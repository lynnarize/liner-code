/*
  Liner · Radio group
  One of a few, all visible. The dot springs into the chosen circle; arrow keys move the
  choice. Descriptions sit under labels without stealing the click target.
*/
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./radio-group.css";

export type RadioOption = { value: string; label: string; description?: string; disabled?: boolean };
export type RadioGroupProps = {
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label: string;
  /** Show the group's label above it. */
  showLabel?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
};

export function RadioGroup({ options, value, defaultValue, onValueChange, label, showLabel = true, orientation = "vertical", className }: RadioGroupProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const root = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const pick = (v: string, focus = false) => {
    if (v !== current) feedback.play("tick", 3);
    if (!controlled) setInner(v);
    onValueChange?.(v);
    if (focus) root.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(v)}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const at = enabled.findIndex((o) => o.value === current);
    pick(enabled[(at + dir + enabled.length) % enabled.length].value, true);
  };
  const tabbable = current ?? enabled[0]?.value;
  return (
    <div className={cx("l-radios", className)} data-orientation={orientation}>
      {showLabel && (
        <span className="l-radios__label" id={`${id}-l`}>
          {label}
        </span>
      )}
      <div ref={root} className="l-radios__list" role="radiogroup" aria-labelledby={showLabel ? `${id}-l` : undefined} aria-label={showLabel ? undefined : label} onKeyDown={onKey}>
        {options.map((o) => {
          const on = o.value === current;
          return (
            <div
              key={o.value}
              className="l-radio"
              role="radio"
              aria-checked={on}
              aria-disabled={o.disabled || undefined}
              aria-describedby={o.description ? `${id}-${o.value}` : undefined}
              data-on={on || undefined}
              data-value={o.value}
              tabIndex={o.value === tabbable && !o.disabled ? 0 : -1}
              onClick={() => !o.disabled && pick(o.value)}
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                  if (!o.disabled) pick(o.value);
                }
              }}
            >
              <span className="l-radio__dot" aria-hidden />
              <span className="l-radio__text">
                <span className="l-radio__label">{o.label}</span>
                {o.description && (
                  <span className="l-radio__desc" id={`${id}-${o.value}`}>
                    {o.description}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
