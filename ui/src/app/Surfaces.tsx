/*
  Surfaces beside a session. The right dock holds them as tabs (dock.ts has its rules, Panel.tsx
  draws it): Diff and Agents, Browser, Design, Terminal, Files, Pull request, Linked pull requests,
  Device, Routines, a routine's run, and the add-on panels you have. Each has a key (⌘⇧ and its
  letter) and a button in the session's top-right row, or a place in its ⋯ menu; the New tab guide
  (the + on a pane's strip) lists them all. Tabs keep their state while you switch, so a terminal
  keeps running and a page stays loaded, and each session keeps its own dock.
*/
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AddonInfo, Item, Thread } from "@contracts";
import { emptyDock, readDock, type DockState, type DockTab } from "./dock";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { checkpointsOf, plural, sumLines } from "./model";
import { appIcon, appsFor } from "./Addon";
import { Kbd, Lines } from "./ui";
import "./surfaces.css";

export type SurfaceId = "session" | "side" | "changes" | "agents" | "files" | "terminal" | "browser" | "design" | "pr" | "linked" | "device" | "routines";
/** A tab: a surface, the New tab guide, one routine run (`run:<id>`), a panel (`app:<id>`) or the preview of one on its card (`preview:<item>`). */
export type Tab = DockTab;

export const SURFACES: { id: SurfaceId; label: string; key: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "session", label: "Session", key: "I", icon: I.details },
  { id: "side", label: "Side chat", key: "C", icon: I.comment },
  { id: "browser", label: "Browser", key: "B", icon: I.globe },
  { id: "design", label: "Design", key: "E", icon: I.design },
  { id: "terminal", label: "Terminal", key: "T", icon: I.terminal },
  { id: "files", label: "Files", key: "F", icon: I.file },
  { id: "changes", label: "Changes", key: "D", icon: I.changes },
  { id: "pr", label: "Pull request", key: "P", icon: I.pr },
  { id: "linked", label: "Linked pull requests", key: "L", icon: I.link },
  { id: "device", label: "Device", key: "M", icon: I.device },
  { id: "routines", label: "Routines", key: "R", icon: I.routines },
  { id: "agents", label: "Agents", key: "A", icon: I.agents },
];

export const surfaceOf = (id: Tab) => SURFACES.find((s) => s.id === id);

/*
  Each session's dock, while the app runs and after: kept in this window's storage by session, and
  read back only if it still makes sense (dock.ts, readDock). The Browser and the Terminal bring
  their own pages and shells back; the dock only says which tabs were open where.
*/
const docks = new Map<string, DockState>();
const DOCK_KEY = (threadId: string) => `lc:dock:${threadId}`;
export function keptDock(threadId: string): DockState {
  const have = docks.get(threadId);
  if (have) return have;
  try {
    const read = readDock(JSON.parse(localStorage.getItem(DOCK_KEY(threadId)) || "null"));
    if (read) return read;
  } catch {
    // none kept, or not readable: a fresh one
  }
  return emptyDock();
}
export function keepDock(threadId: string, d: DockState) {
  docks.set(threadId, d);
  try {
    // Previews are of a card that's gone when the app next opens.
    const lasting = { ...d, panes: d.panes.map((p) => ({ tabs: p.tabs.filter((t) => !t.startsWith("preview:")), tab: p.tab })) };
    localStorage.setItem(DOCK_KEY(threadId), JSON.stringify(lasting));
  } catch {
    // Full or blocked: it lasts while the app is open.
  }
}

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
  // Two panes show the dock 1.6 times the kept width (dock.css), so the edge works in kept widths.
  const k = () => (body.current?.closest<HTMLElement>(".lc-session")?.dataset.panes === "2" ? 1.6 : 1);
  const fit = (w: number) => Math.round(Math.max(PANE_MIN, Math.min(w, ((body.current?.clientWidth ?? w * k() + THREAD_MIN) - THREAD_MIN) / k())));
  // The width as it shows: a kept one can be more than this window leaves room for.
  const shown = () => {
    const el = body.current?.querySelector<HTMLElement>(":scope > .lc-panel");
    return el ? el.offsetWidth / k() : (width ?? PANE_MIN);
  };
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
        last.current = fit(start.current.w + (start.current.x - e.clientX) / k());
        onWidth(last.current);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={() => keep(null)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
        if (!step) return;
        e.preventDefault();
        keep(fit(shown() + step / k()));
      }}
    />
  );
}

/**
  The New tab guide, a pane's +: every built-in surface with what it holds right now and its key,
  then the panels you have, then Make one…, which asks the agent for one (DeepSeek Harness's guide
  page, ui-sidebar-right). Picking one puts it in this pane in the guide's place.
*/
export function Guide({ thread, items, agentName, panes, onOpen, onMake }: { thread: Thread; items: Item[]; agentName: string; panes: number; onOpen: (t: Tab) => void; onMake: () => void }) {
  const routines = useEngine((s) => s.routines);
  const runs = useEngine((s) => s.runs);
  const addons = useEngine((s) => s.addons);
  const projects = useEngine((s) => s.projects);
  const [ports, setPorts] = useState<{ port: number; owner: "session" | "project" | null; web: boolean }[] | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void rpc("ports.list", { threadId: thread.id }).then((p) => live && setPorts(p)).catch(() => live && setPorts([]));
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
  const dev = ports?.find((p) => p.owner && p.web);
  const designs = new Set(items.filter((x) => x.kind === "design").map((x) => (x.kind === "design" ? x.design : ""))).size;
  const apps = appsFor(addons, thread.projectId);
  const scopeOf = (a: AddonInfo) => (a.panel?.place === "page" ? "A page of its own" : a.project ? (projects.find((p) => p.id === a.project)?.name ?? "One project") : "Every project");

  const note: Record<SurfaceId, ReactNode> = {
    browser: ports === null ? "Looking for a dev server" : dev ? `localhost:${dev.port}` : "Its dev server, or its HTML pages",
    design: designs ? plural(designs, "design") : "Screens and prototypes, version by version",
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
      data-panes={panes}
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
      <h2>Open in this pane</h2>
      <p>Built in, and the apps you've made. Press a surface's key, or pick one.</p>
      <span className="lc-spick-k">Built in</span>
      <div className="lc-spick-grid">
        {SURFACES.map((s, i) => (
          <button key={s.id} type="button" className="lc-spick-b l-focus" style={{ animationDelay: `${i * 18}ms` }} onClick={() => onOpen(s.id)}>
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
      <span className="lc-spick-k">Your apps</span>
      <div className="lc-spick-grid">
        {apps.map((a, i) => {
          const Icon = appIcon(a.panel?.icon);
          return (
            <button key={a.id} type="button" className="lc-spick-b l-focus" style={{ animationDelay: `${(SURFACES.length + i) * 18}ms` }} onClick={() => onOpen(`app:${a.id}`)}>
              <span className="lc-spick-i">
                <Icon size={15} />
              </span>
              <span className="lc-spick-t">
                <b>{a.name}</b>
                <small>{scopeOf(a)}</small>
              </span>
            </button>
          );
        })}
        <button type="button" className="lc-spick-b l-focus" data-make style={{ animationDelay: `${(SURFACES.length + apps.length) * 18}ms` }} onClick={onMake}>
          <span className="lc-spick-i">
            <I.plus size={15} />
          </span>
          <span className="lc-spick-t">
            <b>Make one…</b>
            <small>Say what you'd like, and {agentName} makes it</small>
          </span>
        </button>
      </div>
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
