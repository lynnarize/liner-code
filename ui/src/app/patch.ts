/*
  "Copy the diff as a patch" (Changes' ··· menu): the turn's files as one unified patch that `git apply`
  takes, built from the texts before and after that the diff already has, so it asks the engine for
  nothing more. It refuses rather than hand over a patch that wouldn't apply: a binary file, a file the
  engine cut short (checkpoints.ts clip) or couldn't read on one side, a change of mode alone (the diff carries no
  modes), files past the first 60, or a name git would have to quote.
  Pure, so the engine's tests read it too and check it with git itself (engine/test/patch.test.ts).
*/
import type { FileDiff } from "../../../contracts/src/index.ts";
import { diffSeq } from "../liner/pro/code-diff/diff.ts";

/** What checkpoints.ts puts at the end of a file it cut short. */
const CUT = "(cut off: the file is larger than the diff view shows)";
/** Marks a last line with no newline, so a line that only gained or lost its newline reads as changed. */
const NO_EOL = "\u0000no-eol";
const CONTEXT = 3;

/** A file's lines, the last one marked when the file doesn't end in a newline. */
function linesOf(text: string | undefined) {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  else lines[lines.length - 1] += NO_EOL;
  return lines;
}
const said = (prefix: string, line: string) => (line.endsWith(NO_EOL) ? `${prefix}${line.slice(0, -NO_EOL.length)}\n\\ No newline at end of file\n` : `${prefix}${line}\n`);

/** The hunks of one file, three lines of context round each change, changes that close merged into one hunk. */
function hunks(before: string[], after: string[]) {
  const edits = diffSeq(before, after);
  const changed = edits.flatMap((e, i) => (e.op === "same" ? [] : [i]));
  if (!changed.length) return "";
  const runs: [number, number][] = [];
  for (const i of changed) {
    const last = runs[runs.length - 1];
    if (last && i - last[1] - 1 <= CONTEXT * 2) last[1] = i;
    else runs.push([i, i]);
  }
  // How many lines of each side come before each edit.
  const olds: number[] = [];
  const news: number[] = [];
  let o = 0;
  let n = 0;
  for (const e of edits) {
    olds.push(o);
    news.push(n);
    if (e.op !== "add") o++;
    if (e.op !== "del") n++;
  }
  let out = "";
  for (const [first, last] of runs) {
    const s = Math.max(0, first - CONTEXT);
    const end = Math.min(edits.length - 1, last + CONTEXT);
    let body = "";
    let oc = 0;
    let nc = 0;
    for (let i = s; i <= end; i++) {
      const e = edits[i];
      if (e.op === "same") body += said(" ", before[e.a]);
      else if (e.op === "del") body += said("-", before[e.a]);
      else body += said("+", after[e.b]);
      if (e.op !== "add") oc++;
      if (e.op !== "del") nc++;
    }
    // An empty side starts at the line before it (0 for an empty file), as diff writes it.
    out += `@@ -${oc ? olds[s] + 1 : olds[s]},${oc} +${nc ? news[s] + 1 : news[s]},${nc} @@\n${body}`;
  }
  return out;
}

/** Why a file can't go in a patch, or nothing when it can. */
function refused(f: FileDiff) {
  for (const p of [f.path, f.from ?? f.path]) if (/[\u0000-\u001f"\\]/.test(p) || p.startsWith("/") || p.split("/").includes("..")) return `${f.path} has a name a patch can't carry.`;
  if (f.before?.includes("\u0000") || f.after?.includes("\u0000")) return `${f.path} is a binary file.`;
  if (f.before?.endsWith(CUT) || f.after?.endsWith(CUT)) return `${f.path} is too large to show in full.`;
  return undefined;
}

/**
  What happened to a file, by git's word for it, not by a missing side: the engine leaves out a side git wouldn't show too
  (a submodule's pointer, a file it can't read). An engine from before `status` leaves only the sides to go by.
*/
export function fileStatus(f: FileDiff): NonNullable<FileDiff["status"]> {
  return f.status ?? (f.before === undefined ? "added" : f.after === undefined ? "deleted" : (f.from ?? f.path) !== f.path ? "renamed" : "modified");
}
const LETTER = { modified: "M", added: "A", deleted: "D", renamed: "R" } as const;
/** A file's letter in Changes' rows (Review.tsx): M, A, D or R. */
export const fileLetter = (f: FileDiff) => LETTER[fileStatus(f)];

/**
  The files as one patch, from the folder the diff's paths are relative to; or why not. `total` is how
  many files the turn changed, of which the engine sends the first 60.
*/
export function patchOf(files: FileDiff[], total = files.length): { patch: string } | { why: string } {
  if (!files.length) return { why: "Nothing changed here." };
  if (total > files.length) return { why: `Only ${files.length} of the ${total} files are here, so the patch would be partial.` };
  let patch = "";
  for (const f of files) {
    const why = refused(f);
    if (why) return { why };
    const from = f.from ?? f.path;
    const status = fileStatus(f);
    const added = status === "added";
    const gone = status === "deleted";
    if ((!added && f.before === undefined) || (!gone && f.after === undefined)) return { why: `${f.path} couldn't be read as it ${f.before === undefined ? "was" : "is"} (git wouldn't show it, as with a submodule), so its change can't go in a patch.` };
    const moved = status === "renamed" || (!added && !gone && from !== f.path);
    const body = hunks(added ? [] : linesOf(f.before), gone ? [] : linesOf(f.after));
    // The same text on both sides is a change of mode only (whether it runs). The diff carries no modes, so it says so rather
    // than hand over a patch that leaves it out.
    if (!body && !added && !gone && !moved) return { why: `${f.path} changed only its mode (whether it runs), which the diff doesn't carry, so a patch would leave it out.` };
    // Modes again: a new file is written as 100644, so a new script loses whether it runs. A deleted file's mode is only
    // checked by git apply against what's there, and 100644 is what most files are.
    patch += `diff --git a/${from} b/${f.path}\n`;
    if (added) patch += "new file mode 100644\n";
    if (gone) patch += "deleted file mode 100644\n";
    if (moved) patch += `rename from ${from}\nrename to ${f.path}\n`;
    if (body) patch += `--- ${added ? "/dev/null" : `a/${from}`}\n+++ ${gone ? "/dev/null" : `b/${f.path}`}\n${body}`;
  }
  return patch ? { patch } : { why: "Nothing changed here." };
}
