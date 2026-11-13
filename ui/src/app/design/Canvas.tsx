/*
  The canvas: the open design file's frames on a plane you pan and zoom. The plane is one element
  moved and scaled by a transform; each frame is an iframe at its own size on it (Frame.tsx), with
  no pointer events of its own. Everything you see on top (the frames' names, the selection and its
  handles, what you point at, who is drawing where, the say bar) is drawn here in screen pixels,
  from the bridge's rects, never inside a frame.

  Pressing reads what is under the pointer through the bridge (frames.hit): a press picks the
  outermost thing under it, or the one beside what's picked at the same depth; a double press goes
  one deeper, and on a text starts editing it in place; ⌘ goes straight to the deepest. A frame is
  moved by its name (or by dragging it once it's picked), and resized by its edges, which reflows
  what it holds. A node picked in a stack can be pulled wider or taller by its edges; it can't be
  dragged out of its place (reorder it with ⌘[ and ⌘], or in Layers).

  An agent at work reads as generating: the frame it is on has a ring in its colour that breathes,
  what it writes settles in inside the frame (Frame.tsx, frame-agent.js), and a small change is lit
  for a moment here on the overlay with a "Changed" tag (live.css). None of it is in a frame's file.
*/
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as PE } from "react";
import type { DesignFrame, Rect, TreeNode } from "@contracts";
import { editText, frames, onEdited, onReady } from "./bridge";
import { carriesFiles, dropFiles } from "./Drop";
import { Frame, takeMarks } from "./Frame";
import "./live.css";
import { SayBar } from "./SayBar";
import { FrameMark } from "./BuildTab";
import { CompareOver } from "./Compare";
import { LiveMark } from "./Live";
import { CheckLabel, CheckMarks } from "./ChecksTab";
import { WayLabel, WaysOver } from "./Ways";
import { PictureOver } from "./Pictures";
import { blankHtml, design, frameOf, getDesign, isGone, keepsView, useDesign, type Sel } from "./store";

const DRAG = 3;
type Box = { x: number; y: number; w: number; h: number };
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Drag =
  | { kind: "pan"; sx: number; sy: number; pan: { x: number; y: number } }
  | { kind: "move"; sx: number; sy: number; ids: string[]; start: DesignFrame[]; moved: boolean }
  | { kind: "frame-size"; sx: number; sy: number; id: string; edge: Edge; start: DesignFrame }
  | { kind: "node-size"; sx: number; sy: number; frame: string; id: string; edge: Edge; w: number; h: number; z: number }
  | { kind: "draw"; sx: number; sy: number; wx: number; wy: number; box?: Box };

/** A node and its parent, in a frame's outline. */
export function parentIn(root: TreeNode | undefined, id: string): { node: TreeNode; parent?: TreeNode; i: number } | undefined {
  if (!root) return undefined;
  if (root.id === id) return { node: root, i: 0 };
  const walk = (p: TreeNode): ReturnType<typeof parentIn> => {
    for (let i = 0; i < p.children.length; i++) {
      const c = p.children[i];
      if (c.id === id) return { node: c, parent: p, i };
      const f = walk(c);
      if (f) return f;
    }
    return undefined;
  };
  return walk(root);
}

/** The frames' bounds on a page. */
export function boundsOf(list: DesignFrame[]): Box | undefined {
  if (!list.length) return undefined;
  const x = Math.min(...list.map((f) => f.x));
  const y = Math.min(...list.map((f) => f.y));
  return { x, y, w: Math.max(...list.map((f) => f.x + f.w)) - x, h: Math.max(...list.map((f) => f.y + f.h)) - y };
}

/** Zooms so the page's frames fit the canvas (⌘1), or to 100% round the middle (⌘0). */
export function fit(el: HTMLElement | null, to?: "all" | "actual") {
  const s = getDesign();
  if (!el || !s.file) return;
  const list = s.file.frames.filter((f) => f.page === (s.page ?? s.file!.pages[0]?.id));
  const r = el.getBoundingClientRect();
  const b = boundsOf(s.sel.length ? list.filter((f) => s.sel.some((x) => x.frame === f.id)) : list) ?? boundsOf(list);
  if (!b) return design.view(1, { x: 60, y: 60 });
  // The dock covers the canvas's foot, the rail its left edge.
  const room = { w: r.width - 120, h: r.height - 220 };
  const zoom = to === "actual" ? 1 : Math.min(2, Math.max(0.02, Math.min(room.w / b.w, room.h / b.h)));
  design.view(zoom, { x: 70 + (room.w - b.w * zoom) / 2 - b.x * zoom, y: 50 + (room.h - b.h * zoom) / 2 - b.y * zoom });
}

export function Canvas({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const file = useDesign((s) => s.file);
  const page = useDesign((s) => s.page ?? s.file?.pages[0]?.id);
  const sel = useDesign((s) => s.sel);
  const tool = useDesign((s) => s.tool);
  const zoom = useDesign((s) => s.zoom);
  const pan = useDesign((s) => s.pan);
  const presence = useDesign((s) => s.presence);
  const editing = useDesign((s) => s.editing);
  const play = useDesign((s) => s.tool === "play");
  const [dropping, setDropping] = useState(false);
  // Which drawn frames have nothing in them yet, as one string so a typed letter elsewhere redraws nothing here.
  const blanks = useDesign((s) => (s.file?.frames ?? []).filter((f) => f.kind === "drawn" && blankHtml(s.html[f.id])).map((f) => f.id).join(","));
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [hover, setHover] = useState<{ frame: string; rect: Rect } | null>(null);
  const [space, setSpace] = useState(false);
  const [drawBox, setDrawBox] = useState<Box | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const depth = useRef(0);
  const fitted = useRef<string | undefined>(undefined);
  const onPage = useMemo(() => (file?.frames ?? []).filter((f) => f.page === page), [file, page]);

  // A design file shown for the first time fits the canvas.
  useLayoutEffect(() => {
    if (!file || fitted.current === `${file.id}:${page}`) return;
    fitted.current = `${file.id}:${page}`;
    // A tab coming back keeps the view it had (store.ts show).
    if (!keepsView(file.id)) fit(root.current);
  }, [file?.id, page, onPage.length > 0]);

  // Where the selected nodes are, in their frames' pixels, as the frames say while they move.
  const watchKey = sel.filter((x) => x.node).map((x) => `${x.frame}:${x.node}`).join(",");
  useEffect(() => {
    const byFrame = new Map<string, string[]>();
    for (const x of sel) if (x.node) byFrame.set(x.frame, [...(byFrame.get(x.frame) ?? []), x.node]);
    const stops = [...byFrame].map(([frame, ids]) =>
      frames.watch(frame, ids, (r) =>
        setRects((was) => {
          const next: Record<string, Rect> = {};
          for (const [k, v] of Object.entries(was)) if (!k.startsWith(`${frame}:`)) next[k] = v;
          for (const [id, v] of Object.entries(r)) next[`${frame}:${id}`] = v;
          return next;
        }),
      ),
    );
    if (!byFrame.size) setRects({});
    return () => stops.forEach((s) => s());
  }, [watchKey]);

  // A small change an agent made (Frame.tsx planOf): each changed element lit in the agent's colour for a moment, "Changed" by the first.
  const [changed, setChanged] = useState<{ frame: string; lead: boolean; rects: Rect[]; key: number }[]>([]);
  useEffect(() => {
    const timers = new Set<number>();
    const stop = onReady((frame) => {
      const m = takeMarks(frame);
      if (!m) return;
      void Promise.all(m.ids.map((id) => frames.read(frame, id).then((n) => n.rect, () => undefined))).then((got) => {
        const rects = got.filter((r): r is Rect => Boolean(r && r.w > 0 && r.h > 0));
        if (!rects.length) return;
        const key = Date.now() + Math.random();
        setChanged((was) => [...was.filter((x) => x.frame !== frame), { frame, lead: m.lead, rects, key }]);
        const t = window.setTimeout(() => (timers.delete(t), setChanged((was) => was.filter((x) => x.key !== key))), 2400);
        timers.add(t);
      });
    });
    return () => (stop(), timers.forEach((t) => clearTimeout(t)));
  }, []);

  // A frame that loaded again (the agent changed it) is read again: its outline, and the node picked in it.
  useEffect(
    () =>
      onReady((frame) => {
        const s = getDesign();
        // A live page loaded again (its tab shown again, or the app reloaded it) shows the changes still held for it.
        const held = s.pending[frame];
        if (held?.length && frameOf(s, frame)?.kind === "live") void frames.apply(frame, held).catch(() => {});
        const ids = s.sel.filter((x) => x.frame === frame && x.node).map((x) => x.node!);
        // The bridge watches the picked nodes again by itself once the frame is ready.
        if (ids.length) void design.refreshNode();
        if (s.tree[frame] || s.sel.some((x) => x.frame === frame)) void design.refreshTree(frame);
      }),
    [],
  );
  // A text edited in place ends: its words go into the file, as one step to undo.
  useEffect(
    () =>
      onEdited((frame, id, text, inner) => {
        design.edit(undefined);
        // The keyboard comes back from the frame, so Esc and ⌘Z are the canvas's again.
        root.current?.focus({ preventScroll: true });
        // Plain words go in as text; a text with marks inside (a <b>, a <span>) as its runs, each mark
        // kept from the file's own source by id (never the page as its scripts drew it).
        void design.apply(frame, [inner ? { id, inner } : { id, text }]);
      }),
    [],
  );
  useEffect(() => {
    for (const x of sel) if (!getDesign().tree[x.frame]) void design.refreshTree(x.frame);
  }, [sel]);

  /*
    Space held pans, as in every canvas, with the focus on the canvas or on nothing. Not while you
    type, and not on a control that Space presses (a button in the chat, the inspector, the tabs or
    Layers, a menu): there Space is that control's. The rail's tools are the canvas's own, so a tool
    just picked still lets Space pan.
  */
  useEffect(() => {
    const CONTROL = "input, textarea, select, [contenteditable], button, a[href], summary, [role=button], [role=tab], [role=checkbox], [role=switch], [role=radio], [role=menuitem], [role=option], [role=slider]";
    const its = (t: EventTarget | null) => {
      if (!(t instanceof Element) || t === root.current) return false;
      if (t.closest(".ld-dock, .ldc-col, .ldc-host, .lc-pop-panel")) return true;
      const c = t.closest(CONTROL);
      return Boolean(c && !(c.closest(".ld-rail") && !c.matches("input, textarea, select, [contenteditable]")));
    };
    const down = (e: KeyboardEvent) => e.code === "Space" && !e.repeat && !its(e.target) && (e.preventDefault(), setSpace(true));
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Two fingers pan, a pinch or ⌘ with the wheel zooms round the pointer.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".ld-dock, .ld-rail, .lc-pop-panel")) return;
      e.preventDefault();
      const s = getDesign();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const k = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
        const z = Math.min(8, Math.max(0.02, s.zoom * k));
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        design.view(z, { x: px - ((px - s.pan.x) * z) / s.zoom, y: py - ((py - s.pan.y) * z) / s.zoom });
      } else design.view(s.zoom, { x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const world = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    const s = getDesign();
    return { x: (e.clientX - r.left - s.pan.x) / s.zoom, y: (e.clientY - r.top - s.pan.y) / s.zoom };
  };
  const frameAt = (p: { x: number; y: number }) => [...onPage].reverse().find((f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h);

  /** Picks by what's under the pointer, as the header comment says. */
  const pick = async (f: DesignFrame, p: { x: number; y: number }, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; count: number }) => {
    const hit = await frames.hit(f.id, p.x - f.x, p.y - f.y, e.metaKey || e.ctrlKey).catch(() => ({ node: null, path: [] }));
    const s = getDesign();
    const path = hit.path;
    const cur = s.sel.find((x) => x.frame === f.id && x.node);
    let next: Sel | undefined;
    if (!path.length) next = { frame: f.id };
    else if (e.metaKey || e.ctrlKey) {
      depth.current = path.length - 1;
      next = { frame: f.id, node: path[path.length - 1].id };
    } else {
      const k = cur ? path.findIndex((n) => n.id === cur.node) : -1;
      if (k >= 0 && e.count >= 2) {
        // Deeper, or into the words of a text.
        if (k + 1 < path.length) {
          depth.current = k + 1;
          next = { frame: f.id, node: path[k + 1].id };
        } else if (path[k].kind === "text") {
          design.edit({ frame: f.id, node: path[k].id });
          editText(f.id, path[k].id, true);
          return;
        } else next = { frame: f.id, node: path[k].id };
      } else if (k >= 0) next = { frame: f.id, node: path[k].id };
      else if (cur || s.sel.some((x) => x.frame === f.id && !x.node)) {
        // The thing beside what was picked, at the same depth; from the frame, its outermost.
        const d = cur ? Math.min(depth.current, path.length - 1) : 0;
        depth.current = d;
        next = { frame: f.id, node: path[d].id };
      } else {
        depth.current = 0;
        next = { frame: f.id, node: path[0].id };
      }
      // A double press on a text picked at once edits it.
      if (e.count >= 2 && next.node && path.find((n) => n.id === next!.node)?.kind === "text" && k < 0) {
        design.select([next]);
        design.edit(next);
        editText(f.id, next.node, true);
        return;
      }
    }
    if (e.shiftKey) {
      const there = s.sel.some((x) => x.frame === next!.frame && x.node === next!.node);
      design.select(there ? s.sel.filter((x) => !(x.frame === next!.frame && x.node === next!.node)) : [...s.sel, next]);
    } else design.select([next]);
  };

  const endEdit = () => {
    const s = getDesign();
    if (s.editing?.node) editText(s.editing.frame, s.editing.node, false);
  };

  // Presses in a row, counted here: a pointer event's own detail isn't the click count everywhere.
  const presses = useRef({ t: 0, x: 0, y: 0, n: 0 });
  const onDown = async (ev: PE<HTMLDivElement>) => {
    if (ev.button === 2) return;
    const was = presses.current;
    const n = ev.timeStamp - was.t < 450 && Math.hypot(ev.clientX - was.x, ev.clientY - was.y) < 5 ? was.n + 1 : 1;
    presses.current = { t: ev.timeStamp, x: ev.clientX, y: ev.clientY, n };
    const e = Object.assign(ev, { count: n });
    if ((e.target as Element).closest(".ld-dock, .ld-rail, .ld-say, .lc-pop-panel, [data-ld-ui]")) return;
    const s = getDesign();
    if (s.editing) endEdit();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || space || s.tool === "hand") {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, pan: s.pan };
      return;
    }
    if (s.tool === "play") return;
    const p = world(e);
    if (s.tool === "frame") {
      drag.current = { kind: "draw", sx: e.clientX, sy: e.clientY, wx: p.x, wy: p.y };
      return;
    }
    const f = frameAt(p);
    if (!f) {
      if (!e.shiftKey) design.select([]);
      // An empty spot drags the canvas.
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, pan: s.pan };
      return;
    }
    const frameSel = s.sel.filter((x) => !x.node).map((x) => x.frame);
    if (frameSel.includes(f.id) && e.count < 2) {
      // A picked frame drags; a press without moving goes into it.
      drag.current = { kind: "move", sx: e.clientX, sy: e.clientY, ids: frameSel, start: s.file!.frames.filter((x) => frameSel.includes(x.id)), moved: false };
      return;
    }
    // A frame whose file is gone holds nothing to pick: it's picked whole, and drags as a frame.
    if (isGone(f)) {
      design.select(e.shiftKey ? [...s.sel, { frame: f.id }] : [{ frame: f.id }]);
      drag.current = { kind: "move", sx: e.clientX, sy: e.clientY, ids: [f.id], start: [f], moved: false };
      return;
    }
    await pick(f, p, e);
  };

  const onMove = (e: PE<HTMLDivElement>) => {
    const d = drag.current;
    const s = getDesign();
    if (!d) {
      if (s.tool !== "select" || space || s.editing) return hover && setHover(null);
      hoverAt(e);
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === "pan") return design.view(s.zoom, { x: d.pan.x + dx, y: d.pan.y + dy });
    if (d.kind === "move") {
      if (!d.moved && Math.hypot(dx, dy) < DRAG) return;
      d.moved = true;
      return design.place(d.start.map((f) => ({ id: f.id, x: f.x + dx / s.zoom, y: f.y + dy / s.zoom })));
    }
    if (d.kind === "frame-size") {
      const f = d.start;
      const zx = dx / s.zoom;
      const zy = dy / s.zoom;
      const b = { x: f.x, y: f.y, w: f.w, h: f.h };
      if (d.edge.includes("e")) b.w = f.w + zx;
      if (d.edge.includes("s")) b.h = f.h + zy;
      if (d.edge.includes("w")) (b.w = f.w - zx), (b.x = f.x + Math.min(zx, f.w - 40));
      if (d.edge.includes("n")) (b.h = f.h - zy), (b.y = f.y + Math.min(zy, f.h - 40));
      return design.place([{ id: f.id, ...b }]);
    }
    if (d.kind === "node-size") {
      const style: Record<string, string> = {};
      if (d.edge.includes("e")) style.width = `${Math.max(1, Math.round(d.w + dx / d.z))}px`;
      if (d.edge.includes("s")) style.height = `${Math.max(1, Math.round(d.h + dy / d.z))}px`;
      sizeNode(d.frame, d.id, style);
      return;
    }
    if (d.kind === "draw") {
      const p = world(e);
      const box = { x: Math.min(p.x, d.wx), y: Math.min(p.y, d.wy), w: Math.abs(p.x - d.wx), h: Math.abs(p.y - d.wy) };
      d.box = box;
      setDrawBox(box);
    }
  };

  const onUp = async (e: PE<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = getDesign();
    if (d.kind === "move") {
      if (d.moved) design.place(d.start.map((f) => ({ id: f.id })), { before: d.start });
      else {
        const p = world(e);
        const f = frameAt(p);
        if (f) await pick(f, p, { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, count: 1 });
      }
    } else if (d.kind === "frame-size") design.place([{ id: d.id }], { before: [d.start] });
    else if (d.kind === "draw") {
      setDrawBox(null);
      design.setTool("select");
      const b = d.box;
      if (b && b.w > 20 && b.h > 20) await design.addFrame({ w: Math.round(b.w), h: Math.round(b.h) }, "Frame", { x: Math.round(b.x), y: Math.round(b.y) });
      else await design.addFrame("phone", undefined, { x: Math.round(d.wx), y: Math.round(d.wy) });
    } else if (d.kind === "pan" && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG && s.tool === "hand") {
      // nothing: a hand's press without a drag
    }
  };

  // Pointing shows what a press would pick, a moment behind the pointer at most.
  const hovering = useRef(0);
  const hoverAt = (e: PE<HTMLDivElement>) => {
    if (hovering.current) return;
    const p = world(e);
    hovering.current = requestAnimationFrame(async () => {
      const f = frameAt(p);
      if (!f) {
        hovering.current = 0;
        return setHover(null);
      }
      const s = getDesign();
      const hit = await frames.hit(f.id, p.x - f.x, p.y - f.y).catch(() => null);
      hovering.current = 0;
      if (!hit || !hit.path.length) return setHover(null);
      const cur = s.sel.find((x) => x.frame === f.id && x.node);
      const k = cur ? hit.path.findIndex((n) => n.id === cur.node) : -1;
      const n = k >= 0 ? hit.path[Math.min(k + 1, hit.path.length - 1)] : hit.path[Math.min(cur ? depth.current : 0, hit.path.length - 1)];
      setHover({ frame: f.id, rect: n.rect });
    });
  };

  // Pulling a node's edge: one change a frame of animation at most, one step to undo for the pull.
  const sizing = useRef<{ frame: string; id: string; style: Record<string, string> } | null>(null);
  const sizeFrame = useRef(0);
  const sizeNode = (frame: string, id: string, style: Record<string, string>) => {
    sizing.current = { frame, id, style };
    if (sizeFrame.current) return;
    sizeFrame.current = requestAnimationFrame(() => {
      sizeFrame.current = 0;
      const c = sizing.current;
      if (c) void design.apply(c.frame, [{ id: c.id, style: c.style }], { coalesce: `size:${c.id}` });
    });
  };

  const startFrameSize = (f: DesignFrame, edge: Edge) => (e: PE) => {
    e.stopPropagation();
    root.current?.setPointerCapture?.(e.pointerId);
    drag.current = { kind: "frame-size", sx: e.clientX, sy: e.clientY, id: f.id, edge, start: f };
  };
  const startNodeSize = (frame: string, id: string, r: Rect, edge: Edge) => (e: PE) => {
    e.stopPropagation();
    root.current?.setPointerCapture?.(e.pointerId);
    drag.current = { kind: "node-size", sx: e.clientX, sy: e.clientY, frame, id, edge, w: r.w, h: r.h, z: getDesign().zoom };
  };
  const startLabel = (f: DesignFrame) => (e: PE) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const s = getDesign();
    if (s.editing) endEdit();
    const already = s.sel.some((x) => x.frame === f.id && !x.node);
    const ids = e.shiftKey ? [...new Set([...s.sel.filter((x) => !x.node).map((x) => x.frame), f.id])] : already ? s.sel.filter((x) => !x.node).map((x) => x.frame) : [f.id];
    design.select(ids.map((frame) => ({ frame })));
    root.current?.setPointerCapture?.(e.pointerId);
    drag.current = { kind: "move", sx: e.clientX, sy: e.clientY, ids, start: getDesign().file!.frames.filter((x) => ids.includes(x.id)), moved: false };
  };

  const toScreen = useCallback((x: number, y: number) => ({ x: pan.x + x * zoom, y: pan.y + y * zoom }), [pan, zoom]);
  const boxOf = (f: DesignFrame, r?: Rect) => {
    const a = toScreen(f.x + (r?.x ?? 0), f.y + (r?.y ?? 0));
    return { left: a.x, top: a.y, width: (r?.w ?? f.w) * zoom, height: (r?.h ?? f.h) * zoom };
  };

  /*
    How wide a frame's label row may be: its frame's width, and never past the next label that starts
    on the same row to its right. Two frames at one place (an old file): the later one's label gives
    way. Within that room the row drops whole chips from the right first, then ends the name in an
    ellipsis (the label row's own rule).
  */
  const labelRoom = (i: number) => {
    const me = boxOf(onPage[i]);
    let room = Math.max(60, me.width);
    onPage.forEach((g, j) => {
      if (j === i) return;
      const o = boxOf(g);
      if (Math.abs(o.top - me.top) >= 20) return;
      if (o.left > me.left) room = Math.min(room, o.left - me.left - 8);
      else if (o.left === me.left && j < i) room = 0;
    });
    return room;
  };

  const firstSel = sel[0];
  const selFrame = frameOf({ file } as never, firstSel?.frame);
  const sayAt = (() => {
    if (!firstSel || !selFrame) return undefined;
    const r = firstSel.node ? rects[`${firstSel.frame}:${firstSel.node}`] : undefined;
    if (firstSel.node && !r) return undefined;
    const b = boxOf(selFrame, r);
    return { x: b.left + b.width / 2, y: b.top + b.height + 10, above: b.top - 10 };
  })();
  const cursor = space || tool === "hand" ? (drag.current?.kind === "pan" ? "grabbing" : "grab") : tool === "frame" ? "crosshair" : "default";
  const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  return (
    <div
      ref={root}
      tabIndex={-1}
      className="ld-cv-hit"
      style={{ cursor }}
      onPointerDown={(e) => void onDown(e)}
      onPointerMove={onMove}
      onPointerUp={(e) => void onUp(e)}
      onPointerLeave={() => setHover(null)}
      data-play={play || undefined}
      data-drop={dropping || undefined}
      // Your own picture files, dropped on a frame or the empty canvas (Drop.ts).
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        if (!carriesFiles(e)) return;
        e.preventDefault();
        const p = world(e);
        void dropFiles(e.dataTransfer.files, p, frameAt(p));
      }}
    >
      <div className="ld-plane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {(file?.frames ?? []).map((f) => (
          <div key={f.id} className="ld-frame" data-gone={isGone(f) || undefined} style={{ left: f.x, top: f.y, width: f.w, height: f.h }} hidden={f.page !== page || undefined}>
            {isGone(f) ? (
              // Its file is gone: an empty box at its place, with its name, until the file comes back.
              <div className="ld-gone" style={{ fontSize: Math.min(13 / zoom, f.w / 22) }}>
                <b>{f.name}</b>
                <span>Its file is gone: {f.path ?? `frames/${f.id}.html`}</span>
              </div>
            ) : (
              <Frame frame={f} editing={editing?.frame === f.id} live={play} />
            )}
          </div>
        ))}
      </div>

      {/* What's drawn over the frames, in screen pixels. */}
      <div className="ld-over" aria-hidden={false}>
        {onPage.map((f, i) => {
          const b = boxOf(f);
          const room = labelRoom(i);
          const p = presence[f.id];
          const picked = sel.some((x) => x.frame === f.id && !x.node);
          const blank = blanks.split(",").includes(f.id);
          return (
            <div key={f.id}>
              <div className="ld-label" data-ld-ui hidden={room <= 0 || undefined} style={{ left: b.left, top: b.top - 22, maxWidth: room }} data-on={picked || undefined} onPointerDown={naming === f.id ? (e) => e.stopPropagation() : startLabel(f)} onDoubleClick={() => setNaming(f.id)}>
                {naming === f.id ? (
                  <input
                    className="ld-name"
                    aria-label="The frame's name"
                    defaultValue={f.name}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== f.name) design.rename(f.id, v);
                      setNaming(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") (e.currentTarget.value = f.name), e.currentTarget.blur();
                    }}
                  />
                ) : (
                  <b>{f.name}</b>
                )}
                {/* The row wraps onto a line it hides: with too little room, whole chips drop from the right (size, then the build state, then the checks); the name keeps its place and ends in an ellipsis. */}
                {p && (
                  <span className="ld-ptag" data-lead={p.lead || undefined}>
                    {p.name}
                  </span>
                )}
                {/* A frame whose file is gone carries its name and that, nothing else: no checks, no build state. */}
                {isGone(f) ? (
                  <span className="ld-ly-gone">file gone</span>
                ) : blank ? (
                  // Nothing drawn in it yet: its name and size, no checks or build state it hasn't earned.
                  <span className="ld-num">
                    {f.w} × {f.h}
                  </span>
                ) : (
                  <>
                    <WayLabel frame={f} />
                    <LiveMark frame={f} />
                    <CheckLabel frame={f} />
                    <FrameMark frame={f} />
                    <span className="ld-num">
                      {f.w} × {f.h}
                    </span>
                  </>
                )}
              </div>
              {/* The ring breathes outward 7.5 px a side: a scale worked out from the box, so only transform and opacity move (design-face.css). */}
              {p && <div className="ld-pres" data-lead={p.lead || undefined} style={{ ...b, ["--ld-gx" as string]: (b.width + 15) / Math.max(1, b.width), ["--ld-gy" as string]: (b.height + 15) / Math.max(1, b.height) }} />}
              <CompareOver frame={f} box={b} zoom={zoom} />
            </div>
          );
        })}
        {hover && !drag.current && (() => {
          const f = frameOf({ file } as never, hover.frame);
          return f ? <div className="ld-hover" style={boxOf(f, hover.rect)} /> : null;
        })()}
        {sel.map((x) => {
          const f = frameOf({ file } as never, x.frame);
          if (!f || f.page !== page) return null;
          const r = x.node ? rects[`${x.frame}:${x.node}`] : undefined;
          if (x.node && !r) return null;
          const b = boxOf(f, r);
          const one = sel.length === 1 && !(editing && editing.node === x.node);
          return (
            <div key={`${x.frame}:${x.node ?? ""}`} className="ld-sel" data-frame={!x.node || undefined} style={b}>
              {one &&
                (x.node
                  ? (["e", "s", "se"] as Edge[]).map((edge) => <i key={edge} data-edge={edge} data-ld-ui onPointerDown={startNodeSize(x.frame, x.node!, r!, edge)} />)
                  : EDGES.map((edge) => <i key={edge} data-edge={edge} data-ld-ui onPointerDown={startFrameSize(f, edge)} />))}
            </div>
          );
        })}
        {changed.map((c) => {
          const f = frameOf({ file } as never, c.frame);
          if (!f || f.page !== page) return null;
          const first = boxOf(f, c.rects[0]);
          return (
            <div key={c.key} className="ld-chg-set" data-lead={c.lead || undefined}>
              {c.rects.map((r, i) => (
                <div key={i} className="ld-chg" style={boxOf(f, r)} />
              ))}
              <span className="ld-chg-tag" style={{ left: first.left, top: first.top + first.height + 4 }}>
                Changed
              </span>
            </div>
          );
        })}
        <CheckMarks frames={onPage} boxOf={boxOf} />
        <PictureOver frames={onPage} boxOf={boxOf} />
        <WaysOver frames={onPage} boxOf={boxOf} />
        {drawBox && <div className="ld-draw" style={boxOf({ ...drawBox, id: "", page: "", name: "", kind: "drawn" } as DesignFrame)} />}
      </div>
      {sayAt && !editing && !drag.current && <SayBar x={sayAt.x} y={sayAt.y} above={sayAt.above} />}
    </div>
  );
}
