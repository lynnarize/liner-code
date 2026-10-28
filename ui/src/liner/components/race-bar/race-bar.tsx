/*
  Liner · Race bar
  Rankings as they change. Each frame (a year, a week) re-sorts the bars: they slide to their
  new places, stretch to their new values, and their numbers roll. Play, pause or scrub to
  any frame; the bars carry their own names, so no legend is needed.
*/
import { useEffect, useState } from "react";
import { cx } from "../../lib/hooks";
import { ChartFrame, type ChartFrameProps } from "../chart/chart";
import { compact } from "../chart/scale";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./race-bar.css";

export type RaceFrame = { label: string; values: Record<string, number> };
export type RaceBarProps = Omit<ChartFrameProps, "children" | "legend" | "table" | "actions"> & {
  frames: RaceFrame[];
  top?: number;
  interval?: number;
  /** Follow one entity in the accent; the others turn grey. */
  focus?: string;
  format?: (v: number) => string;
};

export function RaceBar({ frames, top = 6, interval = 1500, focus, format = compact, ...frame }: RaceBarProps) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (at >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setAt((a) => a + 1), interval);
    return () => window.clearTimeout(t);
  }, [playing, at]);
  const cur = frames[at].values;
  const names = Object.keys(frames[0].values);
  const ranked = [...names].sort((a, b) => cur[b] - cur[a]);
  const max = cur[ranked[0]];
  const rowH = 34;
  return (
    <ChartFrame
      {...frame}
      figure={
        <span className="l-race__frame" key={frames[at].label}>
          {frames[at].label}
        </span>
      }
      actions={
        <span className="l-race__controls">
          <button
            type="button"
            className="l-race__play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (!playing && at >= frames.length - 1) setAt(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? (
              <svg viewBox="0 0 16 16" aria-hidden>
                <rect x="4" y="3.5" width="2.6" height="9" rx="1" fill="currentColor" />
                <rect x="9.4" y="3.5" width="2.6" height="9" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M5 3.5v9l7.5-4.5L5 3.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <input
            type="range"
            className="l-race__scrub"
            min={0}
            max={frames.length - 1}
            value={at}
            aria-label="Frame"
            aria-valuetext={frames[at].label}
            style={{ ["--p" as string]: at / (frames.length - 1) }}
            onChange={(e) => {
              setPlaying(false);
              setAt(Number(e.target.value));
            }}
          />
        </span>
      }
      table={{ columns: ["", ...frames.map((f) => f.label)], rows: names.map((n) => [n, ...frames.map((f) => f.values[n])]) }}
    >
      <div className="l-race" style={{ height: top * rowH }} role="img" aria-label={`${frames[at].label}: ${ranked.slice(0, top).map((n, i) => `${i + 1}. ${n} ${format(cur[n])}`).join(", ")}`}>
        {names.map((n) => {
          const rank = ranked.indexOf(n);
          const shown = rank < top;
          return (
            <div key={n} className={cx("l-race__row", focus && n !== focus && "is-context", n === focus && "is-focus")} style={{ transform: `translateY(${Math.min(rank, top) * rowH}px)`, opacity: shown ? 1 : 0 }} aria-hidden>
              <span className="l-race__name">{n}</span>
              <span className="l-race__track">
                <span className="l-race__bar" style={{ width: `${(cur[n] / max) * 100}%` }} />
                <span className="l-race__value" style={{ left: `${(cur[n] / max) * 100}%` }}>
                  <RollingNumber value={Math.round(cur[n])} format={{ notation: "compact", maximumFractionDigits: 1 }} />
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}
