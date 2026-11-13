/*
  The checks: what is wrong with the design file's screens, found on this Mac with no agent and no
  tokens. The frame agent does the looking (contracts/src/frame-agent.js, `check`): too little
  contrast, things too small to touch, things a screen reader can't say, and what runs past the
  page's edge. Here each frame is laid out again in a hidden frame at the widths it is for (phones
  down to 320, which is the smallest phone in use, and 768; anything wider at its own width and
  1440: a desktop frame is drawn for the narrowest window it is for), the answers are put into
  one plain sentence each, with the lean's names for colours, and a contrast finding gets its fix:
  the nearest lean colour that passes. Checks run when the file opens and again, a moment after
  a frame changes. A frame named "Brand", or whose page says it is not a screen
  (<html data-screen="no">), is left out.

  Fixing what the frame can't fix by itself is an ask: it goes to the session's agent, one finding
  or all of them in one message.
*/
import { useSyncExternalStore } from "react";
import type { CheckFinding, DesignFrame, FrameOp, LeanTokens, Rect, UserShown } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { getState, rpc } from "../engine";
import { agentOf } from "../model";
import { pairOf } from "../Crew";
import { attach, frames, onReady, reloading } from "./bridge";
import { srcDocOf } from "./Frame";
import { leanNow } from "./lean";
import { blankHtml, design, getDesign, isGone, selectionOf, subscribeDesign, type DesignState } from "./store";

export type Kind = CheckFinding["kind"];
export const KIND_NAME: Record<Kind, string> = { fit: "Fit", contrast: "Contrast", touch: "Touch", name: "Name" };

/** A finding as the tab shows it: its frame, its sentence, its own fix and what the button says, and for fit the width and the box to show. */
export type Finding = CheckFinding & { frame: string; key: string; fixLabel?: string; at?: number; box?: Rect };
export type FrameChecks = { frame: string; findings: Finding[]; passed: string[]; ran: number; ms: number; skipped?: string; failed?: string };
type State = { byFrame: Record<string, FrameChecks>; running: number; file?: string; ms?: number };

let state: State = { byFrame: {}, running: 0 };
const fns = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  fns.forEach((f) => f());
  // The inspector's tab counts and Layers read the Design store: they look again too.
  design.touch();
};
export const getChecks = () => state;
const subscribe = (f: () => void) => (fns.add(f), () => void fns.delete(f));
export function useChecks<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state));
}

/** Every finding to fix, frames in canvas order (top to bottom, then left to right), numbered from 1. */
export function toFix(s: State = state, ds: DesignState = getDesign()): Finding[] {
  const order = [...(ds.file?.frames ?? [])].sort((a, b) => a.y - b.y || a.x - b.x);
  return order.flatMap((f) => s.byFrame[f.id]?.findings ?? []);
}
export const countFor = (frame: string) => state.byFrame[frame]?.findings.length ?? 0;

/** The widths a frame is laid out at, the frame's own among them. */
export function widthsOf(w: number) {
  const list = w < 600 ? [320, w, 768] : [w, 1440];
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
  Why a frame isn't checked, or undefined when it's a screen. The frame's own mark (screen: false)
  says it; only a file whose frames carry no mark at all falls back to guessing, by a name with
  "Brand" in it or <html data-screen="no">.
*/
export function notAScreen(f: DesignFrame, html?: string) {
  if (f.screen === false) return "not checked, it is not a screen";
  if ((getDesign().file?.frames ?? []).some((g) => g.screen !== undefined)) return undefined;
  if (/\bbrand\b/i.test(f.name)) return "not checked, it is not a screen";
  if (html && /<html[^>]*\sdata-screen=["']?no\b/i.test(html)) return "not checked, it is not a screen";
  return undefined;
}

// ---------- Colours, said by the lean's names

const hexRe = /#[0-9A-F]{6}\b/gi;
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const norm = (v: string) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return `#${h.toUpperCase()}`;
};
const dist = (a: string, b: string) => {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const lum = (hex: string) => {
  const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const ratioOf = (a: string, b: string) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const leanHex = (t?: LeanTokens) => (t?.colours ?? []).flatMap((c) => (norm(c.value) ? [{ name: c.name, hex: norm(c.value)! }] : []));
/** A colour by its lean name when it is one (within a hair), else its hex. */
const named = (hex: string, t?: LeanTokens) => {
  const c = leanHex(t).find((x) => dist(x.hex, hex) < 6);
  return c ? c.name.replace(/\s*\(.*\)$/, "") : hex.toUpperCase();
};
/** A custom property the frame declares with this value: var(--ink), so the build maps it to the project's token. */
const varFor = (html: string, hex: string) => {
  const re = /--([\w-]+)\s*:\s*(#[0-9a-f]{3,6})\b/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) if (norm(m[2]) === hex) return `var(--${m[1]})`;
  return hex;
};

/** Contrast: the sentence in the lean's words, and its own fix, the nearest lean colour that passes on what's behind it. */
function withContrast(f: Finding, html: string, t?: LeanTokens): Finding {
  const [fg, bg] = (f.text.match(hexRe) ?? []).map((h) => h.toUpperCase());
  if (!fg || !bg) return { ...f, fix: undefined, fixLabel: undefined };
  const need = /needs 3\b/.test(f.text) ? 3 : 4.5;
  const text = f.text.replace(fg, named(fg, t)).replace(` on ${bg}`, ` on ${named(bg, t)}`);
  // The lean's own colours, not the variants it names for another light ("Deep (night)").
  const pass = leanHex(t).filter((c) => !/\(/.test(c.name) && ratioOf(c.hex, bg) >= need).sort((a, b) => dist(a.hex, fg) - dist(b.hex, fg))[0];
  if (!pass || !f.id) return { ...f, text, fix: undefined, fixLabel: undefined };
  const fix: FrameOp[] = [{ id: f.id, style: { color: varFor(html, pass.hex) } }];
  return { ...f, text, fix, fixLabel: `Use ${pass.name.replace(/\s*\(.*\)$/, "")}` };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Fit: one sentence for the frame from the runs at each width. */
function fitFinding(frame: DesignFrame, runs: { w: number; found: CheckFinding[] }[]): Finding | undefined {
  const bad = runs.filter((r) => r.found.length);
  if (!bad.length) return undefined;
  const fine = runs.filter((r) => !r.found.length).map((r) => String(r.w));
  const first = bad[0];
  const names = [...first.found].sort((a, b) => (a.rect?.y ?? 0) - (b.rect?.y ?? 0)).map((x) => x.text);
  const said = names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : list(names);
  // The one to show: the topmost thing that runs off at the narrowest width, as you'd meet it.
  const worst = [...first.found].sort((a, b) => (a.rect?.y ?? 0) - (b.rect?.y ?? 0))[0];
  return {
    kind: "fit",
    id: worst.id,
    rect: worst.rect,
    width: first.w,
    frame: frame.id,
    key: `${frame.id}:fit`,
    text: `At ${list(bad.map((r) => String(r.w)))} wide ${said} ${names.length === 1 ? "runs" : "run"} off the edge.${fine.length ? ` Fine at ${list(fine)}.` : ""}`,
    at: first.w,
    box: worst.rect,
  };
}

// ---------- Running them in hidden frames

let host: HTMLDivElement | null = null;
function hostEl() {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  host.className = "ld-chk-host";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  return host;
}

/**
  One hidden frame per width, kept and loaded again for each run (not made anew), each used by one
  run at a time. The frame of the run that measures everything is made as tall as its page (up to
  TALL), so every text is in view for the contrast check, not only the frame's first screen.
*/
const TALL = 12000;
type Slot = { el: HTMLIFrameElement; key: string; busy: Promise<unknown> };
const slots = new Map<number, Slot>();
function slotFor(w: number): Slot {
  let sl = slots.get(w);
  if (sl && sl.el.isConnected) return sl;
  const el = document.createElement("iframe");
  el.setAttribute("sandbox", "allow-scripts allow-forms");
  el.tabIndex = -1;
  el.width = String(w);
  el.style.width = `${w}px`;
  const key = `check:${w}`;
  hostEl().appendChild(el);
  attach(key, el);
  sl = { el, key, busy: Promise.resolve() };
  slots.set(w, sl);
  return sl;
}
/** The next time this hidden frame says it's ready (its page loaded). */
const readyOnce = (key: string) =>
  new Promise<{ w: number; h: number }>((done) => {
    const stop = onReady((k, size) => k === key && (stop(), done(size)));
    setTimeout(() => (stop(), done({ w: 0, h: 0 })), 8000);
  });

/** The frame's page laid out at one width, in that width's hidden frame. `whole`: as tall as the page, for every check. Answers what it found, and whether the whole page was in view. */
function runAt(frame: DesignFrame, html: string, base: string | undefined, w: number, whole: boolean): Promise<{ found: CheckFinding[]; all: boolean }> {
  const sl = slotFor(w);
  const run = sl.busy.then(async () => {
    sl.el.height = String(frame.h);
    sl.el.style.height = `${frame.h}px`;
    reloading(sl.key);
    const ready = readyOnce(sl.key);
    sl.el.srcdoc = srcDocOf(html, base);
    const size = await ready;
    let all = true;
    if (whole && size.h > frame.h) {
      const h = Math.min(size.h, TALL);
      all = size.h <= TALL;
      sl.el.height = String(h);
      sl.el.style.height = `${h}px`;
    }
    return { found: await frames.check(sl.key), all };
  });
  sl.busy = run.catch(() => undefined);
  return run;
}

// ---------- What a frame says, taken only as far as it can be trusted

const KINDS = new Set<Kind>(["fit", "contrast", "touch", "name"]);
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
/**
  A frame's page runs its own scripts, so what it answers is only data: a known kind, an id that is
  one of the frame's own (from its file), a box, words of a sane length, a ratio, a width. Nothing
  else it sends is kept: every fix, and what its button says, is made here (withContrast).
*/
function trusted(x: unknown, ids: Set<string>, anyId = false): CheckFinding | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  if (typeof o.kind !== "string" || !KINDS.has(o.kind as Kind)) return undefined;
  if (typeof o.text !== "string" || !o.text.trim() || o.text.length > 400) return undefined;
  const out: CheckFinding = { kind: o.kind as Kind, text: o.text.replace(/[\u0000-\u001f]/g, " ") };
  if (typeof o.id === "string" && o.id.length <= 32 && /^[A-Za-z0-9_-]+$/.test(o.id) && (anyId || ids.has(o.id))) out.id = o.id;
  const rc = o.rect as Record<string, unknown> | undefined;
  if (rc && typeof rc === "object") {
    const x0 = num(rc.x, -1e5, 1e5), y0 = num(rc.y, -1e5, 1e5), w0 = num(rc.w, 0, 1e5), h0 = num(rc.h, 0, 1e5);
    if (x0 !== undefined && y0 !== undefined && w0 !== undefined && h0 !== undefined) out.rect = { x: x0, y: y0, w: w0, h: h0 };
  }
  const ratio = num(o.ratio, 1, 21);
  if (ratio !== undefined) out.ratio = ratio;
  const width = num(o.width, 1, 10000);
  if (width !== undefined) out.width = Math.round(width);
  return out;
}
/** The ids a frame's file holds (the engine stamps every element): a finding may only point at one of them. */
const idsIn = (html: string) => new Set([...html.matchAll(/\sdata-l=["']([A-Za-z0-9_-]{1,32})["']/g)].map((m) => m[1]));

/** What the checks have cost, for the dev console and the check scripts (window.__ldChecks): runs of a frame and their time. */
const stats = { runs: 0, ms: 0, last: 0 };
async function checkFrame(f: DesignFrame): Promise<FrameChecks> {
  stats.runs++;
  const s = getDesign();
  const started = performance.now();
  // The page as the file holds it now (the store's copy can trail an edit the engine made).
  const html = s.mock || !s.cwd || !s.file || f.kind === "live" ? s.html[f.id] : ((await rpc("canvas.frame.read", { cwd: s.cwd, file: s.file.id, frame: f.id }).catch(() => undefined))?.html ?? s.html[f.id]);
  const skipped = notAScreen(f, html) ?? (f.kind === "drawn" && blankHtml(html) ? "nothing in it yet" : undefined);
  if (skipped) return { frame: f.id, findings: [], passed: [], ran: Date.now(), ms: 0, skipped };
  const lean = leanNow()?.tokens ?? (await leanOf(s.cwd, s.file?.id));
  try {
    let base: CheckFinding[];
    // Whether the whole page was in view for the contrast check; a live frame is looked at as it shows.
    let whole = true;
    const runs: { w: number; found: CheckFinding[] }[] = [];
    const ids = idsIn(html ?? "");
    // A live frame's ids are checked against its own outline below, so here any well-formed id passes.
    const keep = (list: unknown) => (Array.isArray(list) ? list.slice(0, 500) : []).flatMap((x) => trusted(x, ids, f.kind === "live" || html === undefined) ?? []);
    if (f.kind === "live" || html === undefined) {
      // A live frame is the running page: checked where it is, at its own width.
      // Its ids are the live page's own (its outline, from the frame agent), not a file's: a finding may point only at one of those.
      const tree = await frames.tree(f.id).catch(() => undefined);
      const live = new Set<string>();
      const walk = (n?: { id: string; children: unknown[] }) => {
        if (!n || live.size > 20000) return;
        live.add(n.id);
        for (const c of n.children as { id: string; children: unknown[] }[]) walk(c);
      };
      walk(tree);
      base = keep(await frames.check(f.id));
      for (const x of base) if (x.id && !live.has(x.id)) delete x.id;
      whole = false;
      runs.push({ w: f.w, found: base.filter((x) => x.kind === "fit") });
    } else {
      const ws = widthsOf(f.w);
      const all = await Promise.all(ws.map((w) => runAt(f, html, s.base, w, w === f.w)));
      const own = all[ws.indexOf(f.w)];
      base = keep(own?.found);
      whole = own?.all ?? false;
      ws.forEach((w, i) => runs.push({ w, found: keep(all[i].found).filter((x) => x.kind === "fit") }));
    }
    const findings: Finding[] = [];
    const rule = (k: Kind) => base.filter((x) => x.kind === k);
    for (const k of ["contrast", "touch", "name"] as Kind[]) {
      for (const [i, x] of rule(k).entries()) {
        const one: Finding = { ...x, frame: f.id, key: `${f.id}:${k}:${x.id ?? i}`, box: x.rect };
        findings.push(k === "contrast" ? withContrast(one, html ?? "", lean) : one);
      }
    }
    const fit = fitFinding(f, runs);
    if (fit) findings.unshift(fit);
    // What passed: each check, and fit at each width, that found nothing.
    const passed = [
      // Contrast passes only when the whole page was looked at.
      ...(["contrast", "touch", "name"] as Kind[]).filter((k) => !rule(k).length && !(k === "touch" && f.w >= 1000) && !(k === "contrast" && !whole)).map((k) => KIND_NAME[k]),
      ...runs.filter((r) => !r.found.length).map((r) => `Fit at ${r.w}`),
    ];
    const ms = performance.now() - started;
    stats.ms += ms;
    stats.last = ms;
    return { frame: f.id, findings, passed, ran: Date.now(), ms };
  } catch (e) {
    return { frame: f.id, findings: [], passed: [], ran: Date.now(), ms: performance.now() - started, failed: (e as Error).message };
  }
}

// The lean, read here when the inspector hasn't read it yet (its names say the colours).
const leans = new Map<string, Promise<LeanTokens | undefined>>();
function leanOf(cwd?: string, file?: string) {
  if (!cwd || getDesign().mock) return Promise.resolve(undefined);
  const k = `${cwd}:${file ?? ""}`;
  if (!leans.has(k)) leans.set(k, rpc("lean.read", { cwd, file }).then((l) => (lastLean = l.off === "none" ? undefined : l.tokens), () => undefined));
  return leans.get(k)!;
}

let lastLean: LeanTokens | undefined;
/** The lean as the checks last read it, when the inspector hasn't. */
export const leanSeen = () => leanNow()?.tokens ?? lastLean;

let gen = 0;
/** Checks these frames (every frame of the file when none are named), three at a time. */
export async function runChecks(ids?: string[]) {
  const s = getDesign();
  if (!s.file) return;
  const my = ++gen;
  const file = s.file.id;
  // A frame whose file is gone has nothing to check.
  const want = s.file.frames.filter((f) => (!ids || ids.includes(f.id)) && !isGone(f));
  const started = performance.now();
  set({ running: state.running + 1, ...(state.file !== file ? { byFrame: {}, file } : {}) });
  const queue = [...want];
  const next = async (): Promise<void> => {
    const f = queue.shift();
    if (!f) return;
    const r = await checkFrame(f);
    const now = getDesign();
    if (now.file?.id === file && state.file === file && now.scrub === undefined && now.file.frames.some((g) => g.id === f.id)) set({ byFrame: { ...state.byFrame, [f.id]: r } });
    return next();
  };
  await Promise.all([next(), next(), next()]);
  // A frame gone from the file, or whose own file is gone, takes its findings with it.
  const there = new Set((getDesign().file?.frames ?? []).filter((f) => !isGone(f)).map((f) => f.id));
  const byFrame = Object.fromEntries(Object.entries(state.byFrame).filter(([k]) => there.has(k)));
  set({ running: Math.max(0, state.running - 1), byFrame, ...(my === gen ? { ms: performance.now() - started } : {}) });
}

/*
  Checks run when a file opens, and a moment after a frame changes (its page, its revision, its
  size): one run per changed frame, never while the pointer is held (a slider, a resize, a drag:
  they run once it's let go), and never two runs of one frame at once (a change during a run
  runs it once more after).
*/
let seenFile: string | undefined;
let seenSig: Record<string, string> = {};
const dirty = new Set<string>();
const inFlight = new Set<string>();
let timer = 0;
let opening = 0;
let scrubbing = false;
let started = false;
let held = false;
// A frame whose file went and came back is checked again, even with the very same bytes.
const sigOf = (s: DesignState, f: DesignFrame) => `${isGone(f) ? "gone|" : ""}${f.w}x${f.h}|${s.revs?.[f.id] ?? ""}|${s.html[f.id]?.length ?? -1}:${hashOf(s.html[f.id])}`;
const hashOf = (t?: string) => {
  if (!t) return 0;
  let h = 0;
  for (let i = 0; i < t.length; i += Math.max(1, t.length >> 12)) h = (h * 31 + t.charCodeAt(i)) | 0;
  return h;
};
function flush() {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (held) return;
    const ids = [...dirty].filter((id) => !inFlight.has(id));
    if (!ids.length) return;
    for (const id of ids) dirty.delete(id), inFlight.add(id);
    void runChecks(ids).finally(() => {
      for (const id of ids) inFlight.delete(id);
      if (dirty.size) flush();
    });
  }, 700);
}
export function watchChecks() {
  if (started) return;
  started = true;
  const look = () => {
    const s = getDesign();
    const file = s.file ? `${s.cwd}:${s.file.id}` : undefined;
    if (file !== seenFile) {
      seenFile = file;
      seenSig = Object.fromEntries((s.file?.frames ?? []).map((f) => [f.id, sigOf(s, f)]));
      clearTimeout(timer);
      dirty.clear();
      state = { byFrame: {}, running: 0, file: s.file?.id };
      // The file's first run, a moment after it opens: what arrives meanwhile (its revisions) is part of that run, not a second one.
      clearTimeout(opening);
      if (s.file)
        opening = window.setTimeout(() => {
          opening = 0;
          const now = getDesign();
          seenSig = Object.fromEntries((now.file?.frames ?? []).map((f) => [f.id, sigOf(now, f)]));
          dirty.clear();
          void runChecks();
        }, 600);
      return;
    }
    if (!s.file || opening) return;
    // A kept turn shown (Versions): its findings aren't the file's; they go, and come back once it's let go.
    if (s.scrub !== undefined) {
      if (!scrubbing) {
        scrubbing = true;
        clearTimeout(timer);
        dirty.clear();
        if (Object.keys(state.byFrame).length) set({ byFrame: {} });
      }
      return;
    }
    if (scrubbing) {
      scrubbing = false;
      seenSig = Object.fromEntries(s.file.frames.map((f) => [f.id, sigOf(s, f)]));
      void runChecks();
      return;
    }
    // A frame gone from the file takes its findings with it at once (a take dropped, a frame deleted,
    // Keep), and so does one whose own file is gone; they come back when its file does and it's checked again.
    const there = new Set(s.file.frames.filter((f) => !isGone(f)).map((f) => f.id));
    const gone = Object.keys(state.byFrame).filter((k) => !there.has(k));
    if (gone.length) set({ byFrame: Object.fromEntries(Object.entries(state.byFrame).filter(([k]) => there.has(k))) });
    let changed = false;
    for (const f of s.file.frames) {
      const sig = sigOf(s, f);
      if (sig !== seenSig[f.id]) (dirty.add(f.id), (changed = true));
      seenSig[f.id] = sig;
    }
    if (changed) flush();
  };
  subscribeDesign(look);
  // The pointer held: a control is being dragged. Checks wait for it to be let go.
  window.addEventListener("pointerdown", () => (held = true), true);
  const let_go = () => {
    held = false;
    if (dirty.size) flush();
  };
  window.addEventListener("pointerup", let_go, true);
  window.addEventListener("pointercancel", let_go, true);
  window.addEventListener("blur", let_go);
  look();
}

// ---------- Fixing

/** Who a fix goes to: the session's lead, by name. */
export function fixerName() {
  const s = getDesign();
  const e = getState();
  const t = s.threadId ? e.threads.find((x) => x.id === s.threadId) : undefined;
  if (!t) return s.mock ? "Claude" : "the agent";
  return pairOf(t, e.agents, e.providers)?.lead ?? agentOf(t.agent, e.agents, e.providers).name;
}

const frameName = (id: string) => getDesign().file?.frames.find((f) => f.id === id)?.name ?? id;

/** One message to the session's agent, as a design turn on these frames. `shown`: what you read of it in the chat (the agent gets `text`). */
export async function ask(text: string, frameIds: string[], shown?: UserShown) {
  const s = getDesign();
  if (s.scrub !== undefined) return void toast("An old turn is shown", { description: "Go back to now before asking for a fix." });
  if (s.mock || !s.file) return void toast("Fixes go to the session's agent", { description: "The sample canvas has no session to ask." });
  const sel = selectionOf({ ...s, sel: frameIds.map((frame) => ({ frame })), node: undefined });
  try {
    // A design with no session yet gets it here, begun from this design.
    const id = await design.session();
    if (!id) return;
    await rpc("thread.send", { id, text, mode: "queue", design: { file: s.file.id, ...(sel ? { sel } : {}) }, ...(shown ? { shown } : {}) });
    toast(`Asked ${fixerName()}`, { description: frameIds.length > 1 ? `${frameIds.length} frames` : frameName(frameIds[0]), duration: 2500 });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

const askLine = (f: Finding) => `- ${frameName(f.frame)} (${KIND_NAME[f.kind].toLowerCase()}${f.id ? `, data-l ${f.id}` : ""}): ${f.text}`;
const RULE = "Change only what this needs, keep to the lean (DESIGN.md), and keep every data-l id you keep an element for.";

/** Fix: the finding's own changes when it has them, else an ask. */
export async function fixOne(f: Finding) {
  if (f.fix?.length) return design.apply(f.frame, f.fix);
  await ask(`Fix this check in ${frameName(f.frame)}:\n${askLine(f)}\n\n${RULE}`, [f.frame], { text: f.text, chips: [{ kind: "check", label: "Fix 1 check" }, { kind: "frame", label: frameName(f.frame) }] });
}

/** Fix all: the ones with their own changes here, the rest in one ask. */
export async function fixAll() {
  const all = toFix();
  const own = all.filter((f) => f.fix?.length);
  for (const f of own) await design.apply(f.frame, f.fix!);
  const rest = all.filter((f) => !f.fix?.length);
  if (!rest.length) return;
  const ids = [...new Set(rest.map((f) => f.frame))];
  // You read how many, and the one sentence when there is one; the agent gets each line.
  const shown: UserShown = {
    text: rest.length === 1 ? rest[0].text : `${rest.length} checks on the canvas`,
    chips: [{ kind: "check", label: rest.length === 1 ? "Fix 1 check" : `Fix ${rest.length} checks` }, ...(ids.length === 1 ? [{ kind: "frame" as const, label: frameName(ids[0]) }] : [])],
  };
  await ask(`Fix these ${rest.length === 1 ? "check" : `${rest.length} checks`} on the canvas:\n${rest.map(askLine).join("\n")}\n\n${RULE}`, ids, shown);
}

/** Show: picks the finding's node on the canvas. */
export function show(f: Finding) {
  if (getDesign().page !== getDesign().file?.frames.find((x) => x.id === f.frame)?.page) {
    const page = getDesign().file?.frames.find((x) => x.id === f.frame)?.page;
    if (page) design.setPage(page);
  }
  design.select([{ frame: f.frame, ...(f.id ? { node: f.id } : {}) }]);
}

if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __ldChecks: unknown }).__ldChecks = { getChecks, runChecks, stats };
