/*
  The agents section of the session details card (Env.tsx DetailsCard), as plain code so engine/test/pinned-card.test.ts
  runs it (no React, no alias imports): whether a session has agents at all, which rows of their tree show, which start
  folded, and the cap of eight. The tree itself comes from the models the app already builds: Crew.tsx crewOf (through
  crewRows) for a message's crew, as the Agents surface's "Who's on it" draws it, and chat-cards.ts teamTree for a Swarm or
  a Teamwork, as the agents popup and the team's card draw it. Who is whose child is never worked out a second time here.
*/
import type { SwarmMember } from "../../../contracts/src/swarm.ts";
import { teamTree, type TeamNode } from "./chat-cards.ts";

/** How an agent stands, as its row's mark: working (the moving 3x3), done (a green tick), waits on you (amber), failed (red), idle (a quiet ring). */
export type RowState = "working" | "done" | "waits" | "failed" | "idle";
/**
  One agent of the tree: `key` is unique in the session; `item` the timeline item its own view opens (the Agents surface's
  agent view), none for a model's part or a team member with no row of its own; `now` what it is doing, when known.
*/
export type AgentRow = { key: string; name: string; role?: string; state: RowState; now?: string; item?: string; kids: AgentRow[] };

/**
  Whether the session works with agents now or did: Fusion (a sidekick), a Swarm or Teamwork on for it, agents at work
  (what the line under the message box counts), or agents its tool sent at any time (what the Session surface counts).
  A session that works alone has none, and the card and the Session surface draw nothing of agents for it.
*/
export function hasAgents(s: { sidekick?: unknown; swarm?: boolean; atWork?: number; worked?: number }) {
  return Boolean(s.sidekick) || Boolean(s.swarm) || (s.atWork ?? 0) > 0 || (s.worked ?? 0) > 0;
}

/** Every agent under a row, at any depth. */
export const countUnder = (n: AgentRow): number => n.kids.reduce((sum, k) => sum + 1 + countUnder(k), 0);
/** At work or waiting on you, it or anyone under it. */
const busy = (n: AgentRow): boolean => n.state === "working" || n.state === "waits" || n.kids.some(busy);
/** A parent starts open while a child of it works or waits on you, and folded once they have all finished. */
export const startsOpen = (n: AgentRow) => n.kids.some(busy);

/** Folding you chose, per session and row, while the app is open. */
const folds = new Map<string, Map<string, boolean>>();
export function foldOf(threadId: string, n: AgentRow) {
  return folds.get(threadId)?.get(n.key) ?? startsOpen(n);
}
export function setFold(threadId: string, key: string, open: boolean) {
  const mine = folds.get(threadId) ?? new Map<string, boolean>();
  mine.set(key, open);
  folds.set(threadId, mine);
}

/** The rows the card shows at most; past that the last is "N more", which opens the Agents surface. */
export const ROWS_MAX = 8;
/** Levels drawn: deeper agents fold into their parent's count. */
export const DEPTH_MAX = 3;

export type ShownRow = { node: AgentRow; depth: number; count: number; open: boolean; folds: boolean };

/**
  The rows that show, in order, with each one's depth, the count it holds, whether it is open, and whether it can fold
  (it has children within the levels drawn). `isOpen` is foldOf for the session. At most ROWS_MAX rows: past that,
  ROWS_MAX - 1 rows and `more`, how many rows the rest would have taken.
*/
export function shownRows(roots: readonly AgentRow[], isOpen: (n: AgentRow) => boolean): { rows: ShownRow[]; more: number } {
  const all: ShownRow[] = [];
  const walk = (nodes: readonly AgentRow[], depth: number) => {
    for (const node of nodes) {
      const folds = node.kids.length > 0 && depth < DEPTH_MAX - 1;
      const open = folds && isOpen(node);
      all.push({ node, depth, count: countUnder(node), open, folds });
      if (open) walk(node.kids, depth + 1);
    }
  };
  walk(roots, 0);
  if (all.length <= ROWS_MAX) return { rows: all, more: 0 };
  return { rows: all.slice(0, ROWS_MAX - 1), more: all.length - (ROWS_MAX - 1) };
}

/** A Swarm member's state as its row's mark: the team paused for you is the coordinator waiting on you. */
export function memberRow(m: SwarmMember, paused: boolean): RowState {
  if (m.name === "coordinator" && paused) return "waits";
  if (m.state === "working") return "working";
  if (m.state === "stopped") return m.now && /^Could not start/.test(m.now) ? "failed" : "done";
  return "idle";
}

/**
  A Swarm or a Teamwork as rows: the coordinator, the team under it as teamTree nests it (those that ended after the ones
  still on it, on each level). Peers go by @name with their part in grey; a team's agents by their part, as the surface says them.
*/
export function swarmRows(members: SwarmMember[], swarmMode: boolean, paused: boolean): AgentRow[] {
  const row = (m: SwarmMember, kids: AgentRow[] = []): AgentRow => ({ key: `swarm:${m.name}`, name: m.name === "coordinator" ? "Coordinator" : swarmMode ? `@${m.name}` : m.role || `@${m.name}`, role: m.name === "coordinator" ? (swarmMode ? "Swarm" : "Teamwork") : swarmMode ? m.role || undefined : undefined, state: memberRow(m, paused), now: m.state === "working" ? m.now : undefined, item: m.itemId, kids });
  const level = (l: { kids: TeamNode<SwarmMember>[]; finished: SwarmMember[] }): AgentRow[] => [...l.kids.map((n) => row(n.m, level(n))), ...l.finished.map((m) => row(m))];
  const team = level(teamTree(members));
  const coordinator = members.find((m) => m.name === "coordinator" && m.state !== "killed");
  return coordinator ? [row(coordinator, team)] : team;
}
