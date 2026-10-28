/*
  Liner · Expandable card
  A card that opens into its full story where it stands. The page's own view transition
  carries the card's frame to the center as it grows, the rest of the page dims, and the
  detail comes into focus inside. Closing runs it back into the grid.
*/
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { cx } from "../../lib/hooks";
import "./expandable-card.css";

export type ExpandableCardProps = {
  /** The compact face in the grid. */
  preview: ReactNode;
  /** What shows once open, under the same media. */
  detail: ReactNode;
  media?: ReactNode;
  title: string;
  className?: string;
};

/** Run a DOM change through a view transition when the browser has them and motion is welcome. */
function morph(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  doc.startViewTransition(() => flushSync(change));
}

export function ExpandableCard({ preview, detail, media, title, className }: ExpandableCardProps) {
  const id = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const name = `l-xcard-${id}`;

  const show = (o: boolean) => morph(() => setOpen(o));
  useEffect(() => {
    if (open) {
      panel.current?.focus();
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && show(false);
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    opener.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <>
      <button
        ref={opener}
        type="button"
        className={cx("l-xcard l-frame", className)}
        style={{ viewTransitionName: open ? "none" : name, ["viewTransitionClass" as string]: "l-xcard" }}
        aria-expanded={open}
        aria-label={`Open ${title}`}
        onClick={() => show(true)}
        data-hidden={open || undefined}
      >
        <div className="l-frame-card l-xcard__card">
          {media && <div className="l-xcard__media">{media}</div>}
          <div className="l-xcard__preview">{preview}</div>
        </div>
      </button>
      {open && (
        <div className="l-xcard__layer" onPointerDown={(e) => e.target === e.currentTarget && show(false)}>
          <div ref={panel} className="l-xcard__open l-frame l-frame-float" style={{ viewTransitionName: name, ["viewTransitionClass" as string]: "l-xcard" }} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
            <div className="l-frame-card l-xcard__card">
              {media && <div className="l-xcard__media l-xcard__media--big">{media}</div>}
              <div className="l-xcard__detail">{detail}</div>
            </div>
            <button type="button" className="l-xcard__close l-glass" aria-label="Close" onClick={() => show(false)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
                <path d="m4.5 4.5 7 7m0-7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
