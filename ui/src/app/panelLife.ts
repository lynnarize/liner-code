/*
  Which panels stopped running, across the window: a frame hears its process end (Addon.tsx) and the
  Add-ons page shows it, as DeepSeek Harness's Plugins page does: a Problem tag, the reason, Retry.
  It's this window's knowledge, so it's kept here rather than in the engine. Retry bumps a count the
  frames are keyed by, so each comes up anew; a frame that loads again clears it on its own.
*/
import { useSyncExternalStore } from "react";

let stopped: ReadonlySet<string> = new Set();
let tries: ReadonlyMap<string, number> = new Map();
const ears = new Set<() => void>();
const tell = () => {
  for (const f of ears) f();
};
const subscribe = (f: () => void) => {
  ears.add(f);
  return () => ears.delete(f);
};

export function panelStopped(addon: string) {
  if (stopped.has(addon)) return;
  stopped = new Set(stopped).add(addon);
  tell();
}

export function panelRunning(addon: string) {
  if (!stopped.has(addon)) return;
  const next = new Set(stopped);
  next.delete(addon);
  stopped = next;
  tell();
}

export function retryPanel(addon: string) {
  tries = new Map(tries).set(addon, (tries.get(addon) ?? 0) + 1);
  panelRunning(addon);
  tell();
}

export const useStoppedPanels = () => useSyncExternalStore(subscribe, () => stopped);
export const usePanelTries = (addon: string) => useSyncExternalStore(subscribe, () => tries.get(addon) ?? 0);
