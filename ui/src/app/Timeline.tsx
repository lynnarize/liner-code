/*
  A session's timeline, turn by turn, kept compact. Each turn opens with who worked and on what,
  then its work as a trail of steps, each a line with the fact that matters under it; the trail
  is open and moving while the turn runs and folds to one line when it ends. Anything that needs
  you (a request, a question, a plan) waits in place. The answer follows, and the turn ends with
  one line: what changed, and the Reviewer's verdict.
*/
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PR_TEST_TOOL, type Item, type ProviderInfo, type AgentProfile } from "@contracts";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { isCheckpoint, rpc, threadOf, useEngine, useItems, useItemsWhere } from "./engine";
import { I, ModelMark, Rays } from "./icons";
import { PageCard } from "./Page";
import { PrChatCard } from "./Pr";
import { ApprovalCard } from "@liner/pro/approval-card/approval-card";
import { Dialog } from "@liner/components/dialog/dialog";
import { agentOf, clock, duration, isModelAgent, markOf, modelLabel, onClaude, plural, sumLines, turnsOf } from "./model";
import { Badge, Disc, Lines, ModelTag, Num, Pop, Row as PickRow } from "./ui";
import { toast } from "@liner/components/toast/toast";
import { Progress } from "@liner/components/progress/progress";
import { Boundary } from "./Boundary";
import { bridge } from "./bridge";
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
    if (it.kind !== "approval" || it.state === "asking" || it.tool === PR_TEST_TOOL) continue;
    const free = (x: Item): x is Tool => x.kind === "tool" && x.tool === it.tool && !byTool.has(x.id);
    const call = it.toolId ? calls.find((c) => c.id === it.toolId) : (items.slice(0, i).findLast(free) ?? items.slice(i + 1).find(free));
    if (call && !byTool.has(call.id)) byTool.set(call.id, it);
  }
  return byTool;
}

/** What became of an answered ask, as its call's row says it. */
const askWord = (a: Ask) => (a.state === "approved" ? (a.reviewer ? "Reviewer allowed" : "You allowed") : a.state === "denied" ? "You said no" : "Not answered");

/**
  What became of a step's asks: one says why; several (a run of edits) say each answer once, with
  how many times, as "✓ Reviewer allowed ×3".
*/
function asked(said: Ask[]): ReactNode[] {
  if (said.length === 1) {
    const a = said[0];
    return [
      <span className={a.state === "approved" ? "lc-good" : "lc-bad"}>
        {a.state === "approved" ? "✓" : "✕"} {askWord(a)}
        {a.reason && <span className="lc-quiet">: {a.reason.length > 80 ? `${a.reason.slice(0, 79)}…` : a.reason}</span>}
      </span>,
    ];
  }
  const words = new Map<string, Ask[]>();
  for (const a of said) words.set(askWord(a), [...(words.get(askWord(a)) ?? []), a]);
  return [...words].map(([word, list]) => (
    <span className={list[0].state === "approved" ? "lc-good" : "lc-bad"}>
      {list[0].state === "approved" ? "✓" : "✕"} {word}
      {list.length > 1 && ` ×${list.length}`}
    </span>
  ));
}
type Checkpoint = Extract<Item, { kind: "checkpoint" }>;
type Review = Extract<Item, { kind: "review" }>;
/** What a turn's trail holds, in order: its tool calls, its thinking, what the agent says between steps, and asks waiting on you. */
type Entry = { kind: "tool"; it: Tool } | { kind: "thought"; it: Extract<Item, { kind: "reasoning" }> } | { kind: "say"; it: Extract<Item, { kind: "text" }> } | { kind: "ask"; it: Ask };

const CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode", "mcp__liner__show_page", "liner.show_page"]);
/** A lead wraps the plan it hands over in <plan> tags; the plan card shows it, so the text drops the tags. */
const untag = (text: string) => text.replace(/<\/?plan\b[^>]*>/g, "");

/** A plan being written in a lead's reply: what it said before the plan, the plan so far, and its title once the tag has one. */
function draftOf(text: string) {
  const m = /<plan\b([^>]*)>?/.exec(text);
  if (!m) return null;
  const title = /title\s*=\s*"([^"]+)"/.exec(m[1])?.[1]?.trim();
  return { before: text.slice(0, m.index), plan: text.slice(m.index + m[0].length).replace(/<\/plan>[\s\S]*$/, "").trim(), title: title || undefined };
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
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** A callback that keeps one identity while it calls the latest one given, so it doesn't redraw what it's handed to. */
function useSteady<A extends unknown[]>(fn: ((...a: A) => void) | undefined) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current?.(...a), []);
}

export function Timeline({ threadId, items: given, seen, onReview, reviewing, onGrow }: Props) {
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
      {turns.map(({ turn, items: list }) => (
        // One turn that can't show says so in its place; the rest of the thread stays (T3 Code's RenderErrorBoundary).
        <Boundary key={turn} label="This turn" quiet>
          <Turn threadId={threadId} items={list} agents={agents} providers={providers} seen={seen} onReview={review} reviewing={reviewing} onGrow={grow} />
        </Boundary>
      ))}
    </div>
  );
}

const Turn = memo(function Turn({ threadId, items, agents, providers, seen, onReview, reviewing, onGrow }: { threadId: string; items: Item[]; agents: AgentProfile[]; providers: ProviderInfo[] } & Omit<Props, "items" | "threadId">) {
  const marker = items.find((x) => x.kind === "turn");
  const running = marker?.kind === "turn" && marker.status === "running";
  const who = whoOf(marker, agents, providers);
  // `id` is the item a block stands for, when its key isn't one (a trail, a plan's draft).
  const blocks: { key: string; id?: string; node: ReactNode }[] = [];
  const asks = useMemo(() => foldedAsks(items), [items]);
  const folded = new Set([...asks.values()].map((a) => a.id));
  const fresh = (id: string) => !seen.has(id);
  // The PR card's own test run and its request sit with the card, not in the trail.
  const prRun = items.findLast((x): x is Tool => x.kind === "tool" && x.tool === PR_TEST_TOOL);
  const prAsk = items.find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.tool === PR_TEST_TOOL && x.state === "asking");
  const escalation = (it: Item) => it.kind === "tool" && it.toolKind === "task" && /^Opus\b/.test(it.title);
  const inTrail = (it: Item) => (it.kind === "tool" && it.tool !== PR_TEST_TOOL && !CARD_TOOLS.has(it.tool) && !escalation(it)) || (it.kind === "approval" && it.tool !== PR_TEST_TOOL && !folded.has(it.id));
  // The trail runs to the turn's last step: thinking and what's said before it are part of the work; after it, the answer.
  const lastStep = items.findLastIndex(inTrail);
  const cp = items.find((x): x is Checkpoint => x.kind === "checkpoint");
  const review = items.findLast((x): x is Review => x.kind === "review");
  // A plan still being written (a lead's <plan>, or Claude Code's plan mode filling in its call) is one quiet line until its card comes.
  const unplanned = (i: number) => running && !items.slice(i + 1).some((x) => x.kind === "proposal");
  let run: Entry[] = [];
  const flush = () => {
    if (!run.length) return;
    const entries = run;
    run = [];
    // Thinking or a remark with no step beside it (before a plan card, say) isn't a trail of its own.
    if (!entries.some((e) => e.kind === "tool" || e.kind === "ask")) {
      for (const e of entries)
        if (e.kind === "thought") blocks.push({ key: e.it.id, node: <Thought it={e.it} /> });
        else if (e.kind === "say") blocks.push({ key: e.it.id, node: <StreamedMarkdown className="lc-md" text={untag(e.it.text)} streaming={e.it.streaming} animate={fresh(e.it.id)} onGrow={onGrow} /> });
      return;
    }
    blocks.push({ key: `t${entries[0].it.id}`, id: entries[0].it.id, node: <Trail threadId={threadId} entries={entries} asks={asks} cp={cp} live={running} who={who} onReview={onReview} /> });
  };
  for (const [i, it] of items.entries()) {
    if ((it.kind === "tool" || it.kind === "approval") && it.tool === PR_TEST_TOOL) continue;
    // Thinking too short to show leaves no row, so the steps either side stay one.
    if (it.kind === "reasoning" && !shown(it)) continue;
    // Answered, it's a word on its step's result, and the steps either side stay one trail.
    if (it.kind === "approval" && folded.has(it.id)) continue;
    // Asking you and handing over a plan show as their own cards, not as steps too.
    if (it.kind === "tool" && CARD_TOOLS.has(it.tool)) {
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
    else if (it.kind === "approval") run.push({ kind: "ask", it });
    else if (it.kind === "reasoning" && i < lastStep) run.push({ kind: "thought", it });
    else if (it.kind === "text" && i < lastStep) run.push({ kind: "say", it });
    else {
      flush();
      if (it.kind === "user") blocks.push({ key: it.id, node: <You threadId={threadId} it={it} fresh={fresh(it.id)} onReview={onReview} /> });
      else if (it.kind === "turn") blocks.push({ key: it.id, node: <TurnHead it={it} items={items} agents={agents} providers={providers} /> });
      else if (it.kind === "reasoning") blocks.push({ key: it.id, node: <Thought it={it} /> });
      else if (it.kind === "text") {
        const draft = marker?.kind === "turn" && marker.planning && unplanned(i) ? draftOf(it.text) : null;
        if (!draft) blocks.push({ key: it.id, node: <StreamedMarkdown className="lc-md" text={untag(it.text)} streaming={it.streaming} animate={fresh(it.id)} onGrow={onGrow} /> });
        else {
          if (draft.before.trim()) blocks.push({ key: it.id, node: <StreamedMarkdown className="lc-md" text={draft.before} streaming={false} animate={fresh(it.id)} onGrow={onGrow} /> });
          blocks.push({ key: `${it.id}-plan`, id: it.id, node: <PlanDraft text={draft.plan} title={draft.title} /> });
        }
      }
      else if (it.kind === "plan") blocks.push({ key: it.id, node: <Todo it={it} /> });
      else if (it.kind === "page") blocks.push({ key: it.id, node: <PageCard it={it} /> });
      else if (it.kind === "pr") blocks.push({ key: it.id, node: <PrChatCard threadId={threadId} it={it} fresh={fresh(it.id)} run={prRun} ask={prAsk && ((w) => <Approval key={prAsk.id} threadId={threadId} it={prAsk} who={w} />)} /> });
      else if (it.kind === "question") blocks.push({ key: it.id, node: <QuestionCard threadId={threadId} it={it} who={who} /> });
      else if (it.kind === "proposal") blocks.push({ key: it.id, node: <Proposal threadId={threadId} it={it} who={who} /> });
      // The turn's last line: what changed, and the Reviewer's verdict on it, side by side.
      else if (it.kind === "checkpoint") blocks.push({ key: it.id, node: <TurnFoot cp={it} review={review} providers={providers} onReview={onReview} reviewing={reviewing} /> });
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
      else if (it.kind === "notice") blocks.push({ key: it.id, node: <p className="lc-notice">{it.text}</p> });
    }
  }
  flush();
  return (
    <section className="lc-turn" data-running={running || undefined}>
      {blocks.map((b) => (
        // data-item lets the session find a block: the prompt minimap scrolls to your messages by it.
        <div key={b.key} className="lc-blk" data-item={b.id ?? b.key} data-fresh={fresh(b.id ?? b.key) || undefined}>
          {b.node}
        </div>
      ))}
    </section>
  );
});

const whoOf = (marker: Item | undefined, agents: AgentProfile[], providers: ProviderInfo[]) => (marker?.kind === "turn" ? agentOf(marker.agent, agents, providers).name : "The agent");

/** Who worked, on what model, and how long: "Forge ◑ Sonnet 5.5 · Turn 2 · worked for 3m 43s". */
function TurnHead({ it, items, agents, providers }: { it: Extract<Item, { kind: "turn" }>; items: Item[]; agents: AgentProfile[]; providers: ProviderInfo[] }) {
  const a = agentOf(it.agent, agents, providers);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (it.status !== "running") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [it.status]);
  const last = [...items].reverse().find((x): x is Tool => x.kind === "tool" && x.status === "running");
  const thinking = items.some((x) => x.kind === "reasoning" && x.streaming);
  const asking = items.some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
  const drafting = it.planning && items.some((x) => x.kind === "text" && x.streaming && /<plan\b/.test(x.text));
  const doing = asking ? "is waiting for you" : last ? verb(last) : drafting ? "is writing the plan" : thinking ? "is thinking" : "is working";
  const took = it.status === "running" ? (now - it.at) / 1000 : it.seconds;
  // A lead's turn that ended in a plan "planned"; one that only answered "worked", like any other.
  const planned = it.planning && items.some((x) => x.kind === "proposal");
  // A model on its own is named after the model, so its mark sits on the disc instead of a tag.
  const alone = isModelAgent(it.agent);
  const plan = items.findLast((x): x is Extract<Item, { kind: "plan" }> => x.kind === "plan");
  const progress = plan?.entries.length ? plan.entries.filter((e) => e.status === "completed").length / plan.entries.length : undefined;
  return (
    <div className="lc-head" data-running={it.status === "running" || undefined}>
      {alone ? (
        <span className="lc-disc lc-disc-model" style={{ width: 22, height: 22 }} aria-hidden>
          <ModelMark kind={markOf(it.model)} size={13} />
        </span>
      ) : (
        <Disc agent={a} size={22} lead={it.planning || undefined} />
      )}
      <b>{a.name}</b>
      {!alone && <ModelTag kind={markOf(it.model)} label={modelLabel(it.model, providers)} />}
      {it.status === "running" ? (
        <span className="lc-head-live l-shimmer" key={doing}>
          {doing}
        </span>
      ) : (
        <span className="lc-head-meta">
          · {took === undefined ? (it.status === "stopped" ? "stopped" : it.status === "error" ? "stopped with a problem" : planned ? "planned" : "done") : `${it.status === "stopped" ? "stopped after " : it.status === "error" ? "stopped with a problem after " : planned ? "planned in " : ""}${duration(took)}`}
        </span>
      )}
      <span className="lc-grow" />
      {it.status === "running" && <span className="lc-head-clock lc-mono">{duration(took)}</span>}
      <span className="lc-head-meta">Turn {it.turn}</span>
      {/* How far it has got: its plan's steps done, when it keeps one; a calm sweep while it doesn't. */}
      {it.status === "running" && <Progress className="lc-head-bar" size="sm" value={progress} showValue={false} />}
    </div>
  );
}

function verb(t: Tool) {
  const p = t.path ? t.path.split("/").pop() : undefined;
  if (t.tool === "ExitPlanMode") return "is writing the plan";
  if (t.toolKind === "edit" || t.toolKind === "write") return `is editing ${p ?? "a file"}`;
  if (t.toolKind === "read") return `is reading ${p ?? "a file"}`;
  if (t.toolKind === "search") return "is searching the code";
  if (t.toolKind === "exec") return `is running ${t.title.replace(/^Run /, "").slice(0, 40)}`;
  if (t.toolKind === "web" || t.toolKind === "fetch") return "is reading the web";
  if (t.toolKind === "task") return "is working with a subagent";
  return `is using ${t.tool}`;
}

/** Thinking under 3 seconds isn't worth a line once it's done; nor is a row for it, which would leave a gap. */
const shown = (it: Extract<Item, { kind: "reasoning" }>) => Boolean(it.text.trim()) && (it.streaming || (it.seconds ?? 0) >= 3);

/** Thinking: a quiet fold that says how long it took, marked like the trail: a dot, then the words and the chevron. On the trail its dot sits on the rail. */
function Thought({ it }: { it: Extract<Item, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  if (!shown(it)) return null;
  return (
    <div className="lc-thought" data-open={open || undefined} data-live={it.streaming || undefined}>
      <button type="button" className="lc-thought-h l-focus" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="lc-thought-dot" aria-hidden />
        <span className={it.streaming ? "l-shimmer" : undefined}>{it.streaming ? "Thinking" : `Thought ${duration(it.seconds)}`}</span>
        <Chev className="lc-thought-chev" />
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
        <span className="lc-thought-dot" aria-hidden />
        <span className="l-shimmer">{title ? `Generating the plan: ${title}` : "Generating the plan"}</span>
        {steps > 0 && <span className="l-num">· {plural(steps, "step")} so far</span>}
        {text && <Chev className="lc-thought-chev" />}
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

const Chev = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Liner Code's own Browser tools, under either way an agent tool names them. */
const BROWSER = /^(?:mcp__liner__|liner\.)browser_(\w+)/;
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
/** `diff`: the file in the turn's checkpoint an edit step changed, which a press opens in the Diff. */
type TrailStep = { key: string; tools: Tool[]; verb: string; target?: string; result?: ReactNode; state: "running" | "done" | "failed"; at: number; seconds: number; tail?: string; diff?: string };
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
function trailSteps(tools: Tool[], cp?: Checkpoint): TrailStep[] {
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
    if (t.toolKind === "read") {
      const names = [...new Set(g.map((x) => nameOf(x.path ?? x.title.replace(/^Read\s+/, ""))))];
      return { ...base, verb: "Read", target: names.length === 1 ? names[0] : `${names.length} files`, result: names.length > 1 ? clip(names.join(", ")) : undefined };
    }
    if (t.toolKind === "search") {
      const hits = t.output ? t.output.split("\n").filter(Boolean).length : 0;
      return { ...base, verb: "Searched", target: t.title.replace(/^Search(?:ed)?(?: the code)?(?: for)?\s*/i, "") || undefined, result: t.output !== undefined ? (hits ? plural(hits, "match", "matches") : "nothing found") : undefined };
    }
    if (writes(t)) {
      const f = t.path ? cp?.files.find((x) => x.path === t.path || t.path!.endsWith(`/${x.path}`)) : undefined;
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
  });
}

/**
  A turn's work as a trail of steps: each a line, and the fact that matters under it (what Claude
  Code shows). While the turn runs the trail is open: the step at work pulses, counts up and shows
  its last output, new steps slide in, and the rail carries a moving light. When the turn ends it
  folds by itself to one line that keeps the highlights; it opens again with a press.
*/
function Trail({ threadId, entries, asks, cp, live, who, onReview }: { threadId: string; entries: Entry[]; asks: Map<string, Ask>; cp?: Checkpoint; live: boolean; who: string; onReview: (checkpointId: string, path?: string) => void }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const isOpen = open ?? live;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  // Steps in the order they came, with thinking, what was said and asks between them.
  const list = useMemo(() => {
    const out: Row[] = [];
    let tools: Tool[] = [];
    const flush = () => {
      for (const step of trailSteps(tools, cp)) out.push({ kind: "step", step });
      tools = [];
    };
    for (const e of entries) {
      if (e.kind === "tool") tools.push(e.it);
      else {
        flush();
        out.push(e);
      }
    }
    flush();
    return out;
  }, [entries, cp]);
  const steps = list.filter((r): r is { kind: "step"; step: TrailStep } => r.kind === "step").map((r) => r.step);
  const failed = steps.filter((s) => s.state === "failed").length;
  // From its first step to its last, since calls run side by side and some wait on you.
  const secs = steps.length ? (Math.max(...steps.map((s) => s.at + s.seconds * 1000)) - Math.min(...steps.map((s) => s.at))) / 1000 : 0;
  // Folded, the line keeps what it changed, what it ran and whether it checked its work.
  const tools = steps.flatMap((s) => s.tools);
  const paths = [...new Set(tools.filter((t) => (t.toolKind === "edit" || t.toolKind === "write") && t.path).map((t) => t.path!))];
  const edited = [...new Set(paths.map(nameOf))];
  const ran = tools.filter((t) => t.toolKind === "exec").length;
  const checked = tools.some((t) => BROWSER.test(t.tool));
  // The lines of the files it names; what its commands changed besides shows on the turn's last line.
  const mine = cp?.files.filter((f) => paths.some((p) => p === f.path || p.endsWith(`/${f.path}`))) ?? [];
  const lines = mine.length ? sumLines(mine) : null;
  const parts: ReactNode[] = [
    edited.length > 0 && (
      <span key="e">
        {edited.length <= 2 ? `Edited ${edited.join(" and ")}` : `Edited ${edited.length} files`}
        {lines && (
          <>
            {" "}
            <Lines {...lines} />
          </>
        )}
      </span>
    ),
    ran > 0 && <span key="r">{`${edited.length ? "ran" : "Ran"} ${plural(ran, "command")}`}</span>,
    checked && <span key="b">{edited.length || ran ? "checked" : "Checked"} the Browser</span>,
    !edited.length && !ran && !checked && <span key="s">{plural(steps.length, "step")}</span>,
  ].filter(Boolean);
  return (
    <div className="lc-trail" data-open={isOpen || undefined} data-live={live || undefined}>
      <button type="button" className="lc-trail-sum l-focus" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <span className="lc-trail-mark" data-state={live ? "running" : failed ? "failed" : "done"} aria-hidden />
        {live ? (
          <span className="l-shimmer">
            {who} is working · {plural(steps.length, "step")} so far
          </span>
        ) : (
          <span className="lc-trail-parts">
            {parts.map((p, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {p}
              </span>
            ))}
          </span>
        )}
        {failed > 0 && <Badge tone="danger">{failed} failed</Badge>}
        {!live && secs > 0 && <span className="lc-quiet l-num">{duration(secs)}</span>}
        <Chev className="lc-trail-chev" />
      </button>
      <div className="lc-trail-fold" inert={!isOpen || undefined}>
        <ol className="lc-trail-list">
          {list.map((r, i) => {
            if (r.kind === "thought")
              return (
                <li key={r.it.id} className="lc-trail-note">
                  <Thought it={r.it} />
                </li>
              );
            if (r.kind === "say")
              return (
                <li key={r.it.id} className="lc-trail-say">
                  {clip(untag(draftOf(r.it.text)?.before ?? r.it.text).replace(/\s+/g, " ").trim(), 400)}
                </li>
              );
            if (r.kind === "ask")
              return (
                <li key={r.it.id} className="lc-trail-ask">
                  <Approval threadId={threadId} it={r.it} who={who} />
                </li>
              );
            const s = r.step;
            const said = s.tools.flatMap((t) => asks.get(t.id) ?? []);
            // A step you said no to failed because of it: your no says so, once.
            const result = said.length && said.every((a) => a.state === "denied") ? undefined : s.result;
            // An edit with its file in the turn's checkpoint opens the Diff at that file; the diff says more than the edit's input.
            const diff = s.diff && cp ? { id: cp.id, path: s.diff } : null;
            const has = !diff && (s.tools.some((t) => t.input || t.output) || said.some((a) => a.reason));
            const rowOpen = rows.includes(s.key);
            return (
              <li key={s.key} className="lc-tstep" data-state={s.state} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                <button
                  type="button"
                  className="lc-tstep-line l-focus"
                  data-diff={diff ? true : undefined}
                  aria-expanded={has ? rowOpen : undefined}
                  disabled={!has && !diff}
                  title={diff ? `Show ${nameOf(diff.path)} in the Diff` : undefined}
                  onClick={() => (diff ? onReview(diff.id, diff.path) : setRows((x) => (x.includes(s.key) ? x.filter((k) => k !== s.key) : [...x, s.key])))}
                >
                  <span className="lc-tstep-dot" aria-hidden />
                  <b className={s.state === "running" ? "lc-tstep-verb l-shimmer" : "lc-tstep-verb"}>{s.verb}</b>
                  {s.target && <code className="lc-tstep-target">{s.target}</code>}
                  {diff && <span className="lc-tstep-go" aria-hidden>Diff ›</span>}
                  <span className="lc-grow" />
                  <span className="lc-tstep-time l-num">{s.state === "running" ? (now - s.at >= 2000 ? duration((now - s.at) / 1000) : "") : s.seconds >= 1 ? duration(s.seconds) : ""}</span>
                </button>
                {(result || said.length > 0) && <div className="lc-tstep-res">{joined([result, ...asked(said)])}</div>}
                {s.tail && <pre className="lc-tstep-tail">{s.tail}</pre>}
                {has && rowOpen && (
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
          })}
        </ol>
      </div>
    </div>
  );
}

function Todo({ it }: { it: Extract<Item, { kind: "plan" }> }) {
  const done = it.entries.filter((e) => e.status === "completed").length;
  return (
    <div className="lc-todo lc-frame">
      <div className="lc-fcard">
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
                {e.status === "completed" ? <I.check size={11} /> : e.status === "in_progress" ? <Rays size={10} /> : null}
              </span>
              <span className={e.status === "in_progress" ? "l-shimmer" : undefined}>{e.title}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}


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
          // A command is shown whole: what runs is what you read.
          value: f.label === "Command" || f.label === "File" ? <code className="lc-ask-cmd">{f.value.replace(/^\/Users\/[^/]+/, "~")}</code> : f.value.replace(/^\/Users\/[^/]+/, "~"),
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
  const OTHER = "Something else";
  const chosen = picks[q.question];
  const last = at === it.questions.length - 1;
  const answers = () =>
    Object.fromEntries(it.questions.map((x) => [x.question, picks[x.question] === OTHER ? other[x.question] || OTHER : (picks[x.question] ?? x.options[0]?.label ?? "")]));
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
            const on = (chosen ?? q.options[0]?.label) === o.label;
            return (
              <div key={o.label} className="lc-opt" role="radio" aria-checked={on} tabIndex={0} data-on={on || undefined} onClick={() => setPicks((p) => ({ ...p, [q.question]: o.label }))} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setPicks((p) => ({ ...p, [q.question]: o.label }))}>
                <span className="lc-radio" data-on={on || undefined} />
                <span>
                  <b>
                    {o.label}
                    {"suggested" in o && o.suggested && <Badge tone="accent" dot={false}>{who} suggests</Badge>}
                  </b>
                  {o.description && <small>{o.description}</small>}
                  {o.label === OTHER && on && <textarea className="lc-else" autoFocus placeholder="Say what you would like instead" value={other[q.question] ?? ""} onChange={(e) => setOther((x) => ({ ...x, [q.question]: e.target.value }))} onClick={(e) => e.stopPropagation()} />}
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
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => (last ? void submit() : setAt(at + 1))}>
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
  { id: "escalate", label: "Sonnet, Opus when stuck", note: "Lowest cost on routine work" },
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
  const team = [coder, ...(thread?.helpers ?? []).map((h) => agentOf(h, agents, providers))];
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
  const claude = onClaude(coder.model);
  const mode = RUN_MODES.find((m) => m.id === (coder.runMode ?? "helpers")) ?? RUN_MODES[0];
  const setMode = (runMode: (typeof RUN_MODES)[number]["id"]) => void rpc("agents.save", { agents: agents.map((a) => (a.id === coder.id ? { ...a, runMode } : a)) }).catch(fail);
  const answer = (approve: boolean) => rpc("proposal.answer", { threadId, itemId: it.id, approve, note: approve ? undefined : note.trim(), plan: approve && edit ? planOf(it.title, edit, coder.name) : undefined }).catch(fail);
  const move = (i: number, d: number) => setEdit((e) => {
    const list = [...(e ?? parsed)];
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
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
          <span>{coder.name} builds it on</span>
          {claude ? (
            <Pop label={`How ${coder.name} runs`} width={290} triggerClass="lc-btn lc-plan-modeb" trigger={<>{mode.id === "helpers" ? `${modelLabel(thread?.model ?? coder.model, providers)}, with helpers` : mode.id === "escalate" ? "Sonnet, Opus when stuck" : `${modelLabel(thread?.model ?? coder.model, providers)} alone`}<I.chevD size={11} /></>}>
              {(close) => (
                <>
                  {RUN_MODES.map((m) => (
                    <PickRow key={m.id} title={m.label} note={m.note} on={m.id === mode.id} onPick={() => (setMode(m.id), close())} />
                  ))}
                </>
              )}
            </Pop>
          ) : (
            <b>{modelLabel(thread?.model ?? coder.model, providers)}</b>
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
            <input className="lc-input" placeholder={`Or tell ${who} what to change`} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && note.trim() && void answer(false)} />
            <div className="lc-ask-foot">
              <span className="lc-quiet">{edit ? "Your edits go to the plan as you approve it" : "Nothing runs until you approve"}</span>
              <span className="lc-grow" />
              {note.trim() ? (
                <button type="button" className="lc-btn" data-kind="plain" onClick={() => void answer(false)}>
                  Send changes
                </button>
              ) : steps.length > 0 ? (
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

const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

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
  const said = it.files?.length ? it.text.replace(/\n*I attached: [^\n]*$/, "") : it.text;
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
    try {
      const r = await rpc("thread.rewind", { threadId, itemId: it.id, files: revertFiles, force });
      await rpc("thread.send", { id: threadId, text });
      toast(`Went back to turn ${r.turn}`, { description: revertFiles && r.files ? `${plural(r.files, "file")} back as they were` : "The files stay as they are" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
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
          {it.anchor.file.split("/").pop()}, {it.anchor.endLine && it.anchor.endLine !== it.anchor.line ? `lines ${it.anchor.line}–${it.anchor.endLine}` : `line ${it.anchor.line}`}
        </button>
      )}
      {it.files && it.files.length > 0 && <Attachments files={it.files} />}
      {said && <p>{said}</p>}
      {!it.steer && it.turn > 0 && (
        <span className="lc-you-more">
          <button type="button" className="lc-you-btn l-focus" disabled={running} title={running ? "Stop the turn to edit from here" : "Edit this message and go back to it"} onClick={() => setEdit(it.text)}>
            <I.edit size={12} />
            Edit from here
          </button>
          <button type="button" className="lc-you-btn l-focus" title="Copy" aria-label="Copy the message" onClick={() => void navigator.clipboard?.writeText(it.text).then(() => toast("Copied"))}>
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
          <button key={f} type="button" className="lc-you-chip l-focus" title={`${attachedName(f)}: show in Finder`} onClick={() => bridge.reveal(f)}>
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
            Show in Finder
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
  A turn's last line: what it changed (Review opens the diff) and the Reviewer's verdict, side by
  side. Its findings open under the line; blockers open by themselves, notes wait for a press.
*/
function TurnFoot({ cp, review, providers, onReview, reviewing }: { cp?: Checkpoint; review?: Review; providers: ProviderInfo[]; onReview: (checkpointId: string, path?: string) => void; reviewing?: { id: string; path?: string } | null }) {
  const blocked = review?.status === "blocked";
  const [open, setOpen] = useState(blocked);
  useEffect(() => {
    if (blocked) setOpen(true);
  }, [blocked]);
  const here = Boolean(cp && reviewing?.id === cp.id);
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
            <button type="button" className="lc-foot-chip l-focus" aria-current={here || undefined} onClick={() => onReview(cp.id, cp.files[0]?.path)}>
              {plural(cp.files.length, "file")} <Lines {...sumLines(cp.files)} />
              <span className="lc-quiet">{here ? "In the panel" : "Review ›"}</span>
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
