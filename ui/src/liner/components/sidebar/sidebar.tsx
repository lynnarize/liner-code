/*
  Liner · Sidebar
  An app's navigation, made to sit on glass: a header for the workspace and a couple of
  quiet buttons, sections of places with counts, and a footer for notices and the person.
  The page you are on wears a white plate that glides between items rather than jumping.
  It folds to a rail of icons on a spring; labels blur out first and come back last.
*/
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Tooltip } from "../tooltip/tooltip";
import "./sidebar.css";

export type SidebarItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A quiet number on the right, like open runs. */
  count?: number;
  /** Renders a link instead of a button. */
  href?: string;
};
export type SidebarSection = { id: string; label?: string; items: SidebarItem[] };
export type SidebarProps = {
  sections: SidebarSection[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** The top left: usually a WorkspaceSwitcher. */
  header?: ReactNode;
  /** Icon buttons beside the header, like search. */
  actions?: ReactNode;
  /** Above the person: notices, a setup nudge. Hidden while folded. */
  footer?: ReactNode;
  /** The very bottom, kept when folded: usually a UserMenu. */
  user?: ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  label?: string;
  className?: string;
};

const RailIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6.25 3v10" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export function Sidebar({
  sections,
  value,
  defaultValue,
  onValueChange,
  header,
  actions,
  footer,
  user,
  collapsible = true,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  label = "Main",
  className,
}: SidebarProps) {
  const all = sections.flatMap((s) => s.items);
  const [inner, setInner] = useState(defaultValue ?? all[0]?.id);
  const current = value ?? inner;
  const [innerFold, setInnerFold] = useState(defaultCollapsed);
  const folded = collapsed ?? innerFold;
  const body = useRef<HTMLDivElement>(null);
  const [plate, setPlate] = useState<{ y: number; h: number } | null>(null);

  // The plate follows the current item; it measures again when the rail folds or opens.
  useIsoLayoutEffect(() => {
    const root = body.current;
    const el = root?.querySelector<HTMLElement>(`[data-side-id="${CSS.escape(current ?? "")}"]`);
    if (!el || !root) return setPlate(null);
    // Offsets, not rects: they stay in the sidebar's own units even inside a zoomed parent,
    // and summing them steps over the tooltip anchor a folded item sits in.
    const measure = () => {
      let y = 0;
      for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      setPlate({ y, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [current, folded, sections]);

  const pick = (id: string) => {
    if (id === current) return;
    if (value === undefined) setInner(id);
    onValueChange?.(id);
    feedback.play("tick", 3);
  };
  const fold = () => {
    const next = !folded;
    if (collapsed === undefined) setInnerFold(next);
    onCollapsedChange?.(next);
    feedback.play("toggle");
  };

  // Up and Down walk the items, Home and End jump to the ends.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(body.current?.querySelectorAll<HTMLElement>("[data-side-id]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <nav className={cx("l-side", className)} data-collapsed={folded || undefined} aria-label={label}>
      <div className="l-side__head">
        {header && <div className="l-side__brand">{header}</div>}
        <div className="l-side__actions">
          {!folded && actions}
          {collapsible && (
            <Tooltip content={folded ? "Open sidebar" : "Fold sidebar"} side={folded ? "right" : "bottom"}>
              <button type="button" className="l-side__btn l-focus" aria-label={folded ? "Open sidebar" : "Fold sidebar"} aria-expanded={!folded} onClick={fold}>
                <RailIcon />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div ref={body} className="l-side__body" onKeyDown={onKey}>
        <span className="l-side__plate" aria-hidden style={plate ? { transform: `translateY(${plate.y}px)`, height: plate.h, opacity: 1 } : undefined} />
        {sections.map((s) => (
          <div key={s.id} className="l-side__section" role="group" aria-label={s.label}>
            {s.label && (
              <div className="l-side__label" aria-hidden>
                {s.label}
              </div>
            )}
            <ul className="l-side__list">
              {s.items.map((it) => {
                const on = it.id === current;
                const inside = (
                  <>
                    <span className="l-side__icon" aria-hidden>
                      {it.icon}
                    </span>
                    <span className="l-side__text">{it.label}</span>
                    {it.count !== undefined && <span className="l-side__count l-num">{it.count}</span>}
                  </>
                );
                const common = {
                  className: "l-side__item l-focus",
                  "data-side-id": it.id,
                  "data-on": on || undefined,
                  "aria-current": on ? ("page" as const) : undefined,
                  "aria-label": folded ? (it.count ? `${it.label}, ${it.count}` : it.label) : undefined,
                  onClick: () => pick(it.id),
                };
                const node = it.href ? (
                  <a href={it.href} {...common}>
                    {inside}
                  </a>
                ) : (
                  <button type="button" {...common}>
                    {inside}
                  </button>
                );
                return (
                  <li key={it.id}>
                    {folded ? (
                      <Tooltip content={it.label} side="right">
                        {node}
                      </Tooltip>
                    ) : (
                      node
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {footer && !folded && <div className="l-side__foot">{footer}</div>}
      {user && <div className="l-side__user">{user}</div>}
    </nav>
  );
}

/** A quiet icon button for the sidebar's header, like search. */
export function SidebarAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <Tooltip content={label} side="bottom">
      <button type="button" className="l-side__btn l-focus" aria-label={label} onClick={onClick}>
        {icon}
      </button>
    </Tooltip>
  );
}
