/*
  Liner · Tabs
  Views of one thing, a tap apart. The indicator glides to the chosen tab (a pill on a
  tray, or a line under the labels), and the panel slides in from the side you moved
  toward. Too many tabs scroll, with soft edges showing there is more.
*/
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./tabs.css";

export type Tab = { value: string; label: ReactNode; icon?: ReactNode; badge?: ReactNode; content: ReactNode; disabled?: boolean };
export type TabsProps = {
  tabs: Tab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: "pill" | "line";
  /** Stretch tabs to share the row. */
  full?: boolean;
  label: string;
  className?: string;
};

export function Tabs({ tabs, value, defaultValue, onValueChange, variant = "pill", full, label, className }: TabsProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? tabs[0]?.value);
  const current = controlled ? value : inner;
  const index = Math.max(0, tabs.findIndex((t) => t.value === current));
  const [dir, setDir] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const select = (i: number, focus = false) => {
    const t = tabs[i];
    if (!t || t.disabled) return;
    if (t.value !== current) {
      setDir(i > index ? 1 : -1);
      feedback.play("tick", i * 2);
    }
    if (!controlled) setInner(t.value);
    onValueChange?.(t.value);
    if (focus) list.current?.querySelectorAll<HTMLElement>("[role=tab]")[i]?.focus();
  };

  const measure = () => {
    const el = list.current?.querySelectorAll<HTMLElement>("[role=tab]")[index];
    if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth });
    const l = list.current;
    if (l) setEdges({ start: l.scrollLeft > 2, end: l.scrollLeft + l.clientWidth < l.scrollWidth - 2 });
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useIsoLayoutEffect(measure, [index, tabs.length, variant, full]);
  useEffect(() => {
    const l = list.current!;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(l);
    document.fonts?.ready.then(() => measureRef.current());
    return () => ro.disconnect();
  }, []);
  // Keep the chosen tab in view when the row scrolls.
  useEffect(() => {
    list.current?.querySelectorAll<HTMLElement>("[role=tab]")[index]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [index]);

  const onKey = (e: KeyboardEvent) => {
    const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
    const at = enabled.indexOf(index);
    let next = -1;
    if (e.key === "ArrowRight") next = enabled[(at + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    else return;
    e.preventDefault();
    select(next, true);
  };

  const active = tabs[index];
  return (
    <div className={cx("l-tabs", className)} data-variant={variant}>
      <div className="l-tabs__bar" data-fade-start={edges.start || undefined} data-fade-end={edges.end || undefined}>
        <div ref={list} className="l-tabs__list" role="tablist" aria-label={label} data-full={full || undefined} onKeyDown={onKey} onScroll={measure}>
          {ind && <span className="l-tabs__ind" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} aria-hidden />}
          {tabs.map((t, i) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`${id}-t${i}`}
              aria-selected={i === index}
              aria-controls={`${id}-p${i}`}
              tabIndex={i === index ? 0 : -1}
              disabled={t.disabled}
              className="l-tabs__tab"
              onClick={() => select(i)}
            >
              {t.icon && <span className="l-tabs__icon">{t.icon}</span>}
              <span>{t.label}</span>
              {t.badge !== undefined && <span className="l-tabs__badge">{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="l-tabs__panels">
        <div key={active?.value} className="l-tabs__panel" role="tabpanel" id={`${id}-p${index}`} aria-labelledby={`${id}-t${index}`} tabIndex={0} data-dir={dir}>
          {active?.content}
        </div>
      </div>
    </div>
  );
}
