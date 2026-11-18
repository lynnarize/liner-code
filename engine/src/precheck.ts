/*
  A look at a draft before it goes, after Devin's (its "This draft looks like several independent tasks", "This task looks
  unrelated to the current session"). Devin's server pays for its check; ours would run on the person's own plan or key, so
  every rule here is read from the words and what the engine already knows of the session, and only one rule may ask a
  model: whether a message opens a new subject in a long session, which words alone can't settle. That one is asked only
  after the words have already pointed that way, and is given three seconds; no answer in time is no suggestion.

  At most one suggestion comes out, by this order: several independent tasks (a new session or its first message), then a
  new subject in a long session (on Send), then a heavy model for a small ask. A "plan first" rule is left out: since Plan
  became Lead + sidekick no tool in Liner has a way to plan before it edits that a message could switch on, short of
  putting it at Read only, which is a different thing.

  Pure, apart from `sendCheck`'s question, which the caller passes in. T3 Code has nothing like this to copy.
*/
import type { Precheck } from "../../contracts/src/index.ts";

/** What a draft is checked against: the draft, and what the engine knows of the session it goes to (or would start). */
export type DraftFacts = {
  text: string;
  /** A draft on Home, or a session's first message: one that may be split. */
  first: boolean;
  /** Finished turns in the session so far. */
  turns?: number;
  /** How full its context was at the last turn, 0 to 1, when the tool said. */
  context?: number;
  /** What the session has been about: its title and your last few messages, newest last. */
  recent?: string[];
  /** The session's model, "<provider>:<model>", and its tool's top and fast ones as the picker's Best and Fast name them. */
  model?: string;
  top?: string;
  fast?: string;
  /** What the fast one is called, for the button ("Sonnet 5.5"). */
  fastLabel?: string;
  /** The session thinks at the highest effort its model takes. */
  highest?: boolean;
  /** A pair: its lead hands small work to its sidekick already. */
  pair?: boolean;
};

/** Most sessions one split may start: past that it reads as a backlog, not a few tasks to run side by side. */
const MAX_SPLIT = 6;

// A list item, bulleted or numbered: "- x", "* x", "• x", "1. x", "2) x"; its indent, and its words (trimmed after, not by a lazy match that would try every space).
const ITEM = /^(\s*)(?:[-*•+]|\d{1,2}[.)])\s+(\S.*)$/;
// The verbs a task opens with. An item that starts with one stands as a task; one that doesn't is a detail or a note.
const VERBS = /^(?:please\s+)?(?:add|fix|make|build|write|update|remove|delete|rename|refactor|create|implement|move|change|migrate|replace|upgrade|set\s+up|setup|support|test|document|clean(?:\s+up)?|improve|convert|port|split|extract|bump|enable|disable|allow|show|hide|let|use|drop|introduce|investigate|find|check|speed\s+up|optimi[sz]e|translate|redesign|rewrite|wire(?:\s+up)?|hook\s+up|handle|validate|log|cache|deploy|ship|publish|debug|profile|audit|sort|filter|paginate|style|restyle|tidy|stop|prevent|avoid|ensure|guard)\b/i;
// An item that leans on the one before it is a step of one task, not a task of its own.
const LEANS = /^(?:then|and\s+then|after\s+(?:that|this)|next|finally|afterwards|also\s+then|once\s+(?:that|this)|using\s+(?:that|this|it)|with\s+(?:that|this|it))\b|\b(?:the\s+(?:above|previous|same)|step\s+\d)\b/i;
// A lead-in that names no task of its own ("Please do these:"), where the list under it can be several tasks.
const PLAIN_LEAD = /^(?:please\s*)?(?:(?:can|could|would)\s+you\s+)?(?:do\s+(?:these|the\s+following|this)|the\s+following|a\s+few\s+(?:things|tasks|fixes|changes)|some\s+(?:things|tasks|fixes|changes)|(?:these|the)\s+(?:tasks|things|fixes|changes|issues|bugs|items)|to\s*-?\s*dos?|tasks|todo|bugs|fixes|issues|things\s+to\s+do|a\s+few\s+things)\b/i;
/** A lead-in that is all "these" and nothing else: PLAIN_LEAD, then at most "please", "for me" or "thanks" and a stop or a colon. */
const plainLead = (said: string) => {
  const lead = said.replace(/^(?:here\s+(?:are|is)|here['’]s)\s+/i, "");
  const m = PLAIN_LEAD.exec(lead);
  return Boolean(m) && /^[\s,]*(?:(?:please|for\s+me|thanks|thank\s+you)[\s,]*)*[:.!?]*$/i.test(lead.slice(m![0].length));
};

/**
  The tasks in a draft that reads as several independent ones: three or more list items, each opening with a verb of its own
  and none leaning on the one before it, under no lead-in but a plain "these" and with no item under another. Null when it
  doesn't read so: no model is asked to settle a list that's unclear, it's left alone.

  Each task becomes a session of its own with only its own words, so anything the split would lose refuses it: a lead-in that
  is a task ("Add login:" over "1. the form 2. the route") or that says something of them all ("We're on the staging DB,
  never run migrations."), and an indented item, which belongs to the one above it.
*/
export function tasksOf(text: string): string[] | null {
  const lines = text.split("\n").filter((l) => l.trim());
  const items: string[] = [];
  const before: string[] = [];
  let indent: number | undefined;
  for (const l of lines) {
    const m = ITEM.exec(l);
    if (m) {
      // Every item at the first one's indent: one further in is a detail or a step of the item above it.
      const at = m[1].replace(/\t/g, "    ").length;
      if ((indent ??= at) !== at) return null;
      items.push(m[2].trim());
    }
    // Prose after the list began: a note on the whole, or a list in two parts; either way not plainly several tasks.
    else if (items.length) return null;
    else before.push(l.trim());
  }
  if (items.length < 3 || items.length > MAX_SPLIT) return null;
  // A lead-in is fine only when it says nothing but "these": any more would be left out of every task.
  const lead = before.join(" ").trim();
  if (lead && !plainLead(lead)) return null;
  for (const it of items) {
    if (!VERBS.test(it) || LEANS.test(it)) return null;
    if (it.split(/\s+/).length < 3) return null;
  }
  // The same ask twice is no split.
  if (new Set(items.map((x) => x.toLowerCase())).size !== items.length) return null;
  return items;
}

// Small edits, by their words: what a quicker model does as well as the top one.
const SMALL = /\b(?:rename|typo|spelling|misspell(?:ed|ing)?|one[- ]line(?:r)?|single[- ]line|bump\s+(?:the\s+)?version|capitali[sz]e|lower-?case|upper-?case|whitespace|indent(?:ation)?|trailing\s+(?:comma|space)|semicolon|add\s+a\s+comment|remove\s+(?:the|this|that|an?)\s+(?:unused\s+)?(?:line|import|comment|console\.log|log|print)|update\s+the\s+(?:copyright|year|version)|change\s+\S+\s+to\s+\S+|swap\s+\S+\s+(?:and|with|for)\s+\S+)\b/i;
// Words that make a short ask a big one: reasons, designs, the whole codebase.
const BIG = /\b(?:why|how|explain|design|architect\w*|plan|refactor|investigate|debug|research|everywhere|across|every|all\s+(?:the\s+)?(?:files|places|uses|calls)|whole|entire|codebase|migrate|rewrite|performance|security|review)\b/i;

/** A short, simple ask: one line, twelve words or fewer, that names a small edit and nothing that makes it a big one. */
export function smallAsk(text: string) {
  const t = text.trim();
  if (!t || t.includes("\n")) return false;
  if (t.split(/\s+/).length > 12) return false;
  return SMALL.test(t) && !BIG.test(t);
}

/** A session long enough that a new subject costs it: eight turns or more, or its context over half full. */
export const longSession = (f: Pick<DraftFacts, "turns" | "context">) => (f.turns ?? 0) >= 8 || (f.context ?? 0) > 0.5;

const STOP = new Set("about above after again also always another anything because been before being below between both but cannot could does doing down during each else even every from have having here into just like make more most much must need never only other over please really same should some still such than that their them then there these they thing things this those through under until very want were what when where which while will with without would your yours".split(" "));
/** The words that say what something is about: four letters or more, the common ones left out, plurals as their singular. */
const wordsOf = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
// A message that opens like this carries on from what was said.
const CARRIES_ON = /^(?:also|and|but|now|then|so|ok(?:ay)?|great|thanks|thank\s+you|nice|good|perfect|same|again|still|it|its|it's|that|this|those|these|they|them|why|what\s+about|how\s+about|can\s+you\s+also|one\s+more|another|next|wait|hmm|no\b|yes\b|yep|nope|actually)\b/i;

/**
  Whether a draft may open a new subject, from its words alone: long enough to say what it's about (five words or more),
  not opening as a follow-up does, and sharing no word that says what it's about with the session's title and recent asks.
  Only then is a model asked (sendCheck): words that miss could still be the same work by other names.
*/
export function maybeNewSubject(text: string, recent: string[]) {
  const t = text.trim();
  if (t.split(/\s+/).length < 5 || CARRIES_ON.test(t) || /^[/$@]/.test(t)) return false;
  const mine = wordsOf(t);
  if (mine.size < 2) return false;
  const theirs = wordsOf(recent.join("\n"));
  if (!theirs.size) return false;
  for (const w of mine) if (theirs.has(w)) return false;
  return true;
}

/** The question the quick model is asked: a yes or a no, about the subject only. */
export function subjectQuestion(text: string, recent: string[]) {
  const said = recent.map((r) => `- ${r.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
  return [
    "Answer with one word: yes or no. Do not use any tools.",
    "A coding session has been about this (its title, then the person's latest messages):",
    said,
    "",
    "Their next message is:",
    text.replace(/\s+/g, " ").slice(0, 800),
    "",
    "Is that next message about a different, unrelated subject, one that would go better in a new session? Answer yes or no.",
  ].join("\n");
}

/** A yes or a no from the model's answer; null when it said neither first. */
export function yesNo(out: string): boolean | null {
  const t = out.trim().replace(/^[\s*_`"'([]+/, "");
  if (/^yes\b/i.test(t)) return true;
  if (/^no\b/i.test(t)) return false;
  return null;
}

/** As the picker says a count: "3 sessions". */
const sessions = (n: number) => `${n} sessions`;

/**
  The rules that run as you type, no model asked: several tasks, then a heavy model for a small ask. Null: nothing to say.
*/
export function draftCheck(f: DraftFacts): Precheck | null {
  const text = f.text.trim();
  if (!text || text.startsWith("/")) return null;
  if (f.first) {
    const tasks = tasksOf(text);
    if (tasks) return { kind: "split", caption: "This draft looks like several independent tasks", action: `Split into ${sessions(tasks.length)}`, tasks };
  }
  if (!f.first && !f.pair && f.fast && f.model && f.fast !== f.model && (f.model === f.top || f.highest) && smallAsk(text)) {
    const name = f.fastLabel ?? f.fast;
    return { kind: "heavy", caption: f.model === f.top ? "The top model may be more than this needs" : "The highest effort may be more than this needs", action: `Use ${name}`, model: f.fast };
  }
  return null;
}

/** What `sendCheck` is told of the model's answer: no answer in time is no suggestion. */
export const SEND_LIMIT_MS = 3000;

/**
  The rule that runs on Send: in a long session, a draft whose words open a new subject is put to the quick model (`ask`, with
  a signal that ends at `limit`). A yes is the suggestion; a no, no answer in time, or a failure lets the message go. The model
  is never asked when the words don't already point that way, nor when `useModel` is off.
*/
export async function sendCheck(f: DraftFacts, ask: (prompt: string, signal: AbortSignal) => Promise<string>, o: { useModel?: boolean; limit?: number } = {}): Promise<Precheck | null> {
  // A rule that runs as you type has first say: Send shows it if it's still there.
  const typed = draftCheck(f);
  if (typed?.kind === "split") return typed;
  if (o.useModel === false || f.first || !longSession(f) || !maybeNewSubject(f.text, f.recent ?? [])) return null;
  const limit = o.limit ?? SEND_LIMIT_MS;
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let over = false;
  const late = new Promise<null>((ok) => (timer = setTimeout(() => ((over = true), stop.abort(), ok(null)), limit)));
  try {
    const out = await Promise.race([ask(subjectQuestion(f.text, f.recent ?? []), stop.signal).catch(() => null), late]);
    // An answer that came as time ran out came too late.
    if (over || out === null || yesNo(out) !== true) return null;
    return { kind: "unrelated", caption: "This looks unrelated to this session", action: "Start a new session" };
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}
