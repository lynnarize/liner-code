/*
  The Reviewer and the subagents, as text and rules: what the Reviewer is asked, how its
  findings are read back, what the coder is told when a finding blocks, and which subagents a
  Claude Code writer brings. An Auto session's judge and critics read the same way; what the strong model is told to repair, and what a writer is told after a critique,
  are here too, and the one line Reviewer decides asks about each step. The runtime does the running.
*/
import type { AgentProfile, Finding, ProviderInfo, Risk, RunMode } from "../../contracts/src/index.ts";
import { makerOf, splitModel } from "../../contracts/src/index.ts";

/** What the Reviewer checks, the same every time, so its calls are comparable. */
export const CRITERIA = [
  "It does what was asked, and nothing that wasn't.",
  "No bugs: edge cases, errors, races, off-by-one, wrong types.",
  "Tests cover the change, or it says why they can't.",
  "No secrets, unsafe calls, or code that runs input it shouldn't trust.",
  "It reads like the code around it.",
];

/** reviewer: the Reviewer. judge: a cascade's, whose fail sends the change to a stronger model. critic: one of several reading side by side. */
export function reviewPrompt(ask: string, diff: string, round: number, as: "reviewer" | "judge" | "critic" = "reviewer") {
  return [
    "You review a change another agent just made in this project, before the user sees it. You read only: never edit files or run commands that change anything.",
    as === "judge" ? "A quicker model made it. If you pass it, it ships as it is; if you fail it, a stronger model repairs it from your findings alone, so pass what's right and name exactly what isn't." : "",
    as === "critic" ? "Other reviewers read it at the same time. The author sees all of your findings together and revises once, so give each problem with where it is and what would fix it." : "",
    `What the user asked for:\n<ask>\n${ask.slice(0, 4000)}\n</ask>`,
    `The change (a unified diff):\n<diff>\n${diff}\n</diff>`,
    `Check it against these criteria, and read any file you need to:\n${CRITERIA.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
    round > 1 ? "This is a second look: the coder already tried to fix your last notes. Block only what is still wrong." : "",
    'End your reply with exactly one block: <findings>{"verdict":"pass"|"fail","summary":"one sentence","findings":[{"file":"path","line":12,"endLine":14,"severity":"blocking"|"note","note":"what is wrong and why, in one or two sentences"}]}</findings>. Use "blocking" only for things that must change before this ships; style and nice-to-haves are "note". An empty findings list with "pass" is a fine answer.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
  The Reviewer's verdict and findings, read from its <findings> block (or a bare JSON object). The
  last block that reads counts: a model that echoes the format first, or wraps its JSON in a code
  fence, still gives its verdict, and "FAIL" fails.
*/
export function parseFindings(text: string): { verdict: "pass" | "fail"; summary?: string; findings: Finding[] } | null {
  const blocks = [...text.matchAll(/<findings>([\s\S]*?)<\/findings>/g)].map((m) => m[1]);
  const trimmed = text.trim();
  // No block: a bare JSON object at the end, from whichever "{" starts one that reads.
  if (!blocks.length && trimmed.endsWith("}")) for (let i = trimmed.indexOf("{"); i >= 0; i = trimmed.indexOf("{", i + 1)) blocks.unshift(trimmed.slice(i));
  for (const block of blocks.reverse()) {
    const read = readFindings(block.trim().replace(/^```\w*\s*/, "").replace(/\s*```$/, ""));
    if (read) return read;
  }
  return null;
}

function readFindings(json: string) {
  try {
    const v = JSON.parse(json) as { verdict?: string; summary?: string; findings?: Partial<Finding>[] };
    if (!v || typeof v !== "object" || (typeof v.verdict !== "string" && !Array.isArray(v.findings))) return null;
    const findings: Finding[] = (Array.isArray(v.findings) ? v.findings : [])
      .filter((f) => f && typeof f.file === "string" && typeof f.note === "string")
      .map((f) => ({ file: f.file!.replace(/^\.?\//, ""), line: typeof f.line === "number" ? f.line : undefined, endLine: typeof f.endLine === "number" ? f.endLine : undefined, severity: String(f.severity).toLowerCase() === "blocking" ? "blocking" : "note", note: f.note! }));
    const verdict: "pass" | "fail" = String(v.verdict ?? "").toLowerCase() === "fail" || findings.some((f) => f.severity === "blocking") ? "fail" : "pass";
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

const mustFixFirst = (findings: Finding[]) => [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));

/** What the strong model is told when a cascade's judge won't pass the quicker model's change. */
export function repairPrompt(judge: string, writer: string, findings: Finding[]) {
  const lines = mustFixFirst(findings).map((f) => `- ${f.severity === "blocking" ? "" : "(a note) "}${f.file}${f.line ? `:${f.line}${f.endLine && f.endLine !== f.line ? `-${f.endLine}` : ""}` : ""}: ${f.note}`);
  return `${writer} just made a change for the request above, and a judge (${judge}) didn't pass it:\n${lines.join("\n")}\n\nYou're the stronger model, brought in to repair it. Read the change as it is in the files. Keep what's right and fix what the judge found; if the approach itself is wrong, redo it. Run the tests that cover it, then say in a line or two what you changed.`;
}

/** What the frontier model is told when it refines the cheaper one's change (After a change: Refine). */
export function refinePrompt(writer: string, ask: string, diff: string) {
  return [
    `${writer} just made a first pass at this ask. You're the stronger model, brought in to finish it.`,
    `What the user asked for:\n<ask>\n${ask.slice(0, 4000)}\n</ask>`,
    `The change so far (a unified diff):\n<diff>\n${diff}\n</diff>`,
    "Work on the files as they are now. Keep what works and don't redo it. Fix what's wrong or missing: bugs, edge cases, errors that aren't handled, anything that doesn't do what was asked. Then tighten it so it reads like the code around it. Run the tests that cover it, then say in a line or two what you changed.",
  ].join("\n\n");
}

/** What a cascade's judge reads when the quicker model changed no files: the ask and its answer. */
export function answerPrompt(ask: string, answer: string) {
  return [
    "You check another agent's work before the user sees it. You read only: never edit files or run commands that change anything.",
    `What the user asked for:\n<ask>\n${ask.slice(0, 4000)}\n</ask>`,
    `A quicker model worked on it and changed no files. What it said:\n<answer>\n${answer.slice(0, 8000) || "(nothing)"}\n</answer>`,
    "Read any file you need. If the ask needed no change (a question, a check, a report) and the answer does it right, pass it. If it needed a change and none was made, or the answer is wrong, fail it: a stronger model then does the work from your summary alone, so say what's missing.",
    'End your reply with exactly one block: <findings>{"verdict":"pass"|"fail","summary":"one sentence","findings":[]}</findings>. Findings may stay empty; put a file in one only when you point at a line.',
  ].join("\n\n");
}

/** What the strong model is told when the quicker one didn't get the ask done at all. */
export function takeOverPrompt(judge: string, writer: string, why: string, findings: Finding[]) {
  const lines = mustFixFirst(findings).map((f) => `- ${f.file}${f.line ? `:${f.line}` : ""}: ${f.note}`);
  return `${writer} worked on the request above and didn't get it done. A judge (${judge}) says: ${why || "it made no change."}${lines.length ? `\n${lines.join("\n")}` : ""}\n\nYou're the stronger model, brought in to do it. Read what you need, make the change, run the tests that cover it, then say in a line or two what you changed.`;
}

/** What a writer is told when critics read its change: everything they found, to keep or revise, once. */
export function critiquePrompt(critics: string[], findings: Finding[]) {
  const lines = mustFixFirst(findings).map((f) => `- ${f.severity === "blocking" ? "Must fix" : "Note"}, ${f.file}${f.line ? `:${f.line}${f.endLine && f.endLine !== f.line ? `-${f.endLine}` : ""}` : ""}: ${f.note}`);
  return `${critics.join(" and ")} read your change side by side. What they found:\n${lines.join("\n")}\n\nRevise your change once with this. Fix what must be fixed; take a note only where it makes the change better, and where you're sure a finding is wrong, leave it and say why. Run the tests that cover it, then say in a line or two what you changed.`;
}

/** The Reviewer's quickest model, for deciding one step at a time: Haiku for Claude, a mini for the others, from the same maker in a tool that runs many. */
export function quickOf(ref: string, providers: ProviderInfo[]) {
  const { provider } = splitModel(ref);
  const quick = providers.find((p) => p.id === provider)?.models.find((m) => !m.legacy && /haiku|mini|flash|fast/i.test(m.id) && makerOf(`${provider}:${m.id}`) === makerOf(ref));
  return quick ? `${provider}:${quick.id}` : ref;
}

/**
  Reviewer decides: the Reviewer reads one step the agent would otherwise ask you about, and lets
  it go ahead or hands it to you. It answers from what's here, without running anything.
*/
export function stepPrompt(ask: string, step: { title: string; fields: { label: string; value: string }[]; risk: Risk }, cwd: string) {
  return [
    "You decide, for a person, whether the coding agent working for them may take one step without asking them.",
    "",
    `What they asked the agent:\n"""\n${ask.trim().slice(0, 2000) || "(not said)"}\n"""`,
    "",
    `The step: ${step.title}`,
    ...step.fields.map((f) => `${f.label}: ${f.value}`),
    `Risk by the app's own rules: ${step.risk}`,
    `The project's folder: ${cwd}`,
    "",
    "ALLOW it when it is routine for that ask and stays in the project's folder: reading anything, building, testing, linting, formatting, running or serving the app, installing the project's own dependencies.",
    "ASK when it reaches outside the folder, deletes or overwrites what git can't bring back, pushes, publishes, deploys, spends money, sends anything off this machine other than fetching packages, touches secrets or keys, or has nothing to do with the ask. When unsure, ASK.",
    "",
    "Don't run or read anything; answer from what's above. Reply with one line: ALLOW or ASK, a colon, then why in under 15 words.",
  ].join("\n");
}

/**
  The Reviewer's call on a step, or null when it didn't make one: the last line that starts with
  ALLOW or ASK (bold or not), so a word in passing ("I can't ALLOW this. ASK: …") isn't the call.
*/
export function parseStep(text: string): { allow: boolean; reason: string } | null {
  const m = [...text.matchAll(/^[ \t*_`]*(ALLOW|ASK)\b[*_`]*[ \t]*[:\-–—]?[ \t]*([^\n]*)/gm)].pop();
  return m ? { allow: m[1] === "ALLOW", reason: m[2].trim().replace(/^["']|["']$/g, "").slice(0, 160) } : null;
}

export type SubagentDef = { description: string; prompt: string; tools?: string[]; model?: string };

/** The run mode a writer uses: helpers unless its agent says it runs alone ("escalate", from before, runs with helpers). */
export const runModeOf = (agent: AgentProfile): RunMode => (agent.runMode === "single" ? "single" : "helpers");

/**
  The subagents a Claude Code writer brings (an agent or a bare model), and the model its own loop
  runs on: its own, with an Explorer and a Test runner on Haiku that only read and run tests, so
  long reads and test output stay out of its context.
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
  return { model, agents };
}

/** "explorer" → "Explorer", "test-runner" → "Test runner"; "opus-planner" from older sessions → "Opus". */
export function subagentName(type: string) {
  if (type === "opus-planner") return "Opus";
  if (type === "test-runner") return "Test runner";
  if (type === "general-purpose") return "Subagent";
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, " ");
}
