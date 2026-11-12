/*
  The host side of the frame bridge. Every frame on the canvas runs the frame agent
  (contracts/src/frame-agent.js) inside a sandboxed iframe with no origin, and talks to the app only
  by postMessage. Frame.tsx attaches each iframe here by its frame id; everyone else asks a frame by
  that id: what is under a point, its outline, one node read whole, a list of changes to apply.
  Questions carry a number, and an answer counts only when it comes from the window of the frame
  that was asked, carries a number that frame is waiting on, and is the kind of answer that question
  takes; anything else is dropped without a word, so one frame's page can't answer for another. A
  frame that is reloading answers once it is ready again, and one that never answers fails after a
  while rather than hanging. "edited" is heard only from the frame the app put into editing, for
  the node it put into editing.
*/
import type { CheckFinding, FrameOp, FromFrame, NodeRead, NodeRef, Rect, ToFrame, TreeNode } from "@contracts";

type Answer = Exclude<FromFrame, { t: "ready" | "rects" | "edited" }>["t"];
type Waiting = { want: Answer; done: (m: FromFrame) => void; fail: (e: Error) => void; timer: number };
type Port = { el: HTMLIFrameElement; ready: boolean; size?: { w: number; h: number }; queue: ToFrame[]; watched: string[] };

const ports = new Map<string, Port>();
/** By frame, then by question number. */
const waiting = new Map<string, Map<number, Waiting>>();
/** The one text being edited in place, as the app asked for it. */
let editingNow: { frame: string; id: string } | undefined;
const rectFns = new Map<string, Set<(rects: Record<string, Rect>) => void>>();
const editedFns = new Set<(frame: string, id: string, text: string) => void>();
const readyFns = new Set<(frame: string, size: { w: number; h: number }) => void>();
let n = 0;
let listening = false;

const portOf = (win: MessageEventSource | null) => {
  for (const [id, p] of ports) if (p.el.contentWindow === win) return [id, p] as const;
  return undefined;
};

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (e) => {
    const at = portOf(e.source);
    if (!at) return;
    const [id, p] = at;
    const m = e.data as FromFrame;
    if (!m || typeof m !== "object" || typeof (m as { t?: unknown }).t !== "string") return;
    if (m.t === "ready") {
      p.ready = true;
      p.size = { w: m.w, h: m.h };
      const queue = p.queue.splice(0);
      if (p.watched.length) post(p, { t: "watch", ids: p.watched });
      for (const q of queue) post(p, q);
      for (const fn of readyFns) fn(id, p.size);
      return;
    }
    if (m.t === "rects") {
      for (const fn of rectFns.get(id) ?? []) fn(m.rects);
      return;
    }
    // A text edited in place has ended, with its text: only the frame and node the app put into editing.
    if (m.t === "edited") {
      if (!editingNow || editingNow.frame !== id || editingNow.id !== m.id) return;
      editingNow = undefined;
      for (const fn of editedFns) fn(id, m.id, String(m.text ?? ""));
      return;
    }
    const mine = waiting.get(id);
    const w = typeof m.n === "number" ? mine?.get(m.n) : undefined;
    if (!w || w.want !== m.t) return;
    mine!.delete(m.n);
    clearTimeout(w.timer);
    w.done(m);
  });
}

function post(p: Port, m: ToFrame) {
  try {
    p.el.contentWindow?.postMessage(m, "*");
  } catch {
    // a frame going away mid-question: its answer times out
  }
}

function send(p: Port, m: ToFrame) {
  if (p.ready) post(p, m);
  else p.queue.push(m);
}

function ask<T extends FromFrame>(frame: string, want: Answer, make: (n: number) => ToFrame, ms = 8000): Promise<T> {
  listen();
  const p = ports.get(frame);
  if (!p) return Promise.reject(new Error(`The frame ${frame} isn't on the canvas.`));
  const id = ++n;
  let mine = waiting.get(frame);
  if (!mine) waiting.set(frame, (mine = new Map()));
  const table = mine;
  return new Promise<T>((done, fail) => {
    const timer = window.setTimeout(() => {
      table.delete(id);
      fail(new Error("The frame didn't answer."));
    }, ms);
    table.set(id, { want, done: done as (m: FromFrame) => void, fail, timer });
    send(p, make(id));
  });
}

/** Asks a frame by its id. Each answer is the frame agent's, as contracts/src/design.ts says. */
export const frames = {
  /** What is under a point of the frame, in its own pixels; `deep` goes past the outermost stack the point is in. */
  hit: (frame: string, x: number, y: number, deep?: boolean) => ask<Extract<FromFrame, { t: "hit" }>>(frame, "hit", (n) => ({ t: "hit", n, x, y, deep })).then((m) => ({ node: m.node, path: m.path }) as { node: NodeRef | null; path: NodeRef[] }),
  /** The frame's outline, for Layers. */
  tree: (frame: string) => ask<Extract<FromFrame, { t: "tree" }>>(frame, "tree", (n) => ({ t: "tree", n })).then((m): TreeNode => m.root),
  /** One node read whole. */
  read: (frame: string, id: string) =>
    ask<Extract<FromFrame, { t: "node" }>>(frame, "node", (n) => ({ t: "read", n, id })).then((m): NodeRead => {
      // A node that isn't in the frame any more (an edit gave it a new id, or took it away) answers null: that's a refusal, never a node.
      if (!m.node || typeof m.node !== "object" || !m.node.computed) throw new Error("That layer isn't in the frame any more.");
      return m.node;
    }),
  /** Applies changes in the frame; answers with its whole document as it is now, and the ids it holds. */
  apply: (frame: string, ops: FrameOp[]) => ask<Extract<FromFrame, { t: "applied" }>>(frame, "applied", (n) => ({ t: "apply", n, ops })).then((m) => ({ html: m.html, ids: m.ids })),
  /** The frame's checks (G fills them in the agent; empty until then). */
  check: (frame: string) => ask<Extract<FromFrame, { t: "checks" }>>(frame, "checks", (n) => ({ t: "check", n }), 15000).then((m): CheckFinding[] => m.findings),
  /**
    Keeps hearing these nodes' rects, in the frame's own pixels, once a frame of animation at most
    while they move (layout, a resize, an edit). Returns the stop. Watching one frame replaces what
    it watched before, so only the selection's nodes are followed.
  */
  watch: (frame: string, ids: string[], fn: (rects: Record<string, Rect>) => void) => {
    listen();
    let set = rectFns.get(frame);
    if (!set) rectFns.set(frame, (set = new Set()));
    set.add(fn);
    const p = ports.get(frame);
    if (p) {
      p.watched = ids;
      send(p, { t: "watch", ids });
    }
    return () => {
      set.delete(fn);
      const q = ports.get(frame);
      if (q && !set.size) {
        q.watched = [];
        if (q.ready) post(q, { t: "watch", ids: [] });
      }
    };
  },
};

// Set by the store: while a kept turn is shown (Versions.tsx), no text is edited in place.
let editLocked = () => false;
export const lockEditing = (fn: () => boolean) => void (editLocked = fn);

/** Text editing in place: on puts a caret in the node; off ends it (the text comes back through apply). */
export const editText = (frame: string, id: string, on: boolean) => {
  const p = ports.get(frame);
  if (!p || (on && editLocked())) return;
  // The frame takes the keyboard first, or the caret the agent puts in the text gets no keys.
  if (on) p.el.focus({ preventScroll: true });
  editingNow = on ? { frame, id } : editingNow;
  send(p, { t: "edit", id, on });
};

/** Frame.tsx: this iframe is the frame now (on mount and on each reload of its document). */
export function attach(frame: string, el: HTMLIFrameElement) {
  listen();
  const was = ports.get(frame);
  ports.set(frame, { el, ready: false, queue: was?.el === el ? was.queue : [], watched: was?.watched ?? [] });
}
/** A frame's document is loading again: questions wait for it to say it's ready. */
export function reloading(frame: string) {
  const p = ports.get(frame);
  if (p) p.ready = false;
}
export function detach(frame: string, el: HTMLIFrameElement) {
  if (ports.get(frame)?.el !== el) return;
  ports.delete(frame);
  // Questions to a frame that went away fail now rather than wait out their time.
  for (const w of waiting.get(frame)?.values() ?? []) (clearTimeout(w.timer), w.fail(new Error("The frame went away.")));
  waiting.delete(frame);
  if (editingNow?.frame === frame) editingNow = undefined;
}
export const isReady = (frame: string) => Boolean(ports.get(frame)?.ready);
/** The size a frame's document said it is when it was last ready. */
export const sizeOf = (frame: string) => ports.get(frame)?.size;

/** Hears every frame that becomes ready (its document loaded or reloaded). Returns the stop. */
export function onReady(fn: (frame: string, size: { w: number; h: number }) => void) {
  listen();
  readyFns.add(fn);
  return () => void readyFns.delete(fn);
}

/** Hears a text edited in place end (Enter, Esc, or the caret leaving it), with the text it has now. Returns the stop. */
export function onEdited(fn: (frame: string, id: string, text: string) => void) {
  listen();
  editedFns.add(fn);
  return () => void editedFns.delete(fn);
}
