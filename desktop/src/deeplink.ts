/*
  Parses liner-code:// URLs and second-instance CLI arguments into concrete app targets so the
  desktop shell can route deep-links and folder launches to the active window.
*/
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** `link`: the folder came in a liner-code:// link, which any web page can open, not from a command line you typed. */
export type LaunchTarget = { kind: "thread"; id: string } | { kind: "project"; path: string; link?: boolean };

/** Parses `liner-code://thread/<id>`, `liner-code://session/<id>`, or `liner-code://open?path=<dir>`. */
export function parseDeepLink(raw: string): LaunchTarget | null {
  const trimmed = raw?.trim();
  if (!trimmed || !/^liner-code:/i.test(trimmed)) return null;
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)|%2e%2e/i.test(trimmed)) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  // A broken percent code (%ZZ) makes decodeURIComponent throw, and a throw here reaches the open-url handler and, on a
  // cold launch from a link, stops the rest of startup.
  let segs: string[];
  try {
    segs = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  if ((host === "thread" || host === "session") && segs.length === 1 && segs[0] && /^[\w-]{1,128}$/.test(segs[0])) {
    return { kind: "thread", id: segs[0] };
  }
  if (host === "open" || host === "project") {
    const p = u.searchParams.get("path")?.trim();
    // The check on the raw link misses a .. spelled half in percent codes (%2e.), so look again once it is decoded.
    if (p && p.split(/[\\/]/).includes("..")) return null;
    if (p) return { kind: "project", path: p, link: true };
  }
  return null;
}

/**
  What to ask before a target is opened, or null to open it at once. A folder from a link is asked about first: a web page
  can open liner-code://open?path=… with one click on the browser's prompt, and adding a project runs git in that folder.
*/
export function launchQuestion(target: LaunchTarget): { message: string; detail: string } | null {
  if (target.kind !== "project" || !target.link) return null;
  return { message: `Add “${target.path}” as a project?`, detail: "A link asked Liner Code to add this folder. Liner Code reads the folder and runs git in it. Add it only if you opened the link yourself." };
}

/**
  Extracts a liner-code:// deep-link or existing folder path from Electron's argv. `skip` is how many leading arguments
  are the app itself: argv[0] always, and under `electron <path>` (npm run app:dev, process.defaultApp) the app's own
  folder too, which would otherwise be taken for a folder you asked to open.
*/
export function extractLaunchTarget(argv: readonly string[], cwd?: string, isDir: (p: string) => boolean = defaultIsDir, skip = 1): LaunchTarget | null {
  for (const arg of argv) {
    const link = parseDeepLink(arg);
    if (link) return link;
  }
  // Skip the app's own arguments and flags, then look for an explicit directory path passed on launch.
  for (const arg of argv.slice(skip)) {
    if (!arg || arg.startsWith("-") || arg === "." || arg.endsWith(".asar") || /\.(?:js|cjs|mjs|ts|exe|app)$/i.test(arg)) continue;
    const candidate = cwd ? resolve(cwd, arg) : resolve(arg);
    if (isDir(candidate)) return { kind: "project", path: candidate };
  }
  return null;
}

function defaultIsDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}
