/*
  The canvas: the workflow drawn as one line down the middle. Steps are white cards on it;
  a branch splits it into lanes that bend back into one line below.

  Every change glides: one smooth spring carries each card, stretch of line and + from the
  old picture to the new, written straight to the DOM. Cards that leave blur out where they
  stood, and the line closes up behind them. One ring glides between the steps you pick.
  A test run fills the line with the accent on its way to each step, and the path it didn't
  take steps back.

  Drag the background or scroll to pan (past the edges it gives, then settles back); pinch,
  ⌘ + scroll or the glass buttons to zoom. Scrolling at an edge hands over to the page.
*/
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useIsoLayoutEffect, useReducedMotion, useSize, useSpring } from "../../lib/hooks";
import { clamp, rubber, springs } from "../../lib/spring";
import { feedback } from "../../lib/feedback";
import { RollingNumber } from "../../components/rolling-number/rolling-number";
import { TextShimmer } from "../../components/text-shimmer/text-shimmer";
import { AiMark, Rays } from "../ai-kit/marks";
import { Glyph, Icon } from "./glyphs";
import { edgePath, END_H, NODE_H, NODE_W, type LAdd, type LEdge, type Layout, type Pt } from "./layout";
import { fieldText, flat, formatSeconds, summaryParts, summaryText, ROOT, type InsertAt, type WorkflowPath, type WorkflowStep } from "./model";

export type StepRun = { state: "running" | "done" | "failed" | "skipped"; note?: string; seconds?: number; output?: Record<string, string> };
/** A test run as the canvas draws it: what each step is doing, which steps the line has
    reached, which path each branch took and which paths it skipped. */
export type RunView = { active: boolean; steps: Record<string, StepRun>; lit: string[]; taken: Record<string, string>; skipped: string[] };

export type CanvasApi = {
  fit: () => void;
  reveal: (id: string) => void;
  focus: (id: string) => void;
  /** Opens the add menu after this step, as if its + had been pressed. */
  addAfter: (id: string) => void;
};

export type CanvasProps = {
  steps: WorkflowStep[];
  layout: Layout;
  mode: "edit" | "view";
  selected: string | null;
  run: RunView;
  /** Room the glass over the canvas takes at the top and bottom. */
  insets: { top: number; bottom: number };
  onSelect: (id: string | null, how: "pointer" | "key" | "focus") => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  /** A + was pressed: where the step would go, where the + is in the view, and the view's size. */
  onAdd: (at: InsertAt, anchor: Pt, label: string, view: { w: number; h: number }) => void;
  /** Someone panned or zoomed. */
  onUserMove: () => void;
  api: { current: CanvasApi | null };
  /** Glass that floats over the canvas. */
  children?: ReactNode;
};

type Cam = { x: number; y: number; z: number };
const ZMIN = 0.4;
const ZMAX = 1.6;
const GRID = 22;

/** What just left the picture, kept a moment so it can fade where it stood. */
type Ghosts = { nodes: Map<string, WorkflowStep>; edges: Map<string, LEdge>; adds: Set<string>; pills: Map<string, WorkflowPath>; dots: Set<string> };
const noGhosts = (): Ghosts => ({ nodes: new Map(), edges: new Map(), adds: new Set(), pills: new Map(), dots: new Set() });
const hasGhosts = (g: Ghosts) => g.nodes.size + g.edges.size + g.adds.size + g.pills.size + g.dots.size > 0;

type Track = { layout: Layout; steps: Map<string, WorkflowStep>; paths: Map<string, WorkflowPath>; ghosts: Ghosts };
function indexSteps(steps: WorkflowStep[]) {
  const s = new Map<string, WorkflowStep>();
  const p = new Map<string, WorkflowPath>();
  for (const { step } of flat(steps)) {
    s.set(step.id, step);
    step.paths?.forEach((x) => p.set(x.id, x));
  }
  return { steps: s, paths: p };
}
function nextTrack(prev: Track, layout: Layout, steps: WorkflowStep[]): Track {
  const g = noGhosts();
  const keep = <V,>(from: Map<string, V>, into: Map<string, V>, live: Map<string, unknown>) => from.forEach((v, id) => !live.has(id) && into.set(id, v));
  keep(prev.ghosts.nodes, g.nodes, layout.nodes);
  keep(prev.ghosts.edges, g.edges, layout.edges);
  keep(prev.ghosts.pills, g.pills, layout.pills);
  prev.ghosts.adds.forEach((id) => !layout.adds.has(id) && g.adds.add(id));
  prev.ghosts.dots.forEach((id) => !layout.dots.has(id) && g.dots.add(id));
  prev.layout.nodes.forEach((_, id) => {
    const s = prev.steps.get(id);
    if (!layout.nodes.has(id) && s) g.nodes.set(id, s);
  });
  prev.layout.edges.forEach((e, id) => !layout.edges.has(id) && g.edges.set(id, e));
  prev.layout.pills.forEach((_, id) => {
    const p = prev.paths.get(id);
    if (!layout.pills.has(id) && p) g.pills.set(id, p);
  });
  prev.layout.adds.forEach((_, id) => !layout.adds.has(id) && g.adds.add(id));
  prev.layout.dots.forEach((_, id) => !layout.dots.has(id) && g.dots.add(id));
  return { layout, ...indexSteps(steps), ghosts: g };
}

/** The zoom level, outside React, so a pinch never re-renders the canvas. */
function zoomStore() {
  let z = 1;
  const ls = new Set<() => void>();
  return {
    get: () => z,
    set: (v: number) => {
      if (v === z) return;
      z = v;
      ls.forEach((f) => f());
    },
    subscribe: (f: () => void) => {
      ls.add(f);
      return () => ls.delete(f);
    },
  };
}

/** The zoom as a percentage that rolls to its new value once a gesture rests. */
function ZoomReadout({ store }: { store: ReturnType<typeof zoomStore> }) {
  const z = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [shown, setShown] = useState(z);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(z), 90);
    return () => window.clearTimeout(t);
  }, [z]);
  return (
    <span className="l-wf-zoom__pct l-num" aria-hidden>
      <RollingNumber value={Math.round(shown * 100)} />%
    </span>
  );
}

/** A step's summary, with any number in it rolling as you change it. */
function Summary({ step }: { step: WorkflowStep }) {
  return (
    <>
      {summaryParts(step).map((p, i) =>
        typeof p === "string" ? (
          p
        ) : p.type === "range" ? (
          <span key={i} className="l-wf-val">
            {p.prefix}
            <RollingNumber value={p.value} />
            {p.suffix}
          </span>
        ) : (
          <span key={i}>{fieldText(p)}</span>
        ),
      )}
    </>
  );
}

const ARROWS: Record<string, "up" | "down" | "left" | "right" | undefined> = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function Canvas({ steps, layout, mode, selected, run, insets, onSelect, onOpen, onRemove, onAdd, onUserMove, api, children }: CanvasProps) {
  const edit = mode === "edit";
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const [box, size] = useSize<HTMLDivElement>();
  const world = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement | SVGElement>());
  const bind = (key: string) => (el: HTMLElement | SVGElement | null) => {
    if (el) els.current.set(key, el);
    else els.current.delete(key);
  };

  // Derived during render, so a step that leaves keeps its element and fades where it was.
  const [track, setTrack] = useState<Track>(() => ({ layout, ...indexSteps(steps), ghosts: noGhosts() }));
  if (track.layout !== layout) setTrack(nextTrack(track, layout, steps));
  const { ghosts, paths } = track;
  useEffect(() => {
    if (!hasGhosts(ghosts)) return;
    const t = window.setTimeout(() => setTrack((s) => ({ ...s, ghosts: noGhosts() })), 280);
    return () => window.clearTimeout(t);
  }, [ghosts]);

  // The picture spring: 0 is where everything was, 1 is the new layout.
  const target = useRef(layout);
  const from = useRef(new Map<string, Pt>());
  const pos = useRef(new Map<string, Pt>());
  const kick = useRef(0);
  const t = useSpring(1, springs.smooth, () => apply());

  function apply() {
    const L = target.current;
    const k = t.value;
    const at = (key: string, p: Pt): Pt => {
      const a = k < 1 ? from.current.get(key) : undefined;
      const q = a ? { x: a.x + (p.x - a.x) * k, y: a.y + (p.y - a.y) * k } : p;
      pos.current.set(key, q);
      return q;
    };
    // Placed with `translate`, so each piece's own scale stays about its centre.
    const move = (key: string, p: Pt) => {
      const q = at(key, p);
      const el = els.current.get(key) as HTMLElement | undefined;
      if (el) el.style.translate = `${q.x}px ${q.y}px`;
    };
    L.nodes.forEach((n) => move(`n:${n.id}`, n));
    L.adds.forEach((a) => move(`a:${a.id}`, a));
    L.pills.forEach((p) => move(`p:${p.id}`, p));
    if (L.end) move("end", L.end);
    L.dots.forEach((d) => {
      const q = at(`d:${d.id}`, d);
      const el = els.current.get(`d:${d.id}`);
      el?.setAttribute("cx", String(q.x));
      el?.setAttribute("cy", String(q.y));
    });
    L.edges.forEach((e) => {
      const d = edgePath(e.kind, at(`ea:${e.id}`, e.a), at(`eb:${e.id}`, e.b));
      els.current.get(`e:${e.id}`)?.setAttribute("d", d);
      els.current.get(`x:${e.id}`)?.setAttribute("d", d);
    });
    placeRing();
  }

  useIsoLayoutEffect(() => {
    if (target.current === layout) return;
    const prev = target.current;
    from.current = new Map(pos.current);
    target.current = layout;
    window.clearTimeout(kick.current);
    t.jump(0);
    // A step taken away fades for a beat before the line closes up behind it.
    const added = [...layout.nodes.keys()].some((id) => !prev.nodes.has(id));
    const removed = [...prev.nodes.keys()].some((id) => !layout.nodes.has(id));
    if (removed && !added && !reduce) kick.current = window.setTimeout(() => t.set(1), 130);
    else t.set(1);
    settle();
  }, [layout]);
  // Every render: pieces that just mounted take their place before paint.
  useIsoLayoutEffect(() => apply());
  useEffect(() => () => window.clearTimeout(kick.current), []);

  // One ring glides from the step you had to the step you picked.
  const ringT = useSpring(1, springs.morph, () => placeRing());
  const ring = useRef<{ a: string | null; b: string | null }>({ a: selected, b: selected });
  useIsoLayoutEffect(() => {
    const r = ring.current;
    if (r.b === selected) return;
    const had = r.b !== null && pos.current.has(`n:${r.b}`);
    ring.current = { a: r.b, b: selected };
    if (!had || !selected) ringT.jump(1);
    else {
      ringT.jump(0);
      ringT.set(1);
    }
  }, [selected]);
  function placeRing() {
    const el = els.current.get("ring") as HTMLElement | undefined;
    const { a, b } = ring.current;
    const q = b ? pos.current.get(`n:${b}`) : undefined;
    if (!el || !q) return;
    const k = ringT.value;
    const p = a && k < 1 ? pos.current.get(`n:${a}`) : undefined;
    el.style.translate = p ? `${p.x + (q.x - p.x) * k}px ${p.y + (q.y - p.y) * k}px` : `${q.x}px ${q.y}px`;
  }

  /* ---------- Camera ---------- */
  const cam = useRef<Cam>({ x: 0, y: 0, z: 1 });
  const camA = useRef<Cam>(cam.current);
  const camB = useRef<Cam>(cam.current);
  const camT = useSpring(1, springs.smooth, (k) => {
    const a = camA.current;
    const b = camB.current;
    write({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
  });
  const [zoom] = useState(zoomStore);
  function write(c: Cam) {
    cam.current = c;
    const w = world.current;
    if (w) w.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`;
    const v = box.current;
    if (v) {
      v.style.backgroundPosition = `${c.x}px ${c.y}px`;
      v.style.backgroundSize = `${GRID * c.z}px ${GRID * c.z}px`;
    }
    zoom.set(c.z);
  }
  /** Where the camera is going, or where it is when it is still. */
  const aim = () => (camT.moving ? camB.current : cam.current);
  function go(c: Cam, animate = true) {
    if (!animate || reduce) {
      camT.stop();
      write(c);
      return;
    }
    camA.current = cam.current;
    camB.current = c;
    camT.jump(0);
    camT.set(1);
  }
  const view = () => ({ w: box.current?.offsetWidth ?? 0, h: box.current?.offsetHeight ?? 0 });
  // Pointer positions in the canvas's own pixels, even when a parent is zoomed or scaled.
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const v = box.current!;
    const r = v.getBoundingClientRect();
    const s = r.width / (v.offsetWidth || 1) || 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };

  /** Keeps the picture in reach: centred when it fits, otherwise never further than its edges. Past them it gives like a rubber band. */
  function fitted(c: Cam, band = false): Cam {
    const L = target.current;
    const { w, h } = view();
    const axis = (p: number, size: number, length: number, a: number, b: number) => {
      const s = size * c.z;
      const room = length - a - b;
      if (s <= room) {
        const centre = a + (room - s) / 2;
        return band ? centre + rubber(p - centre, length) : centre;
      }
      const max = a;
      const min = length - b - s;
      if (!band) return clamp(p, min, max);
      if (p > max) return max + rubber(p - max, length);
      if (p < min) return min + rubber(p - min, length);
      return p;
    };
    return { x: axis(c.x, L.width, w, 0, 0), y: axis(c.y, L.height, h, insets.top, insets.bottom), z: c.z };
  }
  function settle() {
    const c = aim();
    const n = fitted(c);
    if (Math.abs(n.x - c.x) > 0.5 || Math.abs(n.y - c.y) > 0.5) go(n);
  }
  function zoomAt(p: Pt, f: number, animate: boolean) {
    const c = animate ? aim() : cam.current;
    const z = clamp(c.z * f, ZMIN, ZMAX);
    const wx = (p.x - c.x) / c.z;
    const wy = (p.y - c.y) / c.z;
    go(fitted({ x: p.x - wx * z, y: p.y - wy * z, z }), animate);
  }
  const centre = () => {
    const { w, h } = view();
    return { x: w / 2, y: (h + insets.top - insets.bottom) / 2 };
  };
  function fit() {
    const L = target.current;
    const { w, h } = view();
    const z = clamp(Math.min((w - 24) / L.width, (h - insets.top - insets.bottom) / L.height), ZMIN, 1);
    go(fitted({ x: 0, y: insets.top, z }));
  }
  /** Brings a step into view with as little travel as it takes. */
  function reveal(id: string, animate = true) {
    const n = target.current.nodes.get(id);
    if (!n) return;
    const c = aim();
    const { w, h } = view();
    const m = 28;
    const x0 = n.x * c.z + c.x;
    const y0 = n.y * c.z + c.y;
    const x1 = x0 + NODE_W * c.z;
    const y1 = y0 + NODE_H * c.z;
    let dx = 0;
    let dy = 0;
    if (x1 - x0 > w - 2 * m) dx = w / 2 - (x0 + x1) / 2;
    else if (x0 < m) dx = m - x0;
    else if (x1 > w - m) dx = w - m - x1;
    if (y0 < insets.top + m) dy = insets.top + m - y0;
    else if (y1 > h - insets.bottom - m) dy = h - insets.bottom - m - y1;
    if (dx || dy) go(fitted({ x: c.x + dx, y: c.y + dy, z: c.z }), animate);
  }

  // First sight: as large as reads well, centred across and from the top down.
  const placed = useRef(false);
  const lastW = useRef(0);
  useIsoLayoutEffect(() => {
    if (!size?.width || !size.height) return;
    const dw = size.width - lastW.current;
    lastW.current = size.width;
    // A resize keeps what was in the middle in the middle.
    if (placed.current) return go(fitted({ ...cam.current, x: cam.current.x + dw / 2 }), false);
    placed.current = true;
    const L = target.current;
    const fz = Math.min((size.width - 24) / L.width, (size.height - insets.top - insets.bottom) / L.height);
    const z = clamp(fz, edit ? 0.78 : ZMIN, 1);
    go(fitted({ x: (size.width - L.width * z) / 2, y: insets.top, z }), false);
  }, [size?.width, size?.height]);
  // When the glass over it grows or shrinks (a sheet rising), the picture settles into the room left.
  useEffect(() => {
    if (placed.current) settle();
  }, [insets.top, insets.bottom]);

  /* ---------- Gestures ---------- */
  const pts = useRef(new Map<number, Pt>());
  const gesture = useRef<{ cam: Cam; a: Pt; d: number; moved: boolean } | null>(null);
  const begin = () => {
    const list = [...pts.current.values()];
    gesture.current = { cam: cam.current, a: list.length > 1 ? mid(list[0], list[1]) : list[0], d: list.length > 1 ? dist(list[0], list[1]) : 0, moved: gesture.current?.moved ?? false };
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!edit || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as Element).closest("[data-wf-hit]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!pts.current.size) gesture.current = null;
    pts.current.set(e.pointerId, local(e));
    camT.stop();
    begin();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    const list = [...pts.current.values()];
    if (list.length === 1) {
      const dx = list[0].x - g.a.x;
      const dy = list[0].y - g.a.y;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      if (!g.moved) {
        g.moved = true;
        box.current?.setAttribute("data-panning", "");
        onUserMove();
      }
      write(fitted({ x: g.cam.x + dx, y: g.cam.y + dy, z: g.cam.z }, true));
    } else {
      const m = mid(list[0], list[1]);
      const z = clamp(g.cam.z * (dist(list[0], list[1]) / (g.d || 1)), ZMIN, ZMAX);
      const wx = (g.a.x - g.cam.x) / g.cam.z;
      const wy = (g.a.y - g.cam.y) / g.cam.z;
      if (!g.moved) {
        g.moved = true;
        onUserMove();
      }
      write(fitted({ x: m.x - wx * z, y: m.y - wy * z, z }, true));
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!pts.current.delete(e.pointerId)) return;
    if (pts.current.size) return begin();
    const g = gesture.current;
    gesture.current = null;
    box.current?.removeAttribute("data-panning");
    // A press on empty canvas, without a drag, lets go of the step.
    if (g && !g.moved && edit && e.type === "pointerup") onSelect(null, "pointer");
    settle();
  };
  // Wheel and trackpad: pan, or zoom with ⌘/Ctrl (a trackpad pinch arrives as Ctrl + wheel).
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  useIsoLayoutEffect(() => {
    wheel.current = (e: WheelEvent) => {
      // Over the step picker the wheel scrolls its list; panning would move the canvas and close it.
      if ((e.target as Element | null)?.closest?.(".l-wf-pick")) return;
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view().h : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(local(e), Math.exp(-clamp(e.deltaY * k, -50, 50) * 0.006), false);
        onUserMove();
        return;
      }
      if (!edit) return;
      const v = box.current!;
      const s = v.getBoundingClientRect().width / (v.offsetWidth || 1) || 1;
      const c = cam.current;
      const n = fitted({ x: c.x - (e.deltaX * k) / s, y: c.y - (e.deltaY * k) / s, z: c.z });
      // At an edge the scroll goes on to the page.
      if (Math.abs(n.x - c.x) < 0.5 && Math.abs(n.y - c.y) < 0.5) return;
      e.preventDefault();
      camT.stop();
      write(n);
      onUserMove();
    };
  });
  useEffect(() => {
    const v = box.current;
    if (!v) return;
    const on = (e: WheelEvent) => wheel.current(e);
    v.addEventListener("wheel", on, { passive: false });
    return () => v.removeEventListener("wheel", on);
  }, []);

  /* ---------- Steps, keys and the + ---------- */
  const places = flat(steps);
  const order = places.map((p) => p.step.id);
  const placeOf = new Map(places.map((p, i) => [p.step.id, { ...p, n: i + 1 }]));

  const focusNode = (id: string) => (els.current.get(`n:${id}`) as HTMLElement | undefined)?.focus({ preventScroll: true });
  const choose = (id: string) => {
    onSelect(id, "key");
    focusNode(id);
    reveal(id);
    feedback.play("tick");
  };
  /** The nearest step in a direction, by where the cards sit. */
  function nearest(id: string, dir: "up" | "down" | "left" | "right") {
    const c = target.current.nodes.get(id);
    if (!c) return null;
    let best: string | null = null;
    let score = Infinity;
    target.current.nodes.forEach((n) => {
      if (n.id === id) return;
      const dx = n.x - c.x;
      const dy = n.y - c.y;
      const along = dir === "down" ? dy : dir === "up" ? -dy : dir === "right" ? dx : -dx;
      const across = dir === "down" || dir === "up" ? Math.abs(dx) : Math.abs(dy);
      if (along <= 1) return;
      const s = along + across * 2;
      if (s < score) {
        score = s;
        best = n.id;
      }
    });
    return best;
  }
  const addLabel = (a: LAdd) => {
    const after = a.after && placeOf.get(a.after)?.step.title;
    if (after) return `Add a step after “${after}”`;
    const path = a.at.list !== ROOT ? paths.get(a.at.list) : undefined;
    return path ? `Add a step to the ${path.label} path` : "Add a step";
  };
  function openAdd(a: LAdd, end = false) {
    // Bring the + into view first, without travel, so the menu opens where it can be seen.
    const { w, h } = view();
    let c = cam.current;
    const sx = a.x * c.z + c.x;
    const sy = (a.y + (end ? END_H / 2 : 0)) * c.z + c.y;
    if (sx < 16 || sx > w - 16 || sy < insets.top + 16 || sy > h - insets.bottom - 16) {
      c = fitted({ x: c.x + (w / 2 - sx), y: c.y + (h / 2 - sy), z: c.z });
      go(c, false);
    }
    onAdd(a.at, { x: a.x * c.z + c.x, y: (a.y + (end ? END_H / 2 : 0)) * c.z + c.y }, addLabel(a), { w, h });
  }
  function addAfter(id: string) {
    const p = placeOf.get(id);
    if (!p) return;
    const next = p.siblings[p.index + 1];
    const L = target.current;
    if (next) {
      const a = L.adds.get(`before:${next.id}`);
      if (a) openAdd(a);
    } else if (p.list === ROOT) {
      if (L.end) openAdd(L.end, true);
    } else {
      const a = L.adds.get(`end:${p.list}`);
      if (a) openAdd(a);
    }
  }
  useIsoLayoutEffect(() => {
    api.current = { fit, reveal, focus: focusNode, addAfter };
  });

  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    if (!edit) return;
    const id = selected && layout.nodes.has(selected) ? selected : order[0];
    if (!id) return;
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      const next = selected === id ? nearest(id, dir) : id;
      if (next) choose(next);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      choose(e.key === "Home" ? order[0] : order[order.length - 1]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(id);
    } else if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      addAfter(id);
    } else if (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomAt(centre(), e.key === "=" || e.key === "+" ? 1.25 : 0.8, true);
    } else if (e.key === "0") {
      e.preventDefault();
      fit();
    }
  };

  // Intro: the line draws itself once, top to bottom, as the cards come into focus.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), 1600);
    return () => window.clearTimeout(t);
  }, []);

  const lit = new Set(run.lit);
  const skipped = new Set(run.skipped);
  const isLit = (e: LEdge) => lit.has(e.to) && !(e.path && skipped.has(e.path));
  const focusable = selected && layout.nodes.has(selected) ? selected : order[0];
  const rank = (id: string) => (id === "end" ? order.length : Math.max(0, order.indexOf(id)));

  const node = (s: WorkflowStep, ghost: boolean) => {
    const p = placeOf.get(s.id);
    const r = ghost ? undefined : run.steps[s.id];
    const on = !ghost && selected === s.id;
    const where = p?.path ? `, on the ${p.path.label} path` : "";
    const state = r?.state === "running" ? `, running: ${r.note ?? "working"}` : r?.state === "done" ? `, done${r.seconds ? ` in ${formatSeconds(r.seconds)}` : ""}` : r?.state === "failed" ? ", failed" : r?.state === "skipped" ? ", skipped" : "";
    const glyph = s.icon ?? (s.kind === "ai" ? <AiMark phase={r?.state === "running" ? "thinking" : "idle"} size={20} /> : <Glyph name={s.glyph} kind={s.kind} />);
    const meta =
      r?.state === "running" ? (
        <TextShimmer>{r.note ?? "Working"}</TextShimmer>
      ) : r?.state === "skipped" ? (
        "Skipped this time"
      ) : r?.note ? (
        r.note
      ) : (
        <Summary step={s} />
      );
    const side =
      r?.state === "running" && s.kind !== "ai" ? (
        <Rays className="l-wf-rays" />
      ) : r?.state === "done" ? (
        <span className="l-wf-took l-num">
          <Icon.check />
          {r.seconds !== undefined && formatSeconds(r.seconds)}
        </span>
      ) : r?.state === "failed" ? (
        <Icon.warn />
      ) : null;
    return (
      <li
        key={s.id}
        ref={bind(`n:${s.id}`)}
        id={`${uid}-${s.id}`}
        className="l-wf-node"
        role={ghost ? "presentation" : edit ? "option" : "listitem"}
        aria-hidden={ghost || undefined}
        aria-selected={edit && !ghost ? on : undefined}
        aria-label={ghost ? undefined : `${s.label}: ${s.title}. ${summaryText(s)}. Step ${p?.n ?? 1} of ${order.length}${where}${state}.`}
        tabIndex={edit && !ghost ? (focusable === s.id ? 0 : -1) : undefined}
        inert={ghost || undefined}
        data-wf-hit=""
        data-kind={s.kind}
        data-state={r?.state}
        data-on={on || undefined}
        data-exit={ghost || undefined}
        style={{ "--i": rank(s.id) } as CSSProperties}
        onClick={() => edit && !ghost && onSelect(s.id, "pointer")}
        onFocus={() => edit && !ghost && selected !== s.id && onSelect(s.id, "focus")}
        onDoubleClick={() => edit && !ghost && onOpen(s.id)}
      >
        <span className="l-wf-node__glyph" aria-hidden>
          {glyph}
        </span>
        <span className="l-wf-node__text" aria-hidden>
          <span className="l-wf-node__kind">{s.label}</span>
          <span className="l-wf-node__title" key={s.title}>
            {s.title}
          </span>
          <span className="l-wf-node__meta" key={r ? `${r.state}${r.note}` : "idle"}>
            {meta}
          </span>
        </span>
        {side && (
          <span className="l-wf-node__side" key={r?.state} aria-hidden>
            {side}
          </span>
        )}
      </li>
    );
  };

  const wire = (e: LEdge, ghost: boolean) => (
    <g
      key={e.id}
      className="l-wf-wire"
      data-kind={e.kind}
      data-lit={(!ghost && isLit(e)) || undefined}
      data-dim={(!ghost && e.path && skipped.has(e.path)) || undefined}
      data-exit={ghost || undefined}
      style={{ "--o": e.order, "--i": rank(e.to) } as CSSProperties}
    >
      <path ref={bind(`e:${e.id}`)} className="l-wf-wire__base" pathLength={e.kind === "tail" ? undefined : 1} />
      {e.kind !== "tail" && <path ref={bind(`x:${e.id}`)} className="l-wf-wire__lit" pathLength={1} />}
    </g>
  );

  const pill = (id: string, path: WorkflowPath | undefined, branch: string | undefined, ghost: boolean) => (
    <span key={id} ref={bind(`p:${id}`)} className="l-wf-pill-at" aria-hidden data-exit={ghost || undefined}>
      <span className="l-wf-pill" data-taken={(!ghost && branch && run.taken[branch] === id) || undefined} data-dim={(!ghost && skipped.has(id)) || undefined}>
        {path?.label}
        {path?.share !== undefined && (
          <b className="l-num">
            <RollingNumber value={path.share} />%
          </b>
        )}
      </span>
    </span>
  );

  return (
    <div
      ref={box}
      className="l-wf-view"
      data-mode={mode}
      data-run={run.active || undefined}
      data-intro={intro || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={world} className="l-wf-world" style={{ width: layout.width, height: layout.height }}>
        <svg className="l-wf-wires" width={layout.width} height={layout.height} aria-hidden>
          {[...layout.edges.values()].map((e) => wire(e, false))}
          {[...ghosts.edges.values()].map((e) => wire(e, true))}
          {[...layout.dots.values(), ...[...ghosts.dots].map((id) => ({ id }))].map((d) => (
            <circle key={d.id} ref={bind(`d:${d.id}`)} className="l-wf-dot" r={3.5} data-exit={ghosts.dots.has(d.id) || undefined} style={{ "--i": 0 } as CSSProperties} />
          ))}
        </svg>
        {edit && <span ref={bind("ring")} className="l-wf-ring" data-on={(selected && layout.nodes.has(selected)) || undefined} aria-hidden />}
        <ol className="l-wf-steps" role={edit ? "listbox" : "list"} aria-label="Steps" aria-describedby={edit ? `${uid}-keys` : undefined} onKeyDown={onKeyDown}>
          {order.map((id) => {
            const p = placeOf.get(id)!;
            return node(p.step, false);
          })}
          {[...ghosts.nodes.values()].map((s) => node(s, true))}
        </ol>
        {[...layout.pills.values()].map((p) => pill(p.id, paths.get(p.id), p.branch, false))}
        {[...ghosts.pills].map(([id, p]) => pill(id, p, undefined, true))}
        {edit &&
          [...layout.adds.values()].map((a) => (
            <button key={a.id} ref={bind(`a:${a.id}`)} type="button" className="l-wf-add" data-wf-hit="" tabIndex={-1} aria-label={addLabel(a)} onClick={() => openAdd(a)}>
              <Icon.plus />
            </button>
          ))}
        {edit &&
          [...ghosts.adds].map((id) => (
            <span key={id} ref={bind(`a:${id}`)} className="l-wf-add" data-exit="" aria-hidden>
              <Icon.plus />
            </span>
          ))}
        {edit && layout.end && (
          <button ref={bind("end")} type="button" className="l-wf-end" data-wf-hit="" onClick={() => layout.end && openAdd(layout.end, true)}>
            <Icon.plus />
            Add a step
          </button>
        )}
      </div>
      {edit && (
        <div className="l-wf-zoom l-glass" data-wf-hit="">
          <button
            type="button"
            className="l-wf-tool l-plate l-focus"
            data-step=""
            aria-label="Zoom out"
            onClick={() => {
              zoomAt(centre(), 0.8, true);
              onUserMove();
            }}
          >
            <Icon.minus />
          </button>
          <ZoomReadout store={zoom} />
          <button
            type="button"
            className="l-wf-tool l-plate l-focus"
            data-step=""
            aria-label="Zoom in"
            onClick={() => {
              zoomAt(centre(), 1.25, true);
              onUserMove();
            }}
          >
            <Icon.plus />
          </button>
          <span className="l-wf-zoom__sep" aria-hidden />
          <button
            type="button"
            className="l-wf-tool l-plate l-focus"
            aria-label="Fit the whole workflow"
            onClick={() => {
              fit();
              onUserMove();
            }}
          >
            <Icon.fit />
          </button>
        </div>
      )}
      {children}
      {edit && (
        <p id={`${uid}-keys`} className="l-sr-only">
          Arrow keys move between steps. Enter opens a step's settings, A adds a step after it, and Delete removes it.
        </p>
      )}
    </div>
  );
}

