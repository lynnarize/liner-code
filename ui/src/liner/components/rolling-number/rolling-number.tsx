import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import "./rolling-number.css";

export type RollingNumberProps = {
  value: number;
  locale?: string;
  format?: Intl.NumberFormatOptions;
  className?: string;
  /** Stagger between digits, right to left, in ms. */
  stagger?: number;
};

type Dir = "up" | "down";

function Digit({ ch, dir, delay, grow }: { ch: string; dir: Dir; delay: number; grow: boolean }) {
  const [s, setS] = useState({ cur: ch, prev: null as string | null, n: 0, dir });
  // Only columns added after the first paint grow in; the initial number just sits there.
  const [growIn] = useState(grow);
  // Derive the swap during render so the outgoing digit is painted in the same frame.
  if (ch !== s.cur) setS({ cur: ch, prev: s.cur, n: s.n + 1, dir });
  const isDigit = /\d/.test(s.cur);
  return (
    <span className="l-roll__col" data-dir={s.dir} data-grow={growIn || undefined} data-sym={!isDigit || undefined} style={{ ["--delay" as string]: `${delay}ms` }}>
      <span className="l-roll__clip">
        <span key={s.n} className="l-roll__digit" data-enter={s.n > 0 || undefined}>
          {s.cur}
        </span>
        {s.prev !== null && (
          <span key={`o${s.n}`} className="l-roll__digit" data-exit onAnimationEnd={() => setS((x) => ({ ...x, prev: null }))}>
            {s.prev}
          </span>
        )}
      </span>
    </span>
  );
}

export function RollingNumber({ value, locale = "en-US", format, className, stagger = 22 }: RollingNumberProps) {
  const fmt = useMemo(() => new Intl.NumberFormat(locale, format), [locale, JSON.stringify(format)]);
  const text = fmt.format(value);
  const prevValue = useRef(value);
  const dir: Dir = value >= prevValue.current ? "up" : "down";
  const prevText = useRef(text);
  const [leaving, setLeaving] = useState<string>("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  useEffect(() => {
    // Columns that disappear collapse instead of vanishing in one frame.
    if (text.length < prevText.current.length) setLeaving(prevText.current.slice(0, prevText.current.length - text.length));
    else setLeaving("");
    prevText.current = text;
    prevValue.current = value;
  }, [text, value]);

  const chars = Array.from(text);
  return (
    <span className={cx("l-roll", className)} aria-label={text} role="text">
      <span aria-hidden className="l-roll__row">
        {Array.from(leaving).map((ch, i) => (
          <span key={`L${leaving.length - i + chars.length}`} className="l-roll__col" data-leaving onAnimationEnd={(e) => e.currentTarget === e.target && i === 0 && setLeaving("")}>
            <span className="l-roll__clip">
              <span className="l-roll__digit">{ch}</span>
            </span>
          </span>
        ))}
        {chars.map((ch, i) => {
          const pos = chars.length - 1 - i;
          return <Digit key={pos} ch={ch} dir={dir} delay={pos * stagger} grow={mounted.current} />;
        })}
      </span>
    </span>
  );
}
