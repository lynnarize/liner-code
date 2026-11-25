/*
  Universal Swarm & Teamwork: a Liner-native multi-agent board and hibernating worker pool that
  works across every CLI and API provider Liner Code drives, with no dependency on any one tool's
  own swarm. Pure types and helpers shared by the engine and the app.
*/
import type { FileChange } from "./index.ts";

/** Live lifecycle of a swarm member. Hibernated and queued members hold zero CLI processes in RAM. */
export type SwarmMemberState = "queued" | "working" | "waiting" | "hibernated" | "skipped" | "stopped" | "killed";
/** Orchestration topology: `teamwork` (2-level hierarchy tree) vs `swarm` (peer-to-peer shared board). */
export type SwarmMode = "teamwork" | "swarm";
/** Where a worker runs: `inherit` shares the session folder (read-only by default); `share` gets a git worktree. */
export type SwarmWorkspace = "inherit" | "share";
/** Built-in team layouts offered when starting Teamwork. */
export type SwarmPreset = "squad" | "audit" | "custom";

/** Stored on a thread when Teamwork / Swarm is enabled for that session. */
export type SwarmConfig = {
  enabled: boolean;
  /** Orchestration behavior: `teamwork` (hierarchical tree) or `swarm` (peer-to-peer shared message board). */
  mode?: SwarmMode;
  preset?: SwarmPreset;
  title?: string;
  /** Maximum active CLI worker processes at once (1..4, overrides Settings.swarmMaxActive). */
  maxActive?: number;
  /** Seconds a parked worker stays warm before its process closes to 0 MB RAM (overrides Settings.swarmHibernateSec). */
  hibernateSec?: number;
  /** Deterministic engine stall monitor (0 RAM, 0 tokens). Defaults to Settings.swarmStallMonitor (true). */
  stallMonitor?: boolean;
};

/** Screenshot flagged by a worker in a board post (`Screenshot: <path> | <caption>`) for the Swarm Overview timeline. */
export type SwarmScreenshot = {
  path: string;
  caption: string;
};

/** Goal and outcome-thread overview (compact, shown in the Agents surface Overview). */
export type SwarmPlan = {
  goal: { title: string; line: string };
  tasks: Record<string, string>;
  threads: { id: string; title: string; goal: string; tasks: string[] }[];
};

/** One member on the swarm roster (coordinator or named worker). */
export type SwarmMember = {
  name: string;
  role: string;
  /** Roster name of who spawned this member ("coordinator" or an orchestrator name), forming the nested Teamwork tree. */
  parent?: string;
  /** True for mid-level managers (such as Project Orchestrator) that may spawn leaf specialists under themselves (max depth 2). */
  canDelegate?: boolean;
  /** Timeline `Item` id of this member's native `task` row so Fanout and AgentsSurface render the live hierarchy. */
  itemId?: string;
  /** Model ref as `<provider>:<model>` (may differ across members for cross-provider teams). */
  model: string;
  state: SwarmMemberState;
  workspace: SwarmWorkspace;
  /** Read-only workers cannot edit files; write workers use `share` worktrees (or serialize on `inherit`). */
  mode: "read" | "write";
  branch?: string;
  worktreePath?: string;
  portOffset?: number;
  channels: string[];
  brief: string;
  now?: string;
  lastReadSeq: number;
  lastPostSeq?: number;
  lastPostAt?: number;
  startedAt?: number;
  hibernatedAt?: number;
  tokens: number;
  costUsd: number;
  /** Best-effort resident memory of this worker's active process in MB (0 when hibernated or queued). */
  rssMb?: number;
  /** Measured file changes in this worker's worktree. */
  files?: FileChange[];
  /** True once this worker's worktree branch has been merged into the session checkout. */
  landed?: boolean;
  /** The auditor: a reader by mode that runs on the session's own model and effort whatever the reader settings say. */
  audit?: boolean;
  /** For the auditor: the worker whose work it checks, named in add or taken when the team had only one unlanded worktree. It runs in that worker's worktree while it is on disk and not landed. */
  auditOf?: string;
  /** The effort level this worker runs at, among its own model's levels ("" or unset: none given, the tool's own). */
  effort?: string;
};

/** One append-only post on the swarm message board (`board.jsonl`). */
export type SwarmPost = {
  seq: number;
  at: number;
  from: string;
  to: string[];
  channel: string;
  kind: "brief" | "post" | "stall" | "system" | "user";
  text: string;
  /** True when the engine published a worker's final answer because it ended its turn without calling swarm_post. */
  autoPosted?: boolean;
  files?: FileChange[];
  /** Screenshots flagged via `Screenshot: <path> | <caption>` lines in this post. */
  screenshots?: SwarmScreenshot[];
};

/** Full view of a thread's swarm, fetched by `swarm.get` and updated live over SSE (`swarm.changed`). */
export type SwarmSnapshot = {
  threadId: string;
  mode: SwarmMode;
  title?: string;
  active: boolean;
  maxActive: number;
  hibernateSec: number;
  stallMonitor: boolean;
  plan?: SwarmPlan;
  members: SwarmMember[];
  posts: SwarmPost[];
  activeSlots: number;
  queuedCount: number;
  hibernatedCount: number;
  rssMb: number;
  /** Set while the team waits for the person: it hit the limit of turns it starts by itself, or Liner Code restarted mid-work. */
  paused?: SwarmPause;
  updatedAt: number;
};

/** Why a swarm waits for the person (the turn limit, a restart, or their own Stop), since when, and (for the limit) after how many turns it started by itself. */
export type SwarmPause = { reason: "limit" | "restart" | "stopped"; at: number; turns?: number };

/** Turns a swarm may start by itself (worker turns and coordinator wakes) before it pauses for the person; anything the person does starts the count again. */
export const SWARM_SELF_TURNS_MAX = 40;
/** Live workers one swarm may hold at once (the coordinator, killed and skipped members don't count). */
export const SWARM_ROSTER_MAX = 12;
/** A parked worker whose last turn ended longer ago than this (10 minutes) has a cold prompt cache, so a long session of it starts fresh. */
export const SWARM_FRESH_AFTER_MS = 10 * 60_000;
/** The context size its tool last reported (100,000 tokens) at or above which a cold wake starts a worker fresh from its notes. */
export const SWARM_FRESH_ABOVE_CONTEXT = 100_000;

/** Bounds for concurrent active swarm worker processes (light on RAM by default: 2). */
export const SWARM_MAX_DEFAULT = 2;
export const SWARM_MAX_MIN = 1;
export const SWARM_MAX_LIMIT = 4;
export const clampSwarmMax = (n?: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(SWARM_MAX_MIN, Math.min(SWARM_MAX_LIMIT, Math.round(n))) : SWARM_MAX_DEFAULT);

/** Bounds for parked worker hibernation delay in seconds (0 = immediate, default 30s, max 300s). */
export const SWARM_HIBERNATE_DEFAULT = 30;
export const clampSwarmHibernate = (n?: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(300, Math.round(n))) : SWARM_HIBERNATE_DEFAULT);

/** Whether a thread runs in Swarm (Teamwork) mode. Side chats never run a swarm. */
export const isSwarm = (t: { swarm?: SwarmConfig; sideOf?: string }) => Boolean(t.swarm?.enabled && !t.sideOf);

const RESERVED_NAMES = new Set(["all", "coordinator", "you", "user", "monitor", "system", "engine"]);
/** Valid roster worker name: lowercase, starts with a letter or digit, up to 24 chars of a-z, 0-9, - and _. */
export function validWorkerName(raw: string): string | null {
  const name = raw.trim().toLowerCase().replace(/^@+/, "");
  if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(name)) return null;
  if (RESERVED_NAMES.has(name) || name.startsWith("coordinator-")) return null;
  return name;
}

/** Extracts normalized `@mention` targets from post text (excluding emails like `a@b.com`). */
export function parseMentions(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /(?:^|[\s([{"'`])@([a-z0-9][a-z0-9_-]{0,23})\b/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}

/** Extracts `Screenshot: <path> | <caption>` entries flagged by workers for the Swarm visual timeline. */
export function parseScreenshots(text: string): SwarmScreenshot[] {
  const out: SwarmScreenshot[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*Screenshot:\s*([^|]+?)\s*\|\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const path = m[1].trim();
    const caption = m[2].trim().slice(0, 120);
    if (path && caption) out.push({ path, caption });
  }
  return out;
}
