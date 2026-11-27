/*
  The Session surface (line and dot, board Panel, 2026-11-27), in the right panel; the details toggle opens it there while
  the panel is open (Session.tsx), and so do ⌘K and its key. From the top: a small card with the halftone naming who leads
  (the model, its tool, its effort, Fusion); Where it runs (the Mac or its worktree, the project and its folder, the branch
  with the lines still to commit, the agents that worked, a pull request and its checks); Context (how much is used, a bar
  of dots with one colour per source, a round dot and a count per source, Compact); Setup (Tool preset, Sidekick context,
  Connections, Spend limit, Workspace memory, Keep this Mac awake). It says no money: Usage and cost is where that is.
  It asks the engine when it shows, again when a turn starts or ends, and on Look again.
*/
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { isSwarm, type ContextPart, type ContextSource, type FileChange, type Item, type LimitWindow, type PrInfo, type SessionInfo, type Thread, type ToolLimits } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I, ModelMark, StateMark } from "./icons";
import { agentOf, checkpointsOf, compact, duration, markOf, modelLabel, plural, sumLines, threadModel } from "./model";
import { openSurface } from "./TopBar";
import { openAgents } from "./Crew";
import { addFive, agentsWorked } from "./session-pop";
import { hasAgents } from "./agent-rows";
import { Badge, Lines, MenuFoot, NamedSwitch, PanelHead, Row, Sep, SubMenu } from "./ui";
import { PaneBody, PaneRow, PaneSection } from "./Pane";
import * as os from "./os";

const fail = (e: Error) => toast.error(e.message);

export function SessionSurface({ thread, items, visible, onShowChange }: { thread: Thread; items: Item[]; visible: boolean; onShowChange: (path: string) => void }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const { files } = useMemo(() => openFiles(items), [items]);
  const [failed, setFailed] = useState("");
  const [looking, setLooking] = useState(false);
  const limits = useEngine((s) => s.limits);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const keepAwake = useEngine((s) => s.settings.keepAwake !== false);
  // The pull request's checks, as its card reads them (pr.status): asked only when the session has one.
  const [checks, setChecks] = useState<PrInfo["checks"]>([]);
  const running = thread.status === "running";
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
  // The press disables the button at once, and keeps it so until the turn is seen running (thread.send answers before
  // that), when the turn's own state takes over; a send that fails lets it go, and so do five seconds without a turn.
  const [compacting, setCompacting] = useState(false);
  const compactNow = () => {
    if (compacting) return;
    setCompacting(true);
    rpc("thread.send", { id: thread.id, text: "/compact" }).then(
      () => toast("Compacting the conversation", { description: "The tool sums up what came before, so the context has room again." }),
      (e: Error) => (setCompacting(false), toast.error(e.message)),
    );
  };
  useEffect(() => {
    if (!compacting) return;
    if (running) return void setCompacting(false);
    const t = setTimeout(() => setCompacting(false), 5000);
    return () => clearTimeout(t);
  }, [compacting, running]);

  const relook = (
    <button type="button" className="lc-pane-tool l-focus" aria-label="Look again" title="Look again" disabled={looking} onClick={look}>
      <I.refresh size={14} />
    </button>
  );
  if (!info)
    return (
      <PaneBody className="lc-ss">
        <PaneSection label="Where it runs" note={relook}>
          <p className={failed ? "lc-ss-note" : "lc-ss-note l-shimmer"}>{failed || "Asking the session"}</p>
        </PaneSection>
      </PaneBody>
    );

  const worked = agentsWorked(items);
  const limit = limits.find((t) => t.provider === info.provider);
  const lead = agentOf(thread.agent, agents, providers);
  const model = threadModel(thread, agents, providers);
  const effort = thread.effortNow ?? thread.effort ?? lead.effort;
  const changed = sumLines(files);
  return (
    <>
      <PaneBody className="lc-ss">
        {failed && <p className="lc-ss-note">{failed}</p>}
        {/* Who leads, on a card that is alive with the halftone: the one thing here that is chosen. */}
        <div className="lc-ss-hero">
          <i className="lc-ht lc-ht-corner lc-ht-soft" aria-hidden />
          <b>
            <ModelMark kind={markOf(model)} size={16} />
            <span className="lc-ss-hero-n">{modelLabel(model, providers)}</span>
            <Badge>{thread.sidekick ? "Lead" : "Works alone"}</Badge>
          </b>
          <span className="lc-ss-cap">
            Through {info.tool}
            {effort ? ` · effort ${effort[0].toUpperCase()}${effort.slice(1)}` : ""}
            {thread.sidekick ? " · in Fusion" : ""}
          </span>
        </div>
        {/* Look again sits by the first label: the surface has no bar of its own (board Panel). */}
        <PaneSection label="Where it runs" note={relook}>
          {/* "This Mac", as the board says it: the machine's own name is in its tooltip, so a picture of it never shows it. */}
          <PaneRow icon={<I.laptop size={14} />} value={info.worktree ? "in a worktree" : "in the checkout"} quiet title={info.machine || undefined}>
            {os.here[0].toUpperCase() + os.here.slice(1)}
          </PaneRow>
          <PaneRow icon={<I.folder size={14} />} value={<span className="lc-mono lc-ss-path"><bdi>{tilde(info.path)}</bdi></span>} quiet title={info.path}>
            {info.project}
          </PaneRow>
          {info.branch && (
            <PaneRow icon={<I.branch size={14} />} value={files.length ? <Lines {...changed} /> : undefined} opens={files.length > 0} title={files.length ? `${plural(files.length, "file")} to commit` : undefined} onClick={files.length ? () => onShowChange(files[0].path) : undefined}>
              <span className="lc-mono">{info.branch}</span>
            </PaneRow>
          )}
          {!info.branch && files.length > 0 && (
            <PaneRow icon={<I.changes size={14} />} value={<Lines {...changed} />} opens onClick={() => onShowChange(files[0].path)}>
              {plural(files.length, "file")} changed
            </PaneRow>
          )}
          {/* Only for a session that has agents, by the test the details card's agents section asks (agent-rows.ts). */}
          {hasAgents({ sidekick: thread.sidekick, swarm: isSwarm(thread), atWork: thread.agentsAtWork, worked: worked.count }) && worked.count > 0 && (
            <PaneRow icon={<I.agents size={14} />} value={duration(worked.seconds) || undefined} quiet opens onClick={() => openAgents(thread.id)}>
              {plural(worked.count, "agent")} worked
            </PaneRow>
          )}
          {thread.pr && (
            <PaneRow icon={<I.pr size={14} />} value={`#${thread.pr.number}`} quiet opens onClick={() => openSurface(thread.id, "pr")}>
              Pull request
            </PaneRow>
          )}
          {thread.pr && checks.length > 0 && <ChecksLine checks={checks} />}
        </PaneSection>
        <ContextCard info={info} doing={running ? doingOf(items) : ""} running={running} compacting={compacting} onCompact={compactNow} />
        {(thread.effortNow && thread.effort && thread.effortNow !== thread.effort) || limit ? (
          <div className="lc-ss-extra">
            {thread.effortNow && thread.effort && thread.effortNow !== thread.effort && (
              <PaneRow icon={<I.effort size={14} />} value={`${thread.effortNow}, asked ${thread.effort}`} quiet>
                Running effort
              </PaneRow>
            )}
            <PlanLimit limits={limit} />
          </div>
        ) : null}
        <PaneSection label="Setup">
          <div className="lc-ss-setup">
            <Setup thread={thread} />
          </div>
          <PaneRow icon={<I.laptop size={14} />} value={<NamedSwitch name={`Keep ${os.here} awake`} checked={keepAwake} onCheckedChange={(on) => void rpc("settings.save", { keepAwake: on }).catch(fail)} />}>
            Keep {os.here} awake
          </PaneRow>
        </PaneSection>
      </PaneBody>
    </>
  );
}

/** "~/tides" for a folder in the home folder: the surface's path is a place, not a string to copy. */
const tilde = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+/, "~");

/** The setup rows: each a value and a menu to its side, as the board's Setup section has them. */
function Setup({ thread }: { thread: Thread }) {
  const update = (patch: Omit<Parameters<typeof rpc<"thread.update">>[1], "id">) => void rpc("thread.update", { id: thread.id, ...patch }).catch(fail);
  const usage = thread.usage;
  return (
    <>
      <SubMenu title="Tool preset" icon={<I.sliders size={14} />} value={thread.toolPreset === "lean" ? "Lean" : "Standard"} label="Tool preset" width={270}>
        {(done) => (
          <>
            <Row title="Standard" on={thread.toolPreset !== "lean"} onPick={() => (done(), update({ toolPreset: "standard" }))} />
            <Row title="Lean" note="Leaves heavy add-ons out, for faster turns that use fewer tokens" on={thread.toolPreset === "lean"} onPick={() => (done(), update({ toolPreset: "lean" }))} />
          </>
        )}
      </SubMenu>
      {thread.sidekick && (
        <SubMenu title="Sidekick context" icon={<I.fork size={14} />} value={thread.sidekickContext === "fork" ? "Fork" : "Isolated"} label="Sidekick context" width={270}>
          {(done) => (
            <>
              <Row title="Isolated" note="The sidekick starts fresh on each brief" on={thread.sidekickContext !== "fork"} onPick={() => (done(), update({ sidekickContext: "isolated" }))} />
              <Row title="Fork" note="The sidekick inherits a summary of this conversation" on={thread.sidekickContext === "fork"} onPick={() => (done(), update({ sidekickContext: "fork" }))} />
            </>
          )}
        </SubMenu>
      )}
      <Connections thread={thread} />
      {/* No money on the surface (line and dot): the row says whether a limit is set; the amounts are in its menu. */}
      <SubMenu title="Spend limit" icon={<I.speed size={14} />} value={thread.spendLimit ? "Set" : "None"} label="Spend limit" width={240}>
        {(done) => (
          <>
            <Row title="Add $5" icon={<I.plus size={14} />} onPick={() => (done(), update({ spendLimit: addFive(thread.spendLimit, usage?.costUsd ?? 0) }))} />
            <Row title="Clear the limit" icon={<I.close size={14} />} disabled={!thread.spendLimit} onPick={() => (done(), update({ spendLimit: null }))} />
            <Sep />
            <MenuFoot>{thread.spendLimit ? "Its turns stop once it is reached. Usage and cost says what it has spent." : "No limit set"}</MenuFoot>
          </>
        )}
      </SubMenu>
      <SubMenu title="Workspace memory" icon={<I.notes size={14} />} value="Save notes" label="Workspace memory" width={260}>
        {(done) => (
          <>
            <Row
              title="Distill to MEMORY.md"
              note="This session's goal, changed files and outcome"
              disabled={thread.status === "running" || thread.turns === 0}
              onPick={() => {
                done();
                void rpc("memory.distill", { threadId: thread.id })
                  .then((r) => toast(r.added ? `Saved ${r.added} notes to MEMORY.md` : "MEMORY.md already has these notes"))
                  .catch(fail);
              }}
            />
            <Sep />
            <MenuFoot>{thread.status === "running" ? "Once the turn ends" : thread.turns === 0 ? "After the first turn" : "Agents read it in later sessions"}</MenuFoot>
          </>
        )}
      </SubMenu>
    </>
  );
}

/** The pull request's checks as one count: passed (a skipped one counts) of all, with the state mark: checks while any runs, problem once one fails, ready when all passed. */
function ChecksLine({ checks }: { checks: PrInfo["checks"] }) {
  const passed = checks.filter((c) => c.state === "pass" || c.state === "skipped").length;
  const failed = checks.filter((c) => c.state === "fail");
  const running = checks.filter((c) => c.state === "pending").length;
  const state = failed.length ? "problem" : running ? "checks" : "ready";
  const title = failed.length ? `Failed: ${failed.map((c) => c.name).join(", ")}` : running ? `${running} still running` : "Every check passed";
  return <Row title="Checks" icon={<StateMark state={state} size={14} />} note={title} end={`${passed} of ${checks.length}`} />;
}

/**
  The connections this session's tool may get, each ticked on or off for this session alone, in a menu to the side. The
  same choice the engine makes (Addons.connections): on in Add-ons, not removed, for this project or every one; a
  connection, or a ported plugin's program that gives tools. A change reaches a turn under way where its tool takes
  connections in place, else from its next turn, as a change in Add-ons does.
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
    rpc("thread.update", { id: thread.id, connectionsOff: next.length ? next : null }).catch(fail);
  };
  return (
    <SubMenu title="Connections" icon={<I.plug size={14} />} value={`${on} of ${all.length} on`} label="Connections" width={250}>
      {() => (
        <>
          {/* The switches are this session's alone: the list says so where it starts, as the board's labels do. */}
          <PanelHead>In this session</PanelHead>
          {all.map((a) => (
            <Row key={a.id} title={a.name} on={!offHere.includes(a.id)} onPick={() => flip(a.id)} />
          ))}
        </>
      )}
    </SubMenu>
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

/** The busiest plan window of the session's tool, as one row, when the tool says. */
function PlanLimit({ limits }: { limits?: ToolLimits }) {
  const now = Date.now();
  const used = (w: LimitWindow) => (w.resetsAt !== undefined && w.resetsAt <= now ? 0 : Math.max(0, Math.min(100, w.usedPercent)));
  const busiest = limits?.windows.reduce<LimitWindow | undefined>((a, w) => (!a || used(w) > used(a) ? w : a), undefined);
  if (!busiest) return null;
  return <Row title={`Plan limit, ${spanOf(busiest)}`} icon={<I.usage size={14} />} end={`${Math.round(used(busiest))}% used`} />;
}

/** What each kind of source is, for its row's tooltip. */
const GROUP_WORD: Record<ContextSource["group"], string> = { setup: "The tool's own", project: "Your project", talk: "The conversation", files: "Files", runs: "Commands", web: "The web", tools: "Other tools" };

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

/** Each kind of source's colour in the bar of dots and on its round dot (one colour per source, board Panel). */
const GROUP_COLOUR: Record<ContextSource["group"], string> = { setup: "var(--l-ink-3)", project: "var(--l-warn)", talk: "var(--lc-blue)", files: "var(--lc-merged)", runs: "var(--l-ok)", web: "var(--lc-progress)", tools: "var(--l-ink-2)" };

/**
  The Context section: "N% used" by its label and Compact at its right end; the bar of dots, one colour per source over the
  grey of what's free, with a mark where the tool compacts; then each source as a row with its round dot and its count.
  Pointing at a source lights its part of the bar. No money: what the context costs is Usage and cost's to say.
*/
function ContextCard({ info, doing, running, compacting, onCompact }: { info: SessionInfo; doing: string; running: boolean; compacting: boolean; onCompact: () => void }) {
  const [hl, setHl] = useState<number | null>(null);
  const ctx = info.context;
  const compactNote = running ? "Once the turn ends" : ctx?.autoCompact === false ? "Auto-compact is off" : ctx?.compactAt && ctx.compactAt > ctx.used ? `${compact(ctx.compactAt - ctx.used)} until the tool compacts` : undefined;
  const compactB = info.compact && (
    <button type="button" className="lc-btn l-focus" data-size="sm" title={compactNote} disabled={running || !ctx || compacting} onClick={onCompact}>
      Compact
    </button>
  );
  if (!ctx)
    return (
      <PaneSection label={<>Context <span className="lc-ss-ct">empty</span></>} note={compactB || undefined}>
        <PaneRow icon={<I.usage size={14} />}>The first turn fills it</PaneRow>
      </PaneSection>
    );
  const sources = ctx.sources?.length ? ctx.sources : ctx.measured ? asSources(ctx.parts) : [{ name: "Used", tokens: ctx.used, group: "talk" as const }];
  const pct = (n: number) => `${Math.min(100, (n / ctx.max) * 100)}%`;
  const share = Math.round((ctx.used / ctx.max) * 100);
  const known = Boolean(ctx.measured || ctx.sources?.length);
  return (
    <PaneSection
      label={
        <>
          Context <span className="lc-ss-ct">{share}% used</span>
          {doing && <span className="lc-ss-ct l-shimmer"> · {doing}</span>}
        </>
      }
      note={compactB || <span className="l-num">{compact(ctx.used)} / {compact(ctx.max)}</span>}
    >
      <div className="lc-ss-bar" role="img" aria-label={`${share}% of the context used${ctx.compactAt ? `; it compacts at ${compact(ctx.compactAt)}` : ""}`} title={`${compact(ctx.used)} of ${compact(ctx.max)}`}>
        <div className="lc-dotbar" data-hl={hl !== null || undefined}>
          {sources.map((s, i) => (
            <span key={`${i}:${s.group}:${s.name}`} data-on={hl === i || undefined} style={{ width: pct(s.tokens), "--lc-dotbar-c": GROUP_COLOUR[s.group] } as CSSProperties} />
          ))}
        </div>
        {ctx.compactAt && ctx.autoCompact !== false && ctx.compactAt < ctx.max && <span className="lc-ss-mark" style={{ left: pct(ctx.compactAt) }} aria-hidden />}
      </div>
      {/* Each source with its round dot and its count; pointing at one lights its part of the bar. */}
      <div className="lc-ss-src" onMouseLeave={() => setHl(null)}>
        {sources.map((s, i) => (
          <div key={`${i}:${s.group}:${s.name}`} className="lc-pane-row" title={`${s.detail ?? GROUP_WORD[s.group]} · ${s.tokens / ctx.max < 0.001 ? "under 0.1%" : `${((s.tokens / ctx.max) * 100).toFixed(1)}%`}`} onMouseEnter={() => setHl(i)}>
            <span className="lc-pane-ri">
              <i className="lc-ss-dot" style={{ background: GROUP_COLOUR[s.group] }} aria-hidden />
            </span>
            <span className="lc-pane-rt">{s.name}</span>
            <span className="lc-pane-rv l-num">{compact(s.tokens)}</span>
          </div>
        ))}
      </div>
      {!known && <p className="lc-ss-note">As of the last turn. {info.provider === "claude" ? "Claude Code shows what fills it once its session is open here again." : `${info.tool} gives the total, not the parts.`}</p>}
      {ctx.deferred ? <p className="lc-ss-note">{compact(ctx.deferred)} of tools wait until used</p> : null}
    </PaneSection>
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
