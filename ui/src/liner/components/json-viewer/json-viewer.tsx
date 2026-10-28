/*
  Liner · JSON viewer
  Data you can fold. Objects and arrays open and close in place and say how much they hold
  when closed; values read by type, and pressing a key copies its path, like user.plan.seats.
*/
import { useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./json-viewer.css";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonViewerProps = {
  data: Json;
  /** Levels open at first. */
  depth?: number;
  rootLabel?: string;
  className?: string;
};

const pathOf = (parts: (string | number)[]) => parts.reduce<string>((p, k) => (typeof k === "number" ? `${p}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? (p ? `${p}.${k}` : k) : `${p}[${JSON.stringify(k)}]`), "");

function Value({ v }: { v: Json }) {
  if (v === null) return <span className="l-json__null">null</span>;
  if (typeof v === "string") return <span className="l-json__str">"{v}"</span>;
  if (typeof v === "number") return <span className="l-json__num">{v}</span>;
  if (typeof v === "boolean") return <span className="l-json__bool">{String(v)}</span>;
  return null;
}

function Node({ k, v, path, depth, open: initial, onCopy, last }: { k?: string | number; v: Json; path: (string | number)[]; depth: number; open: number; onCopy: (p: string) => void; last: boolean }) {
  const isObj = v !== null && typeof v === "object";
  const [open, setOpen] = useState(depth < initial);
  const entries: [string | number, Json][] = isObj ? (Array.isArray(v) ? v.map((x, i) => [i, x] as [number, Json]) : Object.entries(v)) : [];
  const [o, c] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  const key: ReactNode =
    k !== undefined ? (
      <button
        type="button"
        className="l-json__key"
        data-index={typeof k === "number" || undefined}
        title="Copy path"
        onClick={(e) => {
          e.stopPropagation();
          onCopy(pathOf(path));
        }}
      >
        {typeof k === "number" ? k : `"${k}"`}
      </button>
    ) : null;
  if (!isObj)
    return (
      <div className="l-json__row" style={{ ["--d" as string]: depth }}>
        <span className="l-json__twist" aria-hidden />
        {key}
        {key && <span className="l-json__p">: </span>}
        <Value v={v} />
        {!last && <span className="l-json__p">,</span>}
      </div>
    );
  return (
    <div className="l-json__node" data-open={open || undefined}>
      <div className="l-json__row" style={{ ["--d" as string]: depth }} role="treeitem" aria-expanded={open} aria-level={depth + 1}>
        <button type="button" className="l-json__twist" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((x) => !x)}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {key}
        {key && <span className="l-json__p">: </span>}
        <span className="l-json__p">{o}</span>
        {!open && (
          <button type="button" className="l-json__more" onClick={() => setOpen(true)}>
            {entries.length} {Array.isArray(v) ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"}
          </button>
        )}
        {!open && (
          <span className="l-json__p">
            {c}
            {!last && ","}
          </span>
        )}
      </div>
      {open && (
        <div className="l-json__kids" role="group">
          {entries.map(([ck, cv], i) => (
            <Node key={String(ck)} k={ck} v={cv} path={[...path, ck]} depth={depth + 1} open={initial} onCopy={onCopy} last={i === entries.length - 1} />
          ))}
          <div className="l-json__row" style={{ ["--d" as string]: depth }}>
            <span className="l-json__twist" aria-hidden />
            <span className="l-json__p">
              {c}
              {!last && ","}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function JsonViewer({ data, depth = 2, rootLabel, className }: JsonViewerProps) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className={cx("l-json l-frame-solo", className)}>
      <div className="l-json__scroll" role="tree" aria-label={rootLabel ?? "JSON"}>
        <Node v={data} path={[]} depth={0} open={depth} last onCopy={(p) => {
          navigator.clipboard?.writeText(p).catch(() => undefined);
          setCopied(p);
          feedback.play("tick", 4);
          window.setTimeout(() => setCopied((c) => (c === p ? null : c)), 1600);
        }} />
      </div>
      {copied && (
        <div className="l-json__toast l-glass" role="status" key={copied}>
          Copied <code>{copied}</code>
        </div>
      )}
    </div>
  );
}
