/*
  A session's timeline, turn by turn. Each turn opens with who worked and on what, then shows
  the work as it happens: thinking folds away, tool calls gather in one card, and anything that
  needs you (a request, a question, a plan) waits as a card you answer in place. A turn that
  changed files ends with one line: the files, the lines, and Review.
*/
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PR_TEST_TOOL, type Item, type ProviderInfo, type AgentProfile } from "@contracts";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { rpc, threadOf, useEngine } from "./engine";
import { I, ModelMark, Rays, ToolIcon } from "./icons";
import { PageCard } from "./Page";
import { PrChatCard } from "./Pr";
import { ApprovalCard } from "@liner/pro/approval-card/approval-card";
import { AiMark } from "@liner/pro/ai-kit/marks";
import "@liner/pro/tool-calls/tool-calls.css";
import { agentOf, clock, duration, isModelAgent, markOf, modelLabel, onClaude, plural, sumLines, turnsOf } from "./model";
import { Badge, Disc, Lines, ModelTag, Num, Pop, Row as PickRow } from "./ui";
import { toast } from "@liner/components/toast/toast";

type Tool = Extract<Item, { kind: "tool" }>;
type Checkpoint = Extract<Item, { kind: "checkpoint" }>;

const CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode", "mcp__liner__show_page", "liner.show_page"]);
/** A lead wraps the plan it hands over in <plan> tags; the plan card shows it, so the text drops the tags. */
const untag = (text: string) => text.replace(/<\/?plan\b[^>]*>/g, "");

type Props = {
  threadId: string;
  items: Item[];
  /** Items present when the session opened render at once; newer ones animate in. */
  seen: Set<string>;
  onReview: (checkpointId: string, path?: string) => void;
  reviewing?: { id: string; path?: string } | null;
  onGrow?: () => void;
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function Timeline({ threadId, items, seen, onReview, reviewing, onGrow }: Props) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const turns = useMemo(() => turnsOf(items), [items]);
  return (
    <div className="lc-tl">
      {turns.map(({ turn, items: list }) => (
        <Turn key={turn} threadId={threadId} items={list} agents={agents} providers={providers} seen={seen} onReview={onReview} reviewing={reviewing} onGrow={onGrow} />
      ))}
    </div>
  );
}

function Turn({ threadId, items, agents, providers, seen, onReview, reviewing, onGrow }: { threadId: string; items: Item[]; agents: AgentProfile[]; providers: ProviderInfo[] } & Omit<Props, "items" | "threadId">) {
  const marker = items.find((x) => x.kind === "turn");
  const running = marker?.kind === "turn" && marker.status === "running";
  // Consecutive tool calls gather into one work card.
  const blocks: { key: string; node: ReactNode }[] = [];
  let run: Tool[] = [];
  const flush = () => {
    if (!run.length) return;
    const tools = run;
    blocks.push({ key: `w${tools[0].id}`, node: <Work tools={tools} live={running && tools.some((t) => t.status === "running")} who={marker?.kind === "turn" ? agentOf(marker.agent, agents, providers).name : "The agent"} /> });
    run = [];
  };
  const fresh = (id: string) => !seen.has(id);
  // The PR card's own test run and its request sit with the card, not in the work card.
  const prRun = items.findLast((x): x is Tool => x.kind === "tool" && x.tool === PR_TEST_TOOL);
  const prAsk = items.find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.tool === PR_TEST_TOOL && x.state === "asking");
  for (const it of items) {
    if ((it.kind === "tool" || it.kind === "approval") && it.tool === PR_TEST_TOOL) continue;
    // Asking you and handing over a plan show as their own cards, not as tool rows too.
    if (it.kind === "tool" && CARD_TOOLS.has(it.tool)) continue;
    // Asking Opus to plan (Sonnet that escalates) is its own line, not one more tool call.
    if (it.kind === "tool" && it.toolKind === "task" && /^Opus\b/.test(it.title)) {
      flush();
      blocks.push({ key: it.id, node: <Escalation it={it} providers={providers} /> });
      continue;
    }
    if (it.kind === "tool") {
      run.push(it);
      continue;
    }
    flush();
    if (it.kind === "user") blocks.push({ key: it.id, node: <You threadId={threadId} it={it} fresh={fresh(it.id)} onReview={onReview} /> });
    else if (it.kind === "turn") blocks.push({ key: it.id, node: <TurnHead it={it} items={items} agents={agents} providers={providers} /> });
    else if (it.kind === "reasoning") blocks.push({ key: it.id, node: <Thought it={it} /> });
    else if (it.kind === "text") blocks.push({ key: it.id, node: <StreamedMarkdown className="lc-md" text={untag(it.text)} streaming={it.streaming} animate={fresh(it.id)} onGrow={onGrow} /> });
    else if (it.kind === "plan") blocks.push({ key: it.id, node: <Todo it={it} /> });
    else if (it.kind === "page") blocks.push({ key: it.id, node: <PageCard it={it} /> });
    else if (it.kind === "pr") blocks.push({ key: it.id, node: <PrChatCard threadId={threadId} it={it} fresh={fresh(it.id)} run={prRun} ask={prAsk && ((who) => <Approval key={prAsk.id} threadId={threadId} it={prAsk} who={who} />)} /> });
    else if (it.kind === "approval") blocks.push({ key: it.id, node: <Approval threadId={threadId} it={it} who={whoOf(marker, agents, providers)} /> });
    else if (it.kind === "question") blocks.push({ key: it.id, node: <QuestionCard threadId={threadId} it={it} who={whoOf(marker, agents, providers)} /> });
    else if (it.kind === "proposal") blocks.push({ key: it.id, node: <Proposal threadId={threadId} it={it} who={whoOf(marker, agents, providers)} /> });
    else if (it.kind === "checkpoint") blocks.push({ key: it.id, node: <ChangesCard it={it} onReview={onReview} reviewing={reviewing} /> });
    else if (it.kind === "review") blocks.push({ key: it.id, node: <ReviewRow it={it} providers={providers} onReview={onReview} /> });
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
  flush();
  // While it works, the files it touches gather in a live card before the turn's checkpoint lands.
  if (running && !items.some((x) => x.kind === "checkpoint")) {
    const edits = items.filter((x): x is Tool => x.kind === "tool" && (x.toolKind === "edit" || x.toolKind === "write") && Boolean(x.path));
    if (edits.length) blocks.push({ key: "live", node: <LiveChanges edits={edits} /> });
  }
  return (
    <section className="lc-turn" data-running={running || undefined}>
      {blocks.map((b) => (
        <div key={b.key} className="lc-blk" data-fresh={fresh(b.key) || undefined}>
          {b.node}
        </div>
      ))}
    </section>
  );
}

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
  const doing = asking ? "is waiting for you" : last ? verb(last) : thinking ? "is thinking" : "is working";
  const took = it.status === "running" ? (now - it.at) / 1000 : it.seconds;
  // A lead's turn that ended in a plan "planned"; one that only answered "worked", like any other.
  const planned = it.planning && items.some((x) => x.kind === "proposal");
  // A model on its own is named after the model, so its mark sits on the disc instead of a tag.
  const alone = isModelAgent(it.agent);
  return (
    <div className="lc-head">
      {alone ? (
        <span className="lc-disc lc-disc-model" style={{ width: 22, height: 22 }} aria-hidden>
          <ModelMark kind={markOf(it.model)} size={13} />
        </span>
      ) : (
        <Disc agent={a} size={22} lead={it.planning || undefined} />
      )}
      <b>{a.name}</b>
      {!alone && <ModelTag kind={markOf(it.model)} label={modelLabel(it.model, providers)} />}
      <span className="lc-head-meta">· Turn {it.turn}</span>
      {it.status === "running" ? (
        <span className="lc-head-live l-shimmer" key={doing}>
          {doing}
        </span>
      ) : (
        <span className="lc-head-meta">
          · {took === undefined ? (it.status === "stopped" ? "stopped" : it.status === "error" ? "stopped with a problem" : planned ? "planned" : "done") : `${it.status === "stopped" ? "stopped after" : it.status === "error" ? "stopped with a problem after" : planned ? "planned in" : "worked for"} ${duration(took)}`}
        </span>
      )}
      {it.status === "running" && <span className="lc-head-clock lc-mono">{duration(took)}</span>}
    </div>
  );
}

function verb(t: Tool) {
  const p = t.path ? t.path.split("/").pop() : undefined;
  if (t.toolKind === "edit" || t.toolKind === "write") return `is editing ${p ?? "a file"}`;
  if (t.toolKind === "read") return `is reading ${p ?? "a file"}`;
  if (t.toolKind === "search") return "is searching the code";
  if (t.toolKind === "exec") return `is running ${t.title.replace(/^Run /, "").slice(0, 40)}`;
  if (t.toolKind === "web" || t.toolKind === "fetch") return "is reading the web";
  if (t.toolKind === "task") return "is working with a subagent";
  return `is using ${t.tool}`;
}

/** Thinking: a quiet fold that says how long it took. */
function Thought({ it }: { it: Extract<Item, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  if (!it.text.trim()) return null;
  return (
    <div className="lc-thought" data-open={open || undefined}>
      <button type="button" className="lc-thought-h l-focus" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {/* Liner's AI mark breathes while it thinks; once it's done, the line folds like the rest. */}
        {it.streaming ? <AiMark phase="thinking" size={14} /> : <I.chevR size={12} />}
        <span className={it.streaming ? "l-shimmer" : undefined}>{it.streaming ? "Thinking" : (it.seconds ?? 0) < 1 ? "Thought briefly" : `Thought for ${duration(it.seconds)}`}</span>
      </button>
      <div className="lc-fold">
        <div>
          <p className="lc-thought-t">{it.text}</p>
        </div>
      </div>
    </div>
  );
}

const Chev = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A run of tool calls: one line that says what happened, open while it works. Liner's tool calls, in Liner Code's words. */
function Work({ tools, live, who }: { tools: Tool[]; live: boolean; who: string }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const isOpen = open ?? live;
  const edited = new Set(tools.filter((t) => (t.toolKind === "edit" || t.toolKind === "write") && t.path).map((t) => t.path)).size;
  const subs = tools.filter((t) => t.toolKind === "task").length;
  const ran = tools.filter((t) => t.toolKind === "exec").length;
  const read = tools.filter((t) => t.toolKind === "read").length;
  const failed = tools.filter((t) => t.status === "failed").length;
  const secs = tools.reduce((s, t) => s + (t.seconds ?? 0), 0);
  const parts = [subs && `ran ${plural(subs, "subagent")}`, ran && `ran ${plural(ran, "command")}`, read && `read ${plural(read, "file")}`, edited && `edited ${plural(edited, "file")}`].filter(Boolean) as string[];
  const summary = parts.length ? `${who} ${parts.slice(0, -1).join(", ")}${parts.length > 1 ? " and " : ""}${parts[parts.length - 1]}` : `${who} used ${plural(tools.length, "tool")}`;
  // The kinds of tool it reached for, as tiles on the line.
  const kinds = [...new Set(tools.map((t) => t.toolKind))].slice(0, 3);
  return (
    <div className="l-tcalls lc-tc" data-open={isOpen || undefined}>
      <button type="button" className="l-tcalls__sum l-focus" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <span className="l-tcalls__tiles" aria-hidden>
          {kinds.map((k) => (
            <span key={k} className="l-tcalls__tile">
              <ToolIcon kind={k} />
            </span>
          ))}
        </span>
        <span className={live ? "l-tcalls__word l-shimmer" : "l-tcalls__word"} key={summary}>
          {summary}
        </span>
        {failed > 0 && <Badge tone="danger">{failed} failed</Badge>}
        {!live && <span className="l-tcalls__secs l-num">· {duration(secs)}</span>}
        <Chev className="l-tcalls__chev" />
      </button>
      <div className="l-tcalls__fold" inert={!isOpen || undefined}>
        <ul className="l-tcalls__list">
          {tools.map((t, i) => {
            const has = Boolean(t.input || t.output);
            const rowOpen = rows.includes(t.id);
            const state = t.status === "running" ? "running" : t.status === "failed" ? "failed" : "done";
            return (
              <li key={t.id} className="l-tcalls__row" data-state={state} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <button type="button" className="l-tcalls__line l-focus" aria-expanded={has ? rowOpen : undefined} disabled={!has} onClick={() => setRows((r) => (r.includes(t.id) ? r.filter((x) => x !== t.id) : [...r, t.id]))}>
                  <span className="l-tcalls__tile">
                    <ToolIcon kind={t.toolKind} />
                  </span>
                  <span className="l-tcalls__label">{t.title}</span>
                  <code>{t.tool}</code>
                  <span className="l-tcalls__state" key={state}>
                    {state === "running" ? (
                      <Rays size={11} />
                    ) : state === "done" ? (
                      <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-tcalls__ok">
                        <path d="M3.8 8.4 6.6 11l5.6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-tcalls__bad">
                        <path d="m5 5 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    )}
                    <span className="l-sr-only">{state}</span>
                  </span>
                  <span className="l-tcalls__time l-num">{state === "running" ? "" : duration(t.seconds)}</span>
                  {has && <Chev className="l-tcalls__chev" />}
                </button>
                {has && (
                  <div className="l-tcalls__more" data-open={rowOpen || undefined} inert={!rowOpen || undefined}>
                    <div className="l-tcalls__detail">
                      {t.input && <pre className="lc-pre">{t.input}</pre>}
                      {t.output && <pre className="lc-pre" data-out>{t.output.length > 6000 ? `${t.output.slice(0, 6000)}\n…` : t.output}</pre>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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
    const text = s.replace(/\s*(?:—|-)\s*[\w./-]+\.[a-z]{1,5}\s*$/, "").replace(/\*\*/g, "");
    return { text, files };
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

type Step = { text: string; files: string[]; who?: string };
/** A step handed to someone: "… — @Herald" or "… (@Herald)". */
const ownerOf = (text: string, names: string[]) => {
  const m = /(?:—|-|\()\s*@([\w-]+)\)?\s*$/.exec(text);
  const who = m ? names.find((n) => n.toLowerCase() === m[1].toLowerCase()) : undefined;
  return { who, text: m && who ? text.slice(0, m.index).trim() : text };
};
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
  const parsed = useMemo(() => stepsOf(it.plan).map((s) => ({ ...s, ...ownerOf(s.text, names) })), [it.plan, names.join()]);
  const [edit, setEdit] = useState<Step[] | null>(null);
  const steps: Step[] = edit ?? parsed;
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
          <ol className="lc-steps" data-edit={edit ? true : undefined}>
            {steps.map((s, i) => {
              const owner = team.find((a) => a.name === s.who) ?? coder;
              const model = owner.id === coder.id ? (thread?.model ?? coder.model) : owner.model;
              return (
                <li key={`${i}-${s.text.slice(0, 20)}`}>
                  <span className="lc-step-dot" aria-hidden />
                  <span className="lc-step-t">
                    {edit ? (
                      <input className="lc-step-edit" value={s.text} aria-label={`Step ${i + 1}`} onChange={(e) => setEdit(steps.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
                    ) : (
                      <b>{s.text}</b>
                    )}
                    <span className="lc-step-files">
                      {edit && team.length > 1 ? (
                        <select className="lc-step-who" value={owner.name} aria-label={`Who does step ${i + 1}`} onChange={(e) => setEdit(steps.map((x, k) => (k === i ? { ...x, who: e.target.value } : x)))}>
                          {team.map((a) => (
                            <option key={a.id} value={a.name}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="lc-quiet">
                          {owner.name} · {modelLabel(model, providers)}
                        </span>
                      )}
                      {s.files.map((f) => (
                        <code key={f} className="lc-code">
                          {f.split("/").pop()}
                        </code>
                      ))}
                    </span>
                  </span>
                  {edit ? (
                    <span className="lc-step-acts">
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
                  ) : (
                    <span className="lc-quiet lc-mono">{i + 1}</span>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <StreamedMarkdown className="lc-md" text={it.plan} animate={false} />
        )}
        {est && (
          <dl className="lc-plan-est">
            <div>
              <dt>Estimate</dt>
              <dd>~{compactN(est.tokens * n)} tokens</dd>
            </div>
            <div>
              <dt>About</dt>
              <dd>
                {est.cost * n >= 0.005 ? `$${(est.cost * n).toFixed(2)} · ` : ""}
                {Math.max(1, Math.round(n * 1.5))} min
              </dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>your last 30 days</dd>
            </div>
          </dl>
        )}
        {claude && (
          <div className="lc-plan-mode">
            <span className="lc-quiet">{coder.name} runs on</span>
            <Pop label={`How ${coder.name} runs`} width={290} triggerClass="lc-btn lc-plan-modeb" trigger={<>{mode.id === "helpers" ? `${modelLabel(thread?.model ?? coder.model, providers)}, with helpers` : mode.id === "escalate" ? "Sonnet, Opus when stuck" : `${modelLabel(thread?.model ?? coder.model, providers)} alone`}<I.chevD size={11} /></>}>
              {(close) => (
                <>
                  {RUN_MODES.map((m) => (
                    <PickRow key={m.id} title={m.label} note={m.note} on={m.id === mode.id} onPick={() => (setMode(m.id), close())} />
                  ))}
                </>
              )}
            </Pop>
          </div>
        )}
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

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
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
      {current && (
        <button type="button" className="lc-btn" data-kind={open ? "primary" : "plain"} data-size="sm" title={open ? "Carry on where it stopped" : "It may still be limited; try anyway"} onClick={() => void rpc("thread.send", { id: threadId, text: "Continue where you left off." }).catch(fail)}>
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
  const all = useEngine((s) => s.items[threadId]);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const later = (all ?? []).filter((x): x is Checkpoint => x.kind === "checkpoint" && x.turn >= it.turn && !x.reverted);
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
  const go = async (revertFiles: boolean) => {
    const text = (edit ?? "").trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await rpc("thread.rewind", { threadId, itemId: it.id, files: revertFiles });
      await rpc("thread.send", { id: threadId, text });
      toast(`Went back to turn ${r.turn}`, { description: revertFiles && r.files ? `${plural(r.files, "file")} back as they were` : "The files stay as they are" });
    } catch (e) {
      fail(e);
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
      <p>{it.text}</p>
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

/** The Reviewer's pass over a turn: who, which round, and what it found, with each finding a press away from its lines. */
function ReviewRow({ it, providers, onReview }: { it: Extract<Item, { kind: "review" }>; providers: ProviderInfo[]; onReview: (checkpointId: string, path?: string) => void }) {
  const [open, setOpen] = useState(it.status === "blocked");
  const blocking = it.findings.filter((f) => f.severity === "blocking").length;
  const word = it.status === "running" ? "is reviewing the changes" : it.status === "passed" ? (it.findings.length ? `passed it, with ${plural(it.findings.length, "note")}` : "passed it") : it.status === "blocked" ? `found ${plural(blocking || it.findings.length, "blocker")}` : "couldn't finish the review";
  return (
    <div className="lc-rev" data-status={it.status} data-open={open || undefined}>
      <button type="button" className="lc-rev-h l-focus" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!it.findings.length && !it.summary}>
        <span className="lc-tile">{it.status === "running" ? <Rays size={11} /> : <I.shield size={11} />}</span>
        <span className={it.status === "running" ? "l-shimmer" : undefined}>
          <b>Reviewer</b> {word}
        </span>
        <ModelTag kind={markOf(it.reviewer)} label={modelLabel(it.reviewer, providers)} />
        <span className="lc-quiet">· round {it.round}</span>
        <span className="lc-grow" />
        {it.status !== "running" && <Badge tone={it.status === "passed" ? "ok" : it.status === "blocked" ? "danger" : "neutral"}>{it.status === "passed" ? "Verified" : it.status === "blocked" ? "Blocked" : "No verdict"}</Badge>}
      </button>
      {open && (
        <div className="lc-rev-b">
          {it.summary && <p>{it.summary}</p>}
          {it.findings.map((f, i) => (
            <button key={i} type="button" className="lc-rev-f l-focus" data-sev={f.severity} onClick={() => onReview("all", f.file)}>
              <span className="lc-mono">
                {f.file.split("/").pop()}
                {f.line ? `:${f.line}` : ""}
              </span>
              <span>{f.note}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Files join while the agent writes them. Nothing opens on its own. */
function LiveChanges({ edits }: { edits: Tool[] }) {
  const files = [...new Map(edits.map((t) => [t.path!, t])).values()];
  const current = files.find((t) => t.status === "running");
  return (
    <div className="lc-changes lc-frame" data-live>
      <div className="lc-fcard">
        <div className="lc-changes-h">
          <b className="l-shimmer">{current ? `Editing ${nameOf(current.path!)}` : `Edited ${plural(files.length, "file")}`}</b>
        </div>
        <div className="lc-changes-list">
          {files.map((t) => (
            <div key={t.path} className="lc-changes-row">
              {t.status === "running" ? <Rays size={12} /> : <I.check size={13} />}
              <span className="lc-mono">
                <span className="lc-quiet">{dirOf(t.path!)}</span>
                {nameOf(t.path!)}
              </span>
              <span className="lc-grow" />
              {t.status === "running" && <span className="lc-quiet">writing</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A turn's changes: one line until you open it. */
function ChangesCard({ it, onReview, reviewing }: { it: Checkpoint; onReview: (id: string, path?: string) => void; reviewing?: { id: string; path?: string } | null }) {
  const [open, setOpen] = useState(false);
  const total = sumLines(it.files);
  const here = reviewing?.id === it.id;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (here) setOpen(true);
  }, [here]);
  return (
    <div ref={ref} className="lc-changes lc-frame" data-open={open || undefined} data-reverted={it.reverted || undefined}>
      <div className="lc-fcard">
        <div className="lc-changes-h">
          <button type="button" className="lc-changes-fold l-focus" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <I.chevR size={13} />
            <b>{plural(it.files.length, "file")} changed</b>
            <Lines {...total} />
          </button>
          <span className="lc-grow" />
          {it.reverted ? (
            <Badge tone="neutral">Undone</Badge>
          ) : it.committed ? (
            <Badge tone="ok">Committed {it.committed}</Badge>
          ) : open ? (
            <span className="lc-quiet">{here ? "In the panel" : ""}</span>
          ) : (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => onReview(it.id, it.files[0]?.path)}>
              Review
            </button>
          )}
        </div>
        <div className="lc-fold">
          <div>
            <div className="lc-changes-list">
              {it.files.map((f) => {
                const on = here && reviewing?.path === f.path;
                return (
                  <button key={f.path} type="button" className="lc-changes-row l-focus" aria-current={on || undefined} onClick={() => onReview(it.id, f.path)}>
                    <I.file size={13} />
                    <span className="lc-mono">
                      <span className="lc-quiet">{dirOf(f.path)}</span>
                      {nameOf(f.path)}
                    </span>
                    {f.status === "added" && <span className="lc-pill" data-tone="ok">New</span>}
                    {f.status === "deleted" && <span className="lc-pill" data-tone="danger">Deleted</span>}
                    {f.status === "renamed" && <span className="lc-pill">Moved</span>}
                    <span className="lc-grow" />
                    {on && <span className="lc-accent-t">In the panel</span>}
                    <Lines added={f.added} removed={f.removed} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
