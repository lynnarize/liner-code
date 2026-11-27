/*
  How a session stands, read from the session alone: where it sits in the sidebar, whether it needs you, and the mark its row
  shows. One place for every face (Code's sidebar and Wall, Liner Design's rows, Liner Security's, the Dock and the menu bar), so
  they can't disagree. No React and no alias imports here, so plain Node can test it (engine/test/session-state.test.ts).
*/
import type { Thread } from "../../../contracts/src/index.ts";

export type Bucket = "pinned" | "needs" | "working" | "open" | "snoozed" | "settled";

/** The Reviewer blocked its change, and its agent asked nothing: it reads as finished, its mark fresh until you open it. */
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
/**
  A question you have seen and left open: it waits on your answer, and you have opened the session since it began to (the
  engine marks a session unread as it starts waiting, and opening it clears that). Grey once seen (the owner's ruling): its
  amber goes, its row says what it waits for in plain grey, and it draws no mark at all (markStateOf's "seen"), never the done
  tick, since it still waits. It still Needs you (needsYou), and it is no longer news (newsForYou). A problem or a plan's limit
  isn't a question: those keep their colour.
  `looking`: it is the open session in a focused window. It is being looked at, so it is seen already, though the engine's
  unread mark (set as it starts waiting) is still on its way to being cleared; without this its row would flash amber.
*/
export const seenAsk = (t: Thread, looking = false) => t.status === "waiting" && !reviewHeld(t) && (!t.unread || looking);
/**
  Needs you and is news to you: what the lists' folded folders and the top row's pill count in amber. The session you are
  looking at (`looking`, as seenAsk) is news only for what looking doesn't clear: a problem, or its plan's limit.
*/
export const newsForYou = (t: Thread, now = Date.now(), looking = false) => needsYou(t, now) && (looking ? t.status === "error" || t.status === "limited" : !seenAsk(t));

/** How a row stands, as its mark shows it. */
export type SideState = "working" | "needs" | "limited" | "error" | "done" | "new";

export type WallKind = "needs" | "working" | "done";

/** Works now, as By status, a folder and the top pill count it: its turn runs, or agents it sent still work and it asks you nothing. */
export const worksNow = (t: Thread) => t.status === "running" || (!asksYou(t) && Boolean(t.agentsAtWork));
/**
  Which of By status's three a session sits under: Needs you (needsYou: it asks you something, or finished and you haven't
  read it), else Working (worksNow), else Finished. The sidebar's groups and The Wall's filter and its counts all take this,
  so the same sessions are counted the same in both. A tile's own buttons still follow wallKind.
*/
export const statusKind = (t: Thread, now = Date.now()): WallKind => (needsYou(t, now) ? "needs" : worksNow(t) ? "working" : "done");

/** Where a session stands on the Wall, from the session alone: the order and the counts need no timelines. One whose turn is over while agents it sent still work is working, not done. */
export const wallKind = (t: Thread): WallKind => (t.status === "running" ? "working" : (t.status === "waiting" && !reviewHeld(t)) || t.status === "error" || t.status === "limited" ? "needs" : t.agentsAtWork ? "working" : "done");
/** Sessions waiting for review, the Wall's Review queue: Reviewer-blocked, finished with unreviewed files, or with an open pull request (gh says "OPEN", as markStateOf reads it). */
export const needsReview = (t: Thread) => !t.archived && !t.routine && !t.security && !t.done && (reviewHeld(t) || (t.toReview ?? 0) > 0 || t.pr?.state.toUpperCase() === "OPEN");

/** The mark a session's row shows. `busy`: it works now (its turn runs, or agents it sent still do). A session not started yet is "new". */
export const sideStateOf = (t: Thread, busy = t.status === "running"): SideState =>
  busy ? "working" : t.status === "error" ? "error" : t.status === "limited" ? "limited" : reviewHeld(t) ? "done" : t.status === "waiting" ? "needs" : t.turns === 0 ? "new" : "done";

/**
  The state mark's states (icons.tsx StateMark): the one mark for how a session, turn, agent, step, scan, design, add-on build or
  pull request stands, wherever that is shown. Needs is a session that waits on you and you haven't opened since it began to;
  seen is one that still waits and you have seen, which draws nothing (StateMark), named "Waits for your answer"; fresh is
  finished and not opened yet; done is finished and seen, and never a session that still waits; pr, checks, ready and merged
  are its pull request's.
*/
export type MarkState = "working" | "needs" | "seen" | "fresh" | "done" | "new" | "pr" | "checks" | "ready" | "merged" | "problem" | "limit";

/** A row's state as the mark draws it. */
export const MARK_OF: Record<SideState, MarkState> = { working: "working", needs: "needs", limited: "limit", error: "problem", done: "done", new: "new" };

/** How a pull request's checks stand: the session carries it (Thread.pr.checks) as of the app's last read of the pull request. */
export type ChecksState = "running" | "passed" | "failed";

/**
  The mark a session shows, from the session alone. `busy` and `looking` as sideStateOf and seenAsk take them; `checks` is its pull
  request's checks, the session's own (Thread.pr.checks) unless the caller knows better. What asks something of you comes first:
  amber until you have seen it, then "seen", which draws nothing (never done's tick: it still waits); then news you haven't
  opened, then where its pull request stands; a closed one says nothing, so the session reads as finished.
*/
export function markStateOf(t: Thread, o: { busy?: boolean; looking?: boolean; checks?: ChecksState } = {}): MarkState {
  const side = sideStateOf(t, o.busy ?? t.status === "running");
  if (side === "needs") return seenAsk(t, o.looking) ? "seen" : "needs";
  if (side !== "done" && side !== "new") return MARK_OF[side];
  if (t.unread && !o.looking) return "fresh";
  const pr = t.pr?.state.toUpperCase();
  const checks = o.checks ?? t.pr?.checks?.state;
  if (pr === "MERGED") return "merged";
  if (pr === "OPEN") return checks === "running" ? "checks" : checks === "failed" ? "problem" : checks === "passed" ? "ready" : "pr";
  return side;
}

/** The mark's words for a screen reader where MARK_WORD's would mislead: a pull request whose checks failed is a problem, but not one the agent ran into. */
export const markLabelOf = (t: Thread, mark: MarkState) => (mark === "problem" && t.status !== "error" && t.pr?.checks?.state === "failed" ? "Checks failed" : undefined);

/** What a session waits on you for, in its own words (Thread.asking, set by the engine), or the plain words for a session saved before it. */
export const askWords = (t: Thread) => t.asking?.text || "Waits for your answer";

/** How a row colours its pull request's number: green open or ready, purple merged, red when its checks failed, grey while they run or once it's closed. */
export type PrTone = "open" | "merged" | "bad" | "checks" | "closed";
/** A session's pull request as its row says it: the words for its second line, their tone, and its number's colour. */
export function prSaid(pr: NonNullable<Thread["pr"]>): { text: string; tone?: "danger"; num: PrTone } {
  const s = pr.state.toUpperCase();
  if (s === "MERGED") return { text: "Merged", num: "merged" };
  if (s === "CLOSED") return { text: "PR closed", num: "closed" };
  const c = pr.checks;
  if (c?.state === "running") return { text: "Checks running", num: "checks" };
  if (c?.state === "failed") return { text: c.failed ? `${c.failed} ${c.failed === 1 ? "check" : "checks"} failed` : "Checks failed", tone: "danger", num: "bad" };
  if (c?.state === "passed") return { text: "Ready to merge", num: "open" };
  return { text: "PR open", num: "open" };
}
