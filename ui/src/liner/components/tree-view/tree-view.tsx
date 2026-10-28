/*
  Liner · Tree view
  Nested things, like files. Branches open in place with their children growing in, faint
  guides show what belongs where, and the keyboard works as in any file browser: up and
  down to move, right to open, left to close or go to the parent.
*/
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./tree-view.css";

export type TreeNode = { id: string; label: string; icon?: ReactNode; meta?: string; children?: TreeNode[] };
export type TreeViewProps = {
  nodes: TreeNode[];
  label: string;
  defaultExpanded?: string[];
  selected?: string | null;
  onSelect?: (node: TreeNode) => void;
  className?: string;
};

type Flat = { node: TreeNode; level: number; parent: string | null };

const FOLDER = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5Z" />
  </svg>
);
const FILE = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="M4 2.5h5l3 3v8H4v-11Z" />
    <path d="M9 2.5v3h3" />
  </svg>
);

export function TreeView({ nodes, label, defaultExpanded = [], selected: selProp, onSelect, className }: TreeViewProps) {
  const [open, setOpen] = useState(new Set(defaultExpanded));
  const [innerSel, setInnerSel] = useState<string | null>(null);
  const selected = selProp !== undefined ? selProp : innerSel;
  const [focus, setFocus] = useState(nodes[0]?.id);
  const root = useRef<HTMLUListElement>(null);
  const typed = useRef({ q: "", at: 0 });

  // The rows a person can currently see, in order, for the keyboard.
  const visible = useMemo(() => {
    const out: Flat[] = [];
    const walk = (list: TreeNode[], level: number, parent: string | null) =>
      list.forEach((n) => {
        out.push({ node: n, level, parent });
        if (n.children && open.has(n.id)) walk(n.children, level + 1, n.id);
      });
    walk(nodes, 1, null);
    return out;
  }, [nodes, open]);

  const toggle = (id: string, to?: boolean) => {
    setOpen((s) => {
      const n = new Set(s);
      const want = to ?? !n.has(id);
      if (want) n.add(id);
      else n.delete(id);
      return n;
    });
    feedback.play("tick", 2);
  };
  const move = (id: string) => {
    setFocus(id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());
  };
  const pick = (n: TreeNode) => {
    if (selProp === undefined) setInnerSel(n.id);
    onSelect?.(n);
  };

  const onKey = (e: KeyboardEvent) => {
    const i = visible.findIndex((v) => v.node.id === focus);
    const cur = visible[i];
    if (!cur) return;
    const has = !!cur.node.children?.length;
    if (e.key === "ArrowDown") visible[i + 1] && move(visible[i + 1].node.id);
    else if (e.key === "ArrowUp") visible[i - 1] && move(visible[i - 1].node.id);
    else if (e.key === "ArrowRight") {
      if (has && !open.has(cur.node.id)) toggle(cur.node.id, true);
      else if (has) move(cur.node.children![0].id);
    } else if (e.key === "ArrowLeft") {
      if (has && open.has(cur.node.id)) toggle(cur.node.id, false);
      else if (cur.parent) move(cur.parent);
    } else if (e.key === "Home") move(visible[0].node.id);
    else if (e.key === "End") move(visible[visible.length - 1].node.id);
    else if (e.key === "Enter" || e.key === " ") {
      pick(cur.node);
      if (has) toggle(cur.node.id);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = performance.now();
      const q = (now - typed.current.at < 600 ? typed.current.q : "") + e.key.toLowerCase();
      typed.current = { q, at: now };
      const hit = [...visible.slice(i + (q.length === 1 ? 1 : 0)), ...visible].find((v) => v.node.label.toLowerCase().startsWith(q));
      if (hit) move(hit.node.id);
    } else return;
    e.preventDefault();
  };

  const render = (list: TreeNode[], level: number): ReactNode =>
    list.map((n, i) => {
      const has = !!n.children?.length;
      const isOpen = open.has(n.id);
      return (
        <li
          key={n.id}
          role="treeitem"
          aria-level={level}
          aria-setsize={list.length}
          aria-posinset={i + 1}
          aria-expanded={has ? isOpen : undefined}
          aria-selected={selected === n.id}
          className="l-tree__item"
          data-open={isOpen || undefined}
        >
          <div
            className="l-tree__row"
            data-id={n.id}
            data-selected={selected === n.id || undefined}
            tabIndex={focus === n.id ? 0 : -1}
            style={{ ["--level" as string]: level - 1 }}
            onFocus={() => setFocus(n.id)}
            onClick={() => {
              setFocus(n.id);
              pick(n);
              if (has) toggle(n.id);
            }}
          >
            <span className="l-tree__chev" aria-hidden data-hidden={!has || undefined}>
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="l-tree__icon">{n.icon ?? (has ? FOLDER : FILE)}</span>
            <span className="l-tree__label">{n.label}</span>
            {n.meta && <span className="l-tree__meta">{n.meta}</span>}
          </div>
          {has && (
            <div className="l-tree__kids">
              <ul role="group" className="l-tree__group" style={{ ["--level" as string]: level - 1 }} inert={!isOpen || undefined}>
                {render(n.children!, level + 1)}
              </ul>
            </div>
          )}
        </li>
      );
    });

  return (
    <ul ref={root} className={cx("l-tree", className)} role="tree" aria-label={label} onKeyDown={onKey}>
      {render(nodes, 1)}
    </ul>
  );
}
