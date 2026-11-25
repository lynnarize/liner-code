/*
  The Session card (SPEC rule 5, board Session, 2026-11-25): the Session icon at the right end of the session's header
  pins it at the chat's right (Session.tsx), in the menu's shape. Three sections: where it runs (the Mac or its worktree, the project and its
  folder, the branch, the changes still to commit, the agents that worked, a pull request and its checks), its context
  (used of the window, a bar split by source, what fills it opened in place, Compact, what came from cache) and its setup
  (Multi-agent, Tool preset, Sidekick context, Connections, Spend limit, Workspace memory), each a row with its value and
  a menu to its side. Tool, Lead, Sidekick and Reviewer are not here: the message box and the header say them. It asks
  the engine when it opens, again when a turn starts or ends, and on Look again.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import { isSwarm, type ContextPart, type ContextSource, type FileChange, type Item, type LimitWindow, type PrInfo, type SessionInfo, type Thread, type ToolLimits } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine, useItems } from "./engine";
import { I, StateMark } from "./icons";
import { checkpointsOf, compact, duration, money, plural, sumLines } from "./model";
import { openSurface } from "./TopBar";
import { openAgents, showTeam } from "./Crew";
import { addFive, agentsWorked, spendWords } from "./session-pop";
import { ConfirmRow, Lines, MenuFoot, PanelHead, Row, Sep, SubMenu } from "./ui";

const fail = (e: Error) => toast.error(e.message);

/** The popup as the header's Session icon opens it: reads the session's items itself, and closes itself when a row takes you elsewhere. */
export function SessionPopup({ thread, onShowChange, onClose }: { thread: Thread; onShowChange: (path: string) => void; onClose: () => void }) {
  const items = useItems(thread.id);
  return <SessionSurface thread={thread} items={items} visible onShowChange={onShowChange} onClose={onClose} />;
}

export function SessionSurface({ thread, items, visible, onShowChange, onClose = () => {} }: { thread: Thread; items: Item[]; visible: boolean; onShowChange: (path: string) => void; onClose?: () => void }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const { files } = useMemo(() => openFiles(items), [items]);
  const [failed, setFailed] = useState("");
  const [looking, setLooking] = useState(false);
  const limits = useEngine((s) => s.limits);
  // The pull request's checks, as its card reads them (pr.status): asked only when the session has one.
  const [checks, setChecks] = useState<PrInfo["checks"]>([]);
  const usage = thread.usage;
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
    <button type="button" className="lc-ib l-focus lc-spop-look" aria-label="Look again" title="Look again" disabled={looking} onClick={look}>
      <I.refresh size={14} />
    </button>
  );
  if (!info)
    return (
      <div className="lc-spop">
        <PanelHead end={relook}>Where it runs</PanelHead>
        {failed ? <MenuFoot>{failed}</MenuFoot> : <MenuFoot><span className="l-shimmer">Asking the session</span></MenuFoot>}
      </div>
    );

  const worked = agentsWorked(items);
  const go = (tab: "pr" | "changes") => (onClose(), openSurface(thread.id, tab));
  const limit = limits.find((t) => t.provider === info.provider);
  return (
    <div className="lc-spop">
      {failed && <MenuFoot>{failed}</MenuFoot>}
      <PanelHead end={relook}>Where it runs</PanelHead>
      {/* "This Mac", as the board says it: the machine's own name is in its tooltip, so a picture of the popup never shows it. */}
      <Row title="This Mac" note={info.machine || undefined} icon={<I.laptop size={14} />} end={info.worktree ? "its own worktree" : "the checkout"} />
      <Row title={info.project} icon={<I.folder size={14} />} which={tilde(info.path)} whichPath />
      {info.branch && <Row title={<span className="lc-mono">{info.branch}</span>} icon={<I.branch size={14} />} />}
      <Row title={files.length ? `${plural(files.length, "file")} changed` : "No changes yet"} icon={<I.changes size={14} />} end={files.length ? <Lines {...sumLines(files)} /> : undefined} chevron={files.length > 0} disabled={!files.length} onPick={() => (files[0] ? (onClose(), onShowChange(files[0].path)) : go("changes"))} />
      {worked.count > 0 && <Row title={`${plural(worked.count, "agent")} worked`} icon={<I.agents size={14} />} end={duration(worked.seconds) || undefined} chevron onPick={() => (onClose(), openAgents(thread.id))} />}
      {thread.pr && <Row title="Pull request" icon={<I.pr size={14} />} end={`#${thread.pr.number}`} chevron onPick={() => go("pr")} />}
      {thread.pr && checks.length > 0 && <ChecksLine checks={checks} />}
      <Sep />
      <ContextCard info={info} doing={running ? doingOf(items) : ""} running={running} compacting={compacting} onCompact={compactNow} cost={usage?.costUsd ?? 0} cache={usage && usage.inputTokens + usage.cacheReadTokens > 0 ? usage.cacheReadTokens / (usage.inputTokens + usage.cacheReadTokens) : undefined} />
      {thread.effortNow && thread.effort && thread.effortNow !== thread.effort && <Row title="Running effort" icon={<I.effort size={14} />} end={`${thread.effortNow}, asked ${thread.effort}`} />}
      <PlanLimit limits={limit} />
      <Sep />
      <PanelHead>Setup</PanelHead>
      <Setup thread={thread} close={onClose} />
    </div>
  );
}

/** "~/tides" for a folder in the home folder: the popup's path is a place, not a string to copy. */
const tilde = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+/, "~");

/** The setup rows: each a value and a menu to its side, as the board's Setup section has them. */
/**
  Multi-agent › Off, Teamwork, Swarm: one row, the same in this popup's Setup and in the session's title menu (Session.tsx).
  Teamwork and Swarm are started here (and by /teamwork and /swarm), never in a side chat or a scan. `close` closes the
  menu it is in. Off stops every worker, so while a team is on it asks once more, as the team card's Turn it off does.
*/
export function MultiAgentRow({ thread, close }: { thread: Thread; close: () => void }) {
  const mode = isSwarm(thread) ? ((thread.swarm?.mode ?? "teamwork") === "swarm" ? "Swarm" : "Teamwork") : "Off";
  if (thread.sideOf || thread.security) return null;
  // `done` shuts its side menu: in the pinned Session card `close` closes nothing, and the side menu stayed up after a pick.
  const multiAgent = (to: "off" | "teamwork" | "swarm", done: () => void) => {
    done();
    close();
    if (to === "off") void rpc("swarm.enable", { threadId: thread.id, enabled: false }).catch(fail);
    // On, the team's card pins at the chat's right (Crew.tsx TeamPin), where the Agents panel opened before.
    else void rpc("swarm.enable", { threadId: thread.id, enabled: true, mode: to }).then(() => showTeam(thread.id), fail);
  };
  return (
    <SubMenu title="Multi-agent" icon={<I.fusion size={14} />} value={mode} label="Multi-agent" width={250}>
      {(done) => (
        <>
          {mode === "Off" ? <Row title="Off" on onPick={() => multiAgent("off", done)} /> : <ConfirmRow title="Off" sure="Turn it off: every worker stops" red onConfirm={() => multiAgent("off", done)} />}
          <Row title="Teamwork" note="A coordinator and a tree of agents under it" on={mode === "Teamwork"} onPick={() => multiAgent("teamwork", done)} />
          <Row title="Swarm" note="Peers on one board, parked at 0 MB while they wait" on={mode === "Swarm"} onPick={() => multiAgent("swarm", done)} />
        </>
      )}
    </SubMenu>
  );
}

function Setup({ thread, close }: { thread: Thread; close: () => void }) {
  const update = (patch: Omit<Parameters<typeof rpc<"thread.update">>[1], "id">) => void rpc("thread.update", { id: thread.id, ...patch }).catch(fail);
  const usage = thread.usage;
  return (
    <>
      <MultiAgentRow thread={thread} close={close} />
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
      <SubMenu title="Spend limit" icon={<I.speed size={14} />} value={spendWords(thread.spendLimit, usage?.costUsd ?? 0)} label="Spend limit" width={240}>
        {(done) => (
          <>
            <Row title="Add $5" icon={<I.plus size={14} />} onPick={() => (done(), update({ spendLimit: addFive(thread.spendLimit, usage?.costUsd ?? 0) }))} />
            <Row title="Clear the limit" icon={<I.close size={14} />} disabled={!thread.spendLimit} onPick={() => (done(), update({ spendLimit: null }))} />
            <Sep />
            <MenuFoot>{thread.spendLimit ? `${money(usage?.costUsd ?? 0)} used of ${money(thread.spendLimit)}` : "No limit set"}</MenuFoot>
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

/**
  The Context section: used of the window as the label's note, a bar of the sources in their colours with a mark where
  the tool compacts, "N% used" whose "What fills it ›" opens each source with what it takes in place, Compact now with
  how far off the tool's own compacting is, and what came from cache with what it cost.
*/
function ContextCard({ info, doing, running, compacting, onCompact, cost, cache }: { info: SessionInfo; doing: string; running: boolean; compacting: boolean; onCompact: () => void; cost: number; cache?: number }) {
  const [hl, setHl] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const ctx = info.context;
  const compactRow = info.compact && (
    <Row
      title="Compact now"
      icon={<I.shrink size={14} />}
      end={running ? "once the turn ends" : ctx?.autoCompact === false ? "auto-compact is off" : ctx?.compactAt && ctx.compactAt > ctx.used ? `${compact(ctx.compactAt - ctx.used)} until it does` : undefined}
      disabled={running || !ctx || compacting}
      onPick={onCompact}
    />
  );
  const cacheRow = cache !== undefined && <Row title="From cache" icon={<I.layers size={14} />} end={`${Math.round(cache * 100)}%, ${cost > 0 ? `${money(cost)} so far` : "nothing to pay"}`} />;
  if (!ctx)
    return (
      <div className="lc-cx">
        <PanelHead end="Empty">Context</PanelHead>
        <Row title="The first turn fills it" icon={<I.usage size={14} />} />
        {compactRow}
        {cacheRow}
      </div>
    );
  const sources = ctx.sources?.length ? ctx.sources : ctx.measured ? asSources(ctx.parts) : [{ name: "Used", tokens: ctx.used, group: "talk" as const }];
  const pct = (n: number) => `${Math.min(100, (n / ctx.max) * 100)}%`;
  const share = Math.round((ctx.used / ctx.max) * 100);
  const known = Boolean(ctx.measured || ctx.sources?.length);
  return (
    <div className="lc-cx">
      <PanelHead end={<span className="l-num">{compact(ctx.used)} / {compact(ctx.max)}</span>}>
        Context{doing && <span className="lc-spop-doing l-shimmer"> · {doing}</span>}
      </PanelHead>
      <div className="lc-cx-bar lc-spop-bar" role="img" aria-label={`${share}% of the context used${ctx.compactAt ? `; it compacts at ${compact(ctx.compactAt)}` : ""}`}>
        <div className="lc-cx-ticks" data-hl={hl !== null || undefined}>
          {sources.map((s, i) => (
            <i key={`${i}:${s.group}:${s.name}`} data-g={s.group} data-on={hl === i || undefined} style={{ width: pct(s.tokens) }} />
          ))}
        </div>
        {ctx.compactAt && ctx.autoCompact !== false && ctx.compactAt < ctx.max && <span className="lc-cx-mark" style={{ left: pct(ctx.compactAt) }} aria-hidden />}
      </div>
      {/* "What fills it ›" always, as the board has it: where the tool gives only the total, it opens to say so. */}
      <Row title={`${share}% used`} icon={<I.usage size={14} />} end={more ? "Fewer" : "What fills it"} chevron onPick={() => setMore((m) => !m)} />
      {more && !known && <MenuFoot>As of the last turn. {info.provider === "claude" ? "Claude Code shows what fills it once its session is open here again." : `${info.tool} gives the total, not the parts.`}</MenuFoot>}
      {/* Each source opens in place under its row, with what it takes; pointing at one lights its part of the bar. */}
      {more && known && (
        <div className="lc-spop-src" onMouseLeave={() => setHl(null)}>
          {sources.map((s, i) => (
            <div key={`${i}:${s.group}:${s.name}`} className="lc-spop-srow" title={`${s.detail ?? GROUP_WORD[s.group]} · ${s.tokens / ctx.max < 0.001 ? "under 0.1%" : `${((s.tokens / ctx.max) * 100).toFixed(1)}%`}`} onMouseEnter={() => setHl(i)}>
              <i data-g={s.group} aria-hidden />
              <span className="lc-spop-sn">{s.name}</span>
              <span className="l-num">{compact(s.tokens)}</span>
            </div>
          ))}
          {ctx.deferred ? <MenuFoot>{compact(ctx.deferred)} of tools wait until used</MenuFoot> : null}
        </div>
      )}
      {compactRow}
      {cacheRow}
    </div>
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
