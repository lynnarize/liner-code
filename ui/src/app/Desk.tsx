/*
  Desk: every open session on one line, under Home's question. Each session is a task on your
  line (Liner's Agent plan, live): one that works branches off to its agent and fills as its
  plan moves on, one that needs you glides back in amber saying what it waits on, a finished one
  sits with a check that settles it. Pressing what waits opens the case for that decision
  (Liner's Agent feed, live): the claims come from the session's own data (the checks, the
  Reviewer, clashes with the base, what changed and what it cost) and your one press commits,
  merges, starts the plan or decides the run. Beside the line: what happened while you were
  away, and what comes back on its own.
*/
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AgentProfile, Item, PrInfo, PrPicture, Project, ProviderInfo, Routine, RoutineRun, Thread } from "@contracts";
import { AgentPlan, type PlanTask } from "@liner/pro/agent-plan/agent-plan";
import { AgentFeed, type FeedCheck, type FeedDecision, type FeedQuestion } from "@liner/pro/agent-feed/agent-feed";
import type { Agent } from "@liner/pro/agents/agents";
import { PresenceStack, type Presence } from "@liner/pro/presence-stack/presence-stack";
import { NoticeStack, type Notice } from "@liner/components/notice-stack/notice-stack";
import { Countdown } from "@liner/components/countdown/countdown";
import { toast } from "@liner/components/toast/toast";
import { prefersReducedMotion } from "@liner/lib/spring";
import type { RunSettings } from "./Composer";
import { getState, loadItems, onStream, rpc, useEngine } from "./engine";
import { I } from "./icons";
import { accessOf, agentOf, ago, clock, compact, modelLabel, money, plural, since } from "./model";
import "./desk.css";

type Props = {
  /** Where a task you add goes, and who starts it: Home's project and run settings. */
  project?: Project;
  settings: RunSettings;
  worktree: boolean;
  onOpen: (threadId: string) => void;
};

type CaseKind = "commit" | "merge" | "plan" | "run";
/** What a session that needs you waits on, in words, and the case to open for it, if any. */
type Wait = { label: string; note?: string; kind?: CaseKind };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const firstLower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** The first sentence of an answer, short enough for one line under a task. */
const gist = (text: string) => {
  const first = text.trim().split("\n")[0].split(/(?<=[.!?])\s/)[0].replace(/[*_`#>]/g, "");
  return first.length > 96 ? `${first.slice(0, 95).trimEnd()}…` : first;
};
const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);
const tomorrowAt9 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.setHours(9, 0, 0, 0);
};
/** A count small enough to draw as pips. */
const pips = (n: number) => (n > 0 && n <= 16 ? n : undefined);

/** Re-renders once a minute, for "11m" and for when today ends. */
function useMinute() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/* Sessions that settled on their own (a rule you turned on), for What happened while you were away. */
type Settled = { id: string; threadId: string; reason: string; at: number };
let settledList: Settled[] = [];
const settledListeners = new Set<() => void>();
onStream((e) => {
  if (e.type !== "settled") return;
  settledList = [{ id: `settled-${e.threadId}-${Date.now()}`, threadId: e.threadId, reason: e.reason, at: Date.now() }, ...settledList].slice(0, 20);
  for (const l of settledListeners) l();
});
const subscribeSettled = (fn: () => void) => {
  settledListeners.add(fn);
  return () => void settledListeners.delete(fn);
};

/* Notices you dismissed stay dismissed in this window's storage; without storage they come back next launch. */
const SEEN = "lc-desk-seen";
const readSeen = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const saveSeen = (ids: string[]) => {
  try {
    localStorage.setItem(SEEN, JSON.stringify(ids.slice(-200)));
  } catch {
    // private window or storage off: they show again next time
  }
};

/** Waits on you: an answer, a decision, an open pull request. Changes not committed don't: committing is yours to do or not. */
const needsYou = (t: Thread) => t.status === "waiting" || t.status === "error" || t.status === "limited" || !!t.unread || t.pr?.state === "OPEN";

/** On the desk: what works, what waits, what isn't started, and what finished today. Settled and snoozed sessions are out of the way. */
function onDesk(t: Thread, today: number, now: number) {
  if (t.archived || t.done) return false;
  if (t.snoozedUntil && t.snoozedUntil > now) return false;
  return t.status === "running" || t.turns === 0 || needsYou(t) || t.updatedAt >= today;
}

/** How many on the desk are back with you, out with agents, and only yours, for the cue that opens it. */
export function useDeskCounts() {
  const threads = useEngine((s) => s.threads);
  const now = useMinute();
  const today = startOfDay(now);
  return useMemo(() => {
    const n = { back: 0, out: 0, yours: 0 };
    for (const t of threads) {
      if (!onDesk(t, today, now)) continue;
      if (t.status === "running") n.out++;
      else if (t.turns === 0) n.yours++;
      else if (needsYou(t)) n.back++;
    }
    return n;
  }, [threads, today, now]);
}

const lastOf = <K extends Item["kind"]>(items: Item[] | undefined, kind: K, ok: (x: Extract<Item, { kind: K }>) => boolean = () => true) => {
  if (!items) return undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const x = items[i];
    if (x.kind === kind && ok(x as Extract<Item, { kind: K }>)) return x as Extract<Item, { kind: K }>;
  }
  return undefined;
};

function waitOf(t: Thread, items: Item[] | undefined, run: RoutineRun | undefined, name: string, git: boolean): Wait | null {
  const asking = items && [...items].reverse().find((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
  if (asking?.kind === "approval") return { label: "Review the request", note: `Asks to ${firstLower(asking.title)}` };
  if (asking?.kind === "question") return { label: `Answer ${name}`, note: asking.questions[0]?.question ?? "Has a question" };
  if (asking?.kind === "proposal") return { label: "Read the plan", note: `Planned: ${asking.title}`, kind: "plan" };
  if (t.status === "waiting") return { label: "See what it needs", note: "Waits for you" };
  if (t.status === "error") return { label: "See what went wrong", note: lastOf(items, "error")?.message.split("\n")[0] ?? "Ran into a problem" };
  if (t.status === "limited") return { label: "Resume", note: t.limit?.until ? `Limited until ${clock(t.limit.until)}` : (t.limit?.message ?? "Limited") };
  if (t.verdict?.state === "blocked") return { label: "Read the findings", note: t.verdict.note ? `The Reviewer: ${t.verdict.note}` : "The Reviewer found problems" };
  if (run?.status === "handed") return { label: "Decide on the run", note: run.outcome ?? run.cause, kind: "run" };
  if (t.pr?.state === "OPEN") return { label: `Merge #${t.pr.number}`, note: `Pull request #${t.pr.number} is open`, kind: "merge" };
  const said = lastOf(items, "text", (x) => !x.streaming && !!x.text.trim());
  if (t.unread) return { label: "Read the answer", note: said ? gist(said.text) : `Answered ${since(t.updatedAt)}` };
  if ((t.toReview ?? 0) > 0) return { label: `Review ${plural(t.toReview ?? 0, "file")}`, note: `${plural(t.toReview ?? 0, "file")} changed, not committed yet`, kind: git ? "commit" : undefined };
  return null;
}

/** What a working session is doing, in a few words. */
function doingOf(items: Item[] | undefined): string {
  if (!items?.length) return "Working";
  for (let i = items.length - 1; i >= 0; i--) {
    const x = items[i];
    if (x.kind === "tool") {
      const base = x.path?.split("/").pop();
      if (x.toolKind === "edit" || x.toolKind === "write") return `Editing ${base ?? "a file"}`;
      if (x.toolKind === "read") return `Reading ${base ?? "a file"}`;
      if (x.toolKind === "search") return "Searching the code";
      if (x.toolKind === "exec") return `Running ${x.title.replace(/^Run /, "").slice(0, 40)}`;
      if (x.toolKind === "web" || x.toolKind === "fetch") return "Reading the web";
      if (x.toolKind === "task") return "Working with a subagent";
      return x.title;
    }
    if (x.kind === "reasoning") return "Thinking";
    if (x.kind === "text") return "Writing";
    if (x.kind === "turn") return x.planning ? "Planning" : "Working";
  }
  return "Working";
}

/** Who works the running turn: the lead while it plans, else the coder. */
function workerOf(t: Thread, items: Item[] | undefined) {
  const turn = lastOf(items, "turn");
  return turn?.planning && t.lead ? t.lead : t.agent;
}

const toAgent = (id: string, agents: AgentProfile[], providers: ProviderInfo[]): Agent => {
  const p = agentOf(id, agents, providers);
  return { id, name: p.name, role: p.role || "Model", glyph: p.glyph };
};

export function Desk({ project, settings, worktree, onOpen }: Props) {
  const threads = useEngine((s) => s.threads);
  const projects = useEngine((s) => s.projects);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const items = useEngine((s) => s.items);
  const runs = useEngine((s) => s.runs);
  const routines = useEngine((s) => s.routines);
  const settled = useSyncExternalStore(subscribeSettled, () => settledList);
  const [seen, setSeen] = useState(readSeen);
  const [open, setOpen] = useState<{ id: string; kind: CaseKind } | null>(null);
  const now = useMinute();
  const today = startOfDay(now);

  // Oldest first and in place, so a row keeps its spot while it branches off and comes back.
  const desk = useMemo(() => threads.filter((t) => onDesk(t, today, now)).sort((a, b) => a.createdAt - b.createdAt).slice(-40), [threads, today, now]);

  // The timelines of the sessions that work or wait, to say what they do and what they wait on.
  const watch = desk
    .filter((t) => t.status === "running" || needsYou(t))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12)
    .map((t) => t.id)
    .join(",");
  useEffect(() => {
    for (const id of watch.split(",").filter(Boolean)) if (!getState().items[id]) void loadItems(id).catch(() => undefined);
  }, [watch]);

  const several = new Set(desk.map((t) => t.projectId)).size > 1;
  const rows = desk.map((t) => {
    const its = items[t.id];
    const p = projects.find((x) => x.id === t.projectId);
    const run = t.routine ? runs.find((r) => r.id === t.routine?.run) : undefined;
    const settle = `Settle “${t.title}”`;
    const base: PlanTask = { id: t.id, title: t.title, due: ago(t.updatedAt, now), who: several && p ? { name: p.name, kind: "org" } : undefined, checkLabel: settle };
    if (t.status === "running") {
      const plan = lastOf(its, "plan");
      const turn = lastOf(its, "turn");
      const total = plan && turn && plan.turn === turn.turn ? plan.entries.length : 0;
      const doneSteps = total ? plan!.entries.filter((e) => e.status === "completed").length : 0;
      return { t, wait: null, task: { ...base, agent: workerOf(t, its), note: doingOf(its), progress: total ? ([doneSteps, total] as [number, number]) : undefined } };
    }
    if (t.turns === 0) return { t, wait: null, task: base };
    const asker = lastOf(its, "proposal", (x) => x.state === "asking") && t.lead ? t.lead : t.agent;
    const wait = waitOf(t, its, run, agentOf(asker, agents, providers).name, !!p?.git);
    if (wait) return { t, wait, task: { ...base, agent: asker, note: wait.note, action: { label: wait.label, done: "" } } };
    return { t, wait: null, task: { ...base, agent: t.agent, note: `Finished ${since(t.updatedAt, now)}`, done: true } };
  });
  const tasks = rows.map((r) => r.task);

  // The team above the line: who has work here first, then your agents, six at most.
  const team = useMemo(() => {
    const ids = [...new Set(tasks.flatMap((x) => (x.agent ? [x.agent] : [])))];
    for (const a of agents) if (ids.length < 6 && !ids.includes(a.id) && a.id !== "demo") ids.push(a.id);
    return ids.map((id) => toAgent(id, agents, providers));
  }, [tasks.map((x) => x.agent ?? "").join(), agents, providers]);

  const act = (task: PlanTask) => {
    const row = rows.find((r) => r.t.id === task.id);
    if (row?.wait?.kind) setOpen({ id: task.id, kind: row.wait.kind });
    else onOpen(task.id);
  };
  const toggle = (task: PlanTask) => {
    void rpc("thread.update", { id: task.id, done: true })
      .then(() => toast(`Settled ${task.title}`, { action: { label: "Undo", onClick: () => void rpc("thread.update", { id: task.id, done: false }) }, duration: 5000 }))
      .catch((e) => toast.error(msg(e)));
    if (open?.id === task.id) setOpen(null);
  };
  // Handing a task over: a lead brings its coder along; anyone else works on their own.
  const give = async (task: PlanTask, a: Agent) => {
    try {
      const profile = agents.find((x) => x.id === a.id);
      const coder = agents.find((x) => x.specialty === "coder" && x.id !== a.id);
      if (profile && /lead/i.test(profile.role) && coder) await rpc("thread.update", { id: task.id, lead: a.id, agent: coder.id });
      else await rpc("thread.update", { id: task.id, agent: a.id, lead: null });
      await rpc("thread.send", { id: task.id, text: task.title });
    } catch (e) {
      toast.error(msg(e));
    }
  };
  const add = async (title: string) => {
    if (!project) return;
    try {
      await rpc("thread.create", { projectId: project.id, agent: settings.agent, lead: settings.lead, model: settings.model, effort: settings.effort, access: settings.access, title, worktree: worktree && project.git });
    } catch (e) {
      toast.error(msg(e));
    }
  };

  const shown = open && threads.find((t) => t.id === open.id);
  const notices = useNotices(runs, routines, settled, threads, seen, onOpen);
  const soon = <Soon threads={threads} now={now} onOpen={onOpen} />;
  const hasSoon = threads.some((t) => !t.archived && ((t.snoozedUntil ?? 0) > now || (t.status === "limited" && (t.limit?.until ?? 0) > now)));
  const cases = rows.some((r) => r.wait?.kind);
  const side = !!shown || notices.length > 0 || hasSoon || cases;
  const date = new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <section className="lc-desk" aria-label="Desk">
      <div className="lc-desk-grid" data-side={side || undefined}>
        <AgentPlan
          live
          className="lc-desk-plan"
          title="Desk"
          meta={date}
          agents={team}
          tasks={tasks}
          onAct={act}
          onToggle={toggle}
          onGive={(t, a) => void give(t, a)}
          onAdd={(title) => void add(title)}
          onOpen={(t) => onOpen(t.id)}
          addTask={!!project}
          addLabel={project ? `Add a task to ${project.name}` : undefined}
          empty="Nothing on your desk yet. Ask for something above, or add a task below and give it to an agent when you're ready."
        />
        {side && (
          <div className="lc-desk-side">
            {shown && open ? (
              <DeskCase key={`${open.id}-${open.kind}`} t={shown} kind={open.kind} onClose={() => setOpen(null)} onOpen={onOpen} />
            ) : (
              <>
                {cases && <p className="lc-desk-hint">Press what waits on you to see the case for it: the checks, the Reviewer, what changed, and one press to decide.</p>}
                {notices.length > 0 && (
                  <NoticeStack
                    className="lc-desk-notes"
                    label="While you were away"
                    notices={notices}
                    onDismiss={(id) =>
                      setSeen((s) => {
                        const next = [...s, id];
                        saveSeen(next);
                        return next;
                      })
                    }
                  />
                )}
                {soon}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Routine runs that finished on their own today, and sessions a rule settled, newest first. */
function useNotices(runs: RoutineRun[], routines: Routine[], settled: Settled[], threads: Thread[], seen: string[], onOpen: (id: string) => void): Notice[] {
  const day = Date.now() - 86_400_000;
  const fromRuns = runs
    .filter((r) => (r.status === "merged" || r.status === "done" || r.status === "failed") && r.at > day)
    .map((r) => {
      const name = routines.find((x) => x.id === r.routineId)?.name ?? "A routine";
      const title = r.outcome ?? (r.status === "merged" ? `Merged${r.subject ? ` #${r.subject.number}` : ""}` : r.status === "failed" ? "The run failed" : "Done, nothing for you");
      return { at: r.at, n: { id: `run-${r.id}`, eyebrow: name, title, body: `${r.cause} · ${ago(r.at)}`, action: r.threadId ? { label: "Open the run", onClick: () => onOpen(r.threadId!) } : undefined } satisfies Notice };
    });
  const fromSettled = settled.map((s) => {
    const t = threads.find((x) => x.id === s.threadId);
    return { at: s.at, n: { id: s.id, eyebrow: "Settled", title: t?.title ?? "A session", body: s.reason, action: t ? { label: "Open", onClick: () => onOpen(t.id) } : undefined } satisfies Notice };
  });
  return [...fromRuns, ...fromSettled]
    .filter((x) => !seen.includes(x.n.id))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.n);
}

/** Sessions that come back on their own: a snooze that ends, a limit that resets. */
function Soon({ threads, now, onOpen }: { threads: Thread[]; now: number; onOpen: (id: string) => void }) {
  const rows = threads
    .filter((t) => !t.archived)
    .flatMap((t) => {
      if (t.status === "limited" && (t.limit?.until ?? 0) > now) return [{ t, at: t.limit!.until!, why: "Its limit resets" }];
      if ((t.snoozedUntil ?? 0) > now) return [{ t, at: t.snoozedUntil!, why: "Snoozed until" }];
      return [];
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, 4);
  if (!rows.length) return null;
  return (
    <section className="l-frame lc-desk-soon" aria-label="Coming back">
      <header className="l-frame-strip lc-desk-soon-h">
        <b>Coming back</b>
        <span>{plural(rows.length, "session")}</span>
      </header>
      <ul className="l-frame-card lc-desk-soon-list">
        {rows.map((r) => (
          <li key={r.t.id}>
            <button type="button" className="lc-desk-soon-row l-focus" onClick={() => onOpen(r.t.id)}>
              <span className="lc-desk-soon-t">
                <b>{r.t.title}</b>
                <span>
                  {r.why} {clock(r.at, now)}
                </span>
              </span>
              <Countdown to={new Date(r.at)} done="Back now" className="lc-desk-count" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Agents working right now, for Home's bar: they join the stack as a turn starts and blur away when it ends. */
export function DeskPresence() {
  const threads = useEngine((s) => s.threads);
  const items = useEngine((s) => s.items);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const sig = JSON.stringify(
    threads
      .filter((t) => t.status === "running" && !t.archived)
      .reduce<Presence[]>((list, t) => {
        const its = items[t.id];
        const id = workerOf(t, its);
        if (list.some((p) => p.id === id)) return list;
        const last = its?.[its.length - 1];
        const activity: Presence["activity"] = last?.kind === "tool" && (last.toolKind === "edit" || last.toolKind === "write") ? "editing" : last?.kind === "text" && last.streaming ? "typing" : "viewing";
        return [...list, { id, name: agentOf(id, agents, providers).name, activity }];
      }, []),
  );
  const people = useMemo(() => JSON.parse(sig) as Presence[], [sig]);
  if (!people.length) return null;
  return <PresenceStack className="lc-desk-presence" people={people} max={4} size={24} />;
}

/* ---------- The case ---------- */

type Remote = { status?: { pr: PrInfo | null; gh: string; detail?: string }; statusError?: string; picture?: PrPicture; pictureError?: string };
type Case = {
  agent: string;
  checks: FeedCheck[];
  decision: Pick<FeedDecision, "title" | "amount" | "sub" | "act" | "again">;
  questions: FeedQuestion[];
  decide: () => Promise<{ receipt: string; detail: string }>;
};
type Ctx = { t: Thread; items: Item[] | undefined; project?: Project; agents: AgentProfile[]; providers: ProviderInfo[]; budget?: number; runs: RoutineRun[]; routines: Routine[]; remote: Remote | null };

const SENSITIVE = /(^|\/)\.env(\.[\w-]+)?$|\.(pem|key|p12|pfx|keystore|jks)$|(^|\/)id_(rsa|ed25519|ecdsa)|credential|secret|(^|\/)\.npmrc$|(^|\/)\.github\/workflows\//i;
const at = () => clock(Date.now());

/** Steps from a plan's markdown: numbered or bulleted lines, and the files they name. */
function stepsOf(plan: string) {
  return plan
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l))
    .map((l) => ({ text: l.replace(/^(\d+[.)]|[-*•])\s+/, ""), files: [...l.matchAll(/`([^`]+\.[\w]+)`|(?:—|-)\s*([\w./-]+\.[a-z]{1,5})\b/g)].map((m) => m[1] ?? m[2]) }));
}

/** Another model's word on the changes, when a Reviewer read them. */
function reviewerClaim(c: Ctx): FeedCheck | null {
  const v = c.t.verdict;
  if (!v) return null;
  const rv = lastOf(c.items, "review");
  const who = rv ? modelLabel(rv.reviewer, c.providers) : "The Reviewer";
  const blocking = rv ? rv.findings.filter((f) => f.severity === "blocking").length : 0;
  return {
    id: "reviewer",
    claim: "Another model agrees",
    mark: v.state === "verified" ? "passed" : v.state === "blocked" ? "failed" : "checking",
    proof: `${who} read every change${v.round > 1 ? `, in ${v.round} rounds` : ""}`,
    fail: `${who} found ${blocking ? plural(blocking, "problem") : "problems"}${v.note ? `: ${v.note}` : ""}`,
  };
}

function commitCase(c: Ctx): Case {
  const { t, items, project } = c;
  const open = (items ?? []).flatMap((x) => (x.kind === "checkpoint" && !x.reverted && !x.committed ? [x] : []));
  const files = new Map<string, { added: number; removed: number }>();
  for (const cp of open)
    for (const f of cp.files) {
      const was = files.get(f.path) ?? { added: 0, removed: 0 };
      files.set(f.path, { added: was.added + f.added, removed: was.removed + f.removed });
    }
  const list = [...files.entries()].sort((a, b) => b[1].added + b[1].removed - (a[1].added + a[1].removed));
  const add = list.reduce((s, [, f]) => s + f.added, 0);
  const del = list.reduce((s, [, f]) => s + f.removed, 0);
  const loaded = !!items?.length;
  const known = (m: FeedCheck["mark"]) => (loaded ? m : "pending");
  const snaps = open.filter((x) => x.from).length;
  const touchy = list.map(([p]) => p).filter((p) => SENSITIVE.test(p));
  const cost = t.usage.costUsd;
  const tokens = t.usage.inputTokens + t.usage.outputTokens + t.usage.cacheReadTokens;
  const pct = c.budget && cost ? Math.round((cost / c.budget) * 100) : 0;
  const branch = t.worktree?.branch ?? project?.branch ?? "this checkout";
  const biggest = list[0]?.[0].split("/").pop();
  const checks: FeedCheck[] = [
    { id: "size", claim: "The change is small enough to read", count: pips(list.length), n: list.length, mark: known(add + del > 800 ? "failed" : "passed"), proof: `${plural(list.length, "file")}, +${add} −${del}`, fail: `Large: ${plural(list.length, "file")}, +${add} −${del}. Read it in Review first` },
    ...[reviewerClaim(c)].filter((x): x is FeedCheck => !!x),
    { id: "undo", claim: "Every turn can be undone", count: pips(open.length), n: snaps, mark: known(project?.git && snaps === open.length ? "passed" : "failed"), proof: `${plural(snaps, "turn")} kept as snapshots, each with Undo`, fail: project?.git ? `${open.length - snaps} of ${open.length} turns have no snapshot` : "Not a Git repository, so its turns have no snapshots" },
    { id: "sensitive", claim: "Nothing sensitive changed", mark: known(touchy.length ? "failed" : "passed"), proof: "No keys, .env files or CI workflows", fail: `It changed ${touchy.slice(0, 3).join(", ")}. Read ${touchy.length === 1 ? "it" : "them"} first` },
    { id: "cost", claim: c.budget && cost > 0 ? "It stayed within budget" : "What it cost", mark: c.budget && pct >= 25 ? "failed" : "passed", proof: cost > 0 ? `${money(cost)} for this session${c.budget ? `, ${pct < 1 ? "under 1" : pct}% of your ${money(c.budget)} month` : ""}` : `${compact(tokens)} tokens; this tool reports no cost`, fail: `${money(cost)}: ${pct}% of your month's budget in one session` },
    { id: "you", claim: "You sign it off", proof: "", mark: "waiting", yours: { ask: "Read it, then the commit is yours", then: `Committed by you at ${at()}` } },
  ];
  return {
    agent: t.agent,
    checks,
    decision: { title: `Commit “${t.title}”`, amount: `+${add} −${del}`, sub: `${plural(list.length, "file")} · ${branch}${project ? ` · ${project.name}` : ""}`, act: `Commit ${plural(list.length, "file")}`, again: "Commit now instead" },
    questions: [{ q: "What changed, in a sentence?", reading: "Reading the changes" }, ...(biggest ? [{ q: `Why did it change ${biggest}?`, about: "size", reading: `Reading ${biggest}` }] : [])],
    decide: async () => {
      const r = await rpc("git.commit", { threadId: t.id });
      return { receipt: `Committed ${r.sha}`, detail: `${plural(r.files, "file")} on ${branch} · ${at()}` };
    },
  };
}

function mergeCase(c: Ctx): Case {
  const { t, remote } = c;
  const pr = remote?.status?.pr ?? null;
  const number = pr?.number ?? t.pr?.number ?? 0;
  const base = pr?.base ?? remote?.picture?.base ?? "main";
  const who = agentOf(t.agent, c.agents, c.providers).name;
  const checks: FeedCheck[] = [];
  if (!remote) checks.push({ id: "checks", claim: "The checks pass", proof: "", mark: "pending" });
  else if (!pr) {
    const gh = remote.status?.gh;
    checks.push({ id: "checks", claim: "The checks pass", proof: "", mark: "failed", fail: remote.statusError ?? remote.status?.detail ?? (gh === "missing" ? "GitHub's gh isn't installed on this Mac" : gh === "signed-out" ? "gh is signed out of GitHub" : "GitHub has no pull request for this branch") });
  } else {
    const list = pr.checks.filter((x) => x.state !== "skipped");
    const bad = list.filter((x) => x.state === "fail");
    checks.push({
      id: "checks",
      claim: "The checks pass",
      count: pips(list.length),
      n: list.filter((x) => x.state === "pass").length,
      mark: !list.length ? "passed" : bad.length ? "failed" : list.some((x) => x.state === "pending") ? "checking" : "passed",
      proof: list.length ? `All ${list.length} pass` : "No checks run on this repository",
      fail: `${bad
        .slice(0, 3)
        .map((x) => x.name)
        .join(", ")} failed`,
    });
  }
  const pic = remote?.picture;
  const clashes = pic?.conflicts ?? [];
  const clashFiles = [...new Set(clashes.map((x) => x.file.split("/").pop()))].slice(0, 3).join(", ");
  checks.push({
    id: "conflicts",
    claim: `No clashes with ${base}`,
    mark: !remote ? "pending" : remote.pictureError ? "failed" : clashes.length ? "failed" : "passed",
    proof: `Clean against ${base}${pic?.behind ? `, ${plural(pic.behind, "commit")} behind` : ""}`,
    fail: remote?.pictureError ? `Couldn't compare with ${base}: ${remote.pictureError}` : `${plural(clashes.length, "clash", "clashes")} in ${clashFiles}. Ask ${who} to resolve them`,
  });
  const rv = reviewerClaim(c);
  if (rv) checks.push(rv);
  if (pr) {
    const approved = [...new Set(pr.reviews.filter((r) => r.state === "APPROVED").map((r) => r.author))];
    const changes = pr.reviews.find((r) => r.state === "CHANGES_REQUESTED");
    if (pr.reviewDecision === "APPROVED" || approved.length) checks.push({ id: "reviews", claim: "Someone reviewed it on GitHub", mark: "passed", proof: `Approved by ${approved.join(", ") || "a reviewer"}` });
    else if (pr.reviewDecision === "CHANGES_REQUESTED" || changes) checks.push({ id: "reviews", claim: "Someone reviewed it on GitHub", mark: "failed", proof: "", fail: `${changes?.author ?? "A reviewer"} asked for changes` });
    else if (pr.requested.length) checks.push({ id: "reviews", claim: "Someone reviewed it on GitHub", mark: "failed", proof: "", fail: `Waiting on ${pr.requested.join(", ")}` });
  }
  checks.push({ id: "you", claim: "You merge it", proof: "", mark: "waiting", yours: { ask: "Everything else is in. The merge is yours", then: `Merged by you at ${at()}` } });
  const failing = pr?.checks.find((x) => x.state === "fail");
  return {
    agent: t.agent,
    checks,
    decision: { title: `Merge #${number}${pr ? `: ${pr.title}` : ""}`, amount: `#${number}`, sub: pr ? `${plural(pr.commits.length, "commit")} · +${pr.additions} −${pr.deletions} · into ${base}` : "Reading the pull request", act: "Squash and merge", again: "Merge now instead" },
    questions: [
      ...(failing ? [{ q: `Why did ${failing.name} fail?`, about: "checks", reading: "Reading the check" }] : []),
      ...(clashes.length ? [{ q: "How would you resolve the clashes?", about: "conflicts", reading: "Reading both sides" }] : []),
      { q: "Is anything in it risky?", reading: "Reading the branch" },
    ],
    decide: async () => {
      await rpc("pr.merge", { projectId: t.projectId, number });
      return { receipt: `Merged #${number} into ${base}`, detail: at() };
    },
  };
}

function planCase(c: Ctx): Case {
  const { t, items, project } = c;
  const prop = lastOf(items, "proposal", (x) => x.state === "asking") ?? lastOf(items, "proposal");
  const coder = agentOf(t.agent, c.agents, c.providers);
  const lead = agentOf(t.lead ?? t.agent, c.agents, c.providers);
  const steps = prop ? stepsOf(prop.plan) : [];
  const files = [...new Set(steps.flatMap((s) => s.files))];
  const access = accessOf(t.access);
  const known = (m: FeedCheck["mark"]) => (prop ? m : "pending");
  const checks: FeedCheck[] = [
    { id: "steps", claim: "It's in clear steps", count: pips(steps.length), n: steps.length, mark: known(steps.length ? "passed" : "failed"), proof: `${plural(steps.length, "step")}, built by ${coder.name}`, fail: "No numbered steps to follow. Read the plan in the session" },
    { id: "files", claim: "It names the files it will touch", mark: known(files.length ? "passed" : "failed"), proof: `${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}`, fail: "It names no files yet. Ask which ones" },
    { id: "access", claim: "It works within your access", mark: known(t.access === "full" ? "failed" : "passed"), proof: `${coder.name} starts on “${access.label}”: ${firstLower(access.note)}`, fail: `Full access: ${coder.name} acts, then tells you` },
    { id: "you", claim: "You approve it", proof: "", mark: "waiting", yours: { ask: `${coder.name} waits for your word`, then: `Approved by you at ${at()}` } },
  ];
  return {
    agent: t.lead ?? t.agent,
    checks,
    decision: { title: `Start: ${prop?.title ?? t.title}`, amount: plural(steps.length, "step"), sub: `${lead.name} planned it · ${coder.name} builds it${project ? ` · ${project.name}` : ""}`, act: "Approve and start", again: "Start now instead" },
    questions: [
      { q: "What's the riskiest step?", about: "steps", reading: "Reading the plan" },
      { q: "Could it be smaller?", reading: "Reading the plan" },
    ],
    decide: async () => {
      if (!prop) throw new Error("The plan isn't here any more.");
      await rpc("proposal.answer", { threadId: t.id, itemId: prop.id, approve: true });
      return { receipt: `Started: ${coder.name} is on it`, detail: at() };
    },
  };
}

function runCase(c: Ctx): Case {
  const { t } = c;
  const run = c.runs.find((r) => r.id === t.routine?.run);
  const routine = c.routines.find((r) => r.id === t.routine?.id);
  const rules = run?.rules ?? [];
  const subject = run?.subject;
  const checks: FeedCheck[] = rules.length
    ? rules.map((r, i) => ({ id: `rule${i}`, claim: r.label, mark: r.ok ? "passed" : "failed", proof: r.detail ?? "Holds", fail: r.detail ?? "Doesn't hold" }))
    : [{ id: "outcome", claim: "The run finished its steps", mark: run ? "passed" : "pending", proof: run?.outcome ?? run?.cause ?? "" }];
  checks.push({ id: "you", claim: "You decide", proof: "", mark: "waiting", yours: { ask: "It came back to you, so the call is yours", then: `Decided by you at ${at()}` } });
  const merge = subject?.kind === "pr";
  return {
    agent: t.agent,
    checks,
    decision: {
      title: subject ? `${routine?.name ?? "Routine"}: #${subject.number} ${subject.title}` : (routine?.name ?? t.title),
      amount: subject ? `#${subject.number}` : plural(rules.length, "rule"),
      sub: run ? `${run.cause} · ${ago(run.at)}` : "Reading the run",
      act: merge ? "Squash and merge" : "Settle it",
      again: merge ? "Merge now instead" : "Settle it now",
    },
    questions: [{ q: "Why was this handed to me?", reading: "Reading the run" }],
    decide: async () => {
      if (merge && subject) {
        await rpc("pr.merge", { projectId: routine?.projectId ?? t.projectId, number: subject.number });
        return { receipt: `Merged #${subject.number}`, detail: at() };
      }
      await rpc("thread.update", { id: t.id, done: true });
      return { receipt: "Settled", detail: at() };
    },
  };
}

const BUILD: Record<CaseKind, (c: Ctx) => Case> = { commit: commitCase, merge: mergeCase, plan: planCase, run: runCase };

/**
  The case builds claim by claim even though the data is all here: rays first, then the count
  fills, then its mark. A claim still waiting on its data stays on rays until the data comes.
*/
function useReveal(target: FeedCheck[]): FeedCheck[] {
  const reduce = prefersReducedMotion();
  const [r, setR] = useState(0);
  const [n, setN] = useState(0);
  const cur = target[r];
  const ready = !!cur && !!cur.mark && cur.mark !== "pending";
  const total = cur?.count ? Math.min(cur.n ?? 0, cur.count) : 0;
  useEffect(() => {
    if (reduce || !ready) return;
    const ids: number[] = [];
    let ms = 420;
    for (let k = 1; k <= total; k++) {
      const v = k;
      ids.push(window.setTimeout(() => setN(v), ms));
      ms += 110;
    }
    ids.push(
      window.setTimeout(() => {
        setN(0);
        setR((x) => x + 1);
      }, ms + 220),
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [r, ready, total, reduce]);
  if (reduce) return target;
  return target.map((c, i) => (i < r ? c : i === r ? { ...c, mark: "checking", n } : { ...c, mark: "pending", n: 0 }));
}

function DeskCase({ t, kind, onClose, onOpen }: { t: Thread; kind: CaseKind; onClose: () => void; onOpen: (id: string) => void }) {
  const items = useEngine((s) => s.items[t.id]);
  const project = useEngine((s) => s.projects.find((p) => p.id === t.projectId));
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const budget = useEngine((s) => s.settings.budgetUsd);
  const runs = useEngine((s) => s.runs);
  const routines = useEngine((s) => s.routines);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [done, setDone] = useState<{ receipt: string; detail: string } | null>(null);
  const [wake] = useState(tomorrowAt9);

  useEffect(() => {
    if (!getState().items[t.id]) void loadItems(t.id).catch(() => undefined);
  }, [t.id]);
  // A pull request's checks and its picture against the base; checks still running are asked again.
  useEffect(() => {
    if (kind !== "merge") return;
    let live = true;
    let timer = 0;
    const load = async () => {
      const [s, p] = await Promise.allSettled([rpc("pr.status", { threadId: t.id }), rpc("pr.picture", { threadId: t.id })]);
      if (!live) return;
      const next: Remote = {
        status: s.status === "fulfilled" ? s.value : undefined,
        statusError: s.status === "rejected" ? msg(s.reason) : undefined,
        picture: p.status === "fulfilled" ? p.value : undefined,
        pictureError: p.status === "rejected" ? msg(p.reason) : undefined,
      };
      setRemote(next);
      if (next.status?.pr?.checks.some((x) => x.state === "pending")) timer = window.setTimeout(() => void load(), 20_000);
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [t.id, kind]);

  // From your press on, the case stays as it was when you pressed, not as the session is after.
  const pressed = useRef(false);
  const frozen = useRef<Case | null>(null);
  const built = BUILD[kind]({ t, items, project, agents, providers, budget, runs, routines, remote });
  if (!pressed.current) frozen.current = built;
  const c = frozen.current ?? built;
  const checks = useReveal(c.checks);
  const decision: FeedDecision = { ...c.decision, receipt: done?.receipt ?? "", receiptDetail: done?.detail ?? "", held: `Snoozed until ${clock(wake)}` };
  // What the quick model reads besides the session: the case as you see it.
  const context = [`${c.decision.title} (${c.decision.sub})`, ...c.checks.map((x) => `- ${x.claim}: ${x.mark === "failed" ? x.fail : x.mark === "passed" ? x.proof : x.mark === "waiting" ? (x.yours?.ask ?? "waiting on you") : "still being checked"}`)].join("\n");

  return (
    <div className="lc-desk-case">
      <div className="lc-desk-case-bar">
        <button type="button" className="lc-desk-case-x l-focus" aria-label="Close the case" onClick={onClose}>
          <I.chevL size={13} />
          Desk
        </button>
        <span className="lc-desk-case-t">The case</span>
        <button type="button" className="lc-desk-case-open l-focus" onClick={() => onOpen(t.id)}>
          Open the session
          <I.chevR size={12} />
        </button>
      </div>
      <AgentFeed
        live
        className="lc-desk-feed"
        agent={toAgent(c.agent, agents, providers)}
        checks={checks}
        decision={decision}
        questions={c.questions}
        ask={(q) => rpc("desk.ask", { threadId: t.id, question: q, context }).then((r) => r.answer)}
        onDecide={() => {
          pressed.current = true;
          return c.decide().then(setDone, (e) => {
            pressed.current = false;
            toast.error(msg(e));
            throw e;
          });
        }}
        onHold={() => void rpc("thread.update", { id: t.id, snoozedUntil: wake }).catch((e) => toast.error(msg(e)))}
      />
    </div>
  );
}
