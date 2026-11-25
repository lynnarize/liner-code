/*
  Surfaces beside a session. The right panel shows one at a time (dock.ts has its rules, Panel.tsx
  draws it): Changes and Agents, Browser, Design, Files, Pull request (its picker holds what Linked pull
  requests once listed, and the Linked key opens it), Device, Side chat, a routine's run, and the add-on
  panels you have; the Terminal lives in the bottom panel and Session is a popup. Each has a key (⌘⇧ and its letter) and a place in the session header's icon row or
  its ··· (Switcher.tsx). A surface keeps its state while another shows, so a terminal keeps running and
  a page stays loaded, and each session keeps its own panel.
*/
import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ROUTINES_ON, type Item, type Thread } from "@contracts";
import { closeWhere, emptyDock, readDock, type DockState, type DockTab } from "./dock";
import { useEngine } from "./engine";
import { I } from "./icons";
import { ago, plural, sumLines } from "./model";
import { Lines, Pop, Row as PickRow, Sep } from "./ui";
import "./surfaces.css";

export type SurfaceId = "session" | "side" | "changes" | "agents" | "files" | "terminal" | "browser" | "design" | "pr" | "linked" | "device" | "routines";
/** A tab: a surface, the New tab guide, one routine run (`run:<id>`), a panel (`app:<id>`) or the preview of one on its card (`preview:<item>`). */
export type Tab = DockTab;

type Surface = { id: SurfaceId; label: string; key: string; icon: (p: { size?: number }) => ReactNode };
const EVERY_SURFACE: Surface[] = [
  { id: "session", label: "Session", key: "I", icon: I.details },
  { id: "side", label: "Side chat", key: "C", icon: I.comment },
  { id: "browser", label: "Browser", key: "B", icon: I.globe },
  { id: "design", label: "Design", key: "E", icon: I.design },
  { id: "terminal", label: "Terminal", key: "T", icon: I.terminal },
  { id: "files", label: "Files", key: "F", icon: I.folder },
  { id: "changes", label: "Changes", key: "D", icon: I.changes },
  { id: "pr", label: "Pull request", key: "P", icon: I.pr },
  { id: "linked", label: "Linked pull requests", key: "L", icon: I.link },
  { id: "device", label: "Device", key: "M", icon: I.device },
  { id: "routines", label: "Routines", key: "R", icon: I.routines },
  { id: "agents", label: "Agents", key: "A", icon: I.agents },
];
// Routines switched off (contracts, ROUTINES_ON): no tab, no key, no place in the + menu, the guide or ⌘K.
export const SURFACES = EVERY_SURFACE.filter((s) => ROUTINES_ON || s.id !== "routines");

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
    // Routines switched off: a kept Routines tab, or one of a run, doesn't come back.
    if (read) return ROUTINES_ON ? read : closeWhere(read, (t) => t === "routines" || t.startsWith("run:"));
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
  composer keeps its controls. A surface can keep a width of its own under another key (Changes
  does: Session.tsx), with more room kept for the thread.
*/
const WIDTH_KEY = "lc:panel-w";
export const PANE_MIN = 320;
const THREAD_MIN = 420;
const readWidth = (key: string) => {
  try {
    const n = Number(localStorage.getItem(key));
    return n >= PANE_MIN ? n : null;
  } catch {
    return null;
  }
};
export const usePanelWidth = (key = WIDTH_KEY) => useState<number | null>(() => readWidth(key));

/** The edge between the session and the panel: drag it, or use the arrow keys; double-click puts it back. `store` is where the width is kept, `threadMin` what the thread keeps. */
export function PanelGrip({ body, width, onWidth, onDrag, store = WIDTH_KEY, threadMin = THREAD_MIN }: { body: RefObject<HTMLElement | null>; width: number | null; onWidth: (w: number | null) => void; onDrag: (on: boolean) => void; store?: string; threadMin?: number }) {
  // While dragging: where the pointer and the width started (the edge moves with the pointer, from
  // wherever on the grip you took it), and the width it last asked for.
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = useRef<number | null>(null);
  // Two panes show the dock 1.6 times the kept width (dock.css), so the edge works in kept widths.
  const k = () => (body.current?.closest<HTMLElement>(".lc-session")?.dataset.panes === "2" ? 1.6 : 1);
  const fit = (w: number) => Math.round(Math.max(PANE_MIN, Math.min(w, ((body.current?.clientWidth ?? w * k() + threadMin) - threadMin) / k())));
  // The width as it shows: a kept one can be more than this window leaves room for.
  const shown = () => {
    const el = body.current?.querySelector<HTMLElement>(":scope > .lc-panel");
    return el ? el.offsetWidth / k() : (width ?? PANE_MIN);
  };
  const keep = (w: number | null) => {
    onWidth(w);
    try {
      if (w === null) localStorage.removeItem(store);
      else localStorage.setItem(store, String(w));
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

const BELOW_H_KEY = "lc:below-h";
export const BELOW_MIN = 120;
const BELOW_THREAD_MIN = 160;
const readBelowH = () => {
  try {
    const n = Number(localStorage.getItem(BELOW_H_KEY));
    return n >= BELOW_MIN ? n : null;
  } catch {
    return null;
  }
};
export const useBelowHeight = () => useState<number | null>(readBelowH);

/** The horizontal resize handle at the top of the bottom terminal drawer: drag or arrow keys; double-click resets. */
export function TerminalGrip({ thread, height, onHeight, onDrag }: { thread: RefObject<HTMLElement | null>; height: number | null; onHeight: (h: number | null) => void; onDrag: (on: boolean) => void }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  const last = useRef<number | null>(null);
  const maxH = () => Math.max(BELOW_MIN + 40, (thread.current?.clientHeight ?? 600) - BELOW_THREAD_MIN);
  const fit = (h: number) => Math.round(Math.max(BELOW_MIN, Math.min(h, maxH())));
  const shown = () => {
    const el = thread.current?.querySelector<HTMLElement>(":scope > .lc-below");
    return el ? el.offsetHeight : (height ?? 220);
  };
  const keep = (h: number | null) => {
    onHeight(h);
    try {
      if (h === null) localStorage.removeItem(BELOW_H_KEY);
      else localStorage.setItem(BELOW_H_KEY, String(h));
    } catch {
      // storage off: lasts while the app is open
    }
  };
  const end = () => {
    if (start.current === null) return;
    if (last.current !== null) keep(last.current);
    start.current = null;
    last.current = null;
    onDrag(false);
  };
  return (
    <div
      className="lc-below-grip l-focus"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Terminal height"
      aria-valuenow={Math.round(shown())}
      aria-valuemin={BELOW_MIN}
      aria-valuemax={Math.round(maxH())}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0 || !thread.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: shown() };
        onDrag(true);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        last.current = fit(start.current.h + (start.current.y - e.clientY));
        onHeight(last.current);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={() => keep(null)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : 0;
        if (!step) return;
        e.preventDefault();
        keep(fit(shown() + step));
      }}
    />
  );
}

export function prLine(pr: { state: string; checks: { state: string }[]; isDraft?: boolean }) {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  if (pr.checks.some((c) => c.state === "fail")) return "a check failed";
  if (pr.checks.some((c) => c.state === "pending")) return "checks running";
  if (pr.isDraft) return "a draft";
  return pr.checks.length ? "checks pass" : "open";
}

/* ---------- Changes' pieces, used by Review.tsx ---------- */

type Checkpoint = Extract<Item, { kind: "checkpoint" }>;

/** Which turn's changes to show: one turn, all of them, or the branch against main. */
export function TurnPicker({ cps, pick, turns, onPick }: { cps: Checkpoint[]; pick: string; turns: number; onPick: (id: string) => void }) {
  const cp = cps.find((c) => c.id === pick);
  return (
    <Pop
      label="Pick a turn"
      width={320}
      triggerClass="lc-turnpick"
      trigger={
        <>
          {pick === "all" ? "All turns" : pick === "branch" ? "This branch" : `Turn ${cp?.turn ?? ""}`}
          {pick !== "all" && pick !== "branch" && <span className="lc-quiet">of {turns}</span>}
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => (
        <>
          <PickRow title="All turns in this session" note="Everything since the first change, as the tree is now" on={pick === "all"} onPick={() => (onPick("all"), close())} />
          <PickRow title="This branch against main" note="What a pull request from here would carry" on={pick === "branch"} onPick={() => (onPick("branch"), close())} />
          <Sep />
          {[...cps].reverse().map((c) => (
            <PickRow
              key={c.id}
              title={`Turn ${c.turn}`}
              note={`${ago(c.at)} · ${plural(c.files.length, "file")}${c.reverted ? " · undone" : c.committed ? ` · committed ${c.committed}` : ""}`}
              on={pick === c.id}
              end={<Lines {...sumLines(c.files)} />}
              onPick={() => (onPick(c.id), close())}
            />
          ))}
        </>
      )}
    </Pop>
  );
}

/** The engine sends the first 60 files; the rest are counted (T3 Code: chat/ChangedFilesTree.tsx). */
export function MoreFiles({ n, turn, pick }: { n: number; turn: boolean; pick: string | null }) {
  return (
    <p className="lc-rv-more lc-quiet">
      {plural(n, "more file")} {turn ? "in this turn" : pick === "branch" ? "on this branch" : "across all turns"} {n === 1 ? "isn't" : "aren't"} shown here.
    </p>
  );
}

/** A surface's empty or waiting state, centred: the panel frame's one empty state (Pane.tsx, PaneNote), under the name the surfaces already use. */
export { PaneNote as SurfaceNote } from "./Pane";

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
