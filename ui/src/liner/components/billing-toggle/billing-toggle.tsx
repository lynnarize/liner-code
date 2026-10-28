/*
  Liner · Billing toggle
  Monthly or yearly, with what yearly saves said right on the switch. Pair it with
  BillingPrice, whose digits roll to the new amount instead of jumping.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { Segmented } from "../segmented/segmented";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./billing-toggle.css";

export type BillingPeriod = "monthly" | "yearly";
export type BillingToggleProps = {
  value?: BillingPeriod;
  defaultValue?: BillingPeriod;
  onValueChange?: (period: BillingPeriod) => void;
  /** What yearly saves, like "Save 20%" or "2 months free". */
  saving?: string;
  className?: string;
};

export function BillingToggle({ value, defaultValue = "monthly", onValueChange, saving = "Save 20%", className }: BillingToggleProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const period = controlled ? value : inner;
  return (
    <Segmented
      className={cx("l-bill", className)}
      aria-label="Billing period"
      value={period}
      onValueChange={(p) => {
        if (!controlled) setInner(p);
        onValueChange?.(p);
      }}
      options={[
        { value: "monthly", label: "Monthly" },
        {
          value: "yearly",
          label: (
            <span className="l-bill__yearly">
              Yearly
              {saving && (
                <span className="l-bill__save" data-on={period === "yearly" || undefined}>
                  {saving}
                </span>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}

export type BillingPriceProps = {
  /** Price per month when paid monthly. */
  monthly: number;
  /** Price per year when paid yearly. */
  yearly: number;
  period: BillingPeriod;
  currency?: string;
  locale?: string;
  className?: string;
};

/** The per-month price for the chosen period, rolling between the two. */
export function BillingPrice({ monthly, yearly, period, currency = "USD", locale = "en-US", className }: BillingPriceProps) {
  const per = period === "yearly" ? yearly / 12 : monthly;
  const whole = Number.isInteger(Math.round(per * 100) / 100);
  return (
    <span className={cx("l-bill-price", className)}>
      <RollingNumber value={Math.round(per * 100) / 100} locale={locale} format={{ style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }} />
      <span className="l-bill-price__per">
        <span>/ month</span>
        <span className="l-bill-price__note" key={period}>
          {period === "yearly" ? `billed ${new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(yearly)} yearly` : "billed monthly"}
        </span>
      </span>
    </span>
  );
}
