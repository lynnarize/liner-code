/*
  Liner · Text shimmer
  Words that show work is happening: a calm light passes through them. When the work is
  done the light stops and the text settles to ink, coming into focus once more.
*/
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./text-shimmer.css";

export type TextShimmerProps = {
  children: ReactNode;
  /** While true the light passes; false lets it settle. */
  active?: boolean;
  /** Seconds per pass. */
  duration?: number;
  /** How wide the light is, as a share of the text. */
  spread?: number;
  className?: string;
};

export function TextShimmer({ children, active = true, duration = 1.9, spread = 0.3, className }: TextShimmerProps) {
  return (
    <span
      className={cx("l-tshimmer", className)}
      data-active={active || undefined}
      key={String(active)}
      style={{ ["--dur" as string]: `${duration}s`, ["--spread" as string]: `${spread * 50}%` } as CSSProperties}
      aria-busy={active || undefined}
    >
      {children}
    </span>
  );
}
