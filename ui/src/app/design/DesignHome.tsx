/*
  Design Home: the Design face's first tab, laid out as Code's Home (Home.tsx). On top of the box,
  where the design lives (on its own, by default; a project; another folder), pressed to change it;
  the composer in the middle, whose + menu holds the start choices (the lean it follows, none being
  fine; the design skills it loads; what it's drawn for; who makes AI pictures), each a chip after
  the + once it differs from its default, and the other ways to start (an empty canvas, the running
  app, the code's components, a brand). Nothing under the box, as on Code's Home. Sending makes
  the design (design.new), opens its tab, makes its session (begun from it) and sends the ask as a
  design turn. Nothing here ever makes or picks the Scratch project.

  The sidebar's body here is DesignFiles: every design, from design.all, on their own first, then
  by project, each as a row of the list (SideRow) with one ··· that opens its menu.
*/
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { DesignFile, DesignFileInfo, DesignSize, Project } from "@contracts";
import { DESIGNS_FOLDER } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { ChoiceChip, Composer, type PlusChoice, type RunSettings } from "../Composer";
import { getState, onStream, rpc, subscribe as subscribeEngine, useEngine } from "../engine";
import { getTabs, lastDesignTab, moveTab, openTab, showTab, tabKey, useTabs } from "../face";
import { I } from "../icons";
import { ago, codeProjects, markOf, modelLabel, threadModel } from "../model";
import * as os from "../os";
import { ProjectChooser } from "../Projects";
import { SideFacts, SideHead, SideLabel, SideMark, SideRow } from "../SideList";
import { ConfirmRow, ContextMenu, Pop, Row, Sep } from "../ui";
import type { Box } from "../menu-place";
import { HomeLive } from "./Live";
import { PicturesPanel, usePicturesNow } from "./Pictures";
import { D } from "./Rail";
import { buildIn, close as closeTabHere, designWords, knowFrames, markOfTab, sideStateOfDesign, TabTitle } from "./Tabs";
import { dropIfUntouched, knowProject, newDesign, runFor, sessionOf, sigOf, untouched } from "./session";
import { design, getDesign } from "./store";
import "./design-face.css";
// E's skills chips, the row over the box, start with a brand (they fill homeSlots when it loads).
import { OWN_SKILLS, pickedFor } from "./Skills";

/** What other builders add here: E's suggestion row over the box, the design skills' row in the + menu (its rows, its value, its chip after the +), and Start with a brand among the other ways to start. */
export const homeSlots: { above?: ComponentType<{ cwd: string }>; skills?: { Rows: ComponentType<{ cwd: string; done: () => void }>; Value: ComponentType<{ cwd: string }>; Chip: ComponentType<{ cwd: string }> }; or?: ComponentType<{ cwd: string; done: () => void }>; onText?: (text: string) => void; made?: (cwd: string, at: { cwd: string; file: DesignFile }) => Promise<void> } = {};

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

/** Where this design lives: the name over the box, as Home's project name (press it to change it). */
function PlaceChip({ place, onPlace }: { place: string; onPlace: (id: string) => void }) {
  const projects = codeProjects(useEngine((s) => s.projects));
  const here = projects.find((p) => p.id === place);
  const [other, setOther] = useState(false);
  return (
    <Pop label={`Where this design lives: ${here?.name ?? "on its own"}. Change it`} width={420} triggerClass="lc-home-name" keep trigger={<><span>{here?.name ?? "On its own"}</span><I.chevD size={14} /></>}>
      {(close) =>
        other ? (
          <div className="ld-own-pop">
            <button type="button" className="ld-own-back l-focus" onClick={() => setOther(false)}>
              <I.chevL size={14} />
              Another folder
            </button>
            <ProjectChooser value={here?.id} onPick={(p) => (setOther(false), close(), onPlace(p.id))} />
          </div>
        ) : (
          <div className="ld-own-pop">
            <div className="ld-way-mh">Where this design lives</div>
            <button type="button" className="ld-wl l-focus" data-on={!here || undefined} onClick={() => (close(), onPlace(OWN))}>
              <I.folder size={16} />
              <span>
                <b>On its own</b>
                <small>In {DESIGNS_FOLDER}. No project needed</small>
              </span>
              {!here && <I.check size={14} className="ld-ok" />}
            </button>
            {projects.slice(0, 6).map((p) => (
              <button key={p.id} type="button" className="ld-wl l-focus" data-on={p.id === place || undefined} onClick={() => (close(), onPlace(p.id))}>
                <I.folder size={16} />
                <span>
                  <b>{p.name}</b>
                  <small>Beside its code, ready to build</small>
                </span>
                {p.id === place && <I.check size={14} className="ld-ok" />}
              </button>
            ))}
            <Sep />
            <button type="button" className="ld-wl l-focus" onClick={() => setOther(true)}>
              <I.plus size={16} />
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

/**
  The other ways to start, in the + menu's place once its "Start another way" row is pressed: an empty
  canvas, and for a design in a project the running app on the canvas (its picker in the menu's place)
  and the code's components as parts (an ask put in the box); then Start with a brand (Skills.tsx).
*/
function StartRows({ project, cwd, empty, seed, done }: { project?: Project; cwd: string; empty: () => void; seed: (text: string) => void; done: () => void }) {
  const [live, setLive] = useState(false);
  const Brand = homeSlots.or;
  if (live && project) return <HomeLive project={project} onOpen={async (file) => (done(), openTab({ projectId: project.id, file }))} onClose={() => setLive(false)} />;
  return (
    <>
      <Row title="An empty canvas" icon={<D.frame size={16} />} onPick={() => (done(), empty())} />
      {project && (
        <>
          <Row title="The running app, live" note="A page of its dev server, on the canvas" icon={<I.globe size={16} />} onPick={() => setLive(true)} />
          <Row title="Components in the code as parts" note="The ask goes in the box, to send with Send" icon={<I.file size={16} />} onPick={() => (done(), seed("Turn the components in the code into parts on the canvas: one frame per component, on the Parts page."))} />
        </>
      )}
      {Brand && cwd && <Brand cwd={cwd} done={done} />}
    </>
  );
}

/** The lean the new design follows: none is fine (the agent uses its own taste); a project's DESIGN.md when it has one. Its name and first colours. */
function useLean(cwd?: string) {
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
  return { name, sw };
}
/** What the lean means here, in the + menu's place or under its chip. It's changed from the design's sidebar, not here. */
const LeanNote = ({ name }: { name: string | null }) => (
  <div className="ld-own-pop">
    <div className="ld-way-mh">{name ? `The lean: ${name}` : "No lean"}</div>
    <p className="ld-note ld-own-note">
      {name
        ? "The design follows it: its colours, type and steps, and the rules it never breaks. Change it from the design's sidebar."
        : "Optional. The agent uses its own taste and any skills you load. Add a DESIGN.md from the design's sidebar when you want rules it keeps to; nothing asks for one."}
    </p>
  </div>
);
/** The lean's swatches, as small as a mark. */
const LeanMark = ({ name, sw }: { name: string | null; sw: string[] }) => (
  <span className="ld-q4" data-small data-none={!name || undefined} aria-hidden>
    {sw.map((c) => <i key={c} style={{ background: c }} />)}
  </span>
);

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
  const initial = useMemo((): RunSettings => runFor(project), [project?.id, project?.agent, engineSettings.start, engineSettings.defaultAccess, engineSettings.pairEffort, providers.length]);
  const [settings, setSettings] = useState<RunSettings>(initial);
  useEffect(() => setSettings(initial), [initial]);
  const [size, setSize] = useState<Size>(SIZES[0].id);
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
      const t = await rpc("thread.create", { projectId: p.id, design: { file: file.id }, title: file.title, agent: settings.agent, sidekick: settings.sidekick, ...(settings.sidekick && settings.tuning ? { tuning: settings.tuning } : {}), model: settings.model, effort: settings.effort, access: settings.access, mode: "standard", worktree: false });
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
  const lean = useLean(project?.path);
  const pictures = usePicturesNow(true);
  const sizeLabel = SIZES.find((x) => x.id === size)?.label ?? "";
  /*
    The start choices, in the box's + menu with their value at the row's end. What it's drawn for has a
    default (desktop and phone) and shows as a chip only when it's another; the lean (none by default)
    and loaded design skills show as chips while there are some, since they shape what gets drawn. Who
    makes AI pictures can't be picked before there's a design file, so it's a row to read and no chip.
  */
  const choices: PlusChoice[] = [
    { key: "lean", label: "Lean", icon: <LeanMark {...lean} />, value: lean.name ?? "None", say: lean.name ?? "none", body: () => <LeanNote name={lean.name} />, chip: lean.name ? <Pop label={`Lean: ${lean.name}`} width={320} triggerClass="lc-seg-b ld-lean-chip" trigger={<><LeanMark {...lean} /><span className="lc-chip-name">{lean.name}</span><I.chevD size={12} /></>}>{() => <LeanNote name={lean.name} />}</Pop> : undefined },
    ...(Skills && skillsCwd ? [{ key: "skills", label: "Design skills", icon: <I.sparkle size={16} />, value: <Skills.Value cwd={skillsCwd} />, body: (done: () => void) => <Skills.Rows cwd={skillsCwd} done={done} />, chip: <Skills.Chip cwd={skillsCwd} /> }] : []),
    { key: "size", label: "Drawn for", icon: <I.monitor size={16} />, value: sizeLabel, say: sizeLabel, body: (done) => SIZES.map((x) => <Row key={x.id} title={x.label} on={x.id === size} onPick={() => (setSize(x.id), done())} />), chip: size !== SIZES[0].id ? <ChoiceChip icon={<I.monitor size={14} />} label={sizeLabel} clear={{ label: `Back to ${SIZES[0].label.toLowerCase()}`, onClear: () => setSize(SIZES[0].id) }} /> : undefined },
    { key: "pictures", label: "AI pictures", icon: <D.picture size={16} />, value: pictures.name, say: pictures.name, body: () => <PicturesPanel home /> },
    { key: "start", label: "Start another way", icon: <D.frame size={16} />, body: (done) => <StartRows project={project} cwd={skillsCwd} empty={() => void empty()} seed={(text) => setSeed({ text, at: Date.now() })} done={done} /> },
  ];

  return (
    <div className="lc-home ld-home">
      <header className="ld-bar" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" title={`Show the sidebar (${os.mod}\\)`} onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <TabTitle />
        <span className="lc-grow" data-drag />
      </header>
      {/* Laid out as Code's Home: where it lives on top of the box, the box in the middle. */}
      <div className="lc-home-in ld-home-in" data-mid="">
        <div className="ld-home-head">
          <div className="lc-home-top">
            <PlaceChip place={project ? place : OWN} onPlace={setPlace} />
            <span className="lc-grow" />
          </div>
          {Above && skillsCwd && <Above cwd={skillsCwd} />}
        </div>
        <div className="lc-home-compose">
          <Composer
            variant="home"
            draftKey="design-home"
            project={project ?? NOWHERE}
            settings={settings}
            onSettings={(p) => setSettings((s) => ({ ...s, ...p }))}
            onSend={start}
            onText={homeSlots.onText}
            onNewAgent={onNewAgent}
            placeholder="A screen, a page, a brand: say what to design"
            autoFocus
            seed={seed}
            choices={choices}
          />
        </div>
      </div>
    </div>
  );
}

type Listed = { project: Project; files: DesignFileInfo[] };
let listed: Listed[] | null = null;
// A failed design.all is said, not an endless "Looking for designs": its words stay until a read succeeds.
let listFailed: string | null = null;
const listFns = new Set<() => void>();
let asking = 0;
let slowly = 0;
/** Only the open design's page was written (your edit, its agent drawing), which changes no more than its time here: design.all at most once in 2 s. */
const relistSlowly = () => void (slowly ||= window.setTimeout(() => ((slowly = 0), relist()), 2000));
/** design.all again, a moment after anything that may change it (one call for the sidebar). */
function relist() {
  clearTimeout(slowly);
  slowly = 0;
  clearTimeout(asking);
  asking = window.setTimeout(() => {
    void rpc("design.all", {}).then(
      (l) => {
        listed = l;
        listFailed = null;
        listFns.forEach((f) => f());
        // What the open designs' rows say of them when nothing runs there (Tabs.tsx).
        for (const x of l) for (const f of x.files) if (!f.unreadable) knowFrames(tabKey({ projectId: x.project.id, file: f.id }), f.frames);
      },
      (e) => {
        listFailed = e instanceof Error ? e.message : String(e);
        listFns.forEach((f) => f());
      },
    );
  }, 150);
}
/** What hears for the list while anything shows it; let go with the last one that does. */
let hearing: (() => void) | undefined;
function useListed() {
  const [, redraw] = useState(0);
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    listFns.add(f);
    if (!hearing) {
      const offStream = onStream((e) => {
        if (e.type !== "canvas.changed") return;
        const s = getDesign();
        if (e.frame && e.rev && e.cwd === s.cwd && e.file === s.file?.id) relistSlowly();
        else relist();
      });
      // A project come or gone (a design made, removed, moved into a project).
      let was = getState().projects;
      const offEngine = subscribeEngine(() => {
        const now = getState().projects;
        if (now !== was) (was = now), relist();
      });
      hearing = () => (offStream(), void offEngine(), clearTimeout(slowly), (slowly = 0));
    }
    relist();
    return () => {
      listFns.delete(f);
      if (!listFns.size && hearing) (hearing(), (hearing = undefined));
    };
  }, []);
  return listed;
}

type Menu = { project: Project; file: DesignFileInfo; x: number; y: number; under?: Box; row?: Box };

/** Opens a design in its tab, from the sidebar's rows. */
function openDesign(project: Project, f: DesignFileInfo) {
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
}

/** Its ··· opens the row's menu here, its right edge under the button's, as a session row's does (Sidebar.tsx). */
const FILE_MENU_W = 260;

/**
  The sidebar's body on Design Home, under the places (New design is one of them): "All designs" with its one menu (which
  designs it shows), the filter (the only way to find a design by its name: the search finds sessions, not designs), and
  every design, on their own first, then by project. Each design is a row of the list (SideRow): its session's state mark,
  its title with the time it last changed, what it draws or asks or how many frames it has, its model's mark, and one ···.
*/
export function DesignFiles() {
  const list = useListed();
  const threads = useEngine((s) => s.threads);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const { list: tabs } = useTabs();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<string>("all");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [choose, setChoose] = useState(false);
  const match = (f: DesignFileInfo) => !q || f.title.toLowerCase().includes(q.toLowerCase());
  const own = (list ?? []).filter((x) => x.project.kind === "design");
  const inProjects = (list ?? []).filter((x) => x.project.kind !== "design" && x.files.length);
  const open = openDesign;
  const rename = async (project: Project, f: DesignFileInfo, title: string) => {
    if (!title || title === f.title) return;
    try {
      await rpc("design.rename", { projectId: project.id, file: f.id, title });
      relist();
    } catch (e) {
      fail(e);
    }
  };
  const menuAt = (project: Project, f: DesignFileInfo, x: number, y: number, under?: Box, row?: Box) => (setChoose(false), setMenu({ project, file: f, x, y, under, row }));
  const row = (project: Project, f: DesignFileInfo) => {
    const k = tabKey({ projectId: project.id, file: f.id });
    const s = sessionOf({ projectId: project.id, file: f.id }, threads);
    const state = sideStateOfDesign(s);
    // Design Home shows: no design is being looked at, so a question it asks is news until its design is opened.
    const words = f.unreadable ? { text: "Can't be read", tone: "danger" as const } : designWords(s, state, false, f.frames);
    const ref = s ? threadModel(s, agents, providers) : undefined;
    const brand = ref ? markOf(ref) : undefined;
    const title =
      renaming === k ? (
        <input
          className="lc-sb-rename"
          aria-label={`Rename ${f.title}`}
          defaultValue={f.title}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape") (e.currentTarget.value = f.title), e.currentTarget.blur();
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={(e) => (setRenaming(null), void rename(project, f, e.target.value.trim()))}
        />
      ) : (
        f.title
      );
    return (
      <SideRow
        key={k}
        quiet={state === "done"}
        mark={<SideMark state={markOfTab(s, false)} brand={brand} />}
        title={title}
        ago={ago(f.updated)}
        sub={words.text}
        tone={words.tone}
        facts={brand && <SideFacts model={brand} modelName={ref && modelLabel(ref, providers)} />}
        onContextMenu={(e) => (e.preventDefault(), menuAt(project, f, e.clientX, e.clientY))}
        pick={{
          role: "button",
          tabIndex: 0,
          className: "l-focus",
          title: f.title,
          "aria-current": tabs.some((t) => tabKey(t) === k) || undefined,
          onClick: () => renaming !== k && open(project, f),
          onDoubleClick: () => setRenaming(k),
          onKeyDown: (e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(project, f)),
        }}
        acts={
          <button
            type="button"
            className="lc-sb-a l-focus"
            aria-label={`Open, rename, show in ${os.fileManager} and more for ${f.title}`}
            title={`Open, rename, show in ${os.fileManager} and more`}
            aria-haspopup="menu"
            aria-expanded={mk === k}
            data-open={mk === k || undefined}
            onClick={(e) => {
              // Hung under the ···, right edges on one line (menu-place.ts).
              const r = e.currentTarget.getBoundingClientRect();
              menuAt(project, f, r.right, r.bottom, r, e.currentTarget.closest(".lc-sl-row")?.getBoundingClientRect());
            }}
          >
            <I.more size={14} />
          </button>
        }
      />
    );
  };
  const m = menu;
  const mk = m ? tabKey({ projectId: m.project.id, file: m.file.id }) : "";
  const rows: ReactNode[] = [];
  const ownFiles = own.flatMap((x) => x.files.filter(match).map((f) => [x.project, f] as const)).sort((a, b) => b[1].updated - a[1].updated);
  if ((show === "all" || show === "own") && ownFiles.length) {
    rows.push(<SideLabel key="own" name="On their own" count={ownFiles.length} />, ...ownFiles.map(([p, f]) => row(p, f)));
  }
  for (const x of inProjects) {
    if (show !== "all" && show !== x.project.id) continue;
    const files = x.files.filter(match);
    if (!files.length) continue;
    rows.push(<SideLabel key={`h${x.project.id}`} name={x.project.name} count={files.length} />, ...files.map((f) => row(x.project, f)));
  }
  const shownName = show === "all" ? undefined : show === "own" ? "On their own" : inProjects.find((x) => x.project.id === show)?.project.name;
  const folderOf = (p: Project, f: DesignFileInfo) => (p.kind === "design" ? p.path : `${p.path.replace(/\/+$/, "")}/.liner/designs/${f.id}`);
  return (
    <div className="ld-side">
      <SideHead title="All designs" note={shownName} menuLabel="Which designs the list shows">
        {(close) => (
          <>
            <Row title="All designs" icon={<I.list size={16} />} keepIcon on={show === "all"} onPick={() => (close(), setShow("all"))} />
            <Row title="On their own" icon={<I.edit size={16} />} keepIcon on={show === "own"} onPick={() => (close(), setShow("own"))} />
            {inProjects.length > 0 && <Sep />}
            {inProjects.map((x) => (
              <Row key={x.project.id} title={x.project.name} icon={<I.folder size={16} />} keepIcon on={show === x.project.id} onPick={() => (close(), setShow(x.project.id))} />
            ))}
          </>
        )}
      </SideHead>
      <label className="ld-filter">
        <I.search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter designs" aria-label="Filter designs" />
      </label>
      {list === null ? (
        listFailed ? (
          <div className="ld-none">
            <p className="lc-sinfo-note" role="alert">
              {listFailed} <button type="button" className="lc-link l-focus" onClick={() => relist()}>Look again</button>
            </p>
          </div>
        ) : (
          <div className="ld-none l-shimmer">Looking for designs</div>
        )
      ) : rows.length ? <div className="lc-sl-list ld-files">{rows}</div> : <div className="ld-none">{q ? "No design has that in its name." : "No designs yet. Say what to make on the right, or press New design."}</div>}
      <ContextMenu at={m ? { x: m.x, y: m.y, under: m.under, row: m.row } : null} label={m ? `${m.file.title}: what to do with it` : "Design"} onClose={() => (setMenu(null), setChoose(false))} width={choose ? 400 : FILE_MENU_W}>
        {(close) =>
          m && choose ? (
            <ProjectChooser
              onPick={(p) => (close(), void buildIn({ projectId: m.project.id, file: m.file.id, title: m.file.title }, { projectId: p.id }).then(relist, fail))}
              extra={<Row title="Another folder" note="One that isn't a project yet" icon={<I.plus size={16} />} onPick={() => (close(), void bridge.pickFolder().then((path) => (path ? buildIn({ projectId: m.project.id, file: m.file.id, title: m.file.title }, { path }).then(relist) : undefined)).catch(fail))} />}
            />
          ) : m && (
            <>
              <Row title="Open" icon={<D.frame size={16} />} onPick={() => (close(), open(m.project, m.file))} />
              <Row title="Rename" icon={<I.edit size={16} />} onPick={() => (close(), setRenaming(mk))} />
              <Row title={`Show in ${os.fileManager}`} icon={<I.folder size={16} />} onPick={() => (close(), bridge.reveal(folderOf(m.project, m.file)))} />
              {m.project.kind === "design" && (
                <>
                  <Sep />
                  <Row
                    title="Build in a project"
                    note="It moves into the project, conversation and all"
                    icon={<I.link size={16} />}
                    onPick={() => setChoose(true)}
                  />
                </>
              )}
              <Sep />
              {m.project.kind === "design" ? (
                // On its own: out of Liner Design, asked once more as every Remove is ("Remove", then "Remove it"); its folder stays where it is.
                // Through the confirm row, so the second click of a double-click on Remove doesn't remove it; keyed by the design, so
                // the ask never carries over to another design's menu.
                <ConfirmRow
                  key={mk}
                  title="Remove"
                  sure="Remove it"
                  note="From Liner Design; its files stay"
                  sureNote={`Its sessions go. Its files stay in its folder in ${DESIGNS_FOLDER}`}
                  icon={<I.trash size={16} />}
                  onConfirm={() => {
                    close();
                    void rpc("design.remove", { projectId: m.project.id, file: m.file.id })
                      .then(() => (closeTabHere(mk), relist(), toast(`Removed ${m.file.title}`, { description: `Its files are still in ${DESIGNS_FOLDER}.` })))
                      .catch(fail);
                  }}
                />
              ) : (
                // In a project: it goes to Liner Code's trash, and Undo puts it back as it was.
                <Row
                  title="Delete"
                  icon={<I.trash size={16} />}
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
