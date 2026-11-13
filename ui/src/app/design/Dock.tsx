/*
  The dock: the session's composer floating at the foot of the canvas, the conversation without a
  column. It is Composer.tsx itself (not a copy), with three things of the canvas's: a head row for
  what the agent is drawing now (the sidekick beside it), which opens the turn as a sheet above
  with the way back to Liner Code; the selection as chips in the input row; and a design turn's
  mark on what it sends, so the engine tells the agent where the design file is and what is picked.

  The other side of it, "Watch on the canvas" in Liner Code's own composer, is Composer.tsx's,
  with face.ts, so the Code face loads nothing of Liner Design's.
*/
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DesignSelection, Item, Project, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { Composer, type RunSettings } from "../Composer";
import { pairOf } from "../Crew";
import { rpc, useEngine, useItems } from "../engine";
import { I } from "../icons";
import { agentOf } from "../model";
import { drawingOf, type DesignTab } from "../face";
import { makeSession, runFor } from "./session";
import { design, frameOf, getDesign, selectionOf, useDesign } from "./store";
import "./design-face.css";
import { DockRows, DockSkills, onDockText, useSlashRows } from "./Skills";
import { WaitRow } from "./BuildTab";
import { ChecksRow } from "./ChecksTab";
import { PicturesChip, PicturesRow } from "./Pictures";
import { WaysRow } from "./Ways";

type Tool = Extract<Item, { kind: "tool" }>;

/** The latest turn, for the sheet: what you asked, and its steps (the running ones marked). */
function lastTurn(items: Item[]) {
  let start = -1;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "user") {
    start = i;
    break;
  }
  if (start < 0) return undefined;
  const ask = items[start] as Extract<Item, { kind: "user" }>;
  const steps = items.slice(start + 1).filter((x): x is Tool => x.kind === "tool");
  return { ask, steps };
}

function Sheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const items = useItems(thread.id);
  const turn = useMemo(() => lastTurn(items), [items]);
  return (
    <div className="ld-sheet" role="region" aria-label="This turn">
      <div className="ld-sheet-h">
        <span className="ld-ell">{thread.title}</span>
        <span className="lc-grow" />
        <button type="button" className="ld-lk l-focus" onClick={() => (onClose(), design.setFace("code"))}>
          Open in Liner Code
          <I.forward size={13} />
        </button>
      </div>
      {turn ? (
        <>
          <div className="ld-bubble">{turn.ask.text}</div>
          {turn.steps.slice(-8).map((t) => (
            <div key={t.id} className="ld-tl" data-live={t.status === "running" || undefined}>
              {t.status === "running" ? <span className="ld-pd" data-lead aria-hidden /> : t.status === "failed" ? <I.close size={13} /> : <I.check size={13} />}
              <span className="ld-ell">{t.title}</span>
            </div>
          ))}
          {!turn.steps.length && <div className="ld-tl">Nothing done yet in this turn</div>}
        </>
      ) : (
        <div className="ld-tl">No turns yet. Say what to draw below.</div>
      )}
    </div>
  );
}

/** The head row: what is being drawn now, and the sidekick's part; a press opens the turn. */
function Head({ thread, open, onOpen }: { thread: Thread; open: boolean; onOpen: () => void }) {
  const items = useItems(thread.id);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const presence = useDesign((s) => s.presence);
  const file = useDesign((s) => s.file);
  const running = thread.status === "running";
  const now = running ? drawingOf(items) : undefined;
  const pair = pairOf(thread, agents, providers);
  const who = pair?.lead ?? agentOf(thread.agent, agents, providers).name;
  const ps = Object.entries(presence);
  const lead = ps.find(([, p]) => p.lead);
  const side = ps.find(([, p]) => !p.lead);
  const leadFrame = lead ? frameOf({ file } as never, lead[0])?.name : now?.frame;
  // Drawing: an agent's outline is on a frame, or the running turn's call is writing one.
  const busy = Boolean(lead) || (running && Boolean(now));
  if (!running && !lead && !side) return null;
  const step = running && !busy ? [...items].reverse().find((x): x is Tool => x.kind === "tool" && x.status === "running") : undefined;
  return (
    <button type="button" className="lc-trow ld-head l-focus" aria-expanded={open} onClick={onOpen}>
      <span className="ld-pd" data-lead aria-hidden />
      <span className="lc-trow-t">
        {busy ? (
          <>
            <b>{lead?.[1].name ?? who}</b> is drawing {leadFrame ?? "on the canvas"}
            {lead?.[1].label && lead[1].label !== lead[1].name && <span className="ld-q"> {lead[1].label}</span>}
          </>
        ) : step ? (
          <>
            <b>{who}</b> {step.title.charAt(0).toLowerCase() + step.title.slice(1)}
          </>
        ) : (
          <>
            <b>{who}</b> is working
          </>
        )}
      </span>
      <span className="lc-grow" />
      {side && (
        <>
          <span className="ld-pd" aria-hidden />
          <span className="ld-q ld-ell">
            {side[1].name}
            {side[1].label && side[1].label !== side[1].name ? `, ${side[1].label}` : ""}
          </span>
        </>
      )}
      {open ? <I.chevD size={13} /> : <I.chevU size={13} />}
    </button>
  );
}

const KIND_ICON: Record<string, (p: { size?: number }) => ReactNode> = { stack: I.list, text: ({ size }) => <span style={{ fontSize: size, lineHeight: 1, fontWeight: 600 }}>T</span>, image: I.camera, box: I.box };

/** The selection, as chips: each one goes with a press of its ×. */
function Chips() {
  const sel = useDesign((s) => s.sel);
  const file = useDesign((s) => s.file);
  const node = useDesign((s) => s.node);
  const tree = useDesign((s) => s.tree);
  if (!sel.length || !file) return null;
  const nameOf = (frame: string, id?: string) => {
    if (!id) return frameOf({ file } as never, frame)?.name ?? frame;
    if (node?.id === id) return node.name;
    const find = (n: { id: string; name: string; children: unknown[] } | undefined): string | undefined => {
      if (!n) return undefined;
      if (n.id === id) return n.name;
      for (const c of n.children as typeof n[]) {
        const f = find(c);
        if (f) return f;
      }
      return undefined;
    };
    return find(tree[frame]) ?? id;
  };
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

/**
  The dock, for a design on the canvas. A design with no session yet has the same dock: who works
  is picked here, and the first ask makes the session (session.ts), begun from this design.
*/
export function Dock({ thread, project, tab }: { thread?: Thread; project: Project; tab: DesignTab }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const [open, setOpen] = useState(false);
  const cwd = thread?.worktree?.path ?? project.path;
  const slashRows = useSlashRows(cwd);
  // Before there's a session: who it will start with, as Home would start one, until you pick.
  const [first, setFirst] = useState<RunSettings>(() => runFor(project));
  useEffect(() => setFirst(runFor(project)), [project.id]);
  const coder = agentOf(thread?.agent ?? first.agent, agents, providers);
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
    // A design turn's mark: which design file, and what is selected (the engine's "## Design" note).
    try {
      const t = thread ?? (await makeSession(tab, first));
      await rpc("thread.send", { id: t.id, text: m.text, files: m.files, mode: m.mode, design: { file: s.file?.id ?? tab.file, ...(sel ? { sel } : {}) } });
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  return (
    <div className="ld-dock">
      {open && thread && <Sheet thread={thread} onClose={() => setOpen(false)} />}
      <div className="ld-dock-in">
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
          top={<>{thread && <Head thread={thread} open={open} onOpen={() => setOpen((o) => !o)} />}<DockRows cwd={cwd} />{thread && <WaitRow thread={thread} />}<PicturesRow /><WaysRow /><ChecksRow /></>}
          trayEnd={<><PicturesChip threadId={thread?.id} lead={coder.name} /><DockSkills cwd={cwd} /></>}
          onText={onDockText}
          slashRows={slashRows}
        />
      </div>
    </div>
  );
}
