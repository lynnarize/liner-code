/*
  Lead + sidekick: what each is told, and what the lead reads back from a brief. A pair's lead
  owns the session; it hands bounded work to a quicker model through Liner Code's `sidekick` tool
  (liner-tools.ts), and the runtime runs each brief as one turn of the sidekick's own session in
  the same folder (Runtime.delegate). Data and words only, so the tools and the runtime both read it.
*/
import type { AgentRun, Exploring, FileChange, Item, PairShare, PairTuning, PairWays, Settings, SidekickClass, UsageRecord } from "../../contracts/src/index.ts";
import { agentState, costOf } from "../../contracts/src/index.ts";

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

/** What each of a pair's own ways may be (contracts' tuning.ts, PairTuning), and the classes a sidekick may be moved to. */
export const TUNING: Record<keyof PairTuning, readonly unknown[]> = { brief: ["exact", "scoped", "open"], explore: ["none", "bounded", "open"], review: ["all", "diff", "risk"], takeBack: [1, 2], handOver: ["default", "asked"] };
export const CLASSES: readonly SidekickClass[] = ["small", "mid", "frontier"];

/**
  What of a pair's settings the engine can say to a lead, as waysOf reads them: a class, a hand-over or a session's own way
  outside the known ones (a hand-edited file, another version of the app) is left out, so it falls back to the automatic one.
*/
export function knownWays(s: Pick<Settings, "classes" | "handOver">, own?: PairTuning) {
  const classes = Object.fromEntries(Object.entries(s.classes ?? {}).filter(([, c]) => CLASSES.includes(c)));
  const handOver = TUNING.handOver.includes(s.handOver) ? s.handOver : undefined;
  const mine = Object.fromEntries(Object.entries(own ?? {}).filter(([k, v]) => Object.hasOwn(TUNING, k) && TUNING[k as keyof PairTuning].includes(v))) as PairTuning;
  return { settings: { classes, handOver }, own: mine };
}

/** The kinds of work a lead hands over, the same words whether it's told so plainly or firmly. */
const HANDED = "any test, build or install run you'd otherwise wait on for more than about half a minute, an edit across more than one file once you can say exactly what changes, the same change in many places, and code that follows a pattern already there";
/** Said in every pair however it's tuned: the judgment is the lead's, since handing it over backfires. */
const JUDGMENT = "Keep the reading that decides the plan. When the judgment is the deliverable (a design call, a hard bug, a review), do it yourself: handing that over backfires.";

/**
  What a pair's lead is told, beside toolsNote, by how the pair works (contracts' tuning.ts, waysOf):
  how it hands work over, how it briefs, how far the sidekick may look around, how it reads what
  comes back, and when it takes the work back. Whatever the tuning, the judgment stays the lead's
  and every brief says how it's done (done_when): those lines are in every variant.
*/
export function leadRules(sidekick: string, ways: PairWays, n: (tool: string) => string = (t) => t) {
  // A way none of these know (a hand-edited settings file, an older or newer app) is said as the safe end's, a small
  // sidekick's and a plain hand-over, never as "undefined".
  const pick = (said: Record<string, string>, way: unknown, safe: string) => (typeof way === "string" && Object.hasOwn(said, way) ? said[way] : said[safe]);
  // A lead that isn't frontier-class keeps work it should hand over unless it's told plainly that it mustn't.
  const hand = pick({
    default: ways.firm
      ? `Handing over is the rule in this pair, not a choice: hand it ${HANDED}. A lead that keeps that kind of work is doing the pair wrong. Do it yourself only when it's a line or two in one file.`
      : `By default, hand it ${HANDED}. Do it yourself when it's a line or two in one file.`,
    asked: "Keep the work yourself unless the person asks you to use your sidekick. When they do, hand it what they asked for, briefed as below.",
  }, ways.handOver, "default");
  const brief = pick({
    exact: `Write each brief so it can't be misread: the goal, the files and functions to change, and what to leave alone. ${sidekick} takes words literally: be prescriptive, name paths rather than describe them, one task per brief.`,
    scoped: `Write each brief with the goal, the files involved and the limits: what it may change and what it must leave alone. ${sidekick} finds the lines itself, so don't write them for it; one concern per brief.`,
    open: `Write each brief with the goal and the constraints that matter. ${sidekick} is a frontier-class model: say what you want and why, leave the how to it, and listen when it pushes back.`,
  }, ways.brief, "exact");
  const explore = pick({
    none: "Name every file it needs in the brief, and tell it not to go looking for others.",
    bounded: "It may run a few searches inside the folders the brief names, to find callers and uses; name those folders.",
    open: "It may read whatever it needs to understand the work; ask it to report what it found that you hadn't told it.",
  }, ways.explore, "none");
  const review = pick({
    all: "Its report is a claim. Always read the files it changed (they come back measured) before you build on it or tell the person it's done.",
    diff: "Its report is a claim. Read its diff (the files come back measured) before you build on it or tell the person it's done.",
    risk: "Its report is a claim. Before you build on it or tell the person it's done, read closely the parts of its diff that carry risk (the files come back measured) and skim the rest.",
  }, ways.review, "all");
  const takeBack = ways.takeBack !== 2 ? "When it fails at something once, take that piece back and do it yourself." : "When it gets something wrong, send it one correction. When it fails at the same thing twice, take the work back and do it yourself.";
  return [
    `You lead this session. ${sidekick} works beside you as your sidekick: ${n("sidekick")} hands it one piece of the work and waits until it's done. You own the plan, the judgment calls and the review; it does what you hand it.`,
    // Hermes offers a server handed over ACP under a name tagged per session, and only in its catalog of tools loaded on demand.
    n("sidekick").includes("<tag>") ? `Its name ends in __sidekick, after a short tag that changes from session to session. If it isn't in your tool list, find it with tool_search ("sidekick") and call it through tool_call.` : "",
    `${hand} ${JUDGMENT}`,
    `${brief} ${explore}`,
    "Every brief says in done_when how it can tell it's done: the command to run and what it should show.",
    "It knows nothing of this conversation except your briefs, and it remembers those, so send a correction to it rather than starting over (fresh: true only when what it remembers would mislead it). It can't ask the person anything.",
    `${review} A check it ran and reported needn't be run again unless its report or the diff gives you a reason to doubt it. ${takeBack}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
  What the sidekick is told, on top of its soul. `explore`: how far the lead's rules let it look
  around (leadRules), said to it too so both sides agree; one that may read what it needs is told
  nothing more.
*/
export function sidekickRules(lead: string, explore: Exploring = "open") {
  return [
    `You are the sidekick in a Liner Code session. ${lead} leads it: it talks to the person, decides what gets done, and hands you one brief at a time. Every message here is a brief from ${lead}, not from the person.`,
    "Do exactly the brief, no more and no wider. You can't ask anyone anything while you work: when something is unclear, take the smallest reasonable reading, say so in your report, and carry on. Don't send agents of your own.",
    explore === "none" ? "Don't go looking beyond the files the brief names. When you need one it doesn't name, say so in your report rather than search for it." : "",
    explore === "bounded" ? "A few searches inside the folders the brief names are fine, to find callers and uses. Don't go wider than those folders." : "",
    "Before you finish, verify: run the check the brief names, or the nearest one there is (the tests, the build, the type checker), and read back what you changed.",
    "End with a short report: what you did, the files you touched, the checks you ran and how they went, and what's left or didn't work. Facts, not narration: the lead reads it beside the diff.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What the sidekick is sent for one brief. */
export const briefPrompt = (brief: string, doneWhen?: string) => (doneWhen ? `${brief}\n\nDone when: ${doneWhen}` : brief);

/**
  How a brief went, for the lead to read (sidekickResult) or for anything else that hands it back.
  who: the sidekick's model, by its label. files: what it changed, measured; null when the folder couldn't be snapshotted.
  unstarted: it was stopped before it began (waiting in line, or its lead already stopped), so it did nothing.
  capMs: the cap it ran under, when the lead's own tool set it below the usual one (Provider.toolWait).
  how "agent": Liner Code stopped it as it tried to send an agent of its own, which a sidekick may not; `agent` is that agent's task.
  frames: the frames of design files it changed on the canvas, measured apart (files leave .liner/ out).
*/
export type BriefOutcome = { how: "done" | "failed" | "stopped" | "capped" | "limited" | "agent" | "replaced"; who: string; seconds: number; report: string; files: FileChange[] | null; frames?: { name: string; path: string }[]; problem?: string; unstarted?: boolean; capMs?: number; agent?: string };

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
  // Design files are left out of the snapshot, so a brief that only drew on the canvas says that, never "none".
  const drew = o.frames?.length ? `Frames changed on the canvas (measured):\n${o.frames.map((f) => `- ${f.name} (${f.path})`).join("\n")}` : "";
  const files =
    o.files === null
      ? "Files changed: not measured (this folder couldn't be snapshotted)."
      : o.files.length
        ? `Files changed (measured):\n${o.files.map((f) => `- ${f.path}${f.from ? ` (from ${f.from})` : ""}: ${f.status}, +${f.added} -${f.removed}`).join("\n")}`
        : drew
          ? "Outside the design files, no file changed (measured)."
          : "Files changed (measured): none.";
  return [head, `Its report:\n${report || "(It said nothing.)"}`, files, drew, drew ? "The report is its own claim: check the diff, and look at the frames with design_shot, before you rely on it." : "The report is its own claim: check the diff before you rely on it."].filter(Boolean).join("\n\n");
}

/** What a brief's row says when it was stopped before it began: it did nothing, so it was never sent (pairShare). */
export const UNSTARTED = "Stopped before it started.";
/**
  A brief whose sidekick's turn was sent. runBrief puts `steerable` (true or false) on its row only once the sidekick's
  session has opened, right before the brief goes, so a row without it failed before then (its tool gone, the folder
  missing, the session not opening); one stopped in the moment between says UNSTARTED. No other row carries it.
*/
export const briefStarted = (a: AgentRun) => typeof a.steerable === "boolean" && a.report !== UNSTARTED;

/**
  A brief as its lead's turn keeps it, to tell at the turn's end whether the lead took it back
  (tookBackOf): its row, the folder's snapshots before and after it (null when one couldn't be
  taken, or it hasn't ended), and the paths it changed, both ends of a rename (null when unmeasured).
*/
export type BriefMark = { row: string; from: string | null; to: string | null; paths: string[] | null };

/**
  Which briefs the lead took back, by row: true when the lead itself changed a file the brief had
  changed, after the brief ended and before the turn did. The lead's own stretches run from one
  brief's after snapshot to the next one's before (or to the turn's end, `end`), so a file a later
  brief changed is that brief's, not the lead's, and no extra snapshot is taken: each stretch is one
  diff between snapshots there already are. `changed(a, b)`: the paths that differ between two
  snapshots, null when git can't say. A stretch that couldn't be measured (a brief still at work
  past the wind-down, whose own edits can't be told from the lead's, or a snapshot that failed)
  only hides what happened in it: a brief whose file the lead changed in a stretch that was
  measured is still taken back, and one with no such change is left unset rather than called
  kept, since the unmeasured stretch may hold one. What this can't see: a lead that redoes the work in other
  files than the brief's, or that edits beside a brief still at work (a tool that runs calls side
  by side), whose edits read as the brief's; and the person's own edits to the brief's files while
  the turn runs read as the lead's.
*/
export async function tookBackOf(marks: BriefMark[], end: string | null, changed: (a: string, b: string) => Promise<Set<string> | null>): Promise<Map<string, boolean>> {
  const stretches = await Promise.all(
    marks.map((m, i) => {
      const next = i + 1 < marks.length ? marks[i + 1].from : end;
      return m.to && next ? changed(m.to, next).catch(() => null) : Promise.resolve(null);
    }),
  );
  const out = new Map<string, boolean>();
  marks.forEach((m, i) => {
    const after = stretches.slice(i);
    if (!m.paths) return;
    if (m.paths.some((p) => after.some((s) => s?.has(p)))) out.set(m.row, true);
    else if (after.every((s) => s !== null)) out.set(m.row, false);
  });
  return out;
}

/** Who a usage record of a session is in its pair: the sidekick's own, else the lead's. The Reviewer's and the desk's reads are neither. */
const roleOf = (agent: string): "lead" | "sidekick" | undefined => (agent === "sidekick" ? "sidekick" : agent === "reviewer" || agent === "desk" || agent.startsWith("addon:") ? undefined : "lead");

/**
  A pair's use, by model, and how its briefs went (thread.shares), from its session's usage records
  and its timeline. Tokens are counted as the Usage page counts them (summarize in api.ts): input
  and output with cache reads in. Shares of cost are the tools' own figures when every model listed
  reported a cost; else an estimate that weights each model's tokens by its price for a typical
  task (contracts' costOf), as a proxy for list prices; when a model has neither, no model gets a
  cost share, since the others' parts of a whole that's partly unknown would read too high.
*/
export function pairShare(records: UsageRecord[], items: Item[]): PairShare {
  const by = new Map<string, PairShare["models"][number]>();
  for (const r of records) {
    const role = roleOf(r.agent);
    if (!role) continue;
    const ref = `${r.provider}:${r.model}`;
    const m = by.get(`${role}|${ref}`) ?? { ref, role, tokens: 0, costUsd: 0, tokenShare: 0 };
    m.tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens;
    m.costUsd += r.costUsd;
    by.set(`${role}|${ref}`, m);
  }
  // A model that used nothing (a turn stopped as it began) has no part to show.
  const models = [...by.values()].filter((m) => m.tokens > 0 || m.costUsd > 0).sort((a, b) => (a.role === b.role ? b.tokens - a.tokens : a.role === "lead" ? -1 : 1));
  const tokens = models.reduce((s, m) => s + m.tokens, 0);
  for (const m of models) m.tokenShare = tokens ? m.tokens / tokens : 0;
  let estimated = false;
  if (models.length && models.every((m) => m.costUsd > 0)) {
    const cost = models.reduce((s, m) => s + m.costUsd, 0);
    for (const m of models) m.costShare = m.costUsd / cost;
  } else {
    const prices = models.map((m) => costOf(m.ref));
    const weights = models.map((m, i) => m.tokens * (prices[i] ?? 0));
    const all = weights.reduce((s, w) => s + w, 0);
    if (models.length && prices.every((p) => p !== undefined) && all > 0) {
      estimated = true;
      models.forEach((m, i) => (m.costShare = weights[i] / all));
    }
  }
  const briefs = { sent: 0, kept: 0, tookBack: 0 };
  for (const it of items) {
    if (it.kind !== "tool" || !it.agent?.taskId?.startsWith("sidekick:") || !briefStarted(it.agent)) continue;
    briefs.sent++;
    if (it.agent.tookBack) briefs.tookBack++;
    else if (agentState(it) === "done") briefs.kept++;
  }
  return { models, estimated, briefs };
}
