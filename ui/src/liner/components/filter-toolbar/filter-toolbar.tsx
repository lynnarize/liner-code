/*
  Liner · Filter toolbar
  Search and filters in one row above what they narrow. Each filter is a menu of choices
  that stays open while you tick; what is active shows below as tokens you can remove one
  by one, and the count of results rolls as it changes.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { DropdownMenu } from "../menu/menu";
import { SearchField } from "../search-field/search-field";
import { RollingNumber } from "../rolling-number/rolling-number";
import "./filter-toolbar.css";

export type FilterDef = { id: string; label: string; icon?: ReactNode; options: { value: string; label: string }[] };
export type FilterValue = Record<string, string[]>;
export type FilterToolbarProps = {
  filters: FilterDef[];
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  query?: string;
  onQueryChange?: (q: string) => void;
  count?: number;
  noun?: [string, string];
  placeholder?: string;
  className?: string;
};

export function FilterToolbar({ filters, value, onChange, query = "", onQueryChange, count, noun = ["result", "results"], placeholder = "Search", className }: FilterToolbarProps) {
  const set = (id: string, v: string[]) => onChange({ ...value, [id]: v });
  const active = filters.flatMap((f) => (value[f.id] ?? []).map((v) => ({ f, v, label: f.options.find((o) => o.value === v)?.label ?? v })));
  return (
    <div className={cx("l-filters", className)}>
      <div className="l-filters__row">
        {onQueryChange && <SearchField size="sm" value={query} onValueChange={onQueryChange} placeholder={placeholder} className="l-filters__search" />}
        {filters.map((f) => {
          const on = value[f.id] ?? [];
          return (
            <DropdownMenu
              key={f.id}
              label={f.label}
              className="l-filters__menu"
              trigger={
                <>
                  {f.icon}
                  <span>{f.label}</span>
                  {on.length > 0 && (
                    <span className="l-filters__n" key={on.length}>
                      {on.length}
                    </span>
                  )}
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-menu-chev">
                    <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              }
              items={[
                ...f.options.map((o) => ({
                  id: o.value,
                  label: o.label,
                  checked: on.includes(o.value),
                  onSelect: () => set(f.id, on.includes(o.value) ? on.filter((x) => x !== o.value) : [...on, o.value]),
                })),
                ...(on.length ? [{ type: "separator" as const, id: "sep" }, { id: "clear", label: `Clear ${f.label.toLowerCase()}`, onSelect: () => set(f.id, []) }] : []),
              ]}
            />
          );
        })}
        {count !== undefined && (
          <span className="l-filters__count" aria-live="polite">
            <RollingNumber value={count} /> {count === 1 ? noun[0] : noun[1]}
          </span>
        )}
      </div>
      {active.length > 0 && (
        <div className="l-filters__tokens" aria-label="Active filters">
          {active.map(({ f, v, label }) => (
            <span key={`${f.id}:${v}`} className="l-filters__token">
              <span className="l-filters__key">{f.label}</span>
              {label}
              <button type="button" aria-label={`Remove ${f.label}: ${label}`} onClick={() => set(f.id, (value[f.id] ?? []).filter((x) => x !== v))}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="m5 5 6 6m0-6-6 6" />
                </svg>
              </button>
            </span>
          ))}
          <button type="button" className="l-filters__clear" onClick={() => onChange(Object.fromEntries(filters.map((f) => [f.id, []])))}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
