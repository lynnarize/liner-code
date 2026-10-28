import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./text-field.css";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  description?: ReactNode;
  /** A message here marks the field invalid; changing it shakes the field once. */
  error?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  clearable?: boolean;
  showCount?: boolean;
  onValueChange?: (value: string) => void;
  /** Extra control, rendered inside the box after the input. */
  addon?: ReactNode;
  fieldClassName?: string;
};

/** Splits text into spans so each piece can stagger in. */
export function Staggered({ text, by = "word", step = 30, className }: { text: string; by?: "word" | "char"; step?: number; className?: string }) {
  const parts = by === "word" ? text.split(/(\s+)/) : Array.from(text);
  let i = 0;
  return (
    <span className={className} aria-label={text}>
      {parts.map((part, k) =>
        /^\s+$/.test(part) ? (
          <span key={k} aria-hidden>
            {part}
          </span>
        ) : (
          <span key={k} aria-hidden className="l-stagger" style={{ animationDelay: `${i++ * step}ms` }}>
            {part}
          </span>
        ),
      )}
    </span>
  );
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, description, error, leading, trailing, clearable, showCount, onValueChange, addon, fieldClassName, className, id, value, defaultValue, onChange, onFocus, onBlur, maxLength, ...rest },
  forwarded,
) {
  const autoId = useId();
  const inputId = id ?? `f${autoId}`;
  const msgId = `${inputId}-msg`;
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwarded, () => inputRef.current as HTMLInputElement);

  const controlled = value !== undefined;
  const [inner, setInner] = useState(String(defaultValue ?? ""));
  const current = controlled ? String(value ?? "") : inner;
  const [focus, setFocus] = useState(false);
  const up = focus || current.length > 0;
  const message = error || description;

  // Shake once per new error text. Web Animations, so the input keeps focus.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    boxRef.current?.animate(
      [{ transform: "none" }, { transform: "translateX(-5px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(1.5px)" }, { transform: "none" }],
      { duration: 360, easing: "cubic-bezier(.36,.07,.19,.97)" },
    );
    feedback.play("error");
  }, [error]);

  function emit(next: string) {
    if (!controlled) setInner(next);
    onValueChange?.(next);
  }

  function clear() {
    const el = inputRef.current;
    if (!el) return;
    // Go through the native setter so React and form libraries see a real input event.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    feedback.play("tap");
  }

  const count = current.length;
  const near = maxLength ? count / maxLength : 0;

  return (
    <div
      className={cx("l-field", fieldClassName)}
      data-up={up || undefined}
      data-focus={focus || undefined}
      data-invalid={error ? true : undefined}
      data-lead={leading ? true : undefined}
      data-filled={current.length > 0 || undefined}
    >
      <div className={cx("l-field__box", className)} ref={boxRef}>
        <fieldset className="l-field__outline" aria-hidden>
          <legend>
            <span>{label}</span>
          </legend>
        </fieldset>
        {leading && <span className="l-field__lead">{leading}</span>}
        <label className="l-field__label" htmlFor={inputId}>
          {Array.from(label).map((ch, i) => (
            <span key={i} style={{ ["--i" as string]: i }}>
              {ch === " " ? " " : ch}
            </span>
          ))}
        </label>
        <input
          {...rest}
          ref={inputRef}
          id={inputId}
          className="l-field__input"
          value={controlled ? value : inner}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? msgId : undefined}
          onChange={(e) => {
            emit(e.target.value);
            onChange?.(e);
          }}
          onFocus={(e) => {
            setFocus(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            onBlur?.(e);
          }}
        />
        {clearable && (
          <button
            type="button"
            tabIndex={-1}
            className="l-field__clear l-plate"
            data-show={current.length > 0 || undefined}
            aria-label="Clear"
            onPointerDown={(e) => e.preventDefault()}
            onClick={clear}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {addon}
        {trailing && <span className="l-field__trail">{trailing}</span>}
      </div>
      <div className="l-field__msg" data-show={message || (showCount && maxLength) ? true : undefined}>
        <div className="l-field__msg-inner">
          <div className="l-field__msg-row">
            <p id={msgId} className="l-field__msg-text" data-error={error ? true : undefined} key={error ? `e:${error}` : "d"}>
              {error ? (
                <>
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-field__alert">
                    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 4.9v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="8" cy="10.9" r=".95" fill="currentColor" />
                  </svg>
                  <Staggered text={error} step={28} />
                </>
              ) : (
                description
              )}
            </p>
            {showCount && maxLength ? (
              <span className="l-field__count l-num" data-near={near >= 0.9 || undefined} data-full={count >= maxLength || undefined}>
                {count}/{maxLength}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
