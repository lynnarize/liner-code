/*
  Design Home: Home's sibling in the Design face. One question about the project, the composer,
  and under it the lean the design follows and what it's drawn for; then the other ways to start
  (the running app, live; the code's components as parts; an empty canvas) and the folder's design
  files as tiles. Sending makes a design file, starts a session on it with a design turn, and
  opens the canvas. The sidebar's body here is DesignFiles: every project's design files.

  Builder E adds the skills chips and the suggestion over the box (homeSlots below).
*/
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { DesignFile, DesignFileInfo, DesignSize, Project } from "@contracts";
import { startOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { Composer, type RunSettings } from "../Composer";
import { getState, rpc, useEngine } from "../engine";
import { I } from "../icons";
import { ago, plural } from "../model";
import { ProjectChooser } from "../Projects";
import { Pop, Row } from "../ui";
import { HomeLive } from "./Live";
import { D } from "./Rail";
import { design, getDesign, useDesign } from "./store";
import "./design-face.css";
// E's skills chips, the row over the box, start with a brand (they fill homeSlots when it loads).
import "./Skills";

/** What other builders add here: E's suggestion row over the box and skills chips beside the lean. */
export const homeSlots: { above?: ComponentType<{ cwd: string }>; skills?: ComponentType<{ cwd: string }>; or?: ComponentType<{ cwd: string; send: (text: string) => Promise<void> }>; onText?: (text: string) => void; made?: (cwd: string, file: DesignFile) => Promise<void> } = {};

type Size = "desktop+phone" | DesignSize;
const SIZES: { id: Size; label: string }[] = [
  { id: "desktop+phone", label: "Desktop and phone" },
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "phone", label: "Phone" },
];

/** Opens a design file on the canvas: in the project's latest session, or a new one when it has none. */
export async function openDesign(project: Project, file: string, onOpen: (threadId: string) => void) {
  const s = getState();
  const t = s.threads.filter((x) => x.projectId === project.id && !x.archived && !x.sideOf).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? (await rpc("thread.create", { projectId: project.id, title: "Design" }));
  design.setFace("design");
  onOpen(t.id);
  await design.open(t.worktree?.path ?? project.path, file);
}

/** A tile's picture: the design file's first frame, drawn small and still (no agent, no pointer). */
function Thumb({ cwd, info }: { cwd: string; info: DesignFileInfo }) {
  const mock = useDesign((s) => s.mock);
  const [doc, setDoc] = useState<{ html: string; w: number; h: number } | null>(null);
  useEffect(() => {
    let live = true;
    if (mock) {
      const s = getDesign();
      const f = s.file?.frames.find((x) => x.id === info.thumb) ?? s.file?.frames[0];
      if (f) setDoc({ html: s.html[f.id] ?? "", w: f.w, h: f.h });
      return;
    }
    void (async () => {
      try {
        const { file, base } = await rpc("canvas.open", { cwd, file: info.id });
        const f = file.frames.find((x) => x.id === info.thumb) ?? file.frames.find((x) => x.kind === "drawn");
        if (!f) return;
        const { html } = await rpc("canvas.frame.read", { cwd, file: info.id, frame: f.id });
        const withBase = base ? html.replace(/<head[^>]*>/i, (m) => `${m}<base href="${base.replace(/\/?$/, "/")}frames/">`) : html;
        if (live) setDoc({ html: withBase, w: f.w, h: f.h });
      } catch {
        // a tile without a picture still opens
      }
    })();
    return () => void (live = false);
  }, [cwd, info.id, info.updated, mock]);
  const k = doc ? Math.min(204 / doc.w, 120 / doc.h) : 1;
  return (
    <span className="ld-tile-pic" aria-hidden>
      {doc && (
        <span className="ld-tile-frame" style={{ width: doc.w * k, height: doc.h * k }}>
          <iframe title="" sandbox="" srcDoc={doc.html.replace(/<script\b[\s\S]*?<\/script>/gi, "")} width={doc.w} height={doc.h} tabIndex={-1} style={{ width: doc.w, height: doc.h, transform: `scale(${k})` }} />
        </span>
      )}
    </span>
  );
}

function Tiles({ project, onOpen }: { project: Project; onOpen: (threadId: string) => void }) {
  const mock = useDesign((s) => s.mock);
  const [files, setFiles] = useState<DesignFileInfo[]>([]);
  useEffect(() => {
    let live = true;
    // The mock opens its one design file, so the tiles have frames to draw.
    if (mock) void design.open(project.path).then(() => live && setFiles(getDesign().files));
    else void rpc("canvas.list", { cwd: project.path }).then((l) => live && setFiles(l), () => live && setFiles([]));
    return () => void (live = false);
  }, [project.path, mock]);
  if (!files.length) return null;
  return (
    <div className="ld-tiles">
      {[...files].sort((a, b) => b.updated - a.updated).slice(0, 6).map((f) => (
        <button key={f.id} type="button" className="ld-tile l-focus" onClick={() => void openDesign(project, f.id, onOpen).catch((e: Error) => toast.error(e.message))}>
          <Thumb cwd={project.path} info={f} />
          <b>{f.title}</b>
          <small>
            {plural(f.frames, "frame")} · {ago(f.updated)}
          </small>
        </button>
      ))}
    </div>
  );
}

/** The lean the new design follows, as a chip: the project's DESIGN.md, else Liner 2.0. */
function LeanChip({ cwd }: { cwd: string }) {
  const [name, setName] = useState<string>("");
  const [sw, setSw] = useState<string[]>([]);
  const mock = useDesign((s) => s.mock);
  useEffect(() => {
    if (mock) return setName("DESIGN.md"), setSw(["#F0DA9C", "#B5D3A0", "#BFE0EA", "#C4127A"]);
    let live = true;
    void rpc("lean.read", { cwd }).then(
      (l) => live && (setName(l.path?.split("/").pop() ?? (l.off === "builtin" ? "Liner 2.0" : "none yet")), setSw(l.tokens.colours.slice(0, 4).map((c) => c.value))),
      () => live && setName("none yet"),
    );
    return () => void (live = false);
  }, [cwd, mock]);
  return (
    <button type="button" className="lc-pb ld-lean-chip l-focus" onClick={() => window.dispatchEvent(new CustomEvent("ld:open-lean", { detail: { cwd } }))}>
      <span className="ld-q4" data-small aria-hidden>
        {sw.length ? sw.map((c) => <i key={c} style={{ background: c }} />) : <i />}
      </span>
      <span className="lc-strip-cap">Lean: {name || "…"}</span>
    </button>
  );
}

export function DesignHome({ projectId, onProject, onStarted, sidebar, onSidebar, onNewAgent }: { projectId?: string; onProject: (id: string) => void; onStarted: (threadId: string) => void; sidebar: boolean; onSidebar: () => void; onNewAgent: () => void }) {
  const projects = useEngine((s) => s.projects);
  const providers = useEngine((s) => s.providers);
  const engineSettings = useEngine((s) => s.settings);
  const access = useEngine((s) => s.settings.defaultAccess);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const initial = useMemo((): RunSettings => {
    if (project?.agent === "demo") return { agent: "demo", sidekick: "demo:demo", effort: "low", access };
    const start = startOf(engineSettings, providers);
    if (start) return { ...start, effort: "medium", access };
    const first = providers.find((p) => p.available && p.adapter && p.id !== "demo");
    return { agent: first ? `@${first.id}:${first.models[0]?.id ?? "default"}` : "demo", effort: "medium", access };
  }, [project?.id, project?.agent, engineSettings.start, access, providers.length]);
  const [settings, setSettings] = useState<RunSettings>(initial);
  useEffect(() => setSettings(initial), [initial]);
  const [size, setSize] = useState<Size>("desktop+phone");

  const make = async (cwd: string, title: string, s: Size) => {
    const file = await design.create(cwd, title, s === "desktop+phone" ? "desktop" : s);
    if (s === "desktop+phone") await design.addFrame("phone", "Phone");
    if (file) await homeSlots.made?.(cwd, file);
    return file;
  };
  const start = async (m: { text: string; files: { name: string; data: string }[] }) => {
    if (!project) return;
    const title = m.text.split("\n")[0].trim().replace(/[.!?]+$/, "").slice(0, 48) || "Untitled design";
    try {
      const file = await make(project.path, title, size);
      const t = await rpc("thread.create", { projectId: project.id, agent: settings.agent, sidekick: settings.sidekick, model: settings.model, effort: settings.effort, access: settings.access, mode: "standard" });
      // A design turn's mark: the design file it draws in.
      await rpc("thread.send", { id: t.id, text: m.text, files: m.files, ...(file ? { design: { file: file.id } } : {}) });
      design.setFace("design");
      onStarted(t.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const empty = async () => {
    if (!project) return;
    try {
      const file = await make(project.path, "Untitled design", size);
      if (file) await openDesign(project, file.id, onStarted);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  // The running app on the canvas and the code's components as parts are asks to the agent, said in the box.
  const [seed, setSeed] = useState<{ text: string; at: number } | undefined>();
  const Above = homeSlots.above;
  const Skills = homeSlots.skills;
  const Or = homeSlots.or;

  return (
    <div className="lc-home ld-home">
      <header className="lc-top lc-top-home" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <span className="lc-grow" data-drag />
      </header>
      <div className="lc-home-in ld-home-in">
        {project ? (
          <>
            <h2 className="lc-ask-h">
              What should we design in{" "}
              <span className="lc-ask-p">
                <Pop label={`Project: ${project.name}. Change it`} align="center" width={420} triggerClass="lc-proj" trigger={<span>{project.name}</span>}>
                  {(close) => <ProjectChooser value={project.id} onPick={(p) => (close(), onProject(p.id))} />}
                </Pop>
                ?
              </span>
            </h2>
            {Above && <Above cwd={project.path} />}
            <div className="lc-home-compose">
              <Composer
                variant="home"
                project={project}
                settings={settings}
                onSettings={(p) => setSettings((s) => ({ ...s, ...p }))}
                onSend={start}
                onText={homeSlots.onText}
                onNewAgent={onNewAgent}
                placeholder="A screen, a page, a brand: say what to design"
                autoFocus
                seed={seed}
                stripStart={
                  <>
                    <LeanChip cwd={project.path} />
                    {Skills && <Skills cwd={project.path} />}
                  </>
                }
                stripEnd={
                  <Pop label={`What it's drawn for: ${SIZES.find((x) => x.id === size)?.label}. Change it`} width={220} align="end" triggerClass="lc-pb" trigger={<><I.monitor size={13} /><span className="lc-strip-cap">{SIZES.find((x) => x.id === size)?.label}</span><I.chevD size={11} /></>} menu>
                    {(close) => SIZES.map((x) => <Row key={x.id} title={x.label} on={x.id === size} onPick={() => (close(), setSize(x.id))} />)}
                  </Pop>
                }
                stripUnder={
                  <>
                    <span>Or</span>
                    <HomeLive project={project} onOpen={(file) => openDesign(project, file, onStarted)} />
                    <span aria-hidden>·</span>
                    <button type="button" className="lc-under-b l-focus" onClick={() => setSeed({ text: "Turn the components in the code into parts on the canvas: one frame per component, on the Parts page.", at: Date.now() })}>
                      <I.file size={13} />
                      turn components in the code into parts
                    </button>
                    <span aria-hidden>·</span>
                    <button type="button" className="lc-under-b l-focus" onClick={() => void empty()}>
                      <D.frame size={13} />
                      open an empty canvas
                    </button>
                    {Or && <Or cwd={project.path} send={(text) => start({ text, files: [] })} />}
                  </>
                }
              />
            </div>
            <Tiles project={project} onOpen={onStarted} />
          </>
        ) : (
          <div className="lc-noproj">
            <h2 className="lc-ask-h">Add a project to start</h2>
            <p className="lc-quiet">A design file belongs to a folder. Add one from Liner Code's Home, then come back.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The sidebar's body on Design Home: every project's design files, newest first. */
export function DesignFiles({ onNew, onSearch, onOpen }: { onNew: () => void; onSearch: () => void; onOpen: (threadId: string) => void }) {
  const projects = useEngine((s) => s.projects);
  const mock = useDesign((s) => s.mock);
  const mine = useDesign((s) => s.files);
  const cwd = useDesign((s) => s.cwd);
  const [byProject, setByProject] = useState<Record<string, DesignFileInfo[]>>({});
  const [q, setQ] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all(projects.map(async (p) => [p.id, mock ? (p.path === cwd ? mine : []) : await rpc("canvas.list", { cwd: p.path }).catch(() => [])] as const)).then((all) => live && setByProject(Object.fromEntries(all)));
    return () => void (live = false);
  }, [projects.map((p) => p.id).join(), mock, mine]);
  const match = (f: DesignFileInfo) => !q || f.title.toLowerCase().includes(q.toLowerCase());
  const rows: ReactNode[] = [];
  for (const p of projects) {
    const list = (byProject[p.id] ?? []).filter(match).sort((a, b) => b.updated - a.updated);
    if (!list.length) continue;
    rows.push(
      <div key={`h${p.id}`} className="lc-sb-lab ld-lab">
        {p.name}
        <span>{list.length}</span>
      </div>,
    );
    for (const f of list)
      rows.push(
        <button key={`${p.id}:${f.id}`} type="button" className="ld-file l-focus" onClick={() => void openDesign(p, f.id, onOpen).catch((e: Error) => toast.error(e.message))}>
          <span className="ld-file-k" aria-hidden>
            <D.frame size={14} />
          </span>
          <span className="ld-file-t">
            <b>{f.title}</b>
            <small>{plural(f.frames, "frame")}</small>
          </span>
          <span className="ld-file-e">{ago(f.updated)}</span>
        </button>,
      );
  }
  return (
    <div className="ld-side">
      <div className="lc-sb-navrow">
        <button type="button" className="lc-sb-nav l-focus" onClick={onNew}>
          <I.plus size={16} />
          <span>New design</span>
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Search sessions, projects and commands" onClick={onSearch}>
          <I.search size={16} />
        </button>
      </div>
      <label className="ld-filter">
        <I.search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter designs" aria-label="Filter designs" />
      </label>
      {rows.length ? rows : <div className="ld-none">{q ? "No design file has that in its name." : "No design files yet. Ask for one on the right."}</div>}
    </div>
  );
}
