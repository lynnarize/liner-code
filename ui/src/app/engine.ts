/*
  The app's view of the engine: one store fed by the event stream, and rpc() for commands.
  The engine owns the state; this keeps a copy and applies each event to it. Text deltas arrive
  many times a second, so listeners hear about changes once per frame.
*/
import { useSyncExternalStore } from "react";
import type { AddonInfo, AgentProfile, EngineEvent, Item, ProviderInfo, Project, Routine, RoutineRun, RpcMethod, RpcParams, RpcResult, Settings, SidebarGroup, Thread, ToolLimits, Updates } from "@contracts";

declare global {
  interface Window {
    /** Set by the macOS shell: where the engine is and the token it expects. */
    __LINER__?: { base?: string; token?: string; machine?: string; user?: string };
  }
}

export type EngineState = {
  connected: boolean;
  ready: boolean;
  version: string;
  home: string;
  projects: Project[];
  /** Your sessions. Side chats are kept apart (`sides`), so no list of sessions shows them. */
  threads: Thread[];
  sides: Thread[];
  agents: AgentProfile[];
  providers: ProviderInfo[];
  settings: Settings;
  keys: string[];
  groups: SidebarGroup[];
  routines: Routine[];
  /** Recent routine runs, newest first. */
  runs: RoutineRun[];
  /** Liner Code's release and the agent tools' versions, and how their updates are going. */
  updates: Updates;
  /** Each tool's plan windows (5-hour, weekly), as the engine last asked them. */
  limits: ToolLimits[];
  /** Your add-ons, and whether this run started without them. */
  addons: AddonInfo[];
  addonsOff: boolean;
  /** Timelines of the threads that have been opened. */
  items: Record<string, Item[]>;
};

const base = () => window.__LINER__?.base ?? "";
const token = () => window.__LINER__?.token ?? "liner-dev";

let state: EngineState = {
  connected: false,
  ready: false,
  version: "",
  home: "",
  projects: [],
  threads: [],
  sides: [],
  agents: [],
  providers: [],
  settings: { onboarded: true, claudeBilling: "plan", settleDays: 0, notify: true, guardDestructive: true, defaultAccess: "ask", worktrees: false, branchPrefix: "liner/", badge: true },
  keys: [],
  groups: [],
  routines: [],
  runs: [],
  updates: { checking: false, app: { current: "", state: "idle", can: "source" }, tools: [], dismissed: {} },
  limits: [],
  addons: [],
  addonsOff: false,
  items: {},
};
const listeners = new Set<() => void>();

/*
  Text deltas wait for the frame and go in together: a reply streaming a hundred tokens a second
  copies its timeline once a frame, not once a token (T3 Code coalesces its live events the same
  way, in orchestration-v2/ThreadLiveEventCoalescer.ts). Any other event takes them first, so
  nothing lands out of order.
*/
const deltas = new Map<string, Map<string, string>>();
function takeDeltas() {
  if (!deltas.size) return;
  const items = { ...state.items };
  for (const [threadId, texts] of deltas) {
    const list = items[threadId];
    if (!list) continue;
    const next = list.slice();
    for (const [itemId, text] of texts) {
      // The item that streams is nearly always the last one.
      const i = next.findLastIndex((x) => x.id === itemId);
      const it = next[i];
      if (it && (it.kind === "text" || it.kind === "reasoning")) next[i] = { ...it, text: it.text + text };
    }
    items[threadId] = next;
  }
  deltas.clear();
  set({ items });
}

// Listeners hear once per frame. A window that is hidden or covered paints no frames, so a timer
// stands in: the Dock badge and notifications keep up while you're in another app.
let pending = false;
let frame = 0;
let timer = 0;
const flush = () => {
  takeDeltas();
  if (!pending) return;
  pending = false;
  cancelAnimationFrame(frame);
  clearTimeout(timer);
  for (const l of listeners) l();
};
const notify = () => {
  if (pending) return;
  pending = true;
  frame = requestAnimationFrame(flush);
  timer = window.setTimeout(flush, 100);
};
const set = (patch: Partial<EngineState>) => {
  state = { ...state, ...patch };
  notify();
};

const upsert = <T extends { id: string }>(list: T[], x: T) => {
  const i = list.findIndex((y) => y.id === x.id);
  if (i < 0) return [...list, x];
  const next = list.slice();
  next[i] = x;
  return next;
};

type NotifyEvent = Extract<EngineEvent, { type: "notify" }>;
const notifyListeners = new Set<(e: NotifyEvent) => void>();
export const onNotify = (fn: (e: NotifyEvent) => void) => {
  notifyListeners.add(fn);
  return () => notifyListeners.delete(fn);
};

/*
  Streams that don't belong in the state: terminal output, device logs, sessions that settled, an
  agent using a Browser, a design's file changing. A design shown (an item) goes to the state and
  here too, so the session can bring its Design surface up.
*/
type Stream = Extract<EngineEvent, { type: "term" | "term.exit" | "devlog" | "launch" | "settled" | "agent.browser" | "design.changed" | "panel.ai" }> | Extract<EngineEvent, { type: "item" }>;
const streamListeners = new Set<(e: Stream) => void>();
export const onStream = (fn: (e: Stream) => void) => {
  streamListeners.add(fn);
  return () => void streamListeners.delete(fn);
};

/**
  Timelines being fetched, and what came for them meanwhile. Each event is numbered (`seq`); once the
  timeline is in, only those after the moment it was read are applied, so none is lost or applied twice
  (T3 Code: client-runtime state/threads.ts, applyEventsLocked against snapshotSequence).
*/
type Numbered = EngineEvent & { seq?: number };
const loading = new Map<string, { events: Numbered[]; done: Promise<void>; mark: object }>();
/** Every timeline asked for, so one whose fetch failed is fetched again on reconnect. */
const wanted = new Set<string>();
/** Where each fetched timeline was read: an event numbered at or before it is already in it, however late it comes. */
const cursor = new Map<string, number>();

function apply(e: Numbered) {
  if (e.type !== "delta") takeDeltas();
  if ((e.type === "item" || e.type === "delta" || e.type === "timeline") && (e.seq ?? Infinity) <= (cursor.get(e.threadId) ?? -1)) return;
  if ((e.type === "item" || e.type === "delta" || e.type === "timeline") && loading.has(e.threadId)) {
    loading.get(e.threadId)!.events.push(e);
    return;
  }
  switch (e.type) {
    case "hello": {
      const s = e.snapshot;
      // A reconnect starts from the snapshot; open timelines are fetched again, and show as they were meanwhile.
      // A session that's gone takes its timeline with it, rather than being asked for again on every reconnect.
      const there = new Set(s.threads.map((t) => t.id));
      const open = [...new Set([...Object.keys(state.items), ...wanted])].filter((id) => there.has(id));
      for (const id of wanted) if (!there.has(id)) wanted.delete(id);
      const kept = Object.fromEntries(Object.entries(state.items).filter(([id]) => there.has(id)));
      // A restarted engine numbers its events from 0 again; each open timeline gets a fresh cursor when it's fetched again below.
      cursor.clear();
      set({ items: kept, connected: true, ready: true, version: s.version, home: s.home, projects: s.projects, threads: s.threads.filter((t) => !t.sideOf), sides: s.threads.filter((t) => t.sideOf), agents: s.agents, providers: s.providers, settings: s.settings, keys: s.keys, groups: s.groups ?? [], routines: s.routines ?? [], runs: [...(s.runs ?? [])].sort((a, b) => b.at - a.at), ...(s.updates ? { updates: s.updates } : {}), limits: s.limits ?? [], addons: s.addons ?? [], addonsOff: s.addonsOff ?? false });
      for (const id of open) void loadItems(id, true).catch(() => {});
      return;
    }
    case "project":
      return set({ projects: upsert(state.projects, e.project) });
    case "project.removed":
      return set({ projects: state.projects.filter((p) => p.id !== e.id), threads: state.threads.filter((t) => t.projectId !== e.id), sides: state.sides.filter((t) => t.projectId !== e.id) });
    case "thread":
      // A side chat comes out of the session list if it was ever there.
      if (e.thread.sideOf) {
        const sides = upsert(state.sides, e.thread);
        return set(state.threads.some((t) => t.id === e.thread.id) ? { sides, threads: state.threads.filter((t) => t.id !== e.thread.id) } : { sides });
      }
      return set({ threads: upsert(state.threads, e.thread) });
    case "thread.removed": {
      // A session deleted for good (or a side chat let go) goes, with its timeline; an archived one comes as "thread".
      wanted.delete(e.id);
      loading.delete(e.id);
      cursor.delete(e.id);
      deltas.delete(e.id);
      const { [e.id]: _gone, ...items } = state.items;
      return set({ threads: state.threads.filter((t) => t.id !== e.id), sides: state.sides.filter((t) => t.id !== e.id && t.sideOf !== e.id), items });
    }
    case "item": {
      if (e.item.kind === "design") for (const fn of streamListeners) fn(e);
      const list = state.items[e.threadId];
      if (!list) return;
      return set({ items: { ...state.items, [e.threadId]: upsert(list, e.item) } });
    }
    case "timeline":
      if (!state.items[e.threadId]) return;
      return set({ items: { ...state.items, [e.threadId]: e.items } });
    case "delta": {
      if (!state.items[e.threadId]) return;
      let texts = deltas.get(e.threadId);
      if (!texts) deltas.set(e.threadId, (texts = new Map()));
      texts.set(e.itemId, (texts.get(e.itemId) ?? "") + e.text);
      return notify();
    }
    case "agents":
      return set({ agents: e.agents });
    case "providers":
      return set({ providers: e.providers });
    case "settings":
      return set({ settings: e.settings });
    case "keys":
      return set({ keys: e.keys });
    case "notify":
      for (const fn of notifyListeners) fn(e);
      return;
    case "groups":
      return set({ groups: e.groups });
    case "routine":
      return set({ routines: upsert(state.routines, e.routine) });
    case "routine.removed":
      return set({ routines: state.routines.filter((r) => r.id !== e.id), runs: state.runs.filter((r) => r.routineId !== e.id) });
    case "run": {
      const i = state.runs.findIndex((r) => r.id === e.run.id);
      const runs = i < 0 ? [e.run, ...state.runs].slice(0, 200) : state.runs.map((r) => (r.id === e.run.id ? e.run : r));
      return set({ runs });
    }
    case "updates":
      return set({ updates: e.updates });
    case "limits":
      return set({ limits: e.tools });
    case "addons":
      return set({ addons: e.addons, addonsOff: e.off });
    case "term":
    case "term.exit":
    case "devlog":
    case "launch":
    case "settled":
    case "agent.browser":
    case "design.changed":
    case "panel.ai":
      for (const fn of streamListeners) fn(e);
      return;
  }
}

/** How long the event stream may say nothing, heartbeats included, before the engine counts as gone. */
const SILENT_MS = 45_000;

/** Reads the event stream, reconnecting with a short backoff when the engine restarts or stops answering. */
async function connect() {
  let wait = 300;
  for (;;) {
    // The engine writes at least a heartbeat every 15 seconds: three missed means it has stopped answering
    // (frozen, or the connection is half open), so the stream is dropped and the app says it's reconnecting
    // (T3 Code: client-runtime connection/supervisor.ts probes the same way).
    const cut = new AbortController();
    let quiet = 0;
    const listen = () => {
      clearTimeout(quiet);
      quiet = window.setTimeout(() => cut.abort(), SILENT_MS);
    };
    listen();
    try {
      const res = await fetch(`${base()}/events`, { headers: { "x-liner-token": token() }, signal: cut.signal });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      wait = 300;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        listen();
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) apply(JSON.parse(line) as EngineEvent);
        }
      }
    } catch (e) {
      // the engine isn't up yet, went away, or stopped answering
      if (import.meta.env.DEV) console.warn("[liner] event stream:", e);
    } finally {
      clearTimeout(quiet);
      // Closed on every way out, a listener that threw included, so the engine doesn't keep writing into it.
      cut.abort();
    }
    set({ connected: false });
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 4000);
  }
}
let started = false;
export function startEngine() {
  if (started) return;
  started = true;
  void connect();
}

export class RpcError extends Error {}
/** The call never got an answer: the app's own Reconnecting pill says so already. */
export class EngineAway extends RpcError {}

export async function rpc<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
  // The engine away, or an answer that isn't its own (401 is plain text): said in words, not "Failed to fetch".
  let body: { ok: boolean; result?: RpcResult<M>; error?: string };
  try {
    const res = await fetch(`${base()}/rpc`, { method: "POST", headers: { "content-type": "application/json", "x-liner-token": token() }, body: JSON.stringify({ method, params }) });
    body = (await res.json()) as typeof body;
  } catch {
    throw new EngineAway("The engine isn't answering. Try again in a moment.");
  }
  if (!body.ok) throw new RpcError(body.error ?? "Something went wrong.");
  return body.result as RpcResult<M>;
}

/**
  Fetches a thread's timeline. Until it's in, the thread has none in the state (a session shows no
  "new session" screen meanwhile), and what comes for it waits. Asking again while it's fetched waits
  for the same fetch, unless `again` (after a reconnect, when events may have been missed).
*/
export function loadItems(threadId: string, again = false): Promise<void> {
  wanted.add(threadId);
  const going = loading.get(threadId);
  if (going && !again) return going.done;
  // After a reconnect only the new stream counts: what the old one left here is in the fresh read, and a
  // restarted engine counts from 0 again, so its high numbers would pass as new and write old text twice.
  const held: Numbered[] = again ? [] : (going?.events ?? []);
  const mark = {};
  const done = (async () => {
    try {
      const { items, seq } = await rpc("thread.load", { id: threadId });
      // A newer fetch (after a reconnect) stands instead.
      if (loading.get(threadId)?.mark !== mark) return;
      loading.delete(threadId);
      cursor.set(threadId, seq);
      takeDeltas();
      set({ items: { ...state.items, [threadId]: items } });
      for (const e of held) if ((e.seq ?? Infinity) > seq) apply(e);
    } catch (err) {
      if (loading.get(threadId)?.mark === mark) loading.delete(threadId);
      throw err;
    }
  })();
  loading.set(threadId, { events: held, done, mark });
  return done;
}

/** Calls back on every change to the engine's state; returns the unsubscribe. */
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getState = () => state;

/** Reads a slice of the engine's state; re-renders when that slice changes. */
export function useEngine<T>(pick: (s: EngineState) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state));
}

/** A session or a side chat, by id. */
export const threadOf = (s: EngineState, id: string) => s.threads.find((t) => t.id === id) ?? s.sides.find((t) => t.id === id);

const EMPTY: Item[] = [];
export const useItems =(threadId: string | undefined) => useEngine((s) => (threadId ? (s.items[threadId] ?? EMPTY) : EMPTY));

/*
  Some of a thread's items, as one array that stays the same while those items do: a streamed
  word changes the thread's list, not its checkpoints or your messages, so whoever reads only
  those doesn't redraw with every frame of a reply. `keep` is a function made once (at the top of
  a module), since it names the view; one filter a frame serves everyone who reads it.
*/
const views = new Map<(it: Item) => boolean, Map<string, { src: Item[]; out: Item[] }>>();
export function itemsWhere(s: EngineState, threadId: string | undefined, keep: (it: Item) => boolean): Item[] {
  if (!threadId) return EMPTY;
  const src = s.items[threadId] ?? EMPTY;
  let byThread = views.get(keep);
  if (!byThread) views.set(keep, (byThread = new Map()));
  const was = byThread.get(threadId);
  if (was?.src === src) return was.out;
  const out = src.filter(keep);
  const same = was !== undefined && was.out.length === out.length && out.every((x, i) => x === was.out[i]);
  byThread.set(threadId, { src, out: same ? was.out : out });
  return same ? was.out : out;
}
export const useItemsWhere = (threadId: string | undefined, keep: (it: Item) => boolean) => useEngine((s) => itemsWhere(s, threadId, keep));

/** Views for useItemsWhere. */
export const isCheckpoint = (it: Item) => it.kind === "checkpoint";
export const isPrompt = (it: Item) => it.kind === "user";
export const isSubagent = (it: Item) => it.kind === "tool" && it.toolKind === "task";
