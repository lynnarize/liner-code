/*
  FLIP for lists: remember where each keyed row was, and after React moves them, slide each
  one from its old place to its new one. Interruptible, and a no-op with reduced motion.
*/
import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./spring";

export function useFlip<T extends HTMLElement>(deps: unknown[], selector = "[data-flip]") {
  const root = useRef<T>(null);
  const last = useRef(new Map<string, DOMRect>());
  /** Call right before a change that reorders rows. */
  const capture = () => {
    const m = new Map<string, DOMRect>();
    root.current?.querySelectorAll<HTMLElement>(selector).forEach((el) => m.set(el.dataset.flip!, el.getBoundingClientRect()));
    last.current = m;
  };
  useLayoutEffect(() => {
    const before = last.current;
    if (!before.size || prefersReducedMotion()) return;
    root.current?.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const was = before.get(el.dataset.flip!);
      if (!was) return;
      const now = el.getBoundingClientRect();
      const dy = was.top - now.top;
      const dx = was.left - now.left;
      if (Math.abs(dy) < 0.5 && Math.abs(dx) < 0.5) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
    });
    last.current = new Map();
  }, deps);
  return { root, capture };
}
