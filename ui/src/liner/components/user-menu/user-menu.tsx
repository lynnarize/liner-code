/*
  Liner · User menu
  Your account behind the avatar: who you are, a few destinations, the appearance switch
  and sign out. On a phone it opens as a sheet from the bottom edge.
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useRoving } from "../../lib/overlay";
import { Segmented } from "../segmented/segmented";
import "./user-menu.css";

export type UserMenuItem = { id: string; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; onSelect?: () => void };
export type Appearance = "light" | "dark" | "system";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function UserMenu({
  user,
  items,
  appearance,
  onAppearanceChange,
  onSignOut,
  side = "bottom",
  align = "end",
  className,
}: {
  user: { name: string; email: string; plan?: string };
  items: UserMenuItem[];
  appearance?: Appearance;
  onAppearanceChange?: (a: Appearance) => void;
  onSignOut?: () => void;
  /** Which way it opens; a menu at the foot of a sidebar opens up and to the start. */
  side?: "top" | "bottom";
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [wrap], btn);
  const all: UserMenuItem[] = [...items, { id: "__out", label: "Sign out", danger: true, onSelect: onSignOut, icon: <OutIcon /> }];
  const nav = useRoving({
    count: all.length,
    text: (i) => all[i].label,
    onPick: (i) => {
      all[i].onSelect?.();
      feedback.play("tick", 4);
      setOpen(false);
      btn.current?.focus({ preventScroll: true });
    },
  });
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(".l-opts")?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div ref={wrap} className={cx("l-anchor l-umenu", className)}>
      <button ref={btn} type="button" className="l-umenu-trigger l-focus" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="l-umenu-avatar" aria-hidden>
          {initials(user.name)}
        </span>
        <span className="l-umenu-name">{user.name.split(" ")[0]}</span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-umenu-chev">
          <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="l-umenu-scrim" aria-hidden onClick={() => setOpen(false)} />
          <div ref={panel} className="l-pop l-umenu-panel" data-side={side} data-align={align}>
            <span className="l-umenu-grip" aria-hidden />
            <div className="l-umenu-head">
              <span className="l-umenu-avatar" data-size="lg" aria-hidden>
                {initials(user.name)}
              </span>
              <span className="l-umenu-who">
                <b>{user.name}</b>
                <span>{user.email}</span>
              </span>
              {user.plan && <span className="l-umenu-plan">{user.plan}</span>}
            </div>
            {onAppearanceChange && (
              <div className="l-umenu-theme">
                <span>Appearance</span>
                <Segmented
                  size="sm"
                  aria-label="Appearance"
                  value={appearance ?? "system"}
                  onValueChange={(v) => onAppearanceChange(v as Appearance)}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                    { value: "system", label: "Auto" },
                  ]}
                />
              </div>
            )}
            <div className="l-opts" ref={nav.listRef} role="menu" aria-label="Account" tabIndex={-1} onKeyDown={nav.onKeyDown}>
              {nav.hl && <span className="l-opt-hl" style={{ transform: `translateY(${nav.hl.y}px)`, height: nav.hl.h }} aria-hidden />}
              {all.map((it, i) => (
                <div key={it.id}>
                  {it.id === "__out" && <div className="l-opt-sep" role="separator" />}
                  <div
                    data-index={i}
                    role="menuitem"
                    className="l-opt"
                    data-active={nav.active === i || undefined}
                    data-danger={it.danger || undefined}
                    onPointerMove={() => nav.active !== i && nav.setActive(i)}
                    onClick={() => {
                      it.onSelect?.();
                      setOpen(false);
                    }}
                  >
                    {it.icon && <span className="l-opt-icon">{it.icon}</span>}
                    <span className="l-opt-text">
                      <span className="l-opt-label">{it.label}</span>
                    </span>
                    {it.shortcut && <span className="l-opt-kbd">{it.shortcut}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OutIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M6.5 13.25H4a1.25 1.25 0 0 1-1.25-1.25V4A1.25 1.25 0 0 1 4 2.75h2.5M10.5 11 13.5 8l-3-3M13.25 8H6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
