/*
  Liner Code. The window is one ground: the sidebar beside Home, a session or Usage, with
  nothing drawn between them. ⌘K reaches everything; the shell's menu bar sends the same commands.
*/
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AgentProfile, PanelPlace, RoutineRun, SessionMode } from "@contracts";
import { CREATE_ADDON_ASK } from "@contracts";
import { CommandMenu, type CommandItem } from "@liner/pro/command-menu/command-menu";
import { Toaster, toast } from "@liner/components/toast/toast";
import { AgentDialog } from "./AgentDialog";
import { Backdrop, Scene } from "./Backdrop";
import { bridge, onCommand } from "./bridge";
import { EngineAway, getState, onNotify, onStream, RpcError, rpc, startEngine, useEngine } from "./engine";
import { Home } from "./Home";
import { I } from "./icons";
import { ACCESS_LEVELS, agentOf, wallShown } from "./model";
import { Session, showAppTab, showBelow } from "./Session";
import { applyLook, readLook } from "./look";
import { Sidebar, waitsOnYou } from "./Sidebar";
// The builder brings Liner's workflow canvas; it loads when you first edit a routine.
const RoutineBuilder = lazy(() => import("./RoutineBuilder").then((m) => ({ default: m.RoutineBuilder })));
// Screens you open now and then load when you first do, so launch has less to read.
const Settings = lazy(() => import("./Settings").then((m) => ({ default: m.Settings })));
// The Add-ons page shows Settings › Add-ons' own list.
const Setup = lazy(() => import("./Setup").then((m) => ({ default: m.Setup })));
const Usage = lazy(() => import("./Usage").then((m) => ({ default: m.Usage })));
const Wall = lazy(() => import("./Wall").then((m) => ({ default: m.Wall })));
const RoutinesPage = lazy(() => import("./Routines").then((m) => ({ default: m.RoutinesPage })));
const Compare = lazy(() => import("./Compare").then((m) => ({ default: m.Compare })));
import { keepDock, keptDock, SURFACES, type SurfaceId, type Tab } from "./Surfaces";
import { openTab } from "./dock";
import { openSurface } from "./TopBar";
import { AppPage } from "./Addon";
import { AppModelHost } from "./AppModel";
import { AddonsPage } from "./AddonsPage";
import { startAgentBrowser } from "./agentBrowser";
import { startDesigns } from "./Design";
import { HiddenBrowsers } from "./Browser";
import { matches, MENU_COMMANDS, menuKeys, pressed, setBindings, shortcutOf } from "./keymap";
import * as os from "./os";

/** `wall` on a session: opened from the Wall, so its header has the way back and Esc goes there. */
type View = { kind: "home"; projectId?: string; mode?: SessionMode; prompt?: { text: string; at: number } } | { kind: "addons" } | { kind: "session"; id: string; beside?: string; wall?: true } | { kind: "wall" } | { kind: "usage" } | { kind: "routines" } | { kind: "routine"; id?: string; projectId?: string; back?: View } | { kind: "compare"; id: string } | { kind: "app"; id: string; back?: View };

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
  back to where you last were in each. A dialog that's open (⌘K) keeps the keyboard. Beside another
  session, the thread, the composer and the panel are the side you're in (`side`).
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
function moveFocus(step: 1 | -1, side: ParentNode = document) {
  if (document.querySelector("dialog[open]")) return;
  const here = areaOf(document.activeElement);
  const from = here >= 0 ? here : step > 0 ? -1 : AREAS.length;
  for (let n = 1; n <= AREAS.length; n++) {
    const i = (from + step * n + AREAS.length * 2) % AREAS.length;
    const root = (i === 0 ? document : side).querySelector(AREAS[i].root);
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

/** The name while the engine starts. `still`: it's already in focus, so it doesn't come in again. */
function Boot({ label, still }: { label: string; still?: boolean }) {
  return (
    <div className="lc-boot" data-drag>
      <span className="lc-boot-wm" data-still={still || undefined}>
        Liner Code
      </span>
      <span className="l-shimmer">{label}</span>
    </div>
  );
}

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
  useEffect(() => startDesigns(), []);
  useEffect(() => {
    startEngine();
    applyLook(readLook());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => readLook().theme === "system" && applyLook(readLook());
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);
  // A command with no catch of its own (Pin, Stop, a rename) says when the engine turned it down, rather than nothing happening.
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => {
      if (!(e.reason instanceof RpcError)) return;
      e.preventDefault();
      if (!(e.reason instanceof EngineAway)) toast.error(e.reason.message);
    };
    window.addEventListener("unhandledrejection", on);
    return () => window.removeEventListener("unhandledrejection", on);
  }, []);
  useEffect(() => sessionStorage.setItem("lc:view", JSON.stringify(view)), [view]);
  useEffect(() => localStorage.setItem("lc:sidebar", sidebar ? "1" : "0"), [sidebar]);
  useEffect(() => {
    if (lastProject) localStorage.setItem("lc:project", lastProject);
  }, [lastProject]);

  const current = view.kind === "session" ? threads.find((t) => t.id === view.id) : undefined;
  // The session open beside it, if any, and which side has your keys.
  const besideThread = view.kind === "session" && view.beside && view.beside !== view.id ? threads.find((t) => t.id === view.beside && !t.archived) : undefined;
  const [sideFocus, setSideFocus] = useState(0);
  // The session your keys are in: the one open, or beside another the side you're in. ⌘K's "This session" is that one.
  const here = besideThread && sideFocus === 1 ? besideThread : current;
  // The two sides' boxes: F6 moves through the areas of the side you're in.
  const besides = useRef<HTMLDivElement>(null);
  const sideEl = () => (besideThread ? besides.current?.children[sideFocus] : undefined) ?? document;
  // A press or focus in a side gives it your keys. A menu or a Pop opened from a side is portaled out
  // of both (React still passes its events up through here): it leaves the keys where they are.
  const pickSide = (box: HTMLElement, target: EventTarget) => {
    const i = [...box.children].findIndex((c) => c.contains(target as Node));
    if (i >= 0) setSideFocus(i);
  };
  // A session that went away (removed elsewhere) hands back to the one beside it, or to Home.
  useEffect(() => {
    if (ready && view.kind === "session" && !current) setView(besideThread ? { kind: "session", id: besideThread.id } : { kind: "home" });
  }, [ready, view, current, besideThread]);
  /** A session put away (archived, deleted): beside another, that one stays on screen; alone, back to Home. */
  const leave = (id: string) =>
    setView((v) => {
      if (v.kind !== "session" || (v.id !== id && v.beside !== id)) return v;
      const other = v.id === id ? v.beside : v.id;
      return other && other !== id && getState().threads.some((t) => t.id === other && !t.archived) ? { kind: "session", id: other } : { kind: "home" };
    });

  // The Dock says how many sessions need you; notifications say which, while you're elsewhere.
  // Pinned ones too, as the sidebar's Needs you lists them.
  const needs = threads.filter((t) => !t.archived && waitsOnYou(t) && t.turns > 0).length;
  useEffect(() => bridge.badge(badgeOn ? needs : 0), [needs, badgeOn]);
  // The menu bar item says the same, with which sessions, while the window is out of sight.
  const menuBar = useEngine((s) => s.settings.menuBar !== false);
  const live = threads.filter((t) => !t.archived && !t.routine && !t.trial);
  const traySay = JSON.stringify({
    show: menuBar,
    working: live.filter((t) => t.status === "running").map((t) => ({ id: t.id, title: t.title })),
    needs: live.filter((t) => waitsOnYou(t) && t.turns > 0).map((t) => ({ id: t.id, title: t.title, waiting: t.status === "waiting" })),
    // Every turn going, routines' and side chats' too: ⌘Q asks first while there are any.
    running: [...threads, ...sides].filter((t) => !t.archived && t.status === "running").length,
  });
  useEffect(() => bridge.status(JSON.parse(traySay)), [traySay]);
  useEffect(() => {
    const off = onNotify((e) => {
      // Either side of Open beside is on screen.
      const open = view.kind === "session" && (view.id === e.threadId || besideThread?.id === e.threadId) && document.hasFocus();
      if (open) return;
      if (notifyOn) bridge.notify(e.title, e.body, e.threadId);
      if (e.kind === "error" && document.hasFocus()) toast.error(e.title, { description: e.body });
    });
    return () => void off();
  }, [view, notifyOn, besideThread?.id]);

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

  /** Going somewhere from ⌘K, the menu bar or the keys: Settings would otherwise stay over the place you went to. */
  const go = (v: View) => {
    setSettings(false);
    setView(v);
  };
  const openSession = (id: string, tab?: Tab) => {
    if (tab) keepDock(id, openTab(keptDock(id), tab));
    go({ kind: "session", id });
  };
  // An app made from an offer, opened on its page, and the session that made it ("Watch it"), or
  // where a panel ran, with it up there (the Add-ons page's Retry).
  useEffect(() => {
    const app = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; place: string }>).detail;
      if (d.place !== "page") return;
      setSettings(false);
      setView((v) => ({ kind: "app", id: d.id, back: v.kind === "app" ? v.back : v }));
    };
    const session = (e: Event) => {
      const { id, panel } = (e as CustomEvent<{ id: string; panel?: { id: string; place: PanelPlace } }>).detail;
      if (panel?.place === "tab") showAppTab(id, panel.id);
      openSession(id, panel?.place === "dock" ? `app:${panel.id}` : undefined);
    };
    window.addEventListener("lc:open-app", app);
    window.addEventListener("lc:open-session", session);
    return () => {
      window.removeEventListener("lc:open-app", app);
      window.removeEventListener("lc:open-session", session);
    };
  }, []);
  /*
    The Wall, and back. Back is where you were before it: a session you opened from the Wall
    doesn't count, so stepping in and out of tiles still comes back to where you started.
  */
  const wallBack = useRef<View>({ kind: "home" });
  const showWall = () => {
    if (view.kind === "wall") return setSettings(false);
    if (!(view.kind === "session" && view.wall)) wallBack.current = view;
    go({ kind: "wall" });
  };
  const leaveWall = () => go(wallBack.current);
  const openFromWall = (id: string) => {
    wallShown.picked = id;
    go({ kind: "session", id, wall: true });
  };
  const wallRef = useRef(showWall);
  wallRef.current = showWall;
  useEffect(() => {
    const on = () => wallRef.current();
    window.addEventListener("lc:wall", on);
    return () => window.removeEventListener("lc:wall", on);
  }, []);
  // A session opened from the Wall: where it stands among the tiles the Wall showed, and the way back.
  const wallIds = wallShown.ids.filter((id) => threads.some((t) => t.id === id && !t.archived));
  const fromWall = view.kind === "session" && Boolean(view.wall) && !besideThread;
  const wallAt = fromWall && view.kind === "session" ? wallIds.indexOf(view.id) : -1;
  const wallStrip = fromWall
    ? {
        at: wallAt + 1,
        of: wallIds.length,
        onBack: () => go({ kind: "wall" }),
        onPrev: wallAt > 0 ? () => openFromWall(wallIds[wallAt - 1]) : undefined,
        onNext: wallAt >= 0 && wallAt < wallIds.length - 1 ? () => openFromWall(wallIds[wallAt + 1]) : undefined,
      }
    : undefined;
  /*
    There, Esc goes back to the Wall, unless something it was pressed in has a use for it (a field, a
    menu, a terminal). The composer is a field as the Wall's tiles have them: Esc stops a turn that's
    running (its Stop says so, and the way back's hint while one runs), else lets go of the field, and
    the next one goes back.
  */
  useEffect(() => {
    if (!fromWall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (document.querySelector("dialog[open], .lc-st-side")) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t instanceof HTMLTextAreaElement && t.closest(".lc-compose")) return void (e.preventDefault(), t.blur());
      if (t?.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], .xterm, [role='menu'], [role='listbox'], [role='dialog']")) return;
      e.preventDefault();
      setView({ kind: "wall" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fromWall]);
  const openRun = (run: RoutineRun) => (run.threadId ? openSession(run.threadId, `run:${run.id}`) : go({ kind: "routines" }));
  const editRoutine = (id?: string, projectId?: string) => go({ kind: "routine", id, projectId: projectId ?? (here?.projectId || lastProject), back: view.kind === "routine" ? undefined : view });
  const newSession = (projectId?: string) => {
    go({ kind: "home", projectId: projectId ?? (here?.projectId || lastProject) });
  };
  const addProject = () => void bridge.pickFolder().then((p) => (p ? rpc("project.add", { path: p }).then((x) => go({ kind: "home", projectId: x.id })) : undefined)).catch((e: Error) => toast.error(e.message));
  // Create your add-on (the sidebar's Add-ons menu, the Add-ons page): a new task in Workshop, in the
  // project New session would pick (Scratch when there's none), with DeepSeek Harness's ask written in the
  // box and not sent, so you go on to say what it should be.
  const createAddon = async () => {
    try {
      const have = (id?: string) => (id && projects.some((p) => p.id === id) ? id : undefined);
      const projectId = have(here?.projectId) ?? have(lastProject) ?? projects.find((p) => p.agent !== "demo")?.id ?? (await rpc("project.scratch", {})).id;
      setView({ kind: "home", projectId, mode: "creator", prompt: { text: CREATE_ADDON_ASK, at: Date.now() } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /** The sessions as the sidebar shows them, top to bottom: ⌘1 to ⌘9 and "next that needs you" go by it. A closed shelf's rows are still in the DOM (for its closing fold) but don't count; a hidden sidebar's do. */
  const sidebarOrder = () => [...document.querySelectorAll<HTMLElement>(".lc-side .lc-sb-row[data-row]")].filter((r) => !r.closest(".lc-fold[inert]")).map((r) => r.dataset.row ?? "");
  // The next session that waits on you, down the sidebar from the one that's open, round to the top.
  const nextNeeds = () => {
    const order = sidebarOrder();
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    // From the side your keys are in, beside another session.
    const from = here ? rank(here.id) : -1;
    const needs = threads.filter((t) => !t.archived && t.id !== here?.id && waitsOnYou(t) && t.turns > 0).sort((a, b) => rank(a.id) - rank(b.id));
    const next = needs.find((t) => rank(t.id) > from) ?? needs[0];
    if (next) {
      setSettings(false);
      openSession(next.id);
    } else toast(here && waitsOnYou(here) ? "Nothing else needs you" : "Nothing needs you", { duration: 2500 });
  };
  /** Opens a surface in the open session's panel, or in its kept panel for when it opens; the Terminal, in its bottom panel. */
  const showSurface = (id: string, tab: SurfaceId) => {
    if (openSurface(id, tab)) return;
    if (tab === "terminal") (showBelow(id), openSession(id));
    else openSession(id, tab);
  };
  /*
    The title's ··· "Open another session beside it": ⌘K, with the sessions to pick from. The one
    you pick takes the other side (the right, from a session alone), as the sidebar's Open beside does.
  */
  const [besideOf, setBesideOf] = useState<number | null>(null);
  const pickBeside = (side: number) => {
    setBesideOf(side);
    setMenu(true);
  };
  const openBeside = (id: string, side: number) => {
    if (view.kind !== "session") return openSession(id);
    const keep = side === 1 && besideThread ? besideThread.id : view.id;
    if (keep === id) return;
    setSideFocus(side === 1 ? 0 : 1);
    setView(side === 1 ? { kind: "session", id, beside: keep } : { kind: "session", id: keep, beside: id });
  };
  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast(`Copied ${what}`, { description: text, duration: 2500 }),
      () => toast.error(`Couldn't copy ${what}`),
    );

  // Menu-bar commands from the shell, and the same commands from their keys.
  const run = (name: string) => {
    // Nothing of the window's while first run is up, or under a dialog that has the keyboard (⌘K toggles itself; a menu-bar item naming a session still opens it).
    if (!getState().settings.onboarded) return;
    if (document.querySelector("dialog[open]") && name !== "commands" && name !== "updates" && !name.startsWith("open:")) return;
    if (name === "new") newSession();
    else if (name === "commands") {
      if (!menu) setBesideOf(null);
      setMenu(!menu);
    }
    else if (name === "settings") setSettings((o) => !o);
    else if (name === "updates") {
      window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "updates" }));
      void rpc("updates.check", {}).catch(() => {});
    }
    else if (name === "sidebar") setSidebar((s) => !s);
    else if (name === "usage") go({ kind: "usage" });
    else if (name === "wall") view.kind === "wall" && !settings ? leaveWall() : showWall();
    else if (name === "open-project") addProject();
    else if (name === "next-needs") nextNeeds();
    else if (name === "focus.next") moveFocus(1, sideEl());
    else if (name === "focus.prev") moveFocus(-1, sideEl());
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
      // ⌘1 to ⌘9 open the sessions down the sidebar, unless something inside (a model picker's ⌘1–9) took the press or a dialog (⌘K) has the keyboard.
      const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((k) => matches(e, `mod+${k}`));
      if (!n || e.defaultPrevented || document.querySelector("dialog[open]")) return;
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
  const [keysSeen, setKeysSeen] = useState(0);
  useEffect(() => {
    setBindings(keybindings);
    bridge.setMenuKeys(menuKeys());
    setKeysSeen((n) => n + 1);
  }, [JSON.stringify(keybindings ?? [])]);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      { id: "new", label: "New session", group: "Actions", icon: <I.compose size={15} />, shortcut: shortcutOf("new"), onSelect: () => newSession() },
      { id: "next-needs", label: "Next session that needs you", group: "Actions", icon: <I.bell size={15} />, keywords: ["waiting", "jump"], shortcut: shortcutOf("next-needs"), onSelect: nextNeeds },
      { id: "wall", label: "The Wall", group: "Actions", icon: <I.wall size={15} />, keywords: ["every session", "all sessions", "grid", "overview"], shortcut: shortcutOf("wall"), onSelect: showWall },
      { id: "usage", label: "Usage and cost", group: "Actions", icon: <I.usage size={15} />, onSelect: () => go({ kind: "usage" }) },
      { id: "routines", label: "Routines", group: "Actions", icon: <I.routines size={15} />, keywords: ["automation", "schedule", "webhook"], onSelect: () => go({ kind: "routines" }) },
      { id: "routine-new", label: "New routine", group: "Actions", icon: <I.plus size={15} />, onSelect: () => editRoutine() },
      { id: "settings", label: "Settings", group: "Actions", icon: <I.settings size={15} />, shortcut: shortcutOf("settings"), onSelect: () => setSettings(true) },
      { id: "sidebar", label: sidebar ? "Hide the sidebar" : "Show the sidebar", group: "Actions", icon: <I.sidebar size={15} />, shortcut: shortcutOf("sidebar"), onSelect: () => setSidebar((s) => !s) },
      { id: "agent", label: "New agent", group: "Actions", icon: <I.plus size={15} />, onSelect: () => setAgentDialog({ open: true }) },
      { id: "project", label: "Add a project", group: "Actions", icon: <I.folder size={15} />, onSelect: addProject },
    ];
    if (here) {
      const branch = here.worktree?.branch ?? projects.find((p) => p.id === here.projectId)?.branch;
      items.push(
        // The panel's surfaces, opened beside this session (T3 Code's palette lists them too).
        ...SURFACES.map((s) => ({ id: `surface-${s.id}`, label: `Open ${s.label}`, group: "This session", icon: <s.icon size={15} />, shortcut: shortcutOf(`surface.${s.id}`), onSelect: () => showSurface(here.id, s.id) })),
        ...(branch ? [{ id: "copy-branch", label: "Copy branch name", group: "This session", hint: branch, icon: <I.branch size={15} />, onSelect: () => copy(branch, "the branch name") }] : []),
        { id: "copy-id", label: "Copy session id", group: "This session", hint: here.id, onSelect: () => copy(here.id, "the session id") },
        { id: "stop", label: "Stop this session", group: "This session", keywords: ["cancel", "interrupt"], onSelect: () => void rpc("thread.stop", { id: here.id }) },
        { id: "pin", label: here.pinned ? "Unpin it" : "Pin it", group: "This session", onSelect: () => void rpc("thread.update", { id: here.id, pinned: !here.pinned }) },
        { id: "settle", label: "Settle it", group: "This session", onSelect: () => void rpc("thread.update", { id: here.id, done: true, unread: false }) },
        { id: "archive", label: "Archive it", group: "This session", keywords: ["put away", "hide"], onSelect: () => void rpc("thread.update", { id: here.id, archived: true }).then(() => leave(here.id)) },
        {
          id: "fork",
          label: "Fork it",
          group: "This session",
          icon: <I.fork size={15} />,
          onSelect: () => void rpc("thread.create", { projectId: here.projectId, forkOf: here.id }).then((t) => openSession(t.id)),
        },
        {
          id: "access",
          label: "Change what it may do",
          group: "This session",
          icon: <I.lock size={15} />,
          items: ACCESS_LEVELS.map((l) => ({ id: `access-${l.id}`, label: l.label, hint: l.note, onSelect: () => void rpc("thread.update", { id: here.id, access: l.id }) })),
        },
        {
          id: "reveal",
          label: `Show the project in ${os.fileManager}`,
          group: "This session",
          onSelect: () => {
            const p = projects.find((x) => x.id === here.projectId);
            if (p) bridge.openIn(here.worktree?.path ?? p.path, "finder");
          },
        },
        {
          id: "terminal",
          label: "Open a terminal here",
          group: "This session",
          hint: "In Terminal",
          icon: <I.terminal size={15} />,
          onSelect: () => {
            const p = projects.find((x) => x.id === here.projectId);
            if (p) bridge.openIn(here.worktree?.path ?? p.path, "terminal");
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
            { id: "delete-archive", label: "Archive it instead", hint: "Out of the sidebar, back from Settings any time", onSelect: () => void rpc("thread.update", { id: here.id, archived: true }).then(() => leave(here.id)) },
            {
              id: "delete-yes",
              label: `Delete “${here.title}” for good`,
              hint: here.worktree ? "Its worktree is kept if it has changes" : "Its timeline goes; your files stay",
              icon: <I.trash size={15} />,
              onSelect: () =>
                void rpc("thread.remove", { id: here.id })
                  .then(() => leave(here.id))
                  .catch((e: Error) => toast.error(e.message)),
            },
          ],
        },
      );
    }
    for (const t of threads.filter((x) => !x.archived).slice(0, 200)) items.push({ id: `t-${t.id}`, label: t.title, group: "Sessions", hint: `${projects.find((p) => p.id === t.projectId)?.name ?? ""} · ${agentOf(t.agent, agents, providers).name}`, onSelect: () => openSession(t.id) });
    // Words inside messages: the query itself is a keyword, so a hit stays listed while you type on.
    for (const h of found) items.push({ id: `m-${h.threadId}`, label: h.snippet, group: "In messages", hint: h.title, icon: <I.comment size={15} />, keywords: [asked.toLowerCase()], onSelect: () => openSession(h.threadId) });
    for (const p of projects) items.push({ id: `p-${p.id}`, label: `New session in ${p.name}`, group: "Projects", icon: <I.folder size={15} />, onSelect: () => go({ kind: "home", projectId: p.id }) });
    for (const a of agents) items.push({ id: `a-${a.id}`, label: `Edit ${a.name}`, group: "Team", onSelect: () => setAgentDialog({ open: true, agent: a }) });
    return items;
    // New session and New routine read where you are and your last project, so they're here too.
  }, [threads, projects, agents, providers, current, here, sidebar, view, lastProject, found, asked, keysSeen]);
  const besidePicks = useMemo<CommandItem[]>(
    () =>
      besideOf === null
        ? []
        : threads
            .filter((t) => !t.archived && t.id !== current?.id && t.id !== besideThread?.id)
            .slice(0, 200)
            .map((t) => ({ id: `b-${t.id}`, label: t.title, group: "Open beside it", hint: `${projects.find((p) => p.id === t.projectId)?.name ?? ""} · ${agentOf(t.agent, agents, providers).name}`, onSelect: () => openBeside(t.id, besideOf) })),
    [besideOf, threads, projects, agents, providers, current, besideThread, view],
  );

  if (!ready) return <Boot label={connected ? "Opening" : "Starting the engine"} />;

  if (!onboarded)
    return (
      <>
        <Suspense fallback={<Boot label="Opening" still />}>
          <Setup onDone={() => setView({ kind: "home" })} />
        </Suspense>
        <Toaster className="lc-toaster" />
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
            <Sidebar current={view.kind === "session" ? view.id : null} onOpen={(id) => openSession(id)} onNew={newSession} onWall={showWall} wallOn={view.kind === "wall"} onUsage={() => setView({ kind: "usage" })} onSettings={() => setSettings(true)} onAgent={(agent) => setAgentDialog({ open: true, agent })} usageOn={view.kind === "usage"} onRoutines={() => setView({ kind: "routines" })} routinesOn={view.kind === "routines" || view.kind === "routine"} onSearch={() => (setBesideOf(null), setMenu(true))} onHide={() => setSidebar(false)} onApp={(id) => setView({ kind: "app", id, back: view.kind === "app" ? view.back : view })} appOn={view.kind === "app" ? view.id : null} onAddons={() => setView({ kind: "addons" })} addonsOn={view.kind === "addons"} onCreateAddon={() => void createAddon()} onPutAway={leave} onBeside={(id) => (view.kind === "session" && view.id !== id ? (setSideFocus(1), setView({ kind: "session", id: view.id, beside: id })) : openSession(id))} />
          </div>
          <main className="lc-paper" key={view.kind === "session" ? "s" : view.kind}>
            <Backdrop />
            <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening</span></div>}>
            {view.kind === "session" && current ? (
              besideThread ? (
                // Two sessions side by side (TasteCode's Open beside): each has its header, its composer and its panels; keys go to the one you're in.
                <div ref={besides} className="lc-besides" onFocusCapture={(e) => pickSide(e.currentTarget, e.target)} onPointerDownCapture={(e) => pickSide(e.currentTarget, e.target)}>
                  {[current, besideThread].map((t, i) => (
                    <div key={t.id} className="lc-beside">
                      <Session key={t.id} thread={t} sidebar={sidebar || i > 0} onSidebar={() => setSidebar(true)} onNewAgent={() => setAgentDialog({ open: true })} onOpenSession={openSession} onRoutine={(id) => editRoutine(id, t.projectId)} onBeside={() => pickBeside(i)} keys={sideFocus === i} onCloseSide={() => setView({ kind: "session", id: i === 0 ? besideThread.id : current.id })} />
                    </div>
                  ))}
                </div>
              ) : (
              <Session key={current.id} thread={current} sidebar={sidebar} onSidebar={() => setSidebar(true)} onNewAgent={() => setAgentDialog({ open: true })} onOpenSession={openSession} onRoutine={(id) => editRoutine(id, current.projectId)} onBeside={() => pickBeside(0)} wall={wallStrip} />
              )
            ) : view.kind === "wall" ? (
              <Wall sidebar={sidebar} onSidebar={() => setSidebar(true)} onOpen={openFromWall} onBack={leaveWall} onNew={() => newSession()} />
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
            ) : view.kind === "addons" ? (
              <AddonsPage sidebar={sidebar} onSidebar={() => setSidebar(true)} onMake={() => void createAddon()} />
            ) : view.kind === "app" ? (
              <AppPage
                key={view.id}
                id={view.id}
                back={view.back?.kind === "session" ? (threads.find((t) => t.id === (view.back as { id: string }).id)?.title ?? "Back") : view.back?.kind === "usage" ? "Usage" : view.back?.kind === "routines" ? "Routines" : view.back?.kind === "addons" ? "Add-ons" : "Home"}
                onBack={() => setView(view.back ?? { kind: "home" })}
                sidebar={sidebar}
                onSidebar={() => setSidebar(true)}
              />
            ) : (
              <Home
                projectId={view.kind === "home" ? (view.projectId ?? lastProject) : undefined}
                onProject={(id) => {
                  setLastProject(id);
                  setView({ kind: "home", projectId: id });
                }}
                onStarted={(id) => {
                  // Read now: Home's start() holds the render it began in, before this session existed.
                  const t = getState().threads.find((x) => x.id === id);
                  if (t) setLastProject(t.projectId);
                  openSession(id);
                }}
                onCompare={(id) => setView({ kind: "compare", id })}
                startMode={view.kind === "home" ? view.mode : undefined}
                startPrompt={view.kind === "home" ? view.prompt : undefined}
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
      <CommandMenu open={menu} onOpenChange={setMenu} items={besideOf === null ? commands : besidePicks} hotkey={null} placeholder={besideOf === null ? "Search sessions, projects and commands" : "Find a session to open beside it"} />
      <AgentDialog open={agentDialog.open} agent={agentDialog.agent} onClose={() => setAgentDialog({ open: false })} />
      <AppModelHost />
      <Toaster className="lc-toaster" />
    </div>
  );
}
