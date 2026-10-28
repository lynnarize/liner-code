/*
  The panel beside the session: its surfaces as tabs (see Surfaces.tsx). Diff and Agents live here.
  Changes is the diff, kept by turn: the turn picker sits in the diff's strip, the file you
  pressed in the thread scrolls into view, and the foot says how many files you've looked at,
  with Undo for the turn and Commit for everything that's left.
  Agents says who worked in this session, on what, and how much of the budget they used.
*/
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, Item, Thread } from "@contracts";
import { CodeDiff } from "@liner/pro/code-diff/code-diff";
import { toast } from "@liner/components/toast/toast";
import { CommitButton } from "./Commit";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, checkpointsOf, compact, duration, markOf, modelLabel, plural } from "./model";
import { Disc, ModelTag, Num, PanelHead } from "./ui";
import { BrowserSurface } from "./Browser";
import { DeviceSurface } from "./Device";
import { FilesSurface } from "./Files";
import { LinkedSurface, PrSurface } from "./Pr";
import { Review, TurnPicker } from "./Review";
import { RoutinesList, RunDetail } from "./Routines";
import { openTab, PanelTabs, SurfacePicker, surfaceOf, type PanelState, type Tab } from "./Surfaces";
// The terminal brings xterm.js; it loads the first time you open one.
const TerminalSurface = lazy(() => import("./Terminal").then((m) => ({ default: m.TerminalSurface })));
const SessionSurface = lazy(() => import("./SessionInfo").then((m) => ({ default: m.SessionSurface })));

export function Panel({
  thread,
  items,
  state,
  onState,
  focus,
  onFocus,
  agentName,
  onOpenSession,
  onRoutine,
}: {
  thread: Thread;
  items: Item[];
  state: PanelState;
  onState: (p: PanelState) => void;
  focus: { id: string; path?: string } | null;
  onFocus: (f: { id: string; path?: string } | null) => void;
  agentName: string;
  onOpenSession: (id: string, tab?: Tab) => void;
  onRoutine: (id?: string) => void;
}) {
  const runs = useEngine((s) => s.runs);
  const label = (t: Tab) => {
    if (t.startsWith("run:")) {
      const r = runs.find((x) => x.id === t.slice(4));
      return r?.subject ? `Run on #${r.subject.number}` : "A run";
    }
    return surfaceOf(t)?.label ?? t;
  };
  // Only surfaces you've opened mount; once mounted they stay, so a shell or a page keeps going.
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set([state.tab]));
  useEffect(() => {
    if (!state.picking) setMounted((m) => (m.has(state.tab) ? m : new Set(m).add(state.tab)));
  }, [state.tab, state.picking]);
  useEffect(() => setMounted((m) => new Set([...m].filter((t) => state.tabs.includes(t)))), [state.tabs.join()]);
  const open = (t: Tab) => onState(openTab(state, t));
  const wideReview = state.wide && state.tab === "changes" && !state.picking;

  const body = (t: Tab) => {
    const visible = !state.picking && state.tab === t;
    if (t === "changes") return wideReview ? <Review thread={thread} items={items} focus={focus} onFocus={onFocus} onBack={() => onState({ ...state, wide: false })} /> : <Changes thread={thread} items={items} focus={focus} onFocus={onFocus} />;
    if (t === "agents") return <Agents thread={thread} items={items} />;
    if (t === "session")
      return (
        <Suspense fallback={null}>
          <SessionSurface thread={thread} items={items} visible={visible} onShowChange={(path) => (onFocus({ id: "all", path }), open("changes"))} />
        </Suspense>
      );
    if (t === "terminal")
      return (
        <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening a terminal</span></div>}>
          <TerminalSurface thread={thread} visible={visible} />
        </Suspense>
      );
    if (t === "browser") return <BrowserSurface thread={thread} agentName={agentName} />;
    if (t === "files") return <FilesSurface thread={thread} items={items} onShowChanges={(id, path) => (onFocus({ id, path }), open("changes"))} />;
    if (t === "pr") return <PrSurface thread={thread} agentName={agentName} visible={visible} />;
    if (t === "linked") return <LinkedSurface thread={thread} agentName={agentName} onOpenSession={(id) => onOpenSession(id)} />;
    if (t === "device") return <DeviceSurface thread={thread} agentName={agentName} visible={visible} />;
    if (t === "routines") return <RoutinesList projectId={thread.projectId} compact onNew={() => onRoutine()} onEdit={(id) => onRoutine(id)} onRun={(r) => open(`run:${r.id}`)} />;
    if (t.startsWith("run:")) return <RunDetail runId={t.slice(4)} onOpenSession={(id) => (id === thread.id ? undefined : onOpenSession(id, t))} />;
    return null;
  };

  return (
    <aside className="lc-panel" aria-label="Surfaces" data-wide-review={wideReview || undefined}>
      {!wideReview && <PanelTabs state={state} onState={onState} label={label} />}
      {state.picking && <SurfacePicker thread={thread} items={items} agentName={agentName} onOpen={(s) => open(s)} />}
      {state.tabs.map((t) =>
        mounted.has(t) ? (
          <div key={t} className="lc-surface" hidden={state.picking || state.tab !== t} role="tabpanel" aria-label={label(t)}>
            {body(t)}
          </div>
        ) : null,
      )}
    </aside>
  );
}

function Changes({ thread, items, focus, onFocus }: { thread: Thread; items: Item[]; focus: { id: string; path?: string } | null; onFocus: (f: { id: string; path?: string } | null) => void }) {
  const cps = useMemo(() => checkpointsOf(items), [items]);
  const pick = focus?.id && (focus.id === "all" || focus.id === "branch" || cps.some((c) => c.id === focus.id)) ? focus.id : (cps[cps.length - 1]?.id ?? null);
  const cp = cps.find((c) => c.id === pick);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [view, setView] = useState<"unified" | "split">(() => (localStorage.getItem("lc:view") as "split") ?? "unified");
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"undo" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => localStorage.setItem("lc:view", view), [view]);

  // The diff for the turn in the picker, fetched when it changes.
  const key = `${pick}:${cp?.reverted}:${cp?.committed}:${cps.length}`;
  useEffect(() => {
    if (!pick) return setDiff([]);
    let live = true;
    setDiff(null);
    void rpc("checkpoint.diff", { threadId: thread.id, itemId: pick })
      .then((d) => live && setDiff(d))
      .catch(() => live && setDiff([]));
    return () => {
      live = false;
    };
  }, [thread.id, key]);

  // The file pressed in the thread scrolls into view and counts as looked at.
  useEffect(() => {
    if (!diff || !focus?.path) return;
    const i = diff.findIndex((f) => f.path === focus.path);
    const el = box.current?.querySelectorAll<HTMLElement>(".l-cdiff__file")[i];
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
    setViewed((v) => new Set(v).add(focus.path!));
  }, [diff, focus?.path]);

  const files = pick === "all" || pick === "branch" ? (diff ?? []).map((d) => ({ path: d.path, added: 0, removed: 0 })) : (cp?.files ?? []);
  const open = cps.filter((c) => !c.reverted && !c.committed);
  const openFiles = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;

  const undo = async () => {
    if (!cp) return;
    setBusy("undo");
    try {
      await rpc("checkpoint.revert", { threadId: thread.id, itemId: cp.id });
      toast(`Undid turn ${cp.turn}`, { description: `${plural(cp.files.length, "file")} back as they were` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!cps.length)
    return (
      <div className="lc-panel-empty">
        <I.changes size={20} />
        <b>No changes yet</b>
        <p>When a turn edits files, its changes land here, kept by turn, so you can review, undo or commit them.</p>
      </div>
    );

  const picker = <TurnPicker cps={cps} pick={pick ?? "all"} turns={thread.turns} onPick={(id) => onFocus({ id })} />;

  return (
    <div className="lc-changes-panel">
      <div ref={box} className="lc-diff">
        {diff === null ? (
          <div className="lc-diff-wait">
            <span className="l-shimmer">Reading the changes</span>
          </div>
        ) : (
          <CodeDiff files={diff} title={picker} view={view} onViewChange={setView} maxHeight={4000} />
        )}
      </div>
      <div className="lc-panel-foot">
        <span className="lc-viewed">
          <span className="lc-viewed-bar" aria-hidden>
            <i style={{ width: `${files.length ? (Math.min(viewed.size, files.length) / files.length) * 100 : 0}%` }} />
          </span>
          {Math.min(viewed.size, files.length)} of {plural(files.length, "file")} viewed
        </span>
        <span className="lc-grow" />
        {cp && !cp.reverted && !cp.committed && (
          <button type="button" className="lc-btn" data-kind="ghost" disabled={busy !== null || thread.status === "running"} onClick={() => void undo()}>
            <I.undo size={14} />
            Undo turn {cp.turn}
          </button>
        )}
        {openFiles > 0 && <CommitButton thread={thread} files={openFiles} disabled={busy !== null || thread.status === "running"} />}
      </div>
    </div>
  );
}

function Agents({ thread, items }: { thread: Thread; items: Item[] }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const turns = items.filter((x): x is Extract<Item, { kind: "turn" }> => x.kind === "turn");
  const who = [...new Set([thread.lead, thread.agent, ...turns.map((t) => t.agent)].filter(Boolean) as string[])];
  const tools = items.filter((x) => x.kind === "tool");
  const subs = tools.filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.toolKind === "task");
  const reviews = items.filter((x): x is Extract<Item, { kind: "review" }> => x.kind === "review");
  const coder = agentOf(thread.agent, agents, providers);
  const haiku = providers.find((p) => p.id === "claude")?.models.find((m) => m.id.includes("haiku"));
  const opus = providers.find((p) => p.id === "claude")?.models.find((m) => m.id.includes("opus"));
  // Which model a subagent ran on: the agent's own choice, else the cheap default.
  const subModel = (name: string) => {
    if (name === "Explorer") return coder.subagents?.explorer ?? (haiku ? `claude:${haiku.id}` : undefined);
    if (name === "Test runner") return coder.subagents?.tests ?? (haiku ? `claude:${haiku.id}` : undefined);
    if (name === "Opus") return opus ? `claude:${opus.id}` : undefined;
    return undefined;
  };
  const u = thread.usage;
  return (
    <div className="lc-agents-panel">
      <PanelHead>In this session</PanelHead>
      {who.map((id) => {
        const a = agentOf(id, agents, providers);
        const mine = turns.filter((t) => t.agent === id);
        const last = mine[mine.length - 1];
        const model = last?.model ?? (id === thread.agent ? (thread.model ?? a.model) : a.model);
        const isLead = id === thread.lead;
        return (
          <div key={id} className="lc-agent-card">
            <Disc agent={a} size={30} lead={isLead || undefined} />
            <span className="lc-agent-card-t">
              <b>
                {a.name} <span className="lc-quiet">{isLead ? "Lead" : a.role || "Agent"}</span>
              </b>
              <small>
                {mine.length === 0
                  ? isLead
                    ? "Plans first, when you send a message"
                    : "Hasn't worked yet"
                  : last?.status === "running"
                    ? "Working now"
                    : `${isLead ? "Planned" : "Worked"} ${plural(mine.length, "turn")}`}
              </small>
            </span>
            <span className="lc-agent-card-m">
              <ModelTag kind={markOf(model)} label={modelLabel(model, providers)} />
              <small>{(id === thread.agent ? thread.effort : undefined) ?? a.effort}</small>
            </span>
          </div>
        );
      })}
      {(subs.length > 0 || reviews.length > 0) && (
        <>
          <PanelHead end={<span className="lc-quiet">answer to {coder.name}</span>}>Subagents</PanelHead>
          {[...new Map(subs.map((x) => [x.title.split(":")[0], x])).values()].map((first) => {
            const name = first.title.split(":")[0].trim();
            const mine = subs.filter((x) => x.title.split(":")[0].trim() === name);
            const last = mine[mine.length - 1];
            const model = subModel(name);
            const secs = mine.reduce((n, x) => n + (x.seconds ?? 0), 0);
            return (
              <div key={name} className="lc-agent-card" data-sub>
                <span className="lc-tile lc-sub-tile">{name === "Opus" ? <I.sparkle size={12} /> : <I.agents size={12} />}</span>
                <span className="lc-agent-card-t">
                  <b>
                    {name} <span className="lc-quiet">subagent</span>
                  </b>
                  <small>
                    {last.status === "running" ? "Working now" : mine.length > 1 ? `${mine.length} runs` : last.title.split(":").slice(1).join(":").trim() || "Done"}
                    {secs > 0 && last.status !== "running" ? ` · ${duration(secs)}` : ""}
                  </small>
                </span>
                {model && (
                  <span className="lc-agent-card-m">
                    <ModelTag kind={markOf(model)} label={modelLabel(model, providers)} />
                  </span>
                )}
              </div>
            );
          })}
          {reviews.length > 0 && (() => {
            const r = reviews[reviews.length - 1];
            return (
              <div className="lc-agent-card" data-sub>
                <span className="lc-tile lc-sub-tile">
                  <I.shield size={12} />
                </span>
                <span className="lc-agent-card-t">
                  <b>
                    Reviewer <span className="lc-quiet">subagent</span>
                  </b>
                  <small>
                    {r.status === "running" ? "Reading the changes" : r.status === "passed" ? (r.findings.length ? `${plural(r.findings.length, "note")}, nothing blocking` : "Nothing to note") : r.status === "blocked" ? `Blocked in round ${r.round}` : "No verdict"}
                    {r.seconds ? ` · ${duration(r.seconds)}` : ""}
                  </small>
                </span>
                <span className="lc-agent-card-m">
                  <ModelTag kind={markOf(r.reviewer)} label={modelLabel(r.reviewer, providers)} />
                </span>
              </div>
            );
          })()}
        </>
      )}
      <PanelHead>This session</PanelHead>
      <dl className="lc-fields lc-fields-quiet">
        <div>
          <dt>Tokens</dt>
          <dd>
            <Num as="compact" value={u.inputTokens + u.outputTokens + u.cacheReadTokens} />
          </dd>
        </div>
        <div>
          <dt>From cache</dt>
          <dd>{u.inputTokens + u.cacheReadTokens ? <Num as="percent" value={u.cacheReadTokens / (u.inputTokens + u.cacheReadTokens)} /> : "–"}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{u.costUsd ? <Num as="money" value={u.costUsd} /> : "Included in your plan"}</dd>
        </div>
        {u.contextWindow ? (
          <div>
            <dt>Context</dt>
            <dd>
              <Num as="compact" value={u.contextTokens ?? 0} /> of {compact(u.contextWindow)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Tools used</dt>
          <dd>
            <Num value={tools.length} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
