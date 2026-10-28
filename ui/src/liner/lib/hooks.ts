import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Spring, type SpringConfig } from "./spring";

export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const reduceQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      reduceQuery?.addEventListener("change", cb);
      return () => reduceQuery?.removeEventListener("change", cb);
    },
    () => !!reduceQuery?.matches,
    () => false,
  );
}

/** A spring that writes straight to the DOM, so 60fps motion never re-renders React. */
export function useSpring(initial: number, config: SpringConfig, apply: (value: number, velocity: number) => void) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const ref = useRef<Spring | null>(null);
  if (!ref.current) ref.current = new Spring(initial, config, (v, vel) => applyRef.current(v, vel));
  useEffect(() => () => ref.current?.stop(), []);
  return ref.current;
}

/** Remembers the previous value for exit animations and direction. */
export function usePrevious<T>(value: T) {
  const ref = useRef<T>(value);
  const prev = ref.current;
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return prev;
}

/** Measures an element's box and keeps it current. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.offsetWidth, height: el.offsetHeight }));
    ro.observe(el);
    setSize({ width: el.offsetWidth, height: el.offsetHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Runs a callback after a delay, resetting when deps change. */
export function useTimeout(fn: () => void, ms: number | null) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = window.setTimeout(() => fnRef.current(), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
}

/** True once the element has scrolled into view, and stays true. Lets a demo start its story when someone is watching. */
export function useSeen<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(!enabled);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return [ref, seen] as const;
}

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Seconds elapsed while running; holds its value when stopped. */
export function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  const start = useRef(0);
  const sRef = useRef(0);
  sRef.current = s;
  useEffect(() => {
    if (!running) return;
    start.current = performance.now() - sRef.current * 1000;
    const id = window.setInterval(() => setS(Math.floor((performance.now() - start.current) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [running]);
  return [s, () => setS(0)] as const;
}
