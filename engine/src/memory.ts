/*
  What agents keep from session to session in a project, and what they can look up from earlier
  ones (the learning loop in Hermes Agent, kept small). Memory is a short list of facts an agent
  saved with memory_add (a command that works, a convention, a decision you made), kept in Liner
  Code's own folder rather than the project's, and given to every new session there. Search reads
  the project's earlier sessions (what was asked, what was answered) and returns the best snippets.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";

/** At most this many facts per project; the oldest go first. */
const MAX_FACTS = 60;

const fileOf = (home: string, projectId: string) => join(home, "memory", `${projectId.replace(/[^\w-]/g, "_")}.md`);

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
  writeFileSync(fileOf(home, projectId), `# What agents remember about this project\n\n${facts.map((f) => `- ${f}`).join("\n")}\n`);
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

/** Takes facts out by their place in the list. */
export function forget(home: string, projectId: string, index: number): string[] {
  const facts = factsOf(home, projectId).filter((_, i) => i !== index);
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
export function searchSessions(store: Store, projectId: string, query: string, o: { skip?: string; limit?: number } = {}): SessionHit[] {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const hits: (SessionHit & { score: number })[] = [];
  for (const t of store.threads.filter((x) => x.projectId === projectId && x.id !== o.skip)) {
    for (const it of store.peek(t.id, ["user", "text"])) {
      if (it.kind !== "user" && it.kind !== "text") continue;
      const low = it.text.toLowerCase();
      const found = terms.filter((w) => low.includes(w));
      if (!found.length) continue;
      const count = found.reduce((n, w) => n + low.split(w).length - 1, 0);
      const at = Math.max(0, low.indexOf(found[0]) - 80);
      const snippet = `${at ? "…" : ""}${it.text.slice(at, at + 260).replace(/\s+/g, " ").trim()}${at + 260 < it.text.length ? "…" : ""}`;
      hits.push({ threadId: t.id, title: t.title, at: it.at, who: it.kind === "user" ? "you" : "agent", snippet, score: found.length * 10 + Math.min(count, 10) });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, o.limit ?? 8)
    .map(({ score: _, ...h }) => h);
}
