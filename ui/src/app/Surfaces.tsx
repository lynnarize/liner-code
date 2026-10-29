/*
  Surfaces beside a session. The panel holds them as tabs: Diff and Agents, and whatever else
  you open from the + (Browser, Terminal, Files, Pull request, Linked pull requests, Device,
  Routines). Each key opens its surface from the picker. Tabs keep their state while you
  switch, so a terminal keeps running and a page stays loaded. The panel sits beside the
  session, fills the window, or docks under the thread.
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Item, Thread } from "@contracts";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { checkpointsOf, plural, sumLines } from "./model";
import { Kbd, Lines } from "./ui";
import "./surfaces.css";

export type SurfaceId = "session" | "side" | "changes" | "agents" | "files" | "terminal" | "browser" | "pr" | "linked" | "device" | "routines";
/** A tab: a surface, or one routine run (`run:<id>`). */
export type Tab = SurfaceId | `run:${string}`;

export const SURFACES: { id: SurfaceId; label: string; key: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "session", label: "Session", key: "I", icon: I.details },
  { id: "side", label: "Side chat", key: "C", icon: I.comment },
  { id: "browser", label: "Browser", key: "B", icon: I.globe },
  { id: "terminal", label: "Terminal", key: "T", icon: I.terminal },
  { id: "files", label: "Files", key: "F", icon: I.file },
  { id: "changes", label: "Diff", key: "D", icon: I.changes },
  { id: "pr", label: "Pull request", key: "P", icon: I.pr },
  { id: "linked", label: "Linked pull requests", key: "L", icon: I.link },
  { id: "device", label: "Device", key: "M", icon: I.device },
  { id: "routines", label: "Routines", key: "R", icon: I.routines },
  { id: "agents", label: "Agents", key: "A", icon: I.agents },
];
export const surfaceOf = (id: Tab) => SURFACES.find((s) => s.id === id);
const short = (id: Tab) => (id === "linked" ? "Linked" : id.startsWith("run:") ? "Run" : (surfaceOf(id)?.label ?? id));

export type PanelState = { open: boolean; tabs: Tab[]; tab: Tab; wide: boolean; dock: "side" | "bottom"; picking: boolean };
export const initialPanel = (): PanelState => ({ open: false, tabs: ["session", "agents", "changes"], tab: "changes", wide: false, dock: "side", picking: false });

/** Each session keeps its own panel while the app is open. */
const kept = new Map<string, PanelState>();
export const keptPanel = (threadId: string) => kept.get(threadId) ?? initialPanel();
export const keepPanel = (threadId: string, p: PanelState) => void kept.set(threadId, p);

/*
  The panel's width beside the session, the same in every session: about a third of the paper
  until you drag its edge (app.css). The panel keeps PANE_MIN, and the thread THREAD_MIN, so its
  composer keeps its controls.
*/
const WIDTH_KEY = "lc:panel-w";
const PANE_MIN = 320;
const THREAD_MIN = 420;
const readWidth = () => {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= PANE_MIN ? n : null;
  } catch {
    return null;
  }
};
export const usePanelWidth = () => useState<number | null>(readWidth);

/** The edge between the session and the panel: drag it, or use the arrow keys; double-click puts it back. */
export function PanelGrip({ body, width, onWidth, onDrag }: { body: RefObject<HTMLElement | null>; width: number | null; onWidth: (w: number | null) => void; onDrag: (on: boolean) => void }) {
  // While dragging: where the pointer and the width started (the edge moves with the pointer, from
  // wherever on the grip you took it), and the width it last asked for.
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = useRef<number | null>(null);
  const fit = (w: number) => Math.round(Math.max(PANE_MIN, Math.min(w, (body.current?.clientWidth ?? w + THREAD_MIN) - THREAD_MIN)));
  // The width as it shows: a kept one can be more than this window leaves room for.
  const shown = () => body.current?.querySelector<HTMLElement>(":scope > .lc-panel")?.offsetWidth ?? width ?? PANE_MIN;
  const keep = (w: number | null) => {
    onWidth(w);
    try {
      if (w === null) localStorage.removeItem(WIDTH_KEY);
      else localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // storage is off: it lasts while the app is open
    }
  };
  // Ends on the last width the pointer reached: losing the capture says nothing about where it was.
  const end = () => {
    if (start.current === null) return;
    if (last.current !== null) keep(last.current);
    start.current = null;
    last.current = null;
    onDrag(false);
  };
  return (
    <div
      className="lc-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="The panel's width"
      aria-valuenow={Math.round(shown())}
      aria-valuemin={PANE_MIN}
      tabIndex={0}
      title="Drag to resize · double-click to put it back"
      onPointerDown={(e) => {
        if (e.button !== 0 || !body.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: shown() };
        onDrag(true);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        last.current = fit(start.current.w + start.current.x - e.clientX);
        onWidth(last.current);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={() => keep(null)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
        if (!step) return;
        e.preventDefault();
        keep(fit(shown() + step));
      }}
    />
  );
}

/** Opens a tab (adding it when it isn't there yet) and shows the panel. */
export const openTab = (p: PanelState, tab: Tab): PanelState => ({ ...p, open: true, picking: false, tab, tabs: p.tabs.includes(tab) ? p.tabs : [...p.tabs, tab] });
export const closeTab = (p: PanelState, tab: Tab): PanelState => {
  const tabs = p.tabs.filter((t) => t !== tab);
  if (!tabs.length) return { ...p, tabs, open: false, wide: false, picking: false };
  const i = p.tabs.indexOf(tab);
  return { ...p, tabs, tab: p.tab === tab ? tabs[Math.max(0, i - 1)] : p.tab };
};

/** The strip on top of the panel: its tabs, the + that opens a surface, and how the panel sits. */
export function PanelTabs({ state, onState, label }: { state: PanelState; onState: (p: PanelState) => void; label: (t: Tab) => string }) {
  // One white plate glides to the open tab (Liner's rule: one highlight moves between targets).
  const row = useRef<HTMLDivElement>(null);
  const [plate, setPlate] = useState<{ x: number; w: number; moved: boolean } | null>(null);
  const on = state.picking ? null : state.tab;
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const place = () => {
      const tab = el.querySelector<HTMLElement>(".lc-stab[data-on]");
      setPlate((p) => (tab ? { x: tab.offsetLeft, w: tab.offsetWidth, moved: Boolean(p) } : null));
    };
    place();
    const ro = new ResizeObserver(place);
    for (const t of el.querySelectorAll(".lc-stab")) ro.observe(t);
    return () => ro.disconnect();
  }, [on, state.tabs.join()]);
  return (
    <div className="lc-panel-top lc-stabs" role="tablist" aria-label="Surfaces">
      <div ref={row} className="lc-stabs-row" data-many={state.tabs.length > 3 || undefined} data-plate={plate ? "" : undefined}>
        {plate && <span className="lc-stab-plate" data-moved={plate.moved || undefined} style={{ transform: `translateX(${plate.x}px)`, width: plate.w }} aria-hidden />}
        {state.tabs.map((t) => {
          const s = surfaceOf(t);
          const Icon = s?.icon ?? I.routines;
          const on = !state.picking && state.tab === t;
          return (
            <span key={t} className="lc-stab" data-on={on || undefined}>
              <button type="button" role="tab" aria-selected={on} className="lc-stab-b l-focus" onClick={() => onState({ ...state, tab: t, picking: false })} title={label(t)}>
                <Icon size={13} />
                <span>{short(t) === "Run" ? label(t) : short(t)}</span>
              </button>
              <button type="button" className="lc-stab-x l-focus" aria-label={`Close ${label(t)}`} onClick={() => onState(closeTab(state, t))}>
                <I.close size={10} />
              </button>
            </span>
          );
        })}
      </div>
      <button type="button" className="lc-ib l-focus" aria-label="Open a surface" aria-pressed={state.picking} title="Open a surface" onClick={() => onState({ ...state, picking: !state.picking })}>
        <I.plus size={14} />
      </button>
      <span className="lc-grow" />
      <button type="button" className="lc-ib l-focus" aria-label={state.wide ? "Back beside the session" : "Fill the window"} title={state.wide ? "Back beside the session" : "Fill the window"} aria-pressed={state.wide} onClick={() => onState({ ...state, wide: !state.wide, dock: "side" })}>
        <I.expand size={15} />
      </button>
      <button
        type="button"
        className="lc-ib l-focus"
        aria-label={state.dock === "bottom" ? "Dock beside the session" : "Dock under the session"}
        title={state.dock === "bottom" ? "Dock beside the session" : "Dock under the session"}
        aria-pressed={state.dock === "bottom"}
        onClick={() => onState({ ...state, dock: state.dock === "bottom" ? "side" : "bottom", wide: false })}
      >
        {state.dock === "bottom" ? <I.panel size={15} /> : <I.bottom size={15} />}
      </button>
      <button type="button" className="lc-ib l-focus" aria-label="Close the panel" onClick={() => onState({ ...state, open: false, wide: false, picking: false })}>
        <I.close size={14} />
      </button>
    </div>
  );
}

/** "Open a surface": every surface with what it holds right now, and its key. */
export function SurfacePicker({ thread, items, agentName, onOpen }: { thread: Thread; items: Item[]; agentName: string; onOpen: (s: SurfaceId) => void }) {
  const routines = useEngine((s) => s.routines);
  const runs = useEngine((s) => s.runs);
  const [ports, setPorts] = useState<{ port: number; process: string }[] | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void rpc("ports.list", {}).then((p) => live && setPorts(p)).catch(() => live && setPorts([]));
    void rpc("pr.status", { threadId: thread.id })
      .then((s) => live && setPr(s.pr ? `#${s.pr.number}, ${prLine(s.pr)}` : s.gh === "ready" ? (s.ahead ? `Open one for ${plural(s.ahead, "commit")}` : "Nothing to open yet") : ghLine(s.gh)))
      .catch(() => live && setPr("Not available"));
    void rpc("pr.list", { projectId: thread.projectId })
      .then((s) => {
        if (!live) return;
        if (s.gh !== "ready") return setLinked(ghLine(s.gh));
        const open = s.prs.filter((p) => p.state === "OPEN").length;
        const merged = s.prs.filter((p) => p.state === "MERGED").length;
        setLinked(s.prs.length ? `${open} open${merged ? `, ${merged} merged` : ""}` : "None in this project");
      })
      .catch(() => live && setLinked("Not available"));
    void rpc("device.list", {})
      .then((d) => {
        if (!live) return;
        const booted = d.devices.find((x) => x.state === "Booted");
        setDevice(!d.ready ? "Needs Xcode" : booted ? `${booted.name}, booted` : d.devices.length ? plural(d.devices.length, "simulator") : "No simulators yet");
      })
      .catch(() => live && setDevice("Not available"));
    box.current?.focus({ preventScroll: true });
    return () => {
      live = false;
    };
  }, [thread.id]);

  const cps = checkpointsOf(items);
  const last = cps[cps.length - 1];
  const open = cps.filter((c) => !c.reverted && !c.committed);
  const lines = sumLines(open.flatMap((c) => c.files));
  const files = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;
  const on = routines.filter((r) => r.on).length;
  const waits = runs.filter((r) => r.status === "handed" && !r.test).length;
  const dev = ports?.find((p) => /node|vite|next|bun|deno|python|ruby|php|astro|webpack/i.test(p.process)) ?? ports?.[0];

  const note: Record<SurfaceId, ReactNode> = {
    browser: ports === null ? "Looking for a dev server" : dev ? `localhost:${dev.port}` : "Nothing is listening yet",
    terminal: `A shell in ${thread.worktree ? "its worktree" : "the project"}`,
    files: last ? `${plural(last.files.length, "file")} changed in turn ${last.turn}` : "The project's files",
    changes: files ? (
      <>
        <Lines {...lines} /> in {plural(files, "file")}
      </>
    ) : (
      "Nothing to review"
    ),
    pr: pr ?? "Asking GitHub",
    linked: linked ?? "Asking GitHub",
    device: device ?? "Looking for simulators",
    routines: routines.length ? `${on} on${waits ? `, ${waits} ${waits === 1 ? "waits" : "wait"} for you` : ""}` : "None yet",
    agents: "Who works here, and on what",
    session: "Where it runs, its context, what changed",
    side: "Ask about it without stopping it",
  };

  return (
    <div
      ref={box}
      className="lc-spick"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).tagName === "INPUT") return;
        const s = SURFACES.find((x) => x.key === e.key.toUpperCase());
        if (s) {
          e.preventDefault();
          onOpen(s.id);
        }
      }}
    >
      <h2>Open a surface</h2>
      <p>Beside {agentName}'s session. Press its key, or pick one.</p>
      <div className="lc-spick-grid">
        {SURFACES.map((s, i) => (
          <button key={s.id} type="button" className="lc-spick-b l-focus" style={{ animationDelay: `${i * 22}ms` }} onClick={() => onOpen(s.id)}>
            <span className="lc-spick-i">
              <s.icon size={15} />
            </span>
            <span className="lc-spick-t">
              <b>{s.label}</b>
              <small>{note[s.id]}</small>
            </span>
            <Kbd>{s.key}</Kbd>
          </button>
        ))}
      </div>
      <p className="lc-spick-foot">Surfaces open as tabs up top. Dock the panel under the session from the strip.</p>
    </div>
  );
}

export const ghLine = (gh: string) => (gh === "missing" ? "Needs the GitHub CLI" : gh === "signed-out" ? "Sign in to GitHub first" : gh === "no-remote" ? "No GitHub remote" : "Not available");
export function prLine(pr: { state: string; checks: { state: string }[]; isDraft?: boolean }) {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  if (pr.checks.some((c) => c.state === "fail")) return "a check failed";
  if (pr.checks.some((c) => c.state === "pending")) return "checks running";
  if (pr.isDraft) return "a draft";
  return pr.checks.length ? "checks pass" : "open";
}

/** A surface's empty or waiting state, centred. */
export function SurfaceNote({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="lc-panel-empty">
      {icon}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Reads a CSS colour as hex, for libraries that can't read oklch. */
export function hexOf(css: string, fallback = "#000000") {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const x = c.getContext("2d");
  if (!x) return fallback;
  x.fillStyle = fallback;
  x.fillStyle = css;
  x.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 255 ? h(a) : ""}`;
}
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The session's working folder, for surfaces that open things there. */
export function useCwd(thread: Thread) {
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  return useMemo(() => thread.worktree?.path ?? project?.path ?? "", [thread.worktree?.path, project?.path]);
}

/* Project scripts sent to a session's Terminal surface: each runs in a shell of its own. */
type Script = { name: string; command: string };
const pendingScripts = new Map<string, Script[]>();
const scriptListeners = new Map<string, Set<(s: Script) => void>>();
export function runScript(threadId: string, s: Script) {
  const ls = scriptListeners.get(threadId);
  if (ls?.size) for (const l of ls) l(s);
  else pendingScripts.set(threadId, [...(pendingScripts.get(threadId) ?? []), s]);
}
export function takeScripts(threadId: string) {
  const list = pendingScripts.get(threadId) ?? [];
  pendingScripts.delete(threadId);
  return list;
}
export function onScript(threadId: string, fn: (s: Script) => void) {
  const set = scriptListeners.get(threadId) ?? new Set();
  set.add(fn);
  scriptListeners.set(threadId, set);
  return () => void set.delete(fn);
}
