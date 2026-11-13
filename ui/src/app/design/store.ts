/*
  The Design face's state: which face the window shows, the design file open on the canvas, its
  frames' HTML, what is selected, the tool, zoom and pan, changes held for live frames, the undo
  stack, and who is drawing which frame. One store, read with useDesign as engine.ts is read with
  useEngine; `design` holds the actions.

  A design file belongs to the folder, so it is opened by the session's folder (cwd). Changes made
  by hand are applied in the frame at once, for the eye, and what is saved is the ops themselves,
  through canvas.frame.apply, which edits only the touched elements in the frame's source: the
  browser's page (with whatever its scripts built) is never written back. Undo keeps the engine's
  `undo` ops and the revision they apply to, so an undo after someone else changed the frame is
  refused rather than writing an old page over theirs. With ?ld-mock in the dev URL the canvas runs
  on docs/demo/foreshore, held in memory, so it can be seen without the engine's design files.
*/
import { useSyncExternalStore } from "react";
import type { DesignFile, DesignFileInfo, DesignFrame, DesignPatch, DesignSelection, DesignSize, EngineEvent, FrameOp, NodeRead, TreeNode } from "@contracts";
import { DESIGN_UNREADABLE, FRAME_CHANGED, FRAME_SIZES } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { EngineAway, getState, onStream, rpc } from "../engine";
import { agentOf } from "../model";
import { frames, lockEditing } from "./bridge";
import { getFace, setFace, subscribeFace } from "../face";

export type Sel = { frame: string; node?: string };
/** play: the frames take the pointer, to try them as they would run. */
export type Tool = "select" | "hand" | "frame" | "box" | "text" | "picture" | "comment" | "play";
export type Presence = { agent: string; name: string; label: string; lead: boolean; node?: string };

export type DesignState = {
  face: "code" | "design";
  cwd?: string;
  file?: DesignFile;
  base?: string;
  sel: Sel[];
  tool: Tool;
  zoom: number;
  pan: { x: number; y: number };
  /** The first selected node, read through the bridge, kept fresh. */
  node?: NodeRead;
  /** Live frames: changes held until sent to code. */
  pending: Record<string, FrameOp[]>;
  /** Who is drawing a frame now, by the frame's id. */
  presence: Record<string, Presence>;
  /** The folder's design files, for Home and the sidebar. */
  files: DesignFileInfo[];
  /** Each drawn frame's HTML as last read or written (stamped). */
  html: Record<string, string>;
  /** Bumps when a frame must be drawn again from `html`. */
  rev: Record<string, number>;
  /** Each drawn frame's file revision as the engine last said it (FrameRev). */
  revs: Record<string, string>;
  /** Each frame's outline, for Layers, once asked for. */
  tree: Record<string, TreeNode>;
  /** The page the canvas shows. */
  page?: string;
  /** The session the face belongs to: edits are written for it, and it hears what is selected. */
  threadId?: string;
  /** A text being edited in place. */
  editing?: Sel;
  loading: boolean;
  error?: string;
  mock: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The folder's design file that can't be read (a broken design.json): which, and the engine's sentence. */
  broken?: { file: string; title?: string; why: string };
  /** Versions.tsx: a kept turn shown in place of the file, read-only, until it's let go. */
  scrub?: number;
};

const MOCK = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("ld-mock");

let state: DesignState = { face: getFace(), sel: [], tool: "select", zoom: 0.36, pan: { x: 40, y: 40 }, pending: {}, presence: {}, files: [], html: {}, rev: {}, revs: {}, tree: {}, loading: false, mock: MOCK, canUndo: false, canRedo: false };
const listeners = new Set<() => void>();
let queued = 0;
const set = (patch: Partial<DesignState>) => {
  state = { ...state, ...patch };
  if (queued) return;
  // Pan and zoom change on every wheel event: listeners hear once a frame.
  queued = requestAnimationFrame(() => {
    queued = 0;
    for (const l of listeners) l();
  });
};
const setNow = (patch: Partial<DesignState>) => {
  state = { ...state, ...patch };
  cancelAnimationFrame(queued);
  queued = 0;
  for (const l of listeners) l();
};

// The face, as face.ts has it.
subscribeFace(() => setNow({ face: getFace() }));

export const getDesign = () => state;
export const subscribeDesign = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
/** Reads a slice of the Design face's state; re-renders when that slice changes. */
export function useDesign<T>(pick: (s: DesignState) => T): T {
  return useSyncExternalStore(subscribeDesign, () => pick(state));
}

export const frameOf = (s: DesignState, id: string | undefined): DesignFrame | undefined => (id ? s.file?.frames.find((f) => f.id === id) : undefined);
/** A page with nothing in its body yet (no element; scripts aside). */
export const blankHtml = (html?: string) => html !== undefined && !/<body[^>]*>[\s\S]*?<[a-z]/i.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
/** A drawn frame with nothing in it: it shows its name and size only, and Checks and Build leave it out. */
export const isBlank = (s: { html: Record<string, string> }, f: DesignFrame) => f.kind === "drawn" && blankHtml(s.html[f.id]);
/** A drawn frame whose file is gone: the engine keeps its entry and says so (read as optional until it always does). */
export const isGone = (f: DesignFrame | undefined) => Boolean(f?.missing);

/*
  Undo. A frame step holds the ops that take it back (the engine's `undo`, or, once undone, the ops
  that do it again) and the frame's revision they apply to. An index step holds frames' places and
  sizes. An own step is any feature's (design.record): its own undo and redo. In the mock, a frame
  step keeps the two documents, as nothing is saved.
*/
type FrameStep = { kind: "frame"; frame: string; ops: FrameOp[]; rev: string; key?: string; at: number };
type MockStep = { kind: "mock"; frame: string; before: string; after: string; key?: string; at: number };
type IndexStep = { kind: "index"; before: DesignFrame[]; after: DesignFrame[]; at: number };
type OwnStep = { kind: "own"; label?: string; undo: () => Promise<void> | void; redo: () => Promise<void> | void; at: number };
type Step = FrameStep | MockStep | IndexStep | OwnStep;
const undos: Step[] = [];
const redos: Step[] = [];
const COALESCE_MS = 1200;
const syncUndo = () => set({ canUndo: undos.length > 0, canRedo: redos.length > 0 });
const pushStep = (s: Step, key?: string) => {
  const last = undos[undos.length - 1];
  // Changes to the same thing in a row (a slider dragged, letters typed) are one step: the newest
  // change's way back first, then the earlier one's, applied to the newest revision.
  if (key && last && last.kind === s.kind && (s.kind === "frame" || s.kind === "mock") && "frame" in last && last.frame === s.frame && last.key === key && s.at - last.at < COALESCE_MS) {
    if (last.kind === "frame" && s.kind === "frame") {
      last.ops = [...s.ops, ...last.ops];
      last.rev = s.rev;
    }
    if (last.kind === "mock" && s.kind === "mock") last.after = s.after;
    last.at = s.at;
  } else {
    undos.push(key && (s.kind === "frame" || s.kind === "mock") ? { ...s, key } : s);
    if (undos.length > 200) undos.shift();
  }
  redos.length = 0;
  syncUndo();
};
/** Someone else changed this frame: its steps can't be taken back any more. */
function forgetFrame(frame: string) {
  const keep = (x: Step) => !((x.kind === "frame" || x.kind === "mock") && x.frame === frame);
  const u = undos.filter(keep);
  const r = redos.filter(keep);
  if (u.length === undos.length && r.length === redos.length) return;
  undos.splice(0, undos.length, ...u);
  redos.splice(0, redos.length, ...r);
  syncUndo();
}
/** The revisions this window wrote, so their canvas.changed isn't taken for someone else's. */
const mine = new Set<string>();
/** Each frame's saves in flight, one after another, so ops reach the file in the order they were made. */
const inflight = new Map<string, Promise<unknown>>();
const inOrder = <T>(frame: string, run: () => Promise<T>): Promise<T> => {
  const next = (inflight.get(frame) ?? Promise.resolve()).catch(() => {}).then(run);
  inflight.set(frame, next);
  return next;
};
const quiet = (text: string) => toast(text, { duration: 3500 });
/** An agent's change heard for a frame (canvas.changed by "agent"): who, so a refusal can name it. */
const agentHeard = new Map<string, string>();
function heardAgent(frame: string, threadId?: string) {
  const s = getState();
  const t = threadId ? s.threads.find((x) => x.id === threadId) ?? s.sides.find((x) => x.id === threadId) : undefined;
  agentHeard.set(frame, t ? agentOf(t.agent, s.agents, s.providers).name : "An agent");
}
/** Said when the engine refuses an undo for a stale base: only what is known. */
const staleLine = (frame: string) => (agentHeard.has(frame) ? `${agentHeard.get(frame)} changed this frame since; nothing to undo there.` : "This frame changed since; nothing to undo there.");
/** The revision the call started from (the engine's `from`), when it says; optional until it always does. */
const fromOf = (r: object) => (r as { from?: string }).from;
const NOTICED = "This frame changed on disk just before your change. It's drawn again from its file, with your change in it.";

// The file as it was before a kept turn was shown in its place (Versions.tsx), and whether it changed meanwhile.
let scrubbed: { file?: DesignFile; html: Record<string, string>; stale: boolean } | undefined;
lockEditing(() => state.scrub !== undefined);


// The engine's events for the canvas, from the app's one event stream (engine.ts), heard while a design file is open.
let unhear: (() => void) | undefined;
function listenCanvas(on: boolean) {
  unhear?.();
  unhear = undefined;
  if (!on || MOCK) return;
  unhear = onStream((e) => {
    if (e.type === "canvas.changed" || e.type === "canvas.presence") onCanvasEvent(e);
  });
}

/** canvas.changed and canvas.presence: the frame drawn again, who is drawing where. */
export function onCanvasEvent(e: EngineEvent) {
  const s = state;
  if (e.type === "canvas.changed") {
    if (e.cwd !== s.cwd || e.file !== s.file?.id) return;
    // Its folder or design.json removed on disk (the engine's `gone`): none is open, and its tab lets go with one line.
    if (e.gone === true) return void goneNow(s.cwd!, s.file!.id);
    if (s.scrub !== undefined) return void (scrubbed && (scrubbed.stale = true));
    const frame = e.frame;
    if (!frame) return void reloadFile();
    if (e.by === "agent") heardAgent(frame, e.threadId);
    // Heard after this window's own save to that frame lands, so its own revision is known by then.
    void (inflight.get(frame) ?? Promise.resolve()).catch(() => {}).then(() => {
      // Ours, or the frame already as it is; except a frame whose file was gone and is back (the same bytes again).
      if (e.rev && (mine.has(e.rev) || state.revs[frame] === e.rev) && !isGone(frameOf(state, frame))) return;
      forgetFrame(frame);
      void reloadFile(frame);
    });
    return;
  }
  if (e.type === "canvas.presence") {
    if (e.cwd !== s.cwd || e.file !== s.file?.id) return;
    const presence = { ...s.presence };
    if (e.on) presence[e.frame] = { agent: e.agent, name: e.name, label: e.label, lead: !/sidekick/i.test(e.label) && !/sidekick/i.test(e.name), node: e.node };
    else delete presence[e.frame];
    set({ presence });
  }
}

async function reloadFile(frame?: string) {
  const s = state;
  if (!s.cwd || !s.file) return;
  const cwd = s.cwd;
  const id = s.file.id;
  try {
    const { file, base } = await rpc("canvas.open", { cwd, file: id });
    if (state.cwd !== cwd || state.file?.id !== id) return;
    const want = frame ? file.frames.filter((f) => f.id === frame) : file.frames.filter((f) => !state.html[f.id] || f.kind === "drawn");
    const html = { ...state.html };
    const rev = { ...state.rev };
    const revs = { ...state.revs };
    // A frame whose file is gone has nothing to read; it's drawn as its empty box until the file is back.
    await Promise.all(want.filter((f) => f.kind === "drawn" && !f.missing).map(async (f) => {
      const r = await rpc("canvas.frame.read", { cwd, file: id, frame: f.id }).catch(() => undefined);
      if (!r) return;
      // A frame whose file isn't what this window last knew was changed by someone else: its steps go.
      if (revs[f.id] && revs[f.id] !== r.rev && !mine.has(r.rev)) forgetFrame(f.id);
      revs[f.id] = r.rev;
      if (html[f.id] !== r.html) {
        html[f.id] = r.html;
        rev[f.id] = (rev[f.id] ?? 0) + 1;
      }
    }));
    // A frame taken away takes its selection with it; the rest is kept by data-l, and a layer its
    // frame's source no longer has is let go (settled), before anything reads it.
    const there = new Set(file.frames.map((f) => f.id));
    let patch: Partial<DesignState> = { sel: state.sel.filter((x) => there.has(x.frame)) };
    for (const f of want) if (html[f.id] !== undefined) {
      const before = state;
      state = { ...state, ...patch };
      patch = { ...patch, ...settled(f.id, html[f.id]) };
      state = before;
    }
    setNow({ file, base, html, rev, revs, ...patch });
    void design.refreshNode();
  } catch {
    // Gone from its folder (deleted elsewhere, moved): none is open, and its tab lets go (DesignFace). Otherwise the next change tries again.
    // A folder that's gone altogether lists as nothing; an engine that's away says nothing either way.
    const files = await rpc("canvas.list", { cwd }).catch((e: unknown) => (e instanceof EngineAway ? undefined : ([] as DesignFileInfo[])));
    if (files && !files.some((f) => f.id === id)) goneNow(cwd, id, files);
  }
}

/** The open design's files went from under it: nothing is open, and its tab (DesignFace) closes with one line. */
function goneNow(cwd: string, id: string, files: DesignFileInfo[] = state.files.filter((f) => f.id !== id)) {
  if (state.cwd !== cwd || state.file?.id !== id) return;
  if (state.scrub !== undefined) design.scrub();
  vanished = { cwd, file: id, title: state.file.title };
  listenCanvas(false);
  watchFile();
  setNow({ files, file: undefined, sel: [], node: undefined, html: {}, tree: {}, presence: {}, pending: {}, broken: undefined, loading: false });
}
/** The open design whose files went from under it (deleted elsewhere, its folder removed on disk), for its tab's one line. */
let vanished: { cwd: string; file: string; title: string } | undefined;
export function takeVanished(cwd: string, file: string) {
  const v = vanished?.cwd === cwd && vanished.file === file ? vanished.title : undefined;
  if (v) vanished = undefined;
  return v;
}
/** Reads a frame's file again, and draws it again from it. */
/**
  The one place a selection is kept true to a frame's file: whenever the frame is drawn again from
  its source (an accepted Code tab edit, a refusal, an agent's write, undo and redo, a turn brought
  back, a take kept), every picked layer whose id the source no longer has is let go, in the same
  change that puts the source in, before anything reads it. With nothing of it left, the frame
  itself stays picked. The read node goes with its layer.
*/
function settled(frame: string, html: string): Partial<DesignState> {
  const there = new Set([...html.matchAll(/\sdata-l="([^"]+)"/g)].map((m) => m[1]));
  const s = state;
  const gone = s.sel.filter((x) => x.frame === frame && x.node && !there.has(x.node));
  if (!gone.length) return {};
  let sel = s.sel.filter((x) => !gone.includes(x));
  if (!sel.some((x) => x.frame === frame)) sel = [...sel, { frame }];
  const node = s.node && gone.some((x) => x.node === s.node!.id) ? undefined : s.node;
  return { sel, node, editing: s.editing && gone.some((x) => x.node === s.editing!.node) ? undefined : s.editing };
}
async function redrawFromFile(frame: string) {
  const s = state;
  if (s.mock || !s.cwd || !s.file) return;
  const r = await rpc("canvas.frame.read", { cwd: s.cwd, file: s.file.id, frame }).catch(() => undefined);
  if (!r) return;
  setNow({ html: { ...state.html, [frame]: r.html }, rev: { ...state.rev, [frame]: (state.rev[frame] ?? 0) + 1 }, revs: { ...state.revs, [frame]: r.rev }, ...settled(frame, r.html) });
  tellSelection();
}
/** The frame's source as it is now, kept for the canvas (no redraw: the frame already shows it). Called only when the frame on screen is known to match the file. */
async function keepSource(frame: string, rev: string) {
  const s = state;
  if (s.mock || !s.cwd || !s.file) return;
  const r = await rpc("canvas.frame.read", { cwd: s.cwd, file: s.file.id, frame }).catch(() => undefined);
  if (r && r.rev === rev) setNow({ html: { ...state.html, [frame]: r.html } });
}
const refusal = (e: unknown) => (e instanceof Error ? e.message : String(e));
const changedSince = (e: unknown) => refusal(e).startsWith(FRAME_CHANGED) || /There's no element/.test(refusal(e));

let saving = 0;
let savePatch: DesignPatch["frames"] = [];
/** Writes frames' places and sizes, a moment after the last change (a drag sends many). */
function saveFrames(changes: NonNullable<DesignPatch["frames"]>) {
  for (const c of changes) {
    const i = savePatch!.findIndex((x) => x.id === c.id);
    if (i < 0) savePatch!.push(c);
    else savePatch![i] = { ...savePatch![i], ...c };
  }
  clearTimeout(saving);
  saving = window.setTimeout(() => {
    const s = state;
    const patch = savePatch!;
    savePatch = [];
    if (s.mock || !s.cwd || !s.file || !patch.length) return;
    void rpc("canvas.save", { cwd: s.cwd, file: s.file.id, patch: { frames: patch } }).catch((e: Error) => set({ error: e.message }));
  }, 250);
}

const patchFrames = (fn: (f: DesignFrame) => DesignFrame) => {
  const file = state.file;
  if (!file) return;
  setNow({ file: { ...file, frames: file.frames.map(fn) } });
};

let selectionTimer = 0;
function tellSelection() {
  clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    const s = state;
    if (!s.threadId || s.mock) return;
    void rpc("canvas.selection", { threadId: s.threadId, sel: selectionOf(s) }).catch(() => {});
  }, 150);
}

/** What is selected, as design_selection gives it to the agent (and the dock sends with a design turn). */
export function selectionOf(s: DesignState): DesignSelection | null {
  if (!s.file || !s.sel.length) return null;
  const nodes = s.sel.filter((x) => x.node).map((x) => ({ frame: x.frame, id: x.node!, html: s.node && s.node.id === x.node ? s.node.html : "" }));
  const pending = Object.entries(s.pending).filter(([, ops]) => ops.length).map(([frame, ops]) => ({ frame, ops }));
  return { file: s.file.id, frames: [...new Set(s.sel.map((x) => x.frame))], nodes, ...(pending.length ? { pending } : {}) };
}

const redraw = (frame: string, html: string) => setNow({ html: { ...state.html, [frame]: html }, rev: { ...state.rev, [frame]: (state.rev[frame] ?? 0) + 1 } });

async function runSteps(from: Step[], to: Step[], back: boolean) {
  const step = from.pop();
  if (!step) return;
  syncUndo();
  if (step.kind === "frame") {
    const s = state;
    if (!s.cwd || !s.file) return;
    const cwd = s.cwd;
    const file = s.file.id;
    try {
      const r = await inOrder(step.frame, () => rpc("canvas.frame.apply", { cwd, file, frame: step.frame, ops: step.ops, base: step.rev, threadId: s.threadId }));
      mine.add(r.rev);
      // With a base, the engine starts from it or refuses; a `from` that isn't it means the frame moved anyway.
      const moved = fromOf(r) !== undefined && fromOf(r) !== step.rev;
      setNow({ revs: { ...state.revs, [step.frame]: r.rev } });
      to.push({ ...step, ops: r.undo, rev: r.rev, key: undefined, at: Date.now() });
      syncUndo();
      // The same ops in the frame, for the eye; if it can't take them, it's drawn again from the file.
      const shown = moved ? undefined : await frames.apply(step.frame, step.ops).catch(() => undefined);
      if (moved) (forgetFrame(step.frame), quiet(NOTICED));
      if (!shown) await redrawFromFile(step.frame);
      else if (fromOf(r) !== undefined) void keepSource(step.frame, r.rev);
      void design.refreshTree(step.frame);
    } catch (e) {
      forgetFrame(step.frame);
      if (changedSince(e)) quiet(staleLine(step.frame));
      else quiet(`That couldn't be ${back ? "undone" : "done again"}: ${refusal(e)}`);
      await redrawFromFile(step.frame);
    }
    return;
  }
  if (step.kind === "mock") {
    to.push(step);
    syncUndo();
    redraw(step.frame, back ? step.before : step.after);
    return;
  }
  if (step.kind === "own") {
    try {
      await (back ? step.undo() : step.redo());
      to.push(step);
    } catch (e) {
      quiet(`That couldn't be ${back ? "undone" : "done again"}: ${refusal(e)}`);
    }
    syncUndo();
    return;
  }
  to.push(step);
  syncUndo();
  const list = back ? step.before : step.after;
  const file = state.file;
  if (!file) return;
  const byId = new Map(list.map((f) => [f.id, f]));
  setNow({ file: { ...file, frames: file.frames.map((f) => byId.get(f.id) ?? f) } });
  saveFrames(list.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })));
}

/** One canvas.watch for the open file, taken off when the file or the folder changes, or the window closes. */
let watching: { cwd: string; file: string } | undefined;
function watchFile(cwd?: string, file?: string) {
  if (watching && watching.cwd === cwd && watching.file === file) return;
  if (watching) void rpc("canvas.watch", { ...watching, on: false }).catch(() => {});
  watching = cwd && file ? { cwd, file } : undefined;
  if (watching) void rpc("canvas.watch", { ...watching, on: true }).catch(() => {});
}
if (typeof window !== "undefined") window.addEventListener("pagehide", () => watchFile());

/*
  Tabs. The store holds one open design file; the others open in tabs keep, while hidden, what is
  theirs alone: the view (zoom, pan, page, tool), the selection, the undo and redo steps, and the
  changes held for live frames. Showing a tab parks the one before and reads its own file again
  from disk (its frames' HTML, the checks and the build state follow from that, as on any open);
  then its parked view and steps come back. A step taken against a frame that changed while the
  tab was hidden goes (its revision moved), the same as when an agent writes the open file.
*/
type Parked = { cwd: string; file: string; zoom: number; pan: { x: number; y: number }; page?: string; tool: Tool; sel: Sel[]; undos: Step[]; redos: Step[]; revs: Record<string, string>; pending: Record<string, FrameOp[]> };
const parked = new Map<string, Parked>();
/** The tab whose file the store holds now (set once its file is open), so a park files the right view under the right tab. */
let parkKey: string | undefined;
let shownAt: { key: string; cwd: string; file: string } | undefined;
let showing: { key: string; done: Promise<void> } | undefined;
/** The file a tab with a view of its own is opening: Canvas.tsx doesn't fit it, as its view comes back. */
let keepView: string | undefined;
export const keepsView = (file: string) => keepView === file;
function park() {
  const s = state;
  const at = shownAt;
  if (!at || !s.cwd || !s.file || s.mock || s.cwd !== at.cwd || s.file.id !== at.file) return;
  if (s.scrub !== undefined) design.scrub();
  parked.set(at.key, { cwd: s.cwd, file: s.file.id, zoom: s.zoom, pan: s.pan, page: s.page, tool: s.tool === "play" ? "select" : s.tool, sel: s.sel, undos: [...undos], redos: [...redos], revs: { ...s.revs }, pending: s.pending });
}
/** Who makes the session of a tab that has none yet (the shell sets it): a design's first ask makes it. */
let sessionMaker: (() => Promise<string>) | undefined;
export const setSessionMaker = (fn: (() => Promise<string>) | undefined) => void (sessionMaker = fn);

export const design = {
  /**
    Shows a design file in its tab (`key`, face.ts tabKey): the tab before is parked, this one's
    file opened, and its own view and steps put back. Asked again for the same tab while it opens,
    it waits on the same opening.
  */
  show(key: string, cwd: string, file: string, threadId?: string): Promise<void> {
    if (shownAt?.key === key && shownAt.cwd === cwd && shownAt.file === file && state.file?.id === file) return Promise.resolve(void (state.threadId !== threadId && setNow({ threadId })));
    if (showing?.key === key) return showing.done.then(() => void (state.threadId !== threadId && setNow({ threadId })));
    const done = (async () => {
      park();
      shownAt = undefined;
      parkKey = key;
      keepView = parked.get(key)?.file === file ? file : undefined;
      setNow({ threadId, editing: undefined, scrub: undefined });
      await design.open(cwd, file);
      if (parkKey !== key || state.cwd !== cwd || state.file?.id !== file) return;
      shownAt = { key, cwd, file };
      const p = parked.get(key);
      // A tab shown for the first time: the canvas fits it (Canvas.tsx), nothing picked.
      if (!p || p.cwd !== cwd || p.file !== file) return void setNow({ tool: "select", sel: [], node: undefined });
      parked.delete(key);
      // After the canvas has drawn the file (and fitted it, as it does a file it hasn't shown), this tab's own view.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (shownAt?.key !== key) return void parked.set(key, p);
      undos.splice(0, undos.length, ...p.undos);
      redos.splice(0, redos.length, ...p.redos);
      // Frames another hand changed while the tab was hidden: their steps go.
      for (const [frame, rev] of Object.entries(p.revs)) if (state.revs[frame] !== rev && !mine.has(state.revs[frame] ?? "")) forgetFrame(frame);
      const there = new Set(state.file!.frames.map((f) => f.id));
      setNow({ zoom: p.zoom, pan: p.pan, tool: p.tool, page: p.page && state.file!.pages.some((x) => x.id === p.page) ? p.page : state.page, sel: p.sel.filter((x) => there.has(x.frame)), pending: Object.fromEntries(Object.entries(p.pending).filter(([f]) => there.has(f))), canUndo: undos.length > 0, canRedo: redos.length > 0 });
      keepView = undefined;
      // Held changes are shown again in their live pages, which loaded without them (Canvas.tsx does it for a page that loads later).
      for (const [frame, ops] of Object.entries(state.pending)) if (ops.length && frameOf(state, frame)?.kind === "live") void frames.apply(frame, ops).catch(() => {});
      void design.refreshNode();
    })();
    showing = { key, done };
    return done.finally(() => void (showing?.done === done && (showing = undefined)));
  },
  /** The design open now moved (Build in a project): its view and steps go with it to its new place, ready for show(). */
  moved(from: string, to: string, cwd: string, file: string) {
    if (shownAt?.key !== from) return;
    park();
    const p = parked.get(from);
    parked.delete(from);
    if (p) parked.set(to, { ...p, cwd, file });
    shownAt = undefined;
    parkKey = undefined;
  },
  /** A tab closed: what it parked goes. */
  forget(key: string) {
    parked.delete(key);
  },
  /** The session edits are written for: the bound one, else (a design with none yet) the one its first ask makes. */
  async session(): Promise<string | undefined> {
    if (state.threadId) return state.threadId;
    if (!sessionMaker) return undefined;
    const id = await sessionMaker();
    setNow({ threadId: id });
    return id;
  },
  /** The face lives in face.ts (so Liner Code knows it without loading this); the store follows it. */
  setFace(face: "code" | "design") {
    setFace(face);
  },
  toggleFace() {
    design.setFace(state.face === "design" ? "code" : "design");
  },
  /** The session the face is for: its folder's design files, and where edits are written. */
  bind(threadId: string | undefined, cwd: string | undefined) {
    if (state.threadId === threadId && state.cwd === cwd) return;
    const folderChanged = state.cwd !== cwd;
    setNow({ threadId });
    if (folderChanged && cwd) void design.open(cwd);
  },
  /** Opens a folder's design file: the one named, else the latest; none leaves the face on Design Home. */
  async open(cwd: string, file?: string) {
    if (state.mock) return openMock(cwd);
    const was = state.file && state.cwd ? { cwd: state.cwd, file: state.file.id } : undefined;
    if (was && was.cwd !== cwd) watchFile();
    setNow({ cwd, loading: true, error: undefined, ...(was && (was.cwd !== cwd || (file && file !== was.file)) ? { file: undefined, sel: [], node: undefined, html: {}, tree: {}, presence: {}, pending: {} } : {}) });
    try {
      const files = await rpc("canvas.list", { cwd });
      if (state.cwd !== cwd) return;
      // A file named that the folder hasn't got (deleted, moved into a project): none is open, and its tab lets go.
      const pick = file ? (files.some((f) => f.id === file) ? file : undefined) : [...files].sort((a, b) => b.updated - a.updated)[0]?.id;
      if (!pick) {
        listenCanvas(false);
        watchFile();
        return setNow({ files, file: undefined, loading: false, broken: undefined });
      }
      // A design file the engine says it can't read is never opened over (nor a new one made in its place).
      const info = files.find((f) => f.id === pick);
      if (info?.unreadable) {
        listenCanvas(false);
        watchFile();
        return setNow({ files, file: undefined, loading: false, broken: { file: pick, title: info.title, why: info.unreadable } });
      }
      let opening;
      try {
        opening = await rpc("canvas.open", { cwd, file: pick });
      } catch (e) {
        listenCanvas(false);
        watchFile();
        // The engine's sentence, without its "unreadable:" tag (DESIGN_UNREADABLE).
        const why = (e as Error).message.replace(new RegExp(`^${DESIGN_UNREADABLE}\\s*`), "");
        return setNow({ files, file: undefined, loading: false, broken: { file: pick, title: info?.title, why } });
      }
      const { file: df, base, revs: opened } = opening;
      const html: Record<string, string> = {};
      const revs: Record<string, string> = { ...(opened ?? {}) };
      await Promise.all(df.frames.filter((f) => f.kind === "drawn" && !f.missing).map(async (f) => {
        const r = await rpc("canvas.frame.read", { cwd, file: pick, frame: f.id }).catch(() => ({ html: "", rev: "" }));
        html[f.id] = r.html;
        if (r.rev) revs[f.id] = r.rev;
      }));
      if (state.cwd !== cwd) return;
      watchFile(cwd, pick);
      listenCanvas(true);
      // The same file opened again keeps its steps; another one starts afresh.
      const again = was?.cwd === cwd && was.file === pick;
      if (!again) {
        undos.length = 0;
        redos.length = 0;
        agentHeard.clear();
      }
      setNow({ broken: undefined, files, file: df, base, html, rev: again ? Object.fromEntries(Object.keys(html).map((k) => [k, (state.rev[k] ?? 0) + (state.html[k] === html[k] ? 0 : 1)])) : {}, revs, tree: again ? state.tree : {}, page: again ? state.page : df.pages[0]?.id, sel: again ? state.sel : [], node: again ? state.node : undefined, loading: false, canUndo: undos.length > 0, canRedo: redos.length > 0 });
      } catch (e) {
      setNow({ loading: false, error: (e as Error).message });
    }
  },
  /** The folder's design files again (Home's tiles). */
  async list(cwd: string) {
    if (state.mock) return void (await openMock(cwd, true));
    try {
      const files = await rpc("canvas.list", { cwd });
      setNow({ files });
    } catch {
      // the list stays as it was
    }
  },
  /** A new design file, opened on the canvas. */
  async create(cwd: string, title: string, size?: DesignSize) {
    if (state.mock) {
      await openMock(cwd);
      return state.file;
    }
    const df = await rpc("canvas.create", { cwd, title, size });
    await design.open(cwd, df.id);
    return df;
  },
  close() {
    watchFile();
    listenCanvas(false);
    setNow({ file: undefined, sel: [], node: undefined, html: {}, tree: {}, presence: {} });
  },
  select(sel: Sel[]) {
    const same = sel.length === state.sel.length && sel.every((x, i) => x.frame === state.sel[i].frame && x.node === state.sel[i].node);
    if (same) return;
    setNow({ sel, editing: undefined, ...(sel[0]?.node ? {} : { node: undefined }) });
    void design.refreshNode();
    tellSelection();
  },
  setTool(tool: Tool) {
    setNow({ tool });
  },
  setPage(page: string) {
    setNow({ page, sel: [], node: undefined });
  },
  /** Pan and zoom; zoom kept between 2% and 800%. */
  view(zoom: number, pan: { x: number; y: number }) {
    set({ zoom: Math.min(8, Math.max(0.02, zoom)), pan });
  },
  /** Applies changes to a frame through the bridge and writes it, with undo. Live frames hold them in `pending`. */
  async apply(frame: string, ops: FrameOp[], opts?: { coalesce?: string; own?: boolean }): Promise<{ ok: boolean; error?: string } | undefined> {
    if (state.scrub !== undefined) return;
    const f = frameOf(state, frame);
    if (!f || !ops.length) return;
    if (f.kind === "live") {
      const pending = { ...state.pending, [frame]: [...(state.pending[frame] ?? []), ...ops] };
      await frames.apply(frame, ops).catch(() => undefined);
      setNow({ pending });
      tellSelection();
      return void design.refreshNode();
    }
    // In the frame at once, for the eye; except a piece of HTML written by hand (an `html` op), which a
    // browser may take apart and put back otherwise: it goes to the engine exactly as written, and the
    // frame is drawn from the file once the engine has taken it (or nothing is drawn when it refuses).
    const before = state.html[frame] ?? "";
    const eye = state.mock || !ops.some((o) => "html" in o);
    const shown = eye ? await frames.apply(frame, ops).catch(() => undefined) : undefined;
    const drop = (ids: string[]) => {
      // A node that went away takes its selection with it.
      const there = new Set(ids);
      const sel = state.sel.filter((x) => x.frame !== frame || !x.node || there.has(x.node));
      if (sel.length !== state.sel.length) setNow({ sel });
    };
    if (state.mock) {
      if (!shown) return;
      setNow({ html: { ...state.html, [frame]: shown.html } });
      pushStep({ kind: "mock", frame, before, after: shown.html, at: Date.now() }, opts?.coalesce);
      drop(shown.ids);
      void design.refreshNode();
      void design.refreshTree(frame);
      return;
    }
    const s = state;
    if (!s.cwd || !s.file) return;
    const cwd = s.cwd;
    const file = s.file.id;
    // What is saved is the ops, on the frame's source: never the browser's page.
    try {
      // The revision this window believed the frame was at when the call went out.
      let believed: string | undefined;
      const r = await inOrder(frame, () => ((believed = state.revs[frame]), rpc("canvas.frame.apply", { cwd, file, frame, ops, threadId: s.threadId })));
      mine.add(r.rev);
      setNow({ revs: { ...state.revs, [frame]: r.rev } });
      // N2: the source had moved on (an agent's write the watcher hadn't told of yet): the file holds
      // that change and this one, the frame on screen only this one. It's drawn again from the file,
      // and the frame's older steps go, as they were taken against another page.
      const moved = fromOf(r) !== undefined && believed !== undefined && fromOf(r) !== believed;
      if (moved) forgetFrame(frame);
      // A change that changed nothing (the same text sent again) is no step to undo.
      if (r.undo.length && r.rev !== (fromOf(r) ?? believed)) pushStep({ kind: "frame", frame, ops: r.undo, rev: r.rev, at: Date.now() }, opts?.coalesce);
      // New elements take the engine's ids; if the frame gave them others, it's drawn again from the file.
      const inFrame = new Set(shown?.ids ?? []);
      if (moved) {
        quiet(NOTICED);
        await redrawFromFile(frame);
      } else if (!eye || !shown || r.ids.some((id) => !inFrame.has(id))) await redrawFromFile(frame);
      else {
        drop(shown.ids);
        // The file's text is kept only when the frame on screen is known to match it (the call started from the page shown).
        if (fromOf(r) !== undefined) void keepSource(frame, r.rev);
      }
    } catch (e) {
      // `own`: the caller says the engine's sentence itself (the Code tab, under its draft).
      if (!opts?.own) quiet(changedSince(e) ? "The frame changed on disk, so that change wasn't saved. It's drawn again as it is now." : `That change wasn't saved: ${refusal(e)} The frame is drawn again from its file.`);
      if (eye) await redrawFromFile(frame);
      return { ok: false, error: refusal(e) };
    }
    void design.refreshNode();
    void design.refreshTree(frame);
    return { ok: true };
  },
  /**
    The whole frame written at once (a take kept, a page put back): checked against the revision this
    window last read (or `base`, the revision a step wrote), so it never lands on top of an agent's newer write. Refused, the frame is drawn
    again as it is now and the answer is false; whoever asked keeps what they were writing.
  */
  async writeWhole(frame: string, html: string, opts?: { quietly?: boolean; base?: string }) {
    const s = state;
    if (s.mock) {
      redraw(frame, html);
      return { rev: "" };
    }
    if (!s.cwd || !s.file) return undefined;
    const cwd = s.cwd;
    const file = s.file.id;
    try {
      const base = opts?.base ?? state.revs[frame];
      const r = await inOrder(frame, () => rpc("canvas.frame.write", { cwd, file, frame, html, threadId: s.threadId, base }));
      mine.add(r.rev);
      setNow({ revs: { ...state.revs, [frame]: r.rev } });
      if (fromOf(r) !== undefined && base !== undefined && fromOf(r) !== base) forgetFrame(frame);
      await redrawFromFile(frame);
      return { rev: r.rev };
    } catch (e) {
      if (!opts?.quietly) quiet(changedSince(e) ? `${agentHeard.get(frame) ?? "Someone"} changed this frame just now, so it wasn't written. It's drawn again as it is; what you wrote is still where you wrote it.` : `The frame wasn't written: ${refusal(e)}`);
      await redrawFromFile(frame);
      return undefined;
    }
  },
  /**
    Records a step of a feature's own on the undo stack: `undo` takes it back, `redo` does it again.
    Returns a handle whose `undo()` takes back exactly this step, if it's still the newest one there
    (a toast's Undo).
  */
  record(step: { label?: string; undo: () => Promise<void> | void; redo: () => Promise<void> | void }) {
    const own: OwnStep = { kind: "own", ...step, at: Date.now() };
    pushStep(own);
    return {
      undo: () => {
        if (undos[undos.length - 1] !== own) return void quiet("Something changed since, so use ⌘Z to step back to it.");
        void runSteps(undos, redos, true).then(() => design.refreshNode());
      },
    };
  },
  undo() {
    if (state.scrub !== undefined) return;
    void runSteps(undos, redos, true).then(() => design.refreshNode());
  },
  redo() {
    if (state.scrub !== undefined) return;
    void runSteps(redos, undos, false).then(() => design.refreshNode());
  },
  /** Reads the first selected node again through the bridge. */
  async refreshNode() {
    const first = state.sel.find((x) => x.node);
    if (!first) {
      if (state.node) setNow({ node: undefined });
      return;
    }
    try {
      const node = await frames.read(first.frame, first.node!);
      const now = state.sel.find((x) => x.node);
      if (now?.frame === first.frame && now.node === first.node) setNow({ node });
    } catch {
      // The node went away, or the frame is reloading: the next ready reads it again. What's shown
      // never stays the read of a layer that isn't the one picked now.
      if (state.node && state.node.id !== state.sel.find((x) => x.node)?.node) setNow({ node: undefined });
    }
  },
  /** A frame's outline again, for Layers. */
  async refreshTree(frame: string) {
    try {
      const root = await frames.tree(frame);
      setNow({ tree: { ...state.tree, [frame]: root } });
    } catch {
      // kept as it was
    }
  },
  /** Moves or resizes frames on the canvas; `done` ends a drag (one undo step for all of it). */
  place(changes: { id: string; x?: number; y?: number; w?: number; h?: number }[], done?: { before: DesignFrame[] }) {
    if (state.scrub !== undefined) return;
    const byId = new Map(changes.map((c) => [c.id, c]));
    patchFrames((f) => {
      const c = byId.get(f.id);
      if (!c) return f;
      return { ...f, x: Math.round(c.x ?? f.x), y: Math.round(c.y ?? f.y), w: Math.max(40, Math.round(c.w ?? f.w)), h: Math.max(40, Math.round(c.h ?? f.h)) };
    });
    if (done) {
      const after = (state.file?.frames ?? []).filter((f) => byId.has(f.id));
      pushStep({ kind: "index", before: done.before, after, at: Date.now() });
      saveFrames(after.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })));
    }
  },
  /**
    A single-HTML design of the Design surface as a frame of the folder's design file named after
    it (the file made the first time). A frame of that name that already holds this page is left
    as it is; one that holds another page is never written over: the page comes in as a new frame
    beside it ("… 2"), and the toast says so. Adding is a step to undo. Returns the design file's id.
  */
  async adopt(cwd: string, d: { title: string; html: string; size: DesignSize }) {
    if (state.mock) {
      await openMock(cwd);
      return state.file?.id;
    }
    const files = await rpc("canvas.list", { cwd });
    const was = files.find((f) => f.title === d.title);
    const df = was ? (await rpc("canvas.open", { cwd, file: was.id })).file : await rpc("canvas.create", { cwd, title: d.title });
    // Opened first, so the step below belongs to this file's undo.
    await design.open(cwd, df.id);
    const base = `${d.size[0].toUpperCase()}${d.size.slice(1)} / ${d.title}`;
    const same = df.frames.filter((f) => f.kind === "drawn" && (f.name === base || f.name.startsWith(`${base} `)));
    for (const f of same) {
      const r = await rpc("canvas.frame.read", { cwd, file: df.id, frame: f.id }).catch(() => undefined);
      // Stamps aside, the same page is already there: nothing to do.
      if (r && r.html.replace(/\sdata-l="[^"]*"/g, "") === d.html.replace(/\sdata-l="[^"]*"/g, "")) {
        quiet(`${f.name} is already on the canvas as it is now.`);
        return df.id;
      }
    }
    const taken = new Set(df.frames.map((f) => f.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    const there = df.frames.find((f) => f.name === base);
    const at = there ? { x: Math.max(...df.frames.map((f) => f.x + f.w)) + 160, y: there.y } : {};
    const next = await rpc("canvas.frame.add", { cwd, file: df.id, frame: { name, ...FRAME_SIZES[d.size], ...at }, html: d.html });
    const added = next.frames.find((f) => !df.frames.some((g) => g.id === f.id));
    if (state.file?.id === df.id) await reloadFile();
    if (!added) return df.id;
    const step = design.record({
      label: "Open in Liner Design",
      undo: async () => void (await design.removeFrames([added.id], { record: false })),
      redo: () => design.unremoveFrames([added.id]),
    });
    if (there) toast(`Added as ${name}, beside ${base}`, { description: `${base} has changes of its own, so it was kept as it is.`, duration: 6000, action: { label: "Undo", onClick: () => step.undo() } });
    return df.id;
  },
  /** The design file's lean: its skills and where its rules come from (E's Lean page and skills), shown at once and saved. */
  setLean(lean: DesignFile["lean"]) {
    const s = state;
    if (!s.file) return Promise.resolve();
    setNow({ file: { ...s.file, lean } });
    if (s.mock || !s.cwd) return Promise.resolve();
    const id = s.file.id;
    return rpc("canvas.save", { cwd: s.cwd, file: id, patch: { lean } }).then((file) => void (state.file?.id === id && setNow({ file: { ...state.file, lean: file.lean } }))).catch((e: Error) => setNow({ error: e.message }));
  },
  /** A new page, shown at once. */
  addPage(name: string) {
    const s = state;
    if (!s.file) return;
    const id = `p${Date.now().toString(36)}`;
    const pages = [...s.file.pages, { id, name }];
    setNow({ file: { ...s.file, pages }, page: id, sel: [], node: undefined });
    if (!s.mock && s.cwd) void rpc("canvas.save", { cwd: s.cwd, file: s.file.id, patch: { pages } }).then((file) => setNow({ file })).catch((e: Error) => setNow({ error: e.message }));
  },
  rename(frame: string, name: string) {
    if (state.scrub !== undefined) return;
    patchFrames((f) => (f.id === frame ? { ...f, name } : f));
    saveFrames([{ id: frame, name }]);
  },
  /** A new drawn frame of a size, to the right of the others (or where asked). */
  async addFrame(size: DesignSize | { w: number; h: number }, name?: string, at?: { x: number; y: number }) {
    const s = state;
    const file = s.file;
    if (!file || s.scrub !== undefined) return;
    const wh = typeof size === "string" ? FRAME_SIZES[size] : size;
    const label = name ?? (typeof size === "string" ? `${size[0].toUpperCase()}${size.slice(1)} / New` : "Frame");
    const onPage = file.frames.filter((f) => f.page === (s.page ?? file.pages[0]?.id));
    const x = at?.x ?? (onPage.length ? Math.max(...onPage.map((f) => f.x + f.w)) + 80 : 0);
    const y = at?.y ?? (onPage.length ? Math.min(...onPage.map((f) => f.y)) : 0);
    const blank = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<style>\n*{box-sizing:border-box;margin:0}\nbody{width:${wh.w}px;min-height:${wh.h}px;font:400 15px/1.4 system-ui,sans-serif}\n</style>\n</head>\n<body>\n</body>\n</html>\n`;
    if (s.mock) {
      const id = `f${Date.now().toString(36)}`;
      const frame: DesignFrame = { id, page: s.page ?? "screens", name: label, kind: "drawn", path: `frames/${id}.html`, x, y, w: wh.w, h: wh.h };
      setNow({ file: { ...file, frames: [...file.frames, frame] }, html: { ...state.html, [id]: blank } });
      design.select([{ frame: id }]);
      return;
    }
    try {
      const next = await rpc("canvas.frame.add", { cwd: s.cwd!, file: file.id, frame: { name: label, w: wh.w, h: wh.h, x, y, page: s.page }, html: blank });
      const added = next.frames.find((f) => !file.frames.some((g) => g.id === f.id));
      const html = { ...state.html };
      if (added) html[added.id] = (await rpc("canvas.frame.read", { cwd: s.cwd!, file: file.id, frame: added.id }).catch(() => ({ html: blank }))).html;
      setNow({ file: next, html });
      if (added) design.select([{ frame: added.id }]);
    } catch (e) {
      setNow({ error: (e as Error).message });
    }
  },
  /**
    Takes frames off the canvas. The engine keeps each in a trash (its entry, build link and HTML),
    so the step can be undone: canvas.frame.unremove puts them back. `record: false` leaves the step
    to the caller (Ways' Keep makes one step of several changes). Returns the step's handle.
  */
  async removeFrames(ids: string[], opts?: { record?: boolean }): Promise<{ undo: () => void } | undefined> {
    const s = state;
    const file = s.file;
    if (!file || !ids.length || s.scrub !== undefined) return undefined;
    const gone = file.frames.filter((f) => ids.includes(f.id));
    setNow({ file: { ...file, frames: file.frames.filter((f) => !ids.includes(f.id)) }, sel: s.sel.filter((x) => !ids.includes(x.frame)), node: undefined });
    if (s.mock) {
      const html = { ...state.html };
      return opts?.record === false ? undefined : design.record({
        label: "Take frames away",
        undo: () => setNow({ file: { ...state.file!, frames: [...state.file!.frames, ...gone] }, html: { ...state.html, ...Object.fromEntries(gone.map((f) => [f.id, html[f.id] ?? ""])) } }),
        redo: () => setNow({ file: { ...state.file!, frames: state.file!.frames.filter((f) => !ids.includes(f.id)) } }),
      });
    }
    const cwd = s.cwd!;
    const fid = file.id;
    const removed: string[] = [];
    for (const frame of ids) await rpc("canvas.frame.remove", { cwd, file: fid, frame }).then((f) => (removed.push(frame), setNow({ file: f }))).catch((e: Error) => setNow({ error: e.message }));
    if (!removed.length || opts?.record === false) return undefined;
    return design.record({ label: "Take frames away", undo: () => design.unremoveFrames(removed), redo: async (): Promise<void> => void (await design.removeFrames(removed, { record: false })) });
  },
  /** Puts frames taken away back (the engine's trash): same ids, places, build links and HTML. */
  async unremoveFrames(ids: string[]) {
    const s = state;
    if (s.mock || !s.cwd || !s.file) return;
    const cwd = s.cwd;
    const fid = s.file.id;
    let last: DesignFile | undefined;
    for (const frame of [...ids].reverse()) last = await rpc("canvas.frame.unremove", { cwd, file: fid, frame });
    if (!last) return;
    const html = { ...state.html };
    const revs = { ...state.revs };
    for (const frame of ids) {
      const r = await rpc("canvas.frame.read", { cwd, file: fid, frame }).catch(() => undefined);
      if (r) (html[frame] = r.html), (revs[frame] = r.rev), mine.add(r.rev);
    }
    setNow({ file: last, html, revs, rev: { ...state.rev, ...Object.fromEntries(ids.map((f) => [f, (state.rev[f] ?? 0) + 1])) } });
  },
  async copyFrames(ids: string[]) {
    const s = state;
    const file = s.file;
    if (!file || s.scrub !== undefined) return;
    const made: string[] = [];
    for (const id of ids) {
      const f = file.frames.find((x) => x.id === id);
      if (!f) continue;
      const x = f.x + f.w + 80;
      if (s.mock) {
        const nid = `f${Math.random().toString(36).slice(2, 8)}`;
        const copy = { ...f, id: nid, name: `${f.name} copy`, x };
        setNow({ file: { ...state.file!, frames: [...state.file!.frames, copy] }, html: { ...state.html, [nid]: state.html[id] ?? "" } });
        made.push(nid);
        continue;
      }
      try {
        const next = await rpc("canvas.frame.copy", { cwd: s.cwd!, file: file.id, frame: id, x, y: f.y });
        const added = next.frames.find((g) => !state.file!.frames.some((h) => h.id === g.id));
        const html = { ...state.html };
        if (added) {
          html[added.id] = (await rpc("canvas.frame.read", { cwd: s.cwd!, file: file.id, frame: added.id }).catch(() => ({ html: state.html[id] ?? "" }))).html;
          made.push(added.id);
        }
        setNow({ file: next, html });
      } catch (e) {
        setNow({ error: (e as Error).message });
      }
    }
    if (made.length) design.select(made.map((frame) => ({ frame })));
  },
  /** Starts or ends editing a text in place. */
  edit(sel: Sel | undefined) {
    if (sel && state.scrub !== undefined) return;
    setNow({ editing: sel });
  },
  /**
    Versions.tsx: shows a kept turn, read-only (every change above refuses while it's shown), with
    its frames when the engine could read them; called without a turn, the file comes back as it is.
  */
  scrub(turn?: number, view?: { file: DesignFile; html: Record<string, string> }) {
    const bump = (html: Record<string, string>) => Object.fromEntries(Object.keys({ ...html, ...state.rev }).map((k) => [k, (state.rev[k] ?? 0) + 1]));
    if (turn !== undefined) {
      scrubbed ??= { file: state.file, html: state.html, stale: false };
      return setNow({ scrub: turn, sel: [], node: undefined, editing: undefined, ...(view ? { file: view.file, html: view.html, rev: bump(view.html) } : { file: scrubbed.file, html: scrubbed.html, rev: bump(scrubbed.html) }) });
    }
    const was = scrubbed;
    scrubbed = undefined;
    if (!was) return void (state.scrub !== undefined && setNow({ scrub: undefined }));
    setNow({ scrub: undefined, file: was.file, html: was.html, rev: bump(was.html), sel: [], node: undefined });
    if (was.stale) void reloadFile();
  },
  /** Live.tsx: the changes held for a live frame, as they are now (one put back). */
  keepPending(frame: string, ops: FrameOp[]) {
    const { [frame]: _gone, ...rest } = state.pending;
    setNow({ pending: ops.length ? { ...rest, [frame]: ops } : rest });
    tellSelection();
  },
  /** Drops changes held for a live frame (after they went to code, or were let go). */
  clearPending(frame: string) {
    const { [frame]: _gone, ...pending } = state.pending;
    setNow({ pending });
  },
  setPresence(frame: string, p: Presence | undefined) {
    const presence = { ...state.presence };
    if (p) presence[frame] = p;
    else delete presence[frame];
    setNow({ presence });
  },
  clearError() {
    setNow({ error: undefined });
  },
  /** Readers look again: for state kept beside this store (the checks' counts on the tab and in Layers). */
  touch() {
    set({});
  },
};

// The mock: docs/demo/foreshore as a design file, in memory (dev only, ?ld-mock).
const MOCK_SOURCES: Record<string, () => Promise<unknown>> = import.meta.env.DEV ? import.meta.glob(["../../../../docs/demo/foreshore/*.html", "../../../../docs/demo/foreshore/*.css"], { query: "?raw", import: "default" }) : {};

async function openMock(cwd: string, listOnly = false) {
  const read = async (name: string) => {
    const k = Object.keys(MOCK_SOURCES).find((p) => p.endsWith(`/${name}`));
    return k ? String(await MOCK_SOURCES[k]()) : "";
  };
  const files: DesignFileInfo[] = [
    { id: "tide-tables", title: "Tide tables", frames: 6, updated: Date.now() - 4 * 60_000, thumb: "desktop" },
    { id: "launch-page", title: "Launch page", frames: 2, updated: Date.now() - 2 * 86_400_000, thumb: "landing" },
    { id: "brand", title: "Brand", frames: 1, updated: Date.now() - 6 * 86_400_000, thumb: "brand" },
  ];
  if (listOnly) return setNow({ cwd, files });
  if (state.file && state.cwd === cwd) return;
  const css = await read("foreshore.css");
  const inline = (h: string) => h.replace(/<link rel="stylesheet" href="foreshore\.css">/, `<style>\n${css}\n</style>`);
  const list: [string, string, string, number, number, number, number, string?][] = [
    ["desktop", "Desktop / Today", "desktop.html", 0, 0, 1280, 800],
    ["phone-today", "Phone / Today", "phone-today.html", 1360, 0, 390, 844],
    ["phone-station", "Phone / Station", "phone-station.html", 1830, 0, 390, 844],
    ["brand", "Brand / Board", "brand.html", 0, 970, 1280, 800],
    ["phone-week", "Phone / Week", "phone-week.html", 1360, 970, 390, 844],
    ["dark-today", "Dark / Today", "phone-today.html", 1830, 970, 390, 844, "night"],
  ];
  const html: Record<string, string> = {};
  for (const [id, , src, , , , , night] of list) {
    const h = inline(await read(src));
    html[id] = night ? h.replace("<body>", '<body class="night">') : h;
  }
  const file: DesignFile = {
    v: 1, id: "tide-tables", title: "Tide tables",
    pages: [{ id: "screens", name: "Screens" }, { id: "parts", name: "Parts" }, { id: "scratch", name: "Scratch" }],
    frames: list.map(([id, name, , x, y, w, h]) => ({ id, page: "screens", name, kind: "drawn", path: `frames/${id}.html`, x, y, w, h })),
    lean: { path: "DESIGN.md", skills: ["awwwards", "brandkit"] },
  };
  undos.length = 0;
  redos.length = 0;
  setNow({ cwd, files, file, base: "", html, rev: {}, tree: {}, page: "screens", sel: [], node: undefined, loading: false, canUndo: false, canRedo: false, presence: { "phone-week": { agent: "claude", name: "Claude", label: "Claude", lead: true }, "dark-today": { agent: "codex", name: "Sidekick", label: "Sidekick", lead: false } } });
}

// In dev, the store is reachable from the console (and the check scripts) as window.__ld.
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __ld: unknown }).__ld = { getDesign, design, frames };
