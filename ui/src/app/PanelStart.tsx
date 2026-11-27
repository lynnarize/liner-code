/*
  The panel's start page (the owner approved the board "as drawn", 2026-11-27, after Kimi's empty right panel): what the
  right panel shows while it is open with nothing in it, in place of an empty frame or a surface nobody asked for. One
  centred column, at most 388 wide, 64 under the head, in three groups of lean rows: Start here, In this session (only what
  the session has now, else nothing) and Your apps. What each row says and does is surface-row.ts startPage, so it is
  tested without React; a press goes through Switcher.tsx runPick, the same as the row's twin in +, so what it opens
  becomes a tab and the page is gone until the panel is empty again.
  It reads only what the app already holds or what the details card and + already ask: ports.list for a server this
  session started, device.list (+'s useBooted) for a running simulator. Nothing here moves but a row's hover fill.
*/
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { isSwarm, type LocalServer, type PanelIcon, type Thread } from "@contracts";
import { isSubagent, rpc, useEngine, useItemsWhere } from "./engine";
import { I, StepMark } from "./icons";
import { appIcon, appsFor } from "./Addon";
import { usePins } from "./TopBar";
import { SURFACES, surfaceOf } from "./Surfaces";
import { type DockState } from "./dock";
import { hasAgents } from "./agent-rows";
import { canPr, hasCanvas, isCanvasItem, moreRows, startPage, type StartRow } from "./surface-row";
import { keys, runPick, useBooted } from "./Switcher";

/** The icon a Start here or In this session row leads with, by its surface. */
const ICON: Record<string, (p: { size?: number }) => ReactNode> = { side: I.comment, terminal: I.terminal };
const iconOf = (id: string) => ICON[id] ?? surfaceOf(id)?.icon ?? I.app;

export function PanelStart({ thread, dock, onDock, changes, onBelow, onMake }: {
  thread: Thread;
  dock: DockState;
  onDock: (d: DockState) => void;
  changes: { files: number; added: number; removed: number };
  onBelow: (on: boolean) => void;
  onMake: () => void;
}) {
  const addons = useEngine((s) => s.addons);
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const pins = usePins();
  const worked = useItemsWhere(thread.id, isSubagent).length;
  const drew = useItemsWhere(thread.id, isCanvasItem);
  const device = useBooted();
  const [servers, setServers] = useState<LocalServer[]>([]);
  const running = thread.status === "running";
  // What listens, asked as the details card asks it: when the page shows, and again as a turn starts or ends.
  useEffect(() => {
    let live = true;
    void rpc("ports.list", { threadId: thread.id }).then((l) => live && setServers(l), () => {});
    return () => {
      live = false;
    };
  }, [thread.id, thread.turns, running]);
  const apps = appsFor(addons, thread.projectId);
  const ordered = moreRows(dock, apps, pins).apps.map((r) => {
    const a = apps.find((x) => x.id === r.id);
    return { id: r.id, name: r.name, line: a?.summary || a?.description, icon: a?.panel?.icon };
  });
  const page = startPage({
    ids: SURFACES.map((s) => s.id),
    labelOf: (id) => surfaceOf(id)?.label ?? id,
    now: { agents: hasAgents({ sidekick: thread.sidekick, swarm: isSwarm(thread), atWork: thread.agentsAtWork, worked }), pr: canPr(thread, project), canvas: hasCanvas(thread, drew), device },
    changes,
    servers,
    thread,
    worked,
    apps: ordered,
    keyOf: (id) => keys(`surface.${id}`),
  });
  const press = (r: StartRow) => runPick({ thread, dock, onDock, onBelow, onMake }, r.pick);
  return (
    <div className="lc-start" role="region" aria-label="Start">
      <div className="lc-start-in">
        <Group label="Start here" rows={page.here} press={press} />
        {page.session.length > 0 && <Group label="In this session" rows={page.session} press={press} />}
        <Group label="Your apps" rows={page.apps} press={press} />
      </div>
    </div>
  );
}

function Group({ label, rows, press }: { label: string; rows: StartRow[]; press: (r: StartRow) => void }) {
  return (
    <div className="lc-start-g" role="group" aria-label={label}>
      <div className="lc-start-l" aria-hidden>
        {label}
      </div>
      {rows.map((r) => (
        <button key={r.id} type="button" className="lc-start-r l-focus" data-quiet={r.quiet || undefined} aria-label={r.name} onClick={() => press(r)}>
          <Lead row={r} />
          {r.app ? <b>{r.title}</b> : r.title}
          {r.note && <em>{r.note}</em>}
          <End row={r} />
        </button>
      ))}
    </div>
  );
}

/** The row's 16px lead: its surface's icon, Fusion's two strokes, an app's own icon or its tile, or New add-on's +. */
function Lead({ row }: { row: StartRow }) {
  if (row.quiet) return <I.plus size={16} />;
  if (row.fusion) return <I.fusion size={16} />;
  if (row.app) {
    if (row.app.icon) {
      const Icon = appIcon(row.app.icon as PanelIcon);
      return <Icon size={16} />;
    }
    return (
      <span className="lc-start-tile" style={{ "--h": row.app.hue } as CSSProperties} aria-hidden>
        {row.app.tile}
      </span>
    );
  }
  const Icon = iconOf(row.id);
  return <Icon size={16} />;
}

/** The row's grey right end: changed files and lines, a server that listens, the agents at work, the pull request's state, or a key. */
function End({ row }: { row: StartRow }) {
  const e = row.end;
  if (!e) return null;
  return (
    <span className="lc-start-k" aria-hidden>
      {e.kind === "key" && e.keys}
      {e.kind === "changes" && (
        <>
          <span>{e.files === 1 ? "1 file" : `${e.files} files`}</span>
          {e.added > 0 && <span data-add>+{e.added}</span>}
          {e.removed > 0 && <span data-del>−{e.removed}</span>}
        </>
      )}
      {e.kind === "server" && (
        <>
          <i className="lc-start-dot" />
          localhost:{e.port}
        </>
      )}
      {e.kind === "agents" && (
        <>
          {e.working && <StepMark state="working" live size={12} label="Working" />}
          {e.n} {e.working ? "working" : "worked"}
        </>
      )}
      {e.kind === "pr" && <span data-tone={e.tone}>{e.word}</span>}
    </span>
  );
}
