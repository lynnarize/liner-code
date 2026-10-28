/*
  What changes while nobody is looking: a session's pull request merges, its checks finish,
  someone replies, or nothing has happened for days. Every minute the engine looks, then
  settles sessions into Done or wakes snoozed ones, as Settings says.
*/
import type { Thread } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";
import type { Store } from "./store.ts";

const EVERY = 60_000;

export class Watch {
  private timer: NodeJS.Timeout | null = null;
  /** Comments and reviews on a pull request when its session was snoozed until someone replies. */
  private baseline = new Map<string, number>();
  private store: Store;
  private env: NodeJS.ProcessEnv;
  constructor(store: Store, env: NodeJS.ProcessEnv) {
    this.store = store;
    this.env = env;
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

  /** Fast-forwards each project's default branch when its checkout sits on it, clean. */
  private pulled = new Map<string, number>();
  private async pull() {
    if (!this.store.settings.autoPull) return;
    for (const p of this.store.projects) {
      if (!p.git || Date.now() - (this.pulled.get(p.id) ?? 0) < 15 * 60_000) continue;
      this.pulled.set(p.id, Date.now());
      const opts = { cwd: p.path, env: this.env, timeout: 60000 };
      const [status, branch, head] = await Promise.all([run("git", ["status", "--porcelain"], opts), run("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts), run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], opts)]);
      const main = head.stdout.trim().replace(/^origin\//, "") || "main";
      if (status.code !== 0 || status.stdout.trim() || branch.stdout.trim() !== main) continue;
      await run("git", ["pull", "--ff-only", "--quiet"], opts);
    }
  }

  async tick() {
    const s = this.store.settings;
    const now = Date.now();
    void this.pull().catch(() => {});
    for (const t of this.store.threads) {
      if (t.archived) continue;
      try {
        // Nothing has happened for days and nothing waits on you: it settles into Done.
        if (s.settleDays > 0 && !t.done && !t.pinned && t.status === "done" && !t.toReview && !t.unread && now - t.updatedAt > s.settleDays * 86400000) this.settle(t, `Nothing happened for ${s.settleDays} days`);
        if (t.pr && t.pr.state === "OPEN" && (s.settleOnMerge || t.wake)) await this.followPr(t);
      } catch {
        // gh is offline or the project moved; try again next minute
      }
    }
  }

  private async followPr(t: Thread) {
    const r = await run("gh", ["pr", "view", String(t.pr!.number), "--json", "state,statusCheckRollup,comments,reviews"], { cwd: this.cwd(t), env: this.env, timeout: 30000 });
    if (r.code !== 0) return;
    const v = JSON.parse(r.stdout) as { state: string; statusCheckRollup?: { status?: string; state?: string; conclusion?: string }[]; comments?: unknown[]; reviews?: unknown[] };
    if (v.state !== t.pr!.state) this.store.patchThread(t.id, { pr: { ...t.pr!, state: v.state } });
    if (v.state === "MERGED" && this.store.settings.settleOnMerge && !t.done) return this.settle(t, `#${t.pr!.number} merged`);
    if (!t.wake) return;
    const wake = (why: string) => {
      this.store.patchThread(t.id, { snoozedUntil: undefined, wake: undefined, unread: true });
      this.store.emit({ type: "notify", threadId: t.id, kind: "done", title: why, body: t.title });
    };
    if (t.wake.kind === "checks") {
      const checks = v.statusCheckRollup ?? [];
      const pending = checks.some((c) => /PENDING|QUEUED|IN_PROGRESS|EXPECTED/.test((c.status || c.state || "").toUpperCase()) && !c.conclusion);
      if (checks.length && !pending) wake(`Checks finished on #${t.pr!.number}`);
    } else {
      const count = (v.comments?.length ?? 0) + (v.reviews?.length ?? 0);
      const before = this.baseline.get(t.id);
      if (before === undefined) this.baseline.set(t.id, count);
      else if (count > before) {
        this.baseline.delete(t.id);
        wake(`Someone replied on #${t.pr!.number}`);
      }
    }
  }
}
