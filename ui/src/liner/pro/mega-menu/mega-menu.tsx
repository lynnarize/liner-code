/*
  Liner Pro · Mega menu
  One glass panel for the whole navigation. Moving between items doesn't close and reopen
  it: the panel slides under the new item and morphs to the size of its content, which
  slides in from the side you came from.
*/
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./mega-menu.css";

export type MegaItem = { id: string; label: string; content?: ReactNode; href?: string };
export type MegaMenuProps = { items: MegaItem[]; label?: string; className?: string };

export function MegaMenu({ items, label = "Main", className }: MegaMenuProps) {
  const [active, setActive] = useState<number | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const [dir, setDir] = useState(0);
  const [box, setBox] = useState({ x: 0, w: 0, h: 0 });
  // Opening from closed places the panel at once; only moves between items morph.
  const [fresh, setFresh] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const open = active !== null;

  const show = (i: number | null) => {
    window.clearTimeout(timer.current);
    if (i === active) return;
    if (i !== null && active !== null) setDir(i > active ? 1 : -1);
    else setDir(0);
    setFresh(active === null);
    setPrev(active);
    setActive(i);
    if (i !== null) feedback.play("tick", i * 2);
  };
  const later = (i: number | null, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => show(i), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Size and place the panel for the active content, centered under its trigger.
  useIsoLayoutEffect(() => {
    if (active === null) return;
    const slot = slots.current[active];
    const t = triggers.current[active];
    const n = nav.current;
    if (!slot || !t || !n) return;
    const w = slot.offsetWidth;
    const h = slot.offsetHeight;
    const center = t.offsetLeft + t.offsetWidth / 2;
    const x = Math.max(0, Math.min(center - w / 2, n.offsetWidth - w));
    setBox({ x, w, h });
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setFresh(false)));
    return () => cancelAnimationFrame(id);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !nav.current?.contains(e.target as Node) && show(null);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, active]);

  const onBarKey = (i: number) => (e: KeyboardEvent) => {
    const enabled = items.map((_, k) => k);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const k = (i + (e.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
      triggers.current[k]?.focus();
      if (open && items[k].content) show(k);
    } else if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && items[i].content) {
      e.preventDefault();
      show(i);
      requestAnimationFrame(() => slots.current[i]?.querySelector<HTMLElement>("a, button")?.focus());
    } else if (e.key === "Escape") show(null);
  };

  return (
    <nav ref={nav} className={cx("l-mega", className)} aria-label={label} onPointerLeave={() => later(null, 260)} onPointerEnter={() => window.clearTimeout(timer.current)}>
      <ul className="l-mega__bar l-glass">
        {items.map((it, i) => (
          <li key={it.id}>
            {it.content ? (
              <button
                ref={(el) => {
                  triggers.current[i] = el;
                }}
                type="button"
                className="l-mega__trigger"
                aria-expanded={active === i}
                aria-controls={`l-mega-${it.id}`}
                data-on={active === i || undefined}
                onPointerEnter={() => (open ? show(i) : later(i, 120))}
                onClick={() => show(active === i ? null : i)}
                onKeyDown={onBarKey(i)}
              >
                {it.label}
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <a
                ref={(el) => {
                  triggers.current[i] = el as unknown as HTMLButtonElement;
                }}
                className="l-mega__trigger"
                href={it.href ?? "#"}
                onPointerEnter={() => later(null, 160)}
                onKeyDown={onBarKey(i)}
              >
                {it.label}
              </a>
            )}
          </li>
        ))}
      </ul>
      <div
        className="l-mega__view l-lens"
        data-open={open || undefined}
        data-fresh={fresh || undefined}
        data-dir={dir}
        style={{ width: box.w, height: box.h, transform: `translateX(${box.x}px)` }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && active !== null) {
            triggers.current[active]?.focus();
            show(null);
          }
        }}
      >
        {items.map((it, i) =>
          it.content ? (
            <div
              key={it.id}
              id={`l-mega-${it.id}`}
              ref={(el) => {
                slots.current[i] = el;
              }}
              className="l-mega__slot"
              data-state={i === active ? "in" : i === prev && open ? "out" : undefined}
              aria-hidden={i !== active}
              inert={i !== active || undefined}
            >
              {it.content}
            </div>
          ) : null,
        )}
      </div>
    </nav>
  );
}

/** A tidy row for menu content: icon, title, one line. */
export function MegaLink({ icon, title, description, href = "#" }: { icon?: ReactNode; title: string; description?: string; href?: string }) {
  return (
    <a className="l-mega__link" href={href}>
      {icon && <span className="l-mega__icon">{icon}</span>}
      <span className="l-mega__text">
        <b>{title}</b>
        {description && <span>{description}</span>}
      </span>
    </a>
  );
}
