/*
  Liner · Data grid
  A spreadsheet's feel in a small part: one active cell you move with the arrows, typing to
  replace, Enter to edit and confirm, Tab across, Escape to back out. Columns resize from
  their edge, and number columns total themselves at the bottom.
*/
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./data-grid.css";

export type GridColumn = { key: string; header: string; type?: "text" | "number"; width?: number; format?: (v: number) => string };
export type GridRow = Record<string, string | number>;
export type DataGridProps = {
  columns: GridColumn[];
  rows: GridRow[];
  onRowsChange?: (rows: GridRow[]) => void;
  label: string;
  className?: string;
};

export function DataGrid({ columns, rows: initial, onRowsChange, label, className }: DataGridProps) {
  const [rows, setRows] = useState(initial);
  const [at, setAt] = useState({ r: 0, c: 0 });
  const [edit, setEdit] = useState<{ value: string } | null>(null);
  const [widths, setWidths] = useState(() => columns.map((c) => c.width ?? 140));
  const grid = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Focus follows the active cell only once someone is using the grid, never on load.
  const engaged = useRef(false);
  const fmt = (c: GridColumn, v: string | number) => (c.type === "number" && typeof v === "number" ? (c.format ?? ((n: number) => n.toLocaleString("en-US")))(v) : String(v ?? ""));

  useEffect(() => {
    if (!engaged.current) return;
    if (edit) input.current?.focus();
    else grid.current?.querySelector<HTMLElement>(`[data-cell="${at.r}-${at.c}"]`)?.focus({ preventScroll: false });
  }, [at, !!edit]);

  const commit = (move?: { dr: number; dc: number }) => {
    if (edit) {
      const col = columns[at.c];
      const raw = edit.value.trim();
      const v = col.type === "number" ? Number(raw.replace(/[^\d.-]/g, "")) || 0 : raw;
      const next = rows.map((row, i) => (i === at.r ? { ...row, [col.key]: v } : row));
      setRows(next);
      onRowsChange?.(next);
      setEdit(null);
      feedback.play("tick", 3);
    }
    if (move) setAt((p) => ({ r: Math.max(0, Math.min(rows.length - 1, p.r + move.dr)), c: Math.max(0, Math.min(columns.length - 1, p.c + move.dc)) }));
  };

  const onKey = (e: KeyboardEvent) => {
    if (edit) {
      if (e.key === "Enter") {
        e.preventDefault();
        commit({ dr: e.shiftKey ? -1 : 1, dc: 0 });
      } else if (e.key === "Tab") {
        e.preventDefault();
        commit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEdit(null);
      }
      return;
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      commit({ dr: moves[e.key][0], dc: moves[e.key][1] });
    } else if (e.key === "Tab") {
      if ((e.shiftKey && at.c === 0) || (!e.shiftKey && at.c === columns.length - 1)) return;
      e.preventDefault();
      commit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setEdit({ value: String(rows[at.r][columns[at.c].key] ?? "") });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const col = columns[at.c];
      const next = rows.map((row, i) => (i === at.r ? { ...row, [col.key]: col.type === "number" ? 0 : "" } : row));
      setRows(next);
      onRowsChange?.(next);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typing replaces the cell, like a spreadsheet.
      e.preventDefault();
      setEdit({ value: e.key });
    }
  };

  // The last column takes any room left, so the rows always reach the frame's edge (and its
  // corners); its width stays the floor, so a narrow grid still scrolls.
  const template = `44px ${widths.map((w, i) => (i === widths.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`)).join(" ")}`;
  return (
    <div className={cx("l-grid l-frame-solo", className)}>
      <div ref={grid} className="l-grid__scroll" role="grid" aria-label={label} aria-rowcount={rows.length + 1} aria-colcount={columns.length} onKeyDown={onKey} onPointerDown={() => (engaged.current = true)} onFocus={() => (engaged.current = true)}>
        <div className="l-grid__row l-grid__head" role="row" style={{ gridTemplateColumns: template }}>
          <span className="l-grid__corner" aria-hidden />
          {columns.map((c, i) => (
            <div key={c.key} role="columnheader" className="l-grid__th" data-type={c.type}>
              {c.header}
              <span
                className="l-grid__resize"
                aria-hidden
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const x = e.clientX;
                  const w0 = widths[i];
                  const move = (ev: PointerEvent) => setWidths((ws) => ws.map((w, k) => (k === i ? Math.max(70, w0 + ev.clientX - x) : w)));
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                onDoubleClick={() => setWidths((ws) => ws.map((w, k) => (k === i ? (columns[i].width ?? 140) : w)))}
              />
            </div>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={r} className="l-grid__row" role="row" aria-rowindex={r + 2} style={{ gridTemplateColumns: template }}>
            <span className="l-grid__num" aria-hidden>
              {r + 1}
            </span>
            {columns.map((c, ci) => {
              const active = at.r === r && at.c === ci;
              return (
                <div
                  key={c.key}
                  role="gridcell"
                  tabIndex={active && !edit ? 0 : -1}
                  data-cell={`${r}-${ci}`}
                  data-active={active || undefined}
                  data-type={c.type}
                  aria-selected={active}
                  className="l-grid__cell"
                  onPointerDown={() => {
                    if (!active) commit();
                    setAt({ r, c: ci });
                  }}
                  onDoubleClick={() => setEdit({ value: String(row[c.key] ?? "") })}
                >
                  {active && edit ? (
                    <input ref={input} className="l-grid__input" aria-label={`${c.header}, row ${r + 1}`} value={edit.value} onChange={(e) => setEdit({ value: e.target.value })} onBlur={() => commit()} />
                  ) : (
                    <span>{fmt(c, row[c.key])}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div className="l-grid__row l-grid__foot" role="row" style={{ gridTemplateColumns: template }}>
          <span className="l-grid__num" aria-hidden>
            Σ
          </span>
          {columns.map((c) => (
            <div key={c.key} role="gridcell" className="l-grid__cell" data-type={c.type}>
              {c.type === "number" ? <b key={rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)}>{fmt(c, rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0))}</b> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
