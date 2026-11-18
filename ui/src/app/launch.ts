/*
  The session folder's .claude/launch.json servers, as the engine runs them (engine/src/launch.ts).
  The app says once a minute which sessions are on screen: a folder none of whose sessions has
  been for half an hour, and none of which is working, has its servers stopped, and they start
  again when one of them is opened, as Claude Code's previews do.
*/
import { useEffect, useRef, useState } from "react";
import type { LaunchServer } from "@contracts";
import { onStream, rpc, threadOf, useEngine } from "./engine";

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

/**
  The list, read again when a server of this session's folder starts, comes up or stops (the read is
  the file and the engine's record). The event names the folder, as the engine finds a session's
  (its worktree, else its project): another folder's server isn't a read for every Browser and
  Agents surface open. A session not known here yet hears every folder's, as before.
*/
export function useLaunch(threadId: string) {
  const [list, setList] = useState<LaunchList | null>(null);
  const [n, setN] = useState(0);
  const connected = useEngine((s) => s.connected);
  const root = useEngine((s) => {
    const t = threadOf(s, threadId);
    return t ? (t.worktree?.path ?? s.projects.find((p) => p.id === t.projectId)?.path) : undefined;
  });
  const rootRef = useRef(root);
  rootRef.current = root;
  useEffect(() => onStream((e) => void (e.type === "launch" && (!rootRef.current || e.root === rootRef.current) && setN((x) => x + 1))), []);
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
