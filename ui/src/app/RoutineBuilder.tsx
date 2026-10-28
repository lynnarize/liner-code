/*
  The routine builder: a routine drawn on Liner's workflow canvas. The trigger, the AI steps,
  the gate (code, not a model) with its two paths, and the actions on each. Changes save a
  moment after you stop; a test runs on a pull request you name and never acts.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentProfile, GateRule, Project, Routine, RoutineRun, RoutineStep } from "@contracts";
import { WorkflowBuilder, type WorkflowField, type WorkflowRunRecord, type WorkflowRunner, type WorkflowStats, type WorkflowStep, type WorkflowTemplate } from "@liner/pro/workflow-builder/workflow-builder";
import { toast } from "@liner/components/toast/toast";
import { getState, rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, modelLabel, plural, since } from "./model";
import { ACTION, DAYS, triggerText } from "./Routines";
import { Badge, Pop } from "./ui";
import { ProjectChooser } from "./Projects";

const sel = (id: string, label: string, value: string, options: { value: string; label: string; hint?: string }[], hint?: string): WorkflowField => ({ type: "select", id, label, value, options, hint });
const choice = (id: string, label: string, value: string, options: { value: string; label: string }[]): WorkflowField => ({ type: "choice", id, label, value, options });
const toggle = (id: string, label: string, value: boolean, on?: string, off?: string, hint?: string): WorkflowField => ({ type: "toggle", id, label, value, on, off, hint });
const text = (id: string, label: string, value: string, placeholder?: string, hint?: string): WorkflowField => ({ type: "text", id, label, value, placeholder, hint });
const long = (id: string, label: string, value: string, hint?: string): WorkflowField => ({ type: "longtext", id, label, value, hint });
const range = (id: string, label: string, value: number, min: number, max: number, step = 1, suffix?: string): WorkflowField => ({ type: "range", id, label, value, min, max, step, suffix });
const val = <T,>(s: WorkflowStep, id: string, d: T): T => (s.fields?.find((f) => f.id === id)?.value as T | undefined) ?? d;
const uidOf = (b: string) => `${b}-${Math.random().toString(36).slice(2, 7)}`;

type Ctx = { agents: AgentProfile[]; projects: Project[]; providers: ReturnType<typeof getState>["providers"] };

function triggerStep(r: Draft, c: Ctx, id = "trigger"): WorkflowStep {
  const t = r.trigger;
  const fields: WorkflowField[] = [choice("start", "Starts on", t.kind === "github" ? "event" : t.kind, [{ value: "event", label: "Event" }, { value: "schedule", label: "Schedule" }, { value: "webhook", label: "Webhook" }, { value: "manual", label: "By hand" }])];
  if (t.kind === "github") fields.push(sel("event", "When", t.event, [{ value: "pr.opened", label: "A pull request opens" }, { value: "issue.opened", label: "An issue is opened" }]), toggle("outside", "Only from outside the team", Boolean(t.outside), "not from the team", "from anyone"));
  if (t.kind === "schedule") {
    fields.push(sel("every", "How often", t.every, [{ value: "hour", label: "Every hour" }, { value: "day", label: "Every day" }, { value: "weekday", label: "Weekdays" }, { value: "week", label: "Once a week" }]));
    if (t.every !== "hour") fields.push(text("at", "At", t.at ?? "09:00", "09:00"));
    if (t.every === "week") fields.push(sel("day", "On", String(t.day ?? 1), DAYS.map((d, i) => ({ value: String(i), label: d }))));
  }
  fields.push(
    choice("runsGo", "Each run", r.runsGo, [{ value: "own", label: "Its own session" }, { value: "one", label: "A turn in one session" }]),
    range("pauseAfter", "Pause after failures in a row", r.pauseAfter, 0, 5, 1),
    range("merges", "Merges a day, at most", r.limits.mergesPerDay, 0, 20, 1),
    range("tokens", "Tokens a run, at most", Math.round(r.limits.tokensPerRun / 1000), 10, 400, 10, "k"),
  );
  const label = t.kind === "github" ? "Trigger · GitHub" : t.kind === "schedule" ? "Trigger · Schedule" : t.kind === "webhook" ? "Trigger · Webhook" : "Trigger · You";
  const title = t.kind === "github" ? (t.event === "pr.opened" ? (t.outside ? "An outside pull request opens" : "A pull request opens") : "An issue is opened") : t.kind === "schedule" ? triggerText(t) : t.kind === "webhook" ? "Its URL is called" : "You press Run now";
  const project = c.projects.find((p) => p.id === r.projectId);
  const summary = `${project?.name ?? "No project"}${t.kind === "github" ? " · {outside}" : ""}`;
  return { id, kind: "trigger", type: "trigger", label, title, summary, glyph: t.kind === "schedule" ? "clock" : t.kind === "webhook" ? "bolt" : t.kind === "manual" ? "person" : "code", fields };
}

const AI_LABEL = { read: "AI · Read", work: "AI · Work", audit: "AI · Audit" } as const;
const AI_TITLE = { read: "Reads it and reports", work: "Does the work", audit: "Audits it" } as const;
function aiStep(s: Extract<RoutineStep, { kind: "ai" }>, c: Ctx, id = uidOf("ai")): WorkflowStep {
  return {
    id,
    kind: "ai",
    type: `ai-${s.role}`,
    label: AI_LABEL[s.role],
    title: `${agentOf(s.agent, c.agents, c.providers).name} ${AI_TITLE[s.role].toLowerCase()}`,
    summary: s.role === "work" ? "{agent} · edits in a session" : s.role === "audit" ? "{agent} · findings as data" : "{agent} · read-only",
    fields: [
      sel("agent", "Who", s.agent, c.agents.map((a) => ({ value: a.id, label: a.name, hint: modelLabel(a.model, c.providers) }))),
      long("prompt", "What to do", s.prompt, "{{body.…}}, {{headers.…}} and {{subject.…}} fill in from what started the run."),
    ],
  };
}

function gateStep(g: Extract<RoutineStep, { kind: "gate" }>, pass: WorkflowStep[], fail: WorkflowStep[], id = "gate"): WorkflowStep {
  const has = (k: GateRule["kind"]) => g.rules.some((r) => r.kind === k);
  const max = g.rules.find((r): r is Extract<GateRule, { kind: "maxLines" }> => r.kind === "maxLines");
  const paths = g.rules.find((r): r is Extract<GateRule, { kind: "paths" }> => r.kind === "paths");
  const fields = [
    toggle("checks", "Every check passes", has("checks"), "checks pass", "", "Lint, types, tests: whatever the repository runs"),
    toggle("reviewer", "The Reviewer finds nothing blocking", has("reviewer"), "nothing blocking", "", "Notes are fine; a blocker is not"),
    toggle("maxOn", "Fewer changed lines than a limit", Boolean(max), "small", "", "Bigger changes deserve your eyes"),
    range("max", "Changed lines, at most", max?.n ?? 300, 50, 2000, 50),
    text("deny", "Leaves these paths alone", paths?.deny.join(", ") ?? "", ".github/, infra/, *.lock", "Comma-separated; empty turns the rule off"),
    toggle("known", "The author has been merged before", has("knownAuthor"), "known author", "", "First pull requests always go to you"),
  ];
  return {
    id,
    kind: "branch",
    type: "gate",
    label: "If",
    title: "Safe to act on its own?",
    summary: `${plural(g.rules.length, "rule")}, checked by code`,
    glyph: "branch",
    fields,
    paths: [
      { id: `${id}-pass`, label: g.rules.length ? `All ${plural(g.rules.length, "rule")} hold` : "It passes", steps: pass },
      { id: `${id}-fail`, label: "Otherwise", steps: fail },
    ],
  };
}

const ACTION_GLYPH = { merge: "code", comment: "chat", label: "record", close: "doc", inbox: "person", notify: "send" } as const;
function actionStep(a: Extract<RoutineStep, { kind: "action" }>, id = uidOf(a.action)): WorkflowStep {
  const fields: WorkflowField[] = [];
  if (a.action === "comment") fields.push(long("arg", "What it says", a.arg ?? "", "Empty: the audit's notes, or a thank-you when there are none"));
  if (a.action === "label") fields.push(text("arg", "Label", a.arg ?? "", "merged-by-routine"));
  if (a.action === "close") fields.push(text("arg", "Reason the author sees", a.arg ?? "", "Duplicate of #120"));
  if (a.action === "notify") fields.push(text("arg", "What it says", a.arg ?? "", "Triage finished"));
  const summary = a.action === "merge" ? "once every check passes" : a.action === "inbox" ? "in Needs you, with the audit" : a.action === "comment" ? "on the pull request or issue" : a.action === "notify" ? "a notification on this Mac" : "{arg}";
  return { id, kind: a.action === "inbox" ? "person" : "action", type: a.action, label: a.action === "inbox" ? "Ask · You" : a.action === "notify" ? "Action · This Mac" : "Action · GitHub", title: ACTION[a.action], summary, glyph: ACTION_GLYPH[a.action], fields };
}

type Draft = Omit<Routine, "id" | "createdAt" | "failures"> & { id?: string };

export function toSteps(r: Draft, c: Ctx): WorkflowStep[] {
  const out: WorkflowStep[] = [triggerStep(r, c)];
  for (const s of r.steps) if (s.kind === "ai") out.push(aiStep(s, c));
  const acts = r.steps.filter((s): s is Extract<RoutineStep, { kind: "action" }> => s.kind === "action");
  const gate = r.steps.find((s): s is Extract<RoutineStep, { kind: "gate" }> => s.kind === "gate");
  if (gate) {
    out.push(gateStep(gate, acts.filter((a) => a.when === "pass").map((a) => actionStep(a)), acts.filter((a) => a.when === "fail").map((a) => actionStep(a))));
    for (const a of acts.filter((x) => x.when === "always")) out.push(actionStep(a));
  } else for (const a of acts) out.push(actionStep(a));
  return out;
}

export function fromSteps(steps: WorkflowStep[], base: Draft): Draft {
  const out: RoutineStep[] = [];
  let trigger = base.trigger;
  const next: Draft = { ...base, limits: { ...base.limits } };
  const action = (s: WorkflowStep, when: "pass" | "fail" | "always"): RoutineStep | null => {
    const a = s.type as Extract<RoutineStep, { kind: "action" }>["action"];
    if (!(a in ACTION)) return null;
    const arg = val<string>(s, "arg", "").trim();
    return { kind: "action", action: a, when, ...(arg ? { arg } : {}) };
  };
  const hasGate = steps.some((s) => s.type === "gate");
  for (const s of steps) {
    if (s.type === "trigger") {
      const start = val<string>(s, "start", "manual");
      if (start === "event") trigger = { kind: "github", event: val(s, "event", "pr.opened") as "pr.opened", outside: val(s, "outside", false) };
      else if (start === "schedule") {
        const every = val(s, "every", "day") as "day";
        trigger = { kind: "schedule", every, at: val(s, "at", "09:00"), ...(every === ("week" as string) ? { day: Number(val(s, "day", "1")) } : {}) };
      } else if (start === "webhook") trigger = { kind: "webhook", secret: base.trigger.kind === "webhook" ? base.trigger.secret : "" };
      else trigger = { kind: "manual" };
      next.runsGo = val(s, "runsGo", base.runsGo) as "own";
      next.pauseAfter = val(s, "pauseAfter", base.pauseAfter);
      next.limits.mergesPerDay = val(s, "merges", base.limits.mergesPerDay);
      next.limits.tokensPerRun = val(s, "tokens", Math.round(base.limits.tokensPerRun / 1000)) * 1000;
    } else if (s.type?.startsWith("ai-")) out.push({ kind: "ai", role: s.type.slice(3) as "read", agent: val(s, "agent", ""), prompt: val(s, "prompt", "") });
    else if (s.type === "gate") {
      const rules: GateRule[] = [];
      if (val(s, "checks", false)) rules.push({ kind: "checks" });
      if (val(s, "reviewer", false)) rules.push({ kind: "reviewer" });
      if (val(s, "maxOn", false)) rules.push({ kind: "maxLines", n: val(s, "max", 300) });
      const deny = val(s, "deny", "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (deny.length) rules.push({ kind: "paths", deny });
      if (val(s, "known", false)) rules.push({ kind: "knownAuthor" });
      out.push({ kind: "gate", rules });
      for (const a of s.paths?.[0]?.steps ?? []) {
        const x = action(a, "pass");
        if (x) out.push(x);
      }
      for (const a of s.paths?.[1]?.steps ?? []) {
        const x = action(a, "fail");
        if (x) out.push(x);
      }
    } else {
      const x = action(s, hasGate ? "always" : "pass");
      if (x) out.push(x);
    }
  }
  return { ...next, trigger, steps: out };
}

function templates(c: Ctx): WorkflowTemplate[] {
  const first = c.agents.find((a) => a.id !== "demo")?.id ?? c.agents[0]?.id ?? "demo";
  const ai = (role: "read" | "work" | "audit", name: string, hint: string): WorkflowTemplate => {
    const s = aiStep({ kind: "ai", role, agent: first, prompt: role === "audit" ? "Audit it for secrets, unsafe calls, missing tests and anything the project's rules forbid." : role === "read" ? "Read it and say what it changes, and what a reviewer should look at." : "" }, c);
    return { type: s.type!, kind: "ai", group: "AI", name, hint, label: s.label, title: s.title, summary: s.summary, fields: s.fields };
  };
  const act = (a: Extract<RoutineStep, { kind: "action" }>["action"], hint: string, group = "On GitHub"): WorkflowTemplate => {
    const s = actionStep({ kind: "action", action: a, when: "pass" });
    return { type: a, kind: s.kind, group, name: ACTION[a], hint, label: s.label, title: s.title, summary: s.summary, glyph: s.glyph, fields: s.fields };
  };
  const g = gateStep({ kind: "gate", rules: [{ kind: "checks" }, { kind: "reviewer" }] }, [], []);
  return [
    ai("read", "Read and report", "Read-only: what it changes, file by file"),
    ai("audit", "Audit", "Against fixed criteria, findings as data"),
    ai("work", "Do the work", "Edits in a session of its own"),
    { type: "gate", kind: "branch", group: "Logic", name: "The gate", hint: "Rules checked by code, with two paths", label: g.label, title: g.title, summary: g.summary, glyph: "branch", fields: g.fields, paths: ["All rules hold", "Otherwise"] },
    act("merge", "Squash and merge, within the day's limit"),
    act("comment", "Thank the author, say what's next"),
    act("label", "Like merged-by-routine"),
    act("close", "With a reason the author sees"),
    act("inbox", "In Needs you, with the audit", "You"),
    act("notify", "A notification on this Mac", "You"),
  ];
}

const BLANK = (projectId: string, agent: string): Draft => ({
  name: "A new routine",
  on: false,
  projectId,
  trigger: { kind: "github", event: "pr.opened", outside: true },
  steps: [
    { kind: "ai", role: "read", agent, prompt: "Read the pull request and say what it changes, and where a reviewer should look." },
    { kind: "ai", role: "audit", agent, prompt: "Audit it for secrets, unsafe calls, missing tests and anything the project's rules forbid." },
    { kind: "gate", rules: [{ kind: "checks" }, { kind: "reviewer" }, { kind: "maxLines", n: 300 }, { kind: "paths", deny: [".github/", "infra/", "*.lock"] }, { kind: "knownAuthor" }] },
    { kind: "action", action: "merge", when: "pass" },
    { kind: "action", action: "comment", when: "fail" },
    { kind: "action", action: "inbox", when: "fail" },
  ],
  runsGo: "own",
  pauseAfter: 2,
  limits: { mergesPerDay: 5, tokensPerRun: 40000 },
});

export function RoutineBuilder({ id, projectId, onClose, onOpenRun }: { id?: string; projectId?: string; onClose: () => void; onOpenRun: (run: RoutineRun) => void }) {
  const saved = useEngine((s) => s.routines.find((r) => r.id === id));
  const agents = useEngine((s) => s.agents);
  const projects = useEngine((s) => s.projects);
  const providers = useEngine((s) => s.providers);
  const runs = useEngine((s) => s.runs);
  const c: Ctx = { agents, projects, providers };
  const [draft, setDraft] = useState<Draft>(() => saved ?? BLANK(projectId ?? projects[0]?.id ?? "", agents.find((a) => a.id !== "demo")?.id ?? agents[0]?.id ?? "demo"));
  const [steps, setSteps] = useState<WorkflowStep[]>(() => toSteps(draft, c));
  const [name, setName] = useState(draft.name);
  const [testOn, setTestOn] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(saved ? Date.now() : null);
  const idRef = useRef<string | undefined>(saved?.id);
  const testNo = useRef("");
  testNo.current = testOn;

  // Changes save a moment after you stop.
  const persist = async (d: Draft) => {
    if (!d.projectId) throw new Error("Add a project first: routines run in one.");
    const r = await rpc("routine.save", { routine: { ...d, id: idRef.current } });
    idRef.current = r.id;
    setDraft(r);
    setSavedAt(Date.now());
    return r;
  };
  const timer = useRef(0);
  const change = (next: WorkflowStep[]) => {
    // A trigger that changed kind gets the settings for its kind.
    const t0 = steps.find((s) => s.type === "trigger");
    const t1 = next.find((s) => s.type === "trigger");
    let fixed = next;
    if (t0 && t1 && (val(t0, "start", "") !== val(t1, "start", "") || val(t0, "every", "") !== val(t1, "every", "") || val(t0, "event", "") !== val(t1, "event", ""))) {
      const d = fromSteps(next, draft);
      const start = val<string>(t1, "start", "manual");
      if (start === "event" && d.trigger.kind !== "github") d.trigger = { kind: "github", event: "pr.opened", outside: true };
      if (start === "schedule" && d.trigger.kind !== "schedule") d.trigger = { kind: "schedule", every: "day", at: "09:00" };
      fixed = next.map((s) => (s.type === "trigger" ? triggerStep(d, c, s.id) : s));
    }
    setSteps(fixed);
    const d = { ...fromSteps(fixed, draft), name };
    setDraft(d);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(d).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), 700);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // A test: it saves, runs on the pull request you name, and the canvas follows the run.
  const runner: WorkflowRunner = async (current, emit, signal) => {
    const d = { ...fromSteps(current, draft), name };
    const r = await persist(d);
    const n = Number(testNo.current.replace(/\D/g, "")) || undefined;
    emit({ type: "status", text: n ? `Testing on #${n}` : "Testing" });
    const started = await rpc("routine.test", { id: r.id, number: n });
    const aiIds = current.filter((s) => s.kind === "ai").map((s) => s.id);
    const gate = current.find((s) => s.type === "gate");
    const lit = new Set<string>();
    emit({ type: "step", id: current[0].id, state: "done" });
    for (;;) {
      if (signal.aborted) {
        void rpc("routine.stop", { runId: started.id });
        throw Object.assign(new Error("Stopped"), { name: "AbortError" });
      }
      const run = getState().runs.find((x) => x.id === started.id);
      if (run) {
        // Run steps arrive in order: the subject (when there is one), AI steps, the gate, actions.
        const ais = run.steps.filter((s) => s.model);
        ais.forEach((s, k) => {
          const id = aiIds[k];
          if (!id) return;
          const key = `${id}:${s.status}`;
          if (lit.has(key)) return;
          lit.add(key);
          emit({ type: "step", id, state: s.status === "running" ? "running" : s.status === "failed" ? "failed" : "done", note: s.detail, seconds: s.seconds });
        });
        const g = run.steps.find((s) => s.label.startsWith("The gate"));
        if (gate && g && g.status !== "running" && !lit.has("gate")) {
          lit.add("gate");
          const pass = (run.rules ?? []).every((x) => x.ok);
          emit({ type: "step", id: gate.id, state: "done", note: g.detail, seconds: g.seconds });
          emit({ type: "path", branch: gate.id, path: gate.paths![pass ? 0 : 1].id });
          for (const s of gate.paths![pass ? 0 : 1].steps) emit({ type: "step", id: s.id, state: "done", note: "Would run here; tests never act" });
        }
        if (run.status !== "running") return { text: run.outcome ?? "The test finished." };
      }
      await new Promise((res) => setTimeout(res, 400));
    }
  };

  const mine = runs.filter((r) => r.routineId === idRef.current);
  const week = mine.filter((r) => r.at > Date.now() - 7 * 86400000 && !r.test);
  const stats: WorkflowStats | undefined = week.length
    ? {
        runs: week.length,
        ok: Math.round((week.filter((r) => r.status !== "failed").length / week.length) * 100),
        seconds: week.reduce((s, r) => s + (r.seconds ?? 0), 0) / week.length,
        week: Array.from({ length: 7 }, (_, i) => week.filter((r) => new Date(r.at).toDateString() === new Date(Date.now() - (6 - i) * 86400000).toDateString()).length),
      }
    : undefined;
  const records: WorkflowRunRecord[] = mine.slice(0, 6).map((r) => ({ id: r.id, title: r.subject ? `#${r.subject.number} ${r.subject.title}` : r.cause, seconds: r.seconds ?? 0, when: since(r.at), ok: r.status !== "failed", test: r.test }));
  const hook = draft.trigger.kind === "webhook" && idRef.current && draft.trigger.secret ? `${window.__LINER__?.base || location.origin}/hooks/r/${idRef.current}?key=${draft.trigger.secret}` : null;
  const tpl = useMemo(() => templates(c), [agents, providers]);
  const last = mine.find((r) => r.test);

  return (
    <div className="lc-rb">
      <header className="lc-top" data-drag>
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onClose}>
          <I.chevL size={13} />
          Routines
        </button>
        <input
          className="lc-rb-name"
          value={name}
          aria-label="The routine's name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== draft.name) void persist({ ...draft, name: name.trim() }).catch(() => {});
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <Badge tone={draft.on ? "ok" : "neutral"}>{draft.on ? "On" : "Draft"}</Badge>
        <Pop
          label="The project it runs in"
          width={420}
          triggerClass="lc-pb lc-rb-proj"
          trigger={
            <>
              <I.folder size={13} />
              {projects.find((p) => p.id === draft.projectId)?.name ?? "Choose a project"}
              <I.chevD size={11} />
            </>
          }
        >
          {(close) => (
            <ProjectChooser
              value={draft.projectId}
              need={draft.trigger.kind === "github" ? "github" : undefined}
              onPick={(p) => {
                close();
                const d = { ...fromSteps(steps, draft), name, projectId: p.id };
                setDraft(d);
                setSteps((st) => st.map((x) => (x.type === "trigger" ? triggerStep(d, { ...c, projects: projects.some((y) => y.id === p.id) ? projects : [...projects, p] }, x.id) : x)));
                void persist(d).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
              }}
            />
          )}
        </Pop>
        <span className="lc-quiet lc-rb-saved">{savedAt ? "Saved" : "Not saved yet"}</span>
        <span className="lc-grow" data-drag />
        {(draft.trigger.kind === "github" || draft.trigger.kind === "webhook") && (
          <label className="lc-rb-test">
            <span className="lc-quiet">Test on #</span>
            <input value={testOn} onChange={(e) => setTestOn(e.target.value)} placeholder="139" inputMode="numeric" aria-label="Test on this pull request number" />
          </label>
        )}
        <button
          type="button"
          className="lc-btn"
          data-kind={draft.on ? "plain" : "accent"}
          onClick={() =>
            void persist({ ...draft, name: name.trim() || draft.name, on: !draft.on })
              .then((r) => toast(r.on ? `${r.name} is on` : `${r.name} is off`, { description: r.on ? triggerText(r.trigger) : "It won't start until you turn it on." }))
              .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
          }
        >
          {draft.on ? "Turn off" : "Turn on"}
        </button>
      </header>
      {draft.trigger.kind === "github" && projects.find((p) => p.id === draft.projectId) && !projects.find((p) => p.id === draft.projectId)?.remote && (
        <div className="lc-rb-hook lc-rb-warn">
          <I.pr size={13} />
          <span>{projects.find((p) => p.id === draft.projectId)?.name} has no GitHub remote, so this trigger can't see its pull requests or issues. Choose a project from GitHub, or push this one there.</span>
        </div>
      )}
      {hook && (
        <div className="lc-rb-hook">
          <I.bolt size={13} />
          <span className="lc-quiet">POST to</span>
          <span className="lc-mono lc-rb-url">{hook}</span>
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void navigator.clipboard?.writeText(hook).then(() => toast("Copied the URL"))}>
            Copy
          </button>
          <span className="lc-quiet">This Mac only, until remote access. The prompt can quote {"{{body.…}}"}.</span>
        </div>
      )}
      <div className="lc-rb-canvas">
        <WorkflowBuilder title={name} steps={steps} onStepsChange={change} templates={tpl} people={[]} run={runner} ask={null} stats={stats} runs={records} published={false} defaultSelected={null} />
      </div>
      {last && last.status !== "running" && (
        <div className="lc-rb-last l-glass">
          <span className="lc-quiet">Last test{last.subject ? ` on #${last.subject.number}` : ""}:</span>
          <span>{last.outcome}</span>
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => onOpenRun(last)}>
            See it
          </button>
        </div>
      )}
      <p className="lc-rb-foot lc-quiet">Code checks the gate's rules, not a model. The Reviewer reports what it finds; only the harness may merge. Tests never act.</p>
    </div>
  );
}

