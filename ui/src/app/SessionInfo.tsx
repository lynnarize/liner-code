/*
  The Session surface: where this session runs (the Mac, the folder, the branch, the tool and its
  model), what fills its context as the tool counts it, source by source, with Compact, and the
  changes still to commit, each opening in the diff. It asks the engine when it shows, again when a
  turn starts or ends, and on Refresh.
*/
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ContextPart, ContextSource, FileChange, Item, LimitWindow, PrInfo, SessionInfo, Thread, ToolLimits } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { checkpointsOf, compact, duration, modelLabel, money, plural, sumLines } from "./model";
import { liveOf, Tick, type Mark } from "./Timeline";
import { Lines, PanelHead } from "./ui";


export function SessionSurface({ thread, items, visible, onShowChange }: { thread: Thread; items: Item[]; visible: boolean; onShowChange: (path: string) => void }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const { files } = useMemo(() => openFiles(items), [items]);
  const [failed, setFailed] = useState("");
  const [looking, setLooking] = useState(false);
  const providers = useEngine((s) => s.providers);
  const limits = useEngine((s) => s.limits);
  // The pull request's checks, as its card reads them (pr.status): asked only when the session has one.
  const [checks, setChecks] = useState<PrInfo["checks"]>([]);
  const usage = thread.usage;
  const running = thread.status === "running";
  // What fills the context, source by source, opens under its row: the board shows the one line.
  const [more, setMore] = useState(false);
  // Only the latest ask is shown: one sent as a turn started can answer after the one sent as it ended.
  const asked = useRef(0);
  const look = () => {
    const n = ++asked.current;
    setLooking(true);
    rpc("thread.info", { id: thread.id })
      .then((i) => n === asked.current && (setInfo(i), setFailed("")), (e: Error) => n === asked.current && setFailed(e.message))
      .finally(() => n === asked.current && setLooking(false));
    if (thread.pr)
      rpc("pr.status", { threadId: thread.id }).then(
        (st) => n === asked.current && setChecks(st.pr?.checks ?? []),
        () => {},
      );
    else setChecks([]);
  };
  // When it shows, and when a turn starts or ends.
  useEffect(() => {
    if (visible) look();
  }, [visible, thread.id, thread.turns, running]);

  // A second press before the turn's status lands would queue another /compact, summarising what was just summarised.
  // The state disables the button from the press itself and clears when the send settles, the turn's own running state
  // taking over then; a state alone suffices (no ref), handed to ContextCard whose button reads it.
  const [compacting, setCompacting] = useState(false);
  const compactNow = () => {
    if (compacting) return;
    setCompacting(true);
    rpc("thread.send", { id: thread.id, text: "/compact" }).then(
      () => toast("Compacting the conversation", { description: "The tool sums up what came before, so the context has room again." }),
      (e: Error) => toast.error(e.message),
    ).finally(() => setCompacting(false));
  };

  if (!info) return <div className="lc-sinfo">{failed ? <p className="lc-sinfo-note">{failed}</p> : <span className="l-shimmer lc-sinfo-note">Asking the session</span>}</div>;

  return (
    <div className="lc-sinfo">
      {failed && <p className="lc-sinfo-note" role="alert">{failed}</p>}
      {/* The board's sections, in its order: Session, Project, Who works. */}
      <section className="lc-sinfo-card">
        <PanelHead
          end={
            <button type="button" className="lc-ib l-focus" aria-label="Look again" title="Look again" disabled={looking} onClick={look}>
              <I.refresh size={14} />
            </button>
          }
        >
          Session
        </PanelHead>
        <button type="button" className="lc-sinfo-line lc-sinfo-go l-focus" aria-expanded={more} title="What fills the context" onClick={() => setMore(!more)}>
          <span className="lc-sinfo-ic">
            <I.clock size={14} />
          </span>
          <span className="lc-sinfo-v">
            <span className="lc-grow">Context</span>
            <span className="l-num">
              {info.context ? `${((info.context.used / info.context.max) * 100).toFixed(1)}%` : "Empty"}
              {usage && usage.costUsd > 0 ? ` · ${money(usage.costUsd)}` : ""}
            </span>
          </span>
        </button>
        <div className="lc-sinfo-bar" role="img" aria-label="Share of the context used">
          <span style={{ width: `${info.context ? Math.min(100, (info.context.used / info.context.max) * 100) : 0}%` }} />
        </div>
        {usage && usage.inputTokens + usage.cacheReadTokens > 0 && (
          <Line icon={<I.layers size={14} />}>
            <span className="lc-grow">Cache hit</span>
            <span className="l-num">{((usage.cacheReadTokens / (usage.inputTokens + usage.cacheReadTokens)) * 100).toFixed(1)}%</span>
          </Line>
        )}
      </section>

      {more && <ContextCard info={info} doing={running ? doingOf(items) : ""} running={running} compacting={compacting} onCompact={compactNow} />}

      <section className="lc-sinfo-card">
        <PanelHead end={<span className="lc-quiet">{info.project}</span>}>Project</PanelHead>
        {info.branch && (
          <Line icon={<I.branch size={14} />}>
            <span className="lc-mono">{info.branch}</span>
          </Line>
        )}
        <button type="button" className="lc-sinfo-line lc-sinfo-go l-focus" disabled={!files.length} onClick={() => files[0] && onShowChange(files[0].path)}>
          <span className="lc-sinfo-ic">
            <I.changes size={14} />
          </span>
          <span className="lc-sinfo-v">
            <span className="lc-grow">{files.length ? `${plural(files.length, "file")} changed` : "No changes yet"}</span>
            {files.length > 0 && <Lines {...sumLines(files)} />}
          </span>
        </button>
        {thread.pr && (
          <Line icon={<I.pr size={14} />}>
            <span className="lc-grow">Pull request</span>
            <span className="lc-sinfo-chip">#{thread.pr.number}</span>
          </Line>
        )}
        {thread.pr && checks.length > 0 && <ChecksLine checks={checks} />}
      </section>

      <section className="lc-sinfo-card">
        <PanelHead end={thread.sidekick ? <span className="lc-quiet">Fusion</span> : undefined}>Who works</PanelHead>
        <Line icon={<I.chip size={14} />}>
          <span className="lc-grow">Tool</span>
          {info.tool}
        </Line>
        <Line icon={<I.agents size={14} />}>
          <span className="lc-grow">Lead</span>
          {modelLabel(`${info.provider}:${info.model}`, providers)}
        </Line>
        {thread.sidekick && (
          <Line icon={<I.agents size={14} />}>
            <span className="lc-grow">Sidekick</span>
            {modelLabel(thread.sidekick, providers)}
          </Line>
        )}
        <Line icon={<I.shield size={14} />}>
          <span className="lc-grow">Reviewer</span>
          {thread.review ? "On" : "Off"}
        </Line>
      </section>

      <Connections thread={thread} />

      <ThisTurn items={items} limits={limits.find((t) => t.provider === info.provider)} />
    </div>
  );
}

/** The pull request's checks as one count: passed (a skipped one counts) of all, the dot amber while any runs and red once one fails. */
function ChecksLine({ checks }: { checks: PrInfo["checks"] }) {
  const passed = checks.filter((c) => c.state === "pass" || c.state === "skipped").length;
  const failed = checks.filter((c) => c.state === "fail");
  const running = checks.filter((c) => c.state === "pending").length;
  const state = failed.length ? "fail" : running ? "running" : "ok";
  const title = failed.length ? `Failed: ${failed.map((c) => c.name).join(", ")}` : running ? `${running} still running` : "Every check passed";
  return (
    <Line icon={<I.check size={14} />} title={title}>
      <span className="lc-grow">Checks</span>
      <i className="lc-sinfo-dot" data-state={state} aria-hidden />
      <span className="l-num">
        {passed}/{checks.length}
      </span>
    </Line>
  );
}

/**
  The connections this session's tool may get, each with a switch for this session alone. The same
  choice the engine makes (Addons.connections): on in Add-ons, not removed, for this project or every
  one; a connection, or a ported plugin's program that gives tools. A switch reaches a turn under way
  where its tool takes connections in place, else from its next turn, as a change in Add-ons does.
*/
function Connections({ thread }: { thread: Thread }) {
  const addons = useEngine((s) => s.addons);
  const off = useEngine((s) => s.addonsOff);
  const all = off ? [] : addons.filter((a) => a.enabled && !a.removed && (!a.project || a.project === thread.projectId) && (a.kind === "connection" ? !a.dsh || Boolean(a.dsh.tools?.length) : Boolean(a.panel?.dsh?.host && a.panel.dsh.tools?.length)));
  if (!all.length) return null;
  const offHere = thread.connectionsOff ?? [];
  const on = all.filter((a) => !offHere.includes(a.id)).length;
  const flip = (id: string) => {
    const next = offHere.includes(id) ? offHere.filter((x) => x !== id) : [...offHere, id];
    rpc("thread.update", { id: thread.id, connectionsOff: next.length ? next : null }).catch((e: Error) => toast.error(e.message));
  };
  return (
    <section className="lc-sinfo-card">
      <PanelHead end={<span className="l-num lc-quiet">{on} of {all.length}</span>}>Connections</PanelHead>
      {all.map((a) => {
        const here = !offHere.includes(a.id);
        return (
          <div key={a.id} className="lc-sinfo-line">
            <button type="button" role="switch" aria-checked={here} aria-label={a.name} className="lc-sinfo-switch l-focus" onClick={() => flip(a.id)} />
            <span className="lc-sinfo-v">{a.name}</span>
          </div>
        );
      })}
    </section>
  );
}

/** A plan window's span in words: "5 hours", "week"; its own label when it names more than its span. */
function spanOf(w: LimitWindow) {
  const m = w.minutes;
  if (!m || w.label.includes(",")) return w.label[0].toLowerCase() + w.label.slice(1);
  if (m === 10080) return "week";
  if (m >= 40000) return "month";
  if (m % 1440 === 0) return plural(m / 1440, "day");
  if (m % 60 === 0) return plural(m / 60, "hour");
  return plural(m, "minute");
}

/**
  The session's last turn: how long it took, or its clock while it runs (time spent waiting on you
  left out, as the turn's own status line counts it), and the busiest plan window of the session's
  tool. Nothing before the first turn.
*/
function ThisTurn({ items, limits }: { items: Item[]; limits?: ToolLimits }) {
  const marks = items.filter((x): x is Mark => x.kind === "turn");
  const n = marks.at(-1)?.turn;
  if (n === undefined) return null;
  const turn = marks.filter((m) => m.turn === n);
  const first = turn[0];
  const end = turn[turn.length - 1];
  const running = turn.some((m) => m.status === "running");
  const now = Date.now();
  const used = (w: LimitWindow) => (w.resetsAt !== undefined && w.resetsAt <= now ? 0 : Math.max(0, Math.min(100, w.usedPercent)));
  const busiest = limits?.windows.reduce<LimitWindow | undefined>((a, w) => (!a || used(w) > used(a) ? w : a), undefined);
  const took = !running && end.seconds !== undefined ? (end.at - first.at) / 1000 + end.seconds : undefined;
  // What it cost, each part's own (a fix after the Reviewer is a mark of its own) added up; nothing when no tool said.
  const cost = turn.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  if (!running && took === undefined && !busiest) return null;
  return (
    <section className="lc-sinfo-card">
      <PanelHead end={running ? <Tick className="l-num" text={liveOf(turn, items.filter((x) => x.turn === n)).clock} /> : took !== undefined ? <span className="l-num">{duration(took)}{cost > 0 ? ` · ${money(cost)}` : ""}</span> : undefined}>This turn</PanelHead>
      {busiest && (
        <Line icon={<I.usage size={14} />}>
          <span className="lc-grow">Plan limit, {spanOf(busiest)}</span>
          <span className="l-num">{Math.round(used(busiest))}% used</span>
        </Line>
      )}
    </section>
  );
}

/** What each kind of source is, for its tooltip. */
const GROUP_WORD: Record<ContextSource["group"], string> = { setup: "The tool's own", project: "Your project", talk: "The conversation", files: "Files", runs: "Commands", web: "The web", tools: "Other tools" };
/** Chips shown before "more": the bar still draws them all. */
const FIRST_CHIPS = 9;

/** The parts a tool lists, as sources, when it doesn't say more: used parts in the conversation's colour, past the first. */
const asSources = (parts: ContextPart[]): ContextSource[] => parts.filter((p) => p.kind === "used").map((p, i) => ({ name: p.name, tokens: p.tokens, group: i === 0 ? "setup" : "talk" }));

/** What the agent is at while its turn runs, in a word or two, beside the context it fills. */
function doingOf(items: Item[]) {
  const t = items.findLast((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.status === "running");
  if (items.some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking")) return "waiting for you";
  if (t) {
    if (/^(?:mcp__liner__|liner\.)server_start/.test(t.tool)) return "starting a server";
    if (/^(?:mcp__liner__|liner\.)browser_/.test(t.tool) || t.toolKind === "web" || t.toolKind === "fetch") return "on the web";
    return t.toolKind === "read" ? "reading" : t.toolKind === "edit" || t.toolKind === "write" ? "editing" : t.toolKind === "search" ? "searching" : t.toolKind === "exec" ? "running a command" : t.toolKind === "task" ? "with a subagent" : "working";
  }
  const last = items.at(-1);
  return last?.kind === "reasoning" && last.streaming ? "thinking" : last?.kind === "text" && last.streaming ? "writing" : "working";
}

/**
  What fills the context: how much of the window, as a bar of ticks in each source's colour with
  a mark where the tool compacts older turns, then each source with what it takes. A source says
  more when the pointer rests on it, and its ticks stand out.
*/
function ContextCard({ info, doing, running, compacting, onCompact }: { info: SessionInfo; doing: string; running: boolean; compacting: boolean; onCompact: () => void }) {
  const [hl, setHl] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const ctx = info.context;
  const compactBtn = info.compact && (
    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={running || !ctx || compacting} title={running ? "Wait for the turn to finish" : "Sum up the conversation so far, to make room"} onClick={onCompact}>
      Compact
    </button>
  );
  if (!ctx)
    return (
      <section className="lc-sinfo-card lc-cx">
        <PanelHead end={compactBtn}>Context</PanelHead>
        <p className="lc-sinfo-note">Empty so far: the first turn fills it.</p>
      </section>
    );
  const sources = ctx.sources?.length ? ctx.sources : ctx.measured ? asSources(ctx.parts) : [{ name: "Used", tokens: ctx.used, group: "talk" as const }];
  const pct = (n: number) => `${Math.min(100, (n / ctx.max) * 100)}%`;
  const share = Math.round((ctx.used / ctx.max) * 100);
  const chips = all ? sources : sources.slice(0, FIRST_CHIPS);
  // Short, so it fits beside a chip at the panel's edge: what it is, then its share of the window.
  const tip = (s: ContextSource) => `${s.detail ?? GROUP_WORD[s.group]} · ${s.tokens / ctx.max < 0.001 ? "under 0.1%" : `${((s.tokens / ctx.max) * 100).toFixed(1)}%`}`;
  return (
    <section className="lc-sinfo-card lc-cx">
      <div className="lc-cx-head">
        <b>Context</b>
        {doing && (
          <span className="lc-cx-doing l-shimmer">
            {doing}
          </span>
        )}
        <span className="lc-grow" />
        <span className="l-num">
          {compact(ctx.used)} <span className="lc-quiet">of {compact(ctx.max)}</span>
        </span>
      </div>
      <div className="lc-cx-bar" role="img" aria-label={`${share}% of the context used${ctx.compactAt ? `; it compacts at ${compact(ctx.compactAt)}` : ""}`}>
        <div className="lc-cx-ticks" data-hl={hl !== null || undefined}>
          {sources.map((s, i) => (
            <i key={`${i}:${s.group}:${s.name}`} data-g={s.group} data-on={hl === i || undefined} style={{ width: pct(s.tokens) }} />
          ))}
        </div>
        {ctx.compactAt && ctx.autoCompact !== false && ctx.compactAt < ctx.max && <span className="lc-cx-mark" style={{ left: pct(ctx.compactAt) }} aria-hidden />}
      </div>
      {ctx.measured || ctx.sources?.length ? (
        <div className="lc-cx-chips" onMouseLeave={() => setHl(null)}>
          {chips.map((s, i) => (
            // Two files can share a name and a kind (a CLAUDE.md at the root and in a package).
            <Tooltip key={`${i}:${s.group}:${s.name}`} content={tip(s)}>
              <button type="button" className="lc-cx-chip l-focus" onMouseEnter={() => setHl(i)} onFocus={() => setHl(i)} onBlur={() => setHl(null)}>
                <i data-g={s.group} aria-hidden />
                <span className="lc-cx-name">{s.name}</span>
                <span className="lc-quiet l-num">{compact(s.tokens)}</span>
              </button>
            </Tooltip>
          ))}
          {sources.length > FIRST_CHIPS && (
            <button type="button" className="lc-cx-chip lc-cx-more l-focus" aria-expanded={all} onClick={() => setAll((a) => !a)}>
              {all ? "Fewer" : `${sources.length - FIRST_CHIPS} more`}
            </button>
          )}
        </div>
      ) : (
        <p className="lc-sinfo-note">As of the last turn. {info.provider === "claude" ? "Claude Code shows what fills it once its session is open here again." : `${info.tool} gives the total, not the parts.`}</p>
      )}
      <div className="lc-cx-foot">
        <span className="lc-quiet">
          {ctx.autoCompact === false ? "Auto-compact is off: Compact makes room" : ctx.compactAt ? `Compacts older turns at ${compact(ctx.compactAt)}` : `${share}% used`}
          {ctx.deferred ? ` · ${compact(ctx.deferred)} of tools wait until used` : ""}
        </span>
        {compactBtn}
      </div>
    </section>
  );
}


/** The files still to commit, each once as it stands now: its latest status, its lines from every turn. */
function openFiles(items: Item[]) {
  const open = checkpointsOf(items).filter((c) => !c.reverted && !c.committed);
  const by = new Map<string, FileChange>();
  for (const f of open.flatMap((c) => c.files)) {
    const had = by.get(f.path);
    by.set(f.path, { ...f, added: (had?.added ?? 0) + f.added, removed: (had?.removed ?? 0) + f.removed });
  }
  return { open, files: [...by.values()] };
}

function Line({ icon, title, children }: { icon: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="lc-sinfo-line" title={title}>
      <span className="lc-sinfo-ic">{icon}</span>
      <span className="lc-sinfo-v">{children}</span>
    </div>
  );
}
