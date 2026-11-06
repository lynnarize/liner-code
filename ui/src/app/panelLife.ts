/*
  Which panels stopped running, across the window, and the session each was beside: a frame hears
  its process end (Addon.tsx) and the Add-ons page shows it, as DeepSeek Harness's Plugins page does:
  a Problem tag, the reason, Retry. It's this window's knowledge, so it's kept here rather than in
  the engine. A panel runs only where it's shown, so nothing here can start one: Retry brings up a
  new frame, in its own tab or by going to where it ran, and only a frame that loads clears this.
*/
import { useSyncExternalStore } from "react";

/** What a stopped panel says, in DeepSeek Harness's shape: on the Add-ons page beside its Problem tag, and in its own tab. */
export const STOPPED_REASON = "Reason: it stopped running. Anything it was showing is gone.";

let stopped: ReadonlyMap<string, string | undefined> = new Map();
const ears = new Set<() => void>();
const tell = () => {
  for (const f of ears) f();
};
const subscribe = (f: () => void) => {
  ears.add(f);
  return () => ears.delete(f);
};

/** `threadId`: the session it was beside. A page has none. */
export function panelStopped(addon: string, threadId?: string) {
  stopped = new Map(stopped).set(addon, threadId);
  tell();
}

export function panelRunning(addon: string) {
  if (!stopped.has(addon)) return;
  const next = new Map(stopped);
  next.delete(addon);
  stopped = next;
  tell();
}

export const isPanelStopped = (addon: string) => stopped.has(addon);
export const useStoppedPanels = () => useSyncExternalStore(subscribe, () => stopped);
