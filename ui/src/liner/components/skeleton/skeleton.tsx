/*
  Liner · Skeleton
  The shape of what is coming, with a slow light passing through. When the content lands,
  Swap lets it come into focus over the skeleton instead of popping in.
*/
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./skeleton.css";

export function Skeleton({ width, height = 12, radius, circle, className, style }: { width?: number | string; height?: number | string; radius?: number; circle?: boolean; className?: string; style?: CSSProperties }) {
  return <span className={cx("l-skel", className)} aria-hidden style={{ width: circle ? height : width, height, borderRadius: circle ? 999 : radius, ...style }} />;
}

/** A few lines of text, the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx("l-skel-text", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "62%" : "100%"} height={10} />
      ))}
    </span>
  );
}

/** Shows the skeleton while loading, then lets the content come into focus. */
export function Swap({ loading, skeleton, children, label = "Loading" }: { loading: boolean; skeleton: ReactNode; children: ReactNode; label?: string }) {
  return (
    <div className="l-skswap" aria-busy={loading} aria-live="polite">
      {loading ? (
        <div className="l-skswap__skel" role="status" aria-label={label}>
          {skeleton}
        </div>
      ) : (
        <div className="l-skswap__content">{children}</div>
      )}
    </div>
  );
}
