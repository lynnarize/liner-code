/*
  Whether the Session card is pinned at the chat's right (Session.tsx, as T3 Code pins its own): one choice for every
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
