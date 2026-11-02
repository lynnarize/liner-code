/*
  The engine's memory. Projects, agents, threads and settings live in one state.json; each
  thread's timeline is an append-only log (threads/<id>.jsonl) of item snapshots, the newest
  line for an id winning. Writes are small and atomic, and on disk before they count; a crash
  loses at most the text that was still streaming.
*/
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Access, AgentProfile, EngineEvent, Item, LimitWindow, Mode, ModelPicks, Project, ProviderId, RouteCast, RouteLevel, Settings, SidebarGroup, Thread, UsageRecord } from "../../contracts/src/index.ts";
import { defaultAgents, modelAgent } from "./agents.ts";

type State = { projects: Project[]; threads: Thread[]; agents: AgentProfile[]; settings: Settings; groups: SidebarGroup[] };
type Listener = (e: EngineEvent) => void;

/**
  A rename over a file. On Windows it fails for a moment while something else has the file open
  (a virus scan, the search indexer, a reader), so it's tried again for up to half a second, as
  Claude Code's own writes do.
*/
function renameOver(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || i >= 10 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/**
  Writes a file whole or not at all: to a temporary file, flushed to disk, then renamed over it,
  and the folder flushed so the rename lasts too. A rename alone can leave an empty file after a
  power cut. With `backup`, the file it replaces is kept as .bak first, the last one that was good.
*/
export function writeAtomic(file: string, text: string, o: { backup?: boolean } = {}) {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (o.backup && existsSync(file)) copyFileSync(file, `${file}.bak`);
  renameOver(tmp, file);
  try {
    const dir = openSync(dirname(file), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    // a folder that can't be flushed: the rename is as safe as the system makes it
  }
}

/**
  state.json as it was last saved. One that doesn't read (cut short, or garbled) is moved aside as
  state.json.broken, so the next save can't put it over the good .bak, and the .bak is read
  instead. With neither, the engine starts empty rather than not at all.
*/
export function loadState<T = State>(file: string): Partial<T> {
  if (!existsSync(file)) return existsSync(`${file}.bak`) ? loadState<T>(`${file}.bak`) : {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Partial<T>;
  } catch (e) {
    console.error(`[store] ${file} didn't read (${e instanceof Error ? e.message : String(e)}); moved aside as ${file}.broken`);
    renameSync(file, `${file}.broken`);
    return file.endsWith(".bak") ? {} : loadState<T>(file);
  }
}

export const defaultSettings: Settings = { onboarded: false, mode: "solo", claudeBilling: "plan", settleDays: 0, notify: true, guardDestructive: true, defaultAccess: "auto", worktrees: false, branchPrefix: "liner/", badge: true, budgetUsd: 0, settleOnMerge: false, settleOnRoutine: false, settleVersion: 2, accessVersion: 2 };

/**
  Settings and sessions from before permissions came down to four, moved once: a default that was
  the old one (Asks first), or a level that's gone, becomes Auto; a session that edited on its own
  is Auto, one that only read is Manual. Side chats and routine runs read only, as Liner sets them.
*/
export function fourLevels(s: Pick<State, "settings" | "threads">): Pick<State, "settings" | "threads"> {
  const level = (a: Access): Access => (a === "edits" ? "auto" : a === "read" ? "ask" : a);
  return {
    settings: { ...s.settings, defaultAccess: s.settings.defaultAccess === "full" || s.settings.defaultAccess === "review" ? s.settings.defaultAccess : "auto", accessVersion: 2 },
    threads: s.threads.map((t) => (t.sideOf || t.routine ? t : { ...t, access: level(t.access) })),
  };
}

/** What settings said before modes, read once by `fromWorkStyle`. */
type Legacy = {
  workStyle?: "model" | "lead" | "team";
  team?: unknown;
  setups?: { id: string; lead: string | null; stages: { who: string; job: string }[] }[];
  setup?: string;
  route?: { level?: RouteLevel; cast?: Partial<RouteCast> };
};

/**
  Settings from before modes, read once. A lead and a coder (or a setup with a lead) becomes Plan,
  the rest Solo. Your picks for routed sessions become your models (everyday the cheaper, strong
  the frontier, the judge the checker). Without them, a setup that wrote in stages with bare models
  (DeepSeek builds, Opus improves) makes its first your cheaper model and its last your frontier
  one; when it was the way you worked, its frontier model refines each change, as it did.
*/
export function fromWorkStyle(old: Partial<Settings> & Legacy): Partial<Settings> {
  const { workStyle, team: _team, setups = [], setup, route, ...rest } = old;
  const active = setups.find((x) => x.id === setup) ?? setups[0];
  const mode: Mode = workStyle === "lead" || (workStyle === "team" && active?.lead) ? "plan" : "solo";
  const routed = route?.cast ?? {};
  const staged = setups.find((x) => x.stages.length > 1 && x.stages.every((st) => st.who.startsWith("@")));
  const picks: ModelPicks = routed.everyday || routed.strong || routed.judge ? { cheaper: routed.everyday, frontier: routed.strong, checker: routed.judge } : staged ? { cheaper: staged.stages[0].who.slice(1), frontier: staged.stages[staged.stages.length - 1].who.slice(1) } : {};
  const kept = Object.fromEntries(Object.entries(picks).filter(([, v]) => v)) as ModelPicks;
  const refined = workStyle === "team" && staged && active?.id === staged.id && !active.lead;
  return { ...rest, mode, ...(Object.keys(kept).length ? { picks: kept } : {}), ...(refined ? { after: "refine" as const } : {}), route: route?.level ? { level: route.level } : undefined };
}

export class Store {
  readonly home: string;
  private state: State;
  private items = new Map<string, Item[]>();
  private listeners = new Set<Listener>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(home = process.env.LINER_HOME || join(homedir(), ".liner-code")) {
    this.home = home;
    mkdirSync(join(home, "threads"), { recursive: true });
    const file = join(home, "state.json");
    const saved = loadState(file);
    this.state = {
      projects: saved.projects ?? [],
      threads: saved.threads ?? [],
      agents: saved.agents?.length ? saved.agents : defaultAgents(),
      settings: { ...defaultSettings, ...(saved.settings && !saved.settings.mode ? fromWorkStyle(saved.settings) : saved.settings) },
      groups: saved.groups ?? [],
    };
    if (saved.settings && !saved.settings.mode) this.flush();
    // Settling became yours to do: the rules that used to be on by default are switched off once.
    if (saved.settings && (saved.settings.settleVersion ?? 1) < 2) {
      this.state.settings = { ...this.state.settings, settleDays: 0, settleOnMerge: false, settleOnRoutine: false, settleVersion: 2 };
      this.flush();
    }
    // Permissions came down to four: Auto (the default now), Manual, Reviewer decides, Full access.
    if (saved.settings && (saved.settings.accessVersion ?? 1) < 2) {
      Object.assign(this.state, fourLevels(this.state));
      this.flush();
    }
    // A thread that was working when the engine stopped is not working any more. One whose question
    // or planner's plan still asks stays in Needs you: those outlive the turn that asked (timeline()).
    for (const t of this.state.threads)
      if (t.status === "running" || t.status === "waiting") {
        const asking = t.status === "waiting" && this.timeline(t.id).some((x) => (x.kind === "question" || x.kind === "proposal") && x.state === "asking");
        t.status = asking ? "waiting" : "idle";
        t.unread = true;
        // A review it was in the middle of ended with it (its item settles as an error when read).
        if (t.verdict?.state === "checking") t.verdict = undefined;
      }
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Events sent so far: each goes out numbered, so the app can tell one a snapshot holds from one after it. */
  seq = 0;
  emit(e: EngineEvent) {
    this.seq++;
    for (const fn of this.listeners) fn(e);
  }

  get projects() {
    return this.state.projects;
  }
  get threads() {
    return this.state.threads;
  }
  get agents() {
    return this.state.agents;
  }
  get settings() {
    return this.state.settings;
  }
  get groups() {
    return this.state.groups;
  }
  setGroups(groups: SidebarGroup[]) {
    this.state.groups = groups;
    // Sessions in a group that's gone go back to sorting by state.
    for (const t of this.state.threads) if (t.group && !groups.some((g) => g.id === t.group)) t.group = undefined;
    this.save();
    this.emit({ type: "groups", groups });
    return groups;
  }

  project(id: string) {
    const p = this.state.projects.find((x) => x.id === id);
    if (!p) throw new Error(`No project ${id}`);
    return p;
  }
  thread(id: string) {
    const t = this.state.threads.find((x) => x.id === id);
    if (!t) throw new Error(`No thread ${id}`);
    return t;
  }
  /** The model that stands in for an agent that's gone, until `repairAgents` points its sessions elsewhere: the everyday one, once tools are found. */
  standIn = "claude:claude-sonnet-5-5";

  /** An agent by id, or a bare model ("@claude:claude-opus-5-5"). One that's gone is the stand-in model, never another of your agents. */
  agent(id: string): AgentProfile {
    if (id.startsWith("@")) return modelAgent(id, id.slice(id.indexOf(":") + 1));
    return this.state.agents.find((a) => a.id === id) ?? modelAgent(`@${this.standIn}`, this.standIn.slice(this.standIn.indexOf(":") + 1));
  }

  /**
    Sessions that name an agent that's gone carry on with the model it ran on: from `models` (the
    agents you just removed), else its last turn in the session, else `fallback`. A planner with no
    model to go on leaves the session in Solo. A project that started with it starts as usual.
  */
  repairAgents(models: Map<string, string>, fallback: string) {
    const known = new Set(this.state.agents.map((a) => a.id));
    const live = (id?: string) => !id || id.startsWith("@") || known.has(id);
    const modelOf = (t: Thread, id: string) => {
      const turn = this.timeline(t.id).findLast((x) => x.kind === "turn" && x.agent === id);
      return models.get(id) ?? (turn?.kind === "turn" ? turn.model : undefined);
    };
    let changed = false;
    for (const t of this.state.threads) {
      if (live(t.agent) && live(t.lead) && live(t.turnBy)) continue;
      const agent = live(t.agent) ? t.agent : `@${modelOf(t, t.agent) ?? fallback}`;
      const was = t.lead && !live(t.lead) ? modelOf(t, t.lead) : undefined;
      const lead = live(t.lead) ? t.lead : was && `@${was}` !== agent ? `@${was}` : undefined;
      // Moved in place, so the session keeps its spot in the sidebar.
      Object.assign(t, { agent, lead, turnBy: live(t.turnBy) ? t.turnBy : t.turnBy === t.lead ? lead : agent, leadSession: lead ? t.leadSession : undefined });
      this.emit({ type: "thread", thread: t });
      changed = true;
    }
    for (const p of this.state.projects)
      if (p.agent && !live(p.agent)) {
        p.agent = undefined;
        this.emit({ type: "project", project: p });
        changed = true;
      }
    if (changed) this.save();
    return changed;
  }

  /** A turn ran on a tool: its plan's windows are asked again. */
  onUsage?: (r: UsageRecord) => void;
  /** A turn reported one of its tool's plan windows. */
  onWindow?: (provider: ProviderId, w: LimitWindow) => void;
  /** Every turn's tokens and cost, one line each, for the Usage page. */
  logUsage(r: UsageRecord) {
    appendFileSync(join(this.home, "usage.jsonl"), `${JSON.stringify(r)}\n`);
    this.onUsage?.(r);
  }
  usage(from: number): UsageRecord[] {
    const file = join(this.home, "usage.jsonl");
    if (!existsSync(file)) return [];
    const out: UsageRecord[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as UsageRecord;
        if (r.at >= from) out.push(r);
      } catch {
        // a torn line
      }
    }
    return out;
  }

  /** Forgets a thread and its timeline. */
  removeThread(id: string) {
    this.state.threads = this.state.threads.filter((t) => t.id !== id);
    this.items.delete(id);
    rmSync(this.logFile(id), { force: true });
    this.save();
  }

  putProject(p: Project) {
    const i = this.state.projects.findIndex((x) => x.id === p.id);
    if (i < 0) this.state.projects.push(p);
    else this.state.projects[i] = p;
    this.save();
    this.emit({ type: "project", project: p });
    return p;
  }
  removeProject(id: string) {
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    this.state.threads = this.state.threads.filter((t) => t.projectId !== id);
    this.save();
    this.emit({ type: "project.removed", id });
  }

  putThread(t: Thread) {
    t.updatedAt = Date.now();
    const i = this.state.threads.findIndex((x) => x.id === t.id);
    if (i < 0) this.state.threads.push(t);
    else this.state.threads[i] = t;
    this.save();
    this.emit({ type: "thread", thread: t });
    return t;
  }
  patchThread(id: string, patch: Partial<Thread>) {
    return this.putThread({ ...this.thread(id), ...patch });
  }

  setAgents(agents: AgentProfile[]) {
    this.state.agents = agents;
    this.save();
    this.emit({ type: "agents", agents });
    return agents;
  }
  setSettings(patch: Partial<Settings>) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
    this.emit({ type: "settings", settings: this.state.settings });
    return this.state.settings;
  }

  /** The timeline of a thread, read from its log the first time it is asked for. */
  timeline(threadId: string): Item[] {
    const cached = this.items.get(threadId);
    if (cached) return cached;
    const file = this.logFile(threadId);
    const order: string[] = [];
    const byId = new Map<string, Item>();
    let lines = 0;
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        lines++;
        try {
          const item = JSON.parse(line) as Item;
          if (!byId.has(item.id)) order.push(item.id);
          byId.set(item.id, item);
        } catch {
          // A torn last line from a crash: skip it.
        }
      }
    }
    const list = order.map((id) => byId.get(id)!);
    // Anything left mid-stream or mid-step by a stopped engine is settled. A question stays: its
    // answer goes as your next message (Runtime.answerQuestion). So does a planner's plan, which never
    // waited in its turn: approving it starts the builder (Runtime.answerProposal). A plan a writer
    // waited on in its turn, or a step to allow, has nobody to answer to any more.
    const planned = new Set(list.flatMap((x) => (x.kind === "turn" && x.planning ? [x.turn] : [])));
    for (const it of list) {
      if ((it.kind === "text" || it.kind === "reasoning") && it.streaming) it.streaming = false;
      if (it.kind === "tool" && it.status === "running") it.status = "failed";
      if (it.kind === "approval" && it.state === "asking") it.state = "expired";
      if (it.kind === "proposal" && it.state === "asking" && !planned.has(it.turn)) it.state = "expired";
      if (it.kind === "turn" && it.status === "running") it.status = "stopped";
      if (it.kind === "review" && it.status === "running") it.status = "error";
    }
    this.items.set(threadId, list);
    // Rewrite the log once it holds many more lines than items.
    if (lines > list.length * 3 + 50) this.rewrite(threadId);
    return list;
  }

  /**
    A thread's checkpoints and reviews, read from its log without keeping the timeline in memory:
    for numbers across many sessions. Later lines replace earlier ones with the same id.
  */
  marks(threadId: string): Item[] {
    return this.peek(threadId, ["checkpoint", "review"]);
  }

  /** A thread's items of these kinds, read from its log without keeping the timeline in memory: for numbers and search across many sessions. */
  peek(threadId: string, kinds: Item["kind"][]): Item[] {
    const cached = this.items.get(threadId);
    if (cached) return cached.filter((x) => kinds.includes(x.kind));
    const file = this.logFile(threadId);
    if (!existsSync(file)) return [];
    const byId = new Map<string, Item>();
    const tags = kinds.map((k) => `"kind":"${k}"`);
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!tags.some((t) => line.includes(t))) continue;
      try {
        const item = JSON.parse(line) as Item;
        byId.set(item.id, item);
      } catch {
        // A torn last line from a crash: skip it.
      }
    }
    return [...byId.values()];
  }

  /** Adds or replaces an item, tells the app, and logs it unless it is still streaming. */
  putItem(threadId: string, item: Item, log = true) {
    const list = this.timeline(threadId);
    const i = list.findIndex((x) => x.id === item.id);
    if (i < 0) list.push(item);
    else list[i] = item;
    this.emit({ type: "item", threadId, item });
    if (log) appendFileSync(this.logFile(threadId), `${JSON.stringify(item)}\n`);
    return item;
  }

  /** On the way out: what's still streaming is logged as it stands, so quitting keeps an answer so far. */
  keepStreaming() {
    for (const [threadId, list] of this.items)
      for (const it of list) if ((it.kind === "text" || it.kind === "reasoning") && it.streaming && it.text) appendFileSync(this.logFile(threadId), `${JSON.stringify({ ...it, streaming: false })}\n`);
  }

  /** Appends streamed text to a text or reasoning item, in memory; it is logged when it ends. */
  appendText(threadId: string, itemId: string, text: string) {
    const it = this.timeline(threadId).find((x) => x.id === itemId);
    if (!it || (it.kind !== "text" && it.kind !== "reasoning")) return;
    it.text += text;
    this.emit({ type: "delta", threadId, itemId, text });
  }

  /** Takes turns `from` and later off a thread's timeline, and tells the app. */
  truncate(threadId: string, from: number) {
    const list = this.timeline(threadId).filter((x) => x.turn < from);
    this.items.set(threadId, list);
    this.rewrite(threadId);
    this.emit({ type: "timeline", threadId, items: list });
    return list;
  }

  item(threadId: string, itemId: string) {
    const it = this.timeline(threadId).find((x) => x.id === itemId);
    if (!it) throw new Error(`No item ${itemId}`);
    return it;
  }

  private logFile(threadId: string) {
    return join(this.home, "threads", `${threadId}.jsonl`);
  }
  private rewrite(threadId: string) {
    const list = this.items.get(threadId) ?? [];
    const file = this.logFile(threadId);
    writeAtomic(file, list.map((x) => JSON.stringify(x)).join("\n") + (list.length ? "\n" : ""));
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 120);
  }
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    writeAtomic(join(this.home, "state.json"), JSON.stringify(this.state, null, 2), { backup: true });
  }
}

let n = 0;
/** Short, sortable ids: time first, then a counter and a little noise. */
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(n++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
