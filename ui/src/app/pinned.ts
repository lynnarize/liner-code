/*
  Whether the session details card is pinned at the chat's right (Session.tsx, as T3 Code pins its own): one choice for every
  session and every launch, so it stays where you left it as you move between sessions. Kept in localStorage, which can
  be shut (a private window): then it lasts as long as the page.
*/
import { useSyncExternalStore } from "react";

const KEY = "lc:session-card";
let pinned = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
const watchers = new Set<() => void>();

export function setSessionPinned(next: boolean | ((was: boolean) => boolean)) {
  const v = typeof next === "function" ? next(pinned) : next;
  if (v === pinned) return;
  pinned = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
  for (const w of watchers) w();
}

export function useSessionPinned() {
  return useSyncExternalStore(
    (w) => (watchers.add(w), () => void watchers.delete(w)),
    () => pinned,
  );
}

/*
  Whether the card's Context row is unfolded (its sources, a row each, and the note under them): one choice for every
  session while the app is open, as the card itself is one, and not kept past a launch, where the card opens lean again.
  `shown` counts the times something asked to see the Context (the message box's ring): the card scrolls its row into
  view for each.
*/
let context = { open: false, shown: 0 };
const contextWatchers = new Set<() => void>();
export function setContextOpen(open: boolean) {
  if (open === context.open) return;
  context = { ...context, open };
  for (const w of contextWatchers) w();
}
/** The two choices as they stand, outside a render (engine/test/session-card.test.ts reads them). */
export const detailsNow = () => ({ shown: pinned, context });
export function useContextOpen() {
  return useSyncExternalStore(
    (w) => (contextWatchers.add(w), () => void contextWatchers.delete(w)),
    () => context,
  );
}

/**
  Every way into the session's details (the Session key, the title's menu, ⌘K, a notification that asked for the Session
  tab before it went): the card shows, whether or not the panel is open. `context` unfolds its Context row and brings it
  into view, as the message box's ring and "N% of context" ask.
*/
export function showDetails(o: { context?: boolean } = {}) {
  setSessionPinned(true);
  if (!o.context) return;
  context = { open: true, shown: context.shown + 1 };
  for (const w of contextWatchers) w();
}
