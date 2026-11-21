/*
  What changes while nobody is looking: a session's pull request merges, its checks finish,
  someone replies, or nothing has happened for days. Every minute the engine looks, then
  settles sessions into Done or wakes snoozed ones, as Settings says. A pull request whose
  saved checks read running is looked at too, so its row doesn't say "Checks running" forever.
*/
import type { Thread } from "../../contracts/src/index.ts";
import { keptSince, prChecksOf, sameChecks } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";
import { ghCheck } from "./surfaces.ts";
import type { Store } from "./store.ts";

const EVERY = 60_000;
/** How long checks first read running are followed for their own sake: a run that never ends isn't read from gh forever. */
export const CHECKS_FOR = 2 * 3600_000;

export class Watch {
  private timer: NodeJS.Timeout | null = null;
  /** A tick still waiting on gh when the next minute comes, so two never follow the same pull request at once. */
  private ticking = false;
  private store: Store;
  private env: NodeJS.ProcessEnv;
  /** Whether something works in a checkout now (a session's turn, a routine run), so it isn't pulled under it. */
  private busy: (path: string) => boolean;
  constructor(store: Store, env: NodeJS.ProcessEnv, busy: (path: string) => boolean = () => false) {
    this.store = store;
    this.env = env;
    this.busy = busy;
  }
  start() {
    this.timer = setInterval(() => void this.tick(), EVERY);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private cwd(t: Thread) {
    return t.worktree?.path ?? this.store.project(t.projectId).path;
  }

  private settle(t: Thread, reason: string) {
    this.store.patchThread(t.id, { done: true, unread: false });
    this.store.emit({ type: "settled", threadId: t.id, reason });
  }

  /**
    Fast-forwards each project's default branch when its checkout sits on it, clean, and nothing
    works in it: pulled under a turn, what came in would read as that turn's change.
  */
  private pulled = new Map<string, number>();
  private async pull() {
    if (!this.store.settings.autoPull) return;
    for (const p of this.store.projects) {
      if (!p.git || this.busy(p.path) || Date.now() - (this.pulled.get(p.id) ?? 0) < 15 * 60_000) continue;
      this.pulled.set(p.id, Date.now());
      const opts = { cwd: p.path, env: this.env, timeout: 60000 };
      const [status, branch, head] = await Promise.all([run("git", ["status", "--porcelain"], opts), run("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts), run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], opts)]);
      const main = head.stdout.trim().replace(/^origin\//, "") || "main";
      if (status.code !== 0 || status.stdout.trim() || branch.stdout.trim() !== main || this.busy(p.path)) continue;
      await run("git", ["pull", "--ff-only", "--quiet"], opts);
    }
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const s = this.store.settings;
      const now = Date.now();
      void this.pull().catch(() => {});
      for (const t of this.store.threads) {
        if (t.archived) continue;
        try {
          // Nothing has happened for days and nothing waits on you: it settles into Done.
          if (s.settleDays > 0 && !t.done && !t.pinned && t.status === "done" && !t.toReview && !t.unread && !t.agentsAtWork && now - t.updatedAt > s.settleDays * 86400000) this.settle(t, `Nothing happened for ${s.settleDays} days`);
          // Checks still running are followed on their own too, but only their facts change for that: nothing settles or wakes.
          const running = t.pr?.checks?.state === "running" && now - (t.pr.checks.since ?? now) < CHECKS_FOR;
          if (t.pr && t.pr.state === "OPEN" && (s.settleOnMerge || t.wake || running)) await this.followPr(t);
        } catch {
          // gh is offline or the project moved; try again next minute
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async followPr(t: Thread) {
    const r = await run("gh", ["pr", "view", String(t.pr!.number), "--json", "state,statusCheckRollup,comments,reviews"], { cwd: this.cwd(t), env: this.env, timeout: 30000 });
    if (r.code !== 0) return;
    const v = JSON.parse(r.stdout) as { state: string; statusCheckRollup?: { status?: string; state?: string; conclusion?: string }[]; comments?: unknown[]; reviews?: unknown[] };
    // How its checks stand comes with the read it makes anyway, so the session's row says it as of this minute (prChecksOf).
    // Running, when they were first read so is kept with the session (keptSince): the two hours above outlast a restart.
    const checks = keptSince(t.pr!.checks, prChecksOf((v.statusCheckRollup ?? []).map(ghCheck)));
    if (v.state !== t.pr!.state || !sameChecks(t.pr!.checks, checks) || t.pr!.checks?.since !== checks?.since) this.store.patchThread(t.id, { pr: { number: t.pr!.number, url: t.pr!.url, state: v.state, ...(checks ? { checks } : {}) } });
    const wake = (why: string) => {
      this.store.patchThread(t.id, { snoozedUntil: undefined, wake: undefined, unread: true });
      this.store.emit({ type: "notify", threadId: t.id, kind: "done", title: why, body: t.title });
    };
    // Once it's closed nothing follows it any more, so what waited on it would sleep out its thirty days.
    const over = v.state === "MERGED" || v.state === "CLOSED";
    if (over && t.wake) wake(`#${t.pr!.number} ${v.state === "MERGED" ? "merged" : "was closed"}`);
    if (v.state === "MERGED" && this.store.settings.settleOnMerge && !t.done && !t.agentsAtWork) return this.settle(t, `#${t.pr!.number} merged`);
    if (!t.wake || over) return;
    if (t.wake.kind === "checks") {
      const checks = v.statusCheckRollup ?? [];
      const pending = checks.some((c) => /PENDING|QUEUED|IN_PROGRESS|EXPECTED/.test((c.status || c.state || "").toUpperCase()) && !c.conclusion);
      if (checks.length && !pending) wake(`Checks finished on #${t.pr!.number}`);
    } else {
      const count = (v.comments?.length ?? 0) + (v.reviews?.length ?? 0);
      // Kept with the session: counted afresh after a restart, a reply that came while Liner Code was shut would be taken as the start.
      if (t.wake.seen === undefined) this.store.patchThread(t.id, { wake: { ...t.wake, seen: count } });
      else if (count > t.wake.seen) wake(`Someone replied on #${t.pr!.number}`);
    }
  }
}
