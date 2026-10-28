import { useRef, useState } from "react";
import { TextField, type TextFieldProps } from "../text-field/text-field";
import { feedback } from "../../lib/feedback";
import "./password-field.css";

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "addon" | "label"> & {
  label?: string;
  /** Show the strength meter while typing a new password. */
  showStrength?: boolean;
};

const levels = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

export function scorePassword(pw: string) {
  if (pw.length < 6) return { score: 0, hint: pw ? "Use at least 8 characters" : "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (/(.)\1{2,}/.test(pw) || /^(password|qwerty|123456)/i.test(pw)) score = Math.max(1, score - 2);
  score = Math.max(1, Math.min(4, score));
  const hint =
    score >= 4
      ? "Strong password"
      : !/[^A-Za-z0-9]/.test(pw)
        ? "Add a symbol to make it stronger"
        : !/\d/.test(pw)
          ? "Add a number to make it stronger"
          : !(/[a-z]/.test(pw) && /[A-Z]/.test(pw))
            ? "Mix upper and lower case"
            : "Make it a little longer";
  return { score, hint };
}

export function PasswordField({ label = "Password", showStrength = true, onValueChange, ...rest }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const [value, setValue] = useState(String(rest.defaultValue ?? rest.value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  const { score, hint } = scorePassword(value);

  function toggle() {
    setShown((s) => !s);
    feedback.play("toggle");
    // A short blur covers the glyph swap between dots and letters.
    inputRef.current?.animate([{ filter: "blur(3px)", opacity: 0.4 }, { filter: "none", opacity: 1 }], { duration: 260, easing: "ease-out" });
  }

  return (
    <div className="l-pass" data-score={score}>
      <TextField
        {...rest}
        ref={inputRef}
        label={label}
        type={shown ? "text" : "password"}
        autoComplete={rest.autoComplete ?? "new-password"}
        spellCheck={false}
        onValueChange={(v) => {
          setValue(v);
          onValueChange?.(v);
        }}
        addon={
          <button
            type="button"
            className="l-pass__eye l-plate l-focus"
            data-shown={shown || undefined}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            onPointerDown={(e) => e.preventDefault()}
            onClick={toggle}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M1.75 8s2.3-4.25 6.25-4.25S14.25 8 14.25 8 11.95 12.25 8 12.25 1.75 8 1.75 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M6.3 3.95A6.6 6.6 0 0 1 8 3.75c3.95 0 6.25 4.25 6.25 4.25a11.6 11.6 0 0 1-1.7 2.2M4.2 5.1A11.3 11.3 0 0 0 1.75 8S4.05 12.25 8 12.25c1.15 0 2.15-.36 3-.88M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.6 6.55a2 2 0 0 0 2.85 2.85" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        }
      />
      {showStrength && (
        <div className="l-pass__meter" data-show={value.length > 0 || undefined} aria-live="polite">
          <div className="l-pass__meter-inner">
            <div className="l-pass__bars" aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className="l-pass__bar" data-on={score >= i || undefined} style={{ ["--i" as string]: i }} />
              ))}
            </div>
            <div className="l-pass__meta">
              <span className="l-pass__level" key={score}>
                {levels[score]}
              </span>
              <span className="l-pass__hint" key={hint}>
                {hint}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
