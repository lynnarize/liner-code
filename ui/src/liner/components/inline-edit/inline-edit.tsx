/*
  Liner · Inline edit
  Text that becomes a field where it stands. The field is exactly as wide as the words,
  so nothing jumps. Enter or leaving saves, Escape puts it back. A save can be async and
  can refuse: return a message and the field stays open with it.
*/
import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "../../lib/field.css";
import "./inline-edit.css";

export type InlineEditProps = {
  value?: string;
  defaultValue?: string;
  /** Return (or resolve to) a message to refuse the change. */
  onSave?: (next: string) => void | string | null | Promise<void | string | null>;
  /** Names the field for assistive tech, like "Project name". */
  label: string;
  placeholder?: string;
  size?: "md" | "lg";
  /** Reject an empty value. */
  required?: boolean;
  className?: string;
};

export function InlineEdit({ value, defaultValue = "", onSave, label, placeholder = "Untitled", size = "md", required = true, className }: InlineEditProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const saved = controlled ? value : inner;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const view = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  // Set while saving or closing, so the blur that follows Enter or Escape does nothing.
  const settling = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(() => setState("idle"), 1400);
    return () => window.clearTimeout(t);
  }, [state]);

  const open = () => {
    settling.current = false;
    setDraft(saved);
    setError(null);
    setEditing(true);
  };
  const close = (refocus: boolean) => {
    settling.current = true;
    setEditing(false);
    setError(null);
    if (refocus) requestAnimationFrame(() => view.current?.focus());
  };
  const refuse = (msg: string) => {
    settling.current = false;
    setError(msg);
    setState("idle");
    feedback.play("error");
    box.current?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], { duration: 300, easing: "ease-out" });
    input.current?.focus();
  };
  const commit = async (refocus: boolean) => {
    if (settling.current) return;
    settling.current = true;
    const next = draft.trim();
    if (next === saved) return close(refocus);
    if (required && !next) return refuse("Can't be empty");
    setState("saving");
    const res = await onSave?.(next);
    if (typeof res === "string" && res) return refuse(res);
    if (!controlled) setInner(next);
    setState("done");
    feedback.play("success");
    close(refocus);
  };

  if (!editing)
    return (
      <span className={cx("l-iedit", className)} data-size={size}>
        <button ref={view} type="button" className="l-iedit__view" data-empty={!saved || undefined} aria-label={`${label}: ${saved || "empty"}. Edit`} onClick={open}>
          <span className="l-iedit__text" key={saved}>
            {saved || placeholder}
          </span>
          <span className="l-iedit__mark" data-state={state} aria-hidden>
            {state === "done" ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.6 8.4 6.6 11.3 12.4 5" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.2 3.3a1.6 1.6 0 0 1 2.3 2.3L6 12.1l-3 .8.8-3 6.4-6.6Z" />
              </svg>
            )}
          </span>
        </button>
      </span>
    );

  return (
    <span className={cx("l-iedit", className)} data-size={size} data-editing="">
      <span ref={box} className="l-iedit__box" data-invalid={error ? "" : undefined} data-busy={state === "saving" || undefined}>
        {/* The sizer holds the same text as the input, so the box is always as wide as the words. */}
        <span className="l-iedit__sizer" aria-hidden>
          {draft || placeholder}
        </span>
        <input
          ref={input}
          value={draft}
          aria-label={label}
          aria-invalid={!!error || undefined}
          placeholder={placeholder}
          readOnly={state === "saving"}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => commit(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close(true);
            }
          }}
        />
        {state === "saving" && <span className="l-iedit__spin" aria-hidden />}
      </span>
      {error && (
        <span className="l-in-hint l-iedit__error" data-tone="danger" role="alert" key={error}>
          {error}
        </span>
      )}
    </span>
  );
}
