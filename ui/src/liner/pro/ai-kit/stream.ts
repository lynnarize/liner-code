/*
  The reveal clock behind every streamed reply.

  Text can arrive from a model in any chunk size; the clock paces it. Every tick
  (~34ms) it reveals a few whole words and records where that chunk starts, so the
  renderer can wrap each chunk in its own span. Spans already on screen keep their
  keys and never re-render, move or re-animate. Shortly after the last chunk the
  reply "settles" and the renderer drops the spans for plain text.
*/
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../lib/spring";

export type RevealState = {
  /** Characters of the source shown so far. */
  end: number;
  /** Source offsets where each revealed chunk begins, ascending. */
  chunks: number[];
  /** Everything currently known has been revealed. */
  caughtUp: boolean;
  /** Caught up, no more text coming, and the last chunk has finished fading. */
  settled: boolean;
};

const TICK = 34;
const SETTLE = 240;

/** End offsets of whole words (a word plus its trailing whitespace). */
function wordEnds(text: string, from: number) {
  const ends: number[] = [];
  const re = /\S+\s*/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ends.push(m.index + m[0].length);
  return ends;
}

export function useReveal(
  text: string,
  opts: {
    /** Animate the reveal. False shows everything at once (history, reduced motion). */
    animate?: boolean;
    /** More text is still coming from the model. */
    streaming?: boolean;
    /** Words per second. */
    speed?: number;
    /** Freeze where it is (Stop). */
    paused?: boolean;
    onCaughtUp?: () => void;
  } = {},
): RevealState {
  const { animate = true, streaming = false, speed = 90, paused = false, onCaughtUp } = opts;
  const instant = !animate || prefersReducedMotion();
  const [state, setState] = useState<RevealState>(() =>
    instant ? { end: text.length, chunks: [0], caughtUp: true, settled: !streaming } : { end: 0, chunks: [], caughtUp: text.length === 0, settled: false },
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const textRef = useRef(text);
  const cbRef = useRef(onCaughtUp);
  cbRef.current = onCaughtUp;

  // A different text (not a continuation) starts over.
  useEffect(() => {
    const prev = textRef.current;
    textRef.current = text;
    if (!text.startsWith(prev.slice(0, stateRef.current.end))) {
      setState(instant ? { end: text.length, chunks: [0], caughtUp: true, settled: !streaming } : { end: 0, chunks: [], caughtUp: false, settled: false });
    } else if (instant) {
      setState({ end: text.length, chunks: [0], caughtUp: true, settled: !streaming });
    }
  }, [text, instant, streaming]);

  // The clock: runs only while there is something left to reveal.
  useEffect(() => {
    if (instant || paused || state.end >= text.length) return;
    const perTick = Math.max(1, (speed * TICK) / 1000);
    let last = performance.now();
    let carry = 0;
    let raf = requestAnimationFrame(function step(now) {
      if (now - last >= TICK) {
        last = now;
        // Whole words only, with a little variance so the rhythm doesn't feel mechanical.
        carry += perTick * (0.8 + Math.random() * 0.4);
        const take = Math.floor(carry);
        if (take > 0) {
          carry -= take;
          const s = stateRef.current;
          const ends = wordEnds(textRef.current, s.end);
          if (ends.length) {
            const nextEnd = ends[Math.min(take, ends.length) - 1];
            setState({ end: nextEnd, chunks: [...s.chunks, s.end], caughtUp: nextEnd >= textRef.current.length, settled: false });
            if (nextEnd >= textRef.current.length) return;
          }
        }
      }
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [text, instant, speed, paused, state.end >= text.length]);

  useEffect(() => {
    if (state.caughtUp) cbRef.current?.();
  }, [state.caughtUp]);

  // Settle into plain strings once the last chunk has faded and nothing more is coming.
  useEffect(() => {
    if (!(state.caughtUp || paused) || streaming || state.settled) return;
    const t = window.setTimeout(() => setState((s) => ({ ...s, settled: true })), SETTLE);
    return () => window.clearTimeout(t);
  }, [state.caughtUp, paused, streaming, state.settled]);

  return state;
}
