/*
  What the inspector edits: the selected nodes, read whole (the store keeps the first fresh; the
  others are read through the bridge here), the first one's parent (whose flow decides how "Fill"
  is written), the frame's custom properties and the lean. A value shown is the one every selected
  node shares, else "mixed"; a change goes to each of them, through design.apply, with one
  coalesce key per gesture so a drag is one undo step.
*/
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FrameOp, LeanTokens, NodeRead, TreeNode } from "@contracts";
import { frames } from "../bridge";
import { design, useDesign, type Sel } from "../store";
import { useFrameVars, useLean, type FrameVars } from "../lean";

export type Style = Record<string, string | null>;

export type Target = {
  frame: string;
  node: NodeRead;
  /** Every selected node, the first included. */
  all: { frame: string; node: NodeRead }[];
  parent?: NodeRead;
  vars: FrameVars;
  lean?: LeanTokens;
  /** A computed value every selected node shares, else undefined. */
  value: (prop: string) => string | undefined;
  /** An inline value every selected node shares, else undefined. */
  inline: (prop: string) => string | undefined;
  /** The nodes differ on this computed property. */
  mixed: (prop: string) => boolean;
  /** Writes inline styles on every selected node; `key` makes one gesture one undo step. */
  set: (style: Style | ((n: NodeRead) => Style), key?: string) => void;
  /** Any ops, made per node. */
  ops: (make: (n: NodeRead) => FrameOp[], key?: string) => void;
};

// The last change made in Style, so the Code tab can mark its line.
let last: { id: string; props: string[]; at: number } | undefined;
const lastFns = new Set<() => void>();
export const useLastChange = () => useSyncExternalStore((f) => (lastFns.add(f), () => void lastFns.delete(f)), () => last);
const noteChange = (id: string, props: string[]) => {
  last = { id, props, at: Date.now() };
  lastFns.forEach((f) => f());
};

const parentIn = (root: TreeNode | undefined, id: string): TreeNode | undefined => {
  if (!root) return undefined;
  for (const c of root.children) {
    if (c.id === id) return root;
    const p = parentIn(c, id);
    if (p) return p;
  }
  return undefined;
};

let keys = 0;
/** A coalesce key for one press (a fresh one each time). */
export const once = (what: string) => `${what}:${++keys}`;

/** The inspector's target, or undefined with no node selected. */
export function useTarget(): Target | undefined {
  const node = useDesign((s) => s.node);
  const sel = useDesign((s) => s.sel);
  const first = sel.find((x) => x.node);
  const frame = first?.frame;
  const tree = useDesign((s) => (frame ? s.tree[frame] : undefined));
  const vars = useFrameVars(frame);
  const lean = useLean()?.tokens;
  const others = useOthers(sel, node);
  const parentRef = node && tree ? parentIn(tree, node.id) : undefined;
  const parent = useRead(frame, parentRef?.id, node);

  useEffect(() => {
    if (frame && !tree) void design.refreshTree(frame);
  }, [frame, tree]);

  return useMemo(() => {
    if (!node || !frame || node.id !== first?.node || !node.computed) return undefined;
    // Only nodes read whole: a selected layer that went away is left out, never read.
    const all = [{ frame, node }, ...others.filter((x) => x.node?.computed)];
    const pick = (get: (n: NodeRead) => string | undefined) => {
      const v = get(node);
      return all.every((x) => get(x.node) === v) ? v : undefined;
    };
    const ops = (make: (n: NodeRead) => FrameOp[], key?: string) => {
      const byFrame = new Map<string, FrameOp[]>();
      for (const x of all) byFrame.set(x.frame, [...(byFrame.get(x.frame) ?? []), ...make(x.node)]);
      for (const [f, list] of byFrame) if (list.length) void design.apply(f, list, key ? { coalesce: key } : undefined);
    };
    const set = (style: Style | ((n: NodeRead) => Style), key?: string) => {
      let props: string[] = [];
      ops((n) => {
        const s = typeof style === "function" ? style(n) : style;
        if (n === node) props = Object.keys(s);
        return Object.keys(s).length ? [{ id: n.id, style: s }] : [];
      }, key);
      noteChange(node.id, props);
    };
    return {
      frame,
      node,
      all,
      parent,
      vars,
      lean,
      value: (p) => pick((n) => n.computed[p]),
      inline: (p) => pick((n) => n.inline[p]),
      mixed: (p) => all.some((x) => x.node.computed[p] !== node.computed[p]),
      set,
      ops,
    } satisfies Target;
  }, [node, frame, first?.node, others, parent, vars, lean]);
}

/** The other selected nodes, read whole; again whenever the first one changes (an edit went to all). */
function useOthers(sel: Sel[], node: NodeRead | undefined) {
  const [others, setOthers] = useState<{ frame: string; node: NodeRead }[]>([]);
  const rest = sel.filter((x) => x.node).slice(1);
  const want = rest.map((x) => `${x.frame}/${x.node}`).join(" ");
  useEffect(() => {
    if (!rest.length) return setOthers((o) => (o.length ? [] : o));
    let live = true;
    void Promise.all(rest.map((x) => frames.read(x.frame, x.node!).then((n) => ({ frame: x.frame, node: n })).catch(() => undefined))).then((list) => {
      if (live) setOthers(list.filter((x): x is { frame: string; node: NodeRead } => Boolean(x)));
    });
    return () => void (live = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, node]);
  return others;
}

/** One node read through the bridge (the parent), again when `again` changes. */
function useRead(frame: string | undefined, id: string | undefined, again: unknown) {
  const [read, setRead] = useState<NodeRead | undefined>();
  useEffect(() => {
    if (!frame || !id) return setRead(undefined);
    let live = true;
    frames.read(frame, id).then((n) => live && setRead(n)).catch(() => live && setRead(undefined));
    return () => void (live = false);
  }, [frame, id, again]);
  return read;
}
