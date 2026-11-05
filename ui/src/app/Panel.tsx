/*
  The right dock beside the session: one or two panes side by side, each a strip of tabs over the
  surface that's up (dock.ts has the rules; DeepSeek Harness's ui-dockkit and ui-sidebar-right
  were the model). A chip moves to the other pane by dragging it there, or from its menu; dropped
  on the right half of a lone pane it splits it. A pane's + opens the New tab guide in it. The
  last pane's strip ends with the full-canvas switch and the hide button, and the full canvas on
  Diff is the full-width Review.
  Every surface you open is mounted once and kept while it's open in either pane, placed into its
  pane's column, so moving it never reloads a page or restarts a shell.
  Changes is the diff, kept by turn: the turn picker sits in the diff's strip, the file you
  pressed in the thread scrolls into view, and the foot says how many files you've looked at,
  with Undo for the turn and Commit for everything that's left.
  Agents says who worked in this session, on what, and how much of the budget they used.
*/
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FileDiff, Item, Thread } from "@contracts";
import { CodeDiff } from "@liner/pro/code-diff/code-diff";
import { prefersReducedMotion } from "@liner/lib/spring";
import { toast } from "@liner/components/toast/toast";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { Boundary } from "./Boundary";
import { CommitButton } from "./Commit";
import { closeOthers, closeTab, GUIDE, moveTab, openTab, pickTab, toggleFull, type DockState } from "./dock";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, checkpointsOf, compact, duration, markOf, modelLabel, plural } from "./model";
import { ContextMenu, Disc, ModelTag, Num, PanelHead, Pop, Row, Sep } from "./ui";
import { AddonView, appIcon, appsFor, isPanelAsk } from "./Addon";
import { pin, usePins } from "./TopBar";
import { BrowserSurface } from "./Browser";
import { DesignSurface } from "./Design";
import { DeviceSurface } from "./Device";
import { FilesSurface } from "./Files";
import { toComposer } from "./Find";
import { LinkedSurface, PrSurface } from "./Pr";
import { Review, TurnPicker, Viewed } from "./Review";
import { RoutinesList, RunDetail } from "./Routines";
import { ship } from "./Ship";
import { SideChat } from "./SideChat";
import { Guide, surfaceOf, type Tab } from "./Surfaces";
import { undoTurn } from "./undo";
import "./dock.css";
// The terminal brings xterm.js; it loads the first time you open one.
const TerminalSurface = lazy(() => import("./Terminal").then((m) => ({ default: m.TerminalSurface })));
const SessionSurface = lazy(() => import("./SessionInfo").then((m) => ({ default: m.SessionSurface })));

/** A chip on its way between panes. */
const DRAG = "application/x-liner-tab";
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function Panel({
  thread,
  items,
  dock,
  onDock,
  focus,
  onFocus,
  agentName,
  onOpenSession,
  onRoutine,
  leaving,
}: {
  thread: Thread;
  items: Item[];
  dock: DockState;
  onDock: (d: DockState) => void;
  focus: { id: string; path?: string } | null;
  onFocus: (f: { id: string; path?: string } | null) => void;
  agentName: string;
  onOpenSession: (id: string, tab?: Tab) => void;
  onRoutine: (id?: string) => void;
  /** Shut, and on its way out: it stays as it was while its column closes, and takes no clicks. */
  leaving?: boolean;
}) {
  const runs = useEngine((s) => s.runs);
  const addons = useEngine((s) => s.addons);
  const asks = useMemo(() => items.filter(isPanelAsk) as Extract<Item, { kind: "approval" }>[], [items]);
  /** A tab's name and icon: a surface's, a run's, an add-on's, or a preview's. */
  const meta = (t: Tab) => {
    if (t === GUIDE) return { label: "New tab", icon: I.guide };
    if (t.startsWith("run:")) {
      const r = runs.find((x) => x.id === t.slice(4));
      return { label: r?.subject ? `Run on #${r.subject.number}` : "A run", icon: I.routines };
    }
    if (t.startsWith("app:")) {
      const a = addons.find((x) => x.id === t.slice(4));
      return { label: a?.name ?? "An add-on", icon: appIcon(a?.panel?.icon), app: true };
    }
    if (t.startsWith("preview:")) {
      const a = asks.find((x) => x.id === t.slice(8))?.addon;
      return { label: a?.name ?? "A preview", icon: appIcon(a?.kind === "panel" ? a.icon : undefined), preview: true };
    }
    const s = surfaceOf(t);
    return { label: s?.label ?? t, short: t === "linked" ? "Linked" : undefined, icon: s?.icon ?? I.routines };
  };
  // Only surfaces you've opened mount; once mounted they stay while they're open in either pane.
  const shown = dock.panes.map((p) => p.tab);
  const all = [...new Set(dock.panes.flatMap((p) => p.tabs))].filter((t) => t !== GUIDE);
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set(shown));
  useEffect(() => {
    setMounted((m) => (shown.every((t) => m.has(t)) ? m : new Set([...m, ...shown])));
  }, [shown.join()]);
  useEffect(() => setMounted((m) => new Set([...m].filter((t) => all.includes(t)))), [all.join()]);
  const [dragging, setDragging] = useState<Tab | null>(null);
  const [drop, setDrop] = useState<{ pane: number; split?: boolean } | null>(null);
  const open = (t: Tab, pane?: number) => onDock(openTab(dock, t, pane));
  const wideReview = dock.full && dock.panes.length === 1 && dock.panes[0].tab === "changes";
  const make = () => toComposer(thread.id, "Make me a panel that ");

  const body = (t: Tab, visible: boolean) => {
    if (t === "changes") return wideReview ? <Review thread={thread} items={items} focus={focus} onFocus={onFocus} onBack={() => onDock({ ...dock, full: false })} /> : <Changes thread={thread} items={items} focus={focus} onFocus={onFocus} />;
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
    if (t === "side") return <SideChat thread={thread} visible={visible} />;
    if (t === "browser") return <BrowserSurface thread={thread} agentName={agentName} hidden={!visible} />;
    if (t === "design") return <DesignSurface thread={thread} items={items} agentName={agentName} visible={visible} />;
    if (t === "files") return <FilesSurface thread={thread} items={items} onShowChanges={(id, path) => (onFocus({ id, path }), open("changes"))} />;
    if (t === "pr") return <PrSurface thread={thread} agentName={agentName} visible={visible} />;
    if (t === "linked") return <LinkedSurface thread={thread} agentName={agentName} onOpenSession={(id) => onOpenSession(id)} />;
    if (t === "device") return <DeviceSurface thread={thread} agentName={agentName} visible={visible} />;
    if (t === "routines") return <RoutinesList projectId={thread.projectId} compact onNew={() => onRoutine()} onEdit={(id) => onRoutine(id)} onRun={(r) => open(`run:${r.id}`)} />;
    if (t.startsWith("run:")) return <RunDetail runId={t.slice(4)} onOpenSession={(id) => (id === thread.id ? undefined : onOpenSession(id, t))} />;
    if (t.startsWith("app:")) return <AddonView addon={t.slice(4)} thread={thread} agentName={agentName} visible={visible} />;
    if (t.startsWith("preview:")) {
      const a = asks.find((x) => x.id === t.slice(8))?.addon;
      return <AddonView addon={a?.id ?? ""} preview={t.slice(8)} thread={thread} agentName={agentName} visible={visible} />;
    }
    return null;
  };

  const dropOn = (e: DragEvent, pane: number, index?: number, splitIt?: boolean) => {
    const t = e.dataTransfer.getData(DRAG) || dragging;
    setDrop(null);
    setDragging(null);
    if (!t) return;
    e.preventDefault();
    onDock(splitIt ? moveTab(dock, t, dock.panes.length) : moveTab(dock, t, pane, index));
  };
  const allow = (e: DragEvent) => {
    if (!dragging && !e.dataTransfer.types.includes(DRAG)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    return true;
  };

  return (
    <aside
      className="lc-panel lc-dockpanes"
      aria-label="Dock"
      style={{ "--panes": dock.panes.length } as CSSProperties}
      data-wide-review={wideReview || undefined}
      data-leaving={leaving || undefined}
      data-dragging={dragging ? true : undefined}
      inert={leaving || undefined}
    >
      {!wideReview &&
        dock.panes.map((_, i) => (
          <Strip
            key={i}
            i={i}
            dock={dock}
            onDock={onDock}
            meta={meta}
            last={i === dock.panes.length - 1}
            dropping={drop?.pane === i && !drop.split}
            onDragTab={(t) => setDragging(t)}
            onDragEnd={() => (setDragging(null), setDrop(null))}
            onDragOver={(e) => allow(e) && setDrop({ pane: i })}
            onDrop={(e, index) => dropOn(e, i, index)}
            style={{ gridColumn: i + 1 }}
            label={`Pane ${i + 1}`}
            projectId={thread.projectId}
          />
        ))}
      {dock.panes.map((p, i) =>
        p.tab === GUIDE ? (
          <div key={`guide:${i}`} className="lc-surface" role="tabpanel" aria-label="New tab" data-pane={i} style={{ gridColumn: i + 1, gridRow: 2 }}>
            <Guide thread={thread} items={items} agentName={agentName} panes={dock.panes.length} onOpen={(t) => open(t, i)} onMake={make} />
          </div>
        ) : null,
      )}
      {all.map((t) => {
        if (!mounted.has(t)) return null;
        const i = dock.panes.findIndex((p) => p.tabs.includes(t));
        const visible = i >= 0 && dock.panes[i].tab === t;
        return (
          <div key={t} className="lc-surface" hidden={!visible} role="tabpanel" aria-label={meta(t).label} data-pane={Math.max(0, i)} style={{ gridColumn: Math.max(0, i) + 1, gridRow: wideReview ? "1 / span 2" : 2 }} onPointerDown={() => i !== dock.at && onDock({ ...dock, at: i })}>
            {/* One surface that breaks says so in its own tab; the others and the session go on. */}
            <Boundary label={meta(t).label} quiet>
              {body(t, visible && dock.open)}
            </Boundary>
          </div>
        );
      })}
      {/* While a chip is dragged, each pane's body takes the drop (a page or a terminal under it would swallow it). */}
      {dragging &&
        dock.panes.map((_, i) => (
          <div key={`drop:${i}`} className="lc-dropzone" style={{ gridColumn: i + 1, gridRow: 2 }} data-on={drop?.pane === i || undefined} data-split={(drop?.pane === i && drop.split) || undefined}>
            <div
              className="lc-dropzone-l"
              onDragOver={(e) => allow(e) && setDrop({ pane: i })}
              onDragLeave={() => setDrop(null)}
              onDrop={(e) => dropOn(e, i)}
            />
            <div
              className="lc-dropzone-r"
              onDragOver={(e) => allow(e) && setDrop({ pane: i })}
              onDragLeave={() => setDrop(null)}
              onDrop={(e) => dropOn(e, i)}
            />
          </div>
        ))}
    </aside>
  );
}

/**
  One pane's strip, which is the panel's header (TasteCode v0.5): the apps you pinned first, as
  icons, then every tab with its name, the + that opens the guide, and in the last pane the full
  canvas. The header's own button shows and hides the panel.
*/
function Strip({ i, dock, onDock, meta, last, dropping, onDragTab, onDragEnd, onDragOver, onDrop, style, label, projectId }: {
  i: number;
  dock: DockState;
  onDock: (d: DockState) => void;
  meta: (t: Tab) => { label: string; short?: string; icon: (p: { size?: number }) => React.ReactNode; preview?: boolean };
  last: boolean;
  dropping: boolean;
  onDragTab: (t: Tab) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent, index?: number) => void;
  style: CSSProperties;
  label: string;
  projectId: string;
}) {
  const p = dock.panes[i];
  const pins = usePins();
  const addons = useEngine((s) => s.addons);
  const pinnedApps = i === 0 ? appsFor(addons, projectId).filter((a) => pins.includes(a.id) && !dock.panes.some((x) => x.tabs.includes(`app:${a.id}`))) : [];
  const row = useRef<HTMLDivElement>(null);
  const [plate, setPlate] = useState<{ x: number; w: number; moved: boolean } | null>(null);
  const [menu, setMenu] = useState<{ t: Tab; x: number; y: number } | null>(null);
  // One white plate glides to the tab that's up (Liner's rule: one highlight moves between targets).
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const place = () => {
      const tab = el.querySelector<HTMLElement>(".lc-stab[data-on]");
      setPlate((was) => (tab ? { x: tab.offsetLeft, w: tab.offsetWidth, moved: Boolean(was) } : null));
    };
    place();
    const ro = new ResizeObserver(place);
    for (const t of el.querySelectorAll(".lc-stab")) ro.observe(t);
    return () => ro.disconnect();
  }, [p.tab, p.tabs.join()]);
  // Manual activation, as WAI-ARIA tabs: the arrows, Home and End move between chips; Enter or Space picks one.
  const onKey = (e: ReactKeyboardEvent) => {
    const chips = [...(row.current?.querySelectorAll<HTMLButtonElement>(".lc-stab-b") ?? [])];
    const k = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (k < 0) return;
    const to = e.key === "ArrowRight" ? (k + 1) % chips.length : e.key === "ArrowLeft" ? (k - 1 + chips.length) % chips.length : e.key === "Home" ? 0 : e.key === "End" ? chips.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    chips[to].focus();
  };
  const two = dock.panes.length > 1;
  return (
    <div className="lc-panel-top lc-stabs" role="presentation" style={style} data-pane={i} data-drag data-drop={dropping || undefined} onDragOver={onDragOver} onDrop={(e) => onDrop(e)}>
      {pinnedApps.map((a) => {
        const Icon = appIcon(a.panel?.icon);
        return (
          <Tooltip key={a.id} content={`${a.name} · pinned`}>
            <button type="button" className="lc-stab-pin l-focus" aria-label={`${a.name}, pinned`} onClick={() => onDock(openTab(dock, `app:${a.id}`, i))}>
              <Icon size={14} />
            </button>
          </Tooltip>
        );
      })}
      <div ref={row} className="lc-stabs-row" role="tablist" aria-label={label} data-plate={plate ? "" : undefined} onKeyDown={onKey}>
        {plate && <span className="lc-stab-plate" data-moved={plate.moved || undefined} style={{ transform: `translateX(${plate.x}px)`, width: plate.w }} aria-hidden />}
        {p.tabs.map((t, k) => {
          const m = meta(t);
          const Icon = m.icon;
          const on = p.tab === t;
          // The guide standing as the dock's only tab has no close (DeepSeek's sole-tab rule).
          const closable = !(t === GUIDE && dock.panes.length === 1 && p.tabs.length === 1);
          return (
            <span
              key={t}
              className="lc-stab"
              data-on={on || undefined}
              data-preview={m.preview || undefined}
              onDragOver={onDragOver}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, k);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                aria-label={m.label}
                className="lc-stab-b l-focus"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG, t);
                  e.dataTransfer.effectAllowed = "move";
                  onDragTab(t);
                }}
                onDragEnd={onDragEnd}
                onClick={() => onDock(pickTab(dock, i, t))}
                // A tab down to its icon has no close of its own: a middle click closes it, as in a browser.
                onAuxClick={(e) => closable && e.button === 1 && (e.preventDefault(), onDock(closeTab(dock, t)))}
                onContextMenu={(e) => (e.preventDefault(), setMenu({ t, x: e.clientX, y: e.clientY }))}
                title={on ? m.label : `${m.label} · middle-click to close`}
              >
                <Icon size={13} />
                <span>{m.short ?? m.label}</span>
                {m.preview && <small className="lc-stab-tag">Preview</small>}
              </button>
              {closable && (
                <button type="button" className="lc-stab-x l-focus" tabIndex={on ? 0 : -1} aria-label={`Close ${m.label}`} onClick={() => onDock(closeTab(dock, t))}>
                  <I.close size={10} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!p.tabs.includes(GUIDE) && (
        <Tooltip content="New tab">
          <button type="button" className="lc-ib l-focus" aria-label="New tab" onClick={() => onDock(openTab(dock, GUIDE, i))}>
            <I.plus size={14} />
          </button>
        </Tooltip>
      )}
      <span className="lc-grow" data-drag />
      {last && (
        <Tooltip content={dock.full ? "Leave the full canvas" : "Open in the full canvas"}>
          <button type="button" className="lc-ib l-focus" aria-label={dock.full ? "Leave the full canvas" : "Open in the full canvas"} aria-pressed={dock.full} onClick={() => onDock(toggleFull(dock))}>
            {dock.full ? <I.shrink size={15} /> : <I.expand size={15} />}
          </button>
        </Tooltip>
      )}
      <ContextMenu at={menu} label={menu ? `${meta(menu.t).label}, its tab` : "A tab"} onClose={() => setMenu(null)}>
        {(close) =>
          menu && (
            <>
              {two && <Row title={i === 0 ? "Move to the right pane" : "Move to the left pane"} icon={<I.split size={13} />} onPick={() => (close(), onDock(moveTab(dock, menu.t, i === 0 ? 1 : 0)))} />}
              {menu.t.startsWith("app:") && (
                <Row
                  title={pins.includes(menu.t.slice(4)) ? "Unpin from the panel" : "Pin to the panel"}
                  note={pins.includes(menu.t.slice(4)) ? undefined : "Its tab stays at the strip's start"}
                  icon={<I.pin size={13} />}
                  onPick={() => (close(), pin(menu.t.slice(4), !pins.includes(menu.t.slice(4))))}
                />
              )}
              {(two || menu.t.startsWith("app:")) && <Sep />}
              <Row title="Close" icon={<I.close size={13} />} onPick={() => (close(), onDock(closeTab(dock, menu.t)))} />
              <Row title="Close the others" icon={<I.close size={13} />} disabled={p.tabs.length < 2} onPick={() => (close(), onDock(closeOthers(dock, menu.t)))} />
            </>
          )
        }
      </ContextMenu>
    </div>
  );
}

/** With nothing to commit, the diff's foot still pushes the branch or opens a pull request. */
function PushButton({ thread, branch }: { thread: Thread; branch?: string }) {
  return (
    <Pop label="Push or open a pull request" side="top" align="end" width={280} triggerClass="lc-btn" disabled={thread.status === "running"} trigger={<><I.push size={14} />Push</>}>
      {(close) => (
        <div className="lc-ship-menu">
          <PanelHead>Nothing to commit</PanelHead>
          <Row title={`Push ${branch ?? "this branch"}`} note="To its branch on GitHub" icon={<I.push size={13} />} onPick={() => (close(), void ship(thread, null))} />
          <Row title="Open a pull request" note="The PR card, in the chat" icon={<I.pr size={13} />} onPick={() => (close(), void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail))} />
        </div>
      )}
    </Pop>
  );
}
function Changes({ thread, items, focus, onFocus }: { thread: Thread; items: Item[]; focus: { id: string; path?: string } | null; onFocus: (f: { id: string; path?: string } | null) => void }) {
  const branch = useEngine((s) => thread.worktree?.branch ?? s.projects.find((p) => p.id === thread.projectId)?.branch);
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
    el?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setViewed((v) => new Set(v).add(focus.path!));
  }, [diff, focus?.path]);

  const files = pick === "all" || pick === "branch" ? (diff ?? []).map((d) => ({ path: d.path, added: 0, removed: 0 })) : (cp?.files ?? []);
  // Looked at: this turn's files you've opened, not ones from another turn.
  const seen = files.filter((f) => viewed.has(f.path)).length;
  const open = cps.filter((c) => !c.reverted && !c.committed);
  const openFiles = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;

  const undo = async () => {
    if (!cp) return;
    setBusy("undo");
    try {
      await undoTurn(thread.id, cp);
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
        <Viewed seen={seen} total={files.length} />
        <span className="lc-grow" />
        {cp && !cp.reverted && !cp.committed && (
          <button type="button" className="lc-btn" data-kind="ghost" disabled={busy !== null || thread.status === "running"} onClick={() => void undo()}>
            <I.undo size={14} />
            Undo turn {cp.turn}
          </button>
        )}
        {openFiles > 0 ? <CommitButton thread={thread} files={openFiles} disabled={busy !== null || thread.status === "running"} /> : <PushButton thread={thread} branch={branch} />}
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
  // No cost reported: say who pays, as the engine bills it (runtime.ts gives Claude Code the Anthropic
  // key when it bills to the key, and Codex the OpenAI key whenever one is saved).
  const settings = useEngine((s) => s.settings);
  const keys = useEngine((s) => s.keys);
  const ran = [...new Set([...turns.map((t) => t.model), thread.model ?? coder.model].filter(Boolean).map((m) => m!.replace(/^@/, "").split(":")[0]))];
  const payer = (id: string) => {
    if (id === "demo") return "Nothing: a scripted run";
    const p = providers.find((x) => x.id === id);
    if (p?.endpoint) return `Billed by ${p.label}`;
    if (id === "claude" && settings.claudeBilling === "key" && keys.includes("anthropic")) return "Billed to your Anthropic key";
    if (id === "codex" && keys.includes("openai")) return "Billed to your OpenAI key";
    return "Included in your plan";
  };
  const unpriced = [...new Set(ran.map(payer))].join("; ") || "Included in your plan";
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
                {a.name} <span className="lc-quiet">{isLead ? "Plans" : a.role || "Agent"}</span>
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
          <dd>{u.costUsd ? <Num as="money" value={u.costUsd} /> : unpriced}</dd>
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
