/*
  The Files surface's tree: Liner's tree view in look and keys (its classes and its stylesheet), drawing only the rows
  that can be seen (treeRows.ts). A shut folder holds nothing on the page until it is opened, and a list longer than
  TREE_ROWS ends in "Show more". Opening a folder shows what it holds at once: there is nothing on the page beforehand
  to grow from.
*/
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { feedback } from "@liner/lib/feedback";
import "@liner/components/tree-view/tree-view.css";
import { TREE_ROWS, treeRows, type TreeNode } from "./treeRows";

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

export function FileTree({ nodes, label, defaultExpanded = [], selected, onSelect }: { nodes: TreeNode[]; label: string; defaultExpanded?: string[]; selected: string | null; onSelect: (node: TreeNode) => void }) {
  const [open, setOpen] = useState(new Set(defaultExpanded));
  const [limit, setLimit] = useState(TREE_ROWS);
  const [focus, setFocus] = useState(nodes[0]?.id);
  const root = useRef<HTMLUListElement>(null);
  const typed = useRef({ q: "", at: 0 });

  // The rows a person can see, in order: what is drawn, and what the keyboard moves through.
  const { rows, more } = useMemo(() => treeRows(nodes, open, limit), [nodes, open, limit]);
  const shown = useMemo(() => new Set(rows.map((r) => r.node.id)), [rows]);

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

  const onKey = (e: KeyboardEvent) => {
    const i = rows.findIndex((v) => v.node.id === focus);
    const cur = rows[i];
    if (!cur) return;
    const has = !!cur.node.children?.length;
    if (e.key === "ArrowDown") rows[i + 1] && move(rows[i + 1].node.id);
    else if (e.key === "ArrowUp") rows[i - 1] && move(rows[i - 1].node.id);
    else if (e.key === "ArrowRight") {
      if (has && !open.has(cur.node.id)) toggle(cur.node.id, true);
      else if (has) move(cur.node.children![0].id);
    } else if (e.key === "ArrowLeft") {
      if (has && open.has(cur.node.id)) toggle(cur.node.id, false);
      else if (cur.parent) move(cur.parent);
    } else if (e.key === "Home") move(rows[0].node.id);
    else if (e.key === "End") move(rows[rows.length - 1].node.id);
    else if (e.key === "Enter" || e.key === " ") {
      onSelect(cur.node);
      if (has) toggle(cur.node.id);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = performance.now();
      const q = (now - typed.current.at < 600 ? typed.current.q : "") + e.key.toLowerCase();
      typed.current = { q, at: now };
      const hit = [...rows.slice(i + (q.length === 1 ? 1 : 0)), ...rows].find((v) => v.node.label.toLowerCase().startsWith(q));
      if (hit) move(hit.node.id);
    } else return;
    e.preventDefault();
  };

  const render = (list: TreeNode[], level: number): ReactNode =>
    list.map((n, i) => {
      // Past the rows drawn this time: "Show more" brings them.
      if (!shown.has(n.id)) return null;
      const has = !!n.children?.length;
      const isOpen = open.has(n.id);
      return (
        <li key={n.id} role="treeitem" aria-level={level} aria-setsize={list.length} aria-posinset={i + 1} aria-expanded={has ? isOpen : undefined} aria-selected={selected === n.id} className="l-tree__item" data-open={isOpen || undefined}>
          <div
            className="l-tree__row"
            data-id={n.id}
            data-selected={selected === n.id || undefined}
            tabIndex={focus === n.id ? 0 : -1}
            style={{ ["--level" as string]: level - 1 }}
            onFocus={() => setFocus(n.id)}
            onClick={() => {
              setFocus(n.id);
              onSelect(n);
              if (has) toggle(n.id);
            }}
          >
            <span className="l-tree__chev" aria-hidden data-hidden={!has || undefined}>
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="l-tree__icon">{has ? FOLDER : FILE}</span>
            <span className="l-tree__label">{n.label}</span>
            {n.meta && <span className="l-tree__meta">{n.meta}</span>}
          </div>
          {/* What a folder holds is on the page only while it is open. */}
          {has && isOpen && (
            <div className="l-tree__kids">
              <ul role="group" className="l-tree__group" style={{ ["--level" as string]: level - 1 }}>
                {render(n.children!, level + 1)}
              </ul>
            </div>
          )}
        </li>
      );
    });

  return (
    <>
      <ul ref={root} className="l-tree" role="tree" aria-label={label} onKeyDown={onKey}>
        {render(nodes, 1)}
      </ul>
      {more > 0 && (
        <button type="button" className="lc-files-more l-focus" onClick={() => setLimit((n) => n + TREE_ROWS)}>
          Show {Math.min(more, TREE_ROWS).toLocaleString()} more <span className="lc-quiet">of {more.toLocaleString()}</span>
        </button>
      )}
    </>
  );
}
