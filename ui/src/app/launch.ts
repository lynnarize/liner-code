/*
  The session folder's .claude/launch.json servers, as the engine runs them (engine/src/launch.ts).
  The app says once a minute which sessions are on screen: a folder none of whose sessions has
  been for half an hour, and none of which is working, has its servers stopped, and they start
  again when one of them is opened, as Claude Code's previews do.
*/
import { useEffect, useState } from "react";
import type { LaunchServer } from "@contracts";
import { onStream, rpc, useEngine } from "./engine";

export type LaunchList = { servers: LaunchServer[]; file: boolean; error?: string };

/** How often a session on screen says so; well inside the engine's half hour. */
const BEAT_MS = 60_000;

/** This session is on screen while the window is: its folder's servers stay up, and the ones that slept wake. */
export function useSeen(threadId: string) {
  const connected = useEngine((s) => s.connected);
  useEffect(() => {
    if (!connected) return;
    const beat = () => {
      if (document.visibilityState === "visible") void rpc("launch.seen", { threadId }).catch(() => {});
    };
    beat();
    const t = window.setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [threadId, connected]);
}

/** The list, read again when any folder's server starts, comes up or stops (the read is the file and the engine's record). */
export function useLaunch(threadId: string) {
  const [list, setList] = useState<LaunchList | null>(null);
  const [n, setN] = useState(0);
  const connected = useEngine((s) => s.connected);
  useEffect(() => onStream((e) => void (e.type === "launch" && setN((x) => x + 1))), []);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    void rpc("launch.list", { threadId })
      .then((l) => live && setList(l))
      .catch(() => live && setList({ servers: [], file: false }));
    return () => {
      live = false;
    };
  }, [threadId, n, connected]);
  return [list, () => setN((x) => x + 1)] as const;
}

/** What a row says under its name, when there's something to say. */
export function launchNote(s: LaunchServer): string | undefined {
  if (s.problem) return s.problem;
  if (s.status === "starting") return "Starting";
  if (s.status === "running") return s.changed ? "launch.json changed: restart to use it" : undefined;
  if (s.asleep) return "Stopped while you were away";
  if (s.ended?.failed) return s.ended.reason.split("\n")[0];
  return undefined;
}
