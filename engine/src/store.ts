/*
  The engine's memory. Projects, agents, threads and settings live in one state.json; each
  thread's timeline is an append-only log (threads/<id>.jsonl) of item snapshots, the newest
  line for an id winning. Writes are small and atomic, and on disk before they count; a crash
  loses at most the text that was still streaming.
*/
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { AgentProfile, EngineEvent, Item, Project, Settings, SidebarGroup, Thread, UsageRecord } from "../../contracts/src/index.ts";
import { defaultAgents, modelAgent } from "./agents.ts";

type State = { projects: Project[]; threads: Thread[]; agents: AgentProfile[]; settings: Settings; groups: SidebarGroup[] };
type Listener = (e: EngineEvent) => void;

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
  renameSync(tmp, file);
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
function loadState(file: string): Partial<State> {
  if (!existsSync(file)) return existsSync(`${file}.bak`) ? loadState(`${file}.bak`) : {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Partial<State>;
  } catch (e) {
    console.error(`[store] ${file} didn't read (${e instanceof Error ? e.message : String(e)}); moved aside as ${file}.broken`);
    renameSync(file, `${file}.broken`);
    return file.endsWith(".bak") ? {} : loadState(file);
  }
}

export const defaultSettings: Settings = { onboarded: false, workStyle: "model", claudeBilling: "plan", settleDays: 0, notify: true, guardDestructive: true, defaultAccess: "ask", worktrees: false, branchPrefix: "liner/", badge: true, budgetUsd: 0, settleOnMerge: false, settleOnRoutine: false, settleVersion: 2 };

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
      settings: { ...defaultSettings, ...saved.settings },
      groups: saved.groups ?? [],
    };
    // Settling became yours to do: the rules that used to be on by default are switched off once.
    if (saved.settings && (saved.settings.settleVersion ?? 1) < 2) {
      this.state.settings = { ...this.state.settings, settleDays: 0, settleOnMerge: false, settleOnRoutine: false, settleVersion: 2 };
      this.flush();
    }
    // A thread that was working when the engine stopped is not working any more; it stays in
    // Needs you, so a question it was asking isn't lost when it settles.
    for (const t of this.state.threads)
      if (t.status === "running" || t.status === "waiting") {
        t.status = "idle";
        t.unread = true;
      }
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: EngineEvent) {
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
  /** An agent by id, or a bare model ("@claude:claude-opus-5-5"). */
  agent(id: string): AgentProfile {
    if (id.startsWith("@")) return modelAgent(id, id.slice(id.indexOf(":") + 1));
    return this.state.agents.find((a) => a.id === id) ?? this.state.agents[0];
  }

  /** Every turn's tokens and cost, one line each, for the Usage page. */
  logUsage(r: UsageRecord) {
    appendFileSync(join(this.home, "usage.jsonl"), `${JSON.stringify(r)}\n`);
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
    // Anything left mid-stream or mid-question by a stopped engine is settled.
    for (const it of list) {
      if ((it.kind === "text" || it.kind === "reasoning") && it.streaming) it.streaming = false;
      if (it.kind === "tool" && it.status === "running") it.status = "failed";
      if (it.kind === "approval" && it.state === "asking") it.state = "expired";
      if ((it.kind === "question" || it.kind === "proposal") && it.state === "asking") it.state = "expired";
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
