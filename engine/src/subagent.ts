/*
  Ephemeral subagents for providers that don't have working native subagents in Liner Code
  (OpenCode, where ACP drops child permissions so its own task/subagent is denied; Cursor, Grok,
  and added ACP agents). Claude Code, Codex, Hermes and Antigravity keep their own native
  subagents, matching T3 Code's native-first approach.

  Read-only subagents (mode: "read", the default) run in parallel up to SUBAGENT_MAX_CONCURRENT
  when the lead emits multiple calls in one turn; write subagents (mode: "write") queue behind any
  active writer so two children never race on the same working tree. Data and words only, so the
  tools and the runtime both read it.
*/
import type { FileChange } from "../../contracts/src/index.ts";
import { SUBAGENT_MAX_DEFAULT } from "../../contracts/src/index.ts";
import { SUBAGENT_ENV } from "./liner-tools.ts";
import { SIDEKICK_MS } from "./sidekick.ts";

/** How long one subagent call may run before Liner Code stops it and returns what it found so far. */
export const SUBAGENT_MS = SIDEKICK_MS;
/** Default number of read-only subagents that may run side by side in one session at a time. */
export const SUBAGENT_MAX_CONCURRENT = SUBAGENT_MAX_DEFAULT;
export { SUBAGENT_ENV };
/**
  Provider families whose native subagents already work through Liner Code (Claude Code's Agent/Task,
  Codex's spawnAgent, OpenCode's shared V2 HTTP daemon, Hermes's delegate_task, Antigravity's
  invoke_subagent, and Demo). Every other family (Cursor, Grok, added ACP agents, or OpenCode forced
  onto legacy ACP via LINER_OPENCODE_ACP=1) gets Liner Code's `subagent` tool.
*/
export const NATIVE_SUBAGENT_FAMILIES = new Set(["claude", "codex", "opencode", "hermes", "antigravity", "demo"]);
export const needsSubagentTool = (family: string, env?: NodeJS.ProcessEnv) => (family === "opencode" ? env?.LINER_OPENCODE_ACP === "1" : !NATIVE_SUBAGENT_FAMILIES.has(family));

/**
  The subagent tool by the name each provider gives Liner Code's: mcp__liner__subagent (Claude Code),
  liner.subagent (Codex, ACP), liner_subagent (OpenCode), mcp__editor_liner_<8 hex>__subagent (Hermes).
*/
export const isSubagentTool = (tool: string) => /^(?:mcp__liner__|liner[._]|mcp__editor_liner_[0-9a-f]{8}__)subagent$/.test(tool);

/** What a subagent's task reads as on its row: its title, else the prompt's first non-empty line, cut to 80 chars. */
export function subagentTask(title: unknown, prompt?: unknown) {
  const raw = String(title ?? "").trim() || String(prompt ?? "");
  const line = raw.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  return line.length > 80 ? `${line.slice(0, 78).trimEnd()}…` : line;
}

/** The tool row's title: "Subagent: Audit CSS height tokens". */
export const subagentTitle = (title: unknown, prompt?: unknown) => {
  const task = subagentTask(title, prompt);
  return task ? `Subagent: ${task}` : "Subagent";
};

/** What a session offered Liner Code's `subagent` tool is told beside toolsNote. */
export function subagentLeadNote(n: (tool: string) => string = (t) => t, max = SUBAGENT_MAX_CONCURRENT) {
  return [
    `${n("subagent")} spawns a focused subagent in this folder with a fresh context and waits for its report.`,
    `Use mode: "read" (the default) for research, codebase mapping, audits or planning: up to ${max} read-only subagents run in parallel when you call ${n("subagent")} multiple times in one turn, and they cannot edit files. Use mode: "write" for bounded implementation tasks (write subagents run one at a time in this folder and return the files they changed, measured by Liner Code).`,
    "Give each subagent a self-contained prompt with the exact goal, scope and what to report; it sees nothing of this conversation and cannot ask the person questions.",
  ].join(" ");
}

/** What a child subagent is told as its system instructions. */
export function subagentRules(parent: string, mode: "read" | "write") {
  return [
    `You are an ephemeral subagent in a Liner Code session led by ${parent}. Do only the task given in this message.`,
    "You cannot ask anyone questions while you work: if something is ambiguous, take the smallest reasonable reading, note your assumption in your report, and continue. Do not spawn subagents of your own.",
    mode === "read"
      ? "You are strictly read-only: read and search files to answer the task, and never edit files or run commands that change state."
      : "Before you finish, verify your changes with the check named in the task (or the nearest test/typecheck/build command) and review what you changed.",
    mode === "read"
      ? "End with a concise, factual report: your findings with exact file:line references and any gaps or assumptions. Facts, not narration."
      : "End with a concise, factual report: what you changed, the files you touched, the checks you ran and their results, and anything left unfinished. Facts, not narration.",
  ].join("\n");
}

/** What the subagent is sent as its turn prompt. */
export const subagentPrompt = (prompt: string, doneWhen?: string) => (doneWhen ? `${prompt}\n\nDone when: ${doneWhen}` : prompt);

export type SubagentOutcome = {
  how: "done" | "failed" | "stopped" | "capped" | "limited" | "agent";
  who: string;
  mode: "read" | "write";
  seconds: number;
  report: string;
  files?: FileChange[] | null;
  problem?: string;
  unstarted?: boolean;
  capMs?: number;
  agent?: string;
};

const took = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const REPORT_MAX = 6000;

function capOf(ms?: number) {
  if (ms === undefined) return `the ${Math.round(SUBAGENT_MS / 60_000)}-minute cap for one subagent`;
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s % 60 ? took(s) : `${s / 60} min`}, the cap for one subagent call here`;
}

/** What the lead reads back from a subagent call: short enough to fit cleanly in its context. */
export function subagentResult(o: SubagentOutcome) {
  if (o.unstarted) return `The subagent (${o.who}) was stopped before it started: nothing was done.`;
  const who = `the subagent (${o.who})`;
  const head = {
    done: `The subagent (${o.who}) finished in ${took(o.seconds)}.`,
    failed: `The subagent (${o.who}) failed after ${took(o.seconds)}: ${o.problem ?? "its tool stopped with a problem"}.`,
    stopped: `The subagent (${o.who}) was stopped after ${took(o.seconds)}. This is what it had done so far.`,
    capped: `Liner Code stopped ${who} at ${capOf(o.capMs)}. This is what it had done so far.`,
    limited: `The subagent (${o.who}) hit a usage limit after ${took(o.seconds)}${o.problem ? ` (${o.problem})` : ""}. This is what it had done so far.`,
    agent: `Liner Code stopped ${who} after ${took(o.seconds)}: it tried to spawn another agent${o.agent ? ` ("${o.agent}")` : ""}, which subagents may not do.`,
  }[o.how];
  const said = o.report.trim();
  const report = said.length > REPORT_MAX ? `…${said.slice(-REPORT_MAX)}` : said;
  const files =
    o.mode !== "write"
      ? ""
      : o.files === null || o.files === undefined
        ? "Files changed: not measured (this folder couldn't be snapshotted)."
        : o.files.length
          ? `Files changed (measured):\n${o.files.map((f) => `- ${f.path}${f.from ? ` (from ${f.from})` : ""}: ${f.status}, +${f.added} -${f.removed}`).join("\n")}`
          : "Files changed (measured): none.";
  const note = o.mode === "write" ? "The report is its own claim: check the diff before you rely on it." : "";
  return [head, `Report:\n${report || "(It said nothing.)"}`, files, note].filter(Boolean).join("\n\n");
}
