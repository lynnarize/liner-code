import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./toast.css";

export type ToastKind = "default" | "success" | "error" | "info" | "loading";
export type ToastOptions = {
  description?: ReactNode;
  kind?: ToastKind;
  action?: { label: string; onClick: () => void };
  /** Milliseconds on screen. Loading toasts wait for their promise. */
  duration?: number;
  id?: number;
};
export type ToastData = Required<Pick<ToastOptions, "kind" | "duration">> &
  Omit<ToastOptions, "kind" | "duration"> & { id: number; title: ReactNode; removing?: "auto" | "left" | "right" | "down"; version: number };

/** A toast store. Use the default `toast` export app-wide, or create one per surface. */
export function createToaster() {
  let toasts: ToastData[] = [];
  let seq = 1;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  function upsert(title: ReactNode, opts: ToastOptions = {}) {
    const kind = opts.kind ?? "default";
    const duration = opts.duration ?? (kind === "loading" ? Infinity : kind === "error" ? 6000 : 4200);
    if (opts.id !== undefined && toasts.some((t) => t.id === opts.id)) {
      toasts = toasts.map((t) => (t.id === opts.id ? { ...t, ...opts, title, kind, duration, version: t.version + 1 } : t));
    } else {
      const id = opts.id ?? seq++;
      toasts = [...toasts, { ...opts, id, title, kind, duration, version: 0 }];
      feedback.play(kind === "error" ? "error" : "pop", 4);
    }
    emit();
    return opts.id ?? seq - 1;
  }

  const toast = Object.assign((title: ReactNode, opts?: ToastOptions) => upsert(title, opts), {
    success: (title: ReactNode, opts?: ToastOptions) => upsert(title, { ...opts, kind: "success" }),
    error: (title: ReactNode, opts?: ToastOptions) => upsert(title, { ...opts, kind: "error" }),
    info: (title: ReactNode, opts?: ToastOptions) => upsert(title, { ...opts, kind: "info" }),
    loading: (title: ReactNode, opts?: ToastOptions) => upsert(title, { ...opts, kind: "loading" }),
    /** One toast follows the promise: spinner, then a check or an error, in place. */
    promise<T>(p: Promise<T>, msgs: { loading: ReactNode; success: ReactNode | ((v: T) => ReactNode); error: ReactNode | ((e: unknown) => ReactNode); description?: ReactNode }) {
      const id = upsert(msgs.loading, { kind: "loading", description: msgs.description });
      p.then(
        (v) => {
          upsert(typeof msgs.success === "function" ? (msgs.success as (v: T) => ReactNode)(v) : msgs.success, { id, kind: "success", description: msgs.description, duration: 4200 });
          feedback.play("success");
        },
        (e) => upsert(typeof msgs.error === "function" ? (msgs.error as (e: unknown) => ReactNode)(e) : msgs.error, { id, kind: "error", description: msgs.description, duration: 6000 }),
      );
      return p;
    },
    dismiss(id?: number, how: ToastData["removing"] = "auto") {
      toasts = toasts.map((t) => (id === undefined || t.id === id ? { ...t, removing: t.removing ?? how } : t));
      emit();
    },
    /** Internal: drop a toast once its exit has played. */
    remove(id: number) {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    get: () => toasts,
  });
  return toast;
}

export type Toaster = ReturnType<typeof createToaster>;
export const toast = createToaster();

const icons: Record<Exclude<ToastKind, "default">, ReactNode> = {
  success: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="l-toast__svg-ok">
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity=".16" />
      <path d="M6.4 10.3 8.8 12.6 13.6 7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity=".16" />
      <path d="M10 6.2v4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="13.6" r="1.05" fill="currentColor" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity=".16" />
      <path d="M10 9.2v4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="6.5" r="1.05" fill="currentColor" />
    </svg>
  ),
  loading: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="l-toast__spin">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.8" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

export type ToasterProps = {
  store?: Toaster;
  /** Fixed to the viewport, or absolute inside a positioned parent. */
  placement?: "fixed" | "contained";
  /** How many toasts peek out behind the front one. */
  visible?: number;
  hotkey?: string;
  className?: string;
};

export function Toaster({ store = toast, placement = "fixed", visible = 3, hotkey = "F8", className }: ToasterProps) {
  const list = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [expanded, setExpanded] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const regionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === hotkey) {
        e.preventDefault();
        regionRef.current?.querySelector<HTMLElement>(".l-toast")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  useEffect(() => {
    if (!list.some((t) => !t.removing)) setExpanded(false);
  }, [list]);

  // Newest first. Heights let the expanded stack lay out without measuring in render.
  const ordered = [...list].reverse();
  const alive = ordered.filter((t) => !t.removing);
  const frontHeight = heights[alive[0]?.id] ?? 64;
  let offset = 0;

  return (
    <section
      ref={regionRef}
      className={cx("l-toaster", className)}
      data-placement={placement}
      data-expanded={expanded || undefined}
      aria-label={`Notifications, press ${hotkey} to focus`}
      onPointerEnter={(e) => e.pointerType === "mouse" && setExpanded(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setExpanded(false)}
      style={{ ["--front-h" as string]: `${frontHeight}px` }}
    >
      <ol className="l-toaster__list">
        {ordered.map((t) => {
          const index = alive.indexOf(t);
          const y = offset;
          if (index >= 0) offset += (heights[t.id] ?? 64) + 10;
          return (
            <ToastItem
              key={t.id}
              t={t}
              index={index < 0 ? 0 : index}
              expandedY={y}
              hidden={index >= visible}
              store={store}
              onHeight={(h) => setHeights((m) => (m[t.id] === h ? m : { ...m, [t.id]: h }))}
            />
          );
        })}
      </ol>
    </section>
  );
}

function ToastItem({
  t,
  index,
  expandedY,
  hidden,
  store,
  onHeight,
}: {
  t: ToastData;
  index: number;
  expandedY: number;
  hidden: boolean;
  store: Toaster;
  onHeight: (h: number) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [mounted, setMounted] = useState(false);
  const [swipe, setSwipe] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.querySelector<HTMLElement>(".l-toast__body")!.offsetHeight));
    ro.observe(el.querySelector(".l-toast__body")!);
    const id = requestAnimationFrame(() => setMounted(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(id);
    };
  }, []);

  useEffect(() => {
    if (!t.removing) return;
    const id = window.setTimeout(() => store.remove(t.id), 260);
    return () => window.clearTimeout(id);
  }, [t.removing, t.id, store]);

  const timed = Number.isFinite(t.duration) && !t.removing;
  const icon = t.kind === "default" ? null : icons[t.kind];

  return (
    <li
      ref={ref}
      className="l-toast l-focus"
      tabIndex={0}
      role={t.kind === "error" ? "alert" : "status"}
      aria-live={t.kind === "error" ? "assertive" : "polite"}
      aria-atomic
      data-kind={t.kind}
      data-front={index === 0 || undefined}
      data-mounted={mounted || undefined}
      data-hidden={hidden || undefined}
      data-removing={t.removing}
      data-swiping={swipe ? true : undefined}
      style={{
        ["--i" as string]: index,
        ["--y" as string]: `${expandedY}px`,
        ["--sx" as string]: swipe ? `${swipe.x}px` : undefined,
        ["--sy" as string]: swipe ? `${swipe.y}px` : undefined,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Delete" || e.key === "Backspace") store.dismiss(t.id);
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = Math.max(0, e.clientY - s.y);
        // Free sideways and down; resist up, the stack has nowhere to go.
        const up = Math.min(0, e.clientY - s.y);
        setSwipe({ x: dx, y: dy + up * 0.15 });
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || !swipe) return setSwipe(null);
        const dt = Math.max(1, performance.now() - s.t);
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        const fast = Math.abs(dx) / dt > 0.45 || dy / dt > 0.45;
        if (Math.abs(dx) > 80 || dy > 50 || fast) {
          store.dismiss(t.id, Math.abs(dx) > dy ? (dx < 0 ? "left" : "right") : "down");
          feedback.play("tap", -3);
        } else setSwipe(null);
      }}
      onPointerCancel={() => {
        start.current = null;
        setSwipe(null);
      }}
    >
      <div className="l-toast__body">
        {icon && (
          <span className="l-toast__icon" key={t.kind}>
            {icon}
          </span>
        )}
        <div className="l-toast__text">
          <div className="l-toast__title" key={`t${t.version}`}>
            {t.title}
          </div>
          {t.description && <div className="l-toast__desc">{t.description}</div>}
        </div>
        {t.action && (
          <button
            type="button"
            className="l-toast__action l-focus"
            onClick={() => {
              t.action!.onClick();
              store.dismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
        {timed && (
          <span
            className="l-toast__timer"
            data-timer=""
            key={`timer${t.version}`}
            style={{ animationDuration: `${t.duration}ms` }}
            onAnimationEnd={() => store.dismiss(t.id)}
            aria-hidden
          />
        )}
      </div>
      <button type="button" className="l-toast__close" aria-label="Dismiss" onClick={() => store.dismiss(t.id)}>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}
