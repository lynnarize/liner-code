/*
  Where the Browser's page has been, so its head shows Back and Forward only when there is somewhere to go
  (Browser.tsx): in a panel about 420px wide the three buttons took the address's room. The page tells the
  panel every place it lands on ("nav") and how it got there (engine/src/proxy.ts): a step through its history
  (a Back or Forward, the panel's or the page's own) lands on the place before or after this one; a replaced
  address takes this place's room and adds none; anything else is a new place, which drops the places ahead.
  A link back to the page before is a new place too, so A, B, then a link to A can still go Back to B.
*/

export type Trail = { places: string[]; at: number };

export const NO_TRAIL: Trail = { places: [], at: -1 };

/** How the page landed: a step through its history ("pop"), an address replaced in place, or a new place. */
export type Landing = "pop" | "replace" | "new";

/**
  How the page's "nav" message (its `how`: push, replace, pop or load) lands on the trail. A whole page that loads
  is a new place, unless the head's Back or Forward was just pressed (`stepping`): then it is that step. A page that
  doesn't say how (an older one) is read as a step, as before.
*/
export function landing(how: unknown, stepping: boolean): Landing {
  if (how === "push") return "new";
  if (how === "replace") return "replace";
  if (how === "load") return stepping ? "pop" : "new";
  return "pop";
}

/** The trail once the page has landed on `path`. */
export function landed(t: Trail, path: string, how: Landing = "pop"): Trail {
  if (t.places[t.at] === path) return t;
  if (how === "replace" && t.at >= 0) return { places: t.places.map((p, i) => (i === t.at ? path : p)), at: t.at };
  if (how === "pop" && t.at > 0 && t.places[t.at - 1] === path) return { places: t.places, at: t.at - 1 };
  if (how === "pop" && t.places[t.at + 1] === path) return { places: t.places, at: t.at + 1 };
  const places = [...t.places.slice(0, t.at + 1), path];
  return { places, at: places.length - 1 };
}

/** Whether Back and Forward have somewhere to go. */
export const canBack = (t: Trail) => t.at > 0;
export const canForward = (t: Trail) => t.at >= 0 && t.at < t.places.length - 1;
