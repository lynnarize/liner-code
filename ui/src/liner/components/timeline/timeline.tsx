/*
  Liner · Timeline
  What happened, in order. Each event hangs off a hairline with a small mark; the latest
  can carry a live state, and events come into focus in a short cascade when they arrive.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./timeline.css";

export type TimelineEvent = { id: string; title: ReactNode; time: string; body?: ReactNode; icon?: ReactNode; state?: "done" | "current" | "upcoming" };
export type TimelineProps = { events: TimelineEvent[]; className?: string };

export function Timeline({ events, className }: TimelineProps) {
  return (
    <ol className={cx("l-timeline", className)}>
      {events.map((e, i) => (
        <li key={e.id} className="l-timeline__event" data-state={e.state ?? "done"} style={{ animationDelay: `${i * 60}ms` }}>
          <span className="l-timeline__mark" aria-hidden>
            {e.icon}
          </span>
          <div className="l-timeline__body">
            <div className="l-timeline__head">
              <b>{e.title}</b>
              <time>{e.time}</time>
            </div>
            {e.body && <div className="l-timeline__text">{e.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
