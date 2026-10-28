/*
  Liner Pro · Agent plan
  The work drawn on one line: yours. A task an agent takes branches off the line in the
  accent, its progress filling the branch while it works; when it needs you it glides back
  onto your line in amber, and a finished one settles on the line with a check. The team
  rides on the glass above: press one of them to pick out their tasks. Live, the tasks come
  from your data and every press is handed to you to carry out.
*/
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx, useSeen } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Button } from "../../components/button/button";
import { RollingNumber } from "../../components/rolling-number/rolling-number";
import { AddGlyph, AskLine, AgentAvatar, Who, sampleAgents, type Agent, type AgentStatus } from "../agents/agents";
import "./agent-plan.css";

export type PlanTask = {
  id: string;
  title: string;
  /** When it is due, as people say it: Today, Fri, Next week. */
  due?: string;
  who?: { name: string; kind?: "person" | "org" };
  /** The agent that has it. Leave it out while the task is only yours. */
  agent?: string;
  /** What the agent is doing, or did, in its own words. */
  note?: string;
  /** How far along it is while the agent works. */
  progress?: [number, number];
  /** Set when the agent hands the task back for you to act on, with what it says after. */
  action?: { label: string; done: string };
  done?: boolean;
  /** What pressing its mark does, when that isn't marking it done or not done. */
  checkLabel?: string;
};

/** One beat of a scripted run: at `at` ms, task `id` takes on `set`. */
export type PlanBeat = { at: number; id: string; set: Partial<PlanTask> };

export type AgentPlanProps = {
  /** Defaults to whose plan it is, like "Ines's plan". */
  title?: string;
  owner?: string;
  /** A quiet line beside the title, like the day. */
  meta?: string;
  agents?: Agent[];
  tasks?: PlanTask[];
  /** Beats to play once the plan is on screen, so it is alive in a demo. */
  script?: PlanBeat[];
  /** Turn the script off. */
  autoPlay?: boolean;
  /** Every change, yours or the script's, with the whole list. */
  onTasksChange?: (tasks: PlanTask[]) => void;
  /** The Add a task line under the plan. Turn it off when a reply bar already sits below it. */
  addTask?: boolean;
  /** What the Add a task line says. */
  addLabel?: string;
  /**
    Live data: the plan shows `tasks` as they are, plays no script, and hands every press to
    the handlers below. Change the tasks and it moves to them.
  */
  live?: boolean;
  /** The action on a task that is back with you. */
  onAct?: (task: PlanTask) => void;
  /** A task's mark. */
  onToggle?: (task: PlanTask) => void;
  /** Giving a task that is only yours to an agent. */
  onGive?: (task: PlanTask, agent: Agent) => void;
  onAdd?: (title: string) => void;
  /** Pressing a task's title. Left out, titles are plain text. */
  onOpen?: (task: PlanTask) => void;
  /** Shown in the card while there are no tasks. */
  empty?: ReactNode;
  className?: string;
};

/** Who holds a task: still only yours, out with an agent, back with you, or done. */
type Hold = "yours" | "out" | "back" | "done";
const holdOf = (t: PlanTask): Hold => (t.done ? "done" : t.action ? "back" : t.agent ? "out" : "yours");

const sampleTasks: PlanTask[] = [
  { id: "t1", title: "Pay the October compute invoice", due: "Today", who: { name: "Nimbus", kind: "org" }, agent: "ledger", note: "Matching usage reports", progress: [5, 7] },
  { id: "t2", title: "Review Tuesday's launch post", due: "Mon", who: { name: "Priya" }, agent: "herald", note: "Suggested 5 edits, in your voice", action: { label: "Review the edits", done: "You kept all 5 edits" } },
  { id: "t3", title: "Write to Theo about pricing", due: "Fri", who: { name: "Theo" } },
  { id: "t4", title: "Ship the session-refresh fix", due: "Today", who: { name: "Noor" }, agent: "forge", note: "Running the checks", progress: [31, 42] },
  { id: "t5", title: "Book the offsite venue", due: "Sat", who: { name: "Harbor Hall", kind: "org" }, agent: "atlas", note: "Booked the terrace room. Rain clears by 10:00", done: true },
];

// A short scripted morning: a fix merges, the invoice comes back for approval, and the open
// task is picked up and drafted.
const sampleScript: PlanBeat[] = [
  { at: 1400, id: "t4", set: { note: "All 42 checks pass. Merging", progress: [42, 42] } },
  { at: 2400, id: "t1", set: { progress: [6, 7] } },
  { at: 3200, id: "t4", set: { done: true, note: "Merged #128 into main", progress: undefined } },
  { at: 4800, id: "t1", set: { note: "All 7 reports match. Ready to pay $18,420.60", progress: undefined, action: { label: "Approve payment", done: "Paid $18,420.60 at 09:32" } } },
  { at: 6400, id: "t3", set: { agent: "herald", note: "Reading your pricing notes" } },
  { at: 10200, id: "t3", set: { note: "Drafted from your notes, in your words", action: { label: "Review the draft", done: "Sent to Theo at 09:48" } } },
];

let seq = 1;

export function AgentPlan({ title, owner = "Ines", meta = "Thursday 22 October", agents = sampleAgents, tasks: initial = sampleTasks, script, autoPlay = true, onTasksChange, addTask = true, addLabel = "Add a task", live = false, onAct, onToggle, onGive, onAdd, onOpen, empty, className }: AgentPlanProps) {
  const [own, setTasks] = useState(initial);
  const tasks = live ? initial : own;
  const play = autoPlay && !live;
  const beats = script ?? (initial === sampleTasks ? sampleScript : []);
  const [focus, setFocus] = useState<string | null>(null);
  const [rootRef, seen] = useSeen<HTMLElement>(play);
  const timers = useRef<number[]>([]);
  // Tasks you have handled yourself; the scripted morning leaves them alone.
  const touched = useRef(new Set<string>());
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);

  const patch = (id: string, p: Partial<PlanTask>) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const auto = (id: string, p: Partial<PlanTask>) => !touched.current.has(id) && patch(id, p);
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The script plays once the plan is on screen; tasks you have handled are left alone.
  useEffect(() => {
    if (!play || !seen) return;
    const ids = beats.map((b) => window.setTimeout(() => auto(b.id, b.set), b.at));
    return () => ids.forEach(clearTimeout);
  }, [play, seen]);
  useEffect(() => {
    if (!live) onTasksChange?.(own);
  }, [own]);

  const count: Record<Hold, number> = { yours: 0, out: 0, back: 0, done: 0 };
  tasks.forEach((t) => count[holdOf(t)]++);
  const statusOf = (id: string): AgentStatus | undefined => {
    const mine = tasks.filter((t) => t.agent === id && !t.done);
    return mine.some((t) => t.action) ? "waiting" : mine.length ? "working" : undefined;
  };

  function toggle(t: PlanTask) {
    feedback.play(t.done ? "tap" : "pop", t.done ? -2 : 5);
    if (live) return onToggle?.(t);
    touched.current.add(t.id);
    patch(t.id, { done: !t.done });
  }
  function act(t: PlanTask) {
    if (!t.action) return;
    if (live) return onAct?.(t);
    touched.current.add(t.id);
    patch(t.id, { done: true, note: t.action.done, action: undefined });
    feedback.play("success");
  }
  // Handing a task over: it branches off to the agent, then comes back for you to read.
  function give(id: string, a: Agent) {
    if (live) {
      const t = tasks.find((x) => x.id === id);
      feedback.play("pop", 3);
      return t && onGive?.(t, a);
    }
    touched.current.add(id);
    patch(id, { agent: a.id, note: "Looking into it", done: false });
    feedback.play("pop", 3);
    later(3400, () => patch(id, { note: "Back with notes on the task", action: { label: "Read the notes", done: "Read, notes kept on the task" } }));
  }
  function add(title: string) {
    if (live) {
      feedback.play("pop", 3);
      return onAdd?.(title);
    }
    const id = `n${seq++}`;
    setTasks((list) => [...list, { id, title, due: "Today" }]);
    feedback.play("pop", 3);
    const a = agents.find((x) => x.id === "atlas") ?? agents[0];
    if (a) later(1300, () => give(id, a));
  }

  return (
    <section ref={rootRef} className={cx("l-aplan l-frame", className)} aria-label={title ?? `${owner}'s plan`}>
      <header className="l-frame-strip l-aplan-top">
        <span className="l-aplan-heading">
          <b>{title ?? `${owner}'s plan`}</b>
          {meta && <span>{meta}</span>}
        </span>
        <span className="l-aplan-team" role="group" aria-label="Pick out one agent's tasks">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              className="l-aplan-mate l-focus"
              aria-pressed={focus === a.id}
              aria-label={`${a.name}, ${a.role}`}
              title={`${a.name} · ${a.role}`}
              onClick={() => {
                setFocus((f) => (f === a.id ? null : a.id));
                feedback.play("tick", 2);
              }}
            >
              <AgentAvatar a={a} size={26} status={statusOf(a.id)} />
            </button>
          ))}
        </span>
      </header>

      <div className="l-frame-card l-aplan-card">
        {/* The counts double as the key to the line: amber on it, accent off it, ink when done. */}
        <p className="l-aplan-sum">
          <span data-k="back">
            <i aria-hidden />
            <RollingNumber value={count.back} />
            <span>
              <span className="l-aplan-long">back </span>with you
            </span>
          </span>
          <span data-k="out">
            <i aria-hidden />
            <RollingNumber value={count.out} />
            <span>
              out<span className="l-aplan-long"> with agents</span>
            </span>
          </span>
          <span data-k="done">
            <i aria-hidden />
            <RollingNumber value={count.done} />
            <span>done</span>
          </span>
        </p>
        {tasks.length === 0 && empty && <div className="l-aplan-empty">{empty}</div>}
        <ol className="l-aplan-list" data-focus={focus || undefined}>
          {tasks.map((t) => {
            const hold = holdOf(t);
            const a = t.agent ? byId[t.agent] : undefined;
            const p = t.progress ? t.progress[0] / t.progress[1] : 0;
            return (
              <li key={t.id} className="l-aplan-task" data-hold={hold} data-dim={(focus && t.agent !== focus) || undefined} style={{ ["--p" as string]: p }}>
                <span className="l-aplan-rail" aria-hidden>
                  <svg className="l-aplan-fork" viewBox="0 0 23.5 12" fill="none">
                    <path d="M.75 0C.75 7 22.75 5 22.75 12" pathLength="1" />
                  </svg>
                  <i className="l-aplan-branch" />
                  <svg className="l-aplan-return" viewBox="0 0 23.5 12" fill="none">
                    <path d="M22.75 0C22.75 7 .75 5 .75 12" />
                  </svg>
                </span>
                <span className="l-aplan-node">
                  {hold === "out" && a ? (
                    <span className="l-aplan-node-in" key="out" title={`${a.name} has it`}>
                      <AgentAvatar a={a} size={24} status="working" />
                    </span>
                  ) : (
                    <button
                      key="mine"
                      type="button"
                      className="l-aplan-check l-focus"
                      aria-pressed={!!t.done}
                      aria-label={t.checkLabel ?? (t.done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`)}
                      title={t.checkLabel}
                      onClick={() => toggle(t)}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden>
                        <path d="M4.6 8.3 7 10.6l4.5-4.9" pathLength="1" />
                      </svg>
                    </button>
                  )}
                </span>
                <div className="l-aplan-body">
                  {onOpen ? (
                    <button type="button" className="l-aplan-title l-aplan-open l-focus" onClick={() => onOpen(t)}>
                      {t.title}
                    </button>
                  ) : (
                    <span className="l-aplan-title">{t.title}</span>
                  )}
                  {a && t.note && (
                    <span className="l-aplan-note">
                      <b>{a.name}</b>{" "}
                      <span key={t.note} className={hold === "out" ? "l-aplan-note-text l-shimmer" : "l-aplan-note-text"}>
                        {t.note}
                      </span>
                      {t.progress && hold === "out" && (
                        <span className="l-aplan-count l-num">
                          {t.progress[0]} of {t.progress[1]}
                        </span>
                      )}
                    </span>
                  )}
                  {hold === "back" && t.action && (
                    <span className="l-aplan-actions">
                      <Button size="sm" variant="secondary" onClick={() => act(t)}>
                        {t.action.label}
                      </Button>
                      <span className="l-aplan-waiting">Back with you</span>
                    </span>
                  )}
                  {hold === "yours" && (
                    <span className="l-aplan-give">
                      <span>Give it to</span>
                      {agents.map((x) => (
                        <button key={x.id} type="button" className="l-aplan-give-to l-focus" title={`${x.name} · ${x.role}`} aria-label={`Give "${t.title}" to ${x.name}`} onClick={() => give(t.id, x)}>
                          <AgentAvatar a={x} size={22} />
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                <span className="l-aplan-side">
                  {t.due && (
                    <span className="l-aplan-due" data-today={t.due === "Today" || undefined}>
                      {t.due}
                    </span>
                  )}
                  {t.who && <Who name={t.who.name} kind={t.who.kind} />}
                </span>
                <span className="l-sr-only">
                  {hold === "out" && a ? `${a.name} has it` : hold === "back" ? "Back with you" : hold === "done" ? "Done" : "Only yours so far"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {addTask && <AskLine icon={<AddGlyph />} placeholder={addLabel} onSubmit={add} />}
    </section>
  );
}
