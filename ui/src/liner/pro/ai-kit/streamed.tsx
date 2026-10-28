import { useEffect, useMemo, useRef } from "react";
import { useReveal } from "./stream";
import { parseMarkdown, renderMarkdown } from "./markdown";
import { Cite, useCites } from "./cite";
import "./ai-kit.css";

export type StreamedMarkdownProps = {
  text: string;
  /** More text is still coming; keeps the reply busy after the reveal catches up. */
  streaming?: boolean;
  /** False renders at once: history, regenerate-off, reduced motion. */
  animate?: boolean;
  speed?: number;
  /** Wrap sentences so a citation can tint the one it supports. */
  sentences?: boolean;
  /** Freeze the reveal where it is, for Stop. */
  paused?: boolean;
  onCaughtUp?: () => void;
  /** Called on every revealed chunk, for scroll-following. */
  onGrow?: () => void;
  className?: string;
};

export function StreamedMarkdown({ text, streaming = false, animate = true, speed, sentences, paused, onCaughtUp, onGrow, className }: StreamedMarkdownProps) {
  const r = useReveal(text, { animate, streaming, speed, paused });
  const cites = useCites();
  const shown = text.slice(0, r.end);
  const blocks = useMemo(() => parseMarkdown(shown), [shown]);
  const growRef = useRef(onGrow);
  growRef.current = onGrow;
  // Block body on purpose: an effect must return nothing or a cleanup function.
  useEffect(() => {
    growRef.current?.();
  }, [r.end]);
  // "Done" means revealed to the end and nothing more coming, whichever happens last.
  const finished = r.caughtUp && !streaming && !paused;
  const doneRef = useRef(onCaughtUp);
  doneRef.current = onCaughtUp;
  useEffect(() => {
    if (finished) doneRef.current?.();
  }, [finished]);

  const lit = cites?.lit;
  const writing = !paused && !(r.caughtUp && !streaming);
  return (
    <div className={className ? `l-md ${className}` : "l-md"} aria-busy={writing || undefined}>
      {renderMarkdown(blocks, {
        chunks: r.settled ? null : r.chunks,
        sentences,
        litSentence: lit?.from === "cite" ? lit.sentence : null,
        litSources: lit?.from === "card" ? lit.sources : null,
        renderCite: (ids, at, sentence) => <Cite key={at} ids={ids} at={at} sentence={sentence} />,
      })}
    </div>
  );
}
