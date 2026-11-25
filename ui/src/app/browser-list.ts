/*
  What the Browser's address list says (Browser.tsx, board Menus "The address in Browser, when pressed"),
  apart from the component so it can be tested: each dev server's value at its row's end, the label's
  live note, and which other servers on this Mac are offered.
*/

/** The parts of a launch.json server (contracts LaunchServer) and of a server on this Mac (LocalServer) read here; written out so the engine's tests can read this file. */
type Server = { status: "stopped" | "starting" | "running"; port: number; at?: number; problem?: string; ended?: { reason?: string; at?: number; failed?: boolean }; asleep?: boolean };
type Local = { port: number; web: boolean; owner: "session" | "project" | null };

/** A launch.json server's value at its row's end: the port it runs on, or where it stands. */
export function serverValue(s: Server) {
  if (s.problem) return "Can't run";
  if (s.status === "starting") return "Starting";
  if (s.status === "running") return `:${s.at ?? s.port}`;
  if (s.ended?.failed && !s.asleep) return "Stopped with an error";
  return "Not running";
}

/** The Dev servers label's live note: "1 running", "2 running", or nothing while none is. */
export function runningNote(servers: Pick<Server, "status">[]) {
  const n = servers.filter((s) => s.status !== "stopped").length;
  return n ? `${n} running` : undefined;
}

/** Servers elsewhere on this Mac: none of this session's or its folder's, the ones that serve a page first, never opened by themselves. */
export const elsewhere = <T extends Local>(ports: T[] | null) =>
  (ports ?? [])
    .filter((p) => !p.owner)
    .sort((a, b) => Number(b.web) - Number(a.web));
