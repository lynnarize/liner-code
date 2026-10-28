/*
  Liner · Reactions
  Acknowledge something in one tap. Your own reactions are tinted, counts roll to their
  new value, and a new reaction grows in from the add button's picker.
*/
import { useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss } from "../../lib/overlay";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./reactions.css";

export type Reaction = { emoji: string; label: string; count: number; mine?: boolean };

const defaultChoices: Array<{ emoji: string; label: string }> = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "🎉", label: "Party" },
  { emoji: "😂", label: "Laughing" },
  { emoji: "👀", label: "Eyes" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "🙏", label: "Thanks" },
  { emoji: "🔥", label: "Fire" },
];

export function Reactions({ defaultValue = [], choices = defaultChoices, onChange, className }: { defaultValue?: Reaction[]; choices?: Array<{ emoji: string; label: string }>; onChange?: (r: Reaction[]) => void; className?: string }) {
  const [list, setList] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [popped, setPopped] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), [wrap], addRef);

  const commit = (next: Reaction[]) => {
    setList(next);
    onChange?.(next);
  };
  const toggle = (emoji: string, label: string) => {
    const r = list.find((x) => x.emoji === emoji);
    if (!r) commit([...list, { emoji, label, count: 1, mine: true }]);
    else if (r.mine) commit(r.count <= 1 ? list.filter((x) => x !== r) : list.map((x) => (x === r ? { ...x, count: x.count - 1, mine: false } : x)));
    else commit(list.map((x) => (x === r ? { ...x, count: x.count + 1, mine: true } : x)));
    const adding = !r?.mine;
    if (adding) {
      setPopped(emoji);
      window.setTimeout(() => setPopped((p) => (p === emoji ? null : p)), 600);
    }
    feedback.play(adding ? "pop" : "tap", adding ? 5 : -1);
  };

  return (
    <div ref={wrap} className={cx("l-react", className)} role="group" aria-label="Reactions">
      {list.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className="l-react-chip l-focus"
          data-mine={r.mine || undefined}
          data-pop={popped === r.emoji || undefined}
          aria-pressed={!!r.mine}
          aria-label={`${r.label}, ${r.count}${r.mine ? ", including you" : ""}`}
          onClick={() => toggle(r.emoji, r.label)}
        >
          <span className="l-react-emoji" aria-hidden>
            {r.emoji}
          </span>
          <RollingNumber value={r.count} className="l-react-n" />
        </button>
      ))}
      <span className="l-anchor">
        <button ref={addRef} type="button" className="l-react-add l-focus" aria-label="Add reaction" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.6 9.8c.5.7 1.1 1 1.9 1s1.4-.3 1.9-1M5.8 7.2h.01M9.2 7.2h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12.75 1.75v3M11.25 3.25h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {open && (
          <div className="l-pop l-react-picker" data-side="top" data-align="start" role="dialog" aria-label="Pick a reaction">
            {choices.map((c, i) => (
              <button
                key={c.emoji}
                type="button"
                className="l-react-pick l-focus"
                aria-label={c.label}
                style={{ animationDelay: `${i * 22}ms` }}
                autoFocus={i === 0}
                onClick={() => {
                  toggle(c.emoji, c.label);
                  setOpen(false);
                  addRef.current?.focus({ preventScroll: true });
                }}
              >
                {c.emoji}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}
