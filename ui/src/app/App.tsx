/*
  Liner Code. The window is one glass frame holding the sidebar; the white paper inside it holds
  Home, a session or Usage. ⌘K reaches everything; the shell's menu bar sends the same commands.
*/
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { AgentProfile, RoutineRun } from "@contracts";
import { CommandMenu, type CommandItem } from "@liner/pro/command-menu/command-menu";
import { Toaster, toast } from "@liner/components/toast/toast";
import { AgentDialog } from "./AgentDialog";
import { Backdrop, Scene } from "./Backdrop";
import { bridge, onCommand } from "./bridge";
import { onNotify, onStream, rpc, startEngine, useEngine } from "./engine";
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
import { keepPanel, keptPanel, openTab, type Tab } from "./Surfaces";
import { startAgentBrowser } from "./agentBrowser";
import { MENU_COMMANDS, menuKeys, pressed, setBindings, shortcutOf } from "./keymap";

type View = { kind: "home"; projectId?: string } | { kind: "session"; id: string } | { kind: "usage" } | { kind: "routines" } | { kind: "routine"; id?: string; projectId?: string; back?: View } | { kind: "compare"; id: string };

const readView = (): View => {
  try {
    return JSON.parse(sessionStorage.getItem("lc:view") || "") as View;
  } catch {
    return { kind: "home" };
  }
};

export function App() {
  const ready = useEngine((s) => s.ready);
  const connected = useEngine((s) => s.connected);
  const onboarded = useEngine((s) => s.settings.onboarded);
  const notifyOn = useEngine((s) => s.settings.notify);
  const badgeOn = useEngine((s) => s.settings.badge);
  const threads = useEngine((s) => s.threads);
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
    else if (name.startsWith("open:")) openSession(name.slice(5));
  };
  useEffect(() => onCommand(run), [current, lastProject]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const name = pressed(e, MENU_COMMANDS);
      if (!name) return;
      e.preventDefault();
      run(name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, lastProject]);
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
      items.push(
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
          onSelect: () => void rpc("thread.remove", { id: current.id }).then(() => setView({ kind: "home" })),
        },
      );
    }
    for (const t of threads.filter((x) => !x.archived).slice(0, 200)) items.push({ id: `t-${t.id}`, label: t.title, group: "Sessions", hint: `${projects.find((p) => p.id === t.projectId)?.name ?? ""} · ${agentOf(t.agent, agents, providers).name}`, onSelect: () => openSession(t.id) });
    for (const p of projects) items.push({ id: `p-${p.id}`, label: `New session in ${p.name}`, group: "Projects", icon: <I.folder size={15} />, onSelect: () => setView({ kind: "home", projectId: p.id }) });
    for (const a of agents) items.push({ id: `a-${a.id}`, label: `Edit ${a.name}`, group: "Team", onSelect: () => setAgentDialog({ open: true, agent: a }) });
    return items;
  }, [threads, projects, agents, providers, current, sidebar]);

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
        <div className="lc-offline l-glass" role="status">
          <span className="l-shimmer">Reconnecting to the engine</span>
        </div>
      )}
      <CommandMenu open={menu} onOpenChange={setMenu} items={commands} hotkey={null} placeholder="Search sessions, projects and commands" />
      <AgentDialog open={agentDialog.open} agent={agentDialog.agent} onClose={() => setAgentDialog({ open: false })} />
      <Toaster />
    </div>
  );
}
