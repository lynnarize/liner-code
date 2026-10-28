/*
  Routines: work that runs on its own. The list shows each routine with who does its reading
  and auditing, the run in progress step by step, and its last runs; whatever waits for you
  has a Review. A run opens as its own tab: why it did what it did, rule by rule, and the run
  step by step. The builder draws a routine on Liner's workflow canvas: the trigger, the AI
  steps, the gate (code, not a model) with its two paths, and the actions on each.
*/
import type { Routine, RoutineRun, RoutineStep, Trigger } from "@contracts";
import { Switch } from "@liner/components/switch/switch";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, duration, compact, modelLabel, plural, since } from "./model";
import { Badge, ModelTag } from "./ui";
import { markOf } from "./model";

/* ---------- Words ---------- */

export const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
export function triggerText(t: Trigger) {
  if (t.kind === "schedule") return t.every === "hour" ? "Every hour" : t.every === "day" ? `Every day at ${t.at ?? "09:00"}` : t.every === "weekday" ? `Weekdays at ${t.at ?? "09:00"}` : `${DAYS[t.day ?? 1]} at ${t.at ?? "09:00"}`;
  if (t.kind === "github") return t.event === "pr.opened" ? (t.outside ? "When someone outside the team opens a pull request" : "When a pull request opens") : "When an issue is opened";
  if (t.kind === "webhook") return "When its webhook is called";
  return "When you run it";
}
const ROLE = { read: "reads", work: "works", audit: "audits" } as const;
export const ACTION: Record<string, string> = { merge: "Squash and merge", comment: "Comment", label: "Add a label", close: "Close it", inbox: "Hand it to you", notify: "Tell you" };

/** "Comments, and merges when 5 rules hold". */
function outcomeText(r: Routine) {
  const gate = r.steps.find((s): s is Extract<RoutineStep, { kind: "gate" }> => s.kind === "gate");
  const acts = r.steps.filter((s): s is Extract<RoutineStep, { kind: "action" }> => s.kind === "action");
  const pass = acts.filter((a) => a.when === "pass").map((a) => ACTION[a.action].toLowerCase());
  const other = acts.filter((a) => a.when !== "pass").map((a) => ACTION[a.action].toLowerCase());
  const work = r.steps.some((s) => s.kind === "ai" && s.role === "work");
  const parts: string[] = [];
  if (work) parts.push("does the work in a session");
  if (other.length) parts.push(other.join(", "));
  if (pass.length) parts.push(`${pass.join(", ")} when ${gate ? plural(gate.rules.length, "rule") : "every step"} ${gate && gate.rules.length === 1 ? "holds" : "hold"}`);
  const s = parts.join(", and ") || "Reports in its session";
  return s[0].toUpperCase() + s.slice(1);
}

const runTone = (r: RoutineRun) => (r.status === "merged" ? "accent" : r.status === "done" ? "ok" : r.status === "handed" ? "warn" : r.status === "failed" ? "danger" : "neutral");
const runWord = (r: RoutineRun) => (r.test ? "a test" : r.status === "merged" ? "merged on its own" : r.status === "done" ? "handled on its own" : r.status === "handed" ? "waits for you" : r.status === "failed" ? "failed" : "running");

function StepMark({ status }: { status: string }) {
  if (status === "running") return <span className="lc-rt-mk" data-s="run" aria-label="Running" />;
  if (status === "done") return <span className="lc-rt-mk" data-s="done" aria-label="Done"><I.check size={10} /></span>;
  if (status === "failed") return <span className="lc-rt-mk" data-s="fail" aria-label="Failed"><I.close size={9} /></span>;
  if (status === "skipped") return <span className="lc-rt-mk" data-s="skip" aria-label="Skipped" />;
  return <span className="lc-rt-mk" aria-label="Waiting" />;
}

/* ---------- The list ---------- */

export function RoutinesList({ projectId, onNew, onEdit, onRun, compact: tight }: { projectId?: string; onNew: () => void; onEdit: (id: string) => void; onRun: (run: RoutineRun) => void; compact?: boolean }) {
  const routines = useEngine((s) => s.routines);
  const runs = useEngine((s) => s.runs);
  const projects = useEngine((s) => s.projects);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const week = Date.now() - 7 * 86400000;
  const list = routines.filter((r) => !projectId || r.projectId === projectId);
  const mine = runs.filter((r) => list.some((x) => x.id === r.routineId) && !r.test);
  const waits = mine.filter((r) => r.status === "handed").length;

  const toggle = async (r: Routine, on: boolean) => {
    try {
      await rpc("routine.save", { routine: { ...r, on } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const runNow = async (r: Routine) => {
    try {
      const run = await rpc("routine.run", { id: r.id });
      toast(`Started ${r.name}`, { description: "It runs in a session of its own." });
      onRun(run);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="lc-rt" data-compact={tight || undefined}>
      <div className="lc-rt-top">
        <span className="lc-quiet">
          {list.length ? (
            <>
              {list.filter((r) => r.on).length} of {list.length} on · {plural(mine.filter((r) => r.at > week).length, "run")} this week
            </>
          ) : (
            "No routines yet"
          )}
        </span>
        {waits > 0 && (
          <span className="lc-rt-wait">
            <i />
            {waits} {waits === 1 ? "waits" : "wait"} for you
          </span>
        )}
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={onNew}>
          <I.plus size={13} />
          New routine
        </button>
      </div>
      {list.length === 0 && (
        <div className="lc-rt-empty">
          <span className="lc-tile">
            <I.routines size={14} />
          </span>
          <b>Work that runs on its own</b>
          <p>Audit outside pull requests, triage new issues, bump patch versions on Mondays. Models read and report; code in the harness decides, and only it may merge.</p>
          <button type="button" className="lc-btn" data-kind="primary" onClick={onNew}>
            Make the first one
          </button>
        </div>
      )}
      {list.map((r, i) => {
        const rs = runs.filter((x) => x.routineId === r.id);
        const live = rs.find((x) => x.status === "running");
        const earlier = rs.filter((x) => x !== live).slice(0, tight ? 2 : 3);
        const ai = r.steps.filter((s): s is Extract<RoutineStep, { kind: "ai" }> => s.kind === "ai");
        const project = projects.find((p) => p.id === r.projectId);
        const next = r.on && r.nextRun ? `next ${since(Date.now() * 2 - r.nextRun).replace(" ago", "").replace("just now", "soon")}` : null;
        return (
          <article key={r.id} className="lc-rt-card" data-off={!r.on || undefined} style={{ animationDelay: `${i * 35}ms` }}>
            <div className="lc-rt-h">
              <span className="lc-tile">{r.trigger.kind === "schedule" ? <I.clock size={13} /> : r.trigger.kind === "github" ? <I.pr size={13} /> : r.trigger.kind === "webhook" ? <I.bolt size={13} /> : <I.hand size={13} />}</span>
              <button type="button" className="lc-rt-name l-focus" onClick={() => onEdit(r.id)} title="Edit the routine">
                <b>{r.name}</b>
                <small className="lc-quiet">
                  {triggerText(r.trigger)}
                  {project ? ` · ${project.name}` : ""}
                  {!r.on && r.failures > 0 ? ` · paused after ${plural(r.failures, "failure")}` : !r.on ? " · off" : next && r.trigger.kind === "schedule" ? ` · ${next}` : ""}
                </small>
              </button>
              <Switch size="sm" checked={r.on} onCheckedChange={(on) => void toggle(r, on)} aria-label={`${r.name} is ${r.on ? "on" : "off"}`} />
            </div>
            <div className="lc-rt-who">
              {ai.map((s, k) => {
                const a = agentOf(s.agent, agents, providers);
                return (
                  <span key={k} className="lc-rt-chip">
                    {a.name} {ROLE[s.role]}
                    <ModelTag kind={markOf(a.model)} label={modelLabel(a.model, providers)} />
                  </span>
                );
              })}
              <span className="lc-rt-out">
                <I.chevR size={11} />
                {outcomeText(r)}
              </span>
            </div>
            {live && (
              <div className="lc-rt-live">
                <div className="lc-rt-live-h">
                  <span className="lc-rt-spin" aria-hidden />
                  <b>{live.subject ? `#${live.subject.number} ${live.subject.title}` : live.cause}</b>
                  <span className="lc-grow" />
                  <span className="lc-quiet">Step {live.steps.length}</span>
                  <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void rpc("routine.stop", { runId: live.id })}>
                    Stop
                  </button>
                </div>
                <ol className="lc-rt-steps" aria-label="Steps of this run">
                  {live.steps.map((s, k) => (
                    <li key={k} data-s={s.status}>
                      <StepMark status={s.status} />
                      <span>
                        {s.label}
                        {s.detail && <small className="lc-quiet"> {s.detail}</small>}
                      </span>
                      <span className="lc-mono lc-quiet">{s.seconds !== undefined ? duration(s.seconds) : ""}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {earlier.length > 0 && (
              <ul className="lc-rt-runs" aria-label="Earlier runs">
                {earlier.map((x) => (
                  <li key={x.id} data-handed={x.status === "handed" || undefined}>
                    <button type="button" className="lc-rt-run l-focus" onClick={() => onRun(x)}>
                      {x.subject && <span className="lc-mono lc-quiet">#{x.subject.number}</span>}
                      <span className="lc-rt-run-t">{x.subject?.title ?? x.cause}</span>
                      <span className="lc-rt-run-w" data-tone={runTone(x)}>
                        {runWord(x)}
                      </span>
                      <span className="lc-grow" />
                      <span className="lc-quiet lc-rt-when">{since(x.at)}</span>
                    </button>
                    {x.status === "handed" && (
                      <button type="button" className="lc-btn" data-kind="accent" data-size="sm" onClick={() => onRun(x)}>
                        Review
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="lc-rt-acts">
              <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void runNow(r)} disabled={Boolean(live)}>
                <I.play size={12} />
                Run now
              </button>
              <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => onEdit(r.id)}>
                <I.edit size={12} />
                Edit
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ---------- One run ---------- */

export function RunDetail({ runId, onOpenSession }: { runId: string; onOpenSession?: (id: string) => void }) {
  const run = useEngine((s) => s.runs.find((r) => r.id === runId));
  const routine = useEngine((s) => s.routines.find((r) => r.id === run?.routineId));
  const providers = useEngine((s) => s.providers);
  if (!run) return <div className="lc-panel-empty"><b>That run is gone</b><p>Runs older than the last 300 aren't kept.</p></div>;
  const ok = run.rules?.filter((x) => x.ok).length ?? 0;
  const t = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="lc-run">
      <div className="lc-run-scroll">
        <header className="lc-pr-head">
          <div className="lc-pr-title">
            <b>{run.subject?.title ?? routine?.name ?? "A run"}</b>
            <span className="lc-quiet">
              {run.subject ? `#${run.subject.number}${run.subject.author ? ` · ${run.subject.author}` : ""}` : run.cause}
              {run.test ? " · a test" : ""}
            </span>
          </div>
          <Badge tone={runTone(run)}>{run.status === "running" ? "Running" : run.status === "merged" ? "Merged" : run.status === "handed" ? "Waits for you" : run.status === "failed" ? "Failed" : "Done"}</Badge>
        </header>
        <p className="lc-run-sum">
          {run.status === "running" ? `${routine?.name ?? "The routine"} is working on it` : `${routine?.name ?? "The routine"}: ${(run.outcome ?? "done").replace(/^./, (c) => c.toLowerCase())}`}. It started {since(run.at)}; {run.cause.replace(/^./, (c) => c.toLowerCase())}.
        </p>
        {run.rules && run.rules.length > 0 && (
          <div className="lc-pr-sec">
            <div className="lc-pr-lab">
              {run.status === "merged" ? "Why it merged" : "The gate"}
              <span>
                {ok} of {run.rules.length} rules held
              </span>
            </div>
            <ul className="lc-pr-checks">
              {run.rules.map((x) => (
                <li key={x.label} data-state={x.ok ? "pass" : "fail"}>
                  <span className="lc-pr-dot" data-tone={x.ok ? "ok" : "danger"} aria-hidden />
                  <b>{x.label}</b>
                  <span className="lc-quiet">{x.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="lc-pr-sec">
          <div className="lc-pr-lab">
            The run
            <span>
              {run.seconds ? duration(run.seconds) : "So far"}
              {run.tokens ? ` · ${compact(run.tokens)} tokens` : ""}
            </span>
          </div>
          <ol className="lc-run-steps">
            {run.steps.map((s, k) => (
              <li key={k} data-s={s.status}>
                <time className="lc-mono lc-quiet">{t(s.at)}</time>
                <StepMark status={s.status} />
                <span className="lc-run-step-t">
                  <b>{s.label}</b>
                  {s.model && <ModelTag kind={markOf(s.model)} label={modelLabel(s.model, providers)} />}
                  {s.detail && <small>{s.detail}</small>}
                </span>
                <span className="lc-mono lc-quiet">{s.seconds !== undefined ? duration(s.seconds) : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="lc-panel-foot">
        <p role="status" className="lc-pr-status" data-tone={run.status === "failed" ? "danger" : run.status === "handed" ? "warn" : undefined}>
          {run.status === "running" && <span className="lc-pr-spin" aria-hidden />}
          {run.status === "running" ? "Running" : `${run.outcome ?? "Done"}, ${since(run.at)}`}
        </p>
        <span className="lc-grow" />
        {run.status === "running" && (
          <button type="button" className="lc-btn" data-kind="plain" onClick={() => void rpc("routine.stop", { runId: run.id })}>
            Stop
          </button>
        )}
        {run.subject?.url && (
          <button type="button" className="lc-ib l-focus" aria-label="Open it on GitHub" title="Open it on GitHub" onClick={() => window.open(run.subject!.url, "_blank")}>
            <I.external size={14} />
          </button>
        )}
        {run.threadId && onOpenSession && (
          <button type="button" className="lc-btn" data-kind="primary" onClick={() => onOpenSession(run.threadId!)}>
            Open its session
          </button>
        )}
      </div>
    </div>
  );
}

/** The full-page Routines view, from the sidebar. */
export function RoutinesPage({ sidebar, onSidebar, onNew, onEdit, onOpenRun }: { sidebar: boolean; onSidebar: () => void; onNew: () => void; onEdit: (id: string) => void; onOpenRun: (run: RoutineRun) => void }) {
  return (
    <div className="lc-usage lc-rtp">
      <header className="lc-top" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <h1 className="lc-title">Routines</h1>
        <span className="lc-grow" data-drag />
      </header>
      <div className="lc-rtp-scroll">
        <div className="lc-rtp-in">
          <RoutinesList onNew={onNew} onEdit={onEdit} onRun={onOpenRun} />
        </div>
      </div>
    </div>
  );
}

