/*
  A pull request, in the seamless skin, the way Commit and push draws its card: your commits as
  rows on a rail under "Merge into main", the base's line beside them, what reached the base in
  the meantime on it, each clash with its two lines, the checks in a list, and one status line
  that cross-blurs from step to step with the one thing to press beside it. In the thread it is a
  white card; in the panel it is the Pull request surface itself, in the panel's one frame (board
  PullRequest, 2026-11-25): its head says the state, its body is sections of rows, and its foot has the
  status line with the one thing to press, in ink. It runs the same PR agent Liner's PR flow does
  (create, resolve, merge), reported as events.
*/
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PrAgent, PrCheck, PrCommit, PrConflict, PrEvent, PrStage } from "@liner/pro/pr-flow/pr-flow";
import { useSeen } from "@liner/lib/hooks";
import { I, StateMark, StepMark } from "./icons";
import { plural } from "./model";
import { PaneBody, PaneButton, PaneFoot, PaneRow, PaneSection } from "./Pane";
import { bridge } from "./bridge";
import { Lines } from "./ui";

const BUSY: PrStage[] = ["creating", "checking", "resolving", "testing", "merging"];
const STATE: Record<PrCheck["state"], string> = { queued: "Queued", running: "Running", passed: "Passed", failed: "Failed" };
/** A check's mark: a step's shapes, the passed one's tick green (RULING 3), in the chat card and the panel alike. */
const CHECK_STEP = { queued: "waiting", running: "working", passed: "done", failed: "failed" } as const;
/** What the head says at each stage. */
const SAYS: Record<PrStage, string> = { idle: "Not opened", creating: "Opening", checking: "Checking", conflicts: "Conflicts", resolving: "Resolving", testing: "Testing", ready: "Ready", merging: "Merging", merged: "Merged" };

type Act = "open" | "resolve" | "merge" | "resume" | "view";
/** What the panel's head is told: the pull request's number and address once there is one, and the state as one word in its tone. */
export type PrHeadOf = { number?: number; url?: string; word: string; tone?: "ok" | "warn" };

/**
  In the panel (`variant="panel"`) the card draws the whole surface: `head` draws the head with the state it
  is handed, `what` is the section before the commits (the title and description, before one exists), `more`
  the sections after the checks (Reviews), and `by` who opened it.
*/
export function PrCard({ title, branch, base = "main", agent, diff, start, variant = "chat", head, what, more, by }: { title: string; branch: string; base?: string; agent: PrAgent; diff?: { add: number; del: number }; start?: boolean; variant?: "chat" | "panel"; head?: (s: PrHeadOf) => ReactNode; what?: ReactNode; more?: ReactNode; by?: string }) {
  const [stage, setStage] = useState<PrStage>("idle");
  const [commits, setCommits] = useState<PrCommit[]>([]);
  const [conflicts, setConflicts] = useState<PrConflict[]>([]);
  const [checks, setChecks] = useState<PrCheck[]>([]);
  const [status, setStatus] = useState("");
  const [pr, setPr] = useState<{ number: number; url?: string } | null>(null);
  const [note, setNote] = useState("");
  const [paused, setPaused] = useState(false);
  const [showFix, setShowFix] = useState(false);
  const step = useRef<keyof PrAgent>("create");
  const abort = useRef<AbortController | null>(null);
  const [ref, seen] = useSeen<HTMLElement>(Boolean(start));

  const emit = (e: PrEvent) => {
    if (e.type === "status") setStatus(e.text);
    else if (e.type === "stage") setStage(e.stage);
    else if (e.type === "commits") setCommits(e.commits);
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
      await agent[next](emit, ctl.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") emit({ type: "status", text: "Something went wrong. Try again." });
    }
  };
  useEffect(() => () => abort.current?.abort(), []);
  const begin = () => {
    if (stage !== "idle") return;
    setStage("creating");
    void run("create");
  };
  // `start` can come later (a PR opened from the chat while the panel shows none): seen is true already then.
  useEffect(() => {
    if (start && seen) begin();
  }, [seen, start]);

  const merged = stage === "merged";
  const busy = BUSY.includes(stage) && !paused;
  const mine = commits.filter((c) => c.lane === "branch" && !c.merge).reverse();
  const landed = commits.filter((c) => c.lane === "base");
  const open = conflicts.filter((k) => !k.resolved).length;
  const files = [...new Set(conflicts.map((k) => k.file))];
  const settled = conflicts.length > 0 && open === 0;
  const want: Act | null = paused ? "resume" : stage === "idle" ? "open" : stage === "conflicts" ? "resolve" : stage === "ready" ? "merge" : merged && pr?.url ? "view" : null;
  const line = stage === "idle" ? `Opens ${branch} into ${base}` : paused ? "Stopped. Continue when you're ready." : status || SAYS[stage];
  // Ready with a check failed is yours to decide, not a green tick: the note says you can merge anyway.
  const failing = stage === "ready" && checks.some((k) => k.state === "failed");
  const tone = stage === "conflicts" || failing ? "warn" : stage === "ready" || merged ? "ok" : undefined;
  const stop = () => {
    abort.current?.abort();
    setPaused(true);
  };

  if (variant === "panel") {
    const passed = checks.filter((k) => k.state === "passed").length;
    // The one thing to press, in ink and last; merged, Open on GitHub is the head's tool.
    const act =
      want === "open" ? { say: "Open a pull request", go: begin } : want === "resolve" ? { say: "Resolve conflicts", go: () => void run("resolve") } : want === "merge" ? { say: "Squash and merge", go: () => void run("merge") } : want === "resume" ? { say: "Continue", go: () => void run(step.current) } : null;
    return (
      <section ref={ref} className="lc-pr-card" data-stage={stage} data-busy={busy || undefined} aria-label={`Pull request: ${title}`}>
        {head?.({ number: pr?.number, url: pr?.url, word: merged ? "Merged" : stage === "ready" ? "Open" : SAYS[stage], tone: stage === "conflicts" || failing ? "warn" : stage === "ready" || merged || (pr && !busy) ? "ok" : undefined })}
        <PaneBody>
          <div className="lc-pr-top">
            <b className="lc-pr-name">{title}</b>
            <span className="lc-pr-way">
              <code title={branch}>{branch}</code>
              <I.forward size={12} />
              <code>{base}</code>
              {by && <span className="lc-pr-by">by {by}</span>}
              <span className="lc-grow" />
              {diff && diff.add + diff.del > 0 && <Lines added={diff.add} removed={diff.del} />}
            </span>
          </div>
          {note && (
            <p className="lc-pr-note" key={note}>
              {note.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part))}
            </p>
          )}
          {what}
          {conflicts.length > 0 && (
            <PaneSection label="Conflicts" note={settled ? `${plural(conflicts.length, "conflict")} resolved` : `${conflicts.length - open} of ${conflicts.length} resolved, in ${plural(files.length, "file")}`}>
              {settled && !showFix ? (
                <PaneRow icon={<StepMark state="done" size={14} />} opens onClick={() => setShowFix(true)}>
                  Show how each was resolved
                </PaneRow>
              ) : (
                <ul className="lc-prc-hunks lc-pr-hunks">
                  {conflicts.map((k) => (
                    <li key={k.id} data-done={k.resolved !== undefined || undefined} data-active={k.active || undefined}>
                      <span className="lc-prc-file">
                        {k.file}:{k.line}
                      </span>
                      {k.resolved !== undefined ? (
                        <code data-side="both">{k.resolved}</code>
                      ) : (
                        <>
                          <code data-side="base">
                            {k.base}
                            <em>{base}</em>
                          </code>
                          <code data-side="yours">
                            {k.yours}
                            <em>yours</em>
                          </code>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PaneSection>
          )}
          <PaneSection label="Commits" note={mine.length || undefined}>
            {mine.length ? (
              mine.map((c) => (
                <PaneRow key={c.id} icon={<I.commit size={14} />} value={c.hash} quiet>
                  {c.title}
                </PaneRow>
              ))
            ) : (
              <PaneRow icon={<I.commit size={14} />} quiet>
                <span className="lc-quiet">Nothing pushed yet</span>
              </PaneRow>
            )}
          </PaneSection>
          {landed.length > 0 && (
            <PaneSection label={`Reached ${base} meanwhile`} note={landed.length}>
              {landed.map((c) => (
                <PaneRow key={c.id} icon={<I.merge size={14} />} value={[c.who ?? c.hash?.slice(0, 7), c.when].filter(Boolean).join(" · ")} quiet>
                  {c.title}
                </PaneRow>
              ))}
            </PaneSection>
          )}
          {checks.length > 0 && (
            <PaneSection label="Checks" note={`${passed} of ${checks.length} passed`}>
              {checks.map((k) => (
                <PaneRow key={k.id} title={k.detail} icon={<StepMark state={CHECK_STEP[k.state]} tone={k.state === "passed" ? "ok" : undefined} size={14} />} value={k.result ?? STATE[k.state]} quiet>
                  {k.label}
                </PaneRow>
              ))}
            </PaneSection>
          )}
          {more}
        </PaneBody>
        <PaneFoot
          say={
            <span className="lc-pr-say" data-tone={tone} role="status">
              <span key={line.replace(/\d+/g, "#")}>{stage === "ready" && !status ? "Ready to merge" : line}</span>
            </span>
          }
        >
          {/* A merge asked for can't be called back, so there's nothing for Stop to stop. */}
          {busy && stage !== "merging" && <PaneButton onClick={stop}>Stop</PaneButton>}
          {act && (
            <PaneButton ink onClick={act.go}>
              {act.say}
            </PaneButton>
          )}
        </PaneFoot>
      </section>
    );
  }

  return (
    <section ref={ref} className="lc-prc" data-variant={variant} data-stage={stage} data-busy={busy || undefined} aria-label={`Pull request: ${title}`}>
      <div className="lc-prc-head">
        <span className="lc-prc-ttl">Pull request</span>
        {pr && <span className="lc-prc-num">#{pr.number}</span>}
        <span className="lc-ship-tag" title={branch}>
          {branch}
        </span>
        {/* The state is its coloured word alone, as the panel's head has it (board PullRequest). */}
        <span className="lc-prc-state" data-tone={tone} key={stage}>
          {merged ? "Merged" : stage === "ready" ? "Open" : SAYS[stage]}
        </span>
      </div>
      <div className="lc-prc-title">
        <b>{title}</b>
        {diff && diff.add + diff.del > 0 && (
          <span className="lc-prc-diff">
            <span className="plus">+{diff.add}</span>
            <span className="minus">−{diff.del}</span>
          </span>
        )}
      </div>
      <div className="lc-prc-rows">
        <div className="lc-ship-row lc-prc-row" style={{ "--d": "0ms" } as CSSProperties}>
          <svg className="lc-ship-rail" viewBox="0 0 30 30" aria-hidden>
            <path d="M8 19.5V30" className="rm" />
            {mine.length + landed.length > 0 && <path d="M20 30C20 22 8 24 8 19.5" className="rb dash" />}
            <circle cx="8" cy="15" r="4.5" className="ring" />
            <path d="M6.2 15.2l1.3 1.3 2.4-2.6" className="ck" />
          </svg>
          <span className="t3">Merge into {base}</span>
          <span className="lc-ship-meta lc-prc-meta">{merged ? "merged" : open ? plural(open, "conflict") : mine.length ? plural(mine.length, "commit") : "not pushed yet"}</span>
        </div>
        {mine.map((c) => (
          <div key={c.id} className="lc-ship-row lc-prc-row">
            <svg className="lc-ship-rail" viewBox="0 0 30 30" aria-hidden>
              <path d="M8 0V30" className="rm" />
              <path d="M20 0V30" className="rb" />
              <circle cx="20" cy="15" r="3.5" className="dot" />
            </svg>
            <span className="lc-ship-sub">{c.title}</span>
            {c.hash && <span className="lc-ship-meta">{c.hash}</span>}
          </div>
        ))}
        {landed.map((c) => (
          <div key={c.id} className="lc-ship-row lc-prc-row" data-landed>
            <svg className="lc-ship-rail" viewBox="0 0 30 30" aria-hidden>
              <path d="M8 0V30" className="rm" />
              <path d="M20 0V30" className="rb" />
              <circle cx="8" cy="15" r="3.5" className="dotw" />
            </svg>
            <span className="lc-ship-sub t2">{c.title}</span>
            <span className="lc-ship-meta">
              {c.who ?? c.hash?.slice(0, 7)}
              {c.when && <span>{c.when}</span>}
            </span>
          </div>
        ))}
        <div className="lc-ship-row lc-prc-row">
          <svg className="lc-ship-rail" viewBox="0 0 30 30" aria-hidden>
            <path d="M8 0V15" className="rm" />
            {mine.length + landed.length > 0 && <path d="M20 0C20 9 8 7 8 14" className="rb" />}
            <circle cx="8" cy="15" r="3.5" className="dotm" />
          </svg>
          <span className="lc-ship-tag" data-m>
            {base}
          </span>
          <span className="t3" title={branch}>
            where {branch} left it
          </span>
        </div>
      </div>
      {note && (
        <p className="lc-prc-note" key={note}>
          {note.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part))}
        </p>
      )}
      {conflicts.length > 0 && (
        <div className="lc-prc-fix">
          <button type="button" className="lc-prc-sum l-focus" data-done={settled || undefined} aria-expanded={!settled || showFix} onClick={() => setShowFix((s) => !s)}>
            {settled ? <I.check size={14} /> : <I.alert size={14} />}
            {settled ? `${plural(conflicts.length, "conflict")} resolved` : `${plural(conflicts.length, "conflict")} in ${plural(files.length, "file")}`}
            <span className="lc-prc-aside">{settled ? showFix ? <I.chevD size={14} /> : <I.chevR size={14} /> : `${conflicts.length - open} of ${conflicts.length} resolved`}</span>
          </button>
          {(!settled || showFix) && (
            <ul className="lc-prc-hunks">
              {conflicts.map((k) => (
                <li key={k.id} data-done={k.resolved !== undefined || undefined} data-active={k.active || undefined}>
                  <span className="lc-prc-file">
                    {k.file}:{k.line}
                  </span>
                  {k.resolved !== undefined ? (
                    <code data-side="both">{k.resolved}</code>
                  ) : (
                    <>
                      <code data-side="base">
                        {k.base}
                        <em>{base}</em>
                      </code>
                      <code data-side="yours">
                        {k.yours}
                        <em>yours</em>
                      </code>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {checks.length > 0 && (
        <div className="lc-prc-checks-row">
          <span className="lc-prc-lab">Checks</span>
          <ul className="lc-prc-checks" aria-label="Checks">
            {checks.map((k) => (
              <li key={k.id} data-state={k.state} title={k.detail}>
                <span className="lc-prc-ck" aria-hidden>
                  <StepMark state={CHECK_STEP[k.state]} tone={k.state === "passed" ? "ok" : undefined} size={12} />
                </span>
                {k.label}
                <span className="lc-prc-cm" key={k.state}>
                  {k.result ?? STATE[k.state]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="lc-prc-line">
        {/* The mark stays mounted while the words cross-blur, so a change of stage plays across its dots. */}
        <span className="lc-prc-status" data-tone={tone} role="status">
          {(busy || tone) && <StateMark state={busy ? "working" : tone === "warn" ? "needs" : merged ? "merged" : "ready"} size={14} />}
          <span key={line.replace(/\d+/g, "#")}>{stage === "ready" && !status ? "Ready to merge" : line}</span>
        </span>
        <span className="lc-grow" />
        {/* The one thing to press is ink, in the frame's button, as the panel's foot has it (RULING 1 and 2). */}
        {want === "open" && (
          <PaneButton ink icon={<I.pr size={14} />} onClick={begin}>
            Open a pull request
          </PaneButton>
        )}
        {want === "resolve" && (
          <PaneButton ink onClick={() => void run("resolve")}>
            Resolve conflicts
          </PaneButton>
        )}
        {want === "merge" && (
          <PaneButton ink onClick={() => void run("merge")}>
            Squash and merge
          </PaneButton>
        )}
        {want === "resume" && (
          <PaneButton ink onClick={() => void run(step.current)}>
            Continue
          </PaneButton>
        )}
        {want === "view" && pr?.url && (
          <PaneButton ink icon={<I.external size={14} />} onClick={() => bridge.openExternal(pr.url!)}>
            Open on GitHub
          </PaneButton>
        )}
        {/* A merge asked for can't be called back, so there's nothing for Stop to stop. */}
      </div>
    </section>
  );
}
