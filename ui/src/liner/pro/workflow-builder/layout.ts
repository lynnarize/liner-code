/*
  The picture of a workflow, worked out from its steps alone. Every step is a card on one
  line down the middle; a branch splits the line into lanes, each as wide as what it holds,
  and the lanes bend back into one line below it. Pure and deterministic, so the canvas can
  glide from one picture to the next, and nothing needs measuring.

  Each stretch of line knows the step it leads into (`to`), so a run can light the way to a
  step as it starts, one stretch after another (`order`).
*/
import { ROOT, type InsertAt, type WorkflowStep } from "./model";

export const NODE_W = 248;
export const NODE_H = 72;
/** Between two steps; a + sits halfway. */
const EDGE = 44;
/** The straight drop out of a branch before its line bends. */
const STUB = 10;
const CURVE = 34;
/** A path's label, sitting on its line. */
const PILL = 24;
const LANE_GAP = 28;
export const PAD = { x: 44, y: 30 };
/** The "Add a step" at the end of the line. */
export const END_H = 34;

export type Pt = { x: number; y: number };
export type LEdge = {
  id: string;
  kind: "line" | "split" | "merge" | "tail";
  a: Pt;
  b: Pt;
  /** The step this stretch leads into, or "end". */
  to: string;
  /** The innermost path it runs through, if any. */
  path?: string;
  order: number;
};
export type LNode = Pt & { id: string };
export type LAdd = Pt & { id: string; at: InsertAt; after?: string };
export type LPill = Pt & { id: string; branch: string };
export type LDot = Pt & { id: string };
export type Layout = {
  nodes: Map<string, LNode>;
  edges: Map<string, LEdge>;
  adds: Map<string, LAdd>;
  pills: Map<string, LPill>;
  dots: Map<string, LDot>;
  /** The "Add a step" at the end, when there is one: its top centre. */
  end: LAdd | null;
  width: number;
  height: number;
};

const widthOf = (list: WorkflowStep[]): number => list.reduce((w, s) => (s.paths?.length ? Math.max(w, branchWidth(s)) : w), NODE_W);
function branchWidth(s: WorkflowStep) {
  const lanes = s.paths!.map((p) => widthOf(p.steps));
  return Math.max(NODE_W, lanes.reduce((a, b) => a + b, 0) + LANE_GAP * (lanes.length - 1));
}

/** A stretch of line still waiting to learn which step it leads into, and its place on the way there. */
type Pending = { edge: LEdge; seq: number };
const nextSeq = (pending: Pending[]) => pending.reduce((m, p) => Math.max(m, p.seq + 1), 0);

export function layoutOf(steps: WorkflowStep[], { tail = true }: { tail?: boolean } = {}): Layout {
  const L: Layout = { nodes: new Map(), edges: new Map(), adds: new Map(), pills: new Map(), dots: new Map(), end: null, width: 0, height: 0 };
  const width = widthOf(steps) + PAD.x * 2;

  const line = (e: Omit<LEdge, "to" | "order">, pending: Pending[], seq = nextSeq(pending)) => {
    const edge: LEdge = { ...e, to: "end", order: seq };
    L.edges.set(edge.id, edge);
    pending.push({ edge, seq });
  };
  const resolve = (pending: Pending[], to: string) => {
    for (const p of pending) p.edge.to = to;
    pending.length = 0;
  };

  /** Lays a list down the line at x. `cur` is where the line arrives from; returns where it leaves. */
  function list(items: WorkflowStep[], id: string, x: number, cur: Pt | null, top: number, pending: Pending[], path?: string): Pt | null {
    items.forEach((s, i) => {
      const y = cur ? cur.y + EDGE : top;
      if (cur) {
        line({ id: `in:${s.id}`, kind: "line", a: cur, b: { x, y }, path }, pending);
        L.adds.set(`before:${s.id}`, { id: `before:${s.id}`, x, y: cur.y + EDGE / 2, at: { list: id, index: i }, after: items[i - 1]?.id });
      }
      L.nodes.set(s.id, { id: s.id, x: x - NODE_W / 2, y });
      resolve(pending, s.id);
      const bottom = y + NODE_H;
      if (!s.paths?.length) {
        cur = { x, y: bottom };
        return;
      }
      // A branch: the line drops, bends out to each lane, and every lane bends back below.
      const widths = s.paths.map((p) => widthOf(p.steps));
      const total = widths.reduce((a, b) => a + b, 0) + LANE_GAP * (widths.length - 1);
      let left = x - total / 2;
      const split = { x, y: bottom + STUB };
      L.dots.set(`split:${s.id}`, { id: `split:${s.id}`, ...split });
      const lanes = s.paths.map((p, j) => {
        const lx = left + widths[j] / 2;
        left += widths[j] + LANE_GAP;
        const own: Pending[] = [];
        const bend = { x: lx, y: split.y + CURVE };
        line({ id: `split:${p.id}`, kind: "split", a: { x, y: bottom }, b: bend, path: p.id }, own, 0);
        L.pills.set(p.id, { id: p.id, branch: s.id, x: lx, y: bend.y + PILL / 2 });
        const end = list(p.steps, p.id, lx, { x: lx, y: bend.y + PILL }, 0, own, p.id) ?? { x: lx, y: bend.y + PILL };
        return { p, lx, end, own };
      });
      const meet = Math.max(...lanes.map((l) => l.end.y)) + EDGE;
      const join = { x, y: meet + CURVE };
      for (const { p, lx, end, own } of lanes) {
        line({ id: `out:${p.id}`, kind: "line", a: end, b: { x: lx, y: meet }, path: p.id }, own);
        L.adds.set(`end:${p.id}`, { id: `end:${p.id}`, x: lx, y: end.y + EDGE / 2, at: { list: p.id, index: p.steps.length }, after: p.steps.at(-1)?.id });
        line({ id: `join:${p.id}`, kind: "merge", a: { x: lx, y: meet }, b: join, path: p.id }, own);
        pending.push(...own);
      }
      L.dots.set(`join:${s.id}`, { id: `join:${s.id}`, ...join });
      cur = join;
    });
    return cur;
  }

  const last = list(steps, ROOT, width / 2, null, PAD.y, [], undefined);
  let bottom = last?.y ?? PAD.y;
  if (tail) {
    const y = last ? last.y + EDGE : PAD.y;
    if (last) L.edges.set("tail", { id: "tail", kind: "tail", a: last, b: { x: width / 2, y }, to: "end", order: 0 });
    L.end = { id: "end", x: width / 2, y, at: { list: ROOT, index: steps.length }, after: steps.at(-1)?.id };
    bottom = y + END_H;
  }
  L.width = width;
  L.height = bottom + PAD.y;
  return L;
}

/** The SVG path for a stretch of line. Splits and merges bend on one smooth S. */
export function edgePath(kind: LEdge["kind"], a: Pt, b: Pt) {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (kind === "line" || kind === "tail") return `M${r(a.x)} ${r(a.y)}L${r(b.x)} ${r(b.y)}`;
  if (kind === "split") {
    const y0 = a.y + STUB;
    const m = (y0 + b.y) / 2;
    return `M${r(a.x)} ${r(a.y)}V${r(y0)}C${r(a.x)} ${r(m)} ${r(b.x)} ${r(m)} ${r(b.x)} ${r(b.y)}`;
  }
  const m = (a.y + b.y) / 2;
  return `M${r(a.x)} ${r(a.y)}C${r(a.x)} ${r(m)} ${r(b.x)} ${r(m)} ${r(b.x)} ${r(b.y)}`;
}
