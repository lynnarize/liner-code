/*
  What the Session card (SessionInfo.tsx) says in its rows, kept apart from React so engine/test/session-pop.test.ts
  can read it (no React and no alias imports): how many agents worked in the session and for how long, and the Spend limit's value.
*/
import type { Item } from "../../../contracts/src/index.ts";

/**
  The agents sent in this session (every "task" row: Claude Code's Agent tool, a sidekick's brief, a subagent), and the
  time they worked together, each one's own seconds added up (a running one's clock to `now`). Nothing when none was sent.
*/
export function agentsWorked(items: Item[], now = Date.now()) {
  let count = 0;
  let seconds = 0;
  for (const it of items) {
    if (it.kind !== "tool" || it.toolKind !== "task") continue;
    count++;
    seconds += it.status === "running" ? Math.max(0, (now - it.at) / 1000) : (it.seconds ?? 0);
  }
  return { count, seconds };
}

/** The Spend limit row's value: "None", or the limit with how much of it is used ("$5.00, 40% used"). */
export function spendWords(limit: number | undefined, spent: number) {
  if (!limit || limit <= 0) return "None";
  const cap = limit >= 100 ? `$${limit.toFixed(0)}` : `$${limit.toFixed(2)}`;
  return spent > 0 ? `${cap}, ${Math.min(999, Math.round((spent / limit) * 100))}% used` : cap;
}

/**
  What "Add $5" sets the limit to: five more than the limit, or than what is already spent when that is more (no limit
  yet, or one it went past), so the press never sets a limit the session is already over.
*/
export const addFive = (limit: number | undefined, spent: number) => Number((Math.max(limit ?? 0, spent) + 5).toFixed(2));
