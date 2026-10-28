/*
  Liner · Hover card
  A richer preview when the pointer rests on a name or a link: who someone is, what a page
  holds. It waits long enough not to flash while you pass by, stays while you move into it,
  and opens from keyboard focus too.
*/
import { useId, useRef, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { useFlip, useIntent } from "../../lib/overlay";
import "./hover-card.css";

export type HoverCardProps = {
  /** The inline thing people point at. */
  children: ReactNode;
  /** What the card shows. */
  card: ReactNode;
  href?: string;
  width?: number;
  delay?: number;
  className?: string;
};

export function HoverCard({ children, card, href = "#", width = 300, delay = 450, className }: HoverCardProps) {
  const id = useId();
  const intent = useIntent(delay, 160);
  const a = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(intent.open, a, panel, "bottom");
  return (
    <span className={cx("l-anchor l-hcard", className)} onPointerEnter={() => intent.enter()} onPointerLeave={intent.leave}>
      <a
        ref={a}
        href={href}
        className="l-hcard__trigger"
        aria-describedby={intent.open ? id : undefined}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && intent.enter(true)}
        onBlur={intent.leave}
        onKeyDown={(e) => e.key === "Escape" && intent.setOpen(false)}
        onClick={(e) => href === "#" && e.preventDefault()}
      >
        {children}
      </a>
      {intent.open && (
        <div ref={panel} id={id} role="tooltip" className="l-pop l-hcard__panel" data-side={side} data-align="start" style={{ width }}>
          {card}
        </div>
      )}
    </span>
  );
}

/** A ready-made profile card body. */
export function ProfileCard({ name, handle, bio, stats, action }: { name: string; handle: string; bio?: string; stats?: [string, string][]; action?: ReactNode }) {
  return (
    <div className="l-hcard__profile">
      <div className="l-hcard__top">
        <span className="l-hcard__avatar" aria-hidden>
          {name
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")}
        </span>
        {action}
      </div>
      <div className="l-hcard__who">
        <b>{name}</b>
        <span>@{handle}</span>
      </div>
      {bio && <p>{bio}</p>}
      {stats && (
        <div className="l-hcard__stats">
          {stats.map(([n, l]) => (
            <span key={l}>
              <b>{n}</b> {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
