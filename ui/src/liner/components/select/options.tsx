/*
  The option list Select, Combobox and Multi-select share: rows on one gliding highlight,
  optional group headings, the typed part of a label picked out, and a check for what is
  chosen (a box when several can be).
*/
import { Fragment, type ReactNode } from "react";
import type { useRoving } from "../../lib/overlay";
import "./options.css";

export type SelectOption = { value: string; label: string; hint?: string; icon?: ReactNode; group?: string; disabled?: boolean };

function Match({ text, query }: { text: string; query?: string }) {
  const q = query?.trim();
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="l-opt-match">{text.slice(at, at + q.length)}</b>
      {text.slice(at + q.length)}
    </>
  );
}

export function OptionList({
  id,
  options,
  nav,
  isSelected,
  onPick,
  query,
  multi,
  empty = "No matches",
  extra,
  label,
  maxHeight = 280,
}: {
  id: string;
  options: SelectOption[];
  nav: ReturnType<typeof useRoving>;
  isSelected: (value: string) => boolean;
  onPick: (index: number) => void;
  query?: string;
  multi?: boolean;
  empty?: ReactNode;
  /** A last row after the options, like "Create …"; it takes the index options.length. */
  extra?: ReactNode;
  label: string;
  maxHeight?: number;
}) {
  return (
    <div className="l-opts l-optlist" ref={nav.listRef} role="listbox" id={id} aria-label={label} aria-multiselectable={multi || undefined} style={{ maxHeight }}>
      {nav.hl && nav.active >= 0 && <span className="l-opt-hl" style={{ transform: `translateY(${nav.hl.y}px)`, height: nav.hl.h }} aria-hidden />}
      {options.map((o, i) => {
        const on = isSelected(o.value);
        const heading = o.group && o.group !== options[i - 1]?.group;
        return (
          <Fragment key={o.value}>
            {heading && (
              <div className="l-opt-group" role="presentation">
                {o.group}
              </div>
            )}
            <div
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={on}
              aria-disabled={o.disabled || undefined}
              className="l-opt"
              data-active={nav.active === i || undefined}
              onPointerMove={() => !o.disabled && nav.active !== i && nav.setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => !o.disabled && onPick(i)}
            >
              {multi && (
                <span className="l-optbox" data-on={on || undefined} aria-hidden>
                  <svg viewBox="0 0 16 16" fill="none">
                    <path d="M4 8.4 6.8 11 12 5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              {o.icon && <span className="l-opt-icon">{o.icon}</span>}
              <span className="l-opt-text">
                <span className="l-opt-label">
                  <Match text={o.label} query={query} />
                </span>
                {o.hint && <span className="l-opt-hint">{o.hint}</span>}
              </span>
              {!multi && on && (
                <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-opt-check">
                  <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </Fragment>
        );
      })}
      {extra}
      {!options.length && !extra && <div className="l-optlist-empty">{empty}</div>}
    </div>
  );
}
