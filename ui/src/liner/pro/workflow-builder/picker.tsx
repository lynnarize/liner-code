/*
  The add menu: glass that opens from a + on the line. Typing narrows the steps and picks
  out the letters that match; one highlight glides between them, and Enter adds the one
  under it where the + was.
*/
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useDismiss, useRoving } from "../../lib/overlay";
import { AiMark } from "../ai-kit/marks";
import { Glyph, Icon } from "./glyphs";
import type { WorkflowTemplate } from "./model";

type Entry = { type: "label"; id: string; label: string } | { type: "item"; id: string; t: WorkflowTemplate };

function Match({ text, q }: { text: string; q: string }) {
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b>{text.slice(at, at + q.length)}</b>
      {text.slice(at + q.length)}
    </>
  );
}

export type StepPickerProps = {
  templates: WorkflowTemplate[];
  /** Names the menu: “Add a step after Understand the request”. */
  title: string;
  /** Where it opens in the canvas: its left edge, and its top (or bottom, opening upward). */
  x: number;
  y: number;
  side: "top" | "bottom";
  /** The +'s distance from the left edge, so the menu grows out of it. */
  origin: number;
  /** The tallest the list can be in the room it has. */
  max: number;
  onPick: (t: WorkflowTemplate) => void;
  onClose: () => void;
};

export function StepPicker({ templates, title, x, y, side, origin, max, onPick, onClose }: StepPickerProps) {
  const id = useId().replace(/:/g, "");
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const query = q.trim().toLowerCase();
  const entries = useMemo(() => {
    const hits = templates.filter((t) => !query || `${t.name} ${t.hint ?? ""} ${t.group}`.toLowerCase().includes(query));
    const out: Entry[] = [];
    let group = "";
    for (const t of hits) {
      if (t.group !== group) {
        group = t.group;
        out.push({ type: "label", id: `g-${group}`, label: group });
      }
      out.push({ type: "item", id: t.type, t });
    }
    return out;
  }, [query, templates]);
  const first = entries.findIndex((e) => e.type === "item");
  const nav = useRoving({
    count: entries.length,
    skip: (i) => entries[i]?.type !== "item",
    onPick: (i) => {
      const e = entries[i];
      if (e?.type === "item") onPick(e.t);
    },
    onEscape: onClose,
    initial: first,
  });
  // A new query starts the highlight on its first match.
  useEffect(() => {
    nav.setActive(first);
  }, [query]);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useDismiss(true, onClose, [panel]);

  // The field keeps the caret; only the keys that move or choose go to the list.
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") nav.onKeyDown(e);
    else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={panel}
      className="l-pop l-wf-pick"
      data-wf-hit=""
      data-side={side}
      role="dialog"
      aria-label={title}
      style={{ left: x, top: side === "bottom" ? y : "auto", bottom: side === "top" ? y : "auto", "--origin-x": `${origin}px`, "--pick-max": `${max}px` } as CSSProperties}
    >
      <label className="l-wf-pick__find">
        <Icon.search />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={keys}
          placeholder="Find a step"
          role="combobox"
          aria-label="Find a step"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={nav.active >= 0 && entries[nav.active]?.type === "item" ? `${id}-${nav.active}` : undefined}
        />
      </label>
      <div className="l-opts l-wf-pick__list" ref={nav.listRef} role="listbox" id={`${id}-list`} aria-label="Steps you can add">
        {nav.hl && entries.length > 0 && <span className="l-opt-hl" style={{ transform: `translateY(${nav.hl.y}px)`, height: nav.hl.h }} aria-hidden />}
        {entries.map((e, i) =>
          e.type === "label" ? (
            <div key={e.id} className="l-opt-group" role="presentation">
              {e.label}
            </div>
          ) : (
            <div
              key={e.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={nav.active === i}
              data-index={i}
              className="l-opt"
              data-active={nav.active === i || undefined}
              onPointerMove={() => nav.active !== i && nav.setActive(i)}
              onClick={() => onPick(e.t)}
            >
              <span className="l-wf-pick__glyph" data-kind={e.t.kind} aria-hidden>
                {e.t.kind === "ai" ? <AiMark size={16} /> : <Glyph name={e.t.glyph} kind={e.t.kind} />}
              </span>
              <span className="l-opt-text">
                <span className="l-opt-label">
                  <Match text={e.t.name} q={query} />
                </span>
                {e.t.hint && <span className="l-opt-hint">{e.t.hint}</span>}
              </span>
            </div>
          ),
        )}
        {!entries.length && <p className="l-wf-pick__none">Nothing matches “{q.trim()}”. Try “wait” or “email”.</p>}
      </div>
    </div>
  );
}
