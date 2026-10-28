/*
  Liner · Menu
  A glass list of actions. DropdownMenu anchors it to a trigger, ContextMenu opens it at
  the pointer, and MenuPanel is the list itself for anything else that needs one.
  One highlight glides between rows; arrows, Home, End and type-ahead move it.
*/
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip, useRoving, type Side } from "../../lib/overlay";
import "./menu.css";

export type MenuAction = {
  type?: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A toggle row: draws a check and keeps the menu open. */
  checked?: boolean;
  onSelect?: () => void;
};
export type MenuEntry = MenuAction | { type: "separator"; id: string } | { type: "label"; id: string; label: string };

const isAction = (e: MenuEntry): e is MenuAction => e.type === undefined || e.type === "item";

/** The list on its own: a glass panel that takes focus and hands it back on close. */
export function MenuPanel({
  items,
  label,
  side = "bottom",
  align = "start",
  style,
  className,
  onClose,
}: {
  items: MenuEntry[];
  label: string;
  side?: Side;
  align?: "start" | "end" | "center";
  style?: CSSProperties;
  className?: string;
  /** refocus: false when focus is already moving elsewhere (Tab). */
  onClose: (refocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const skip = (i: number) => {
    const e = items[i];
    return !isAction(e) || !!e.disabled;
  };
  const pick = (i: number) => {
    const e = items[i];
    if (!isAction(e) || e.disabled) return;
    e.onSelect?.();
    feedback.play(e.danger ? "tap" : "tick", 4);
    if (e.checked === undefined) onClose(true);
  };
  const nav = useRoving({
    count: items.length,
    skip,
    text: (i) => (isAction(items[i]) ? (items[i] as MenuAction).label : ""),
    onPick: pick,
    onEscape: () => onClose(true),
    onTab: () => onClose(false),
  });
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={ref} className={cx("l-pop l-menu", className)} role="menu" aria-label={label} tabIndex={-1} data-side={side} data-align={align} style={style} onKeyDown={nav.onKeyDown}>
      <div className="l-opts" ref={nav.listRef}>
        {nav.hl && <span className="l-opt-hl" style={{ transform: `translateY(${nav.hl.y}px)`, height: nav.hl.h }} aria-hidden />}
        {items.map((e, i) =>
          e.type === "separator" ? (
            <div key={e.id} className="l-opt-sep" role="separator" />
          ) : e.type === "label" ? (
            <div key={e.id} className="l-opt-group" role="presentation">
              {e.label}
            </div>
          ) : (
            <div
              key={e.id}
              data-index={i}
              role={e.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={e.checked}
              aria-disabled={e.disabled || undefined}
              className="l-opt"
              data-active={nav.active === i || undefined}
              data-danger={e.danger || undefined}
              onPointerMove={() => !e.disabled && nav.active !== i && nav.setActive(i)}
              onClick={() => pick(i)}
            >
              {e.icon && <span className="l-opt-icon">{e.icon}</span>}
              <span className="l-opt-text">
                <span className="l-opt-label">{e.label}</span>
                {e.hint && <span className="l-opt-hint">{e.hint}</span>}
              </span>
              {e.shortcut && <span className="l-opt-kbd">{e.shortcut}</span>}
              {e.checked && (
                <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-opt-check">
                  <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export type DropdownMenuProps = {
  items: MenuEntry[];
  /** The trigger's text; or pass `trigger` for full control of its contents. */
  label: string;
  trigger?: ReactNode;
  align?: "start" | "end";
  side?: Side;
  /** Style the trigger as an icon button. */
  iconOnly?: boolean;
  className?: string;
};

/** A focused list of actions anchored to a trigger. */
export function DropdownMenu({ items, label, trigger, align = "start", side: prefer = "bottom", iconOnly, className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const side = useFlip(open, btn, panelRef, prefer);
  useDismiss(open, () => setOpen(false), [wrap]);
  return (
    <div ref={wrap} className={cx("l-anchor l-dropdown", className)}>
      <button
        ref={btn}
        type="button"
        className="l-menu-trigger l-focus"
        data-icon-only={iconOnly || undefined}
        data-open={open || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? label : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger ?? (
          <>
            <span>{label}</span>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-menu-chev">
              <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        )}
      </button>
      {open && (
        <div ref={panelRef} style={{ display: "contents" }}>
          <MenuPanel
            items={items}
            label={label}
            side={side}
            align={align}
            onClose={(refocus) => {
              setOpen(false);
              if (refocus) btn.current?.focus({ preventScroll: true });
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Secondary actions kept close to the thing they act on: right-click, long-press, or Shift+F10. */
export function ContextMenu({ items, label = "Actions", children, className }: { items: MenuEntry[]; label?: string; children: ReactNode; className?: string }) {
  const id = useId();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const press = useRef<number | undefined>(undefined);
  useDismiss(!!at, () => setAt(null), [wrap]);

  const openAt = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    // Keep the panel inside the area: open left or up when the pointer is near an edge.
    setAt({ x: Math.min(clientX - r.left, r.width - 210), y: Math.min(clientY - r.top, Math.max(8, r.height - 40 * items.length)) });
    feedback.play("tap", 3);
  };

  return (
    <div
      ref={wrap}
      className={cx("l-context", className)}
      tabIndex={0}
      aria-describedby={`${id}-hint`}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        openAt(e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        const { clientX, clientY } = e;
        press.current = window.setTimeout(() => openAt(clientX, clientY), 500);
      }}
      onPointerUp={() => window.clearTimeout(press.current)}
      onPointerCancel={() => window.clearTimeout(press.current)}
      onKeyDown={(e) => {
        if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
          e.preventDefault();
          const r = wrap.current!.getBoundingClientRect();
          openAt(r.left + 24, r.top + 24);
        }
      }}
    >
      {children}
      <span id={`${id}-hint`} className="l-sr-only">
        Press Shift F10 for actions
      </span>
      {at && (
        <MenuPanel
          items={items}
          label={label}
          className="l-context-panel"
          style={{ left: at.x, top: at.y }}
          onClose={(refocus) => {
            setAt(null);
            if (refocus) wrap.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
