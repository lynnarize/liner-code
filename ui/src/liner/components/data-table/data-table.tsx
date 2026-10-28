/*
  Liner · Data table
  Rows people compare. Press a header to sort (ascending, descending, then back to the
  original order) and the rows slide to their new places instead of jumping. Numbers align
  on the right in even figures; selection is a box per row with a header box for all.
*/
import { useMemo, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useFlip } from "../../lib/flip";
import "./data-table.css";

export type Column<T> = {
  key: string;
  header: string;
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  width?: string;
};
export type Sort = { key: string; dir: "asc" | "desc" } | null;
export type DataTableProps<T> = {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => string;
  caption: string;
  selectable?: boolean;
  onSelectionChange?: (keys: string[]) => void;
  defaultSort?: Sort;
  empty?: ReactNode;
  className?: string;
};

function Box({ state, label, onToggle }: { state: boolean | "mixed"; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={state} aria-label={label} className="l-table__box" data-state={String(state)} onClick={onToggle}>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        {state === "mixed" ? <path d="M4.5 8h7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /> : <path d="M4 8.4 6.8 11 12 5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </button>
  );
}

export function DataTable<T>({ rows, columns, getKey, caption, selectable, onSelectionChange, defaultSort = null, empty = "Nothing here yet", className }: DataTableProps<T>) {
  const [sort, setSort] = useState<Sort>(defaultSort);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const out = [...rows].sort((a, b) => {
      const x = col.value(a);
      const y = col.value(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === "asc" ? r : -r;
    });
    return out;
  }, [rows, columns, sort]);
  const flip = useFlip<HTMLTableSectionElement>([sorted]);

  const cycle = (key: string) => {
    flip.capture();
    setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
    feedback.play("tick", 3);
  };
  const setSelection = (next: Set<string>) => {
    setSel(next);
    onSelectionChange?.([...next]);
  };
  const all = rows.length > 0 && sel.size === rows.length ? true : sel.size ? "mixed" : false;

  return (
    <div className={cx("l-table l-frame-solo", className)}>
      <div className="l-table__scroll">
        <table>
          <caption className="l-table__caption">{caption}</caption>
          <thead>
            <tr>
              {selectable && (
                <th className="l-table__check" scope="col">
                  <Box state={all} label="Select all rows" onToggle={() => setSelection(all === true ? new Set() : new Set(rows.map(getKey)))} />
                </th>
              )}
              {columns.map((c) => {
                const on = sort?.key === c.key ? sort.dir : undefined;
                return (
                  <th key={c.key} scope="col" data-align={c.align} style={{ width: c.width }} aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : undefined}>
                    {c.sortable === false ? (
                      c.header
                    ) : (
                      <button type="button" className="l-table__sort" data-dir={on} onClick={() => cycle(c.key)}>
                        {c.header}
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M8 3.5v9m0 0-3-3m3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={flip.root}>
            {sorted.map((r) => {
              const k = getKey(r);
              const on = sel.has(k);
              return (
                <tr key={k} data-flip={k} data-selected={on || undefined}>
                  {selectable && (
                    <td className="l-table__check">
                      <Box
                        state={on}
                        label={`Select ${String(columns[0].value(r))}`}
                        onToggle={() => {
                          const next = new Set(sel);
                          if (on) next.delete(k);
                          else next.add(k);
                          setSelection(next);
                        }}
                      />
                    </td>
                  )}
                  {columns.map((c, i) => {
                    const Cell = i === 0 ? "th" : "td";
                    return (
                      <Cell key={c.key} scope={i === 0 ? "row" : undefined} data-align={c.align}>
                        {c.render ? c.render(r) : c.value(r)}
                      </Cell>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="l-table__empty">{empty}</div>}
      </div>
      {selectable && sel.size > 0 && (
        <div className="l-table__bar" role="status" key={sel.size}>
          {sel.size} selected
          <button type="button" onClick={() => setSelection(new Set())}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
