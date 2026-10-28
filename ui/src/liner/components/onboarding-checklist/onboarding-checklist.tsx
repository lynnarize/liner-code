/*
  Liner · Onboarding checklist
  The first few things worth doing, with progress you can see. Each task opens to say why
  and how; finishing one draws its check and moves the ring. When all are done the card
  says so once and can fold itself away.
*/
import { useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss } from "../../lib/overlay";
import { ProgressRing } from "../progress/progress";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./onboarding-checklist.css";

export type ChecklistTask = { id: string; title: string; description?: ReactNode; action?: ReactNode };
export type OnboardingChecklistProps = {
  title?: string;
  tasks: ChecklistTask[];
  done?: string[];
  defaultDone?: string[];
  onDoneChange?: (done: string[]) => void;
  onDismiss?: () => void;
  className?: string;
};

export function OnboardingChecklist({ title = "Get started", tasks, done, defaultDone = [], onDoneChange, onDismiss, className }: OnboardingChecklistProps) {
  const controlled = done !== undefined;
  const [inner, setInner] = useState(defaultDone);
  const finished = controlled ? done : inner;
  const [open, setOpen] = useState<string | null>(() => tasks.find((t) => !finished.includes(t.id))?.id ?? null);
  const all = finished.length === tasks.length;

  const toggle = (id: string) => {
    const was = finished.includes(id);
    const next = was ? finished.filter((x) => x !== id) : [...finished, id];
    if (!controlled) setInner(next);
    onDoneChange?.(next);
    feedback.play(was ? "tap" : next.length === tasks.length ? "success" : "pop", next.length);
    // Move on to the next open task.
    if (!was) setOpen(tasks.find((t) => !next.includes(t.id))?.id ?? null);
  };

  return (
    <section className={cx("l-todo l-frame", className)} data-all={all || undefined} aria-label={title}>
      <header className="l-frame-strip l-todo__head">
        <span className="l-todo__titles">
          <b>{title}</b>
          <span key={finished.length}>{all ? "All set. Nice work." : `${finished.length} of ${tasks.length} done`}</span>
        </span>
        <ProgressRing value={finished.length / tasks.length} size={40} stroke={4} label="Setup progress" />
      </header>
      <ol className="l-frame-card l-todo__list">
        {tasks.map((t) => {
          const isDone = finished.includes(t.id);
          const isOpen = open === t.id;
          return (
            <li key={t.id} className="l-todo__task" data-done={isDone || undefined} data-open={isOpen || undefined}>
              <div className="l-todo__row">
                <button type="button" className="l-todo__box" role="checkbox" aria-checked={isDone} aria-label={`${t.title}: ${isDone ? "done" : "not done"}`} onClick={() => toggle(t.id)}>
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M4 8.4 6.8 11 12 5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button type="button" className="l-todo__title" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.id)}>
                  <span>{t.title}</span>
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className="l-todo__more" inert={!isOpen || undefined}>
                <div className="l-todo__clip">
                  <div className="l-todo__body">
                    {t.description && <p>{t.description}</p>}
                    {t.action}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {all && onDismiss && (
        <div className="l-frame-strip l-todo__foot">
          <span>Everything's ready.</span>
          <button type="button" onClick={onDismiss}>
            Hide checklist
          </button>
        </div>
      )}
    </section>
  );
}

export type ChecklistNudgeProps = Omit<OnboardingChecklistProps, "className"> & {
  /** Where the checklist opens. A nudge low in a sidebar opens upward. */
  side?: "top" | "bottom";
  className?: string;
};

/**
 * The checklist, folded into a card small enough for a sidebar: how many are done, the
 * one to do next, and a thin bar. Pressing it opens the whole checklist on glass.
 */
export function ChecklistNudge({ title = "Getting started", tasks, done, defaultDone = [], onDoneChange, onDismiss, side = "top", className }: ChecklistNudgeProps) {
  const controlled = done !== undefined;
  const [inner, setInner] = useState(defaultDone);
  const finished = controlled ? done : inner;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), [wrap], btn);
  const pct = tasks.length ? Math.round((finished.length / tasks.length) * 100) : 0;
  const next = tasks.find((t) => !finished.includes(t.id));
  return (
    <div ref={wrap} className={cx("l-nudge", className)}>
      <button
        ref={btn}
        type="button"
        className="l-nudge__card l-focus"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          feedback.play("tap", 2);
        }}
      >
        <span className="l-nudge__head">
          <b>{title}</b>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="l-nudge__meta">
          <span className="l-num">
            <RollingNumber value={finished.length} /> of {tasks.length}
          </span>
          <span aria-hidden>·</span>
          <span className="l-nudge__next" key={next?.id ?? "all"}>
            {next ? `Next: ${next.title}` : "All done"}
          </span>
        </span>
        <span className="l-nudge__bar" aria-hidden>
          <i style={{ transform: `scaleX(${pct / 100})` }} />
        </span>
      </button>
      {open && (
        <div className="l-nudge__pop" data-side={side}>
          <OnboardingChecklist
            title={title}
            tasks={tasks}
            done={finished}
            onDoneChange={(d) => {
              if (!controlled) setInner(d);
              onDoneChange?.(d);
            }}
            onDismiss={onDismiss}
            className="l-frame-float"
          />
        </div>
      )}
    </div>
  );
}
