/*
  A pull request, in the seamless skin, the way Commit and push draws its card: your commits as
  rows on a rail under "Merge into main", the base's line beside them, what reached the base in
  the meantime on it, each clash with its two lines, the checks in a list, and one status line
  that cross-blurs from step to step with the one thing to press beside it. In the thread it is a
  white card; in the panel it sits on the paper. It runs the same PR agent Liner's PR flow does
  (create, resolve, merge), reported as events.
*/
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PrAgent, PrCheck, PrCommit, PrConflict, PrEvent, PrStage } from "@liner/pro/pr-flow/pr-flow";
import { useSeen } from "@liner/lib/hooks";
import { I } from "./icons";
import { plural } from "./model";

const BUSY: PrStage[] = ["creating", "checking", "resolving", "testing", "merging"];
const STATE: Record<PrCheck["state"], string> = { queued: "Queued", running: "Running", passed: "Passed", failed: "Failed" };
/** What the head says at each stage. */
const SAYS: Record<PrStage, string> = { idle: "Not opened", creating: "Opening", checking: "Checking", conflicts: "Conflicts", resolving: "Resolving", testing: "Testing", ready: "Ready", merging: "Merging", merged: "Merged" };

type Act = "open" | "resolve" | "merge" | "resume" | "view";

export function PrCard({ title, branch, base = "main", agent, diff, start, variant = "chat" }: { title: string; branch: string; base?: string; agent: PrAgent; diff?: { add: number; del: number }; start?: boolean; variant?: "chat" | "panel" }) {
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
  useEffect(() => {
    if (start && seen) begin();
  }, [seen]);

  const merged = stage === "merged";
  const busy = BUSY.includes(stage) && !paused;
  const mine = commits.filter((c) => c.lane === "branch" && !c.merge).reverse();
  const landed = commits.filter((c) => c.lane === "base");
  const open = conflicts.filter((k) => !k.resolved).length;
  const files = [...new Set(conflicts.map((k) => k.file))];
  const settled = conflicts.length > 0 && open === 0;
  const want: Act | null = paused ? "resume" : stage === "idle" ? "open" : stage === "conflicts" ? "resolve" : stage === "ready" ? "merge" : merged && pr?.url ? "view" : null;
  const line = stage === "idle" ? `Opens ${branch} into ${base}` : paused ? "Stopped. Continue when you're ready." : status || SAYS[stage];
  const tone = stage === "conflicts" ? "warn" : stage === "ready" || merged ? "ok" : undefined;

  return (
    <section ref={ref} className="lc-prc" data-variant={variant} data-stage={stage} data-busy={busy || undefined} aria-label={`Pull request: ${title}`}>
      <div className="lc-prc-head">
        <span className="lc-prc-ttl">Pull request</span>
        {pr && <span className="lc-prc-num">#{pr.number}</span>}
        <span className="lc-ship-tag">{branch}</span>
        <span className="lc-prc-state" data-tone={tone} key={stage}>
          {(stage === "ready" || merged || (pr && !busy && stage !== "conflicts")) && <i />}
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
          <span className="t3">where {branch} left it</span>
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
            {settled ? <I.check size={13} /> : <I.alert size={13} />}
            {settled ? `${plural(conflicts.length, "conflict")} resolved` : `${plural(conflicts.length, "conflict")} in ${plural(files.length, "file")}`}
            <span className="lc-prc-aside">{settled ? (showFix ? "Hide" : "Show") : `${conflicts.length - open} of ${conflicts.length} resolved`}</span>
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
                  {k.state === "passed" ? <I.check size={13} /> : k.state === "failed" ? <I.close size={12} /> : <span />}
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
        <span className="lc-prc-status" data-tone={tone} role="status" key={line.replace(/\d+/g, "#")}>
          {busy ? <span className="lc-ship-spin" aria-hidden /> : tone === "ok" ? <I.check size={14} /> : tone === "warn" ? <I.alert size={14} /> : null}
          <span className={busy ? "l-shimmer" : undefined}>{stage === "ready" && !status ? "Ready to merge" : line}</span>
        </span>
        <span className="lc-grow" />
        {want === "open" && (
          <button type="button" className="lc-btn" data-kind="accent" data-size="sm" onClick={begin}>
            <I.pr size={13} />
            Open a pull request
          </button>
        )}
        {want === "resolve" && (
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => void run("resolve")}>
            Resolve conflicts
          </button>
        )}
        {want === "merge" && (
          <button type="button" className="lc-btn" data-kind="accent" data-size="sm" onClick={() => void run("merge")}>
            Squash and merge
          </button>
        )}
        {want === "resume" && (
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void run(step.current)}>
            Continue
          </button>
        )}
        {want === "view" && (
          <a className="lc-btn" data-kind="plain" data-size="sm" href={pr?.url} target="_blank" rel="noreferrer">
            View pull request
          </a>
        )}
        {busy && variant === "panel" && (
          <button
            type="button"
            className="lc-btn"
            data-kind="ghost"
            data-size="sm"
            onClick={() => {
              abort.current?.abort();
              setPaused(true);
            }}
          >
            Stop
          </button>
        )}
      </div>
    </section>
  );
}
