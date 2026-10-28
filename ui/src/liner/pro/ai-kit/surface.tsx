/*
  Liner Pro · AI kit · Surface
  The pieces AI chat, AI answer and the Composer share, so the three read as one design:
  who is answering, source cards, the action row with its feedback reasons, and the glass
  menu. Their containers are the foundation frame: .l-frame, .l-frame-card, .l-frame-strip.
*/
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cx } from "../../lib/hooks";
import { feedback as sound } from "../../lib/feedback";
import { CopyButton } from "../../components/copy-button/copy-button";
import { AiMark, ModelMark, SourceMark, type AiPhase } from "./marks";
import { useCites, type Source } from "./cite";

export type AiModelRef = { id: string; name: string };
export type AiVote = "up" | "down" | null;

/** Who is answering: the orb while it works, the model's mark and name once it rests. */
export function AiWho({ working, phase, model, status, children }: { working: boolean; phase: AiPhase; model: AiModelRef; status?: string; children?: ReactNode }) {
  const text = working ? (status ?? "Thinking") : (status ?? model.name);
  return (
    <div className="l-ai-who">
      <span className="l-ai-who-mark" key={working ? "work" : "rest"}>
        {working ? <AiMark phase={phase} size={20} /> : <ModelMark id={model.id} size={16} />}
      </span>
      {children ?? (
        <span key={text} className={working ? "l-ai-who-text l-shimmer" : "l-ai-who-text"}>
          {text}
        </span>
      )}
    </div>
  );
}

/**
 * Sources as small cards that scroll sideways. Hovering one lights the sentences that cite
 * it. `ids` maps each card to its citation number when the order differs (0 for none), and
 * `slots` holds empty places for sources still on the way.
 */
export function SourceCards({ sources, ids, bleed, stagger = 110, slots = 0 }: { sources: Source[]; ids?: number[]; bleed?: number; stagger?: number; slots?: number }) {
  const cites = useCites();
  const lit = cites?.lit?.sources ?? [];
  return (
    <div className="l-ai-sources" role="list" aria-label="Sources" style={bleed === undefined ? undefined : { ["--bleed" as string]: `${bleed}px` }}>
      {sources.map((s, i) => {
        const id = ids?.[i] ?? i + 1;
        const on = id > 0 && cites ? () => cites.light({ sources: [id], sentence: null, from: "card" }) : undefined;
        const off = on ? () => cites!.light(null) : undefined;
        // Without a link it is a plain card, so it never nests an anchor inside another.
        const Card = s.href ? "a" : "div";
        return (
          <Card
            key={s.title}
            role="listitem"
            href={s.href}
            target={s.href ? "_blank" : undefined}
            rel={s.href ? "noreferrer" : undefined}
            tabIndex={s.href ? undefined : 0}
            className="l-ai-source l-glass-rim l-focus"
            data-lit={(id > 0 && lit.includes(id)) || undefined}
            style={{ animationDelay: `${i * stagger}ms` }}
            onPointerEnter={on}
            onPointerLeave={off}
            onFocus={on}
            onBlur={off}
          >
            <span className="l-ai-source-site">
              <SourceMark name={s.name} hue={s.hue} size={14} />
              {s.name}
              {id > 0 && <span className="l-ai-source-n l-num">{id}</span>}
            </span>
            <span className="l-ai-source-title">{s.title}</span>
          </Card>
        );
      })}
      {Array.from({ length: slots }, (_, i) => (
        <span key={`slot${i}`} className="l-ai-slot" aria-hidden>
          <i />
          <i />
        </span>
      ))}
    </div>
  );
}

/**
 * Copy, regenerate, thumbs and the version pager, with one quiet line of meta on the right.
 * Thumbs down asks why with a row of reasons that opens under it.
 */
export function AiActions({
  copy,
  onRegenerate,
  regenerateLabel = "Regenerate",
  busy,
  vote,
  onVote,
  reasons,
  onReason,
  versions,
  took,
  stopped,
  className,
}: {
  copy: () => string;
  onRegenerate: () => void;
  regenerateLabel?: string;
  busy?: boolean;
  vote: AiVote;
  onVote: (vote: AiVote) => void;
  reasons?: string[];
  onReason?: (reason: string) => void;
  versions?: { index: number; count: number; onPage: (dir: -1 | 1) => void };
  /** Seconds the answer took, already formatted. */
  took?: string;
  stopped?: boolean;
  className?: string;
}) {
  const [spin, setSpin] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    setReason(null);
  }, [vote]);
  const asking = vote === "down" && !reason && !!reasons?.length;
  const meta = asking ? "What went wrong?" : vote ? "Thanks for the feedback" : stopped ? "Stopped early" : took ? `Answered in ${took}s` : "";

  return (
    <div className={cx("l-ai-feedback", className)} data-asking={asking || undefined}>
      <div className="l-ai-actions">
        <div className="l-ai-actions-row">
          <CopyButton value={copy} iconOnly size="sm" variant="ghost" label="Copy" />
          <button
            type="button"
            className="l-ai-act l-focus"
            aria-label={regenerateLabel}
            disabled={busy}
            onClick={() => {
              setSpin((s) => s + 1);
              onRegenerate();
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-ai-regen" key={spin}>
              <path d="M13.1 8a5.1 5.1 0 1 1-1.5-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M13.25 2.9v2.6h-2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {(["up", "down"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="l-ai-act l-focus"
              aria-label={v === "up" ? "Good answer" : "Bad answer"}
              aria-pressed={vote === v}
              data-on={vote === v || undefined}
              onClick={() => {
                const next = vote === v ? null : v;
                onVote(next);
                sound.play(next ? "pop" : "tap", next === "up" ? 6 : 0);
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-ai-thumb" data-dir={v}>
                <path
                  d="M5.25 7.1 7.6 2.6c.9 0 1.6.75 1.5 1.65l-.25 2.1h3.05a1.4 1.4 0 0 1 1.38 1.65l-.7 3.9a1.4 1.4 0 0 1-1.38 1.15H5.25V7.1ZM5.25 7.1H3.4a.9.9 0 0 0-.9.9v4.25c0 .5.4.9.9.9h1.85"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
          {versions && versions.count > 1 && (
            <div className="l-ai-versions" role="group" aria-label={`Version ${versions.index + 1} of ${versions.count}`}>
              <button type="button" className="l-ai-ver l-focus" aria-label="Previous version" disabled={versions.index === 0 || busy} onClick={() => versions.onPage(-1)}>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M10 4 6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span className="l-num">
                {versions.index + 1} / {versions.count}
              </span>
              <button type="button" className="l-ai-ver l-focus" aria-label="Next version" disabled={versions.index === versions.count - 1 || busy} onClick={() => versions.onPage(1)}>
                <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <span className="l-ai-meta" key={meta}>
          {meta}
        </span>
      </div>
      {reasons && reasons.length > 0 && (
        <div className="l-ai-reasons" data-open={asking || undefined}>
          <div>
            {reasons.map((r, i) => (
              <button
                key={r}
                type="button"
                className="l-ai-reason l-focus"
                tabIndex={asking ? 0 : -1}
                style={{ transitionDelay: asking ? `${i * 40}ms` : "0ms" }}
                onClick={() => {
                  setReason(r);
                  onReason?.(r);
                  sound.play("tick", 4);
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export type AiMenuItem = { id: string; label: ReactNode; note?: ReactNode; icon?: ReactNode; checked?: boolean };

/** A glass menu that floats over the surface. Focus moves in, arrows move, Escape hands it back. */
export function AiMenu({
  label,
  items,
  place,
  below,
  anchor,
  footer,
  onPick,
  onClose,
  onSide,
}: {
  label: string;
  items: AiMenuItem[];
  place: "start" | "end";
  below?: boolean;
  anchor: RefObject<HTMLElement | null>;
  footer?: ReactNode;
  onPick: (item: AiMenuItem) => void;
  onClose: () => void;
  /** Left and right arrows, e.g. to change effort while the menu is open. */
  onSide?: (dir: -1 | 1) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((it) => it.checked)));
  const [hl, setHl] = useState<{ y: number; h: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) closeRef.current();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [anchor]);
  useLayoutEffect(() => {
    const row = listRef.current?.querySelectorAll<HTMLElement>("[role^=menuitem]")[active];
    if (row) setHl({ y: row.offsetTop, h: row.offsetHeight });
  }, [active]);

  const close = (refocus = true) => {
    onClose();
    if (refocus) anchor.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={ref}
      className="l-ai-menu l-glass-rim"
      data-place={place}
      data-below={below || undefined}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        const n = items.length;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
          sound.play("tick");
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          setActive(e.key === "Home" ? 0 : n - 1);
        } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && onSide) {
          e.preventDefault();
          onSide(e.key === "ArrowLeft" ? -1 : 1);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(items[active]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === "Tab") {
          close(false);
        }
      }}
    >
      <div className="l-ai-menu-list" ref={listRef}>
        {hl && <span className="l-ai-hl" style={{ transform: `translateY(${hl.y}px)`, height: hl.h }} aria-hidden />}
        {items.map((it, i) => (
          <div
            key={it.id}
            role={it.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={it.checked}
            className="l-ai-menu-item"
            data-active={i === active || undefined}
            onPointerMove={() => i !== active && setActive(i)}
            onClick={() => onPick(it)}
          >
            {it.icon && <span className="l-ai-menu-icon">{it.icon}</span>}
            <span className="l-ai-menu-text">
              <span className="l-ai-menu-name">{it.label}</span>
              {it.note && <span className="l-ai-menu-desc">{it.note}</span>}
            </span>
            {it.checked && (
              <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-ai-menu-check">
                <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}
