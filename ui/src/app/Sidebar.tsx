/*
  The sidebar, in Liner 2.0: no colour but a session's state, no boxes, space between its parts.
  Its top row is as Claude Code's desktop app has it: the traffic lights' room, then Hide, Back and
  Forward together, the window's drag area, and at the far right how many sessions work and how
  many wait on you, a pill that opens The Wall (every face has this row). The name is at the foot,
  "Liner Code", "Liner Design" or "Liner Security", and it is the switch between the three. Under
  the top row New session, Search, The Wall and Add-ons with your apps. Then "Sessions", whose one
  menu holds what the list shows (By folder, the default, or By status, or one of the places a
  session is put away: Snoozed, Settled and Archive), Carry on, the sort, your groups and a new
  project. By folder: Pinned and your groups, then a folder for each project, what needs you first
  in it, a fork under the session it came from. By status: Pinned, Needs you, Working, your groups,
  Complete. Every row is two lines on the places' grid (SideList.tsx): how it stands in the mark
  column under their icons, the title on their text edge, and under it what the session is doing
  now or how it ended; a pull request's mark at its end. Carry on, from the menu, opens a panel
  beside the sidebar with the work begun elsewhere (changes not committed in the project you were
  last in, sessions in Claude Code and Codex not brought in yet). The list takes all the room down
  to the foot and dissolves where it runs on past an edge, so nothing draws a line.
  Pointing at a row shows Pin, Snooze and Settle in its end's place (P, S and D from the keyboard);
  resting on it brings a card beside the sidebar with the rest of its story. One plate marks the open session.
  ⌘-click picks rows and ⇧-click a run of them; with more than one picked, a bar settles, snoozes,
  archives or moves them all at once. Esc lets them go.
*/
import { Fragment, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { prefersReducedMotion } from "@liner/lib/spring";
import { createPortal } from "react-dom";
import type { AgentProfile, ProviderInfo, RecentSession, RoutineRun, Thread } from "@contracts";
import { bridge } from "./bridge";
import { isSubagent, itemsWhere, rpc, useEngine } from "./engine";
import { appIcon } from "./Addon";
import { I, ModelMark, N, type MarkKind } from "./icons";
import { agentOf, ago, bucketOf, clock, codeProjects, designWhere, markOf, modelLabel, money, onTheWall, plural, reviewHeld, since, type Bucket } from "./model";
import { ContextMenu, LimitRow, Num, PanelHead, Pop, Row, Sep, StatusMark } from "./ui";
import { SideCounts, SideFolder, SideHead, SideLabel, SideMark, SideRow, type SideState } from "./SideList";
import { asksYou, needsYou, sideStateOf, waitsOnYou } from "./session-state";
import { appNotice, updates } from "./Updates";
import { pairOf } from "./Crew";
import { agentState, ROUTINES_ON, updateModes } from "@contracts";
import { shortcutOf } from "./keymap";
import { FACE_NAME, type Face } from "./face";
import * as os from "./os";
import { toast } from "@liner/components/toast/toast";

type Props = {
  current: string | null;
  onOpen: (id: string) => void;
  onNew: (projectId?: string) => void;
  onUsage: () => void;
  onSettings: () => void;
  usageOn: boolean;
  onRoutines: () => void;
  routinesOn: boolean;
  /** The Wall: every session at once. */
  onWall?: () => void;
  wallOn?: boolean;
  onSearch: () => void;
  onHide: () => void;
  /** Home is on screen: New session is the lit row. */
  homeOn?: boolean;
  /** Back and Forward through where you have been in this window; absent when there is nowhere to go. */
  onBack?: () => void;
  onForward?: () => void;
  /** An app's page of its own (an add-on panel placed "page"), and the one on screen. */
  onApp?: (id: string) => void;
  appOn?: string | null;
  /** The Add-ons page: everything your agents made for Liner Code (DeepSeek Harness's Plugins entry). */
  onAddons?: () => void;
  addonsOn?: boolean;
  /** Opens a session beside the one on screen. */
  onBeside?: (id: string) => void;
  /** A session was archived from here: if it's on screen, the window moves off it. */
  onPutAway?: (id: string) => void;
  /** Liner Code, Liner Design or Liner Security: the switch under the name, the same in each. */
  face?: Face;
  onFace?: (face: Face) => void;
  /** In Design and Security, what the sidebar holds in place of the sessions (design/Layers.tsx, design/DesignHome.tsx, security/Side.tsx). */
  faceBody?: ReactNode;
  /** The project you were last in: Recent offers to carry on its work that isn't committed. */
  recentProject?: string;
  /** Home in a project with an ask written in its box and not sent (Recent's Continue uncommitted work). */
  onCarryOn?: (projectId: string, text: string) => void;
};

/** A command's keys, like "⌘O", or nothing when it has none. */
const keysOf = (id: string) => {
  const k = shortcutOf(id);
  return k ? os.keys(k) : undefined;
};

/** What the list shows: every project's sessions by folder or by how they stand, or a place they're put away in. */
type View = "folder" | "status" | "snoozed" | "settled" | "archive";
/** By folder: the one group every design on its own is listed under. */
const DESIGNS = "designs";
const VIEWS: Record<View, string> = { folder: "By folder", status: "By status", snoozed: "Snoozed", settled: "Settled", archive: "Archive" };
type Order = "activity" | "started";

/** A choice kept in localStorage, for how you like the list. */
function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && allowed.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // private window: the choice lasts until the window closes
    }
  };
  return [value, set] as const;
}

export { asksYou, needsYou, waitsOnYou };
/**
  How a row and its card show a session on its shelf: a pinned one that waits on you as Needs you
  (its dot, its words, its mark). T3 Code reads a row's state from the thread alone, its pin apart
  (sidebar/SidebarThreadRow.tsx, resolveSidebarThreadStatus).
*/
const standing = (t: Thread, shelf: Bucket, now = Date.now()): Bucket => (shelf === "pinned" && waitsOnYou(t, now) ? "needs" : shelf);

/** A list of ids kept in localStorage, for what you folded. */
function useFolded(key: string) {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      return [];
    }
  });
  const toggle = (id: string) =>
    setIds((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // private window: folds last until the window closes
      }
      return next;
    });
  return [ids, toggle] as const;
}

/** When a snooze ends: in an hour, tomorrow at nine, or Monday at nine. */
function snoozeTimes() {
  const now = new Date();
  const hour = new Date(now.getTime() + 3600000);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  const t = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return [
    { label: "In an hour", at: hour, note: t(hour) },
    { label: "Tomorrow morning", at: tomorrow, note: t(tomorrow) },
    { label: "Monday", at: monday, note: t(monday) },
  ];
}

export function Sidebar({ current, onOpen, onNew, onWall, wallOn, onUsage, onSettings, usageOn, onRoutines, routinesOn, onSearch, onHide, homeOn, onBack, onForward, onApp, appOn, onAddons, addonsOn, onBeside, onPutAway, face = "code", onFace, faceBody, recentProject, onCarryOn }: Props) {
  const addons = useEngine((s) => s.addons);
  const pages = addons.filter((a) => a.panel?.place === "page" && a.enabled && !a.removed);
  const limits = useEngine((s) => s.limits);
  const update = useEngine((s) => s.updates);
  const updateMode = useEngine((s) => updateModes(s.settings).app);
  // Liner Security's scans, fixes and questions about a finding are listed in its own sidebar (security/Side.tsx), not among Code's sessions.
  const everyThread = useEngine((s) => s.threads);
  const threads = useMemo(() => everyThread.filter((t) => !t.security), [everyThread]);
  const groups = useEngine((s) => s.groups);
  const routines = useEngine((s) => s.routines);
  const runs = useEngine((s) => s.runs);
  const [menu, setMenu] = useState<{ t: Thread; x: number; y: number } | null>(null);
  const [naming, setNaming] = useState<{ forThread?: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const projects = useEngine((s) => s.projects);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  // The agents at work in each working session ("Sonnet 5.5 + 3 agents"), from the sessions whose timeline is here; read as one line so a streamed word redraws nothing.
  const sentLine = useEngine((s) =>
    s.threads
      .filter((t) => t.status === "running" || t.agentsAtWork)
      .map((t) => `${t.id}=${Math.max(itemsWhere(s, t.id, isSubagent).filter((x) => x.kind === "tool" && agentState(x) === "running").length, t.agentsAtWork ?? 0)}`)
      .join(","),
  );
  const sent = useMemo(() => new Map(sentLine.split(",").filter(Boolean).map((x) => [x.split("=")[0], Number(x.split("=")[1])] as const)), [sentLine]);
  // A new key since the list's rebuild (lc:sb-view, which held All projects, is no longer read): everyone starts on By folder.
  const [view, setView] = useStored<View>("lc:sb-list", "folder", ["folder", "status", "snoozed", "settled", "archive"]);
  const [order, setOrder] = useStored<Order>("lc:sb-order", "activity", ["activity", "started"]);
  const [shutProjects, toggleProject] = useFolded("lc:sb-shut");
  const [shutForks, toggleForks] = useFolded("lc:sb-shut-forks");
  // Which edges the list runs on past, for the blur that dissolves it there.
  const [edges, setEdges] = useState({ up: false, down: false });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [plate, setPlate] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Rows drawn before: drawn again (in another place) they skip their entry fade, as does one first drawn already open (SessionRow and app.css, data-fresh).
  const seenRows = useRef(new Set<string>());
  // What the list draws, top to bottom, as this render builds it (rows, labels, folders): the plate and the rows' glide measure again only when it changes.
  const drawn: string[] = [];
  // What a row does, reached through one ref so the rows (memoised) take no new callbacks: each press reads what's current (set after the list is built, below).
  const ctl = useRef<RowCtl>(null as unknown as RowCtl);
  // Rows picked for one action on them all, and where a ⇧-click's run starts (T3 Code: threadSelectionStore.ts).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  /*
    Six taps on the name at the foot within a few seconds show the Demo, or hide it again (the
    head carried the name before; the "Liner" span keeps its class, lc-brand, for whoever looks
    for it). The name is also the Code and Design switch, so each tap opens or shuts its menu:
    six leave it shut, and if the sixth opened it after all, it shuts again, uncounted.
  */
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  const taps = useRef<number[]>([]);
  const ownTap = useRef(false);
  const tapMe = (e: React.MouseEvent) => {
    // Clicks in the menu come through React's tree too (it's a portal): only the name counts.
    const name = (e.target as HTMLElement).closest<HTMLElement>(".lc-sb-name");
    if (!name || ownTap.current) return;
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length < 6) return;
    taps.current = [];
    // Its open state is read before this tap's own toggle is drawn: shut then means this tap opened it.
    if (name instanceof HTMLButtonElement && !name.hasAttribute("data-open"))
      window.setTimeout(() => {
        ownTap.current = true;
        name.click();
        ownTap.current = false;
      });
    void rpc("settings.save", { showDemo: !showDemo });
    toast(showDemo ? "The Demo is hidden" : "The Demo is on", { description: showDemo ? "Bring it back in Settings › General, or tap Liner at the sidebar's foot six times." : "Demo run is in Who works on this, and the sample project on Home." });
  };

  // Times and snoozes move on their own.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  // Latest activity first, or the newest session first.
  const newest = (a: Thread, b: Thread) => (order === "started" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  const list = useMemo(() => threads.filter((t) => !t.archived).sort(newest), [threads, order]);
  const archivedList = useMemo(() => threads.filter((t) => t.archived).sort(newest), [threads, order]);

  const place = (t: Thread): Bucket => bucketOf(t, now);
  const working = everyThread.filter((t) => !t.archived && t.status === "running").length;
  // Routines handed back to you wait on their icon as a dot; otherwise its tip says how many run.
  const handed = runs.filter((r) => r.status === "handed" && !r.test).length;
  const routinesNote = handed ? `${handed} waiting` : routines.length ? `${routines.filter((r) => r.on).length} on` : "";
  /*
    Needs you, in this panel, is needsYou (above), as the Dock counts it: one asking you something, or
    finished and not read. bucketOf (Settle the project) also counts one not started; here that is
    under Complete, with its own words.
  */
  const needs = (t: Thread) => needsYou(t, now);
  // Working, in this panel: its turn runs, or agents it sent still work and it doesn't need you. One answered while you were away whose agents still work is working; it reads as answered once they're done. The rows, By status, a folded folder, a folder's order and the pill all take this one test.
  const works = (t: Thread) => t.status === "running" || (!asksYou(t) && Boolean(t.agentsAtWork));
  // The top row's counts: the sessions on The Wall that work (as it sorts them: a turn running, or agents it sent still at work) and those that need you.
  // Liner Security's too: The Wall, the Dock and the tray count them.
  const onWallNow = everyThread.filter((t) => onTheWall(t, now));
  const wallWaits = onWallNow.filter(needs).length;
  const wallWorking = onWallNow.filter(works);
  const machine = window.__LINER__?.machine ?? "This computer";
  const addProject = () =>
    void bridge.pickFolder().then((p) =>
      p
        ? rpc("project.add", { path: p }).then(
            (x) => onNew(x.id),
            (e: Error) => toast.error(e.message),
          )
        : undefined,
    );
  // A session in one of your groups sits there until it's snoozed or settled.
  const inGroup = (t: Thread, b: Bucket) => Boolean(t.group && groups.some((g) => g.id === t.group) && b !== "settled" && b !== "snoozed");
  const byBucket = useMemo(() => {
    const m: Record<Bucket, Thread[]> = { pinned: [], needs: [], working: [], open: [], snoozed: [], settled: [] };
    for (const t of list) {
      const b = place(t);
      if (!inGroup(t, b)) m[b].push(t);
    }
    return m;
  }, [list, now, groups]);
  const byGroup = useMemo(() => groups.map((g) => ({ g, list: list.filter((t) => t.group === g.id && inGroup(t, place(t))) })), [groups, list, now]);

  // Project > session > its forks: every session that isn't pinned, in a group, snoozed or
  // settled, under its project in your projects' order; in each, what needs you first, then
  // what works, then the rest in the sort you picked. A fork sits under the session it came from
  // while that one is here too, in the order they were made.
  const tree = useMemo(() => {
    const rank = (t: Thread) => (needs(t) ? 0 : works(t) ? 1 : 2);
    const here = [...byBucket.needs, ...byBucket.working, ...byBucket.open].sort((a, b) => rank(a) - rank(b) || newest(a, b));
    const ids = new Set(here.map((t) => t.id));
    const forks = new Map<string, Thread[]>();
    for (const t of [...here].sort((a, b) => a.createdAt - b.createdAt)) if (t.forkOf && ids.has(t.forkOf)) forks.set(t.forkOf, [...(forks.get(t.forkOf) ?? []), t]);
    const top = here.filter((t) => !(t.forkOf && ids.has(t.forkOf)));
    const known = new Set(projects.map((p) => p.id));
    // Designs on their own (Project.kind "design") are one group, "Designs", never a project each, and never Scratch.
    const designs = new Set(projects.filter((p) => p.kind === "design").map((p) => p.id));
    const inSection = (id: string) => (t: Thread) => (id === DESIGNS ? designs.has(t.projectId) : id ? t.projectId === id : !known.has(t.projectId));
    const sections = [...projects.filter((p) => p.kind !== "design" && !p.demoFor).map((p) => ({ id: p.id, name: p.name })), { id: DESIGNS, name: "Designs" }, { id: "", name: "No project" }]
      .map((x) => ({ ...x, list: top.filter(inSection(x.id)), all: here.filter(inSection(x.id)) }))
      .filter((x) => x.list.length > 0)
      // What a folded folder says: how many it holds, whether one needs you, and the first that works (its spinner is in that one's tint).
      .map(({ all, ...x }) => ({ ...x, ids: all.map((t) => t.id), count: all.length, needs: all.filter(needs).length, working: all.find(works) }));
    return { sections, forks };
  }, [byBucket, projects, order, now]);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const look = () => {
      const up = sc.scrollTop > 2;
      const down = sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2;
      setEdges((e) => (e.up === up && e.down === down ? e : { up, down }));
    };
    look();
    sc.addEventListener("scroll", look, { passive: true });
    const ro = new ResizeObserver(look);
    ro.observe(sc);
    ro.observe(sc.firstElementChild as HTMLElement);
    return () => {
      sc.removeEventListener("scroll", look);
      ro.disconnect();
    };
    // Again when the list comes back from Design's body.
  }, [Boolean(faceBody)]);

  const act = async (t: Thread, what: "pin" | "settle" | "snooze" | "wake", at?: Date) => {
    const settled = bucketOf(t, now) === "settled";
    // A snooze for a time, or waking it now, ends one that waited on a pull request (else that one still wakes it, and the row reads it).
    const patch =
      what === "pin" ? { pinned: !t.pinned } : what === "settle" ? { done: !settled, unread: false, pinned: false } : what === "snooze" ? { snoozedUntil: at!.getTime(), wake: null } : { snoozedUntil: null, wake: null };
    const before = { pinned: t.pinned ?? false, done: t.done ?? false, snoozedUntil: t.snoozedUntil ?? null, unread: t.unread ?? false, wake: t.wake ?? null };
    await rpc("thread.update", { id: t.id, ...patch });
    const where = what === "pin" ? (t.pinned ? "out of Pinned" : "to Pinned") : what === "settle" ? (settled ? "back to its project" : "to Settled") : what === "snooze" ? `to Snoozed, until ${at!.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "back";
    toast(`Moved ${t.title} ${where}`, { action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, ...before }) }, duration: 5000 });
  };

  const moveTo = async (t: Thread, groupId: string | null) => {
    const before = t.group ?? null;
    await rpc("thread.update", { id: t.id, group: groupId });
    const name = groupId ? groups.find((g) => g.id === groupId)?.name : null;
    toast(name ? `Moved ${t.title} to ${name}` : `Took ${t.title} out of its group`, { action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, group: before }) }, duration: 5000 });
  };
  const wake = async (t: Thread, kind: "checks" | "reply") => {
    if (!t.pr) return;
    const before = { wake: t.wake ?? null, snoozedUntil: t.snoozedUntil ?? null };
    await rpc("thread.update", { id: t.id, wake: { kind, pr: t.pr.number }, snoozedUntil: Date.now() + 30 * 86400000 });
    toast(`Moved ${t.title} to Snoozed`, { description: kind === "checks" ? `Back when the checks on #${t.pr.number} finish` : `Back when someone replies on #${t.pr.number}`, action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, ...before }) }, duration: 5000 });
  };
  const newGroup = async (name: string, forThread?: string) => {
    const id = `g${Date.now().toString(36)}`;
    await rpc("groups.save", { groups: [...groups, { id, name }] });
    if (forThread) await rpc("thread.update", { id: forThread, group: id });
  };
  const dropTo = async (id: string, target: string) => {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    // A drop puts it there: one already there stays (act() toggles, a drag doesn't).
    if (target === "pinned") return t.pinned ? undefined : act(t, "pin");
    if (target === "settled") return place(t) === "settled" ? undefined : act(t, "settle");
    if (target === "snoozed") return place(t) === "snoozed" ? undefined : act(t, "snooze", snoozeTimes()[0].at);
    if (target === "ungroup") return t.group ? moveTo(t, null) : undefined;
    if (target.startsWith("group:")) return t.group === target.slice(6) ? undefined : moveTo(t, target.slice(6));
  };
  const drop = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/x-liner-session")) return;
      e.preventDefault();
      setDropOn(target);
    },
    onDragLeave: () => setDropOn((d) => (d === target ? null : d)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData("text/x-liner-session");
      setDropOn(null);
      if (id) void dropTo(id, target);
    },
    "data-drop": dropOn === target || undefined,
  });

  /* ---------- Picking several rows (T3 Code: Sidebar.tsx's handleThreadClick, threadSelectionStore.ts) ---------- */

  // Only sessions still in the list count: one archived elsewhere leaves the pick.
  const pickedThreads = useMemo(() => threads.filter((t) => picked.has(t.id) && !t.archived), [threads, picked]);
  const clearPicked = () => {
    setPicked((p) => (p.size ? new Set() : p));
    setAnchor(null);
  };
  const togglePick = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    setAnchor(next.has(id) ? id : anchor);
  };
  /** ⇧-click: every row on screen from the anchor (or the open session) to this one, in the order they show. */
  const pickRun = (id: string) => {
    // A shelf folded away still holds its rows, out of sight: they aren't in the run.
    const order = [...(nav.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].filter((el) => !el.closest("[inert]")).map((el) => el.dataset.row ?? "");
    const from = anchor ?? current;
    const a = from ? order.indexOf(from) : -1;
    const b = order.indexOf(id);
    const next = new Set(picked);
    if (a < 0 || b < 0) next.add(id);
    else for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
    setPicked(next);
    setAnchor(a < 0 ? id : from);
  };
  useEffect(() => {
    if (!picked.size) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      // A menu closing on Escape has had it already.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      clearPicked();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked.size]);

  /** One change for every picked session, with one Undo that puts each back as it was. */
  const bulk = async (what: string, patch: Omit<Parameters<typeof rpc<"thread.update">>[1], "id">, note?: string) => {
    const ts = pickedThreads;
    if (!ts.length) return;
    const before = ts.map((t) => ({ id: t.id, pinned: t.pinned ?? false, done: t.done ?? false, snoozedUntil: t.snoozedUntil ?? null, unread: t.unread ?? false, archived: t.archived ?? false, group: t.group ?? null, wake: t.wake ?? null }));
    clearPicked();
    try {
      await Promise.all(ts.map((t) => rpc("thread.update", { id: t.id, ...patch })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    if (patch.archived) for (const t of ts) onPutAway?.(t.id);
    toast(`${what} ${plural(ts.length, "session")}`, { description: note, action: { label: "Undo", onClick: () => void Promise.all(before.map((b) => rpc("thread.update", b))) }, duration: 5000 });
  };

  const archive = async (t: Thread) => {
    await rpc("thread.update", { id: t.id, archived: true });
    onPutAway?.(t.id);
    toast(`Archived ${t.title}`, { action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, archived: false }) } });
  };
  /** Out of Archive, back where it stood before. */
  const unarchive = async (t: Thread) => {
    await rpc("thread.update", { id: t.id, archived: false });
    toast(`Brought ${t.title} back`, { description: "Out of Archive, back in the list.", action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, archived: true }) } });
  };

  /**
    Settles a whole project: every finished session under its header goes to Settled at once, with
    one Undo. Sessions still at work, and those waiting on you (an approval, a question, a plan, an
    answer you haven't read: whatever Needs you holds), stay where they are; settled, they'd leave
    Needs you and the Dock's count. With none left, the project leaves the list until it has a
    session again (T3 Code's auto-settle passes over a pending request too: ThreadSettlementService.ts).
  */
  const settleProject = async (projectId: string, name: string) => {
    const known = new Set(projects.map((p) => p.id));
    const designs = new Set(projects.filter((p) => p.kind === "design").map((p) => p.id));
    const mine = [...byBucket.needs, ...byBucket.working, ...byBucket.open].filter((t) => (projectId === DESIGNS ? designs.has(t.projectId) : projectId ? t.projectId === projectId : !known.has(t.projectId)));
    const go = mine.filter((t) => place(t) === "open");
    const busy = mine.filter((t) => place(t) === "working").length;
    const waiting = mine.length - go.length - busy;
    const stay = [busy ? `${plural(busy, "session")} still working` : "", waiting ? `${busy ? waiting : plural(waiting, "session")} waiting on you` : ""].filter(Boolean).join(" and ");
    const still = stay ? `${stay} ${busy + waiting === 1 ? "stays" : "stay"} in the list.` : undefined;
    if (!go.length) return void toast(`Nothing to settle in ${name}`, { description: still });
    const before = go.map((t) => ({ id: t.id, done: t.done ?? false, unread: t.unread ?? false, pinned: t.pinned ?? false }));
    try {
      await Promise.all(go.map((t) => rpc("thread.update", { id: t.id, done: true, unread: false, pinned: false })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    toast(`Settled ${plural(go.length, "session")} in ${name}`, { description: still ?? "It comes back to the list with its next session.", action: { label: "Undo", onClick: () => void Promise.all(before.map((b) => rpc("thread.update", b))) }, duration: 6000 });
  };
  const [projMenu, setProjMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);

  const rowKeys = (e: KeyboardEvent, t: Thread) => {
    // ⌘, ⌃ and ⌥ keys are the app's (⌘⇧D opens Changes), not Pin, Snooze or Settle.
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    // An archived session isn't pinned, snoozed or settled: it comes back first.
    if (t.archived && e.key.length === 1) return;
    if (e.key === "p" || e.key === "P") void act(t, "pin");
    else if (e.key === "d" || e.key === "D") void act(t, "settle");
    else if (e.key === "s" || e.key === "S") void act(t, "snooze", snoozeTimes()[0].at);
    else if (e.key === "F2") setRenaming(t.id);
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ t, x: r.left + 24, y: r.bottom });
    }
    // ↑ and ↓ are SideRow's, as in every face's list, folder headers included (SideList.tsx, listArrows).
    else return;
    e.preventDefault();
  };

  /* ---------- The card a row shows when the pointer rests on it ---------- */

  const [card, setCard] = useState<{ id: string; el: HTMLElement } | null>(null);
  const showing = useRef(false);
  showing.current = card !== null;
  const cardTimer = useRef(0);
  const leaveTimer = useRef(0);
  // Nothing floats over a row while you rename, pick several, or have a menu open (a drag hides it as it starts).
  const busy = useRef(false);
  busy.current = renaming !== null || pickedThreads.length > 0 || menu !== null;
  const blocked = () => busy.current || document.querySelector(".lc-pop-panel") !== null;
  const hideCard = () => {
    window.clearTimeout(cardTimer.current);
    window.clearTimeout(leaveTimer.current);
    setCard(null);
  };
  const pointAt = (id: string, el: HTMLElement) => {
    window.clearTimeout(cardTimer.current);
    window.clearTimeout(leaveTimer.current);
    if (blocked()) return;
    const show = () => !blocked() && el.isConnected && setCard({ id, el });
    // Once one shows, the next row's comes at once, as the pointer runs down the list.
    if (showing.current) show();
    else cardTimer.current = window.setTimeout(show, 450);
  };
  // A moment's grace, so crossing the gap to the next row doesn't drop the card.
  const leaveRow = () => {
    window.clearTimeout(cardTimer.current);
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setCard(null), 80);
  };
  useEffect(() => {
    if (renaming !== null || picked.size > 0 || menu) hideCard();
  }, [renaming, picked.size, menu]);
  useEffect(
    () => () => {
      window.clearTimeout(cardTimer.current);
      window.clearTimeout(leaveTimer.current);
    },
    [],
  );
  // It goes on a click, a key's Escape, the list scrolling, or the window losing focus.
  useEffect(() => {
    if (!card) return;
    const off = () => hideCard();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && off();
    const sb = nav.current;
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", off, true);
    window.addEventListener("blur", off);
    sb?.addEventListener("scroll", off, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", off, true);
      window.removeEventListener("blur", off);
      sb?.removeEventListener("scroll", off, true);
    };
  }, [card !== null]);

  /** The card's contents: the title, where it is, then how it stands, who works, where, what changed, and the keys. */
  const cardBody = (t: Thread) => {
    const bucket = standing(t, place(t), now);
    const project = projects.find((p) => p.id === t.projectId);
    const branch = t.worktree?.branch ?? project?.branch;
    const on = onIt(t, agents, providers);
    const coder = agentOf(t.agent, agents, providers);
    const ref = t.model ?? coder.model;
    const model = modelLabel(ref, providers);
    // "Opus 5.5 + Sol" for a pair; "Forge on Sonnet 5.5"; a model on its own is named once.
    const team = on.pair ? `${on.pair.name}: ${on.pair.lead} leads, ${on.pair.side} works` : coder.name === model ? model : `${coder.name} on ${model}`;
    const run = t.routine ? runs.find((r) => r.id === t.routine!.run) : undefined;
    // A pair's sidekick is in its name already; the agents besides it are counted.
    const sentNow = Math.max(0, (sent.get(t.id) ?? 0) - (on.pair ? 1 : 0));
    const said = cardState(t, bucket, on.who, now, run);
    const state = sentNow ? { ...said, text: `${said.text} with ${plural(sentNow, "agent")}` } : said;
    const changes = [(t.toReview ?? 0) > 0 ? `${plural(t.toReview!, "file")} changed, not committed` : "", t.pr ? `pull request #${t.pr.number}${t.pr.state ? `, ${t.pr.state.toLowerCase()}` : ""}` : ""].filter(Boolean).join(" · ");
    const u = t.usage;
    const ctx = u?.contextTokens && u.contextWindow ? Math.round((u.contextTokens / u.contextWindow) * 100) : null;
    const last = [`Last move ${agoLong(t.updatedAt, now)}`, ctx !== null ? `${ctx}% of context` : "", u?.costUsd ? money(u.costUsd) : ""].filter(Boolean).join(" · ");
    // ⌘1 to ⌘9 go down the sidebar as it shows (App's sidebarOrder).
    const n = [...document.querySelectorAll<HTMLElement>(".lc-side .lc-sb-row[data-row]")].findIndex((r) => r.dataset.row === t.id) + 1;
    return (
      <>
        <p className="lc-sbc-title">{t.title}</p>
        <p className="lc-sbc-where">
          <ProjectBadge name={project?.name ?? "No project"} none={!project} design={Boolean(t.design)} />
          <span className="lc-sbc-pj">{t.design ? designWhere(t, projects) : (project?.name ?? "No project")}</span>
          {branch && (
            <>
              <span className="lc-sbc-dot">·</span>
              <span className="lc-sbc-branch">
                <I.branch size={12} />
                <span>{branch}</span>
              </span>
            </>
          )}
        </p>
        <div className="lc-sbc-facts">
          <span className="lc-sbc-i">
            <StatusMark t={t} bucket={bucket} brand={markOf(on.ref)} />
          </span>
          <span data-tone={state.tone}>{state.text}</span>
          <span className="lc-sbc-i">
            <ModelMark kind={markOf(ref)} size={14} />
          </span>
          <span>{team}</span>
          <span className="lc-sbc-i">
            <I.laptop size={14} />
          </span>
          <span>
            {machine} · {t.worktree ? "in its own worktree" : "in the project folder"}
          </span>
          {changes && (
            <>
              <span className="lc-sbc-i">{(t.toReview ?? 0) > 0 ? <I.changes size={14} /> : <I.pr size={14} />}</span>
              <span>{changes}</span>
            </>
          )}
          <span className="lc-sbc-i">
            <I.clock size={14} />
          </span>
          <span>{last}</span>
        </div>
        <p className="lc-sbc-keys">
          <span>
            <kbd>P</kbd> {t.pinned ? "unpin" : "pin"}
          </span>
          <span>
            <kbd>S</kbd> snooze
          </span>
          <span>
            <kbd>D</kbd> {bucket === "settled" ? "bring back" : "settle"}
          </span>
          {n > 0 && n <= 9 && (
            <span className="lc-sbc-open">
              <kbd>{os.keys(`mod+${n}`)}</kbd> open
            </span>
          )}
        </p>
      </>
    );
  };

  /** A session's row (SessionRow, below the sidebar), with what it needs from here. */
  const row = (t: Thread, shelf: Bucket, forks?: { n: number; open: boolean }) => {
    drawn.push(t.id);
    return (
      <SessionRow
        key={t.id}
        t={t}
        shelf={shelf}
        now={now}
        agents={agents}
        providers={providers}
        run={t.routine ? runs.find((r) => r.id === t.routine!.run) : undefined}
        working={sent.get(t.id) ?? 0}
        current={t.id === current}
        renaming={renaming === t.id}
        picked={picked.has(t.id)}
        picking={picked.size > 0}
        described={card?.id === t.id}
        forks={forks?.n}
        forksOpen={forks?.open}
        seen={seenRows.current}
        ctl={ctl}
      />
    );
  };

  /** A session with its forks under it, and theirs under them. */
  const branch = (t: Thread): ReactNode => {
    const kids = tree.forks.get(t.id) ?? [];
    const shut = shutForks.includes(t.id);
    return (
      <Fragment key={t.id}>
        {row(t, place(t), kids.length ? { n: kids.length, open: !shut } : undefined)}
        {kids.length > 0 && !shut && <div className="lc-sb-kids">{kids.map(branch)}</div>}
      </Fragment>
    );
  };

  /** A labelled run of rows, with how many there are (Pinned's with its pin). `bare` is the rows alone, still named for a screen reader. */
  const block = (name: string, ts: Thread[], extra: { pin?: boolean; bucket?: Bucket; bare?: boolean } = {}) =>
    ts.length > 0 && drawn.push(`§${name}`) > 0 && (
      <section key={name} className="lc-sb-sec" aria-label={name} {...(extra.pin ? drop("pinned") : {})}>
        {!extra.bare && <SideLabel name={name} count={ts.length} icon={extra.pin ? <I.pin size={12} /> : undefined} />}
        {ts.map((t) => row(t, extra.bucket ?? place(t)))}
      </section>
    );
  const groupBlocks = () =>
    byGroup.map(({ g, list: ts }) => (drawn.push(`§${g.id}:${ts.length ? "" : "empty"}`),
      <section key={g.id} className="lc-sb-sec" aria-label={g.name} {...drop(`group:${g.id}`)}>
        <SideLabel name={g.name} count={ts.length} />
        {ts.length ? ts.map((t) => row(t, place(t))) : <p className="lc-sb-hint">Drag a session here, or right-click one.</p>}
      </section>
    ));
  /** A list with nothing in it says what's missing, and how to fill it. */
  const none = (icon: ReactNode, what: string, how: string) => (
    <div className="lc-sb-none">
      {icon}
      <b>{what}</b>
      <span>{how}</span>
    </div>
  );
  const listed: Record<View, number> = {
    folder: byBucket.pinned.length + byGroup.length + tree.sections.length,
    status: byBucket.pinned.length + byGroup.length + byBucket.needs.length + byBucket.working.length + byBucket.open.length,
    snoozed: byBucket.snoozed.length,
    settled: byBucket.settled.length,
    archive: archivedList.length,
  };
  const empty =
    listed[view] > 0
      ? null
      : view === "snoozed"
          ? none(<I.snooze size={20} />, "Nothing snoozed", "Snooze a session from its row (S), and it comes back by itself.")
          : view === "settled"
            ? none(<I.settle size={20} />, "Nothing settled", "Settle a finished session from its row (D) to put it out of the way.")
            : view === "archive"
              ? none(<I.box size={20} />, "Nothing archived", "Archive a session from its right-click menu. It waits here until you bring it back.")
              : list.length === 0
                ? none(<I.compose size={20} />, "No sessions yet", "Start one with New session, and it shows up here.")
                : none(<I.settle size={20} />, "Nothing open", "Every session is snoozed or settled. Pick either from the menu above.");
  // Carry on's count, for its row in the menu (CarryOn knows it before its panel opens), and the way to open that panel.
  const [carryCount, setCarryCount] = useState(0);
  const carryOpen = useRef<(() => void) | null>(null);
  const putAway = view === "snoozed" ? byBucket.snoozed.length : view === "settled" ? byBucket.settled.length : view === "archive" ? archivedList.length : undefined;
  const wallBrand = wallWorking[0] ? markOf(onIt(wallWorking[0], agents, providers).ref) : undefined;

  const out = (
    <nav ref={nav} className="lc-sb" aria-label="Sessions">
      {/* As Claude Code's desktop app has it: Hide, Back and Forward together after the lights, the drag area, and at the far right what works and what waits on you, which opens The Wall. The name is at the foot. */}
      <div className="lc-sb-head" data-drag>
        <button type="button" className="lc-ib lc-sb-hb l-focus" aria-label="Hide the sidebar" title="Hide the sidebar" onClick={onHide}>
          <N.sidebar />
        </button>
        <button type="button" className="lc-ib lc-sb-hb l-focus" aria-label="Back" title="Back" disabled={!onBack} onClick={onBack}>
          <N.back />
        </button>
        <button type="button" className="lc-ib lc-sb-hb l-focus" aria-label="Forward" title="Forward" disabled={!onForward} onClick={onForward}>
          <N.forward />
        </button>
        <span className="lc-grow" data-drag />
        {onWall && <SideCounts working={wallWorking.length} waiting={wallWaits} brand={wallBrand} onOpen={onWall} />}
      </div>

      {faceBody ? (
        <div className="lc-sb-design" data-face={face}>{faceBody}</div>
      ) : (
      <>
      {/* Your places, one row each: New session (search at its end), Routines and Add-ons. */}
      <div className="lc-sb-top">
        <button type="button" className="lc-sb-nav l-focus" aria-current={homeOn ? "page" : undefined} title="New session" onClick={() => onNew()}>
          <N.plus />
          <span>New session</span>
        </button>
        <button type="button" className="lc-sb-nav l-focus" title="Search sessions, projects and commands" onClick={onSearch}>
          <N.search />
          <span>Search</span>
        </button>
        {onWall && (
          <button
            type="button"
            className="lc-sb-nav l-focus"
            aria-current={wallOn ? "page" : undefined}
            aria-label={`The Wall, ${plural(onWallNow.length, "session")}${wallWaits ? `, ${wallWaits} waiting on you` : ""}`}
            title="The Wall: every session at once"
            onClick={onWall}
          >
            <N.wall />
            <span>The Wall</span>
          </button>
        )}
        {/* Routines switched off (contracts, ROUTINES_ON): no row for them. */}
        {ROUTINES_ON && (
        <button type="button" className="lc-sb-nav l-focus" aria-current={routinesOn ? "page" : undefined} aria-label={`Routines${routinesNote ? `, ${routinesNote}` : ""}`} title={`Routines${routinesNote ? ` · ${routinesNote}` : ""}`} onClick={onRoutines}>
          <N.routines />
          <span>Routines</span>
          {handed > 0 ? <span className="lc-sb-ndot" data-k="warn" /> : routines.some((r) => r.on) && <span className="lc-sb-nend">{routinesNote}</span>}
        </button>
        )}
      </div>

      {/* Add-ons, apart from your places: its ··· makes a new one or opens their settings, and your apps sit under it (DeepSeek Harness's sidebar entry). */}
      {(onAddons || (pages.length > 0 && onApp)) && (
        <section className="lc-sb-apps" aria-label="Add-ons">
          {onAddons && (
            <button type="button" className="lc-sb-nav l-focus" aria-current={addonsOn ? "page" : undefined} title="Add-ons: connections, panels and apps" onClick={onAddons}>
              <N.puzzle />
              <span>Add-ons</span>
            </button>
          )}
          {onApp &&
            pages.map((a) => {
              const Icon = appIcon(a.panel?.icon);
              return (
                <button key={a.id} type="button" className="lc-sb-nav l-focus" aria-current={appOn === a.id ? "page" : undefined} onClick={() => onApp(a.id)}>
                  <Icon size={16} style={{ margin: "0 2px" }} />
                  <span>{a.name}</span>
                </button>
              );
            })}
        </section>
      )}

      {/* "Sessions", and another view's name after it; its one menu holds the views, Carry on, the sort, your groups and a new project. Carry on's panel opens from a button hidden at the heading's end, so it opens beside the sidebar level with it. */}
      <div className="lc-sb-listhead">
        <SideHead title="Sessions" note={view === "folder" ? undefined : VIEWS[view]} count={putAway} menuLabel="What the list shows, and how it is sorted">
          {(close) => {
            const pick = (v: View) => () => (close(), setView(v));
            return (
              <>
                <Row title="By folder" icon={<I.folder size={14} />} keepIcon on={view === "folder"} onPick={pick("folder")} />
                <Row title="By status" icon={<I.list size={14} />} keepIcon on={view === "status"} onPick={pick("status")} />
                <Sep />
                {(byBucket.snoozed.length > 0 || view === "snoozed") && <Row title="Snoozed" icon={<I.snooze size={14} />} keepIcon on={view === "snoozed"} end={byBucket.snoozed.length || undefined} onPick={pick("snoozed")} />}
                <Row title="Settled" icon={<I.settle size={14} />} keepIcon on={view === "settled"} end={byBucket.settled.length || undefined} onPick={pick("settled")} />
                <Row title="Archive" icon={<I.box size={14} />} keepIcon on={view === "archive"} end={archivedList.length || undefined} onPick={pick("archive")} />
                {carryCount > 0 && (
                  <>
                    <Sep />
                    <Row
                      title="Carry on"
                      icon={<I.carry size={14} />}
                      end={
                        <span className="lc-sb-carry-n">
                          <Num value={carryCount} />
                          <I.chevR size={12} />
                        </span>
                      }
                      onPick={() => {
                        close();
                        // Once the menu has gone and given the keyboard back, the panel opens and takes it.
                        window.setTimeout(() => carryOpen.current?.());
                      }}
                    />
                  </>
                )}
                <Sep />
                <PanelHead>Sort by</PanelHead>
                <Row title="Last activity" keepIcon on={order === "activity"} onPick={() => (close(), setOrder("activity"))} />
                <Row title="Date started" keepIcon on={order === "started"} onPick={() => (close(), setOrder("started"))} />
                {groups.length > 0 && (
                  <>
                    <Sep />
                    <PanelHead>Your groups</PanelHead>
                    {groups.map((g) => (
                      <Row
                        key={g.id}
                        title={g.name}
                        end={
                          <span className="lc-sb-gacts">
                            {threads.filter((t) => t.group === g.id && !t.archived).length}
                            <span
                              role="button"
                              tabIndex={0}
                              className="lc-sb-gdel l-focus"
                              aria-label={`Remove the ${g.name} group`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void rpc("groups.save", { groups: groups.filter((x) => x.id !== g.id) });
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                e.stopPropagation();
                                void rpc("groups.save", { groups: groups.filter((x) => x.id !== g.id) });
                              }}
                            >
                              <I.close size={12} />
                            </span>
                          </span>
                        }
                        onPick={close}
                      />
                    ))}
                  </>
                )}
                <Sep />
                <Row title="Add a project" icon={<I.plus size={14} />} end={keysOf("open-project")} onPick={() => (close(), addProject())} />
                <Row title="New group" icon={<I.plus size={14} />} onPick={() => (close(), setNaming({}))} />
              </>
            );
          }}
        </SideHead>
        <CarryOn projectId={recentProject} now={now} onOpen={onOpen} onCarryOn={onCarryOn} side={() => nav.current} onCount={setCarryCount} opener={carryOpen} />
      </div>

      {naming && (
        <form
          className="lc-sb-newg"
          onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get("name")?.toString().trim();
            if (v) void newGroup(v, naming.forThread);
            setNaming(null);
          }}
        >
          <input name="name" autoFocus placeholder="Name the group, like Launch week" aria-label="The group's name" onKeyDown={(e) => e.key === "Escape" && setNaming(null)} onBlur={(e) => !e.target.value.trim() && setNaming(null)} />
        </form>
      )}

      <div ref={scroller} className="lc-sb-scroll" data-up={edges.up || undefined} data-down={edges.down || undefined}>
        <div className="lc-sb-inner lc-sl-list">
          <span className="lc-sb-plate" aria-hidden style={plate ? { transform: `translate(${plate.x}px, ${plate.y}px)`, width: plate.w, height: plate.h, opacity: 1 } : { opacity: 0 }} />
          {view === "folder" && (
            <>
              {block("Pinned", byBucket.pinned, { pin: true, bucket: "pinned" })}
              {groupBlocks()}
              {tree.sections.map((x) => (drawn.push(`▸${x.id}:${shutProjects.includes(x.id) ? "shut" : ""}`),
                <SideFolder
                  key={x.id || "none"}
                  name={x.name}
                  count={x.count}
                  open={!shutProjects.includes(x.id)}
                  onToggle={() => foldProject(x.id, x.ids)}
                  needs={x.needs > 0}
                  working={Boolean(x.working)}
                  brand={x.working ? markOf(onIt(x.working, agents, providers).ref) : undefined}
                  icon={x.id === DESIGNS ? <I.edit size={16} /> : undefined}
                  onContextMenu={(e) => (e.preventDefault(), setProjMenu({ id: x.id, name: x.name, x: e.clientX, y: e.clientY }))}
                  actions={
                    <>
                      <button type="button" className="lc-sb-a l-focus" aria-label={`Settle the finished sessions in ${x.name}`} title="Settle the project: its finished sessions go to Settled" onClick={() => void settleProject(x.id, x.name)}>
                        <I.settle size={14} />
                      </button>
                      {x.id && x.id !== DESIGNS && (
                        <button type="button" className="lc-sb-a l-focus" aria-label={`New session in ${x.name}`} title="New session here" onClick={() => onNew(x.id)}>
                          <I.plus size={14} />
                        </button>
                      )}
                    </>
                  }
                >
                  {x.list.map(branch)}
                </SideFolder>
              ))}
            </>
          )}
          {view === "status" && (
            <>
              {block("Pinned", byBucket.pinned, { pin: true, bucket: "pinned" })}
              {block("Needs you", byBucket.needs.filter(needs), { bucket: "needs" })}
              {block("Working", [...byBucket.working, ...byBucket.needs.filter((t) => !needs(t) && works(t))].sort(newest))}
              {groupBlocks()}
              {/* Not started is finished work here: under Complete, with its own mark and words. */}
              {block("Complete", [...byBucket.needs.filter((t) => !needs(t) && !works(t)), ...byBucket.open].sort(newest))}
            </>
          )}
          {view === "snoozed" && block("Snoozed", byBucket.snoozed, { bucket: "snoozed", bare: true })}
          {view === "settled" && block("Settled", byBucket.settled, { bucket: "settled", bare: true })}
          {view === "archive" && block("Archive", archivedList, { bare: true })}
          {empty && drawn.push("none") > 0 && empty}
        </div>
        <div className="lc-sb-blur" aria-hidden />
      </div>

      {/* Several rows picked: one action for them all, as their own rows' buttons would do it one by one. */}
      {pickedThreads.length > 1 && (
        <div className="lc-sb-bulk l-glass" role="toolbar" aria-label={`${pickedThreads.length} sessions picked`}>
          <span className="lc-sb-bulk-n">{pickedThreads.length} picked</span>
          <button type="button" className="lc-sb-a l-focus" aria-label="Settle them" title="Settle them" onClick={() => void bulk("Settled", { done: true, unread: false, pinned: false })}>
            <I.settle size={14} />
          </button>
          <button
            type="button"
            className="lc-sb-a l-focus"
            aria-label="Snooze them for an hour"
            title="Snooze them for an hour"
            onClick={() => {
              const at = snoozeTimes()[0];
              void bulk("Snoozed", { snoozedUntil: at.at.getTime(), wake: null }, `Back at ${at.note}`);
            }}
          >
            <I.snooze size={14} />
          </button>
          <button type="button" className="lc-sb-a l-focus" aria-label="Archive them" title="Archive them" onClick={() => void bulk("Archived", { archived: true })}>
            <I.box size={14} />
          </button>
          <Pop label="Move them to a group" side="top" align="center" width={230} triggerClass="lc-sb-a" trigger={<I.label size={14} />}>
            {(close) => (
              <>
                <PanelHead>Move them to</PanelHead>
                {groups.map((g) => (
                  <Row key={g.id} title={g.name} onPick={() => (close(), void bulk("Moved", { group: g.id }, `To ${g.name}`))} />
                ))}
                {groups.length === 0 && <p className="lc-quiet lc-pop-note">No groups yet. Make one from a session's right-click menu.</p>}
                {pickedThreads.some((t) => t.group) && (
                  <>
                    <Sep />
                    <Row title="Out of their groups" onPick={() => (close(), void bulk("Moved", { group: null }, "Out of their groups"))} />
                  </>
                )}
              </>
            )}
          </Pop>
          <span className="lc-grow" />
          <button type="button" className="lc-sb-a l-focus" aria-label="Let go of them" title="Let go of them (Esc)" onClick={clearPicked}>
            <I.close size={14} />
          </button>
        </div>
      )}

      {(() => {
        const t = card && card.el.isConnected ? threads.find((x) => x.id === card.id && !x.archived) : undefined;
        return t && createPortal(<SessionCard el={card!.el} side={nav.current}>{cardBody(t)}</SessionCard>, document.body);
      })()}

      <ContextMenu at={projMenu} label={projMenu ? `Actions for ${projMenu.name}` : "A project"} onClose={() => setProjMenu(null)} width={250}>
        {(close) =>
          projMenu && (
            <>
              {projMenu.id && <Row title="New session here" icon={<I.plus size={14} />} onPick={() => (close(), onNew(projMenu.id))} />}
              <Row title="Settle the project" note="Its finished sessions go to Settled" icon={<I.settle size={14} />} onPick={() => (close(), void settleProject(projMenu.id, projMenu.name))} />
              <Row title={shutProjects.includes(projMenu.id) ? "Show its sessions" : "Fold its sessions"} icon={<I.chevD size={14} />} onPick={() => (close(), foldProject(projMenu.id, tree.sections.find((x) => x.id === projMenu.id)?.ids ?? []))} />
            </>
          )
        }
      </ContextMenu>

      <ContextMenu at={menu} label={menu ? `Actions for ${menu.t.title}` : "Actions"} onClose={() => setMenu(null)} width={250}>
        {(close) =>
          menu && (
            <>
              {onBeside && current && current !== menu.t.id && <Row title="Open beside" note="Next to the session on screen" icon={<I.split size={14} />} onPick={() => (close(), onBeside(menu.t.id))} />}
              {!menu.t.archived && (
                <>
                  <Row title={menu.t.pinned ? "Unpin" : "Pin"} end="P" onPick={() => (close(), void act(menu.t, "pin"))} />
                  <Row title="Snooze for an hour" end="S" onPick={() => (close(), void act(menu.t, "snooze", snoozeTimes()[0].at))} />
                  {menu.t.pr?.state === "OPEN" && <Row title={`Snooze until #${menu.t.pr.number}'s checks finish`} onPick={() => (close(), void wake(menu.t, "checks"))} />}
                  <Row title={bucketOf(menu.t, now) === "settled" ? "Bring it back" : "Settle"} note={bucketOf(menu.t, now) === "settled" ? undefined : "Out of the way until it's busy again"} end="D" onPick={() => (close(), void act(menu.t, "settle"))} />
                  <Sep />
                  <PanelHead>Move to a group</PanelHead>
                  {groups.map((g) => (
                    <Row key={g.id} title={g.name} on={menu.t.group === g.id} onPick={() => (close(), void moveTo(menu.t, menu.t.group === g.id ? null : g.id))} />
                  ))}
                  <Row title="New group" icon={<I.plus size={14} />} onPick={() => (close(), setNaming({ forThread: menu.t.id }))} />
                  {menu.t.group && <Row title="Take it out of its group" onPick={() => (close(), void moveTo(menu.t, null))} />}
                  <Sep />
                </>
              )}
              <Row title="Rename" end="F2" onPick={() => (close(), setRenaming(menu.t.id))} />
              <Row title="Export as Markdown" note="Asks, plans, answers and diffs, saved in Downloads" onPick={() => (close(), exportSession(menu.t.id))} />
              {menu.t.archived ? <Row title="Bring it back" note="Out of Archive, back in the list" onPick={() => (close(), void unarchive(menu.t))} /> : <Row title="Archive" onPick={() => (close(), void archive(menu.t))} />}
            </>
          )
        }
      </ContextMenu>

      </>
      )}

      {/* A new Liner Code, ready or on its way: a card over the foot, until it goes in or you put it away (until a newer one). */}
      {(() => {
        const n = updateMode !== "off" && update.dismissed.app !== update.app.latest && (update.app.state === "ready" || update.app.state === "downloading") ? appNotice(update.app) : null;
        if (!n) return null;
        const busy = working > 0 && update.app.state === "ready" ? ` ${plural(working, "session")} ${working === 1 ? "is" : "are"} working.` : "";
        return (
          <div className="lc-sb-update" role="status">
            <I.download size={16} />
            <div className="lc-sb-update-t">
              <b>{n.title}</b>
              <span>{update.app.state === "ready" ? `Restart now, or it goes in when you next quit.${busy}` : n.body}</span>
            </div>
            {n.action && update.app.state === "ready" && (
              <button type="button" className="lc-sb-update-go l-focus" onClick={n.action.onClick}>
                Restart
              </button>
            )}
            <button type="button" className="lc-sb-a l-focus" aria-label="Put it away" title="Put it away until a newer version" onClick={() => updates.dismiss("app")}>
              <I.close size={12} />
            </button>
          </div>
        );
      })()}

      {/* Along the foot: the name, which is the Code and Design switch, then your plans' limits and Settings (your account is in Settings). */}
      <div className="lc-sb-foot" onClick={tapMe}>
        {onFace ? (
          <Pop
            label={`Liner ${FACE_NAME[face]}. Switch between Code, Design and Security`}
            menu
            side="top"
            // As wide as the sidebar inside its insets, and never past its edge onto the paper.
            width="within"
            within={() => nav.current}
            triggerClass="lc-sb-facepick lc-sb-name"
            trigger={
              <>
                {/* "Liner" in ink and the face in grey after it, so it reads as the app's name; no tile. */}
                <span className="lc-brand">Liner</span>
                <span className="lc-sb-name-face">{FACE_NAME[face]}</span>
                <I.chevD size={12} />
              </>
            }
          >
            {(close) => (
              <div className="lc-sb-menu">
                <button type="button" role="menuitemradio" aria-checked={face === "code"} className="lc-face-opt l-focus" onClick={() => (close(), onFace("code"))}>
                  <span className="lc-face-tile" data-face="code"><I.terminal size={12} /></span>
                  <span className="lc-face-tx">
                    <b>Code</b>
                    <small>Sessions in your projects</small>
                  </span>
                  {face === "code" && <I.check size={14} />}
                </button>
                <button type="button" role="menuitemradio" aria-checked={face === "design"} className="lc-face-opt l-focus" onClick={() => (close(), onFace("design"))}>
                  <span className="lc-face-tile" data-face="design"><I.design size={12} /></span>
                  <span className="lc-face-tx">
                    <b>Design</b>
                    <small>Frames drawn with an agent</small>
                  </span>
                  {face === "design" && <I.check size={14} />}
                </button>
                <button type="button" role="menuitemradio" aria-checked={face === "security"} className="lc-face-opt l-focus" onClick={() => (close(), onFace("security"))}>
                  <span className="lc-face-tile" data-face="security"><I.shield size={12} /></span>
                  <span className="lc-face-tx">
                    <b>Security</b>
                    <small>Findings and scans</small>
                  </span>
                  {face === "security" && <I.check size={14} />}
                </button>
              </div>
            )}
          </Pop>
        ) : (
          // With nothing to switch to, the name alone, still the Demo's six taps.
          <span className="lc-sb-name" role="presentation">
            <span className="lc-brand">Liner</span>
            <span className="lc-sb-name-face">{FACE_NAME[face]}</span>
          </span>
        )}
        <span className="lc-grow" />
        <PlanLimits tools={limits.filter((l) => l.windows.length)} usageOn={usageOn} onUsage={onUsage} />
        <button type="button" className="lc-ib l-focus" aria-label="Settings and your account" title="Settings and your account" onClick={onSettings}>
          <N.settings />
        </button>
      </div>
    </nav>
  );

  const layout = drawn.join("\n");
  // The plate follows the open session as rows arrive, leave and fold: measured again only when what the list draws changes
  // (`layout`, from this render's `drawn`), not for every word a session sends; its ResizeObserver covers the rest.
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    // Measured from the list's own box, since a fork's row sits inside its parent's indent.
    const measure = () => {
      const inner = sc.firstElementChild as HTMLElement;
      const row = current ? sc.querySelector<HTMLElement>(`[data-row="${CSS.escape(current)}"]`) : null;
      if (!row) return setPlate(null);
      // From the layout, not the screen: a row gliding to its place (below) is already there for the plate.
      const next = boxIn(row, inner);
      // The same place again (the list's first resize report, a row that didn't move) keeps the plate as it is, rather than drawing the whole sidebar again for it.
      setPlate((was) => (was && was.x === next.x && was.y === next.y && was.w === next.w && was.h === next.h ? was : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc.firstElementChild as HTMLElement);
    return () => ro.disconnect();
  }, [current, layout, view, renaming, Boolean(faceBody)]);

  /*
    Rows move rather than jump: one that changes place (it starts or stops working, a session is new
    or gone, By status takes it to another section) glides from where it was, and the plate with it
    while it's the open one. Not when the view changes or a folder or forks fold (those are new
    places, not moves), and not with Reduce motion.
  */
  const tops = useRef<{ key: string; at: Map<string, number> } | null>(null);
  const still = useRef(false);
  useLayoutEffect(() => {
    const inner = scroller.current?.firstElementChild as HTMLElement | null;
    if (!inner) return void (tops.current = null);
    for (const a of inner.getAnimations({ subtree: true })) if (a.id === GLIDE) a.finish();
    const at = new Map<string, number>();
    for (const el of inner.querySelectorAll<HTMLElement>("[data-row]")) at.set(el.dataset.row ?? "", boxIn(el, inner).y);
    const key = `${view}:${Boolean(faceBody)}`;
    const was = tops.current;
    tops.current = { key, at };
    const skip = still.current;
    still.current = false;
    if (!was || was.key !== key || skip || prefersReducedMotion()) return;
    const glide = (el: Element, dy: number) => el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)", id: GLIDE });
    for (const [id, y] of at) {
      const from = was.at.get(id);
      if (from === undefined || Math.abs(from - y) < 1) continue;
      const el = inner.querySelector(`[data-row="${CSS.escape(id)}"]`);
      if (el) glide(el, from - y);
      const plateEl = inner.querySelector(".lc-sb-plate");
      if (id === current && plateEl) glide(plateEl, from - y);
    }
  }, [layout, view, Boolean(faceBody)]);
  /** A folder opened or shut: its rows are new there, so they fade in as ever, and nothing glides for it. */
  const foldProject = (id: string, ids: string[]) => {
    still.current = true;
    if (shutProjects.includes(id)) for (const x of ids) seenRows.current.delete(x);
    toggleProject(id);
  };
  ctl.current = {
    act,
    unarchive,
    wake,
    hideCard,
    pointAt,
    leaveRow,
    menuAt: (t, x, y) => setMenu({ t, x, y }),
    togglePick,
    pickRun,
    clearPicked,
    open: onOpen,
    keys: rowKeys,
    rename: setRenaming,
    toggleForks: (id) => {
      still.current = true;
      if (shutForks.includes(id)) for (const x of tree.forks.get(id) ?? []) seenRows.current.delete(x.id);
      toggleForks(id);
    },
  };
  return out;
}

/** The rows' glide (WAAPI's id for it), so a new one finishes the last first. */
const GLIDE = "lc-sb-glide";
/** Where an element sits in `root` by the layout (offsets, which a glide's translate doesn't move), with its size. */
function boxIn(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
  What Carry on found last, kept while the app is open: within a minute nothing is asked again. The
  sessions go by your code projects, the work not committed by project. A project whose sessions
  change what they've left uncommitted (a turn ends, a commit goes in) has its count marked old, so
  the next look asks Git again; the old count stands until it answers.
*/
let recentFound: { at: number; key: string; theirs: RecentSession[] } | null = null;
const changedFound = new Map<string, { at: number; n: number }>();
/** How long what Carry on found stands before it asks again. */
const RECENT_FOR = 60_000;
/** Rows Carry on holds at most. */
const RECENT_MAX = 6;
const fresh = (x: { at: number } | null | undefined) => Boolean(x && Date.now() - x.at < RECENT_FOR);
/** The tools Carry on knows by name, in the order their groups come; any other is named after its id and comes after them. */
const TOOLS: Record<string, { name: string; mark: MarkKind }> = { claude: { name: "Claude Code", mark: "claudecode" }, codex: { name: "Codex", mark: "codex" } };
const toolOf = (tool: string) => TOOLS[tool] ?? { name: tool.charAt(0).toUpperCase() + tool.slice(1), mark: "other" as const };
const toolOrder = (tool: string) => (tool in TOOLS ? Object.keys(TOOLS).indexOf(tool) : 99);

/**
  Carry on, in the Sessions menu: work that's already yours to pick up and isn't in Liner Code's
  list. The work not committed in the project you were last in (none offered when that isn't a code
  project: never another project's), and the sessions in Claude Code and Codex in your projects not
  brought in yet, newest first (sessions.recent, one read of both tools for every project). Sessions
  that wait on you are in the list's own groups already, so they aren't here. It is one row in the
  menu with the count at its end (`onCount` tells the sidebar the count): pressing it opens a panel
  beside the sidebar, by where the work is, so however much there is your sessions don't move. The
  panel hangs from a button kept out of sight at the heading's end (`opener` presses it), so it opens
  level with the heading. Pressing one there brings it in and opens it, or for the work not
  committed, writes the ask to finish it into Home's box. With nothing to carry on there's no row;
  with the panel open it stays, saying so, until you close it.
  The row needs its count before it's opened, so it asks once the sidebar has been still a moment
  after it comes up, and again when the panel opens or the window comes back to the front, when what
  it has is over a minute old (so a row hidden for want of anything, or after a failed read, comes
  back by itself). sessions.recent is a read of the tools' folders on the engine (each project's
  Claude Code folder listed, Codex's whole tree walked, the first 96 KB of the newest few dozen files
  read), so nothing asks it on a timer. Moving to another project asks only Git again, for that
  project, once a minute at most, or sooner after its sessions changed what's uncommitted.
*/
function CarryOn({ projectId, now, onOpen, onCarryOn, side, onCount, opener }: { projectId?: string; now: number; onOpen: (id: string) => void; onCarryOn?: (projectId: string, text: string) => void; side: () => HTMLElement | null; onCount: (n: number) => void; opener: MutableRefObject<(() => void) | null> }) {
  const all = useEngine((s) => s.projects);
  const projects = useMemo(() => codeProjects(all), [all]);
  const project = projects.find((p) => p.id === projectId);
  // The sessions are asked again when your code projects change (and on opening or coming back, once a minute old).
  const key = projects.map((p) => p.id).sort().join();
  const gitHere = project?.git ? project.id : undefined;
  const gitRef = useRef(gitHere);
  gitRef.current = gitHere;
  const intro = useId();
  const [found, setFound] = useState(() => (recentFound?.key === key ? recentFound.theirs : null));
  const [changed, setChanged] = useState(() => (gitHere ? (changedFound.get(gitHere)?.n ?? 0) : 0));
  // 0 until the sidebar has been still a moment after it comes up (at once when it has asked before, as after Design); each opening of the panel, or return of the window, counts one more.
  const [asked, setAsked] = useState(() => (recentFound ? 1 : 0));
  // Bumped when this project's count was marked old, so Git is asked again.
  const [stale, setStale] = useState(0);
  // The panel is open: the row stays while it is, even with nothing left in it.
  const [showing, setShowing] = useState(false);
  // The read of sessions.recent that's out, for which list: the window's focus and visibilitychange both come on a return, and one read answers both.
  const pending = useRef<{ key: string; p: Promise<RecentSession[]> } | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    if (asked) return;
    const go = () => setAsked((a) => a || 1);
    let idle = 0;
    const t = window.setTimeout(() => (typeof requestIdleCallback === "function" ? (idle = requestIdleCallback(go, { timeout: 3000 })) : go()), 1200);
    return () => {
      window.clearTimeout(t);
      if (idle) cancelIdleCallback(idle);
    };
  }, []);
  // Back to the window (from a terminal, from Claude Code): what's over a minute old is asked again.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "visible" || pending.current) return;
      const git = gitRef.current;
      if (!fresh(recentFound) || (git && !fresh(changedFound.get(git)))) setAsked((a) => a + 1);
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);
  // A turn ending or a commit going in changes what a session has left uncommitted (Thread.toReview): that project's count is old.
  const marks = useEngine((s) => s.threads.map((t) => `${t.projectId}\t${t.id}=${t.status === "running" ? "r" : (t.toReview ?? 0)}`).join("\n"));
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const by = new Map<string, string>();
    for (const m of marks.split("\n")) if (m) by.set(m.split("\t")[0], `${by.get(m.split("\t")[0]) ?? ""}${m}\n`);
    const was = seen.current;
    seen.current = by;
    if (!was) return;
    for (const [p, v] of by) {
      if (was.get(p) === v) continue;
      const had = changedFound.get(p);
      if (had) changedFound.set(p, { ...had, at: 0 });
      if (p === gitRef.current) setStale((n) => n + 1);
    }
  }, [marks]);
  useEffect(() => {
    if (!asked) return;
    if (recentFound?.key === key && fresh(recentFound)) return setFound(recentFound.theirs);
    let live = true;
    // A read already out for this list is waited on, not asked twice.
    let ask = pending.current?.key === key ? pending.current.p : null;
    if (!ask) {
      const p: Promise<RecentSession[]> = rpc("sessions.recent", { limit: RECENT_MAX }).then((theirs) => {
        // A late answer for a list that has since moved on is let go, not kept.
        if (keyRef.current === key) recentFound = { at: Date.now(), key, theirs };
        return theirs;
      });
      const out = { key, p };
      pending.current = out;
      const done = () => void (pending.current === out && (pending.current = null));
      p.then(done, done);
      ask = p;
    }
    ask.then(
      (theirs) => live && setFound(theirs),
      // Nothing kept: the next look asks again.
      () => live && setFound([]),
    );
    return () => {
      live = false;
    };
  }, [asked, key]);
  useEffect(() => {
    if (!gitHere) return setChanged(0);
    // What it found here last stands while it asks again.
    const had = changedFound.get(gitHere);
    setChanged(had?.n ?? 0);
    if (!asked || fresh(had)) return;
    let live = true;
    // A moment's wait, so running through sessions in several projects asks Git only where you stop.
    const t = window.setTimeout(
      () =>
        void rpc("git.status", { projectId: gitHere }).then(
          (g) => {
            changedFound.set(gitHere, { at: Date.now(), n: g.changes.length });
            if (live) setChanged(g.changes.length);
          },
          () => live && setChanged(0),
        ),
      400,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [asked, gitHere, stale]);
  const bring = (x: RecentSession) =>
    void rpc("sessions.import", { projectId: x.projectId, tool: x.tool, id: x.id }).then(
      (t) => {
        // Brought in, it's in the list now: Carry on lets it go.
        const left = (list: RecentSession[]) => list.filter((y) => !(y.tool === x.tool && y.id === x.id));
        if (recentFound) recentFound = { ...recentFound, theirs: left(recentFound.theirs) };
        setFound((f) => f && left(f));
        onOpen(t.id);
      },
      (e: Error) => toast.error(e.message),
    );
  const carry = onCarryOn && project ? changed : 0;
  const theirs = found ? found.slice(0, RECENT_MAX - (carry ? 1 : 0)) : [];
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? "a project";
  const files = plural(carry, "file");
  // Known once the sessions are; until then, or with nothing to carry on, there's no row (unless its panel is open).
  const count = found ? theirs.length + (carry ? 1 : 0) : 0;
  useEffect(() => onCount(count), [count]);
  // The button the panel hangs from is out of sight: once the panel closes, the keyboard goes back to the heading's menu, where Carry on is, rather than to it or to nowhere.
  const holder = useRef<HTMLSpanElement>(null);
  opener.current = () => holder.current?.querySelector<HTMLButtonElement>("button")?.click();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (showing) return void (wasOpen.current = true);
    const at = document.activeElement;
    if (wasOpen.current && (!at || at === document.body || holder.current?.contains(at))) side()?.querySelector<HTMLElement>(".lc-sl-head-b")?.focus({ preventScroll: true });
    wasOpen.current = false;
  }, [showing, count]);
  if (!count && !showing) return null;
  // By where the work is: what isn't committed first, then each tool's sessions, newest first in each.
  const sources = [...new Set(theirs.map((x) => x.tool))].sort((a, b) => toolOrder(a) - toolOrder(b));
  /** A row as the list's rows are: the source's mark in the mark column, the title and what pressing it does, and under it the tool and the project. */
  const line = (key: string, mark: ReactNode, title: string, where: string, does: string | undefined, tip: string, onPick: () => void) => (
    <button key={key} type="button" role="menuitem" className="lc-carry-row l-focus" title={tip} onClick={onPick}>
      <span className="lc-carry-mk">{mark}</span>
      <b>{title}</b>
      {does && <span className="lc-carry-do">{does}</span>}
      <span className="lc-carry-s">{where}</span>
    </button>
  );
  return (
    // Only an anchor for the panel: the menu's row is the way in, so assistive tech is not shown a second Carry on (focus never stays in it: the effect above moves it on).
    <span ref={holder} className="lc-sb-carry-at" aria-hidden>
      <Pop
        label={count ? `Carry on: ${count} to pick up here` : "Carry on"}
        describedBy={intro}
        menu
        side="right"
        width={276}
        within={side}
        triggerClass="lc-sb-carry"
        // Out of the Tab order: the menu's Carry on row is the way in.
        triggerAttrs={{ tabIndex: "-1" }}
        trigger="Carry on"
      >
        {(close) => (
          <CarryPanel
            onShow={() => {
              setShowing(true);
              setAsked((a) => a + 1);
            }}
            onHide={() => setShowing(false)}
          >
            {/* Its title is the panel's label already; the line under it is its description (aria-describedby). */}
            <div className="lc-carry-h">
              <b aria-hidden>Carry on</b>
              <span id={intro}>Work you can pick up here: changes not committed, and sessions in Claude Code and Codex.</span>
            </div>
            {/* The row the keyboard was on went with the rest: it lands here, so Escape and Tab still start from the panel. */}
            {!count && (
              <p className="lc-carry-none" tabIndex={-1} ref={(el) => void (el && (!document.activeElement || document.activeElement === document.body) && el.focus({ preventScroll: true }))}>
                Nothing to carry on right now
              </p>
            )}
            {carry > 0 && project && (
              <div className="lc-carry-g" role="group" aria-label="Not committed">
                <div className="lc-carry-gh" aria-hidden>
                  <span>Not committed</span>
                  <span>1</span>
                </div>
                {line("carry", <I.changes size={14} />, "Continue uncommitted work", `${project.name} · ${files}`, undefined, `${files} not committed in ${project.name}`, () => {
                  close();
                  onCarryOn?.(project.id, `Carry on the work that isn't committed here (${files}): read what changed, then finish it.`);
                })}
              </div>
            )}
            {sources.map((tool) => {
              const { name, mark } = toolOf(tool);
              const xs = theirs.filter((x) => x.tool === tool);
              return (
                <div key={tool} className="lc-carry-g" role="group" aria-label={`From ${name}`}>
                  <div className="lc-carry-gh" aria-hidden>
                    <span>From {name}</span>
                    <span>{xs.length}</span>
                  </div>
                  {xs.map((x) =>
                    line(`${x.tool}:${x.id}`, <ModelMark kind={mark} size={14} />, x.title, `${name} · ${nameOf(x.projectId)}`, "Bring in", `From ${name} · ${nameOf(x.projectId)} · ${agoLong(x.at, now)}`, () => {
                      close();
                      bring(x);
                    }),
                  )}
                </div>
              );
            })}
          </CarryPanel>
        )}
      </Pop>
    </span>
  );
}

/** Carry on's panel: opening it is what asks again, when what Carry on has is over a minute old; while it's up, the row stays. */
function CarryPanel({ onShow, onHide, children }: { onShow: () => void; onHide: () => void; children: ReactNode }) {
  useEffect(() => {
    onShow();
    return onHide;
  }, []);
  return <div className="lc-carry">{children}</div>;
}

/** Your plans' limits at a glance: a ring with the busiest window, every tool's windows in its pop, and the way to Usage. */
function PlanLimits({ tools, usageOn, onUsage }: { tools: import("@contracts").ToolLimits[]; usageOn: boolean; onUsage: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const used = (w: import("@contracts").LimitWindow) => (w.resetsAt !== undefined && w.resetsAt <= now ? 0 : Math.max(0, Math.min(100, w.usedPercent)));
  const top = Math.max(0, ...tools.flatMap((t) => t.windows.map(used)));
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <Pop
      label={tools.length ? `Plan limits: the busiest window is ${Math.round(top)}% used` : "Usage and plan limits"}
      side="top"
      align="end"
      width={290}
      triggerClass="lc-ib lc-sb-fi"
      triggerAttrs={{ "aria-pressed": usageOn || undefined }}
      trigger={
        <span className="lc-sb-ring" data-warn={top >= 80 || undefined} aria-hidden>
          <svg width={16} height={16} viewBox="0 0 14 14">
            <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
            <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - top / 100)} strokeLinecap="round" transform="rotate(-90 7 7)" />
          </svg>
        </span>
      }
    >
      {(close) => (
        <div className="lc-limm">
          {tools.map((t) => (
            <div key={t.provider} className="lc-limm-tool">
              <PanelHead end={t.plan && t.plan[0].toUpperCase() + t.plan.slice(1)}>{t.label}</PanelHead>
              {t.windows.map((w) => (
                <LimitRow key={w.label} w={w} label={t.label} now={now} />
              ))}
            </div>
          ))}
          {!tools.length && <p className="lc-quiet lc-pop-note">No plan has reported its limits yet. They show here once a session runs on Claude Code or Codex.</p>}
          <Sep />
          <Row title="Usage and cost" icon={<I.usage size={14} />} onPick={() => (close(), onUsage())} />
        </div>
      )}
    </Pop>
  );
}

/** Saves a session as Markdown in Downloads, and says where with a way to show it. */
function exportSession(threadId: string) {
  void rpc("thread.export", { id: threadId }).then(
    ({ path }) => toast.success("Saved as Markdown", { description: os.tilde(path), action: { label: "Show", onClick: () => bridge.reveal(path) } }),
    (e: Error) => toast.error(e.message),
  );
}


/*
  A session's row, the same in every view (SideRow): in the mark column how it stands (the spinner
  in its model's tint while it works, the amber dot while it waits on you, the clock, the error
  mark, the ring before it starts, else a small grey dot); its title; under it what it is doing
  now, or how it ended; at its end its pull request, or the changes it left to review. Pointing at
  it, Pin, Snooze and Settle take the end's place. Who works on it, where and when are in the card
  a resting pointer brings.
  Its own memoised part: a session's news redraws its row alone, never the list; what it does is
  reached through `ctl`, which the sidebar keeps current, so the row takes no new callbacks.
*/
type RowCtl = {
  act: (t: Thread, what: "pin" | "settle" | "snooze" | "wake", at?: Date) => Promise<void>;
  unarchive: (t: Thread) => Promise<void>;
  wake: (t: Thread, kind: "checks" | "reply") => Promise<void>;
  hideCard: () => void;
  pointAt: (id: string, el: HTMLElement) => void;
  leaveRow: () => void;
  menuAt: (t: Thread, x: number, y: number) => void;
  togglePick: (id: string) => void;
  pickRun: (id: string) => void;
  clearPicked: () => void;
  open: (id: string) => void;
  keys: (e: KeyboardEvent, t: Thread) => void;
  rename: (id: string | null) => void;
  toggleForks: (id: string) => void;
};
type RowProps = {
  t: Thread;
  shelf: Bucket;
  now: number;
  agents: AgentProfile[];
  providers: ProviderInfo[];
  run?: RoutineRun;
  /** Agents it sent at work now. */
  working: number;
  current: boolean;
  renaming: boolean;
  picked: boolean;
  /** Some row is picked: every row says whether it is. */
  picking: boolean;
  /** The resting pointer's card tells about it. */
  described: boolean;
  /** Its forks, and whether they show. */
  forks?: number;
  forksOpen?: boolean;
  /** Rows drawn before, for the life of the sidebar. */
  seen: Set<string>;
  ctl: MutableRefObject<RowCtl>;
};
const SessionRow = memo(function SessionRow({ t, shelf, now, agents, providers, run, working, current, renaming, picked, picking, described, forks, forksOpen, seen, ctl }: RowProps) {
  // Pinned is where it's kept, not how it stands: one that waits on you shows it, as the Dock counts it.
  const bucket = standing(t, shelf, now);
  const on = onIt(t, agents, providers);
  // Finished and nothing waits on you, or settled: the title steps back.
  const title =
    renaming ? (
      <input
        className="lc-sb-rename"
        aria-label={`Rename ${t.title || "New session"}`}
        defaultValue={t.title}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          // The Enter that confirms an IME composition is not the end of the rename.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key !== "Enter" && e.key !== "Escape") return;
          // Back to the row, not nowhere: Enter saves as the field loses focus, Escape puts the title back first.
          if (e.key === "Escape") e.currentTarget.value = t.title;
          e.currentTarget.closest<HTMLElement>(".lc-sb-pick")?.focus();
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== t.title) void rpc("thread.update", { id: t.id, title: v });
          ctl.current.rename(null);
        }}
      />
    ) : (
      // A session the engine hasn't named yet still reads as one.
      t.title || "New session"
    );
  // A pair's sidekick is in its name already: the agents besides it are counted.
  const agentsNow = Math.max(0, working - (on.pair ? 1 : 0));
  const busy = !t.archived && (t.status === "running" || run?.status === "running" || (working > 0 && !asksYou(t)));
  // Finished and nothing waits on you, or settled: the title steps back. One at work keeps full ink.
  const quiet = !busy && (Boolean(t.archived) || bucket === "settled" || (bucket !== "needs" && t.status !== "running" && t.status !== "error" && t.status !== "limited" && t.turns > 0));
  // A row that first comes already open (a session just sent from Home) is there at once, so the plate under it is never empty; one drawn
  // before (By status moves a row to another section, which draws it anew) doesn't fade in again. Either keeps that for this row's life, so nothing plays when it changes.
  const [fresh] = useState(() => seen.has(t.id) || current);
  useEffect(() => void seen.add(t.id), []);
  const state: SideState = sideStateOf(t, busy);
  const said = rowLine(t, bucket, state, agentsNow, now);
  const pr = t.pr ? prState(t.pr.state) : undefined;
  // Finished while you were elsewhere: a blue dot until you open it, beside its pull request or changes mark.
  const unseen = t.unread && (state === "done" || state === "new");
  const marks = t.pr ? (
    <span className="lc-sl-pr" data-pr={pr} role="img" aria-label={`Pull request #${t.pr.number}, ${pr}`}>
      <I.pr size={14} />
    </span>
  ) : (t.toReview ?? 0) > 0 ? (
    <span className="lc-sl-chg" role="img" aria-label={`${plural(t.toReview!, "file")} to review`}>
      <I.changes size={14} />
    </span>
  ) : undefined;
  const end = unseen ? (
    <span className="lc-sl-ends">
      {marks}
      <span className="lc-sl-new" role="img" aria-label="Finished, not opened yet" />
    </span>
  ) : (
    marks
  );
  const acts = t.archived ? (
    <button type="button" className="lc-sb-a l-focus" aria-label="Bring it back" title="Bring it back from Archive" onClick={() => void ctl.current.unarchive(t)}>
      <I.undo size={14} />
    </button>
  ) : (
    <>
      <button type="button" className="lc-sb-a l-focus" aria-label={t.pinned ? "Unpin" : "Pin"} title={t.pinned ? "Unpin (P)" : "Pin (P)"} aria-pressed={Boolean(t.pinned)} onClick={() => void ctl.current.act(t, "pin")}>
        <I.pin size={14} />
      </button>
      <Pop label="Snooze until" align="end" width={230} menu triggerClass="lc-sb-a" trigger={<I.snooze size={14} />}>
        {(close) => (
          <>
            <PanelHead>Snooze until</PanelHead>
            {snoozeTimes().map((s) => (
              <Row
                key={s.label}
                title={s.label}
                end={s.note}
                onPick={() => {
                  close();
                  void ctl.current.act(t, "snooze", s.at);
                }}
              />
            ))}
            {t.pr && t.pr.state === "OPEN" && (
              <>
                <Sep />
                <PanelHead>Or until</PanelHead>
                <Row title="Checks finish" end={`#${t.pr.number}`} onPick={() => (close(), void ctl.current.wake(t, "checks"))} />
                <Row title="Someone replies" end={`#${t.pr.number}`} onPick={() => (close(), void ctl.current.wake(t, "reply"))} />
              </>
            )}
            {t.snoozedUntil && t.snoozedUntil > now && (
              <>
                <Sep />
                <Row
                  title="Wake it now"
                  onPick={() => {
                    close();
                    void ctl.current.act(t, "wake");
                  }}
                />
              </>
            )}
          </>
        )}
      </Pop>
      <button type="button" className="lc-sb-a l-focus" aria-label={bucket === "settled" ? "Bring it back" : "Settle"} aria-pressed={bucket === "settled"} title={bucket === "settled" ? "Bring it back (D)" : "Settle (D)"} onClick={() => void ctl.current.act(t, "settle")}>
        <I.settle size={14} />
      </button>
    </>
  );
  return (
    <SideRow
      className="lc-sb-row"
      data-row={t.id}
      data-forks={forks !== undefined ? "" : undefined}
      data-picked={picked || undefined}
      data-fresh={fresh || undefined}
      aria-current={current ? "page" : undefined}
      current={current}
      quiet={quiet}
      mark={<SideMark state={state} brand={markOf(on.ref)} />}
      title={title}
      sub={said.text}
      tone={said.tone}
      end={end}
      acts={acts}
      draggable={!renaming && !t.archived}
      onDragStart={(e) => {
        ctl.current.hideCard();
        e.dataTransfer.setData("text/x-liner-session", t.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      // A mouse at rest over the row: not a touch, and no button held (a drag, a selection).
      onPointerEnter={(e) => e.pointerType === "mouse" && e.buttons === 0 && ctl.current.pointAt(t.id, e.currentTarget)}
      onPointerLeave={() => ctl.current.leaveRow()}
      onPointerDown={() => ctl.current.hideCard()}
      onContextMenu={(e) => {
        e.preventDefault();
        ctl.current.hideCard();
        ctl.current.menuAt(t, e.clientX, e.clientY);
      }}
      pick={{
        role: "button",
        tabIndex: 0,
        className: "lc-sb-pick l-focus",
        "aria-pressed": picking ? picked : undefined,
        "aria-describedby": described ? CARD_ID : undefined,
        // ⇧ would select the text between the rows; the run is the selection here.
        onMouseDown: (e) => e.shiftKey && e.preventDefault(),
        onClick: (e) => {
          if (e.metaKey || e.ctrlKey) return ctl.current.togglePick(t.id);
          if (e.shiftKey) return ctl.current.pickRun(t.id);
          // A plain click opens the session, and lets go of any picked rows.
          ctl.current.clearPicked();
          ctl.current.open(t.id);
        },
        onKeyDown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return ctl.current.keys(e, t);
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          ctl.current.clearPicked();
          ctl.current.open(t.id);
        },
        onDoubleClick: (e) => !(e.metaKey || e.ctrlKey || e.shiftKey) && ctl.current.rename(t.id),
      }}
    >
      {forks !== undefined && (
        <button type="button" className="lc-sb-forks l-focus" aria-expanded={forksOpen} aria-label={`${plural(forks, "fork")} of ${t.title}`} title={forksOpen ? "Fold its forks" : "Show its forks"} onClick={() => ctl.current.toggleForks(t.id)}>
          <I.chevR size={12} />
          <I.fork size={12} />
          {forks}
        </button>
      )}
    </SideRow>
  );
});

/** Who's on a session (a pair as one: "Opus 5.5 + Sol"), and the model its lead runs on. */
function onIt(t: Thread, agents: AgentProfile[], providers: ProviderInfo[]) {
  const a = agentOf(t.agent, agents, providers);
  // A thread's own model stands in for its agent's.
  const ref = t.model ?? a.model;
  const pair = pairOf(t, agents, providers);
  return { who: pair?.name ?? a.name, ref, pair };
}

/** "Liner Code" → LC, "my-app" → MA, "Firefly" → FI. */
function badgeLetters(name: string) {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_\-./]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] ?? "?")].slice(0, 2).join("");
  return letters.toUpperCase();
}
/** A project's badge: its two letters in grey (Liner 2.0 has no colour per item). */
function ProjectBadge({ name, none, design }: { name: string; none?: boolean; design?: boolean }) {
  return (
    <span className="lc-pjb" data-none={none || undefined} data-design={design || undefined} aria-hidden>
      {design ? <I.edit size={12} /> : badgeLetters(name)}
    </span>
  );
}

/** A pull request's state, as its mark and words say it. */
const prState = (state: string) => (state.toUpperCase() === "MERGED" ? "merged" : state.toUpperCase() === "CLOSED" ? "closed" : "open");

/**
  A row's second line: what the session is doing now while it works ("Reading Sidebar.tsx", the
  engine's Thread.doing, with the agents it sent still at work after it), else how it stands or
  how it ended, first that applies: the Reviewer's block, waiting on you, a problem, its plan's
  limit, snoozed, not started, its pull request, changes to review, else finished and how long
  ago. One finished while you were elsewhere says so with a blue dot at the row's end, not here.
*/
function rowLine(t: Thread, bucket: Bucket, state: SideState, agents: number, now: number): { text: string; tone?: "warn" | "danger" } {
  if (state === "working") {
    const doing = t.status === "running" ? t.doing?.text || "Working" : "Working";
    // The engine's own line for sending agents ("Sending an agent"): only how many are at work, not the same word twice.
    if (agents > 0 && doing.startsWith("Sending an agent")) return { text: `${plural(agents, "agent")} at work` };
    return { text: agents > 0 ? `${doing} · ${plural(agents, "agent")}` : doing };
  }
  if (reviewHeld(t)) return { text: "Reviewer blocked it" };
  if (t.status === "waiting") return { text: "Waits for your answer", tone: "warn" };
  if (t.status === "error") return { text: "Ran into a problem", tone: "danger" };
  if (t.status === "limited") return { text: `Hit its plan's limit${t.limit?.until ? `, back at ${clock(t.limit.until, now)}` : ""}`, tone: "warn" };
  if (bucket === "snoozed") {
    if (t.wake) return { text: t.wake.kind === "checks" ? `Until #${t.wake.pr}'s checks finish` : `Until a reply on #${t.wake.pr}` };
    if (t.snoozedUntil) return { text: `Until ${clock(t.snoozedUntil, now)}` };
  }
  if (t.turns === 0) return { text: "Not started" };
  if (t.pr) return { text: `PR ${prState(t.pr.state)}` };
  if ((t.toReview ?? 0) > 0) return { text: `${plural(t.toReview!, "file")} to review` };
  // ago() says "now", "4m", "2h", then a day or a date: the minutes and hours read "ago" after them.
  const a = ago(t.updatedAt, now);
  return { text: `Finished · ${a === "now" ? "just now" : /^\d+[mh]$/.test(a) ? `${a} ago` : a}` };
}

/** "just now", "4 min ago", "2 hours ago", "yesterday". */
const agoLong = (at: number, now: number) => {
  const m = Math.floor((now - at) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : since(at, now);
};

/** How a session stands, in the card: the row's words, said in full. */
function cardState(t: Thread, bucket: Bucket, who: string, now: number, run?: { status: string; steps: unknown[]; subject?: { number: number } }): { text: string; tone?: "warn" | "danger" } {
  if (run?.status === "running") return { text: `Working · a routine's run${run.subject ? ` on #${run.subject.number}` : ""}, step ${run.steps.length}` };
  if (bucket === "snoozed") {
    if (t.wake) return { text: t.wake.kind === "checks" ? `Snoozed · back when the checks on #${t.wake.pr} finish` : `Snoozed · back when someone replies on #${t.wake.pr}` };
    if (t.snoozedUntil) return { text: `Snoozed · back ${clock(t.snoozedUntil, now)}` };
  }
  if (t.status === "running") {
    if (t.goal?.status === "active") return { text: `Working · ${who} works toward its goal, turn ${t.goal.turns} of ${t.goal.max}` };
    return { text: `Working · ${who} ${who.includes(" + ") ? "are" : "is"} at it` };
  }
  if (reviewHeld(t)) return { text: `Finished · the Reviewer blocked it${t.verdict?.note ? `: ${t.verdict.note}` : ""}` };
  if (t.status === "waiting") return { text: `Needs you · ${who} ${who.includes(" + ") ? "wait" : "waits"} for your answer`, tone: "warn" };
  if (t.status === "error") return { text: `Ran into a problem · ${who} stopped short`, tone: "danger" };
  if (t.status === "limited") return { text: `Limited · ${who}'s plan ran out${t.limit?.until ? `, back at ${clock(t.limit.until, now)}` : ""}`, tone: "warn" };
  if (t.turns === 0) return { text: "Not started · nothing asked yet" };
  if (t.unread) return { text: `Finished · ${who} answered while you were away` };
  if (bucket === "settled") return { text: "Settled · out of the way until it's busy again" };
  return { text: `Done · ${who} finished, nothing waits on you` };
}

const CARD_ID = "lc-sb-card";
const EDGE = 10;

/**
  The card beside the sidebar, level with the row it tells about, above everything and kept
  inside the window. It follows its row as the list moves, and glides from one row to the next.
*/
function SessionCard({ el, side, children }: { el: HTMLElement; side: HTMLElement | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const r = el.getBoundingClientRect();
    const left = Math.round((side ?? el).getBoundingClientRect().right + 8);
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const room = vw - EDGE - left;
    // No room beside the sidebar: better none than one over the row.
    card.style.visibility = room < 220 ? "hidden" : "";
    card.style.width = `${Math.min(320, room)}px`;
    card.style.left = `${left}px`;
    const top = Math.round(Math.max(EDGE, Math.min(r.top - 6, vh - EDGE - card.offsetHeight)));
    if (placed.current) card.dataset.glide = "";
    card.style.top = `${top}px`;
    placed.current = true;
  });
  return (
    <div ref={ref} id={CARD_ID} role="tooltip" className="lc-sbc">
      {children}
    </div>
  );
}
