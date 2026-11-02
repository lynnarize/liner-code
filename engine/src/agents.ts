/*
  Agents are optional: a session runs on a bare model ("@claude:claude-opus-5-5"), which needs no
  profile at all. An agent is one you make when a model should carry instructions of its own (a
  soul, a prompt, skills, context files). A fresh install has only the Demo, a scripted run.
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { AgentProfile } from "../../contracts/src/index.ts";
import { skillAt } from "./providers/models.ts";

export function defaultAgents(): AgentProfile[] {
  return [{ id: "demo", name: "Demo", role: "Scripted run", glyph: "spark", specialty: "custom", model: "demo:demo", effort: "low", soul: "" }];
}

/** A session that talks to a model directly: "@claude:claude-opus-5-5". */
export function modelAgent(id: string, label: string): AgentProfile {
  return { id, name: label, role: "Model", glyph: "spark", specialty: "custom", model: id.slice(1), effort: "medium", soul: "" };
}

/** The most of one context file an agent is handed, so a stray log can't fill its context. */
const CONTEXT_MAX = 48_000;

/** Where one of an agent's paths is: absolute and ~ paths as they are, others in the session's folder. */
export const pathIn = (p: string, cwd: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : isAbsolute(p) ? p : join(cwd, p));

/**
  What an agent is told on top of the tool's own prompt, at the start of each session: its soul,
  then its prompt, so both hold on every turn; the skills it may read when a task calls for one
  (each a skill.md file, by name, line and path); and its context files as they read now. A
  relative path is looked for in the session's folder; one that isn't there is left out.
*/
export function briefOf(agent: Pick<AgentProfile, "soul" | "prompt" | "skills" | "contextFiles">, cwd: string): string {
  const parts = [agent.soul.trim(), agent.prompt?.trim() ?? ""];
  const skills = (agent.skills ?? []).flatMap((p) => {
    const s = skillAt(pathIn(p, cwd));
    return s?.path ? [`- ${s.name} (${isAbsolute(p) || p.startsWith("~/") ? s.path : relative(cwd, s.path)})${s.description ? `: ${s.description}` : ""}`] : [];
  });
  if (skills.length) parts.push(`## Skills\n\nWhen a task calls for one of these, read its file first and follow it.\n\n${skills.join("\n")}`);
  const files = (agent.contextFiles ?? []).flatMap((p) => {
    try {
      const text = readFileSync(pathIn(p, cwd), "utf8");
      const cut = text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX)}\n[… the rest of the file is left out]` : text;
      return [`<file path="${p}">\n${cut.trim()}\n</file>`];
    } catch {
      return [];
    }
  });
  if (files.length) parts.push(`## Context files\n\nRead at the start of this session, as they were then.\n\n${files.join("\n\n")}`);
  return parts.filter(Boolean).join("\n\n");
}
