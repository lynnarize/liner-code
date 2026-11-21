/*
  A press that asks before it acts (Delete, then Delete for good): the first press turns the control into its confirm,
  and only a later press acts. No React here, so plain Node can test it (engine/test/reviewed-faults.test.ts).
*/

/**
  How long a confirm that has just appeared lets presses go by. The second click of a double-click lands well inside it,
  on the control that has just become the confirm, and would otherwise act at once.
*/
export const CONFIRM_SETTLE = 500;

/** What a press on a two-step confirm does: the first asks, one inside the settle is still the same double-click and waits, a later one acts. */
export function confirmPress(askedAt: number | null, now: number, settle = CONFIRM_SETTLE): "ask" | "wait" | "do" {
  if (askedAt === null) return "ask";
  return now - askedAt < settle ? "wait" : "do";
}
