/*
  Scan new PRs (Settings › Source control & issues, `scanNewPrs`): while it is on and the app is open, the engine looks at
  your projects' open pull requests now and then and starts a Liner Security scan (security-targets.ts) of one that is new,
  or got new commits since its last scan. It is careful with your plan:

  - one scan at a time: nothing starts while one it started is still running;
  - never a draft (it waits until the pull request is ready);
  - at most DAILY_CAP a day, counted from local midnight; past it, nothing more until tomorrow (Settings' row says so);
  - the pull requests that were open when it was turned on are the baseline, not "new": only what opens after, or a commit
    pushed to one after, is scanned;
  - it looks at most every few minutes (the lists' own refresh, never under POLL_MIN_MS), and only while a window is open.

  What it remembers (each pull request's head commit when it last looked, the day's count) is kept under the engine's home
  (security/watch.json), so a restart neither scans everything again nor forgets the cap. The decision is a pure function
  (decide) so it can be tested without gh, a model or a clock.
*/
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrItem, ScanTarget } from "../../contracts/src/index.ts";
import { scmSettings, targetKey } from "../../contracts/src/index.ts";
import { writeAtomic } from "./store.ts";
import type { Security } from "./security.ts";
import { headOf, isWide, lastScanOf, scanTarget } from "./security-targets.ts";

/** The most scans Scan new PRs starts in a day. */
export const DAILY_CAP = 10;
/** It never looks more often than this. */
export const POLL_MIN_MS = 5 * 60_000;
/** The words Settings' row shows under Scan new pull requests. */
export const WATCH_NOTE = `Scans a pull request as it opens or gets new commits, one at a time, never a draft, at most ${DAILY_CAP} a day, while Liner Code is open.`;

/** What the watcher remembers: per pull request ("pr:<project>:<n>"), its head commit, when GitHub last said it changed, and whether it was a draft then. */
export type WatchState = { v: 1; baselined: boolean; seen: Record<string, { sha?: string; updatedAt: number; draft?: boolean }>; day: string; count: number; /** Scans that couldn't start, per pull request: how many times at that head commit, and when last. */ failed?: Record<string, { sha?: string; n: number; at: number }> };
export const freshState = (): WatchState => ({ v: 1, baselined: false, seen: {}, day: "", count: 0 });

/** A pull request's key, as targetStatus keys it. */
export const prKey = (pr: Pick<PrItem, "projectId" | "number">) => targetKey({ kind: "pr", projectId: pr.projectId, number: pr.number });

/** After this many failed starts at one head commit, a pull request rests for FAIL_REST_MS; after FAIL_GIVE_UP, it isn't tried again until a new commit. */
export const FAIL_REST = 2;
export const FAIL_GIVE_UP = 4;
export const FAIL_REST_MS = 60 * 60_000;

/**
  Whether a pull request's failed starts hold it back now: a new commit clears them; two rest it an hour; four give up on that
  commit. A failure with no commit to pin it to (its head couldn't be looked up) only rests it: giving up there would be for good.
*/
export function heldBack(f: { sha?: string; n: number; at: number } | undefined, head: string | undefined, now: number): boolean {
  if (!f) return false;
  if (f.sha && head && head !== f.sha) return false;
  if (f.sha && f.n >= FAIL_GIVE_UP) return true;
  return f.n >= FAIL_REST && now - f.at < FAIL_REST_MS;
}

/**
  A picked scan that couldn't start (gh can't read it, the tool is gone): not counted against the day, still to scan (its
  `seen` as before it was picked), and its failure noted at its head commit, so it rests rather than block the others.
*/
export function failedStart(state: WatchState, pick: WatchPick, now: number, before?: WatchState["seen"][string]): WatchState {
  const key = prKey(pick.pr);
  const seen = { ...state.seen };
  if (before) seen[key] = before;
  else delete seen[key];
  const was = state.failed?.[key];
  const n = was && (!was.sha || !pick.sha || was.sha === pick.sha) ? was.n + 1 : 1;
  return { ...state, seen, count: Math.max(0, state.count - 1), failed: { ...state.failed, [key]: { ...(pick.sha ? { sha: pick.sha } : {}), n, at: now } } };
}

/** Local "YYYY-MM-DD" of a time: the day the cap counts in. */
export const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Why a pull request is to be scanned: it opened (or stopped being a draft) since the watcher last looked, or it got new commits. */
export type WatchPick = { pr: PrItem; why: "new" | "commits"; sha?: string };

/**
  What to do with the open pull requests now: which one to scan, if any, and the state to keep. `heads` are the head commits
  looked up this time (needsHead's); `scanned` the head commit each one's last scan read (a scan by hand counts); `running`
  whether a scan the watcher started still runs. The first look only records the baseline. A draft is never picked: it is
  "new" once it's ready. Nothing is picked once the day's cap is reached (`capped` says so, for Settings' row).
*/
export function decide(o: { prs: PrItem[]; state: WatchState; heads: Record<string, string | undefined>; scanned: Record<string, string | undefined>; running: boolean; now: number; cap?: number; /** Keys tried already in this look. */ skip?: Set<string> }): { pick?: WatchPick; state: WatchState; capped: boolean } {
  const cap = o.cap ?? DAILY_CAP;
  const today = dayOf(o.now);
  const state: WatchState = { ...o.state, seen: { ...o.state.seen }, ...(o.state.day === today ? {} : { day: today, count: 0 }) };
  const open = o.prs.filter((p) => p.state === "open" || p.state === "draft");
  const seenNow = (p: PrItem, sha?: string) => ({ ...(sha ? { sha } : {}), updatedAt: p.updatedAt, ...(p.state === "draft" ? { draft: true } : {}) });
  if (!state.baselined) {
    for (const p of open) state.seen[prKey(p)] = seenNow(p, o.heads[prKey(p)]);
    state.baselined = true;
    return { state, capped: false };
  }
  const capped = state.count >= cap;
  let pick: WatchPick | undefined;
  // Newest first: the one someone is most likely waiting on.
  for (const p of [...open].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const key = prKey(p);
    const had = state.seen[key];
    const head = o.heads[key] ?? had?.sha;
    const last = o.scanned[key];
    let why: WatchPick["why"] | undefined;
    if (p.state === "draft") why = undefined;
    else if (!had || had.draft) why = last && head && last === head ? undefined : "new";
    else if (head && (last ?? had.sha) && head !== (last ?? had.sha)) why = "commits";
    // One whose scans keep failing to start rests (or waits for a new commit), and the next is picked instead.
    if (why && (o.skip?.has(key) || heldBack(state.failed?.[key], head, o.now))) continue;
    if (why && !pick && !o.running && !capped) {
      pick = { pr: p, why, ...(head ? { sha: head } : {}) };
      state.count++;
      state.seen[key] = seenNow(p, head);
      continue;
    }
    // Not picked: what is known of it now is kept, except a change still to scan (picked on a later look, or tomorrow).
    if (!why) state.seen[key] = seenNow(p, head);
  }
  // Closed and merged ones are forgotten.
  const still = new Set(open.map(prKey));
  for (const k of Object.keys(state.seen)) if (!still.has(k)) delete state.seen[k];
  if (state.failed) state.failed = Object.fromEntries(Object.entries(state.failed).filter(([k]) => still.has(k)));
  return { ...(pick ? { pick } : {}), state, capped };
}

/** The pull requests whose head commit is worth asking gh for this time: on the first look all, then those new, changed since the watcher last looked, or seen without one. */
export function needsHead(prs: PrItem[], state: WatchState): PrItem[] {
  return prs.filter((p) => {
    if (p.state !== "open" && p.state !== "draft") return false;
    if (!state.baselined) return true;
    const had = state.seen[prKey(p)];
    return p.state === "open" && (!had || had.draft || p.updatedAt > had.updatedAt || !had.sha);
  });
}

/** What the watcher is lent: the open pull requests (W2's lists), whether a window is open, and the clock (tests change them). */
export type WatchHost = { listPrs: () => Promise<PrItem[]>; windows: () => boolean; now?: () => number; head?: (projectId: string, number: number) => Promise<string | undefined>; start?: (target: ScanTarget) => Promise<unknown> };

/** The watcher: one per engine, started by main.ts; it does nothing while Scan new PRs is off. */
export class Watcher {
  private sec: Security;
  private host: WatchHost;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private last = 0;
  /** The scan it started last, while it runs. */
  private mine?: string;
  constructor(sec: Security, host: WatchHost) {
    this.sec = sec;
    this.host = host;
  }

  private file() {
    return join(this.sec.store.home, "security", "watch.json");
  }
  load(): WatchState {
    try {
      const v = JSON.parse(readFileSync(this.file(), "utf8")) as WatchState;
      if (v && v.v === 1 && typeof v.seen === "object" && v.seen) return { ...freshState(), ...v };
    } catch {
      // none yet
    }
    return freshState();
  }
  save(s: WatchState) {
    mkdirSync(join(this.sec.store.home, "security"), { recursive: true });
    writeAtomic(this.file(), JSON.stringify(s));
  }

  /** Looks every minute whether it is time to look (the refresh may change in Settings meanwhile). */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((e) => console.error("[security] Scan new PRs:", e)), 60_000);
    this.timer.unref?.();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** How often it looks: the lists' own refresh, never more often than every five minutes. */
  intervalMs() {
    const s = scmSettings(this.sec.store.settings);
    return Math.max(POLL_MIN_MS, (s.worklistRefresh || 0) * 1000);
  }

  /** One look, when it's on, a window is open and its time has come (or `force`). Answers what it started, if anything. */
  async tick(force = false): Promise<WatchPick | undefined> {
    const now = this.host.now?.() ?? Date.now();
    const s = scmSettings(this.sec.store.settings);
    if (!s.scanNewPrs) {
      // Turned off: the next time it's on, what's open then is the baseline again.
      if (this.load().baselined) this.save(freshState());
      return undefined;
    }
    if (this.busy || !this.host.windows() || (!force && now - this.last < this.intervalMs())) return undefined;
    this.busy = true;
    this.last = now;
    try {
      const state = this.load();
      const prs = await this.host.listPrs();
      const heads: Record<string, string | undefined> = {};
      const head = this.host.head ?? ((projectId: string, n: number) => headOf(this.sec, projectId, n));
      // Never a flood of gh calls: the ones that changed, a few at a time, fifty at most.
      for (const p of needsHead(prs, state).slice(0, 50)) heads[prKey(p)] = await head(p.projectId, p.number).catch(() => undefined);
      const scanned: Record<string, string | undefined> = {};
      for (const p of prs) {
        try {
          const rec = lastScanOf(this.sec, { kind: "pr", projectId: p.projectId, number: p.number });
          if (rec?.headSha) scanned[prKey(p)] = rec.headSha;
        } catch {
          // a project Security doesn't read
        }
      }
      let running = false;
      if (this.mine) {
        try {
          const r = this.sec.scan(this.mine);
          running = r.state === "running" || r.state === "asking";
        } catch {
          // its record went
        }
        if (!running) this.mine = undefined;
      }
      // One that can't start doesn't hold the others up: the next candidate is tried in the same look, a few at most.
      const skip = new Set<string>();
      let kept = state;
      for (let tries = 0; tries < 5; tries++) {
        const d = decide({ prs, state: kept, heads, scanned, running, now, skip });
        this.save(d.state);
        if (!d.pick) return undefined;
        const key = prKey(d.pick.pr);
        const target: ScanTarget = { kind: "pr", projectId: d.pick.pr.projectId, number: d.pick.pr.number };
        try {
          const r = (await (this.host.start ? this.host.start(target) : scanTarget(this.sec, { target, auto: true }))) as { scanId?: string } | undefined;
          if (r?.scanId) this.mine = r.scanId;
          if (d.state.failed?.[key]) {
            const { [key]: _gone, ...rest } = d.state.failed;
            void _gone;
            this.save({ ...d.state, failed: rest });
          }
          return d.pick;
        } catch (e) {
          // A failure no pull request caused (no tool ready, gh signed out or not there, the network) stops this look and is held
          // against none: the next look tries again, and every one would fail the same way meanwhile.
          if (isWide(e)) {
            const back = { ...d.state, seen: { ...d.state.seen }, count: Math.max(0, d.state.count - 1) };
            if (kept.seen[key]) back.seen[key] = kept.seen[key];
            else delete back.seen[key];
            this.save(back);
            console.error("[security] Scan new PRs waits:", e instanceof Error ? e.message : e);
            return undefined;
          }
          // Not counted against the day, still to scan, and noted, so after a few tries it rests (failedStart).
          skip.add(key);
          kept = failedStart(d.state, d.pick, now, kept.seen[key]);
          this.save(kept);
          console.error("[security] Scan new PRs couldn't start a scan:", e instanceof Error ? e.message : e);
        }
      }
      return undefined;
    } finally {
      this.busy = false;
    }
  }
}
