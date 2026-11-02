/*
  OpenCode Go's plan windows: the rolling five hours, the week and the month, as opencode.ai
  reports them for a Go key (T3 Code: provider-opencode's usageLimits.ts). The key is the one
  OpenCode signed in with (its auth.json, its own database, OPENCODE_API_KEY), the one Hermes
  runs Go's models with (its .env), or an API endpoint's you added for Go. It goes to
  opencode.ai only, and never follows a redirect.
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { LimitWindow } from "../../../contracts/src/index.ts";

const USAGE = "https://opencode.ai/zen/go/v1/usage";

/** An endpoint that is OpenCode Go ("https://opencode.ai/zen/go/v1", "…/inference/go/openai/v1"). */
export const isGo = (url: string) => {
  const u = URL.parse(url.trim());
  return u?.host === "opencode.ai" && /(^|\/)go(\/|$)/.test(u.pathname);
};

/** The keys OpenCode could use for Go, the likeliest first. */
export function goKeys(env: NodeJS.ProcessEnv): string[] {
  const data = join(env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share"), "opencode");
  const keys: (string | undefined)[] = [];
  // Its database keeps the keys it signed in with lately; one for another server isn't opencode.ai's.
  const file = env.OPENCODE_DB ?? "opencode.db";
  if (!env.OPENCODE_AUTH_CONTENT && file !== ":memory:") for (const id of ["opencode", "opencode-go"]) keys.push(storedKey(resolve(data, file), id));
  let auth: Record<string, { type?: string; key?: string } | undefined> = {};
  try {
    auth = JSON.parse(env.OPENCODE_AUTH_CONTENT || readFileSync(join(data, "auth.json"), "utf8"));
  } catch {
    // signed in some other way, or not at all
  }
  const go = auth["opencode-go"];
  keys.push(go?.type === "api" ? go.key : env.OPENCODE_API_KEY);
  return [...new Set(keys.map((k) => k?.trim()).filter((k): k is string => Boolean(k)))];
}

/** The Go key Hermes runs OpenCode Go's models with: OPENCODE_GO_API_KEY, in its environment or its .env. */
export function hermesGoKey(env: NodeJS.ProcessEnv): string | undefined {
  if (env.OPENCODE_GO_API_KEY?.trim()) return env.OPENCODE_GO_API_KEY.trim();
  try {
    const line = readFileSync(join(env.HERMES_HOME || join(env.HOME || homedir(), ".hermes"), ".env"), "utf8").split("\n").find((l) => /^\s*(export\s+)?OPENCODE_GO_API_KEY\s*=/.test(l));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;
  } catch {
    return undefined;
  }
}

function storedKey(path: string, integration: string): string | undefined {
  try {
    // node:sqlite is loaded only here, and only when it's there: a Node without it reads auth.json alone.
    const { DatabaseSync } = (process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined) ?? {};
    if (!DatabaseSync) return undefined;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 100");
      const row = db.prepare("SELECT value FROM credential WHERE integration_id = ? AND active IS NOT 0 ORDER BY active DESC, time_created DESC, id DESC LIMIT 1").get(integration) as { value?: unknown } | undefined;
      const v = typeof row?.value === "string" ? (JSON.parse(row.value) as { type?: string; key?: string; metadata?: { server?: unknown } }) : undefined;
      if (v?.type !== "key" || typeof v.key !== "string") return undefined;
      const server = typeof v.metadata?.server === "string" ? URL.parse(v.metadata.server) : null;
      return server && `${server.origin}${server.pathname.replace(/\/+$/, "")}` === "https://opencode.ai/console" ? v.key : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

type Win = { percent?: unknown; resetsAt?: unknown };
const WINDOWS = [
  ["rolling", { label: "5-hour window", kind: "session", minutes: 300 }],
  ["weekly", { label: "Weekly", kind: "weekly", minutes: 10080 }],
  ["monthly", { label: "Monthly", kind: "monthly" }],
] as const;

/**
  The windows for the first of `keys` opencode.ai takes. Null when none is a Go key (it answers
  401 or 403 to each): there's no Go plan to show. Anything else that goes wrong says so.
*/
export async function goUsage(keys: string[], at = USAGE): Promise<LimitWindow[] | null> {
  // Another address (the voucher's, on Liner Code's site) answers the same way, and is named by its host.
  const host = at === USAGE ? "opencode.ai" : (URL.parse(at)?.host ?? at);
  const plan = at === USAGE ? "OpenCode Go's usage" : "The plan's usage";
  for (const key of keys) {
    let r: Response;
    try {
      r = await fetch(at, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000), redirect: "error" });
    } catch (e) {
      throw new Error(`${host} didn't answer: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw new Error(`${host} answered ${r.status} for ${plan.replace(/^The/, "the")}.`);
    const b = (await r.json().catch(() => ({}))) as { usage?: Record<string, Win | undefined> };
    const windows = WINDOWS.flatMap(([k, w]) => {
      const x = b.usage?.[k];
      if (typeof x?.percent !== "number" || !Number.isFinite(x.percent)) return [];
      const at = typeof x.resetsAt === "string" ? Date.parse(x.resetsAt) : typeof x.resetsAt === "number" ? x.resetsAt : NaN;
      return [{ ...w, usedPercent: Math.max(0, Math.min(100, x.percent)), ...(Number.isFinite(at) ? { resetsAt: at } : {}) }];
    });
    if (!windows.length) throw new Error(`${plan} came back in a shape Liner Code doesn't read.`);
    return windows;
  }
  return null;
}
