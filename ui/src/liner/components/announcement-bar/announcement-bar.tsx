/*
  Liner · Announcement bar
  One line of news above everything, on glass. A short tag, the message, a link, and a way
  to put it away; once dismissed it stays away (per browser) if you give it an id.
*/
import { useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./announcement-bar.css";

export type AnnouncementBarProps = {
  children: ReactNode;
  tag?: string;
  link?: { label: string; href: string };
  /** Remember dismissal under this key. */
  id?: string;
  className?: string;
};

const seen = (id?: string) => {
  if (!id) return false;
  try {
    return localStorage.getItem(`liner:announce:${id}`) === "1";
  } catch {
    return false;
  }
};

export function AnnouncementBar({ children, tag = "New", link, id, className }: AnnouncementBarProps) {
  const [gone, setGone] = useState(() => seen(id));
  const [leaving, setLeaving] = useState(false);
  if (gone) return null;
  return (
    <div className={cx("l-announce", className)} data-leaving={leaving || undefined} role="region" aria-label="Announcement" onTransitionEnd={(e) => leaving && e.propertyName === "grid-template-rows" && setGone(true)}>
      <div className="l-announce__clip">
        <div className="l-announce__bar l-glass">
          {tag && <span className="l-announce__tag">{tag}</span>}
          <span className="l-announce__text">{children}</span>
          {link && (
            <a className="l-announce__link" href={link.href}>
              {link.label}
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
          <button
            type="button"
            className="l-announce__x"
            aria-label="Dismiss announcement"
            onClick={() => {
              setLeaving(true);
              try {
                if (id) localStorage.setItem(`liner:announce:${id}`, "1");
              } catch {
                /* it just comes back next visit */
              }
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="m4.5 4.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
