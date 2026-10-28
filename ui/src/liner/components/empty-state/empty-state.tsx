/*
  Liner · Empty state
  What to do when there is nothing here yet. A quiet stacked glyph, one sentence on why it
  is empty, and the action that fills it. Search misses suggest clearing what narrowed it.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./empty-state.css";

const GLYPHS: Record<string, ReactNode> = {
  inbox: <path d="M3 9.5h3l1 1.75h2l1-1.75h3M3 9.5 4.6 4.3A1 1 0 0 1 5.55 3.6h4.9a1 1 0 0 1 .95.7L13 9.5v2.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />,
  search: <path d="M7.2 2.6a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2ZM10.6 10.6l2.9 2.9M5.6 7.2h3.2" />,
  folder: <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5ZM6 8.5h4" />,
  error: <path d="M8 5.25v3.25M8 10.6v.1M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Z" />,
};

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  kind?: "inbox" | "search" | "folder" | "error";
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, kind = "inbox", icon, actions, className }: EmptyStateProps) {
  return (
    <div className={cx("l-empty", className)} data-kind={kind} role="status">
      <span className="l-empty__art" aria-hidden>
        <i />
        <i />
        <span className="l-empty__glyph">
          {icon ?? (
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              {GLYPHS[kind]}
            </svg>
          )}
        </span>
      </span>
      <b className="l-empty__title">{title}</b>
      {description && <p className="l-empty__desc">{description}</p>}
      {actions && <div className="l-empty__actions">{actions}</div>}
    </div>
  );
}
