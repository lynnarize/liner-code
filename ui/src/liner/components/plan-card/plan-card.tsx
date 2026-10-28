/*
  Liner · Plan card
  The plan you are on, at a glance: its name and price, when it renews, how much of the
  period is left as a ring, and two ways out of it. Cancelling asks once, in place, then
  says plainly how long you keep it; resuming is one press. Every line that changes comes
  into focus where it was.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Badge } from "../badge/badge";
import { Button } from "../button/button";
import { ProgressRing } from "../progress/progress";
import "./plan-card.css";

export type PlanCardProps = {
  name: string;
  /** Already formatted, like "$49/mo". */
  price: string;
  status?: "active" | "trialing" | "past-due";
  /** "Renews on Nov 12, 2026 · billed monthly". */
  renews?: string;
  /** The date the plan would end if cancelled. */
  periodEnd?: string;
  /** Days left in the period, drawn as a ring. */
  daysLeft?: { days: number; of: number };
  label?: string;
  changeLabel?: string;
  onChange?: () => void;
  onCancel?: () => Promise<void> | void;
  onResume?: () => Promise<void> | void;
  className?: string;
};

const STATUS = { active: ["success", "Active"], trialing: ["accent", "Trial"], "past-due": ["danger", "Past due"] } as const;

export function PlanCard({ name, price, status = "active", renews, periodEnd, daysLeft, label = "Current plan", changeLabel = "Change plan", onChange, onCancel, onResume, className }: PlanCardProps) {
  const [phase, setPhase] = useState<"on" | "confirm" | "working" | "ending" | "resuming">("on");
  const ending = phase === "ending" || phase === "resuming";
  const run = async (next: "ending" | "on", fn?: () => Promise<void> | void) => {
    setPhase(next === "ending" ? "working" : "resuming");
    try {
      await fn?.();
      setPhase(next);
      feedback.play(next === "on" ? "success" : "tap", next === "on" ? 0 : -2);
    } catch {
      setPhase(next === "ending" ? "confirm" : "ending");
    }
  };
  const [tone, word] = ending ? (["warning", periodEnd ? `Ends ${periodEnd.split(",")[0]}` : "Ending"] as const) : STATUS[status];
  return (
    <section className={cx("l-plancard l-frame-solo", className)} data-phase={phase} data-ring={daysLeft ? "" : undefined} aria-label={label}>
      {daysLeft && (
        <div className="l-plancard__ring">
          <ProgressRing value={1 - daysLeft.days / daysLeft.of} size={60} stroke={5} label={`${daysLeft.days} of ${daysLeft.of} days left`}>
            <b className="l-num">{daysLeft.days}</b>
          </ProgressRing>
          <span>days left</span>
        </div>
      )}
      <div className="l-plancard__top">
        <span className="l-plancard__label">{label}</span>
        <Badge size="sm" tone={tone} dot key={word}>
          {word}
        </Badge>
      </div>
      <div className="l-plancard__name">
        <b>{name}</b>
        <span aria-hidden>·</span>
        <span>{price}</span>
      </div>
      <p className="l-plancard__line" key={`line-${ending ? "end" : phase === "confirm" ? "ask" : "on"}`}>
        {phase === "confirm"
          ? `Cancel at the end of this period? You keep ${name}${periodEnd ? ` until ${periodEnd}` : " until it ends"}.`
          : ending
            ? `Cancelled. You keep ${name}${periodEnd ? ` until ${periodEnd}` : " until the period ends"}.`
            : renews}
      </p>
      <div className="l-plancard__actions" key={`act-${phase === "confirm" || phase === "working" ? "confirm" : ending ? "ending" : "on"}`}>
        {phase === "confirm" || phase === "working" ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setPhase("on")} disabled={phase === "working"}>
              Keep {name}
            </Button>
            <Button size="sm" variant="danger" loading={phase === "working"} onClick={() => run("ending", onCancel)}>
              Cancel plan
            </Button>
          </>
        ) : ending ? (
          <Button size="sm" variant="secondary" loading={phase === "resuming"} onClick={() => run("on", onResume)}>
            Resume {name}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={onChange}>
              {changeLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPhase("confirm")}>
              Cancel plan
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
