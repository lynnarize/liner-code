/*
  A session's timeline, turn by turn, kept compact. Each turn opens with who worked and on what,
  then its work as a trail of steps, each a line with the fact that matters under it; the trail
  is open and moving while the turn runs and folds to one line when it ends. Anything that needs
  you (a request, a question, a plan) waits in place. The answer follows, and the turn ends with
  one line: what changed, and the Reviewer's verdict.
*/
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addonKey, PR_TEST_TOOL, type ConnectionAsk, type Item, type PanelAsk, type ProviderInfo, type AgentProfile, type TurnPart } from "@contracts";
import { appIcon, OfferCard } from "./Addon";
import { toComposer } from "./Find";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { isCheckpoint, rpc, threadOf, useEngine, useItems, useItemsWhere } from "./engine";
import { I, ModelMark, Rays } from "./icons";
import { PageCard } from "./Page";
import { DesignCard } from "./Design";
import { PrChatCard } from "./Pr";
import { commandOf as askCommand, headlineOf } from "./Ask";
import { ApprovalCard } from "@liner/pro/approval-card/approval-card";
import { Segmented } from "@liner/components/segmented/segmented";
import { Dialog } from "@liner/components/dialog/dialog";
import { agentOf, clock, designPart, duration, isModelAgent, markOf, mergeFiles, modelLabel, onClaude, plural, sumLines, turnsOf } from "./model";
import { Badge, Disc, EnvLine, Lines, ModelTag, Num, Pop, Row as PickRow } from "./ui";
import { Fanout, isSidekick, onWhom } from "./Crew";
import { toast } from "@liner/components/toast/toast";
import { Boundary } from "./Boundary";
import { bridge, isNative } from "./bridge";
import * as os from "./os";
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

const CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode", "mcp__liner__show_page", "liner.show_page"]);
/**
  Showing a design: its card stands for it once the turn has one. One that failed, or that kept
  the version before (nothing changed), stays a step, with what it said. Under each way a tool
  names it (OpenCode's is liner_design_show). Liner Design's tools (design_frame, design_node and
  the rest) aren't here on purpose: they draw on the canvas, which has no card, so each stays a
  step with the words canvas.ts's titleOf gives it.
*/
const DESIGN_TOOLS = new Set(["mcp__liner__design_show", "liner.design_show", "liner_design_show"]);
const isCard = (it: Item, designed: boolean) => it.kind === "tool" && (CARD_TOOLS.has(it.tool) || (designed && DESIGN_TOOLS.has(it.tool) && it.status === "done"));
/** A tool call the trail draws as a step: not a card of its own (a question, a plan, a page, a design shown) nor the PR card's test run. */
export const isStep = (it: Tool) => !CARD_TOOLS.has(it.tool) && !DESIGN_TOOLS.has(it.tool) && it.tool !== PR_TEST_TOOL && !(it.toolKind === "task" && /^Opus\b/.test(it.title));
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
  onReview: (checkpointId: string, path?: string) => void;
  reviewing?: { id: string; path?: string } | null;
  onGrow?: () => void;
  /**
    The session shows a plain ask at its composer (Ask.tsx): here it is a row that waits, not a
    card. Left out (a side chat, which has no such composer), the card stays in the timeline.
  */
  docked?: boolean;
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** A callback that keeps one identity while it calls the latest one given, so it doesn't redraw what it's handed to. */
function useSteady<A extends unknown[]>(fn: ((...a: A) => void) | undefined) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current?.(...a), []);
}

export function Timeline({ threadId, items: given, seen, onReview, reviewing, onGrow, docked }: Props) {
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
  const review = useSteady(onReview);
  const grow = useSteady(onGrow);
  return (
    <div className="lc-tl">
      {turns.map(({ turn, n, items: list }) => (
        // One turn that can't show says so in its place; the rest of the thread stays (T3 Code's RenderErrorBoundary).
        <Boundary key={turn} label="This turn" quiet>
          <Turn threadId={threadId} n={n} items={list} agents={agents} providers={providers} seen={seen} onReview={review} reviewing={reviewing} onGrow={grow} docked={docked} />
        </Boundary>
      ))}
    </div>
  );
}

const Turn = memo(function Turn({ threadId, n, items, agents, providers, seen, onReview, reviewing, onGrow, docked }: { threadId: string; n: number; items: Item[]; agents: AgentProfile[]; providers: ProviderInfo[] } & Omit<Props, "items" | "threadId">) {
  // Your turn, and any parts that carried it on (a build, a refine, a fix): one turn, one foot, and
  // a head for each model's part, so who did what reads in order.
  const marks = items.filter((x): x is Mark => x.kind === "turn");
  const marker = marks[0];
  const running = marks.some((m) => m.status === "running");
  const parts = sectionsOf(marks);
  const cps = items.filter((x): x is Checkpoint => x.kind === "checkpoint");
  const lastCp = cps[cps.length - 1];
  // The changes of the whole turn, as one: each file once, the lines added up; Review opens them all.
  // Every part undone, it says what was undone rather than "0 files".
  const undone = cps.every((c) => c.reverted);
  const shownCp = cps.length > 1 && lastCp ? { ...lastCp, files: mergeFiles((undone ? cps : cps.filter((c) => !c.reverted)).flatMap((c) => c.files)), reverted: undone } : lastCp;
  // `id` is the item a block stands for, when its key isn't one (a trail, a plan's draft). A trail's
  // node is made once the whole turn is read, when it's known which one is live; `still` blocks
  // never come in with the block's fade and blur (the work block and its status line), and `said`
  // marks words, after which a trail before them is done.
  const blocks: { key: string; id?: string; node?: ReactNode; trail?: TrailIn; still?: boolean; said?: boolean }[] = [];
  // The turn's steps so far, for its status line.
  let count = 0;
  // A tool gone quiet (its notice with Stop, and nothing since) is said on the status line, not as a line of its own.
  const qi = running ? items.findLastIndex((x) => x.kind === "notice" && Boolean(x.stop)) : -1;
  const quiet = qi >= 0 && qi > items.findLastIndex((x) => x.kind !== "notice") ? (items[qi] as Extract<Item, { kind: "notice" }>) : undefined;
  const waiting = running && items.some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
  const asks = useMemo(() => foldedAsks(items), [items]);
  const folded = new Set([...asks.values()].map((a) => a.id));
  const fresh = (id: string) => !seen.has(id);
  // The PR card's own test run and its request sit with the card, not in the trail.
  const prRun = items.findLast((x): x is Tool => x.kind === "tool" && x.tool === PR_TEST_TOOL);
  const prAsk = items.find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.tool === PR_TEST_TOOL && x.state === "asking");
  const escalation = (it: Item) => it.kind === "tool" && it.toolKind === "task" && /^Opus\b/.test(it.title);
  const designed = items.some((x) => x.kind === "design");
  const cp = items.find((x): x is Checkpoint => x.kind === "checkpoint");
  const review = items.findLast((x): x is Review => x.kind === "review");
  // A plan still being written (a lead's <plan>, or Claude Code's plan mode filling in its call) is one quiet line until its card comes.
  const unplanned = (i: number) => running && !items.slice(i + 1).some((x) => x.kind === "proposal");
  // Which part of the turn an item is in: the planner's words read as a plan, the builder's as they are.
  let at: Mark | undefined;
  // The steps between two things said, and the thinking between them: one folded row (Claude Code's
  // and T3 Code's work groups). The last one while the turn works is live: its row says the step under way.
  let run: Entry[] = [];
  // A row is keyed by the item that started it, even thinking that ended too short to keep a line:
  // while it streamed it was the row's first entry, so the row keeps its key when it drops out.
  let lead: string | undefined;
  const flush = (live = false) => {
    const first = lead;
    lead = undefined;
    if (!run.length) return;
    const entries = run;
    run = [];
    const key = first ?? entries[0].it.id;
    // Thinking with no step beside it (before a reply, say) is a row of its own once it's done. It
    // takes the key the trail it starts will have, so when a step joins it the row stays and doesn't
    // come in again. While the turn works it is the live work block instead: thinking makes no row then.
    if (!live && !entries.some((e) => e.kind !== "thought")) {
      for (const [j, e] of entries.entries()) if (e.kind === "thought") blocks.push({ key: `t${j === 0 ? key : e.it.id}`, id: j === 0 ? key : e.it.id, node: <Thought it={e.it} /> });
      return;
    }
    // Its own part's checkpoint (a build after the plan keeps its own), for its lines and its diffs.
    const partCp = cps.find((c) => c.turn === entries[0].it.turn) ?? cp;
    const read = rowsOf(entries, partCp);
    count += read.rows.filter((r) => r.kind === "step").length;
    blocks.push({ key: `t${key}`, id: key, still: true, trail: { entries, ...read, cp: partCp, who: whoOf(at ?? marker, agents, providers) } });
  };
  const offers: Extract<Item, { kind: "offer" }>[] = [];
  for (const [i, it] of items.entries()) {
    if ((it.kind === "tool" || it.kind === "approval") && it.tool === PR_TEST_TOOL) continue;
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
    if (escalation(it)) {
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
      else if (it.kind === "user") blocks.push({ key: it.id, said: true, node: <You threadId={threadId} it={it} fresh={fresh(it.id)} onReview={onReview} /> });
      else if (it.kind === "turn") {
        at = it;
        const part = parts.get(it.id);
        if (part) blocks.push({ key: it.id, node: <TurnHead it={it} marks={part} n={it === marker ? n : undefined} items={items} agents={agents} providers={providers} timed={!items.some((x) => x.kind === "tool" && isStep(x))} /> });
      }
      else if (it.kind === "text") {
        const planning = Boolean((at ?? marker)?.planning);
        const draft = planning && unplanned(i) ? draftOf(it.text) : null;
        // A lead's tag still arriving ("<pl") isn't shown: the words before it stay as they were when the plan starts.
        if (!draft) blocks.push({ key: it.id, said: true, node: <StreamedMarkdown className="lc-md" text={planning && it.streaming ? untag(it.text).replace(/<\/?[a-z]*$/i, "") : untag(it.text)} streaming={it.streaming} animate={fresh(it.id)} onGrow={onGrow} /> });
        else {
          // What the lead says around its plan reads in order around this line, and the card and
          // those words take the same keys when the turn ends (the engine's ids), so they settle
          // in place: nothing moves above the card or comes in twice.
          if (draft.before.trim()) blocks.push({ key: it.id, said: true, node: <StreamedMarkdown className="lc-md" text={draft.before} streaming={false} animate={fresh(it.id)} onGrow={onGrow} /> });
          blocks.push({ key: `${it.id}-plan`, id: it.id, node: <PlanDraft text={draft.plan} title={draft.title} /> });
          if (draft.after) blocks.push({ key: `${it.id}-after`, node: <StreamedMarkdown className="lc-md" text={draft.after} streaming={it.streaming} animate={fresh(it.id)} onGrow={onGrow} /> });
        }
      }
      else if (it.kind === "plan") blocks.push({ key: it.id, node: <Todo it={it} /> });
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
            </p>
          ),
        });
      else if (it.kind === "offer") offers.push(it);
    }
  }
  flush(running);
  // An offer to make an app shows once its turn has ended, after the answer (DeepSeek Harness's card).
  if (!running) for (const o of offers) blocks.push({ key: o.id, node: <OfferCard threadId={threadId} it={o} who={whoOf(at ?? marker, agents, providers)} /> });
  // The trail at work is the turn's last, with nothing said after it: the rest fold to their one line.
  const lastTrail = blocks.findLastIndex((b) => b.trail);
  const live = running && lastTrail >= 0 && !blocks.slice(lastTrail + 1).some((b) => b.said) ? lastTrail : -1;
  // Done, the turn's time goes at the end of its last trail's line, unless a part's head says it ("built it in 46s").
  const end = marks[marks.length - 1];
  const took = !running && marker && end?.status === "done" && end.seconds !== undefined && !marks.some((m) => m.part || m.planning) ? (end.at - marker.at) / 1000 + end.seconds - marks.slice(0, -1).reduce((n, m) => n + (m.waited ?? 0), 0) / 1000 : undefined;
  // While it works, the turn ends on its status line: what it's doing and its clock.
  if (running && marker) blocks.push({ key: `live-${marker.id}`, still: true, node: <LiveStatus threadId={threadId} marks={marks} items={items} steps={count} quiet={quiet} /> });
  return (
    <section className="lc-turn" data-running={running || undefined}>
      {blocks.map((b, i) => (
        // data-item lets the session find a block: the prompt minimap scrolls to your messages by it.
        <div key={b.key} className="lc-blk" data-item={b.id ?? b.key} data-fresh={(!b.still && fresh(b.id ?? b.key)) || undefined}>
          {b.trail ? <Trail threadId={threadId} {...b.trail} asks={asks} live={i === live} waiting={waiting} took={i === lastTrail ? took : undefined} onReview={onReview} /> : b.node}
        </div>
      ))}
    </section>
  );
});

const whoOf = (marker: Item | undefined, agents: AgentProfile[], providers: ProviderInfo[]) => (marker?.kind === "turn" ? agentOf(marker.agent, agents, providers).name : "The agent");

type Mark = Extract<Item, { kind: "turn" }>;

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
            ? "stopped with a problem"
            : did
              ? did.replace(/ in$/, "")
              : ""
        : status === "stopped"
          ? `stopped after ${duration(took)}`
          : status === "error"
            ? `stopped with a problem after ${duration(took)}`
            : did
              ? `${did} ${duration(took)}`
              : timed
                ? duration(took)
                : "";
  // A model on its own is named after the model, so its mark sits on the disc instead of a tag.
  const alone = isModelAgent(it.agent);
  return (
    <div className="lc-head" data-part={n === undefined || undefined} title={why || undefined}>
      {alone ? (
        <span className="lc-disc lc-disc-model" style={{ width: 22, height: 22 }} aria-hidden>
          <ModelMark kind={markOf(it.model)} size={13} />
        </span>
      ) : (
        <Disc agent={a} size={22} lead={it.planning || undefined} />
      )}
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
  second: one timer for all of them, there only while one is up (T3 Code: apps/web/src/lib/tickTextContent.ts).
*/
const ticking = new Set<() => void>();
let ticker: number | undefined;
function onTick(fn: () => void) {
  ticking.add(fn);
  ticker ??= window.setInterval(() => {
    for (const f of ticking) f();
  }, 1000);
  return () => {
    ticking.delete(fn);
    if (ticking.size || ticker === undefined) return;
    window.clearInterval(ticker);
    ticker = undefined;
  };
}
/** Text that keeps itself up to date each second. React never owns its words, so a redraw and a tick can't fight over them. */
function Tick({ text, className }: { text: () => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const read = useRef(text);
  read.current = text;
  const put = useCallback(() => {
    const el = ref.current;
    const t = read.current();
    if (el && el.textContent !== t) el.textContent = t;
  }, []);
  useLayoutEffect(put);
  useEffect(() => onTick(put), [put]);
  return <span ref={ref} className={className} />;
}
/** A clock while it runs: whole seconds, so it doesn't show tenths it never updates. */
const ticked = (s: number) => (s < 60 ? `${Math.floor(Math.max(0, s))}s` : duration(Math.floor(s)));

/**
  The turn's one status line, at its end: a pip (the only thing in the turn that moves), what it's
  doing as one word, its clock and how many steps. Waiting on you, it's amber and says where the
  clock stopped: time you take isn't the agent's. A tool gone quiet says so here, with Stop.
*/
function LiveStatus({ threadId, marks, items, steps, quiet }: { threadId: string; marks: Mark[]; items: Item[]; steps: number; quiet?: Extract<Item, { kind: "notice" }> }) {
  const first = marks[0];
  const now = marks.findLast((m) => m.status === "running") ?? marks[marks.length - 1];
  const asks = items.filter((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
  const waiting = asks.length > 0;
  const waited = marks.reduce((n, m) => n + (m.waited ?? 0), 0);
  // When the wait began: the engine's mark, else the oldest thing still asking.
  const since = marks.find((m) => m.waitingSince)?.waitingSince ?? (waiting ? Math.min(...asks.map((a) => a.at)) : undefined);
  const clock = () => ticked((Math.min(Date.now(), since ?? Infinity) - first.at - waited) / 1000);
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
  // "opencode hasn't said anything new for 1 minute": the notice's first clause; the rest is its title.
  const hush = quiet && quiet.text.split(/:\s/)[0];
  return (
    <div className="lc-status" role="status" data-wait={waiting || undefined} data-quiet={(!waiting && quiet) || undefined} title={!waiting && quiet ? quiet.text : undefined}>
      <span className="lc-pip" aria-hidden />
      <b>{word}</b>
      {waiting ? (
        <span className="l-num">
          the clock stopped at <Tick text={clock} />
        </span>
      ) : (
        <span className="lc-status-t l-num">
          <span aria-hidden>
            <Tick text={clock} />
          </span>
          {steps > 0 && ` · ${plural(steps, "step")}`}
          {hush && ` · ${hush}`}
        </span>
      )}
      {!waiting && quiet && (
        <>
          <span className="lc-grow" />
          <button type="button" className="lc-notice-stop l-focus" onClick={() => void rpc("thread.stop", { id: threadId })}>
            Stop
          </button>
        </>
      )}
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
  A plan while it's written: one line marked like thinking, with how many steps it has so far,
  rather than the plan streaming by and then showing again as its card. It opens for a look.
*/
function PlanDraft({ text, title }: { text?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const steps = text ? stepsOf(text).length : 0;
  return (
    <div className="lc-thought" data-open={open || undefined} data-live>
      <button type="button" className="lc-thought-h l-focus" aria-expanded={text ? open : undefined} disabled={!text} onClick={() => setOpen((o) => !o)}>
        <span className="l-shimmer">{title ? `Writing the plan: ${title}` : "Writing the plan…"}</span>
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

/** Liner Code's own Browser tools, under either way an agent tool names them. */
const BROWSER = /^(?:mcp__liner__|liner\.)browser_(\w+)/;
/** Its dev servers from launch.json, the same way. */
const SERVER = /^(?:mcp__liner__|liner\.)server_(\w+)/;
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
/** The command a step ran: Claude Code reports its input as JSON, Codex and the rest as the command. */
function commandOf(t: Tool) {
  const raw = t.input ?? "";
  try {
    const j = JSON.parse(raw) as { command?: unknown };
    if (typeof j?.command === "string") return j.command;
  } catch {
    // the command itself
  }
  return raw || t.title.replace(/^Run\s+/, "");
}

/** One line of the trail: what it did (a verb and what it touched), how it went, and the fact that matters, under it. */
/** `diff`: the file in the turn's checkpoint an edit step changed, which a press opens in Changes. */
export type TrailStep ={ key: string; tools: Tool[]; verb: string; target?: string; result?: ReactNode; state: "running" | "done" | "failed"; at: number; seconds: number; tail?: string; diff?: string };
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
export function trailSteps(tools: Tool[], cp?: Checkpoint): TrailStep[] {
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
      return { ...base, verb: "Checked in the Browser", target: page, result: joined([did.join(", "), ...pageParts(t)]) };
    }
    if (SERVER.exec(t.tool)?.[1] === "start") {
      // "web is running on localhost:5173, …": where it runs, which is what the person needs of it.
      const at = /\b(?:running|starting)\b[^\n]*?\bon (localhost:\d+)/.exec(t.output ?? "")?.[1];
      // Failed, why: the line under "didn't stay up", or the one line it said (the person said no).
      const said = (t.output ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const why = /didn't stay up/.test(said[0] ?? "") ? said[1] : said[0];
      return { ...base, verb: state === "running" ? "Starting" : state === "failed" ? "Couldn't start" : "Started", target: t.title.replace(/^Run\s+|\s+from launch\.json$/g, ""), result: state === "failed" ? (why ? clip(why) : undefined) : at };
    }
    if (t.toolKind === "read") {
      const names = [...new Set(g.map((x) => nameOf(x.path ?? x.title.replace(/^Read\s+/, ""))))];
      return { ...base, verb: "Read", target: names.length === 1 ? names[0] : `${names.length} files`, result: names.length > 1 ? clip(names.join(", ")) : undefined };
    }
    if (t.toolKind === "search") {
      const hits = t.output ? t.output.split("\n").filter(Boolean).length : 0;
      return { ...base, verb: "Searched", target: t.title.replace(/^Search(?:ed)?(?: the code)?(?: for)?\s*/i, "") || undefined, result: t.output !== undefined ? (hits ? plural(hits, "match", "matches") : "nothing found") : undefined };
    }
    if (writes(t)) {
      const f = t.path ? cp?.files.find((x) => slashed(t.path!) === x.path || slashed(t.path!).endsWith(`/${x.path}`)) : undefined;
      // An edit that didn't apply (its text wasn't found) is usually tried again in the same group.
      const missed = g.length > 1 ? g.filter((x) => x.status === "failed").length : 0;
      return {
        ...base,
        diff: f && cp && !cp.reverted && state !== "running" ? f.path : undefined,
        verb: state === "running" ? "Editing" : f?.status === "added" ? "Created" : "Edited",
        target: t.path ? nameOf(t.path) : t.title.replace(/^(?:Edit|Write)\s+/, ""),
        result: joined([f && <Lines added={f.added} removed={f.removed} />, g.length > 1 && plural(g.length, "edit"), missed > 0 && <span className="lc-bad">{missed} didn't apply</span>]),
      };
    }
    if (t.toolKind === "exec") {
      const command = commandOf(t).replace(/\s+/g, " ").trim();
      return { ...base, verb: state === "running" ? "Running" : "Ran", target: clip(command, 72), result: state === "running" ? undefined : ranResult(t), tail: state === "running" && t.output ? t.output.split("\n").filter(Boolean).slice(-2).join("\n") : undefined };
    }
    const line = lastLine(t.output);
    return { ...base, verb: t.title, result: line && state !== "running" ? clip(line) : undefined };
  }).map((step) => {
    // A call that was still going when its turn was stopped says so, rather than how far its output got.
    const t = step.tools[step.tools.length - 1];
    return t.status === "stopped" ? { ...step, result: <span className="lc-quiet">stopped</span> } : step;
  });
}

/** A trail's rows in the order they came: its steps (as trailSteps groups them), with thinking and answered asks between them. */
type TrailIn = { entries: Entry[]; rows: Row[]; sent: Tool[]; cp?: Checkpoint; who: string };
function rowsOf(entries: Entry[], cp?: Checkpoint): { rows: Row[]; sent: Tool[] } {
  // Agents this part sent off (Claude Code's Agent tool): they fan out under the trail, each with what it does (Crew.tsx), not as steps.
  const sent = entries.flatMap((e) => (e.kind === "tool" && e.it.toolKind === "task" && isStep(e.it) ? [e.it] : []));
  const rows: Row[] = [];
  let tools: Tool[] = [];
  const flush = () => {
    for (const step of trailSteps(tools, cp)) rows.push({ kind: "step", step });
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

/** Markdown as plain words on one line, for the slot: no marks, links as their words, code as its text. */
const flat = (md: string) =>
  md
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|\*|~~)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();

/** How long a new row takes to come in. Only while you watch, and only its opacity. */
const ROW_IN = 160;

/**
  A turn's work. While it runs it is a block that keeps its height: "N earlier steps" once there are
  more than three (it opens all of them in a box that scrolls and follows the newest, T3 Code's
  bounded work log), the last three steps a line each, and a slot of two lines that is always there:
  what the running command last printed, else the newest thinking since the last step. Thinking makes
  no row while it works and rows are only ever added at the end, so nothing jumps; nothing in it moves
  either, the status line's pip under it does that. When the turn ends it folds to one line that says
  what it did, and opens with a press to every row, thinking too, in the same quiet style.
*/
function Trail({ threadId, entries, rows, sent, asks, cp, live, waiting, took, onReview }: TrailIn & { threadId: string; asks: Map<string, Ask>; live: boolean; waiting: boolean; took?: number; onReview: (checkpointId: string, path?: string) => void }) {
  const [isOpen, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const steps = rows.filter((r): r is { kind: "step"; step: TrailStep } => r.kind === "step").map((r) => r.step);
  // When each row came, so one that arrives while you watch fades in; those there when the trail first drew don't.
  const came = useRef(new Map<string, number>());
  const drawn = useRef(false);
  useEffect(() => {
    drawn.current = true;
  }, []);
  const toggle = (key: string) => setOpened((x) => (x.includes(key) ? x.filter((k) => k !== key) : [...x, key]));
  const row = (r: Row) => {
    if (r.kind === "thought")
      return (
        <li key={r.it.id} className="lc-trail-note">
          <Thought it={r.it} />
        </li>
      );
    if (r.kind === "ask") {
      if (!came.current.has(r.it.id)) came.current.set(r.it.id, drawn.current && live ? Date.now() : 0);
      return <AskRow key={r.it.id} it={r.it} fresh={live && Date.now() - (came.current.get(r.it.id) ?? 0) < ROW_IN} />;
    }
    const key = r.step.key;
    if (!came.current.has(key)) came.current.set(key, drawn.current && live ? Date.now() : 0);
    return <StepRow key={key} s={r.step} said={r.step.tools.flatMap((t) => asks.get(t.id) ?? [])} cp={cp} open={opened.includes(key)} onToggle={() => toggle(key)} onReview={onReview} fresh={live && Date.now() - (came.current.get(key) ?? 0) < ROW_IN} />;
  };
  // The box of every step follows the newest while you're at its end (T3 Code's bounded scroller).
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  // The slot comes the first time it has something to show and stays for the rest of the live block.
  const slotOn = useRef(false);
  const shownRows = live ? rows.filter((r) => r.kind !== "thought") : rows;
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [all, shownRows.length]);
  if (live) {
    const last = shownRows.slice(-3);
    const earlier = shownRows.length - last.length;
    // The slot: the running command's last two lines; else the newest thinking since the last step.
    const tail = steps.findLast((s) => s.state === "running")?.tail;
    const since = entries.slice(entries.findLastIndex((e) => e.kind !== "thought") + 1);
    const thought = tail ? "" : flat(since.flatMap((e) => (e.kind === "thought" ? [e.it.text] : [])).join(" ")).slice(-360);
    if (tail || thought) slotOn.current = true;
    const slot = !waiting && slotOn.current;
    // Nothing of its own to show yet (a lead waiting on its sidekick): no rail and no empty slot, only who it sent.
    if (!shownRows.length && !slot)
      return (
        <div className="lc-trail" data-live>
          <Fanout threadId={threadId} tools={sent} />
        </div>
      );
    return (
      <div className="lc-trail" data-live>
        <ol className="lc-wk">
          {earlier > 0 && (
            <li>
              <button type="button" className="lc-wk-earlier l-focus" aria-expanded={all} onClick={() => setAll(!all)}>
                {plural(earlier, "earlier step")}
                <Chev className="lc-row-chev" />
              </button>
            </li>
          )}
          {all && earlier > 0 ? (
            <li>
              <div className="lc-wk-box" ref={box} onScroll={(e) => (stuck.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 24)}>
                <ol className="lc-wk lc-wk-all">{shownRows.map(row)}</ol>
              </div>
            </li>
          ) : (
            last.map(row)
          )}
          {slot && (
            <li className="lc-wk-slot" data-mono={tail ? true : undefined} aria-hidden>
              {tail ? tail.split("\n").map((l, i) => <span key={i}>{l}</span>) : thought && <span>{thought}</span>}
            </li>
          )}
        </ol>
        <Fanout threadId={threadId} tools={sent} />
      </div>
    );
  }
  const failed = steps.filter((s) => s.state === "failed").length;
  // Folded, the row keeps what it changed, ran, read and looked up, and whether it checked its work.
  const tools = steps.flatMap((s) => s.tools);
  const paths = [...new Set(tools.filter((t) => (t.toolKind === "edit" || t.toolKind === "write") && t.path).map((t) => t.path!))];
  const edited = [...new Set(paths.map(nameOf))];
  const ran = tools.filter((t) => t.toolKind === "exec").length;
  const read = new Set(tools.filter((t) => t.toolKind === "read").map((t) => t.path ?? t.id)).size;
  const searched = tools.some((t) => t.toolKind === "search");
  const web = tools.some((t) => t.toolKind === "web" || t.toolKind === "fetch");
  const checked = tools.some((t) => BROWSER.test(t.tool));
  // The lines of the files it names; what its commands changed besides shows on the turn's last line.
  const mine = cp?.files.filter((f) => paths.some((p) => slashed(p) === f.path || slashed(p).endsWith(`/${f.path}`))) ?? [];
  const lines = mine.length ? sumLines(mine) : null;
  const said = [
    edited.length > 0 && (edited.length <= 2 ? `edited ${edited.join(" and ")}` : `edited ${edited.length} files`),
    ran > 0 && `ran ${plural(ran, "command")}`,
    read > 0 && `read ${plural(read, "file")}`,
    searched && "searched the code",
    web && "read the web",
    checked && "checked the Browser",
  ].filter((x): x is string => Boolean(x));
  if (!said.length) said.push(steps.length ? plural(steps.length, "step") : sent.length === 0 ? "thought it through" : sent.every(isSidekick) ? "handed work to its sidekick" : `sent ${onWhom(sent)}`);
  return (
    <div className="lc-trail" data-open={isOpen || undefined}>
      <button type="button" className="lc-trail-sum l-focus" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <span className="lc-trail-parts">
          {said.map((p, i) => (
            <span key={p}>
              {i > 0 && ", "}
              {i === 0 ? `${p[0].toUpperCase()}${p.slice(1)}` : p}
              {i === 0 && edited.length > 0 && lines && (
                <>
                  {" "}
                  <Lines {...lines} />
                </>
              )}
            </span>
          ))}
        </span>
        {failed > 0 && <span className="lc-trail-failed">· {failed} failed</span>}
        {took !== undefined && <span className="lc-trail-took l-num">· {duration(took)}</span>}
        <Chev className="lc-row-chev" />
      </button>
      {isOpen && <ol className="lc-wk lc-wk-all">{rows.map(row)}</ol>}
      <Fanout threadId={threadId} tools={sent} />
    </div>
  );
}

/**
  One step on a line: its verb, what it touched in mono, how it went in grey, what you said to its
  ask as a tag, and its time at the right. Finished it's grey; the one at work is in full ink, and it
  only ever changes its words in place (Reading → Read). A dot only where something needs saying: it
  failed, or you said no. It opens for its input and output, or an edit opens Changes at its file.
*/
function StepRow({ s, said, cp, open, onToggle, onReview, fresh }: { s: TrailStep; said: Ask[]; cp?: Checkpoint; open: boolean; onToggle: () => void; onReview: (checkpointId: string, path?: string) => void; fresh: boolean }) {
  const refused = said.length > 0 && said.every((a) => a.state === "denied");
  // A step you said no to failed because of it: your no says so, once, with your words if you gave any.
  const reason = refused ? said.find((a) => a.reason)?.reason : undefined;
  const result = refused ? (reason ? `“${clip(reason, 80)}”` : undefined) : s.result;
  // An edit with its file in the turn's checkpoint opens Changes at that file; the diff says more than the edit's input.
  const diff = s.diff && cp ? { id: cp.id, path: s.diff } : null;
  const has = !diff && (s.tools.some((t) => t.input || t.output) || said.some((a) => a.reason));
  const at = s.at;
  return (
    <li className="lc-wk-row" data-state={refused ? "no" : s.state} data-new={fresh || undefined}>
      <span className="lc-wk-dot" aria-hidden />
      <button
        type="button"
        className="lc-wk-ln l-focus"
        data-diff={diff ? true : undefined}
        aria-expanded={has ? open : undefined}
        disabled={!has && !diff}
        title={diff ? `Show ${nameOf(diff.path)} in Changes` : undefined}
        onClick={() => (diff ? onReview(diff.id, diff.path) : onToggle())}
      >
        <b className="lc-wk-verb">{s.verb}</b>
        {s.target && <code className="lc-wk-target">{s.target}</code>}
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
  An ask on the trail. Waiting, it is a row in full ink with an amber dot, "Asks to …" and "waiting
  for you": the ask itself is at the composer. Answered without a step to fold into, it says what
  became of it: refused, a red dot and "Didn't …", with your words if you gave any.
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
      <span className="lc-wk-dot" aria-hidden />
      <button type="button" className="lc-wk-ln" disabled title={it.title}>
        <b className="lc-wk-verb">{verb}</b>
        {command !== undefined && <code className="lc-wk-target">{command.replace(/\s+/g, " ").trim()}</code>}
        {it.reason && <span className="lc-wk-r">“{clip(it.reason, 80)}”</span>}
        <span className="lc-wk-tag">{it.state === "asking" ? "waiting for you" : tagsOf([it])[0]}</span>
        <span className="lc-grow" />
      </button>
    </li>
  );
}

function Todo({ it }: { it: Extract<Item, { kind: "plan" }> }) {
  const done = it.entries.filter((e) => e.status === "completed").length;
  return (
    // A labelled list on the paper, not a card: "Plan" and its count, then a line a task.
    <section className="lc-todo" aria-label="Plan">
      <div className="lc-todo-h">
        <b>Plan</b>
        <span className="lc-quiet">
          <Num value={done} /> of {it.entries.length} done
        </span>
      </div>
      <ol>
        {it.entries.map((e, i) => (
          <li key={i} data-s={e.status}>
            <span className="lc-todo-mk" key={e.status}>
              {e.status === "completed" ? <I.check size={14} /> : e.status === "in_progress" ? <Rays size={11} /> : null}
            </span>
            <span>
              <span className={e.status === "in_progress" ? "l-shimmer" : undefined}>{e.title}</span>
              {e.owner && <span className="lc-todo-own">{e.owner}</span>}
            </span>
          </li>
        ))}
      </ol>
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
        {it.state === "approved" ? <I.check size={13} /> : <I.close size={13} />}
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
              <I.chevR size={11} />
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
        {it.state === "approved" && !gone ? <I.check size={13} /> : <I.close size={13} />}
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
              <I.chevR size={11} />
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

const PLACE = { dock: "the right dock", tab: "a tab beside Chat", page: "a page of its own" } as const;
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
        {it.state === "approved" && !gone ? a.same ? <I.push size={13} /> : <I.check size={13} /> : <I.close size={13} />}
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
            <I.chevR size={11} />
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
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  if (it.state !== "asking")
    return (
      <div className="lc-answered" data-state={it.state === "answered" ? "approved" : "denied"}>
        {it.state === "answered" ? <I.check size={13} /> : <I.close size={13} />}
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
  const OTHER = "Something else";
  // A question that comes with no choices (Codex's and ACP's free text): writing your own is the one there is.
  const pickOf = (x: (typeof it.questions)[number]) => picks[x.question] ?? x.options[0]?.label ?? OTHER;
  const chosen = pickOf(q);
  const last = at === it.questions.length - 1;
  const answers = () =>
    Object.fromEntries(it.questions.map((x) => [x.question, pickOf(x) === OTHER ? other[x.question]?.trim() || OTHER : pickOf(x)]));
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
        </div>
        <div className="lc-opts" role="radiogroup" aria-label={q.question}>
          {[...q.options, { label: OTHER, description: "Write your own answer." }].map((o) => {
            const on = chosen === o.label;
            return (
              <div key={o.label} className="lc-opt" role="radio" aria-checked={on} tabIndex={0} data-on={on || undefined} onClick={() => setPicks((p) => ({ ...p, [q.question]: o.label }))} onKeyDown={(e) => {
                // Its own keys only: space and Enter in the field inside it are letters, and space here would scroll the thread.
                if (e.target !== e.currentTarget || (e.key !== " " && e.key !== "Enter")) return;
                e.preventDefault();
                setPicks((p) => ({ ...p, [q.question]: o.label }));
              }}>
                <span className="lc-radio" data-on={on || undefined} />
                <span>
                  <b>
                    {o.label}
                    {"suggested" in o && o.suggested && <Badge tone="accent" dot={false}>{who} suggests</Badge>}
                  </b>
                  {o.description && <small>{o.description}</small>}
                  {o.label === OTHER && on && <textarea className="lc-else" autoFocus={picks[q.question] === OTHER} aria-label="Your own answer" placeholder="Say what you would like instead" value={other[q.question] ?? ""} onChange={(e) => setOther((x) => ({ ...x, [q.question]: e.target.value }))} onClick={(e) => e.stopPropagation()} />}
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
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={chosen === OTHER && !other[q.question]?.trim()} title={chosen === OTHER && !other[q.question]?.trim() ? "Write your answer first" : undefined} onClick={() => (last ? void submit() : setAt(at + 1))}>
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
        {it.state === "approved" ? <I.check size={13} /> : <I.edit size={13} />}
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
                          <I.close size={11} />
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
            <Pop label={`How ${coder.name} runs`} width={290} triggerClass="lc-btn lc-plan-modeb" trigger={<>{mode.id === "helpers" ? `${modelLabel(thread?.model ?? coder.model, providers)}, with helpers` : `${modelLabel(thread?.model ?? coder.model, providers)} alone`}<I.chevD size={11} /></>}>
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

/** The tool's plan ran out mid-turn. It says which window and when it reopens; Resume carries on. */
function LimitCard({ threadId, it }: { threadId: string; it: Extract<Item, { kind: "limit" }> }) {
  const status = useEngine((s) => threadOf(s, threadId)?.status);
  const providers = useEngine((s) => s.providers);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!it.until) return;
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [it.until]);
  const label = providers.find((p) => p.id === it.provider)?.label ?? it.provider;
  const open = !it.until || it.until <= now;
  const current = status === "limited";
  return (
    <div className="lc-limit" data-current={current || undefined}>
      <span className="lc-tile">
        <I.clock size={12} />
      </span>
      <span className="lc-limit-t">
        <b>{label} hit its usage limit</b>
        <small>
          {it.message}
          {it.until ? (open ? " It has reset." : ` It resets ${clock(it.until)}.`) : ""}
        </small>
      </span>
      {current && it.fallback && (
        <button type="button" className="lc-btn" data-kind={open ? "plain" : "primary"} data-size="sm" title="Another tool takes over, with the conversation so far" onClick={() => void rpc("thread.carryOn", { id: threadId, model: it.fallback }).catch(fail)}>
          Carry on with {modelLabel(it.fallback, providers)}
        </button>
      )}
      {current && (
        <button type="button" className="lc-btn" data-kind={open || !it.fallback ? "primary" : "plain"} data-size="sm" title={open ? "Carry on where it stopped" : "It may still be limited; try anyway"} onClick={() => void rpc("thread.send", { id: threadId, text: "Continue where you left off." }).catch(fail)}>
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
function You({ threadId, it, fresh, onReview }: { threadId: string; it: Extract<Item, { kind: "user" }>; fresh: boolean; onReview: (checkpointId: string, path?: string) => void }) {
  const running = useEngine((s) => threadOf(s, threadId)?.status === "running");
  // Only the checkpoints: the whole timeline would redraw every message you sent with each streamed word.
  const cps = useItemsWhere(threadId, isCheckpoint) as Checkpoint[];
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
        <button type="button" className="lc-you-anchor l-focus" onClick={() => onReview("all", it.anchor!.file)} title="Show these lines">
          <I.comment size={11} />
          <span>
            {it.anchor.file.split("/").pop()}, {it.anchor.endLine && it.anchor.endLine !== it.anchor.line ? `lines ${it.anchor.line}–${it.anchor.endLine}` : `line ${it.anchor.line}`}
          </span>
        </button>
      )}
      {part && (
        <span className="lc-you-anchor lc-you-part" title={`About ${part} in “${title}”`}>
          <I.comment size={11} />
          <span>
            {part} · {title}
          </span>
        </span>
      )}
      {it.files && it.files.length > 0 && <Attachments files={it.files} />}
      {said && <p>{said}</p>}
      {!it.steer && it.turn > 0 && (
        <span className="lc-you-more">
          <button type="button" className="lc-you-btn l-focus" disabled={running} title={running ? "Stop the turn to edit from here" : "Edit this message and go back to it"} onClick={() => setEdit(part ? said : it.text)}>
            <I.edit size={12} />
            Edit from here
          </button>
          <button type="button" className="lc-you-btn l-focus" title="Copy" aria-label="Copy the message" onClick={() => void navigator.clipboard?.writeText(said).then(() => toast("Copied"), fail)}>
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
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="lc-picture-frame">{src ? <img src={src} alt={attachedName(path)} /> : <span className="lc-quiet">{failed ? "This picture isn't there any more." : "Opening…"}</span>}</div>
    </Dialog>
  );
}

/** "Asked Opus 5.5 to plan this, a change across sync/ and editor/": Sonnet escalating, with Opus's plan inside. */
function Escalation({ it, providers }: { it: Tool; providers: ProviderInfo[] }) {
  const [open, setOpen] = useState(false);
  const what = it.title.replace(/^Opus:?\s*/, "");
  const opus = providers.find((p) => p.id === "claude")?.models.find((m) => m.id.includes("opus"))?.label ?? "Opus";
  return (
    <div className="lc-esc" data-open={open || undefined}>
      <button type="button" className="lc-esc-h l-focus" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!it.output}>
        <span className="lc-tile">{it.status === "running" ? <Rays size={11} /> : <I.sparkle size={11} />}</span>
        <span className={it.status === "running" ? "l-shimmer" : undefined}>
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
  The turn's last line: what changed (all its parts' changes as one, when `all`; Review opens the
  diff) and the Reviewer's verdict, side by side. Its findings open under the line; blockers open
  by themselves, notes wait for a press.
*/
function TurnFoot({ cp, all, review, providers, onReview, reviewing }: { cp?: Checkpoint; all?: boolean; review?: Review; providers: ProviderInfo[]; onReview: (checkpointId: string, path?: string) => void; reviewing?: { id: string; path?: string } | null }) {
  const blocked = review?.status === "blocked";
  const [open, setOpen] = useState(blocked);
  useEffect(() => {
    if (blocked) setOpen(true);
  }, [blocked]);
  // A turn of several parts opens as "all", at its first file.
  const here = Boolean(cp && reviewing && (all ? reviewing.id === "all" && reviewing.path === cp.files[0]?.path : reviewing.id === cp.id));
  const has = Boolean(review && (review.findings.length || review.summary));
  const blockers = review?.findings.filter((f) => f.severity === "blocking").length ?? 0;
  const verdict = !review ? "" : review.status === "running" ? "is reading it" : review.status === "passed" ? (review.findings.length ? `passed, ${plural(review.findings.length, "note")}` : "passed") : review.status === "blocked" ? plural(blockers || review.findings.length, "blocker") : "gave no verdict";
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
            <button type="button" className="lc-foot-chip lc-foot-changes l-focus" aria-current={here || undefined} onClick={() => onReview(all ? "all" : cp.id, cp.files[0]?.path)}>
              {/* The words "View changes" went (the chevron says it opens); a reader still hears them. */}
              {plural(cp.files.length, "file")} changed <Lines {...sumLines(cp.files)} />
              <span className="l-sr-only">{here ? ", in the panel" : ", view changes"}</span>
              <Chev className="lc-row-chev" />
            </button>
          ))}
        {review && (
          <button type="button" className="lc-foot-chip l-focus" data-tone={review.status === "passed" ? "ok" : blocked ? "danger" : undefined} aria-expanded={has ? open : undefined} disabled={!has} onClick={() => setOpen(!open)}>
            {review.status === "running" ? <Rays size={11} /> : <I.shield size={12} />}
            Reviewer
            <span className="lc-quiet">{modelLabel(review.reviewer, providers)}</span>
            <b className={review.status === "running" ? "l-shimmer" : undefined}>{verdict}</b>
            {review.round > 1 && <span className="lc-quiet">round {review.round}</span>}
            {has && <Chev className="lc-foot-chev" />}
          </button>
        )}
      </div>
      {review && has && open && (
        <div className="lc-foot-findings">
          {review.summary && <p>{review.summary}</p>}
          {review.findings.map((f, i) => (
            <button key={i} type="button" className="lc-foot-f l-focus" data-sev={f.severity} onClick={() => onReview("all", f.file)}>
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
