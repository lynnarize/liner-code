/*
  Liner · Card
  The house container: a glass frame around a white card, with an optional quiet strip for
  meta or actions. Interactive cards lift a little and catch a soft light where the pointer is.
*/
import type { PointerEvent, ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./card.css";

export type CardProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Art or an image across the top of the card. */
  media?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  /** A quiet row on the glass under the card. */
  footer?: ReactNode;
  /** Makes the whole card a link. */
  href?: string;
  interactive?: boolean;
  className?: string;
};

export function Card({ title, description, media, eyebrow, children, footer, href, interactive, className }: CardProps) {
  const live = interactive || !!href;
  const body = (
    <>
      <div className="l-frame-card l-card__card">
        {media && <div className="l-card__media">{media}</div>}
        {(title || description || eyebrow || children) && (
          <div className="l-card__body">
            {eyebrow && <span className="l-card__eyebrow">{eyebrow}</span>}
            {title && <h3 className="l-card__title">{title}</h3>}
            {description && <p className="l-card__desc">{description}</p>}
            {children}
          </div>
        )}
      </div>
      {footer && <div className="l-frame-strip l-card__foot">{footer}</div>}
    </>
  );
  const props = {
    className: cx("l-card l-frame", className),
    "data-live": live || undefined,
    // The light follows the pointer: two custom properties, no re-render.
    onPointerMove: live
      ? (e: PointerEvent<HTMLElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
          e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
        }
      : undefined,
  };
  return href ? (
    <a href={href} {...props}>
      {body}
    </a>
  ) : (
    <article {...props}>{body}</article>
  );
}
