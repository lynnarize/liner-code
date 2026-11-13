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
  the node it put into editing. The canvas's keys pressed in a frame come over a port of their own
  (keysFor below), never by the window's postMessage, which any script of the page can call too.
*/
import type { CheckFinding, FrameOp, FromFrame, NodeRead, NodeRef, Rect, TextPart, ToFrame, TreeNode } from "@contracts";

type Answer = Exclude<FromFrame, { t: "ready" | "rects" | "edited" | "key" }>["t"];
type Waiting = { want: Answer; done: (m: FromFrame) => void; fail: (e: Error) => void; timer: number };
type Port = {
  el: HTMLIFrameElement;
  ready: boolean;
  size?: { w: number; h: number };
  queue: ToFrame[];
  watched: string[];
  /** The app's end of the frame's key port (keysFor), and, until its agent said it back, the `go` it was sent. */
  keys?: { port: MessagePort; go?: string };
  /** A live frame: the first port offered while `keys` was held, taken when that one closes. */
  next?: MessagePort;
  /** A drawn frame: the key its document's agent was given (Frame.tsx); only a port sent with it is taken. */
  key?: string;
};

const ports = new Map<string, Port>();
/** By frame, then by question number. */
const waiting = new Map<string, Map<number, Waiting>>();
/** The one text being edited in place, as the app asked for it. */
let editingNow: { frame: string; id: string } | undefined;
const rectFns = new Map<string, Set<(rects: Record<string, Rect>) => void>>();
const editedFns = new Set<(frame: string, id: string, text: string, inner?: TextPart[]) => void>();
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
    if ((m as { t: string }).t === "keys") return keysFor(p, e.ports[0], (m as { key?: unknown }).key);
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
      for (const fn of editedFns) fn(id, m.id, String(m.text ?? ""), Array.isArray(m.inner) ? m.inner : undefined);
      return;
    }
    // Keys come over the frame's key port (keysFor below), never this way.
    if (m.t === "key") return;
    const mine = waiting.get(id);
    const w = typeof m.n === "number" ? mine?.get(m.n) : undefined;
    if (!w || w.want !== m.t) return;
    mine!.delete(m.n);
    clearTimeout(w.timer);
    w.done(m);
  });
}

/*
  A canvas key pressed while the frame had the keyboard (Play, a live page; frame-agent.js says
  which): pressed again here, on the frame's own element, so the face's keys (DesignFace) hear it as
  if the canvas had it. It comes over a MessageChannel the agent makes as it starts, before any
  script of the page runs, and sends up in its first message ({ t: "keys", key }, its far end
  transferred; frame-agent.js keyPort); a "key" said by postMessage, which any script of the page can
  send, is never heard. Any script of the page can send up a channel of its own the same way, so the
  one taken is told apart:
  - A drawn frame: only one sent with the key Frame.tsx put in this document's agent tag. The agent
    takes its tag out of the page before any script of the page runs, so no script of it knows the
    key; a page that loads again by itself (location.reload()) has the same srcdoc, and its agent
    the same key. A page that wipes itself (document.open()) or goes somewhere else (a data: URL)
    has nothing to send it with.
  - A live frame (the page through the engine's proxy, from another origin, so the app can't read
    its address or its document): one port at a time. The first offered is taken; another one
    offered while it is held waits as `next` (only the first such, and only while it stays open) and
    is taken only once the held one closes. A port closes (its "close" event, from the browser) only
    when the window at its far end goes away: the page loaded again (a dev server's full reload), or
    went to another page. A page that wipes itself (document.open()) keeps its window, and so the
    agent's port, which then stays the one held; the page's own wait for ever. The first port the
    new window of a page loaded again sends is its agent's, which the proxy puts before everything
    in it, so a reload takes the agent's port. Left open: a live page that goes to a page with no
    agent (a data: URL, a local page the proxy doesn't serve, or one a service worker answers
    itself) can have its own port taken once the old window went away, and send the canvas's keys
    (Delete, ⌘Z, V, H, Esc: all undoable) while the person has the keyboard in it.
    A browser with no close event on ports (`closes` below: Electron's Chromium has it; WebKit, as
    in the Mac shell, and some Chromium builds don't) can't say the held port's window went away,
    and waiting for an answer instead can't tell a window gone from one a page keeps busy, so there
    a live frame keeps the first port it sent and takes no other: after the page loads again by
    itself, or the frame is pointed elsewhere, its keys go unheard until the frame is drawn anew.
  A port taken is first sent { t: "go", n }, and keys on it are heard only once the agent sent the
  same n back, so nothing sent on a port before it was taken (by a window gone since) is a key.
  Acted on only when the frame's iframe has the app's focus (the person's keyboard really is in it),
  and only where the frame needs to tell its keys at all (keysWanted: Play, a live frame). An Esc the
  canvas took gives the keyboard back to the app, and so does a key that took the frame out of where
  it tells its keys (H in Play): the next key is the app's then.
*/
const KEYS = new Set(["Escape", "Delete", "Backspace", "z", "Z", "y", "Y", "v", "V", "h", "H"]);
let keysWanted: (frame: string) => boolean = () => false;
/** DesignFace: which frames' keys the canvas hears now. */
export const hearFrameKeys = (fn: (frame: string) => boolean) => void (keysWanted = fn);

/** Whether this browser fires "close" on a port whose far end's window went away. */
const closes = typeof MessagePort !== "undefined" && "onclose" in MessagePort.prototype;

const goOf = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};
const holder = (port: MessagePort) => {
  for (const [id, q] of ports) if (q.keys?.port === port) return [id, q] as const;
  return undefined;
};

function keysFor(p: Port, port: MessagePort | undefined, key: unknown) {
  if (!port) return;
  try {
    if (p.key !== undefined) {
      if (key !== p.key) return port.close();
      return take(p, port);
    }
    if (!p.keys) return take(p, port);
    if (p.next || !closes) return port.close();
    p.next = port;
    // Started with no listener: what comes on it before it is taken is dropped.
    port.addEventListener("close", () => {
      for (const q of ports.values()) if (q.next === port) q.next = undefined;
    });
    port.start();
  } catch {
    // a frame going away: its keys go with it
  }
}

function take(p: Port, port: MessagePort) {
  if (p.keys?.port !== port) p.keys?.port.close();
  if (p.next === port) p.next = undefined;
  const go = goOf();
  const k: { port: MessagePort; go?: string } = { port, go };
  p.keys = k;
  port.onmessage = (e) => {
    const at = holder(port);
    if (!at || at[1].keys !== k) return;
    const m = e.data as { t?: unknown; n?: unknown } | null;
    if (k.go !== undefined) {
      if (m && typeof m === "object" && m.t === "ok" && m.n === k.go) k.go = undefined;
      return;
    }
    pressed(at[0], at[1], m);
  };
  // Its far end's window went away (the page loaded again, or went elsewhere): the port offered next, if any, is the one now.
  port.addEventListener("close", () => {
    const at = holder(port);
    if (!at || at[1].keys !== k) return;
    const q = at[1];
    q.keys = undefined;
    const next = q.next;
    if (next) take(q, next);
  });
  port.postMessage({ t: "go", n: go });
}

function pressed(id: string, p: Port, m: unknown) {
  const k = m as { t?: unknown; key?: unknown; code?: unknown; meta?: unknown; ctrl?: unknown; shift?: unknown; alt?: unknown } | null;
  if (!k || typeof k !== "object" || k.t !== "key" || typeof k.key !== "string" || !KEYS.has(k.key)) return;
  if ((editingNow && editingNow.frame === id) || document.activeElement !== p.el || !keysWanted(id)) return;
  const ev = new KeyboardEvent("keydown", { key: k.key, code: typeof k.code === "string" ? k.code : "", metaKey: k.meta === true, ctrlKey: k.ctrl === true, shiftKey: k.shift === true, altKey: k.alt === true, bubbles: true, cancelable: true });
  p.el.dispatchEvent(ev);
  if (ev.defaultPrevented && (k.key === "Escape" || !keysWanted(id))) p.el.blur();
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
  const same = was?.el === el;
  if (was && !same) (was.keys?.port.close(), was.next?.close());
  ports.set(frame, { el, ready: false, queue: same ? was.queue : [], watched: was?.watched ?? [], keys: same ? was.keys : undefined, next: same ? was.next : undefined, key: same ? was.key : undefined });
}
/**
  A frame's document is loading again: questions wait for it to say it's ready. `key`: a drawn
  frame's, the key its new document's agent was given (Frame.tsx); a live frame has none.
*/
export function reloading(frame: string, key?: string) {
  const p = ports.get(frame);
  if (!p) return;
  p.ready = false;
  p.key = key;
}
export function detach(frame: string, el: HTMLIFrameElement) {
  const p = ports.get(frame);
  if (p?.el !== el) return;
  p.keys?.port.close();
  p.next?.close();
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

/** Hears a text edited in place end (Enter, Esc, or the caret leaving it), with the text it has now, and its runs when it has marks inside. Returns the stop. */
export function onEdited(fn: (frame: string, id: string, text: string, inner?: TextPart[]) => void) {
  listen();
  editedFns.add(fn);
  return () => void editedFns.delete(fn);
}
