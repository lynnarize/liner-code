/*
  The sidebar, in Liner 2.0: no colour but a session's state, no boxes, space between its parts.
  On top, New session (search at its end) and Routines; then Add-ons, its ··· holding New add-on
  (a session in Workshop) and Add-on settings, with your apps under it. Then the list, and above it
  what it shows: All projects (Pinned, Active, your groups, Finished: two lines a session, its
  project's letters in grey, a dot on them while it works or waits, its project and state under
  its title) or By folder (a session a line under its project's folder, a fork under the session
  it came from), or one of the places a session is put away: Snoozed, Settled and Archive. Sort,
  your groups and a new project sit beside it; the filter field under it. The list takes all the
  room down to the foot and dissolves where it runs on past an edge, so nothing draws a line.
  Pointing at a row shows Pin, Snooze and Settle (P, S and D from the keyboard); resting on it
  brings a card beside the sidebar with the rest of its story. One plate marks the open session.
  ⌘-click picks rows and ⇧-click a run of them; with more than one picked, a bar settles, snoozes,
  archives or moves them all at once. Esc lets them go.
*/
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentProfile, ProviderInfo, Thread } from "@contracts";
import { bridge } from "./bridge";
import { isSubagent, itemsWhere, rpc, useEngine } from "./engine";
import { appIcon } from "./Addon";
import { I, ModelMark } from "./icons";
import { agentOf, ago, bucketOf, clock, markOf, modelLabel, money, onTheWall, plural, since, type Bucket } from "./model";
import { ContextMenu, Disc, LimitRow, ModelTag, Num, PanelHead, Pop, Row, Sep, StatusMark } from "./ui";
import { appNotice, updates } from "./Updates";
import { agentState, updateModes } from "@contracts";
import { shortcutOf } from "./keymap";
import * as os from "./os";
import { toast } from "@liner/components/toast/toast";

type Props = {
  current: string | null;
  onOpen: (id: string) => void;
  onNew: (projectId?: string) => void;
  onUsage: () => void;
  onSettings: () => void;
  onAgent: (agent?: AgentProfile) => void;
  usageOn: boolean;
  onRoutines: () => void;
  routinesOn: boolean;
  /** The Wall: every session at once. */
  onWall?: () => void;
  wallOn?: boolean;
  onSearch: () => void;
  onHide: () => void;
  /** An app's page of its own (an add-on panel placed "page"), and the one on screen. */
  onApp?: (id: string) => void;
  appOn?: string | null;
  /** The Add-ons page: everything your agents made for Liner Code (DeepSeek Harness's Plugins entry). */
  onAddons?: () => void;
  addonsOn?: boolean;
  /** A new task in Workshop, its ask for an add-on with a sidebar entry written and not sent. */
  onCreateAddon?: () => void;
  /** Opens a session beside the one on screen. */
  onBeside?: (id: string) => void;
  /** A session was archived from here: if it's on screen, the window moves off it. */
  onPutAway?: (id: string) => void;
};

/** A command's keys for a tip, like " (⌘B)". */
const key = (id: string) => {
  const k = shortcutOf(id);
  return k ? ` (${os.keys(k)})` : "";
};

/** What the list shows: every project's sessions by how they stand, by folder, or a place they're put away in. */
type View = "all" | "folder" | "snoozed" | "settled" | "archive";
const VIEWS: Record<View, string> = { all: "All projects", folder: "By folder", snoozed: "Snoozed", settled: "Settled", archive: "Archive" };
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

/**
  Waits on you, wherever you keep it: a pinned session or one in your groups as well, the way the
  Dock's count takes it (App). Snoozed and settled ones are put away, so they don't.
*/
export const waitsOnYou = (t: Thread, now = Date.now()) => bucketOf(t.pinned ? { ...t, pinned: false } : t, now) === "needs";
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

export function Sidebar({ current, onOpen, onNew, onWall, wallOn, onUsage, onSettings, onAgent, usageOn, onRoutines, routinesOn, onSearch, onHide, onApp, appOn, onAddons, addonsOn, onCreateAddon, onBeside, onPutAway }: Props) {
  const addons = useEngine((s) => s.addons);
  const pages = addons.filter((a) => a.panel?.place === "page" && a.enabled && !a.removed);
  const limits = useEngine((s) => s.limits);
  const update = useEngine((s) => s.updates);
  const updateMode = useEngine((s) => updateModes(s.settings).app);
  const threads = useEngine((s) => s.threads);
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
  const [query, setQuery] = useState("");
  const [view, setView] = useStored<View>("lc:sb-view", "all", ["all", "folder", "snoozed", "settled", "archive"]);
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
  // Rows picked for one action on them all, and where a ⇧-click's run starts (T3 Code: threadSelectionStore.ts).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  // Six taps on your name within a few seconds show the Demo, or hide it again.
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  const taps = useRef<number[]>([]);
  const tapMe = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length < 6) return;
    taps.current = [];
    void rpc("settings.save", { showDemo: !showDemo });
    toast(showDemo ? "The Demo is hidden" : "The Demo is on", { description: showDemo ? "Tap your name six times to bring it back." : "Demo run is in Who works on this, and the sample project on Home." });
  };

  // Times and snoozes move on their own.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  // Latest activity first, or the newest session first.
  const newest = (a: Thread, b: Thread) => (order === "started" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  const matches = (t: Thread, q: string) => !q || t.title.toLowerCase().includes(q) || projects.find((p) => p.id === t.projectId)?.name.toLowerCase().includes(q);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => !t.archived && matches(t, q)).sort(newest);
  }, [threads, projects, query, order]);
  const archivedList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => t.archived && matches(t, q)).sort(newest);
  }, [threads, projects, query, order]);
  const projectName = (t: Thread) => projects.find((p) => p.id === t.projectId)?.name ?? "No project";

  const place = (t: Thread): Bucket => bucketOf(t, now);
  const team = agents.filter((a) => a.id !== "demo");
  const working = threads.filter((t) => !t.archived && t.status === "running").length;
  // Routines handed back to you wait on their icon as a dot; otherwise its tip says how many run.
  const handed = runs.filter((r) => r.status === "handed" && !r.test).length;
  const routinesNote = handed ? `${handed} waiting` : routines.length ? `${routines.filter((r) => r.on).length} on` : "";
  // The Wall's row: how many sessions are on it, and a dot while one asks, failed or hit a limit.
  const onWallNow = threads.filter((t) => onTheWall(t, now));
  const wallWaits = onWallNow.filter((t) => t.status === "waiting" || t.status === "error" || t.status === "limited").length;
  const me = window.__LINER__?.user ?? "You";
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
  // All projects: what waits on you and what's at work, together, ahead of what's finished.
  const active = useMemo(() => [...byBucket.needs, ...byBucket.working].sort(newest), [byBucket, order]);

  // Project > session > its forks: every session that isn't pinned, in a group, snoozed or
  // settled, under its project in your projects' order. A fork sits under the session it came
  // from while that one is here too, in the order they were made.
  const tree = useMemo(() => {
    const here = [...byBucket.needs, ...byBucket.working, ...byBucket.open].sort(newest);
    const ids = new Set(here.map((t) => t.id));
    const forks = new Map<string, Thread[]>();
    for (const t of [...here].sort((a, b) => a.createdAt - b.createdAt)) if (t.forkOf && ids.has(t.forkOf)) forks.set(t.forkOf, [...(forks.get(t.forkOf) ?? []), t]);
    const top = here.filter((t) => !(t.forkOf && ids.has(t.forkOf)));
    const known = new Set(projects.map((p) => p.id));
    const sections = [...projects.map((p) => ({ id: p.id, name: p.name, list: top.filter((t) => t.projectId === p.id) })), { id: "", name: "No project", list: top.filter((t) => !known.has(t.projectId)) }]
      .filter((x) => x.list.length > 0)
      .map((x) => ({ ...x, needs: here.filter((t) => (x.id ? t.projectId === x.id : !known.has(t.projectId)) && place(t) === "needs").length }));
    return { sections, forks };
  }, [byBucket, projects, order]);

  // The plate follows the open session as rows arrive, leave and fold.
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    // Measured from the list's own box, since a fork's row sits inside its parent's indent.
    const measure = () => {
      const inner = sc.firstElementChild as HTMLElement;
      const row = current ? sc.querySelector<HTMLElement>(`[data-row="${CSS.escape(current)}"]`) : null;
      if (!row) return setPlate(null);
      const a = inner.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      setPlate({ x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc.firstElementChild as HTMLElement);
    return () => ro.disconnect();
  }, [current, list, archivedList, view, shutProjects, shutForks, renaming, groups]);

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
  }, []);

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
    const mine = [...byBucket.needs, ...byBucket.working, ...byBucket.open].filter((t) => (projectId ? t.projectId === projectId : !known.has(t.projectId)));
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
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = [...((e.currentTarget as HTMLElement).closest(".lc-sb")?.querySelectorAll<HTMLElement>(".lc-sb-pick") ?? [])];
      const i = rows.indexOf(e.currentTarget as HTMLElement);
      rows[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      e.preventDefault();
    } else return;
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
    const lead = t.lead ? agentOf(t.lead, agents, providers).name : undefined;
    // "Helm plans, Forge builds on Sonnet 5.5"; "Forge on Sonnet 5.5"; a model on its own is named once.
    const builds = coder.name === model ? model : `${coder.name}${lead ? " builds" : ""} on ${model}`;
    const team = lead ? `${lead} plans, ${coder.name === model ? `${model} builds` : builds}` : builds;
    const run = t.routine ? runs.find((r) => r.id === t.routine!.run) : undefined;
    const sentNow = sent.get(t.id) ?? 0;
    const said = cardState(t, bucket, on.who, on.leadOn ? lead : undefined, now, run);
    const state = sentNow ? { ...said, text: `${said.text} with ${plural(sentNow, "agent")}` } : said;
    const changes = [(t.toReview ?? 0) > 0 ? `${plural(t.toReview!, "file")} changed, not committed` : "", t.pr ? `pull request #${t.pr.number}${t.pr.state ? `, ${t.pr.state.toLowerCase()}` : ""}` : ""].filter(Boolean).join(" · ");
    const u = t.usage;
    const ctx = u?.contextTokens && u.contextWindow ? Math.round((u.contextTokens / u.contextWindow) * 100) : null;
    const last = [`Last move ${agoLong(t.updatedAt, now)}`, ctx !== null ? `${ctx}% of context` : "", u?.costUsd ? money(u.costUsd) : ""].filter(Boolean).join(" · ");
    // ⌘1 to ⌘9 go down the sidebar as it shows (App's sidebarOrder).
    const n = [...document.querySelectorAll<HTMLElement>(".lc-side .lc-sb-row[data-row]")].filter((r) => !r.closest(".lc-fold[inert]")).findIndex((r) => r.dataset.row === t.id) + 1;
    return (
      <>
        <p className="lc-sbc-title">{t.title}</p>
        <p className="lc-sbc-where">
          <ProjectBadge name={project?.name ?? "No project"} none={!project} />
          <span className="lc-sbc-pj">{project?.name ?? "No project"}</span>
          {branch && (
            <>
              <span className="lc-sbc-dot">·</span>
              <span className="lc-sbc-branch">
                <I.branch size={11} />
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
            <ModelMark kind={markOf(ref)} size={13} />
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

  /*
    A session's row. Two lines in All projects and the places sessions are put away: its project's
    letters (a dot on them while it works or waits), its title with the maker's mark at the end,
    and under it its project, how it stands and how long ago. One line under its folder: the title,
    and at its end how it stands. The rest is in the card a resting pointer brings.
  */
  const row = (t: Thread, shelf: Bucket, opts: { two?: boolean; forks?: { n: number; open: boolean; toggle: () => void } } = {}) => {
    const { two, forks } = opts;
    // Pinned is where it's kept, not how it stands: one that waits on you shows it, as the Dock counts it.
    const bucket = standing(t, shelf, now);
    const on = onIt(t, agents, providers);
    const { ref } = on;
    const run = t.routine ? runs.find((r) => r.id === t.routine!.run) : undefined;
    // Finished and nothing waits on you, or settled: the title steps back.
    const quiet = Boolean(t.archived) || bucket === "settled" || (bucket !== "needs" && t.status !== "running" && t.status !== "error" && t.status !== "limited" && t.turns > 0);
    const busy = t.status === "running" || t.status === "error" || t.status === "limited" || bucket === "needs" || run?.status === "running";
    const title =
      renaming === t.id ? (
        <input
          className="lc-sb-rename"
          aria-label={`Rename ${t.title}`}
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
            setRenaming(null);
          }}
        />
      ) : (
        <b>{t.title}</b>
      );
    const working = sent.get(t.id) ?? 0;
    const state = two ? (working ? { text: `${on.who} + ${plural(working, "agent")}` } : rowState(t, bucket, Boolean(on.leadOn && t.lead), now, run)) : null;
    const dot = t.archived ? undefined : t.status === "running" || run?.status === "running" || (working && bucket !== "needs") ? "work" : t.status === "error" ? "danger" : bucket === "needs" || t.status === "limited" ? "warn" : undefined;
    return (
      <div
        key={t.id}
        className="lc-sb-row"
        data-row={t.id}
        data-two={two || undefined}
        data-forks={forks ? "" : undefined}
        data-picked={picked.has(t.id) || undefined}
        data-quiet={quiet || undefined}
        aria-current={t.id === current ? "page" : undefined}
        draggable={renaming !== t.id && !t.archived}
        onDragStart={(e) => {
          hideCard();
          e.dataTransfer.setData("text/x-liner-session", t.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        // A mouse at rest over the row: not a touch, and no button held (a drag, a selection).
        onPointerEnter={(e) => e.pointerType === "mouse" && e.buttons === 0 && pointAt(t.id, e.currentTarget)}
        onPointerLeave={leaveRow}
        onPointerDown={hideCard}
        onContextMenu={(e) => {
          e.preventDefault();
          hideCard();
          setMenu({ t, x: e.clientX, y: e.clientY });
        }}
      >
        <div
          role="button"
          tabIndex={0}
          className="lc-sb-pick l-focus"
          aria-pressed={picked.size ? picked.has(t.id) : undefined}
          aria-describedby={card?.id === t.id ? CARD_ID : undefined}
          // ⇧ would select the text between the rows; the run is the selection here.
          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) return togglePick(t.id);
            if (e.shiftKey) return pickRun(t.id);
            // A plain click opens the session, and lets go of any picked rows.
            clearPicked();
            onOpen(t.id);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return rowKeys(e, t);
            e.preventDefault();
            clearPicked();
            onOpen(t.id);
          }}
          onDoubleClick={(e) => !(e.metaKey || e.ctrlKey || e.shiftKey) && setRenaming(t.id)}
        >
          {two ? (
            <>
              <ProjectBadge name={projectName(t)} none={!projects.some((p) => p.id === t.projectId)} dot={dot} />
              <span className="lc-sb-tx">
                <span className="lc-sb-h">
                  {title}
                  <span className="lc-sb-lead">
                    <ModelMark kind={markOf(ref)} size={12} />
                  </span>
                </span>
                <span className="lc-sb-s">
                  <span className="lc-sb-st">
                    {projectName(t)}
                    {state && (
                      <>
                        {" · "}
                        <span data-tone={state.tone}>{state.text}</span>
                      </>
                    )}
                  </span>
                  <span className="lc-sb-time">{ago(t.updatedAt, now)}</span>
                </span>
              </span>
            </>
          ) : (
            <span className="lc-sb-h">
              {title}
              {/* Working, waiting or stuck shows its mark; anything else, how long ago. */}
              {busy ? (
                <span className="lc-sb-mk">
                  <StatusMark t={t} bucket={bucket} brand={markOf(ref)} />
                </span>
              ) : (
                <span className="lc-sb-time">{ago(t.updatedAt, now)}</span>
              )}
            </span>
          )}
        </div>
        <span className="lc-sb-acts">
          {t.archived ? (
            <button type="button" className="lc-sb-a l-focus" aria-label="Bring it back" title="Bring it back from Archive" onClick={() => void unarchive(t)}>
              <I.undo size={14} />
            </button>
          ) : (
            <>
              <button type="button" className="lc-sb-a l-focus" aria-label={t.pinned ? "Unpin" : "Pin"} title={t.pinned ? "Unpin (P)" : "Pin (P)"} aria-pressed={Boolean(t.pinned)} onClick={() => void act(t, "pin")}>
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
                          void act(t, "snooze", s.at);
                        }}
                      />
                    ))}
                    {t.pr && t.pr.state === "OPEN" && (
                      <>
                        <Sep />
                        <PanelHead>Or until</PanelHead>
                        <Row title="Checks finish" end={`#${t.pr.number}`} onPick={() => (close(), void wake(t, "checks"))} />
                        <Row title="Someone replies" end={`#${t.pr.number}`} onPick={() => (close(), void wake(t, "reply"))} />
                      </>
                    )}
                    {t.snoozedUntil && t.snoozedUntil > now && (
                      <>
                        <Sep />
                        <Row
                          title="Wake it now"
                          onPick={() => {
                            close();
                            void act(t, "wake");
                          }}
                        />
                      </>
                    )}
                  </>
                )}
              </Pop>
              <button type="button" className="lc-sb-a l-focus" aria-label={bucket === "settled" ? "Bring it back" : "Settle"} aria-pressed={bucket === "settled"} title={bucket === "settled" ? "Bring it back (D)" : "Settle (D)"} onClick={() => void act(t, "settle")}>
                <I.settle size={14} />
              </button>
            </>
          )}
        </span>
        {forks && (
          <button type="button" className="lc-sb-forks l-focus" aria-expanded={forks.open} aria-label={`${plural(forks.n, "fork")} of ${t.title}`} title={forks.open ? "Fold its forks" : "Show its forks"} onClick={forks.toggle}>
            <I.chevR size={10} />
            <I.fork size={11} />
            {forks.n}
          </button>
        )}
      </div>
    );
  };

  /** A session with its forks under it, and theirs under them. */
  const branch = (t: Thread): ReactNode => {
    const kids = tree.forks.get(t.id) ?? [];
    const shut = shutForks.includes(t.id);
    return (
      <Fragment key={t.id}>
        {row(t, place(t), { forks: kids.length ? { n: kids.length, open: !shut, toggle: () => toggleForks(t.id) } : undefined })}
        {kids.length > 0 && !shut && <div className="lc-sb-kids">{kids.map(branch)}</div>}
      </Fragment>
    );
  };

  /** A labelled run of rows, with how many there are. */
  const block = (name: string, ts: Thread[], two: boolean, extra: { pin?: boolean; bucket?: Bucket } = {}) =>
    ts.length > 0 && (
      <section key={name} className="lc-sb-sec" aria-label={name} {...(extra.pin ? drop("pinned") : {})}>
        <div className="lc-sb-lab">
          {extra.pin && <I.pin size={12} />}
          {name}
          <span>
            <Num value={ts.length} />
          </span>
        </div>
        {ts.map((t) => row(t, extra.bucket ?? place(t), { two }))}
      </section>
    );
  const groupBlocks = (two: boolean) =>
    byGroup.map(({ g, list: ts }) => (
      <section key={g.id} className="lc-sb-sec" aria-label={g.name} {...drop(`group:${g.id}`)}>
        <div className="lc-sb-lab">
          {g.name}
          <span>{ts.length}</span>
        </div>
        {ts.length ? ts.map((t) => row(t, place(t), { two })) : <p className="lc-sb-hint">Drag a session here, or right-click one.</p>}
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
  const q = query.trim();
  const listed: Record<View, number> = {
    all: byBucket.pinned.length + byGroup.length + active.length + byBucket.open.length,
    folder: byBucket.pinned.length + byGroup.length + tree.sections.length,
    snoozed: byBucket.snoozed.length,
    settled: byBucket.settled.length,
    archive: archivedList.length,
  };
  const empty =
    listed[view] > 0
      ? null
      : q
        ? none(<I.search size={20} />, "No session matches that", view === "all" || view === "folder" ? "Try fewer words, or look in Settled or Archive." : `Nothing in ${VIEWS[view]} matches it.`)
        : view === "snoozed"
          ? none(<I.snooze size={20} />, "Nothing snoozed", "Snooze a session from its row (S), and it comes back by itself.")
          : view === "settled"
            ? none(<I.settle size={20} />, "Nothing settled", "Settle a finished session from its row (D) to put it out of the way.")
            : view === "archive"
              ? none(<I.box size={20} />, "Nothing archived", "Archive a session from its right-click menu. It waits here until you bring it back.")
              : list.length === 0
                ? none(<I.compose size={20} />, "No sessions yet", "Start one with New session, and it shows up here.")
                : none(<I.settle size={20} />, "Nothing open", "Every session is snoozed or settled. Pick either from the menu above.");


  return (
    <nav ref={nav} className="lc-sb" aria-label="Sessions">
      <div className="lc-sb-head" data-drag>
        <span className="lc-brand">Liner Code</span>
        <button type="button" className="lc-ib l-focus" aria-label="Hide the sidebar" title={`Hide the sidebar${key("sidebar")}`} onClick={onHide}>
          <I.sidebar size={16} />
        </button>
      </div>

      {/* Your places, one row each: New session (search at its end), Routines and Add-ons. */}
      <div className="lc-sb-top">
        <div className="lc-sb-navrow">
          <button type="button" className="lc-sb-nav l-focus" title={`New session${key("new")}`} onClick={() => onNew()}>
            <I.compose size={16} />
            <span>New session</span>
            {shortcutOf("new") && <kbd className="lc-sb-kbd">{os.keys(shortcutOf("new")!)}</kbd>}
          </button>
          <button type="button" className="lc-ib l-focus" aria-label="Search sessions, projects and commands" title={`Search${key("commands")}`} onClick={onSearch}>
            <I.search size={16} />
          </button>
        </div>
        {onWall && (
          <button
            type="button"
            className="lc-sb-nav l-focus"
            aria-current={wallOn ? "page" : undefined}
            aria-label={`The Wall, ${plural(onWallNow.length, "session")}${wallWaits ? `, ${wallWaits} waiting on you` : ""}`}
            title={`The Wall: every session at once${key("wall")}`}
            onClick={onWall}
          >
            <I.wall size={16} />
            <span>The Wall</span>
            {wallWaits > 0 && <span className="lc-sb-ndot" data-k="warn" />}
            {onWallNow.length > 0 && <span className="lc-sb-nend">{onWallNow.length}</span>}
          </button>
        )}
        <button type="button" className="lc-sb-nav l-focus" aria-current={routinesOn ? "page" : undefined} aria-label={`Routines${routinesNote ? `, ${routinesNote}` : ""}`} title={`Routines${routinesNote ? ` · ${routinesNote}` : ""}`} onClick={onRoutines}>
          <I.routines size={16} />
          <span>Routines</span>
          {handed > 0 ? <span className="lc-sb-ndot" data-k="warn" /> : routines.some((r) => r.on) && <span className="lc-sb-nend">{routinesNote}</span>}
        </button>
      </div>

      {/* Add-ons, apart from your places: its ··· makes a new one or opens their settings, and your apps sit under it (DeepSeek Harness's sidebar entry). */}
      {(onAddons || (pages.length > 0 && onApp)) && (
        <section className="lc-sb-apps" aria-label="Add-ons">
          <div className="lc-sb-lab">
            Add-ons
            {onAddons && (
              <Pop label="Add-ons" menu align="end" width={250} className="lc-sb-labpop" triggerClass="lc-sb-add" triggerAttrs={{ "aria-current": addonsOn ? "page" : undefined, title: "Add-ons: connections, panels and apps" }} trigger={<I.more size={14} />}>
                {(close) => (
                  <div className="lc-sb-menu">
                    {onCreateAddon && <Row title="New add-on" note="Starts a session in Workshop" icon={<I.plus size={13} />} onPick={() => (close(), onCreateAddon())} />}
                    <Row title="Add-on settings" note="Connections, panels and apps" icon={<I.settings size={13} />} onPick={() => (close(), onAddons())} />
                  </div>
                )}
              </Pop>
            )}
          </div>
          {onApp &&
            pages.map((a) => {
              const Icon = appIcon(a.panel?.icon);
              return (
                <button key={a.id} type="button" className="lc-sb-nav l-focus" aria-current={appOn === a.id ? "page" : undefined} onClick={() => onApp(a.id)}>
                  <Icon size={16} />
                  <span>{a.name}</span>
                </button>
              );
            })}
        </section>
      )}

      {/* What the list shows, how it's sorted and a new project; the filter under them. */}
      <div className="lc-sb-views">
        <div className="lc-sb-bar">
          <Pop label={`What the list shows: ${VIEWS[view]}`} menu width={236} triggerClass="lc-sb-view" trigger={<>{VIEWS[view]}<I.chevD size={11} /></>}>
            {(close) => {
              const pick = (v: View) => () => (close(), setView(v));
              return (
                <div className="lc-sb-menu">
                  <Row title="All projects" icon={<I.list size={13} />} keepIcon on={view === "all"} onPick={pick("all")} />
                  <Row title="By folder" icon={<I.folder size={13} />} keepIcon on={view === "folder"} onPick={pick("folder")} />
                  <Sep />
                  {(byBucket.snoozed.length > 0 || view === "snoozed") && <Row title="Snoozed" icon={<I.snooze size={13} />} keepIcon on={view === "snoozed"} end={byBucket.snoozed.length || undefined} onPick={pick("snoozed")} />}
                  <Row title="Settled" icon={<I.settle size={13} />} keepIcon on={view === "settled"} end={byBucket.settled.length || undefined} onPick={pick("settled")} />
                  <Row title="Archive" icon={<I.box size={13} />} keepIcon on={view === "archive"} end={archivedList.length || undefined} onPick={pick("archive")} />
                </div>
              );
            }}
          </Pop>
          <span className="lc-grow" />
          <Pop label="Sort and groups" align="end" width={250} triggerClass="lc-ib" triggerAttrs={{ title: "Sort, and your groups" }} trigger={<I.sort size={14} />}>
            {(close) => (
              <>
                <PanelHead>Sort by</PanelHead>
                <Row title="Last activity" on={order === "activity"} onPick={() => (close(), setOrder("activity"))} />
                <Row title="Date started" on={order === "started"} onPick={() => (close(), setOrder("started"))} />
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
                          <I.close size={10} />
                        </span>
                      </span>
                    }
                    onPick={close}
                  />
                ))}
                <Row title="New group" icon={<I.plus size={13} />} onPick={() => (close(), setNaming({}))} />
              </>
            )}
          </Pop>
          <button type="button" className="lc-ib l-focus" aria-label="Add a project" title={`Add a project${key("open-project")}`} onClick={addProject}>
            <I.plus size={14} />
          </button>
        </div>
        <div className="lc-sb-find" role="search">
          <I.search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter sessions" aria-label="Filter sessions" onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))} />
          {query && (
            <button type="button" className="lc-ib l-focus" aria-label="Clear the filter" title="Clear the filter (Esc)" onClick={() => setQuery("")}>
              <I.close size={12} />
            </button>
          )}
        </div>
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
        <div className="lc-sb-inner">
          <span className="lc-sb-plate" aria-hidden style={plate ? { transform: `translate(${plate.x}px, ${plate.y}px)`, width: plate.w, height: plate.h, opacity: 1 } : { opacity: 0 }} />
          {view === "all" && (
            <>
              {block("Pinned", byBucket.pinned, true, { pin: true, bucket: "pinned" })}
              {block("Active", active, true)}
              {groupBlocks(true)}
              {block("Finished", byBucket.open, true, { bucket: "open" })}
            </>
          )}
          {view === "folder" && (
            <>
              {block("Pinned", byBucket.pinned, false, { pin: true, bucket: "pinned" })}
              {groupBlocks(false)}
              {tree.sections.map((x) => {
                const shut = shutProjects.includes(x.id);
                return (
                  <section key={x.id || "none"} className="lc-sb-sec lc-sb-proj" aria-label={x.name}>
                    <div className="lc-sb-lab lc-sb-plab" onContextMenu={(e) => (e.preventDefault(), setProjMenu({ id: x.id, name: x.name, x: e.clientX, y: e.clientY }))}>
                      <button type="button" className="lc-sb-pt l-focus" aria-expanded={!shut} title={shut ? "Show its sessions" : "Fold its sessions"} onClick={() => toggleProject(x.id)}>
                        <span className="lc-sb-picon">
                          <I.folder size={16} />
                        </span>
                        <span>{x.name}</span>
                        <I.chevR size={11} />
                      </button>
                      {x.needs > 0 && (
                        <span className="lc-sb-pneeds" title={`${plural(x.needs, "session")} ${x.needs === 1 ? "needs" : "need"} you`}>
                          <Num value={x.needs} />
                        </span>
                      )}
                      <button type="button" className="lc-sb-add l-focus" aria-label={`Settle the finished sessions in ${x.name}`} title="Settle the project: its finished sessions go to Settled" onClick={() => void settleProject(x.id, x.name)}>
                        <I.settle size={12} />
                      </button>
                      {x.id && (
                        <button type="button" className="lc-sb-add l-focus" aria-label={`New session in ${x.name}`} title="New session here" onClick={() => onNew(x.id)}>
                          <I.plus size={12} />
                        </button>
                      )}
                    </div>
                    {!shut && x.list.map(branch)}
                  </section>
                );
              })}
            </>
          )}
          {view === "snoozed" && block("Snoozed", byBucket.snoozed, true, { bucket: "snoozed" })}
          {view === "settled" && block("Settled", byBucket.settled, true, { bucket: "settled" })}
          {view === "archive" && block("Archive", archivedList, true)}
          {empty}
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
            <I.close size={13} />
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
              {projMenu.id && <Row title="New session here" icon={<I.plus size={13} />} onPick={() => (close(), onNew(projMenu.id))} />}
              <Row title="Settle the project" note="Its finished sessions go to Settled" icon={<I.settle size={13} />} onPick={() => (close(), void settleProject(projMenu.id, projMenu.name))} />
              <Row title={shutProjects.includes(projMenu.id) ? "Show its sessions" : "Fold its sessions"} icon={<I.chevD size={13} />} onPick={() => (close(), toggleProject(projMenu.id))} />
            </>
          )
        }
      </ContextMenu>

      <ContextMenu at={menu} label={menu ? `Actions for ${menu.t.title}` : "Actions"} onClose={() => setMenu(null)} width={250}>
        {(close) =>
          menu && (
            <>
              {onBeside && current && current !== menu.t.id && <Row title="Open beside" note="Next to the session on screen" icon={<I.split size={13} />} onPick={() => (close(), onBeside(menu.t.id))} />}
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
                  <Row title="New group" icon={<I.plus size={13} />} onPick={() => (close(), setNaming({ forThread: menu.t.id }))} />
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

      {/* A new Liner Code, ready or on its way: a card over the foot, until it goes in or you put it away (until a newer one). */}
      {(() => {
        const n = updateMode !== "off" && update.dismissed.app !== update.app.latest && (update.app.state === "ready" || update.app.state === "downloading") ? appNotice(update.app) : null;
        if (!n) return null;
        const busy = working > 0 && update.app.state === "ready" ? ` ${plural(working, "session")} ${working === 1 ? "is" : "are"} working.` : "";
        return (
          <div className="lc-sb-update" role="status">
            <I.download size={15} />
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

      {/* Along the foot: you, then the team, your plans' limits and Settings. */}
      <div className="lc-sb-foot">
        <button type="button" className="lc-sb-me l-focus" aria-label={`${me}, ${machine}`} title={`${me} · ${machine}`} onClick={tapMe}>
          <span className="lc-me-av lc-sb-av">{initials(me)}</span>
          <span className="lc-sb-me-n">{me}</span>
        </button>
        <span className="lc-grow" />
        <Pop
          label={`Team, ${team.length}${working > 0 ? `, ${plural(working, "session")} at work` : ""}`}
          side="top"
          width={300}
          triggerClass="lc-ib lc-sb-fi"
          trigger={
            <>
              <I.agents size={16} />
              {working > 0 && <span className="lc-sb-fdot" />}
            </>
          }
        >
          {(close) => (
            <>
              <PanelHead>Team · {team.length}</PanelHead>
              <div className="lc-sb-team-list">
                {team.map((a) => (
                  <button key={a.id} type="button" className="lc-sb-agent l-focus" onClick={() => (close(), onAgent(a))} title={`Edit ${a.name}`}>
                    <Disc agent={a} size={24} />
                    <span className="lc-sb-agent-t">
                      <span>{a.name}</span>
                      <small>{a.role}</small>
                    </span>
                    <ModelTag kind={markOf(a.model)} label={modelLabel(a.model, providers)} />
                  </button>
                ))}
              </div>
              <Sep />
              <Row title="New agent" icon={<I.plus size={13} />} onPick={() => (close(), onAgent())} />
            </>
          )}
        </Pop>
        <PlanLimits tools={limits.filter((l) => l.windows.length)} usageOn={usageOn} onUsage={onUsage} />
        <button type="button" className="lc-ib l-focus" aria-label="Settings" title={`Settings (${os.mod},)`} onClick={onSettings}>
          <I.settings size={16} />
        </button>
      </div>
    </nav>
  );
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
          <Row title="Usage and cost" icon={<I.usage size={13} />} onPick={() => (close(), onUsage())} />
        </div>
      )}
    </Pop>
  );
}

/** Saves a session as Markdown in Downloads, and says where with a way to show it. */
export function exportSession(threadId: string) {
  void rpc("thread.export", { id: threadId }).then(
    ({ path }) => toast.success("Saved as Markdown", { description: os.tilde(path), action: { label: "Show", onClick: () => bridge.reveal(path) } }),
    (e: Error) => toast.error(e.message),
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Who's on a session now (the lead while it plans and its plan waits on you, else the coder), and the model they run on. */
function onIt(t: Thread, agents: AgentProfile[], providers: ProviderInfo[]) {
  const leadOn = Boolean(t.lead && (t.turns === 0 || t.turnBy === t.lead));
  const a = agentOf(leadOn ? t.lead : t.agent, agents, providers);
  // A thread's own model stands in for its coder's; a lead keeps its own.
  const ref = leadOn ? a.model : (t.model ?? a.model);
  return { who: a.name, model: modelLabel(ref, providers), ref, leadOn };
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
/**
  A project's badge: its two letters in grey (Liner 2.0 has no colour per item). On a session's
  row it carries a dot while the session works (the accent), waits on you (warn) or stopped short
  (danger).
*/
function ProjectBadge({ name, none, dot }: { name: string; none?: boolean; dot?: "work" | "warn" | "danger" }) {
  return (
    <span className="lc-pjb" data-none={none || undefined} aria-hidden>
      {badgeLetters(name)}
      {dot && <span className="lc-pjb-dot" data-k={dot} />}
    </span>
  );
}

/** How a session stands, said short after its project on its row's second line: nothing when it's simply done. */
function rowState(t: Thread, bucket: Bucket, lead: boolean, now: number, run?: { status: string }): { text: string; tone?: "warn" | "danger" } | null {
  if (t.archived) return null;
  if (run?.status === "running" || t.status === "running") return { text: "working" };
  if (bucket === "snoozed") return t.wake ? { text: t.wake.kind === "checks" ? `until #${t.wake.pr}'s checks finish` : `until a reply on #${t.wake.pr}` } : t.snoozedUntil ? { text: `until ${clock(t.snoozedUntil, now)}` } : null;
  if (t.status === "waiting") return { text: lead ? "plan waits for your OK" : "waits for your answer", tone: "warn" };
  if (t.status === "error") return { text: "ran into a problem", tone: "danger" };
  if (t.status === "limited") return { text: "hit its plan's limit", tone: "warn" };
  if (t.turns === 0) return { text: "not started" };
  if (t.unread) return { text: "answered while you were away", tone: "warn" };
  return null;
}

/** "just now", "4 min ago", "2 hours ago", "yesterday". */
const agoLong = (at: number, now: number) => {
  const m = Math.floor((now - at) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : since(at, now);
};

/** How a session stands, in the card: the row's words, said in full. */
function cardState(t: Thread, bucket: Bucket, who: string, lead: string | undefined, now: number, run?: { status: string; steps: unknown[]; subject?: { number: number } }): { text: string; tone?: "warn" | "danger" } {
  if (run?.status === "running") return { text: `Working · a routine's run${run.subject ? ` on #${run.subject.number}` : ""}, step ${run.steps.length}` };
  if (bucket === "snoozed") {
    if (t.wake) return { text: t.wake.kind === "checks" ? `Snoozed · back when the checks on #${t.wake.pr} finish` : `Snoozed · back when someone replies on #${t.wake.pr}` };
    if (t.snoozedUntil) return { text: `Snoozed · back ${clock(t.snoozedUntil, now)}` };
  }
  if (t.status === "running") {
    if (t.goal?.status === "active") return { text: `Working · ${who} works toward its goal, turn ${t.goal.turns} of ${t.goal.max}` };
    return { text: lead ? `Working · ${lead} draws up a plan` : `Working · ${who} is at it` };
  }
  if (t.status === "waiting") return { text: lead ? `Needs you · ${lead}'s plan waits for your OK` : `Needs you · ${who} waits for your answer`, tone: "warn" };
  if (t.status === "error") return { text: `Ran into a problem · ${who} stopped short`, tone: "danger" };
  if (t.status === "limited") return { text: `Limited · ${who}'s plan ran out${t.limit?.until ? `, back at ${clock(t.limit.until, now)}` : ""}`, tone: "warn" };
  if (t.turns === 0) return { text: "Not started · nothing asked yet" };
  if (t.unread) return { text: `Needs you · ${who} answered while you were away`, tone: "warn" };
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
