/*
  Liner · Workspace switcher
  The name at the top of a sidebar, and the menu of places you can be. Each workspace is a
  letter tile; the one you are in carries a check. Built on the Menu, so the highlight
  glides and type-ahead works.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { DropdownMenu, type MenuEntry } from "../menu/menu";
import "./workspace-switcher.css";

export type Workspace = { id: string; name: string; /** Under the name in the menu, like a plan. */ meta?: string };
export type WorkspaceSwitcherProps = {
  workspaces: Workspace[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Adds a New workspace row. */
  onCreate?: () => void;
  /** Adds a Workspace settings row. */
  onSettings?: () => void;
  className?: string;
};

const Tile = ({ name, size = "md" }: { name: string; size?: "sm" | "md" }) => (
  <span className="l-wsw__tile" data-size={size} aria-hidden>
    {name.charAt(0).toUpperCase()}
  </span>
);

export function WorkspaceSwitcher({ workspaces, value, defaultValue, onValueChange, onCreate, onSettings, className }: WorkspaceSwitcherProps) {
  const [inner, setInner] = useState(defaultValue ?? workspaces[0]?.id);
  const current = workspaces.find((w) => w.id === (value ?? inner)) ?? workspaces[0];
  const pick = (id: string) => {
    if (value === undefined) setInner(id);
    onValueChange?.(id);
  };
  const items: MenuEntry[] = [
    { type: "label", id: "label", label: "Workspaces" },
    ...workspaces.map((w) => ({
      id: w.id,
      label: w.name,
      hint: w.meta,
      icon: <Tile name={w.name} size="sm" />,
      // The current one draws a check and keeps the menu open, like any toggled row.
      checked: w.id === current?.id ? true : undefined,
      onSelect: () => pick(w.id),
    })),
    ...(onCreate || onSettings ? [{ type: "separator" as const, id: "sep" }] : []),
    ...(onCreate
      ? [
          {
            id: "new",
            label: "New workspace",
            icon: (
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ),
            onSelect: onCreate,
          },
        ]
      : []),
    ...(onSettings
      ? [
          {
            id: "settings",
            label: "Workspace settings",
            icon: (
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 1.9v1.6M8 12.5v1.6M14.1 8h-1.6M3.5 8H1.9M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1M12.3 12.3l-1.1-1.1M4.8 4.8 3.7 3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            ),
            onSelect: onSettings,
          },
        ]
      : []),
  ];
  if (!current) return null;
  return (
    <DropdownMenu
      className={cx("l-wsw", className)}
      label={`Workspace: ${current.name}`}
      items={items}
      trigger={
        <>
          <Tile name={current.name} />
          <span className="l-wsw__name" data-side-label key={current.id}>
            {current.name}
          </span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-menu-chev" data-side-label>
            <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      }
    />
  );
}
