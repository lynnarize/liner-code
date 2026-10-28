import { useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./like-button.css";

export type LikeButtonProps = {
  liked?: boolean;
  defaultLiked?: boolean;
  /** Count before the viewer's own like. */
  count?: number;
  onLikedChange?: (liked: boolean) => void;
  className?: string;
};

const DOTS = 10;

export function LikeButton({ liked, defaultLiked = false, count = 0, onLikedChange, className }: LikeButtonProps) {
  const controlled = liked !== undefined;
  const [inner, setInner] = useState(defaultLiked);
  const on = controlled ? liked : inner;
  // Bumped on every like so the burst replays.
  const [burst, setBurst] = useState(0);

  return (
    <button
      type="button"
      className={cx("l-like", "l-focus", className)}
      data-on={on || undefined}
      aria-pressed={on}
      aria-label={on ? "Unlike" : "Like"}
      onClick={() => {
        const next = !on;
        if (!controlled) setInner(next);
        onLikedChange?.(next);
        if (next) setBurst((b) => b + 1);
        feedback.play(next ? "pop" : "tap", next ? 5 : -2);
      }}
    >
      <span className="l-like__icon">
        {burst > 0 && on && (
          <span className="l-like__burst" key={burst} aria-hidden>
            <span className="l-like__ring" />
            {Array.from({ length: DOTS }, (_, i) => (
              <span key={i} className="l-like__dot" style={{ ["--a" as string]: `${(360 / DOTS) * i + (i % 2 ? 8 : -8)}deg`, ["--far" as string]: i % 2 ? "15px" : "19px" }} />
            ))}
          </span>
        )}
        <svg viewBox="0 0 20 20" aria-hidden className="l-like__heart" key={on ? `on${burst}` : "off"}>
          <path d="M10 16.6s-6.4-3.7-6.4-8.4A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 6.4 2.2c0 4.7-6.4 8.4-6.4 8.4Z" />
        </svg>
      </span>
      <span className="l-like__count">
        <RollingNumber value={count + (on ? 1 : 0)} />
      </span>
    </button>
  );
}
