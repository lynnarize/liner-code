/*
  Liner · Theme switch
  Moves the page between light and dark through a view transition, in one of four ways:
  eclipse (a disc sweeps across), split (it opens from a center seam), rise (it comes up
  from the bottom) or fade. Without View Transitions, or with reduced motion, it just
  switches.
*/
import { flushSync } from "react-dom";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { prefersReducedMotion } from "../../lib/spring";
import { IconMorph } from "../icon-morph/icon-morph";
import "./theme-switch.css";

export type ThemeSwitchVariant = "eclipse" | "split" | "rise" | "fade";
type Theme = "light" | "dark";

/** Run `apply` inside a view transition styled by `variant`, anchored at (x, y). */
export function switchTheme(variant: ThemeSwitchVariant, apply: () => void, at?: { x: number; y: number }) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || prefersReducedMotion()) return apply();
  const root = document.documentElement;
  const x = at?.x ?? window.innerWidth / 2;
  const y = at?.y ?? window.innerHeight / 2;
  root.style.setProperty("--ts-x", `${x}px`);
  root.style.setProperty("--ts-y", `${y}px`);
  root.style.setProperty("--ts-r", `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
  root.dataset.themeSwitch = variant;
  const t = doc.startViewTransition(() => flushSync(apply));
  t.finished.finally(() => delete root.dataset.themeSwitch);
}

export function ThemeSwitch({ theme, onThemeChange, variant = "eclipse", className }: { theme: Theme; onThemeChange: (t: Theme) => void; variant?: ThemeSwitchVariant; className?: string }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={cx("l-tswitch l-focus", className)}
      aria-label={dark ? "Switch to light" : "Switch to dark"}
      data-dark={dark || undefined}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        feedback.play("toggle", dark ? -2 : 2);
        switchTheme(variant, () => onThemeChange(dark ? "light" : "dark"), { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      <IconMorph kind="theme" on={dark} size={18} />
    </button>
  );
}
