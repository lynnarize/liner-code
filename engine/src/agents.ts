/*
  The team a fresh install starts with, from the first run's "A lead and a coder": Helm plans
  on Opus and hands the code to Forge on Sonnet. Agents are optional: a session can also talk to
  a model directly, with an id like "@claude:claude-opus-5-5", which needs no profile at all.
*/
import type { AgentProfile } from "../../contracts/src/index.ts";

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
