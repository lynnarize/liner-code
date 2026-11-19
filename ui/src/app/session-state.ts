/*
  How a session stands, read from the session alone: where it sits in the sidebar, whether it needs you, and the mark its row
  shows. One place for every face (Code's sidebar and Wall, Liner Design's rows, Liner Security's, the Dock and the menu bar), so
  they can't disagree. No React and no alias imports here, so plain Node can test it (engine/test/session-state.test.ts).
*/
import type { Thread } from "../../../contracts/src/index.ts";

export type Bucket = "pinned" | "needs" | "working" | "open" | "snoozed" | "settled";

/** The Reviewer blocked its change, and its agent asked nothing: it reads as finished, with a blue dot until you open it. */
export const reviewHeld = (t: Thread) => t.status === "waiting" && t.held === "review";

/**
  Where a session sits: Needs you and Working follow the agents; Pinned, Snoozed and Settled are
  yours. A session that needs nothing more from you stays open in its project until you settle
  it (or a rule you turned on does); new work there brings it back.
*/
export function bucketOf(t: Thread, now = Date.now()): Bucket {
  if (t.snoozedUntil && t.snoozedUntil > now) return "snoozed";
  if (t.done) return "settled";
  if (t.pinned) return "pinned";
  if (t.status === "running") return "working";
  // Files changed and not committed don't wait on you: committing is yours to do or not (T3 Code
  // marks only what asks, fails or hasn't been seen, too).
  const needs = (t.status === "waiting" && !reviewHeld(t)) || t.status === "error" || t.status === "limited" || t.unread || t.turns === 0;
  // Agents it sent still at work in the background: it works, though its turn has ended.
  return needs ? "needs" : t.agentsAtWork ? "working" : "open";
}

/**
  Waits on you, wherever you keep it: a pinned session or one in your groups as well, the way the
  Dock's count takes it (App). Snoozed and settled ones are put away, so they don't.
*/
export const waitsOnYou = (t: Thread, now = Date.now()) => bucketOf(t.pinned ? { ...t, pinned: false } : t, now) === "needs";
/** Asks you something: it waits on your answer, ran into a problem, or hit its plan's limit. A Reviewer block isn't asking (reviewHeld). */
export const asksYou = (t: Thread) => (t.status === "waiting" && !reviewHeld(t)) || t.status === "error" || t.status === "limited";
/**
  Needs you, the same everywhere: the sidebar's Needs you and its top pill, the Dock's count, the menu
  bar item and Next session that needs you. It asks you something, or it finished and you haven't
  read it. Not one that hasn't started, nor one put away (archived, snoozed, settled); a pinned one or
  one in your groups does. One answered while you were away whose agents still work is working until they're done.
*/
export const needsYou = (t: Thread, now = Date.now()) => !t.archived && t.turns > 0 && waitsOnYou(t, now) && (asksYou(t) || !t.agentsAtWork);

/** How a row stands, as its mark shows it. */
export type SideState = "working" | "needs" | "limited" | "error" | "done" | "new";

export type WallKind = "needs" | "working" | "done";

/** Where a session stands on the Wall, from the session alone: the order and the counts need no timelines. One whose turn is over while agents it sent still work is working, not done. */
export const wallKind = (t: Thread): WallKind => (t.status === "running" ? "working" : (t.status === "waiting" && !reviewHeld(t)) || t.status === "error" || t.status === "limited" ? "needs" : t.agentsAtWork ? "working" : "done");

/** The mark a session's row shows. `busy`: it works now (its turn runs, or agents it sent still do). A session not started yet is "new". */
export const sideStateOf = (t: Thread, busy = t.status === "running"): SideState =>
  busy ? "working" : t.status === "error" ? "error" : t.status === "limited" ? "limited" : reviewHeld(t) ? "done" : t.status === "waiting" ? "needs" : t.turns === 0 ? "new" : "done";
