/*
  Liner · Split button
  One primary action with its nearby alternatives a chevron away. Picking an
  alternative can also make it the new default, and the label rolls over to it.
*/
import { useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip } from "../../lib/overlay";
import { MenuPanel, type MenuEntry } from "../menu/menu";
import "./split-button.css";

export type SplitOption = { id: string; label: string; hint?: string; icon?: React.ReactNode };

export type SplitButtonProps = {
  options: SplitOption[];
  /** The default option's id. */
  defaultValue?: string;
  /** Run an option: the main button runs the current default. */
  onAction?: (id: string) => void;
  /** Picking from the menu makes that option the new default. */
  remember?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
};

export function SplitButton({ options, defaultValue, onAction, remember = true, variant = "primary", className }: SplitButtonProps) {
  const [current, setCurrent] = useState(defaultValue ?? options[0].id);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const chev = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(open, chev, panel);
  useDismiss(open, () => setOpen(false), [wrap]);
  const main = options.find((o) => o.id === current) ?? options[0];

  const items: MenuEntry[] = options.map((o) => ({
    id: o.id,
    label: o.label,
    hint: o.hint,
    icon: o.icon,
    checked: remember ? o.id === current : undefined,
    onSelect: () => {
      if (remember) setCurrent(o.id);
      onAction?.(o.id);
      setOpen(false);
    },
  }));

  return (
    <div ref={wrap} className={cx("l-split", className)} data-variant={variant}>
      <button
        type="button"
        className="l-split-main l-focus"
        onClick={() => {
          onAction?.(main.id);
          feedback.play("tap", 3);
        }}
      >
        {main.icon && <span className="l-split-icon">{main.icon}</span>}
        <span key={main.id} className="l-split-label">
          {main.label}
        </span>
      </button>
      <span className="l-split-sep" aria-hidden />
      <button
        ref={chev}
        type="button"
        className="l-split-chev l-focus"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div ref={panel} style={{ display: "contents" }}>
          <MenuPanel
            items={items}
            label="Options"
            side={side}
            align="end"
            onClose={(refocus) => {
              setOpen(false);
              if (refocus) chev.current?.focus({ preventScroll: true });
            }}
          />
        </div>
      )}
    </div>
  );
}
