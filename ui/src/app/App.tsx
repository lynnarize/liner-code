/*
  Liner Code. The window is one ground: the sidebar beside Home, a session or Usage, with
  nothing drawn between them. ⌘K reaches everything; the shell's menu bar sends the same commands.
*/
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProfile, PanelPlace, RoutineRun, SessionMode, Thread } from "@contracts";
import { CREATE_ADDON_ASK, ROUTINES_ON } from "@contracts";
import { CommandMenu, type CommandItem } from "@liner/pro/command-menu/command-menu";
import { Toaster, toast } from "@liner/components/toast/toast";
import { Tips } from "./Tips";
import { Boundary } from "./Boundary";
import { Backdrop, Scene } from "./Backdrop";
import { bridge, onCommand } from "./bridge";
import { EngineAway, getState, onNotify, onStream, RpcError, rpc, startEngine, useEngine } from "./engine";
import { Home } from "./Home";
import { I } from "./icons";
import { ACCESS_LEVELS, agentOf, ago, markOf, threadModel, wallShown } from "./model";
import { markLabelOf, markStateOf } from "./session-state";
import { SideMark } from "./SideList";
import { Session, showAppTab, showBelow } from "./Session";
import { applyLook, entering, readLook } from "./look";
import { usePresence, useSteady } from "./ui";
import { MOTION } from "./motion";
import { needsYou, Sidebar } from "./Sidebar";
import { reviewHeld } from "./session-state";
import { early, lazyAgain } from "./early";
// The builder brings Liner's workflow canvas; it loads when you first edit a routine.
const RoutineBuilder = lazyAgain(() => import("./RoutineBuilder").then((m) => m.RoutineBuilder));
// Settings, Usage and the Wall load once the app has started and is idle (App, below): early.ts.
const SettingsScreen = early(() => import("./Settings").then((m) => m.Settings));
const UsageScreen = early(() => import("./Usage").then((m) => m.Usage));
const WallScreen = early(() => import("./Wall").then((m) => m.Wall));
const Settings = SettingsScreen.View;
// The Add-ons page and the agent dialog open now and then: they load at idle too, never with launch.
const AddonsScreen = early(() => import("./AddonsPage").then((m) => m.AddonsPage));
const AddonsPage = AddonsScreen.View;
const AgentScreen = early(() => import("./AgentDialog").then((m) => m.AgentDialog));
const AgentDialog = AgentScreen.View;
// The Add-ons page shows Settings › Add-ons' own list.
const Setup = lazyAgain(() => import("./Setup").then((m) => m.Setup));
const Usage = UsageScreen.View;
const Wall = WallScreen.View;
const RoutinesPage = lazyAgain(() => import("./Routines").then((m) => m.RoutinesPage));
const Compare = lazyAgain(() => import("./Compare").then((m) => m.Compare));
// Pull requests and Issues, from the sidebar's foot: they load the first time one is opened.
const PullRequests = lazyAgain(() => import("./PullRequests").then((m) => m.PullRequests));
const Issues = lazyAgain(() => import("./Issues").then((m) => m.Issues));
import { keepDock, keptDock, SURFACES, type SurfaceId, type Tab } from "./Surfaces";
import { openTab } from "./dock";
import { openSurface } from "./TopBar";
import { askPicker } from "./pr-pick";
import { AppPage } from "./Addon";
import { AppModelHost } from "./AppModel";
import { startAgentBrowser } from "./agentBrowser";
import { startDesigns } from "./Design";
import { HiddenBrowsers } from "./Browser";
import { is, matches, MENU_COMMANDS, menuKeys, pressed, setBindings, shortcutOf } from "./keymap";
import { currentTab, faceKept, getFace, HOME_TAB, openTab as openDesignTab, setFace, showTab, tabKey, toggleFace, useFace, useTabs } from "./face";
import { keptOnFaceChange } from "./face-pages";
import { keptRead, keptWrite, textRead, wordRead, wordWrite } from "./kept.ts";
// Liner Design's store and sidebar body load with the face, never for someone who stays in Code.
const DesignSide = lazyAgain(() => import("./design/Layers").then((m) => m.DesignSide));
// Liner Design's face: its tabs, Design Home and the canvas load the first time the window shows them.
const DesignShell = lazyAgain(() => import("./design/Shell").then((m) => m.DesignShell));
const OpenDesigns = lazyAgain(() => import("./design/Tabs").then((m) => m.OpenDesigns));
const DesignFiles = lazyAgain(() => import("./design/DesignHome").then((m) => m.DesignFiles));
/** Liner Design's session helpers, loaded only when the Design face is (or is about to be) up. */
const designSession = () => import("./design/session");
// Its first-open sheet, over whichever of the two shows.
// Liner Security's face and its sidebar body: loaded the first time the window shows Security, never for someone who doesn't.
const SecurityShell = lazyAgain(() => import("./security/Shell").then((m) => m.SecurityShell));
const SecuritySide = lazyAgain(() => import("./security/Side").then((m) => m.SecuritySide));
// The scans of pull requests and issues running in the background, bottom right, on every face.
const ScanDock = lazyAgain(() => import("./security/ScanDock").then((m) => m.ScanDock));
// An app outside Liner Code asking first, or signing in (Liner MCP), bottom right above the scans, on every face.
const AppAsk = lazyAgain(() => import("./AppAsk").then((m) => m.AppAsk));
const DesignIntro = lazyAgain(() => import("./design/Intro").then((m) => m.DesignIntro));
import * as os from "./os";
import { markUnread, stopShows, unreadRow } from "./row-menu";
import { anyModal, MODAL } from "./menu-keys";
import { toastRight } from "./toast-place";

/** `wall` on a session: opened from the Wall, so its header has the way back and Esc goes there. */
type View = { kind: "home"; projectId?: string; mode?: SessionMode; prompt?: { text: string; at: number } } | { kind: "addons" } | { kind: "session"; id: string; beside?: string; wall?: true } | { kind: "wall" } | { kind: "usage" } | { kind: "routines" } | { kind: "routine"; id?: string; projectId?: string; back?: View } | { kind: "compare"; id: string } | { kind: "app"; id: string; back?: View } | { kind: "prs"; pick?: string } | { kind: "issues" };

/** The same place: the same kind of screen, and the same session, app or comparison on it. */
const samePlace = (a: View, b: View) => a.kind === b.kind && ("id" in a ? a.id : undefined) === ("id" in b ? b.id : undefined);
/** A place as Back and Forward keep it: Home without the mode and words it opened with (Create add-on's), so going back doesn't start that again. */
const trailed = (v: View): View => (v.kind === "home" ? { kind: "home", projectId: v.projectId } : { ...v });

/** A kept place is trusted only for its outer kind, the words the View type names: a corrupted value starts at Home instead of passing its cast into the code. */
const VIEW_KINDS = ["home", "addons", "session", "wall", "usage", "routines", "routine", "compare", "app", "prs", "issues"];
const isView = (v: unknown): v is View => {
  const kind = typeof v === "object" && v !== null ? (v as { kind?: unknown }).kind : undefined;
  return typeof kind === "string" && VIEW_KINDS.includes(kind);
};
const readView = (): View => keptRead<View>(sessionStorage, "lc:view", { kind: "home" }, isView);

/*
  F6 and ⇧F6 move between the window's areas, T3 Code's workspace areas (docs/user/keyboard-focus.md):
  the sidebar, the thread, the composer and the panel, skipping any that's hidden or absent, and
  back to where you last were in each. A dialog that's open (⌘K) keeps the keyboard. Beside another
  session, the thread, the composer and the panel are the side you're in (`side`).
*/
const AREAS: { root: string; first: string[] }[] = [
  { root: ".lc-side:not([inert])", first: [".lc-sl-row[aria-current='page'] .lc-sl-pick", ".lc-sb-row[aria-current='page'] .lc-sb-pick", ".lc-sl-pick", ".lc-sb-pick", "button"] },
  { root: ".lc-thread .lc-scroll", first: [] },
  { root: ".lc-composer", first: ["textarea"] },
  { root: ".lc-panel", first: [".lc-surface:not([hidden]) textarea", ".lc-surface:not([hidden]) :is(input, select, button, [tabindex='0'])", "[role='tab'][aria-selected='true']"] },
  { root: ".ld-cv", first: ["[tabindex='0']", "button"] },
  { root: ".ld-dock", first: ["textarea", "button"] },
  { root: ".ld-insp", first: ["input", "select", "button"] },
  { root: ".ls-scroll", first: ["button", "input", "a"] },
  { root: ".lf-x", first: ["button", "input", "textarea"] },
];
const lastIn = new Map<number, HTMLElement>();
const shows = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && el.isConnected && el.checkVisibility();
const focusable = (el: Element | null | undefined): el is HTMLElement => shows(el) && el.tabIndex >= 0 && !el.matches(":disabled, [aria-disabled='true']") && !el.closest("[inert]");
const hasOpenModal = () => anyModal(document.querySelectorAll(MODAL));
const areaOf = (el: Element | null) => {
  if (!el) return -1;
  let best = -1;
  let bestEl: Element | null = null;
  for (let i = 0; i < AREAS.length; i++) {
    const m = el.closest(AREAS[i].root);
    if (m && (!bestEl || bestEl.contains(m))) {
      best = i;
      bestEl = m;
    }
  }
  return best;
};
function moveFocus(step: 1 | -1, side: ParentNode = document) {
  if (hasOpenModal()) return;
  const here = areaOf(document.activeElement);
  const from = here >= 0 ? here : step > 0 ? -1 : AREAS.length;
  for (let n = 1; n <= AREAS.length; n++) {
    const i = (from + step * n + AREAS.length * 2) % AREAS.length;
    const root = (i === 0 ? document : side).querySelector(AREAS[i].root);
    if (!shows(root)) continue;
    const kept = lastIn.get(i);
    const target = (focusable(kept) && root.contains(kept) && areaOf(kept) === i ? kept : undefined) ?? AREAS[i].first.map((q) => [...root.querySelectorAll(q)].find((el): el is HTMLElement => focusable(el) && areaOf(el) === i)).find(Boolean) ?? root;
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

/** The right edge of the chat column of a session whose panel is open, the rightmost of two beside each other; null when no panel shows. */
function columnRight() {
  const cols = [...document.querySelectorAll<HTMLElement>(".lc-session[data-panel] .lc-thread")];
  return cols.length ? Math.max(...cols.map((c) => c.getBoundingClientRect().right)) : null;
}
/** Keeps --lc-toast-right true (toast-place.ts): measured when a notice comes or goes, and when the window changes size. */
function useToastPlace() {
  useEffect(() => {
    const place = () => document.documentElement.style.setProperty("--lc-toast-right", `${toastRight(document.documentElement.clientWidth, columnRight())}px`);
    place();
    const off = toast.subscribe(place);
    window.addEventListener("resize", place);
    return () => {
      off();
      window.removeEventListener("resize", place);
    };
  }, []);
}

export function App() {
  useToastPlace();
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
  const [view, setViewNow] = useState<View>(readView);
  /*
    Where you have been in this window, for Back and Forward (the sidebar's head, as Claude Code and
    Devin have them). Going to another place, or another session, leaves the one you were on behind
    you; a change within a place (Home's project, a session opened beside) does not.
  */
  const trail = useRef<{ back: View[]; forward: View[]; left?: View }>({ back: [], forward: [] });
  const setView = useCallback((next: View | ((v: View) => View)) => {
    setViewNow((was) => {
      const v = typeof next === "function" ? next(was) : next;
      const t = trail.current;
      // The updater may run twice (StrictMode): the place is kept once.
      if (!samePlace(was, v) && t.left !== was) {
        t.left = was;
        t.back.push(trailed(was));
        if (t.back.length > 60) t.back.shift();
        t.forward = [];
      }
      return v;
    });
  }, []);
  // Back and Forward step over a session or a page that has gone since (deleted, removed elsewhere).
  const stillThere = (v: View) => {
    const s = getState();
    if (v.kind === "session") return s.threads.some((t) => t.id === v.id);
    if (v.kind === "app") return s.addons.some((a) => a.id === v.id && a.panel);
    if (v.kind === "compare") return s.threads.some((t) => t.compare?.id === v.id && !t.archived);
    if (v.kind === "routines") return ROUTINES_ON;
    if (v.kind === "routine") return ROUTINES_ON && (!v.id || s.routines.some((r) => r.id === v.id));
    return true;
  };
  const step = (from: View[], to: View[]) => {
    let v = from.pop();
    while (v && !stillThere(v)) v = from.pop();
    if (!v) return;
    to.push(trailed(view));
    setSettings(false);
    setViewNow(v);
  };
  const goBack = () => step(trail.current.back, trail.current.forward);
  const goForward = () => step(trail.current.forward, trail.current.back);
  /** A session put away or gone: no longer a place Back or Forward goes; beside another, the other stays. */
  const forget = (id: string) => {
    const t = trail.current;
    const keep = (list: View[]) => list.filter((v) => !(v.kind === "session" && v.id === id)).map((v) => (v.kind === "session" && v.beside === id ? { kind: "session" as const, id: v.id, wall: v.wall } : v));
    t.back = keep(t.back);
    t.forward = keep(t.forward);
  };
  // Liner Code or Liner Design: the same sessions under either, remembered per window.
  const face = useFace();
  const [sidebar, setSidebar] = useState(() => wordRead(localStorage, "lc:sidebar", ["0", "1"], "1") !== "0");
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [agentDialog, setAgentDialog] = useState<{ open: boolean; agent?: AgentProfile }>({ open: false });
  const agentEver = useRef(false);
  if (agentDialog.open) agentEver.current = true;
  const [lastProject, setLastProject] = useState<string | undefined>(() => textRead(localStorage, "lc:project", null) ?? undefined);

  useEffect(() => startAgentBrowser(), []);
  // Files dropped where nothing takes them (the composer, the canvas and the panel take theirs) do nothing: the window never navigates to them.
  useEffect(() => {
    const none = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", none);
    window.addEventListener("drop", none);
    return () => {
      window.removeEventListener("dragover", none);
      window.removeEventListener("drop", none);
    };
  }, []);
  // Settings, Usage and the Wall, fetched while nothing else is going on, a moment after the app is up.
  useEffect(() => {
    if (!ready) return;
    const idle = (fn: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 4000 }) : window.setTimeout(fn, 0));
    const t = window.setTimeout(() => idle(() => void Promise.all([SettingsScreen.fetch(), UsageScreen.fetch(), WallScreen.fetch(), AddonsScreen.fetch(), AgentScreen.fetch()]).catch(() => {})), 1500);
    return () => clearTimeout(t);
  }, [ready]);
  useEffect(() => startDesigns(), []);
  useEffect(() => {
    startEngine();
    applyLook(readLook());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => readLook().theme === "system" && applyLook(readLook());
    mq.addEventListener("change", follow);
    // Reduce transparency turned on or off: the see-through window goes solid or comes back (look.ts, lessGlass).
    const glass = matchMedia("(prefers-reduced-transparency: reduce)");
    const again = () => applyLook(readLook());
    glass.addEventListener("change", again);
    return () => {
      mq.removeEventListener("change", follow);
      glass.removeEventListener("change", again);
    };
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
  useEffect(() => keptWrite(sessionStorage, "lc:view", view), [view]);
  useEffect(() => wordWrite(localStorage, "lc:sidebar", sidebar ? "1" : "0"), [sidebar]);
  useEffect(() => {
    if (lastProject) wordWrite(localStorage, "lc:project", lastProject);
  }, [lastProject]);

  const current = view.kind === "session" ? threads.find((t) => t.id === view.id) : undefined;
  // The design tab Liner Design shows, and its project (for the sidebar's body).
  const designTabs = useTabs();
  const designTab = designTabs.list.find((t) => tabKey(t) === designTabs.at);
  const designProject = designTab ? projects.find((p) => p.id === designTab.projectId) : undefined;
  // The session open beside it, if any, and which side has your keys.
  const besideThread = view.kind === "session" && view.beside && view.beside !== view.id ? threads.find((t) => t.id === view.beside && !t.archived) : undefined;
  const [sideFocus, setSideFocus] = useState(0);
  // The active Security scan/fix thread, tracked via lc:face-nav so ⌘K's "This session" works in Security without eagerly loading security/store.
  const [secThreadId, setSecThreadId] = useState<string | undefined>(() => {
    const p = keptRead<{ kind?: string; threadId?: string } | null>(sessionStorage, "liner.security-page", null, (v): v is { kind?: string; threadId?: string } | null => v === null || (typeof v === "object" && v !== null));
    return p?.kind === "scan" && typeof p.threadId === "string" ? p.threadId : undefined;
  });
  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent<{ securityThreadId?: string }>).detail;
      if (detail && "securityThreadId" in detail) setSecThreadId(detail.securityThreadId);
      setView((v) => (keptOnFaceChange(v.kind) ? v : { kind: "home" }));
    };
    window.addEventListener("lc:face-nav", onNav);
    return () => window.removeEventListener("lc:face-nav", onNav);
  }, []);
  // The session your keys are in: the one open, or beside another the side you're in, or the active Design/Security session. ⌘K's "This session" is that one.
  const here =
    face === "security"
      ? (secThreadId ? threads.find((t) => t.id === secThreadId) : undefined)
      : face === "design"
        ? (designTab?.threadId ? threads.find((t) => t.id === designTab.threadId) : current)
        : besideThread && sideFocus === 1
          ? besideThread
          : current;
  // The two sides' boxes: F6 moves through the areas of the side you're in.
  const besides = useRef<HTMLDivElement>(null);
  // At Quick motion a view you open shows as it is, in its first frame (look.ts, entering): another
  // session, Home, the Wall, Usage, a page. Settings opens over them as a pop-up, so they stay as they are under it.
  const paper = useRef<HTMLElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const opened = `${face}:${view.kind}:${current?.id ?? ("id" in view ? view.id : "")}:${besideThread?.id ?? ""}`;
  useLayoutEffect(() => entering(paper.current), [opened, ready, onboarded]);
  useLayoutEffect(() => entering(side.current), [ready, onboarded]);
  const sideEl = () => (besideThread ? besides.current?.children[sideFocus] : undefined) ?? document;
  // A press or focus in a side gives it your keys. A menu or a Pop opened from a side is portaled out
  // of both (React still passes its events up through here): it leaves the keys where they are.
  const pickSide = (box: HTMLElement, target: EventTarget) => {
    const i = [...box.children].findIndex((c) => c.contains(target as Node));
    if (i >= 0) setSideFocus(i);
  };
  // A session that went away (removed elsewhere) hands back to the one beside it, or to Home, in its place: Back doesn't lead to it.
  useEffect(() => {
    if (!ready || view.kind !== "session" || current) return;
    forget(view.id);
    setViewNow(besideThread ? { kind: "session", id: besideThread.id } : { kind: "home" });
  }, [ready, view, current, besideThread]);
  /** A session put away (archived, deleted): beside another, that one stays on screen; alone, back to Home. Either way in its place, and Back and Forward forget it. */
  const leave = (id: string) => {
    forget(id);
    setViewNow((v) => {
      if (v.kind !== "session" || (v.id !== id && v.beside !== id)) return v;
      const other = v.id === id ? v.beside : v.id;
      return other && other !== id && getState().threads.some((t) => t.id === other && !t.archived) ? { kind: "session", id: other } : { kind: "home" };
    });
  };

  /*
    The two faces of the same work. Design from a session begun from a design (Thread.design) shows
    that design's tab; from another session, its folder's latest design file with that session, as
    before; from anywhere else, the tab Liner Design last showed. Code from a design's tab shows its
    session, made on the way if it has none yet; from Design Home, Liner Code's Home.
  */
  const lastFace = useRef(face);
  useEffect(() => bridge.setMenuFace(face), [face]);
  useEffect(() => {
    const was = lastFace.current;
    lastFace.current = face;
    if (was === face || !ready) return;
    // A page that belongs to no face (Add-ons, Usage, the Wall, an app) is left behind with the face it was opened from.
    if (!keptOnFaceChange(view.kind)) setView({ kind: "home" });
    // Liner Security has its own pages and sessions: going to it or leaving it makes nothing and opens nothing of Design's.
    if (face === "security" || was === "security") return;
    const s = getState();
    if (face === "design") {
      const t = view.kind === "session" ? s.threads.find((x) => x.id === (sideFocus === 1 && view.beside ? view.beside : view.id)) : undefined;
      if (!t) return;
      const tab = currentTab();
      if (tab && tab.projectId === t.projectId && (tab.threadId === t.id || tab.file === t.design?.file)) return;
      if (t.design) return openDesignTab({ projectId: t.projectId, file: t.design.file, threadId: t.id });
      const cwd = t.worktree?.path ?? s.projects.find((p) => p.id === t.projectId)?.path;
      if (!cwd) return;
      void rpc("canvas.list", { cwd }).then((files) => {
        const latest = [...files].sort((a, b) => b.updated - a.updated)[0];
        if (latest && getFace() === "design") openDesignTab({ projectId: t.projectId, file: latest.id, title: latest.title, threadId: t.id });
        else if (getFace() === "design") showTab(HOME_TAB);
      }, () => {});
      return;
    }
    const tab = currentTab();
    if (!tab) return void (view.kind === "session" && s.projects.find((p) => p.id === current?.projectId)?.kind === "design" && setView({ kind: "home" }));
    // Never create a phantom empty thread on a casual Design -> Code switch: open an existing session if one exists, else land on Code Home with the project preselected.
    void designSession()
      .then((m) => {
        if (getFace() !== "code") return;
        const existing = m.sessionOf(tab, getState().threads);
        if (existing) go({ kind: "session", id: existing.id });
        else {
          const proj = getState().projects.find((p) => p.id === tab.projectId);
          go({ kind: "home", projectId: proj && proj.kind !== "design" && !proj.demoFor ? proj.id : undefined });
        }
      })
      .catch((e: Error) => toast.error(e.message));
  }, [face]);
  // Code never shows a scan, fix or question about a finding (Thread.security): one left up when you came back from Security goes Home.
  useEffect(() => {
    if (face !== "code" || view.kind !== "session" || !ready) return;
    if (getState().threads.some((t) => t.id === view.id && t.security)) setView({ kind: "home" });
  }, [view.kind === "session" ? view.id : "", face, ready]);
  // Settings' "Liner opens in": a fresh start (not a reload of this window) opens in Liner Design, on Design Home, or in Liner Security.
  const openIn = useEngine((s) => s.settings.openIn);
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (!faceKept() && openIn === "design") {
      showTab(HOME_TAB);
      setFace("design");
    } else if (!faceKept() && openIn === "security") setFace("security");
  }, [ready]);

  // The Dock says how many sessions need you (needsYou: asking you something, or finished and not read); notifications say which, while you're elsewhere.
  // Pinned ones too, as the sidebar's Needs you lists them.
  const needs = threads.filter((t) => needsYou(t)).length;
  useEffect(() => bridge.badge(badgeOn ? needs : 0), [needs, badgeOn]);
  // The menu bar item says the same, with which sessions, while the window is out of sight.
  const menuBar = useEngine((s) => s.settings.menuBar !== false);
  const live = threads.filter((t) => !t.archived && !t.routine);
  const traySay = JSON.stringify({
    show: menuBar,
    working: live.filter((t) => t.status === "running" || t.agentsAtWork).map((t) => ({ id: t.id, title: t.title })),
    needs: live.filter((t) => needsYou(t)).map((t) => ({ id: t.id, title: t.title, waiting: t.status === "waiting" && !reviewHeld(t) })),
    // Every turn going, routines' and side chats' too: ⌘Q asks first while there are any.
    // Agents in the background count: quitting ends them.
    running: [...threads, ...sides].filter((t) => !t.archived && (t.status === "running" || t.agentsAtWork)).length,
    // Every session waiting on you, the same ones: ⌘Q asks first for those whose request still holds a turn open (the shell looks).
    asking: [...threads, ...sides].filter((t) => !t.archived && t.status === "waiting" && !reviewHeld(t) && !t.agentsAtWork).map((t) => t.id),
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

  // A session a rule settled says so, with an Undo. Its name is read as it comes, so the listener stays put.
  useEffect(
    () =>
      onStream((e) => {
        if (e.type !== "settled") return;
        const t = getState().threads.find((x) => x.id === e.threadId);
        toast(`Moved ${t?.title ?? "a session"} to Settled`, { description: e.reason, action: { label: "Undo", onClick: () => void rpc("thread.update", { id: e.threadId, done: false }) }, duration: 5000 });
      }),
    [],
  );

  // "Set up a way of working" in the composer opens Settings on that place.
  useEffect(() => {
    const on = (e: Event) => {
      wordWrite(sessionStorage, "lc:settings", String((e as CustomEvent).detail ?? "general"));
      setSettings(true);
    };
    window.addEventListener("lc:open-settings", on);
    return () => window.removeEventListener("lc:open-settings", on);
  }, []);
  // "Change on Home" in Settings, Appearance: Home, where the Behind Home panel opens as it comes (Dots.tsx).
  useEffect(() => {
    const on = () => {
      setSettings(false);
      if (getFace() !== "code") setFace("code");
      setView((v) => (v.kind === "home" ? v : { kind: "home" }));
    };
    window.addEventListener("lc:behind-home", on);
    return () => window.removeEventListener("lc:behind-home", on);
  }, []);

  /** Going somewhere from ⌘K, the menu bar or the keys: Settings would otherwise stay over the place you went to. */
  const go = (v: View) => {
    setSettings(false);
    // A session opened by id (a notification, ⌘K, the next one that needs you, the sidebar) goes to the face it belongs to,
    // every time: a scan, fix or question about a finding (Thread.security) to Liner Security's own session page, with its
    // lock; any other session, asked for while Security shows, to Code.
    if (v.kind === "session") {
      const t = getState().threads.find((x) => x.id === v.id);
      if (t?.security) {
        if (getFace() !== "security") setFace("security");
        void import("./security/store").then((m) => m.goSecurity({ kind: "scan", threadId: t.id }));
        return;
      }
      if (t && getFace() !== "code") setFace("code");
    }
    setView(v);
  };
  const openSession = (id: string, tab?: Tab) => {
    if (tab) keepDock(id, openTab(keptDock(id), tab));
    go({ kind: "session", id });
  };
  // An app made from an offer, opened on its page, and the session that made it ("Open it" on the offer), or
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
    // "Open in Liner Design" (the timeline's design card, the Design surface): the canvas, on that session's folder and design file.
    const inDesign = (e: Event) => {
      const d = (e as CustomEvent<{ threadId?: string; cwd?: string; file?: string }>).detail ?? {};
      // That design file in its tab, with that session; the face then has nothing more to find.
      const t = d.threadId ? getState().threads.find((x) => x.id === d.threadId) : undefined;
      if (t && d.file) openDesignTab({ projectId: t.projectId, file: d.file, threadId: t.id });
      if (d.threadId) openSession(d.threadId);
      setFace("design");
    };
    window.addEventListener("lc:open-app", app);
    // A chat card's agents pressed where no Code session of that thread shows (Liner Design, a side chat: Crew.tsx
    // agentsSurface): the session in Liner Code, with that surface in its panel.
    const surface = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; tab: Tab }>).detail;
      openSession(d.id, d.tab);
    };
    window.addEventListener("lc:open-session", session);
    window.addEventListener("lc:open-liner-design", inDesign);
    window.addEventListener("lc:show-surface", surface);
    return () => {
      window.removeEventListener("lc:open-app", app);
      window.removeEventListener("lc:open-session", session);
      window.removeEventListener("lc:open-liner-design", inDesign);
      window.removeEventListener("lc:show-surface", surface);
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
  // The message box's usage ring opens Usage and cost (UsageRing.tsx).
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const on = () => goRef.current({ kind: "usage" });
    window.addEventListener("lc:usage", on);
    return () => window.removeEventListener("lc:usage", on);
  }, []);
  // A session opened from the Wall: where it stands among the tiles the Wall showed, and the way back.
  const wallIds = wallShown.ids.filter((id) => threads.some((t) => t.id === id && !t.archived));
  const fromWall = view.kind === "session" && Boolean(view.wall) && !besideThread;
  const wallAt = fromWall && view.kind === "session" ? wallIds.indexOf(view.id) : -1;
  // One object while where it stands doesn't change, with callbacks that keep their identity: the session (memo) isn't redrawn for a new one.
  const wallBackTo = useSteady(() => go({ kind: "wall" }));
  const wallPrev = useSteady(() => openFromWall(wallIds[wallAt - 1]));
  const wallNext = useSteady(() => openFromWall(wallIds[wallAt + 1]));
  const hasPrev = wallAt > 0;
  const hasNext = wallAt >= 0 && wallAt < wallIds.length - 1;
  const wallStrip = useMemo(() => (fromWall ? { at: wallAt + 1, of: wallIds.length, onBack: wallBackTo, onPrev: hasPrev ? wallPrev : undefined, onNext: hasNext ? wallNext : undefined } : undefined), [fromWall, wallAt, wallIds.length, hasPrev, hasNext]);
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
  // Routines switched off (contracts, ROUTINES_ON): a run's session still opens, to read, without the run's tab.
  const openRun = (run: RoutineRun) => (!ROUTINES_ON ? run.threadId && openSession(run.threadId) : run.threadId ? openSession(run.threadId, `run:${run.id}`) : go({ kind: "routines" }));
  const editRoutine = (id?: string, projectId?: string) => go({ kind: "routine", id, projectId: projectId ?? (here?.projectId || lastProject), back: view.kind === "routine" ? undefined : view });
  const newSession = (projectId?: string) => {
    if (getFace() !== "code") setFace("code");
    go({ kind: "home", projectId: projectId ?? (here?.projectId || lastProject) });
  };
  const addProject = () => void bridge.pickFolder().then((p) => (p ? rpc("project.add", { path: p }).then((x) => go({ kind: "home", projectId: x.id })) : undefined)).catch((e: Error) => toast.error(e.message));
  // Create your add-on (the sidebar's Add-ons menu, the Add-ons page): a new task in Workshop, in the
  // project New session would pick (Scratch when there's none), with DeepSeek Harness's ask written in the
  // box and not sent, so you go on to say what it should be.
  const createAddon = async () => {
    try {
      const have = (id?: string) => (id && projects.some((p) => p.id === id && p.kind !== "design" && !p.demoFor) ? id : undefined);
      const projectId = have(here?.projectId) ?? have(lastProject) ?? projects.find((p) => p.agent !== "demo" && p.kind !== "design" && !p.demoFor)?.id ?? (await rpc("project.scratch", {})).id;
      setView({ kind: "home", projectId, mode: "creator", prompt: { text: CREATE_ADDON_ASK, at: Date.now() } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /** The rows as the active sidebar shows them, top to bottom: ⌘1 to ⌘9 and "next that needs you" go by it. */
  const sidebarRows = () => [...document.querySelectorAll<HTMLElement>(".lc-side [data-row]")];
  const sidebarOrder = () => sidebarRows().map((r) => r.dataset.row ?? "");
  // The next session that waits on you, down the sidebar from the one that's open, round to the top.
  const nextNeeds = () => {
    const order = sidebarOrder();
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    // From the side your keys are in, beside another session.
    const from = here ? rank(here.id) : -1;
    const needs = threads.filter((t) => t.id !== here?.id && needsYou(t)).sort((a, b) => rank(a.id) - rank(b.id));
    const next = needs.find((t) => rank(t.id) > from) ?? needs[0];
    if (next) {
      setSettings(false);
      openSession(next.id);
    } else toast(here && needsYou(here) ? "Nothing else needs you" : "Nothing needs you", { duration: 2500 });
  };
  /** Opens a surface in the open session's panel, or in its kept panel for when it opens; the Terminal, in its bottom panel. */
  const showSurface = (id: string, tab: SurfaceId) => {
    if (openSurface(id, tab)) return;
    if (tab === "terminal") (showBelow(id), openSession(id));
    // Linked pull requests is Pull request with its picker open, which it takes as it shows (pr-pick.ts).
    else if (tab === "linked") (askPicker(id), openSession(id, "pr"));
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
  /*
    What App hands a session, Settings and their panels, each with one identity for the window's life
    (useSteady: it calls the latest), so Session and Settings, which are memoised, redraw only for
    their own news. Each side of Open beside has its own, reading which session is on it as it's pressed.
  */
  const showSidebar = useCallback(() => setSidebar(true), []);
  const newAgent = useCallback(() => setAgentDialog({ open: true }), []);
  const closeSettings = useCallback(() => setSettings(false), []);
  const settingsLife = usePresence(settings, MOTION.sheetOut);
  const editAgent = useCallback((agent?: AgentProfile) => setAgentDialog({ open: true, agent }), []);
  const steadyOpen = useSteady(openSession);
  const openFromSettings = useSteady((id: string) => (setSettings(false), openSession(id)));
  const sideThread = (i: number) => (i === 0 ? current : besideThread);
  const routineAt = [useSteady((id?: string) => editRoutine(id, sideThread(0)?.projectId)), useSteady((id?: string) => editRoutine(id, sideThread(1)?.projectId))];
  const besideAt = [useSteady(() => pickBeside(0)), useSteady(() => pickBeside(1))];
  // Closing a side leaves the other one on screen alone.
  const closeAt = [useSteady(() => besideThread && setView({ kind: "session", id: besideThread.id })), useSteady(() => current && setView({ kind: "session", id: current.id }))];
  // Parts that read the state themselves: one element each for the window's life, so App's own redraws pass them by.
  const still = useMemo(() => ({ hidden: <HiddenBrowsers />, scene: <Scene />, backdrop: <Backdrop />, host: <AppModelHost /> }), []);
  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast(`Copied ${what}`, { description: text, duration: 2500 }),
      () => toast.error(`Couldn't copy ${what}`),
    );

  // Menu-bar commands from the shell, and the same commands from their keys.
  const run = (name: string) => {
    // Nothing of the window's while first run is up, or under a dialog that has the keyboard (⌘K toggles itself; a menu-bar item naming a session still opens it).
    if (!getState().settings.onboarded) return;
    if (hasOpenModal() && name !== "commands" && name !== "updates" && !name.startsWith("open:")) return;
    // ⌘N: a new design while Liner Design shows; Start a scan in Liner Security; in Liner Code, a new session as ever.
    if (name === "new") getFace() === "design" ? void designSession().then((m) => m.newDesign()).catch((e: Error) => toast.error(e.message)) : getFace() === "security" ? void import("./security/store").then((m) => m.goSecurity({ kind: "start" })) : newSession();
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
    else if (name.startsWith("open-path:")) {
      const target = name.slice(10).trim();
      // The shell asked first when the folder came in a link (desktop deeplink.ts, launchQuestion): Home opens on it.
      if (target) void rpc("project.add", { path: target }).then((p) => go({ kind: "home", projectId: p.id })).catch((e: Error) => toast.error(e.message));
    }
  };
  // The listeners stay; each press reaches what's current through the ref.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => onCommand((name) => runRef.current(name)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌥⌘E: Liner Code and Liner Design, the same session under either.
      if (is(e, "face") && getState().settings.onboarded && !hasOpenModal()) {
        e.preventDefault();
        return toggleFace();
      }
      const name = pressed(e, MENU_COMMANDS);
      if (name) {
        e.preventDefault();
        return runRef.current(name);
      }
      // ⌘1 to ⌘9 open the items down the sidebar, unless something inside (a model picker's ⌘1–9) took the press or an overlay has the keyboard.
      const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((k) => matches(e, `mod+${k}`));
      if (!n || e.defaultPrevented || hasOpenModal()) return;
      e.preventDefault();
      const row = sidebarRows()[n - 1];
      if (!row) return;
      if (row.dataset.designTab) showTab(row.dataset.designTab);
      else if (row.dataset.row) runRef.current(`open:${row.dataset.row}`);
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
      // A page of its own (Permissions) searches only its own items.
      setAsked(document.querySelector(".l-cmd__crumb") ? "" : el.value.trim());
    };
    // Heard as the event bubbles out, after the menu's own onChange. Caught on the way in (capture),
    // this set state before React's listener ran: App re-rendered in between, the field was put back
    // to the menu's old query, and every keystroke but the last was lost.
    document.addEventListener("input", on);
    return () => document.removeEventListener("input", on);
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

  /*
    Built while ⌘K is open (and kept as it was while it closes): shut, a session's news doesn't
    rebuild up to 200 rows nobody sees. `whileOpen` stands each input in for nothing while it's shut.
  */
  const lastCommands = useRef<CommandItem[]>([]);
  const whileOpen = <T,>(x: T) => (menu ? x : null);
  // A session among the results reads as its row does (SideList.tsx): the state mark in its model's colour, the title, then where it is and the time since it last did something. Who works on it is still found by its name.
  const sessionPick = (t: Thread) => {
    const ref = threadModel(t, agents, providers);
    const mark = markStateOf(t, { busy: t.status === "running" });
    return {
      label: t.title || "New session",
      icon: <SideMark state={mark} brand={ref ? markOf(ref) : undefined} label={markLabelOf(t, mark)} />,
      hint: [projects.find((p) => p.id === t.projectId)?.name, ago(t.updatedAt)].filter(Boolean).join(" · "),
      keywords: [agentOf(t.agent, agents, providers).name],
    };
  };
  const commands = useMemo<CommandItem[]>(() => {
    if (!menu) return lastCommands.current;
    const items: CommandItem[] = [
      { id: "new", label: "New session", group: "Actions", icon: <I.compose size={16} />, shortcut: shortcutOf("new"), onSelect: () => newSession() },
      { id: "next-needs", label: "Next session that needs you", group: "Actions", icon: <I.bell size={16} />, keywords: ["waiting", "jump"], shortcut: shortcutOf("next-needs"), onSelect: nextNeeds },
      { id: "wall", label: "The Wall", group: "Actions", icon: <I.wall size={16} />, keywords: ["every session", "all sessions", "grid", "overview"], shortcut: shortcutOf("wall"), onSelect: showWall },
      { id: "usage", label: "Usage and cost", group: "Actions", icon: <I.usage size={16} />, onSelect: () => go({ kind: "usage" }) },
      { id: "prs", label: "Pull requests", group: "Actions", icon: <I.pr size={16} />, keywords: ["pr", "review", "github", "merge"], onSelect: () => go({ kind: "prs" }) },
      { id: "issues", label: "Issues", group: "Actions", icon: <I.ring size={16} />, keywords: ["issue", "bug", "github", "linear"], onSelect: () => go({ kind: "issues" }) },
      // Direct face switch commands, with ⌥⌘E shown on the next face in cycle.
      ...(face !== "code" ? [{ id: "face-code", label: "Switch to Liner Code", group: "Actions", icon: <I.code size={16} />, keywords: ["code", "sessions", "face"], shortcut: face === "security" ? shortcutOf("face") : undefined, onSelect: () => setFace("code") }] : []),
      ...(face !== "design" ? [{ id: "face-design", label: "Switch to Liner Design", group: "Actions", icon: <I.edit size={16} />, keywords: ["design", "canvas", "face"], shortcut: face === "code" ? shortcutOf("face") : undefined, onSelect: () => setFace("design") }] : []),
      ...(face !== "security" ? [{ id: "face-security", label: "Switch to Liner Security", group: "Actions", icon: <I.shield size={16} />, keywords: ["security", "scan", "findings", "face"], shortcut: face === "design" ? shortcutOf("face") : undefined, onSelect: () => setFace("security") }] : []),
      ...(ROUTINES_ON
        ? [
            { id: "routines", label: "Routines", group: "Actions", icon: <I.routines size={16} />, keywords: ["automation", "schedule", "webhook"], onSelect: () => go({ kind: "routines" }) },
            { id: "routine-new", label: "New routine", group: "Actions", icon: <I.plus size={16} />, onSelect: () => editRoutine() },
          ]
        : []),
      { id: "settings", label: "Settings", group: "Actions", icon: <I.settings size={16} />, shortcut: shortcutOf("settings"), onSelect: () => setSettings(true) },
      { id: "sidebar", label: sidebar ? "Hide the sidebar" : "Show the sidebar", group: "Actions", icon: <I.sidebar size={16} />, shortcut: shortcutOf("sidebar"), onSelect: () => setSidebar((s) => !s) },
      { id: "agent", label: "New agent", group: "Actions", icon: <I.plus size={16} />, onSelect: () => setAgentDialog({ open: true }) },
      { id: "project", label: "Add a project", group: "Actions", icon: <I.folder size={16} />, onSelect: addProject },
    ];
    if (here) {
      const branch = here.worktree?.branch ?? projects.find((p) => p.id === here.projectId)?.branch;
      items.push(
        // The panel's surfaces, opened beside this session (T3 Code's palette lists them too).
        ...SURFACES.map((s) => ({ id: `surface-${s.id}`, label: s.id === "linked" ? "Pick a pull request in this project" : s.id === "session" ? "Show session details" : `Open ${s.label}`, group: "This session", icon: <s.icon size={16} />, shortcut: shortcutOf(`surface.${s.id}`), onSelect: () => showSurface(here.id, s.id) })),
        ...(branch ? [{ id: "copy-branch", label: "Copy branch name", group: "This session", hint: branch, icon: <I.branch size={16} />, onSelect: () => copy(branch, "the branch name") }] : []),
        { id: "copy-id", label: "Copy session id", group: "This session", hint: here.id, icon: <I.copy size={16} />, onSelect: () => copy(here.id, "the session id") },
        // A session's own rows in the words and order of its row menu in the sidebar (board RowMenu, row-menu.ts): Pin, Mark unread, Settle; Open beside, Export as Markdown; Stop it while it works, Archive.
        { id: "pin", label: here.pinned ? "Unpin" : "Pin", group: "This session", icon: <I.pin size={16} />, onSelect: () => void rpc("thread.update", { id: here.id, pinned: !here.pinned }) },
        { id: "unread", label: unreadRow(here).title, group: "This session", icon: <I.bell size={16} />, onSelect: () => (markUnread(here.id, unreadRow(here).unread), void rpc("thread.update", { id: here.id, unread: unreadRow(here).unread })) },
        { id: "settle", label: "Settle", group: "This session", keywords: ["done"], icon: <I.settle size={16} />, onSelect: () => void rpc("thread.update", { id: here.id, done: true, unread: false }) },
        { id: "beside", label: "Open beside", group: "This session", keywords: ["split", "two sessions"], icon: <I.split size={16} />, keepOpen: true, onSelect: () => setBesideOf(1) },
        {
          id: "export",
          label: "Export as Markdown",
          group: "This session",
          hint: "Saved in Downloads",
          icon: <I.download size={16} />,
          onSelect: () =>
            void rpc("thread.export", { id: here.id }).then(
              ({ path }) => toast.success("Saved as Markdown", { description: os.tilde(path), action: { label: "Show", onClick: () => bridge.reveal(path) } }),
              (e: Error) => toast.error(e.message),
            ),
        },
        ...(stopShows(here) ? [{ id: "stop", label: "Stop it", group: "This session", keywords: ["cancel", "interrupt", "stop this session"], icon: <I.stop size={16} />, onSelect: () => void rpc("thread.stop", { id: here.id }) }] : []),
        { id: "archive", label: "Archive", group: "This session", keywords: ["put away", "hide"], icon: <I.box size={16} />, onSelect: () => void rpc("thread.update", { id: here.id, archived: true }).then(() => leave(here.id)) },
        {
          id: "fork",
          label: "Fork it",
          group: "This session",
          icon: <I.fork size={16} />,
          onSelect: () => void rpc("thread.create", { projectId: here.projectId, forkOf: here.id }).then((t) => openSession(t.id)),
        },
        {
          id: "access",
          label: "Permissions",
          group: "This session",
          keywords: ["access", "what it may do"],
          icon: <I.lock size={16} />,
          items: ACCESS_LEVELS.map((l) => ({ id: `access-${l.id}`, label: l.label, hint: l.note, onSelect: () => void rpc("thread.update", { id: here.id, access: l.id }) })),
        },
        {
          id: "reveal",
          label: `Show the project in ${os.fileManager}`,
          group: "This session",
          icon: <I.folder size={16} />,
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
          icon: <I.terminal size={16} />,
          onSelect: () => {
            const p = projects.find((x) => x.id === here.projectId);
            if (p) bridge.openIn(here.worktree?.path ?? p.path, "terminal");
          },
        },
        {
          id: "delete",
          label: "Delete this session",
          group: "This session",
          icon: <I.trash size={16} />,
          // It can't be undone, so it asks first, on a page of its own; Enter alone keeps it.
          items: [
            { id: "delete-keep", label: "Keep it", icon: <I.close size={16} />, onSelect: () => {} },
            { id: "delete-archive", label: "Archive it instead", hint: "Out of the sidebar, back from Settings any time", icon: <I.box size={16} />, onSelect: () => void rpc("thread.update", { id: here.id, archived: true }).then(() => leave(here.id)) },
            {
              id: "delete-yes",
              label: `Delete “${here.title}” for good`,
              hint: here.worktree ? "Its worktree is kept if it has changes" : "Its timeline goes; your files stay",
              icon: <I.trash size={16} />,
              onSelect: () =>
                void rpc("thread.remove", { id: here.id })
                  .then(() => leave(here.id))
                  .catch((e: Error) => toast.error(e.message)),
            },
          ],
        },
      );
    }
    for (const t of threads.filter((x) => !x.archived && !x.security).slice(0, 200)) items.push({ id: `t-${t.id}`, ...sessionPick(t), group: "Sessions", onSelect: () => openSession(t.id) });
    for (const t of threads.filter((x) => !x.archived && x.security).slice(0, 50)) {
      const p = sessionPick(t);
      items.push({ id: `t-${t.id}`, ...p, hint: ["Security", p.hint].filter(Boolean).join(" · "), group: "Security sessions", onSelect: () => openSession(t.id) });
    }
    // Words inside messages: the query itself is a keyword, so a hit stays listed while you type on.
    for (const h of found) items.push({ id: `m-${h.threadId}`, label: h.snippet, group: "In messages", hint: h.title, icon: <I.comment size={16} />, keywords: [asked.toLowerCase()], onSelect: () => openSession(h.threadId) });
    for (const p of projects) if (p.kind !== "design" && !p.demoFor) items.push({ id: `p-${p.id}`, label: `New session in ${p.name}`, group: "Projects", icon: <I.folder size={16} />, onSelect: () => go({ kind: "home", projectId: p.id }) });
    for (const a of agents) items.push({ id: `a-${a.id}`, label: `Edit ${a.name}`, group: "Team", icon: <I.edit size={16} />, onSelect: () => setAgentDialog({ open: true, agent: a }) });
    lastCommands.current = items;
    return items;
    // New session and New routine read where you are and your last project, so they're here too.
  }, [menu, ...[threads, projects, agents, providers, current, here, sidebar, view, lastProject, found, asked, keysSeen, face].map(whileOpen)]);
  const besidePicks = useMemo<CommandItem[]>(
    () =>
      besideOf === null
        ? []
        : threads
            .filter((t) => !t.archived && !t.security && t.id !== current?.id && t.id !== besideThread?.id)
            .slice(0, 200)
            .map((t) => ({ id: `b-${t.id}`, ...sessionPick(t), group: "Open beside it", onSelect: () => openBeside(t.id, besideOf) })),
    [besideOf, threads, projects, agents, providers, current, besideThread, view],
  );

  if (!ready) return <Boot label={connected ? "Opening" : "Starting the engine"} />;

  if (!onboarded)
    return (
      <>
        <Boundary label="Setup" place="page">
          <Suspense fallback={<Boot label="Opening" still />}>
            <Setup onDone={() => setView({ kind: "home" })} />
          </Suspense>
        </Boundary>
        <Toaster className="lc-toaster" />
        <Tips />
      </>
    );

  return (
    <div className="lc-app" data-sidebar={sidebar || undefined}>
      {still.hidden}
      {still.scene}
      {/* The app stays under Settings, which opens over it as a pop-up (below); while it's open nothing under it takes the keyboard. */}
      {(
        <>
          <div ref={side} className="lc-side" inert={!sidebar || settings || undefined}>
            {/* Back and Forward walk Liner Code's places; Liner Design shows its own tabs over Home and a session alike, so there they rest. */}
            <Sidebar
              face={face}
              onFace={(f) => setFace(f)}
              // Recent's project: Home's, else the session's on screen, else the one you were last in.
              recentProject={view.kind === "home" ? (view.projectId ?? lastProject) : here?.projectId || lastProject}
              onCarryOn={(projectId, text) => go({ kind: "home", projectId, prompt: { text, at: Date.now() } })}
              faceBody={
                face === "security" ? (
                  <Boundary label="Liner Security" quiet>
                    <Suspense fallback={null}>
                      <SecuritySide />
                    </Suspense>
                  </Boundary>
                ) : face !== "design" ? undefined : (
                <>
                {/* Your places and the open designs first, as Code lists its sessions; then this design's lean, pages and layers, or every design on Design Home. */}
                <Boundary label="The open designs" quiet>
                  <Suspense fallback={null}>
                    <OpenDesigns />
                  </Suspense>
                </Boundary>
                {designTab && designProject ? (
                  <Boundary label="Layers" quiet>
                    <Suspense fallback={null}>
                      <DesignSide key={tabKey(designTab)} cwd={threads.find((t) => t.id === designTab.threadId && t.projectId === designProject.id)?.worktree?.path ?? designProject.path} />
                    </Suspense>
                  </Boundary>
                ) : (
                  <Boundary label="Designs" quiet>
                    <Suspense fallback={null}>
                      <DesignFiles />
                    </Suspense>
                  </Boundary>
                )}
                </>
                )
              }
              current={view.kind === "session" ? view.id : null} homeOn={view.kind === "home" && !settings} onBack={face === "code" && trail.current.back.some(stillThere) ? goBack : undefined} onForward={face === "code" && trail.current.forward.some(stillThere) ? goForward : undefined} onOpen={(id) => openSession(id)} onNew={newSession} onWall={showWall} wallOn={view.kind === "wall"} onSettings={() => setSettings(true)} onRoutines={() => setView({ kind: "routines" })} routinesOn={view.kind === "routines" || view.kind === "routine"} onSearch={() => (setBesideOf(null), setMenu(true))} onHide={() => setSidebar(false)} onApp={(id) => setView({ kind: "app", id, back: view.kind === "app" ? view.back : view })} appOn={view.kind === "app" ? view.id : null} onAddons={() => setView({ kind: "addons" })} addonsOn={view.kind === "addons"} onPullRequests={() => go({ kind: "prs" })} prsOn={view.kind === "prs" && !settings} onIssues={() => go({ kind: "issues" })} issuesOn={view.kind === "issues" && !settings} onPutAway={leave} onBeside={(id) => (view.kind === "session" && view.id !== id ? (setSideFocus(1), setView({ kind: "session", id: view.id, beside: id })) : openSession(id))} />
          </div>
          <main ref={paper} className="lc-paper" key={view.kind === "session" ? "s" : view.kind} inert={settings || undefined}>
            {still.backdrop}
            {/* A page or session whose code didn't load (or that broke) says so in its place, and the sidebar goes on; another page tries again. */}
            <Boundary label={view.kind === "session" ? "This session" : "This page"} quiet place="page" resetKey={`${face}:${view.kind}:${view.kind === "session" ? view.id : ""}`}>
            <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening</span></div>}>
            {face === "security" && (view.kind === "home" || view.kind === "session") ? (
              // Liner Security: its Overview, Findings, Projects, Start a scan, or a scan's session. A fault in it stays in it.
              <Boundary label="Liner Security">
                <SecurityShell sidebar={sidebar} onSidebar={showSidebar} />
              </Boundary>
            ) : face === "design" && (view.kind === "home" || view.kind === "session") ? (
              // Liner Design: its tabs, Design Home or a design on its canvas. A fault in it stays in it: the sidebar and the Code face go on working.
              <Boundary label="Liner Design">
                <DesignShell sidebar={sidebar} onSidebar={showSidebar} onNewAgent={newAgent} />
              </Boundary>
            ) : view.kind === "session" && current ? (
              besideThread ? (
                // Two sessions side by side (TasteCode's Open beside): each has its header, its composer and its panels; keys go to the one you're in.
                <div ref={besides} className="lc-besides" onFocusCapture={(e) => pickSide(e.currentTarget, e.target)} onPointerDownCapture={(e) => pickSide(e.currentTarget, e.target)}>
                  {[current, besideThread].map((t, i) => (
                    <div key={t.id} className="lc-beside">
                      <Session key={t.id} thread={t} sidebar={sidebar || i > 0} onSidebar={showSidebar} onNewAgent={newAgent} onOpenSession={steadyOpen} onRoutine={routineAt[i]} onBeside={besideAt[i]} keys={sideFocus === i} onCloseSide={closeAt[i]} />
                    </div>
                  ))}
                </div>
              ) : (
              <Session key={current.id} thread={current} sidebar={sidebar} onSidebar={showSidebar} onNewAgent={newAgent} onOpenSession={steadyOpen} onRoutine={routineAt[0]} onBeside={besideAt[0]} wall={wallStrip} />
              )
            ) : view.kind === "wall" ? (
              <Wall sidebar={sidebar} onSidebar={() => setSidebar(true)} onOpen={openFromWall} onBack={leaveWall} onNew={() => newSession()} />
            ) : ROUTINES_ON && view.kind === "routines" ? (
              <RoutinesPage sidebar={sidebar} onSidebar={() => setSidebar(true)} onNew={() => editRoutine()} onEdit={(id) => editRoutine(id)} onOpenRun={openRun} />
            ) : ROUTINES_ON && view.kind === "routine" ? (
              <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening the routine</span></div>}>
                <RoutineBuilder key={view.id ?? "new"} id={view.id} projectId={view.projectId} onClose={() => setView(view.back ?? { kind: "routines" })} onOpenRun={openRun} />
              </Suspense>
            ) : view.kind === "compare" ? (
              <Compare id={view.id} sidebar={sidebar} onSidebar={() => setSidebar(true)} onOpen={(id) => openSession(id)} onDone={(id) => openSession(id)} />
            ) : view.kind === "prs" ? (
              <PullRequests key={view.pick ?? ""} sidebar={sidebar} onSidebar={() => setSidebar(true)} pick={view.pick} />
            ) : view.kind === "issues" ? (
              <Issues sidebar={sidebar} onSidebar={() => setSidebar(true)} onPr={(projectId, number) => go({ kind: "prs", pick: `${projectId}#${number}` })} />
            ) : view.kind === "usage" ? (
              <Usage sidebar={sidebar} onSidebar={() => setSidebar(true)} />
            ) : view.kind === "addons" ? (
              <AddonsPage sidebar={sidebar} onSidebar={() => setSidebar(true)} onMake={() => void createAddon()} />
            ) : view.kind === "app" ? (
              <AppPage
                key={view.id}
                id={view.id}
                back={view.back?.kind === "session" ? (threads.find((t) => t.id === (view.back as { id: string }).id)?.title ?? "Back") : view.back?.kind === "wall" ? "The Wall" : view.back?.kind === "compare" ? "Comparison" : view.back?.kind === "usage" ? "Usage" : view.back?.kind === "routines" ? "Routines" : view.back?.kind === "addons" ? "Add-ons" : "Home"}
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
            </Boundary>
          </main>
          {face === "design" && (view.kind === "home" || (view.kind === "session" && current)) && (
            <Boundary label="Liner Design's introduction" shown={false}>
            <Suspense fallback={null}>
              <DesignIntro agent={view.kind === "session" && current ? agentOf((here ?? current).agent, agents, providers).name : undefined} />
            </Suspense>
            </Boundary>
          )}
        </>
      )}
      {settingsLife.mounted && (
        // Its own code loads apart (early.ts): one that didn't load says so over the window, with Try again and Close.
        // Shut, it stays for its fade (a dialog's 160ms, usePresence) and then goes.
        <Boundary label="Settings" quiet place="float" onClose={closeSettings}>
          <Suspense fallback={null}>
            <Settings onClose={closeSettings} onAgent={editAgent} onOpen={openFromSettings} closing={settingsLife.closing} />
          </Suspense>
        </Boundary>
      )}
      {!connected && (
        <div className="lc-offline" role="status">
          <span className="l-shimmer">Reconnecting to the engine</span>
        </div>
      )}
      <CommandMenu open={menu} onOpenChange={setMenu} items={besideOf === null ? commands : besidePicks} hotkey={null} placeholder={besideOf === null ? "Search sessions, projects and commands" : "Find a session to open beside it"} footer={<span className="lc-cmd-foot">Sessions, projects and commands</span>} />
      {/* Loaded the first time it opens (or at idle before), then kept, so it closes as it always has. */}
      {agentEver.current && (
        // Its code loads apart: one that didn't load says so over the window while it's asked for, never takes the window with it.
        <Boundary label="The agent dialog" quiet place="float" shown={agentDialog.open} onClose={() => setAgentDialog({ open: false })}>
          <Suspense fallback={null}>
            <AgentDialog open={agentDialog.open} agent={agentDialog.agent} onClose={() => setAgentDialog({ open: false })} />
          </Suspense>
        </Boundary>
      )}
      {still.host}
      <Boundary label="The scans in the background" quiet place="float">
        <Suspense fallback={null}>
          <ScanDock />
        </Suspense>
      </Boundary>
      <Boundary label="An app asking first" quiet place="float">
        <Suspense fallback={null}>
          <AppAsk />
        </Suspense>
      </Boundary>
      <Toaster className="lc-toaster" />
      <Tips />
    </div>
  );
}
