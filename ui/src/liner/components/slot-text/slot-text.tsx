/*
  Liner · Slot text
  Text that arrives like a departures board: each character spins through a few others and
  lands, left to right, a moment apart. Spaces and unchanged characters stay still.
*/
import { useEffect, useMemo, useRef } from "react";
import { cx } from "../../lib/hooks";
import "./slot-text.css";

export type SlotTextProps = {
  children: string;
  /** Characters to spin through. */
  charset?: string;
  /** How many characters each column passes before landing. */
  spins?: number;
  /** Delay between columns, ms. */
  stagger?: number;
  className?: string;
};

const DEFAULT = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function SlotText({ children, charset = DEFAULT, spins = 6, stagger = 45, className }: SlotTextProps) {
  const prev = useRef("");
  const run = useRef(0);
  // The previous text is recorded after each commit, so rendering twice changes nothing.
  useEffect(() => {
    prev.current = children;
  }, [children]);
  const cols = useMemo(() => {
    const before = prev.current;
    run.current += 1;
    // A small seeded scramble per column, so a re-render with the same text doesn't respin.
    let s = children.length * 31 + run.current * 7;
    const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from(children).map((ch, i) => {
      const still = ch === " " || before[i] === ch;
      const strip = still ? [ch] : [before[i] ?? " ", ...Array.from({ length: spins }, () => charset[Math.floor(rand() * charset.length)]), ch];
      return { ch, strip, still, key: `${run.current}-${i}` };
    });
  }, [children]);
  return (
    <span className={cx("l-slot", className)} aria-label={children}>
      {cols.map((c, i) => (
        <span key={c.still ? `s${i}${c.ch}` : c.key} className="l-slot__col" aria-hidden>
          <span className="l-slot__ghost">{c.ch === " " ? " " : c.ch}</span>
          <span className="l-slot__strip" data-still={c.still || undefined} style={{ ["--n" as string]: c.strip.length - 1, animationDelay: `${i * stagger}ms` }}>
            {c.strip.map((x, k) => (
              <span key={k}>{x === " " ? " " : x}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
