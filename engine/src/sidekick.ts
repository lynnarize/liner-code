/*
  Lead + sidekick: what each is told, and what the lead reads back from a brief. A pair's lead
  owns the session; it hands bounded work to a quicker model through Liner Code's `sidekick` tool
  (liner-tools.ts), and the runtime runs each brief as one turn of the sidekick's own session in
  the same folder (Runtime.delegate). Data and words only, so the tools and the runtime both read it.
*/
import type { FileChange } from "../../contracts/src/index.ts";

/** How long one brief may run before it's stopped and the lead is told what was done so far. */
export const SIDEKICK_MS = 10 * 60_000;
/** Put after a thread's id by a sidekick's key to Liner Code's tools, so its calls are told from the lead's. */
export const AS_SIDEKICK = "#sidekick";
/** What a question from the sidekick is answered with: nobody is there to answer it. */
export const NOBODY = "Nobody can answer: the person isn't watching this brief and the lead is waiting for it to finish. State your assumption in your report and carry on.";

/**
  The sidekick tool by the name each tool gives Liner Code's: mcp__liner__sidekick (Claude Code), liner.sidekick (Codex, ACP),
  liner_sidekick (OpenCode), mcp__editor_liner_<8 hex>__sidekick (Hermes, which tags a server handed over ACP per session).
*/
export const isSidekickTool = (tool: string) => /^(?:mcp__liner__|liner[._]|mcp__editor_liner_[0-9a-f]{8}__)sidekick$/.test(tool);

/**
  What a brief needs to end in before the lead's tool gives up on the call: stopping the sidekick (an ACP agent gets
  15 seconds to cancel), snapshotting the folder after, and the answer's way back.
*/
export const BRIEF_MARGIN_MS = 60_000;
/**
  The least time a brief is started with. One with less left on its call (the briefs before it in line used that up, or
  the tool never waits long enough) isn't started at all: it would be cut as soon as it began.
*/
export const BRIEF_MIN_MS = 15_000;
/**
  How long the lead's turn waits, once it ends, for a brief it stopped to wind down (its tool cancelling, its last edits,
  its after snapshot, its use logged) before the turn takes its own after snapshot. An ACP agent gets 15 seconds to cancel;
  one that never answers can't hold the turn past this.
*/
export const BRIEF_WIND_MS = 30_000;
/**
  How long one brief may run when the lead's tool waits `toolWait` ms at most on a call (Provider.toolWait): its own
  wait less the margin, never more than `cap`. Unknown or unbounded: the cap. At or below 0 there's no time for one.
*/
export const briefCap = (toolWait: number | null | undefined, cap = SIDEKICK_MS) => (toolWait && toolWait > 0 ? Math.min(cap, toolWait - BRIEF_MARGIN_MS) : cap);

/** A brief's first line, short, as the row's task. */
export function taskOf(brief: unknown) {
  const line = String(brief ?? "").split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  return line.length > 80 ? `${line.slice(0, 78).trimEnd()}…` : line;
}
/** The tool row's title: "Sidekick: Rename nextHigh to nextHighTide". */
export const sidekickTitle = (brief: unknown) => (taskOf(brief) ? `Sidekick: ${taskOf(brief)}` : "Sidekick");

/**
  What a pair's lead is told, beside toolsNote. `frontier`: the sidekick is of the frontier class, so
  it gets lighter briefs and may push back; a quicker one gets prescriptive briefs.
*/
export function leadRules(sidekick: string, frontier: boolean, n: (tool: string) => string = (t) => t) {
  return [
    `You lead this session. ${sidekick} works beside you as your sidekick: ${n("sidekick")} hands it one piece of the work and waits until it's done. You own the plan, the judgment calls and the review; it does what you hand it.`,
    // Hermes offers a server handed over ACP under a name tagged per session, and only in its catalog of tools loaded on demand.
    n("sidekick").includes("<tag>") ? `Its name ends in __sidekick, after a short tag that changes from session to session. If it isn't in your tool list, find it with tool_search ("sidekick") and call it through tool_call.` : "",
    "By default, hand it any test, build or install run you'd otherwise wait on for more than about half a minute, an edit across more than one file once you can say exactly what changes, the same change in many places, and code that follows a pattern already there. Do it yourself when it's a line or two in one file. Keep the reading that decides the plan. When the judgment is the deliverable (a design call, a hard bug, a review), do it yourself: handing that over backfires.",
    frontier
      ? `Write each brief with the goal and the constraints that matter. ${sidekick} is a frontier-class model: say what you want and why, leave the how to it, and listen when it pushes back.`
      : `Write each brief so it can't be misread: the goal, the files and functions to change, and what to leave alone. ${sidekick} is quicker than you and takes words literally: be prescriptive, name paths rather than describe them, one task per brief.`,
    "Every brief says in done_when how it can tell it's done: the command to run and what it should show.",
    "It knows nothing of this conversation except your briefs, and it remembers those, so send a correction to it rather than starting over (fresh: true only when what it remembers would mislead it). It can't ask the person anything.",
    "Its report is a claim. Always read the files it changed (they come back measured) before you build on it or tell the person it's done. A check it ran and reported needn't be run again unless its report or the diff gives you a reason to doubt it. When it fails at the same thing twice, take the work back and do it yourself.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What the sidekick is told, on top of its soul. */
export function sidekickRules(lead: string) {
  return [
    `You are the sidekick in a Liner Code session. ${lead} leads it: it talks to the person, decides what gets done, and hands you one brief at a time. Every message here is a brief from ${lead}, not from the person.`,
    "Do exactly the brief, no more and no wider. You can't ask anyone anything while you work: when something is unclear, take the smallest reasonable reading, say so in your report, and carry on. Don't send agents of your own.",
    "Before you finish, verify: run the check the brief names, or the nearest one there is (the tests, the build, the type checker), and read back what you changed.",
    "End with a short report: what you did, the files you touched, the checks you ran and how they went, and what's left or didn't work. Facts, not narration: the lead reads it beside the diff.",
  ].join("\n");
}

/** What the sidekick is sent for one brief. */
export const briefPrompt = (brief: string, doneWhen?: string) => (doneWhen ? `${brief}\n\nDone when: ${doneWhen}` : brief);

/**
  How a brief went, for the lead to read (sidekickResult) or for anything else that hands it back.
  who: the sidekick's model, by its label. files: what it changed, measured; null when the folder couldn't be snapshotted.
  unstarted: it was stopped before it began (waiting in line, or its lead already stopped), so it did nothing.
  capMs: the cap it ran under, when the lead's own tool set it below the usual one (Provider.toolWait).
  how "agent": Liner Code stopped it as it tried to send an agent of its own, which a sidekick may not; `agent` is that agent's task.
*/
export type BriefOutcome = { how: "done" | "failed" | "stopped" | "capped" | "limited" | "agent" | "replaced"; who: string; seconds: number; report: string; files: FileChange[] | null; problem?: string; unstarted?: boolean; capMs?: number; agent?: string };

const took = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
/** Its report as the lead reads it: whole unless it's long, when the end (where a report sums up) stays. */
const REPORT_MAX = 6000;

/** The cap a brief was stopped at, as the lead reads it. `ms`: set when the lead's own tool's wait on a call set it, below the usual one. */
function capOf(ms?: number) {
  if (ms === undefined) return `the ${Math.round(SIDEKICK_MS / 60_000)}-minute cap for one brief`;
  const s = Math.max(1, Math.round(ms / 1000));
  return `${s % 60 ? took(s) : `${s / 60} min`}, the cap for one brief here: your tool gives up on a call to Liner Code's tools soon after that`;
}

/** What the lead reads back from a brief: short, since it lands in the lead's context. */
export function sidekickResult(o: BriefOutcome) {
  if (o.unstarted) return `The brief was stopped before the sidekick (${o.who}) started on it: nothing was done, and no file changed.`;
  const who = `the sidekick (${o.who})`;
  const head = {
    done: `The sidekick (${o.who}) finished the brief in ${took(o.seconds)}.`,
    failed: `The sidekick (${o.who}) didn't finish the brief (${took(o.seconds)}): ${o.problem ?? "its tool stopped with a problem"}.`,
    stopped: `The person stopped ${who} after ${took(o.seconds)}. This is what it did so far.`,
    capped: `Liner Code stopped ${who} at ${capOf(o.capMs)}. This is what it did so far.`,
    // The person picked another sidekick (runtime.retool): nobody pressed Stop.
    replaced: `The sidekick changed, so Liner Code stopped ${who} after ${took(o.seconds)} and ended it and what it started. This is what it did so far.`,
    limited: `The sidekick (${o.who}) ran out of usage after ${took(o.seconds)}${o.problem ? ` (${o.problem})` : ""}. This is what it did so far.`,
    agent: `Liner Code stopped ${who} after ${took(o.seconds)}: it tried to send an agent of its own${o.agent ? ` ("${o.agent}")` : ""}, and a sidekick may not. This is what it had done. If the brief is still needed, send it again and say to do the work itself.`,
  }[o.how];
  const said = o.report.trim();
  const report = said.length > REPORT_MAX ? `…${said.slice(-REPORT_MAX)}` : said;
  const files =
    o.files === null
      ? "Files changed: not measured (this folder couldn't be snapshotted)."
      : o.files.length
        ? `Files changed (measured):\n${o.files.map((f) => `- ${f.path}${f.from ? ` (from ${f.from})` : ""}: ${f.status}, +${f.added} -${f.removed}`).join("\n")}`
        : "Files changed (measured): none.";
  return [head, `Its report:\n${report || "(It said nothing.)"}`, files, "The report is its own claim: check the diff before you rely on it."].join("\n\n");
}
