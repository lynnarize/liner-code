/*
  Liner · Property list
  Facts about one thing, one per row: an icon, a quiet name and its value. Values that
  change come into focus in place, so a running cost or a count reads as live.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./property-list.css";

export type Property = { label: string; value: ReactNode; icon?: ReactNode };
export type PropertyListProps = {
  items: Property[];
  /** Name and value on one row, or the value under its name. */
  layout?: "split" | "stacked";
  label?: string;
  className?: string;
};

export function PropertyList({ items, layout = "split", label, className }: PropertyListProps) {
  return (
    <dl className={cx("l-props", className)} data-layout={layout} aria-label={label}>
      {items.map((p) => (
        <div key={p.label} className="l-props__row">
          <dt>
            {p.icon && (
              <span className="l-props__icon" aria-hidden>
                {p.icon}
              </span>
            )}
            {p.label}
          </dt>
          {/* A plain value re-keys when it changes, so the new one unblurs in. */}
          <dd key={typeof p.value === "string" || typeof p.value === "number" ? String(p.value) : undefined}>{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}
