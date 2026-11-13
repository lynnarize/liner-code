/*
  The dock: the session's composer, floating at the foot of the canvas, or at the foot of the chat's column when the chat is
  pinned (Chat.tsx). It is Composer.tsx itself (not a copy), with the canvas's own parts: the chat at the top of its tray
  (one row, or the conversation open above the box), an agent's ask docked as Liner Code docks it (Ask.tsx), the selection
  as chips in the input row, and a design turn's mark on what it sends, so the engine tells the agent where the design
  file is and what is picked. What you send with a selection keeps the selection's names as chips (thread.send's `shown`).

  The other side of it, "Watch on the canvas" in Liner Code's own composer, is Composer.tsx's,
  with face.ts, so the Code face loads nothing of Liner Design's.
*/
import { useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DesignSelection, Project, ShownChip, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { Composer, type RunSettings } from "../Composer";
import { pairOf } from "../Crew";
import { loadItems, rpc, useEngine } from "../engine";
import { I } from "../icons";
import { agentOf } from "../model";
import { type DesignTab } from "../face";
import { AskDock, useDockAsk } from "../Ask";
import { makeSession, runFor } from "./session";
import { design, frameOf, getDesign, selectionOf, useDesign, type DesignState } from "./store";
import { ChatBody, ChatMin, ChatOpen, DockHosts } from "./Chat";
import "./design-face.css";
import { DockRows, DockSkills, onDockText, useSlashRows } from "./Skills";
import { WaitRow } from "./BuildTab";
import { ChecksRow } from "./ChecksTab";
import { PicturesChip, PicturesRow } from "./Pictures";
import { WaysRow } from "./Ways";

const KIND_ICON: Record<string, (p: { size?: number }) => ReactNode> = { stack: I.list, text: ({ size }) => <span style={{ fontSize: size, lineHeight: 1, fontWeight: 600 }}>T</span>, image: I.camera, box: I.box };

/** A selected frame's or layer's name, as the outline has it (the node read in the inspector first). */
function selName(s: Pick<DesignState, "file" | "node" | "tree">, frame: string, id?: string) {
  if (!id) return frameOf({ file: s.file } as never, frame)?.name ?? frame;
  if (s.node?.id === id) return s.node.name;
  const find = (n: { id: string; name: string; children: unknown[] } | undefined): string | undefined => {
    if (!n) return undefined;
    if (n.id === id) return n.name;
    for (const c of n.children as (typeof n)[]) {
      const f = find(c);
      if (f) return f;
    }
    return undefined;
  };
  return find(s.tree[frame]) ?? id;
}

/** The selection, as chips: each one goes with a press of its ×. */
function Chips() {
  const sel = useDesign((s) => s.sel);
  const file = useDesign((s) => s.file);
  const node = useDesign((s) => s.node);
  const tree = useDesign((s) => s.tree);
  if (!sel.length || !file) return null;
  const nameOf = (frame: string, id?: string) => selName({ file, node, tree }, frame, id);
  return (
    <>
      {sel.slice(0, 3).map((x) => {
        const Icon = x.node ? (KIND_ICON[node?.id === x.node ? node.kind : "box"] ?? I.box) : I.page;
        return (
          <span key={`${x.frame}:${x.node ?? ""}`} className="ld-chip">
            <Icon size={13} />
            <span className="ld-ell">{nameOf(x.frame, x.node)}</span>
            <button type="button" className="l-focus" aria-label={`Leave ${nameOf(x.frame, x.node)} out`} onClick={() => design.select(sel.filter((y) => y !== x))}>
              <I.close size={11} />
            </button>
          </span>
        );
      })}
      {sel.length > 3 && <span className="ld-chip">+{sel.length - 3}</span>}
    </>
  );
}

/** What you sent with a selection, as you read it: the selection's names as chips, your words as typed. */
function shownFor(text: string): { text: string; chips: ShownChip[] } | undefined {
  const s = getDesign();
  if (!s.sel.length || !s.file) return undefined;
  const chips = s.sel.slice(0, 6).map((x): ShownChip => ({ kind: x.node ? "layer" : "frame", label: selName(s, x.frame, x.node) }));
  return { text, chips };
}

/**
  The dock, for a design on the canvas. A design with no session yet has the same dock: who works
  is picked here, and the first ask makes the session (session.ts), begun from this design.
  DesignFace renders it once per tab: the composer and the conversation go into the hosts it hands down (Chat.tsx
  DockHosts), which the floating dock, the open chat and the column hold, so this one keeps the ask, the slash rows and
  the draft whatever the size.
*/
const NO_THREAD = { id: "" } as Thread;
export function Dock({ thread, project, tab }: { thread?: Thread; project: Project; tab: DesignTab }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const hosts = useContext(DockHosts)!;
  const size = hosts.size;
  // The session whose conversation this tab has shown: before that, a small chat draws none.
  const [shownOnce, setShownOnce] = useState<string>();
  useEffect(() => {
    if (thread && size !== "min") setShownOnce(thread.id);
  }, [thread?.id, size]);
  const cwd = thread?.worktree?.path ?? project.path;
  const slashRows = useSlashRows(cwd);
  // Before there's a session: who it will start with, as Home would start one, until you pick.
  const [first, setFirst] = useState<RunSettings>(() => runFor(project));
  useEffect(() => setFirst(runFor(project)), [project.id]);
  // The chat reads the session's timeline, which the app fetches only for what shows it.
  useEffect(() => {
    if (thread) void loadItems(thread.id).catch(() => {});
  }, [thread?.id]);
  const coder = agentOf(thread?.agent ?? first.agent, agents, providers);
  const lead = thread ? (pairOf(thread, agents, providers)?.lead ?? coder.name) : coder.name;
  // An agent's ask waits at the composer, as in Liner Code: in every size of the chat, since the composer is always here.
  const asking = useDockAsk(thread ?? NO_THREAD, lead);
  const settings: RunSettings = thread ? { agent: thread.agent, model: thread.model, effort: thread.effort ?? coder.effort, access: thread.access, ...(thread.sidekick ? { sidekick: thread.sidekick } : {}) } : first;
  const busy = thread?.status === "running";
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  const update = (patch: Partial<RunSettings>) => {
    if (!thread) return setFirst((s) => ({ ...s, ...patch }));
    const p: Parameters<typeof rpc<"thread.update">>[1] = { id: thread.id };
    if ("agent" in patch) p.agent = patch.agent;
    if ("sidekick" in patch) p.sidekick = (patch as { sidekick?: string | null }).sidekick ?? null;
    if ("model" in patch) p.model = patch.model ?? null;
    if ("effort" in patch) p.effort = patch.effort;
    if ("access" in patch) p.access = patch.access;
    void rpc("thread.update", p).catch(fail);
  };
  const send = async (m: { text: string; files: { name: string; data: string }[]; mode: "queue" | "steer" }) => {
    const s = getDesign();
    const sel: DesignSelection | null = selectionOf(s);
    const shown = shownFor(m.text);
    // A design turn's mark: which design file, and what is selected (the engine's "## Design" note).
    try {
      const t = thread ?? (await makeSession(tab, first));
      await rpc("thread.send", { id: t.id, text: m.text, files: m.files, mode: m.mode, design: { file: s.file?.id ?? tab.file, ...(sel ? { sel } : {}) }, ...(shown ? { shown } : {}) });
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  // The chat at the top of the tray: one row, or open above the box. Pinned, it is the column instead.
  const chat = thread && size !== "pinned" ? size === "open" ? <ChatOpen thread={thread} /> : <ChatMin thread={thread} /> : null;
  const composer = (
    <Composer
      variant="session"
      project={project}
      thread={thread}
      settings={settings}
      onSettings={update}
      onSend={send}
      onStop={() => thread && void rpc("thread.stop", { id: thread.id }).catch(fail)}
      busy={busy}
      placeholder={busy ? "Write while it draws: it goes when the turn ends" : "Say what to draw or change"}
      canvas
      chips={<Chips />}
      ask={asking ?? undefined}
      top={<>{chat}{asking && <AskDock dock={asking} />}<DockRows cwd={cwd} />{thread && <WaitRow thread={thread} />}<PicturesRow /><WaysRow /><ChecksRow /></>}
      trayEnd={<><PicturesChip threadId={thread?.id} lead={coder.name} /><DockSkills cwd={cwd} /></>}
      onText={onDockText}
      slashRows={slashRows}
    />
  );
  // The conversation is drawn once the chat has shown it in this tab, and stays one through a pin, an unpin and a spell at
  // min (out of the page then, so nothing draws or reads it), so a note typed into a plan or an open fold survives.
  return (
    <>
      {createPortal(composer, hosts.composer)}
      {thread && (size !== "min" || shownOnce === thread.id) && createPortal(<ChatBody key={thread.id} thread={thread} visible={size !== "min"} />, hosts.body)}
    </>
  );
}
