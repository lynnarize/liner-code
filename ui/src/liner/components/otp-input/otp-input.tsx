import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./otp-input.css";

export type OtpInputProps = {
  length?: 4 | 6;
  /** Resolve true to accept the code, false to reject it. */
  onComplete?: (code: string) => boolean | Promise<boolean>;
  successLabel?: string;
  errorLabel?: string;
  /** Draw a separator after this many cells. Defaults to half of a 6-cell code. */
  groupAt?: number;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
};

type Status = "idle" | "verifying" | "error" | "success";

export function OtpInput({
  length = 6,
  onComplete,
  successLabel = "Verified",
  errorLabel = "That code didn't match. Try again.",
  groupAt = length === 6 ? 3 : 0,
  autoFocus,
  className,
  "aria-label": ariaLabel = "One-time code",
}: OtpInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [clearing, setClearing] = useState(false);
  const [ring, setRing] = useState<{ x: number; w: number } | null>(null);
  const [pillW, setPillW] = useState(0);
  const pillRef = useRef<HTMLSpanElement>(null);

  const active = Math.min(sel, length - 1);
  const locked = status === "verifying" || status === "success";

  // One ring glides between cells instead of every cell owning its own focus style.
  useEffect(() => {
    const cell = slotsRef.current?.querySelectorAll<HTMLElement>(".l-otp__cell")[active];
    if (cell) setRing({ x: cell.offsetLeft, w: cell.offsetWidth });
  }, [active, length]);

  useEffect(() => {
    if (pillRef.current) setPillW(pillRef.current.scrollWidth);
  }, [successLabel]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  async function submit(code: string) {
    setStatus("verifying");
    const ok = await (onComplete ? onComplete(code) : new Promise<boolean>((r) => setTimeout(() => r(true), 900)));
    if (ok) {
      setStatus("success");
      feedback.play("success");
      inputRef.current?.blur();
      return;
    }
    setStatus("error");
    feedback.play("error");
    slotsRef.current?.animate(
      [{ transform: "none" }, { transform: "translateX(-6px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(1.5px)" }, { transform: "none" }],
      { duration: 380, easing: "cubic-bezier(.36,.07,.19,.97)" },
    );
    // Clear back to front after the shake, so the cells empty like a rewind.
    window.setTimeout(() => {
      setClearing(true);
      window.setTimeout(() => {
        setClearing(false);
        setValue("");
        setSel(0);
        inputRef.current?.focus();
      }, 240 + length * 22);
    }, 520);
  }

  function onInput(next: string) {
    const digits = next.replace(/\D/g, "").slice(0, length);
    if (status === "error" && digits.length) setStatus("idle");
    if (digits.length > value.length) feedback.play("tick", digits.length);
    setValue(digits);
    setSel(Math.min(digits.length, length - 1));
    if (digits.length === length) submit(digits);
  }

  function reset() {
    if (status !== "success") return;
    setStatus("idle");
    setValue("");
    setSel(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }

  const cells = Array.from({ length }, (_, i) => i);

  return (
    <div
      className={cx("l-otp", className)}
      data-status={status}
      data-focus={focused || undefined}
      style={{ ["--n" as string]: length, ["--pill-w" as string]: `${pillW}px` }}
    >
      <div className="l-otp__slots" ref={slotsRef} data-clearing={clearing || undefined}>
        {cells.map((i) => (
          <span key={i} className="l-otp__wrap" style={{ ["--i" as string]: i }}>
            <span className="l-otp__cell" data-filled={value[i] ? true : undefined}>
              {value[i] && (
                <span className="l-otp__char" key={`${i}${value[i]}`}>
                  {value[i]}
                </span>
              )}
              {focused && !locked && i === value.length && <span className="l-otp__caret" />}
            </span>
            {groupAt > 0 && i === groupAt - 1 && <span className="l-otp__sep" aria-hidden />}
          </span>
        ))}
        <span
          className="l-otp__ring"
          data-show={(focused && !locked) || undefined}
          style={ring ? { transform: `translateX(${ring.x}px)`, width: ring.w } : undefined}
          aria-hidden
        />
        <span className="l-otp__pill" aria-hidden={status !== "success"}>
          <span className="l-otp__pill-inner" ref={pillRef}>
            <svg viewBox="0 0 16 16" fill="none" className="l-otp__check" aria-hidden>
              <path d="M3.5 8.4 6.6 11.3 12.5 4.9" pathLength="1" />
            </svg>
            {successLabel}
          </span>
        </span>
        <input
          ref={inputRef}
          id={id}
          className="l-otp__input"
          value={value}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d*"
          maxLength={length}
          aria-label={ariaLabel}
          aria-invalid={status === "error" || undefined}
          aria-describedby={`${id}-msg`}
          readOnly={locked}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => {
            setFocused(true);
            setSel(Math.min(value.length, length - 1));
          }}
          onBlur={() => setFocused(false)}
          onClick={reset}
          onSelect={(e) => {
            const t = e.currentTarget;
            // Keep the ring on the cell being typed, wherever the native caret lands.
            setSel(Math.min(t.value.length, length - 1));
            if (t.selectionStart !== t.value.length) t.setSelectionRange(t.value.length, t.value.length);
          }}
        />
      </div>
      <div className="l-otp__msg" data-show={status === "error" || undefined}>
        <div className="l-otp__msg-inner">
          <p id={`${id}-msg`} className="l-otp__msg-text" role={status === "error" ? "alert" : undefined}>
            {status === "error" ? errorLabel : ""}
          </p>
        </div>
      </div>
      <span className="l-sr-only" aria-live="polite">
        {status === "verifying" ? "Checking code" : status === "success" ? successLabel : ""}
      </span>
    </div>
  );
}
