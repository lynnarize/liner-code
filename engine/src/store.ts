/*
  The engine's memory. Projects, agents, threads and settings live in one state.json; each
  thread's timeline is an append-only log (threads/<id>.jsonl) of item snapshots, the newest
  line for an id winning. Writes are small and atomic, and on disk before they count; a crash
  loses at most the text that was still streaming.
*/
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Access, AgentProfile, EngineEvent, Item, LimitWindow, ModelPicks, Project, ProviderId, Settings, SidebarGroup, Thread, UsageRecord } from "../../contracts/src/index.ts";
import { defaultAgents, modelAgent } from "./agents.ts";

type State = { projects: Project[]; threads: Thread[]; agents: AgentProfile[]; settings: Settings; groups: SidebarGroup[] };

/** How many timelines stay in memory once they have sat unused for TIMELINE_IDLE_MS (letGoTimelines): the rest are read from their logs again when next asked for. */
export const TIMELINES_KEPT = 30;
export const TIMELINE_IDLE_MS = 10 * 60_000;
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

export const defaultSettings: Settings = { onboarded: false, claudeBilling: "plan", settleDays: 0, notify: true, guardDestructive: true, defaultAccess: "auto", worktrees: false, branchPrefix: "liner/", badge: true, budgetUsd: 0, settleOnMerge: false, settleOnRoutine: false, settleVersion: 2, accessVersion: 2 };

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

/** Where the state from before pairs is kept, beside state.json: written once, never over an earlier copy. */
export const BEFORE_PAIRS = "state.before-pairs.json";

/** Settings as they were saved before pairs: read once by `toPairs`, and what `fromWorkStyle` makes. */
type OldPicks = { frontier?: string; cheaper?: string; second?: string; lead?: string; sidekick?: string; checker?: string };
export type OldSettings = Omit<Settings, "picks"> & { mode?: "solo" | "plan" | "auto"; picks?: OldPicks; dual?: boolean; after?: "check" | "refine" | "off"; route?: { level?: string }; approvePlans?: boolean };
/** A session as it was saved before pairs: a Plan session's planner (`lead`), an Auto session's cast, After and the rest. */
type OldThread = Thread & {
  lead?: string;
  leadSession?: string;
  route?: { cast?: { strong?: string; everyday?: string } };
  dual?: boolean;
  after?: "check" | "refine" | "off";
  checks?: { by: string | null; rounds: number };
  trial?: unknown;
};

/**
  Plan and Auto from before pairs, moved once. A Plan session's planner leads it and its builder
  becomes the sidekick, as a bare model (a builder that was one of your agents is that agent's
  model, or the session's own model when it had one). An Auto session is led by its cast's strong
  model with its everyday one as the sidekick. Two of the same model make no pair. Both drop their
  tools' saved sessions (a fork's too), so the next turn starts from the conversation as text. After "off" (or a
  checker of nobody) turns the Reviewer off for the session; any other After follows Settings. A
  cost test is archived. Settings' Solo starts new sessions fast, Plan and Auto as a pair; your
  frontier model is your lead and your cheaper one your sidekick (Dual frontier's second goes),
  and the old fields are dropped once read. This is the one place that still reads them.
  A session saved so oddly that moving it fails is left as it was and logged, so one odd session
  can't stop the engine (a planner with no builder just leads alone). Every session's saved conversations of other models ("@<ref>", a
  Refine's) go too: a sidekick is kept under that same key and would resume one as its own.
*/
export function toPairs(s: { settings: OldSettings; threads: OldThread[]; agents: AgentProfile[] }): Pick<State, "settings" | "threads"> {
  const bare = (id?: string) => (!id ? undefined : id.startsWith("@") ? id.slice(1) : s.agents.find((a) => a.id === id)?.model);
  const threads = s.threads.map((old): Thread => {
    try {
      return pairOf(old);
    } catch (e) {
      // Its id as JSON: whatever was saved as one, saying so can't throw too.
      console.error(`[store] session ${JSON.stringify(old?.id)} didn't move to pairs (${e instanceof Error ? e.message : String(e)}); left as it was`);
      return old;
    }
  });
  function pairOf(old: OldThread): Thread {
    const { lead, leadSession: _ls, route, dual: _d, after, checks, trial, ...t } = old;
    const moved: Thread = { ...t };
    let pair: { agent: string; sidekick?: string } | undefined;
    // The Demo played planner and builder both: it stays one model.
    if (lead && lead !== t.agent) {
      const sidekick = t.model ?? bare(t.agent);
      pair = { agent: lead, sidekick: sidekick && sidekick !== bare(lead) ? sidekick : undefined };
      // The model and effort were the builder's; the lead goes by its own.
      delete moved.model;
      delete moved.effort;
    } else if (route?.cast?.strong) {
      const { strong, everyday } = route.cast;
      pair = { agent: `@${strong}`, sidekick: everyday && everyday !== strong ? everyday : undefined };
      delete moved.model;
    }
    // A Refine's own conversation, under the key a sidekick of that model keeps its own: it would resume it. The lead's is providerSession.
    if (moved.sessions) {
      const kept = Object.fromEntries(Object.entries(moved.sessions).filter(([k]) => !k.startsWith("@")));
      if (Object.keys(kept).length) moved.sessions = kept;
      else delete moved.sessions;
    }
    if (pair) {
      moved.agent = pair.agent;
      if (pair.sidekick) moved.sidekick = pair.sidekick;
      else delete moved.sidekick;
      delete moved.providerSession;
      delete moved.sessions;
      // A fork that never ran its first turn would branch the old builder's own conversation as the lead's (Runtime.realFork):
      // it starts from the conversation as text instead.
      if (moved.forkSession !== undefined) moved.forkSession = "";
      if (moved.turnBy && moved.turnBy !== moved.agent) delete moved.turnBy;
    }
    if ((after === "off" || checks?.by === null) && moved.review === undefined) moved.review = false;
    if (trial) moved.archived = true;
    return moved;
  }
  // Saved as null, picks are none: a default in the pattern only stands in for undefined.
  const { mode, dual: _d, after, route: _r, approvePlans: _a, picks: was, ...rest } = s.settings;
  const old: OldPicks = was ?? {};
  const start = rest.start ?? (mode === "solo" ? "fast" : mode ? "pair" : undefined);
  const picks = Object.fromEntries(Object.entries({ lead: old.lead ?? old.frontier, sidekick: old.sidekick ?? old.cheaper, checker: old.checker }).filter(([, v]) => v)) as ModelPicks;
  const settings: Settings = { ...rest, ...(Object.keys(picks).length ? { picks } : {}), ...(start ? { start } : {}), ...(after === "off" && rest.review === undefined ? { review: false } : {}), pairVersion: 1 };
  return { settings, threads };
}

/** What settings said before modes, read once by `fromWorkStyle`. */
type Legacy = {
  workStyle?: "model" | "lead" | "team";
  team?: unknown;
  setups?: { id: string; lead: string | null; stages: { who: string; job: string }[] }[];
  setup?: string;
  route?: { level?: string; cast?: { everyday?: string; strong?: string; judge?: string; critics?: string[] } };
};

/**
  Settings from before modes, read once, into the shape `toPairs` reads next. A lead and a coder
  (or a setup with a lead) becomes Plan, the rest Solo. Your picks for routed sessions become your
  models (everyday the cheaper, strong the frontier, the judge the checker). Without them, a setup
  that wrote in stages with bare models (DeepSeek builds, Opus improves) makes its first your
  cheaper model and its last your frontier one; when it was the way you worked, its frontier
  model refined each change, as it did.
*/
export function fromWorkStyle(old: Partial<OldSettings> & Legacy): Partial<OldSettings> {
  const { workStyle, team: _team, setups = [], setup, route, ...rest } = old;
  const active = setups.find((x) => x.id === setup) ?? setups[0];
  const mode = workStyle === "lead" || (workStyle === "team" && active?.lead) ? "plan" : "solo";
  const routed = route?.cast ?? {};
  const staged = setups.find((x) => x.stages.length > 1 && x.stages.every((st) => st.who.startsWith("@")));
  const picks: OldPicks = routed.everyday || routed.strong || routed.judge ? { cheaper: routed.everyday, frontier: routed.strong, checker: routed.judge } : staged ? { cheaper: staged.stages[0].who.slice(1), frontier: staged.stages[staged.stages.length - 1].who.slice(1) } : {};
  const kept = Object.fromEntries(Object.entries(picks).filter(([, v]) => v)) as OldPicks;
  const refined = workStyle === "team" && staged && active?.id === staged.id && !active.lead;
  return { ...rest, mode, ...(Object.keys(kept).length ? { picks: kept } : {}), ...(refined ? { after: "refine" as const } : {}), route: route?.level ? { level: route.level } : undefined };
}

export class Store {
  readonly home: string;
  private state: State;
  private items = new Map<string, Item[]>();
  /** When each timeline in memory was last asked for, so the ones nobody has used in a while can go (letGoTimelines). */
  private usedAt = new Map<string, number>();
  /** Threads removed while this engine runs: a late write from a turn still winding down (sink.end) can't bring back their log. */
  private removed = new Set<string>();
  private listeners = new Set<Listener>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(home = process.env.LINER_HOME || join(homedir(), ".liner-code")) {
    this.home = home;
    mkdirSync(join(home, "threads"), { recursive: true });
    const file = join(home, "state.json");
    const saved = loadState<Omit<State, "settings"> & { settings: OldSettings & Legacy }>(file);
    // Before anything is moved to pairs, the state as it was is kept once beside it, for the owner to find.
    const pairsDue = Boolean(saved.settings && !saved.settings.pairVersion);
    // Settings from before modes had neither a mode nor pairs.
    const beforeModes = Boolean(pairsDue && saved.settings && !saved.settings.mode);
    const before = join(home, BEFORE_PAIRS);
    if (pairsDue && !existsSync(before)) {
      if (existsSync(file)) copyFileSync(file, before);
      else writeFileSync(before, JSON.stringify(saved, null, 2));
    }
    // A session saved as null (or anything else that isn't one) is no session: dropped here, before anything below reads it.
    const all: unknown[] = Array.isArray(saved.threads) ? saved.threads : [];
    const threads = all.filter((t): t is Thread => t !== null && typeof t === "object" && !Array.isArray(t));
    if (threads.length < all.length) console.error(`[store] ${all.length - threads.length} saved session(s) that weren't sessions left out`);
    this.state = {
      projects: saved.projects ?? [],
      threads,
      agents: saved.agents?.length ? saved.agents : defaultAgents(),
      // Read as it was saved; `toPairs` below moves what's from before pairs, and only then is it on pairs: a save before
      // that (the moves above it) mustn't mark it moved. A fresh install has nothing to move, so it's on pairs at once.
      settings: { ...defaultSettings, ...(!saved.settings ? { pairVersion: 1 } : beforeModes ? fromWorkStyle(saved.settings) : saved.settings) } as Settings,
      groups: saved.groups ?? [],
    };
    if (beforeModes) this.flush();
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
    // Plan and Auto became pairs, and After the Reviewer's switch.
    // One that fails as a whole leaves the state as it was and unmarked, to be tried again on the next start, rather than
    // keeping the engine from starting at all.
    if (pairsDue) {
      try {
        Object.assign(this.state, toPairs(this.state));
        this.flush();
      } catch (e) {
        console.error(`[store] the sessions didn't move to pairs (${e instanceof Error ? e.message : String(e)}); they'll be tried again on the next start`);
      }
    }
    // A thread that was working when the engine stopped is not working any more. One whose question
    // still asks stays in Needs you: it outlives the turn that asked (timeline()).
    for (const t of this.state.threads)
      if (t.status === "running" || t.status === "waiting") {
        const asking = t.status === "waiting" && this.timeline(t.id).some((x) => x.kind === "question" && x.state === "asking");
        t.status = asking ? "waiting" : "idle";
        t.unread = true;
        // A review it was in the middle of ended with it (its item settles as an error when read).
        if (t.verdict?.state === "checking") t.verdict = undefined;
      }
    // Its agents in the background went with the engine's tool process too (timeline() settles their rows).
    for (const t of this.state.threads) if (t.agentsAtWork) t.agentsAtWork = undefined;
    // What it was doing went with its turn: a line saved by chance alongside a later save is never read back.
    for (const t of this.state.threads) if (t.doing) t.doing = undefined;
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
  /** The model that stands in for an agent that's gone, until `repairAgents` points its sessions elsewhere: the quicker of your two, once tools are found. */
  standIn = "claude:claude-sonnet-5-5";

  /** An agent by id, or a bare model ("@claude:claude-opus-5-5"). One that's gone is the stand-in model, never another of your agents. */
  agent(id: string): AgentProfile {
    if (id.startsWith("@")) return modelAgent(id, id.slice(id.indexOf(":") + 1));
    return this.state.agents.find((a) => a.id === id) ?? modelAgent(`@${this.standIn}`, this.standIn.slice(this.standIn.indexOf(":") + 1));
  }

  /**
    Sessions that name an agent that's gone carry on with the model it ran on: from `models` (the
    agents you just removed), else its last turn in the session, else `fallback`. A project that
    started with it starts as usual.
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
      if (live(t.agent) && live(t.turnBy)) continue;
      const agent = live(t.agent) ? t.agent : `@${modelOf(t, t.agent) ?? fallback}`;
      // Moved in place, so the session keeps its spot in the sidebar.
      Object.assign(t, { agent, turnBy: live(t.turnBy) ? t.turnBy : agent });
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
  /** Each record as it's logged, for the anonymous daily count (usage-ping.ts). */
  counted?: (r: UsageRecord) => void;
  /** Every turn's tokens and cost, one line each, for the Usage page. */
  logUsage(r: UsageRecord) {
    appendFileSync(join(this.home, "usage.jsonl"), `${JSON.stringify(r)}\n`);
    this.counted?.(r);
    this.onUsage?.(r);
  }
  /** usage.jsonl as read so far: its records, and how far into the file they go. Only what was added since is read next time. */
  private usageRead: { bytes: number; records: UsageRecord[] } = { bytes: 0, records: [] };
  usage(from: number): UsageRecord[] {
    const file = join(this.home, "usage.jsonl");
    const size = statSync(file, { throwIfNoEntry: false })?.size;
    if (size === undefined) return (this.usageRead = { bytes: 0, records: [] }), [];
    // Shorter than what was read: it was replaced, so it's read again from the start.
    if (size < this.usageRead.bytes) this.usageRead = { bytes: 0, records: [] };
    if (size > this.usageRead.bytes) {
      const fd = openSync(file, "r");
      let text: string;
      try {
        const buf = Buffer.alloc(size - this.usageRead.bytes);
        text = buf.subarray(0, readSync(fd, buf, 0, buf.length, this.usageRead.bytes)).toString("utf8");
      } finally {
        closeSync(fd);
      }
      // Up to the last whole line: one still being written is read when it ends.
      const end = text.lastIndexOf("\n") + 1;
      for (const line of text.slice(0, end).split("\n")) {
        if (!line) continue;
        try {
          this.usageRead.records.push(JSON.parse(line) as UsageRecord);
        } catch {
          // a torn line
        }
      }
      this.usageRead.bytes += Buffer.byteLength(text.slice(0, end));
    }
    return this.usageRead.records.filter((r) => r.at >= from);
  }

  /** Forgets a thread and its timeline. */
  removeThread(id: string) {
    this.state.threads = this.state.threads.filter((t) => t.id !== id);
    this.items.delete(id);
    this.usedAt.delete(id);
    this.removed.add(id);
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
    // A security scan (and a question about a finding) only reads: whatever asks for more (a plan approved, a patch) leaves it at Read only.
    if ((t.security?.kind === "scan" || t.security?.kind === "ask") && t.access !== "read") t = { ...t, access: "read" };
    t.updatedAt = Date.now();
    this.removed.delete(t.id);
    // Only a running turn is doing anything: a session that stops, ends, fails or waits on you says so at once.
    if (t.doing && t.status !== "running") t = { ...t, doing: undefined };
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
  /**
    What a running session is doing now (Thread.doing), or nothing. It changes often, so it is cheap: sent to the app, but
    it neither moves the session in the sidebar (updatedAt) nor saves by itself, and it is dropped when the engine starts.
    Set only while the session runs; cleared whatever it is doing.
  */
  setDoing(id: string, doing: Thread["doing"]) {
    const i = this.state.threads.findIndex((x) => x.id === id);
    if (i < 0) return;
    const t = this.state.threads[i];
    if (doing && t.status !== "running") return;
    if (t.doing?.text === doing?.text) return;
    const next: Thread = { ...t, doing };
    if (!doing) delete next.doing;
    this.state.threads[i] = next;
    this.emit({ type: "thread", thread: next });
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
    if (cached) {
      this.usedAt.set(threadId, Date.now());
      return cached;
    }
    // Removed: nothing to read, and nothing kept for it.
    if (this.removed.has(threadId)) return [];
    this.usedAt.set(threadId, Date.now());
    const file = this.logFile(threadId);
    const order: string[] = [];
    const byId = new Map<string, Item>();
    let lines = 0;
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      // A line a crash cut short: what's written next starts on a line of its own, or it goes with it.
      if (text && !text.endsWith("\n")) appendFileSync(file, "\n");
      for (const line of text.split("\n")) {
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
    // answer goes as your next message (Runtime.answerQuestion). A plan or a step to allow has nobody
    // to answer to any more: its turn waited on it, a planner's plan from before pairs included.
    for (const it of list) {
      if ((it.kind === "text" || it.kind === "reasoning") && it.streaming) it.streaming = false;
      if (it.kind === "tool" && it.status === "running") it.status = "failed";
      // An agent still at work in the background went with the engine's tool process.
      if (it.kind === "tool" && it.agent?.state === "running") it.agent = { ...it.agent, state: "stopped", now: undefined };
      if (it.kind === "approval" && it.state === "asking") it.state = "expired";
      if (it.kind === "proposal" && it.state === "asking") it.state = "expired";
      if (it.kind === "turn" && it.status === "running") it.status = "stopped";
      if (it.kind === "review" && it.status === "running") it.status = "error";
    }
    this.items.set(threadId, list);
    // Rewrite the log once it holds many more lines than items.
    if (lines > list.length * 3 + 50) this.rewrite(threadId);
    return list;
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

  /**
    Lets go of timelines in memory past the newest TIMELINES_KEPT, each unused for TIMELINE_IDLE_MS, that `busy` doesn't hold (a
    turn, a hold, a test run: Runtime's) and that hold nothing the log doesn't (nothing streaming, running or asking), so reading
    one again gives the same items. Called from a timer only, never in the middle of a call that holds a list. How many went.
  */
  letGoTimelines(busy: (threadId: string) => boolean, now = Date.now()) {
    let over = this.items.size - TIMELINES_KEPT;
    if (over <= 0) return 0;
    const live = (x: Item) => ((x.kind === "text" || x.kind === "reasoning") && x.streaming) || (x.kind === "tool" && (x.status === "running" || x.agent?.state === "running")) || ((x.kind === "approval" || x.kind === "proposal" || x.kind === "question") && x.state === "asking") || ((x.kind === "turn" || x.kind === "review") && x.status === "running");
    const idle = [...this.items.keys()].map((id) => [id, this.usedAt.get(id) ?? 0] as const).filter(([, at]) => now - at >= TIMELINE_IDLE_MS).sort((a, b) => a[1] - b[1]);
    let gone = 0;
    for (const [id] of idle) {
      if (over <= 0) break;
      const t = this.state.threads.find((x) => x.id === id);
      if (busy(id) || t?.status === "running" || t?.status === "waiting" || this.items.get(id)!.some(live)) continue;
      this.items.delete(id);
      this.usedAt.delete(id);
      over--;
      gone++;
    }
    return gone;
  }

  /** Adds or replaces an item, tells the app, and logs it unless it is still streaming. Nothing, for a thread removed meanwhile. */
  putItem(threadId: string, item: Item, log = true) {
    if (this.removed.has(threadId)) return item;
    const list = this.timeline(threadId);
    // From the end: the item that changes is nearly always one of the latest.
    const i = list.findLastIndex((x) => x.id === item.id);
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
    if (this.removed.has(threadId)) return;
    const it = this.timeline(threadId).findLast((x) => x.id === itemId);
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
    // Written plain, not indented: it is rewritten whole as sessions change, and indenting made it about 40% larger.
    writeAtomic(join(this.home, "state.json"), JSON.stringify(this.state), { backup: true });
  }
}

let n = 0;
/** Short, sortable ids: time first, then a counter and a little noise. */
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(n++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
