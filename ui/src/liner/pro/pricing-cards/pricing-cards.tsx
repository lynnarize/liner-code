/*
  Liner Pro · Pricing cards
  Plans side by side with what each includes. Above them, the period, and for plans priced
  per seat, how many seats: every figure rolls as either changes, so the total for your
  team is always on the card. The plan you are on sits in a tinted frame; a bigger plan
  says Upgrade, a smaller one Switch, and choosing one moves the frame.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Badge } from "../../components/badge/badge";
import { Button } from "../../components/button/button";
import { RollingNumber } from "../../components/rolling-number/rolling-number";
import { BillingToggle, type BillingPeriod } from "../../components/billing-toggle/billing-toggle";
import { Stepper } from "../../components/stepper/stepper";
import "./pricing-cards.css";

export type PricingPlan = {
  id: string;
  name: string;
  /** Per month, billed monthly. */
  monthly: number;
  /** Per month, billed yearly. */
  yearly: number;
  tagline?: string;
  features: string[];
  /** Priced per seat: the card adds the total for the chosen number of seats. */
  seat?: boolean;
};
export type PricingCardsProps = {
  plans: PricingPlan[];
  current?: string;
  defaultCurrent?: string;
  period?: BillingPeriod;
  defaultPeriod?: BillingPeriod;
  onPeriodChange?: (period: BillingPeriod) => void;
  /** Resolve to make the choice stick; throw to leave things as they were. */
  onSelect?: (id: string, period: BillingPeriod) => Promise<void> | void;
  title?: string;
  description?: string;
  saving?: string;
  currency?: string;
  /** Seats, for plans priced per seat. Shows a stepper when any plan is. */
  seats?: number;
  defaultSeats?: number;
  onSeatsChange?: (seats: number) => void;
  className?: string;
};

export function PricingCards({
  plans,
  current,
  defaultCurrent,
  period,
  defaultPeriod = "monthly",
  onPeriodChange,
  onSelect,
  title = "Plans",
  description,
  saving = "−20%",
  currency = "USD",
  seats,
  defaultSeats = 5,
  onSeatsChange,
  className,
}: PricingCardsProps) {
  const [innerSeats, setInnerSeats] = useState(defaultSeats);
  const team = seats ?? innerSeats;
  const perSeat = plans.some((p) => p.seat);
  const [innerPeriod, setInnerPeriod] = useState<BillingPeriod>(defaultPeriod);
  const per = period ?? innerPeriod;
  const [innerCurrent, setInnerCurrent] = useState(defaultCurrent);
  const on = current ?? innerCurrent;
  const [busy, setBusy] = useState<string | null>(null);
  const price = (p: PricingPlan) => (per === "yearly" ? p.yearly : p.monthly);
  // Plans compare by what the team would pay, not the sticker price.
  const cost = (p: PricingPlan) => price(p) * (p.seat ? team : 1);
  const money = { style: "currency", currency, maximumFractionDigits: 0 } as const;
  const mine = plans.find((p) => p.id === on);

  const choose = async (p: PricingPlan) => {
    setBusy(p.id);
    try {
      await onSelect?.(p.id, per);
      if (current === undefined) setInnerCurrent(p.id);
      feedback.play("success");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={cx("l-price", className)} aria-label={title}>
      <header className="l-price__head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <div className="l-price__controls">
          {perSeat && (
            <Stepper
              size="md"
              label="Seats"
              min={1}
              max={200}
              value={team}
              onValueChange={(v) => {
                if (seats === undefined) setInnerSeats(v);
                onSeatsChange?.(v);
              }}
            />
          )}
          <BillingToggle
          value={per}
          saving={saving}
          onValueChange={(v) => {
            if (period === undefined) setInnerPeriod(v);
            onPeriodChange?.(v);
          }}
          />
        </div>
      </header>
      <div className="l-price__grid">
        {plans.map((p) => {
          const isOn = p.id === on;
          const up = mine ? cost(p) > cost(mine) : true;
          return (
            <article key={p.id} className="l-price__card l-frame-solo" data-current={isOn || undefined}>
              <div className="l-price__name">
                <b>{p.name}</b>
                {isOn && (
                  <Badge size="sm" tone="accent">
                    Current
                  </Badge>
                )}
              </div>
              <div className="l-price__amount">
                <span className="l-price__figure l-num">
                  <RollingNumber value={price(p)} format={money} />
                </span>
                <span className="l-price__per">{p.seat ? "a seat, monthly" : "a month"}</span>
              </div>
              <span className="l-price__billed">
                {p.seat ? (
                  <>
                    <b className="l-num">
                      <RollingNumber value={cost(p)} format={money} />
                    </b>{" "}
                    a month for {team} {team === 1 ? "seat" : "seats"}
                  </>
                ) : (
                  "Flat, whatever the team size"
                )}
                {per === "yearly" ? ", billed yearly" : ""}
              </span>
              {p.tagline && <p className="l-price__tag">{p.tagline}</p>}
              <ul className="l-price__features">
                {p.features.map((f) => (
                  <li key={f}>
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M3.8 8.4 6.6 11l5.6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant={isOn ? "secondary" : up ? "primary" : "secondary"} disabled={isOn || (busy !== null && busy !== p.id)} loading={busy === p.id} onClick={() => choose(p)}>
                {isOn ? "Your plan" : up ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
