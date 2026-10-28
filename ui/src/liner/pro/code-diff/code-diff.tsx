/*
  Liner Pro · Code diff
  What changed in code, file by file. The strip on the glass totals the change and holds
  the view: step through the changes, unified or split, wrap. Each file sits on the card
  under a header that folds it away; unchanged runs fold to one quiet line that opens in
  place, and a line that changed only a word or two picks out just those words. Syntax
  stays in ink and one accent, as in Code block; added and removed lines wear the status
  tones with a + or −, so they never rest on colour alone. One accent bar glides to the
  change you step to.
*/
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cx, useIsoLayoutEffect, useReducedMotion, useSize } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Segmented } from "../../components/segmented/segmented";
import { Tooltip } from "../../components/tooltip/tooltip";
import { RollingNumber } from "../../components/rolling-number/rolling-number";
import { tokenize, type Lang, type Token } from "../../components/code-block/tokenize";
import { diffRows, segment, type Range, type Row, type Segment } from "./diff";
import "../../components/code-block/code-block.css";
import "./code-diff.css";

export type DiffFile = {
  path: string;
  /** The file before the change; leave it out for a new file. */
  before?: string;
  /** The file after; leave it out for a deleted one. */
  after?: string;
  /** The old path, when the file moved. */
  from?: string;
  /** Read from the extension when left out. */
  language?: Lang;
};
export type CodeDiffView = "unified" | "split";
export type CodeDiffProps = {
  files: DiffFile[];
  /** What the changes are, on the strip: "Forge's changes", "Turn 2". */
  title?: ReactNode;
  view?: CodeDiffView;
  defaultView?: CodeDiffView;
  onViewChange?: (view: CodeDiffView) => void;
  defaultWrap?: boolean;
  /** Unchanged lines kept around each change; longer runs fold. */
  context?: number;
  /** The card scrolls past this height, with each file's header pinned. */
  maxHeight?: number;
  /** Paths that start folded away. */
  defaultCollapsed?: string[];
  className?: string;
};

// Split needs room for two columns of code; narrower than this it reads unified.
const SPLIT_MIN = 620;

const EXT: Record<string, Lang> = { tsx: "tsx", jsx: "tsx", ts: "ts", mts: "ts", cts: "ts", js: "js", mjs: "js", cjs: "js", css: "css", json: "json", sh: "bash", bash: "bash", zsh: "bash", html: "html", svg: "html", xml: "html" };

const linesOf = (text?: string) => (text === undefined || text === "" ? [] : text.replace(/\n$/, "").split("\n"));
const toks = (lines: string[], lang?: Lang): Token[][] => (lang ? tokenize(lines.join("\n"), lang) : lines.map((l) => (l ? [{ text: l, kind: "" }] : [])));

type Prepared = {
  key: string;
  file: DiffFile;
  status?: "New" | "Deleted" | "Moved";
  oldToks: Token[][];
  newToks: Token[][];
  segs: Segment[];
  adds: number;
  dels: number;
  /** The first change's index across every file, and how many this file has. */
  first: number;
  changes: number;
  digits: number;
};

function prepare(files: DiffFile[], context: number): Prepared[] {
  let first = 0;
  return files.map((file, i) => {
    const a = linesOf(file.before);
    const b = linesOf(file.after);
    const lang = file.language ?? EXT[file.path.split(".").pop()?.toLowerCase() ?? ""];
    const rows = diffRows(a, b);
    const changes = rows.reduce((n, r) => Math.max(n, (r.change ?? -1) + 1), 0);
    const p: Prepared = {
      key: `${i}:${file.path}`,
      file,
      status: file.before === undefined ? "New" : file.after === undefined ? "Deleted" : file.from && file.from !== file.path ? "Moved" : undefined,
      oldToks: toks(a, lang),
      newToks: toks(b, lang),
      segs: segment(rows, context),
      adds: rows.filter((r) => r.kind === "add").length,
      dels: rows.filter((r) => r.kind === "del").length,
      first,
      changes,
      digits: String(Math.max(a.length, b.length, 1)).length,
    };
    first += changes;
    return p;
  });
}

/** A line's syntax tokens, with the words that changed gathered into marks. */
function Code({ line, marks }: { line: Token[]; marks?: Range[] }) {
  const tok = (t: { text: string; kind: string }, k: number) =>
    t.kind ? (
      <span key={k} className={`l-tok-${t.kind}`}>
        {t.text}
      </span>
    ) : (
      <Fragment key={k}>{t.text}</Fragment>
    );
  if (!marks?.length) return <>{line.map(tok)}</>;
  // Cut tokens where marks begin and end, then wrap each mark's pieces in one element.
  const pieces: { text: string; kind: string; m: number }[] = [];
  let pos = 0;
  for (const t of line) {
    for (let s = 0; s < t.text.length; ) {
      const at = pos + s;
      const m = marks.findIndex(([a, b]) => at >= a && at < b);
      const next = m >= 0 ? marks[m][1] : (marks.find(([a]) => a > at)?.[0] ?? Infinity);
      const end = Math.min(t.text.length, next - pos);
      pieces.push({ text: t.text.slice(s, end), kind: t.kind, m });
      s = end;
    }
    pos += t.text.length;
  }
  const out: ReactNode[] = [];
  for (let i = 0; i < pieces.length; ) {
    let j = i;
    while (j < pieces.length && pieces[j].m === pieces[i].m) j++;
    const inner = pieces.slice(i, j).map(tok);
    out.push(
      pieces[i].m >= 0 ? (
        <mark key={i} className="l-cdiff__w">
          {inner}
        </mark>
      ) : (
        <Fragment key={i}>{inner}</Fragment>
      ),
    );
    i = j;
  }
  return <>{out}</>;
}

const said = { add: "Added: ", del: "Removed: " } as const;

/** One side of a line: its number, its sign and its code. */
function Line({ row, side, p, change }: { row?: Row; side: "old" | "new" | "one"; p: Prepared; change?: number }) {
  if (!row) return <div className="l-cdiff__line" data-empty aria-hidden />;
  const old = row.kind === "del" || (side === "old" && row.kind === "same");
  const n = old ? row.old! : row.new!;
  const line = (old ? p.oldToks : p.newToks)[n - 1] ?? [];
  return (
    <div className="l-cdiff__line" data-kind={row.kind} data-change={change}>
      <span className="l-cdiff__n" aria-hidden>
        {n}
      </span>
      <span className="l-cdiff__sign" aria-hidden>
        {row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}
      </span>
      <span className="l-cdiff__code">
        {row.kind !== "same" && <span className="l-sr-only">{said[row.kind]}</span>}
        <Code line={line} marks={row.words} />
      </span>
    </div>
  );
}

/** Rows in the chosen view. Split pairs each removal with the addition that replaced it. */
function Rows({ rows, p, split }: { rows: Row[]; p: Prepared; split: boolean }) {
  // The first row of each change carries its index, for stepping between changes.
  const firstOf = (r: Row, i: number) => (r.change !== undefined && rows[i - 1]?.change !== r.change ? p.first + r.change : undefined);
  if (!split) return <>{rows.map((r, i) => <Line key={i} row={r} side="one" p={p} change={firstOf(r, i)} />)}</>;
  const pairs: { l?: Row; r?: Row; change?: number }[] = [];
  for (let i = 0; i < rows.length; ) {
    const r = rows[i];
    if (r.kind === "same") {
      pairs.push({ l: r, r });
      i++;
      continue;
    }
    const start = pairs.length;
    const dels: Row[] = [];
    const adds: Row[] = [];
    for (; i < rows.length && rows[i].change === r.change; i++) (rows[i].kind === "del" ? dels : adds).push(rows[i]);
    // Twins sit side by side; the lines between them share rows in order, so little is left empty.
    let d = 0;
    let a = 0;
    const zip = (toD: number, toA: number) => {
      while (d < toD || a < toA) pairs.push({ l: d < toD ? dels[d++] : undefined, r: a < toA ? adds[a++] : undefined });
    };
    for (const [k, del] of dels.entries()) {
      if (del.twin === undefined) continue;
      zip(k, del.twin);
      pairs.push({ l: dels[d++], r: adds[a++] });
    }
    zip(dels.length, adds.length);
    pairs[start].change = p.first + r.change!;
  }
  return (
    <>
      {pairs.map((pr, i) => (
        <div key={i} className="l-cdiff__pair" data-change={pr.change}>
          <Line row={pr.l} side="old" p={p} />
          <Line row={pr.r} side="new" p={p} />
        </div>
      ))}
    </>
  );
}

const Chevron = () => (
  <svg className="l-cdiff__chev" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M4.5 6.25 8 9.75l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function CodeDiff({ files, title, view, defaultView = "unified", onViewChange, defaultWrap = false, context = 3, maxHeight = 520, defaultCollapsed = [], className }: CodeDiffProps) {
  const prepared = useMemo(() => prepare(files, context), [files, context]);
  const [ref, size] = useSize<HTMLElement>();
  const reduced = useReducedMotion();
  const live = useId();
  const [innerView, setInnerView] = useState(defaultView);
  const chosen = view ?? innerView;
  const roomy = (size?.width ?? Infinity) >= SPLIT_MIN;
  const split = chosen === "split" && roomy;
  const [wrap, setWrap] = useState(defaultWrap);
  const [collapsed, setCollapsed] = useState(() => new Set(prepared.filter((p) => defaultCollapsed.includes(p.file.path)).map((p) => p.key)));
  const [opened, setOpened] = useState(() => new Set<string>());
  // The change you stepped to, and where its accent bar sits on the card.
  const [at, setAt] = useState(-1);
  const [visit, setVisit] = useState(0);
  const [bar, setBar] = useState<{ y: number; h: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const adds = prepared.reduce((n, p) => n + p.adds, 0);
  const dels = prepared.reduce((n, p) => n + p.dels, 0);
  const steps = prepared.filter((p) => !collapsed.has(p.key)).flatMap((p) => Array.from({ length: p.changes }, (_, i) => p.first + i));

  const pickView = (v: CodeDiffView) => {
    if (view === undefined) setInnerView(v);
    onViewChange?.(v);
  };
  const toggleFile = (p: Prepared) => {
    const folding = !collapsed.has(p.key);
    setCollapsed((s) => {
      const next = new Set(s);
      if (!next.delete(p.key)) next.add(p.key);
      return next;
    });
    // Folding away the file you are on lets the bar go with it.
    if (folding && at >= p.first && at < p.first + p.changes) setAt(-1);
    feedback.play("tap");
  };
  // The button gives way as the lines open, so focus moves on to the lines it opened.
  const focusFold = useRef<string | null>(null);
  const unfold = (id: string) => {
    focusFold.current = id;
    setOpened((s) => new Set(s).add(id));
    feedback.play("tap", 2);
  };

  const step = (dir: 1 | -1) => {
    if (!steps.length) return;
    const from = steps.indexOf(at);
    setAt(steps[from < 0 ? (dir > 0 ? 0 : steps.length - 1) : (from + dir + steps.length) % steps.length]);
    // Counted too, so stepping to the only change brings it back after you scroll away.
    setVisit((v) => v + 1);
    feedback.play("tick", dir);
  };

  // Where the change you stepped to sits on the card, measured with offsets (they hold inside
  // CSS zoom). The bar follows it as lines fold, wrap or change layout.
  const measure = () => {
    const card = cardRef.current;
    const rows = at < 0 || !card ? [] : [...card.querySelectorAll<HTMLElement>("[data-change]")];
    const i = rows.findIndex((r) => r.dataset.change === String(at));
    if (!card || i < 0) {
      setBar(null);
      return null;
    }
    const top = (el: HTMLElement) => {
      let y = 0;
      for (let n: HTMLElement | null = el; n && n !== card; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      return y;
    };
    // The change runs on until the next unchanged line (a split pair is changed if either side is).
    const changed = (el: HTMLElement) => el.dataset.change === undefined && (/add|del/.test(el.dataset.kind ?? "") || !!el.querySelector(":scope > [data-kind='add'], :scope > [data-kind='del']"));
    let last = rows[i];
    for (let n = last.nextElementSibling as HTMLElement | null; n && changed(n); n = n.nextElementSibling as HTMLElement | null) last = n;
    const y = top(rows[i]);
    const h = top(last) + last.offsetHeight - y;
    setBar((b) => (b?.y === y && b.h === h ? b : { y, h }));
    return { card, row: rows[i], y };
  };

  // Stepping brings the change into view, just under its file's header.
  useIsoLayoutEffect(() => {
    const m = measure();
    if (!m) return;
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
    if (m.card.scrollHeight > m.card.clientHeight + 1) {
      const head = m.card.querySelector<HTMLElement>(".l-cdiff__head")?.offsetHeight ?? 0;
      m.card.scrollTo({ top: Math.max(0, m.y - head - 28), behavior });
    } else m.row.scrollIntoView({ block: "nearest", behavior });
  }, [at, visit]);

  useEffect(() => {
    const card = cardRef.current;
    if (at < 0 || !card) return;
    const ro = new ResizeObserver(() => measure());
    card.querySelectorAll(".l-cdiff__file").forEach((f) => ro.observe(f));
    return () => ro.disconnect();
  }, [at, split, wrap, prepared]);

  const here = prepared.find((p) => at >= p.first && at < p.first + p.changes);

  return (
    <section ref={ref} className={cx("l-cdiff l-frame", className)} data-wrap={wrap || undefined} data-view={split ? "split" : "unified"} aria-label="Code changes">
      <div className="l-frame-strip l-cdiff__top">
        <span className="l-cdiff__title">
          <span className="l-cdiff__label">{title ?? `${files.length} ${files.length === 1 ? "file" : "files"} changed`}</span>
          <span className="l-cdiff__tally l-num">
            <span data-add>
              +<RollingNumber value={adds} />
            </span>
            <span data-del>
              −<RollingNumber value={dels} />
            </span>
            <span className="l-sr-only">
              {adds} lines added, {dels} removed
            </span>
          </span>
        </span>
        <span className="l-cdiff__tools">
          <Tooltip content="Previous change">
            <button type="button" className="l-cdiff__icon l-plate l-focus" aria-label="Previous change" disabled={!steps.length} onClick={() => step(-1)}>
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4.5 9.75 8 6.25l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip content="Next change">
            <button type="button" className="l-cdiff__icon l-plate l-focus" aria-label="Next change" disabled={!steps.length} onClick={() => step(1)}>
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4.5 6.25 8 9.75l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
          {roomy && (
            <Segmented<CodeDiffView>
              className="l-cdiff__view"
              size="sm"
              aria-label="Layout"
              value={chosen}
              onValueChange={pickView}
              options={[
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ]}
            />
          )}
          <Tooltip content={wrap ? "Scroll long lines" : "Wrap long lines"}>
            <button
              type="button"
              className="l-cdiff__icon l-plate l-focus"
              aria-label="Wrap long lines"
              aria-pressed={wrap || split}
              data-on={wrap || split || undefined}
              disabled={split}
              onClick={() => {
                setWrap((w) => !w);
                feedback.play("toggle");
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M2.75 4h10.5M2.75 8h8.5a2 2 0 0 1 0 4H8.5m0 0 1.5-1.5M8.5 12l1.5 1.5M2.75 12H5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
        </span>
      </div>
      <div ref={cardRef} className="l-frame-card l-cdiff__card" style={{ maxHeight }}>
        {bar && <span className="l-cdiff__here" style={{ translate: `0 ${bar.y}px`, height: bar.h }} aria-hidden />}
        {prepared.map((p) => {
          const folded = collapsed.has(p.key);
          const slash = p.file.path.lastIndexOf("/");
          // A new or deleted file has only one side, so it reads unified in either view.
          const two = split && p.status !== "New" && p.status !== "Deleted";
          return (
            <div key={p.key} className="l-cdiff__file" data-folded={folded || undefined}>
              <div className="l-cdiff__head">
                <button type="button" className="l-cdiff__name l-focus" aria-expanded={!folded} onClick={() => toggleFile(p)}>
                  <Chevron />
                  <span className="l-cdiff__path">
                    {slash >= 0 && <span className="l-cdiff__dir">{p.file.path.slice(0, slash + 1)}</span>}
                    <b>{p.file.path.slice(slash + 1)}</b>
                  </span>
                  {p.status && (
                    <span className="l-cdiff__status" data-status={p.status}>
                      {p.status === "Moved" ? `Moved from ${p.file.from}` : p.status}
                    </span>
                  )}
                </button>
                <span className="l-cdiff__counts l-num" aria-label={`${p.adds} added, ${p.dels} removed`}>
                  {p.adds > 0 && <span data-add>+{p.adds}</span>}
                  {p.dels > 0 && <span data-del>−{p.dels}</span>}
                </span>
              </div>
              <div className="l-cdiff__body" inert={folded}>
                <div className="l-cdiff__clip">
                  {p.changes === 0 ? (
                    <p className="l-cdiff__same">{p.status === "Moved" ? "Moved without changes." : "No changes in this file."}</p>
                  ) : (
                    <div className="l-cdiff__scroll" tabIndex={wrap || split ? undefined : 0} role="group" aria-label={`Changes to ${p.file.path}`}>
                      <div className="l-cdiff__rows" style={{ ["--cd-digits" as string]: p.digits }}>
                        {p.segs.map((s, i) => {
                          if (s.kind === "rows") return <Rows key={i} rows={s.rows} p={p} split={two} />;
                          const id = `${p.key}#${s.id}`;
                          const open = opened.has(id);
                          return (
                            <div key={i} className="l-cdiff__fold" data-open={open || undefined}>
                              <div className="l-cdiff__bar">
                                <div className="l-cdiff__clip">
                                  <button type="button" className="l-cdiff__unfold l-focus" tabIndex={open ? -1 : undefined} onClick={() => unfold(id)}>
                                    <span>
                                      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                                        <path d="M5.25 5.5 8 2.75l2.75 2.75M5.25 10.5 8 13.25l2.75-2.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                      {s.rows.length} unchanged lines
                                    </span>
                                  </button>
                                </div>
                              </div>
                              {open && (
                                <div
                                  className="l-cdiff__more"
                                  tabIndex={-1}
                                  ref={(el) => {
                                    if (el && focusFold.current === id) {
                                      focusFold.current = null;
                                      el.focus({ preventScroll: true });
                                    }
                                  }}
                                >
                                  <div className="l-cdiff__clip">
                                    <Rows rows={s.rows} p={p} split={two} />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!prepared.length && <p className="l-cdiff__same">Nothing has changed yet.</p>}
      </div>
      <span id={live} className="l-sr-only" aria-live="polite">
        {here ? `Change ${steps.indexOf(at) + 1} of ${steps.length}, in ${here.file.path}` : ""}
      </span>
    </section>
  );
}
