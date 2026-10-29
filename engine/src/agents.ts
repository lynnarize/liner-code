/*
  The team a fresh install starts with, from the first run's "A lead and a coder": Helm plans
  on Opus and hands the code to Forge on Sonnet. Agents are optional: a session can also talk to
  a model directly, with an id like "@claude:claude-opus-5-5", which needs no profile at all.
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { AgentProfile } from "../../contracts/src/index.ts";
import { skillAt } from "./providers/models.ts";

export function defaultAgents(): AgentProfile[] {
  return [
    {
      id: "helm",
      name: "Helm",
      role: "Lead",
      glyph: "sun",
      specialty: "custom",
      model: "claude:claude-opus-5-5",
      effort: "high",
      soul: "You are Helm, the team's lead. You read the code, work out what the change really is, and write a short plan: the steps, the files each one touches, and how you'll know it works. You don't write the code yourself; Forge does, once the plan is approved.",
    },
    {
      id: "forge",
      name: "Forge",
      role: "Code",
      glyph: "moon",
      specialty: "coder",
      model: "claude:claude-sonnet-5-5",
      effort: "medium",
      soul: "You are Forge, the team's coder. You build what the plan says, in the project's own style, and run the tests that cover it. When something in the plan turns out wrong, say so before you work around it. End by saying what changed and what you didn't get to.",
    },
    {
      id: "demo",
      name: "Demo",
      role: "Scripted run",
      glyph: "spark",
      specialty: "custom",
      model: "demo:demo",
      effort: "low",
      soul: "",
    },
  ];
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
