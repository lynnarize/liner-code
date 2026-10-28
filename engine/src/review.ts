/*
  The Reviewer and the subagents, as text and rules: what the Reviewer is asked, how its
  findings are read back, what the coder is told when a finding blocks, and which subagents a
  Claude Code agent brings for each run mode. The runtime does the running.
*/
import type { AgentProfile, Finding, ProviderInfo, RunMode } from "../../contracts/src/index.ts";
import { familyOf, splitModel } from "../../contracts/src/index.ts";

/** What the Reviewer checks, the same every time, so its calls are comparable. */
export const CRITERIA = [
  "It does what was asked, and nothing that wasn't.",
  "No bugs: edge cases, errors, races, off-by-one, wrong types.",
  "Tests cover the change, or it says why they can't.",
  "No secrets, unsafe calls, or code that runs input it shouldn't trust.",
  "It reads like the code around it.",
];

export function reviewPrompt(ask: string, diff: string, round: number) {
  return [
    "You review a change another agent just made in this project, before the user sees it. You read only: never edit files or run commands that change anything.",
    `What the user asked for:\n<ask>\n${ask.slice(0, 4000)}\n</ask>`,
    `The change (a unified diff):\n<diff>\n${diff}\n</diff>`,
    `Check it against these criteria, and read any file you need to:\n${CRITERIA.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
    round > 1 ? "This is a second look: the coder already tried to fix your last notes. Block only what is still wrong." : "",
    'End your reply with exactly one block: <findings>{"verdict":"pass"|"fail","summary":"one sentence","findings":[{"file":"path","line":12,"endLine":14,"severity":"blocking"|"note","note":"what is wrong and why, in one or two sentences"}]}</findings>. Use "blocking" only for things that must change before this ships; style and nice-to-haves are "note". An empty findings list with "pass" is a fine answer.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The Reviewer's verdict and findings, read from its <findings> block (or a bare JSON object). */
export function parseFindings(text: string): { verdict: "pass" | "fail"; summary?: string; findings: Finding[] } | null {
  const m = /<findings>([\s\S]*?)<\/findings>/.exec(text) ?? /(\{[\s\S]*"verdict"[\s\S]*\})\s*$/.exec(text.trim());
  if (!m) return null;
  try {
    const v = JSON.parse(m[1].trim()) as { verdict?: string; summary?: string; findings?: Partial<Finding>[] };
    const findings: Finding[] = (v.findings ?? [])
      .filter((f) => f && typeof f.file === "string" && typeof f.note === "string")
      .map((f) => ({ file: f.file!.replace(/^\.?\//, ""), line: typeof f.line === "number" ? f.line : undefined, endLine: typeof f.endLine === "number" ? f.endLine : undefined, severity: f.severity === "blocking" ? "blocking" : "note", note: f.note! }));
    const verdict = v.verdict === "fail" || findings.some((f) => f.severity === "blocking") ? "fail" : "pass";
    return { verdict, summary: v.summary, findings };
  } catch {
    return null;
  }
}

/** What the coder is told when the Reviewer blocks. */
export function fixPrompt(reviewer: string, findings: Finding[]) {
  const lines = findings.filter((f) => f.severity === "blocking").map((f) => `- ${f.file}${f.line ? `:${f.line}${f.endLine && f.endLine !== f.line ? `-${f.endLine}` : ""}` : ""}: ${f.note}`);
  return `The Reviewer (${reviewer}) found problems in your last change that must be fixed before it ships:\n${lines.join("\n")}\n\nFix these, run the tests that cover them, and say in one line what you changed. Leave everything else as it is.`;
}

/**
  Who reviews an agent's work, as "<provider>:<model>". "auto" picks another model family than
  the agent's when one is ready (Codex reviewing Claude, Claude reviewing the rest), so the two
  don't share blind spots.
*/
export function reviewerFor(agent: AgentProfile, providers: ProviderInfo[]): string | null {
  // null is "Nobody", a choice; only an unset reviewer falls back to the default.
  const set = agent.subagents?.reviewer;
  const want = set === null ? null : (set ?? (agent.specialty === "coder" ? "auto" : null));
  if (!want) return null;
  if (want !== "auto") return want;
  const family = familyOf(splitModel(agent.model).provider);
  const ready = (id: string) => providers.find((p) => p.id === id && p.available && p.adapter && p.models.length);
  const other = family === "claude" ? (ready("codex") ?? ready("opencode")) : ready("claude");
  if (other) return `${other.id}:${other.id === "claude" ? "claude-opus-5-5" : other.models[0].id}`;
  return ready("claude") ? "claude:claude-opus-5-5" : null;
}

export type SubagentDef = { description: string; prompt: string; tools?: string[]; model?: string };

/** The run mode an agent uses when it doesn't say: coders bring helpers, the rest run alone. */
export const runModeOf = (agent: AgentProfile): RunMode => agent.runMode ?? (agent.specialty === "coder" || agent.specialty === "debugger" ? "helpers" : "single");

/**
  The subagents a Claude Code agent brings, and the model its own loop runs on.
  helpers: its own model, with an Explorer and a Test runner on Haiku that only read and run tests.
  escalate: Sonnet runs the loop and asks Opus to plan only when a change is hard.
*/
export function claudeTeam(agent: AgentProfile, model: string): { model: string; agents: Record<string, SubagentDef> } {
  const mode = runModeOf(agent);
  if (mode === "single") return { model, agents: {} };
  const small = (ref?: string) => (ref ?? "claude:claude-haiku-5-5").replace(/^claude:/, "");
  const agents: Record<string, SubagentDef> = {
    explorer: {
      description: "Explorer: reads and maps the code for you. Use it to find where something lives, how parts connect, or what a change will touch, before you edit. It only reads.",
      prompt: "You are the Explorer. Read and search the code to answer the question you were given. Report file:line references and a short summary. Never edit anything.",
      tools: ["Read", "Grep", "Glob", "LS"],
      model: small(agent.subagents?.explorer),
    },
    "test-runner": {
      description: "Test runner: runs the project's tests (or a subset) and reads the failures for you. Use it after a change, instead of running long test output yourself.",
      prompt: "You are the Test runner. Run the tests you were asked to run, then report which pass, which fail, and the first useful line of each failure. Don't fix anything.",
      tools: ["Bash", "Read", "Grep", "Glob"],
      model: small(agent.subagents?.tests),
    },
  };
  if (mode === "escalate") {
    agents["opus-planner"] = {
      description: "Ask Opus: plans a hard change for you. Use it to plan a change across several areas of the code, after tests fail twice, or when the Reviewer rejects your work twice. It only reads and returns a plan.",
      prompt: "You are Opus, asked to plan a hard change. Read what you need, then return a short, ordered plan: the steps, the files each touches, and how to check it. Don't edit anything.",
      tools: ["Read", "Grep", "Glob", "LS"],
      model: "claude-opus-5-5",
    };
    return { model: "claude-sonnet-5-5", agents };
  }
  return { model, agents };
}

/** "explorer" → "Explorer", "test-runner" → "Test runner", "opus-planner" → "Opus". */
export function subagentName(type: string) {
  if (type === "opus-planner") return "Opus";
  if (type === "test-runner") return "Test runner";
  if (type === "general-purpose") return "Subagent";
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, " ");
}

/** Plan steps handed to someone other than the coder: "… — @Herald" or "… (Herald)". */
export function assignments(plan: string, names: string[]) {
  const out = new Map<string, string[]>();
  for (const line of plan.split("\n")) {
    if (!/^\s*(\d+[.)]|[-*•])\s+/.test(line)) continue;
    const who = names.find((n) => new RegExp(`(@${n}\\b|\\(${n}\\)|—\\s*${n}\\s*$)`, "i").test(line));
    if (who) out.set(who, [...(out.get(who) ?? []), line.trim()]);
  }
  return out;
}
