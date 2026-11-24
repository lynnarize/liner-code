/*
  The worktrees Liner Code makes for sessions: their submodules checked out, put back when a
  session comes back to one that's gone, and let go only when nothing in them would be lost.
  T3 Code's storageCleanup.ts, vcs/worktreeRemoval.ts and orchestration-v2/ProviderTurnStartService.ts.
*/
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { run } from "./exec.ts";

/**
  Resolves where a new worktree directory should be created: either under Liner's external
  `defaultRoot` ("sibling") or inside `<repoRoot>/.worktrees/<tid>` ("inside", automatically
  appending `.worktrees/` to `.git/info/exclude` so the repo stays clean).
*/
export function resolveWorktreePath(repoRoot: string, tid: string, defaultRoot: string, place?: "sibling" | "inside"): string {
  if (place === "inside") {
    const dir = join(repoRoot, ".worktrees");
    mkdirSync(dir, { recursive: true });
    try {
      const exclude = join(repoRoot, ".git", "info", "exclude");
      if (existsSync(exclude)) {
        const cur = readFileSync(exclude, "utf8");
        if (!cur.split(/\r?\n/).some((l) => l.trim() === ".worktrees" || l.trim() === ".worktrees/")) {
          appendFileSync(exclude, `${cur.endsWith("\n") ? "" : "\n"}.worktrees/\n`);
        }
      }
    } catch {
      // Non-standard .git file or read-only info/exclude: worktree still works.
    }
    return join(dir, tid);
  }
  mkdirSync(defaultRoot, { recursive: true });
  return join(defaultRoot, tid);
}

/** Deterministic per-worktree port offset (1..499) passed as LINER_WORKTREE_PORT_OFFSET so parallel previews don't collide. */
export function portOffsetFor(tid: string): number {
  const hash = createHash("sha256").update(tid).digest();
  return 1 + (hash.readUInt16BE(0) % 499);
}

/** Returns the real path of `<root>/.liner/worktree-setup.sh` if it exists as a regular file inside `root`. */
export function worktreeHookPath(root: string): string | null {
  const candidate = join(root, ".liner", "worktree-setup.sh");
  if (!existsSync(candidate)) return null;
  try {
    const st = lstatSync(candidate);
    if (!st.isFile() || st.isSymbolicLink()) return null;
    const realRoot = realpathSync(root);
    const realFile = realpathSync(candidate);
    const rel = relative(realRoot, realFile);
    if (!rel || rel.startsWith("..") || resolve(realRoot, rel) !== realFile) return null;
    return realFile;
  } catch {
    return null;
  }
}

// Nothing here can wait on a password prompt nobody sees.
const git = (cwd: string, args: string[], timeout = 120000) => run("git", args, { cwd, timeout, input: "", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const lastLine = (r: { stdout: string; stderr: string }) => (r.stderr || r.stdout).trim().split("\n").pop()?.replace(/^(?:fatal|error):\s*/, "");

/**
  A new worktree's submodules, which `git worktree add` leaves empty: the project's tools or source
  may be in them (T3 Code's GitVcsDriverCore.ts createWorktree). Returns what went wrong, or null.
*/
export async function submodules(root: string): Promise<string | null> {
  if (!existsSync(join(root, ".gitmodules"))) return null;
  const r = await git(root, ["submodule", "update", "--init"], 10 * 60_000);
  return r.code === 0 ? null : lastLine(r) || "git submodule update failed";
}

/**
  Why a worktree has to stay for what's in it: changes not committed, untracked files included.
  null when there are none (T3 Code's storageCleanup.ts localChangesReason).
*/
export async function localChanges(root: string): Promise<string | null> {
  const r = await git(root, ["status", "--porcelain=v1", "-z", "--ignore-submodules=none", "--untracked-files=all"]);
  if (r.code !== 0) return `git couldn't read what's in it (${lastLine(r) || `exit ${r.code}`})`;
  const rec = r.stdout.split("\0").filter(Boolean);
  let count = 0;
  for (let i = 0; i < rec.length; i++) {
    count++;
    // A rename's or copy's old path is a record of its own.
    if (/^[RC]|^.[RC]/.test(rec[i])) i++;
  }
  return count ? `it has changes that aren't committed (${count} ${count === 1 ? "file" : "files"})` : null;
}

/**
  Removes a worktree once nothing in it would be lost, and never with --force: one with changes
  stays, and git itself refuses one that's locked or holds submodules. Its branch stays either way.
  Returns why it stayed, or null once it's gone. `repo` is the project's own checkout.
*/
export async function removeWorktree(repo: string, root: string): Promise<string | null> {
  if (!existsSync(root)) {
    await git(repo, ["worktree", "prune"]);
    return null;
  }
  const changes = await localChanges(root);
  if (changes) return changes;
  // git's own check passes untracked files over when status.showUntrackedFiles is "no", and would delete them (T3 Code's vcs/worktreeRemoval.ts).
  const r = await git(repo, ["-c", "status.showUntrackedFiles=normal", "worktree", "remove", "--", root]);
  return r.code === 0 ? null : lastLine(r) || "git wouldn't remove it";
}

/**
  Puts a session's worktree back where it was, on its branch; when the branch is gone too, a new one
  of that name from where the project's checkout is (T3 Code's orchestration-v2/ProviderTurnStartService.ts
  recreateMissingWorktree). Throws when git can't.
*/
export async function recreateWorktree(repo: string, root: string, branch: string) {
  // A worktree deleted by hand is still registered until it's pruned, and git won't add one there.
  await git(repo, ["worktree", "prune"]);
  const has = (await git(repo, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).code === 0;
  const r = await git(repo, has ? ["worktree", "add", "--", root, branch] : ["worktree", "add", "-b", branch, "--", root, "HEAD"], 10 * 60_000);
  if (r.code !== 0) throw new Error(`Couldn't put the worktree back at ${root} on ${branch}: ${lastLine(r) || `exit ${r.code}`}`);
}
