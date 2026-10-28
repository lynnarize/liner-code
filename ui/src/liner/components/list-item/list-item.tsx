/*
  Liner · List item
  A row for settings, people and things: a leading tile, a title with a line under it, and
  whatever belongs on the right (a switch, a button, a badge). Put several in a List and
  hairlines fall between them. A row with onClick or href becomes one big target.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./list-item.css";

export type ListItemProps = {
  title: ReactNode;
  description?: ReactNode;
  /** An icon, drawn in a quiet tile. */
  icon?: ReactNode;
  /** Anything else on the left: an avatar, a brand mark, a picture. */
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
};

export function ListItem({ title, description, icon, leading, trailing, onClick, href, className }: ListItemProps) {
  const lead = leading ?? (icon ? <span className="l-row__tile">{icon}</span> : null);
  const body = (
    <>
      {lead && (
        <span className="l-row__lead" aria-hidden={!leading || undefined}>
          {lead}
        </span>
      )}
      <span className="l-row__text">
        <span className="l-row__title">{title}</span>
        {description && <span className="l-row__desc">{description}</span>}
      </span>
    </>
  );
  const interactive = !!(onClick || href);
  return (
    <div className={cx("l-row", className)} role="listitem" data-interactive={interactive || undefined}>
      {href ? (
        <a className="l-row__main l-focus" href={href} onClick={onClick}>
          {body}
        </a>
      ) : onClick ? (
        <button type="button" className="l-row__main l-focus" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="l-row__main">{body}</div>
      )}
      {trailing && <div className="l-row__trail">{trailing}</div>}
    </div>
  );
}

/** Rows with hairlines between them. */
export function List({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div className={cx("l-rows", className)} role="list" aria-label={label}>
      {children}
    </div>
  );
}
