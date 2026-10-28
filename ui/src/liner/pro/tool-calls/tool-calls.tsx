/*
  Liner Pro · Tool calls
  What an agent reached for, folded into one line: the tools' marks, how many and how long.
  While they run the line shimmers; open it for a row per call with its own state, time and,
  if you pass one, what went in and came out.
*/
import { useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Rays } from "../ai-kit/marks";
import { formatSeconds } from "../ai-kit/format";
import "../ai-kit/ai-kit.css";
import "./tool-calls.css";

export type ToolCall = {
  id: string;
  /** The tool's name, in mono: stripe.query. */
  name: string;
  /** What it was for, in words. */
  label?: string;
  icon?: ReactNode;
  state: "running" | "done" | "failed";
  seconds?: number;
  /** Input and output, shown when the row opens. */
  detail?: ReactNode;
};
export type ToolCallsProps = {
  calls: ToolCall[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

const Chev = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Tile = ({ call }: { call: ToolCall }) => <span className="l-tcalls__tile">{call.icon ?? <b>{call.name.charAt(0).toUpperCase()}</b>}</span>;

export function ToolCalls({ calls, open, defaultOpen = false, onOpenChange, className }: ToolCallsProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const [rows, setRows] = useState<string[]>([]);
  const running = calls.some((c) => c.state === "running");
  const failed = calls.filter((c) => c.state === "failed").length;
  const secs = calls.reduce((a, c) => a + (c.seconds ?? 0), 0);
  const toggle = () => {
    if (open === undefined) setInner(!isOpen);
    onOpenChange?.(!isOpen);
    feedback.play("tap", isOpen ? -1 : 1);
  };
  const word = running ? "Using tools" : failed ? `${failed} of ${calls.length} failed` : `Used ${calls.length} ${calls.length === 1 ? "tool" : "tools"}`;
  return (
    <div className={cx("l-tcalls", className)} data-open={isOpen || undefined}>
      <button type="button" className="l-tcalls__sum l-focus" aria-expanded={isOpen} onClick={toggle}>
        <span className="l-tcalls__tiles" aria-hidden>
          {calls.slice(0, 3).map((c) => (
            <Tile key={c.id} call={c} />
          ))}
        </span>
        <span className={running ? "l-tcalls__word l-shimmer" : "l-tcalls__word"} key={word}>
          {word}
        </span>
        <span className="l-tcalls__secs l-num">· {formatSeconds(secs)}</span>
        <Chev className="l-tcalls__chev" />
      </button>
      <div className="l-tcalls__fold" inert={!isOpen || undefined}>
        <ul className="l-tcalls__list">
          {calls.map((c, i) => {
            const rowOpen = rows.includes(c.id);
            return (
              <li key={c.id} className="l-tcalls__row" data-state={c.state} style={{ animationDelay: `${i * 50}ms` }}>
                <button
                  type="button"
                  className="l-tcalls__line l-focus"
                  aria-expanded={c.detail ? rowOpen : undefined}
                  disabled={!c.detail}
                  onClick={() => setRows((r) => (r.includes(c.id) ? r.filter((x) => x !== c.id) : [...r, c.id]))}
                >
                  <Tile call={c} />
                  <code>{c.name}</code>
                  {c.label && <span className="l-tcalls__label">{c.label}</span>}
                  <span className="l-tcalls__state" key={c.state}>
                    {c.state === "running" ? (
                      <Rays />
                    ) : c.state === "done" ? (
                      <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-tcalls__ok">
                        <path d="M3.8 8.4 6.6 11l5.6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-tcalls__bad">
                        <path d="m5 5 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    )}
                    <span className="l-sr-only">{c.state === "running" ? "running" : c.state === "done" ? "done" : "failed"}</span>
                  </span>
                  <span className="l-tcalls__time l-num">{c.seconds !== undefined ? formatSeconds(c.seconds) : ""}</span>
                  {c.detail && <Chev className="l-tcalls__chev" />}
                </button>
                {c.detail && (
                  <div className="l-tcalls__more" data-open={rowOpen || undefined} inert={!rowOpen || undefined}>
                    <div className="l-tcalls__detail">{c.detail}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
