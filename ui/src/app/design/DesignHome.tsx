/*
  Design Home: the Design face's first tab. One question, the composer, and under it where the
  design lives (on its own, by default; a project; another folder), the lean it follows (none is
  fine), the skills it loads and what it's drawn for; then the other ways to start. Sending makes
  the design (design.new), opens its tab, makes its session (begun from it) and sends the ask as a
  design turn. Nothing here ever makes or picks the Scratch project.

  The sidebar's body here is DesignFiles: every design, from design.all, on their own first, then
  by project, each with the row menu a session row has.
*/
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { DesignFile, DesignFileInfo, DesignSize, Project } from "@contracts";
import { DESIGNS_FOLDER } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { Composer, type RunSettings } from "../Composer";
import { getState, onStream, rpc, subscribe as subscribeEngine, useEngine } from "../engine";
import { getTabs, lastDesignTab, moveTab, openTab, showTab, tabKey, useTabs } from "../face";
import { I } from "../icons";
import { ago, codeProjects, plural } from "../model";
import * as os from "../os";
import { ProjectChooser } from "../Projects";
import { ContextMenu, Pop, Row, Sep } from "../ui";
import { HomeLive } from "./Live";
import { PicturesChip } from "./Pictures";
import { D } from "./Rail";
import { buildIn, close as closeTabHere, Tabs } from "./Tabs";
import { dropIfUntouched, knowProject, newDesign, runFor, sessionOf, sigOf, untouched } from "./session";
import { design } from "./store";
import "./design-face.css";
// E's skills chips, the row over the box, start with a brand (they fill homeSlots when it loads).
import { OWN_SKILLS, pickedFor } from "./Skills";

/** What other builders add here: E's suggestion row over the box and skills chips beside the lean. */
export const homeSlots: { above?: ComponentType<{ cwd: string }>; skills?: ComponentType<{ cwd: string }>; or?: ComponentType<{ cwd: string; send: (text: string) => Promise<void> }>; onText?: (text: string) => void; made?: (cwd: string, at: { cwd: string; file: DesignFile }) => Promise<void> } = {};

type Size = "desktop+phone" | DesignSize;
const SIZES: { id: Size; label: string }[] = [
  { id: "desktop+phone", label: "Desktop and phone" },
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "phone", label: "Phone" },
];
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/**
  A design's name from the ask: the phrase before the first joining word ("for", "with", "that",
  "in", "on", "to", "and") when that leaves at least two words; otherwise its first words, cut at a
  word, at most about 28 characters, with no trailing punctuation or little word. The folder's
  name follows it (design.new makes the slug from the title).
    "A sign-in screen for a small notes app"  → "A sign-in screen"
    "Pricing page with three plans"           → "Pricing page"
    "Brand board"                             → "Brand board"
    "Landing for the launch of Foreshore"     → "Landing for the launch" (one word before "for": its first words)
    "Make the tide times larger on the phone" → "Make the tide times larger"
*/
const JOINS = new Set(["for", "with", "that", "in", "on", "to", "and"]);
export function shortTitle(text: string, max = 28) {
  const line = (text.split("\n").map((l) => l.trim()).find(Boolean) ?? "").replace(/\s+/g, " ");
  const words = line.split(" ").filter(Boolean);
  const join = words.findIndex((w, i) => i > 0 && JOINS.has(w.toLowerCase()));
  const tidy = (t: string) => {
    let prev;
    do (prev = t), (t = t.replace(/[\s.,;:!?…—–-]+$/, "").replace(/\s+(a|an|the|and|or|for|of|to|in|on|with|at|by|from|that)$/i, ""));
    while (t !== prev);
    return t;
  };
  if (join >= 2) {
    const phrase = tidy(words.slice(0, join).join(" "));
    if (phrase.split(" ").length >= 2 && phrase.length <= max) return phrase;
  }
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) {
      if (!out) out = next.slice(0, max);
      break;
    }
    out = next;
  }
  return tidy(out) || "Untitled design";
}

/** Where a new design lives: on its own (in Liner Designs), or a project's id. */
const OWN = "";
/** The composer needs a project to read; a design on its own has none yet, so it reads this stand-in (no git, no files). */
const NOWHERE: Project = { id: "", name: "On its own", path: "", git: false, createdAt: 0, kind: "design" };

/** Where this design lives: the place chip under the box. */
function PlaceChip({ place, onPlace }: { place: string; onPlace: (id: string) => void }) {
  const projects = codeProjects(useEngine((s) => s.projects));
  const here = projects.find((p) => p.id === place);
  const [other, setOther] = useState(false);
  return (
    <Pop label={`Where this design lives: ${here?.name ?? "on its own"}. Change it`} width={420} triggerClass="lc-pb" keep trigger={<><I.folder size={13} /><span className="lc-strip-cap">{here?.name ?? "On its own"}</span><I.chevD size={11} /></>}>
      {(close) =>
        other ? (
          <div className="ld-own-pop">
            <button type="button" className="ld-own-back l-focus" onClick={() => setOther(false)}>
              <I.chevL size={13} />
              Another folder
            </button>
            <ProjectChooser value={here?.id} onPick={(p) => (setOther(false), close(), onPlace(p.id))} />
          </div>
        ) : (
          <div className="ld-own-pop">
            <div className="ld-way-mh">Where this design lives</div>
            <button type="button" className="ld-wl l-focus" data-on={!here || undefined} onClick={() => (close(), onPlace(OWN))}>
              <I.folder size={15} />
              <span>
                <b>On its own</b>
                <small>In {DESIGNS_FOLDER}. No project needed</small>
              </span>
              {!here && <I.check size={14} className="ld-ok" />}
            </button>
            {projects.slice(0, 6).map((p) => (
              <button key={p.id} type="button" className="ld-wl l-focus" data-on={p.id === place || undefined} onClick={() => (close(), onPlace(p.id))}>
                <I.folder size={15} />
                <span>
                  <b>{p.name}</b>
                  <small>Beside its code, ready to build</small>
                </span>
                {p.id === place && <I.check size={14} className="ld-ok" />}
              </button>
            ))}
            <Sep />
            <button type="button" className="ld-wl l-focus" onClick={() => setOther(true)}>
              <I.plus size={15} />
              <span>
                <b>Another folder</b>
              </span>
            </button>
            <p className="ld-note ld-own-note">On its own is never a Scratch session. You can move it into a project later, when you want code.</p>
          </div>
        )
      }
    </Pop>
  );
}

/** The lean the new design follows, as a chip: none is fine (the agent uses its own taste); a project's DESIGN.md when it has one. */
function LeanChip({ cwd }: { cwd?: string }) {
  const [name, setName] = useState<string | null>(null);
  const [sw, setSw] = useState<string[]>([]);
  useEffect(() => {
    setName(null);
    setSw([]);
    if (!cwd) return;
    let live = true;
    void rpc("lean.read", { cwd }).then(
      (l) => live && (setName(l.off === "none" ? null : l.off === "builtin" ? "Liner 2.0" : (l.path?.split("/").pop() ?? "DESIGN.md")), setSw(l.off === "none" ? [] : l.tokens.colours.slice(0, 4).map((c) => c.value))),
      () => live && setName(null),
    );
    return () => void (live = false);
  }, [cwd]);
  return (
    <Pop label={name ? `Lean: ${name}` : "No lean"} width={320} triggerClass="lc-pb ld-lean-chip" trigger={<><span className="ld-q4" data-small data-none={!name || undefined} aria-hidden>{sw.map((c) => <i key={c} style={{ background: c }} />)}</span><span className="lc-strip-cap">{name ?? "No lean"}</span><I.chevD size={11} /></>}>
      {() => (
        <div className="ld-own-pop">
          <div className="ld-way-mh">{name ? `The lean: ${name}` : "No lean"}</div>
          <p className="ld-note ld-own-note">
            {name
              ? "The design follows it: its colours, type and steps, and the rules it never breaks. Change it from the design's sidebar."
              : "Optional. The agent uses its own taste and any skills you load. Add a DESIGN.md from the design's sidebar when you want rules it keeps to; nothing asks for one."}
          </p>
        </div>
      )}
    </Pop>
  );
}

export function DesignHome({ sidebar, onSidebar, onNewAgent }: { sidebar: boolean; onSidebar: () => void; onNewAgent: () => void }) {
  const all = useEngine((s) => s.projects);
  const providers = useEngine((s) => s.providers);
  const engineSettings = useEngine((s) => s.settings);
  const projects = useMemo(() => codeProjects(all), [all]);
  // On its own by default; a project picked here is kept for the next design.
  // A window without storage (it throws) starts on its own each time, rather than breaking the page.
  const [place, setPlace] = useState<string>(() => {
    try {
      return localStorage.getItem("ld:place") ?? OWN;
    } catch {
      return OWN;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ld:place", place);
    } catch {
      // kept for this view only
    }
  }, [place]);
  const project = projects.find((p) => p.id === place);
  const initial = useMemo((): RunSettings => runFor(project), [project?.id, project?.agent, engineSettings.start, engineSettings.defaultAccess, providers.length]);
  const [settings, setSettings] = useState<RunSettings>(initial);
  useEffect(() => setSettings(initial), [initial]);
  const [size, setSize] = useState<Size>("desktop+phone");
  // The skills listed (and picked) here: a project's, or for a design on its own your own skills only (lean.skills with no folder).
  const skillsCwd = project?.path ?? OWN_SKILLS;

  const make = async (title: string) => {
    const made = await rpc("design.new", { title, size, ...(project ? { projectId: project.id } : {}) });
    knowProject(made.project);
    const fresh = sigOf(made.file);
    if (skillsCwd) await homeSlots.made?.(skillsCwd, { cwd: made.project.path, file: made.file }).catch(() => {});
    return { ...made, fresh };
  };
  const start = async (m: { text: string; files: { name: string; data: string }[] }) => {
    const title = shortTitle(m.text);
    try {
      const { project: p, file } = await make(title);
      // Its session, begun from it, in its own folder (never a worktree: the design file is there).
      const t = await rpc("thread.create", { projectId: p.id, design: { file: file.id }, title: file.title, agent: settings.agent, sidekick: settings.sidekick, model: settings.model, effort: settings.effort, access: settings.access, mode: "standard", worktree: false });
      openTab({ projectId: p.id, file: file.id, title: file.title, threadId: t.id });
      await rpc("thread.send", { id: t.id, text: m.text, files: m.files, design: { file: file.id } });
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  const empty = async () => {
    try {
      // On its own with nothing picked here: the same New design as ⌘N, "+" and the sidebar (an untouched one open is reused).
      if (!project && !pickedFor(skillsCwd).length) return void (await newDesign({ size }));
      const { project: p, file, fresh } = await make("Untitled design");
      // Untouched, it goes again when its tab closes (session.ts); a skill picked here already touched it.
      openTab({ projectId: p.id, file: file.id, title: file.title, ...(p.kind === "design" ? { fresh } : {}) });
    } catch (e) {
      fail(e);
    }
  };
  // The running app on the canvas and the code's components as parts are asks to the agent, said in the box.
  const [seed, setSeed] = useState<{ text: string; at: number } | undefined>();
  const Above = homeSlots.above;
  const Skills = homeSlots.skills;
  const Or = homeSlots.or;

  return (
    <div className="lc-home ld-home">
      <header className="ld-bar" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <Tabs />
        <span className="lc-grow" data-drag />
      </header>
      <div className="lc-home-in ld-home-in">
        <h2 className="lc-ask-h">What should we design?</h2>
        {Above && skillsCwd && <Above cwd={skillsCwd} />}
        <div className="lc-home-compose">
          <Composer
            variant="home"
            project={project ?? NOWHERE}
            settings={settings}
            onSettings={(p) => setSettings((s) => ({ ...s, ...p }))}
            onSend={start}
            onText={homeSlots.onText}
            onNewAgent={onNewAgent}
            placeholder="A screen, a page, a brand: say what to design"
            autoFocus
            seed={seed}
            trayEnd={<PicturesChip lead={undefined} home />}
            stripStart={
              <>
                <PlaceChip place={project ? place : OWN} onPlace={setPlace} />
                <LeanChip cwd={project?.path} />
                {Skills && skillsCwd && <Skills cwd={skillsCwd} />}
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
                <button type="button" className="lc-under-b l-focus" onClick={() => void empty()}>
                  <D.frame size={13} />
                  open an empty canvas
                </button>
                {project && (
                  <>
                    <span aria-hidden>·</span>
                    <HomeLive project={project} onOpen={async (file) => openTab({ projectId: project.id, file })} />
                    <span aria-hidden>·</span>
                    <button type="button" className="lc-under-b l-focus" onClick={() => setSeed({ text: "Turn the components in the code into parts on the canvas: one frame per component, on the Parts page.", at: Date.now() })}>
                      <I.file size={13} />
                      turn components in the code into parts
                    </button>
                  </>
                )}
                {Or && skillsCwd && <Or cwd={skillsCwd} send={(text) => start({ text, files: [] })} />}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

type Listed = { project: Project; files: DesignFileInfo[] };
let listed: Listed[] | null = null;
const listFns = new Set<() => void>();
let asking = 0;
/** design.all again, a moment after anything that may change it (one call for the sidebar). */
function relist() {
  clearTimeout(asking);
  asking = window.setTimeout(() => {
    void rpc("design.all", {}).then(
      (l) => ((listed = l), listFns.forEach((f) => f())),
      () => {},
    );
  }, 150);
}
let hearing = false;
function useListed() {
  const [, redraw] = useState(0);
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    listFns.add(f);
    if (!hearing) {
      hearing = true;
      onStream((e) => {
        if (e.type === "canvas.changed") relist();
      });
      // A project come or gone (a design made, removed, moved into a project).
      let was = getState().projects;
      subscribeEngine(() => {
        const now = getState().projects;
        if (now !== was) (was = now), relist();
      });
    }
    relist();
    return () => void listFns.delete(f);
  }, []);
  return listed;
}

type Menu = { project: Project; file: DesignFileInfo; x: number; y: number };

/** The sidebar's body on Design Home: "New design", the filter, and every design, on their own first, then by project. */
export function DesignFiles({ onSearch }: { onSearch: () => void }) {
  const list = useListed();
  const threads = useEngine((s) => s.threads);
  const { list: tabs } = useTabs();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<string>("all");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [choose, setChoose] = useState(false);
  const match = (f: DesignFileInfo) => !q || f.title.toLowerCase().includes(q.toLowerCase());
  const own = (list ?? []).filter((x) => x.project.kind === "design");
  const inProjects = (list ?? []).filter((x) => x.project.kind !== "design" && x.files.length);
  const open = (project: Project, f: DesignFileInfo) => {
    knowProject(project);
    const next = { projectId: project.id, file: f.id, title: f.title };
    // The design shown last (from Home, the one shown before it): opened in its place, an untouched one goes.
    const here = lastDesignTab();
    if (here && tabKey(here) === tabKey(next)) return showTab(tabKey(next));
    // Opened in the place of an untouched design: that one goes (it held nothing of yours), its tab becomes this one's.
    if (here?.fresh && !getTabs().list.some((t) => tabKey(t) === tabKey(next)))
      return void untouched(here).then((gone) => {
        if (!gone) return openTab(next);
        moveTab(tabKey(here), next);
        showTab(tabKey(next));
        design.forget(tabKey(here));
        void dropIfUntouched(here);
      });
    openTab(next);
  };
  const busy = (project: Project, f: DesignFileInfo) => sessionOf({ projectId: project.id, file: f.id }, threads)?.status === "running";
  const rename = async (project: Project, f: DesignFileInfo, title: string) => {
    if (!title || title === f.title) return;
    try {
      await rpc("design.rename", { projectId: project.id, file: f.id, title });
      relist();
    } catch (e) {
      fail(e);
    }
  };
  const row = (project: Project, f: DesignFileInfo) => {
    const k = tabKey({ projectId: project.id, file: f.id });
    return (
      <div key={k} className="ld-file-w" onContextMenu={(e) => (e.preventDefault(), setSure(false), setChoose(false), setMenu({ project, file: f, x: e.clientX, y: e.clientY }))}>
        {renaming === k ? (
          <span className="ld-file">
            <span className="ld-file-k" aria-hidden>
              <D.frame size={14} />
            </span>
            <input
              className="lc-sb-rename"
              aria-label={`Rename ${f.title}`}
              defaultValue={f.title}
              autoFocus
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Escape") (e.currentTarget.value = f.title), e.currentTarget.blur();
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => (setRenaming(null), void rename(project, f, e.target.value.trim()))}
            />
          </span>
        ) : (
          <button type="button" className="ld-file l-focus" aria-current={tabs.some((t) => tabKey(t) === k) || undefined} onClick={() => open(project, f)} onDoubleClick={() => setRenaming(k)}>
            <span className="ld-file-k" aria-hidden>
              <D.frame size={14} />
            </span>
            <span className="ld-file-t">
              <b>{f.title}</b>
              <small>
                {f.unreadable ? "can't be read" : plural(f.frames, "frame")}
                {busy(project, f) && " · being drawn"}
              </small>
            </span>
            <span className="ld-file-e">{ago(f.updated)}</span>
          </button>
        )}
      </div>
    );
  };
  const rows: ReactNode[] = [];
  const ownFiles = own.flatMap((x) => x.files.filter(match).map((f) => [x.project, f] as const)).sort((a, b) => b[1].updated - a[1].updated);
  if ((show === "all" || show === "own") && ownFiles.length) {
    rows.push(
      <div key="own" className="lc-sb-lab ld-lab">
        On their own
        <span>{ownFiles.length}</span>
      </div>,
      ...ownFiles.map(([p, f]) => row(p, f)),
    );
  }
  for (const x of inProjects) {
    if (show !== "all" && show !== x.project.id) continue;
    const files = x.files.filter(match);
    if (!files.length) continue;
    rows.push(
      <div key={`h${x.project.id}`} className="lc-sb-lab ld-lab">
        {x.project.name}
        <span>{files.length}</span>
      </div>,
      ...files.map((f) => row(x.project, f)),
    );
  }
  const shownName = show === "all" ? "All designs" : show === "own" ? "On their own" : (inProjects.find((x) => x.project.id === show)?.project.name ?? "All designs");
  const m = menu;
  const mk = m ? tabKey({ projectId: m.project.id, file: m.file.id }) : "";
  const folderOf = (p: Project, f: DesignFileInfo) => (p.kind === "design" ? p.path : `${p.path.replace(/\/+$/, "")}/.liner/designs/${f.id}`);
  return (
    <div className="ld-side">
      <div className="lc-sb-navrow">
        <button type="button" className="lc-sb-nav l-focus" onClick={() => void newDesign().catch(fail)}>
          <I.plus size={16} />
          <span>New design</span>
          <kbd className="lc-sb-kbd">{os.keys("mod+n")}</kbd>
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Search sessions, projects and commands" onClick={onSearch}>
          <I.search size={16} />
        </button>
      </div>
      <Pop label={`Show: ${shownName}`} width={240} triggerClass="ld-show" trigger={<><span>{shownName}</span><I.chevD size={12} /></>} menu>
        {(close) => (
          <>
            <Row title="All designs" on={show === "all"} onPick={() => (close(), setShow("all"))} />
            <Row title="On their own" on={show === "own"} onPick={() => (close(), setShow("own"))} />
            {inProjects.length > 0 && <Sep />}
            {inProjects.map((x) => (
              <Row key={x.project.id} title={x.project.name} on={show === x.project.id} onPick={() => (close(), setShow(x.project.id))} />
            ))}
          </>
        )}
      </Pop>
      <label className="ld-filter">
        <I.search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter designs" aria-label="Filter designs" />
      </label>
      {list === null ? <div className="ld-none l-shimmer">Looking for designs</div> : rows.length ? rows : <div className="ld-none">{q ? "No design has that in its name." : "No designs yet. Say what to make on the right, or press New design."}</div>}
      <ContextMenu at={m ? { x: m.x, y: m.y } : null} label={m ? `${m.file.title}: what to do with it` : "Design"} onClose={() => (setMenu(null), setSure(false), setChoose(false))} width={choose ? 400 : 260}>
        {(close) =>
          m && choose ? (
            <ProjectChooser
              onPick={(p) => (close(), void buildIn({ projectId: m.project.id, file: m.file.id, title: m.file.title }, { projectId: p.id }).then(relist, fail))}
              extra={<Row title="Another folder" note="One that isn't a project yet" icon={<I.plus size={14} />} onPick={() => (close(), void bridge.pickFolder().then((path) => (path ? buildIn({ projectId: m.project.id, file: m.file.id, title: m.file.title }, { path }).then(relist) : undefined)).catch(fail))} />}
            />
          ) : m && (
            <>
              <Row title="Open" icon={<D.frame size={14} />} onPick={() => (close(), open(m.project, m.file))} />
              <Row title="Rename" icon={<I.edit size={14} />} onPick={() => (close(), setRenaming(mk))} />
              <Row title={`Show in ${os.fileManager}`} icon={<I.folder size={14} />} onPick={() => (close(), bridge.reveal(folderOf(m.project, m.file)))} />
              {m.project.kind === "design" && (
                <>
                  <Sep />
                  <Row
                    title="Build in a project"
                    note="It moves into the project, conversation and all"
                    icon={<I.link size={14} />}
                    onPick={() => setChoose(true)}
                  />
                </>
              )}
              <Sep />
              {m.project.kind === "design" ? (
                // On its own: out of Liner Design for good, asked once more; its folder stays where it is.
                <Row
                  title={sure ? `Remove “${m.file.title}” from Liner Design` : "Delete"}
                  note={sure ? `Its sessions go. Its files stay in its folder in ${DESIGNS_FOLDER}` : undefined}
                  icon={<I.trash size={14} />}
                  onPick={() => {
                    if (!sure) return setSure(true);
                    close();
                    setSure(false);
                    void rpc("design.remove", { projectId: m.project.id, file: m.file.id })
                      .then(() => (closeTabHere(mk), relist(), toast(`Removed ${m.file.title}`, { description: `Its files are still in ${DESIGNS_FOLDER}.` })))
                      .catch(fail);
                  }}
                />
              ) : (
                // In a project: it goes to Liner Code's trash, and Undo puts it back as it was.
                <Row
                  title="Delete"
                  icon={<I.trash size={14} />}
                  onPick={() => {
                    close();
                    const { project, file } = m;
                    // Its tab, if it had one, closes at once; Undo puts the design back and opens it again.
                    const had = getTabs().list.find((t) => tabKey(t) === mk);
                    void rpc("design.remove", { projectId: project.id, file: file.id })
                      .then(() => {
                        closeTabHere(mk);
                        relist();
                        toast(`Deleted ${file.title}`, { duration: 6000, action: { label: "Undo", onClick: () => void rpc("design.unremove", { projectId: project.id, file: file.id }).then((r) => (relist(), had && openTab({ projectId: r.project.id, file: r.file.id, title: r.file.title })), fail) } });
                      })
                      .catch(fail);
                  }}
                />
              )}
            </>
          )
        }
      </ContextMenu>
    </div>
  );
}
