/*
  Liner Pro · Diff review
  An agent's edits to your text, shown in place: what it would remove is struck through,
  what it would add is tinted. The strip on top says who suggested how many; keep or leave
  each one (point at it, or Enter and Backspace), step through them, or settle the rest
  from the strip below, which counts what you have settled. Removed words blur away
  quickly; kept words lose their tint and become plain text.

  Write the text as a word diff: "Revenue grew [-18-]{+21+}% in Q3".
*/
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Button } from "../../components/button/button";
import { RollingNumber } from "../../components/rolling-number/rolling-number";
import "./diff-review.css";

type Part = { kind: "same"; text: string } | { kind: "change"; id: number; del?: string; ins?: string };
export type DiffDecision = "accepted" | "rejected";
export type DiffReviewProps = {
  /** The text, with removals as [-…-] and additions as {+…+}. */
  text: string;
  /** What the edits are to, like the document's name. */
  title?: ReactNode;
  /** Who suggested them. */
  author?: string;
  /** Told after every decision: the text with decided changes applied, and how many are left. */
  onChange?: (text: string, open: number) => void;
  className?: string;
};

export function parseDiff(text: string): Part[] {
  const parts: Part[] = [];
  const re = /\[-([\s\S]*?)-\]|\{\+([\s\S]*?)\+\}/g;
  let at = 0;
  let id = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) parts.push({ kind: "same", text: text.slice(at, m.index) });
    const last = parts[parts.length - 1];
    // A removal followed straight away by an addition is one change: a replacement.
    if (m[2] !== undefined && last?.kind === "change" && last.ins === undefined && m.index === at) last.ins = m[2];
    else parts.push({ kind: "change", id: id++, del: m[1], ins: m[2] });
    at = re.lastIndex;
  }
  if (at < text.length) parts.push({ kind: "same", text: text.slice(at) });
  return parts;
}

const Sparkle = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M8 2.5c.5 2.6 1.9 4 4.5 4.5-2.6.5-4 1.9-4.5 4.5-.5-2.6-1.9-4-4.5-4.5 2.6-.5 4-1.9 4.5-4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

export function DiffReview({ text, title, author = "The agent", onChange, className }: DiffReviewProps) {
  const parts = useMemo(() => parseDiff(text), [text]);
  const changes = parts.filter((p): p is Extract<Part, { kind: "change" }> => p.kind === "change");
  const [decided, setDecided] = useState<Record<number, DiffDecision>>({});
  // Words leaving play their short exit first, then drop out of the text.
  const [gone, setGone] = useState<Record<number, true>>({});
  const refs = useRef(new Map<number, HTMLSpanElement>());
  const open = changes.filter((c) => !decided[c.id]);

  const resolved = (d: Record<number, DiffDecision>) =>
    parts.map((p) => (p.kind === "same" ? p.text : d[p.id] === "accepted" ? (p.ins ?? "") : d[p.id] === "rejected" ? (p.del ?? "") : `${p.del !== undefined ? `[-${p.del}-]` : ""}${p.ins !== undefined ? `{+${p.ins}+}` : ""}`)).join("");

  // Tell the owner after each decision lands, outside the state update.
  const told = useRef(0);
  useEffect(() => {
    const n = Object.keys(decided).length;
    if (n === told.current) return;
    told.current = n;
    onChange?.(resolved(decided), changes.length - n);
  }, [decided]);

  const decide = (ids: number[], how: DiffDecision) => {
    const fresh = ids.filter((id) => !decided[id]);
    if (!fresh.length) return;
    // Several at once settle left to right, a beat apart.
    fresh.forEach((id, i) =>
      window.setTimeout(() => {
        setDecided((d) => ({ ...d, [id]: how }));
        window.setTimeout(() => setGone((g) => ({ ...g, [id]: true })), 170);
      }, i * 45),
    );
    feedback.play(how === "accepted" ? "pop" : "tap", how === "accepted" ? 2 : -1);
  };

  const step = (dir: 1 | -1) => {
    if (!open.length) return;
    const focused = changes.findIndex((c) => refs.current.get(c.id) === document.activeElement);
    const ids = open.map((c) => c.id);
    const from = focused >= 0 ? ids.findIndex((id) => id === changes[focused].id) : -1;
    const next = ids[(from + dir + ids.length) % ids.length] ?? ids[0];
    refs.current.get(next)?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLSpanElement>, id: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      decide([id], "accepted");
      step(1);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      decide([id], "rejected");
      step(1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    }
  };

  const settled = changes.length - open.length;
  return (
    <section className={cx("l-diff l-frame", className)} aria-label="Suggested edits">
      <div className="l-frame-strip l-diff__top">
        <span className="l-diff__who">
          <Sparkle />
          <span>
            <b>{author}</b> suggests {changes.length} {changes.length === 1 ? "edit" : "edits"}
            {title && (
              <>
                {" "}
                to <em>{title}</em>
              </>
            )}
          </span>
        </span>
        <span className="l-diff__nav">
          <button type="button" className="l-diff__arrow l-focus" aria-label="Previous edit" disabled={!open.length} onClick={() => step(-1)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M9.75 4.5 6.25 8l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="l-diff__arrow l-focus" aria-label="Next edit" disabled={!open.length} onClick={() => step(1)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
      </div>
      <div className="l-frame-card l-diff__card">
        <p className="l-diff__text">
          {parts.map((p, i) => {
            if (p.kind === "same") return <span key={`s${i}`}>{p.text}</span>;
            const d = decided[p.id];
            const label = p.del !== undefined && p.ins !== undefined ? `Replace “${p.del}” with “${p.ins}”` : p.ins !== undefined ? `Add “${p.ins}”` : `Remove “${p.del}”`;
            return (
              <span
                key={`c${p.id}`}
                ref={(el) => {
                  if (el) refs.current.set(p.id, el);
                  else refs.current.delete(p.id);
                }}
                className="l-diff__chg l-focus"
                data-state={d ?? "open"}
                role={d ? undefined : "button"}
                tabIndex={d ? -1 : 0}
                aria-label={d ? undefined : `${label}. Enter keeps it, Backspace leaves it out.`}
                onKeyDown={d ? undefined : (e) => onKey(e, p.id)}
              >
                {p.del !== undefined && !(d === "accepted" && gone[p.id]) && <del data-out={d === "accepted" || undefined}>{p.del}</del>}
                {p.ins !== undefined && !(d === "rejected" && gone[p.id]) && <ins data-out={d === "rejected" || undefined}>{p.ins}</ins>}
                {!d && (
                  <span className="l-diff__pick l-glass" aria-hidden>
                    <button type="button" tabIndex={-1} title="Keep" onClick={() => decide([p.id], "accepted")}>
                      <svg viewBox="0 0 16 16" fill="none">
                        <path d="M3.8 8.4 6.6 11l5.6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button type="button" tabIndex={-1} title="Leave out" onClick={() => decide([p.id], "rejected")}>
                      <svg viewBox="0 0 16 16" fill="none">
                        <path d="m5 5 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    </button>
                  </span>
                )}
              </span>
            );
          })}
        </p>
      </div>
      <div className="l-frame-strip l-diff__foot">
        <span className="l-diff__count" data-done={!open.length || undefined} aria-live="polite">
          <span className="l-diff__meter" aria-hidden>
            <i style={{ transform: `scaleX(${changes.length ? settled / changes.length : 1})` }} />
          </span>
          <span aria-hidden>
            <RollingNumber value={settled} /> of {changes.length} settled
          </span>
          <span className="l-sr-only">{open.length ? `${open.length} edits left to review` : "Every edit reviewed"}</span>
        </span>
        <span className="l-diff__all">
          <Button size="sm" variant="ghost" disabled={!open.length} onClick={() => decide(open.map((c) => c.id), "rejected")}>
            Leave all
          </Button>
          <Button size="sm" variant="secondary" disabled={!open.length} onClick={() => decide(open.map((c) => c.id), "accepted")}>
            Keep all
          </Button>
        </span>
      </div>
    </section>
  );
}
