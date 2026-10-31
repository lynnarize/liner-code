/*
  The app's view of the engine: one store fed by the event stream, and rpc() for commands.
  The engine owns the state; this keeps a copy and applies each event to it. Text deltas arrive
  many times a second, so listeners hear about changes once per frame.
*/
import { useSyncExternalStore } from "react";
import type { AgentProfile, EngineEvent, Item, ProviderInfo, Project, Routine, RoutineRun, RpcMethod, RpcParams, RpcResult, Settings, SidebarGroup, Thread, Updates } from "@contracts";

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
  settings: { onboarded: true, workStyle: "model", claudeBilling: "plan", settleDays: 0, notify: true, guardDestructive: true, defaultAccess: "ask", worktrees: false, branchPrefix: "liner/", badge: true },
  keys: [],
  groups: [],
  routines: [],
  runs: [],
  updates: { checking: false, app: { current: "", state: "idle", can: "source" }, tools: [], dismissed: {} },
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

/* Streams that don't belong in the state: terminal output, device logs, sessions that settled, an agent using a Browser. */
type Stream = Extract<EngineEvent, { type: "term" | "term.exit" | "devlog" | "settled" | "agent.browser" }>;
const streamListeners = new Set<(e: Stream) => void>();
export const onStream = (fn: (e: Stream) => void) => {
  streamListeners.add(fn);
  return () => void streamListeners.delete(fn);
};

function apply(e: EngineEvent) {
  if (e.type !== "delta") takeDeltas();
  switch (e.type) {
    case "hello": {
      const s = e.snapshot;
      // A reconnect starts from the snapshot; open timelines are fetched again.
      const open = Object.keys(state.items);
      set({ connected: true, ready: true, version: s.version, home: s.home, projects: s.projects, threads: s.threads.filter((t) => !t.sideOf), sides: s.threads.filter((t) => t.sideOf), agents: s.agents, providers: s.providers, settings: s.settings, keys: s.keys, groups: s.groups ?? [], routines: s.routines ?? [], runs: [...(s.runs ?? [])].sort((a, b) => b.at - a.at), ...(s.updates ? { updates: s.updates } : {}), items: {} });
      for (const id of open) void loadItems(id);
      return;
    }
    case "project":
      return set({ projects: upsert(state.projects, e.project) });
    case "project.removed":
      return set({ projects: state.projects.filter((p) => p.id !== e.id), threads: state.threads.filter((t) => t.projectId !== e.id), sides: state.sides.filter((t) => t.projectId !== e.id) });
    case "thread":
      // A side chat that's let go comes as archived; it isn't kept like an archived session.
      if (e.thread.sideOf) {
        const sides = e.thread.archived ? state.sides.filter((t) => t.id !== e.thread.id) : upsert(state.sides, e.thread);
        return set(state.threads.some((t) => t.id === e.thread.id) ? { sides, threads: state.threads.filter((t) => t.id !== e.thread.id) } : { sides });
      }
      return set({ threads: e.thread.archived && !state.threads.some((t) => t.id === e.thread.id && !t.archived) ? state.threads.filter((t) => t.id !== e.thread.id) : upsert(state.threads, e.thread) });
    case "item": {
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
    case "term":
    case "term.exit":
    case "devlog":
    case "settled":
    case "agent.browser":
      for (const fn of streamListeners) fn(e);
      return;
  }
}

/** Reads the event stream, reconnecting with a short backoff when the engine restarts. */
async function connect() {
  let wait = 300;
  for (;;) {
    try {
      const res = await fetch(`${base()}/events`, { headers: { "x-liner-token": token() } });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      wait = 300;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) apply(JSON.parse(line) as EngineEvent);
        }
      }
    } catch (e) {
      // the engine isn't up yet, or went away
      if (import.meta.env.DEV) console.warn("[liner] event stream:", e);
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

export async function rpc<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
  const res = await fetch(`${base()}/rpc`, { method: "POST", headers: { "content-type": "application/json", "x-liner-token": token() }, body: JSON.stringify({ method, params }) });
  const body = (await res.json()) as { ok: boolean; result?: RpcResult<M>; error?: string };
  if (!body.ok) throw new RpcError(body.error ?? "Something went wrong.");
  return body.result as RpcResult<M>;
}

export async function loadItems(threadId: string) {
  if (!state.items[threadId]) set({ items: { ...state.items, [threadId]: [] } });
  const items = await rpc("thread.items", { id: threadId });
  // Text that streamed in before the answer goes in first; the answer then stands for it, as it did.
  takeDeltas();
  set({ items: { ...state.items, [threadId]: items } });
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
