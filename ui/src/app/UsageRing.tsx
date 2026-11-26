/*
  The usage ring in the message box, beside who works on it (board Approve, 2026-11-26): a small ring and "38%" for the
  chosen tool's busiest plan window right now, its tooltip "Claude Code: 38% of the 5-hour limit used". It follows the
  tool picked in the box, and isn't there when that tool reports no limit (an API key, the Demo). The numbers are the
  ones the sidebar's foot ring used to show (EngineState.limits, which the engine keeps as each tool reports them).
  Pressing it opens Usage and cost, where every window of every tool is.
*/
import { useEffect, useState } from "react";
import { useEngine } from "./engine";
import { ringOf } from "./worklists-logic";
import "./usage-ring.css";

export function UsageRing({ model }: { model?: string }) {
  const limits = useEngine((s) => s.limits);
  // A window's reset passing empties it: the ring looks again now and then, not on every render.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const ring = model ? ringOf(limits, model, now) : null;
  if (!ring) return null;
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <button type="button" className="lc-uring l-focus" data-high={ring.high || undefined} title={ring.tip} aria-label={`${ring.tip}. Open Usage and cost`} onClick={() => window.dispatchEvent(new CustomEvent("lc:usage"))}>
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.75" />
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray={c} strokeDashoffset={c * (1 - ring.pct / 100)} strokeLinecap="round" transform="rotate(-90 7 7)" />
      </svg>
      <span>{ring.pct}%</span>
    </button>
  );
}
