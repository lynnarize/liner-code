/*
  Liner Pro · Agents (shared pieces)
  Named agents, each with its own glyph, so people can tell at a glance who is
  doing what. No per-agent color: status is the only thing that gets one. Used by the
  Agent plan and Agent feed.
*/
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { prefersReducedMotion } from "../../lib/spring";
import "./agents.css";

export type Agent = { id: string; name: string; role: string; glyph: AgentGlyph };
/** The first four are Halcyon's team; the rest mark a specialty (shapes for design, code, a scope for debugging, a lens for research, a spark for anything else). */
export type AgentGlyph = "sun" | "leaf" | "moon" | "pen" | "shapes" | "code" | "scope" | "lens" | "spark";
export type AgentStatus = "working" | "waiting" | "done" | "paused" | "idle";

export const sampleAgents: Agent[] = [
  { id: "ledger", name: "Ledger", role: "Finance", glyph: "sun" },
  { id: "herald", name: "Herald", role: "Launches", glyph: "pen" },
  { id: "forge", name: "Forge", role: "Code", glyph: "moon" },
  { id: "atlas", name: "Atlas", role: "Research", glyph: "leaf" },
];

const glyphs: Record<AgentGlyph, ReactNode> = {
  shapes: <path d="M4.3 4.3h3.9v3.9H4.3ZM10.1 7.8a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />,
  code: <path d="M6.1 5.4 3.7 8l2.4 2.6M9.9 5.4 12.3 8l-2.4 2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  scope: <path d="M8 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM8 3.4v2M8 10.6v2M3.4 8h2M10.6 8h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />,
  lens: <path d="M7.2 4.4a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Zm2 4.8 2.4 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />,
  spark: <path d="M8 3.9 9 7l3.1 1L9 9l-1 3.1L7 9 3.9 8 7 7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />,
  sun: <path d="M8 4.2v1.3M8 10.5v1.3M4.2 8h1.3M10.5 8h1.3M5.3 5.3l.9.9M9.8 9.8l.9.9M10.7 5.3l-.9.9M6.2 9.8l-.9.9M8 6.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />,
  leaf: <path d="M4.6 11.4c0-4.1 2.6-6.6 6.8-6.8-.2 4.2-2.7 6.8-6.8 6.8Zm0 0 3.6-3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  moon: <path d="M10.9 9.8A3.6 3.6 0 0 1 6.2 5.1a3.6 3.6 0 1 0 4.7 4.7Z" fill="currentColor" />,
  pen: <path d="m9.6 4.7 1.7 1.7-4.9 4.9-2.1.4.4-2.1 4.9-4.9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />,
};

/** A quiet round avatar with the agent's glyph and an optional live status badge. */
export function AgentAvatar({ a, size = 24, status, dim }: { a: Agent; size?: number; status?: AgentStatus; dim?: boolean }) {
  return (
    <span className="l-agent" data-status={status} data-dim={dim || undefined} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 16 16" className="l-agent-glyph">
        {glyphs[a.glyph]}
      </svg>
      {status && status !== "idle" && (
        <span className="l-agent-badge" key={status}>
          {status === "working" ? (
            <span className="l-agent-spin">
              <svg viewBox="0 0 10 10">
                <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="10 12" strokeLinecap="round" />
              </svg>
            </span>
          ) : status === "done" ? (
            <svg viewBox="0 0 10 10">
              <path d="M2.8 5.2 4.3 6.6 7.3 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
            </svg>
          ) : status === "paused" ? (
            <svg viewBox="0 0 10 10">
              <path d="M3.8 3.2v3.6M6.2 3.2v3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          ) : null}
        </span>
      )}
    </span>
  );
}

/** A person or organisation, as a small letter tile and a name. */
export function Who({ name, kind = "person" }: { name: string; kind?: "person" | "org" }) {
  return (
    <span className="l-who" data-kind={kind}>
      <span className="l-who-tile" aria-hidden>
        {name.charAt(0)}
      </span>
      {name}
    </span>
  );
}

/**
 * The line both surfaces type into: a white field on the glass strip under the card, a disc
 * that says what it does (a plus to add, the agent's face to ask), and the Composer's
 * round send, which fills in once there is something to send.
 */
export function AskLine({ icon, placeholder, label, busy, onSubmit, className }: { icon: ReactNode; placeholder: string; label?: string; busy?: boolean; onSubmit: (text: string) => void; className?: string }) {
  const [draft, setDraft] = useState("");
  const ready = !!draft.trim() && !busy;
  return (
    <form
      className={cx("l-frame-strip l-agent-ask", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onSubmit(draft.trim());
        setDraft("");
      }}
    >
      <div className="l-agent-ask__field">
        <span className="l-agent-ask__icon" aria-hidden>
          {icon}
        </span>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder} enterKeyHint="send" />
        <button type="submit" className="l-agent-ask__send l-focus" data-ready={ready || undefined} aria-disabled={!ready || undefined} aria-label="Send">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 12.5V3.5M4.1 7.4 8 3.5l3.9 3.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  );
}

/** The plus in AskLine's disc, for lines that add rather than ask. */
export const AddGlyph = () => (
  <span className="l-agent-ask__add">
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 4.25v7.5M4.25 8h7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  </span>
);

/**
 * Keeps a scroller pinned to the bottom while content grows, on a soft lerp.
 * Scrolling up releases it; `jump` brings it back.
 */
export function useStickToBottom() {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const raf = useRef(0);
  const [away, setAway] = useState(false);

  const follow = useCallback(() => {
    const el = ref.current;
    if (!el || !stuck.current) return;
    cancelAnimationFrame(raf.current);
    if (prefersReducedMotion()) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const step = () => {
      const target = el.scrollHeight - el.clientHeight;
      const d = target - el.scrollTop;
      if (!stuck.current) return;
      if (Math.abs(d) < 1) return;
      const from = el.scrollTop;
      el.scrollTop += d * 0.16;
      // Content a fraction of a pixel taller than the box, or a step under one device pixel,
      // leaves scrollTop where it was. Land and stop, or this asks for a layout every frame forever.
      if (el.scrollTop === from) {
        el.scrollTop = target;
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  useLayoutEffect(() => {
    const c = contentRef.current;
    if (!c) return;
    const ro = new ResizeObserver(follow);
    ro.observe(c);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [follow]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        stuck.current = false;
        cancelAnimationFrame(raf.current);
      }
    };
    const onScroll = () => {
      const d = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (d < 30) stuck.current = true;
      setAway(d > 80 && !stuck.current);
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", () => (stuck.current = false), { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const jump = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stuck.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);

  const stick = useCallback(() => {
    stuck.current = true;
    setAway(false);
    requestAnimationFrame(follow);
  }, [follow]);

  return { ref, contentRef, away, jump, stick, follow };
}
