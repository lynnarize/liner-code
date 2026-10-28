/*
  Liner · Button groups
  Three ways to hold related actions:
  - ButtonGroup: joined segments with hairlines; one hover highlight glides between them,
    and an attached menu can close the row.
  - FloatingButtonGroup: separate soft buttons in a quiet tray, with one shared highlight
    that morphs from button to button and settles on the selected one.
  - ExpandingButtonGroup: icons that grow to show their label when pointed at or focused,
    and confirm in place when used.
*/
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss } from "../../lib/overlay";
import { MenuPanel, type MenuEntry } from "../menu/menu";
import "./button-group.css";

export type GroupItem = { id: string; label: string; icon?: ReactNode };
type Box = { x: number; w: number } | null;

/** Measure a child of `wrap` marked data-id={id}. */
function measure(wrap: HTMLElement | null, id: string | null): Box {
  if (!wrap || !id) return null;
  const el = wrap.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  // Rects, not offsetLeft: a segment can sit inside its own positioned anchor.
  const a = wrap.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  return { x: b.left - a.left - wrap.clientLeft, w: b.width };
}

export function ButtonGroup({ items, onAction, menu, size = "md", className }: { items: GroupItem[]; onAction?: (id: string) => void; menu?: MenuEntry[]; size?: "sm" | "md"; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [box, setBox] = useState<Box>(null);
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const menuWrap = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [menuWrap]);
  useLayoutEffect(() => {
    if (hover) setBox(measure(wrap.current, hover));
  }, [hover]);

  return (
    <div ref={wrap} className={cx("l-bgroup", className)} role="group" data-size={size} onPointerLeave={() => setHover(null)}>
      <span className="l-bgroup-hl" data-show={hover ? true : undefined} style={box ? { transform: `translateX(${box.x}px)`, width: box.w } : undefined} aria-hidden />
      {items.map((it, i) => (
        <span key={it.id} className="l-bgroup-cell">
          {i > 0 && <span className="l-bgroup-sep" aria-hidden />}
          <button
            type="button"
            className="l-bgroup-btn l-focus"
            data-id={it.id}
            onPointerEnter={() => setHover(it.id)}
            onFocus={() => setHover(it.id)}
            onBlur={() => setHover(null)}
            onClick={() => {
              onAction?.(it.id);
              feedback.play("tap", 2 + i);
            }}
          >
            {it.icon && <span className="l-bgroup-icon">{it.icon}</span>}
            {it.label}
          </button>
        </span>
      ))}
      {menu && (
        <span ref={menuWrap} className="l-bgroup-cell l-anchor">
          <span className="l-bgroup-sep" aria-hidden />
          <button
            ref={more}
            type="button"
            className="l-bgroup-btn l-bgroup-more l-focus"
            data-id="__more"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={open}
            onPointerEnter={() => setHover("__more")}
            onFocus={() => setHover("__more")}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <MenuPanel
              items={menu}
              label="More actions"
              align="end"
              onClose={(refocus) => {
                setOpen(false);
                if (refocus) more.current?.focus({ preventScroll: true });
              }}
            />
          )}
        </span>
      )}
    </div>
  );
}

export function FloatingButtonGroup({
  items,
  value,
  defaultValue,
  onValueChange,
  className,
}: {
  items: GroupItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id);
  const selected = value ?? inner;
  const [hover, setHover] = useState<string | null>(null);
  const [box, setBox] = useState<Box>(null);
  const target = hover ?? selected;
  useLayoutEffect(() => {
    setBox(measure(wrap.current, target));
  }, [target, items.length]);
  return (
    <div ref={wrap} className={cx("l-fgroup l-glass", className)} role="radiogroup" onPointerLeave={() => setHover(null)}>
      {/* One highlight: it follows the pointer, then settles back on the choice. */}
      <span className="l-fgroup-hl" data-hover={hover && hover !== selected ? true : undefined} style={box ? { transform: `translateX(${box.x}px)`, width: box.w } : undefined} aria-hidden />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={selected === it.id}
          className="l-fgroup-btn l-focus"
          data-id={it.id}
          data-on={selected === it.id || undefined}
          onPointerEnter={() => setHover(it.id)}
          onFocus={() => setHover(it.id)}
          onBlur={() => setHover(null)}
          onClick={() => {
            if (value === undefined) setInner(it.id);
            onValueChange?.(it.id);
            feedback.play("tick", 4);
          }}
        >
          {it.icon && <span className="l-bgroup-icon">{it.icon}</span>}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ExpandingButtonGroup({ items, onAction, className }: { items: Required<Pick<GroupItem, "id" | "label" | "icon">>[]; onAction?: (id: string) => void; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className={cx("l-egroup l-glass", className)} role="group" onPointerLeave={() => setOpen(null)}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="l-egroup-btn l-focus"
          aria-label={it.label}
          data-open={open === it.id || done === it.id || undefined}
          data-done={done === it.id || undefined}
          onPointerEnter={() => setOpen(it.id)}
          onFocus={() => setOpen(it.id)}
          onBlur={() => setOpen(null)}
          onClick={() => {
            onAction?.(it.id);
            setDone(it.id);
            feedback.play("success");
            window.setTimeout(() => setDone((d) => (d === it.id ? null : d)), 1400);
          }}
        >
          <span className="l-egroup-icon" key={done === it.id ? "done" : "icon"} aria-hidden>
            {done === it.id ? (
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              it.icon
            )}
          </span>
          <span className="l-egroup-label" aria-hidden>
            <span>{done === it.id ? "Done" : it.label}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
