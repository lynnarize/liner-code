/*
  A press that asks before it acts (Delete, then Delete for good): the first press turns the control into its confirm,
  and only a later press acts. No React here, so plain Node can test it (engine/test/reviewed-faults.test.ts).
*/

/**
  How long a confirm that has just appeared lets presses go by. The second click of a double-click lands well inside it,
  on the control that has just become the confirm, and would otherwise act at once.
*/
export const CONFIRM_SETTLE = 500;

/**
  How long a confirm stays armed. A confirm that stays on screen (the team card's Turn it off) would otherwise wait in red
  for ever, and a press minutes later, meant for something else, would act; past this the press asks again.
*/
export const CONFIRM_LAPSE = 4000;

/** What a press on a two-step confirm does: the first asks, one inside the settle is still the same double-click and waits, a later one acts, and one past the lapse asks afresh. */
export function confirmPress(askedAt: number | null, now: number, settle = CONFIRM_SETTLE, lapse = CONFIRM_LAPSE): "ask" | "wait" | "do" {
  if (askedAt === null || now - askedAt >= lapse) return "ask";
  return now - askedAt < settle ? "wait" : "do";
}
