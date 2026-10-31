/*
  A snapshot of the working tree before and after every turn, so each turn's changes can be
  shown as a diff and taken back. Snapshots go through a throwaway index, so your staging area
  is never touched, and are kept under refs/liner/ so git's cleanup doesn't drop them.
  Ignored files (node_modules, build output) are left out, as git leaves them out.
*/
import { copyFileSync, existsSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FileChange, FileDiff } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";

let n = 0;
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string) => run("git", args, { cwd, env: { ...process.env, ...env }, input, timeout: 120000 });

/**
  Paths handed to git as names, never as patterns: a file called `*.txt` or `:x` is that file and
  no other (T3 Code's `:(literal)` pathspecs, GitVcsDriver.ts diffCheckpoints).
*/
export const literal = (paths: string[]) => paths.map((p) => `:(literal)${p}`);

/**
  How a patch is asked for when a model reads it, `git apply` takes it or an export keeps it: the
  same whatever your git config says (colors, an external diff tool, textconv filters, other
  prefixes). T3 Code's GitVcsDriverCore.ts PATCH_RENDER_PREFIX_ARGS and REVIEW_DIFF_ARGS.
*/
export const PATCH = ["--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];

/**
  The throwaway index never splits, so writing it can't expire the shared index your own still
  reads, and never asks a file monitor, which knows only your own index (T3 Code's GitVcsDriver.ts
  captureCheckpoint).
*/
const SCRATCH = ["-c", "core.fsmonitor=false", "-c", "core.splitIndex=false", "-c", "splitIndex.sharedIndexExpire=never"];

/**
  A failure that's gone a moment later: another git holding a lock, or a file that went between git
  listing it and reading it (a build writing as the snapshot runs). T3 Code's vcs/VcsProcess.ts
  isTransientGitExit.
*/
const transient = (stderr: string) => /unable to create [^\n]*\.lock['"]?: file exists/i.test(stderr) || /(?:unable to stat|lstat\(|error: open\()[^\n]+: no such file or directory/i.test(stderr);

/** A snapshot's git command, tried twice more when it failed for a moment's reason. */
async function steady(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  for (let i = 0; ; i++) {
    const r = await git(cwd, args, env);
    if (r.code === 0 || i === 2 || !transient(r.stderr)) return r;
    await new Promise((ok) => setTimeout(ok, 75));
  }
}

/**
  A folder git keeps: inside a work tree, and not one its repository ignores (a project in a home
  folder that is a repository ignoring everything gets no snapshots there, so it isn't a Git project).
*/
export async function isRepo(cwd: string) {
  const r = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (r.code !== 0 || r.stdout.trim() !== "true") return false;
  return (await git(cwd, ["check-ignore", "-q", "."])).code !== 0;
}

/**
  Where a project's folder sits in its repository: "" at the top, "web/" for a folder inside one
  (a project in a monorepo, or in a home folder that is a repository itself). Paths here are the
  project's own, as the rest of Liner Code reads them; T3 Code keeps them from the repository's top
  and runs git from there instead.
*/
export async function prefixOf(cwd: string) {
  const r = await git(cwd, ["rev-parse", "--show-prefix"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

/** A path from the repository's top (a checkpoint saved before paths were the project's own) made the project's own. */
export const local = (path: string, prefix: string) => (prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path);

export async function branchOf(cwd: string) {
  const r = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

/**
  Starts the throwaway index from a copy of the repo's own, so `git add -A` reads only the files
  whose size or time changed since git last looked. Started from HEAD alone it reads every file,
  twice a turn: seconds on a large repo. A copy that marks files to be passed over
  (assume-unchanged, skip-worktree, a sparse checkout) would hide their changes, so then it
  starts from HEAD after all.
*/
async function seed(cwd: string, index: string, env: NodeJS.ProcessEnv, head: boolean) {
  try {
    const own = resolve(cwd, (await git(cwd, ["rev-parse", "--git-path", "index"])).stdout.trim());
    // Git trusts a file's size and time only when it's older than the index that recorded them. A
    // copy made now would vouch for a same-size edit made in the second the real index was written,
    // so the copy is dated a second before its source (T3 Code's GitVcsDriver.ts captureCheckpoint).
    const time = Math.floor(statSync(own).mtimeMs / 1000) - 1;
    if (time > 0) {
      copyFileSync(own, index);
      utimesSync(index, time, time);
      const tags = await git(cwd, [...SCRATCH, "ls-files", "-v"], env);
      if (tags.code === 0 && !/^(?:[a-z]|S) /m.test(tags.stdout)) return;
    }
  } catch {
    // no index yet
  }
  rmSync(index, { force: true });
  if (head) await git(cwd, [...SCRATCH, "read-tree", "HEAD"], env);
}

/**
  `git add -A` into the throwaway index. A folder in the project that's a repository of its own with
  no commit yet stops it ("does not have a commit checked out"), so then it's added again without
  those folders (T3 Code's GitVcsDriver.ts stageFiles).
*/
async function stage(cwd: string, env: NodeJS.ProcessEnv) {
  const add = (skip: string[]) => steady(cwd, [...SCRATCH, "add", "-A", "--", ".", ...skip], env);
  if ((await add([])).code === 0) return true;
  const others = await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."], env);
  if (others.code !== 0) return false;
  // Git lists a repository inside as its folder, with a slash; a few dozen at most are worth looking at.
  const folders = others.stdout.split("\0").filter((p) => p.endsWith("/"));
  if (!folders.length || folders.length > 64) return false;
  const skip: string[] = [];
  for (const folder of folders) {
    const sub = join(cwd, folder);
    if (!existsSync(join(sub, ".git"))) continue;
    const head = await git(sub, ["rev-parse", "--verify", "-q", "HEAD"], { GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined });
    if (head.code !== 0) skip.push(`:(exclude,literal)${folder}`);
  }
  return skip.length > 0 && (await add(skip)).code === 0;
}

/** Captures the working tree as a commit under refs/liner/<name>. Returns the commit, or null. */
export async function capture(cwd: string, name: string): Promise<string | null> {
  const index = join(tmpdir(), `liner-index-${process.pid}-${n++}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    const head = await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
    await seed(cwd, index, env, head.code === 0);
    if (!(await stage(cwd, env))) return null;
    const tree = (await steady(cwd, [...SCRATCH, "write-tree"], env)).stdout.trim();
    if (!tree) return null;
    // HEAD is the parent, so a turn that moved HEAD can be told from one that didn't (authoredPaths).
    const args = ["commit-tree", tree, "-m", `Liner Code checkpoint ${name}`];
    if (head.code === 0) args.splice(2, 0, "-p", head.stdout.trim());
    const commit = (await git(cwd, args, { GIT_AUTHOR_NAME: "Liner Code", GIT_AUTHOR_EMAIL: "checkpoints@liner.local", GIT_COMMITTER_NAME: "Liner Code", GIT_COMMITTER_EMAIL: "checkpoints@liner.local" })).stdout.trim();
    if (!commit) return null;
    if ((await steady(cwd, ["update-ref", `refs/liner/${name}`, commit])).code !== 0) return null;
    return commit;
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

/**
  `git diff --numstat -z`, path by path. A rename's counts come with an empty path, then its old and
  new paths as records of their own (T3 Code's checkpointing/Diffs.ts parseTurnDiffFilesFromNumstat).
  Without -z, git quotes a name like café.txt as "caf\303\251.txt", which matches no file.
*/
export function numstat(out: string) {
  const counts = new Map<string, [number, number]>();
  const rec = out.split("\0");
  for (let i = 0; i < rec.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(rec[i]);
    if (!m) continue;
    let path = rec[i].slice(m[0].length);
    if (!path) {
      path = rec[i + 2] ?? "";
      i += 2;
    }
    if (path) counts.set(path, [m[1] === "-" ? 0 : Number(m[1]), m[2] === "-" ? 0 : Number(m[2])]);
  }
  return counts;
}

/**
  What changed between two snapshots, file by file, with line counts, by paths in the project's
  folder. With `turn`, only what the turn itself wrote: a pull, merge or checkout during it brings
  files it didn't (see authoredPaths).
*/
export async function changes(cwd: string, from: string, to: string, o: { turn?: boolean } = {}): Promise<FileChange[]> {
  const args = ["diff", "--relative", "--no-ext-diff", "--no-textconv", "-M", "-z"];
  const [num, names, authored] = await Promise.all([git(cwd, [...args, "--numstat", from, to]), git(cwd, [...args, "--name-status", from, to]), o.turn ? authoredPaths(cwd, from, to) : null]);
  const counts = numstat(num.stdout);
  const out: FileChange[] = [];
  // -z: a status, then its path, or for a rename or copy the old path and the new one.
  const rec = names.stdout.split("\0");
  for (let i = 0; i < rec.length; i++) {
    const code = rec[i][0];
    if (!code || !/^[ACDMRTUX]/.test(rec[i])) continue;
    const two = code === "R" || code === "C";
    const was = two ? rec[i + 1] : undefined;
    const path = rec[i + (two ? 2 : 1)];
    i += two ? 2 : 1;
    if (!path) continue;
    const [added, removed] = counts.get(path) ?? [0, 0];
    const status = code === "A" || code === "C" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified";
    out.push({ path, status, added, removed, ...(code === "R" ? { from: was } : {}) });
  }
  // T3 Code's checkpointing/Diffs.ts isGitImport: a file neither of whose paths the turn wrote came in with HEAD.
  return authored ? out.filter((f) => authored.has(f.path) || (f.from !== undefined && authored.has(f.from))) : out;
}

/**
  The paths a turn wrote itself when HEAD moved under it (a pull, merge, checkout or rebase), by the
  project's own paths; null when HEAD stayed put, so every change is the turn's. Each snapshot's
  parent is the HEAD it was taken on. What differed from HEAD at either end is the turn's (or
  yours); of the commits that came or went, those made during the turn count, and of a merge only
  its conflict fixes. T3 Code's GitVcsDriver.ts listAuthoredPaths.
*/
export async function authoredPaths(cwd: string, from: string, to: string): Promise<Set<string> | null> {
  const heads = await git(cwd, ["log", "--no-walk=unsorted", "--format=%P %ct", `${from}^{commit}`, `${to}^{commit}`]);
  if (heads.code !== 0) return null;
  const [fromLine = "", toLine = ""] = heads.stdout.trimEnd().split("\n");
  const [start = "", at = ""] = fromLine.split(" ");
  const [end = ""] = toLine.split(" ");
  if (!start || !end || start === end) return null;
  const list = async (args: string[]) => {
    const r = await git(cwd, [...args, "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-relative"]);
    if (r.code !== 0) throw new Error(r.stderr);
    return r.stdout.split("\0");
  };
  try {
    const lists = await Promise.all([
      list(["diff", start, `${from}^{commit}`]),
      list(["diff", end, `${to}^{commit}`]),
      // Remerge diffs keep a merge's conflict fixes and leave out what merged cleanly.
      list(["log", "--format=", "--diff-merges=remerge", `${end}..${start}`]),
      list(["log", "--format=", "--diff-merges=remerge", `--since=@${at}`, `${start}..${end}`]),
    ]);
    const prefix = await prefixOf(cwd);
    return new Set(lists.flat().flatMap((p) => (!p ? [] : !prefix ? [p] : p.startsWith(prefix) ? [p.slice(prefix.length)] : [])));
  } catch {
    // An older git without remerge diffs: every change counts, as before.
    return null;
  }
}

const MAX = 400_000;
async function show(cwd: string, rev: string, path: string) {
  // rev:./path reads from this folder; rev:path would read from the repository's top.
  const r = await git(cwd, ["show", `${rev}:./${path}`]);
  if (r.code !== 0) return undefined;
  return r.stdout.length > MAX ? `${r.stdout.slice(0, MAX)}\n… (cut off: the file is larger than the diff view shows)` : r.stdout;
}

/** Each changed file's text before and after, for the diff card. */
export async function diffFiles(cwd: string, from: string, to: string, files: FileChange[]): Promise<FileDiff[]> {
  const prefix = await prefixOf(cwd);
  return Promise.all(
    files.slice(0, 60).map(async (f) => ({
      path: f.path,
      from: f.from,
      before: f.status === "added" ? undefined : await show(cwd, from, local(f.from ?? f.path, prefix)),
      after: f.status === "deleted" ? undefined : await show(cwd, to, local(f.path, prefix)),
    })),
  );
}

/**
  Puts the files a turn changed back the way they were before it. Binary files come back intact.
  Throws when it can't, so a turn is never marked undone that wasn't.
*/
export async function restore(cwd: string, from: string, files: FileChange[]) {
  if (!existsSync(cwd)) throw new Error(`${cwd} isn't there any more, so nothing could be put back.`);
  if ((await git(cwd, ["cat-file", "-e", `${from}^{commit}`])).code !== 0) throw new Error("The snapshot from before that turn is gone from the repository, so its files can't be put back.");
  const index = join(tmpdir(), `liner-index-${process.pid}-${n++}`);
  try {
    const prefix = await prefixOf(cwd);
    const back = new Set<string>();
    const drop: string[] = [];
    for (const f of files) {
      if (f.status === "added" || f.status === "renamed") drop.push(local(f.path, prefix));
      if (f.status !== "added") back.add(local(f.from ?? f.path, prefix));
    }
    // Checked out first, so a failure leaves the turn's new files where they are. Through a
    // throwaway index, so your staging area is never touched.
    if (back.size) {
      const r = await git(cwd, ["checkout", from, "--", ...literal([...back])], { GIT_INDEX_FILE: index });
      if (r.code !== 0) throw new Error(`git couldn't put the files back: ${(r.stderr || r.stdout).trim().split("\n").pop() || `exit ${r.code}`}`);
    }
    // A path that's both (a rename onto a name another file left) was just put back, so it stays.
    for (const p of drop) if (!back.has(p)) rmSync(join(cwd, p), { force: true });
  } finally {
    rmSync(index, { force: true });
  }
}

/** A turn to take back: the snapshots around it and the files it changed. */
export type Undo = { from: string; to?: string; files: FileChange[] };

/**
  Of the files these turns changed (newest turn first), the ones that are different now from how
  the newest turn that touched each left it: you edited them since, or a later turn did.
*/
export async function edited(cwd: string, now: string, turns: Undo[]): Promise<string[]> {
  const prefix = await prefixOf(cwd);
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const t of turns) {
    const paths = [...new Set(t.files.flatMap((f) => [f.path, ...(f.from ? [f.from] : [])]).map((p) => local(p, prefix)))].filter((p) => !seen.has(p));
    for (const p of paths) seen.add(p);
    if (!t.to || !paths.length) continue;
    const r = await git(cwd, ["diff", "--name-only", "-z", "--no-renames", "--relative", "--no-ext-diff", t.to, now, "--", ...literal(paths)]);
    if (r.code !== 0) throw new Error(`git couldn't compare the files with that turn: ${r.stderr.trim().split("\n").pop()}`);
    for (const p of r.stdout.split("\0")) if (p) out.add(p);
  }
  return [...out];
}

/**
  Takes turns back, newest first. The folder as it is now is kept first as a snapshot (returned),
  so the undo can be undone too. Unless `force`, nothing is put back when a file the turns touched
  changed after them, since that change would be lost.
*/
export async function undo(cwd: string, name: string, turns: Undo[], force = false): Promise<string> {
  if (!existsSync(cwd)) throw new Error(`${cwd} isn't there any more, so nothing could be put back.`);
  const now = await capture(cwd, name);
  if (!now) throw new Error("Couldn't take a snapshot of the files as they are now, so nothing was put back.");
  if (!force) {
    const changed = await edited(cwd, now, turns);
    if (changed.length) {
      const shown = changed.length > 6 ? `${changed.slice(0, 6).join(", ")} and ${changed.length - 6} more` : changed.join(", ");
      throw new Error(`Changed after that turn: ${shown}. Putting the turn back would overwrite ${changed.length === 1 ? "that change" : "those changes"}, so nothing was put back.`);
    }
  }
  try {
    for (const t of turns) await restore(cwd, t.from, t.files);
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)} The files as they were are kept in refs/liner/${name}.`);
  }
  return now;
}

/** Drops a thread's snapshots once the thread is gone. */
export async function forget(cwd: string, prefix: string) {
  const r = await git(cwd, ["for-each-ref", "--format=%(refname)", `refs/liner/${prefix}`]);
  for (const ref of r.stdout.split("\n").filter(Boolean)) await git(cwd, ["update-ref", "-d", ref]);
}
