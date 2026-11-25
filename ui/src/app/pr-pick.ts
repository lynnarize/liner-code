/*
  The Pull request surface's picker, "#N ⌄" in its head (board PullRequest, SPEC "Where each surface's controls
  go", 2026-11-25): this session's pull request on top, then the project's others, which is what the Linked pull
  requests surface listed before it went. What each one is called, how they are grouped and found, and which of
  its actions a picked one offers live here, apart from Pr.tsx, so they can be tried without a window.

  The Linked key, ⌘K's row for it, and a layout kept from before all open Pull request with this picker open:
  askPicker asks, and the surface takes the ask when it shows (takePicker), even when it mounts only after.
*/
import type { PrInfo } from "../../../contracts/src/index.ts";

/** How a pull request stands, in the head's word and the picker row's end: one word or two, and its tone. */
export function prWord(p: Pick<PrInfo, "state" | "isDraft" | "mergeable" | "checks" | "reviewDecision">): { word: string; tone?: "ok" | "warn" | "danger" } {
  if (p.state === "MERGED") return { word: "Merged" };
  if (p.state === "CLOSED") return { word: "Closed" };
  if (p.mergeable === "CONFLICTING") return { word: "Conflicts", tone: "warn" };
  if (p.checks.some((c) => c.state === "fail")) return { word: "A check failed", tone: "danger" };
  if (p.isDraft) return { word: "Draft" };
  if (p.checks.some((c) => c.state === "pending")) return { word: "Checks running" };
  if (p.reviewDecision === "CHANGES_REQUESTED") return { word: "Changes asked for", tone: "warn" };
  return { word: "Open", tone: "ok" };
}

/** Whether a pull request is this session's: opened from it, or the one its thread remembers. */
export const isMine = (p: Pick<PrInfo, "number" | "threadId">, thread: { id: string; pr?: { number: number } }) => p.threadId === thread.id || p.number === thread.pr?.number;

/**
  The picker's lists: this session's pull request, then the others in the project, open ones first and the
  newest of each first, each narrowed by what you typed in its find field (the number, with or without its #, or
  words of the title or branch). `open` counts the others still open, for the label's note.
*/
export function pickerLists(prs: PrInfo[], thread: { id: string; pr?: { number: number } }, find = "") {
  const q = find.trim().toLowerCase().replace(/^#/, "");
  const hit = (p: PrInfo) => !q || String(p.number).startsWith(q) || p.title.toLowerCase().includes(q) || p.head.toLowerCase().includes(q);
  const mine = prs.find((p) => isMine(p, thread));
  const others = prs.filter((p) => p !== mine).sort((a, b) => Number(b.state === "OPEN") - Number(a.state === "OPEN") || b.number - a.number);
  return { mine: mine && hit(mine) ? mine : undefined, others: others.filter(hit), open: others.filter((p) => p.state === "OPEN").length };
}

export type PrAction = "session" | "resolve" | "merge";
/**
  What a picked pull request of the project lets you do in the foot, in the order it shows them: open the
  session it came from (another session's), ask for its conflicts to be resolved, merge it once it is ready. The
  last is the ink one. Open on GitHub is the head's tool for every pull request. These are the Linked surface's
  buttons, kept.
*/
export function prActions(p: PrInfo, thread: { id: string }): PrAction[] {
  const conflict = p.mergeable === "CONFLICTING";
  const failed = p.checks.some((c) => c.state === "fail");
  const pending = p.checks.some((c) => c.state === "pending");
  const ready = p.state === "OPEN" && !p.isDraft && !conflict && !failed && !pending;
  const out: PrAction[] = [];
  if (p.threadId && p.threadId !== thread.id) out.push("session");
  if (conflict && p.state === "OPEN") out.push("resolve");
  if (ready) out.push("merge");
  return out;
}

/* ---------- Opening the surface with its picker open ---------- */

const asked = new Set<string>();
const takers = new Map<string, () => void>();
/** The Linked key, ⌘K or a kept layout: the session's Pull request surface opens its picker, now or when it next shows. */
export function askPicker(threadId: string) {
  const take = takers.get(threadId);
  if (take) take();
  else asked.add(threadId);
}
/** The surface, as it shows: whether the picker was asked for while it wasn't there. Asked once, taken once. */
export const takePicker = (threadId: string) => asked.delete(threadId);
/** The surface listens while it is mounted, so an ask while it shows opens the picker at once. */
export function onPicker(threadId: string, open: () => void) {
  takers.set(threadId, open);
  return () => {
    if (takers.get(threadId) === open) takers.delete(threadId);
  };
}
