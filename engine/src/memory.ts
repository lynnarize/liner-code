/*
  What agents keep from session to session in a project, and what they can look up from earlier
  ones (the learning loop in Hermes Agent, kept small). Memory is a short list of facts an agent
  saved with memory_add (a command that works, a convention, a decision you made), kept in Liner
  Code's own folder rather than the project's, and given to every new session there. Search reads
  the project's earlier sessions (what was asked, what was answered) and returns the best snippets.
*/
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Thread } from "../../contracts/src/index.ts";
import { writeAtomic, type Store } from "./store.ts";

/** The first words of a first message, as a session's name. */
export function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 44 ? `${t.slice(0, 42).trimEnd()}…` : t || "New session";
}

/**
  A session's name as an agent or an outside tool reads it. A session named by its first message is named by what the
  person read of it (runtime.ts shownOf): told to an agent, that line would be words the agent was never told, so it reads
  the name the first message's own words give. A name the person gave, or any other, is as it is. A side chat named as
  one ("Side chat · …", as thread.side names it) reads its session's name for agents now, by its link to the session,
  whatever the session was called when the side chat was made.
*/
export function titleForAgents(store: Store, t: Thread): string {
  if (t.sideOf && t.title.startsWith("Side chat · ")) {
    const parent = store.threads?.find((x) => x.id === t.sideOf);
    if (parent) return `Side chat · ${titleForAgents(store, parent)}`;
  }
  // A stand-in store (a test's, an outside tool's view) may keep no timeline: its name is then as it is.
  const first = (typeof store.peek === "function" ? store.peek(t.id, ["user"]) : []).find((x) => x.kind === "user");
  if (first?.kind === "user" && first.shown?.text && t.title === titleFrom(first.shown.text)) return titleFrom(first.text);
  return t.title;
}

/** At most this many facts per project; the oldest go first. */
const MAX_FACTS = 60;

export const fileOf = (home: string, projectId: string) => join(home, "memory", `${projectId.replace(/[^\w-]/g, "_")}.md`);

/** A project's facts, oldest first. */
export function factsOf(home: string, projectId: string): string[] {
  const file = fileOf(home, projectId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => /^- (.+)$/.exec(l.trim())?.[1]?.trim())
    .filter((f): f is string => Boolean(f));
}

function save(home: string, projectId: string, facts: string[]) {
  mkdirSync(join(home, "memory"), { recursive: true });
  // Whole or not at all: a crash halfway would leave the project with half its memory.
  writeAtomic(fileOf(home, projectId), `# What agents remember about this project\n\n${facts.map((f) => `- ${f}`).join("\n")}\n`);
}

/** Saves a fact once: one line, trimmed; the same fact again (any case) isn't added twice. */
export function remember(home: string, projectId: string, fact: string): { added: boolean; facts: string[] } {
  const f = fact.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!f) throw new Error("Say the fact in a sentence.");
  const facts = factsOf(home, projectId);
  if (facts.some((x) => x.toLowerCase() === f.toLowerCase())) return { added: false, facts };
  const next = [...facts, f].slice(-MAX_FACTS);
  save(home, projectId, next);
  return { added: true, facts: next };
}

/** Takes a fact out by its text, so a list that changed since it was shown can't lose the wrong one. */
export function forget(home: string, projectId: string, fact: string): string[] {
  const facts = factsOf(home, projectId).filter((x) => x !== fact);
  save(home, projectId, facts);
  return facts;
}

/** The memory as an agent starts with it, or nothing when there's none. */
export function memoryNote(home: string, projectId: string): string {
  const facts = factsOf(home, projectId);
  if (!facts.length) return "";
  let out = "What earlier sessions in this project saved (memory_add adds to it):";
  for (const f of [...facts].reverse()) {
    if (out.length + f.length > 4000) break;
    out += `\n- ${f}`;
  }
  return out;
}

export type SessionHit = { threadId: string; title: string; at: number; who: "you" | "agent"; snippet: string };

/** Lowercase words of three letters or more, the query's terms. */
const termsOf = (q: string) => [...new Set(q.toLowerCase().match(/[\p{L}\p{N}_.-]{3,}/gu) ?? [])];

/**
  The best matches for `query` in a project's sessions (all of them, archived too, except
  `skip`): your messages and the agents' answers, scored by how many of the query's words each
  holds and how often, newer first on a tie. A snippet is the part around the first match.
*/
export function searchSessions(store: Store, projectId: string, query: string, o: { skip?: string; limit?: number; person?: boolean } = {}): SessionHit[] {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const hits: (SessionHit & { score: number })[] = [];
  for (const t of store.threads.filter((x) => x.projectId === projectId && x.id !== o.skip)) {
    for (const it of store.peek(t.id, ["user", "text"])) {
      if (it.kind !== "user" && it.kind !== "text") continue;
      // A message Liner wrote for the person (Liner Design's asks): the person's own search in the app (`person`) finds it by
      // what they read of it too, and shows that. An agent's search reads only what the agent was told (runtime.ts shownOf).
      const read = o.person && it.kind === "user" && it.shown ? [it.shown.text, ...(it.shown.chips ?? []).map((c) => c.label)].join(" ") : "";
      const low = `${read}\n${it.text}`.toLowerCase();
      const found = terms.filter((w) => low.includes(w));
      if (!found.length) continue;
      const count = found.reduce((n, w) => n + low.split(w).length - 1, 0);
      const words = read && found.some((w) => read.toLowerCase().includes(w)) ? read : it.text;
      const at = Math.max(0, words.toLowerCase().indexOf(found.find((w) => words.toLowerCase().includes(w)) ?? found[0]) - 80);
      const snippet = `${at ? "…" : ""}${words.slice(at, at + 260).replace(/\s+/g, " ").trim()}${at + 260 < words.length ? "…" : ""}`;
      hits.push({ threadId: t.id, title: o.person ? t.title : titleForAgents(store, t), at: it.at, who: it.kind === "user" ? "you" : "agent", snippet, score: found.length * 10 + Math.min(count, 10) });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, o.limit ?? 8)
    .map(({ score: _, ...h }) => h);
}
