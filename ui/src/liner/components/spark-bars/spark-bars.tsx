/*
  Liner · Spark bars
  A period at a glance: one small bar per day, the days still to come drawn as a quiet
  baseline, and the average beside the label. The latest bar wears the accent; point at
  any bar (or use the arrow keys) to read it. Bars grow in on arrival, left to right.
*/
import { useState, type KeyboardEvent } from "react";
import { cx } from "../../lib/hooks";
import "./spark-bars.css";

export type SparkBarsProps = {
  /** Values so far, oldest first. */
  data: number[];
  /** Slots in the whole period; the ones without data wait as placeholders. */
  total?: number;
  /** One per value, for the read-out. */
  labels?: string[];
  label?: string;
  /** After the average, like "/ day". */
  unit?: string;
  format?: (n: number) => string;
  height?: number;
  className?: string;
};

const plain = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function SparkBars({ data, total = data.length, labels, label = "Per day", unit = "/ day", format = plain, height = 64, className }: SparkBarsProps) {
  const [at, setAt] = useState<number | null>(null);
  const slots = Math.max(total, data.length);
  const max = Math.max(1, ...data);
  const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
  const peak = data.indexOf(Math.max(...data));
  const summary = data.length
    ? `${label}: ${data.length} of ${slots} so far, average ${format(Math.round(avg))}, highest ${format(data[peak])}${labels?.[peak] ? ` on ${labels[peak]}` : ""}.`
    : `${label}: nothing yet.`;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!data.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const from = at ?? (e.key === "ArrowRight" ? -1 : data.length);
      setAt(Math.min(data.length - 1, Math.max(0, from + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Escape") setAt(null);
  };

  return (
    <figure className={cx("l-sbars", className)}>
      <figcaption className="l-sbars__head">
        <span>{label}</span>
        {data.length > 0 && (
          <span className="l-sbars__avg-text">
            Avg <b className="l-num">{format(Math.round(avg))}</b> {unit}
          </span>
        )}
      </figcaption>
      <div
        className="l-sbars__plot l-focus"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={summary}
        onKeyDown={onKey}
        onBlur={() => setAt(null)}
        onPointerLeave={() => setAt(null)}
      >
        <span className="l-sbars__avg" style={{ bottom: `${(avg / max) * 100}%` }} aria-hidden />
        {Array.from({ length: slots }, (_, i) =>
          i < data.length ? (
            <span
              key={i}
              className="l-sbars__bar"
              data-last={i === data.length - 1 || undefined}
              data-on={at === i || undefined}
              style={{ ["--h" as string]: Math.max(0.02, data[i] / max), ["--i" as string]: i }}
              onPointerEnter={() => setAt(i)}
            />
          ) : (
            <span key={i} className="l-sbars__slot" aria-hidden />
          ),
        )}
        {at !== null && (
          <span className="l-sbars__tip l-glass" style={{ left: `${((at + 0.5) / slots) * 100}%` }} aria-hidden key={at}>
            <b className="l-num">{format(data[at])}</b>
            {labels?.[at] && <span>{labels[at]}</span>}
          </span>
        )}
      </div>
      {at !== null && (
        <span className="l-sr-only" aria-live="polite">
          {`${labels?.[at] ?? `Day ${at + 1}`}: ${format(data[at])}`}
        </span>
      )}
    </figure>
  );
}
