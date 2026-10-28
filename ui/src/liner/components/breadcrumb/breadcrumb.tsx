/*
  Liner · Breadcrumb
  Where you are and how you got here. Long trails fold their middle into a menu, so the
  first step and the last few stay readable. The current page is plain text, never a link.
*/
import type { ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { DropdownMenu } from "../menu/menu";
import "./breadcrumb.css";

export type Crumb = { label: string; href?: string; icon?: ReactNode; onSelect?: () => void };
export type BreadcrumbProps = {
  items: Crumb[];
  /** Fold the middle once there are more than this many. */
  max?: number;
  separator?: "chevron" | "slash";
  className?: string;
};

const SEP = {
  chevron: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  slash: <span aria-hidden>/</span>,
};

export function Breadcrumb({ items, max = 4, separator = "chevron", className }: BreadcrumbProps) {
  const fold = items.length > max;
  const head = fold ? items.slice(0, 1) : items;
  const hidden = fold ? items.slice(1, items.length - (max - 2)) : [];
  const tail = fold ? items.slice(items.length - (max - 2)) : [];

  const crumb = (c: Crumb, i: number, last: boolean) => (
    <li key={`${c.label}${i}`} className="l-crumbs__item">
      {last ? (
        <span className="l-crumbs__current" aria-current="page">
          {c.icon}
          {c.label}
        </span>
      ) : (
        <a
          className="l-crumbs__link"
          href={c.href ?? "#"}
          onClick={(e) => {
            if (c.onSelect) {
              e.preventDefault();
              c.onSelect();
            }
          }}
        >
          {c.icon}
          {c.label}
        </a>
      )}
      {!last && <span className="l-crumbs__sep">{SEP[separator]}</span>}
    </li>
  );

  return (
    <nav className={cx("l-crumbs", className)} aria-label="Breadcrumb">
      <ol>
        {head.map((c, i) => crumb(c, i, !fold && i === items.length - 1))}
        {fold && (
          <li className="l-crumbs__item">
            <DropdownMenu
              label={`${hidden.length} more`}
              className="l-crumbs__more"
              trigger={<span aria-hidden>···</span>}
              items={hidden.map((c, i) => ({ id: `${i}`, label: c.label, icon: c.icon, onSelect: () => (c.onSelect ? c.onSelect() : c.href && (location.href = c.href)) }))}
            />
            <span className="l-crumbs__sep">{SEP[separator]}</span>
          </li>
        )}
        {tail.map((c, i) => crumb(c, items.length - tail.length + i, i === tail.length - 1))}
      </ol>
    </nav>
  );
}
