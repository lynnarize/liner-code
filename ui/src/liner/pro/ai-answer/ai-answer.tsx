/*
  Liner Pro · AI answer
  One answered question with its sources, on the shared AI surface. It searches (the globe
  fills its ring as each source lands in a held place), writes (chunks come into focus),
  then rests with the model's mark and the shared action row. The search line folds the
  sources away once it is done. Citations and sources light each other.
*/
import { useEffect, useId, useRef, useState } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback as sound } from "../../lib/feedback";
import { CiteScope, type Source } from "../ai-kit/cite";
import { SourceMark, type AiPhase } from "../ai-kit/marks";
import { AiActions, AiWho, SourceCards, type AiModelRef, type AiVote } from "../ai-kit/surface";
import { StreamedMarkdown } from "../ai-kit/streamed";
import { toPlain } from "../ai-kit/markdown";
import "../ai-kit/ai-kit.css";
import "./ai-answer.css";

export type { Source };

export type AiAnswerProps = {
  question: string;
  sources: Source[];
  /** What was searched, shown while sources come in. Defaults to the question. */
  query?: string;
  /** Drive the search yourself: true while results arrive (grow `sources`), false once done.
      Leave it out and the sources land one after another. */
  searching?: boolean;
  /** Markdown with [n] citations. It may grow while streaming; a different text starts over. */
  answer: string;
  /** Earlier or alternative versions the pager can step through after a regenerate. */
  versions?: string[];
  /** More text is still coming from your model. */
  streaming?: boolean;
  animate?: boolean;
  /** Words per second while writing. */
  speed?: number;
  followUps?: string[];
  onFollowUp?: (question: string) => void;
  onRegenerate?: () => void;
  onStop?: () => void;
  onFeedback?: (value: "up" | "down", reason?: string) => void;
  feedbackReasons?: string[];
  /** Who answered; shown with its mark once the answer rests. */
  model?: AiModelRef;
  className?: string;
};

type Phase = "reading" | "writing" | "done" | "stopped";

export function AiAnswer(props: AiAnswerProps) {
  return (
    <CiteScope sources={props.sources} variant="named" className={cx("l-ans l-frame", props.className)}>
      <AnswerBody {...props} />
    </CiteScope>
  );
}

const Globe = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-ans-globe__ico">
    <circle cx="8" cy="8" r="6.1" stroke="currentColor" strokeWidth="1.15" />
    <path d="M1.9 8h12.2M8 1.9c1.7 1.7 2.5 3.7 2.5 6.1S9.7 12.4 8 14.1C6.3 12.4 5.5 10.4 5.5 8S6.3 3.6 8 1.9Z" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
  </svg>
);

function AnswerBody({
  question,
  sources,
  query,
  searching,
  answer,
  versions: extra = [],
  streaming = false,
  animate = true,
  speed = 46,
  followUps = [],
  onFollowUp,
  onRegenerate,
  onStop,
  onFeedback,
  feedbackReasons = ["Not accurate", "Wrong source", "Too long", "Out of date"],
  model = { id: "balanced", name: "Balanced" },
}: AiAnswerProps) {
  const [phase, setPhase] = useState<Phase>(animate ? "reading" : "done");
  const [run, setRun] = useState(0);
  const [version, setVersion] = useState(0);
  // Paging between versions shows them at once with a fade; only regenerate streams.
  const [paged, setPaged] = useState(false);
  // Versions exist only once regenerate has produced them.
  const [reached, setReached] = useState(1);
  const [vote, setVote] = useState<AiVote>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  const started = useRef(performance.now());
  const all = [answer, ...extra];
  const text = all[Math.min(version, all.length - 1)];

  // Searching: sources land one at a time into held places, then the writing starts. With
  // `searching` you drive it, and the answer starts writing once it turns false.
  const live = searching !== undefined;
  const [landed, setLanded] = useState(animate && !live ? 0 : sources.length);
  const [open, setOpen] = useState(true);
  const cardsId = useId();
  useEffect(() => {
    if (phase !== "reading") return;
    if (live) {
      if (!searching) setPhase("writing");
      return;
    }
    const t = landed < sources.length ? window.setTimeout(() => setLanded((n) => n + 1), landed ? 320 : 480) : window.setTimeout(() => setPhase("writing"), 560);
    return () => window.clearTimeout(t);
  }, [phase, landed, live, searching, sources.length]);
  const shown = live ? sources.length : landed;

  // The card glides to its new height instead of jumping.
  const innerRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useIsoLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function regenerate() {
    const next = extra.length ? Math.min(all.length - 1, reached) : version;
    setVersion(next);
    setReached((r) => Math.max(r, next + 1));
    setVote(null);
    setElapsed(null);
    started.current = performance.now();
    setRun((r) => r + 1);
    setPaged(false);
    setPhase("writing");
    onRegenerate?.();
  }

  const markPhase: AiPhase = phase === "reading" ? "reading" : phase === "writing" ? "writing" : phase === "stopped" ? "stopped" : "done";
  const working = phase === "reading" || phase === "writing";
  const reading = phase === "reading";
  // The ring fills a step with each source; driven from outside it turns until the search ends.
  const progress = live ? null : sources.length ? shown / sources.length : 1;

  return (
    <>
      <div className="l-ans-card l-frame-card" style={{ height: h ?? undefined }}>
        <div ref={innerRef} className="l-ans-inner">
          <h3 className="l-ans-q">{question}</h3>
          <button
            type="button"
            className="l-ans-search l-focus"
            data-reading={reading || undefined}
            aria-expanded={reading ? undefined : open}
            aria-controls={cardsId}
            disabled={reading}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="l-ans-globe" aria-hidden>
              <svg viewBox="0 0 28 28" data-spin={(reading && progress === null) || undefined}>
                <circle className="l-ans-globe__track" cx="14" cy="14" r="12.25" />
                <circle className="l-ans-globe__fill" cx="14" cy="14" r="12.25" pathLength={1} style={{ strokeDashoffset: reading ? 1 - (progress ?? 0.28) : 0 }} />
              </svg>
              <Globe />
            </span>
            <span className="l-ans-search-label" key={reading ? "s" : "d"}>
              {reading ? <span className="l-shimmer">Searching for “{query ?? question}”</span> : `Searched ${shown} ${shown === 1 ? "site" : "sites"}`}
            </span>
            <span className="l-ans-marks" aria-hidden>
              {sources.slice(0, Math.min(shown, 5)).map((s) => (
                <span key={s.title} className="l-ans-mark">
                  <SourceMark name={s.name} hue={s.hue} size={16} />
                </span>
              ))}
            </span>
            {!reading && (
              <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-ans-search-chev">
                <path d="m4.5 6.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <div id={cardsId} className="l-ans-cards" data-open={open || undefined} inert={!open || undefined}>
            <div className="l-ans-cards-in">
              <SourceCards sources={sources.slice(0, shown)} stagger={animate ? 0 : 110} slots={reading ? (live ? 2 : sources.length - shown) : 0} />
            </div>
          </div>

          <div className="l-ans-who" data-reading={reading || undefined} aria-live="polite">
            {reading ? (
              <span className="l-sr-only">Searching for {query ?? question}</span>
            ) : (
              <AiWho working={working} phase={markPhase} model={model} status={phase === "writing" ? `Writing from ${shown} ${shown === 1 ? "source" : "sources"}` : undefined} />
            )}
          </div>

          {phase !== "reading" && (
            <StreamedMarkdown
              key={`${run}-${version}`}
              className={paged ? "l-ans-md l-ans-paged" : "l-ans-md"}
              text={text}
              streaming={streaming}
              animate={animate && !paged}
              speed={speed}
              sentences
              paused={phase === "stopped"}
              onCaughtUp={() => {
                if (streaming) return;
                setPhase((p) => (p === "writing" ? "done" : p));
                if (!paged) setElapsed(((performance.now() - started.current) / 1000).toFixed(1));
              }}
            />
          )}

          {phase === "done" && followUps.length > 0 && (
            <div className="l-ans-follow">
              <span className="l-ans-follow-label">Related</span>
              {followUps.map((q, i) => (
                <button key={q} type="button" className="l-ans-follow-item l-focus" style={{ animationDelay: `${120 + i * 70}ms` }} onClick={() => onFollowUp?.(q)}>
                  {q}
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3.25 8h9.5M8.9 4.1 12.8 8l-3.9 3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="l-ans-foot l-frame-strip">
        {working ? (
          <button
            type="button"
            className="l-ans-stop l-focus"
            onClick={() => {
              setPhase("stopped");
              onStop?.();
              sound.play("tap", -2);
            }}
          >
            <span className="l-ans-stop-icon" aria-hidden />
            Stop
          </button>
        ) : (
          <AiActions
            copy={() => toPlain(text, sources)}
            onRegenerate={regenerate}
            vote={vote}
            onVote={(v) => {
              setVote(v);
              if (v === "up") onFeedback?.("up");
            }}
            reasons={feedbackReasons}
            onReason={(r) => onFeedback?.("down", r)}
            versions={{ index: version, count: reached, onPage: (dir) => (setPaged(true), setVersion((v) => v + dir)) }}
            took={elapsed ?? undefined}
            stopped={phase === "stopped"}
          />
        )}
      </div>
    </>
  );
}
