/*
  The sidebar, on the window's glass. Sessions sit under their project, and a fork under the
  session it came from; each project folds, and so does a session's forks. Pinned and your own
  groups come first. A session stays in its project until you settle it, which puts it out of
  the way under Settled; Snoozed holds it until a time. Those two are shelves docked under the
  list, a tray of two that slides its sessions up when you open one; the list dissolves into
  blur where it runs on past an edge, so nothing draws a line. A project's header carries its
  badge (two letters on a colour of its own). A row is two lines: its title, then who works on
  which model and where it stands. Pointing at a row shows Pin, Snooze and Settle (P, S and D
  from the keyboard); resting on it brings a card beside the sidebar with the rest of its story.
  One white plate marks the open session.
  Below them, the team and the models they run on, a section that folds to its header.
  ⌘-click picks rows and ⇧-click a run of them; with more than one picked, a bar settles, snoozes,
  archives or moves them all at once. Esc lets them go.
*/
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentProfile, ProviderInfo, Thread } from "@contracts";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { appIcon } from "./Addon";
import { I, ModelMark } from "./icons";
import { agentOf, ago, bucketOf, clock, markOf, modelLabel, money, plural, since, statusLine, type Bucket } from "./model";
import { ContextMenu, Disc, ModelTag, Num, PanelHead, Pop, Row, Sep, StatusMark } from "./ui";
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
  onSearch: () => void;
  onHide: () => void;
  /** An app's page of its own (an add-on panel placed "page"), and the one on screen. */
  onApp?: (id: string) => void;
  appOn?: string | null;
  /** The Add-ons page: everything your agents made for Liner Code (DeepSeek Harness's Plugins entry). */
  onAddons?: () => void;
  addonsOn?: boolean;
  /** A new task in Creator mode, its ask for an add-on with a sidebar entry written and not sent. */
  onCreateAddon?: () => void;
};

/** A command's keys for a tip, like " (⌘B)". */
const key = (id: string) => {
  const k = shortcutOf(id);
  return k ? ` (${os.keys(k)})` : "";
};

const NAME: Record<Bucket, string> = { pinned: "Pinned", needs: "Needs you", working: "Working", open: "Open", snoozed: "Snoozed", settled: "Settled" };

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

export function Sidebar({ current, onOpen, onNew, onUsage, onSettings, onAgent, usageOn, onRoutines, routinesOn, onSearch, onHide, onApp, appOn, onAddons, addonsOn, onCreateAddon }: Props) {
  const pages = useEngine((s) => s.addons).filter((a) => a.panel?.place === "page" && a.enabled && !a.removed);
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
  const [query, setQuery] = useState("");
  const [shelf, setShelf] = useState<"snoozed" | "settled" | null>(null);
  // A closing shelf keeps its rows until it has folded away.
  const lastShelf = useRef(shelf);
  if (shelf) lastShelf.current = shelf;
  const shown = shelf ?? lastShelf.current;
  const [shutProjects, toggleProject] = useFolded("lc:sb-shut");
  const [shutForks, toggleForks] = useFolded("lc:sb-shut-forks");
  // The filter field shows from its button, and stays while it holds a filter.
  const [finding, setFinding] = useState(false);
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

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads
      .filter((t) => !t.archived)
      .filter((t) => !q || t.title.toLowerCase().includes(q) || projects.find((p) => p.id === t.projectId)?.name.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [threads, projects, query]);

  const place = (t: Thread): Bucket => bucketOf(t, now);
  const team = agents.filter((a) => a.id !== "demo");
  const working = threads.filter((t) => !t.archived && t.status === "running").length;
  // Routines handed back to you wait on their icon as a dot; otherwise its tip says how many run.
  const handed = runs.filter((r) => r.status === "handed" && !r.test).length;
  const routinesNote = handed ? `${handed} waiting` : routines.length ? `${routines.filter((r) => r.on).length} on` : "";
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

  // Project > session > its forks: every session that isn't pinned, in a group, snoozed or
  // settled, under its project in your projects' order. A fork sits under the session it came
  // from while that one is here too, in the order they were made.
  const tree = useMemo(() => {
    const here = [...byBucket.needs, ...byBucket.working, ...byBucket.open].sort((a, b) => b.updatedAt - a.updatedAt);
    const ids = new Set(here.map((t) => t.id));
    const forks = new Map<string, Thread[]>();
    for (const t of [...here].sort((a, b) => a.createdAt - b.createdAt)) if (t.forkOf && ids.has(t.forkOf)) forks.set(t.forkOf, [...(forks.get(t.forkOf) ?? []), t]);
    const top = here.filter((t) => !(t.forkOf && ids.has(t.forkOf)));
    const known = new Set(projects.map((p) => p.id));
    const sections = [...projects.map((p) => ({ id: p.id, name: p.name, list: top.filter((t) => t.projectId === p.id) })), { id: "", name: "No project", list: top.filter((t) => !known.has(t.projectId)) }]
      .filter((x) => x.list.length > 0)
      .map((x) => ({ ...x, needs: here.filter((t) => (x.id ? t.projectId === x.id : !known.has(t.projectId)) && place(t) === "needs").length }));
    return { sections, forks };
  }, [byBucket, projects]);

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
  }, [current, list, shutProjects, shutForks, renaming, groups]);

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
    const patch =
      what === "pin" ? { pinned: !t.pinned } : what === "settle" ? { done: !settled, unread: false, pinned: false } : what === "snooze" ? { snoozedUntil: at!.getTime() } : { snoozedUntil: null };
    const before = { pinned: t.pinned ?? false, done: t.done ?? false, snoozedUntil: t.snoozedUntil ?? null, unread: t.unread ?? false };
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
    await rpc("thread.update", { id: t.id, wake: { kind, pr: t.pr.number }, snoozedUntil: Date.now() + 30 * 86400000 });
    toast(`Moved ${t.title} to Snoozed`, { description: kind === "checks" ? `Back when the checks on #${t.pr.number} finish` : `Back when someone replies on #${t.pr.number}`, action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, wake: null, snoozedUntil: null }) }, duration: 5000 });
  };
  const newGroup = async (name: string, forThread?: string) => {
    const id = `g${Date.now().toString(36)}`;
    await rpc("groups.save", { groups: [...groups, { id, name }] });
    if (forThread) await rpc("thread.update", { id: forThread, group: id });
  };
  const dropTo = async (id: string, target: string) => {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    if (target === "pinned") return act(t, "pin");
    if (target === "settled") return act(t, "settle");
    if (target === "snoozed") return act(t, "snooze", snoozeTimes()[0].at);
    if (target === "ungroup") return moveTo(t, null);
    if (target.startsWith("group:")) return moveTo(t, target.slice(6));
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
    const before = ts.map((t) => ({ id: t.id, pinned: t.pinned ?? false, done: t.done ?? false, snoozedUntil: t.snoozedUntil ?? null, unread: t.unread ?? false, archived: t.archived ?? false, group: t.group ?? null }));
    clearPicked();
    try {
      await Promise.all(ts.map((t) => rpc("thread.update", { id: t.id, ...patch })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    toast(`${what} ${plural(ts.length, "session")}`, { description: note, action: { label: "Undo", onClick: () => void Promise.all(before.map((b) => rpc("thread.update", b))) }, duration: 5000 });
  };

  const rowKeys = (e: KeyboardEvent, t: Thread) => {
    // ⌘, ⌃ and ⌥ keys are the app's (⌘⇧D opens the Diff), not Pin, Snooze or Settle.
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
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
  busy.current = renaming !== null || picked.size > 0 || menu !== null;
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
    const bucket = place(t);
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
    const state = cardState(t, bucket, on.who, on.leadOn ? lead : undefined, now, run);
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
          <ProjectBadge id={project?.id ?? ""} name={project?.name ?? "No project"} />
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

  // Under its project's own header a row doesn't name the project again; in Pinned, your groups and the shelves it does.
  const row = (t: Thread, bucket: Bucket, forks?: { n: number; open: boolean; toggle: () => void }, inProject = false) => {
    const project = projects.find((p) => p.id === t.projectId);
    const { who, model, ref } = onIt(t, agents, providers);
    const run = t.routine ? runs.find((r) => r.id === t.routine!.run) : undefined;
    // Who, on what, and where it stands: "Forge · Sonnet 5.5 · working". A model on its own is named once.
    const line: { text: string; warn?: boolean } =
      run?.status === "running"
        ? { text: `${run.subject ? `#${run.subject.number}` : "Running"} · step ${run.steps.length}` }
        : t.wake && bucket === "snoozed"
          ? { text: t.wake.kind === "checks" ? `Until the checks on #${t.wake.pr} finish` : `Until someone replies on #${t.wake.pr}` }
          : bucket === "snoozed" && t.snoozedUntil
            ? { text: `Back ${clock(t.snoozedUntil, now)}` }
            : statusLine(t, model === who ? who : `${who} · ${model}`);
    const tone = t.status === "error" && !run ? "danger" : line.warn ? "warn" : undefined;
    // Finished and nothing waits on you, or settled: the title steps back.
    const quiet = bucket === "settled" || (bucket !== "needs" && t.status !== "running" && t.status !== "error" && t.status !== "limited" && t.turns > 0);
    return (
      <div
        key={t.id}
        className="lc-sb-row"
        data-row={t.id}
        data-forks={forks ? "" : undefined}
        data-picked={picked.has(t.id) || undefined}
        data-quiet={quiet || undefined}
        aria-current={t.id === current ? "page" : undefined}
        draggable={renaming !== t.id}
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
          onKeyDown={(e) => (e.key === "Enter" ? (clearPicked(), onOpen(t.id)) : rowKeys(e, t))}
          onDoubleClick={(e) => !(e.metaKey || e.ctrlKey || e.shiftKey) && setRenaming(t.id)}
        >
          {/* The small line on top (T3 Code's card row, sidebar/SidebarThreadRow.tsx): the project
              where it isn't said already, who works and where it stands, and the time. */}
          <span className="lc-sb-s">
            {!inProject && (
              <>
                <ProjectBadge id={project?.id ?? ""} name={project?.name ?? "No project"} small />
                <span className="lc-sb-pj">{project?.name ?? "No project"}</span>
                <span className="lc-sb-dot">·</span>
              </>
            )}
            {/* Keyed on its words, so a new state fades in (and only then). */}
            <span className="lc-sb-st" data-tone={tone}>
              <span key={line.text}>{line.text}</span>
            </span>
            <span className="lc-sb-time">{ago(t.updatedAt, now)}</span>
          </span>
          <span className="lc-sb-h">
            {renaming === t.id ? (
              <input
                className="lc-sb-rename"
                defaultValue={t.title}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                  e.stopPropagation();
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== t.title) void rpc("thread.update", { id: t.id, title: v });
                  setRenaming(null);
                }}
              />
            ) : (
              <b>{t.title}</b>
            )}
            <span className="lc-sb-mk">
              <StatusMark t={t} bucket={bucket} brand={markOf(ref)} />
            </span>
          </span>
        </div>
        <span className="lc-sb-acts">
          <button type="button" className="lc-sb-a l-focus" aria-label={t.pinned ? "Unpin" : "Pin"} title={t.pinned ? "Unpin (P)" : "Pin (P)"} aria-pressed={t.pinned} onClick={() => void act(t, "pin")}>
            <I.pin size={14} />
          </button>
          <Pop label="Snooze until" align="end" width={230} triggerClass="lc-sb-a" trigger={<I.snooze size={14} />}>
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
        {row(t, place(t), kids.length ? { n: kids.length, open: !shut, toggle: () => toggleForks(t.id) } : undefined, true)}
        {kids.length > 0 && !shut && <div className="lc-sb-kids">{kids.map(branch)}</div>}
      </Fragment>
    );
  };

  const section = (b: Bucket) =>
    byBucket[b].length > 0 && (
      <section key={b} className="lc-sb-sec" aria-label={NAME[b]} {...(b === "pinned" ? drop("pinned") : {})}>
        <div className="lc-sb-lab" data-warn={b === "needs" || undefined}>
          {b === "pinned" && <I.pin size={12} />}
          {NAME[b]}
          <span>
            <Num value={byBucket[b].length} />
          </span>
        </div>
        {byBucket[b].map((t) => row(t, b))}
      </section>
    );


  return (
    <nav ref={nav} className="lc-sb" aria-label="Sessions">
      <div className="lc-sb-head" data-drag>
        <span className="lc-brand">Liner Code</span>
        <button type="button" className="lc-ib l-focus" aria-label="Hide the sidebar" title={`Hide the sidebar${key("sidebar")}`} onClick={onHide}>
          <I.sidebar size={16} />
        </button>
      </div>

      {/* Search, and beside it what you start from here: a filter, a project, a session. */}
      <div className="lc-sb-bar">
        <button type="button" className="lc-sb-nav lc-sb-search l-focus" title={`Search${key("commands")}`} onClick={onSearch}>
          <I.search size={16} />
          Search
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Filter sessions" aria-pressed={finding} title="Filter sessions" onClick={() => (finding && setQuery(""), setFinding(!finding))}>
          <I.filter size={16} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Add a project" title={`Add a project${key("open-project")}`} onClick={addProject}>
          <I.folderAdd size={16} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="New session" title={`New session${key("new")}`} onClick={() => onNew()}>
          <I.compose size={16} />
        </button>
      </div>

      {finding && (
        <div className="lc-sb-find" role="search">
          <I.filter size={14} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter sessions" aria-label="Filter sessions" onKeyDown={(e) => e.key === "Escape" && (setQuery(""), setFinding(false))} />
          <Pop label="Your groups" align="end" width={250} triggerClass="lc-ib" trigger={<I.label size={14} />}>
            {(close) => (
              <>
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
                          className="lc-sb-gdel"
                          aria-label={`Remove the ${g.name} group`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void rpc("groups.save", { groups: groups.filter((x) => x.id !== g.id) });
                          }}
                          onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), void rpc("groups.save", { groups: groups.filter((x) => x.id !== g.id) }))}
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
        </div>
      )}

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

      {/* Apps with a page of their own, above the projects: each opens in place of the conversation (DeepSeek Harness's sidebar entry). */}
      {(onAddons || (pages.length > 0 && onApp)) && (
        <section className="lc-sb-apps" aria-label="Apps">
          {/* Add-ons opens a menu under it, as DeepSeek Harness's More does: browse what you have, or create one. */}
          {onAddons && (
            <Pop
              label="Add-ons"
              menu
              width="trigger"
              className="lc-sb-more-pop"
              triggerClass="lc-sb-nav"
              triggerAttrs={{ "aria-current": addonsOn ? "page" : undefined, "data-on": addonsOn || undefined }}
              trigger={
                <>
                  <I.blocks size={14} />
                  <span>Add-ons</span>
                </>
              }
            >
              {(close) => (
                <div className="lc-sb-more">
                  <button type="button" role="menuitem" className="l-focus" onClick={() => (close(), onAddons())}>
                    <I.blocks size={15} />
                    Browse add-ons
                  </button>
                  {onCreateAddon && (
                    <button type="button" role="menuitem" className="l-focus" onClick={() => (close(), onCreateAddon())}>
                      <I.plus size={15} />
                      Create your add-on
                    </button>
                  )}
                </div>
              )}
            </Pop>
          )}
          {pages.length > 0 && onApp && <div className="lc-sb-lab">Apps</div>}
          {onApp && pages.map((a) => {
            const Icon = appIcon(a.panel?.icon);
            return (
              <button key={a.id} type="button" className="lc-sb-nav l-focus" aria-current={appOn === a.id ? "page" : undefined} data-on={appOn === a.id || undefined} onClick={() => onApp(a.id)}>
                <Icon size={14} />
                <span>{a.name}</span>
              </button>
            );
          })}
        </section>
      )}
      <div ref={scroller} className="lc-sb-scroll" data-up={edges.up || undefined} data-down={edges.down || undefined}>
        <div className="lc-sb-inner">
          <span className="lc-sb-plate" aria-hidden style={plate ? { transform: `translate(${plate.x}px, ${plate.y}px)`, width: plate.w, height: plate.h, opacity: 1 } : { opacity: 0 }} />
          {section("pinned")}
          {byGroup.map(({ g, list: ts }) => (
            <section key={g.id} className="lc-sb-sec" aria-label={g.name} {...drop(`group:${g.id}`)}>
              <div className="lc-sb-lab">
                {g.name}
                <span>{ts.length}</span>
              </div>
              {ts.length ? ts.map((t) => row(t, place(t))) : <p className="lc-sb-hint">Drag a session here, or right-click one.</p>}
            </section>
          ))}
          {tree.sections.map((x) => {
            const shut = shutProjects.includes(x.id);
            return (
              <section key={x.id || "none"} className="lc-sb-sec lc-sb-proj" aria-label={x.name}>
                <div className="lc-sb-lab lc-sb-plab">
                  <button type="button" className="lc-sb-pt l-focus" aria-expanded={!shut} title={shut ? "Show its sessions" : "Fold its sessions"} onClick={() => toggleProject(x.id)}>
                    <ProjectBadge id={x.id} name={x.name} />
                    <span>{x.name}</span>
                    <I.chevR size={11} />
                  </button>
                  {x.needs > 0 && (
                    <span className="lc-sb-pneeds" title={`${plural(x.needs, "session")} ${x.needs === 1 ? "needs" : "need"} you`}>
                      <Num value={x.needs} />
                    </span>
                  )}
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
          {/* Empty here, though sessions may still wait on the shelves below. */}
          {(list.length === 0 || (!byBucket.pinned.length && !byGroup.length && !tree.sections.length)) && (
            <p className="lc-sb-empty">
              {list.length === 0
                ? query
                  ? "No session matches that."
                  : "Sessions you start show up here, under their project."
                : query
                  ? "Only snoozed or settled sessions match that, on the shelves below."
                  : "Everything is snoozed or settled, on the shelves below."}
            </p>
          )}
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
              void bulk("Snoozed", { snoozedUntil: at.at.getTime() }, `Back at ${at.note}`);
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

      {/* The two shelves, docked under the list: a tray of two, and the open one's sessions above it. */}
      <div className="lc-sb-dock" data-open={shelf ? "" : undefined}>
        <div className="lc-fold" inert={!shelf || undefined}>
          <div>
            {shown && (
              <section className="lc-sb-shelf" data-shelf={shown} aria-label={NAME[shown]} key={shown}>
                <p className="lc-sb-shelf-note">{shown === "snoozed" ? "Each comes back on its own, when its time comes." : "Out of the way until they're busy again."}</p>
                {byBucket[shown].length ? (
                  byBucket[shown].map((t) => row(t, shown))
                ) : (
                  <p className="lc-sb-hint">{shown === "snoozed" ? "Nothing snoozed. Snooze a session from its row (S), and it comes back by itself." : "Nothing settled. Settle a finished session from its row (D) to put it out of the way."}</p>
                )}
              </section>
            )}
          </div>
        </div>
        <div className="lc-sb-tray" role="group" aria-label="Shelves">
          {(["snoozed", "settled"] as const).map((b) => (
            <button key={b} type="button" className="lc-sb-tab l-focus" aria-pressed={shelf === b} data-empty={byBucket[b].length ? undefined : ""} title={b === "snoozed" ? "Snoozed: back on their own later" : "Settled: low priority, out of the way"} onClick={() => setShelf((x) => (x === b ? null : b))} {...drop(b)}>
              {b === "snoozed" ? <I.snooze size={14} /> : <I.settle size={14} />}
              {NAME[b]}
              <span>
                <Num value={byBucket[b].length} />
              </span>
            </button>
          ))}
        </div>
      </div>

      {(() => {
        const t = card && card.el.isConnected ? threads.find((x) => x.id === card.id && !x.archived) : undefined;
        return t && createPortal(<SessionCard el={card!.el} side={nav.current}>{cardBody(t)}</SessionCard>, document.body);
      })()}

      <ContextMenu at={menu} label={menu ? `Actions for ${menu.t.title}` : "Actions"} onClose={() => setMenu(null)} width={250}>
        {(close) =>
          menu && (
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
              <Row title="Rename" end="F2" onPick={() => (close(), setRenaming(menu.t.id))} />
              <Row title="Export as Markdown" note="Asks, plans, answers and diffs, saved in Downloads" onPick={() => (close(), exportSession(menu.t.id))} />
              <Row title="Archive" onPick={() => (close(), void rpc("thread.update", { id: menu.t.id, archived: true }).then(() => toast(`Archived ${menu.t.title}`, { action: { label: "Undo", onClick: () => void rpc("thread.update", { id: menu.t.id, archived: false }) } })))} />
            </>
          )
        }
      </ContextMenu>

      {/* Along the foot, your places as icons: settings, routines, the team, usage, and you at the end. */}
      <div className="lc-sb-foot">
        <button type="button" className="lc-ib l-focus" aria-label="Settings" title={`Settings (${os.mod},)`} onClick={onSettings}>
          <I.settings size={16} />
        </button>
        <button type="button" className="lc-ib lc-sb-fi l-focus" aria-label={`Routines${routinesNote ? `, ${routinesNote}` : ""}`} aria-pressed={routinesOn} title={`Routines${routinesNote ? ` · ${routinesNote}` : ""}`} onClick={onRoutines}>
          <I.routines size={16} />
          {handed > 0 && <span className="lc-sb-fdot" data-k="warn" />}
        </button>
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
        <button type="button" className="lc-ib l-focus" aria-label="Usage" aria-pressed={usageOn} title="Usage and cost" onClick={onUsage}>
          <I.usage size={16} />
        </button>
        <span className="lc-grow" />
        <button type="button" className="lc-me-av lc-sb-av l-focus" aria-label={`${me}, ${machine}`} title={`${me} · ${machine}`} onClick={tapMe}>
          {initials(me)}
        </button>
      </div>
    </nav>
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

/*
  A project's badge: two letters on a colour of its own, picked from its id so it stays the same.
  The id is hashed (FNV-1a: ids share their first letters, which bunched a plain hash onto a few
  hues) onto the clear arc of the wheel, from green round through blue, violet, pink and red to
  orange, past the yellows and limes that go muddy this deep; white letters read on all of it.
*/
function hueOf(id: string) {
  let h = 0x811c9dc5;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return Math.round((145 + (((h >>> 0) % 1000) / 1000) * 265) % 360);
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
function ProjectBadge({ id, name, small }: { id: string; name: string; small?: boolean }) {
  return (
    <span className="lc-pjb" data-small={small || undefined} data-none={!id || undefined} style={{ "--lc-pjb-h": hueOf(id) } as CSSProperties} aria-hidden>
      {badgeLetters(name)}
    </span>
  );
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
