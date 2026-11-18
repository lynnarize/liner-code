/*
  Anonymous usage counts: how many people use Liner Code, and how many tokens their agents write.
  Once a day at most, one small POST to linercode.dev/api/usage (site/worker/index.ts) with a
  random install id, the app's version, the OS and chip, the day, and the tokens counted since the
  last one went: nothing else, ever. No prompts, files, folders, projects, models, tools, sessions or
  errors, and the Worker keeps no address.

  The install id is a random UUID made once and kept in <LINER_HOME>/usage.json (yours alone to
  read, 0600), beside the tokens counted so far; nothing about the machine, its user or an account
  goes into it. The count is kept as it goes, from each turn's usage record (store.logUsage), not
  added up from the sessions later, so a deleted session can't make it go back. The Demo, Check my
  tools and API endpoints on this machine aren't counted: their tokens are no one's real work.

  Settings › General › Share anonymous usage counts (Settings.usagePing, on unless false) turns it
  off: then nothing goes, and what was counted is dropped at once. A test, a dev run, the engine run
  from source, a home in a temp folder, or LINER_NO_USAGE=1 never sends at all (usageTarget).
*/
import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Settings, UsageRecord } from "../../contracts/src/index.ts";
import { ENDPOINT_TOOL, familyOf } from "../../contracts/src/index.ts";

export const USAGE_URL = "https://linercode.dev/api/usage";
const HOUR = 3_600_000;
/** How long after the engine starts it first looks, so a ping never competes with a launch. */
const FIRST_LOOK = 60_000;

/** Exactly what one ping says, and all it ever says. */
export type Ping = { id: string; v: string; os: "mac" | "windows" | "linux"; arch: string; day: string; out: number; in: number };
/** usage.json: the install id, the last day a ping went (UTC), when one was last tried, and what was counted since. */
type Kept = { id: string; day?: string; tried?: number; out: number; in: number };

const OS: Record<string, Ping["os"]> = { darwin: "mac", win32: "windows", linux: "linux" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
/** The chips the Worker knows by name; any other (riscv64, loong64…) goes as "other", or every ping would be refused. */
const ARCHES = new Set(["arm64", "x64", "ia32", "arm"]);
/** The most of either count one ping carries: the Worker's own cap (site/worker/index.ts CAP). More waits for the next day's. */
export const PING_CAP = 1e12;

/** The UTC day of a time, as YYYY-MM-DD. */
export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** The path as given and with its links followed (/tmp is /private/tmp on a Mac), each compared. */
const forms = (p: string) => {
  const all = [resolve(p)];
  try {
    all.push(realpathSync(p));
  } catch {
    // not there (yet): as given
  }
  return process.platform === "win32" ? all.map((f) => f.toLowerCase()) : all;
};
const under = (path: string, dir: string) => forms(path).some((a) => forms(dir).some((b) => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)));

/**
  Where pings go, or nowhere (undefined). Nowhere for LINER_NO_USAGE=1, a test (NODE_ENV=test, or a
  process node --test started), a dev run (--dev), the engine run from its .ts files rather than the
  app's bundle, and a home in a temp folder (a test's or a check's). LINER_USAGE_URL is honoured only
  when it is plain http on this machine (a check's fake server), and then even in those runs, since
  it can't reach anywhere else; any other value is ignored.
*/
export function usageTarget(o: { env: NodeJS.ProcessEnv; home: string; dev: boolean; bundled: boolean }): string | undefined {
  const { env } = o;
  if (env.LINER_NO_USAGE === "1") return undefined;
  const own = env.LINER_USAGE_URL?.trim();
  if (own && LOOPBACK.test(own)) return own;
  if (o.dev || !o.bundled || env.NODE_ENV === "test" || env.NODE_TEST_CONTEXT) return undefined;
  const temps = [tmpdir(), ...(process.platform === "win32" ? [] : ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"])];
  if (temps.some((t) => under(o.home, t))) return undefined;
  return USAGE_URL;
}

/**
  Whether a turn's tokens count: not the Demo's, not Check my tools' (agent "check"), and not those of
  an API endpoint on this machine (a local model, or a check's fake API).
*/
export function counts(r: UsageRecord, settings: Pick<Settings, "endpoints">) {
  if (r.agent === "check" || familyOf(r.provider) === "demo") return false;
  const e = (settings.endpoints ?? []).find((e) => `${ENDPOINT_TOOL[e.protocol]}.${e.id}` === r.provider);
  return !e || !/^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(e.url.trim());
}

const whole = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export class UsagePing {
  private readonly file: string;
  private readonly url: string;
  private readonly version: string;
  private readonly settings: () => Pick<Settings, "usagePing" | "endpoints">;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly os?: Ping["os"];
  private readonly arch: string;
  private kept?: Kept;
  private sending = false;
  /** Said once a run: the Worker refused a ping. */
  private refusedTold = false;

  constructor(o: { home: string; url: string; version: string; settings: () => Pick<Settings, "usagePing" | "endpoints">; fetch?: typeof fetch; now?: () => number; platform?: string; arch?: string }) {
    this.file = join(o.home, "usage.json");
    this.url = o.url;
    this.version = o.version;
    this.settings = o.settings;
    this.fetch = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.os = OS[o.platform ?? process.platform];
    const arch = o.arch ?? process.arch;
    this.arch = ARCHES.has(arch) ? arch : "other";
    if (this.on()) this.load();
    // Off since the last run: whatever was counted then goes now.
    else this.off();
  }

  private on() {
    return this.settings().usagePing !== false;
  }

  /** usage.json as kept, or a new install id when there's none (or it doesn't read). */
  private load(): Kept {
    if (this.kept) return this.kept;
    let k: Partial<Kept> = {};
    try {
      k = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Kept>;
    } catch {
      // none yet, or garbled: a fresh start
    }
    const fresh = typeof k.id !== "string" || !UUID.test(k.id);
    this.kept = { id: fresh ? randomUUID() : k.id!, out: whole(k.out), in: whole(k.in), ...(typeof k.day === "string" ? { day: k.day } : {}), ...(typeof k.tried === "number" ? { tried: k.tried } : {}) };
    if (fresh) this.save();
    return this.kept;
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.kept), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (e) {
      console.error("[usage]", e instanceof Error ? e.message : e);
    }
  }

  /** A turn's usage record, as it's logged: its tokens are added to the count, when they count. */
  add(r: UsageRecord) {
    if (!this.on() || !counts(r, this.settings())) return;
    const k = this.load();
    const out = whole(r.outputTokens);
    const inp = whole(r.inputTokens) + whole(r.cacheReadTokens);
    if (!out && !inp) return;
    k.out += out;
    k.in += inp;
    this.save();
  }

  /** Switched off: what was counted is dropped, and only the install id stays. */
  off() {
    let id: unknown;
    try {
      id = (JSON.parse(readFileSync(this.file, "utf8")) as Partial<Kept>).id;
    } catch {
      return;
    }
    this.kept = typeof id === "string" && UUID.test(id) ? { id, out: 0, in: 0 } : undefined;
    if (this.kept) this.save();
  }

  /**
    Sends today's ping, if one hasn't gone today, none was tried in the last hour, and it's on. What
    went is taken off the count once the Worker took it; on a failure the count stays for the next
    try, but a refusal (400) drops what the ping held, so a body the Worker won't take isn't sent
    for good. True when one went.
  */
  async tick(): Promise<boolean> {
    if (this.sending || !this.on() || !this.os) return false;
    const k = this.load();
    const now = this.now();
    const day = dayOf(now);
    if (k.day === day || (k.tried !== undefined && now - k.tried < HOUR && now >= k.tried)) return false;
    k.tried = now;
    this.save();
    // Each count at most the Worker's cap (a heavy user's cache reads after a long stretch offline): what is over it goes on the next day's.
    const ping: Ping = { id: k.id, v: this.version, os: this.os, arch: this.arch, day, out: Math.min(k.out, PING_CAP), in: Math.min(k.in, PING_CAP) };
    this.sending = true;
    try {
      // No redirect followed, no cookies, five seconds at most.
      const r = await this.fetch(this.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": `liner-code/${this.version}` }, body: JSON.stringify(ping), redirect: "error", credentials: "omit", signal: AbortSignal.timeout(5000) });
      await r.body?.cancel().catch(() => {});
      // Refused as it is (a 400): the same body would be refused every hour for good, so what it held is dropped and today is done.
      const refused = r.status === 400;
      if (refused && !this.refusedTold) {
        this.refusedTold = true;
        console.error("[usage] the usage count was refused; what it held is dropped");
      }
      if (!r.ok && !refused) return false;
      // Switched off while it went: the count is gone already.
      if (!this.on() || this.kept !== k) return !refused;
      k.out = Math.max(0, k.out - ping.out);
      k.in = Math.max(0, k.in - ping.in);
      k.day = day;
      this.save();
      return !refused;
    } catch {
      return false;
    } finally {
      this.sending = false;
    }
  }

  /** Looks a minute after the engine starts, then every hour; never keeps the engine running. The stop it returns ends that. */
  start() {
    const look = () => void this.tick().catch(() => {});
    const first = setTimeout(look, FIRST_LOOK);
    const every = setInterval(look, HOUR);
    first.unref();
    every.unref();
    return () => (clearTimeout(first), clearInterval(every));
  }
}
