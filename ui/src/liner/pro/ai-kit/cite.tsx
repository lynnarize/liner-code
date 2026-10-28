/*
  Citations. A CiteScope owns the sources, which citation or source is lit, and one
  shared preview card. Chips light their sentence and source cards; source cards light
  every sentence that cites them. The preview has hover intent, so moving into it
  keeps it open, and keyboard focus opens it too.
*/
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SourceMark } from "./marks";

export type Source = { title: string; name: string; domain?: string; snippet?: string; href?: string; hue?: number };
export type Lit = { sources: number[]; sentence: number | null; from: "cite" | "card" };

type Preview = { ids: number[]; key: number; x: number; y: number; below: boolean };

type Ctx = {
  sources: Source[];
  variant: "named" | "number";
  lit: Lit | null;
  light: (lit: Lit | null) => void;
  preview: Preview | null;
  open: (ids: number[], key: number, el: HTMLElement) => void;
  close: () => void;
  keep: () => void;
};

const CiteContext = createContext<Ctx | null>(null);
export const useCites = () => useContext(CiteContext);

export function CiteScope({ sources, variant = "named", className, children }: { sources: Source[]; variant?: "named" | "number"; className?: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState<Lit | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const keep = useCallback(() => window.clearTimeout(closeTimer.current), []);
  const close = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setPreview(null);
      // Only clear what a citation lit; a source card may have taken over since.
      setLit((l) => (l?.from === "cite" ? null : l));
    }, 140);
  }, []);
  const open = useCallback((ids: number[], key: number, el: HTMLElement) => {
    window.clearTimeout(closeTimer.current);
    const root = rootRef.current;
    if (!root) return;
    const r = el.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const below = r.bottom - box.top + 180 < Math.max(box.height, 260) || r.top - box.top < 190;
    setPreview({ ids, key, x: r.left - box.left + r.width / 2, y: below ? r.bottom - box.top + 6 : r.top - box.top - 6, below });
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const light = useCallback((l: Lit | null) => {
    if (l?.from === "card") {
      window.clearTimeout(closeTimer.current);
      setPreview(null);
    }
    setLit(l);
  }, []);
  const value = useMemo<Ctx>(() => ({ sources, variant, lit, light, preview, open, close, keep }), [sources, variant, lit, light, preview, open, close, keep]);
  return (
    <CiteContext.Provider value={value}>
      <div className={className} ref={rootRef} style={{ position: "relative" }}>
        {children}
        {preview && <PreviewCard key={preview.key} preview={preview} rootRef={rootRef} />}
      </div>
    </CiteContext.Provider>
  );
}

function PreviewCard({ preview, rootRef }: { preview: Preview; rootRef: React.RefObject<HTMLDivElement | null> }) {
  const ctx = useCites()!;
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  // Keep the card inside the scope, centered on its chip when there is room.
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 280;
    const max = (rootRef.current?.clientWidth ?? 600) - w - 4;
    setLeft(Math.max(4, Math.min(max, preview.x - w / 2)));
  }, [preview, rootRef]);
  const items = preview.ids.map((id) => ({ id, s: ctx.sources[id - 1] })).filter((x) => x.s);
  return (
    <div
      ref={ref}
      className="l-cite-card"
      role="tooltip"
      data-below={preview.below || undefined}
      style={{ left: left ?? -9999, top: preview.y }}
      onPointerEnter={ctx.keep}
      onPointerLeave={ctx.close}
    >
      {items.map(({ id, s }) => {
        const Tag = s.href ? "a" : "div";
        return (
          <Tag key={id} className="l-cite-card-item" {...(s.href ? { href: s.href, target: "_blank", rel: "noreferrer" } : {})}>
            <span className="l-cite-card-site">
              <SourceMark name={s.name} hue={s.hue} size={14} />
              {s.domain ?? s.name}
              <span className="l-cite-card-n l-num">{id}</span>
            </span>
            <span className="l-cite-card-title">{s.title}</span>
            {items.length === 1 && s.snippet && <span className="l-cite-card-snip">{s.snippet}</span>}
          </Tag>
        );
      })}
    </div>
  );
}

/** One citation in running text. Named shows "Notion +1"; number shows one pill per source. */
export function Cite({ ids, at, sentence }: { ids: number[]; at: number; sentence: number | null }) {
  const ctx = useCites();
  if (!ctx) return null;
  const valid = ids.filter((id) => ctx.sources[id - 1]);
  if (!valid.length) return <span className="l-cite-plain">[{ids.join(",")}]</span>;
  const on = ctx.preview?.key === at;
  // A hovered source card lights every chip that cites it.
  const lit = ctx.lit?.from === "card" && valid.some((id) => ctx.lit!.sources.includes(id));
  const enter = (el: HTMLElement) => {
    ctx.light({ sources: valid, sentence, from: "cite" });
    ctx.open(valid, at, el);
  };
  const leave = () => ctx.close();
  const label = valid.map((id) => `Source ${id}: ${ctx.sources[id - 1].title}`).join("; ");

  if (ctx.variant === "number")
    return (
      <span className="l-cites">
        {valid.map((id) => (
          <button
            key={id}
            type="button"
            className="l-cite l-cite-num l-focus"
            data-open={(on && ctx.preview?.ids.length === 1 && ctx.preview.ids[0] === id) || undefined}
            data-lit={(ctx.lit?.from === "card" && ctx.lit.sources.includes(id)) || undefined}
            aria-label={`Source ${id}: ${ctx.sources[id - 1].title}`}
            onPointerEnter={(e) => {
              ctx.light({ sources: [id], sentence, from: "cite" });
              ctx.open([id], at, e.currentTarget);
            }}
            onPointerLeave={leave}
            onFocus={(e) => {
              ctx.light({ sources: [id], sentence, from: "cite" });
              ctx.open([id], at, e.currentTarget);
            }}
            onBlur={leave}
            onKeyDown={(e) => e.key === "Escape" && ctx.close()}
          >
            {id}
          </button>
        ))}
      </span>
    );

  const first = ctx.sources[valid[0] - 1];
  return (
    <button
      type="button"
      className="l-cite l-focus"
      data-open={on || undefined}
      data-lit={lit || undefined}
      aria-label={label}
      onPointerEnter={(e) => enter(e.currentTarget)}
      onPointerLeave={leave}
      onFocus={(e) => enter(e.currentTarget)}
      onBlur={leave}
      onKeyDown={(e) => e.key === "Escape" && ctx.close()}
      onClick={(e) => enter(e.currentTarget)}
    >
      {first.name}
      {valid.length > 1 && <span className="l-cite-more l-num">+{valid.length - 1}</span>}
    </button>
  );
}
