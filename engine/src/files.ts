/*
  The project's files, for @ mentions and the Files panel. In a git repo it is what git sees
  (tracked plus new, minus ignored); elsewhere a shallow walk that skips the usual heavy folders.
*/
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FileChange, TreeEntry } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";
import { numstat } from "./checkpoints.ts";

const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".cache", "target", ".DS_Store", ".turbo", "coverage"]);

export async function listFiles(root: string, limit = 20000): Promise<string[]> {
  // -z: without it git quotes a name like café.txt as "caf\303\251.txt", which matches no file.
  const r = await run("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, timeout: 15000 });
  if (r.code === 0) return r.stdout.split("\0").filter(Boolean).slice(0, limit);
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 8) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs, depth + 1);
      else out.push(relative(root, abs));
      if (out.length >= limit) return;
    }
  };
  walk(root, 0);
  return out;
}

/** Subsequence match on the path, better for hits in the file name. */
function score(query: string, path: string) {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const name = p.slice(p.lastIndexOf("/") + 1);
  if (name.startsWith(q)) return 3;
  if (name.includes(q)) return 2;
  let i = 0;
  for (const c of p) if (c === q[i]) i++;
  return i === q.length ? 1 : 0;
}

export async function findFiles(root: string, query = "", limit = 40) {
  const files = await listFiles(root);
  const picked = query ? files.map((f) => [f, score(query, f)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).map(([f]) => f) : files;
  return picked.slice(0, limit).map((path) => {
    let size = 0;
    try {
      size = statSync(join(root, path)).size;
    } catch {
      // gone since git listed it
    }
    return { path, size };
  });
}

export async function tree(root: string): Promise<TreeEntry[]> {
  const files = await listFiles(root, 5000);
  const top: TreeEntry[] = [];
  const dirs = new Map<string, TreeEntry>();
  const dirOf = (path: string): TreeEntry[] => {
    if (!path) return top;
    let d = dirs.get(path);
    if (!d) {
      const i = path.lastIndexOf("/");
      d = { path, dir: true, children: [] };
      dirs.set(path, d);
      dirOf(i < 0 ? "" : path.slice(0, i)).push(d);
    }
    return d.children!;
  };
  for (const f of files) {
    const i = f.lastIndexOf("/");
    dirOf(i < 0 ? "" : f.slice(0, i)).push({ path: f, dir: false });
  }
  const sort = (list: TreeEntry[]) => {
    list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path));
    for (const e of list) if (e.children) sort(e.children);
  };
  sort(top);
  return top;
}

export async function gitStatus(root: string) {
  const [st, num] = await Promise.all([run("git", ["status", "--porcelain=v1", "-b", "-z"], { cwd: root }), run("git", ["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "HEAD"], { cwd: root })]);
  if (st.code !== 0) return { ahead: 0, behind: 0, changes: [] as FileChange[] };
  const rec = st.stdout.split("\0");
  const head = rec[0]?.startsWith("## ") ? rec.shift()!.slice(3) : "";
  const branch = head.split("...")[0].replace(/^No commits yet on /, "");
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
  const counts = numstat(num.stdout);
  const changes: FileChange[] = [];
  for (let i = 0; i < rec.length; i++) {
    if (!rec[i]) continue;
    const code = rec[i].slice(0, 2);
    const path = rec[i].slice(3);
    // -z: a rename's old path comes after it, as a record of its own.
    if (/[RC]/.test(code)) i++;
    const [added, removed] = counts.get(path) ?? [0, 0];
    const status = code.includes("?") || code.includes("A") ? "added" : code.includes("D") ? "deleted" : code.includes("R") ? "renamed" : "modified";
    changes.push({ path, status, added, removed });
  }
  return { branch, ahead, behind, changes };
}
