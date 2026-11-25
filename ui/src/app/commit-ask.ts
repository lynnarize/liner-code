/*
  The session title menu's Commit opens Changes with its commit form open (QA E40), as one way to commit: the menu asks,
  and Changes' Commit button takes the ask when it shows, even when Changes mounts only after. The ask carries what
  follows the commit (a push, the pull request card, or nothing), as the title menu's choice says. Kept apart from React
  so plain Node can test it (engine/test/commit-ask.test.ts). No React and no alias imports here.
*/

/** What follows a commit: Commit.tsx's Then. */
export type CommitThen = "commit" | "push" | "pr";

/**
  How long an ask waits for the Commit button: long enough for Changes to open and show it, not so long that a button
  that was greyed out (an undo at work) opens the form by itself minutes later, when nobody asked any more.
*/
export const ASK_KEPT_MS = 3000;

const asked = new Map<string, { then: CommitThen; at: number }>();
const takers = new Map<string, (then: CommitThen) => void>();

/** Open this session's commit form, now if its Commit button shows, else when it next does. */
export function askCommit(threadId: string, then: CommitThen, now = Date.now()) {
  const take = takers.get(threadId);
  if (take) take(then);
  else asked.set(threadId, { then, at: now });
}

/** The Commit button, as it shows: the ask made while it wasn't there, if any and still fresh. Asked once, taken once. */
export function takeCommit(threadId: string, now = Date.now()): CommitThen | undefined {
  const ask = asked.get(threadId);
  asked.delete(threadId);
  return ask && now - ask.at <= ASK_KEPT_MS ? ask.then : undefined;
}

/** The Commit button listens while it is mounted, so an ask while it shows opens the form at once. */
export function onCommitAsk(threadId: string, open: (then: CommitThen) => void) {
  takers.set(threadId, open);
  return () => {
    if (takers.get(threadId) === open) takers.delete(threadId);
  };
}
