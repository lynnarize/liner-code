/*
  The diff behind Code diff: Myers on lines, then again on the words of each changed pair,
  so a line that only changed a name shows that name and not the whole line.
*/

export type Edit = { op: "same" | "del" | "add"; a: number; b: number };
export type Range = [start: number, end: number];
export type Row = {
  kind: "same" | "del" | "add";
  /** 1-based line numbers; a removed line has only old, an added one only new. */
  old?: number;
  new?: number;
  /** Character ranges that changed, for a line paired with its counterpart. */
  words?: Range[];
  /** Which change this row belongs to, counted from 0. */
  change?: number;
  /** For a removed line: which of its change's added lines replaced it. */
  twin?: number;
};
export type Segment = { kind: "rows"; rows: Row[] } | { kind: "fold"; id: number; rows: Row[] };

/** Myers' O(ND) diff. Common ends are trimmed first; each round keeps only the diagonals it reached. */
export function diffSeq<T>(a: readonly T[], b: readonly T[]): Edit[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  const A = (i: number) => a[pre + i];
  const B = (i: number) => b[pre + i];

  const mid: Edit[] = [];
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let done = max === 0;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A(x) === B(y)) x++, y++;
      v[off + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }
  // Walk the rounds back from the end, reading each round's diagonals as it started.
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d];
    const at = (k: number) => t[k + d];
    const k = x - y;
    const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = d === 0 ? 0 : at(pk);
    const py = px - pk;
    while (x > px && y > py) mid.push({ op: "same", a: pre + --x, b: pre + --y });
    if (d > 0) {
      if (x === px) mid.push({ op: "add", a: pre + x, b: pre + --y });
      else mid.push({ op: "del", a: pre + --x, b: pre + y });
    }
  }
  mid.reverse();

  const out: Edit[] = [];
  for (let i = 0; i < pre; i++) out.push({ op: "same", a: i, b: i });
  out.push(...mid);
  for (let i = 0; i < suf; i++) out.push({ op: "same", a: a.length - suf + i, b: b.length - suf + i });
  return out;
}

const WORD = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g;

type Words = { del: Range[]; add: Range[]; kept: number };

/** What changed between two versions of a line, and how much of it stayed; nothing when they share too little to compare. */
export function diffWords(before: string, after: string): Words | null {
  const a = before.match(WORD) ?? [];
  const b = after.match(WORD) ?? [];
  const edits = diffSeq(a, b);
  const starts = (toks: string[]) => toks.reduce<number[]>((s, _, i) => (s.push(i ? s[i - 1] + toks[i - 1].length : 0), s), []);
  const sa = starts(a);
  const sb = starts(b);
  const ra: Range[] = [];
  const rb: Range[] = [];
  let kept = 0;
  // Ranges merge across a single space, so "fast sync" reads as one change, not two.
  const add = (rs: Range[], s: number, e: number, text: string) => {
    const last = rs[rs.length - 1];
    if (last && (last[1] === s || (last[1] < s && !text.slice(last[1], s).trim()))) last[1] = e;
    else rs.push([s, e]);
  };
  for (const e of edits) {
    if (e.op === "same") kept += a[e.a].trim().length;
    // A mark never starts or ends on a space; spaces only join the words around them.
    else if (e.op === "del") a[e.a].trim() && add(ra, sa[e.a], sa[e.a] + a[e.a].length, before);
    else b[e.b].trim() && add(rb, sb[e.b], sb[e.b] + b[e.b].length, after);
  }
  const longest = Math.max(before.trim().length, after.trim().length);
  // Lines that keep less than 40% of their text are rewrites: tinting words would be noise.
  if (!longest || kept / longest < 0.4) return null;
  return { del: ra, add: rb, kept: kept / longest };
}

/**
  Which removed line became which added line. Lines pair in order, choosing the pairs that
  keep the most text, so a line inserted above a changed one doesn't steal its partner.
*/
function align(a: string[], b: string[]): [number, number, Words][] {
  if (a.length * b.length > 400) {
    return a.slice(0, b.length).flatMap((x, i) => {
      const w = diffWords(x, b[i]);
      return w ? [[i, i, w] as [number, number, Words]] : [];
    });
  }
  const w = a.map((x) => b.map((y) => diffWords(x, y)));
  const best = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) best[i][j] = Math.max(best[i - 1][j], best[i][j - 1], best[i - 1][j - 1] + (w[i - 1][j - 1]?.kept ?? 0));
  const out: [number, number, Words][] = [];
  for (let i = a.length, j = b.length; i > 0 && j > 0; ) {
    const here = w[i - 1][j - 1];
    if (here && best[i][j] === best[i - 1][j - 1] + here.kept) out.push([--i, --j, here]);
    else if (best[i][j] === best[i - 1][j]) i--;
    else j--;
  }
  return out.reverse();
}

/** Rows for a file, with removals before additions inside each change and words paired up. */
export function diffRows(before: string[], after: string[]): Row[] {
  const edits = diffSeq(before, after);
  const rows: Row[] = [];
  let change = -1;
  for (let i = 0; i < edits.length; ) {
    if (edits[i].op === "same") {
      rows.push({ kind: "same", old: edits[i].a + 1, new: edits[i].b + 1 });
      i++;
      continue;
    }
    change++;
    const dels: Row[] = [];
    const adds: Row[] = [];
    for (; i < edits.length && edits[i].op !== "same"; i++) {
      const e = edits[i];
      if (e.op === "del") dels.push({ kind: "del", old: e.a + 1, change });
      else adds.push({ kind: "add", new: e.b + 1, change });
    }
    for (const [d, a, w] of align(
      dels.map((r) => before[r.old! - 1]),
      adds.map((r) => after[r.new! - 1]),
    )) {
      dels[d].words = w.del;
      dels[d].twin = a;
      adds[a].words = w.add;
    }
    rows.push(...dels, ...adds);
  }
  return rows;
}

/** Changes with `context` lines around them; longer unchanged runs fold away. */
export function segment(rows: Row[], context: number): Segment[] {
  const keep = rows.map(() => false);
  rows.forEach((r, i) => {
    if (r.kind === "same") return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true;
  });
  const out: Segment[] = [];
  let fold = 0;
  for (let i = 0; i < rows.length; ) {
    const shown = keep[i];
    let j = i;
    while (j < rows.length && keep[j] === shown) j++;
    const run = rows.slice(i, j);
    // A fold of one line costs as much room as the line, so show it instead.
    if (shown || run.length < 2) {
      const last = out[out.length - 1];
      if (last?.kind === "rows") last.rows.push(...run);
      else out.push({ kind: "rows", rows: run });
    } else out.push({ kind: "fold", id: fold++, rows: run });
    i = j;
  }
  return out;
}
