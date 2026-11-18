/*
  The Overview's "Open findings, day by day" (board A): what was open at the end of each day of the period as a stepped
  line, one series in the accent at 2px with a 10% wash under it, hairlines at 0, half way and a round top, a dot at its
  end with "N open today", a small dot under each day a scan ran, and one sentence on the latest scan that raised the
  count. Point at a day (or focus the chart and use the arrow keys) to read it: how many were open, the date, and what
  happened that day. Drawn at the box's own width, so its words never scale; 7, 30 and 90 days all fit.
*/
import { useLayoutEffect, useRef, useState } from "react";
import type { OverviewDay, ScanRecord } from "@contracts";
import { plural } from "../model";

const H = 312;
const X0 = 22;
const PAD_R = 6;
const TOP = 26;
const BASE = 270;

/** A round top for the axis, with a whole number half way: 4 for up to 4, then 10, 20, 40, 100… */
export function axisTop(max: number) {
  if (max <= 4) return 4;
  const half = Math.ceil(max / 2);
  const mag = 10 ** Math.floor(Math.log10(half));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= half) ?? 10 * mag;
  return step * 2;
}

const dateOf = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** A scan in a few words, for the readout and the note: "A scan of the whole project found 4". */
export function scanSentence(s: ScanRecord | undefined) {
  if (!s) return "A scan ran";
  const found = s.state === "running" || s.state === "asking" ? "is reading" : s.counts.found ? `found ${s.counts.found}` : "found nothing";
  return s.depth === "checks" ? `Free checks ${found}` : s.depth === "branch" ? `A scan of the branch ${found}` : `A scan of the whole project ${found}`;
}

/** What happened on a day, a line each. */
function happened(d: OverviewDay, scans: ScanRecord[]) {
  const lines = d.scans.map((id) => scanSentence(scans.find((s) => s.id === id)));
  if (!d.scans.length && d.found) lines.push(`${d.found} found`);
  if (d.fixed) lines.push(`${d.fixed} fixed`);
  if (d.dismissed) lines.push(`${d.dismissed} dismissed`);
  return lines;
}

export function OpenChart({ series, scans, now = Date.now() }: { series: OverviewDay[]; scans: ScanRecord[]; now?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(686);
  const [active, setActive] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setW(Math.max(280, Math.round(el.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, series.length);
  const right = w - PAD_R;
  const step = (right - X0) / n;
  const max = Math.max(0, ...series.map((d) => d.open));
  const top = axisTop(max);
  const y = (v: number) => BASE - (v / top) * (BASE - TOP);
  const xs = (i: number) => X0 + i * step;
  const mid = (i: number) => X0 + (i + 0.5) * step;

  let line = series.length ? `M${X0} ${y(series[0].open).toFixed(1)}` : `M${X0} ${BASE}`;
  series.forEach((d, i) => {
    line += `H${xs(i + 1).toFixed(1)}`;
    const next = series[i + 1];
    if (next && next.open !== d.open) line += `V${y(next.open).toFixed(1)}`;
  });
  if (!series.length) line += `H${right}`;
  const area = `${line}V${BASE}H${X0}Z`;
  const last = series[series.length - 1]?.open ?? 0;

  // Dates under the axis: every day for a week, every 7 for a month, every 14 beyond; the first starts at the axis.
  const every = n <= 7 ? 1 : n <= 31 ? 7 : 14;
  const labels = series.map((d, i) => ({ i, text: dateOf(d.at) })).filter(({ i }) => i % every === 0);

  // The note: the latest day a scan ran and the count went up, when its words fit above the line to its left.
  const note = (() => {
    for (let i = series.length - 1; i > 0; i--) {
      const d = series[i];
      if (!d.scans.length || d.open <= series[i - 1].open) continue;
      const rec = d.scans.map((id) => scans.find((s) => s.id === id)).find((s) => s && s.counts.found);
      const when = midnightOf(now) === midnightOf(d.at) ? "Today's" : midnightOf(now) - 86400000 === midnightOf(d.at) ? "Yesterday's" : null;
      const said = scanSentence(rec);
      const text = when ? `${when} ${said.replace(/^A scan/, "scan").replace(/^Free checks/, "free checks")}` : `${said}, ${dateOf(d.at)}`;
      const x = xs(i) - 10;
      const ny = y(series[i - 1].open) + 0.6 * (y(d.open) - y(series[i - 1].open));
      const width = text.length * 6.6;
      if (x - width < X0 + 8) return null;
      const clear = series.every((o, j) => j >= i || xs(j + 1) < x - width || y(o.open) > ny + 12);
      return clear && ny < BASE - 18 ? { x, y: ny, text } : null;
    }
    return null;
  })();

  const day = active === null ? null : series[active];
  const said = day ? happened(day, scans) : [];
  const readout = day ? `${day.open} open, ${dateOf(day.at)}${said.length ? `. ${said.join(". ")}` : ""}` : "";
  const label = `Open findings on each of the last ${plural(n, "day")}: ${last} open today, ${max} at most.`;

  return (
    <div className="lo-chart" ref={box}>
      <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" aria-label={label}>
        <path className="lo-ch-gl" d={`M${X0} ${y(top / 2)}H${right}`} />
        <path className="lo-ch-gl" d={`M${X0} ${y(top)}H${right}`} />
        <text x={0} y={BASE} dy=".35em">0</text>
        <text x={0} y={y(top / 2)} dy=".35em">{top / 2}</text>
        <text x={0} y={y(top)} dy=".35em">{top}</text>
        <path className="lo-ch-ar" d={area} />
        <path className="lo-ch-ax" d={`M${X0} ${BASE}H${right}`} />
        <path className="lo-ch-ln" d={line} />
        <circle className="lo-ch-end" cx={right} cy={y(last)} r={5} />
        <text className="lo-ch-endl" x={right} y={y(last) - 13} textAnchor="end">
          {last ? `${last} open today` : "Nothing open today"}
        </text>
        {note && (
          <text className="lo-ch-note" x={note.x} y={note.y} textAnchor="end">
            {note.text}
          </text>
        )}
        {series.map((d, i) => d.scans.length > 0 && <circle key={d.day} className="lo-ch-sc" cx={mid(i)} cy={281} r={3} />)}
        {labels.map(({ i, text }) => {
          const first = i === 0;
          const end = !first && mid(i) + 24 > w;
          return (
            <text key={i} x={first ? X0 : mid(i)} y={304} textAnchor={first ? "start" : end ? "end" : "middle"}>
              {text}
            </text>
          );
        })}
      </svg>
      <div
        className="lo-days l-focus"
        style={{ left: X0, top: TOP, width: right - X0, height: BASE - TOP }}
        tabIndex={0}
        role="group"
        aria-label="Read the chart day by day with the arrow keys"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setActive(Math.min(n - 1, Math.max(0, Math.floor((e.clientX - r.left) / step))));
        }}
        onMouseLeave={(e) => document.activeElement !== e.currentTarget && setActive(null)}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          const go = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -n : e.key === "End" ? n : 0;
          if (!go) return;
          e.preventDefault();
          setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + go)));
        }}
      >
        {day && active !== null && (
          <>
            <span className="lo-day-at" style={{ left: (active + 0.5) * step }} />
            <span className="lo-day-dot" style={{ left: (active + 0.5) * step, top: y(day.open) - TOP }} />
            <span className="lo-tip" data-side={mid(active) > X0 + (right - X0) / 2 ? "left" : "right"} style={{ left: (active + 0.5) * step }}>
              <b>{day.open} open</b>
              <span>{dateOf(day.at)}</span>
              {said.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </span>
          </>
        )}
      </div>
      <span className="l-sr-only" aria-live="polite">
        {readout}
      </span>
    </div>
  );
}

const midnightOf = (at: number) => new Date(new Date(at).toDateString()).getTime();
