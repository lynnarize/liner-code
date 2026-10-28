/*
  Liner · Textarea
  Grows with what you write, between minRows and maxRows, then scrolls. The counter only
  speaks up near the limit: a ring fills, then the number turns to a warning.
*/
import { forwardRef, useId, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import "../../lib/field.css";
import "./textarea.css";

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value" | "defaultValue" | "onSubmit"> & {
  label?: string;
  description?: string;
  error?: string | null;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  minRows?: number;
  maxRows?: number;
  /** Submit on ⌘/Ctrl + Enter. */
  onSubmit?: (value: string) => void;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, description, error, value, defaultValue = "", onValueChange, minRows = 3, maxRows = 10, maxLength, onSubmit, onKeyDown, className, id, ...rest },
  forwarded,
) {
  const auto = useId();
  const fid = id ?? `ta${auto}`;
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwarded, () => ref.current as HTMLTextAreaElement);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const text = controlled ? value : inner;

  // Height follows the content; the box transitions, so new lines ease in.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    // Measure at zero height with the transition off, then restore and let it ease.
    const prev = el.style.height;
    el.style.transition = "none";
    el.style.height = "0px";
    const want = el.scrollHeight;
    el.style.height = prev;
    void el.offsetHeight;
    el.style.transition = "";
    const h = Math.min(Math.max(want, minRows * line + pad), maxRows * line + pad);
    el.style.height = `${h}px`;
    if (want > h + 1) el.dataset.scroll = "";
    else delete el.dataset.scroll;
  }, [text, minRows, maxRows]);

  const left = maxLength ? maxLength - text.length : null;
  const near = left !== null && left <= Math.max(10, maxLength! * 0.2);
  const msg = error || description;
  return (
    <div className={cx("l-in l-textarea", className)}>
      {label && (
        <label className="l-in-label" htmlFor={fid}>
          {label}
        </label>
      )}
      <div className="l-in-box l-textarea__box" data-invalid={error ? "" : undefined}>
        <textarea
          ref={ref}
          id={fid}
          value={text}
          maxLength={maxLength}
          aria-invalid={!!error || undefined}
          aria-describedby={msg ? `${fid}-msg` : undefined}
          onChange={(e) => {
            if (!controlled) setInner(e.target.value);
            onValueChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit(text);
            }
            onKeyDown?.(e);
          }}
          {...rest}
        />
        {maxLength && (
          <span className="l-textarea__count" data-near={near || undefined} data-over={left! <= 0 || undefined} aria-hidden={!near}>
            <svg viewBox="0 0 20 20" aria-hidden>
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="8" pathLength={100} style={{ strokeDasharray: `${Math.min(100, (text.length / maxLength) * 100)} 100` }} />
            </svg>
            {near && (
              <span key={left! > 0 ? "n" : "o"} aria-live="polite">
                {left}
              </span>
            )}
          </span>
        )}
      </div>
      {msg && (
        <span id={`${fid}-msg`} className="l-in-hint" data-tone={error ? "danger" : undefined} key={msg}>
          {msg}
        </span>
      )}
    </div>
  );
});
