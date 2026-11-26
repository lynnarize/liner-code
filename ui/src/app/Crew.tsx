/*
  Who's on a session's work, and who sent whom. Liner Code puts models on a message (the lead, the
  Reviewer, and in a session from before pairs a planner and a builder), and those models send agents off to do parts of it
  (Claude Code's Agent tool: Explore, the Test runner, a general Subagent), each under the one that
  sent it, agents of agents included. All of it is read from the timeline: the turn items say who
  worked, the "task" rows say which agents were sent and carry what each was asked, does now and
  sent back (AgentRun). A pair's sidekick is one of them: the lead's call to Liner Code's sidekick
  tool is its row, named after its model, with the files it changed as Liner Code measured them;
  and it's named as the pair's even before its first brief. Shown four ways: the header's crew chip and its popover, the fan-out under
  a turn's work, a line on the composer while the work waits on agents, and the Agents surface
  (the tree, a timeline of who worked when, the tasks with who took them, what runs in the
  background), where one agent opens on its own. An agent in the background (Claude Code's by
  default, Codex's past its turn) outlives the turn that sent it and ends on its own row, turns
  later: until then it counts wherever agents at work do, whichever message is the latest.
*/
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { toast } from "@liner/components/toast/toast";
import { SWARM_SELF_TURNS_MAX, agentState, isPair, isSwarm, type AgentProfile, type AgentStep, type FileChange, type Item, type PairShare, type PlanEntry, type ProviderInfo, type SwarmMember, type SwarmPost, type SwarmSnapshot, type Thread } from "@contracts";
import { getState, rpc, threadOf, useEngine, useItemsWhere, useSwarm } from "./engine";
import { I, ModelMark, StepMark, type StepState } from "./icons";
import { useLaunch } from "./launch";
import { agentOf, compact, duration, isModelAgent, markOf, modelLabel, planEnd, planStatus, plural, sumLines, type PlanEnd } from "./model";
import { ModelPop } from "./Models";
import { openSurface } from "./TopBar";
import { ConfirmRow, Lines, MenuFoot, NamedSwitch, Num, PanelHead, Pop, Row, Sep } from "./ui";
import { PANE_PICK, PANE_ROW, PANE_TOOL, PaneButton, PaneHead, PaneNote, PaneRow, PaneRowIn, PaneWords } from "./Pane";
import { agentsReach, crewCounts, teamCounts, teamLine, teamTree, type TeamLevel } from "./chat-cards";
import { SendBox } from "./Composer";
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
/** A path's last part: "src/tides.js" is tides.js. */
const nameOf = (path: string) => path.split("/").pop() || path;
/** The frames a sidekick drew on the canvas (AgentRun.frames), said as a row says files: by name for one or two. */
const drewSaid = (frames: { name: string }[], after = false) => `${frames.length <= 2 ? (after ? "drew" : "Drew") : after ? "changed" : "Changed"} ${frames.length <= 2 ? frames.map((f) => f.name).join(" and ") : plural(frames.length, "frame")}`;
/** "+3 −1" in words, for a screen reader: "3 lines added, 1 removed". */
const linesSaid = ({ added, removed }: { added: number; removed: number }) => [added > 0 && `${plural(added, "line")} added`, removed > 0 && `${added > 0 ? removed : plural(removed, "line")} removed`].filter(Boolean).join(", ");
const FILE_WORD: Record<string, string> = { added: "Added", deleted: "Deleted", renamed: "Renamed" };
/** A pair's sidekick on a brief: the lead's call to Liner Code's sidekick tool, by any tool's name for it (mcp__liner__sidekick, liner.sidekick, liner_sidekick). */
export const isSidekick = (t: Tool) => /(?:^|[._])sidekick$/.test(t.tool);
/** A brief or subagent stopped while it waited its turn: it never started. */
const unstarted = (t: Tool) => (isSidekick(t) || /(?:^|[._])subagent$/.test(t.tool)) && stateOf(t) === "stopped" && !t.agent?.tools && !t.agent?.steps?.length;
/** Who an agent is, by name: a sidekick by its model ("GPT-6.1 Sol"), the rest by their kind ("Explore"). */
export const whoIs = (t: Tool, providers: ProviderInfo[]) => (isSidekick(t) ? (t.agent?.model ? modelLabel(t.agent.model, providers) : "Sidekick") : agentName(t));
/**
  A model's name, short, for a pair said in one breath: "GPT-6.1 Sol" is Sol, "DeepSeek V4.1 Flash"
  DeepSeek Flash, "GLM-5.3 Flash" GLM Flash; a name with nothing after its version ("Opus 5.5") stays.
*/
export const shortModel = (label: string) => label.replace(/^GPT-[\d.]+\s+(?=\S)/i, "").replace(/^(\S+?)[\s-]+v?\d[\d.]*\s+(?=\S)/i, "$1 ");
/**
  A pair, by name: its lead (the model, or your agent) and its sidekick, and the two in one breath
  ("Opus 5.5 + Sol"). The same model on both sides is named once ("Demo", not "Demo + Demo": the same ref or the same full label, since short names drop versions), and
  `same` says so, for the faces that would show it twice. Null for a session of one model.
*/
export function pairOf(t: Thread, agents: AgentProfile[], providers: ProviderInfo[]) {
  if (!isPair(t)) return null;
  const a = agentOf(t.agent, agents, providers);
  const bare = isModelAgent(t.agent) || t.agent === "demo";
  const leadRef = t.model ?? a.model;
  const lead = bare ? modelLabel(leadRef, providers) : a.name;
  const side = modelLabel(t.sidekick!, providers);
  const same = bare && (leadRef === t.sidekick || lead === side);
  return { lead, leadRef, side, sideRef: t.sidekick!, same, name: same ? shortModel(lead) : `${bare ? shortModel(lead) : lead} + ${shortModel(side)}` };
}
export type PairNames = NonNullable<ReturnType<typeof pairOf>>;
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
  if (unstarted(t)) return "Stopped before it started";
  if (s === "stopped") return "Stopped before it finished";
  if (s === "failed") return firstLine(t.output) ?? "Ran into a problem";
  // A row from before agents said how they ended: its call returned and nothing more was heard.
  if (t.agent?.background && t.agent.state === undefined && !t.agent.report) return "Working in the background";
  return firstLine(t.agent?.report) ?? firstLine(t.output) ?? "Finished";
}
/** How long it has run: its clock while it's at work (in the background too), else what the engine kept at its end. */
const secsOf = (t: Tool, now: number) => (stateOf(t) === "running" ? Math.max(0, (now - t.at) / 1000) : t.seconds);
/** "12 tools · 18k · 41s" */
export function agentStats(t: Tool, now: number) {
  const a = t.agent;
  return [a?.tools ? plural(a.tools, "tool") : null, a?.tokens ? compact(a.tokens) : null, duration(secsOf(t, now)) || null].filter(Boolean).join(" · ");
}

/* ---------- the crew of the latest message ---------- */

export type AgentNode = { it: Tool; kids: AgentNode[] };
export type Member = { key: string; agent: string; model: string; name: string; tag?: string; role?: string; status: Turn["status"]; at: number; seconds?: number; agents: AgentNode[] };
/** `earlier`: agents an earlier message sent that are still at work, in the background past their turn. */
export type Crew = { turn: number; mode: string; members: Member[]; reviews: Review[]; agents: Tool[]; earlier: Tool[]; plan?: PlanEntry[]; /** How the run that made the plan ended (model.ts planEnd). */ planEnd?: PlanEnd; start: number; lead?: Member; pair: PairNames | null };

/** What a part of a turn did, for a session from before too (a planner, a builder, a refiner). */
const ROLE: Record<string, string> = { build: "Builder", refine: "Refiner", repair: "Fixer", fix: "Fixer", revise: "Reviser", takeover: "Took over" };

/**
  Who worked on your latest message: each model's part (the lead, its fix after the Reviewer), with the
  agents it sent (in order, under the one that sent each), and the Reviewer's rounds. The model
  at work, or the last one, leads. With them, the agents of earlier messages still at work: a new
  turn (one Claude Code starts by itself when one of them ends, too) doesn't make them leave.
*/
export function crewOf(items: Item[], thread: Thread, profiles: AgentProfile[], providers: ProviderInfo[]): Crew | null {
  let turn = -1;
  for (const it of items) if (it.kind === "turn" && it.turn > turn) turn = it.turn;
  if (turn < 0) return null;
  const members: Member[] = [];
  const reviews: Review[] = [];
  const agents: Tool[] = [];
  const earlier: Tool[] = [];
  const nodes = new Map<string, AgentNode>();
  let plan: PlanEntry[] | undefined;
  let cur: Member | undefined;
  const pair = pairOf(thread, profiles, providers);
  for (const it of items) {
    if (it.turn !== turn) {
      if (isAgent(it) && stateOf(it) === "running") earlier.push(it);
      continue;
    }
    if (it.kind === "turn") {
      const role = it.planning ? "Planner" : it.part ? ROLE[it.part] : pair && it.agent === thread.agent ? "Lead" : undefined;
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
  const mode = pair ? "Fusion" : "One model";
  return { turn, mode, members, reviews, agents, earlier, plan, planEnd: planEnd(planStatus(items, turn)), start: members[0].at, lead: members.findLast((m) => m.status === "running") ?? members.at(-1), pair };
}

/** The crew of a session, read from only the items that make it (not every streamed word). */
export function useCrew(thread: Thread) {
  const items = useItemsWhere(thread.id, isCrewItem);
  const profiles = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  return useMemo(() => crewOf(items, thread, profiles, providers), [items, thread.sidekick, thread.sideOf, thread.agent, thread.model, profiles, providers]);
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
/** At work and not waited on: in the background, its call returned (or its turn over), on until it ends. */
const behind = (t: Tool) => running(t) && !holding(t);
/** Every agent under these, agents of agents too: a model waits on the Subagent its Explore sent as much as on the Explore. */
const everyAgent = (nodes: AgentNode[]): Tool[] => nodes.flatMap((n) => [n.it, ...everyAgent(n.kids)]);
/** Every agent at work now: the latest message's, and those earlier ones left in the background. */
const atWork = (crew: Crew) => [...crew.agents.filter(running), ...crew.earlier];
/** Who's held up on, said as the work is: "its sidekick", "2 agents", "its sidekick and an agent". */
function onWhom(tools: Tool[]) {
  const side = tools.some(isSidekick);
  const rest = tools.filter((t) => !isSidekick(t)).length;
  return side ? (rest ? `its sidekick and ${plural(rest, "agent")}` : "its sidekick") : plural(rest, "agent");
}
/** "waiting on its sidekick · 2 in the background", "waiting on 1 agent", or either half, or nothing. */
const waitWords = (waited: Tool[], back: number) => [waited.length ? `waiting on ${onWhom(waited)}` : "", back ? `${back} in the background` : ""].filter(Boolean).join(" · ");
/** Everyone on it: the models, the agents (a pair's sidekick once, however many briefs), the Reviewers. */
const countOf = (crew: Crew) => crew.members.length + crew.agents.filter((t) => !isSidekick(t)).length + crew.earlier.length + (crew.pair ? 1 : 0) + new Set(crew.reviews.map((r) => r.reviewer)).size;
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
  if (itemId !== null) agentsSurface(threadId);
}
/**
  The Agents surface of this session's panel. The chat cards show in Liner Design and in a side chat too, where no Code
  session of this thread is on screen to open it (openSurface finds none): there App opens the session in Liner Code with
  the surface showing (chat-cards.ts agentsReach), so the press is never lost.
*/
function agentsSurface(threadId: string) {
  const t = getState().threads.find((x) => x.id === threadId);
  if (agentsReach(openSurface(threadId, "agents"), Boolean(t?.security)) === "code") window.dispatchEvent(new CustomEvent("lc:show-surface", { detail: { id: threadId, tab: "agents" } }));
}
function useShownAgent(threadId: string) {
  return useSyncExternalStore(
    (w) => (watchers.add(w), () => void watchers.delete(w)),
    () => shown.get(threadId) ?? null,
  );
}

/* ---------- small parts ---------- */

/**
  An agent's kind, as a mark: Explore (Codex's Explorer) looks, the Test runner runs tests, the rest
  do what they're sent to, one Codex calls by a nickname ("Planck") as well.
*/
function Kind({ name, size = 12 }: { name: string; size?: number }) {
  const Icon = /^explor/i.test(name) ? I.search : /^test/i.test(name) ? I.flask : I.mark;
  return <Icon size={size} />;
}
/** An agent's face: a sidekick's is its model's mark, the rest their kind's. */
function Face({ t, size = 12 }: { t: Tool; size?: number }) {
  return isSidekick(t) && t.agent?.model ? <ModelMark kind={markOf(t.agent.model)} size={size} /> : <Kind name={agentName(t)} size={size} />;
}
const STATE_WORD: Record<State, string> = { running: "Working", done: "Finished", failed: "Ran into a problem", stopped: "Stopped" };
const STEP_OF: Record<State, StepState> = { running: "working", done: "done", failed: "failed", stopped: "skipped" };
const HEAD_WORD: Record<StepState, string> = { working: "Working", done: "All finished", failed: "One ran into a problem", skipped: "Stopped", waiting: "Waiting" };
/**
  How it stands, as the Plan list's marks (icons.tsx StepMark, the state mark): the working light
  at work, the finished shape when done, the problem shape when it ran into one, the faint shape
  when it was stopped or hasn't started (its words tell those two apart).
*/
export function Mark({ state, waiting }: { state: State; waiting?: boolean }) {
  return <StepMark className="lc-cr-mark" size={14} state={waiting ? "waiting" : STEP_OF[state]} label={waiting ? "Waiting" : STATE_WORD[state]} />;
}

/* ---------- the header's chip and the agents popup ---------- */

/** The agents popup, open or not, by session: its chip in the header holds it, and the Session card and the cards in the chat open it. */
const popOpen = new Map<string, boolean>();
const popWatchers = new Set<() => void>();
/** The sessions whose chip is on screen now, so a row that opens the popup opens the Agents surface where there is none. */
const chipsShown = new Set<string>();
function setPop(threadId: string, open: boolean) {
  popOpen.set(threadId, open);
  for (const w of popWatchers) w();
}
function usePopOpen(threadId: string, fallback = false) {
  return useSyncExternalStore(
    (w) => (popWatchers.add(w), () => void popWatchers.delete(w)),
    () => popOpen.get(threadId) ?? fallback,
  );
}
/**
  Opens the agents popup from its chip in the header; where the header shows no chip (nobody at work and no team on),
  the Agents surface in the panel, which lists the same.
*/
export function openAgents(threadId: string) {
  if (chipsShown.has(threadId)) setPop(threadId, true);
  else (showAgent(threadId, null), agentsSurface(threadId));
}

/** The chip's Pop, wired to the session's popup state: one place for a crew's chip and a team's. */
function ChipPop({ threadId, label, trigger, children }: { threadId: string; label: string; trigger: ReactNode; children: (close: () => void) => ReactNode }) {
  const open = usePopOpen(threadId);
  useEffect(() => {
    chipsShown.add(threadId);
    // The chip goes when the work ends: a popup left open then would drop open by itself with the next chip.
    return () => void (chipsShown.delete(threadId), popOpen.delete(threadId));
  }, [threadId]);
  return (
    <Pop label={label} width={340} align="start" className="lc-crew-pop" triggerClass="lc-crew l-focus" open={open} onOpenChange={(o) => setPop(threadId, o)} trigger={trigger}>
      {children}
    </Pop>
  );
}

/**
  Teamwork's and a Swarm's chip: it opens the team in the Agents panel (the right tab), which lists every member, the
  board, the worktrees and the team's actions. Nothing of the team is pinned over the chat: the panel already holds it.
*/
function TeamChip({ threadId, label, children }: { threadId: string; label: string; children: ReactNode }) {
  return (
    <button type="button" className="lc-crew l-focus" aria-label={`${label}: who works, the board and the worktrees, in the Agents panel`} onClick={() => showTeamView(threadId, "all")}>
      {children}
    </button>
  );
}
/** Opens the team in the Agents panel: what turning Teamwork or a Swarm on shows, as the chip does. */
export function showTeam(threadId: string) {
  showTeamView(threadId, "all");
}

/**
  The header's chip: who leads your latest message and how many work for it ("Sonnet 5.5 · 3 agents") while two or more
  are at work in this session right now (the lead's turn running counts one, each agent it sent that still works one
  more), and always while Teamwork or a Swarm is on ("Swarm 2 of 5 working"). At rest the header holds nothing between
  the title and the Reviewer. A pair is named as one ("Opus 5.5 + Sol"). It opens the agents popup (board Agents).
*/
export function CrewChip({ thread }: { thread: Thread }) {
  const crew = useCrew(thread);
  const swarmOn = isSwarm(thread);
  const swarm = useSwarm(thread.id, swarmOn);
  if (swarmOn && swarm) {
    const live = swarm.members.filter((m) => m.state !== "killed");
    const working = live.filter((m) => m.state === "working").length;
    const label = swarm.mode === "swarm" ? "Swarm" : "Teamwork";
    return (
      <TeamChip threadId={thread.id} label={label}>
        <span className="lc-crew-t">
          {label}
          <span className="lc-quiet"> {swarm.paused ? "paused" : working ? `${working} of ${live.length} working` : live.length > 1 ? `${live.length - 1} parked` : "ready"}</span>
        </span>
      </TeamChip>
    );
  }
  if (!crew) return null;
  const working = atWork(crew);
  if ((thread.status === "running" ? 1 : 0) + working.length < 2) return null;
  const pair = crew.pair;
  const lead = crew.lead!;
  // A pair's sidekick is in its name; the agents besides it are counted.
  const others = [...crew.agents, ...crew.earlier].filter((t) => !isSidekick(t)).length;
  return (
    <ChipPop
      threadId={thread.id}
      label="Who's on this session"
      trigger={
        <>
          {/* It shows only while two or more work; the faces say who. No working mark: the live line and the session's row move for it. */}
          <span className="lc-cr-faces" aria-hidden>
            <span>
              <ModelMark kind={markOf(pair ? pair.leadRef : lead.model)} size={12} />
            </span>
            {pair && !pair.same && (
              <span>
                <ModelMark kind={markOf(pair.sideRef)} size={12} />
              </span>
            )}
            {working
              .filter((t) => !pair || !isSidekick(t))
              .slice(0, pair && !pair.same ? 1 : 2)
              .map((t) => (
                <span key={t.id}>
                  <Face t={t} size={12} />
                </span>
              ))}
          </span>
          {/* The models by name, then the agents they sent counted after a dot: a "+" read as one more model. */}
          {pair ? (
            <span className="lc-crew-t">
              {pair.name}
              {others > 0 && <span className="lc-quiet"> · {plural(others, "agent")}</span>}
            </span>
          ) : (
            <span className="lc-crew-t">
              {lead.name}
              {crew.agents.length + crew.earlier.length > 0 && <span className="lc-quiet"> · {plural(crew.agents.length + crew.earlier.length, "agent")}</span>}
            </span>
          )}
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => <CrewPop thread={thread} crew={crew} close={close} />}
    </ChipPop>
  );
}

/** A team member's mark in a list (rule 7): the working mark at work, a ring while it waits or is parked, a tick once it ended, a cross when it was stopped by a problem. */
function memberStep(m: SwarmMember): StepState {
  if (m.state === "working") return "working";
  if (m.state === "stopped") return m.now && /^Could not start/.test(m.now) ? "failed" : "done";
  if (m.state === "skipped") return "skipped";
  return "waiting";
}
/** What a member's row says at its end: its clock at work, else how it waits. */
function memberEnd(m: SwarmMember, now: number) {
  if (m.state === "working") return m.startedAt ? duration(Math.max(0, (now - m.startedAt) / 1000)) : "working";
  if (m.state === "queued") return "waits for a slot";
  if (m.state === "waiting") return "waits";
  if (m.state === "hibernated") return "parked";
  if (m.state === "skipped") return "skipped";
  return m.landed ? "landed" : "finished";
}
/** "@scout" in a Swarm, "Scene builder" in Teamwork: peers go by name, a team's agents by their part. */
const memberName = (m: SwarmMember, swarmMode: boolean) => (swarmMode ? `@${m.name}` : m.role || `@${m.name}`);

/** Which of a team's views the Agents surface shows when it opens: the whole list, the board, the worktrees, or the add-worker form. */
export type TeamView = "all" | "board" | "worktrees" | "add";
const teamViews = new Map<string, TeamView>();
const viewWatchers = new Set<() => void>();
/** Opens a team's view in the Agents surface (the popup's Board and Worktrees rows, Add a worker). */
export function showTeamView(threadId: string, view: TeamView) {
  teamViews.set(threadId, view);
  shown.set(threadId, null);
  for (const w of [...viewWatchers, ...watchers]) w();
  agentsSurface(threadId);
}
function useTeamView(threadId: string): [TeamView, (v: TeamView) => void] {
  const v = useSyncExternalStore(
    (w) => (viewWatchers.add(w), () => void viewWatchers.delete(w)),
    () => teamViews.get(threadId) ?? "all",
  );
  return [v, (to) => (teamViews.set(threadId, to), viewWatchers.forEach((w) => w()))];
}

/** Why a team waits for you, in a few words. */
const pausedWords = (swarm: SwarmSnapshot) => (swarm.paused?.reason === "limit" ? `Paused after ${swarm.paused.turns ?? SWARM_SELF_TURNS_MAX} turns it started by itself` : swarm.paused?.reason === "restart" ? "Paused: Liner Code restarted" : "Paused by you");

/**
  The agents popup for a plain crew (board Agents, in a session with no team): who leads your latest message with the
  agents it sent under it on a guide line, agents of agents nested, finished ones folded to "N finished ›", the Reviewer,
  those still at work from an earlier message; then Stop and the panel; a grey foot line of counts.
*/
function CrewPop({ thread, crew, close }: { thread: Thread; crew: Crew; close: () => void }) {
  const providers = useEngine((s) => s.providers);
  const working = crew.members.filter((m) => m.status === "running").length + atWork(crew).length + crew.reviews.filter((r) => r.status === "running").length;
  const now = useNow(working > 0);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const open = (t: Tool) => (close(), showAgent(thread.id, t.id));
  const agentRow = (t: Tool, kids: number) => (
    <Row
      key={t.id}
      title={
        <>
          {whoIs(t, providers)}
          {isSidekick(t) ? <span className="lc-quiet"> Sidekick</span> : kids > 0 ? <span className="lc-quiet"> ({plural(kids, "agent")})</span> : null}
        </>
      }
      icon={<StepMark size={14} state={STEP_OF[stateOf(t)]} />}
      end={duration(secsOf(t, now))}
      onPick={() => open(t)}
    />
  );
  const branch = (nodes: AgentNode[], key: string): ReactNode => {
    const done = nodes.filter((n) => !running(n.it) && !n.kids.some((k) => running(k.it)));
    const fold = done.length > 1 && !unfolded.has(key);
    return (
      <div className="lc-ap-kids">
        {nodes.map((n) =>
          fold && done.includes(n) ? null : (
            <div key={n.it.id}>
              {agentRow(n.it, n.kids.length)}
              {n.kids.length > 0 && branch(n.kids, n.it.id)}
            </div>
          ),
        )}
        {fold && <Row title={`${done.length} finished`} icon={<StepMark size={14} state="done" />} chevron onPick={() => setUnfolded((was) => new Set([...was, key]))} />}
      </div>
    );
  };
  const memberState = (m: Member): StepState => (m.status === "running" ? "working" : m.status === "error" ? "failed" : m.status === "stopped" ? "skipped" : "done");
  return (
    <div className="lc-ap">
      <PanelHead end={working ? `${working} of ${countOf(crew)} working` : `${countOf(crew)} worked on it`}>{crew.pair ? "Fusion" : "Agents"}</PanelHead>
      {crew.members.map((m) => (
        <div key={m.key}>
          <Row
            title={
              <>
                {m.name}
                {m.role ? <span className="lc-quiet"> {m.role}</span> : null}
              </>
            }
            icon={<StepMark size={14} state={memberState(m)} />}
            end={duration(m.status === "running" ? (now - m.at) / 1000 : m.seconds)}
            onPick={() => (close(), showAgent(thread.id, null), openSurface(thread.id, "agents"))}
          />
          {m.agents.length > 0 && branch(m.agents, m.key)}
        </div>
      ))}
      {crew.earlier.length > 0 && (
        <>
          <PanelHead>Still at work from an earlier message</PanelHead>
          {branch(
            crew.earlier.map((it) => ({ it, kids: [] })),
            "earlier",
          )}
        </>
      )}
      {crew.reviews.slice(-1).map((r) => (
        <Row key={r.id} title={<>{modelLabel(r.reviewer, providers)}<span className="lc-quiet"> Reviewer</span></>} icon={<StepMark size={14} state={r.status === "running" ? "working" : r.status === "blocked" || r.status === "error" ? "failed" : "done"} />} end={reviewWord(r)} />
      ))}
      <Sep />
      <Row title="Every agent, in the panel" icon={<I.panel size={14} />} chevron onPick={() => (close(), showAgent(thread.id, null), openSurface(thread.id, "agents"))} />
      {atWork(crew).some((t) => t.agent?.taskId) && <Row title={stopWord(atWork(crew), "Stop all agents")} icon={<I.stop size={14} />} red onPick={() => (close(), stopAll(thread.id, atWork(crew)))} />}
      <Sep />
      <MenuFoot>{waitWords(atWork(crew).filter(holding), atWork(crew).filter(behind).length) || (working ? `${working} working` : "Nobody works now")}</MenuFoot>
    </div>
  );
}

/* ---------- the card in the chat ---------- */

/** Each card's folded or open, by session and card, kept in this browser (a per-viewer convenience; it may come back empty). */
const FOLD_KEY = "lc-card-fold";
const folds: Record<string, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
})();
const foldWatchers = new Set<() => void>();
/** A card's open state for this session, remembered: open until you fold it. */
export function useCardFold(threadId: string, card: string): [boolean, (open: boolean) => void] {
  const key = `${threadId}:${card}`;
  const shut = useSyncExternalStore(
    (w) => (foldWatchers.add(w), () => void foldWatchers.delete(w)),
    () => folds[key] === true,
  );
  return [
    !shut,
    (open) => {
      if (open) delete folds[key];
      else folds[key] = true;
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
      } catch {}
      for (const w of foldWatchers) w();
    },
  ];
}

/**
  The team at work, as a card at the chat's end under the Plan (SPEC rule 6, boards Swarm and Teamwork): its name, its
  counts, the model and memory and Pause in its head; an agent a row (its mark, its name, what it does now, its time);
  Teamwork as a tree. Folded: the name, the counts and what one working agent is doing. Its name opens the agents popup.
  A plain crew (agents a model sent) has the same card while two or more work, or one goes on past its turn: one agent
  while the turn runs is the live line's to say. It took the place of the strips over the message box.
*/
export function CrewCard({ threadId, team = true }: { threadId: string; team?: boolean }) {
  const thread = useEngine((s) => threadOf(s, threadId));
  if (!thread) return null;
  return <CrewCardOf thread={thread} team={team} />;
}
/*
  `team` false: no card here, for a Teamwork, a Swarm or a plain crew of agents. A Code session's own Agents panel (the
  right tab) lists them, the header's chip opens it, and the chat's "Started 3 agents" line says who went, so a card kept
  at the chat's end only said it again, with marks and clocks of its own (2026-11-26, after Capy). Liner Design's chat and
  a Liner Security scan have no such panel, so theirs stays.
*/
function CrewCardOf({ thread, team }: { thread: Thread; team: boolean }) {
  const crew = useCrew(thread);
  const swarmOn = isSwarm(thread);
  const swarm = useSwarm(thread.id, swarmOn && team);
  if (!team) return null;
  if (swarmOn && swarm) {
    const workers = swarm.members.filter((m) => m.name !== "coordinator" && m.state !== "killed");
    const busy = workers.some((m) => m.state === "working" || m.state === "queued") || swarm.members.some((m) => m.name === "coordinator" && m.state === "working");
    if (workers.length && (busy || swarm.paused || thread.status === "running")) return <TeamCard thread={thread} swarm={swarm} />;
    return null;
  }
  const working = crew ? atWork(crew) : [];
  if (!crew || !working.length || lone(thread, working)) return null;
  return <AgentsCard thread={thread} crew={crew} working={working} />;
}

/** A card's head: the fold chevron, its name (which opens the agents popup), the counts, the folded line, and its end. */
function CardHead({ threadId, open, onOpen, name, counts, line, end, still }: { threadId: string; open: boolean; onOpen: (o: boolean) => void; name: string; counts: string; line?: string; end?: ReactNode; still?: boolean }) {
  return (
    <div className="lc-ccard-h">
      <button type="button" className="lc-ccard-fold l-focus" aria-expanded={open} aria-label={open ? `Fold the ${name} card` : `Open the ${name} card`} onClick={() => onOpen(!open)}>
        <I.chevR size={12} className="lc-sum-chev" />
      </button>
      <button type="button" className="lc-ccard-name l-focus" title={still ? undefined : "Who works, in the agents popup"} disabled={still} onClick={() => openAgents(threadId)}>
        <b>{name}</b>
        {counts && <span className="lc-quiet">{counts}</span>}
      </button>
      {!open && line && <span className="lc-ccard-line">{line}</span>}
      <span className="lc-grow" />
      {end}
    </div>
  );
}

function TeamCard({ thread, swarm }: { thread: Thread; swarm: SwarmSnapshot }) {
  const providers = useEngine((s) => s.providers);
  const [open, setOpen] = useCardFold(thread.id, "team");
  // A scan's card has nowhere to open its agents (agentsReach): its rows say who works and are not buttons.
  const still = agentsReach(false, Boolean(thread.security)) === "none";
  const swarmMode = swarm.mode === "swarm";
  const live = swarm.members.filter((m) => m.state !== "killed");
  const coord = live.find((m) => m.name === "coordinator");
  const now = useNow(live.some((m) => m.state === "working"));
  const tree = useMemo(() => teamTree(swarm.members), [swarm.members]);
  const name = swarmMode ? "Swarm" : "Teamwork";
  const busy = live.some((m) => m.name !== "coordinator" && (m.state === "working" || m.state === "queued" || m.state === "waiting"));
  const pause = swarm.paused ? (
    <button type="button" className="lc-ccard-act l-focus" onClick={() => void rpc("swarm.resume", { threadId: thread.id }).catch(fail)}>
      Carry on
    </button>
  ) : (
    busy && (
      <button type="button" className="lc-ccard-act l-focus" onClick={() => void rpc("swarm.stopAll", { threadId: thread.id }).catch(fail)}>
        Pause
      </button>
    )
  );
  const row = (m: SwarmMember, depth: number, kids = 0) => (
    <li key={m.name} className="lc-ccard-r" style={{ "--d": depth } as CSSProperties}>
      <button type="button" className="lc-ccard-rb l-focus" disabled={still || !m.itemId} onClick={() => m.itemId && showAgent(thread.id, m.itemId)}>
        <StepMark size={14} state={m.name === "coordinator" ? (m.state === "working" || swarm.activeSlots > 0 ? "working" : "waiting") : memberStep(m)} />
        <span className="lc-ccard-who">
          {m.name === "coordinator" ? "Coordinator" : memberName(m, swarmMode)}
          {kids > 0 && !swarmMode && <span className="lc-quiet"> ({kids})</span>}
        </span>
        <span className="lc-ccard-t">{m.name === "coordinator" ? (swarm.paused ? pausedWords(swarm) : swarm.activeSlots > 0 ? `Coordinating ${swarm.activeSlots} active` : (m.now ?? "Ready")) : m.state === "queued" ? "Waits for a slot" : (m.now ?? SWARM_STATE_WORD[m.state])}</span>
        <span className="lc-ccard-n l-num">{m.name === "coordinator" ? (m.startedAt && m.state === "working" ? duration((now - m.startedAt) / 1000) : "") : memberEnd(m, now)}</span>
      </button>
    </li>
  );
  const rows = (lv: TeamLevel<SwarmMember>, depth: number): ReactNode[] => [
    ...lv.kids.flatMap((n) => [row(n.m, depth, n.kids.length + n.finished.length), ...rows(n, depth + 1)]),
    ...(lv.finished.length
      ? [
          <li key={`done-${depth}-${lv.finished[0].name}`} className="lc-ccard-r" style={{ "--d": depth } as CSSProperties}>
            <button type="button" className="lc-ccard-rb l-focus" disabled={still} onClick={() => openAgents(thread.id)}>
              <StepMark size={14} state="done" />
              <span className="lc-ccard-who">{lv.finished.length} finished</span>
              <span className="lc-grow" />
              <I.chevR size={14} />
            </button>
          </li>,
        ]
      : []),
  ];
  return (
    <section className="lc-ccard" aria-label={name} data-open={open || undefined}>
      <CardHead
        threadId={thread.id}
        open={open}
        onOpen={setOpen}
        name={name}
        counts={swarm.paused ? "paused" : teamCounts(swarm.members)}
        line={teamLine(live)}
        still={still}
        end={
          <>
            {open && <span className="lc-ccard-n l-num">{[coord ? shortModel(modelLabel(coord.model, providers)) : "", swarm.rssMb > 0 ? `~${swarm.rssMb} MB` : ""].filter(Boolean).join(" · ")}</span>}
            {pause}
          </>
        }
      />
      {open && (
        <ul className="lc-ccard-rows" data-tree={!swarmMode || undefined}>
          {coord && row(coord, 0)}
          {rows(tree, swarmMode ? 0 : 1)}
        </ul>
      )}
    </section>
  );
}

/** A plain crew's card: every agent at work, and those of this message that finished, a row each under who sent it. */
function AgentsCard({ thread, crew, working }: { thread: Thread; crew: Crew; working: Tool[] }) {
  const providers = useEngine((s) => s.providers);
  const [open, setOpen] = useCardFold(thread.id, "crew");
  const still = agentsReach(false, Boolean(thread.security)) === "none";
  const now = useNow(true);
  const all = [...everyAgent(crew.members.flatMap((m) => m.agents)), ...crew.earlier];
  const done = all.filter((t) => !running(t)).length;
  const counts = crewCounts(working.length, done);
  const busy = working.find((t) => t.agent?.now) ?? working[0];
  const line = busy ? `${isSidekick(busy) ? shortModel(whoIs(busy, providers)) : agentName(busy)}: ${doing(agentNow(busy))}` : "";
  const rows = (nodes: AgentNode[], depth: number): ReactNode[] =>
    nodes.flatMap((n) => [
      <li key={n.it.id} className="lc-ccard-r" style={{ "--d": depth } as CSSProperties}>
        <button type="button" className="lc-ccard-rb l-focus" disabled={still} onClick={() => showAgent(thread.id, n.it.id)}>
          <Mark state={stateOf(n.it)} />
          <span className="lc-ccard-who">{whoIs(n.it, providers)}</span>
          <span className="lc-ccard-t">{agentNow(n.it)}</span>
          <span className="lc-ccard-n l-num">{duration(secsOf(n.it, now))}</span>
        </button>
      </li>,
      ...rows(n.kids, depth + 1),
    ]);
  return (
    <section className="lc-ccard" aria-label="Agents" data-open={open || undefined}>
      <CardHead
        threadId={thread.id}
        open={open}
        onOpen={setOpen}
        name={crew.pair ? "Fusion" : "Agents"}
        counts={counts}
        line={line}
        still={still}
        end={
          working.some((t) => t.agent?.taskId) && (
            <button type="button" className="lc-ccard-act l-focus" onClick={() => stopAll(thread.id, working)}>
              {stopWord(working, "Stop agents")}
            </button>
          )
        }
      />
      {open && (
        <ul className="lc-ccard-rows">
          {rows(
            crew.members.flatMap((m) => m.agents),
            0,
          )}
          {rows(
            crew.earlier.map((it) => ({ it, kids: [] })),
            0,
          )}
        </ul>
      )}
    </section>
  );
}

/** "88%": a share (0 to 1) as a whole percent, never 0% for a part that used something. */
const pct = (share: number) => `${share > 0 && share < 0.01 ? "<1" : Math.round(share * 100)}%`;

/**
  A pair's use so far, by model: each one's tokens, and its share of the session's cost (of its
  tokens when no cost is known for it), with the token share quietly beside a cost share; then how
  the lead's briefs went, through the last finished turn. An answer with no models (a pair's first
  turn, before any has ended), or an engine that can't say (it fails), leaves the list as it was, with no word.
*/
function PairShares({ thread }: { thread: Thread }) {
  const providers = useEngine((s) => s.providers);
  const [shares, setShares] = useState<PairShare | null>(null);
  // The engine counts finished turns only (a lead's use is recorded at its turn's end), so a turn at work isn't in yet.
  const live = thread.status === "running" || thread.status === "waiting";
  // Read once per open, and again when a turn is added or the session's status moves (a turn ends). Each read
  // reads the whole usage log, so never per usage tick. A reply to an older read than the latest is dropped.
  useEffect(() => {
    let gone = false;
    void rpc("thread.shares", { id: thread.id })
      .then((s) => !gone && setShares(s))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [thread.id, thread.turns, thread.status]);
  if (!shares?.models.length) return null;
  const { sent, kept, tookBack } = shares.briefs;
  return (
    <>
      {shares.models.map((m) => {
        const ref = m.ref.replace(/^@/, "");
        const cost = m.costShare !== undefined;
        const share = cost ? m.costShare! : m.tokenShare;
        const role = m.role === "lead" ? "Lead" : "Sidekick";
        return (
          <div key={`${m.role}:${m.ref}`} className="lc-crp-m">
            <ModelMark kind={markOf(ref)} size={12} />
            <b>
              {modelLabel(ref, providers)}
              <span className="lc-crp-role">{role}</span>
            </b>
            <span className="lc-crp-n">{compact(m.tokens)} tokens</span>
            <span className="lc-crp-share" role="img" aria-label={`${role}: ${pct(share)} of ${cost ? "cost" : "tokens"}${cost ? `, ${pct(m.tokenShare)} of tokens` : ""}`}>
              <i style={{ "--w": `${Math.max(0, Math.min(1, share)) * 100}%` } as CSSProperties} />
              <span>
                {pct(share)} of {cost ? "cost" : "tokens"}
                {cost && <span className="lc-quiet"> · {pct(m.tokenShare)} of tokens</span>}
              </span>
            </span>
          </div>
        );
      })}
      <div className="lc-crp-sep" />
      {sent > 0 && <div className="lc-crp-l">{`${plural(sent, "brief")} · ${kept} kept · ${tookBack} taken back`}</div>}
      {thread.spendLimit !== undefined && thread.spendLimit > 0 && (
        <div className="lc-crp-l">
          Spend cap: ${thread.spendLimit.toFixed(2)}
          {thread.usage?.costUsd ? ` ($${thread.usage.costUsd.toFixed(2)} used)` : ""}
        </div>
      )}
      <div className="lc-crp-l lc-quiet">
        {live ? "Through the last finished turn. " : ""}
        {shares.estimated ? "Tokens are counted. Cost is an estimate from list prices, and your plan may differ." : "Tokens and cost are as each tool reported them."}
      </div>
      <div className="lc-crp-sep" />
    </>
  );
}

/**
  How a model's part stands, its agents counted as the composer's line counts them: every one at
  work under it, not only those it sent itself, those it waits on apart from those in the background.
  The lead's count takes in an earlier message's still at work too (`earlier`): it's the one that hears when they end.
*/
function memberWord(m: Member, now: number, earlier = 0) {
  const all = everyAgent(m.agents);
  const back = all.filter(behind).length + earlier;
  const also = back ? ` · ${back} in the background` : "";
  const waited = all.filter(holding);
  if (m.status === "running") return waited.length ? waitWords(waited, back) : `${m.role === "Planner" ? "planning" : "working"}${also}`;
  if (m.status === "stopped") return `stopped${also}`;
  if (m.status === "error") return `stopped with a problem${also}`;
  void now;
  return (m.role === "Planner" ? "planned it" : m.agents.length ? `worked with ${onWhom(m.agents.map((n) => n.it))}` : "done") + also;
}
/** Stop for what's at work: a pair's sidekick alone is "Stop the sidekick". */
const stopWord = (tools: Tool[], many: string) => (tools.filter(running).every(isSidekick) ? "Stop the sidekick" : many);
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
  what each sent back. Pressing one opens its newest steps in place, as Claude Code does (Peek), with Open in Agents for its
  whole trail in the Agents surface. Whether they're at work is
  theirs to say, not the trail's: a trail the model has gone on past (a plan, a word) is no longer
  live, while the agents it sent still are. A pair's sidekick reads as itself: its model, its brief,
  its steps live, and once it's back its report and the files it changed, as Liner Code measured them.
*/
export function Fanout({ threadId, tools }: { threadId: string; tools: Tool[] }) {
  const providers = useEngine((s) => s.providers);
  // One quiet line until it is opened (SPEC rule 6): who works is the card at the chat's end; this is what was sent here.
  const [open, setOpen] = useState(false);
  // The rows opened in place, by item id: kept while the trail is on screen.
  const [peeked, setPeeked] = useState<ReadonlySet<string>>(() => new Set());
  const peek = (id: string) => setPeeked((was) => {
    const next = new Set(was);
    if (!next.delete(id)) next.add(id);
    return next;
  });
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
  const back = tools.filter(behind).length;
  const working = tools.length - done - back;
  const ongoing = working + back > 0;
  const branch = (nodes: AgentNode[]): ReactNode =>
    nodes.map((n, i) => {
      const t = n.it;
      const st = stateOf(t);
      const side = isSidekick(t);
      const model = t.agent?.model ? modelLabel(t.agent.model, providers) : undefined;
      const task = agentTask(t);
      const on = st === "running";
      const files = side && !on ? t.agent?.files : undefined;
      // A design's frames aren't in its files (the snapshot leaves .liner/ out): measured on their own, said beside them.
      const frames = side && !on ? (t.agent?.frames ?? []) : [];
      // Said as one sentence: read from its parts, the mark and a report that starts "Done." said it twice, and "measured" hung on the end.
      const doing = agentNow(t);
      const word = STATE_WORD[st];
      const said = [
        `${whoIs(t, providers)}${side ? ", the sidekick" : ""}`,
        on ? `${word} on: ${task}. Now: ${doing}` : doing.toLowerCase().startsWith(word.toLowerCase()) ? doing : `${word}: ${doing}`,
        on ? agentStats(t, now) : duration(secsOf(t, now)),
        files && !unstarted(t) ? (files.length ? `Changed ${files.length <= 2 ? files.map((f) => nameOf(f.path)).join(" and ") : plural(files.length, "file")}, ${linesSaid(sumLines(files))}` : frames.length ? null : "Changed no file") : null,
        frames.length && !unstarted(t) ? drewSaid(frames) : null,
      ]
        .filter((x): x is string => Boolean(x))
        .map((x) => x.replace(/[.\s]+$/, ""))
        .join(". ");
      return (
        <div key={t.id} className="lc-fan-kid" data-last={i === nodes.length - 1 || undefined}>
          <button type="button" className="lc-fan-ag l-focus" data-on={on || undefined} data-side={side || undefined} data-open={peeked.has(t.id) || undefined} onClick={() => peek(t.id)} aria-expanded={peeked.has(t.id)} aria-label={said} title={peeked.has(t.id) ? "Hide its steps" : "Show its steps"}>
            <span className="lc-fan-1">
              <Mark state={st} />
              {side && <Face t={t} size={12} />}
              <b>{whoIs(t, providers)}</b>
              {n.kids.length > 0 && <span className="lc-quiet">({plural(n.kids.length, "subagent")})</span>}
              {side && <span className="lc-fan-tag">Sidekick</span>}
              <span className="lc-fan-task">{on ? task : agentNow(t)}</span>
              {on ? !side && model && <span className="lc-fan-m">{model}</span> : <span className="lc-fan-m l-num">{duration(secsOf(t, now))}</span>}
            </span>
            {on && (
              <span className="lc-fan-2">
                <span className="lc-fan-now">{agentNow(t)}</span>
                <span className="lc-fan-m l-num">{agentStats(t, now)}</span>
              </span>
            )}
            {(files || frames.length > 0) && !unstarted(t) && (
              <span className="lc-fan-2">
                <span className="lc-fan-now">
                  {files?.length ? <>Changed {files.length <= 2 ? files.map((f) => nameOf(f.path)).join(" and ") : plural(files.length, "file")} <Lines {...sumLines(files)} /></> : frames.length ? null : "Changed no file"}
                  {frames.length > 0 && (files?.length ? `; ${drewSaid(frames, true)}` : drewSaid(frames))}
                </span>
                <span className="lc-fan-m">measured</span>
              </span>
            )}
          </button>
          {peeked.has(t.id) && <Peek threadId={threadId} t={t} />}
          {n.kids.length > 0 && <div className="lc-fan-kids">{branch(n.kids)}</div>}
        </div>
      );
    });
  // The header's mark says how they all stand: at work while any is, else finished only when every one
  // is, the problem shape when one ran into a problem, the faint shape when one was stopped.
  const states = tools.map(stateOf);
  const head: StepState = ongoing ? "working" : states.every((s) => s === "done") ? "done" : states.includes("failed") ? "failed" : states.includes("stopped") ? "skipped" : "working";
  // A pair's lead hands work over; it doesn't start "1 agent".
  const whom = onWhom(tools);
  const handed = tools.every(isSidekick);
  return (
    <div className="lc-fan" role="group" aria-label={handed ? "Handed to its sidekick" : `${plural(tools.length, "agent")} sent`} data-open={open || undefined}>
      <button type="button" className="lc-fan-h l-focus" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepMark size={14} state={head} label={HEAD_WORD[head]} />
        {ongoing ? (handed ? "Handed work to its sidekick" : `Started ${whom}`) : handed ? `Handed ${plural(tools.length, "brief")} to its sidekick` : `With ${whom}`}
        <span className="lc-quiet">· {ongoing ? (handed && tools.length === 1 ? "at work" : [done && `${done} finished`, working && `${working} working`, back && `${back} in the background`].filter(Boolean).join(", ")) : tools.length === 1 ? "what it sent back" : "what each sent back"}</span>
        <I.chevR size={12} className="lc-sum-chev" />
      </button>
      {open && <div className="lc-fan-kids">{branch(roots)}</div>}
    </div>
  );
}

/** How many steps an agent took that its row no longer holds: its tool counts them all, the row keeps its last 40. */
function earlierOf(t: Tool, kept: AgentStep[]) {
  const calls = kept.filter((s) => s.toolKind !== "think").length;
  return Math.max(0, (t.agent?.tools ?? calls) - calls);
}
/** A step's time, to the second: "10:02:14". */
const stepAt = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
  An agent's row opened in place, as Claude Code opens one: its last few steps under it, a thought in quiet italics, the one at
  work with its mark, how many came before, and Open in Agents for the whole trail. The same for every tool; one whose tool
  says nothing of its steps (OpenCode, Antigravity) says so.
*/
function Peek({ threadId, t }: { threadId: string; t: Tool }) {
  const steps = t.agent?.steps ?? [];
  const shown = steps.slice(-4);
  const earlier = earlierOf(t, shown);
  return (
    <div className="lc-fan-peek">
      {earlier > 0 && <span className="lc-fan-more">+ {plural(earlier, "earlier step")}</span>}
      {shown.length ? (
        <ul className="lc-fan-steps" role="list">
          {shown.map((s, i) => (
            <li key={i} data-think={s.toolKind === "think" || undefined} data-state={s.status}>
              {s.status === "running" ? <Mark state="running" /> : <span className="lc-fan-hook" aria-hidden>⎿</span>}
              <span>{s.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="lc-fan-more">{stateOf(t) === "running" ? "No steps yet." : "Its tool doesn't say what it did, step by step."}</span>
      )}
      <button type="button" className="lc-fan-open l-focus" onClick={() => showAgent(threadId, t.id)}>
        Open in Agents
      </button>
    </div>
  );
}

/* ---------- one agent while the turn runs ---------- */

/** Exactly one agent at work while the turn runs: the live line says what it does, so the strip stays away. */
const lone = (thread: Thread, working: Tool[]) => working.length === 1 && thread.status === "running";

/**
  With one agent at work while the turn runs, the live line carries it (Timeline.tsx LiveLine): its newest step says what
  the agent is doing, and this, in its `end`, stops it, in the strip's words ("Stop the sidekick"). Two or more, the strip has Stop.
*/
export function LoneStop({ thread }: { thread: Thread }) {
  const crew = useCrew(thread);
  const working = crew ? atWork(crew) : [];
  if (!lone(thread, working) || !working[0].agent?.taskId) return null;
  return (
    <button type="button" className="lc-crs-stop l-focus" onClick={() => stopAll(thread.id, working)}>
      {stopWord(working, "Stop the agent")}
    </button>
  );
}

/* ---------- the Agents surface ---------- */

/**
  The Agents surface, in the panel's frame (board Agent): one agent when one was opened (from the agents popup, a card in
  the chat or the list), a team's list, board or worktrees, or the whole crew with its timeline lanes, its tasks, what
  runs in the background and what the session used.
*/
export function AgentsSurface({ thread }: { thread: Thread }) {
  // The crew's own items (turns, agents, reviews, the plan): a streamed word of a reply changes none of them.
  const crew = useCrew(thread);
  const items = useItemsWhere(thread.id, isCrewItem);
  const picked = useShownAgent(thread.id);
  const swarmOn = isSwarm(thread);
  const swarm = useSwarm(thread.id, swarmOn);
  const [view, setView] = useTeamView(thread.id);
  const agent = picked ? items.find((x): x is Tool => x.id === picked && isAgent(x)) : undefined;
  if (agent) return <AgentView key={agent.id} thread={thread} crew={crew} it={agent} items={items} />;
  if (swarmOn && swarm) return <SwarmSurface thread={thread} swarm={swarm} view={view} onView={setView} />;
  return (
    <>
      <PaneHead name="Agents" shows={crew ? <PaneWords>{crew.members.some((m) => m.status === "running") || atWork(crew).length ? `${countOf(crew)} on it` : `${countOf(crew)} worked on it`}</PaneWords> : undefined} />
      <div className="lc-agents-panel lc-cr">
        <CrewView thread={thread} crew={crew} />
      </div>
    </>
  );
}

function CrewView({ thread, crew }: { thread: Thread; crew: Crew | null }) {
  const providers = useEngine((s) => s.providers);
  const profiles = useEngine((s) => s.agents);
  const live = Boolean(crew && (crew.members.some((m) => m.status === "running") || atWork(crew).length));
  const now = useNow(live);
  const [launch, again] = useLaunch(thread.id);
  const servers = launch?.servers.filter((s) => s.status !== "stopped") ?? [];
  const pair = crew?.pair ?? pairOf(thread, profiles, providers);
  /** A pair's sidekick with no brief in this message: it's the pair's all the same, and waits for one. */
  const idle = (p: PairNames, last: boolean, working: boolean) => (
    <div className="lc-cr-kid" data-last={last || undefined}>
      <div className="lc-cr-row">
        <span className="lc-cr-disc">
          <ModelMark kind={markOf(p.sideRef)} size={12} />
        </span>
        <span className="lc-cr-t">
          <b>
            {p.side} <span>· Sidekick</span>
          </b>
          <small>
            <Mark state="running" waiting />
            {working ? `Waits for a brief from ${p.lead}` : `No brief from ${p.lead} this message`}
          </small>
        </span>
      </div>
    </div>
  );
  if (!crew)
    return (
      <>
        {pair ? (
          <>
            <div className="lc-cr-h">
              Fusion<span className="lc-cr-rule" />
              <span>nothing asked yet</span>
            </div>
            <div className="lc-cr-tree">
              <div className="lc-cr-row" data-root>
                <span className="lc-cr-disc">
                  <ModelMark kind={markOf(pair.leadRef)} size={12} />
                </span>
                <span className="lc-cr-t">
                  <b>
                    {pair.lead} <span>· Lead</span>
                  </b>
                  <small>Takes your message, plans, and reviews what its sidekick does</small>
                </span>
              </div>
              <div className="lc-cr-kids">{idle(pair, true, true)}</div>
            </div>
          </>
        ) : (
          <PaneNote icon={<I.agents size={20} />} title="No agents yet">
            When a model takes your message and sends agents off, they show here with who sent whom. Teamwork and Swarm start from the Session card's Multi-agent row.
          </PaneNote>
        )}
        <SessionUse thread={thread} />
      </>
    );
  const working = crew.members.filter((m) => m.status === "running").length + atWork(crew).length;
  // At work and not waited on, this message's and earlier ones': each opens on its own, with Stop it.
  const background = atWork(crew).filter(behind);
  // `more`: a row follows these under the same branch (a pair's sidekick that has no brief yet).
  const tree = (nodes: AgentNode[], more = false): ReactNode =>
    nodes.map((n, i) => (
      <div key={n.it.id} className="lc-cr-kid" data-last={(i === nodes.length - 1 && !more) || undefined}>
        <button type="button" className="lc-cr-row l-focus" onClick={() => showAgent(thread.id, n.it.id)}>
          <span className="lc-cr-tile">
            <Face t={n.it} size={14} />
          </span>
          <span className="lc-cr-t">
            <b>
              {whoIs(n.it, providers)}
              {isSidekick(n.it) ? <span> · Sidekick</span> : n.it.agent?.model && <span> · {modelLabel(n.it.agent.model, providers)}</span>}
            </b>
            <small>
              <Mark state={stateOf(n.it)} />
              <span>{agentNow(n.it)}</span>
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
        <span>{working ? `${working} working` : "finished"}</span>
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
                <span className="lc-cr-disc">
                  <ModelMark kind={markOf(m.model)} size={12} />
                </span>
                <span className="lc-cr-t">
                  <b>
                    {m.name}
                    {(m.role || m.tag) && <span> · {[m.role, m.tag].filter(Boolean).join(", ")}</span>}
                  </b>
                  <small>
                    <Mark state={m.status === "running" ? "running" : m.status === "error" ? "failed" : m.status === "stopped" ? "stopped" : "done"} />
                    {memberWord(m, now, m === crew.lead ? crew.earlier.length : 0).replace(/^./, (c) => c.toUpperCase())}
                  </small>
                </span>
                <span className="lc-cr-n l-num">{duration(m.status === "running" ? (now - m.at) / 1000 : m.seconds)}</span>
              </div>
              {(m.agents.length > 0 || (pair && m === crew.lead && !crew.agents.some(isSidekick))) && (
                <div className="lc-cr-kids">
                  {tree(m.agents, Boolean(pair && m === crew.lead && !crew.agents.some(isSidekick)))}
                  {pair && m === crew.lead && !crew.agents.some(isSidekick) && idle(pair, true, m.status === "running")}
                </div>
              )}
            </div>
          ))}
          {review && (
            <div className="lc-cr-kid" data-last>
              <div className="lc-cr-row">
                <span className="lc-cr-disc">
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
              {crew.planEnd === "stopped" ? "Stopped at " : ""}
              {plan.filter((p) => p.status === "completed").length} of {plan.length}
              {crew.planEnd === "stopped" ? "" : " done"}
            </span>
          </div>
          {/* The Plan list's rule: once the run that made it is over, a step not done reads as skipped (stopped) or left open (finished). */}
          {plan.map((p, i) => (
            <div key={`${i}${p.title}`} className="lc-cr-task" data-state={p.status}>
              {p.status !== "completed" && crew.planEnd ? <StepMark className="lc-cr-mark" size={14} state="skipped" label={crew.planEnd === "open" ? "Left open" : "Skipped"} /> : <Mark state={p.status === "completed" ? "done" : "running"} waiting={p.status === "pending"} />}
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
              <PaneButton onClick={() => void rpc("launch.stop", { threadId: thread.id, name: s.name }).then(again).catch(fail)}>Stop</PaneButton>
            </div>
          ))}
        </>
      )}

      {crew.pair && (
        <>
          <div className="lc-cr-h">
            Use by model<span className="lc-cr-rule" />
          </div>
          <div className="lc-crp">
            <PairShares thread={thread} />
          </div>
        </>
      )}
      <SessionUse thread={thread} />
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
      // Live while it works, in the background too: the engine keeps its seconds as it goes and at its end.
      const live = running(n.it);
      lanes.push({ key: n.it.id, label: whoIs(n.it, providers), from: n.it.at, to: Math.max(n.it.at + 500, endOf(n.it.at, live, n.it.seconds)), live });
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

/** Strips a redundant leading `cd "<cwd>" && ` from shell step titles so narrow agent panels show the real command. */
function cleanStepTitle(title: string, cwd: string): string {
  if (!title.startsWith("Run ")) return title;
  const m = title.slice(4).trimStart().match(/^cd\s+(?:"([^"]+)"|'([^']+)'|((?:\\.|[^\s;&])+))\s*(?:&&|;)\s*([\s\S]+)$/);
  if (!m) return title;
  const rawDir = m[1] ?? m[2] ?? (m[3] ?? "").replace(/\\ /g, " ");
  const norm = (p: string) => p.replace(/\/+$/, "");
  return norm(rawDir) === norm(cwd) ? `Run ${m[4].trimStart()}` : title;
}

/**
  One agent: who sent it, what it was asked, its steps, what it sent back; stop it, or tell the
  model that sent it. A pair's sidekick, by its model, with the files its brief changed as Liner
  Code measured them, not as it said.
*/
function AgentView({ thread, crew, it, items }: { thread: Thread; crew: Crew | null; it: Tool; items: Item[] }) {
  const providers = useEngine((s) => s.providers);
  const profiles = useEngine((s) => s.agents);
  const cwd = useEngine((s) => s.projects.find((p) => p.id === thread.projectId)?.path ?? "");
  const st = stateOf(it);
  const now = useNow(st === "running");
  const [say, setSay] = useState("");
  const a = it.agent;
  const side = isSidekick(it);
  const name = whoIs(it, providers);
  // Who sent it: the agent above it, else the model whose part it came in.
  const parent = a?.parent ? items.find((x): x is Tool => x.id === a.parent && isAgent(x)) : undefined;
  const owner = crew?.members.find((m) => {
    const has = (ns: AgentNode[]): boolean => ns.some((n) => n.it.id === it.id || has(n.kids));
    return has(m.agents);
  });
  // One an earlier message sent, still at work: the model whose part of that turn it came in.
  const part = !parent && !owner ? items.findLast((x): x is Turn => x.kind === "turn" && x.turn === it.turn && x.at <= it.at) : undefined;
  const sender = parent ? agentName(parent) : (owner?.name ?? (part ? (isModelAgent(part.agent) || part.agent === "demo" ? modelLabel(part.model, providers) : agentOf(part.agent, profiles, providers).name) : "the model"));
  const kids = items.filter((x): x is Tool => isAgent(x) && x.agent?.parent === it.id);
  const steps = a?.steps ?? [];
  const earlier = earlierOf(it, steps);
  // While it works, the newest step stays in view as it comes, unless you turn that off to read back.
  const [follow, setFollow] = useState(true);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (follow && st === "running") end.current?.scrollIntoView({ block: "nearest" });
  }, [follow, st, steps.length, steps.at(-1)?.status]);
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
    else void rpc("thread.send", { id: thread.id, text: side ? `About the brief you gave your sidekick${a?.task ? ` (${a.task})` : ""}: ${text}` : `About the ${name} agent you sent${a?.task ? ` (${a.task})` : ""}: ${text}`, mode: "steer" }).catch(fail);
  };
  const stop = st === "running" && a?.taskId && (
    <PaneButton icon={<I.stop size={12} />} onClick={() => void rpc("thread.stopAgent", { id: thread.id, item: it.id }).then((ok) => !ok && toast.error(`${name} has already stopped.`)).catch(fail)}>
      Stop
    </PaneButton>
  );
  // Who it is and who sent it, in the head's quiet words: "Haiku 5.5, sent by Demo".
  const said = [side ? "Sidekick" : a?.model ? modelLabel(a.model, providers) : "", `${side ? "briefed" : "sent"} by ${parent ? agentName(parent) : sender}`].filter(Boolean).join(", ");
  const steerable = st === "running" && (direct || (!parent && (thread.status === "running" || it.status !== "running")));
  return (
    <>
      <PaneHead
        lead={
          // Named for where it goes: back to the list, or to the agent that sent it.
          <button type="button" className="lc-pane-tool l-focus" aria-label={parent ? `Back to ${agentName(parent)}` : "Back to all agents"} title={parent ? `Back to ${agentName(parent)}` : "Back to all agents"} onClick={() => showAgent(thread.id, parent ? parent.id : null)}>
            <I.chevL size={16} />
          </button>
        }
        name={name}
        shows={<PaneWords>{said}</PaneWords>}
        tools={stop || undefined}
      />
      <div className="lc-agents-panel lc-cr">
      <div className="lc-cr-astat">
        <Mark state={st} />
        <span className="lc-grow">{[unstarted(it) ? "Never started" : st === "running" && it.status !== "running" ? "In the background" : st === "running" ? "Working" : STATE_WORD[st], st === "running" ? `for ${duration(secsOf(it, now))}` : duration(secsOf(it, now))].filter(Boolean).join(" ")}</span>
        {(a?.tools || a?.tokens) && (
          <span className="lc-cr-stats">
            {/* The figures as words for a screen reader: the rolling digits beside them aren't read in Chromium, so they're hidden and said here. */}
            <span className="l-sr-only">{[a?.tools ? plural(a.tools, "tool") : null, a?.tokens ? `${compact(a.tokens)} tokens` : null].filter(Boolean).join(", ")}</span>
            <span aria-hidden>
              {a?.tools ? (
                <>
                  <Num value={a.tools} /> {a.tools === 1 ? "tool" : "tools"}
                </>
              ) : null}
              {a?.tools && a?.tokens ? ", " : null}
              {a?.tokens ? (
                <>
                  <Num as="compact" value={a.tokens} /> tokens
                </>
              ) : null}
            </span>
          </span>
        )}
      </div>

      {/* Its parts are headings, so a screen reader can go from the brief to the report to the files. */}
      <div className="lc-cr-h" role="heading" aria-level={3}>{side ? "The brief" : "Asked to"}</div>
      <div className="lc-cr-brief">{a?.brief ?? agentTask(it) ?? "Nothing said."}</div>

      {kids.length > 0 && (
        <>
          <div className="lc-cr-h" role="heading" aria-level={3}>It sent {plural(kids.length, "agent")}</div>
          {kids.map((k) => (
            <button key={k.id} type="button" className="lc-cr-row l-focus" onClick={() => showAgent(thread.id, k.id)}>
              <span className="lc-cr-tile">
                <Kind name={agentName(k)} size={14} />
              </span>
              <span className="lc-cr-t">
                <b>{agentName(k)}</b>
                <small>
                  <Mark state={stateOf(k)} />
                  <span>{agentNow(k)}</span>
                </small>
              </span>
            </button>
          ))}
        </>
      )}

      <div className="lc-cr-h" role="heading" aria-level={3}>
        Steps<span className="lc-cr-rule" />
        {st === "running" && steps.length > 0 ? (
          <span className="lc-cr-follow">
            Follows the newest
            <NamedSwitch name="Keep the newest step in view" size="sm" checked={follow} onCheckedChange={setFollow} />
          </span>
        ) : (
          <span>{steps.filter((s) => s.toolKind !== "think").length + earlier || ""}</span>
        )}
      </div>
      {earlier > 0 && <p className="lc-cr-earlier">+ {plural(earlier, "earlier step")}, no longer kept here</p>}
      {steps.length ? (
        // role="list": WebKit drops a list's role once its bullets are styled away, and VoiceOver stops saying "list, 4 items".
        <ul className="lc-cr-steps" role="list">
          {steps.map((s, i) => {
            const label = cleanStepTitle(s.title, cwd);
            return (
              <li key={i} ref={i === steps.length - 1 ? end : undefined} data-state={s.status} data-think={s.toolKind === "think" || undefined}>
                {s.toolKind === "think" ? null : <Mark state={s.status === "running" ? "running" : s.status === "failed" ? "failed" : "done"} />}
                <span title={s.title}>{label}</span>
                {s.at !== undefined && <time className="lc-cr-at" dateTime={new Date(s.at).toISOString()}>{s.status === "running" && i === steps.length - 1 ? "now" : stepAt(s.at)}</time>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="lc-cr-none">{st === "running" ? "None yet." : unstarted(it) ? "None: the brief was stopped while it waited its turn." : "Its tool doesn't say what it did, step by step."}</p>
      )}

      <div className="lc-cr-h" role="heading" aria-level={3}>Report</div>
      <div className="lc-cr-report" data-empty={!a?.report || undefined}>
        {unstarted(it) ? `It never started on this brief: it was stopped while it waited its turn, so nothing was done. ${sender} was told.` : (a?.report ?? (st === "running" ? (it.status !== "running" ? `It works in the background; ${sender} hears when it ends.` : `Goes back to ${sender} when it finishes, and shows here.`) : st === "stopped" ? `Stopped before it reported. ${sender} was told.` : (it.output ?? "Nothing came back.")))}
      </div>

      {side && !unstarted(it) && <Measured threadId={thread.id} files={st === "running" ? undefined : a?.files} frames={a?.frames} running={st === "running"} />}

      {heard.map((w, i) => (
        <div key={i} className="lc-cr-heard">
          <Mark state="done" />
          <span>“{w}”</span>
          <span className="lc-quiet">at its next step</span>
        </div>
      ))}
      </div>
      {/* One at work in the background past its turn takes a word too: to the model that sent it, as your next message. The box is the surface's foot. */}
      {steerable && (
        <div className="lc-cr-foot">
          {/* The message box's field and Send, as every place that writes to an agent has them. */}
          <SendBox className="lc-cr-steer" value={say} onChange={setSay} label={direct ? `Tell ${name} something` : `Tell ${sender} what ${name} should do instead`} placeholder={direct ? `Tell ${name} something` : `Tell ${sender} what ${name} should do instead`} onSend={send} />
          <p className="lc-cr-hint">
            {direct
              ? "Goes in at its next step, without stopping it."
              : `${name}'s tool can't take a word mid-run, so this goes to ${sender} now, without stopping it; it can stop ${name} and send a new one.${a?.taskId ? " Stop works on the agent directly." : ""}`}
          </p>
        </div>
      )}
    </>
  );
}

/**
  What a sidekick's brief changed, as Liner Code measured it from snapshots before and after (its
  report is its own claim). A file opens in Files; unmeasured (no git here), it says so.
*/
function Measured({ threadId, files, frames = [], running }: { threadId: string; files?: FileChange[]; frames?: { name: string; path: string }[]; running: boolean }) {
  return (
    <>
      {/* The canvas's frames are measured apart (the snapshot leaves .liner/ out): a brief that only drew says what it drew. */}
      {!running && frames.length > 0 && (
        <>
          <div className="lc-cr-h" role="heading" aria-level={3}>
            Frames it changed<span className="lc-cr-rule" />
            <span>measured</span>
          </div>
          <ul className="lc-cr-files" role="list">
            {frames.map((f) => (
              <li key={f.path}>
                <span className="lc-cr-file" title={f.path}>
                  <span className="lc-cr-fs" data-s="modified">F</span>
                  <span className="lc-cr-fp">{f.name}</span>
                  <span className="lc-cr-fp lc-mono">{f.path}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="lc-cr-h" role="heading" aria-level={3}>
        Files it changed<span className="lc-cr-rule" />
        <span>{files?.length ? <Lines {...sumLines(files)} /> : "measured"}</span>
      </div>
      {running ? (
        <p className="lc-cr-none">Measured when it finishes, from the folder as it was before and after.</p>
      ) : !files ? (
        <p className="lc-cr-none">Not measured: this folder couldn't be snapshotted.</p>
      ) : !files.length ? (
        <p className="lc-cr-none">{frames.length ? "No file outside the design's frames." : "None."} Measured from the folder before and after its brief.</p>
      ) : (
        <ul className="lc-cr-files" role="list">
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" className="lc-cr-file l-focus" title={`Open ${f.path}`} aria-label={`${[`${FILE_WORD[f.status] ?? "Modified"}: ${f.path}`, linesSaid(f)].filter(Boolean).join(", ")}. Open it`} onClick={() => window.dispatchEvent(new CustomEvent("lc:open-file", { detail: { path: f.path, threadId } }))}>
                <span className="lc-cr-fs" data-s={f.status}>
                  {f.status === "added" ? "A" : f.status === "deleted" ? "D" : f.status === "renamed" ? "R" : "M"}
                </span>
                <span className="lc-cr-fp lc-mono">{f.path}</span>
                <Lines added={f.added} removed={f.removed} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** What the session has used: tokens, the cache, the cost, the context, the tools. */
/** SessionUse's view: every tool call and every turn, and no reply's words. */
const isToolOrTurn = (it: Item) => it.kind === "tool" || it.kind === "turn";
function SessionUse({ thread }: { thread: Thread }) {
  const items = useItemsWhere(thread.id, isToolOrTurn);
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
      {/* Rows of the frame (PaneRow), not a table: the pane's body has no boxes or wells (SPEC rule 3). */}
      <PaneRow icon={<I.usage size={14} />} value={<Num as="compact" value={u.inputTokens + u.cacheReadTokens + u.outputTokens} />}>Tokens</PaneRow>
      <PaneRow icon={<I.layers size={14} />} value={u.inputTokens + u.cacheReadTokens ? <Num as="percent" value={u.cacheReadTokens / (u.inputTokens + u.cacheReadTokens)} /> : "–"}>From cache</PaneRow>
      <PaneRow icon={<I.speed size={14} />} value={u.costUsd ? <Num as="money" value={u.costUsd} /> : unpriced} quiet={!u.costUsd}>Cost</PaneRow>
      {u.contextWindow ? (
        <PaneRow icon={<I.chip size={14} />} value={<>{compact(u.contextTokens ?? 0)} of {compact(u.contextWindow)}</>}>Context</PaneRow>
      ) : null}
      <PaneRow icon={<I.tool size={14} />} value={<Num value={tools} />}>Tools used</PaneRow>
    </>
  );
}

/* ---------- Liner-native Swarm & Teamwork (reuses Crew's marks, tree, popover and fields) ---------- */

const SWARM_STATE_WORD: Record<SwarmMember["state"], string> = {
  working: "Working",
  queued: "Queued (0 MB)",
  waiting: "Waiting",
  hibernated: "Hibernated (0 MB)",
  skipped: "Skipped",
  stopped: "Stopped",
  killed: "Ended",
};

function swarmMark(s: SwarmMember["state"]): { state: State; waiting?: boolean } {
  if (s === "working") return { state: "running" };
  if (s === "queued" || s === "waiting") return { state: "running", waiting: true };
  if (s === "hibernated") return { state: "done" };
  return { state: "stopped" };
}

/** A worker's effort after its model, only when it differs from the session's (a reader one lower, a model without that level). */
const effortNote = (m: SwarmMember, thread: Thread) => (m.effort && m.effort !== (thread.effort ?? "") ? ` · ${m.effort}` : "");

/** Native Liner Code Agents surface in Teamwork (hierarchy tree) or Swarm (peer board + Overview) mode. */
function SwarmSurface({ thread, swarm, view, onView }: { thread: Thread; swarm: SwarmSnapshot; view: TeamView; onView: (v: TeamView) => void }) {
  const providers = useEngine((s) => s.providers);
  const isSwarmMode = swarm.mode === "swarm";
  const tab = view === "board" ? "board" : view === "worktrees" ? "worktrees" : "overview";
  const [channel, setChannel] = useState("all");
  const [draft, setDraft] = useState("");
  // The add-worker form shows when the agents popup's Add a worker opened the surface, or its own row was pressed.
  const adding = view === "add";
  const setAdding = (on: boolean | ((was: boolean) => boolean)) => onView((typeof on === "function" ? on(adding) : on) ? "add" : "all");
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFold = (key: string) =>
    setFolded((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const [wName, setWName] = useState("");
  const [wRole, setWRole] = useState("Writer");
  const [wWs, setWWs] = useState<"share" | "inherit">("share");
  const [wFork, setWFork] = useState("");
  const [wBrief, setWBrief] = useState("");

  const live = swarm.members.filter((m) => m.state !== "killed");
  const coordinator = live.find((m) => m.name === "coordinator");
  const workers = live.filter((m) => m.name !== "coordinator");
  const kidsOf = (parentName: string) => workers.filter((m) => (m.parent ?? "coordinator") === parentName);
  const topWorkers = kidsOf("coordinator");
  const worktrees = workers.filter((m) => m.workspace === "share");
  const channels = useMemo(() => [...new Set(["main", ...swarm.posts.map((p) => p.channel)])], [swarm.posts]);
  const posts = useMemo(() => (channel === "all" ? swarm.posts : swarm.posts.filter((p) => p.channel === channel)), [swarm.posts, channel]);
  const timelineShots = useMemo(
    () =>
      swarm.posts.flatMap((p) =>
        (p.screenshots ?? []).map((s, idx) => ({ key: `${p.seq}-${idx}`, seq: p.seq, from: p.from, path: s.path, caption: s.caption })),
      ),
    [swarm.posts],
  );
  const effectiveTab = !isSwarmMode && tab === "board" ? "overview" : tab;

  const renderBranch = (nodes: SwarmMember[], peerLabel = false): ReactNode =>
    nodes.map((m, i) => {
      const mk = swarmMark(m.state);
      const kids = kidsOf(m.name);
      const isFolded = folded.has(m.name);
      const isActive = m.state === "working" || m.state === "queued" || kids.some((k) => k.state === "working" || k.state === "queued");
      const openDetails = () => m.itemId && showAgent(thread.id, m.itemId);
      return (
        <div key={m.name} className="lc-cr-kid" data-last={i === nodes.length - 1 || undefined}>
          <div className="lc-sw-node">
            <button type="button" className="lc-cr-row l-focus lc-sw-mrow" onClick={openDetails} disabled={!m.itemId} title={m.itemId ? `Inspect ${m.role}` : m.now || SWARM_STATE_WORD[m.state]}>
              <Mark state={isActive ? "running" : mk.state} waiting={!isActive && mk.waiting} />
              <span className="lc-cr-t">
                <b>
                  {peerLabel ? `@${m.name}` : m.role}
                  {peerLabel && m.role ? <span> · {m.role}</span> : null}
                  {kids.length > 0 && <span> ({plural(kids.length, peerLabel ? "helper" : "subagent")})</span>}
                </b>
                <small>
                  <span>
                    {m.now || SWARM_STATE_WORD[m.state]}
                    {m.workspace === "share" && m.branch ? ` · ${m.branch}` : ""}
                    {m.audit && m.auditOf ? ` · audits @${m.auditOf}` : ""}
                  </span>
                </small>
              </span>
              <span className="lc-cr-n l-num">{m.state === "working" && m.rssMb ? `~${m.rssMb} MB` : `${shortModel(modelLabel(m.model, providers))}${effortNote(m, thread)}`}</span>
            </button>
            {kids.length > 0 && (
              <button type="button" className="lc-ib l-focus lc-sw-fold" aria-label={isFolded ? `Expand ${m.role}` : `Collapse ${m.role}`} aria-expanded={!isFolded} onClick={() => toggleFold(m.name)}>
                {isFolded ? <I.chevR size={12} /> : <I.chevD size={12} />}
              </button>
            )}
            {m.state !== "skipped" && (
              <Pop
                menu
                align="end"
                width={230}
                label={`Actions for ${m.role}`}
                triggerClass="lc-ib l-focus lc-sw-more"
                trigger={<I.more size={14} />}
              >
                {(close) => (
                  <>
                    <div className="lc-sw-popm">
                      <ModelPop label={`Model for @${m.name}`} value={m.model} onPick={(ref) => (void rpc("swarm.swapModel", { threadId: thread.id, name: m.name, model: ref }).catch(fail), close())} />
                    </div>
                    <Sep />
                    {m.itemId && <Row title="Open steps and report" onPick={() => (close(), openDetails())} />}
                    {m.state === "working" || m.state === "waiting" ? (
                      <Row title="Hibernate (0 MB RAM)" onPick={() => (close(), void rpc("swarm.hibernate", { threadId: thread.id, name: m.name }).catch(fail))} />
                    ) : (
                      <Row title="Wake worker" onPick={() => (close(), void rpc("swarm.wake", { threadId: thread.id, name: m.name }).catch(fail))} />
                    )}
                    {/* It can't be woken again, so it asks once more, as Turn it off does. */}
                    <ConfirmRow title="End worker" sure={`End @${m.name}: it stops for good`} red onConfirm={() => (close(), void rpc("swarm.killWorker", { threadId: thread.id, name: m.name }).catch(fail))} />
                  </>
                )}
              </Pop>
            )}
          </div>
          {kids.length > 0 && !isFolded && <div className="lc-cr-kids">{renderBranch(kids, peerLabel)}</div>}
        </div>
      );
    });

  const sendPost = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void rpc("swarm.post", { threadId: thread.id, text, ...(channel !== "all" ? { channel } : {}) }).catch(fail);
  };

  const addWorker = () => {
    const name = wName.trim();
    const brief = wBrief.trim();
    if (!name || !brief) return toast.error("Give the worker a short name and a brief.");
    void rpc("swarm.addWorker", { threadId: thread.id, name, role: wRole.trim() || "Writer", workspace: wWs, mode: wWs === "share" ? "write" : "read", brief, ...(wFork ? { fork: wFork } : {}) })
      .then(() => {
        setWName("");
        setWBrief("");
        setWFork("");
        setAdding(false);
      })
      .catch(fail);
  };

  const workstreamMeta = (taskNames: string[]) => {
    const owners = taskNames.map((n) => workers.find((w) => w.name === n)).filter(Boolean) as SwarmMember[];
    const anyWorking = owners.some((o) => o.state === "working" || o.state === "queued");
    const allDone = owners.length > 0 && owners.every((o) => o.state === "hibernated" || o.state === "waiting" || o.landed);
    const lastPost = swarm.posts.findLast((p) => taskNames.includes(p.from) || p.to.some((t) => taskNames.includes(t)));
    const state: State = anyWorking ? "running" : allDone ? "done" : "running";
    return { state, waiting: !anyWorking && !allDone, statusWord: anyWorking ? "working" : allDone ? "ready" : "pending", lastPost };
  };

  const label = isSwarmMode ? "Swarm" : "Teamwork";
  const VIEW_WORD: Record<"overview" | "board" | "worktrees", string> = { overview: isSwarmMode ? "Overview" : "Agents", board: swarm.posts.length ? `Board, ${plural(swarm.posts.length, "post")}` : "Board", worktrees: worktrees.length ? `Worktrees, ${worktrees.length}` : "Worktrees" };
  const views = (isSwarmMode ? ["overview", "board", "worktrees"] : worktrees.length ? ["overview", "worktrees"] : []) as ("overview" | "board" | "worktrees")[];
  const busy = workers.some((m) => m.state === "working" || m.state === "queued" || m.state === "waiting");
  return (
    <>
      <PaneHead
        name={swarm.title || label}
        shows={
          views.length > 1 ? (
            <Pop menu triggerClass={PANE_PICK} label={`${label} views`} width={220} trigger={<>{VIEW_WORD[effectiveTab]} <I.chevD size={12} /></>}>
              {(close) => views.map((v) => <Row key={v} title={VIEW_WORD[v]} on={effectiveTab === v} onPick={() => (close(), onView(v === "overview" ? "all" : v))} />)}
            </Pop>
          ) : (
            <PaneWords>{teamCounts(swarm.members) || "No agent yet"}</PaneWords>
          )
        }
        tools={
          <Pop menu align="end" triggerClass={PANE_TOOL} label={`${label}: pause, hibernate or turn off`} width={240} trigger={<I.more size={16} />}>
            {(close) => (
              <>
                {isSwarmMode && <Row title="Add a worker" icon={<I.plus size={14} />} onPick={() => (close(), onView("add"))} />}
                {workers.some((m) => m.state === "working" || m.state === "waiting") && <Row title="Hibernate all" icon={<I.snooze size={14} />} onPick={() => (close(), void rpc("swarm.hibernate", { threadId: thread.id }).catch(fail))} />}
                {swarm.paused ? (
                  <Row title="Carry on" icon={<I.play size={14} />} onPick={() => (close(), void rpc("swarm.resume", { threadId: thread.id }).catch(fail))} />
                ) : (
                  <Row title={isSwarmMode ? "Pause the swarm" : "Pause Teamwork"} icon={<I.stop size={14} />} disabled={!busy} onPick={() => (close(), void rpc("swarm.stopAll", { threadId: thread.id }).catch(fail))} />
                )}
                <Sep />
                <ConfirmRow title={isSwarmMode ? "Turn the swarm off" : "Turn Teamwork off"} sure="Turn it off: every worker stops" icon={<I.close size={14} />} red onConfirm={() => (close(), void rpc("swarm.enable", { threadId: thread.id, enabled: false }).catch(fail))} />
              </>
            )}
          </Pop>
        }
      />
      <div className="lc-agents-panel lc-cr">

      {effectiveTab === "overview" && (
        <>
          {/* The person's own Stop needs no line: they know they pressed it. */}
          {swarm.paused && swarm.paused.reason !== "stopped" && (
            <div className="lc-sw-addbar">
              <span className="lc-cr-none">{swarm.paused.reason === "limit" ? `Paused after ${swarm.paused.turns ?? SWARM_SELF_TURNS_MAX} turns the team started by itself.` : "Paused: Liner Code restarted."}</span>
              <span className="lc-grow" />
              <PaneButton onClick={() => void rpc("swarm.resume", { threadId: thread.id }).catch(fail)}>Carry on</PaneButton>
            </div>
          )}
          {isSwarmMode && swarm.plan && (
            <>
              <div className="lc-cr-h">
                Goal<span className="lc-cr-rule" />
                <span>{swarm.stallMonitor ? "Stall monitor on" : "Manual"}</span>
              </div>
              <div className="lc-cr-brief">
                <b>{swarm.plan.goal.title}</b>
                {swarm.plan.goal.line && <div className="lc-quiet">{swarm.plan.goal.line}</div>}
              </div>
              {swarm.plan.threads.length > 0 && (
                <>
                  <div className="lc-cr-h">
                    Workstreams<span className="lc-cr-rule" />
                    <span>{plural(swarm.plan.threads.length, "outcome")}</span>
                  </div>
                  <div className="lc-sw-wslist">
                    {swarm.plan.threads.map((th) => {
                      const meta = workstreamMeta(th.tasks);
                      return (
                        <div key={th.id} className="lc-sw-ws">
                          <div className="lc-sw-wsh">
                            <Mark state={meta.state} waiting={meta.waiting} />
                            <b>{th.title}</b>
                            <span className="lc-cr-own">{meta.statusWord}</span>
                          </div>
                          {th.goal && <div className="lc-sw-wsg">{th.goal}</div>}
                          <div className="lc-sw-wsf">
                            {th.tasks.map((k) => (
                              <span key={k} className="lc-cr-own">@{k}</span>
                            ))}
                            <span className="lc-grow" />
                            {meta.lastPost && <span className="lc-mono lc-quiet">#{meta.lastPost.seq}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {isSwarmMode && timelineShots.length > 0 && (
            <>
              <div className="lc-cr-h">
                Visual timeline<span className="lc-cr-rule" />
                <span>{plural(timelineShots.length, "screenshot")}</span>
              </div>
              <div className="lc-sw-shots">
                {timelineShots.map((sh) => (
                  <div key={sh.key} className="lc-sw-shot" title={sh.path}>
                    <div className="lc-sw-shoth">
                      <span className="lc-mono">#{sh.seq}</span>
                      <span>@{sh.from}</span>
                    </div>
                    <div className="lc-sw-shotc">{sh.caption}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="lc-cr-h">
            {isSwarmMode ? "Roster" : "Subagents"}
            <span className="lc-cr-rule" />
            <span>
              {swarm.activeSlots}/{swarm.maxActive} active · {swarm.rssMb > 0 ? `~${swarm.rssMb} MB` : "0 MB"}
            </span>
          </div>

          <div className="lc-cr-tree">
            {coordinator && (
              <div className="lc-sw-node">
                <div className="lc-cr-row lc-sw-mrow" data-root>
                  <Mark state={coordinator.state === "working" || swarm.activeSlots > 0 ? "running" : "done"} waiting={coordinator.state === "waiting" && swarm.activeSlots === 0 && workers.length === 0} />
                  <span className="lc-cr-t">
                    <b>
                      {isSwarmMode ? "@coordinator" : "Teamwork Coordinator"}
                      {isSwarmMode && <span> · Coordinator</span>}
                      {!isSwarmMode && topWorkers.length > 0 && <span> ({plural(topWorkers.length, "subagent")})</span>}
                    </b>
                    <small>
                      <span>{modelLabel(coordinator.model, providers)} · {coordinator.state === "working" || swarm.activeSlots > 0 ? "Coordinating" : "Ready"}</span>
                    </small>
                  </span>
                </div>
                {!isSwarmMode && topWorkers.length > 0 && (
                  <button type="button" className="lc-ib l-focus lc-sw-fold" aria-label={folded.has("coordinator") ? "Expand Teamwork Coordinator" : "Collapse Teamwork Coordinator"} aria-expanded={!folded.has("coordinator")} onClick={() => toggleFold("coordinator")}>
                    {folded.has("coordinator") ? <I.chevR size={12} /> : <I.chevD size={12} />}
                  </button>
                )}
              </div>
            )}
            {isSwarmMode ? (
              topWorkers.length === 0 ? (
                <p className="lc-cr-none">No peers yet. Send a task in chat and @coordinator will spawn peers automatically, or add one manually below.</p>
              ) : (
                renderBranch(topWorkers, true)
              )
            ) : (
              !folded.has("coordinator") && (
                <div className="lc-cr-kids">
                  {topWorkers.length === 0 ? (
                    <div className="lc-cr-kid" data-last>
                      <p className="lc-cr-none">No subagents yet. Describe the task in chat with /teamwork.</p>
                    </div>
                  ) : (
                    renderBranch(topWorkers, false)
                  )}
                </div>
              )
            )}
          </div>

          {/* Hibernate all, Pause and Turn off are the head's ··· (and the agents popup's); adding a worker is a row that opens its form. */}
          {isSwarmMode && (
            <PaneRow icon={<I.plus size={14} />} opens={!adding} value={adding ? "Cancel" : undefined} quiet onClick={() => setAdding((a) => !a)}>
              Add a worker
            </PaneRow>
          )}

          {isSwarmMode && adding && (
            <div className="lc-sw-form">
              <div className="lc-sw-fgrid">
                <input type="text" className="lc-sw-in l-focus" placeholder="Name (backend, tester…)" value={wName} onChange={(e) => setWName(e.target.value)} />
                <input type="text" className="lc-sw-in l-focus" placeholder="Role (Writer, Verifier…)" value={wRole} onChange={(e) => setWRole(e.target.value)} />
              </div>
              {/* A choice among several is a row with its value and a menu, never a segmented control or a native select. */}
              <Pop menu triggerClass={PANE_ROW} label="Where the worker works" width={260} trigger={<PaneRowIn icon={<I.branch size={14} />} value={wWs === "share" ? "Its own worktree, writes" : "The shared folder, reads"} quiet opens>Workspace</PaneRowIn>}>
                {(close) => (
                  <>
                    <Row title="Its own worktree" note="Writes on a branch of its own" on={wWs === "share"} onPick={() => (close(), setWWs("share"))} />
                    <Row title="The shared folder" note="Reads only" on={wWs === "inherit"} onPick={() => (close(), setWWs("inherit"))} />
                  </>
                )}
              </Pop>
              {live.length > 0 && (
                <Pop menu triggerClass={PANE_ROW} label="Context to start from" width={260} trigger={<PaneRowIn icon={<I.fork size={14} />} value={wFork ? `From @${wFork}` : "Fresh"} quiet opens>Context</PaneRowIn>}>
                  {(close) => (
                    <>
                      <Row title="Start fresh" on={!wFork} onPick={() => (close(), setWFork(""))} />
                      {live.map((m) => (
                        <Row key={m.name} title={`Fork from @${m.name}`} on={wFork === m.name} onPick={() => (close(), setWFork(m.name))} />
                      ))}
                    </>
                  )}
                </Pop>
              )}
              <textarea rows={2} className="lc-sw-in l-focus" placeholder="Brief: what this worker owns and what done looks like…" value={wBrief} onChange={(e) => setWBrief(e.target.value)} />
              <div className="lc-sw-formfoot">
                <PaneButton onClick={() => setAdding(false)}>Cancel</PaneButton>
                <PaneButton ink onClick={addWorker}>
                  Add to swarm
                </PaneButton>
              </div>
            </div>
          )}

          <div className="lc-cr-h">
            RAM pool<span className="lc-cr-rule" />
            <span className="l-num">{swarm.rssMb > 0 ? `~${swarm.rssMb} MB` : "0 MB"}</span>
          </div>
          <Pop menu triggerClass={PANE_ROW} label="Active worker slots" width={220} trigger={<PaneRowIn icon={<I.chip size={14} />} value={`${swarm.activeSlots} of ${swarm.maxActive} busy`} quiet opens>Active slots</PaneRowIn>}>
            {(close) => [1, 2, 3, 4].map((v) => <Row key={v} title={plural(v, "slot")} on={swarm.maxActive === v} onPick={() => (close(), void rpc("swarm.config", { threadId: thread.id, maxActive: v }).catch(fail))} />)}
          </Pop>
          <PaneRow icon={<I.snooze size={14} />} value={`${swarm.hibernatedCount}, 0 MB`} quiet>Hibernated</PaneRow>
          <PaneRow icon={<I.clock size={14} />} value={swarm.hibernateSec === 0 ? "at once" : `after ${swarm.hibernateSec} s`} quiet>Auto-hibernate</PaneRow>
          <SessionUse thread={thread} />
        </>
      )}

      {effectiveTab === "board" && (
        <>
          {channels.length > 1 && (
            <Pop menu triggerClass={PANE_ROW} label="Board channel" width={220} trigger={<PaneRowIn icon={<I.comment size={14} />} value={channel === "all" ? "All" : `#${channel}`} quiet opens>Channel</PaneRowIn>}>
              {(close) => [{ value: "all", label: "All" }, ...channels.map((c) => ({ value: c, label: `#${c}` }))].map((c) => <Row key={c.value} title={c.label} on={channel === c.value} onPick={() => (close(), setChannel(c.value))} />)}
            </Pop>
          )}
          <div className="lc-cr-h">
            Board<span className="lc-cr-rule" />
            <span>{plural(posts.length, "post")}</span>
          </div>
          {posts.length === 0 ? (
            <p className="lc-cr-none">No board posts yet. Briefs, @mentions and worker reports land here.</p>
          ) : (
            <ul className="lc-sw-posts" role="list">
              {posts.map((p: SwarmPost) => (
                <li key={p.seq} className="lc-sw-post" data-kind={p.kind}>
                  <div className="lc-sw-ph">
                    <span className="lc-mono lc-quiet">#{p.seq}</span>
                    <b>@{p.from}</b>
                    {p.channel !== "main" && <span className="lc-crp-role">#{p.channel}</span>}
                    {p.autoPosted && <span className="lc-crp-role">auto</span>}
                    {p.kind === "stall" && <span className="lc-crp-role">stall</span>}
                    <span className="lc-grow" />
                    <time className="lc-cr-at" dateTime={new Date(p.at).toISOString()}>
                      {stepAt(p.at)}
                    </time>
                  </div>
                  <div className="lc-sw-pb">{p.text}</div>
                </li>
              ))}
            </ul>
          )}
          <SendBox className="lc-cr-steer" value={draft} onChange={setDraft} label="Post to swarm board" placeholder="Post to the board (@name wakes a hibernated worker)…" onSend={sendPost} />
          <p className="lc-cr-hint">Mention @name to wake a parked worker, or @all to notify the roster.</p>
        </>
      )}

      {effectiveTab === "worktrees" && (
        <>
          <div className="lc-cr-h">
            Isolated worktrees<span className="lc-cr-rule" />
            <span>{worktrees.length}</span>
          </div>
          {worktrees.length === 0 ? (
            <p className="lc-cr-none">No worktree writers yet. Writers added with workspace "share" get their own git branch and worktree here.</p>
          ) : (
            worktrees.map((m) => (
              <div key={m.name} className="lc-sw-wt">
                <div className="lc-sw-wth">
                  <b>@{m.name}</b>
                  <span className="lc-mono lc-quiet">{m.branch}</span>
                  {m.portOffset ? <span className="lc-quiet l-num">+{m.portOffset}</span> : null}
                  <span className="lc-grow" />
                  {m.landed ? (
                    <span className="lc-crp-role">Landed</span>
                  ) : (
                    <PaneButton
                      disabled={m.state === "working"}
                      onClick={() =>
                        void rpc("swarm.land", { threadId: thread.id, name: m.name })
                          .then((r) => toast.success(r.summary))
                          .catch(fail)
                      }
                    >
                      Land into checkout
                    </PaneButton>
                  )}
                </div>
                {m.worktreePath && <div className="lc-mono lc-quiet lc-sw-wtp">{m.worktreePath}</div>}
                {m.files && m.files.length > 0 && (
                  <ul className="lc-cr-files" role="list">
                    {m.files.map((f) => (
                      <li key={f.path}>
                        <span className="lc-cr-file" title={f.path}>
                          <span className="lc-cr-fs" data-s={f.status}>
                            {f.status === "added" ? "A" : f.status === "deleted" ? "D" : f.status === "renamed" ? "R" : "M"}
                          </span>
                          <span className="lc-cr-fp lc-mono">{f.path}</span>
                          <Lines added={f.added} removed={f.removed} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </>
      )}
      </div>
    </>
  );
}
