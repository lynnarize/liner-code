/*
  The words and keys of the ask at the composer (Ask.tsx), kept apart from React so they can be
  read and checked on their own: how a command is cut into rows, what in a row is marked, and what
  Enter and Esc do while an ask is up.
*/

/**
  A command cut into rows, a step each, for showing only: what runs is always the command as the
  agent wrote it. It is cut outside quotes, `$(…)` and backticks: after a new line and after `;`
  (which stays at the end of its row, as it reads in a script), and before `&&`, `||`, `|` and a
  `do`, `done`, `then`, `else` or `fi` where a command would start (each starts the row it cuts).
  `2>&1` and `>|` aren't cuts. Joining the rows gives the command back, apart from the white space
  at a cut; rows inside `do … done` and `then … fi` are indented two spaces a level.
*/
export function rowsOf(command: string): string[] {
  const starts: number[] = [0];
  const cut = (at: number) => {
    const last = starts[starts.length - 1];
    // Only white space since the last cut: that row would be empty, so the cut moves here.
    if (!command.slice(last, at).trim()) starts[starts.length - 1] = at;
    else starts.push(at);
  };
  const stack: string[] = [];
  let atCommand = true;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const top = stack[stack.length - 1];
    if (top === "'") {
      if (c === "'") stack.pop();
      continue;
    }
    if (top === "`") {
      if (c === "\\") i++;
      else if (c === "`") stack.pop();
      continue;
    }
    if (c === "\\") {
      i++;
      atCommand = false;
      continue;
    }
    if (top === '"') {
      if (c === '"') stack.pop();
      else if (c === "$" && command[i + 1] === "(") (stack.push("("), i++);
      else if (c === "`") stack.push("`");
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      stack.push(c);
      atCommand = false;
      continue;
    }
    if (c === "$" && command[i + 1] === "(") {
      stack.push("(");
      i++;
      atCommand = false;
      continue;
    }
    if (c === "(") {
      stack.push("(");
      continue;
    }
    if (c === ")") {
      if (top === "(") stack.pop();
      continue;
    }
    // Inside $( … ) nothing is cut: it's one part of the row it's in.
    if (stack.length) continue;
    if (c === "\n") {
      cut(i + 1);
      atCommand = true;
      continue;
    }
    if (c === ";") {
      // `;;` ends a case branch: it stays whole.
      if (command[i + 1] === ";") i++;
      cut(i + 1);
      atCommand = true;
      continue;
    }
    if ((c === "&" && command[i + 1] === "&") || (c === "|" && command[i + 1] === "|")) {
      cut(i);
      i++;
      atCommand = true;
      continue;
    }
    if (c === "|" && command[i - 1] !== ">") {
      cut(i);
      atCommand = true;
      continue;
    }
    if (/\s/.test(c)) continue;
    if (atCommand && (i === 0 || /[\s;|&]/.test(command[i - 1]))) {
      const kw = /^(do|done|then|else|fi)(?=[\s;|&)]|$)/.exec(command.slice(i))?.[1];
      if (kw) {
        cut(i);
        i += kw.length - 1;
        // After do, then and else a command starts; after done and fi, a redirect or a separator may follow.
        atCommand = kw === "do" || kw === "then" || kw === "else";
        continue;
      }
    }
    atCommand = false;
  }
  const rows: string[] = [];
  let depth = 0;
  for (const [n, start] of starts.entries()) {
    const row = command.slice(start, starts[n + 1] ?? command.length).trim();
    if (!row) continue;
    const kw = /^(do|done|then|else|fi)\b/.exec(row)?.[1];
    if (kw === "done" || kw === "fi" || kw === "else") depth = Math.max(0, depth - 1);
    rows.push(`${"  ".repeat(depth)}${row}`);
    if (kw === "do" || kw === "then" || kw === "else") depth++;
  }
  return rows.length ? rows : [command];
}

/** A piece of a row: plain, a program (`p`, in full ink), or a site (`u`, in the accent). */
export type Bit = { t: string; k?: "p" | "u" };

const KEYWORDS = new Set(["for", "in", "case", "esac", "select", "function", "done", "fi", "do", "then", "else", "if", "while", "until"]);

/** A row's programs and sites, marked: the word a step starts with, the one after `$(`, and the scheme and host of a URL. */
export function bitsOf(row: string): Bit[] {
  const marks: { from: number; to: number; k: "p" | "u" }[] = [];
  for (const m of row.matchAll(/https?:\/\/[^\s/"'?#)`]+/g)) marks.push({ from: m.index, to: m.index + m[0].length, k: "u" });
  for (const m of row.matchAll(/\$\(\s*([A-Za-z0-9_./~+-]+)/g)) {
    const from = m.index + m[0].length - m[1].length;
    marks.push({ from, to: from + m[1].length, k: "p" });
  }
  // The row's own program: past a separator, a keyword that starts a block, and any NAME=value before it.
  const lead = /^\s*(?:&&|\|\||\|)?\s*(?:(?:do|then|else|if|while|until|!)\s+)*/.exec(row)![0];
  let at = lead.length;
  for (;;) {
    const word = /^[^\s;|&<>()]+/.exec(row.slice(at))?.[0];
    if (!word) break;
    if (/^[A-Za-z_]\w*=/.test(word)) {
      const gap = /^\s+/.exec(row.slice(at + word.length))?.[0];
      if (!gap) break;
      at += word.length + gap.length;
      continue;
    }
    if (!KEYWORDS.has(word) && !/["'`$]/.test(word)) marks.push({ from: at, to: at + word.length, k: "p" });
    break;
  }
  marks.sort((a, b) => a.from - b.from);
  const bits: Bit[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.from < pos) continue;
    if (m.from > pos) bits.push({ t: row.slice(pos, m.from) });
    bits.push({ t: row.slice(m.from, m.to), k: m.k });
    pos = m.to;
  }
  if (pos < row.length) bits.push({ t: row.slice(pos) });
  return bits;
}

/** How long after the last change to the box Enter is still the box's (T3 Code: composerTypingGuard.ts). */
export const TYPING_GUARD = 1500;
/** How long an ask must have been in view before a key can answer it: a key pressed as it came was meant for what was there before. */
export const SHOWN_GUARD = 600;

export type AskKeyIn = {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** The key is held down (the system repeating it). */
  repeat: boolean;
  /** Choosing how to answer, or sending it back with the box's words. */
  mode: "choose" | "back";
  /** High risk: only a hold runs it. */
  high: boolean;
  /** How many "don't ask again" grants it offers; ⌘Enter takes the first. */
  grants: number;
  /** What the composer's box holds now. */
  box: string;
  now: number;
  /** When the box last changed: a key, a paste, a message sent out of it. */
  typedAt: number;
  /** When this ask came into view at the composer. */
  shownAt: number;
};

/**
  What Enter or Esc does while an ask is up, pressed in the composer's box or on the ask. `null`:
  nothing to do with the ask, the key does what it does today. `swallow`: the key does nothing.

  Enter (no Shift, no Option):
  - sending it back: sends it back, with the box's words as the reason (empty is a plain no).
    ⌘Enter is swallowed there, so the reason isn't sent as a message instead.
  - the box has words: null. Enter sends them as it does today, and the ask waits for its buttons.
    So words that were there before the ask arrived are never taken for a yes.
  - high risk: swallowed. Only holding the button runs it.
  - the box changed in the last 1.5s, the ask came into view in the last 0.6s, or the key is
    repeating: swallowed. A person mid-sentence, or pressing Enter a second time to send, didn't
    mean to run a command.
  - otherwise Enter runs it once, and ⌘Enter runs it with its first grant (swallowed with none).
  Esc (no modifiers):
  - sending it back: back to choosing.
  - the box is empty: "Not this", which goes to sending it back. It never also stops the turn.
  - the box has words: null, as today.
*/
export function askKey(s: AskKeyIn): "run" | "grant" | "send-back" | "not-this" | "back" | "swallow" | null {
  const empty = !s.box.trim();
  if (s.key === "Escape") {
    if (s.mod || s.shift || s.alt) return null;
    if (s.mode === "back") return "back";
    return empty ? "not-this" : null;
  }
  if (s.key !== "Enter" || s.shift || s.alt) return null;
  if (s.mode === "back") return s.mod ? "swallow" : "send-back";
  if (!empty) return null;
  if (s.high) return "swallow";
  if (s.repeat || s.now - s.typedAt < TYPING_GUARD || s.now - s.shownAt < SHOWN_GUARD) return "swallow";
  if (s.mod) return s.grants > 0 ? "grant" : "swallow";
  return "run";
}
