/*
  Who's on a session's work, and who sent whom. Liner Code puts models on a message (a planner and
  a builder, Auto's writer, the Reviewer), and those models send agents off to do parts of it
  (Claude Code's Agent tool: Explore, the Test runner, a general Subagent), each under the one that
  sent it, agents of agents included. All of it is read from the timeline: the turn items say who
  worked, the "task" rows say which agents were sent and carry what each was asked, does now and
  sent back (AgentRun). Shown four ways: the header's crew chip and its popover, the fan-out under
  a turn's work, a line on the composer while the work waits on agents, and the Agents surface
  (the tree, a timeline of who worked when, the tasks with who took them, what runs in the
  background), where one agent opens on its own.
*/
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "@liner/components/toast/toast";
import { agentState, ROUTE_LEVELS, type AgentProfile, type Item, type PlanEntry, type ProviderInfo, type Thread } from "@contracts";
import { rpc, useEngine, useItemsWhere } from "./engine";
import { I, ModelMark } from "./icons";
import { useLaunch } from "./launch";
import { agentOf, compact, duration, isModelAgent, markOf, modelLabel, plural } from "./model";
import { openSurface } from "./TopBar";
import { Num, Pop } from "./ui";
import "./crew.css";

type Tool = Extract<Item, { kind: "tool" }>;
type Turn = Extract<Item, { kind: "turn" }>;
type Review = Extract<Item, { kind: "review" }>;
type State = "running" | "done" | "failed" | "stopped";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** The items the crew is read from: who worked (turns, reviews), the agents they sent, and the task list. */
export const isCrewItem = (it: Item) => it.kind === "turn" || it.kind === "review" || it.kind === "plan" || (it.kind === "tool" && it.toolKind === "task");
export const isAgent = (it: Item): it is Tool => it.kind === "tool" && it.toolKind === "task";

/* ---------- one agent, in words ---------- */

export const agentName = (t: Tool) => t.agent?.name ?? (t.title.split(":")[0].trim() || "Agent");
export const agentTask = (t: Tool) => t.agent?.task ?? t.title.split(":").slice(1).join(":").trim();
export const stateOf = (t: Tool): State => agentState(t);
/** Its first line said plainly: no list marks, headings, code ticks or bold. */
const firstLine = (s?: string) => s?.split("\n").map((x) => x.replace(/^[#>*\-\s]+/, "").replace(/`|\*\*/g, "").trim()).find(Boolean);
/** A step's title as what it's doing: "Read a.ts" is "reading a.ts". */
export function doing(title: string) {
  const m = /^(\S+)\s(.*)$/.exec(title);
  const ing: Record<string, string> = { Read: "reading", Search: "searching", Run: "running", Fetch: "fetching", Write: "writing", Edit: "editing", Find: "finding", Update: "updating", Start: "starting", List: "listing" };
  return m && ing[m[1]] ? `${ing[m[1]]} ${m[2]}` : title.charAt(0).toLowerCase() + title.slice(1);
}
/** What it's doing now, or how it ended. */
export function agentNow(t: Tool) {
  const s = stateOf(t);
  if (s === "running") return t.agent?.now ?? "Starting";
  if (s === "stopped") return "Stopped before it finished";
  if (s === "failed") return firstLine(t.output) ?? "Didn't finish";
  if (t.agent?.background && !t.agent.report) return "Working in the background";
  return firstLine(t.agent?.report) ?? firstLine(t.output) ?? "Done";
}
const secsOf = (t: Tool, now: number) => (stateOf(t) === "running" && !(t.agent?.background && t.status !== "running") ? Math.max(0, (now - t.at) / 1000) : t.seconds);
/** "12 tools · 18k · 41s" */
export function agentStats(t: Tool, now: number) {
  const a = t.agent;
  return [a?.tools ? plural(a.tools, "tool") : null, a?.tokens ? compact(a.tokens) : null, duration(secsOf(t, now)) || null].filter(Boolean).join(" · ");
}

/* ---------- the crew of the latest message ---------- */

export type AgentNode = { it: Tool; kids: AgentNode[] };
export type Member = { key: string; agent: string; model: string; name: string; tag?: string; role?: string; status: Turn["status"]; at: number; seconds?: number; agents: AgentNode[] };
export type Crew = { turn: number; mode: string; members: Member[]; reviews: Review[]; agents: Tool[]; plan?: PlanEntry[]; start: number; lead?: Member };

const ROLE: Record<string, string> = { build: "Builder", refine: "Refiner", repair: "Fixer", fix: "Fixer", revise: "Reviser", takeover: "Took over" };

/**
  Who worked on your latest message: each model's part (a planner, then a builder), with the
  agents it sent (in order, under the one that sent each), and the Reviewer's rounds. The model
  at work, or the last one, leads.
*/
export function crewOf(items: Item[], thread: Thread, profiles: AgentProfile[], providers: ProviderInfo[]): Crew | null {
  let turn = -1;
  for (const it of items) if (it.kind === "turn" && it.turn > turn) turn = it.turn;
  if (turn < 0) return null;
  const members: Member[] = [];
  const reviews: Review[] = [];
  const agents: Tool[] = [];
  const nodes = new Map<string, AgentNode>();
  let plan: PlanEntry[] | undefined;
  let cur: Member | undefined;
  for (const it of items) {
    if (it.turn !== turn) continue;
    if (it.kind === "turn") {
      const role = it.planning ? "Planner" : it.part ? ROLE[it.part] : thread.lead ? "Builder" : thread.route ? "Writes" : undefined;
      // A part goes on after an answer of yours as another turn item: it's the same member.
      const same = members.find((m) => m.agent === it.agent && m.model === it.model && m.role === role);
      if (same) {
        same.status = it.status;
        same.seconds = it.seconds === undefined ? undefined : (it.at - same.at) / 1000 + it.seconds;
        cur = same;
        continue;
      }
      const a = agentOf(it.agent, profiles, providers);
      const label = modelLabel(it.model, providers);
      const bare = isModelAgent(it.agent) || it.agent === "demo";
      cur = { key: it.id, agent: it.agent, model: it.model, name: bare ? label : a.name, tag: bare ? undefined : label, role, status: it.status, at: it.at, seconds: it.seconds, agents: [] };
      members.push(cur);
    } else if (isAgent(it)) {
      agents.push(it);
      const node: AgentNode = { it, kids: [] };
      nodes.set(it.id, node);
      const parent = it.agent?.parent ? nodes.get(it.agent.parent) : undefined;
      if (parent) parent.kids.push(node);
      else cur?.agents.push(node);
    } else if (it.kind === "review") reviews.push(it);
    else if (it.kind === "plan") plan = it.entries;
  }
  if (!members.length) return null;
  const mode = thread.route ? `Auto · ${ROUTE_LEVELS.find((l) => l.id === thread.route!.level)?.label ?? "Standard"}` : thread.lead ? "Plan, then build" : "Solo";
  return { turn, mode, members, reviews, agents, plan, start: members[0].at, lead: members.findLast((m) => m.status === "running") ?? members.at(-1) };
}

/** The crew of a session, read from only the items that make it (not every streamed word). */
export function useCrew(thread: Thread) {
  const items = useItemsWhere(thread.id, isCrewItem);
  const profiles = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  return useMemo(() => crewOf(items, thread, profiles, providers), [items, thread.lead, thread.route?.level, thread.agent, profiles, providers]);
}

/** A clock that ticks each second while `on`. */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

const running = (t: Tool) => stateOf(t) === "running";
/** Running and holding up the model that sent it: one in the background doesn't. */
const holding = (t: Tool) => running(t) && t.status === "running";
const countOf = (crew: Crew) => crew.members.length + crew.agents.length + new Set(crew.reviews.map((r) => r.reviewer)).size;
const stopAll = (threadId: string, tools: Tool[]) => {
  for (const t of tools.filter((x) => running(x) && x.agent?.taskId)) void rpc("thread.stopAgent", { id: threadId, item: t.id }).catch(fail);
};

/* ---------- which agent the Agents surface shows ---------- */

const shown = new Map<string, string | null>();
const watchers = new Set<() => void>();
/** Opens one agent in the Agents surface (null: the whole crew again). */
export function showAgent(threadId: string, itemId: string | null) {
  shown.set(threadId, itemId);
  for (const w of watchers) w();
  if (itemId !== null) openSurface(threadId, "agents");
}
function useShownAgent(threadId: string) {
  return useSyncExternalStore(
    (w) => (watchers.add(w), () => void watchers.delete(w)),
    () => shown.get(threadId) ?? null,
  );
}

/* ---------- small parts ---------- */

/** An agent's kind, as a mark: Explore looks, the Test runner runs tests, the rest do what they're sent to. */
function Kind({ name, size = 12 }: { name: string; size?: number }) {
  const Icon = name === "Explore" ? I.search : name === "Test runner" ? I.flask : I.sparkle;
  return <Icon size={size} />;
}
const STATE_WORD: Record<State, string> = { running: "Working", done: "Done", failed: "Didn't finish", stopped: "Stopped" };
/** How it stands, as a mark: a breathing dot at work, a tick when done, a square when stopped, a ring when it hasn't started. */
export function Mark({ state, waiting }: { state: State; waiting?: boolean }) {
  return (
    <span className="lc-cr-mark" data-state={waiting ? "waiting" : state} role="img" aria-label={waiting ? "Waiting" : STATE_WORD[state]}>
      {state === "done" ? <I.check size={12} /> : state === "failed" ? <I.close size={11} /> : <i />}
    </span>
  );
}

/* ---------- the header's crew chip ---------- */

/**
  Who leads your latest message and how many work for it ("Sonnet 5.5 + 3 agents"); once it's
  over, how many worked on it. Opens the crew as a list. Nothing when one model works alone.
*/
export function CrewChip({ thread }: { thread: Thread }) {
  const crew = useCrew(thread);
  if (!crew || (crew.members.length < 2 && !crew.agents.length && !crew.reviews.length)) return null;
  const live = thread.status === "running" || thread.status === "waiting";
  const lead = crew.lead!;
  const working = crew.agents.filter(running);
  return (
    <Pop
      label="Who's on this session"
      width={400}
      triggerClass="lc-crew l-focus"
      triggerAttrs={{ "data-live": live || undefined }}
      trigger={
        <>
          <span className="lc-cr-faces" aria-hidden>
            <span data-lead={live || undefined}>
              <ModelMark kind={markOf(lead.model)} size={11} />
            </span>
            {(working.length ? working : crew.agents).slice(0, 2).map((t) => (
              <span key={t.id}>
                <Kind name={agentName(t)} size={11} />
              </span>
            ))}
          </span>
          {live ? (
            <span className="lc-crew-t">
              {lead.name}
              {crew.agents.length > 0 && <span className="lc-quiet"> + {plural(crew.agents.length, "agent")}</span>}
            </span>
          ) : (
            <span className="lc-crew-t">{countOf(crew)} worked on it</span>
          )}
          <I.chevD size={11} />
        </>
      }
    >
      {(close) => <CrewList thread={thread} crew={crew} close={close} />}
    </Pop>
  );
}

/** The crew as a list, in the chip's popover: who leads, who works for it, what runs in the background. */
function CrewList({ thread, crew, close }: { thread: Thread; crew: Crew; close: () => void }) {
  const providers = useEngine((s) => s.providers);
  const live = crew.members.some((m) => m.status === "running") || crew.agents.some(running);
  const now = useNow(live);
  const [launch] = useLaunch(thread.id);
  const servers = launch?.servers.filter((s) => s.status !== "stopped") ?? [];
  const working = crew.members.filter((m) => m.status === "running").length + crew.agents.filter(running).length + crew.reviews.filter((r) => r.status === "running").length;
  const open = (t: Tool) => (close(), showAgent(thread.id, t.id));
  const rows = (nodes: AgentNode[], depth: number): ReactNode[] =>
    nodes.flatMap((n) => [
      <button key={n.it.id} type="button" className="lc-crp-r l-focus" style={{ paddingLeft: 8 + depth * 22 }} onClick={() => open(n.it)}>
        <Mark state={stateOf(n.it)} />
        <b>{agentName(n.it)}</b>
        <span className={running(n.it) ? "lc-crp-t l-shimmer" : "lc-crp-t"}>{agentNow(n.it)}</span>
        <span className="lc-crp-n">{duration(secsOf(n.it, now))}</span>
      </button>,
      ...rows(n.kids, depth + 1),
    ]);
  return (
    <div className="lc-crp">
      <div className="lc-crp-h">
        <b>{crew.mode}</b>
        <span className="lc-quiet">· {working ? `${working} of ${countOf(crew)} working` : `${countOf(crew)} worked on it`}</span>
      </div>
      {crew.members.map((m) => (
        <div key={m.key}>
          <div className="lc-crp-r">
            <Mark state={m.status === "running" ? "running" : m.status === "error" ? "failed" : m.status === "stopped" ? "stopped" : "done"} />
            <b>{m.name}</b>
            {m.role && <span className="lc-crp-role">{m.role}</span>}
            <span className="lc-crp-t">{memberWord(m, now)}</span>
            <span className="lc-crp-n">{duration(m.status === "running" ? (now - m.at) / 1000 : m.seconds)}</span>
          </div>
          {rows(m.agents, 1)}
        </div>
      ))}
      {crew.reviews.slice(-1).map((r) => (
        <div key={r.id} className="lc-crp-r">
          <Mark state={r.status === "running" ? "running" : r.status === "blocked" || r.status === "error" ? "failed" : "done"} />
          <b>{modelLabel(r.reviewer, providers)}</b>
          <span className="lc-crp-role">Reviewer</span>
          <span className="lc-crp-t">{reviewWord(r)}</span>
        </div>
      ))}
      <div className="lc-crp-sep" />
      {servers.length ? (
        servers.map((s) => (
          <div key={s.name} className="lc-crp-r">
            <I.server size={13} />
            <span className="lc-crp-t lc-mono">{s.name}</span>
            <span className="lc-crp-n">{s.at ? `localhost:${s.at}` : s.status}</span>
          </div>
        ))
      ) : (
        <div className="lc-crp-r lc-quiet">
          <I.server size={13} />
          Nothing in the background
        </div>
      )}
      <div className="lc-crp-sep" />
      <div className="lc-crp-foot">
        <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => (close(), showAgent(thread.id, null), openSurface(thread.id, "agents"))}>
          Show in the panel
        </button>
        <span className="lc-grow" />
        {crew.agents.some((t) => running(t) && t.agent?.taskId) && (
          <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => stopAll(thread.id, crew.agents)}>
            Stop all agents
          </button>
        )}
      </div>
    </div>
  );
}

function memberWord(m: Member, now: number) {
  if (m.status === "running") {
    const waiting = m.agents.filter((n) => holding(n.it)).length;
    return waiting ? `waiting on ${plural(waiting, "agent")}` : m.role === "Planner" ? "planning" : "working";
  }
  if (m.status === "stopped") return "stopped";
  if (m.status === "error") return "stopped with a problem";
  void now;
  return m.role === "Planner" ? "planned it" : m.agents.length ? `worked with ${plural(m.agents.length, "agent")}` : "done";
}
function reviewWord(r: Review) {
  if (r.status === "running") return "reading the change";
  if (r.status === "passed") return r.findings.length ? `verified, ${plural(r.findings.length, "note")}` : "verified";
  if (r.status === "blocked") return `blocked in round ${r.round}`;
  return "no verdict";
}

/* ---------- the fan-out under a turn's work ---------- */

/**
  The agents a part of a turn sent, under its work: "Started 3 agents", each on a branch under
  the one that sent it, with what it's doing now, its model and its counts; once they're done,
  what each sent back. Pressing one opens it in the Agents surface.
*/
export function Fanout({ threadId, tools, live }: { threadId: string; tools: Tool[]; live: boolean }) {
  const providers = useEngine((s) => s.providers);
  const anyRunning = tools.some(running);
  const now = useNow(anyRunning);
  const roots = useMemo(() => {
    const nodes = new Map(tools.map((it) => [it.id, { it, kids: [] as AgentNode[] }]));
    const out: AgentNode[] = [];
    for (const n of nodes.values()) {
      const parent = n.it.agent?.parent ? nodes.get(n.it.agent.parent) : undefined;
      if (parent) parent.kids.push(n);
      else out.push(n);
    }
    return out;
  }, [tools]);
  if (!tools.length) return null;
  const done = tools.filter((t) => !running(t)).length;
  const working = tools.length - done;
  const ongoing = live && working > 0;
  const branch = (nodes: AgentNode[]): ReactNode =>
    nodes.map((n, i) => {
      const t = n.it;
      const st = stateOf(t);
      const model = t.agent?.model ? modelLabel(t.agent.model, providers) : undefined;
      const task = agentTask(t);
      const on = st === "running";
      return (
        <div key={t.id} className="lc-fan-kid" data-last={i === nodes.length - 1 || undefined}>
          <button type="button" className="lc-fan-ag l-focus" data-on={on || undefined} onClick={() => showAgent(threadId, t.id)} title={`Open ${agentName(t)}`}>
            <span className="lc-fan-1">
              <Mark state={st} />
              <b>{agentName(t)}</b>
              <span className="lc-fan-task">{on ? task : agentNow(t)}</span>
              {on ? model && <span className="lc-fan-m">{model}</span> : <span className="lc-fan-m l-num">{duration(secsOf(t, now))}</span>}
            </span>
            {on && (
              <span className="lc-fan-2">
                <span className="lc-fan-now l-shimmer">{agentNow(t)}</span>
                <span className="lc-fan-m l-num">{agentStats(t, now)}</span>
              </span>
            )}
          </button>
          {n.kids.length > 0 && <div className="lc-fan-kids">{branch(n.kids)}</div>}
        </div>
      );
    });
  return (
    <div className="lc-fan" aria-label={`${plural(tools.length, "agent")} sent`}>
      <div className="lc-fan-h">
        <I.fanout size={14} />
        {ongoing ? `Started ${plural(tools.length, "agent")}` : `With ${plural(tools.length, "agent")}`}
        <span className="lc-quiet">· {ongoing ? [done && `${done} done`, `${working} working`].filter(Boolean).join(", ") : "what each sent back"}</span>
      </div>
      <div className="lc-fan-kids">{branch(roots)}</div>
    </div>
  );
}

/* ---------- the composer's line ---------- */

/** While the work waits on agents: who waits on how many, and what one of them is doing. */
export function CrewStrip({ thread }: { thread: Thread }) {
  const crew = useCrew(thread);
  const live = thread.status === "running";
  const working = live ? (crew?.agents.filter(running) ?? []) : [];
  if (!crew || !working.length) return null;
  const waited = working.filter(holding);
  const latest = working.reduce((a, b) => (b.at > a.at ? b : a));
  return (
    <div className="lc-crs" role="status">
      <span className="lc-cr-faces lc-crs-faces" aria-hidden>
        {working.slice(0, 3).map((t) => (
          <span key={t.id}>
            <Kind name={agentName(t)} size={10} />
          </span>
        ))}
      </span>
      <span className="lc-crs-t">
        {waited.length ? `${crew.lead!.name} is waiting on ${plural(waited.length, "agent")}` : `${plural(working.length, "agent")} at work in the background`}
        <span className="lc-quiet">
          {" "}
          · {agentName(latest)} is {doing(agentNow(latest))}
        </span>
      </span>
      <button type="button" className="lc-ib l-focus" aria-label="Who's on this session" title="Who's on this session" onClick={() => (showAgent(thread.id, null), openSurface(thread.id, "agents"))}>
        <I.info size={14} />
      </button>
      {working.some((t) => t.agent?.taskId) && (
        <button type="button" className="lc-crs-stop l-focus" onClick={() => stopAll(thread.id, working)}>
          Stop agents
        </button>
      )}
    </div>
  );
}

/* ---------- the Agents surface ---------- */

/** The Agents surface: the whole crew, or one agent when one was opened. */
export function AgentsSurface({ thread, items }: { thread: Thread; items: Item[] }) {
  const profiles = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const crew = useMemo(() => crewOf(items.filter(isCrewItem), thread, profiles, providers), [items, thread, profiles, providers]);
  const picked = useShownAgent(thread.id);
  const agent = picked ? items.find((x): x is Tool => x.id === picked && isAgent(x)) : undefined;
  return <div className="lc-agents-panel lc-cr">{agent ? <AgentView key={agent.id} thread={thread} crew={crew} it={agent} items={items} /> : <CrewView thread={thread} crew={crew} items={items} />}</div>;
}

function CrewView({ thread, crew, items }: { thread: Thread; crew: Crew | null; items: Item[] }) {
  const providers = useEngine((s) => s.providers);
  const live = Boolean(crew && (crew.members.some((m) => m.status === "running") || crew.agents.some(running)));
  const now = useNow(live);
  const [launch, again] = useLaunch(thread.id);
  const servers = launch?.servers.filter((s) => s.status !== "stopped") ?? [];
  if (!crew)
    return (
      <>
        <p className="lc-cr-empty">Nobody has worked here yet. When a model takes your message, and when it sends agents off, they show here with who sent whom.</p>
        <SessionUse thread={thread} items={items} />
      </>
    );
  const working = crew.members.filter((m) => m.status === "running").length + crew.agents.filter(running).length;
  const background = crew.agents.filter((t) => t.agent?.background && running(t));
  const tree = (nodes: AgentNode[]): ReactNode =>
    nodes.map((n, i) => (
      <div key={n.it.id} className="lc-cr-kid" data-last={i === nodes.length - 1 || undefined}>
        <button type="button" className="lc-cr-row l-focus" onClick={() => showAgent(thread.id, n.it.id)}>
          <span className="lc-cr-tile">
            <Kind name={agentName(n.it)} size={13} />
          </span>
          <span className="lc-cr-t">
            <b>
              {agentName(n.it)}
              {n.it.agent?.model && <span> · {modelLabel(n.it.agent.model, providers)}</span>}
            </b>
            <small>
              <Mark state={stateOf(n.it)} />
              <span className={running(n.it) ? "l-shimmer" : undefined}>{agentNow(n.it)}</span>
            </small>
          </span>
          <span className="lc-cr-n l-num">{duration(secsOf(n.it, now))}</span>
        </button>
        {n.kids.length > 0 && <div className="lc-cr-kids">{tree(n.kids)}</div>}
      </div>
    ));
  const review = crew.reviews.at(-1);
  const plan = crew.plan ?? [];
  return (
    <>
      <div className="lc-cr-h">
        Who's on it<span className="lc-cr-rule" />
        <span>{working ? `${countOf(crew)} on it, ${working} working` : `${countOf(crew)} worked on it`}</span>
      </div>
      <div className="lc-cr-tree">
        <div className="lc-cr-row" data-root>
          <span className="lc-cr-av">Y</span>
          <span className="lc-cr-t">
            <b>
              You <span>· {crew.mode}</span>
            </b>
            <small>Message {crew.turn}</small>
          </span>
        </div>
        <div className="lc-cr-kids">
          {crew.members.map((m, i) => (
            <div key={m.key} className="lc-cr-kid" data-last={(i === crew.members.length - 1 && !review) || undefined}>
              <div className="lc-cr-row">
                <span className="lc-cr-disc" data-on={m.status === "running" || undefined}>
                  <ModelMark kind={markOf(m.model)} size={12} />
                </span>
                <span className="lc-cr-t">
                  <b>
                    {m.name}
                    {(m.role || m.tag) && <span> · {[m.role, m.tag].filter(Boolean).join(", ")}</span>}
                  </b>
                  <small>
                    <Mark state={m.status === "running" ? "running" : m.status === "error" ? "failed" : m.status === "stopped" ? "stopped" : "done"} />
                    {memberWord(m, now).replace(/^./, (c) => c.toUpperCase())}
                  </small>
                </span>
                <span className="lc-cr-n l-num">{duration(m.status === "running" ? (now - m.at) / 1000 : m.seconds)}</span>
              </div>
              {m.agents.length > 0 && <div className="lc-cr-kids">{tree(m.agents)}</div>}
            </div>
          ))}
          {review && (
            <div className="lc-cr-kid" data-last>
              <div className="lc-cr-row">
                <span className="lc-cr-disc" data-on={review.status === "running" || undefined}>
                  <I.shield size={12} />
                </span>
                <span className="lc-cr-t">
                  <b>
                    {modelLabel(review.reviewer, providers)} <span>· Reviewer</span>
                  </b>
                  <small>
                    <Mark state={review.status === "running" ? "running" : review.status === "passed" ? "done" : "failed"} />
                    {reviewWord(review).replace(/^./, (c) => c.toUpperCase())}
                  </small>
                </span>
                <span className="lc-cr-n l-num">{duration(review.status === "running" ? (now - review.at) / 1000 : review.seconds)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <Lanes crew={crew} now={now} />

      {plan.length > 0 && (
        <>
          <div className="lc-cr-h">
            Tasks<span className="lc-cr-rule" />
            <span>
              {plan.filter((p) => p.status === "completed").length} of {plan.length} done
            </span>
          </div>
          {plan.map((p, i) => (
            <div key={`${i}${p.title}`} className="lc-cr-task" data-state={p.status}>
              <Mark state={p.status === "completed" ? "done" : "running"} waiting={p.status === "pending"} />
              <span className="lc-cr-task-t">{p.title}</span>
              {p.owner ? <span className="lc-cr-own">{p.owner}</span> : p.status === "pending" && <span className="lc-quiet lc-cr-none">no one yet</span>}
            </div>
          ))}
        </>
      )}

      {(servers.length > 0 || background.length > 0) && (
        <>
          <div className="lc-cr-h">
            Background<span className="lc-cr-rule" />
            <span>{servers.length + background.length}</span>
          </div>
          {background.map((t) => (
            <button key={t.id} type="button" className="lc-cr-bg l-focus" onClick={() => showAgent(thread.id, t.id)}>
              <Kind name={agentName(t)} size={14} />
              <span className="lc-cr-t">
                <b>{agentName(t)}</b>
                <small>{agentTask(t)}</small>
              </span>
            </button>
          ))}
          {servers.map((s) => (
            <div key={s.name} className="lc-cr-bg">
              <I.server size={14} />
              <span className="lc-cr-t">
                <b className="lc-mono">{s.name}</b>
                <small>{[s.at ? `localhost:${s.at}` : s.status === "starting" ? "Starting" : undefined, s.startedAt ? duration((now - s.startedAt) / 1000) : undefined].filter(Boolean).join(" · ")}</small>
              </span>
              <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => void rpc("launch.stop", { threadId: thread.id, name: s.name }).then(again).catch(fail)}>
                Stop
              </button>
            </div>
          ))}
        </>
      )}

      <SessionUse thread={thread} items={items} />
    </>
  );
}

/**
  Who worked when, in lanes: each model's part, each agent's run (agents of agents under them),
  the Reviewer's reading. Where a model waits on its agents, its lane is hatched.
*/
function Lanes({ crew, now }: { crew: Crew; now: number }) {
  const providers = useEngine((s) => s.providers);
  type Lane = { key: string; label: string; from: number; to: number; live: boolean; wait?: [number, number]; next?: boolean };
  const lanes: Lane[] = [];
  const endOf = (at: number, live: boolean, seconds?: number) => (live ? now : at + (seconds ?? 0) * 1000);
  const walk = (nodes: AgentNode[]) => {
    for (const n of nodes) {
      const live = running(n.it) && n.it.status === "running";
      lanes.push({ key: n.it.id, label: agentName(n.it), from: n.it.at, to: Math.max(n.it.at + 500, endOf(n.it.at, live, n.it.seconds)), live });
      walk(n.kids);
    }
  };
  for (const m of crew.members) {
    const live = m.status === "running";
    const to = endOf(m.at, live, m.seconds);
    const held = m.agents.map((n) => n.it).filter((t) => !t.agent?.background);
    const wait: [number, number] | undefined = held.length ? [Math.min(...held.map((t) => t.at)), Math.max(...held.map((t) => endOf(t.at, holding(t), t.seconds)))] : undefined;
    lanes.push({ key: m.key, label: m.name, from: m.at, to: Math.max(m.at + 500, to), live, wait });
    walk(m.agents);
  }
  for (const r of crew.reviews.slice(-1)) lanes.push({ key: r.id, label: modelLabel(r.reviewer, providers), from: r.at, to: Math.max(r.at + 500, endOf(r.at, r.status === "running", r.seconds)), live: r.status === "running" });
  if (!lanes.length) return null;
  const start = Math.min(...lanes.map((l) => l.from));
  const end = Math.max(...lanes.map((l) => l.to), start + 1000);
  const span = end - start;
  const pct = (t: number) => `${(((t - start) / span) * 100).toFixed(2)}%`;
  const width = (a: number, b: number) => `${((Math.max(0, b - a) / span) * 100).toFixed(2)}%`;
  // Marks at a round step: 15 seconds, a minute, five, ten.
  const step = [5, 15, 30, 60, 120, 300, 600, 1800].find((s) => span / 1000 / s <= 4) ?? 3600;
  const ticks = Array.from({ length: Math.floor(span / 1000 / step) + 1 }, (_, i) => i * step);
  const tokens = crew.agents.reduce((n, t) => n + (t.agent?.tokens ?? 0), 0);
  return (
    <>
      <div className="lc-cr-h">
        Timeline<span className="lc-cr-rule" />
        <span className="l-num">
          {duration(span / 1000)}
          {tokens > 0 && ` · agents used ${compact(tokens)} tokens`}
        </span>
      </div>
      <div className="lc-cr-lanes">
        <span />
        <div className="lc-cr-axis l-num" aria-hidden>
          {ticks.map((s) => (
            <span key={s} style={{ left: `${Math.min(92, (s * 1000 * 100) / span)}%` }}>
              {s === 0 ? "0" : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`}
            </span>
          ))}
        </div>
        {lanes.map((l) => (
          <LaneRow key={l.key} label={l.label}>
            <span className="lc-cr-bar" data-live={l.live || undefined} style={{ left: pct(l.from), width: width(l.from, l.to) }} />
            {l.wait && <span className="lc-cr-bar" data-wait style={{ left: pct(Math.max(l.from, l.wait[0])), width: width(Math.max(l.from, l.wait[0]), Math.min(l.to, l.wait[1])) }} title="Waiting on its agents" />}
          </LaneRow>
        ))}
      </div>
    </>
  );
}
const LaneRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <span className="lc-cr-ll" title={label}>
      {label}
    </span>
    <div className="lc-cr-track">{children}</div>
  </>
);

/** One agent: who sent it, what it was asked, its steps, what it sent back; stop it, or tell the model that sent it. */
function AgentView({ thread, crew, it, items }: { thread: Thread; crew: Crew | null; it: Tool; items: Item[] }) {
  const providers = useEngine((s) => s.providers);
  const st = stateOf(it);
  const now = useNow(st === "running");
  const [say, setSay] = useState("");
  const a = it.agent;
  const name = agentName(it);
  // Who sent it: the agent above it, else the model whose part it came in.
  const parent = a?.parent ? items.find((x): x is Tool => x.id === a.parent && isAgent(x)) : undefined;
  const owner = crew?.members.find((m) => {
    const has = (ns: AgentNode[]): boolean => ns.some((n) => n.it.id === it.id || has(n.kids));
    return has(m.agents);
  });
  const sender = parent ? agentName(parent) : (owner?.name ?? "the model");
  const kids = items.filter((x): x is Tool => isAgent(x) && x.agent?.parent === it.id);
  const steps = a?.steps ?? [];
  // An agent whose tool takes a word mid-run (Codex's) hears it at its next step; another's goes to the model that sent it.
  const direct = Boolean(a?.steerable && a.taskId);
  const [heard, setHeard] = useState<string[]>([]);
  const send = () => {
    const text = say.trim();
    if (!text) return;
    setSay("");
    if (direct)
      void rpc("thread.steerAgent", { id: thread.id, item: it.id, text })
        .then((ok) => (ok ? setHeard((x) => [...x, text]) : toast.error(`${name} had finished, so it didn't hear that.`)))
        .catch(fail);
    else void rpc("thread.send", { id: thread.id, text: `About the ${name} agent you sent${a?.task ? ` (${a.task})` : ""}: ${text}`, mode: "steer" }).catch(fail);
  };
  return (
    <>
      <button type="button" className="lc-cr-back l-focus" onClick={() => showAgent(thread.id, null)}>
        <I.chevL size={13} />
        Agents
        {parent && (
          <>
            <I.chevR size={11} />
            <span>{agentName(parent)}</span>
          </>
        )}
      </button>
      <div className="lc-cr-ah">
        <span className="lc-cr-tile" data-big>
          <Kind name={name} size={15} />
        </span>
        <b>{name}</b>
        {a?.model && <span className="lc-cr-pill">{modelLabel(a.model, providers)}</span>}
        <span className="lc-grow" />
        {st === "running" && a?.taskId && (
          <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => void rpc("thread.stopAgent", { id: thread.id, item: it.id }).then((ok) => !ok && toast.error(`${name} has already stopped.`)).catch(fail)}>
            <I.stop size={10} />
            Stop it
          </button>
        )}
      </div>
      <div className="lc-cr-astat">
        <Mark state={st} />
        {[a?.background && st === "running" && it.status !== "running" ? "In the background" : STATE_WORD[st], duration(secsOf(it, now)), `sent by ${sender}`].filter(Boolean).join(" · ")}
      </div>
      {(a?.tools || a?.tokens) && (
        <div className="lc-cr-stats">
          {a?.tools ? (
            <span>
              <b>
                <Num value={a.tools} />
              </b>
              {a.tools === 1 ? "tool" : "tools"}
            </span>
          ) : null}
          {a?.tokens ? (
            <span>
              <b>
                <Num as="compact" value={a.tokens} />
              </b>
              tokens
            </span>
          ) : null}
        </div>
      )}

      <div className="lc-cr-h">Asked to</div>
      <div className="lc-cr-brief">{a?.brief ?? agentTask(it) ?? "Nothing said."}</div>

      {kids.length > 0 && (
        <>
          <div className="lc-cr-h">It sent {plural(kids.length, "agent")}</div>
          {kids.map((k) => (
            <button key={k.id} type="button" className="lc-cr-row l-focus" onClick={() => showAgent(thread.id, k.id)}>
              <span className="lc-cr-tile">
                <Kind name={agentName(k)} size={13} />
              </span>
              <span className="lc-cr-t">
                <b>{agentName(k)}</b>
                <small>
                  <Mark state={stateOf(k)} />
                  <span className={running(k) ? "l-shimmer" : undefined}>{agentNow(k)}</span>
                </small>
              </span>
            </button>
          ))}
        </>
      )}

      <div className="lc-cr-h">
        Steps<span className="lc-cr-rule" />
        <span>{steps.length || ""}</span>
      </div>
      {steps.length ? (
        <ul className="lc-cr-steps">
          {steps.map((s, i) => (
            <li key={i} data-state={s.status}>
              <Mark state={s.status === "running" ? "running" : s.status === "failed" ? "failed" : "done"} />
              <span className={s.status === "running" ? "l-shimmer" : undefined}>{s.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lc-cr-none">{st === "running" ? "None yet." : "Its tool doesn't say what it did, step by step."}</p>
      )}

      <div className="lc-cr-h">Report</div>
      <div className="lc-cr-report" data-empty={!a?.report || undefined}>
        {a?.report ?? (st === "running" ? (a?.background && it.status !== "running" ? `It works in the background; ${sender} hears when it ends.` : `Goes back to ${sender} when it finishes, and shows here.`) : st === "stopped" ? `Stopped before it reported. ${sender} was told.` : (it.output ?? "Nothing came back."))}
      </div>

      {st === "running" && (direct || (thread.status === "running" && !parent)) && (
        <>
          <label className="lc-cr-steer">
            <input
              type="text"
              value={say}
              placeholder={direct ? `Tell ${name} something…` : `Tell ${sender} what ${name} should do instead…`}
              onChange={(e) => setSay(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") send();
              }}
            />
            <span className="lc-quiet">↵</span>
          </label>
          {heard.map((w, i) => (
            <div key={i} className="lc-cr-heard">
              <Mark state="done" />
              <span>“{w}”</span>
              <span className="lc-quiet">at its next step</span>
            </div>
          ))}
          <p className="lc-cr-hint">
            {direct
              ? "Goes in at its next step, without stopping it."
              : `${name}'s tool can't take a word mid-run, so this goes to ${sender} now, without stopping it; it can stop ${name} and send a new one.${a?.taskId ? " Stop it works on the agent directly." : ""}`}
          </p>
        </>
      )}
    </>
  );
}

/** What the session has used: tokens, the cache, the cost, the context, the tools. */
function SessionUse({ thread, items }: { thread: Thread; items: Item[] }) {
  const settings = useEngine((s) => s.settings);
  const keys = useEngine((s) => s.keys);
  const providers = useEngine((s) => s.providers);
  const agents = useEngine((s) => s.agents);
  const u = thread.usage;
  const tools = items.filter((x) => x.kind === "tool").length;
  const turns = items.filter((x): x is Turn => x.kind === "turn");
  const coder = agentOf(thread.agent, agents, providers);
  // No cost reported: say who pays, as the engine bills it (runtime.ts gives Claude Code the Anthropic
  // key when it bills to the key, and Codex the OpenAI key whenever one is saved).
  const ran = [...new Set([...turns.map((t) => t.model), thread.model ?? coder.model].filter(Boolean).map((m) => m!.replace(/^@/, "").split(":")[0]))];
  const payer = (id: string) => {
    if (id === "demo") return "Nothing: a scripted run";
    const p = providers.find((x) => x.id === id);
    if (p?.endpoint) return `Billed by ${p.label}`;
    if (id === "claude" && settings.claudeBilling === "key" && keys.includes("anthropic")) return "Billed to your Anthropic key";
    if (id === "codex" && keys.includes("openai")) return "Billed to your OpenAI key";
    return "Included in your plan";
  };
  const unpriced = [...new Set(ran.map(payer))].join("; ") || "Included in your plan";
  return (
    <>
      <div className="lc-cr-h">
        This session<span className="lc-cr-rule" />
      </div>
      <dl className="lc-fields lc-fields-quiet">
        <div>
          <dt>Tokens</dt>
          <dd>
            <Num as="compact" value={u.inputTokens + u.outputTokens + u.cacheReadTokens} />
          </dd>
        </div>
        <div>
          <dt>From cache</dt>
          <dd>{u.inputTokens + u.cacheReadTokens ? <Num as="percent" value={u.cacheReadTokens / (u.inputTokens + u.cacheReadTokens)} /> : "–"}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{u.costUsd ? <Num as="money" value={u.costUsd} /> : unpriced}</dd>
        </div>
        {u.contextWindow ? (
          <div>
            <dt>Context</dt>
            <dd>
              <Num as="compact" value={u.contextTokens ?? 0} /> of {compact(u.contextWindow)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Tools used</dt>
          <dd>
            <Num value={tools} />
          </dd>
        </div>
      </dl>
    </>
  );
}
