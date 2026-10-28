/*
  Liner · Icon morph
  Icons that become their other state instead of swapping: the menu's lines fold into a
  close, play reshapes into pause, plus loses a stroke, copy comes into focus as a check,
  the sun's rays draw in as the moon slides away.
*/
import { useId, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./icon-morph.css";

export type MorphKind = "menu" | "play" | "plus" | "copy" | "theme" | "chevron";

export function IconMorph({ kind, on, size = 20, className }: { kind: MorphKind; on: boolean; size?: number; className?: string }) {
  const maskId = `l-morph-${useId().replace(/:/g, "")}`;
  const common = { className: cx("l-morph", className), "data-kind": kind, "data-on": on || undefined, style: { width: size, height: size }, "aria-hidden": true } as const;
  if (kind === "play")
    // Two four-point shapes: the halves of the triangle become the two bars.
    return (
      <span {...common}>
        <span className="l-morph-play" data-half="a" />
        <span className="l-morph-play" data-half="b" />
      </span>
    );
  if (kind === "copy")
    return (
      <span {...common}>
        <svg viewBox="0 0 20 20" fill="none" className="l-morph-a">
          <rect x="7" y="7" width="9.5" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M13 4.5H5.8A1.8 1.8 0 0 0 4 6.3v7.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <svg viewBox="0 0 20 20" fill="none" className="l-morph-b">
          <path d="M4.6 10.4 8.2 14 15.4 6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
        </svg>
      </span>
    );
  if (kind === "theme")
    return (
      <span {...common}>
        <svg viewBox="0 0 20 20" fill="none">
          <mask id={maskId}>
            <rect width="20" height="20" fill="#fff" />
            <circle className="l-morph-bite" cx="14.5" cy="5.5" r="5" fill="#000" />
          </mask>
          <circle className="l-morph-core" cx="10" cy="10" r="4.2" fill="currentColor" mask={`url(#${maskId})`} />
          <g className="l-morph-rays" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M10 1.8v1.6M10 16.6v1.6M18.2 10h-1.6M3.4 10H1.8M15.8 4.2l-1.1 1.1M5.3 14.7l-1.1 1.1M15.8 15.8l-1.1-1.1M5.3 5.3 4.2 4.2" />
          </g>
        </svg>
      </span>
    );
  // Line icons: menu (three lines), plus (two), chevron (two that tilt).
  return (
    <span {...common}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        {kind === "menu" && (
          <>
            <line className="l-morph-1" x1="4" y1="6" x2="16" y2="6" />
            <line className="l-morph-2" x1="4" y1="10" x2="16" y2="10" />
            <line className="l-morph-3" x1="4" y1="14" x2="16" y2="14" />
          </>
        )}
        {kind === "plus" && (
          <>
            <line className="l-morph-h" x1="4" y1="10" x2="16" y2="10" />
            <line className="l-morph-v" x1="10" y1="4" x2="10" y2="16" />
          </>
        )}
        {kind === "chevron" && (
          <>
            <line className="l-morph-l" x1="5" y1="8" x2="10" y2="12.5" />
            <line className="l-morph-r" x1="15" y1="8" x2="10" y2="12.5" />
          </>
        )}
      </svg>
    </span>
  );
}

const labels: Record<MorphKind, [string, string]> = {
  menu: ["Open menu", "Close menu"],
  play: ["Play", "Pause"],
  plus: ["Expand", "Collapse"],
  copy: ["Copy", "Copied"],
  theme: ["Switch to dark", "Switch to light"],
  chevron: ["Show more", "Show less"],
};

/** A button that toggles its morphing icon. Copy turns back on its own. */
export function IconMorphButton({ kind, on: onProp, defaultOn = false, onChange, className }: { kind: MorphKind; on?: boolean; defaultOn?: boolean; onChange?: (on: boolean) => void; className?: string }) {
  const [inner, setInner] = useState(defaultOn);
  const on = onProp ?? inner;
  return (
    <button
      type="button"
      className={cx("l-morph-btn l-focus", className)}
      aria-label={labels[kind][on ? 1 : 0]}
      aria-pressed={kind === "copy" ? undefined : on}
      onClick={() => {
        const next = !on;
        if (onProp === undefined) setInner(next);
        onChange?.(next);
        feedback.play(next ? "pop" : "tap", next ? 4 : 0);
        if (kind === "copy" && next)
          window.setTimeout(() => {
            if (onProp === undefined) setInner(false);
            onChange?.(false);
          }, 1400);
      }}
    >
      <IconMorph kind={kind} on={on} />
    </button>
  );
}
