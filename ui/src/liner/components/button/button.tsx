import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import "./button.css";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Shows a spinner, sets aria-busy and swallows clicks while keeping focus. */
  loading?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
  /** Turn off for buttons that anchor a menu; the popup measures the pressed size. */
  pressScale?: boolean;
  /** Square, icon-only button. Needs an aria-label. */
  iconOnly?: boolean;
};

type Label = { id: number; node: ReactNode; out?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, iconEnd, pressScale = true, iconOnly, className, children, onClick, disabled, ...rest },
  ref,
) {
  const contentRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  // Keep the outgoing label mounted so it can blur out while the new one blurs in.
  const textKey = typeof children === "string" || typeof children === "number" ? String(children) : null;
  const [labels, setLabels] = useState<Label[]>([{ id: 0, node: children }]);
  const lastKey = useRef(textKey);
  useEffect(() => {
    if (textKey === lastKey.current) {
      setLabels((list) => list.map((l) => (l.out ? l : { ...l, node: children })));
      return;
    }
    lastKey.current = textKey;
    setLabels((list) => [...list.filter((l) => !l.out).map((l) => ({ ...l, out: true })), { id: (list.at(-1)?.id ?? 0) + 1, node: children }]);
  }, [textKey, children]);

  // The width springs to fit new content instead of jumping in one frame.
  useIsoLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const id = requestAnimationFrame(() => setReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(id);
    };
  }, []);

  const busy = loading || undefined;
  const showLead = loading || icon;

  return (
    <button
      ref={ref}
      className={cx("l-btn", "l-focus", className)}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      data-press={pressScale || undefined}
      data-loading={busy}
      aria-busy={busy}
      aria-disabled={busy || disabled || undefined}
      disabled={disabled}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      <span className="l-btn__sizer" data-ready={ready || undefined} style={width !== null ? { width } : undefined}>
        <span className="l-btn__content" ref={contentRef}>
          {showLead && (
            <span className="l-btn__lead" aria-hidden>
              <span className="l-btn__icon" data-hide={loading || undefined}>
                {icon}
              </span>
              <span className="l-btn__spin" data-show={loading || undefined}>
                <svg viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.75" />
                  <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </span>
            </span>
          )}
          {!iconOnly && (
            <span className="l-btn__label">
              {labels.map((l) =>
                l.out ? (
                  <span
                    key={l.id}
                    className="l-btn__ghost"
                    aria-hidden
                    onAnimationEnd={() => setLabels((list) => list.filter((x) => x.id !== l.id))}
                  >
                    {l.node}
                  </span>
                ) : (
                  <span key={l.id} className="l-btn__text" data-enter={l.id > 0 || undefined}>
                    {l.node}
                  </span>
                ),
              )}
            </span>
          )}
          {iconEnd && (
            <span className="l-btn__end" aria-hidden>
              {iconEnd}
            </span>
          )}
        </span>
      </span>
    </button>
  );
});
