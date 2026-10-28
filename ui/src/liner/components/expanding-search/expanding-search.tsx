/*
  Liner · Expanding search
  A search button that opens into a field where it stands. It grows toward the free side,
  takes focus, and folds back when it loses focus while empty.
*/
import { useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "../../lib/field.css";
import "./expanding-search.css";

export type ExpandingSearchProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** Open width in px. */
  width?: number;
  /** Grow to the left, for search at the end of a toolbar. */
  align?: "start" | "end";
  className?: string;
};

export function ExpandingSearch({ value, defaultValue = "", onValueChange, onSubmit, placeholder = "Search", width = 260, align = "start", className }: ExpandingSearchProps) {
  const [open, setOpen] = useState(false);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const text = controlled ? value : inner;
  const input = useRef<HTMLInputElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const set = (v: string) => {
    if (!controlled) setInner(v);
    onValueChange?.(v);
  };
  const expand = () => {
    setOpen(true);
    feedback.play("tap", 2);
    // Focus right away: the field is in the DOM, only narrow.
    input.current?.focus({ preventScroll: true });
  };
  return (
    <div
      className={cx("l-xsearch", className)}
      data-open={open || undefined}
      data-align={align}
      style={{ ["--xs-w" as string]: `${width}px` }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && !text) setOpen(false);
      }}
    >
      <button ref={btn} type="button" className="l-xsearch__btn" aria-label={placeholder} aria-expanded={open} tabIndex={open ? -1 : 0} onClick={expand}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <circle cx="7.2" cy="7.2" r="4.6" />
          <path d="m10.6 10.6 2.9 2.9" />
        </svg>
      </button>
      <input
        ref={input}
        type="search"
        className="l-xsearch__input"
        placeholder={placeholder}
        aria-label={placeholder}
        tabIndex={open ? 0 : -1}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (text) set("");
            else {
              setOpen(false);
              btn.current?.focus();
            }
          } else if (e.key === "Enter") onSubmit?.(text);
        }}
      />
      <button
        type="button"
        className="l-in-btn l-xsearch__clear"
        aria-label="Clear search"
        tabIndex={open && text ? 0 : -1}
        data-show={(open && text) || undefined}
        onClick={() => {
          set("");
          input.current?.focus();
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d="m4.5 4.5 7 7m0-7-7 7" />
        </svg>
      </button>
    </div>
  );
}
