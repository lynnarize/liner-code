/*
  Liner · Search field
  A quiet field that a key can reach from anywhere. While empty it shows its shortcut;
  once there is text the shortcut gives way to a clear button. Escape clears, then blurs.
*/
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "../../lib/field.css";
import "./search-field.css";

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "defaultValue" | "size" | "onSubmit"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** A key that focuses the field from anywhere on the page, like "/" or "k" (with ⌘). */
  shortcut?: string;
  /** With shortcut: require ⌘ (or Ctrl). */
  mod?: boolean;
  loading?: boolean;
  /** A count or note shown at the end, like "12 results". */
  meta?: string;
  size?: "sm" | "md" | "lg";
};

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, defaultValue = "", onValueChange, onSubmit, shortcut, mod, loading, meta, size = "md", className, placeholder = "Search", onKeyDown, ...rest },
  forwarded,
) {
  const ref = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwarded, () => ref.current as HTMLInputElement);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const text = controlled ? value : inner;
  const set = (v: string) => {
    if (!controlled) setInner(v);
    onValueChange?.(v);
  };

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== shortcut.toLowerCase() || !!mod !== (e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement;
      if (!mod && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, mod]);

  const mac = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);
  return (
    <div className={cx("l-in-box l-search", className)} data-size={size} role="search">
      <span className="l-in-icon l-search__icon" data-loading={loading || undefined} aria-hidden>
        {loading ? (
          <svg viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.6" />
            <path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7.2" cy="7.2" r="4.6" />
            <path d="m10.6 10.6 2.9 2.9" />
          </svg>
        )}
      </span>
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={rest["aria-label"] ?? placeholder}
        value={text}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (text) set("");
            else ref.current?.blur();
          } else if (e.key === "Enter") onSubmit?.(text);
          onKeyDown?.(e);
        }}
        {...rest}
      />
      {meta && text && (
        <span className="l-search__meta" key={meta} aria-live="polite">
          {meta}
        </span>
      )}
      {text ? (
        <button
          type="button"
          className="l-in-btn l-search__clear"
          aria-label="Clear search"
          onClick={() => {
            set("");
            feedback.play("tick");
            ref.current?.focus();
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="m4.5 4.5 7 7m0-7-7 7" />
          </svg>
        </button>
      ) : (
        shortcut && (
          <span className="l-search__keys" aria-hidden>
            {mod && <kbd className="l-kbd">{mac ? "⌘" : "Ctrl"}</kbd>}
            <kbd className="l-kbd">{shortcut.toUpperCase()}</kbd>
          </span>
        )
      )}
    </div>
  );
});
