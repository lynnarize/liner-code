/*
  Liner · Notice stack
  What's new, kept small: notices stack like cards, the next ones peeking above the first.
  Point at the stack and it fans out so you can read them all; dismiss the front one and
  it leaves quickly while the next springs forward into its place.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./notice-stack.css";

export type Notice = {
  id: string;
  /** A small line above the title, like the product name. */
  eyebrow?: string;
  title: string;
  body?: string;
  action?: { label: string; href?: string; onClick?: () => void };
};
export type NoticeStackProps = {
  notices: Notice[];
  onDismiss?: (id: string) => void;
  /** How many cards show at once, the front one included. */
  depth?: number;
  label?: string;
  className?: string;
};

const Chevron = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function NoticeStack({ notices, onDismiss, depth = 3, label = "What's new", className }: NoticeStackProps) {
  const [gone, setGone] = useState<string[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null);
  const live = notices.filter((n) => !gone.includes(n.id));
  if (!live.length) return null;
  const shown = live.slice(0, depth);

  const dismiss = (id: string) => {
    if (leaving) return;
    setLeaving(id);
    feedback.play("tap", -2);
    // The exit is short; the rest move up as soon as it has gone.
    window.setTimeout(() => {
      setGone((g) => [...g, id]);
      setLeaving(null);
      onDismiss?.(id);
    }, 170);
  };

  return (
    <section className={cx("l-notes", className)} aria-label={label} style={{ ["--n" as string]: shown.length }}>
      {shown.map((n, i) => {
        const front = i === 0;
        return (
          <article
            key={n.id}
            className="l-notes__card"
            style={{ ["--d" as string]: i, zIndex: depth - i }}
            data-front={front || undefined}
            data-leaving={leaving === n.id || undefined}
            aria-hidden={!front || undefined}
            inert={!front || undefined}
          >
            <div className="l-notes__top">
              {n.eyebrow && <span className="l-notes__eyebrow">{n.eyebrow}</span>}
              <button type="button" className="l-notes__x l-focus" aria-label={`Dismiss ${n.title}`} onClick={() => dismiss(n.id)}>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="m4.75 4.75 6.5 6.5m0-6.5-6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <b className="l-notes__title">{n.title}</b>
            {n.body && <p className="l-notes__body">{n.body}</p>}
            {n.action &&
              (n.action.href ? (
                <a className="l-notes__action l-focus" href={n.action.href} onClick={n.action.onClick}>
                  {n.action.label}
                  <Chevron />
                </a>
              ) : (
                <button type="button" className="l-notes__action l-focus" onClick={n.action.onClick}>
                  {n.action.label}
                  <Chevron />
                </button>
              ))}
          </article>
        );
      })}
      {live.length > 1 && <span className="l-sr-only">{`${live.length - 1} more after this one`}</span>}
    </section>
  );
}
