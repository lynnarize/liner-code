/*
  A snapshot of the working tree before and after every turn, so each turn's changes can be
  shown as a diff and taken back. Snapshots go through a throwaway index, so your staging area
  is never touched, and are kept under refs/liner/ so git's cleanup doesn't drop them.
  Ignored files (node_modules, build output) are left out, as git leaves them out.
*/
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileChange, FileDiff } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";

let n = 0;
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string) => run("git", args, { cwd, env: { ...process.env, ...env }, input, timeout: 120000 });

export async function isRepo(cwd: string) {
  const r = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function branchOf(cwd: string) {
  const r = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

/** Captures the working tree as a commit under refs/liner/<name>. Returns the commit, or null. */
export async function capture(cwd: string, name: string): Promise<string | null> {
  const index = join(tmpdir(), `liner-index-${process.pid}-${n++}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    const head = await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
    if (head.code === 0) await git(cwd, ["read-tree", "HEAD"], env);
    const add = await git(cwd, ["add", "-A", "--", "."], env);
    if (add.code !== 0) return null;
    const tree = (await git(cwd, ["write-tree"], env)).stdout.trim();
    if (!tree) return null;
    const args = ["commit-tree", tree, "-m", `Liner Code checkpoint ${name}`];
    if (head.code === 0) args.splice(2, 0, "-p", head.stdout.trim());
    const commit = (await git(cwd, args, { GIT_AUTHOR_NAME: "Liner Code", GIT_AUTHOR_EMAIL: "checkpoints@liner.local", GIT_COMMITTER_NAME: "Liner Code", GIT_COMMITTER_EMAIL: "checkpoints@liner.local" })).stdout.trim();
    if (!commit) return null;
    await git(cwd, ["update-ref", `refs/liner/${name}`, commit]);
    return commit;
  } finally {
    rmSync(index, { force: true });
  }
}

/** What changed between two snapshots, file by file, with line counts. */
export async function changes(cwd: string, from: string, to: string): Promise<FileChange[]> {
  const [num, names] = await Promise.all([git(cwd, ["diff", "--numstat", "-M", from, to]), git(cwd, ["diff", "--name-status", "-M", from, to])]);
  const counts = new Map<string, [number, number]>();
  for (const line of num.stdout.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    // Renames show as "old => new" or "dir/{old => new}"; keep the new path.
    const path = m[3].replace(/\{[^}]* => ([^}]*)\}/, "$1").replace(/^.* => /, "");
    counts.set(path, [m[1] === "-" ? 0 : Number(m[1]), m[2] === "-" ? 0 : Number(m[2])]);
  }
  const out: FileChange[] = [];
  for (const line of names.stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const code = parts[0][0];
    const path = parts[parts.length - 1];
    const [added, removed] = counts.get(path) ?? [0, 0];
    const status = code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified";
    out.push({ path, status, added, removed, ...(code === "R" ? { from: parts[1] } : {}) });
  }
  return out;
}

const MAX = 400_000;
async function show(cwd: string, rev: string, path: string) {
  const r = await git(cwd, ["show", `${rev}:${path}`]);
  if (r.code !== 0) return undefined;
  return r.stdout.length > MAX ? `${r.stdout.slice(0, MAX)}\n… (cut off: the file is larger than the diff view shows)` : r.stdout;
}

/** Each changed file's text before and after, for the diff card. */
export async function diffFiles(cwd: string, from: string, to: string, files: FileChange[]): Promise<FileDiff[]> {
  return Promise.all(
    files.slice(0, 60).map(async (f) => ({
      path: f.path,
      from: f.from,
      before: f.status === "added" ? undefined : await show(cwd, from, f.from ?? f.path),
      after: f.status === "deleted" ? undefined : await show(cwd, to, f.path),
    })),
  );
}

/** Puts the files a turn changed back the way they were before it. Binary files come back intact. */
export async function restore(cwd: string, from: string, files: FileChange[]) {
  const index = join(tmpdir(), `liner-index-${process.pid}-${n++}`);
  try {
    const back: string[] = [];
    for (const f of files) {
      if (f.status === "added" || f.status === "renamed") rmSync(join(cwd, f.path), { force: true });
      if (f.status !== "added") back.push(f.from ?? f.path);
    }
    // Checking out through a throwaway index writes the files without touching your staging area.
    if (back.length) await git(cwd, ["checkout", from, "--", ...back], { GIT_INDEX_FILE: index });
  } finally {
    rmSync(index, { force: true });
  }
}

/** Drops a thread's snapshots once the thread is gone. */
export async function forget(cwd: string, prefix: string) {
  const r = await git(cwd, ["for-each-ref", "--format=%(refname)", `refs/liner/${prefix}`]);
  for (const ref of r.stdout.split("\n").filter(Boolean)) await git(cwd, ["update-ref", "-d", ref]);
}

