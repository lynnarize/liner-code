/*
  Liner Pro · PR flow
  An agent opening a pull request, as generative UI. The card is the pull request: your
  branch drawn as a line above main, the agent's note, and only what needs you right now.
  When main has moved on, its new commits arrive on the line below in amber and each
  conflict shows its two lines; resolving folds every pair into one. The checks fill in on
  their own, and merging settles the branch onto main until the two lines are one.

  Bring your own agent: `create`, `resolve` and `merge` each receive `emit` and an abort
  signal, and report progress as events. Without one, a simulated agent plays the story.

  Pass `composer` and the card sits in a conversation: a Create PR button over your
  composer, your request, and the agent's working line that opens into every step.
*/
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, useSeen } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Button } from "../../components/button/button";
import { Tooltip } from "../../components/tooltip/tooltip";
import { TextShimmer } from "../../components/text-shimmer/text-shimmer";
import { AiMark } from "../ai-kit/marks";
import { Strands } from "./strands";
import { simulatedPrAgent } from "./sample";
import "../ai-kit/ai-kit.css";
import "./pr-flow.css";

export type PrCommit = {
  id: string;
  title: string;
  /** Your branch, or the base: commits that reached it since you branched. */
  lane: "branch" | "base";
  hash?: string;
  who?: string;
  when?: string;
  /** A merge commit that brings the base into your branch. */
  merge?: boolean;
};
export type PrConflict = {
  id: string;
  file: string;
  line: number;
  /** The line as the base has it, and as your branch has it. */
  base: string;
  yours: string;
  /** The line that replaces both, once resolved. */
  resolved?: string;
  /** The base commit it clashes with; that commit's mark clears with its conflicts. */
  commit?: string;
  /** Being resolved right now. */
  active?: boolean;
};
export type PrCheck = {
  id: string;
  label: string;
  state: "queued" | "running" | "passed" | "failed";
  /** 0 to 1, for a running check that knows how far along it is. */
  progress?: number;
  result?: string;
  /** Shown on hover and focus. */
  detail?: string;
};
export type PrStage = "idle" | "creating" | "checking" | "conflicts" | "resolving" | "testing" | "ready" | "merging" | "merged";
export type PrEvent =
  | { type: "status"; text: string }
  | { type: "stage"; stage: PrStage }
  | { type: "commits"; commits: PrCommit[] }
  | { type: "conflicts"; conflicts: PrConflict[] }
  | { type: "checks"; checks: PrCheck[] }
  | { type: "pr"; number: number; url?: string }
  | { type: "message"; text: string };
export type PrAgent = {
  create: (emit: (e: PrEvent) => void, signal: AbortSignal) => Promise<void>;
  resolve: (emit: (e: PrEvent) => void, signal: AbortSignal) => Promise<void>;
  merge: (emit: (e: PrEvent) => void, signal: AbortSignal) => Promise<void>;
};
/** What a composer under the card gets: send a request, or stop the agent mid-step. */
export type PrChat = {
  busy: boolean;
  /** The first request opens the pull request; later ones take the step it is waiting on. */
  send: (text: string) => Promise<void>;
  stop: () => void;
};
export type PrFlowProps = {
  title: string;
  branch: string;
  base?: string;
  agent?: PrAgent;
  diff?: { add: number; del: number };
  /** Start when it scrolls into view, instead of waiting for Open pull request. */
  start?: boolean;
  /** Resolve and merge without waiting for presses. */
  autoPlay?: boolean;
  onStageChange?: (stage: PrStage) => void;
  /** Sets the card in a conversation, with your composer under it. Wire its send and stop to `chat`. */
  composer?: (chat: PrChat) => ReactNode;
  /** What the Create PR button asks for. */
  ask?: string;
  className?: string;
};

const BUSY: PrStage[] = ["creating", "checking", "resolving", "testing", "merging"];
const STATE: Record<PrCheck["state"], string> = { queued: "Queued", running: "Running", passed: "Passed", failed: "Failed" };
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Words that come into focus one after another; `code` spans keep their own look. */
function Words({ text }: { text: string }) {
  let n = 0;
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? (
          <code key={i} className="l-prf-word" style={{ animationDelay: `${n++ * 30}ms` }}>
            {part.slice(1, -1)}
          </code>
        ) : (
          part.split(/(\s+)/).map((w, k) =>
            /^\s+$/.test(w) || !w ? (
              w
            ) : (
              <span key={`${i}-${k}`} className="l-prf-word" style={{ animationDelay: `${n++ * 30}ms` }}>
                {w}
              </span>
            ),
          )
        ),
      )}
    </>
  );
}

/** Opens to its content's height; overflow shows again once it has settled, for tooltips. */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const [rest, setRest] = useState(open);
  useEffect(() => {
    if (!open) setRest(false);
  }, [open]);
  return (
    <div
      className="l-prf-fold"
      data-open={open || undefined}
      data-rest={(open && rest) || undefined}
      inert={!open || undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows") setRest(open);
      }}
    >
      <div className="l-prf-fold__in">{children}</div>
    </div>
  );
}

const Check = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico">
    <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Warn = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico">
    <path d="M8 6.25v3.25M8 11.4v.1M7.1 2.8 1.9 11.9a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5L8.9 2.8a1 1 0 0 0-1.8 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const MergeIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico">
    <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="11.5" cy="9" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M4.5 5.1v5.8M4.5 5.6c0 2.2 1.6 3.4 5.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const PrIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico">
    <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="11.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M4.5 5.1v5.8M11.5 10.9V6.6a2 2 0 0 0-2-2H7.4M8.8 3.1 7.3 4.6l1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FileIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico">
    <path d="M9 1.9H5a1.6 1.6 0 0 0-1.6 1.6v9A1.6 1.6 0 0 0 5 14.1h6a1.6 1.6 0 0 0 1.6-1.6V5.5L9 1.9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M9 2v3.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);
const Arrow = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico">
    <path d="M6 4h6v6M12 4l-7.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** One side of a conflict: the line number, the code, and whose it is. */
function Code({ side, no, text, tag, hidden }: { side: "base" | "yours" | "both"; no: number; text: string; tag: string; hidden: boolean }) {
  return (
    <div className="l-prf-code" data-side={side} aria-hidden={hidden || undefined}>
      <div>
        <p>
          <i aria-hidden>{no}</i>
          <span className="l-sr-only">{side === "both" ? "Resolved" : tag}: </span>
          <code>{text}</code>
          <em aria-hidden>{tag}</em>
        </p>
      </div>
    </div>
  );
}

/** A check's ring: dashed while queued, filling or turning while it runs, then a mark. */
function Ring({ state, progress }: { state: PrCheck["state"]; progress?: number }) {
  const spin = state === "running" && progress === undefined;
  return (
    <svg className="l-prf-ring" viewBox="0 0 20 20" data-state={state} data-spin={spin || undefined} aria-hidden>
      {state === "passed" || state === "failed" ? (
        <g className="l-prf-ring__done">
          <circle cx="10" cy="10" r="9" />
          <path d={state === "passed" ? "M6.2 10.3 8.7 12.7 13.8 7.4" : "M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4"} />
        </g>
      ) : (
        <>
          <circle className="l-prf-ring__track" cx="10" cy="10" r="8" />
          {state === "running" && <circle className="l-prf-ring__arc" cx="10" cy="10" r="8" pathLength={1} style={spin ? undefined : { strokeDashoffset: 1 - (progress ?? 0) }} />}
        </>
      )}
    </svg>
  );
}

const Chevron = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico">
    <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type Act = "open" | "resolve" | "merge" | "view" | "resume";

export function PrFlow({ title, branch, base = "main", agent: given, diff = { add: 482, del: 37 }, start, autoPlay, onStageChange, composer, ask = "Create PR", className }: PrFlowProps) {
  const agent = useRef(given ?? simulatedPrAgent());
  const [stage, setStage] = useState<PrStage>("idle");
  const [commits, setCommits] = useState<PrCommit[]>([]);
  const [conflicts, setConflicts] = useState<PrConflict[]>([]);
  const [checks, setChecks] = useState<PrCheck[]>([]);
  const [status, setStatus] = useState("");
  const [pr, setPr] = useState<{ number: number; url?: string } | null>(null);
  const [note, setNote] = useState("");
  const [showFix, setShowFix] = useState(false);
  // The conversation around the card: your request, every step the agent reported, its time.
  const [asked, setAsked] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [secs, setSecs] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const [paused, setPaused] = useState(false);
  const step = useRef<keyof PrAgent>("create");
  const abort = useRef<AbortController | null>(null);
  const [ref, seen] = useSeen<HTMLElement>(!!start);
  const card = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const emit = (e: PrEvent) => {
    if (e.type === "status") {
      setStatus(e.text);
      // Progress on the same step ("Running 3 of 42 tests") updates its line instead of adding one.
      const shape = (t?: string) => t?.replace(/\d+/g, "#");
      setLog((l) => (shape(l[l.length - 1]) === shape(e.text) ? [...l.slice(0, -1), e.text] : [...l, e.text]));
    } else if (e.type === "stage") {
      setStage(e.stage);
      onStageChange?.(e.stage);
      if (e.stage === "conflicts") feedback.play("error");
      if (e.stage === "ready" || e.stage === "merged") feedback.play("success");
    } else if (e.type === "commits") setCommits(e.commits);
    else if (e.type === "conflicts") setConflicts(e.conflicts);
    else if (e.type === "checks") setChecks(e.checks);
    else if (e.type === "pr") setPr({ number: e.number, url: e.url });
    else setNote(e.text);
  };
  const run = async (next: keyof PrAgent) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    step.current = next;
    setPaused(false);
    try {
      await agent.current[next](emit, ctl.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") emit({ type: "status", text: "Something went wrong. Try again." });
    }
  };
  useEffect(() => () => abort.current?.abort(), []);

  const begin = () => {
    if (stage !== "idle") return Promise.resolve();
    setStage("creating");
    feedback.play("tap", 2);
    return run("create");
  };
  // Stopping pauses where it is; Continue, or the next message, runs that step again.
  const stop = () => {
    if (!BUSY.includes(stage) || paused) return;
    abort.current?.abort();
    setPaused(true);
    emit({ type: "status", text: "Stopped. Continue when you are ready." });
  };
  const send = (text: string) => {
    if (paused) return run(step.current);
    if (stage === "idle") {
      setAsked(text.trim() || ask);
      return begin();
    }
    if (stage === "conflicts") return run("resolve");
    if (stage === "ready") return run("merge");
    return Promise.resolve();
  };
  useEffect(() => {
    if (start && seen) composer ? send(ask) : begin();
  }, [seen]);
  // With autoPlay, the presses happen on their own after a beat.
  useEffect(() => {
    if (!autoPlay) return;
    const next = stage === "conflicts" ? "resolve" : stage === "ready" ? "merge" : null;
    if (!next) return;
    const t = window.setTimeout(() => run(next), 1800);
    return () => window.clearTimeout(t);
  }, [stage, autoPlay]);

  const merged = stage === "merged";
  const busy = BUSY.includes(stage) && !paused;
  // The working line counts whole seconds, and only while the agent works.
  useEffect(() => {
    if (!busy || !composer) return;
    const t0 = performance.now() - secs * 1000;
    const id = window.setInterval(() => setSecs(Math.floor((performance.now() - t0) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [busy]);
  const mine = commits.filter((c) => c.lane === "branch" && !c.merge).length;
  const landed = commits.filter((c) => c.lane === "base").length;
  const open = conflicts.filter((k) => !k.resolved).length;
  const files = [...new Set(conflicts.map((k) => k.file))];
  const settled = conflicts.length > 0 && open === 0;
  const fixOpen = stage === "conflicts" || stage === "resolving" || (settled && showFix);
  const progress = checks.length ? checks.reduce((s, k) => s + (k.state === "passed" || k.state === "failed" ? 1 : k.state === "running" ? (k.progress ?? 0) : 0), 0) / checks.length : 0;
  const picture = [
    mine ? `${count(mine, "commit")} on ${branch}` : `${branch}, not pushed yet`,
    landed ? `${count(landed, "new commit")} on ${base}` : null,
    open ? `${count(open, "conflict")}` : null,
    merged ? `merged into ${base}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  // The one thing to press appears when it is your turn, and steps aside quickly once pressed.
  const want: Act | null = paused ? "resume" : stage === "idle" ? "open" : stage === "conflicts" ? "resolve" : stage === "ready" ? "merge" : merged && pr?.url ? "view" : null;
  const [act, setAct] = useState<Act | null>(want);
  const [leaving, setLeaving] = useState(false);
  const actRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (want === act) {
      setLeaving(false);
      return;
    }
    if (!act) {
      setAct(want);
      return;
    }
    if (actRef.current?.contains(document.activeElement)) card.current?.focus({ preventScroll: true });
    setLeaving(true);
    const t = window.setTimeout(() => {
      setAct(want);
      setLeaving(false);
    }, 150);
    return () => window.clearTimeout(t);
  }, [want, act]);

  const action =
    act === "open" ? (
      <Button size="sm" onClick={begin}>
        Open pull request
      </Button>
    ) : act === "resolve" ? (
      <Button size="sm" onClick={() => stage === "conflicts" && run("resolve")}>
        Resolve conflicts
      </Button>
    ) : act === "merge" ? (
      <Button size="sm" icon={<MergeIcon />} onClick={() => stage === "ready" && run("merge")}>
        Merge
      </Button>
    ) : act === "resume" ? (
      <Button size="sm" onClick={() => paused && run(step.current)}>
        Continue
      </Button>
    ) : act === "view" ? (
      <a className="l-prf__link" href={pr?.url} target="_blank" rel="noreferrer">
        View pull request
        <Arrow />
      </a>
    ) : null;

  const tone = stage === "conflicts" ? "warn" : stage === "ready" ? "ok" : merged ? "done" : undefined;
  const icon = busy ? <AiMark phase="thinking" size={16} /> : paused ? null : stage === "conflicts" ? <Warn /> : stage === "ready" ? <Check /> : merged ? <MergeIcon /> : null;

  const section = (
    <section
      ref={(el) => {
        card.current = el;
        if (!composer) ref.current = el;
      }}
      className={cx("l-prf l-frame", !composer && className)}
      data-stage={stage}
      data-open={pr ? "" : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="l-frame-card l-prf__card">
        <header className="l-prf__head">
          <span className="l-prf__glyph" aria-hidden>
            <span key={merged ? "m" : "o"}>{merged ? <MergeIcon /> : <PrIcon />}</span>
          </span>
          <div className="l-prf__id">
            <b className="l-prf__title" id={titleId}>
              {title}
            </b>
            <p className="l-prf__meta">
              {pr && <span key="n">#{pr.number}</span>}
              {mine > 0 && <span key="c">{count(mine, "commit")}</span>}
              <span key="d" className="l-prf__diff">
                <span className="l-sr-only">
                  {diff.add} lines added, {diff.del} removed
                </span>
                <b data-tone="add" aria-hidden>
                  +{diff.add}
                </b>
                <b data-tone="del" aria-hidden>
                  −{diff.del}
                </b>
              </span>
            </p>
          </div>
          {pr && (
            <span className="l-prf__pill" data-state={merged ? "merged" : "open"} key={merged ? "m" : "o"}>
              {merged ? "Merged" : "Open"}
            </span>
          )}
        </header>

        <Strands stage={stage} branch={branch} base={base} commits={commits} conflicts={conflicts} progress={progress} label={picture} />

        {note && (
          <p className="l-prf__note" key={note}>
            <Words text={note} />
          </p>
        )}

        <Fold open={conflicts.length > 0}>
          <div className="l-prf__fix">
            {settled ? (
              <button type="button" className="l-prf-sum" data-done="" aria-expanded={fixOpen} onClick={() => setShowFix((s) => !s)}>
                <Check />
                <span key="d">{count(conflicts.length, "conflict")} resolved</span>
                <span className="l-prf-sum__aside">{fixOpen ? "Hide" : "Show"}</span>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-prf-ico l-prf-sum__chev">
                  <path d="m4.5 6.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <div className="l-prf-sum">
                <Warn />
                <span key="o">
                  {count(conflicts.length, "conflict")} in {count(files.length, "file")}
                </span>
                <span className="l-prf-sum__aside">
                  {conflicts.length - open} of {conflicts.length} resolved
                </span>
              </div>
            )}
            <Fold open={fixOpen}>
              <ul className="l-prf-files">
                {files.map((f) => {
                  const list = conflicts.filter((k) => k.file === f);
                  const left = list.filter((k) => !k.resolved).length;
                  return (
                    <li key={f} className="l-prf-file">
                      <div className="l-prf-file__head">
                        <FileIcon />
                        <span className="l-prf-file__name">{f}</span>
                        <span className="l-prf-file__state" data-done={!left || undefined} key={left ? "o" : "d"}>
                          {left ? count(left, "conflict") : "Resolved"}
                        </span>
                      </div>
                      <ol className="l-prf-hunks">
                        {list.map((k) => (
                          <li key={k.id} className="l-prf-hunk" data-done={k.resolved !== undefined || undefined} data-active={k.active || undefined}>
                            <Code side="base" no={k.line} text={k.base} tag={base} hidden={k.resolved !== undefined} />
                            <Code side="yours" no={k.line} text={k.yours} tag="yours" hidden={k.resolved !== undefined} />
                            <Code side="both" no={k.line} text={k.resolved ?? ""} tag="both" hidden={k.resolved === undefined} />
                          </li>
                        ))}
                      </ol>
                    </li>
                  );
                })}
              </ul>
            </Fold>
          </div>
        </Fold>

        <Fold open={checks.length > 0}>
          <ul className="l-prf__checks" aria-label="Checks">
            {checks.map((k, i) => {
              const tile = (
                <button type="button" className="l-prf-check" data-state={k.state}>
                  <Ring state={k.state} progress={k.progress} />
                  <span className="l-prf-check__text">
                    <b>{k.label}</b>
                    <span key={k.state}>{k.result ?? STATE[k.state]}</span>
                  </span>
                </button>
              );
              return (
                <li key={k.id} style={{ animationDelay: `${i * 60}ms` }}>
                  {k.detail ? <Tooltip content={k.detail}>{tile}</Tooltip> : tile}
                </li>
              );
            })}
          </ul>
        </Fold>
      </div>

      <div className="l-frame-strip l-prf__strip">
        <p className="l-prf__status" data-tone={tone} role="status">
          {icon && (
            <span className="l-prf__status-ico" key={busy ? "busy" : stage}>
              {icon}
            </span>
          )}
          <span className="l-prf__status-text" key={stage === "idle" ? "idle" : status.replace(/\d+/g, "#")}>
            {stage === "idle" ? (
              <>
                Opens <code>{branch}</code> into <code>{base}</code>
              </>
            ) : (
              status
            )}
          </span>
        </p>
        {action && (
          <span ref={actRef} className="l-prf__act" key={act} data-out={leaving || undefined} inert={leaving || undefined}>
            {action}
          </span>
        )}
      </div>
    </section>
  );
  if (!composer) return section;

  return (
    <div
      ref={(el) => {
        ref.current = el;
      }}
      className={cx("l-prf-chat", className)}
      data-stage={stage}
    >
      {asked && (
        <>
          <p className="l-prf-ask">{asked}</p>
          <div className="l-prf-work">
            <button type="button" className="l-prf-work__line l-focus" aria-expanded={showLog} onClick={() => setShowLog((s) => !s)}>
              <Chevron />
              {busy ? <TextShimmer>Working</TextShimmer> : <span key="w">Worked for</span>}
              <span className="l-prf-work__secs">{secs}s</span>
            </button>
            <Fold open={showLog}>
              <ol className="l-prf-work__log" aria-label="Steps">
                {log.map((l, i) => (
                  <li key={`${i}${l}`}>
                    {i === log.length - 1 && busy ? <AiMark phase="thinking" size={14} /> : <Check />}
                    <span>{l}</span>
                  </li>
                ))}
              </ol>
            </Fold>
          </div>
        </>
      )}
      {stage !== "idle" && section}
      <Fold open={stage === "idle"}>
        <div className="l-prf-starters">
          <button type="button" className="l-prf-start l-focus" onClick={() => send(ask)}>
            <PrIcon />
            {ask}
          </button>
        </div>
      </Fold>
      {composer({ busy, send, stop })}
    </div>
  );
}
