import { useId, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./tag-input.css";

export type TagInputProps = {
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
  max?: number;
  /** Return an error string to reject a tag. */
  validate?: (tag: string) => string | null;
  className?: string;
};

type Tag = { id: number; text: string; leaving?: boolean };

let nextId = 1;

export function TagInput({ value, defaultValue = [], onValueChange, label = "Tags", placeholder = "Add a tag", max = 12, validate, className }: TagInputProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [tags, setTags] = useState<Tag[]>(() => (value ?? defaultValue).map((text) => ({ id: nextId++, text })));
  // Chips that exist on first render just sit there; only new ones animate in.
  const firstNew = useRef(nextId).current;
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const live = tags.filter((t) => !t.leaving);
  if (controlled && value.join("\u0000") !== live.map((t) => t.text).join("\u0000")) {
    // Follow outside changes without losing the exit animation of chips in flight.
    setTags([...tags.filter((t) => t.leaving), ...value.map((text) => live.find((t) => t.text === text) ?? { id: nextId++, text })]);
  }

  function emit(next: Tag[]) {
    setTags(next);
    onValueChange?.(next.filter((t) => !t.leaving).map((t) => t.text));
  }

  function flash(text: string) {
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-tag="${CSS.escape(text.toLowerCase())}"]`);
    el?.animate(
      [{ transform: "none" }, { transform: "scale(1.08)", background: "var(--l-accent-soft)" }, { transform: "none" }],
      { duration: 420, easing: "cubic-bezier(.3,1.4,.4,1)" },
    );
  }

  function add(raw: string) {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    let next = [...tags];
    for (const text of parts) {
      const dupe = next.find((t) => !t.leaving && t.text.toLowerCase() === text.toLowerCase());
      if (dupe) {
        flash(dupe.text);
        feedback.play("tap");
        continue;
      }
      const problem = validate?.(text) ?? (next.filter((t) => !t.leaving).length >= max ? `Up to ${max} tags` : null);
      if (problem) {
        setError(problem);
        feedback.play("error");
        break;
      }
      next = [...next, { id: nextId++, text }];
      feedback.play("pop", next.length % 6);
    }
    emit(next);
    setDraft("");
  }

  function remove(tagId: number) {
    emit(tags.map((t) => (t.id === tagId ? { ...t, leaving: true } : t)));
    setArmed(false);
    feedback.play("tap", -2);
  }

  return (
    <div className={cx("l-tags", className)} data-error={error ? true : undefined}>
      <label className="l-tags__label" htmlFor={id}>
        {label}
        <span className="l-tags__count l-num">
          {live.length}/{max}
        </span>
      </label>
      <div className="l-tags__box" ref={rowRef} onPointerDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
        {tags.map((t, i) => {
          const isLast = !t.leaving && t.id === live[live.length - 1]?.id;
          return (
            <span
              key={t.id}
              className="l-tag"
              data-tag={t.text.toLowerCase()}
              data-leaving={t.leaving || undefined}
              data-static={t.id < firstNew || undefined}
              data-armed={(armed && isLast) || undefined}
              onAnimationEnd={(e) => {
                if (t.leaving && e.animationName === "l-tag-out") setTags((list) => list.filter((x) => x.id !== t.id));
              }}
              style={{ ["--i" as string]: i }}
            >
              <span className="l-tag__inner">
                <span className="l-tag__text">{t.text}</span>
                <button type="button" className="l-tag__x" aria-label={`Remove ${t.text}`} tabIndex={-1} onClick={() => remove(t.id)}>
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={id}
          className="l-tags__input"
          value={draft}
          placeholder={live.length ? "" : placeholder}
          aria-describedby={`${id}-hint`}
          enterKeyHint="done"
          onChange={(e) => {
            const v = e.target.value;
            setError(null);
            setArmed(false);
            if (/[,\n]/.test(v)) add(v);
            else setDraft(v);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,\n]/.test(text)) {
              e.preventDefault();
              add(draft + text);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              if (draft.trim()) {
                e.preventDefault();
                add(draft);
              }
            } else if (e.key === "Backspace" && !draft) {
              // First press arms the last chip, second removes it: no accidental deletes.
              const last = live[live.length - 1];
              if (!last) return;
              e.preventDefault();
              if (armed) remove(last.id);
              else {
                setArmed(true);
                feedback.play("tick");
              }
            } else if (e.key === "Escape") {
              setArmed(false);
            }
          }}
          onBlur={() => {
            setArmed(false);
            if (draft.trim()) add(draft);
          }}
        />
      </div>
      <p id={`${id}-hint`} className="l-tags__hint" key={error ?? "hint"} data-error={error ? true : undefined}>
        {error ?? "Press Enter or comma to add. Backspace twice to remove."}
      </p>
      <span className="l-sr-only" aria-live="polite">
        {armed ? `${live[live.length - 1]?.text} selected, press Backspace again to remove` : ""}
      </span>
    </div>
  );
}
