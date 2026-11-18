/*
  Your own changes go along: what changed in the session's folder between its last turn and this one, said to the agent ahead
  of your message, so it doesn't work from a stale read of a file you edited or write over your edit (Devin's "Share user
  edits"). Liner snapshots the folder before and after every turn (checkpoints.ts), so this costs a git diff of two snapshots
  already taken: the last turn's "after" and this turn's "before". Ignored files are left out, as the snapshots leave them out.

  Liner can't know a person made a change, only that it was made outside this session's turns, so that is what's said.
  Not everything that changed between turns is unknown, though. What Liner did itself is named as what it was: an Undo of a turn, a Keep
  from Compare, files the turns taken back left when you edited an earlier message, another session's turn in the same folder,
  and what came with a pull, merge or branch switch (HEAD moved). Only names and line counts, never contents. The Terminal
  isn't told apart: it's a raw pty, and Liner can't know where one command ends, so a file a command there wrote is "outside your turns" like any other.

  T3 Code has no such note to copy; the HEAD test is its listAuthoredPaths (checkpoints.ts authoredPaths).
*/
import type { EditedFile, FileChange, Item } from "../../contracts/src/index.ts";
import { authoredPaths, changes, literal, local, prefixOf } from "./checkpoints.ts";
import { run } from "./exec.ts";

/** Git, stopped by `signal` (a Stop, or a turn that waited long enough for the note): one stopped answers as failed. */
const gitOf = (signal?: AbortSignal) => (cwd: string, args: string[]) => run("git", ["-c", "log.showSignature=false", ...args], { cwd, timeout: 60000, signal });
type Git = ReturnType<typeof gitOf>;

/** Names in the note at most: past that, "and 14 more". */
export const NOTE_CAP = 20;
/** How long a turn waits for the note once its tool is open (runtime.ts): past that it goes without one. */
export const EDITS_MS = 3000;
/** Past this many paths, one diff of the whole folder is read instead of naming each path (a command line has a limit). */
const PATHSPEC_CAP = 200;

/** A commit and when it was made (seconds), or null when there's no such ref or commit. */
async function commitOf(git: Git, cwd: string, rev: string): Promise<{ commit: string; at: number } | null> {
  const r = await git(cwd, ["log", "-1", "--no-walk", "--format=%H %ct", `${rev}^{commit}`]);
  const [commit, at] = r.stdout.trim().split(" ");
  return r.code === 0 && commit && at ? { commit, at: Number(at) } : null;
}

/** Of `paths`, the ones whose state in `a` and `b` is the same: one git call, however many paths. */
async function sameIn(git: Git, cwd: string, a: string, b: string, paths: string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  const r = await git(cwd, ["diff", "--name-only", "-z", "--no-renames", "--relative", "--no-ext-diff", a, b, ...(paths.length > PATHSPEC_CAP ? [] : ["--", ...literal(paths)])]);
  if (r.code !== 0) return new Set();
  const differ = new Set(r.stdout.split("\0").filter(Boolean));
  return new Set(paths.filter((p) => !differ.has(p)));
}

/**
  The snapshot the last turn left: its "after", by the newest turn marker before `turn`. A turn that took none (its snapshot
  failed) gives no note, rather than calling its agent's edits outside work. A ref older than its marker is from a turn taken back
  (a rewind numbers turns again) and doesn't count.
*/
async function lastAfter(git: Git, cwd: string, threadId: string, turn: number, items: Item[]) {
  const marker = items.findLast((x) => x.kind === "turn" && x.turn < turn);
  if (!marker) return null;
  const after = await commitOf(git, cwd, `refs/liner/${threadId}/${marker.turn}-after`);
  return after && after.at >= Math.floor(marker.at / 1000) - 1 ? after : null;
}

/** Another session working in the same folder: its id, its title and its timeline. */
export type Beside = { id: string; title: string; items: Item[] };

/**
  What changed in `cwd` from the last turn's end to `now` (this turn's "before" snapshot), file by file, each with who did
  it; null when nothing did, or there's no last turn to measure from. `keeps`: refs of Keep from Compare in this project
  (compare.keep saves the kept take as refs/liner/<id>/keep). `beside`: other sessions in the same folder. `signal`: stops its
  git calls, and the answer is null.
*/
export async function editsSince(cwd: string, threadId: string, turn: number, items: Item[], now: string, o: { keeps?: string[]; beside?: Beside[]; signal?: AbortSignal } = {}): Promise<EditedFile[] | null> {
  const files = await editsOf(gitOf(o.signal), cwd, threadId, turn, items, now, o);
  return o.signal?.aborted ? null : files;
}

async function editsOf(git: Git, cwd: string, threadId: string, turn: number, items: Item[], now: string, o: { keeps?: string[]; beside?: Beside[]; signal?: AbortSignal }): Promise<EditedFile[] | null> {
  const stopped = () => o.signal?.aborted === true;
  const from = await lastAfter(git, cwd, threadId, turn, items);
  if (!from || from.commit === now) return null;
  const files = await changes(cwd, from.commit, now);
  if (!files.length) return null;
  const prefix = await prefixOf(cwd);
  const paths = files.map((f) => f.path);
  const by = new Map<string, Omit<EditedFile, keyof FileChange | "path">>();
  const claim = (set: Iterable<string>, who: Omit<EditedFile, keyof FileChange | "path">) => {
    for (const p of set) if (!by.has(p)) by.set(p, who);
  };

  // An Undo of a turn made since: its files that are now as they were before that turn.
  for (const cp of items) {
    if (stopped()) return null;
    if (cp.kind !== "checkpoint" || !cp.reverted || !cp.redo || !cp.from) continue;
    const when = await commitOf(git, cwd, cp.redo);
    if (!when || when.at < from.at) continue;
    const mine = cp.files.flatMap((f) => [local(f.path, prefix, f.rel), ...(f.from ? [local(f.from, prefix, f.rel)] : [])]).filter((p) => paths.includes(p));
    claim(await sameIn(git, cwd, cp.from, now, mine), { by: "undo", turn: cp.turn });
  }

  // Turns taken back when you edited an earlier message, their files kept: the newest of their "after" snapshots, made since.
  const refs = await git(cwd, ["for-each-ref", "--format=%(refname) %(objectname) %(committerdate:unix)", `refs/liner/${threadId}/`]);
  let gone: { commit: string; at: number } | null = null;
  for (const line of refs.stdout.split("\n")) {
    const m = /\/(\d+)-after (\S+) (\d+)$/.exec(line.trim());
    if (!m || Number(m[1]) < turn || Number(m[3]) < from.at) continue;
    if (!gone || Number(m[3]) > gone.at) gone = { commit: m[2], at: Number(m[3]) };
  }
  if (gone) claim(await sameIn(git, cwd, gone.commit, now, paths.filter((p) => !by.has(p))), { by: "rewind" });

  // A take kept from Compare since: its files as that take left them.
  for (const ref of o.keeps ?? []) {
    if (stopped()) return null;
    const kept = await commitOf(git, cwd, ref);
    if (kept && kept.at >= from.at) claim(await sameIn(git, cwd, kept.commit, now, paths.filter((p) => !by.has(p))), { by: "keep" });
  }

  // Another session's work in this folder since: the files its checkpoints name, a turn of it undone since among them (the
  // Undo was its, not the person's), and a turn of it still running, which has no checkpoint yet: what differs from its
  // "before" snapshot. A person's edit to the same file meanwhile can't be told apart, so it's named as that session's.
  for (const b of o.beside ?? []) {
    if (stopped()) return null;
    const theirs = new Set<string>();
    for (const cp of b.items) {
      if (cp.kind !== "checkpoint") continue;
      const undone = cp.reverted && cp.redo ? await commitOf(git, cwd, cp.redo) : null;
      if (cp.at >= from.at * 1000 || (undone && undone.at >= from.at)) for (const f of cp.files) for (const p of [f.path, ...(f.from ? [f.from] : [])]) theirs.add(local(p, prefix, f.rel));
    }
    const live = b.items.findLast((x) => x.kind === "turn");
    if (live?.kind === "turn" && live.status === "running") {
      const before = await commitOf(git, cwd, `refs/liner/${b.id}/${live.turn}-before`);
      // One diff for all the paths left, not a git process per path.
      const left = paths.filter((x) => !by.has(x) && !theirs.has(x));
      if (before && left.length) {
        const same = await sameIn(git, cwd, before.commit, now, left);
        for (const p of left) if (!same.has(p)) theirs.add(p);
      }
    }
    claim(paths.filter((p) => theirs.has(p)), { by: "session", title: b.title });
  }

  if (stopped()) return null;
  // HEAD moved (a pull, merge, rebase or branch switch): what came with the commits is named as that.
  const authored = await authoredPaths(cwd, from.commit, now);
  if (authored) claim(files.filter((f) => !authored.has(f.path) && !(f.from && authored.has(f.from))).map((f) => f.path), { by: "branch" });

  return files.map((f) => ({ path: f.path, status: f.status, added: f.added, removed: f.removed, ...(f.from ? { from: f.from } : {}), ...(by.get(f.path) ?? { by: "outside" as const }) }));
}

/** "src/a.ts (modified, +3 −1)". */
const lineOf = (f: EditedFile) => `- ${f.from ? `${f.from} → ` : ""}${f.path} (${f.status}${f.status === "deleted" ? "" : `, +${f.added} −${f.removed}`})`;

/**
  Each group's heading, in the order they're said. The first claims only what Liner knows: the files changed outside this
  session's turns, by whoever (a person, a terminal, a command left running), not that a person changed them.
*/
const HEADS: { key: (f: EditedFile) => string; head: (f: EditedFile) => string }[] = [
  { key: (f) => (f.by === "outside" ? "outside" : ""), head: () => "Changed since your last turn, outside your turns:" },
  { key: (f) => (f.by === "undo" ? `undo-${f.turn}` : ""), head: (f) => `Put back by an Undo of turn ${f.turn} in Liner Code (that turn's changes to these files are gone):` },
  { key: (f) => (f.by === "rewind" ? "rewind" : ""), head: () => "Left by turns that were taken out of this conversation (their file changes were kept):" },
  { key: (f) => (f.by === "keep" ? "keep" : ""), head: () => "Brought in from another session by Keep in Liner Code's Compare:" },
  { key: (f) => (f.by === "session" ? `session-${f.title}` : ""), head: (f) => `Changed by another session working in this folder${f.title ? ` ("${f.title}")` : ""}:` },
  { key: (f) => (f.by === "branch" ? "branch" : ""), head: () => "Came in with a pull, merge or branch switch:" },
];

/**
  The note ahead of the message: information, not an instruction. Grouped by who changed what, NOTE_CAP names at most in
  all, then "and N more". `skipUndo`: the tool is told the conversation again this turn (handoff), which already says
  which turns were undone, so it isn't said twice. Empty when nothing is left to say.
*/
export function editsNote(files: EditedFile[], o: { skipUndo?: boolean } = {}) {
  const said = files.filter((f) => !(o.skipUndo && f.by === "undo"));
  if (!said.length) return "";
  const groups = new Map<string, { head: string; files: EditedFile[] }>();
  for (const h of HEADS)
    for (const f of said) {
      const k = h.key(f);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, { head: h.head(f), files: [] });
      groups.get(k)!.files.push(f);
    }
  const out = ["## Files changed since your last turn", "For your information: these files in the project changed between your last turn and this message, so what you read of them before may be out of date. Names and line counts only."];
  let left = NOTE_CAP;
  for (const g of groups.values()) {
    if (left <= 0) break;
    out.push("", g.head, ...g.files.slice(0, left).map(lineOf));
    left -= g.files.length;
  }
  if (left < 0) out.push(`- and ${-left} more`);
  return out.join("\n");
}
