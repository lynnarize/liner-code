/*
  Liner Pro · Agent sidebar
  The left side of an agent harness, made to sit on glass: sessions grouped by project, and
  the team of agents you open them with.

  - Projects fold open on grid rows; a folded project still says how many need you.
  - Each session wears its state: rays while its agent works, amber when it needs you, a
    check once it is done, a ring while it waits for your first word.
  - One white plate glides to the open session, across projects.
  - Fork from a session's menu (or a right-click): the fork sits under the session it came
    from, joined by a branch line, and opens. Forks of forks stay under the same session.
  - New session from the header, from a project's +, or from an agent's +.
  - Agents say how they stand, worked out from their sessions. New agent opens a dialog:
    pick what it is good at, and its name, model and soul.md fill in.
*/
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { AgentAvatar } from "../agents/agents";
import { Rays } from "../ai-kit/marks";
import { AiMenu } from "../ai-kit/surface";
import { AgentDialog } from "./agent-dialog";
import { agentModels, sampleProjects, sampleTeam, type AgentModel, type AgentSpec, type SessionStatus, type SidebarProject, type SidebarSession } from "./presets";
import "../ai-kit/ai-kit.css";
import "./agent-sidebar.css";

export * from "./presets";

export type AgentSidebarProps = {
  projects?: SidebarProject[];
  defaultProjects?: SidebarProject[];
  /** Every change the sidebar makes: new sessions, forks, renames, archives. */
  onProjectsChange?: (projects: SidebarProject[]) => void;
  agents?: AgentSpec[];
  defaultAgents?: AgentSpec[];
  onAgentsChange?: (agents: AgentSpec[]) => void;
  /** The open session. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string, session: SidebarSession) => void;
  /** Keep a new or edited agent somewhere; throw to keep the dialog open. */
  onSaveAgent?: (agent: AgentSpec, isNew: boolean) => void | Promise<void>;
  models?: AgentModel[];
  /** The top left, like your workspace. */
  header?: ReactNode;
  /** Above the person: usage, a notice. */
  footer?: ReactNode;
  /** The very bottom: who is signed in. */
  user?: ReactNode;
  /** The time label for a new session or fork. Hours and minutes by default. */
  now?: () => string;
  className?: string;
};

type Row = { s: SidebarSession; depth: 0 | 1; forked?: boolean; more?: boolean; from?: SidebarSession };
type Box = { x: number; y: number; w: number; h: number };
type Undo = { session: SidebarSession; project: string; index: number };

const WORD: Record<SessionStatus, string> = { running: "working", waiting: "needs you", done: "done", idle: "new" };
const clock = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
let seq = 1;
const uid = () => `s-${Date.now().toString(36)}-${seq++}`;

/** Roots in order, each followed by every fork that came from it, oldest first. */
function arrange(sessions: SidebarSession[]): Row[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const rootOf = (s: SidebarSession) => {
    let r = s;
    for (let n = 0; r.forkOf && byId.has(r.forkOf) && n < 50; n++) r = byId.get(r.forkOf)!;
    return r;
  };
  const forks = new Map<string, SidebarSession[]>();
  for (const s of sessions) {
    if (!s.forkOf || !byId.has(s.forkOf)) continue;
    const root = rootOf(s).id;
    forks.set(root, [...(forks.get(root) ?? []), s]);
  }
  const rows: Row[] = [];
  for (const s of sessions) {
    if (s.forkOf && byId.has(s.forkOf)) continue;
    const mine = forks.get(s.id) ?? [];
    rows.push({ s, depth: 0, forked: mine.length > 0 });
    mine.forEach((f, i) => rows.push({ s: f, depth: 1, more: i < mine.length - 1, from: byId.get(f.forkOf!) }));
  }
  return rows;
}

/** Where an element sits inside root, in root's own (unzoomed) pixels, net of any scrolling between. */
function boxIn(el: HTMLElement, root: HTMLElement): Box {
  let x = 0;
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== root; ) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const p = n.offsetParent as HTMLElement | null;
    if (p && p !== root) {
      x -= p.scrollLeft;
      y -= p.scrollTop;
    }
    n = p;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export function AgentSidebar({
  projects: projectsProp,
  defaultProjects,
  onProjectsChange,
  agents: agentsProp,
  defaultAgents,
  onAgentsChange,
  value,
  defaultValue,
  onValueChange,
  onSaveAgent,
  models = agentModels,
  header,
  footer,
  user,
  now = clock,
  className,
}: AgentSidebarProps) {
  const [innerProjects, setInnerProjects] = useState(() => defaultProjects ?? sampleProjects);
  const [innerAgents, setInnerAgents] = useState(() => defaultAgents ?? sampleTeam);
  const projects = projectsProp ?? innerProjects;
  const agents = agentsProp ?? innerAgents;
  const [innerValue, setInnerValue] = useState(() => defaultValue ?? projects[0]?.sessions[0]?.id ?? "");
  const selected = value ?? innerValue;
  const [folded, setFolded] = useState(() => new Set(projects.filter((p) => p.folded).map((p) => p.id)));
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<Undo | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; box: Box } | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; agent?: AgentSpec }>({ open: false });
  const [plate, setPlate] = useState<(Box & { on: boolean }) | null>(null);
  const [focusTo, setFocusTo] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const root = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);

  const commit = (next: SidebarProject[]) => {
    if (!projectsProp) setInnerProjects(next);
    onProjectsChange?.(next);
  };
  const commitAgents = (next: AgentSpec[]) => {
    if (!agentsProp) setInnerAgents(next);
    onAgentsChange?.(next);
  };
  const select = (s: SidebarSession) => {
    if (value === undefined) setInnerValue(s.id);
    onValueChange?.(s.id, s);
  };
  const say = (text: string) => setAnnounce(text);

  const live = projects.flatMap((p) => p.sessions).filter((s) => !leaving.has(s.id));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const nameOf = (id: string) => agentById.get(id)?.name ?? id;
  const projectOf = (id: string) => projects.find((p) => p.sessions.some((s) => s.id === id));
  const waiting = live.filter((s) => s.status === "waiting").length;
  const stateOf = (id: string) => {
    const mine = live.filter((s) => s.agent === id);
    return mine.some((s) => s.status === "waiting") ? "waiting" : mine.some((s) => s.status === "running") ? "running" : "free";
  };

  // The plate follows the open session as rows open, close, arrive and leave.
  useIsoLayoutEffect(() => {
    const sc = scroller.current;
    const content = inner.current;
    if (!sc || !content) return;
    const measure = () => {
      const row = sc.querySelector<HTMLElement>(`[data-row="${CSS.escape(selected)}"]`);
      if (!row || row.closest("[data-folded]") || row.hasAttribute("data-leaving")) return setPlate((p) => (p ? { ...p, on: false } : p));
      setPlate({ x: row.offsetLeft, y: row.offsetTop, w: row.offsetWidth, h: row.offsetHeight, on: true });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [selected, projects, folded, leaving, renaming]);

  // A menu stays with its row: scrolling or resizing closes it.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const sc = scroller.current;
    sc?.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      sc?.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // A new session or fork takes focus, so the keyboard carries on from it (F2 names it).
  useEffect(() => {
    if (!focusTo) return;
    root.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(focusTo)}"] .l-asb-pick`)?.focus();
    setFocusTo(null);
  }, [focusTo]);

  // Undo waits six seconds, then the archive is kept.
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const unfold = (id: string) =>
    setFolded((f) => {
      if (!f.has(id)) return f;
      const n = new Set(f);
      n.delete(id);
      return n;
    });
  const arrive = (id: string) => {
    setFresh((f) => new Set(f).add(id));
    setFocusTo(id);
  };

  function newSession(projectId?: string, agentId?: string) {
    const project = projects.find((p) => p.id === projectId) ?? projectOf(selected) ?? projects[0];
    if (!project) return;
    const agent = agentId ?? project.agent ?? project.sessions[0]?.agent ?? agents[0]?.id ?? "";
    const s: SidebarSession = { id: uid(), title: "New session", agent, status: "idle", time: now() };
    commit(projects.map((p) => (p.id === project.id ? { ...p, sessions: [s, ...p.sessions] } : p)));
    unfold(project.id);
    arrive(s.id);
    select(s);
    say(`New session with ${nameOf(agent)} in ${project.name}`);
    feedback.play("pop", 3);
  }

  function fork(from: SidebarSession) {
    const project = projectOf(from.id);
    if (!project) return;
    const s: SidebarSession = { id: uid(), title: from.title, agent: from.agent, status: "idle", time: now(), forkOf: from.id };
    commit(projects.map((p) => (p.id === project.id ? { ...p, sessions: [...p.sessions, s] } : p)));
    unfold(project.id);
    arrive(s.id);
    select(s);
    say(`Forked ${from.title}. The fork is open`);
    feedback.play("pop", 5);
  }

  function rename(id: string, title: string) {
    setRenaming(null);
    const t = title.trim();
    const s = live.find((x) => x.id === id);
    if (!s || !t || t === s.title) return;
    commit(projects.map((p) => ({ ...p, sessions: p.sessions.map((x) => (x.id === id ? { ...x, title: t } : x)) })));
    say(`Renamed to ${t}`);
  }

  function archive(s: SidebarSession) {
    // The open session hands over to its neighbour in the list before it goes.
    if (s.id === selected) {
      const order = projects.filter((p) => !folded.has(p.id)).flatMap((p) => arrange(p.sessions).map((r) => r.s)).filter((x) => !leaving.has(x.id));
      const i = order.findIndex((x) => x.id === s.id);
      const next = order[i + 1] ?? order[i - 1];
      if (next) select(next);
    }
    setLeaving((l) => new Set(l).add(s.id));
    feedback.play("tap", -2);
  }
  function gone(s: SidebarSession) {
    const project = projectOf(s.id);
    setLeaving((l) => {
      const n = new Set(l);
      n.delete(s.id);
      return n;
    });
    if (!project) return;
    setUndo({ session: s, project: project.id, index: project.sessions.findIndex((x) => x.id === s.id) });
    commit(projects.map((p) => (p.id === project.id ? { ...p, sessions: p.sessions.filter((x) => x.id !== s.id) } : p)));
    say(`Archived ${s.title}. Undo is below the projects`);
  }
  function restore() {
    if (!undo) return;
    const { session, project, index } = undo;
    commit(projects.map((p) => (p.id === project ? { ...p, sessions: [...p.sessions.slice(0, index), session, ...p.sessions.slice(index)] } : p)));
    unfold(project);
    arrive(session.id);
    setUndo(null);
    say(`${session.title} is back`);
  }

  function openMenu(s: SidebarSession) {
    const sc = root.current;
    const btn = sc?.querySelector<HTMLElement>(`[data-more="${CSS.escape(s.id)}"]`);
    if (!sc || !btn) return;
    menuAnchor.current = btn;
    setMenu({ id: s.id, box: boxIn(btn, sc) });
  }

  function rowKeys(e: KeyboardEvent<HTMLButtonElement>, s: SidebarSession) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      const all = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(".l-asb-pick") ?? []).filter((b) => !b.closest("[data-folded]"));
      const i = all.indexOf(e.currentTarget);
      const to = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : i + (e.key === "ArrowDown" ? 1 : -1);
      if (all[to]) {
        e.preventDefault();
        all[to].focus();
      }
    } else if (e.key === "F2") {
      e.preventDefault();
      setRenaming(s.id);
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openMenu(s);
    }
  }

  const menuSession = menu ? live.find((s) => s.id === menu.id) : undefined;

  return (
    <nav ref={root} className={cx("l-asb", className)} aria-label="Sessions and agents">
      <div className="l-asb-head">
        <div className="l-asb-brand">{header}</div>
        <button type="button" className="l-asb-new l-plate l-focus" aria-label="New session" title="New session" onClick={() => newSession()}>
          <Glyph name="compose" />
        </button>
      </div>

      <div ref={scroller} className="l-asb-scroll">
        <span className="l-asb-plate" aria-hidden style={plate ? { transform: `translate(${plate.x}px, ${plate.y}px)`, width: plate.w, height: plate.h, opacity: plate.on ? 1 : 0 } : undefined} />
        <div ref={inner} className="l-asb-inner">
          <section className="l-asb-sec" aria-label="Projects">
            <h3 className="l-asb-label">
              Projects
              {waiting > 0 && (
                <span key={waiting} data-tone="warn">
                  {waiting} {waiting === 1 ? "needs" : "need"} you
                </span>
              )}
            </h3>
            {projects.map((p) => {
              const isFolded = folded.has(p.id);
              const mine = p.sessions.filter((s) => !leaving.has(s.id));
              const need = mine.filter((s) => s.status === "waiting").length;
              return (
                <div key={p.id} className="l-asb-project" data-folded={isFolded || undefined}>
                  <div className="l-asb-proj-head">
                    <button
                      type="button"
                      className="l-asb-proj l-focus"
                      aria-expanded={!isFolded}
                      onClick={() =>
                        setFolded((f) => {
                          const n = new Set(f);
                          if (n.has(p.id)) n.delete(p.id);
                          else n.add(p.id);
                          return n;
                        })
                      }
                    >
                      <Glyph name="chev" />
                      <span className="l-asb-proj-name">{p.name}</span>
                      {isFolded && mine.length > 0 && (
                        <span className="l-asb-proj-count l-num" data-tone={need ? "warn" : undefined} aria-label={need ? `${need} need you` : `${mine.length} sessions`}>
                          {need || mine.length}
                        </span>
                      )}
                    </button>
                    <button type="button" className="l-asb-proj-add l-plate l-focus" aria-label={`New session in ${p.name}`} title={`New session in ${p.name}`} onClick={() => newSession(p.id)}>
                      <Glyph name="plus" />
                    </button>
                  </div>
                  <div className="l-asb-fold" inert={isFolded || undefined}>
                    <div className="l-asb-clip">
                      <div className="l-asb-rows">
                        {arrange(p.sessions).map((r) => {
                          const s = r.s;
                          const out = leaving.has(s.id);
                          const current = s.id === selected;
                          const word = s.status === "idle" && s.forkOf ? "fork" : WORD[s.status];
                          return (
                            <div
                              key={s.id}
                              data-row={s.id}
                              className="l-asb-row"
                              data-depth={r.depth}
                              data-forked={(r.forked && !out) || undefined}
                              data-more={r.more || undefined}
                              data-current={current || undefined}
                              data-fresh={fresh.has(s.id) || undefined}
                              data-leaving={out || undefined}
                              onAnimationEnd={(e) => e.animationName === "l-asb-out" && e.target === e.currentTarget && gone(s)}
                              onContextMenu={(e: MouseEvent) => {
                                e.preventDefault();
                                openMenu(s);
                              }}
                            >
                              {renaming === s.id ? (
                                <div className="l-asb-pick" data-editing>
                                  <StatusMark status={s.status} />
                                  <input
                                    className="l-asb-rename"
                                    defaultValue={s.title}
                                    aria-label={`Rename ${s.title}`}
                                    autoFocus
                                    onFocus={(e) => e.currentTarget.select()}
                                    onBlur={(e) => rename(s.id, e.currentTarget.value)}
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter" && e.key !== "Escape") return;
                                      e.preventDefault();
                                      if (e.key === "Enter") rename(s.id, e.currentTarget.value);
                                      else setRenaming(null);
                                      setFocusTo(s.id);
                                    }}
                                  />
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="l-asb-pick"
                                  aria-current={current ? "page" : undefined}
                                  aria-label={`${s.title}, ${nameOf(s.agent)}, ${word}${r.from ? `, forked from ${r.from.title}` : ""}`}
                                  onClick={() => select(s)}
                                  onKeyDown={(e) => rowKeys(e, s)}
                                >
                                  <StatusMark status={s.status} />
                                  <span className="l-asb-text">
                                    <b>{s.title}</b>
                                    <span>
                                      {nameOf(s.agent)} ·{" "}
                                      <span key={word} data-status={s.status}>
                                        {word}
                                      </span>
                                    </span>
                                  </span>
                                  <time className="l-num">{s.time}</time>
                                </button>
                              )}
                              {renaming !== s.id && (
                                <button
                                  type="button"
                                  data-more={s.id}
                                  className="l-asb-more l-plate"
                                  aria-label={`More for ${s.title}`}
                                  aria-haspopup="menu"
                                  aria-expanded={menu?.id === s.id}
                                  tabIndex={current ? 0 : -1}
                                  onClick={() => (menu?.id === s.id ? setMenu(null) : openMenu(s))}
                                >
                                  <Glyph name="more" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {undo && (
              <div className="l-asb-undo" key={undo.session.id}>
                <span>
                  Archived <b>{undo.session.title}</b>
                </span>
                <button type="button" className="l-focus" onClick={restore}>
                  Undo
                </button>
              </div>
            )}
          </section>

          <section className="l-asb-sec" aria-label="Agents">
            <h3 className="l-asb-label">Agents</h3>
            <ul className="l-asb-agents">
              {agents.map((a) => {
                const st = stateOf(a.id);
                const word = st === "waiting" ? "Needs you" : st === "running" ? "Working" : "Free";
                return (
                  <li key={a.id} className="l-asb-agent" data-state={st} data-fresh={fresh.has(a.id) || undefined}>
                    <button type="button" className="l-asb-agent-pick" aria-label={`${a.name}, ${a.role}, ${word}. Edit`} onClick={() => setDialog({ open: true, agent: a })}>
                      <AgentAvatar a={a} size={24} status={st === "waiting" ? "waiting" : st === "running" ? "working" : undefined} />
                      <span className="l-asb-agent-name">
                        <b>{a.name}</b>
                        <span>{a.role}</span>
                      </span>
                      <span className="l-asb-agent-state" key={st}>
                        {word}
                      </span>
                    </button>
                    <button type="button" className="l-asb-agent-add l-plate l-focus" aria-label={`New session with ${a.name}`} title={`New session with ${a.name}`} onClick={() => newSession(undefined, a.id)}>
                      <Glyph name="plus" />
                    </button>
                  </li>
                );
              })}
              <li>
                <button type="button" className="l-asb-agent-new" onClick={() => setDialog({ open: true })}>
                  <span aria-hidden>
                    <Glyph name="plus" />
                  </span>
                  New agent
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>

      {(footer || user) && (
        <div className="l-asb-foot">
          {footer}
          {user}
        </div>
      )}

      {menu && menuSession && (
        <div className="l-asb-menu-at" style={{ left: menu.box.x, top: menu.box.y, width: menu.box.w, height: menu.box.h }}>
          <AiMenu
            label={`${menuSession.title} actions`}
            place="end"
            below
            anchor={menuAnchor}
            items={[
              { id: "fork", label: "Fork", note: "A copy to take elsewhere", icon: <Glyph name="fork" /> },
              { id: "rename", label: "Rename", icon: <Glyph name="rename" /> },
              { id: "archive", label: "Archive", note: "You can undo it", icon: <Glyph name="archive" /> },
            ]}
            onClose={() => setMenu(null)}
            onPick={(it) => {
              setMenu(null);
              if (it.id === "fork") fork(menuSession);
              else if (it.id === "rename") setRenaming(menuSession.id);
              else archive(menuSession);
            }}
          />
        </div>
      )}

      <AgentDialog
        open={dialog.open}
        agent={dialog.agent}
        models={models}
        taken={agents.filter((a) => a.id !== dialog.agent?.id).map((a) => a.name)}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSave={async (spec) => {
          const isNew = !dialog.agent;
          await onSaveAgent?.(spec, isNew);
          commitAgents(isNew ? [...agents, spec] : agents.map((a) => (a.id === spec.id ? spec : a)));
          if (isNew) arrive(spec.id);
          say(isNew ? `${spec.name} joined the team` : `Saved ${spec.name}`);
          feedback.play("success");
        }}
      />

      <span className="l-sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </nav>
  );
}

/** Rays while working, amber when it needs you, a check once done, a ring while new. */
function StatusMark({ status }: { status: SessionStatus }) {
  return (
    <span className="l-asb-mark" data-status={status} key={status} aria-hidden>
      {status === "running" ? (
        <Rays />
      ) : status === "waiting" ? (
        <i />
      ) : status === "done" ? (
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M4.4 8.4 6.9 10.9l4.7-5.2" pathLength="1" />
        </svg>
      ) : (
        <b />
      )}
    </span>
  );
}

const glyphPaths = {
  compose: <path d="M7.5 2.75H4.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V8.5M11.4 2.6l2 2-4.8 4.8-2.6.6.6-2.6 4.8-4.8Z" />,
  plus: <path d="M8 3.75v8.5M3.75 8h8.5" />,
  chev: <path d="M6.25 4.5 9.75 8l-3.5 3.5" />,
  more: (
    <>
      <circle cx="3.75" cy="8" r=".6" />
      <circle cx="8" cy="8" r=".6" />
      <circle cx="12.25" cy="8" r=".6" />
    </>
  ),
  fork: (
    <>
      <circle cx="5" cy="3.75" r="1.5" />
      <circle cx="5" cy="12.25" r="1.5" />
      <circle cx="11" cy="5.25" r="1.5" />
      <path d="M5 5.25v5.5M11 6.75c0 2.25-1.5 3.25-4.6 3.9" />
    </>
  ),
  rename: <path d="m10.2 3.3 2.5 2.5-6.9 6.9-3 .5.5-3 6.9-6.9Z" />,
  archive: <path d="M2.75 3.75h10.5v2.5H2.75zM3.75 6.25v6a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1v-6M6.5 8.75h3" />,
};

function Glyph({ name }: { name: keyof typeof glyphPaths }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="l-asb-glyph" data-glyph={name}>
      {glyphPaths[name]}
    </svg>
  );
}
