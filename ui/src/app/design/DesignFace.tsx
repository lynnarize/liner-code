/*
  Liner Design's face of a design, in its tab: its design file on a canvas, and its session (the
  one begun from it, which it may not have yet: the first ask makes it). The top row holds the
  tabs (Tabs.tsx), who is drawing, "On its own" for a design on its own, the zoom and Play; the
  rail, the canvas and the dock fill the rest, and the inspector stands at the right. The
  sidebar's body for this face is Layers.tsx's DesignSide.

  The keys here are the canvas's: V and H, F for a frame, R and T to add, Esc to go up, Delete,
  ⌘D, ⌘[ and ⌘], ⌘Z and ⇧⌘Z, ⌘0 and ⌘1, ⌘+ and ⌘−. They're heard first (before the app's ⌘1 to
  ⌘9) and only while nothing that takes typing has the keyboard.
*/
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { Project, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "../engine";
import { I } from "../icons";
import { matches } from "../keymap";
import { Pop, Row, Sep } from "../ui";
import * as os from "../os";
import { patchTab, tabKey, type DesignTab } from "../face";
import { close as closeTabHere, OwnChip, Tabs } from "./Tabs";
import { editText, frames } from "./bridge";
import { Canvas, fit, parentIn } from "./Canvas";
import { Dock } from "./Dock";
import { ChatColumn, DockFloat, DockHosts, useHosts, useShownSize } from "./Chat";
import { Inspector } from "./Inspector";
import { reorder } from "./Layers";
import { insert, Rail } from "./Rail";
import { design, getDesign, isBlank, takeVanished, useDesign } from "./store";
import { LiveChip } from "./Live";
import { Versions } from "./Versions";
import "./design-face.css";
// E: the Lean page over the canvas, and whether it is up.
import { LeanLayer } from "./LeanPage";
import { isLeanOpen } from "./Skills";

/**
  A part of the Design face that broke (the canvas, the inspector, the dock) says so in its own
  place, in one plain sentence, with Draw it again; the rest of the face, the sidebar and the Code
  face go on working. As Boundary.tsx does for the panel's surfaces and the timeline's turns.
*/
export class FaceBoundary extends Component<{ children: ReactNode; what: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Liner Design] ${this.props.what} broke`, error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lc-broke ld-broke" role="alert" data-quiet data-what={this.props.what}>
        <b>The {this.props.what} hit a fault and stopped; your design file is as it was.</b>
        <span className="lc-quiet">{this.state.error.message || String(this.state.error)}</span>
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => {
          // What it showed is read again from the file, without the layer it tripped on.
          const s = getDesign();
          design.select(s.sel.filter((x) => !x.node));
          this.setState({ error: null });
        }}>
          Draw it again
        </button>
      </div>
    );
  }
}

/**
  A design file that can't be read: the engine's sentence, the file named, and no offer to make a
  new one over it. When this session kept a copy of it (a turn's, or one from before a bring-back),
  the newest can be brought back.
*/
function Unreadable({ thread, cwd, broken }: { thread?: Thread; cwd?: string; broken: { file: string; title?: string; why: string } }) {
  const [copies, setCopies] = useState<{ key: string; turn: number; at: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    // A design with no session yet has no kept copies.
    if (!thread) return void setCopies([]);
    void rpc("canvas.versions", { threadId: thread.id, file: broken.file }).then((v) => live && setCopies([...v].sort((a, b) => b.at - a.at)), () => live && setCopies([]));
    return () => void (live = false);
  }, [thread?.id, broken.file]);
  const last = copies?.[0];
  return (
    <>
      <I.alert size={20} />
      <b>The design file “{broken.title ?? broken.file}” can't be read</b>
      <span>{broken.why}</span>
      <span className="ld-mono">.liner/designs/{broken.file}/design.json</span>
      {last ? (
        <button type="button" className="lc-btn" data-kind="ink" disabled={busy} onClick={() => {
          if (!cwd || !thread) return;
          setBusy(true);
          void rpc("canvas.restore", { threadId: thread.id, file: broken.file, key: last.key })
            .then(() => design.open(cwd, broken.file))
            .catch((e: Error) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}>
          Bring back the copy from turn {last.turn}
        </button>
      ) : copies ? (
        <span>This session kept no copy of it to bring back. Its files are still in the folder as they are.</span>
      ) : null}
    </>
  );
}

/** The folder a session works in: its worktree, else its project's. */
export function cwdOf(thread: Thread, projects: { id: string; path: string }[]) {
  return thread.worktree?.path ?? projects.find((p) => p.id === thread.projectId)?.path;
}

const typing = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest("input, textarea, select, [contenteditable], .xterm"));
/** Focus in the chat or the dock (a fold, a trail row, an ask, a question's option): the canvas's plain keys aren't for it. */
const inChat = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".ld-dock, .ldc-col, .ldc-host"));

async function duplicate() {
  const s = getDesign();
  const nodes = s.sel.filter((x) => x.node);
  if (!nodes.length) return design.copyFrames(s.sel.map((x) => x.frame));
  const made: { frame: string; node: string }[] = [];
  for (const x of nodes) {
    if (!getDesign().tree[x.frame]) await design.refreshTree(x.frame);
    const here = parentIn(getDesign().tree[x.frame], x.node!);
    if (!here?.parent) continue;
    const read = await frames.read(x.frame, x.node!).catch(() => undefined);
    if (!read) continue;
    const id = `x${Math.random().toString(36).slice(2, 8)}`;
    const html = read.html.replace(/\sdata-l="[^"]*"/g, "").replace(/^<(\w+)/, `<$1 data-l="${id}"`);
    await design.apply(x.frame, [{ into: here.parent.id, insert: html, before: here.parent.children[here.i + 1]?.id }]);
    made.push({ frame: x.frame, node: id });
  }
  if (made.length) design.select(made);
}

async function remove() {
  const s = getDesign();
  const nodes = s.sel.filter((x) => x.node);
  const whole = s.sel.filter((x) => !x.node).map((x) => x.frame);
  const byFrame = new Map<string, string[]>();
  for (const x of nodes) byFrame.set(x.frame, [...(byFrame.get(x.frame) ?? []), x.node!]);
  design.select([]);
  for (const [frame, ids] of byFrame) await design.apply(frame, ids.map((id) => ({ id, remove: true as const })));
  if (whole.length) {
    const step = await design.removeFrames(whole);
    toast(whole.length === 1 ? "Took the frame away" : `Took ${whole.length} frames away`, { duration: 5000, ...(step ? { action: { label: "Undo", onClick: () => step.undo() } } : {}) });
  }
}

function up() {
  const s = getDesign();
  if (s.editing?.node) return editText(s.editing.frame, s.editing.node, false);
  const at = s.sel[0];
  if (!at) return;
  if (!at.node) return design.select([]);
  const here = parentIn(s.tree[at.frame], at.node);
  const parent = here?.parent;
  design.select([parent && parent.id !== s.tree[at.frame]?.id ? { frame: at.frame, node: parent.id } : { frame: at.frame }]);
}

function zoomBy(el: HTMLElement | null, k: number) {
  const s = getDesign();
  const r = el?.getBoundingClientRect();
  const cx = (r?.width ?? 800) / 2;
  const cy = (r?.height ?? 600) / 2;
  const z = Math.min(8, Math.max(0.02, s.zoom * k));
  design.view(z, { x: cx - ((cx - s.pan.x) * z) / s.zoom, y: cy - ((cy - s.pan.y) * z) / s.zoom });
}

function TopRow({ sidebar, onSidebar, cv, tab, project }: { sidebar: boolean; onSidebar: () => void; cv: React.RefObject<HTMLDivElement | null>; tab: DesignTab; project: Project }) {
  const zoom = useDesign((s) => s.zoom);
  const presence = useDesign((s) => s.presence);
  const play = useDesign((s) => s.tool === "play");
  const who = Object.values(presence);
  return (
    <header className="ld-bar" data-drag>
      {!sidebar && (
        <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" title={`Show the sidebar (${os.mod}\\)`} onClick={onSidebar}>
          <I.sidebar size={16} />
        </button>
      )}
      <Tabs />
      <span className="lc-grow" data-drag />
      <LiveChip />
      <Versions />
      {who.length > 0 && (
        <span className="ld-who" role="img" aria-label={`Drawing now: ${who.map((p) => p.name).join(" and ")}`}>
          {who.map((p) => (
            <i key={`${p.name}${p.lead}`} data-lead={p.lead || undefined}>
              {p.name.charAt(0).toUpperCase()}
            </i>
          ))}
        </span>
      )}
      {project.kind === "design" && <OwnChip tab={tab} project={project} />}
      <Pop label={`Zoom, ${Math.round(zoom * 100)}%`} width={220} align="end" triggerClass="ld-zoom" trigger={<><span className="ld-num">{Math.round(zoom * 100)}%</span><I.chevD size={12} /></>} menu>
        {(close) => (
          <>
            <Row title="Zoom in" end={<span className="ld-k">{os.mod}+</span>} onPick={() => (close(), zoomBy(cv.current, 1.25))} />
            <Row title="Zoom out" end={<span className="ld-k">{os.mod}−</span>} onPick={() => (close(), zoomBy(cv.current, 0.8))} />
            <Sep />
            <Row title="Zoom to fit" end={<span className="ld-k">{os.mod}1</span>} onPick={() => (close(), fit(cv.current))} />
            <Row title="Actual size" end={<span className="ld-k">{os.mod}0</span>} onPick={() => (close(), fit(cv.current, "actual"))} />
          </>
        )}
      </Pop>
      <button type="button" className="lc-tb l-focus" aria-label="Play: try the screens as they would run" title={play ? "Stop playing (Esc)" : "Play: try the screens as they would run"} aria-pressed={play} onClick={() => design.setTool(play ? "select" : "play")}>
        <I.play size={15} />
      </button>
    </header>
  );
}

/** Under an empty canvas: what to do first. */
function EmptyHint() {
  const empty = useDesign((s) => Boolean(s.file) && s.scrub === undefined && (s.file!.frames.length === 0 || s.file!.frames.every((f) => isBlank(s, f))));
  if (!empty) return null;
  return (
    <p className="ld-hint" aria-live="polite">
      <b>Nothing here yet.</b> Say what to make, or draw with the tools on the left.
    </p>
  );
}

export function DesignFace({ tab, project, thread, sidebar, onSidebar }: { tab: DesignTab; project: Project; thread?: Thread; sidebar: boolean; onSidebar: () => void }) {
  const key = tabKey(tab);
  // The design's folder: its session's worktree when it runs in one, else the project's.
  const cwd = thread?.worktree?.path ?? project.path;
  const file = useDesign((s) => s.file);
  const files = useDesign((s) => s.files);
  // The store holds this tab's file (not still the tab before's): only then is the canvas drawn, so it never fits or draws another tab's.
  const mine = useDesign((s) => s.cwd === cwd && s.file?.id === tab.file);
  const loading = useDesign((s) => s.loading);
  const broken = useDesign((s) => s.broken);
  const error = useDesign((s) => s.error);
  const cv = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // The chat: its size as shown (a narrow window shows a pinned chat open), and the hosts its one composer and conversation go in.
  const row = useRef<HTMLDivElement>(null);
  const { size, minimise } = useShownSize(row, thread?.id);
  const made = useHosts();
  const hosts = useMemo(() => ({ ...made, size, minimise }), [made, size, minimise]);

  // This tab's design file on the canvas, with its own view and steps; the tab before is parked.
  useEffect(() => {
    let live = true;
    setShown(false);
    void design.show(key, cwd, tab.file, thread?.id).finally(() => live && setShown(true));
    return () => void (live = false);
  }, [key, cwd, tab.file, thread?.id]);
  // Its name on the tab, as the file has it.
  useEffect(() => {
    if (file && file.id === tab.file && getDesign().cwd === cwd && file.title !== tab.title) patchTab(key, { title: file.title });
  }, [file?.title, file?.id]);
  // A design whose file went away (deleted, moved elsewhere) closes its tab, quietly.
  const gone = shown && !loading && !file && !broken && getDesign().cwd === cwd && !files.some((f) => f.id === tab.file);
  useEffect(() => {
    if (!gone) return;
    // Gone from under it (not closed by you): one quiet line says so.
    const was = takeVanished(cwd, tab.file);
    closeTabHere(key);
    if (was) toast(`${was} is gone`, { description: "Its files are no longer in its folder, so its tab closed.", duration: 4000 });
  }, [gone]);
  useEffect(() => {
    if (!error) return;
    toast.error(error);
    design.clearError();
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || typing(e.target) || isLeanOpen() || document.querySelector("dialog[open], .lc-pop-panel")) return;
      const s = getDesign();
      const done = () => (e.preventDefault(), e.stopPropagation());
      if (matches(e, "mod+z")) return done(), design.undo();
      if (matches(e, "mod+shift+z") || matches(e, "mod+y")) return done(), design.redo();
      if (matches(e, "mod+0")) return done(), fit(cv.current, "actual");
      if (matches(e, "mod+1")) return done(), fit(cv.current);
      if (matches(e, "mod+=") || matches(e, "mod+shift+=")) return done(), zoomBy(cv.current, 1.25);
      if (matches(e, "mod+-")) return done(), zoomBy(cv.current, 0.8);
      if (matches(e, "mod+d")) return done(), void duplicate();
      if (matches(e, "mod+[")) return done(), void reorder(-1);
      if (matches(e, "mod+]")) return done(), void reorder(1);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Delete, Enter, Esc and the tool letters pressed on a chat control are that control's, never the canvas's.
      if (inChat(e.target)) return;
      if (e.key === "Escape") {
        if (s.tool === "play" || s.tool === "frame") return done(), design.setTool("select");
        if (s.sel.length || s.editing) return done(), up();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") return s.sel.length ? (done(), void remove()) : undefined;
      if (e.key === "Enter" && s.node?.kind === "text" && s.sel[0]?.node === s.node.id) {
        done();
        design.edit({ frame: s.sel[0].frame, node: s.node.id });
        return editText(s.sel[0].frame, s.node.id, true);
      }
      const k = e.key.toLowerCase();
      if (k === "v") return done(), design.setTool("select");
      if (k === "h") return done(), design.setTool("hand");
      if (k === "f") return done(), design.setTool("frame");
      if (k === "r") return done(), void insert("box");
      if (k === "t") return done(), void insert("text");
    };
    // Heard before the app's own keys, so ⌘1 zooms here rather than opening a session.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="ld-face">
      <section className="ld-main" aria-label="Canvas">
        <TopRow sidebar={sidebar} onSidebar={onSidebar} cv={cv} tab={tab} project={project} />
        {/* The chat pinned is a column before the canvas (Chat.tsx); the split is always there, so pinning never draws the canvas anew. */}
        <DockHosts.Provider value={hosts}>
          <div ref={row} className="ldc-split">
            {size === "pinned" && (
              <FaceBoundary what="chat">
                <ChatColumn thread={thread} />
              </FaceBoundary>
            )}
            <div className="ld-cv">
              <Rail />
              {file && mine ? (
                <FaceBoundary what="canvas">
                  <Canvas root={cv} />
                </FaceBoundary>
              ) : (
                <div className="ld-empty">
                  {loading || (file && !mine) ? (
                    <span className="l-shimmer">Opening the design file</span>
                  ) : broken ? (
                    <Unreadable thread={thread} cwd={cwd} broken={broken} />
                  ) : (
                    <span className="l-shimmer">Opening the design file</span>
                  )}
                </div>
              )}
              <EmptyHint />
              {size !== "pinned" && <DockFloat />}
            </div>
          </div>
          {/* One composer and one conversation, whatever the size: they go into the hosts the places above hold. */}
          <FaceBoundary what="dock">
            <Dock thread={thread} project={project} tab={tab} />
          </FaceBoundary>
        </DockHosts.Provider>
      </section>
      <div className="ld-insp-col">
        <FaceBoundary what="inspector">
          <Inspector />
        </FaceBoundary>
      </div>
      <LeanLayer thread={thread} project={project} sidebar={sidebar} onSidebar={onSidebar} />
    </div>
  );
}
