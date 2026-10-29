/*
  Commit and push, in the thread. Pressing it in the session tray grows the Commit and push chip
  into a card as wide as the thread: the rows rise out of a blur from the bottom up (the base the
  branch left, your commits, then origin), and the status line under them cross-blurs from
  Committing to Pushing to Pushed. While the push runs, the dashed line to origin flows upward;
  when it lands, the ring turns green with a check. Then the card folds back into a Pushed chip,
  with Open a pull request beside it. Each stage holds long enough to read, however fast git is.
*/
import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import type { GitCommit, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "./engine";
import { I } from "./icons";
import { ago, plural } from "./model";

/** 0 the chip, 1 committing, 2 pushing, 3 pushed, 4 folded back into a chip. */
type Stage = 0 | 1 | 2 | 3 | 4;
type Shipment = {
  stage: Stage;
  out?: boolean;
  /** Files in the commit; 0 when there was nothing to commit and it only pushes. */
  files: number;
  subject: string;
  added: number;
  removed: number;
  branch?: string;
  remote?: string | null;
  commits: GitCommit[];
  base?: GitCommit & { branch: string };
  /** How many commits the branch is ahead of the base. */
  ahead?: number;
  /** The commit this made, once git says its sha. */
  fresh?: string;
  error?: string;
};

const runs = new Map<string, Shipment>();
const seen = new Set<() => void>();
const put = (id: string, s: Shipment | null) => {
  if (s) runs.set(id, s);
  else runs.delete(id);
  for (const f of seen) f();
};
const patch = (id: string, p: Partial<Shipment>) => {
  const had = runs.get(id);
  if (had) put(id, { ...had, ...p });
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Waits out what's left of a stage's least hold, so a fast git still reads as steps. */
const holdFrom = (start: number, ms: number) => wait(Math.max(0, ms - (performance.now() - start)));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
  Commits the session's changes (or, with no message, only pushes) and pushes, showing it in the
  thread as it goes. A failure folds the card into a chip that says so.
*/
export async function ship(thread: Thread, commit: { message: string; paths?: string[]; files: number; added: number; removed: number } | null) {
  const id = thread.id;
  const subject = commit?.message.split("\n")[0] ?? "";
  put(id, { stage: 0, files: commit?.files ?? 0, subject, added: commit?.added ?? 0, removed: commit?.removed ?? 0, commits: [] });
  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    patch(id, { stage: 4, error: message });
    toast.error(message);
  };
  try {
    const before = rpc("git.outgoing", { threadId: id }).catch(() => null);
    await wait(reduced() ? 0 : 80);
    let start = performance.now();
    patch(id, { stage: commit ? 1 : 2 });
    const was = await before;
    if (was) patch(id, { branch: was.branch, remote: was.remote, commits: was.commits, base: was.base, ahead: was.ahead });
    if (commit) {
      const r = await rpc("git.commit", { threadId: id, message: commit.message.trim() || undefined, paths: commit.paths });
      patch(id, { fresh: r.sha, files: r.files });
      await holdFrom(start, 1100);
      start = performance.now();
      patch(id, { stage: 2 });
    }
    const now = await rpc("git.outgoing", { threadId: id }).catch(() => null);
    if (now) patch(id, { branch: now.branch, remote: now.remote, commits: now.commits, base: now.base, ahead: now.ahead });
    const p = await rpc("git.push", { threadId: id });
    patch(id, { branch: p.branch, remote: p.remote });
    await holdFrom(start, 1700);
    patch(id, { stage: 3 });
    await wait(reduced() ? 600 : 1500);
    patch(id, { stage: 4 });
  } catch (e) {
    fail(e);
  }
}

/** Puts the card away: it fades, then goes. */
function dismiss(id: string) {
  patch(id, { out: true });
  setTimeout(() => put(id, null), 220);
}

/** The commits as rows, newest first, with the one this made marked new until git names it. */
function rowsOf(s: Shipment): (GitCommit & { fresh?: boolean })[] {
  const list = s.commits.slice(0, 4).map((c) => ({ ...c, fresh: Boolean(s.fresh) && c.sha === s.fresh }));
  if (s.files && !list.some((c) => c.fresh)) list.unshift({ sha: s.fresh ?? "", subject: s.subject, at: Date.now(), fresh: true });
  return list;
}

/** The card, at the end of the thread, while a commit and push runs and after it lands. */
export function ShipCard({ thread }: { thread: Thread }) {
  const s = useSyncExternalStore(
    (f) => (seen.add(f), () => void seen.delete(f)),
    () => runs.get(thread.id),
  );
  // The next turn starts a new chapter: the chip from the last push steps aside.
  useEffect(() => {
    if (s?.stage === 4) dismiss(thread.id);
  }, [thread.turns]);
  if (!s) return null;
  const rows = rowsOf(s);
  const n = Math.max(1, s.files ? rows.length : s.commits.length);
  const remote = s.remote ?? "origin";
  const ahead = s.base && s.ahead ? `, ${plural(s.ahead, "commit")} ahead of ${s.base.branch}` : "";
  const bars = Math.min(5, Math.max(1, Math.round(Math.log2(s.added + s.removed + 1))));
  const red = s.added + s.removed ? Math.round((s.removed / (s.added + s.removed)) * bars) : 0;
  return (
    <div className="lc-ship" data-p={s.stage} data-out={s.out || undefined} data-error={s.error ? "" : undefined} role="status" aria-live="polite">
      <div className="lc-ship-msg">
        <div>
          {!s.error && (
            <p>
              Pushed. <code>{s.branch}</code> is up to date on {remote}
              {ahead}.
            </p>
          )}
        </div>
      </div>
      <div className="lc-ship-wrap">
        <div className="lc-ship-morph">
          <div className="lc-ship-body">
            <div>
              <div className="lc-ship-in">
                <div className="lc-ship-head" style={{ "--d": "120ms" } as CSSProperties}>
                  <span className="lc-ship-ttl">Push</span>
                  {s.branch && <span className="lc-ship-tag">{s.branch}</span>}
                  <span className="lc-ship-sw lc-ship-hsw">
                    <span className="h1">Committing</span>
                    <span className="h2">Pushing</span>
                    <span className="h3">
                      <i />
                      Pushed
                    </span>
                  </span>
                </div>
                <div className="lc-ship-rows">
                  <div className="lc-ship-row" style={{ "--d": `${240 + (rows.length + 1) * 80}ms` } as CSSProperties}>
                    <svg className="lc-ship-rail" viewBox="0 0 30 30" aria-hidden>
                      {s.base && <path d="M8 22V30" className="rm" />}
                      <path d="M20 30V19.5" className="rb dash" />
                      <circle cx="20" cy="15" r="4.5" className="ring" />
                      <path d="M18.2 15.2l1.3 1.3 2.4-2.6" className="ck" />
                    </svg>
                    <span className="t3">
                      To {remote}/{s.branch}
                    </span>
                    <span className="lc-ship-meta lc-ship-sw">
                      <span className="m0">{plural(n, "commit")} to push</span>
                      <span className="m1">up to date</span>
                    </span>
                  </div>
                  {rows.map((c, i) => (
                    <div key={c.fresh ? "fresh" : c.sha} className="lc-ship-row" style={{ "--d": `${240 + (rows.length - i) * 80}ms` } as CSSProperties}>
                      <svg className="lc-ship-rail" viewBox="0 0 30 30" aria-hidden>
                        {s.base && <path d="M8 0V30" className="rm" />}
                        <path d="M20 0V30" className="rb" />
                        <circle cx="20" cy="15" r="3.5" className={c.fresh ? "dot new" : "dot"} />
                      </svg>
                      <span className="lc-ship-sub">{c.subject}</span>
                      <span className="lc-ship-meta">
                        {c.sha || "·······"}
                        <span>{c.fresh ? "You · now" : ago(c.at)}</span>
                      </span>
                    </div>
                  ))}
                  {s.base && (
                    <div className="lc-ship-row" style={{ "--d": "240ms" } as CSSProperties}>
                      <svg className="lc-ship-rail" viewBox="0 0 30 30" aria-hidden>
                        <path d="M8 0V30" className="rm" />
                        <path d="M20 0C20 9 8 7 8 14" className="rb" />
                        <circle cx="8" cy="15" r="3.5" className="dotm" />
                      </svg>
                      <span className="t2 lc-ship-sub">{s.base.subject}</span>
                      <span className="lc-ship-tag" data-m>
                        {s.base.branch}
                      </span>
                      <span className="lc-ship-meta">
                        {s.base.sha}
                        <span>{ago(s.base.at)}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="lc-ship-line">
            <span className="lc-ship-sw">
              <span className="x0">
                <I.push size={14} />
                Commit and push
              </span>
              <span className="x1">
                <span className="lc-ship-spin" aria-hidden />
                <span className="l-shimmer">Committing {plural(s.files, "file")}</span>
              </span>
              <span className="x2">
                <span className="lc-ship-spin" aria-hidden />
                <span className="l-shimmer">
                  Pushing {plural(n, "commit")} to {remote}
                </span>
              </span>
              <span className="x3">
                <I.check size={14} />
                Pushed to {remote}
              </span>
              <span className="x4">
                {s.error ? <I.alert size={14} /> : <I.check size={14} />}
                {s.error ? "The push didn't go through" : `Pushed ${plural(n, "commit")}`}
              </span>
            </span>
            {s.added + s.removed > 0 && (
              <span className="lc-ship-diff">
                <span className="plus">+{s.added}</span>
                <span className="minus">−{s.removed}</span>
                <span className="lc-ship-bars" aria-hidden>
                  {Array.from({ length: 5 }, (_, i) => (
                    <i key={i} data-k={i < bars - red ? "add" : i < bars ? "del" : undefined} />
                  ))}
                </span>
              </span>
            )}
          </div>
        </div>
        {s.error ? (
          <button type="button" className="lc-ship-next lc-btn" data-kind="plain" data-size="sm" title={s.error} onClick={() => dismiss(thread.id)}>
            Dismiss
          </button>
        ) : (
          <button type="button" className="lc-ship-next lc-btn" data-kind="plain" data-size="sm" onClick={() => (dismiss(thread.id), void rpc("thread.send", { id: thread.id, text: "create pr" }).catch((e) => toast.error(String(e?.message ?? e))))}>
            <I.pr size={14} />
            Open a pull request
          </button>
        )}
      </div>
    </div>
  );
}
