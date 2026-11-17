/*
  A working session's ETA in words (Thread.eta, worked out by the engine as a turn starts), for its sidebar row and
  its own live line. Honest numbers only: whole minutes above 90 seconds, then "about a minute", then "under a
  minute"; never seconds counting down. Past the estimate it says "longer than usual" and no number, since any
  number then would be a guess. Pure, so the engine's tests read it too (engine/test/eta.test.ts).
*/

/** What's left of a turn expected to take `ms` from `from`, at `now`; nothing with no estimate. */
export function etaWords(eta: { from: number; ms: number } | undefined, now: number): string | undefined {
  if (!eta || !(eta.ms > 0)) return undefined;
  const left = eta.from + eta.ms - now;
  if (left <= 0) return "longer than usual";
  if (left > 90_000) return `about ${Math.round(left / 60_000)} min left`;
  if (left > 60_000) return "about a minute left";
  return "under a minute left";
}
