/*
  Marks for AI surfaces.
  AiMark is Liner's assistant: a small glass orb with a spark. It breathes while
  thinking, a sheen sweeps it while reading, and the spark turns while writing.
*/
import { useId } from "react";
import { cx } from "../../lib/hooks";

export type AiPhase = "idle" | "thinking" | "reading" | "writing" | "done" | "stopped" | "error";

export function AiMark({ phase = "idle", size = 22 }: { phase?: AiPhase; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="l-aimark" data-phase={phase} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <radialGradient id={`g${id}`} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="oklch(0.86 0.1 250)" />
          <stop offset="0.55" stopColor="var(--l-accent)" />
          <stop offset="1" stopColor="oklch(0.5 0.2 292)" />
        </radialGradient>
        <clipPath id={`c${id}`}>
          <circle cx="12" cy="12" r="10.5" />
        </clipPath>
      </defs>
      <g className="l-aimark-core">
        <circle className="l-aimark-orb" cx="12" cy="12" r="10.5" fill={phase === "error" ? "var(--l-danger)" : `url(#g${id})`} />
        <g clipPath={`url(#c${id})`}>
          <rect className="l-aimark-sheen" x="7" y="-2" width="5" height="28" transform="rotate(20 12 12)" />
        </g>
        <circle className="l-aimark-rim" cx="12" cy="12" r="10.1" />
      </g>
      <path className="l-aimark-spark" d="M12 6.4l1.35 3.9 3.95 1.35-3.95 1.35L12 16.9l-1.35-3.9-3.95-1.35 3.95-1.35z" />
    </svg>
  );
}

export { SourceMark } from "../../components/reasoning/reasoning";

/** Abstract model glyphs. Swap for your providers' marks. */
export function ModelMark({ id, size = 16 }: { id: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true, className: "l-modelmark", "data-model": id } as const;
  if (id === "swift")
    return (
      <svg {...common}>
        <path d="M9 1.8 3.8 9h3.7l-.5 5.2L12.2 7H8.5L9 1.8Z" fill="currentColor" />
      </svg>
    );
  if (id === "deep")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="0.9" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
    </svg>
  );
}

/**
 * A spinner without a spin: eight rays, the brightest a beat ahead of the ones fading behind
 * it. The rays hold their shades and the group steps round a ray at a time: one animation
 * that changes eight times a turn, not eight fades repainting on every frame.
 */
export function Rays({ className }: { className?: string }) {
  return (
    <svg className={cx("l-rays", className)} viewBox="0 0 20 20" aria-hidden>
      <g className="l-rays__turn">
        {Array.from({ length: 8 }, (_, k) => (
          <line key={k} x1="10" y1="2.6" x2="10" y2="5.6" opacity={k ? 0.18 + (0.82 * k) / 8 : 1} transform={`rotate(${k * 45} 10 10)`} />
        ))}
      </g>
    </svg>
  );
}
