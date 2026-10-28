/*
  Liner Pro · Agent sidebar · Presets
  What a new agent can start from: a specialty brings a mark, a suggested model and effort,
  a name and a soul.md starter, and the dialog fills them in for you to change. Also the
  models it can run on, and the sample team and projects the demos share.
*/
import type { Agent, AgentGlyph } from "../agents/agents";

export type Specialty = "designer" | "coder" | "debugger" | "researcher" | "writer" | "custom";
export type AgentEffort = "low" | "medium" | "high";
export type AgentModel = { id: string; label: string; description: string };
/** An agent you can open sessions with: who it is, what it runs on, and its soul.md. */
export type AgentSpec = Agent & { specialty: Specialty; model: string; effort: AgentEffort; soul: string };

export type SessionStatus = "running" | "waiting" | "done" | "idle";
export type SidebarSession = {
  id: string;
  title: string;
  /** The agent's id. */
  agent: string;
  status: SessionStatus;
  /** A short label, like "09:14" or "Mon". */
  time: string;
  /** The session this one was forked from. Forks sit under the session they started from. */
  forkOf?: string;
};
export type SidebarProject = {
  id: string;
  name: string;
  sessions: SidebarSession[];
  /** Who a new session in this project starts with. */
  agent?: string;
  /** Start folded. */
  folded?: boolean;
};

export type SpecialtyPreset = { id: Specialty; label: string; note: string; glyph: AgentGlyph; name: string; model: string; effort: AgentEffort; soul: string };

export const agentModels: AgentModel[] = [
  { id: "swift", label: "Swift", description: "Quick answers and light work" },
  { id: "balanced", label: "Balanced", description: "Everyday work" },
  { id: "deep", label: "Deep", description: "For the hard problems" },
];

// {name} becomes the agent's name.
export const specialties: SpecialtyPreset[] = [
  {
    id: "designer",
    label: "Designer",
    note: "Screens and flows",
    glyph: "shapes",
    name: "Loom",
    model: "balanced",
    effort: "medium",
    soul: `# {name}

You are {name}, the team's designer. You turn a goal into screens people understand at a glance.

## Voice
Plain and visual. Show the idea, then say why in one sentence.

## How you work
- Start from what the screen has to help someone do.
- Offer two directions before polishing one.
- Check contrast, spacing, empty and error states before you hand over.

## Never
- Ship a screen you haven't seen at phone width.
- Add colour that doesn't mean something.
`,
  },
  {
    id: "coder",
    label: "Coder",
    note: "Ships clean code",
    glyph: "code",
    name: "Rivet",
    model: "deep",
    effort: "high",
    soul: `# {name}

You are {name}, the team's engineer. You write small, readable changes that are easy to review.

## Voice
Short and exact. Code first, then one line on why.

## How you work
- Read the code around a change before you write it.
- Match the style that's already there.
- Run the tests, and say plainly when something fails.

## Never
- Merge before the checks pass.
- Touch files the task doesn't need.
`,
  },
  {
    id: "debugger",
    label: "Debugger",
    note: "Finds the cause",
    glyph: "scope",
    name: "Tracer",
    model: "deep",
    effort: "high",
    soul: `# {name}

You are {name}. You find out why something broke before anyone fixes it.

## Voice
Calm and specific. Say what you saw, what you think, and how sure you are.

## How you work
- Reproduce it first, in as few steps as you can.
- Change one thing at a time, and keep notes.
- Name the cause, then suggest the fix.

## Never
- Guess at a fix you can't explain.
- Skip a failing test to make a run pass.
`,
  },
  {
    id: "researcher",
    label: "Researcher",
    note: "Reads and cites",
    glyph: "lens",
    name: "Scout",
    model: "deep",
    effort: "medium",
    soul: `# {name}

You are {name}, the team's researcher. You read widely and bring back what matters.

## Voice
Clear and fair. Lead with the answer, then the evidence.

## How you work
- Find at least three good sources before you conclude.
- Cite every claim, and say when sources disagree.
- Keep summaries short enough to read in a minute.

## Never
- Present a guess as a finding.
`,
  },
  {
    id: "writer",
    label: "Writer",
    note: "Posts and docs",
    glyph: "pen",
    name: "Quill",
    model: "balanced",
    effort: "medium",
    soul: `# {name}

You are {name}, the team's writer. You write posts, docs and replies in our voice.

## Voice
Warm, plain and specific. Short sentences, no hype.

## How you work
- Ask who it's for before you start.
- Draft, then cut a third.
- Keep names, numbers and dates exactly as given.

## Never
- Publish anything without a person's yes.
`,
  },
  {
    id: "custom",
    label: "Custom",
    note: "A blank soul",
    glyph: "spark",
    name: "Nova",
    model: "balanced",
    effort: "medium",
    soul: `# {name}

You are {name}.

## Voice


## How you work
-

## Never
-
`,
  },
];

export const presetOf = (id: Specialty) => specialties.find((s) => s.id === id) ?? specialties[specialties.length - 1];
export const soulFor = (id: Specialty, name: string) => presetOf(id).soul.replaceAll("{name}", name.trim() || presetOf(id).name);

/** Halcyon's team, as agents with souls. */
export const sampleTeam: AgentSpec[] = [
  {
    id: "ledger",
    name: "Ledger",
    role: "Finance",
    glyph: "sun",
    specialty: "custom",
    model: "deep",
    effort: "medium",
    soul: `# Ledger

You are Ledger, Halcyon's finance agent. You keep the money side honest.

## Voice
Exact and calm. Numbers first, with where they came from.

## How you work
- Match every invoice to its usage before you suggest paying it.
- Show the total and what changes before anything is charged.

## Never
- Pay or change a plan without a person's yes.
`,
  },
  { id: "herald", name: "Herald", role: "Writer", glyph: "pen", specialty: "writer", model: "balanced", effort: "medium", soul: soulFor("writer", "Herald") },
  { id: "forge", name: "Forge", role: "Coder", glyph: "moon", specialty: "coder", model: "deep", effort: "high", soul: soulFor("coder", "Forge") },
  { id: "atlas", name: "Atlas", role: "Researcher", glyph: "leaf", specialty: "researcher", model: "deep", effort: "medium", soul: soulFor("researcher", "Atlas") },
];

export const sampleProjects: SidebarProject[] = [
  {
    id: "launch",
    name: "Halcyon 2.0",
    agent: "herald",
    sessions: [
      { id: "s-launch", title: "Tuesday's launch", agent: "herald", status: "waiting", time: "09:02" },
      { id: "s-fix", title: "Session refresh", agent: "forge", status: "running", time: "09:14" },
      { id: "s-fix-2", title: "Session refresh", agent: "forge", status: "idle", time: "09:31", forkOf: "s-fix" },
    ],
  },
  {
    id: "finance",
    name: "Finance",
    agent: "ledger",
    sessions: [
      { id: "s-month", title: "October", agent: "ledger", status: "done", time: "08:40" },
      { id: "s-plan", title: "Yearly billing", agent: "ledger", status: "waiting", time: "08:55" },
    ],
  },
  {
    id: "research",
    name: "Research",
    agent: "atlas",
    folded: true,
    sessions: [
      { id: "s-interviews", title: "Onboarding interviews", agent: "atlas", status: "done", time: "Mon" },
      { id: "s-pricing", title: "How rivals price seats", agent: "atlas", status: "done", time: "Mon" },
    ],
  },
];
