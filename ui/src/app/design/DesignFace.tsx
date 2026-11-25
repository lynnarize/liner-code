/*
  Liner Design's face of a design, in its tab: its design file on a canvas, and its session (the
  one begun from it, which it may not have yet: the first ask makes it). The top row holds the
  design's name with a menu of the open ones (Tabs.tsx; the sidebar lists them too), its kept
  copies as one menu, the zoom and Play, and one ··· with the rest: the live frames' server, Show
  in Finder, and Build in a project for a design on its own (who is drawing is on the frames and in
  the sidebar, not here). The rail, the canvas and the dock fill the rest, and the inspector stands
  at the right. The sidebar's body for this face is
  Layers.tsx's DesignSide, under the open designs.

  The keys here are the canvas's: V and H, F for a frame, R and T to add, Esc to go up, Delete,
  ⌘D, ⌘[ and ⌘], ⌘Z and ⇧⌘Z, ⌘0 and ⌘1, ⌘+ and ⌘−. They're heard first (before the app's ⌘1 to
  ⌘9) and only while nothing that takes typing has the keyboard.
*/
import { Component, memo, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { Project, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "../engine";
import { I, N } from "../icons";
import { matches } from "../keymap";
import { PaneButton, PaneNote, PaneTool } from "../Pane";
import { Pop, Row, Sep, SubMenu } from "../ui";
import { bridge } from "../bridge";
import { ProjectChooser } from "../Projects";
import * as os from "../os";
import { patchTab, setFace, tabKey, type DesignTab } from "../face";
import { buildIn, close as closeTabHere, ownPlace, TabTitle } from "./Tabs";
import { editText, frames, hearFrameKeys } from "./bridge";
import { Canvas, fit, parentIn } from "./Canvas";
import { Dock } from "./Dock";
import { ChatColumn, DockFloat, DockHosts, useHosts, useShownSize } from "./Chat";
import { Inspector } from "./Inspector";
import { reorder } from "./Layers";
import { insert, Rail } from "./Rail";
import { adoptedOriginOf, design, exportFrameHtml, getDesign, isBlank, takeVanished, useDesign } from "./store";
import { useLiveServer } from "./Live";
import { Versions } from "./Versions";
import "./design-face.css";
// E: the Lean page over the canvas, and whether it is up.
import { LeanLayer } from "./LeanPage";
import { isLeanOpen } from "./Skills";
import { useReadWhileShown } from "../unread";

// The face's big parts each read the store for themselves: the face drawn again (a tab shown, its loading) doesn't draw them again with it.
const RailPart = memo(Rail);
const DockPart = memo(Dock);
const InspectorPart = memo(Inspector);
const LeanPart = memo(LeanLayer);

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
    // Only a copy that opens: one whose design.json is broken too (the "before" copy a bring-back keeps of this very state) would bring the break back.
    void rpc("canvas.versions", { threadId: thread.id, file: broken.file }).then((v) => live && setCopies(v.filter((x) => !x.unreadable).sort((a, b) => b.at - a.at)), () => live && setCopies([]));
    return () => void (live = false);
  }, [thread?.id, broken.file]);
  const last = copies?.[0];
  // The one empty state every surface has (Pane.tsx), its one action the ink button.
  return (
    <PaneNote
      icon={<I.alert size={20} />}
      title={`The design file “${broken.title ?? broken.file}” can't be read`}
      action={
        last ? (
          <PaneButton ink disabled={busy} onClick={() => {
            if (!cwd || !thread) return;
            setBusy(true);
            void rpc("canvas.restore", { threadId: thread.id, file: broken.file, key: last.key })
              .then(() => design.open(cwd, broken.file))
              .catch((e: Error) => toast.error(e.message))
              .finally(() => setBusy(false));
          }}>
            Bring back the copy from turn {last.turn}
          </PaneButton>
        ) : undefined
      }
    >
      {broken.why}
      <span className="ld-mono">.liner/designs/{broken.file}/design.json</span>
      {copies && !last && <span>This session kept no copy of it to bring back. Its files are still in the folder as they are.</span>}
    </PaneNote>
  );
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
    // A drawn frame's layer is copied from its file's own source, never from the page on screen,
    // which may hold what its scripts built into it; a live page (or the mock) has only the page.
    const f = getDesign().file?.frames.find((y) => y.id === x.frame);
    const now = getDesign();
    let read: { html: string } | undefined;
    if (f?.kind === "drawn" && !now.mock && now.cwd && now.file) {
      read = await rpc("canvas.frame.node", { cwd: now.cwd, file: now.file.id, frame: x.frame, id: x.node! }).catch((e: Error) => void toast(`That layer wasn't duplicated: ${e.message}`, { duration: 3500 }));
    } else read = await frames.read(x.frame, x.node!).catch(() => undefined);
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
  // Its name is read before it goes, for the toast that says it went.
  const named = s.file?.frames.find((f) => f.id === whole[0])?.name ?? "the frame";
  const byFrame = new Map<string, string[]>();
  for (const x of nodes) byFrame.set(x.frame, [...(byFrame.get(x.frame) ?? []), x.node!]);
  design.select([]);
  for (const [frame, ids] of byFrame) await design.apply(frame, ids.map((id) => ({ id, remove: true as const })));
  if (whole.length) {
    const step = await design.removeFrames(whole);
    // Nothing went (an old turn shown, the engine refused): no toast says it did.
    if (step) toast(whole.length === 1 ? `Deleted ${named}` : `Deleted ${whole.length} frames`, { duration: 5000, action: { label: "Undo", onClick: () => step.undo() } });
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

/**
  The top row's ···, as a surface's top row keeps its everyday tools out and the rest under one: the
  live frames' server (useLiveServer), Show in Finder, and for a design on its own Build in a project,
  which opens the project chooser to the menu's side (as a sidebar row's Snooze until does).
*/
function TopMore({ tab, project }: { tab: DesignTab; project: Project }) {
  const live = useLiveServer();
  const [busy, setBusy] = useState(false);
  const own = project.kind === "design";
  // On its own, the design's folder is its project's; in a project, its folder under .liner/designs.
  const folder = own ? project.path : `${project.path.replace(/\/+$/, "")}/.liner/designs/${tab.file}`;
  const go = async (to: { projectId: string } | { path: string }, close: () => void) => {
    setBusy(true);
    try {
      await buildIn(tab, to);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Pop label="More for this design" menu align="end" width={280} triggerClass="lc-sw-b l-focus" triggerAttrs={{ title: "More" }} trigger={<N.more />}>
        {(close) => (
          <>
            {live.rows && (
              <>
                {live.rows(close)}
                <Sep />
              </>
            )}
            <Row title={`Show in ${os.fileManager}`} note={own ? ownPlace(project) : undefined} icon={<I.folder size={16} />} onPick={() => (close(), bridge.reveal(folder))} />
            {(() => {
              const s = getDesign();
              const targetFrame = s.sel[0]?.frame ?? s.file?.frames.find((f) => f.page === (s.page ?? s.file?.pages[0]?.id) && f.kind === "drawn")?.id;
              if (!targetFrame) return null;
              return (
                <>
                  <Row title="Copy frame HTML" icon={<I.code size={16} />} onPick={() => (close(), void exportFrameHtml(targetFrame, "copy"))} />
                  <Row title="Export frame HTML…" icon={<I.download size={16} />} onPick={() => (close(), void exportFrameHtml(targetFrame, "download"))} />
                </>
              );
            })()}
            {own && (
              <SubMenu title="Build in a project" icon={<I.link size={16} />} label="Build in a project: it moves into the project, conversation and all" width={420}>
                {() =>
                  busy ? (
                    <p className="ld-note ld-own-note">Moving the design in</p>
                  ) : (
                    <ProjectChooser
                      onPick={(p) => void go({ projectId: p.id }, close)}
                      extra={<Row title="Another folder" note="One that isn't a project yet" icon={<I.plus size={16} />} onPick={() => void bridge.pickFolder().then((path) => (path ? go({ path }, close) : undefined))} />}
                    />
                  )
                }
              </SubMenu>
            )}
          </>
        )}
      </Pop>
      {live.floats}
    </>
  );
}

function TopRow({ sidebar, onSidebar, cv, tab, project, inspOpen, onToggleInsp }: { sidebar: boolean; onSidebar: () => void; cv: React.RefObject<HTMLDivElement | null>; tab: DesignTab; project: Project; inspOpen: boolean; onToggleInsp: () => void }) {
  const zoom = useDesign((s) => s.zoom);
  const play = useDesign((s) => s.tool === "play");
  const cwd = useDesign((s) => s.cwd);
  const fileId = useDesign((s) => s.file?.id);
  const adopted = adoptedOriginOf(cwd, fileId);
  return (
    <header className="ld-bar" data-drag>
      {!sidebar && (
        <button type="button" className="lc-sw-b l-focus" aria-label="Show the sidebar" title={`Show the sidebar (${os.mod}\\)`} onClick={onSidebar}>
          <N.sidebar />
        </button>
      )}
      <TabTitle />
      {/* Where it came from, as a head's quiet words: a press goes back to that session. */}
      {adopted && (
        <button
          type="button"
          className="ld-from l-focus"
          title={`Adopted from Code session “${adopted.title}”: go back to it`}
          onClick={() => {
            setFace("code");
            window.dispatchEvent(new CustomEvent("lc:open-session", { detail: { id: adopted.threadId } }));
          }}
        >
          From Code
          <I.chevR size={12} />
        </button>
      )}
      <span className="lc-grow" data-drag />
      <Versions />
      <Pop label={`Zoom, ${Math.round(zoom * 100)}%`} width={220} align="end" triggerClass="ld-zoom" trigger={<><span className="ld-num">{Math.round(zoom * 100)}%</span><I.chevD size={12} /></>} menu>
        {(close) => (
          <>
            <Row title="Zoom in" icon={<I.plus size={16} />} end={<span className="ld-k">{os.mod}+</span>} onPick={() => (close(), zoomBy(cv.current, 1.25))} />
            <Row title="Zoom out" icon={<I.minus size={16} />} end={<span className="ld-k">{os.mod}−</span>} onPick={() => (close(), zoomBy(cv.current, 0.8))} />
            <Sep />
            <Row title="Zoom to fit" icon={<I.fit size={16} />} end={<span className="ld-k">{os.mod}1</span>} onPick={() => (close(), fit(cv.current))} />
            <Row title="Actual size" icon={<I.actual size={16} />} end={<span className="ld-k">{os.mod}0</span>} onPick={() => (close(), fit(cv.current, "actual"))} />
          </>
        )}
      </Pop>
      {/* The session header's buttons (the Code face's switcher): 32 square, 20px icons. */}
      <button type="button" className="lc-sw-b l-focus" aria-label="Play: try the screens as they would run" title={play ? "Stop playing (Esc)" : "Play: try the screens as they would run"} aria-pressed={play} onClick={() => design.setTool(play ? "select" : "play")}>
        <I.play size={20} />
      </button>
      {!inspOpen && (
        <button type="button" className="lc-sw-b l-focus" aria-label="Show inspector" title={`Show inspector (${os.keys("mod+alt+i")})`} onClick={onToggleInsp}>
          <I.panel size={20} />
        </button>
      )}
      <TopMore tab={tab} project={project} />
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
  // The design on screen is read, as a session open in Code is: a question it asks stops being news (unread.ts).
  useReadWhileShown(thread?.id, thread?.unread);
  // The design's folder: its session's worktree when it runs in one, else the project's.
  const cwd = thread?.worktree?.path ?? project.path;
  // Only the open file's id and title: a frame dragged on the canvas draws nothing of the face round it.
  const fileId = useDesign((s) => s.file?.id);
  const fileTitle = useDesign((s) => s.file?.title);
  const files = useDesign((s) => s.files);
  // The store holds this tab's file (not still the tab before's): only then is the canvas drawn, so it never fits or draws another tab's.
  const mine = useDesign((s) => s.cwd === cwd && s.file?.id === tab.file);
  const loading = useDesign((s) => s.loading);
  const broken = useDesign((s) => s.broken);
  const error = useDesign((s) => s.error);
  const cv = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [inspOpen, setInspOpen] = useState(() => {
    try {
      return localStorage.getItem("liner.ld.insp") !== "0";
    } catch {
      return true;
    }
  });
  const toggleInsp = () =>
    setInspOpen((was) => {
      const next = !was;
      try {
        localStorage.setItem("liner.ld.insp", next ? "1" : "0");
      } catch {
        // storage off
      }
      return next;
    });
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
    if (fileId && fileTitle !== undefined && fileId === tab.file && getDesign().cwd === cwd && fileTitle !== tab.title) patchTab(key, { title: fileTitle });
  }, [fileTitle, fileId]);
  // A design whose file went away (deleted, moved elsewhere) closes its tab, quietly.
  const gone = shown && !loading && !fileId && !broken && getDesign().cwd === cwd && !files.some((f) => f.id === tab.file);
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
      if (matches(e, "mod+alt+i")) return done(), toggleInsp();
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
    // A frame tells the canvas its keys only where it needs to: in Play, or a live frame (bridge.ts).
    hearFrameKeys((frame) => {
      const s = getDesign();
      return s.tool === "play" || s.file?.frames.find((f) => f.id === frame)?.kind === "live";
    });
    // Heard before the app's own keys, so ⌘1 zooms here rather than opening a session.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="ld-face" data-insp={inspOpen || undefined}>
      <section className="ld-main" aria-label="Canvas">
        <TopRow sidebar={sidebar} onSidebar={onSidebar} cv={cv} tab={tab} project={project} inspOpen={inspOpen} onToggleInsp={toggleInsp} />
        {/* The chat pinned is a column before the canvas (Chat.tsx); the split is always there, so pinning never draws the canvas anew. */}
        <DockHosts.Provider value={hosts}>
          <div ref={row} className="ldc-split">
            {size === "pinned" && (
              <FaceBoundary what="chat">
                <ChatColumn thread={thread} />
              </FaceBoundary>
            )}
            <div className="ld-cv">
              <RailPart />
              {fileId && mine ? (
                <FaceBoundary what="canvas">
                  <Canvas root={cv} />
                </FaceBoundary>
              ) : (
                <div className="ld-empty">
                  {loading || (fileId && !mine) ? (
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
            <DockPart thread={thread} project={project} tab={tab} />
          </FaceBoundary>
        </DockHosts.Provider>
      </section>
      {inspOpen && (
        <div className="ld-insp-col">
          <FaceBoundary what="inspector">
            {/* The head's Close, in the panel's own button, keeping its name and key (Pane's Close would say "Close the panel"). */}
            <InspectorPart end={<PaneTool label={`Hide inspector (${os.keys("mod+alt+i")})`} icon={<I.close size={16} />} onClick={toggleInsp} />} />
          </FaceBoundary>
        </div>
      )}
      <LeanPart thread={thread} project={project} sidebar={sidebar} onSidebar={onSidebar} />
    </div>
  );
}
