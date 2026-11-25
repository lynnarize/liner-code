/*
  A session's timeline, turn by turn, kept compact. While a turn works, its steps are not in the
  chat: they are the live line at the chat's foot, right over the message box (LiveLine, which the
  session, Liner Design's chat, a scan and the side chat each put there), so the chat never moves
  while you wait. When a part of the turn ends, its steps fold into the chat as one grey line
  above the answer ("Worked for 11.4s · 12 steps"), which opens to every step. Anything that needs
  you (a request, a question, a plan) waits in place. The answer follows, then what changed (each
  file a row that opens Changes on it) and the Reviewer's verdict, and the answer ends with Copy
  alone. How long it took and what it cost are on the folded line.
*/
import { createContext, Fragment, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addonKey, PR_TEST_TOOL, BROWSER_TOOL as BROWSER, BROWSER_WORDS, bareTitle as bare, callCommand, callInput as inputOf, callPath, CANVAS_TOOL as CANVAS_STEP, canvasFrame, canvasWords, CARD_TOOLS, DESIGN_TOOLS, FRAME_FILE, frameFileName, isStepCall, KIND_WORDS, SERVER_TOOL as SERVER, serverOf, SIDEKICK_WORDS, STEP_KINDS, stepFileName, stepKind, toolNameOf, type ConnectionAsk, type Item, type ShownChip, type PanelAsk, type ProviderInfo, type AgentProfile, type StepKind, type TurnPart, type PlanEntry, type Handoff, splitModel, switchedFrom } from "@contracts";
import { appIcon, OfferCard } from "./Addon";
import { toComposer } from "./Find";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { isCheckpoint, rpc, threadOf, useEngine, useItems, useItemsWhere } from "./engine";
import { I, MARK_WORD, ModelMark, StateMark, StepMark, type StepState } from "./icons";
import { PageCard } from "./Page";
import { DesignCard } from "./Design";
import { PrChatCard } from "./Pr";
import { commandOf as askCommand, headlineOf } from "./Ask";
import { ApprovalCard } from "@liner/pro/approval-card/approval-card";
import { Segmented } from "@liner/components/segmented/segmented";
import { Dialog } from "@liner/components/dialog/dialog";
import { agentOf, clock, designPart, duration, effortsFor, isModelAgent, markOf, mergeFiles, modelLabel, threadModel, money, onClaude, planEnd, planStatus, plural, sumLines, turnsOf, type PlanEnd } from "./model";import { Badge, Disc, EnvLine, Lines, ModelTag, Num, Pop, Row as PickRow, useSteady } from "./ui";
import { agentName, CrewCard, Fanout, isSidekick, useCardFold } from "./Crew";
import { firstSentence, lineCount, planCard, planCount, planLine, reportHead, type Report } from "./chat-cards";
import { toast } from "@liner/components/toast/toast";
import { Boundary } from "./Boundary";
import { EtaLeft } from "./EtaLeft";
import { SentWith } from "./SentWith";
import { bridge, isNative } from "./bridge";
import * as os from "./os";
import { thoughtLine } from "./live-thought";
import { levelName } from "./picker";
import { answerOf as answerIn, OTHER, seedOf, selectedOf as selectedIn } from "./question-seed";
import "./timeline.css";

type Tool = Extract<Item, { kind: "tool" }>;
type Ask = Extract<Item, { kind: "approval" }>;

/**
  Answered asks, by the tool call each was for. One answered folds into that call's step, so the
  trail stays one; only an ask still waiting stands on its own. An ask that doesn't name its call
  goes with the last call of its tool ahead of it, else the next one after it (a tool that asks
  before it reports the call).
*/
function foldedAsks(items: Item[]) {
  const byTool = new Map<string, Ask>();
  const calls = items.filter((x): x is Tool => x.kind === "tool");
  for (const [i, it] of items.entries()) {
    if (it.kind !== "approval" || it.state === "asking" || it.tool === PR_TEST_TOOL || it.addon) continue;
    const free = (x: Item): x is Tool => x.kind === "tool" && x.tool === it.tool && !byTool.has(x.id);
    const call = it.toolId ? calls.find((c) => c.id === it.toolId) : (items.slice(0, i).findLast(free) ?? items.slice(i + 1).find(free));
    if (call && !byTool.has(call.id)) byTool.set(call.id, it);
  }
  return byTool;
}

/** What became of an answered ask, as its call's row says it. */
const askWord = (a: Ask) => (a.state === "approved" ? (a.reviewer ? "Reviewer allowed" : `You allowed${grantedWords(a)}`) : a.state === "denied" ? "You said no" : "Not answered");
/** What a yes also took, said after "you allowed": the turn, or what the session stopped asking about. */
const grantedWords = (a: Ask) => {
  const g = a.granted;
  if (!g) return "";
  if (g.kind === "turn") return ", for this turn";
  if (!g.label) return ", and stopped asking";
  return `, and stopped asking for ${g.kind === "skill" ? "this skill's scripts" : g.label === "Edit" ? "edits" : g.label}`;
};

/**
  What became of a step's asks, as tags on its row: "you allowed"; a run of edits says each answer
  once, with how many times, as "Reviewer allowed ×3".
*/
function tagsOf(said: Ask[]) {
  const words = new Map<string, Ask[]>();
  for (const a of said) words.set(askWord(a), [...(words.get(askWord(a)) ?? []), a]);
  return [...words].map(([word, list]) => `${word.replace(/^You /, "you ").replace(/^Not /, "not ")}${list.length > 1 ? ` ×${list.length}` : ""}`);
}
type Checkpoint = Extract<Item, { kind: "checkpoint" }>;
type Review = Extract<Item, { kind: "review" }>;
/** What a turn's trail holds, in order: its tool calls, its thinking, what the agent says between steps, and asks waiting on you. */
type Entry = { kind: "tool"; it: Tool } | { kind: "thought"; it: Extract<Item, { kind: "reasoning" }> } | { kind: "ask"; it: Ask };

/**
  Cards (CARD_TOOLS), and showing a design (DESIGN_TOOLS): its card stands for it once the turn has one. One that failed,
  or that kept the version before (nothing changed), stays in the trail, with what it said. Which calls are steps, and
  their words, are contracts/doing.ts's, so the sidebar's doing line and Liner Design's chat say what the trail says.
*/
const isCard = (it: Item, designed: boolean) => it.kind === "tool" && (CARD_TOOLS.has(it.tool) || (designed && DESIGN_TOOLS.has(it.tool) && it.status === "done"));
/** A tool call the trail draws as a step: not a card of its own (a question, a plan, a page, a design shown) nor the PR card's test run. */
export const isStep: (it: Tool) => boolean = isStepCall;
/** A lead wraps the plan it hands over in <plan> tags; the plan card shows it, so the text drops the tags. */
const untag = (text: string) => text.replace(/<\/?plan\b[^>]*>/g, "");

/** A plan being written in a lead's reply: what it said before the plan, the plan so far, its title once the tag has one, and what it says after. */
function draftOf(text: string) {
  const m = /<plan\b([^>]*)>?/.exec(text);
  if (!m) return null;
  const title = /title\s*=\s*"([^"]+)"/.exec(m[1])?.[1]?.trim();
  const rest = text.slice(m.index + m[0].length);
  const end = rest.indexOf("</plan>");
  // A closing tag still arriving isn't part of the plan.
  const plan = (end < 0 ? rest.replace(/<\/?[a-z]*$/, "") : rest.slice(0, end)).trim();
  return { before: text.slice(0, m.index), plan, title: title || undefined, after: end < 0 ? "" : rest.slice(end + "</plan>".length).trim() };
}

type Props = {
  threadId: string;
  /** The thread's items. Left out, the timeline reads them itself, so a streaming reply redraws it and not the screen around it. */
  items?: Item[];
  /** Items present when the session opened render at once; newer ones animate in. */
  seen: Set<string>;
  /**
    Opens a turn's changes at a file. Left out (a Security scan, which has no Changes), the change card's files are plain rows
    and a step's edit opens its own detail instead: nothing offers to open what isn't there.
  */
  onReview?: (checkpointId: string, path?: string) => void;
  /** Where onReview takes you, after a file's name in a row's label: "in Changes" unless the face says otherwise ("in Liner Code"). */
  reviewIn?: string;
  reviewing?: { id: string; path?: string } | null;
  onGrow?: () => void;
  /**
    The session shows a plain ask at its composer (Ask.tsx): here it is a row that waits, not a
    card. Left out (a side chat, which has no such composer), the card stays in the timeline.
  */
  docked?: boolean;
  /**
    A face's own drawing of an item, in its place (Liner Security: a finding the scan reported, an answered question): a node
    draws it as a block of its own, null leaves it out, undefined draws it as usual. Left out (Code, Design), nothing changes.
    One identity for the session's life (useCallback), so the turns don't redraw for a new one.
  */
  draw?: (it: Item) => ReactNode | null | undefined;
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function Timeline({ threadId, items: given, seen, onReview, reviewIn = "in Changes", reviewing, onGrow, docked, draw }: Props) {
  const own = useItems(given ? undefined : threadId);
  const items = given ?? own;
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  // Each turn keeps its item list while nothing in it changes, so only the turn that streams redraws.
  const kept = useRef(new Map<number, Item[]>());
  const turns = useMemo(() => {
    const list = turnsOf(items, kept.current);
    kept.current = new Map(list.map((t) => [t.turn, t.items]));
    return list;
  }, [items]);
  // Steady, so the turns don't redraw for a new one; none at all when there's nowhere to open the changes.
  const steady = useSteady(onReview);
  const review = onReview ? steady : undefined;
  const grow = useSteady(onGrow);
  // The newest plan is a card at the chat's end (ChatCards), so its turn leaves it out. Every turn is told its id, not only
  // the one of its number: a Liner Design build, refine or fix turn folds into the turn before it (model.ts turnsOf).
  const card = useMemo(() => planCard(items, (t) => planEnd(planStatus(items, t)) === "stopped"), [items]);
  return (
    <ReviewIn.Provider value={reviewIn}>
    <div className="lc-tl">
      {turns.map(({ turn, n, items: list }) => (
        // One turn that can't show says so in its place; the rest of the thread stays (T3 Code's RenderErrorBoundary).
        <Boundary key={turn} label="This turn" quiet>
          <Turn threadId={threadId} n={n} items={list} agents={agents} providers={providers} seen={seen} onReview={review} reviewing={reviewing} onGrow={grow} docked={docked} draw={draw} hidePlan={card?.plan.id} />
        </Boundary>
      ))}
      <Ahead threadId={threadId} items={items} providers={providers} />
      <Boundary label="The cards" quiet>
        <ChatCards threadId={threadId} items={items} card={card} />
      </Boundary>
    </div>
    </ReviewIn.Provider>
  );
}

/**
  The cards that are the last things in the chat (SPEC rule 6, boards Swarm, Tray and Teamwork): the Plan, then the team
  at work (a Swarm, Teamwork, or a plain crew of agents, Crew.tsx CrewCard). They sit under the newest message, and over
  the live line at the chat's foot; a newer answer comes in above them. Every face that draws a Timeline has them: the
  session, Liner Design's chat, a Liner Security scan and the side chat.
*/
function ChatCards({ threadId, items, card }: { threadId: string; items: Item[]; card: ReturnType<typeof planCard> }) {
  return (
    <div className="lc-cards">
      {card && <PlanCard threadId={threadId} it={card.plan} foldDone={card.foldDone} end={planEnd(planStatus(items, card.plan.turn))} />}
      <CrewCard threadId={threadId} />
    </div>
  );
}

/**
  The Plan card: "Plan · N of M done" with a fold chevron, a row a step (its mark, the step, who owns it at the right end).
  Folded, one line: the step at work. Once you have sent a newer message, the finished steps fold to "N finished ›". It
  remembers folded or open per session. `end` reads as Todo's: a run that stopped leaves the steps it never reached skipped.
*/
function PlanCard({ threadId, it, foldDone, end }: { threadId: string; it: Extract<Item, { kind: "plan" }>; foldDone: boolean; end?: PlanEnd }) {
  const [open, setOpen] = useCardFold(threadId, "plan");
  const [doneOpen, setDoneOpen] = useState(false);
  const shown = (s: PlanEntry["status"]): StepState => (s === "completed" ? "done" : end ? "skipped" : s === "in_progress" ? "working" : "waiting");
  const owned = it.entries.some((e) => e.owner);
  const done = it.entries.filter((e) => e.status === "completed");
  const fold = foldDone && done.length > 1 && !doneOpen;
  const row = (e: PlanEntry, i: number) => (
    <li key={i} className="lc-ccard-r" data-s={shown(e.status)}>
      <StepMark size={14} state={shown(e.status)} label={e.status !== "completed" && end === "open" ? "Left open" : undefined} />
      <span className="lc-ccard-t">{e.title}</span>
      {e.owner ? <span className="lc-ccard-n">{e.owner}</span> : owned && e.status === "pending" ? <span className="lc-ccard-n">no one yet</span> : null}
    </li>
  );
  return (
    <section className="lc-ccard" aria-label="Plan" data-open={open || undefined}>
      <div className="lc-ccard-h">
        <button type="button" className="lc-ccard-fold l-focus" aria-expanded={open} aria-label={open ? "Fold the plan" : "Open the plan"} onClick={() => setOpen(!open)}>
          <I.chevR size={12} className="lc-sum-chev" />
          <b>Plan</b>
          <span className="lc-quiet">{planCount(it.entries)}</span>
          {!open && <span className="lc-ccard-line">{planLine(it.entries)}</span>}
        </button>
      </div>
      {open && (
        <ol className="lc-ccard-rows">
          {fold ? (
            <>
              <li className="lc-ccard-r">
                <button type="button" className="lc-ccard-more l-focus" onClick={() => setDoneOpen(true)}>
                  <StepMark size={14} state="done" />
                  <span className="lc-ccard-t">{done.length} finished</span>
                  <I.chevR size={14} />
                </button>
              </li>
              {it.entries.map((e, i) => (e.status === "completed" ? null : row(e, i)))}
            </>
          ) : (
            it.entries.map(row)
          )}
        </ol>
      )}
    </section>
  );
}


/** Where the timeline's onReview opens a file, for its rows' labels (Props, reviewIn). */
const ReviewIn = createContext("in Changes");

const Turn = memo(function Turn({ threadId, n, items, agents, providers, seen, onReview, reviewing, onGrow, docked, draw, hidePlan }: { threadId: string; n: number; items: Item[]; agents: AgentProfile[]; providers: ProviderInfo[]; /** The plan the chat's Plan card shows, left out here. */ hidePlan?: string } & Omit<Props, "items" | "threadId">) {
  const latestTurn = useEngine((s) => threadOf(s, threadId)?.turns);
  // Your turn, and any parts that carried it on (a build, a refine, a fix): one turn, one foot, and
  // a head for each model's part, so who did what reads in order.
  const marks = items.filter((x): x is Mark => x.kind === "turn");
  const marker = marks[0];
  const running = marks.some((m) => m.status === "running");
  // The Design face names its frames for the steps that read or change them (FrameNames).
  const names = useContext(FrameNames);
  const parts = sectionsOf(marks);
  const cps = items.filter((x): x is Checkpoint => x.kind === "checkpoint");
  const lastCp = cps[cps.length - 1];
  // The changes of the whole turn, as one: each file once, the lines added up; Review opens them all.
  // Every part undone, it says what was undone rather than "0 files".
  const undone = cps.every((c) => c.reverted);
  const shownCp = cps.length > 1 && lastCp ? { ...lastCp, files: mergeFiles((undone ? cps : cps.filter((c) => !c.reverted)).flatMap((c) => c.files)), reverted: undone } : lastCp;
  // `id` is the item a block stands for, when its key isn't one (a trail, a plan's draft). A trail's
  // node is made once the whole turn is read, when its part's trails are gathered into one (`part`:
  // the key of the part it is in); `still` blocks never come in with the block's fade and blur.
  const blocks: { key: string; id?: string; node?: ReactNode; trail?: TrailIn; part?: string; still?: boolean }[] = [];
  // Each mark's part, by the key sectionsOf gives the part.
  const partOf = new Map<string, string>();
  for (const [key, list] of parts) for (const m of list) partOf.set(m.id, key);
  // A tool gone quiet (its notice with Stop, and nothing since) is said on the live line, not as a line of its own.
  const quiet = running ? quietOf(items) : undefined;
  const asks = useMemo(() => foldedAsks(items), [items]);
  const folded = new Set([...asks.values()].map((a) => a.id));
  const fresh = (id: string) => !seen.has(id);
  // The PR card's own test run and its request sit with the card, not in the trail.
  const prRun = items.findLast((x): x is Tool => x.kind === "tool" && x.tool === PR_TEST_TOOL);
  const prAsk = items.find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.tool === PR_TEST_TOOL && x.state === "asking");
  const designed = items.some((x) => x.kind === "design");
  const cp = items.find((x): x is Checkpoint => x.kind === "checkpoint");
  const review = items.findLast((x): x is Review => x.kind === "review");
  // A plan still being written (a lead's <plan>, or Claude Code's plan mode filling in its call) is one quiet line until its card comes.
  const unplanned = (i: number) => running && !items.slice(i + 1).some((x) => x.kind === "proposal");
  // Which part of the turn an item is in: the planner's words read as a plan, the builder's as they are.
  let at: Mark | undefined;
  // The steps between two things said, and the thinking between them: one group (Claude Code's and
  // T3 Code's work groups). A part's groups fold into one line once the part is over (below).
  let run: Entry[] = [];
  // A row is keyed by the item that started it, even thinking that ended too short to keep a line:
  // while it streamed it was the row's first entry, so the row keeps its key when it drops out.
  let lead: string | undefined;
  // The part the items read now are in, and whether it is still at work: while it is, its thinking is
  // the live line's, as its steps are, and stays off the chat.
  const partNow = () => partOf.get((at ?? marker)?.id ?? "") ?? "";
  const working = (key: string) => parts.get(key)?.some((m) => m.status === "running") ?? running;
  const flush = () => {
    const first = lead;
    lead = undefined;
    if (!run.length) return;
    const entries = run;
    run = [];
    const key = first ?? entries[0].it.id;
    const part = partNow();
    // Thinking with no step beside it (before a reply, say) is a row of its own once it's done. It
    // takes the key the trail it starts will have, so when a step joins it the row stays and doesn't
    // come in again.
    if (!entries.some((e) => e.kind !== "thought")) {
      if (!working(part)) for (const [j, e] of entries.entries()) if (e.kind === "thought") blocks.push({ key: `t${j === 0 ? key : e.it.id}`, id: j === 0 ? key : e.it.id, node: <Thought it={e.it} /> });
      return;
    }
    // Its own part's checkpoint (a build after the plan keeps its own), for its lines and its diffs.
    const partCp = cps.find((c) => c.turn === entries[0].it.turn) ?? cp;
    const read = rowsOf(entries, partCp, names);
    blocks.push({ key: `t${key}`, id: key, part, trail: { entries, ...read, cp: partCp, who: whoOf(at ?? marker, agents, providers) } });
  };
  const offers: Extract<Item, { kind: "offer" }>[] = [];
  for (const [i, it] of items.entries()) {
    if ((it.kind === "tool" || it.kind === "approval") && it.tool === PR_TEST_TOOL) continue;
    // A face that draws this item its own way (Timeline's `draw`): its block, or nothing.
    const mine = draw?.(it);
    if (mine !== undefined) {
      if (mine !== null) (flush(), blocks.push({ key: it.id, node: mine }));
      continue;
    }
    // A lead's reply that was all plan keeps nothing once its card has it.
    if (it.kind === "text" && !it.streaming && !it.text.trim()) continue;
    // Thinking too short to show leaves no row, so the steps either side stay one.
    if (it.kind === "reasoning" && !shown(it)) {
      if (!run.length) lead ??= it.id;
      continue;
    }
    // Answered, it's a word on its step's result, and the steps either side stay one trail.
    if (it.kind === "approval" && folded.has(it.id)) continue;
    // Asking you and handing over a plan show as their own cards, not as steps too.
    if (isCard(it, designed) && it.kind === "tool") {
      if (it.tool === "ExitPlanMode" && it.status === "running" && unplanned(i)) {
        flush();
        blocks.push({ key: it.id, node: <PlanDraft /> });
      }
      continue;
    }
    // Asking Opus to plan (Sonnet that escalates) is its own line, not one more step.
    if (escalates(it)) {
      flush();
      blocks.push({ key: it.id, node: <Escalation it={it as Tool} providers={providers} /> });
      continue;
    }
    if (it.kind === "tool") run.push({ kind: "tool", it });
    else if (it.kind === "reasoning") run.push({ kind: "thought", it });
    // Asking you never folds away: at the composer it is a row that waits on the trail, else it stands on its own until
    // you answer. An add-on's receipt stays on its own too, with its Undo.
    else if (it.kind === "approval" && !it.addon && (it.state !== "asking" || docked)) run.push({ kind: "ask", it });
    else {
      flush();
      if (it.kind === "approval") blocks.push({ key: it.id, node: it.addon?.kind === "panel" ? <PanelAddonCard threadId={threadId} it={it} who={whoOf(at ?? marker, agents, providers)} /> : it.addon ? <AddonCard threadId={threadId} it={it} who={whoOf(at ?? marker, agents, providers)} /> : <Approval threadId={threadId} it={it} who={whoOf(at ?? marker, agents, providers)} /> });
      // A team's reports woken into its coordinator are no message of yours: each is one folded row (SPEC rule 6).
      else if (it.kind === "user" && it.shown?.reports?.length) blocks.push({ key: it.id, node: <Reports reports={it.shown.reports} /> });
      else if (it.kind === "user") blocks.push({ key: it.id, node: <You threadId={threadId} it={it} fresh={fresh(it.id)} onReview={onReview} /> });
      else if (it.kind === "turn") {
        at = it;
        const part = parts.get(it.id);
        if (part && parts.size > 1) blocks.push({ key: it.id, node: <TurnHead it={it} marks={part} n={it === marker ? n : undefined} items={items} agents={agents} providers={providers} timed={!items.some((x) => x.kind === "tool" && isStep(x))} /> });
      }
      else if (it.kind === "text") {
        const planning = Boolean((at ?? marker)?.planning);
        const draft = planning && unplanned(i) ? draftOf(it.text) : null;
        // A lead's tag still arriving ("<pl") isn't shown: the words before it stay as they were when the plan starts.
        if (!draft) blocks.push({ key: it.id, node: <StreamedMarkdown className="lc-md" text={planning && it.streaming ? untag(it.text).replace(/<\/?[a-z]*$/i, "") : untag(it.text)} streaming={it.streaming} animate={fresh(it.id)} onGrow={onGrow} /> });
        else {
          // What the lead says around its plan reads in order around this line, and the card and
          // those words take the same keys when the turn ends (the engine's ids), so they settle
          // in place: nothing moves above the card or comes in twice.
          if (draft.before.trim()) blocks.push({ key: it.id, node: <StreamedMarkdown className="lc-md" text={draft.before} streaming={false} animate={fresh(it.id)} onGrow={onGrow} /> });
          blocks.push({ key: `${it.id}-plan`, id: it.id, node: <PlanDraft text={draft.plan} title={draft.title} /> });
          if (draft.after) blocks.push({ key: `${it.id}-after`, node: <StreamedMarkdown className="lc-md" text={draft.after} streaming={it.streaming} animate={fresh(it.id)} onGrow={onGrow} /> });
        }
      }
      else if (it.kind === "plan") {
        if (it.id !== hidePlan) blocks.push({ key: it.id, node: <Todo it={it} end={planEnd(planStatus(items, it.turn))} /> });
      }
      else if (it.kind === "page") blocks.push({ key: it.id, node: <PageCard threadId={threadId} it={it} /> });
      else if (it.kind === "design") blocks.push({ key: it.id, node: <DesignCard threadId={threadId} it={it} /> });
      else if (it.kind === "pr") blocks.push({ key: it.id, node: <PrChatCard threadId={threadId} it={it} fresh={fresh(it.id)} run={prRun} ask={prAsk && ((w) => <Approval key={prAsk.id} threadId={threadId} it={prAsk} who={w} />)} /> });
      else if (it.kind === "question") blocks.push({ key: it.id, node: <QuestionCard threadId={threadId} it={it} who={whoOf(at ?? marker, agents, providers)} /> });
      else if (it.kind === "proposal") blocks.push({ key: it.id, node: <Proposal threadId={threadId} it={it} who={whoOf(at ?? marker, agents, providers)} /> });
      // The turn's last line: what changed, and the Reviewer's verdict on it, side by side.
      else if (it.kind === "checkpoint") {
        if (it === lastCp) blocks.push({ key: it.id, node: <TurnFoot cp={shownCp} all={cps.length > 1} review={review} providers={providers} onReview={onReview} reviewing={reviewing} /> });
      }
      else if (it.kind === "review" && !cp && it === review) blocks.push({ key: it.id, node: <TurnFoot review={it} providers={providers} onReview={onReview} reviewing={reviewing} /> });
      else if (it.kind === "limit") blocks.push({ key: it.id, node: <LimitCard threadId={threadId} it={it} /> });
      else if (it.kind === "error" && it.why) blocks.push({ key: it.id, node: <ErrorCard threadId={threadId} it={it} /> });
      else if (it.kind === "error")
        blocks.push({
          key: it.id,
          node: (
            <p className="lc-error" role="alert">
              {it.message}
            </p>
          ),
        });
      // A notice that a tool has gone silent carries Stop beside it while its turn runs; the one that
      // still holds (nothing came after it) is said on the status line instead.
      else if (it.kind === "notice" && it === quiet) continue;
      else if (it.kind === "notice" && it.handoff) blocks.push({ key: it.id, node: <Switched h={it.handoff} providers={providers} /> });
      else if (it.kind === "notice")
        blocks.push({
          key: it.id,
          node: (
            <p className="lc-notice">
              {it.text}
              {it.stop && running && (
                <button type="button" className="lc-notice-stop l-focus" onClick={() => void rpc("thread.stop", { id: threadId })}>
                  Stop
                </button>
              )}
              {!running && it.text === "You stopped this turn." && it.turn === latestTurn && (
                <button type="button" className="lc-notice-stop l-focus" onClick={() => void rpc("thread.send", { id: threadId, text: "Continue where you left off." })}>
                  Resume
                </button>
              )}
            </p>
          ),
        });
      else if (it.kind === "offer") offers.push(it);
    }
  }
  flush();
  // An offer to make an app shows once its turn has ended, after the answer (DeepSeek Harness's card).
  if (!running) for (const o of offers) blocks.push({ key: o.id, node: <OfferCard threadId={threadId} it={o} who={whoOf(at ?? marker, agents, providers)} /> });
  // A part's groups as one: its steps, its rows and the agents it sent, at its first group's place, so the part folds to
  // one line above what it said. While the part works its steps are the live line's (LiveLine), and only the agents it
  // sent stay in the chat, each with what it does; the line comes in once the part is over.
  const gathered = new Map<string, TrailIn>();
  for (const b of blocks) {
    if (!b.trail) continue;
    const was = gathered.get(b.part!);
    if (was) (was.entries.push(...b.trail.entries), was.rows.push(...b.trail.rows), was.sent.push(...b.trail.sent));
    else gathered.set(b.part!, { ...b.trail, entries: [...b.trail.entries], rows: [...b.trail.rows], sent: [...b.trail.sent] });
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b.trail) continue;
    const all = gathered.get(b.part!)!;
    if (blocks.findIndex((x) => x.trail && x.part === b.part) !== i) blocks.splice(i, 1);
    else if (working(b.part!)) {
      if (all.sent.length) blocks[i] = { key: b.key, id: b.id, still: true, node: <Fanout threadId={threadId} tools={all.sent} /> };
      else blocks.splice(i, 1);
    } else blocks[i] = { ...b, trail: all };
  }
  // Done, the turn's time leads its last line, unless a part's head says it ("built it in 46s"); a turn that was stopped or
  // ran into a problem says so in its place.
  const end = marks[marks.length - 1];
  const took = !running && marker && end && end.status !== "running" && end.seconds !== undefined && !marks.some((m) => m.part || m.planning) ? (end.at - marker.at) / 1000 + end.seconds - marks.slice(0, -1).reduce((n, m) => n + (m.waited ?? 0), 0) / 1000 : undefined;
  const ended = !running && end && !marks.some((m) => m.part || m.planning) ? end.status : undefined;
  const leadWords = ended === "stopped" ? (took !== undefined ? `Stopped after ${duration(took)}` : "Stopped") : ended === "error" ? (took !== undefined ? `Ran into a problem after ${duration(took)}` : "Ran into a problem") : took !== undefined ? `Worked for ${duration(took)}` : undefined;
  // What the turn cost, its marks' own added up, however it ended (stopped and failed turns cost too); nothing when no tool said.
  const cost = !running ? marks.reduce((n, m) => n + (m.costUsd ?? 0), 0) : 0;
  // A turn that ended with no step at all still has its line, how long it worked and what it cost, above the answer: the
  // answer ends with Copy alone.
  if (!running && marker && !blocks.some((b) => b.trail) && (leadWords || cost > 0)) {
    const you = blocks.findIndex((b) => b.key === items.find((x) => x.kind === "user")?.id);
    // Its mark stands for it, so a turn that ended before the session opened doesn't come in again.
    blocks.splice(you + 1, 0, { key: `sum-${marker.id}`, id: marker.id, part: "", trail: { entries: [], rows: [], sent: [], who: whoOf(marker, agents, providers) } });
  }
  const lastTrail = blocks.findLastIndex((b) => b.trail);
  // Over, a turn one agent answered ends with Copy alone (T3 Code): who answered is the composer's, how long and what it cost the folded line.
  const words = !running && marker && parts.size <= 1 && end && end.status !== "running" ? items.flatMap((x) => (x.kind === "text" ? [untag(x.text)] : [])).join("\n\n") : "";
  if (words && marker)
    blocks.push({
      key: `end-${marker.id}`,
      still: true,
      node: (
        <div className="lc-turn-end">
          <button type="button" className="lc-ib l-focus" aria-label="Copy the answer" title="Copy the answer" onClick={() => void navigator.clipboard.writeText(words).then(() => toast("Copied"))}>
            <I.copy size={14} />
          </button>
        </div>
      ),
    });
  return (
    <section className="lc-turn" data-running={running || undefined}>
      {blocks.map((b, i) => (
        // data-item lets the session find a block: the prompt minimap scrolls to your messages by it.
        <div key={b.key} className="lc-blk" data-item={b.id ?? b.key} data-fresh={(!b.still && fresh(b.id ?? b.key)) || undefined}>
          {b.trail ? <Summary threadId={threadId} {...b.trail} asks={asks} lead={i === lastTrail ? leadWords : undefined} cost={i === lastTrail && cost > 0 ? cost : undefined} onReview={onReview} /> : b.node}
        </div>
      ))}
    </section>
  );
});

const whoOf = (marker: Item | undefined, agents: AgentProfile[], providers: ProviderInfo[]) => (marker?.kind === "turn" ? agentOf(marker.agent, agents, providers).name : "The agent");

export type Mark = Extract<Item, { kind: "turn" }>;

/** A turn's parts by model, each under the id of its first: a part on another model starts a head of its own; one on the same model (its fix) carries on under it. */
function sectionsOf(marks: Mark[]) {
  const out = new Map<string, Mark[]>();
  let now: Mark[] | undefined;
  for (const m of marks) {
    if (now && now[0].model === m.model && Boolean(now[0].planning) === Boolean(m.planning)) now.push(m);
    else out.set(m.id, (now = [m]));
  }
  return out;
}

/** What a part that carried the turn on does as it works, and did once it's done. */
const PART_WORDS: Record<TurnPart, [string, string]> = {
  build: ["building", "built it in"],
  refine: ["finishing it", "finished it in"],
  repair: ["repairing it", "repaired it in"],
  fix: ["fixing it", "fixed it in"],
  revise: ["revising it", "revised it in"],
  takeover: ["taking it on", "took it on in"],
};

/**
  Who did a part of the turn, on what model, and how long: "Forge ◑ Sonnet 5.5", "Opus 5.5 · planned
  in 41s". The first part's head carries the turn's number; a model that carried it on (built the
  plan, finished the draft) has a head of its own that says what it did. What it's doing right now
  and the running clock are on the turn's status line, at its end where the eye is; the head stays
  still. A plain turn's time goes on its trail's line once it's done (`timed`: it has none, so the
  head keeps it).
*/
function TurnHead({ it, marks, n, items, agents, providers, timed }: { it: Mark; marks: Mark[]; n?: number; items: Item[]; agents: AgentProfile[]; providers: ProviderInfo[]; timed: boolean }) {
  const a = agentOf(it.agent, agents, providers);
  // The part's state is its last mark's: working while any of them works.
  const end = marks[marks.length - 1];
  const status = marks.some((m) => m.status === "running") ? "running" : end.status;
  const why = marks.flatMap((m) => (m.why ? [m.why] : [])).join(" ");
  // A planner that ended in a plan "planned"; one that only answered worked, like any other.
  const planned = it.planning && items.some((x) => x.kind === "proposal");
  const did = it.part ? PART_WORDS[it.part][1] : it.planning && planned ? "planned in" : "";
  const took = end.seconds === undefined ? undefined : (end.at - it.at) / 1000 + end.seconds;
  const meta =
    status === "running"
      ? ""
      : took === undefined
        ? status === "stopped"
          ? "stopped"
          : status === "error"
            ? "ran into a problem"
            : did
              ? did.replace(/ in$/, "")
              : ""
        : status === "stopped"
          ? `stopped after ${duration(took)}`
          : status === "error"
            ? `ran into a problem after ${duration(took)}`
            : did
              ? `${did} ${duration(took)}`
              : timed
                ? duration(took)
                : "";
  // A model on its own is named after the model, so its mark stands bare in the disc's place instead of a tag.
  const alone = isModelAgent(it.agent);
  return (
    <div className="lc-head" data-part={n === undefined || undefined} title={why || undefined}>
      {alone ? <ModelMark kind={markOf(it.model)} size={16} /> : <Disc agent={a} size={20} lead={it.planning || undefined} />}
      <b>{a.name}</b>
      {!alone && <ModelTag kind={markOf(it.model)} label={modelLabel(it.model, providers)} />}
      {meta && <span className="lc-head-meta">· {meta}</span>}
      <span className="lc-grow" />
      {n !== undefined && <span className="lc-head-meta">Turn {n}</span>}
    </div>
  );
}

/** What a part that is still at work is doing, for the status line: "Building", "Planning". */
const PART_NOW: Record<TurnPart, string> = { build: "Building", refine: "Finishing it", repair: "Repairing it", fix: "Fixing it", revise: "Revising it", takeover: "Taking it on" };

/**
  Clocks that tick by writing their own text, so a running turn doesn't draw its list again every
  second: one timer for all of them at each pace, there only while one is up (T3 Code:
  apps/web/src/lib/tickTextContent.ts). The live line's clock ticks in tenths, the rest each second.
*/
const tickers = new Map<number, { fns: Set<() => void>; timer: number }>();
function onTick(fn: () => void, every: number) {
  let t = tickers.get(every);
  if (!t) {
    const fns = new Set<() => void>();
    tickers.set(every, (t = { fns, timer: window.setInterval(() => fns.forEach((f) => f()), every) }));
  }
  t.fns.add(fn);
  return () => {
    const now = tickers.get(every);
    if (!now) return;
    now.fns.delete(fn);
    if (now.fns.size) return;
    window.clearInterval(now.timer);
    tickers.delete(every);
  };
}
/** Text that keeps itself up to date each second (`every`, in ms). React never owns its words, so a redraw and a tick can't fight over them. */
export function Tick({ text, className, every = 1000 }: { text: () => string; className?: string; every?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const read = useRef(text);
  read.current = text;
  const put = useCallback(() => {
    const el = ref.current;
    const t = read.current();
    if (el && el.textContent !== t) el.textContent = t;
  }, []);
  useLayoutEffect(put);
  useEffect(() => onTick(put, every), [put, every]);
  return <span ref={ref} className={className} />;
}
/** A clock while it runs: whole seconds, so it doesn't show tenths it never updates. */
const ticked = (s: number) => (s < 60 ? `${Math.floor(Math.max(0, s))}s` : duration(Math.floor(s)));

/**
  A running turn's state for a status line: whether it waits on you, its one word, and its clock (time spent waiting on you
  left out): `clock` in whole seconds, `fine` as the folded line will say it (tenths under ten seconds). The live line here,
  the Wall's tiles and the session's details all read it.
*/
export function liveOf(marks: Mark[], items: Item[]) {
  const first = marks[0];
  const now = marks.findLast((m) => m.status === "running") ?? marks[marks.length - 1];
  const asks = items.filter((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
  const waiting = asks.length > 0;
  const waited = marks.reduce((n, m) => n + (m.waited ?? 0), 0);
  // When the wait began: the engine's mark, else the oldest thing still asking.
  const since = marks.find((m) => m.waitingSince)?.waitingSince ?? (waiting ? Math.min(...asks.map((a) => a.at)) : undefined);
  const spent = () => (Math.min(Date.now(), since ?? Infinity) - first.at - waited) / 1000;
  const clock = () => ticked(spent());
  const fine = () => duration(Math.max(0, spent()));
  const last = items.findLast((x) => x.kind !== "notice");
  const word = waiting
    ? "Waiting for you"
    : now.part
      ? PART_NOW[now.part]
      : now.planning
        ? "Planning"
        : !items.some((x) => x.kind === "tool" && x.status === "running") && last?.kind === "reasoning" && last.streaming
          ? "Thinking"
          : "Working";
  return { waiting, word, clock, fine };
}

/** A tool gone quiet: its notice with Stop, with nothing but notices after it. Read from the end, so a long thread costs nothing. */
function quietOf(items: Item[]) {
  for (let i = items.length - 1; i >= 0 && items[i].kind === "notice"; i--) {
    const x = items[i];
    if (x.kind === "notice" && x.stop) return x;
  }
  return undefined;
}

/** Asking Opus to plan (Sonnet that escalates): its own line in the chat, never a step. */
const escalates = (it: Item) => it.kind === "tool" && it.toolKind === "task" && /^Opus\b/.test(it.title);

/** What the live line reads of a thread: everything but what the agent says, which streams and which the line never shows. */
const unsaid = (it: Item) => it.kind !== "text";
const NO_ITEMS: Item[] = [];

/**
  The work of a turn's part that is still at work, for the live line: its steps, its thinking and the asks on its trail,
  read by the rules Turn reads them by (cards, asking Opus to plan, the PR card's tests and what a face draws its own way
  stay out; an answered ask folds into its step). A new part (a build after the plan) starts the work again. Null when
  the turn isn't at work.
*/
function workOf(items: Item[], docked: boolean, draw?: Props["draw"]) {
  const marks = items.filter((x): x is Mark => x.kind === "turn");
  if (!marks.some((m) => m.status === "running")) return null;
  const parts = sectionsOf(marks);
  const folded = new Set([...foldedAsks(items).values()].map((a) => a.id));
  const designed = items.some((x) => x.kind === "design");
  let entries: Entry[] = [];
  for (const it of items) {
    if (it.kind === "turn") {
      if (parts.has(it.id)) entries = [];
      continue;
    }
    if ((it.kind === "tool" || it.kind === "approval") && it.tool === PR_TEST_TOOL) continue;
    if (draw?.(it) !== undefined) continue;
    if (it.kind === "tool") {
      if (!isCard(it, designed) && !escalates(it)) entries.push({ kind: "tool", it });
    } else if (it.kind === "reasoning") {
      if (shown(it)) entries.push({ kind: "thought", it });
    } else if (it.kind === "approval" && !folded.has(it.id) && !it.addon && (it.state !== "asking" || docked)) entries.push({ kind: "ask", it });
  }
  return { marks, entries, cp: items.findLast((x): x is Checkpoint => x.kind === "checkpoint") };
}

/** Each kind of step's mark (contracts/doing.ts stepKind): one place, so the live line, a step's row and the folded line agree. */
const KIND_MARK: Record<StepKind, typeof I.file> = { file: I.file, search: I.search, command: I.terminal, web: I.globe, agent: I.agents, canvas: I.design, other: I.tool };
const stepsIn = (rows: Row[]) => rows.flatMap((r) => (r.kind === "step" ? [r.step] : []));
/** The kinds of step a turn used, once each, in the line's own order, and one red problem mark when any step didn't work. */
function Kinds({ tools, failed }: { tools: Tool[]; failed: number }) {
  const used = new Set(tools.map(stepKind));
  const kinds = STEP_KINDS.filter((k) => used.has(k));
  if (!kinds.length && !failed) return null;
  return (
    <span className="lc-kinds" aria-hidden>
      {kinds.map((k) => {
        const Mark = KIND_MARK[k];
        return <Mark key={k} size={14} />;
      })}
      {failed > 0 && <StateMark state="problem" size={14} />}
    </span>
  );
}
/** How many steps a part took (an agent it sent is one) and how many didn't work. */
function countOf(rows: Row[], sent: Tool[]) {
  const steps = stepsIn(rows);
  return { steps, n: steps.length + sent.length, failed: steps.filter((s) => s.state === "failed").length + sent.filter((t) => t.status === "failed").length, tools: [...steps.flatMap((s) => s.tools), ...sent] };
}

/** One step on the live line, in the trail's words for it: its kind's mark, the verb, and what it touches as the trail's mono chip. */
function StepWords({ kind, verb, target, plain }: { kind: StepKind; verb: string; target?: string; plain?: boolean }) {
  const Mark = KIND_MARK[kind];
  return (
    <>
      <span className="lc-wk-ic" aria-hidden>
        <Mark size={14} />
      </span>
      <span className="lc-ll-verb">{verb}</span>
      {target && (plain ? <span className="lc-wk-target" data-plain>{target}</span> : <code className="lc-wk-target">{target}</code>)}
    </>
  );
}

/**
  The newest step, and the one it takes over from: the new one slides up into place from 16px below while the old one
  leaves upward, in a box one line high, so the line never grows and the chat never moves. The step says it in place
  while it stays the newest (Reading → Read). The slide plays whatever Reduce motion and the Motion setting say
  (timeline.css): it is how a person reads that the work moved on.
*/
function Slide({ id, children }: { id: string; children: ReactNode }) {
  const [now, setNow] = useState(id);
  const [was, setWas] = useState<{ id: string; node: ReactNode } | null>(null);
  const [moved, setMoved] = useState(false);
  // What the line said last, kept for the step on its way out.
  const last = useRef(children);
  if (now !== id) {
    setWas({ id: now, node: last.current });
    setNow(id);
    setMoved(true);
  }
  useLayoutEffect(() => {
    last.current = children;
  });
  // Gone once it has left: a time, not its animation's end, which a hidden line never reaches.
  useEffect(() => {
    if (!was) return;
    const t = window.setTimeout(() => setWas(null), 240);
    return () => window.clearTimeout(t);
  }, [was]);
  return (
    // No live region: each step read out as it slides in would drown the session (Crew.tsx's CrewStrip holds the same).
    <div className="lc-ll-tick">
      {was && (
        <div key={`was-${was.id}`} className="lc-ll-step" data-ph="out" aria-hidden>
          {was.node}
        </div>
      )}
      <div key={id} className="lc-ll-step" data-ph={moved ? "in" : undefined}>
        {children}
      </div>
    </div>
  );
}

/**
  A working turn as one live line, at the foot of the chat right over the message box: the working mark in the model's
  colour, how many steps so far, the kinds of step used, then under a hairline only the newest step, then the clock.
  Pressed, it opens the steps so far. A turn with no step yet shows the mark and its clock alone; one that waits on you
  says where the clock stopped. A tool gone quiet says so on the clock's line, with Stop. When the turn ends the line goes
  and the turn's folded line is in the chat (Summary). The session, Liner Design's chat, a scan and the side chat each
  put it at their chat's foot; `docked`: the chat docks asks at the composer, so they are rows of the work (Timeline's
  prop); `draw`: the face's own drawing hook, so what it draws its own way stays out, as in its chat; `end`: buttons of the
  place it sits in, at the head's right (Liner Design's small chat); `extra`: words of the face's own after the clock.
*/
export function LiveLine({ threadId, items: given, docked = true, draw, end, extra, className }: { threadId: string; items?: Item[]; docked?: boolean; draw?: Props["draw"]; end?: ReactNode; extra?: ReactNode; className?: string }) {
  const own = useItemsWhere(given ? undefined : threadId, unsaid);
  const all = given ?? own;
  const names = useContext(FrameNames);
  const turn = useMemo(() => turnsOf(all).at(-1)?.items ?? NO_ITEMS, [all]);
  const work = useMemo(() => workOf(turn, docked, draw), [turn, docked, draw]);
  const read = useMemo(() => (work ? rowsOf(work.entries, work.cp, names) : null), [work, names]);
  const asks = useMemo(() => foldedAsks(turn), [turn]);
  const quietNow = useEngine((s) => quietOf(s.items[threadId] ?? NO_ITEMS));
  const quiet = given ? quietOf(given) : quietNow;
  if (!work || !read) return null;
  return <Live threadId={threadId} turn={turn} marks={work.marks} entries={work.entries} {...read} asks={asks} quiet={quiet} end={end} extra={extra} className={className} />;
}

function Live({ threadId, turn, marks, entries, rows, sent, asks, quiet, end, extra, className }: { threadId: string; turn: Item[]; marks: Mark[]; entries: Entry[]; rows: Row[]; sent: Tool[]; asks: Map<string, Ask>; quiet?: Extract<Item, { kind: "notice" }>; end?: ReactNode; extra?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const { waiting, word, fine } = liveOf(marks, turn);
  // Its ETA, as its sidebar row says it (Thread.eta): read as numbers, so a new thread object with the same one redraws nothing.
  const etaFrom = useEngine((s) => threadOf(s, threadId)?.eta?.from);
  const etaMs = useEngine((s) => threadOf(s, threadId)?.eta?.ms);
  const { steps, n, failed } = countOf(rows, sent);
  // The newest of what it's at: thinking since its last step, else its newest step or agent sent.
  const step = steps.at(-1);
  const agent = sent.at(-1);
  const since = entries.slice(entries.findLastIndex((e) => e.kind !== "thought") + 1);
  const thinking = since.length > 0 && step?.state !== "running";
  // Thinking says its last sentence after the word, quiet and cut to the line by CSS; the line slides when a new sentence begins, not on every token.
  const thought = thinking ? thoughtLine(since.flatMap((e) => (e.kind === "thought" ? [e.it.text] : []))) : undefined;
  const newest = thought
    ? { key: `think-${since[0].it.id}:${thought.n}`, node: <><span className="lc-wk-ic" aria-hidden><I.think size={14} /></span><span className="lc-ll-verb">Thinking</span>{thought.sentence && <span className="lc-wk-r">{thought.sentence}</span>}</> }
    : agent && (!step || agent.at > step.at)
      ? // An agent at work says what it is doing in the trail's words ("Sidekick · Running npm test"), each new thing sliding in; nothing heard yet, what it was sent for.
        agent.status === "running" && agent.agent?.now
        ? { key: `${agent.id}:${agent.agent.now}`, node: <StepWords kind="agent" verb={`${isSidekick(agent) ? "Sidekick" : agentName(agent)} · ${agent.agent.now}`} /> }
        : { key: agent.id, node: <StepWords kind="agent" verb={isSidekick(agent) ? SIDEKICK_WORDS[agent.status === "running" ? 0 : 1] : KIND_WORDS.task[agent.status === "running" ? 0 : 1]} target={isSidekick(agent) || bare(agent.title) ? undefined : agent.title} plain /> }
      : step
        ? { key: step.key, node: <StepWords kind={stepKind(step.tools[step.tools.length - 1])} verb={step.verb} target={step.target} plain={step.plainTarget} /> }
        : null;
  // The open list: every step so far with the thinking between them, as the folded line's list has it once the part ends.
  const list = rows;
  // The model at work no longer tints the mark (rule 7): it is the working mark, or the needs-you mark while it waits on you.
  const state = waiting ? "needs" : "working";
  // "opencode hasn't said anything new for 1 minute": the notice's first clause; the rest is its title.
  const hush = !waiting && quiet ? quiet.text.split(/:\s/)[0] : undefined;
  // The time, after the step: the whole turn's work, or where the clock stopped while it waits on you.
  const clock = (
    <span className="lc-ll-clock l-num" data-wait={waiting || undefined} title={hush ? quiet!.text : undefined}>
      {waiting ? (
        <>
          <b>Waiting for you</b> <Tick text={fine} />
        </>
      ) : (
        <>
          <Tick text={fine} every={100} />
          {hush && ` · ${hush}`}
          {etaFrom !== undefined && etaMs !== undefined && <EtaLeft eta={{ from: etaFrom, ms: etaMs }} lead=" · " />}
        </>
      )}
      {extra}
    </span>
  );
  const stop = hush && (
    <button type="button" className="lc-notice-stop l-focus" onClick={() => void rpc("thread.stop", { id: threadId })}>
      Stop
    </button>
  );
  // No step yet and not thinking: the mark, the word and its clock alone. Thinking before the first step has the line, so its words show.
  if (!n && !newest)
    return (
      <div className={className ? `lc-ll ${className}` : "lc-ll"} role="group" aria-label="The turn at work" data-alone>
        <div className="lc-ll-row">
          <span className="lc-ll-head" data-still>
            <StateMark state={state} label={MARK_WORD[state]} />
            {!waiting && <span className="lc-ll-verb">{word === "Thinking" ? "Working" : word}</span>}
            {clock}
          </span>
          {stop}
          {end && <span className="lc-ll-end">{end}</span>}
        </div>
      </div>
    );
  // One line under the cards (SPEC rule 6): the newest step, its time and ›; pressed, the steps so far open over it.
  return (
    <div className={className ? `lc-ll ${className}` : "lc-ll"} role="group" aria-label="The turn at work">
      {open && list.length > 0 && <StepList rows={list} asks={asks} live />}
      <div className="lc-ll-row">
        <button type="button" className="lc-ll-head l-focus" aria-expanded={list.length ? open : undefined} disabled={!list.length} aria-label={`${MARK_WORD[state]}. ${n ? `${plural(n, "step")} so far` : "Thinking"}${failed ? `, ${failed} didn't work` : ""}${list.length ? `. ${open ? "Hide them" : "Show them"}` : ""}`} onClick={() => setOpen(!open)}>
          <StateMark state={state} />
          <span className="lc-ll-now">{newest ? <Slide id={newest.key}>{newest.node}</Slide> : <span className="lc-ll-verb">{word}</span>}</span>
          {clock}
          {list.length > 0 && <I.chevR size={12} className="lc-sum-chev" />}
        </button>
        {stop}
        {end && <span className="lc-ll-end">{end}</span>}
      </div>
    </div>
  );
}

/** Thinking under 3 seconds isn't worth a line once it's done; nor is a row for it, which would leave a gap. */
const shown =(it: Extract<Item, { kind: "reasoning" }>) => Boolean(it.text.trim()) && (it.streaming || (it.seconds ?? 0) >= 3);

/** Thinking: a quiet fold that says how long it took, the words and then the chevron. On an open trail it's one of its rows. */
function Thought({ it }: { it: Extract<Item, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  if (!shown(it)) return null;
  return (
    <div className="lc-thought" data-open={open || undefined} data-live={it.streaming || undefined}>
      <button type="button" className="lc-thought-h l-focus" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{it.streaming ? "Thinking…" : `Thought for ${duration(it.seconds)}`}</span>
        <Chev className="lc-row-chev" />
      </button>
      <div className="lc-fold">
        <div>
          <p className="lc-thought-t">{it.text}</p>
        </div>
      </div>
    </div>
  );
}

/**
  Before you send: the session's model was changed to another tool's, so your next message hands that tool the conversation
  as a note (T3 Code's "Context handoff pending", client-runtime handoff.ts resolvePendingHandoff). As the engine decides it
  (runtime.ts openSession `switched`): a saved session of another tool's. Not while a turn runs, when the row it puts says it.
  From the model the engine names too (switchedFrom), not the newest turn, which is the new model's own when it failed.
*/
function Ahead({ threadId, items, providers }: { threadId: string; items: Item[]; providers: ProviderInfo[] }) {
  const t = useEngine((s) => threadOf(s, threadId));
  const agents = useEngine((s) => s.agents);
  if (!t?.providerSession || t.status === "running") return null;
  const to = threadModel(t, agents, providers);
  const { provider } = splitModel(to);
  if (provider === "demo" || t.providerSession.startsWith(`${provider}:`) || !items.some((x) => x.kind === "user" || x.kind === "text")) return null;
  const from = switchedFrom(items, provider, t.providerSession);
  return (
    <p className="lc-notice lc-switched-ahead">
      <span>Your next message hands off</span>
      {from && <ModelTag kind={markOf(from)} label={modelLabel(from, providers)} size={14} />}
      <span aria-hidden="true">→</span>
      <span className="l-sr-only">to</span>
      <ModelTag kind={markOf(to)} label={modelLabel(to, providers)} size={14} />
      <span>with a note of everything so far</span>
    </p>
  );
}

/**
  Where the session moved to another tool: from which model to which, at what effort, and the handoff note the one taking
  over was sent, folded under it to read (T3 Code's handoff row, apps/web/src/components/chat/V2LifecycleRow.tsx).
*/
function Switched({ h, providers }: { h: Handoff; providers: ProviderInfo[] }) {
  const [open, setOpen] = useState(false);
  // The model's own name for the level, else the word it was saved as (a model no tool lists any more).
  const level = h.effort ? (effortsFor(h.to, providers).list.find((e) => e.id === h.effort)?.label ?? h.effort) : undefined;
  const to = modelLabel(h.to, providers);
  return (
    <div className="lc-thought lc-switched" data-open={open || undefined}>
      <button type="button" className="lc-switched-h l-focus" aria-expanded={open} title={open ? "Hide the handoff note" : `Read the handoff note ${to} was sent`} onClick={() => setOpen((o) => !o)}>
        <span className="lc-switched-w">Switched</span>
        {h.from && (
          <>
            <ModelTag kind={markOf(h.from)} label={modelLabel(h.from, providers)} size={14} />
            <span className="lc-switched-to" aria-hidden="true">→</span>
            <span className="l-sr-only">to</span>
          </>
        )}
        <ModelTag kind={markOf(h.to)} label={to} size={14} />
        {level && <span className="lc-switched-w">{levelName(level)}</span>}
        <Chev className="lc-row-chev" />
      </button>
      <div className="lc-fold">
        <div>
          <p className="lc-thought-t">{h.note}</p>
        </div>
      </div>
    </div>
  );
}

/**
  A plan while it's written: one line with the working mark, with how many steps it has so far,
  rather than the plan streaming by and then showing again as its card. It opens for a look.
*/
function PlanDraft({ text, title }: { text?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const steps = text ? stepsOf(text).length : 0;
  return (
    <div className="lc-thought" data-open={open || undefined} data-live>
      <button type="button" className="lc-thought-h l-focus" aria-expanded={text ? open : undefined} disabled={!text} onClick={() => setOpen((o) => !o)}>
        <StateMark state="working" />
        <span>{title ? `Writing the plan: ${title}` : "Writing the plan"}</span>
        {steps > 0 && <span className="l-num">· {plural(steps, "step")} so far</span>}
        {text && <Chev className="lc-row-chev" />}
      </button>
      {text && (
        <div className="lc-fold">
          <div>
            <p className="lc-thought-t">{text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** A folded row's small triangle (Claude Code's): it points at the words shut and down open. */
const Chev = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={className}>
    <path d="M4.75 6.25h6.5L8 10.25Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
  </svg>
);

const lastLine = (s?: string) =>
  s
    ?.split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A long output's last 6000 characters, from a whole line: what went wrong is at the end. "…" marks the cut. */
const tailOf = (s: string, n = 6000) => {
  if (s.length <= n) return s;
  const tail = s.slice(-n);
  const nl = tail.indexOf("\n");
  return `…\n${nl >= 0 && nl < 240 ? tail.slice(nl + 1) : tail}`;
};

/*
  Plain names for steps. A tool may title a call with nothing but its kind ("edit", "execute": OpenCode's before it says
  more), and Liner Design's own tools name frames by their ids; neither is words for a person. trailSteps names every step
  (the trail, the Wall, the Design face's chat row all read it), so the plain names are made there, from what the call
  holds: its path, its command, the frame it touches. The words themselves are contracts/doing.ts's, which the engine's
  doing line (the sidebar's second line) says too.
*/
/**
  Calls that were drawing a frame while they ran, by design, frame and call: they say "Drawing", then "Drew", whatever the
  design file says of the frame meanwhile (one drawn again after it was deleted joins the file mid-call).
*/
const drawing = new Set<string>();
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** The file a call is about, by its name: its path's, else a path's in its input, else its title's without the verb (a real title only). */
const fileOf = (t: Tool, verb: RegExp) => {
  const p = callPath(t, verb);
  return p ? stepFileName(p) : undefined;
};
/** Turns a frame's id into its name. The Design face gives one (Chat.tsx); without it a frame is called by what the call says. */
/** `design`: the design file the call names (its slug); a namer names only the open one's frames. */
export type FrameNamer = ((frame: string, design?: string) => string | undefined) & {
  /** The open design file's slug: only its frames can be new for want of a name. */
  open?: string;
  /** The calls that drew a frame: the first whole write of its file in the session (the chat works it out from the timeline). */
  drew?: (toolId: string) => boolean;
};
export const FrameNames = createContext<FrameNamer | undefined>(undefined);
/** A canvas tool's step in plain words: "Read Phone / Menu", "Changed Phone / Menu" (contracts/doing.ts's, the doing line's too). */
const canvasStep = (t: Tool, kind: string, running: boolean, names?: FrameNamer) => canvasWords(t, kind, running, canvasFrame(t, kind, names));

/** One line of the trail: what it did (a verb and what it touched), how it went, and the fact that matters, under it. */
/** `diff`: the file in the turn's checkpoint an edit step changed, which a press opens in Changes. */
export type TrailStep ={ key: string; tools: Tool[]; verb: string; target?: string; /** The target is a frame's name, in the Design face: plain type, not mono. */ plainTarget?: boolean; result?: ReactNode; state: "running" | "done" | "failed"; at: number; seconds: number; tail?: string; diff?: string };
type Row = { kind: "step"; step: TrailStep } | Exclude<Entry, { kind: "tool" }>;

/** A line of output that says what went wrong. */
const ERRORISH = /\b(?:error|fatal|not found|no such file|permission denied|cannot|can't|couldn't|unable|refused|denied|traceback|exception|invalid|unknown)\b/i;
/** How a command ended, in a few words: its test count; failed, its exit code and the line that says why; else its last line. */
function ranResult(t: Tool): ReactNode {
  const out = t.output ?? "";
  // "24 passed", "Tests: 3 failed", and node's "ℹ pass 24" / "ℹ fail 0": the count either side of the word.
  const count = (word: RegExp) => {
    const m = new RegExp(`(\\d+)\\s+(?:tests?\\s+)?${word.source}|\\b${word.source}\\s+(\\d+)`, "i").exec(out);
    return m ? (m[1] ?? m[2]) : undefined;
  };
  const passed = count(/pass(?:ed|ing|es)?\b/);
  const failed = count(/fail(?:ed|ing|ures?|s)?\b/);
  if (passed) return <span className={failed && failed !== "0" ? "lc-bad" : "lc-good"}>{failed && failed !== "0" ? `✕ ${failed} failed, ${passed} passed` : `✓ ${passed} passed`}</span>;
  if (t.status === "failed") {
    // Claude Code starts with "Exit code 128"; others end on "[exit 1: why]". The rest is what it printed, which may be fine.
    const exit = /\[exit (\d+)(?::\s*([^\]]+))?\]/.exec(out) ?? /^Exit code (\d+)/m.exec(out);
    const lines = out.split("\n").map((l) => l.trim()).filter((l) => l && !/^Exit code \d+$|^\[exit \d+/.test(l));
    const code = exit?.[1];
    const why = exit?.[2] ?? lines.find((l) => ERRORISH.test(l)) ?? (code === "127" ? "command not found" : code === "126" ? "it couldn't run" : code ? undefined : lines.at(-1));
    return <span className="lc-bad">✕ {[code && `exit ${code}`, why && clip(why, 80)].filter(Boolean).join(": ") || "failed"}</span>;
  }
  const line = lastLine(out);
  return line ? clip(line) : undefined;
}

/** Parts of a result line, with a dot between those there are: none dangles when a part is missing. */
function joined(parts: ReactNode[]): ReactNode {
  const there = parts.filter((p) => p !== undefined && p !== null && p !== false && p !== "");
  return there.length ? there.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>) : undefined;
}

/** What the page said after the agent's last look: some of its text, and its console. */
function pageParts(t: Tool): ReactNode[] {
  const out = t.output ?? "";
  if (t.status === "failed") return [<span className="lc-bad">✕ {clip(lastLine(out) ?? "the Browser couldn't")}</span>];
  // A page with no text (a canvas game) says "(no text)", which isn't worth quoting.
  const text = /\n\n([\s\S]*?)\n\nControls:/.exec(out)?.[1]?.replace(/\s+/g, " ").trim();
  const errors = /Console errors:\n([\s\S]*)$/.exec(out)?.[1]?.split("\n").filter(Boolean).length ?? 0;
  return [
    text && text !== "(no text)" && <b className="lc-tstep-quote">“{clip(text, 60)}”</b>,
    errors ? <span className="lc-bad">{plural(errors, "console error")}</span> : /Console: no errors/.test(out) && "no console errors",
  ];
}

const writes = (t: Tool) => t.toolKind === "edit" || t.toolKind === "write";

/**
  The turn's tool calls as steps: reads in a row gather into one, so do edits in a row to the same
  file (T3 Code's work log groups them the same way, so a run of edits isn't a stack of rows), and
  so do the agent's turns at the Browser.
*/
export function trailSteps(tools: Tool[], cp?: Checkpoint, names?: FrameNamer): TrailStep[] {
  const groups: Tool[][] = [];
  for (const t of tools) {
    const prev = groups.at(-1)?.at(-1);
    const same = prev && ((prev.toolKind === "read" && t.toolKind === "read") || (BROWSER.test(prev.tool) && BROWSER.test(t.tool)) || (writes(prev) && writes(t) && Boolean(t.path) && prev.path === t.path));
    if (same) groups.at(-1)!.push(t);
    else groups.push([t]);
  }
  return groups.map((g): TrailStep => {
    const t = g[g.length - 1];
    const first = g[0];
    const state = g.some((x) => x.status === "running") ? "running" : t.status === "failed" ? "failed" : "done";
    // From the first call's start to the last one's end: calls in a group often run side by side.
    const seconds = (Math.max(...g.map((x) => x.at + (x.seconds ?? 0) * 1000)) - first.at) / 1000;
    const base = { key: first.id, tools: g, state, at: first.at, seconds } as const;
    const canvas = CANVAS_STEP.exec(t.tool);
    if (canvas) {
      const line = lastLine(t.output);
      return { ...base, ...canvasStep(t, canvas[1], state === "running", names), plainTarget: Boolean(names), result: state === "failed" ? <span className="lc-bad">✕ {clip(line ?? "it didn't go")}</span> : undefined };
    }
    const browser = BROWSER.exec(t.tool);
    if (browser) {
      // What it did, counting only what worked: a click the page turned down didn't happen.
      const acts = g.filter((x) => x.status !== "failed").map((x) => BROWSER.exec(x.tool)?.[1] ?? "");
      const did = (["open", "click", "type", "press"] as const).flatMap((a) => {
        const n = acts.filter((x) => x === a).length;
        const word = { open: "opened", click: "clicked", type: "typed", press: "pressed keys" }[a];
        return n ? [n > 1 ? `${word} ×${n}` : word] : [];
      });
      const page = /^(?:Open|Opened)\s+(.+?)\s+in the Browser$/.exec(first.title)?.[1];
      return { ...base, verb: BROWSER_WORDS[state === "running" ? 0 : 1], target: page, result: joined([did.join(", "), ...pageParts(t)]) };
    }
    if (SERVER.exec(t.tool)?.[1] === "start") {
      // "web is running on localhost:5173, …": where it runs, which is what the person needs of it.
      const at = /\b(?:running|starting)\b[^\n]*?\bon (localhost:\d+)/.exec(t.output ?? "")?.[1];
      // Failed, why: the line under "didn't stay up", or the one line it said (the person said no).
      const said = (t.output ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const why = /didn't stay up/.test(said[0] ?? "") ? said[1] : said[0];
      const server = serverOf(t);
      const verb = state === "running" ? "Starting" : state === "failed" ? "Couldn't start" : "Started";
      return { ...base, verb: server ? verb : `${verb} a server`, target: server, result: state === "failed" ? (why ? clip(why) : undefined) : at };
    }
    if (t.toolKind === "read") {
      const files = [...new Set(g.flatMap((x) => fileOf(x, /^Read\s+/) ?? []))];
      const verb = state === "running" ? "Reading" : "Read";
      // Calls that name no file are still reads: counted, not shown as their kind.
      if (!files.length) return { ...base, verb: g.length > 1 ? `${verb} ${plural(g.length, "file")}` : `${verb} a file` };
      return { ...base, verb, target: files.length === 1 ? files[0] : `${files.length} files`, result: files.length > 1 ? clip(files.join(", ")) : undefined };
    }
    if (t.toolKind === "search") {
      const hits = t.output ? t.output.split("\n").filter(Boolean).length : 0;
      const i = inputOf(t);
      const what = bare(t.title) ? (str(i.pattern) ?? str(i.query)) : t.title.replace(/^Search(?:ed)?(?: the code)?(?: for)?\s*/i, "") || undefined;
      const verb = state === "running" ? "Searching" : "Searched";
      return { ...base, verb: what ? verb : `${verb} the code`, target: what, result: t.output !== undefined ? (hits ? plural(hits, "match", "matches") : "nothing found") : undefined };
    }
    if (writes(t)) {
      const f = t.path ? cp?.files.find((x) => slashed(t.path!) === x.path || slashed(t.path!).endsWith(`/${x.path}`)) : undefined;
      // An edit that didn't apply (its text wasn't found) is usually tried again in the same group.
      const missed = g.length > 1 ? g.filter((x) => x.status === "failed").length : 0;
      return {
        ...base,
        diff: f && cp && !cp.reverted && state !== "running" ? f.path : undefined,
        ...(() => {
          // A design file's frame is called by its name ("Changed Phone / Menu"), not its file's.
          const [, slug, frame] = FRAME_FILE.exec(slashed(t.path ?? "")) ?? [];
          // In the Design face (a namer), a design frame by its name: drawn when the call wrote it first (or, under way, the
          // frame isn't in the design file yet), else changed. Liner Code has no namer and reads it as any file, as before.
          if (frame && names) {
            // A frame with no name is new only in the open design; one of another design has no name here at all, so its
            // call says what it is by itself (a first whole write) and is otherwise a change.
            const key = (x: Tool) => `${slug}/${frame}/${x.id}`;
            const drawn = f?.status === "added" || g.some((x) => names.drew?.(x.id) || drawing.has(key(x))) || (state === "running" && slug === names.open && !names(frame, slug));
            if (drawn && state === "running") drawing.add(key(t));
            return { verb: state === "running" ? (drawn ? "Drawing" : "Changing") : drawn ? "Drew" : "Changed", target: frameFileName(t, frame, names(frame, slug)), plainTarget: true };
          }
          const file = fileOf(t, /^(?:Edit|Write)\s+/);
          // A change that names no file still says what it did: "Changed a file", not the tool's "edit".
          if (!file) return { verb: state === "running" ? "Changing a file" : "Changed a file" };
          return { verb: state === "running" ? "Editing" : f?.status === "added" ? "Created" : "Edited", target: file };
        })(),
        result: joined([f && <Lines added={f.added} removed={f.removed} />, g.length > 1 && plural(g.length, "edit"), missed > 0 && <span className="lc-bad">{missed} didn't apply</span>]),
      };
    }
    if (t.toolKind === "exec") {
      const command = callCommand(t).replace(/\s+/g, " ").trim();
      const verb = state === "running" ? "Running" : "Ran";
      return { ...base, verb: command ? verb : `${verb} a command`, target: command ? clip(command, 72) : undefined, result: state === "running" ? undefined : ranResult(t), tail: state === "running" && t.output ? t.output.split("\n").filter(Boolean).slice(-2).join("\n") : undefined };
    }
    // In the Design face a lead's brief is said once and plainly: the brief itself is on its row, and what the sidekick
    // does is the sidekick's own part of the chat's row (Chat.tsx). Liner Code (no namer) names it by its title, as before.
    if (names && isSidekick(t)) return { ...base, verb: SIDEKICK_WORDS[state === "running" ? 0 : 1] };
    const line = lastLine(t.output);
    // A call titled with only its kind is named by the kind in words; one with no kind of note, by its tool's name.
    const words = KIND_WORDS[t.toolKind];
    const tool = toolNameOf(t.tool);
    const verb = !bare(t.title) ? t.title : words ? words[state === "running" ? 0 : 1] : `${state === "running" ? "Using" : "Used"} ${tool ?? "a tool"}`;
    return { ...base, verb, result: line && state !== "running" ? clip(line) : undefined };
  }).map((step) => {
    // A call that was still going when its turn was stopped says so, rather than how far its output got.
    const t = step.tools[step.tools.length - 1];
    return t.status === "stopped" ? { ...step, result: <span className="lc-quiet">stopped</span> } : step;
  });
}

/** A trail's rows in the order they came: its steps (as trailSteps groups them), with thinking and answered asks between them. */
type TrailIn = { entries: Entry[]; rows: Row[]; sent: Tool[]; cp?: Checkpoint; who: string };
function rowsOf(entries: Entry[], cp?: Checkpoint, names?: FrameNamer): { rows: Row[]; sent: Tool[] } {
  // Agents this part sent off (Claude Code's Agent tool): they fan out under the trail, each with what it does (Crew.tsx), not as steps.
  const sent = entries.flatMap((e) => (e.kind === "tool" && e.it.toolKind === "task" && isStep(e.it) ? [e.it] : []));
  const rows: Row[] = [];
  let tools: Tool[] = [];
  const flush = () => {
    for (const step of trailSteps(tools, cp, names)) rows.push({ kind: "step", step });
    tools = [];
  };
  for (const e of entries) {
    if (e.kind === "tool") {
      if (!sent.includes(e.it)) tools.push(e.it);
    } else {
      flush();
      rows.push(e);
    }
  }
  flush();
  return { rows, sent };
}

/** How long a new row takes to come in. Only while you watch, and only its opacity. */
const ROW_IN = 160;

/** A step's mark: its kind's (contracts/doing.ts stepKind), as the live line and the folded line show the kinds. */
function StepIcon({ s }: { s: TrailStep }) {
  const Mark = KIND_MARK[stepKind(s.tools[s.tools.length - 1])];
  return <Mark size={14} />;
}

/**
  A part's steps, a line each, behind a hairline rule on the left: thinking, answered asks and asks that wait take their
  places between them. It scrolls inside about eight rows. Live (the live line's open list), it follows the newest while
  you're at its end and a row that arrives while you watch fades in; folded, it opens at the first.
*/
function StepList({ rows, asks, cp, live, onReview }: { rows: Row[]; asks: Map<string, Ask>; cp?: Checkpoint; live?: boolean; onReview?: (checkpointId: string, path?: string) => void }) {
  const [opened, setOpened] = useState<string[]>([]);
  // When each row came, so one that arrives while you watch fades in; those there when the list first drew don't.
  const came = useRef(new Map<string, number>());
  const drawn = useRef(false);
  useEffect(() => {
    drawn.current = true;
  }, []);
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(Boolean(live));
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);
  const toggle = (key: string) => setOpened((x) => (x.includes(key) ? x.filter((k) => k !== key) : [...x, key]));
  const fresh = (key: string) => {
    if (!came.current.has(key)) came.current.set(key, drawn.current && live ? Date.now() : 0);
    return Boolean(live) && Date.now() - (came.current.get(key) ?? 0) < ROW_IN;
  };
  const row = (r: Row) => {
    if (r.kind === "thought")
      return (
        <li key={r.it.id} className="lc-trail-note">
          <Thought it={r.it} />
        </li>
      );
    if (r.kind === "ask") return <AskRow key={r.it.id} it={r.it} fresh={fresh(r.it.id)} />;
    const key = r.step.key;
    return <StepRow key={key} s={r.step} said={r.step.tools.flatMap((t) => asks.get(t.id) ?? [])} cp={cp} open={opened.includes(key)} onToggle={() => toggle(key)} onReview={onReview} fresh={fresh(key)} />;
  };
  return (
    <div className="lc-steps" ref={box} role="group" aria-label="The turn's steps" onScroll={live ? (e) => (stuck.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 24) : undefined}>
      <ol className="lc-wk">{rows.map(row)}</ol>
    </div>
  );
}

/**
  A part of a turn once it is over, folded to one grey line above what it said: how long it worked (or that it was
  stopped, or ran into a problem), how many steps, how many didn't work, the kinds of step it used, and what it cost when
  the tools said. Pressed, it opens every step (StepList): each opens its own detail, an edit opens Changes at its file,
  and the agents it sent are under the line, each with what it does. A part's head says its time instead ("built it in
  46s"), so a part's line leads with its steps. A turn with no step has the line too, for its time and cost, with nothing
  to open.
*/
function Summary({ threadId, rows, sent, asks, cp, lead, cost, onReview }: TrailIn & { threadId: string; asks: Map<string, Ask>; /** "Worked for 11.4s", "Stopped after 4.2s". */ lead?: string; /** What the turn cost, at the line's end. */ cost?: number; onReview?: (checkpointId: string, path?: string) => void }) {
  const [open, setOpen] = useState(false);
  const { n, failed, tools } = countOf(rows, sent);
  const has = rows.length > 0;
  const said = [lead, n > 0 ? plural(n, "step") : !lead && has ? "Thought it through" : undefined, failed > 0 && `${failed} didn't work`].filter(Boolean).join(" · ");
  return (
    <div className="lc-trail" data-open={open || undefined}>
      <button type="button" className="lc-trail-sum l-focus" aria-expanded={has ? open : undefined} disabled={!has} onClick={() => setOpen(!open)}>
        {has && <I.chevR size={12} className="lc-sum-chev" />}
        {said && <span className="lc-trail-parts l-num">{said}</span>}
        <Kinds tools={tools} failed={0} />
        {cost !== undefined && <span className="l-num">{said ? `· ${money(cost)}` : money(cost)}</span>}
      </button>
      {open && has && <StepList rows={rows} asks={asks} cp={cp} onReview={onReview} />}
      <Fanout threadId={threadId} tools={sent} />
    </div>
  );
}

/**
  One step on a line: its kind's mark, its verb, what it touched in mono, how it went in grey, what
  you said to its ask as a tag, and its time at the right. Finished it's grey; the one at work is in
  full ink, and it only ever changes its words in place (Reading → Read). One that didn't work, or
  that you said no to, is red, with why in a few words. It opens for its input and output, or an
  edit opens Changes at its file.
*/
function StepRow({ s, said, cp, open, onToggle, onReview, fresh }: { s: TrailStep; said: Ask[]; cp?: Checkpoint; open: boolean; onToggle: () => void; onReview?: (checkpointId: string, path?: string) => void; fresh: boolean }) {
  const where = useContext(ReviewIn);
  const refused = said.length > 0 && said.every((a) => a.state === "denied");
  // A step you said no to failed because of it: your no says so, once, with your words if you gave any.
  const reason = refused ? said.find((a) => a.reason)?.reason : undefined;
  const result = refused ? (reason ? `“${clip(reason, 80)}”` : undefined) : s.result;
  // An edit with its file in the turn's checkpoint opens Changes at that file; the diff says more than the edit's input. With no Changes to open, it opens its own detail.
  const diff = onReview && s.diff && cp ? { id: cp.id, path: s.diff } : null;
  const has = !diff && (s.tools.some((t) => t.input || t.output) || said.some((a) => a.reason));
  const at = s.at;
  return (
    <li className="lc-wk-row" data-state={refused ? "no" : s.state} data-new={fresh || undefined}>
      <button
        type="button"
        className="lc-wk-ln l-focus"
        data-diff={diff ? true : undefined}
        aria-expanded={has ? open : undefined}
        disabled={!has && !diff}
        title={diff ? `Show ${nameOf(diff.path)} ${where}` : undefined}
        onClick={() => (diff && onReview ? onReview(diff.id, diff.path) : onToggle())}
      >
        <span className="lc-wk-ic" aria-hidden>
          <StepIcon s={s} />
        </span>
        <b className="lc-wk-verb">{s.verb}</b>
        {/* A frame's name in the Design face reads as a name, not code (plainTarget); files and commands stay mono. */}
        {s.target && (s.plainTarget ? <span className="lc-wk-target" data-plain>{s.target}</span> : <code className="lc-wk-target">{s.target}</code>)}
        {result && <span className="lc-wk-r">{result}</span>}
        {tagsOf(said).map((t) => (
          <span key={t} className="lc-wk-tag">
            {t}
          </span>
        ))}
        {diff && (
          <span className="lc-wk-go" aria-hidden>
            Changes ›
          </span>
        )}
        <span className="lc-grow" />
        {s.state === "running" ? <Tick className="lc-wk-time l-num" text={() => ((Date.now() - at) / 1000 >= 2 ? ticked((Date.now() - at) / 1000) : "")} /> : <span className="lc-wk-time l-num">{s.seconds >= 1 ? duration(s.seconds) : ""}</span>}
      </button>
      {has && open && (
        <div className="lc-tstep-more">
          {s.tools.map((t) => (
            <Fragment key={t.id}>
              {t.input && <pre className="lc-pre">{t.input}</pre>}
              {t.output && <pre className="lc-pre" data-out>{tailOf(t.output)}</pre>}
            </Fragment>
          ))}
        </div>
      )}
    </li>
  );
}

/**
  An ask on the trail. Waiting, it is a row in full ink with the needs-you mark, "Asks to …" and
  "waiting for you": the ask itself is at the composer. Answered without a step to fold into, it says
  what became of it: refused, in red, "Didn't …", with your words if you gave any.
*/
function AskRow({ it, fresh }: { it: Ask; fresh: boolean }) {
  // In the agent's words when it gave any; a command without them is "run" and the command in mono
  // after it, cut to the row's line, never the command as the verb.
  const words = headlineOf(it);
  const command = words === undefined ? askCommand(it) : undefined;
  const said = words ?? "run";
  const what = /^[A-Z][a-z]/.test(said) ? said[0].toLowerCase() + said.slice(1) : said;
  const state = it.state === "asking" ? "wait" : it.state === "denied" ? "no" : "done";
  const verb = it.state === "asking" ? `Asks to ${what}` : it.state === "denied" ? `Didn't ${what}` : `Asked to ${what}`;
  return (
    <li className="lc-wk-row" data-state={state} data-new={fresh || undefined}>
      <button type="button" className="lc-wk-ln" disabled title={it.title}>
        <span className="lc-wk-ic" aria-hidden>
          {it.state === "asking" ? <StateMark state="needs" /> : <I.ask size={14} />}
        </span>
        <b className="lc-wk-verb">{verb}</b>
        {command !== undefined && <code className="lc-wk-target">{command.replace(/\s+/g, " ").trim()}</code>}
        {it.reason && <span className="lc-wk-r">“{clip(it.reason, 80)}”</span>}
        <span className="lc-wk-tag">{it.state === "asking" ? "waiting for you" : tagsOf([it])[0]}</span>
        <span className="lc-grow" />
      </button>
    </li>
  );
}

/**
  What one agent handed to another, as the engine said it (UserShown.reports, never read from a message's words): a row
  each, "<from> reported to <to>" or "handed over to", its first sentence, how many lines, and ›; it opens in place.
*/
function Reports({ reports }: { reports: Report[] }) {
  return (
    <div className="lc-hand-list">
      {reports.map((r, i) => (
        <HandOver key={i} r={r} />
      ))}
    </div>
  );
}
function HandOver({ r }: { r: Report }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lc-hand" data-open={open || undefined}>
      <button type="button" className="lc-hand-h l-focus" aria-expanded={open} onClick={() => setOpen(!open)}>
        <I.notes size={14} />
        <b>{reportHead(r)}</b>
        <span className="lc-hand-t">{firstSentence(r.text)}</span>
        <span className="lc-hand-n l-num">{plural(lineCount(r), "line")}</span>
        <I.chevR size={12} className="lc-sum-chev" />
      </button>
      {open && <StreamedMarkdown className="lc-md lc-hand-body" text={r.text} streaming={false} animate={false} />}
    </div>
  );
}

/**
  The turn's plan. `end` is how the run that owns it ended (model.ts planEnd, read from the turn
  item of the plan's own `turn`, so a lead's plan stays as it was when a fix part starts). Stopped
  or failed: a step still waiting or under way was never reached, so it reads as skipped, the count
  says where it stopped, and one line names the first step it didn't reach. Finished with steps
  left: those read as left open, dashed the same, and the count stays "N of M done".
*/
function Todo({ it, end }: { it: Extract<Item, { kind: "plan" }>; end?: PlanEnd }) {
  const total = it.entries.length;
  const done = it.entries.filter((e) => e.status === "completed").length;
  const shown = (s: PlanEntry["status"]): StepState => (s === "completed" ? "done" : end ? "skipped" : s === "in_progress" ? "working" : "waiting");
  const missed = end === "stopped" ? it.entries.find((e) => e.status !== "completed") : undefined;
  // The words round the count change, the count stays where it is, so it rolls rather than coming in again.
  const [before, after] = missed ? ["Stopped at ", ` of ${total}`] : done === total && total > 0 ? ["All ", " done"] : ["", ` of ${total} done`];
  return (
    // A labelled list on the paper, not a card: "Plan" and its count, then a line a task.
    <section className="lc-todo" aria-label="Plan">
      <div className="lc-todo-h">
        <b>Plan</b>
        <span className="lc-quiet">
          {before}
          <Num value={done} />
          {after}
        </span>
      </div>
      <ol>
        {it.entries.map((e, i) => (
          <li key={i} data-s={shown(e.status)}>
            <StepMark state={shown(e.status)} label={e.status !== "completed" && end === "open" ? "Left open" : undefined} />
            <span className="lc-todo-t">
              {e.title}
              {e.owner && <span className="lc-todo-own">{e.owner}</span>}
            </span>
          </li>
        ))}
      </ol>
      {missed && (
        <p className="lc-todo-foot">
          <b>{missed.title}</b> wasn't reached.
        </p>
      )}
    </section>
  );
}


/** An ask's fields shown as written, in mono and whole, their line breaks kept. */
const CODE_FIELDS = ["Command", "File", "Environment", "Instructions"];

/** A request to do something: what, where, and what leaves this machine. */
/**
  An agent asking: compact, one row with its buttons beside what it wants, so a run of asks doesn't
  fill the thread. What it says and exactly where it runs fold under Details; a high-risk ask
  shows them open, so you read what happens before you hold to allow it.
*/
function Approval({ threadId, it, who }: { threadId: string; it: Extract<Item, { kind: "approval" }>; who: string }) {
  const [always, setAlways] = useState(false);
  const [details, setDetails] = useState(it.risk === "high");
  // An approval answered here stays Liner's card, so it settles into its receipt; one answered
  // before you opened the session is just a line.
  const live = useRef(it.state === "asking");
  const [answered, setAnswered] = useState(false);
  const answer = async (allow: boolean, reason?: string) => {
    try {
      await rpc("approval.answer", { threadId, itemId: it.id, allow, reason: allow ? undefined : reason?.trim() || undefined, always: allow && always });
      setAnswered(true);
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  const shell = it.tool === "Bash" || it.tool === "shell" || it.tool === "execute" || it.tool === PR_TEST_TOOL;
  const icon = shell ? <I.terminal size={16} /> : /push|publish|pr/i.test(it.title) ? <I.push size={16} /> : <I.file size={16} />;
  // Settled elsewhere (the turn ended, or another window answered): the line, not stale buttons.
  if (!live.current || (it.state !== "asking" && !answered))
    return (
      <div className="lc-answered" data-state={it.state}>
        {it.state === "approved" ? <I.check size={14} /> : <I.close size={14} />}
        <span>
          {it.state === "approved" ? `You let ${who}: ` : it.state === "denied" ? `You said no to ` : "No longer waiting: "}
          <b>{it.title}</b>
          {it.reason && <span className="lc-quiet"> · “{it.reason}”</span>}
        </span>
      </div>
    );
  const asking = it.state === "asking" && !answered;
  return (
    <div className="lc-appr-wrap">
      <ApprovalCard
        className="lc-appr"
        title={it.title}
        agent={who}
        description={details ? it.description : undefined}
        icon={icon}
        risk={it.risk}
        fields={(details ? it.fields : []).map((f) => ({
          label: f.label,
          // A command is shown whole: what runs is what you read. So is the environment it runs with (a
          // launch.json server's, a line each), and a mode's instructions, which every session in it is told.
          value:
            f.label === "Environment" ? (
              <code className="lc-ask-cmd">
                {f.value.split("\n").map((l, i) => (
                  <Fragment key={i}>
                    {i > 0 && "\n"}
                    {l.indexOf("=") > 0 ? <EnvLine k={l.slice(0, l.indexOf("="))} v={os.tilde(l.slice(l.indexOf("=") + 1))} /> : l}
                  </Fragment>
                ))}
              </code>
            ) : CODE_FIELDS.includes(f.label) ? (
              <code className="lc-ask-cmd">{os.tilde(f.value)}</code>
            ) : (
              os.tilde(f.value)
            ),
        }))}
        approveLabel={it.risk === "high" ? (/push/i.test(it.title) ? "Hold to push" : "Hold to allow") : shell ? "Run it" : "Allow"}
        denyLabel="Not this"
        onApprove={() => answer(true)}
        onDeny={(reason) => answer(false, reason)}
        approvedText={it.state === "expired" ? "No longer waiting" : shell ? "Running it" : "Allowed"}
        deniedText={`Sent back to ${who}`}
      />
      {asking && (it.description || it.fields.length > 0 || (it.rule && it.risk !== "high")) && (
        <div className="lc-appr-strip">
          {(it.description || it.fields.length > 0) && (
            <button type="button" className="lc-appr-more l-focus" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              <I.chevR size={12} />
              {details ? "Less" : "Details"}
            </button>
          )}
          {it.rule && it.risk !== "high" && (
            <label className="lc-check">
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
              <span>
                Don't ask again for <code className="lc-code">{it.rule === "Edit" ? "edits" : it.rule}</code> this session
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** "Claude Code, Codex, OpenCode and Hermes". */
const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
  An agent asking to add a connection (add-ons, phase 1): what it reaches, where it goes, a password
  field for each key it needs, and Details for its manifest. A key goes from here to the keychain and
  the engine's memory, never into the transcript or the agent's answer. Answered, it's a receipt
  line: Undo removes the connection (its file stays), and Restore brings it back.
*/
function AddonCard({ threadId, it, who }: { threadId: string; it: Ask; who: string }) {
  const a = it.addon as ConnectionAsk;
  const keys = useEngine((x) => x.keys);
  const have = useEngine((x) => x.addons.find((d) => d.id === a.id));
  const [scope, setScope] = useState<"all" | "project">(a.scope ?? "all");
  const [values, setValues] = useState<Record<string, string>>({});
  const [details, setDetails] = useState(false);
  // A key kept for the server it pointed at before isn't sent to a new one: it's typed again.
  const kept = (name: string) => !a.moved && keys.includes(addonKey(a.id, name));
  const missing = a.secrets.filter((k) => !k.optional && !values[k.name]?.trim() && !kept(k.name));
  const answer = async (allow: boolean, reason?: string) => {
    try {
      // The keys first, so the connection has them the moment it's added.
      if (allow)
        for (const k of a.secrets) {
          const v = values[k.name]?.trim();
          if (!v) continue;
          await bridge.keychainSet(`key:${addonKey(a.id, k.name)}`, v);
          await rpc("keys.set", { provider: addonKey(a.id, k.name), key: v });
        }
      await rpc("approval.answer", { threadId, itemId: it.id, allow, reason: allow ? undefined : reason?.trim() || undefined, scope });
      setValues({});
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  const change = (removed: boolean) => void rpc("addons.update", { id: a.id, removed }).catch(fail);
  if (it.state !== "asking") {
    const where = (it.addon?.scope ?? scope) === "project" ? `${a.project.name} only` : "every project";
    const gone = it.state === "approved" && have?.removed;
    return (
      <div className="lc-answered lc-addon-receipt" data-state={gone ? "denied" : it.state} role="status">
        {it.state === "approved" && !gone ? <I.check size={14} /> : <I.close size={14} />}
        <span>
          {it.state === "expired" ? (
            <>
              No longer waiting: add <b>{a.name}</b>
            </>
          ) : it.state === "denied" ? (
            <>
              You said no to adding <b>{a.name}</b>
              {it.reason && <span className="lc-quiet"> · “{it.reason}”</span>}
            </>
          ) : gone ? (
            <>
              You removed <b>{a.name}</b> from every tool. Its file stays in your add-ons, so it can come back.
            </>
          ) : (
            <>
              You let {who} {a.replaces ? "update" : "add"} <b>{a.name}</b> · {where}
              {a.version ? ` · v${a.version}` : ""}
            </>
          )}
        </span>
        {it.state === "approved" && have && (
          <button type="button" className="lc-answered-act l-focus" onClick={() => change(!gone)}>
            {gone ? "Restore" : "Undo"}
          </button>
        )}
      </div>
    );
  }
  const what = a.transport === "http" ? "reaches" : "starts";
  const fields = [
    { label: "Server", value: <code className="lc-addon-mono">{os.tilde(a.server)}</code> },
    ...(a.moved ? [{ label: "Was", value: <code className="lc-addon-mono">{os.tilde(a.moved)}</code> }] : []),
    ...(a.replaces ? [{ label: "Replaces", value: `v${a.replaces}, which stays kept` }] : []),
    { label: "Reaches", value: a.reaches.length ? andList(a.reaches) : "Every agent tool" },
    {
      label: "Where",
      value: <Segmented size="sm" value={scope} onValueChange={(v) => setScope(v)} options={[{ value: "all" as const, label: "Every project" }, { value: "project" as const, label: a.project.name }]} aria-label="Where it applies" />,
    },
    ...a.secrets.map((k) => ({
      label: k.label,
      value: (
        <span className="lc-addon-key">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={k.label}
            placeholder={kept(k.name) ? "Kept from before · type to replace" : a.moved && keys.includes(addonKey(a.id, k.name)) ? "Type it again for the new server" : k.name}
            value={values[k.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [k.name]: e.target.value }))}
          />
          <small>
            <I.lock size={12} />
            {isNative() ? "Sealed in this Mac's keychain, and never put in the chat." : "Kept in Liner Code's memory until it quits, and never put in the chat."}
          </small>
        </span>
      ),
    })),
    ...(details
      ? [
          ...(a.description ? [{ label: "About", value: <span className="lc-addon-wrap">{a.description}</span> }] : []),
          ...(a.env?.length ? [{ label: "Gets", value: <span className="lc-addon-wrap">{a.env.join(", ")}</span> }] : []),
          { label: "Manifest", value: <pre className="lc-ask-cmd lc-addon-json">{a.manifest}</pre> },
        ]
      : []),
  ];
  return (
    <div className="lc-addon">
      <ApprovalCard
        title={`${a.name}, for every agent tool`}
        ask={`${who} asks to ${a.replaces ? "update" : "add"} a connection`}
        agent={who}
        icon={<I.plug size={16} />}
        description={`Settings only: nothing runs inside Liner Code. Each tool ${what} ${a.name}'s server itself${a.secrets.length ? ", with the key below" : ""}.`}
        fields={fields}
        aside={
          <>
            <button type="button" className="lc-appr-more l-focus" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              <I.chevR size={12} />
              {details ? "Less" : "Details"}
            </button>
            <code className="lc-addon-path" title={a.path}>
              {a.path}
            </code>
          </>
        }
        approveLabel="Add it"
        approveDisabled={missing.length > 0}
        approveHint={missing.length ? `Type the ${missing[0].label} first` : undefined}
        denyLabel="Not this"
        onApprove={() => answer(true)}
        onDeny={(reason) => answer(false, reason)}
        approvedText="Added"
        deniedText={`Sent back to ${who}`}
      />
    </div>
  );
}

const PLACE = { dock: "the panel", tab: "the panel, under ··· › Your apps", page: "a page of its own" } as const;
const kbWords = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024} MB` : `${n} KB`);

/**
  A panel an agent asks to add: what it reads, what it can do, what it keeps, its network, where
  it shows, and what addon_check saw, while the panel itself runs on the right as a preview. One
  that reaches the internet names its one host and is held to allow, like a push. A new version
  that wants more than the one in use says what, and asks again. Afterwards a line stays: added,
  updated without asking (same access), said no to, or removed, each with its way back.
*/
function PanelAddonCard({ threadId, it, who }: { threadId: string; it: Ask; who: string }) {
  const a = it.addon as PanelAsk;
  const have = useEngine((x) => x.addons.find((d) => d.id === a.id));
  const [scope, setScope] = useState<"all" | "project">(a.scope ?? "project");
  const [files, setFiles] = useState(false);
  const answer = async (allow: boolean, reason?: string) => {
    try {
      await rpc("approval.answer", { threadId, itemId: it.id, allow, reason: allow ? undefined : reason?.trim() || undefined, scope: a.place === "page" ? "all" : scope });
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  const set = (p: { removed?: boolean; version?: number }) => void rpc("addons.update", { id: a.id, ...p }).catch(fail);
  if (it.state !== "asking") {
    const where = a.place === "page" ? "a page" : (a.scope ?? scope) === "project" ? a.project.name : "every project";
    // An update's line stays what it was; the add-on's own line says it was removed, with Restore.
    const gone = it.state === "approved" && have?.removed && !a.same;
    const back = a.same && a.replaces && have && !have.removed ? (have.version === a.version ? { to: a.replaces, label: `Back to v${a.replaces}` } : have.version === a.replaces ? { to: a.version!, label: `Forward to v${a.version}` } : null) : null;
    return (
      <div className="lc-answered lc-addon-receipt" data-state={gone ? "denied" : it.state} data-same={a.same || undefined} role="status">
        {it.state === "approved" && !gone ? a.same ? <I.push size={14} /> : <I.check size={14} /> : <I.close size={14} />}
        <span>
          {it.state === "expired" ? (
            <>
              No longer waiting: add <b>{a.name}</b>
            </>
          ) : it.state === "denied" ? (
            <>
              You said no to <b>{a.name}</b>
              {it.reason && <span className="lc-quiet"> · “{it.reason}”</span>}
            </>
          ) : gone ? (
            <>
              You removed <b>{a.name}</b> · its files are kept
            </>
          ) : a.same ? (
            <>
              {who} updated <b>{a.name}</b> to v{a.version} · same access, so it didn't ask
            </>
          ) : (
            <>
              You let {who} {a.replaces ? "update" : "add"} <b>{a.name}</b> · {a.place === "dock" ? "a panel" : "an app"} · {where}
              {a.version ? ` · v${a.version}` : ""}
            </>
          )}
        </span>
        {back && (
          <button type="button" className="lc-answered-act l-focus" onClick={() => set({ version: back.to })}>
            {back.label}
          </button>
        )}
        {it.state === "approved" && have && !a.same && (
          <button type="button" className="lc-answered-act l-focus" onClick={() => set({ removed: !gone })}>
            {gone ? "Restore" : "Undo"}
          </button>
        )}
        {it.state === "denied" && (
          <button type="button" className="lc-answered-act l-focus" onClick={() => toComposer(threadId, `Ask me again to add ${a.name}.`)}>
            Ask again
          </button>
        )}
      </div>
    );
  }
  const net = a.access.network;
  const reads = [a.access.files && "Files in this project", a.access.sessions === "this" && (a.place === "tab" ? "This session: its title, changes and commands" : "The session it's beside: its title, changes and commands"), a.access.sessions === "all" && "Your sessions' titles and changes, in every project"].filter(Boolean).join(" · ") || "Nothing";
  const Icon = net ? I.globe : appIcon(a.icon);
  const fields = [
    ...(net ? [{ label: "Network", value: <code className="lc-addon-mono">{net}</code> }] : []),
    { label: "Reads", value: <span className="lc-addon-wrap">{reads}</span> },
    { label: "Can do", value: a.access.composer ? "Put text in the composer, for you to send" : "Nothing but show itself" },
    ...(a.access.ai ? [{ label: "Model", value: "Asks a model you pick when it first asks, billed to that model's account. Just a model: no tools or files" }] : []),
    { label: "Keeps", value: a.access.storage ? `Its own storage, up to ${kbWords(a.access.storage)}` : "Nothing" },
    ...(net ? [] : [{ label: "Network", value: "None" }]),
    ...(a.replaces ? [{ label: "Replaces", value: `v${a.replaces}, which stays kept` }] : []),
    ...(a.place === "page"
      ? [{ label: "Where", value: "Under Add-ons, in the left sidebar" }]
      : [{ label: "Where", value: <Segmented size="sm" value={scope} onValueChange={(v) => setScope(v)} options={[{ value: "project" as const, label: a.project.name }, { value: "all" as const, label: "Every project" }]} aria-label="Where it shows" /> }]),
    { label: "Checked", value: a.checked ?? <span className="lc-quiet">Not checked yet</span> },
    ...(files
      ? [
          { label: "Files", value: <span className="lc-addon-files">{a.files.map((f) => <span key={f.path}><code>{f.path}</code> <small>{f.size < 1000 ? `${f.size} B` : `${Math.round(f.size / 1000)} KB`}</small></span>)}</span> },
          { label: "Manifest", value: <pre className="lc-ask-cmd lc-addon-json">{a.manifest}</pre> },
        ]
      : []),
  ];
  const wider = a.wider?.length ? a.wider : null;
  const title = a.place === "page" ? `${a.name}, a page of its own` : a.place === "tab" ? `${a.name}, a tab beside Chat` : `${a.name}, beside ${scope === "project" ? `every session in ${a.project.name}` : "your sessions"}`;
  return (
    <div className="lc-addon" data-kind="panel" data-net={net ? true : undefined}>
      <ApprovalCard
        title={title}
        ask={wider ? `${a.name} v${a.next} wants more than v${a.replaces} had` : `${who} asks to add ${a.place === "dock" ? "a panel" : "an app"}${net ? " that reaches the internet" : ""}`}
        agent={who}
        icon={<Icon size={16} />}
        description={
          wider
            ? `It would ${wider.map((w) => w.charAt(0).toLowerCase() + w.slice(1)).join(", and ")}, so it asks again. v${a.replaces} stays until you say.`
            : net
              ? `Whatever it reads could leave this Mac through ${net}. It can reach that one, and no other.`
              : `It runs in a sealed frame ${a.place === "page" ? "of its own" : "beside the session"}, never in Liner Code's engine, and gets only what it lists below. The preview in ${PLACE.dock} is the real thing.`
        }
        fields={fields}
        hold={Boolean(net)}
        aside={
          <button type="button" className="lc-appr-more l-focus" aria-expanded={files} onClick={() => setFiles((d) => !d)}>
            <I.chevR size={12} />
            {files ? "Less" : `Its ${plural(a.files.length, "file")}`}
          </button>
        }
        approveLabel={net ? "Hold to allow" : "Add it"}
        denyLabel="Not this"
        onApprove={() => answer(true)}
        onDeny={(reason) => answer(false, reason)}
        approvedText="Added"
        deniedText={`Sent back to ${who}`}
      />
    </div>
  );
}

/** The agent asks you to choose, one question at a time. */
function QuestionCard({ threadId, it, who }: { threadId: string; it: Extract<Item, { kind: "question" }>; who: string }) {
  const [at, setAt] = useState(0);
  // Seed from persisted partial answers so reloads don't lose selections in progress (question-seed.ts, where your own
  // words in a multiple choice come back once, not once for each comma in them).
  const [seed] = useState(() => seedOf(it.questions, it.partial));
  const [picks, setPicks] = useState<Record<string, string[]>>(seed.picks);
  const [other, setOther] = useState<Record<string, string>>(seed.other);
  if (it.state !== "asking")
    return (
      <div className="lc-answered" data-state={it.state === "answered" ? "approved" : "denied"}>
        {it.state === "answered" ? <I.check size={14} /> : <I.close size={14} />}
        <span>
          {it.state === "answered" ? (
            Object.entries(it.answers ?? {}).map(([q, a]) => (
              <span key={q}>
                {q} <b>{a}</b>{" "}
              </span>
            ))
          ) : it.state === "expired" ? (
            <>
              {who} stopped before you answered {it.questions.length === 1 ? `“${it.questions[0].question}”` : plural(it.questions.length, "question")}. Answer in a message to carry on.
            </>
          ) : (
            <>You skipped {plural(it.questions.length, "question")}</>
          )}
        </span>
      </div>
    );
  const q = it.questions[at];
  // Asked with no question in it (Codex can send none): Skip is all there is, and it lets the turn go on.
  if (!q)
    return (
      <div className="lc-answered">
        <span>{who} is waiting on a question it didn't say.</span>
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void rpc("question.answer", { threadId, itemId: it.id }).catch(fail)}>
          Skip
        </button>
      </div>
    );
  // A question with no predefined options defaults to free-text; otherwise require an explicit pick instead of silently choosing option 0.
  const selectedOf = (x: (typeof it.questions)[number], map = picks): string[] => selectedIn(x, map);
  const answerOf = (x: (typeof it.questions)[number], map = picks, custom = other): string => answerIn(x, map, custom);
  const persistPartial = (nextPicks: Record<string, string[]>, nextOther: Record<string, string>) => {
    const partial: Record<string, string> = {};
    for (const x of it.questions) {
      const val = answerOf(x, nextPicks, nextOther);
      if (val) partial[x.question] = val;
    }
    void rpc("question.partial", { threadId, itemId: it.id, answers: partial }).catch(() => {});
  };
  const toggleChoice = (label: string) => {
    const cur = selectedOf(q);
    const nextList = q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label];
    const nextPicks = { ...picks, [q.question]: nextList };
    setPicks(nextPicks);
    persistPartial(nextPicks, other);
  };
  const chosenList = selectedOf(q);
  const currentAnswer = answerOf(q);
  const last = at === it.questions.length - 1;
  const allAnswered = it.questions.every((x) => Boolean(answerOf(x)));
  const answers = () => Object.fromEntries(it.questions.map((x) => [x.question, answerOf(x)]));
  const submit = () => rpc("question.answer", { threadId, itemId: it.id, answers: answers() }).catch(fail);
  return (
    <section className="lc-q lc-frame" aria-label={`${who} asks: ${q.question}`}>
      <div className="lc-fcard">
        <div className="lc-q-top">
          <span className="lc-dots" aria-hidden>
            {it.questions.map((_, i) => (
              <i key={i} data-on={i <= at || undefined} />
            ))}
          </span>
          Question {at + 1} of {it.questions.length}
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void rpc("question.answer", { threadId, itemId: it.id }).catch(fail)}>
            {it.questions.length > 1 ? "Skip all" : "Skip"}
          </button>
        </div>
        <div className="lc-q-title">
          <b>{q.question}</b>
          {q.header && <p className="lc-quiet">{q.header}</p>}
          {q.multiSelect && <p className="lc-quiet">Choose one or more</p>}
        </div>
        <div className="lc-opts" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
          {[...q.options, { label: OTHER, description: "Write your own answer." }].map((o) => {
            const on = chosenList.includes(o.label);
            return (
              <div key={o.label} className="lc-opt" role={q.multiSelect ? "checkbox" : "radio"} aria-checked={on} tabIndex={0} data-on={on || undefined} onClick={() => toggleChoice(o.label)} onKeyDown={(e) => {
                // Its own keys only: space and Enter in the field inside it are letters, and space here would scroll the thread.
                if (e.target !== e.currentTarget || (e.key !== " " && e.key !== "Enter")) return;
                e.preventDefault();
                toggleChoice(o.label);
              }}>
                <span className="lc-radio" data-on={on || undefined} data-multi={q.multiSelect || undefined} />
                <span>
                  <b>
                    {o.label}
                    {"suggested" in o && o.suggested && <Badge tone="accent">{who} suggests</Badge>}
                  </b>
                  {o.description && <small>{o.description}</small>}
                  {o.label === OTHER && on && (
                    <textarea
                      className="lc-else"
                      autoFocus={chosenList.includes(OTHER)}
                      aria-label="Your own answer"
                      placeholder="Say what you would like instead"
                      value={other[q.question] ?? ""}
                      onChange={(e) => {
                        const nextOther = { ...other, [q.question]: e.target.value };
                        setOther(nextOther);
                        persistPartial(picks, nextOther);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div className="lc-ask-foot">
          <span className="lc-quiet">Nothing runs until you answer</span>
          <span className="lc-grow" />
          {at > 0 && (
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAt(at - 1)}>
              Back
            </button>
          )}
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!currentAnswer || (last && !allAnswered)} title={!currentAnswer ? (chosenList.includes(OTHER) ? "Write your answer first" : "Pick an option first") : undefined} onClick={() => (last ? void submit() : setAt(at + 1))}>
            {last ? "Send answer" : "Next question"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Steps from a plan's markdown: numbered or bulleted lines, with files they name. */
function stepsOf(plan: string) {
  const lines = plan.split("\n").map((l) => l.trim());
  const steps = lines.filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l)).map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, ""));
  return steps.map((s) => {
    const files = [...s.matchAll(/`([^`]+\.[\w]+)`|(?:—|-)\s*([\w./-]+\.[a-z]{1,5})\b/g)].map((m) => m[1] ?? m[2]);
    return { text: s.replace(/\*\*/g, ""), files };
  });
}

/** What a turn of work has cost lately, for a plan's estimate. Asked once a session. */
let pace: Promise<{ tokens: number; cost: number } | null> | null = null;
const paceOf = () =>
  (pace ??= rpc("usage.summary", { days: 30 })
    .then((u) => (u.totals.turns ? { tokens: u.totals.tokens / u.totals.turns, cost: u.totals.perTurn } : null))
    .catch(() => null));

const RUN_MODES = [
  { id: "helpers", label: "Its model, with cheap helpers", note: "Explorers and the test runner on Haiku" },
  { id: "single", label: "Its model alone", note: "No subagents" },
] as const;

/** `id` stays with a step through edits and moves, so its field keeps focus while you type. */
type Step = { id: string; text: string; files: string[]; who?: string };
const FIRST_STEPS = 6;
/** A step's words with `code` in them set as code. */
const codeIn = (text: string) =>
  text.split(/`([^`]+)`/).map((part, i) =>
    i % 2 ? (
      <code key={i} className="lc-code">
        {part}
      </code>
    ) : (
      part
    ),
  );
/** A step handed to someone: "… — @Herald" or "… (@Herald)". */
const ownerOf = (text: string, names: string[]) => {
  const m = /(?:—|-|\()\s*@([\w-]+)\)?\s*$/.exec(text);
  const who = m ? names.find((n) => n.toLowerCase() === m[1].toLowerCase()) : undefined;
  return { who, text: m && who ? text.slice(0, m.index).trim() : text };
};
/** A step's words without the files it ends on ("… — src/a.js" or "… — `a.js`, `b.js`"), which show apart. */
const unfiled = (text: string) => text.replace(/\s+(?:—|-)\s*(?:`[^`]+\.\w+`|[\w./-]+\.[a-z]{1,5})(?:,\s*(?:`[^`]+\.\w+`|[\w./-]+\.[a-z]{1,5}))*\s*$/, "");
const planOf = (title: string, steps: Step[], coder: string) => `${title}\n\n${steps.map((s, i) => `${i + 1}. ${s.text}${s.files.length ? ` — \`${s.files.join("`, `")}\`` : ""}${s.who && s.who !== coder ? ` — @${s.who}` : ""}`).join("\n")}`;

/** A plan to approve: who does each step, what it should cost, and one press to start. Edit steps reorders, drops or hands a step to someone else. */
function Proposal({ threadId, it, who }: { threadId: string; it: Extract<Item, { kind: "proposal" }>; who: string }) {
  const thread = useEngine((s) => threadOf(s, threadId));
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const [note, setNote] = useState("");
  const coder = agentOf(thread?.agent, agents, providers);
  // Steps an older plan handed to someone else still show who; new plans are all the lead's.
  const team = [coder];
  const names = team.map((a) => a.name);
  const parsed = useMemo(() => stepsOf(it.plan).map((s, i) => ({ ...s, id: `s${i}`, text: unfiled(ownerOf(s.text, names).text), who: ownerOf(s.text, names).who })), [it.plan, names.join()]);
  const [edit, setEdit] = useState<Step[] | null>(null);
  const steps: Step[] = edit ?? parsed;
  // A long plan shows its first steps and folds the rest; editing shows them all.
  const [all, setAll] = useState(false);
  const folds = !edit && steps.length > FIRST_STEPS + 1;
  const files = new Set(steps.flatMap((s) => s.files));
  const [est, setEst] = useState<{ tokens: number; cost: number } | null>(null);
  useEffect(() => {
    let live = true;
    void paceOf().then((p) => live && setEst(p));
    return () => {
      live = false;
    };
  }, []);
  const n = Math.max(1, steps.length);
  // How the lead runs is an agent's own setting; a bare model in Claude Code always brings its helpers.
  const claude = onClaude(coder.model) && !coder.id.startsWith("@");
  const mode = RUN_MODES.find((m) => m.id === (coder.runMode === "single" ? "single" : "helpers")) ?? RUN_MODES[0];
  const setMode = (runMode: (typeof RUN_MODES)[number]["id"]) => void rpc("agents.save", { agents: agents.map((a) => (a.id === coder.id ? { ...a, runMode } : a)) }).catch(fail);
  const answer = (approve: boolean) => rpc("proposal.answer", { threadId, itemId: it.id, approve, note: approve ? undefined : note.trim(), plan: approve && edit ? planOf(it.title, edit, coder.name) : undefined }).catch(fail);
  const move = (i: number, d: number) => setEdit((e) => {
    const list = [...(e ?? parsed)];
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
  // A plan nobody had to approve (a hard job, planned first and built straight on): a quiet line that opens to the plan.
  if (it.auto)
    return (
      <details className="lc-planned">
        <summary className="l-focus">
          <span>
            <b>Planned first</b> · {it.title} · {plural(steps.length || 1, "step")}
          </span>
          <Chev className="lc-row-chev" />
        </summary>
        <StreamedMarkdown className="lc-md lc-planned-md" text={it.plan} animate={false} />
      </details>
    );
  if (it.state !== "asking" && it.state !== "expired")
    return (
      <div className="lc-answered" data-state={it.state === "approved" ? "approved" : "denied"}>
        {it.state === "approved" ? <I.check size={14} /> : <I.edit size={14} />}
        <span>
          {it.state === "approved" ? "You approved the plan: " : "You asked for changes: "}
          <b>{it.state === "approved" ? it.title : it.note}</b>
        </span>
      </div>
    );
  return (
    <section className="lc-plan lc-frame" aria-label={`${who}'s plan`}>
      <div className="lc-fcard">
        <div className="lc-plan-top">
          <span>
            <small>{who}'s plan</small>
            <b>{it.title}</b>
          </span>
          <Badge tone="neutral">
            {plural(steps.length || 1, "step")}
            {files.size ? ` · ${plural(files.size, "file")}` : ""}
          </Badge>
        </div>
        {steps.length ? (
          <>
            <ol className="lc-psteps" data-edit={edit ? true : undefined}>
              {(folds && !all ? steps.slice(0, FIRST_STEPS) : steps).map((s, i) => {
                const owner = team.find((a) => a.name === s.who) ?? coder;
                // Files the step doesn't already name in its words.
                const extra = s.files.filter((f) => !s.text.includes(f)).map((f) => f.split("/").pop());
                return (
                  <li key={s.id}>
                    <span className="lc-pstep-n l-num">{i + 1}</span>
                    {edit ? (
                      <input className="lc-pstep-edit" value={s.text} aria-label={`Step ${i + 1}`} onChange={(e) => setEdit(steps.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
                    ) : (
                      <span className="lc-pstep-t">
                        {codeIn(s.text)}
                        {extra.length > 0 && (
                          <>
                            {" "}
                            <span className="lc-pstep-files">· {extra.join(", ")}</span>
                          </>
                        )}
                      </span>
                    )}
                    {edit ? (
                      <span className="lc-pstep-acts">
                        {team.length > 1 && (
                          <select className="lc-pstep-who" value={owner.name} aria-label={`Who does step ${i + 1}`} onChange={(e) => setEdit(steps.map((x, k) => (k === i ? { ...x, who: e.target.value } : x)))}>
                            {team.map((a) => (
                              <option key={a.id} value={a.name}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <button type="button" className="lc-ib l-focus" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                          <I.chevU size={12} />
                        </button>
                        <button type="button" className="lc-ib l-focus" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                          <I.chevD size={12} />
                        </button>
                        <button type="button" className="lc-ib l-focus" aria-label="Drop this step" onClick={() => setEdit(steps.filter((_, k) => k !== i))}>
                          <I.close size={14} />
                        </button>
                      </span>
                    ) : owner.id !== coder.id ? (
                      // Only a step handed to someone else says who; the rest are the coder's, named once below.
                      <span className="lc-pstep-who" title={`${owner.name} · ${modelLabel(owner.model, providers)}`}>
                        {owner.name}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {folds && (
              <button type="button" className="lc-plan-more l-focus" aria-expanded={all} onClick={() => setAll(!all)}>
                {all ? "Show fewer steps" : `Show ${plural(steps.length - FIRST_STEPS, "more step")}`}
                <Chev className="lc-trail-chev" />
              </button>
            )}
          </>
        ) : (
          <StreamedMarkdown className="lc-md" text={it.plan} animate={false} />
        )}
        {/* Who builds it and on what, and what it should cost, on one line. */}
        <div className="lc-plan-meta">
          <span>{coder.id.startsWith("@") ? "Built by" : `${coder.name} builds it on`}</span>
          {claude ? (
            <Pop label={`How ${coder.name} runs`} width={290} triggerClass="lc-btn lc-plan-modeb" trigger={<>{mode.id === "helpers" ? `${modelLabel(thread?.model ?? coder.model, providers)}, with helpers` : `${modelLabel(thread?.model ?? coder.model, providers)} alone`}<I.chevD size={12} /></>}>
              {(close) => (
                <>
                  {RUN_MODES.map((m) => (
                    <PickRow key={m.id} title={m.label} note={m.note} on={m.id === mode.id} onPick={() => (setMode(m.id), close())} />
                  ))}
                </>
              )}
            </Pop>
          ) : (
            <b>{modelLabel(thread?.model ?? coder.model, providers)}{onClaude(coder.model) ? ", with helpers" : ""}</b>
          )}
          {est && (
            <span className="l-num" title="From what your turns cost over the last 30 days">
              · about {est.cost * n >= 0.005 ? `$${(est.cost * n).toFixed(2)}, ` : ""}
              {Math.max(1, Math.round(n * 1.5))} min, ~{compactN(est.tokens * n)} tokens
            </span>
          )}
        </div>
        {it.state === "expired" ? (
          <p className="lc-notice">This plan was waiting when the session stopped. Ask again to get a fresh one.</p>
        ) : (
          <>
            <input className="lc-input" aria-label={`Tell ${who} what to change`} placeholder={`Or tell ${who} what to change`} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && note.trim() && void answer(false)} />
            <div className="lc-ask-foot">
              <span className="lc-quiet">{edit ? "Your edits go to the plan as you approve it" : "Nothing runs until you approve"}</span>
              <span className="lc-grow" />
              {note.trim() ? (
                <button type="button" className="lc-btn" data-kind="plain" onClick={() => void answer(false)}>
                  Send changes
                </button>
              ) : edit || steps.length > 0 ? (
                <button type="button" className="lc-btn" data-kind="plain" onClick={() => setEdit(edit ? null : parsed)}>
                  {edit ? "Undo edits" : "Edit steps"}
                </button>
              ) : null}
              <button type="button" className="lc-btn" data-kind="primary" disabled={edit !== null && edit.length === 0} onClick={() => void answer(true)}>
                Approve and start
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
const compactN = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);

const nameOf = (p: string) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
/** A path with Windows' separators turned to git's. */
const slashed = (p: string) => p.replace(/\\/g, "/");

/**
  One call at a time for a card's buttons (Try again, Carry on, Resume): while one is out they are disabled and a second
  press does nothing, so two clicks never send it twice. A call that went through keeps them so until the session moves on
  (`moved`: it no longer stands as the card says); one that failed lets them be pressed again.
*/
function useOneCall(moved: boolean): [boolean, (call: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  const going = useRef(false);
  useEffect(() => {
    if (moved) (going.current = false), setBusy(false);
  }, [moved]);
  const send = (call: () => Promise<unknown>) => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    void call().catch((e) => ((going.current = false), setBusy(false), fail(e)));
  };
  return [busy, send];
}

/**
  A failure the provider gave a reason for: it refused the request, or is overloaded or down. The error reads as any
  other, then who and why in plain words. A refusal stops there: a refused request isn't sent to another tool, so it
  has no buttons (the engine refuses thread.carryOn after one too). An overload offers Try again, then Carry on with
  another tool's model, the same pick a usage limit offers (never by itself), while it's how the session stopped.
*/
function ErrorCard({ threadId, it }: { threadId: string; it: Extract<Item, { kind: "error" }> }) {
  const status = useEngine((s) => threadOf(s, threadId)?.status);
  const turns = useEngine((s) => threadOf(s, threadId)?.turns);
  const providers = useEngine((s) => s.providers);
  const p = providers.find((x) => x.id === it.provider);
  // Who refused or is overloaded, by name: the company behind a tool's own sign-in, else the tool or endpoint as listed.
  const family = it.provider?.split(".")[0];
  const named = p?.label ?? it.provider ?? "The agent";
  const who = p?.endpoint ? named : family === "claude" ? "Claude" : family === "codex" ? "Codex" : named;
  const vendor = p?.endpoint ? named : family === "claude" ? "Anthropic" : family === "codex" ? "OpenAI" : named;
  const again = it.why === "overloaded";
  const current = again && status === "error" && turns === it.turn;
  const [busy, send] = useOneCall(status !== "error");
  return (
    <>
      <p className="lc-error" role="alert">
        {it.message}
      </p>
      <div className="lc-ask-foot">
        <span className="lc-quiet">{again ? `${vendor} is overloaded right now` : `${who} refused this request`}</span>
        <span className="lc-grow" />
        {current && (
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" title="Send it to the same model again" disabled={busy} onClick={() => send(() => rpc("thread.tryAgain", { id: threadId }))}>
            Try again
          </button>
        )}
        {current && it.fallback && (
          <button type="button" className="lc-btn" data-kind={again ? "plain" : "primary"} data-size="sm" title="Another tool takes over, with the conversation so far" disabled={busy} onClick={() => send(() => rpc("thread.carryOn", { id: threadId, model: it.fallback }))}>
            Carry on with {modelLabel(it.fallback, providers)}
          </button>
        )}
      </div>
    </>
  );
}

/** The tool's plan ran out mid-turn. It says which window and when it reopens; Resume carries on. */
function LimitCard({ threadId, it }: { threadId: string; it: Extract<Item, { kind: "limit" }> }) {
  const status = useEngine((s) => threadOf(s, threadId)?.status);
  const providers = useEngine((s) => s.providers);
  const resumeAtReset = useEngine((s) => Boolean(s.settings.resumeAtReset));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!it.until) return;
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, [it.until]);
  const label = providers.find((p) => p.id === it.provider)?.label ?? it.provider;
  const open = !it.until || it.until <= now;
  const minsLeft = it.until && !open ? Math.max(1, Math.ceil((it.until - now) / 60_000)) : 0;
  const current = status === "limited";
  const [busy, send] = useOneCall(!current);
  return (
    <div className="lc-limit" data-current={current || undefined}>
      <StateMark state="limit" label={MARK_WORD.limit} />
      <span className="lc-limit-t">
        <b>{label} hit its usage limit</b>
        <small>
          {it.message}
          {it.until ? (open ? " It has reset." : ` It resets ${clock(it.until)} (in ${minsLeft}m).`) : ""}
        </small>
      </span>
      {current && it.until && !open && (
        <button
          type="button"
          className="lc-btn"
          data-kind="ghost"
          data-size="sm"
          aria-pressed={resumeAtReset}
          title="Automatically carry on once the usage window reopens"
          onClick={() => void rpc("settings.save", { resumeAtReset: !resumeAtReset }).catch((e: Error) => toast.error(e.message))}
        >
          {resumeAtReset ? "Auto-resume on" : "Auto-resume"}
        </button>
      )}
      {current && it.fallback && (
        <button type="button" className="lc-btn" data-kind={open ? "plain" : "primary"} data-size="sm" title="Another tool takes over, with the conversation so far" disabled={busy} onClick={() => send(() => rpc("thread.carryOn", { id: threadId, model: it.fallback }))}>
          Carry on with {modelLabel(it.fallback, providers)}
        </button>
      )}
      {current && (
        <button type="button" className="lc-btn" data-kind={open || !it.fallback ? "primary" : "plain"} data-size="sm" title={open ? "Carry on where it stopped" : "It may still be limited; try anyway"} disabled={busy} onClick={() => send(() => rpc("thread.send", { id: threadId, text: "Continue where you left off." }))}>
          Resume
        </button>
      )}
    </div>
  );
}

/**
  A message you sent. Edit from here takes the conversation back to just before it: the turns
  after come off, and with Revert files too, so do their changes. Then the edited message goes.
*/
/** A chip of what a message Liner wrote is about, by its kind. */
const SHOWN_ICON: Record<ShownChip["kind"], (p: { size?: number }) => ReactNode> = { check: I.shield, frame: I.page, layer: I.box, compare: I.contrast, build: I.code };

function You({ threadId, it, fresh, onReview }: { threadId: string; it: Extract<Item, { kind: "user" }>; fresh: boolean; onReview?: (checkpointId: string, path?: string) => void }) {
  const thread = useEngine((s) => threadOf(s, threadId));
  const running = thread?.status === "running";
  // Only the checkpoints: the whole timeline would redraw every message you sent with each streamed word.
  const cps = useItemsWhere(threadId, isCheckpoint) as Checkpoint[];
  const [edit, setEdit] = useState<string | null>(null);
  const [rewinding, setRewinding] = useState(false);
  const [busy, setBusy] = useState(false);
  // A message Liner wrote for you (Liner Design's "Fix 1 check"): what the agent was told, folded under it.
  const [told, setTold] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const later = cps.filter((x) => x.turn >= it.turn && !x.reverted);
  // The files show above the words, so the line that tells the agent where they are doesn't show again.
  const typed = it.files?.length ? it.text.replace(/\n*I attached: [^\n]*$/, "") : it.text;
  // A design comment shows only your words; edited, it keeps what it's about.
  const { said, rest, title, part } = designPart(typed);
  const files = new Set(later.flatMap((c) => c.files.map((f) => f.path))).size;
  const committed = later.find((c) => c.committed);
  useEffect(() => {
    if (edit === null) return;
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [edit === null]);
  const go = async (revertFiles: boolean, force = false) => {
    const text = (edit ?? "").trim();
    if (!text) return;
    setBusy(true);
    let wound = false;
    try {
      const r = await rpc("thread.rewind", { threadId, itemId: it.id, files: revertFiles, force });
      wound = true;
      await rpc("thread.send", { id: threadId, text: text + rest });
      toast(`Went back to turn ${r.turn}`, { description: revertFiles && r.files ? `${plural(r.files, "file")} back as they were` : "The files stay as they are" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Gone back but not sent: this message came off with the turns, so your words go to the composer.
      if (wound) toComposer(threadId, text);
      // A file changed after those turns: putting them back would lose that, so it's yours to say.
      if (revertFiles && !force && /^Changed after that turn:/.test(message))
        toast.error("Nothing was put back", { description: message, action: { label: "Go back anyway", onClick: () => void go(true, true) }, duration: 10000 });
      else fail(e);
      setBusy(false);
    }
  };
  const rewindOnly = async (revertFiles: boolean, force = false) => {
    setBusy(true);
    try {
      const r = await rpc("thread.rewind", { threadId, itemId: it.id, files: revertFiles, force });
      setRewinding(false);
      toast(`Undid back to turn ${r.turn}`, { description: revertFiles && r.files ? `${plural(r.files, "file")} back as they were` : "The files stay as they are" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (revertFiles && !force && /^Changed after that turn:/.test(message))
        toast.error("Nothing was put back", { description: message, action: { label: "Go back anyway", onClick: () => void rewindOnly(true, true) }, duration: 10000 });
      else fail(e);
    } finally {
      setBusy(false);
    }
  };
  const forkHere = async () => {
    if (!thread) return;
    setBusy(true);
    try {
      const forked = await rpc("thread.create", { projectId: thread.projectId, forkOf: thread.id, forkTurn: it.turn });
      toast.success(`Forked from turn ${it.turn}`);
      window.dispatchEvent(new CustomEvent("lc:open-session", { detail: { id: forked.id } }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (edit !== null)
    return (
      <div className="lc-you lc-you-edit">
        <textarea
          ref={field}
          className="lc-you-field"
          value={edit}
          aria-label="Edit your message"
          onChange={(e) => {
            setEdit(e.target.value);
            e.target.style.height = "0px";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 260)}px`;
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape") setEdit(null);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void go(false);
          }}
        />
        <div className="lc-you-acts">
          <span className="lc-quiet">Turns from here come off{files ? `; ${plural(files, "file")} changed since` : ""}</span>
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={busy} onClick={() => setEdit(null)}>
            Cancel
          </button>
          {files > 0 && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy || Boolean(committed) || !edit.trim()} title={committed ? `Turn ${committed.turn} is committed; revert the commit first` : "Put the files back as they were before this message"} onClick={() => void go(true)}>
              Revert files too
            </button>
          )}
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy || !edit.trim()} onClick={() => void go(false)}>
            {files ? "Revert and keep changes" : "Send from here"}
          </button>
        </div>
      </div>
    );
  return (
    <div className="lc-you" data-fresh={fresh || undefined}>
      {it.steer && <span className="lc-you-tag">Steered</span>}
      {it.anchor && (
        <button type="button" className="lc-you-anchor l-focus" disabled={!onReview} onClick={() => onReview?.("all", it.anchor!.file)} title={onReview ? "Show these lines" : undefined}>
          <I.comment size={12} />
          <span>
            {it.anchor.file.split("/").pop()}, {it.anchor.endLine && it.anchor.endLine !== it.anchor.line ? `lines ${it.anchor.line}–${it.anchor.endLine}` : `line ${it.anchor.line}`}
          </span>
        </button>
      )}
      {part && (
        <span className="lc-you-anchor lc-you-part" title={`About ${part} in “${title}”`}>
          <I.comment size={12} />
          <span>
            {part} · {title}
          </span>
        </span>
      )}
      {it.files && it.files.length > 0 && <Attachments files={it.files} />}
      {it.shown ? (
        <>
          <p className="lc-you-shown">
            {it.shown.chips?.map((c, i) => {
              const Icon = SHOWN_ICON[c.kind];
              return (
                <span key={i} className="lc-you-sc" data-kind={c.kind}>
                  <Icon size={12} />
                  {c.label}
                </span>
              );
            })}
            {it.shown.text}
          </p>
          {/* Words you typed as they went (a message with a selection) have nothing more to unfold. */}
          {typed.trim() !== it.shown.text.trim() && (
            <>
              <button type="button" className="lc-you-told l-focus" aria-expanded={told} onClick={() => setTold(!told)}>
                What the agent was told
                <I.chevR size={12} />
              </button>
              {told && <pre className="lc-you-toldbox">{typed}</pre>}
            </>
          )}
        </>
      ) : (
        said && <p>{said}</p>
      )}
      {/* The files that changed since the last turn, which the agent was told of ahead of your words (SentWith.tsx). */}
      {it.edits && it.edits.length > 0 && <SentWith edits={it.edits} />}
      {rewinding && (
        <div className="lc-you-acts">
          <span className="lc-quiet">Undo from turn {it.turn} without resending{files ? `; ${plural(files, "file")} changed since` : ""}</span>
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={busy} onClick={() => setRewinding(false)}>
            Cancel
          </button>
          {files > 0 && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy || Boolean(committed)} title={committed ? `Turn ${committed.turn} is committed; revert the commit first` : "Put the files back as they were before this message"} onClick={() => void rewindOnly(true)}>
              Revert files too
            </button>
          )}
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy} onClick={() => void rewindOnly(false)}>
            {files ? "Keep file changes" : "Undo to here"}
          </button>
        </div>
      )}
      {!it.steer && it.turn > 0 && (
        <span className="lc-you-more">
          <button type="button" className="lc-you-btn l-focus" disabled={running || busy} title={running ? "Stop the turn to edit from here" : "Edit this message and go back to it"} onClick={() => (setRewinding(false), setEdit(part ? said : it.text))}>
            <I.edit size={12} />
            Edit from here
          </button>
          <button type="button" className="lc-you-btn l-focus" disabled={running || busy} title={running ? "Stop the turn to undo to here" : "Rewind back to before this message without resending"} onClick={() => setRewinding((x) => !x)}>
            <I.undo size={12} />
            Undo to here
          </button>
          <button type="button" className="lc-you-btn l-focus" disabled={busy} title="Start a new forked session from this turn" onClick={() => void forkHere()}>
            <I.branch size={12} />
            Fork from here
          </button>
          <button type="button" className="lc-you-btn l-focus" title="Copy" aria-label="Copy the message" onClick={() => void navigator.clipboard?.writeText(it.shown?.text || said).then(() => toast("Copied"), fail)}>
            <I.copy size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

/*
  What you attached to a message: pictures as thumbnails that open larger, other files as chips
  with their names (T3 Code: UserMessageContextChips.tsx, ExpandedImageDialog.tsx,
  media/AttachmentImage.tsx). The engine keeps them in its attachments folder and reads them
  back only from there.
*/
const PICTURE = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i;
/** Saved as "<time>-name.png"; the name is what you attached. */
const attachedName = (path: string) => nameOf(path).replace(/^[0-9a-z]{6,10}-/, "");
const pictures = new Map<string, Promise<string>>();
const pictureOf = (path: string) => {
  let p = pictures.get(path);
  if (!p) {
    p = rpc("attachment.read", { path }).then((r) => `data:${r.mime};base64,${r.data}`);
    // A failed read is asked again next time, not remembered.
    p.catch(() => pictures.delete(path));
    pictures.set(path, p);
  }
  return p;
};
function usePicture(path: string) {
  const [state, setState] = useState<{ src?: string; failed?: boolean }>({});
  useEffect(() => {
    let live = true;
    pictureOf(path).then(
      (src) => live && setState({ src }),
      () => live && setState({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}

function Attachments({ files }: { files: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = files.filter((f) => PICTURE.test(f));
  return (
    <div className="lc-you-files">
      {files.map((f) =>
        PICTURE.test(f) ? (
          <Thumb key={f} path={f} onOpen={() => setOpen(f)} />
        ) : (
          <button key={f} type="button" className="lc-you-chip l-focus" title={`${attachedName(f)}: show in ${os.fileManager}`} onClick={() => bridge.reveal(f)}>
            <I.file size={12} />
            <span>{attachedName(f)}</span>
          </button>
        ),
      )}
      {/* On the page itself, so the message's own styles (its bubble) don't reach into the dialog. */}
      {open && createPortal(<Picture path={open} all={shown} onPath={setOpen} onClose={() => setOpen(null)} />, document.body)}
    </div>
  );
}

function Thumb({ path, onOpen }: { path: string; onOpen: () => void }) {
  const { src, failed } = usePicture(path);
  if (failed)
    return (
      <span className="lc-you-chip" data-gone title="This picture isn't there any more">
        <I.file size={12} />
        <span>{attachedName(path)}</span>
      </span>
    );
  return (
    <button type="button" className="lc-you-thumb l-focus" aria-label={`Open ${attachedName(path)}`} title={attachedName(path)} onClick={onOpen} disabled={!src}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="lc-you-thumb-wait" aria-hidden />}
    </button>
  );
}

/** A picture you attached, as large as the window lets it be; ← and → go through the message's others. */
function Picture({ path, all, onPath, onClose }: { path: string; all: string[]; onPath: (p: string) => void; onClose: () => void }) {
  const { src, failed } = usePicture(path);
  const at = all.indexOf(path);
  useEffect(() => {
    if (all.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      onPath(all[(at + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, all, onPath]);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={attachedName(path)}
      description={all.length > 1 ? `${at + 1} of ${all.length}` : undefined}
      size="lg"
      className="lc-picture"
      actions={
        <>
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => bridge.reveal(path)}>
            Show in {os.fileManager}
          </button>
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ink" data-size="sm" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="lc-picture-frame">{src ? <img src={src} alt={attachedName(path)} /> : <span className="lc-quiet">{failed ? "This picture isn't there any more." : "Opening…"}</span>}</div>
    </Dialog>
  );
}

/** "Asked Opus 5.5 to plan this, a change across sync/ and editor/": Sonnet escalating, with Opus's plan inside. How it stands is the state mark, bare. */
function Escalation({ it, providers }: { it: Tool; providers: ProviderInfo[] }) {
  const [open, setOpen] = useState(false);
  const what = it.title.replace(/^Opus:?\s*/, "");
  const opusModel = providers.find((p) => p.id === "claude")?.models.find((m) => m.id.includes("opus"));
  const opus = opusModel?.label ?? "Opus";
  const state = it.status === "running" ? "working" : it.status === "failed" ? "problem" : "done";
  return (
    <div className="lc-esc" data-open={open || undefined}>
      <button type="button" className="lc-esc-h l-focus" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!it.output}>
        <StateMark state={state} brand={markOf(`claude:${opusModel?.id ?? "opus"}`)} label={MARK_WORD[state]} />
        <span>
          {it.status === "running" ? `Asking ${opus} to plan this` : `Asked ${opus} to plan this`}
          {what && <span className="lc-quiet">, {what.charAt(0).toLowerCase() + what.slice(1)}</span>}
        </span>
        <span className="lc-grow" />
        <span className="lc-mono lc-quiet">{it.status === "running" ? "" : duration(it.seconds)}</span>
      </button>
      {open && it.output && (
        <div className="lc-esc-b">
          <StreamedMarkdown className="lc-md" text={it.output} animate={false} />
        </div>
      )}
    </div>
  );
}

/**
  The turn's last line: what changed (all its parts' changes as one, when `all`; each file's row opens
  Changes on it, and the one Changes shows is tinted) and the Reviewer's verdict, side by side. Its findings open under the line; blockers open
  by themselves, notes wait for a press.
*/
function TurnFoot({ cp, all, review, providers, onReview, reviewing }: { cp?: Checkpoint; all?: boolean; review?: Review; providers: ProviderInfo[]; onReview?: (checkpointId: string, path?: string) => void; reviewing?: { id: string; path?: string } | null }) {
  const where = useContext(ReviewIn);
  const blocked = review?.status === "blocked";
  const [open, setOpen] = useState(blocked);
  useEffect(() => {
    if (blocked) setOpen(true);
  }, [blocked]);
  // A turn of several parts opens as "all". The file Changes shows from here, if any.
  const here = cp && reviewing && reviewing.id === (all ? "all" : cp.id) ? reviewing.path : undefined;
  const has = Boolean(review && (review.findings.length || review.summary));
  const blockers = review?.findings.filter((f) => f.severity === "blocking").length ?? 0;
  const verdict = !review ? "" : review.status === "running" ? "reading" : review.status === "passed" ? (review.findings.length ? `passed, ${plural(review.findings.length, "note")}` : "passed") : review.status === "blocked" ? `blocked, ${plural(blockers || review.findings.length, "blocker")}` : "gave no verdict";
  return (
    <div className="lc-foot">
      <div className="lc-foot-row">
        {cp &&
          (cp.reverted ? (
            <span className="lc-foot-chip" data-tone="quiet">
              {plural(cp.files.length, "file")} · undone
            </span>
          ) : cp.committed ? (
            <span className="lc-foot-chip" data-tone="quiet">
              Committed {cp.committed}
            </span>
          ) : (
            <section className="lc-ledger" aria-label="What this turn changed">
              <div className="lc-ledger-h">
                <b>{plural(cp.files.length, "file")} changed</b>
                <Lines {...sumLines(cp.files)} />
              </div>
              {cp.files.slice(0, 6).map((f) => {
                // Five squares: the share of the file's changed lines that were added, and removed.
                const sum = f.added + f.removed;
                const plus = sum ? Math.max(f.added ? 1 : 0, Math.round((f.added / sum) * 5)) : 0;
                const minus = sum ? Math.min(5 - plus, Math.max(f.removed ? 1 : 0, 5 - plus)) : 0;
                const inside = (
                  <>
                    <span className="lc-mono lc-ledger-p">{f.path}</span>
                    {f.status === "added" && <span className="lc-ledger-new">new</span>}
                    <span className="lc-grow" />
                    <Lines added={f.added} removed={f.removed} />
                    <span className="lc-ledger-sq" aria-hidden>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <i key={i} data-k={i < plus ? "a" : i < plus + minus ? "d" : undefined} />
                      ))}
                    </span>
                  </>
                );
                // Nowhere to open it (a Security scan): a plain row, with nothing to press.
                return onReview ? (
                  <button key={f.path} type="button" className="lc-ledger-r l-focus" aria-label={`Open ${f.path} ${where}`} aria-current={here === f.path || undefined} data-here={here === f.path || undefined} onClick={() => onReview(all ? "all" : cp.id, f.path)}>
                    {inside}
                  </button>
                ) : (
                  <div key={f.path} className="lc-ledger-r">
                    {inside}
                  </div>
                );
              })}
              {cp.files.length > 6 && <span className="lc-ledger-more">and {plural(cp.files.length - 6, "more file")}</span>}
            </section>
          ))}
        {review && (
          <button type="button" className="lc-foot-chip l-focus" data-tone={review.status === "passed" ? "ok" : blocked ? "danger" : undefined} aria-expanded={has ? open : undefined} disabled={!has} onClick={() => setOpen(!open)}>
            {/* Reading, the Reviewer is a thing at work: the mark in its model's colour. Its verdict is a fact, in words. */}
            {review.status === "running" ? <StateMark state="working" size={12} brand={markOf(review.reviewer)} label="Reading the changes" /> : <I.shield size={12} />}
            Reviewer
            <span className="lc-quiet">{modelLabel(review.reviewer, providers)}</span>
            <b>{verdict}</b>
            {review.round > 1 && <span className="lc-quiet">round {review.round}</span>}
            {has && <Chev className="lc-foot-chev" />}
          </button>
        )}
      </div>
      {review && has && open && (
        <div className="lc-foot-findings">
          {review.summary && <p>{review.summary}</p>}
          {review.findings.map((f, i) => (
            <button key={i} type="button" className="lc-foot-f l-focus" data-sev={f.severity} disabled={!onReview} onClick={() => onReview?.("all", f.file)}>
              <code>
                {f.file.split("/").pop()}
                {f.line ? `:${f.line}` : ""}
              </code>
              <span>{f.note}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
