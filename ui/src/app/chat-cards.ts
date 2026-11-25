/*
  What the cards at the end of the chat say and when they show (SPEC rule 6, boards Swarm, Tray and Teamwork, 2026-11-25),
  kept apart from React so plain Node can test it (engine/test/chat-cards.test.ts): which plan is the Plan card and when
  its finished steps fold, each card's folded line, a team's counts, the agents popup's tree, and a hand-over said in one
  row. No React and no alias imports here.
*/
import type { Item, PlanEntry, SwarmMember, UserShown } from "../../../contracts/src/index.ts";

type Plan = Extract<Item, { kind: "plan" }>;

/**
  The Plan card: the session's newest plan, lifted out of its turn to the end of the chat, while it is the newest turn's
  or still has steps to do and its run was not stopped (`stopped(turn)`: model.ts planEnd said "stopped"). A plan whose
  every step is done stays in its turn once a newer message is sent. `foldDone`: the person has sent a message since the
  plan was made, so its finished steps fold to "N finished ›".
*/
export function planCard(items: Item[], stopped: (turn: number) => boolean): { plan: Plan; foldDone: boolean } | null {
  let at = -1;
  let latest = -1;
  for (const [i, it] of items.entries()) {
    if (it.kind === "plan") at = i;
    if (it.kind === "turn" && it.turn > latest) latest = it.turn;
  }
  if (at < 0) return null;
  const plan = items[at] as Plan;
  const open = plan.entries.some((e) => e.status !== "completed");
  if (plan.turn !== latest && (!open || stopped(plan.turn))) return null;
  const foldDone = items.slice(at + 1).some((x) => x.kind === "user" && x.turn > plan.turn);
  return { plan, foldDone };
}

/** A step's words carried on mid-sentence: "The menu turns…" is "the menu turns…", an acronym or a name kept as it is. */
const mid = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** The Plan card folded to one line: the step at work ("Now: …"), else the next one waiting, else that every step is done. */
export function planLine(entries: PlanEntry[]) {
  const now = entries.find((e) => e.status === "in_progress");
  if (now) return `Now: ${mid(now.title)}`;
  const next = entries.find((e) => e.status === "pending");
  if (next) return `Next: ${mid(next.title)}`;
  return entries.length ? "Every step is done" : "";
}

/** "2 of 6 done", or "All 6 done". */
export const planCount = (entries: PlanEntry[]) => {
  const done = entries.filter((e) => e.status === "completed").length;
  return done === entries.length && done > 0 ? `All ${done} done` : `${done} of ${entries.length} done`;
};

/**
  A team's members in a few words, the coordinator left out: "2 working, 2 wait for a slot", with those parked until they
  are mentioned (0 MB) and those that ended counted after. Nothing when it has no worker yet.
*/
export function teamCounts(members: Pick<SwarmMember, "name" | "state" | "landed">[]) {
  const workers = members.filter((m) => m.name !== "coordinator" && m.state !== "killed");
  const n = (f: (m: (typeof workers)[number]) => boolean) => workers.filter(f).length;
  const working = n((m) => m.state === "working");
  const queued = n((m) => m.state === "queued");
  const parked = n((m) => m.state === "waiting" || m.state === "hibernated");
  const ended = n((m) => m.state === "stopped" || m.state === "skipped");
  return [working && `${working} working`, queued && `${queued} ${queued === 1 ? "waits" : "wait"} for a slot`, parked && `${parked} parked`, ended && `${ended} stopped`].filter(Boolean).join(", ");
}

/** A team folded to one line: what one working member is doing now ("@build3d: running ls in the project"), else nothing. */
export function teamLine(members: Pick<SwarmMember, "name" | "state" | "now">[]) {
  const m = members.find((x) => x.name !== "coordinator" && x.state === "working" && x.now) ?? members.find((x) => x.state === "working" && x.now);
  return m ? `@${m.name}: ${mid(m.now!)}` : "";
}

/**
  A plain crew (agents a model sent, not a Teamwork or a Swarm) in a few words, as its card's head says them and the
  folded lines on a Wall tile and in Liner Design's small chat repeat them: "2 working, 1 finished". Nothing while none
  is at work: the card shows only then.
*/
export const crewCounts = (working: number, finished: number) => (working ? [`${working} working`, finished && `${finished} finished`].filter(Boolean).join(", ") : "");

/**
  Where a press on a chat card's agents (its name, an agent's row, "N finished ›") takes you. The cards show in every
  face, but only a Code session has the Agents surface: with one on screen for the session, its panel; else the session
  opened in Liner Code with that surface showing; a Liner Security scan opens only in its own face, so there the rows are
  not buttons at all, rather than buttons that do nothing.
*/
export const agentsReach = (sessionShown: boolean, security: boolean): "panel" | "code" | "none" => (sessionShown ? "panel" : security ? "none" : "code");

/** A level of the agents popup's tree: the members on it, each with its own level under it, and those on it that ended (folded to "N finished ›"). */
export type TeamLevel<M> = { kids: TeamNode<M>[]; finished: M[] };
export type TeamNode<M> = TeamLevel<M> & { m: M };

/** A member that has ended its part: stopped, or landed. It folds on its level; one at work, waiting or parked stays a row. */
export const finished = (m: Pick<SwarmMember, "state" | "landed">) => m.state === "stopped" || Boolean(m.landed && m.state !== "working" && m.state !== "queued");

/**
  The tree the agents popup and the team's card draw for a Teamwork or a Swarm: the coordinator's level, each member's
  own level under it (a parent that is gone hands its members to the coordinator), and at each level the members that
  ended and sent no one still at work, folded apart. Killed members are left out; the coordinator is the root, not a node.
*/
export function teamTree<M extends Pick<SwarmMember, "name" | "parent" | "state" | "landed">>(members: M[]): TeamLevel<M> {
  const live = members.filter((m) => m.state !== "killed" && m.name !== "coordinator");
  const names = new Set(live.map((m) => m.name));
  const level = (parent: string): TeamLevel<M> => {
    const nodes = live.filter((m) => (m.parent && names.has(m.parent) ? m.parent : "coordinator") === parent).map((m) => ({ m, ...level(m.name) }));
    const ended = (n: TeamNode<M>) => finished(n.m) && !n.kids.length;
    return { kids: nodes.filter((n) => !ended(n)), finished: nodes.filter(ended).map((n) => n.m) };
  };
  return level("coordinator");
}

/** One hand-over or report from one agent to another, as the message that carried it into the chat holds it (UserShown.reports). */
export type Report = NonNullable<UserShown["reports"]>[number];

/** A name as the chat says it: a team member with its @, the coordinator by its role. */
const who = (name: string) => (name === "coordinator" ? "Coordinator" : `@${name}`);

/** "@settings handed over to @build3d", or "Planner reported to Coordinator" when it goes to the one that sent it. */
export const reportHead = (r: Report) => `${who(r.from)} ${r.to === "coordinator" ? "reported to" : "handed over to"} ${who(r.to)}`;

/** A report's first sentence, its @mention of whom it was for and any list mark left off. */
export function firstSentence(text: string) {
  const line = text.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/`|\*\*/g, "").trim()).find(Boolean) ?? "";
  const bare = line.replace(/^(?:@[\w.-]+[,:]?\s+)+/, "");
  const m = /^(.+?[.!?])(?:\s|$)/.exec(bare);
  return (m ? m[1] : bare).trim();
}

/** "41 lines": how long the whole report is, as the folded row says it. */
export const lineCount = (r: Report) => r.lines ?? r.text.split("\n").length;
