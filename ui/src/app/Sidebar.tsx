/*
  The sidebar, on the window's glass. Sessions sit under their project, and a fork under the
  session it came from; each project folds, and so does a session's forks. Pinned and your own
  groups come first. A session stays in its project until you settle it, which puts it out of
  the way under Settled; Snoozed holds it until a time. Those two are shelves docked under the
  list, a tray of two that slides its sessions up when you open one; the list dissolves into
  blur where it runs on past an edge, so nothing draws a line. Pointing at a row shows Pin,
  Snooze and Settle (P, S and D from the keyboard). One white plate glides to the open session.
  Below them, the team and the models they run on, a section that folds to its header.
*/
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentProfile, Thread } from "@contracts";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, ago, bucketOf, clock, markOf, modelLabel, plural, statusLine, type Bucket } from "./model";
import { ContextMenu, Disc, ModelTag, Num, PanelHead, Pop, Row, Sep, StatusMark } from "./ui";
import { shortcutOf } from "./keymap";
import { TextMorph } from "@liner/components/text-morph/text-morph";
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
};

/** A command's keys for a tip, like " (⌘B)". */
const key = (id: string) => {
  const k = shortcutOf(id);
  return k ? ` (${k.join("")})` : "";
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

export function Sidebar({ current, onOpen, onNew, onUsage, onSettings, onAgent, usageOn, onRoutines, routinesOn, onSearch, onHide }: Props) {
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
  const [shutTeam, toggleTeam] = useFolded("lc:sb-shut-team");
  const teamOpen = !shutTeam.includes("team");
  // Which edges the list runs on past, for the blur that dissolves it there.
  const [edges, setEdges] = useState({ up: false, down: false });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const [plate, setPlate] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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

  const rowKeys = (e: KeyboardEvent, t: Thread) => {
    if (e.target !== e.currentTarget) return;
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

  // Under its project's own header a row doesn't name the project again; in Pinned, your groups and the shelves it does.
  const row = (t: Thread, bucket: Bucket, forks?: { n: number; open: boolean; toggle: () => void }, inProject = false) => {
    const project = projects.find((p) => p.id === t.projectId);
    const who = agentOf(t.agent, agents, providers).name;
    const run = t.routine ? runs.find((r) => r.id === t.routine!.run) : undefined;
    const line =
      run?.status === "running"
        ? { text: `${run.subject ? `#${run.subject.number}` : "Running"} · step ${run.steps.length}` }
        : t.wake && bucket === "snoozed"
          ? { text: t.wake.kind === "checks" ? `Until the checks on #${t.wake.pr} finish` : `Until someone replies on #${t.wake.pr}` }
          : bucket === "snoozed" && t.snoozedUntil
            ? { text: `Back ${clock(t.snoozedUntil, now)}` }
            : statusLine(t, t.lead && t.turns === 0 ? agentOf(t.lead, agents, providers).name : who);
    return (
      <div
        key={t.id}
        className="lc-sb-row"
        data-row={t.id}
        data-forks={forks ? "" : undefined}
        aria-current={t.id === current ? "page" : undefined}
        draggable={renaming !== t.id}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-liner-session", t.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ t, x: e.clientX, y: e.clientY });
        }}
      >
        <div role="button" tabIndex={0} className="lc-sb-pick l-focus" onClick={() => onOpen(t.id)} onKeyDown={(e) => (e.key === "Enter" ? onOpen(t.id) : rowKeys(e, t))} onDoubleClick={() => setRenaming(t.id)}>
          <span className="lc-sb-mk">
            <StatusMark t={t} bucket={bucket} />
          </span>
          <span className="lc-sb-t">
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
              <span className="lc-sb-time">{ago(t.updatedAt, now)}</span>
            </span>
            <span className="lc-sb-s" data-warn={line.warn || undefined}>
              {!inProject && <span className="lc-sb-pj">{project?.name ?? "No project"} · </span>}
              {/* The line morphs from one state to the next: shared letters slide, the rest come into focus. */}
              <TextMorph>{line.text}</TextMorph>
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
          {NAME[b]}
          <span>
            <Num value={byBucket[b].length} />
          </span>
        </div>
        {byBucket[b].map((t) => row(t, b))}
      </section>
    );


  return (
    <nav className="lc-sb" aria-label="Sessions">
      <div className="lc-sb-head" data-drag>
        <span className="lc-brand">Liner Code</span>
        <button type="button" className="lc-ib l-focus" aria-label="Hide the sidebar" title={`Hide the sidebar${key("sidebar")}`} onClick={onHide}>
          <I.sidebar size={16} />
        </button>
      </div>

      {/* Where you go from anywhere: a new session, your routines, and the command menu. */}
      <div className="lc-sb-go">
        <button type="button" className="lc-sb-nav l-focus" onClick={() => onNew()}>
          <I.compose size={16} />
          New session
          <span className="lc-grow" />
          <span className="lc-sb-key">{shortcutOf("new")?.join("")}</span>
        </button>
        <button type="button" className="lc-sb-nav l-focus" aria-current={routinesOn ? "page" : undefined} onClick={onRoutines}>
          <I.routines size={16} />
          Routines
          <span className="lc-grow" />
          {runs.some((r) => r.status === "handed" && !r.test) ? (
            <span className="lc-sb-navw">{runs.filter((r) => r.status === "handed" && !r.test).length} waiting</span>
          ) : (
            routines.length > 0 && <span className="lc-sb-key">{routines.filter((r) => r.on).length} on</span>
          )}
        </button>
        <button type="button" className="lc-sb-nav l-focus" onClick={onSearch}>
          <I.search size={16} />
          Search
          <span className="lc-grow" />
          <span className="lc-sb-key">{shortcutOf("commands")?.join("")}</span>
        </button>
      </div>

      <div className="lc-sb-find" role="search">
        <I.filter size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter sessions" aria-label="Filter sessions" onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
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
                  <button type="button" className="lc-sb-pt l-focus" aria-expanded={!shut} onClick={() => toggleProject(x.id)}>
                    <I.chevR size={11} />
                    <span>{x.name}</span>
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
          {list.length === 0 && <p className="lc-sb-empty">{query ? "No session matches that." : "Sessions you start show up here, under their project."}</p>}
        </div>
        <div className="lc-sb-blur" aria-hidden />
      </div>

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

      <section className="lc-sb-team" data-open={teamOpen || undefined} aria-label="Team">
        <div className="lc-sb-team-head">
          <button type="button" className="lc-sb-team-t l-focus" aria-expanded={teamOpen} onClick={() => toggleTeam("team")}>
            <I.agents size={14} />
            Team
            {working > 0 && <span className="lc-sb-team-dot" title={`${plural(working, "session")} at work`} />}
            <span className="lc-sb-team-n">
              <Num value={team.length} />
            </span>
            <I.chevU size={11} />
          </button>
          <button type="button" className="lc-sb-add l-focus" aria-label="New agent" title="New agent" onClick={() => onAgent()}>
            <I.plus size={12} />
          </button>
        </div>
        <div className="lc-fold" inert={!teamOpen || undefined}>
          <div>
            <div className="lc-sb-team-list">
              {team.map((a) => (
                <button key={a.id} type="button" className="lc-sb-agent l-focus" onClick={() => onAgent(a)} title={`Edit ${a.name}`}>
                  <Disc agent={a} size={24} />
                  <span className="lc-sb-agent-t">
                    <span>{a.name}</span>
                    <small>{a.role}</small>
                  </span>
                  <ModelTag kind={markOf(a.model)} label={modelLabel(a.model, providers)} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="lc-sb-me" onClick={(e) => (e.target as HTMLElement).closest("button") || tapMe()}>
        <span className="lc-me-av">{initials(window.__LINER__?.user ?? "You")}</span>
        <span className="lc-me-t">
          <span>{window.__LINER__?.user ?? "You"}</span>
          <small>{window.__LINER__?.machine ?? "This computer"}</small>
        </span>
        <button type="button" className="lc-ib l-focus" aria-label="Usage" aria-pressed={usageOn} title="Usage and cost" onClick={onUsage}>
          <I.usage size={15} />
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Settings" title="Settings (⌘,)" onClick={onSettings}>
          <I.settings size={15} />
        </button>
      </div>
    </nav>
  );
}

/** Saves a session as Markdown in Downloads, and says where with a way to show it. */
export function exportSession(threadId: string) {
  void rpc("thread.export", { id: threadId }).then(
    ({ path }) => toast.success("Saved as Markdown", { description: path.replace(/^\/Users\/[^/]+/, "~"), action: { label: "Show", onClick: () => bridge.reveal(path) } }),
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
