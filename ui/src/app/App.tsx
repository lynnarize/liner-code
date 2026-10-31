/*
  Liner Code. The window is one ground: the sidebar beside Home, a session or Usage, with
  nothing drawn between them. ⌘K reaches everything; the shell's menu bar sends the same commands.
*/
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AgentProfile, RoutineRun } from "@contracts";
import { CommandMenu, type CommandItem } from "@liner/pro/command-menu/command-menu";
import { Toaster, toast } from "@liner/components/toast/toast";
import { AgentDialog } from "./AgentDialog";
import { Backdrop, Scene } from "./Backdrop";
import { bridge, onCommand } from "./bridge";
import { getState, onNotify, onStream, rpc, startEngine, useEngine } from "./engine";
import { Home } from "./Home";
import { I } from "./icons";
import { ACCESS_LEVELS, agentOf, bucketOf } from "./model";
import { Session } from "./Session";
import { applyLook, readLook } from "./look";
import { Sidebar } from "./Sidebar";
// The builder brings Liner's workflow canvas; it loads when you first edit a routine.
const RoutineBuilder = lazy(() => import("./RoutineBuilder").then((m) => ({ default: m.RoutineBuilder })));
// Screens you open now and then load when you first do, so launch has less to read.
const Settings = lazy(() => import("./Settings").then((m) => ({ default: m.Settings })));
const Setup = lazy(() => import("./Setup").then((m) => ({ default: m.Setup })));
const Usage = lazy(() => import("./Usage").then((m) => ({ default: m.Usage })));
const RoutinesPage = lazy(() => import("./Routines").then((m) => ({ default: m.RoutinesPage })));
const Compare = lazy(() => import("./Compare").then((m) => ({ default: m.Compare })));
import { keepPanel, keptPanel, openTab, SURFACES, type SurfaceId, type Tab } from "./Surfaces";
import { openSurface } from "./Rail";
import { startAgentBrowser } from "./agentBrowser";
import { HiddenBrowsers } from "./Browser";
import { matches, MENU_COMMANDS, menuKeys, pressed, setBindings, shortcutOf } from "./keymap";

type View = { kind: "home"; projectId?: string } | { kind: "session"; id: string } | { kind: "usage" } | { kind: "routines" } | { kind: "routine"; id?: string; projectId?: string; back?: View } | { kind: "compare"; id: string };

const readView = (): View => {
  try {
    return JSON.parse(sessionStorage.getItem("lc:view") || "") as View;
  } catch {
    return { kind: "home" };
  }
};

/*
  F6 and ⇧F6 move between the window's areas, T3 Code's workspace areas (docs/user/keyboard-focus.md):
  the sidebar, the thread, the composer and the panel, skipping any that's hidden or absent, and
  back to where you last were in each. A dialog that's open (⌘K) keeps the keyboard.
*/
const AREAS: { root: string; first: string[] }[] = [
  { root: ".lc-side:not([inert])", first: [".lc-sb-row[aria-current='page'] .lc-sb-pick", ".lc-sb-pick", "button"] },
  { root: ".lc-thread .lc-scroll", first: [] },
  { root: ".lc-composer", first: ["textarea"] },
  { root: ".lc-panel", first: [".lc-surface:not([hidden]) textarea", ".lc-surface:not([hidden]) :is(input, select, button, [tabindex='0'])", "[role='tab'][aria-selected='true']"] },
];
const lastIn = new Map<number, HTMLElement>();
const shows = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && el.isConnected && el.checkVisibility();
const areaOf = (el: Element | null) => (el ? AREAS.findIndex((a) => el.closest(a.root)) : -1);
function moveFocus(step: 1 | -1) {
  if (document.querySelector("dialog[open]")) return;
  const here = areaOf(document.activeElement);
  const from = here >= 0 ? here : step > 0 ? -1 : AREAS.length;
  for (let n = 1; n <= AREAS.length; n++) {
    const i = (from + step * n + AREAS.length * 2) % AREAS.length;
    const root = document.querySelector(AREAS[i].root);
    if (!shows(root)) continue;
    const kept = lastIn.get(i);
    const target = (shows(kept) && root.contains(kept) ? kept : undefined) ?? AREAS[i].first.map((q) => [...root.querySelectorAll(q)].find(shows)).find(Boolean) ?? root;
    // The thread's scroller takes the keyboard too, so the arrows and Page Down read it.
    if (target === root && !root.hasAttribute("tabindex")) root.tabIndex = -1;
    target.focus({ preventScroll: target === root });
    return;
  }
}

/** A line of a message around what you searched for, for ⌘K. */
const around = (text: string, q: string) => {
  const at = text.toLowerCase().indexOf(q.toLowerCase().split(/\s+/)[0] ?? "");
  const from = Math.max(0, at - 30);
  const s = text.slice(from, from + 110).replace(/\s+/g, " ").trim();
  return `${from ? "…" : ""}${s}${from + 110 < text.length ? "…" : ""}`;
};
type Hit = { threadId: string; title: string; snippet: string };

export function App() {
  const ready = useEngine((s) => s.ready);
  const connected = useEngine((s) => s.connected);
  const onboarded = useEngine((s) => s.settings.onboarded);
  const notifyOn = useEngine((s) => s.settings.notify);
  const badgeOn = useEngine((s) => s.settings.badge);
  const threads = useEngine((s) => s.threads);
  const sides = useEngine((s) => s.sides);
  const projects = useEngine((s) => s.projects);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const [view, setView] = useState<View>(readView);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("lc:sidebar") !== "0");
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [agentDialog, setAgentDialog] = useState<{ open: boolean; agent?: AgentProfile }>({ open: false });
  const [lastProject, setLastProject] = useState<string | undefined>(() => localStorage.getItem("lc:project") ?? undefined);

  useEffect(() => startAgentBrowser(), []);
  useEffect(() => {
    startEngine();
    applyLook(readLook());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => readLook().theme === "system" && applyLook(readLook());
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);
  useEffect(() => sessionStorage.setItem("lc:view", JSON.stringify(view)), [view]);
  useEffect(() => localStorage.setItem("lc:sidebar", sidebar ? "1" : "0"), [sidebar]);
  useEffect(() => {
    if (lastProject) localStorage.setItem("lc:project", lastProject);
  }, [lastProject]);

  const current = view.kind === "session" ? threads.find((t) => t.id === view.id) : undefined;
  // A session that went away (removed elsewhere) hands back to Home.
  useEffect(() => {
    if (ready && view.kind === "session" && !current) setView({ kind: "home" });
  }, [ready, view, current]);

  // The Dock says how many sessions need you; notifications say which, while you're elsewhere.
  const needs = threads.filter((t) => !t.archived && bucketOf(t) === "needs" && t.turns > 0).length;
  useEffect(() => bridge.badge(badgeOn ? needs : 0), [needs, badgeOn]);
  // The menu bar item says the same, with which sessions, while the window is out of sight.
  const menuBar = useEngine((s) => s.settings.menuBar !== false);
  const live = threads.filter((t) => !t.archived && !t.routine && !t.trial);
  const traySay = JSON.stringify({
    show: menuBar,
    working: live.filter((t) => t.status === "running").map((t) => ({ id: t.id, title: t.title })),
    needs: live.filter((t) => bucketOf(t) === "needs" && t.turns > 0).map((t) => ({ id: t.id, title: t.title, waiting: t.status === "waiting" })),
    // Every turn going, routines' and side chats' too: ⌘Q asks first while there are any.
    running: [...threads, ...sides].filter((t) => !t.archived && t.status === "running").length,
  });
  useEffect(() => bridge.status(JSON.parse(traySay)), [traySay]);
  useEffect(() => {
    const off = onNotify((e) => {
      const open = view.kind === "session" && view.id === e.threadId && document.hasFocus();
      if (open) return;
      if (notifyOn) bridge.notify(e.title, e.body, e.threadId);
      if (e.kind === "error" && document.hasFocus()) toast.error(e.title, { description: e.body });
    });
    return () => void off();
  }, [view, notifyOn]);

  // A session a rule settled says so, with an Undo.
  useEffect(
    () =>
      onStream((e) => {
        if (e.type !== "settled") return;
        const t = threads.find((x) => x.id === e.threadId);
        toast(`Moved ${t?.title ?? "a session"} to Settled`, { description: e.reason, action: { label: "Undo", onClick: () => void rpc("thread.update", { id: e.threadId, done: false }) }, duration: 5000 });
      }),
    [threads],
  );

  // "Set up a way of working" in the composer opens Settings on that place.
  useEffect(() => {
    const on = (e: Event) => {
      sessionStorage.setItem("lc:settings", String((e as CustomEvent).detail ?? "general"));
      setSettings(true);
    };
    window.addEventListener("lc:open-settings", on);
    return () => window.removeEventListener("lc:open-settings", on);
  }, []);

  const openSession = (id: string, tab?: Tab) => {
    if (tab) keepPanel(id, openTab(keptPanel(id), tab));
    setView({ kind: "session", id });
  };
  const openRun = (run: RoutineRun) => (run.threadId ? openSession(run.threadId, `run:${run.id}`) : setView({ kind: "routines" }));
  const editRoutine = (id?: string, projectId?: string) => setView({ kind: "routine", id, projectId: projectId ?? (current?.projectId || lastProject), back: view.kind === "routine" ? undefined : view });
  const newSession = (projectId?: string) => {
    setView({ kind: "home", projectId: projectId ?? (current?.projectId || lastProject) });
  };

  /** The sessions as the sidebar shows them, top to bottom: ⌘1 to ⌘9 and "next that needs you" go by it. */
  const sidebarOrder = () => [...document.querySelectorAll<HTMLElement>(".lc-side .lc-sb-row[data-row]")].map((r) => r.dataset.row ?? "");
  // The next session that waits on you, down the sidebar from the one that's open, round to the top.
  const nextNeeds = () => {
    const order = sidebarOrder();
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    const here = current ? rank(current.id) : -1;
    const needs = threads.filter((t) => !t.archived && t.id !== current?.id && bucketOf(t) === "needs" && t.turns > 0).sort((a, b) => rank(a.id) - rank(b.id));
    const next = needs.find((t) => rank(t.id) > here) ?? needs[0];
    if (next) {
      setSettings(false);
      openSession(next.id);
    } else toast(current && bucketOf(current) === "needs" ? "Nothing else needs you" : "Nothing needs you", { duration: 2500 });
  };
  /** Opens a surface in the open session's panel, or in its kept panel for when it opens. */
  const showSurface = (id: string, tab: SurfaceId) => {
    if (!openSurface(id, tab)) openSession(id, tab);
  };
  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast(`Copied ${what}`, { description: text, duration: 2500 }),
      () => toast.error(`Couldn't copy ${what}`),
    );

  // Menu-bar commands from the shell, and the same commands from their keys.
  const run = (name: string) => {
    if (name === "new") newSession();
    else if (name === "commands") setMenu((m) => !m);
    else if (name === "settings") setSettings((o) => !o);
    else if (name === "updates") {
      window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "updates" }));
      void rpc("updates.check", {}).catch(() => {});
    }
    else if (name === "sidebar") setSidebar((s) => !s);
    else if (name === "usage") setView({ kind: "usage" });
    else if (name === "open-project") void bridge.pickFolder().then((p) => (p ? rpc("project.add", { path: p }).then((x) => setView({ kind: "home", projectId: x.id })) : undefined));
    else if (name === "next-needs") nextNeeds();
    else if (name === "focus.next") moveFocus(1);
    else if (name === "focus.prev") moveFocus(-1);
    else if (name.startsWith("open:")) openSession(name.slice(5));
  };
  // The listeners stay; each press reaches what's current through the ref.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => onCommand((name) => runRef.current(name)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const name = pressed(e, MENU_COMMANDS);
      if (name) {
        e.preventDefault();
        return runRef.current(name);
      }
      // ⌘1 to ⌘9 open the sessions down the sidebar, unless a dialog (⌘K) has the keyboard.
      const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((k) => matches(e, `mod+${k}`));
      if (!n || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      const id = sidebarOrder()[n - 1];
      if (id) runRef.current(`open:${id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // F6 goes back to where you last were in each area.
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const i = areaOf(e.target as Element | null);
      if (i >= 0 && e.target instanceof HTMLElement) lastIn.set(i, e.target);
    };
    document.addEventListener("focusin", on);
    return () => document.removeEventListener("focusin", on);
  }, []);

  // What the ⌘K field holds, for finding words inside messages (the menu keeps its query to itself).
  const [asked, setAsked] = useState("");
  useEffect(() => {
    if (!menu) return setAsked("");
    const on = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || !el.classList.contains("l-cmd__input")) return;
      // A page of its own (Change what it may do) searches only its own items.
      setAsked(document.querySelector(".l-cmd__crumb") ? "" : el.value.trim());
    };
    document.addEventListener("input", on, true);
    return () => document.removeEventListener("input", on, true);
  }, [menu]);
  // Timelines already loaded answer at once; the engine's search over every session follows,
  // a moment after you stop typing, one hit a session.
  const [found, setFound] = useState<Hit[]>([]);
  useEffect(() => {
    const q = asked.toLowerCase();
    if (q.length < 3) return setFound([]);
    const open = new Map(threads.filter((t) => !t.archived).map((t) => [t.id, t.title]));
    const now = new Map<string, Hit>();
    for (const [id, list] of Object.entries(getState().items)) {
      const title = open.get(id);
      if (title === undefined) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i];
        if ((it.kind === "user" || it.kind === "text") && it.text.toLowerCase().includes(q)) {
          now.set(id, { threadId: id, title, snippet: around(it.text, q) });
          break;
        }
      }
    }
    setFound([...now.values()].slice(0, 10));
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all(projects.map((p) => rpc("sessions.search", { projectId: p.id, query: asked }).catch(() => []))).then((all) => {
        if (!live) return;
        for (const h of all.flat()) if (open.has(h.threadId) && !now.has(h.threadId)) now.set(h.threadId, { threadId: h.threadId, title: h.title, snippet: around(h.snippet, q) });
        setFound([...now.values()].slice(0, 10));
      });
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [asked]);
  // Your shortcuts: the keymap reads them, and the Mac app's menu takes the same keys.
  const keybindings = useEngine((s) => s.settings.keybindings);
  const [, setKeysSeen] = useState(0);
  useEffect(() => {
    setBindings(keybindings);
    bridge.setMenuKeys(menuKeys());
    setKeysSeen((n) => n + 1);
  }, [JSON.stringify(keybindings ?? [])]);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      { id: "new", label: "New session", group: "Actions", icon: <I.compose size={15} />, shortcut: shortcutOf("new"), onSelect: () => newSession() },
      { id: "next-needs", label: "Next session that needs you", group: "Actions", keywords: ["waiting", "jump"], shortcut: shortcutOf("next-needs"), onSelect: nextNeeds },
      { id: "usage", label: "Usage and cost", group: "Actions", icon: <I.usage size={15} />, onSelect: () => setView({ kind: "usage" }) },
      { id: "routines", label: "Routines", group: "Actions", icon: <I.routines size={15} />, keywords: ["automation", "schedule", "webhook"], onSelect: () => setView({ kind: "routines" }) },
      { id: "routine-new", label: "New routine", group: "Actions", icon: <I.plus size={15} />, onSelect: () => editRoutine() },
      { id: "settings", label: "Settings", group: "Actions", icon: <I.settings size={15} />, shortcut: shortcutOf("settings"), onSelect: () => setSettings(true) },
      { id: "sidebar", label: sidebar ? "Hide the sidebar" : "Show the sidebar", group: "Actions", icon: <I.sidebar size={15} />, shortcut: shortcutOf("sidebar"), onSelect: () => setSidebar((s) => !s) },
      { id: "agent", label: "New agent", group: "Actions", icon: <I.plus size={15} />, onSelect: () => setAgentDialog({ open: true }) },
      {
        id: "project",
        label: "Add a project",
        group: "Actions",
        icon: <I.folder size={15} />,
        onSelect: () =>
          void bridge.pickFolder().then((p) => {
            if (p)
              void rpc("project.add", { path: p })
                .then((x) => setView({ kind: "home", projectId: x.id }))
                .catch((e) => toast.error(String(e.message)));
          }),
      },
    ];
    if (current) {
      const branch = current.worktree?.branch ?? projects.find((p) => p.id === current.projectId)?.branch;
      items.push(
        // The panel's surfaces, opened beside this session (T3 Code's palette lists them too).
        ...SURFACES.map((s) => ({ id: `surface-${s.id}`, label: `Open ${s.label}`, group: "This session", icon: <s.icon size={15} />, shortcut: shortcutOf(`surface.${s.id}`), onSelect: () => showSurface(current.id, s.id) })),
        ...(branch ? [{ id: "copy-branch", label: "Copy branch name", group: "This session", hint: branch, icon: <I.branch size={15} />, onSelect: () => copy(branch, "the branch name") }] : []),
        { id: "copy-id", label: "Copy session id", group: "This session", hint: current.id, onSelect: () => copy(current.id, "the session id") },
        { id: "stop", label: "Stop this session", group: "This session", keywords: ["cancel", "interrupt"], onSelect: () => void rpc("thread.stop", { id: current.id }) },
        { id: "pin", label: current.pinned ? "Unpin it" : "Pin it", group: "This session", onSelect: () => void rpc("thread.update", { id: current.id, pinned: !current.pinned }) },
        { id: "settle", label: "Settle it", group: "This session", onSelect: () => void rpc("thread.update", { id: current.id, done: true, unread: false }) },
        { id: "archive", label: "Archive it", group: "This session", keywords: ["put away", "hide"], onSelect: () => void rpc("thread.update", { id: current.id, archived: true }).then(() => setView({ kind: "home" })) },
        {
          id: "fork",
          label: "Fork it",
          group: "This session",
          icon: <I.fork size={15} />,
          onSelect: () => void rpc("thread.create", { projectId: current.projectId, forkOf: current.id }).then((t) => openSession(t.id)),
        },
        {
          id: "access",
          label: "Change what it may do",
          group: "This session",
          icon: <I.lock size={15} />,
          items: ACCESS_LEVELS.map((l) => ({ id: `access-${l.id}`, label: l.label, hint: l.note, onSelect: () => void rpc("thread.update", { id: current.id, access: l.id }) })),
        },
        {
          id: "reveal",
          label: "Show the project in Finder",
          group: "This session",
          onSelect: () => {
            const p = projects.find((x) => x.id === current.projectId);
            if (p) bridge.openIn(current.worktree?.path ?? p.path, "finder");
          },
        },
        {
          id: "terminal",
          label: "Open a terminal here",
          group: "This session",
          hint: "In Terminal",
          icon: <I.terminal size={15} />,
          onSelect: () => {
            const p = projects.find((x) => x.id === current.projectId);
            if (p) bridge.openIn(current.worktree?.path ?? p.path, "terminal");
          },
        },
        {
          id: "delete",
          label: "Delete this session",
          group: "This session",
          icon: <I.trash size={15} />,
          // It can't be undone, so it asks first, on a page of its own; Enter alone keeps it.
          items: [
            { id: "delete-keep", label: "Keep it", onSelect: () => {} },
            { id: "delete-archive", label: "Archive it instead", hint: "Out of the sidebar, back from Settings any time", onSelect: () => void rpc("thread.update", { id: current.id, archived: true }).then(() => setView({ kind: "home" })) },
            {
              id: "delete-yes",
              label: `Delete “${current.title}” for good`,
              hint: current.worktree ? "Its worktree is kept if it has changes" : "Its timeline goes; your files stay",
              icon: <I.trash size={15} />,
              onSelect: () =>
                void rpc("thread.remove", { id: current.id })
                  .then(() => setView({ kind: "home" }))
                  .catch((e: Error) => toast.error(e.message)),
            },
          ],
        },
      );
    }
    for (const t of threads.filter((x) => !x.archived).slice(0, 200)) items.push({ id: `t-${t.id}`, label: t.title, group: "Sessions", hint: `${projects.find((p) => p.id === t.projectId)?.name ?? ""} · ${agentOf(t.agent, agents, providers).name}`, onSelect: () => openSession(t.id) });
    // Words inside messages: the query itself is a keyword, so a hit stays listed while you type on.
    for (const h of found) items.push({ id: `m-${h.threadId}`, label: h.snippet, group: "In messages", hint: h.title, icon: <I.comment size={15} />, keywords: [asked.toLowerCase()], onSelect: () => openSession(h.threadId) });
    for (const p of projects) items.push({ id: `p-${p.id}`, label: `New session in ${p.name}`, group: "Projects", icon: <I.folder size={15} />, onSelect: () => setView({ kind: "home", projectId: p.id }) });
    for (const a of agents) items.push({ id: `a-${a.id}`, label: `Edit ${a.name}`, group: "Team", onSelect: () => setAgentDialog({ open: true, agent: a }) });
    return items;
    // New session and New routine read where you are and your last project, so they're here too.
  }, [threads, projects, agents, providers, current, sidebar, view, lastProject, found, asked]);

  if (!ready)
    return (
      <div className="lc-boot" data-drag>
        <span className="lc-boot-wm">Liner Code</span>
        <span className="l-shimmer">{connected ? "Opening" : "Starting the engine"}</span>
      </div>
    );

  if (!onboarded)
    return (
      <>
        <Suspense fallback={null}>
          <Setup onDone={() => setView({ kind: "home" })} />
        </Suspense>
        <Toaster />
      </>
    );

  return (
    <div className="lc-app" data-sidebar={sidebar || settings || undefined}>
      <HiddenBrowsers />
      <Scene />
      {settings ? (
        <Suspense fallback={null}>
          <Settings onClose={() => setSettings(false)} onAgent={(agent) => setAgentDialog({ open: true, agent })} onOpen={(id) => (setSettings(false), openSession(id))} />
        </Suspense>
      ) : (
        <>
          <div className="lc-side" inert={!sidebar || undefined}>
            <Sidebar current={view.kind === "session" ? view.id : null} onOpen={(id) => openSession(id)} onNew={newSession} onUsage={() => setView({ kind: "usage" })} onSettings={() => setSettings(true)} onAgent={(agent) => setAgentDialog({ open: true, agent })} usageOn={view.kind === "usage"} onRoutines={() => setView({ kind: "routines" })} routinesOn={view.kind === "routines" || view.kind === "routine"} onSearch={() => setMenu(true)} onHide={() => setSidebar(false)} />
          </div>
          <main className="lc-paper" key={view.kind === "session" ? "s" : view.kind}>
            <Backdrop />
            <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening</span></div>}>
            {view.kind === "session" && current ? (
              <Session key={current.id} thread={current} sidebar={sidebar} onSidebar={() => setSidebar(true)} onNewAgent={() => setAgentDialog({ open: true })} onOpenSession={openSession} onRoutine={(id) => editRoutine(id, current.projectId)} />
            ) : view.kind === "routines" ? (
              <RoutinesPage sidebar={sidebar} onSidebar={() => setSidebar(true)} onNew={() => editRoutine()} onEdit={(id) => editRoutine(id)} onOpenRun={openRun} />
            ) : view.kind === "routine" ? (
              <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening the routine</span></div>}>
                <RoutineBuilder key={view.id ?? "new"} id={view.id} projectId={view.projectId} onClose={() => setView(view.back ?? { kind: "routines" })} onOpenRun={openRun} />
              </Suspense>
            ) : view.kind === "compare" ? (
              <Compare id={view.id} sidebar={sidebar} onSidebar={() => setSidebar(true)} onOpen={(id) => openSession(id)} onDone={(id) => openSession(id)} />
            ) : view.kind === "usage" ? (
              <Usage sidebar={sidebar} onSidebar={() => setSidebar(true)} />
            ) : (
              <Home
                projectId={view.kind === "home" ? (view.projectId ?? lastProject) : undefined}
                onProject={(id) => {
                  setLastProject(id);
                  setView({ kind: "home", projectId: id });
                }}
                onStarted={(id) => {
                  const t = threads.find((x) => x.id === id);
                  if (t) setLastProject(t.projectId);
                  openSession(id);
                }}
                onCompare={(id) => setView({ kind: "compare", id })}
                sidebar={sidebar}
                onSidebar={() => setSidebar(true)}
                onNewAgent={() => setAgentDialog({ open: true })}
              />
            )}
            </Suspense>
          </main>
        </>
      )}
      {!connected && (
        <div className="lc-offline" role="status">
          <span className="l-shimmer">Reconnecting to the engine</span>
        </div>
      )}
      <CommandMenu open={menu} onOpenChange={setMenu} items={commands} hotkey={null} placeholder="Search sessions, projects and commands" />
      <AgentDialog open={agentDialog.open} agent={agentDialog.agent} onClose={() => setAgentDialog({ open: false })} />
      <Toaster />
    </div>
  );
}
