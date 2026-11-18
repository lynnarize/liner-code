/*
  Liner Security's one way of saying when and where, so every page of the face agrees: dates as "25 Oct", times as
  "2 hours ago" / "yesterday" (calendar days, not 24-hour spans), the sidebar's short "2h", a fixed finding's one time
  (fixedAt: the moment it closed, never the moment its fix started), and a long folder path cut so its name shows.
*/
import type { SecurityFinding } from "@contracts";
import { tilde } from "../os";

const DAY = 86400000;
const midnight = (at: number) => new Date(new Date(at).toDateString()).getTime();
/** Calendar days between two moments: 0 today, 1 yesterday. */
const daysBack = (at: number, now: number) => Math.round((midnight(now) - midnight(at)) / DAY);

/** "25 Oct". */
export const dateOf = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** "just now", "a minute ago", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then "25 Oct". */
export function when(at: number, now = Date.now()) {
  const d = daysBack(at, now);
  if (d <= 0) {
    const s = Math.max(0, (now - at) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) === 1 ? "a minute ago" : `${Math.floor(s / 60)} minutes ago`;
    return Math.floor(s / 3600) === 1 ? "an hour ago" : `${Math.floor(s / 3600)} hours ago`;
  }
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return dateOf(at);
}

/** The sidebar's short form: "now", "5m", "2h", "yesterday", then "25 Oct". */
export function whenShort(at: number, now = Date.now()) {
  const d = daysBack(at, now);
  if (d <= 0) {
    const s = Math.max(0, (now - at) / 1000);
    return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
  }
  return d === 1 ? "yesterday" : dateOf(at);
}

/** When a fixed finding closed: its last "fixed" event, else when its fix was merged, else its last change. */
export function fixedAt(f: SecurityFinding) {
  const ev = [...f.activity].reverse().find((e) => e.kind === "fixed");
  return ev?.at ?? (f.fix?.state === "merged" ? f.fix.at : f.updatedAt);
}

/** A folder's path with the home as ~, cut from the start when long so the folder's own name shows: "…/Projects/foreshore". */
export function shortPath(path: string, max = 38) {
  const p = tilde(path);
  if (p.length <= max) return p;
  const parts = p.split(/[\\/]/);
  let out = parts[parts.length - 1];
  for (let i = parts.length - 2; i > 0 && `…/${parts[i]}/${out}`.length <= max; i--) out = `${parts[i]}/${out}`;
  return out.length > max - 2 ? `…${out.slice(-(max - 1))}` : `…/${out}`;
}

/** Text with no doubled ending: "the se…." and "done.." read "the se…" and "done.". */
export const tidyEnd = (s: string) => s.replace(/…\.+$/u, "…").replace(/\.{2,}$/, ".").replace(/([!?])\.$/, "$1");

/**
  A file named by a finding (an agent, a checker, a SARIF report: none of it trusted), as a full path inside the project's
  folder, or null when it is absolute or climbs out of it ("../../etc/passwd", "/Applications/x.app"). The editor only ever
  gets a path that stays inside the folder. Symlinks can't be seen from here; the folder itself is the project you added.
*/
export function insideProject(root: string, file: string): string | null {
  if (!root || !file || /^([a-z]+:|[\\/]|~)/i.test(file) || file.includes("\0")) return null;
  const out: string[] = [];
  for (const part of file.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? `${root.replace(/[\\/]+$/, "")}/${out.join("/")}` : null;
}
