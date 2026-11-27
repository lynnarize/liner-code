/*
  Liner Security's small shared pieces, so every page draws a severity, a split, a tag or a bordered box the same way.
  Translated from the mockup's sheet (sec.css: .sev, .parts, .sevbar, .sevleg, .tag, .card, .segs, .cb.chip, .bx, .pick,
  .sw) into the app's own tokens; the classes are security.css's `ls-` ones. Where the app has the thing already (Pop,
  Row, the Liner Switch, Num), these use it. Empty states and find fields are the panel frame's own (Pane.tsx).
*/
import type { ReactNode } from "react";
import type { Severity, SeverityCounts } from "@contracts";
import { SEVERITIES, SEVERITY_LABEL } from "@contracts";
import { Switch } from "@liner/components/switch/switch";
import { I } from "../icons";
import * as os from "../os";
import "./security.css";

/** A colour key for a part of a whole: a severity, or the second look's three answers. */
export type Tone = Severity | "ok" | "no" | "na";

/** How bad: its word on a tag in the severity's colour, drawn this one way everywhere; in a list's fixed column, or as wide as it is (`dot`) where it stands alone (a finding's own top row). */
export function SevMark({ severity, dot, children }: { severity: Severity; dot?: boolean; children?: ReactNode }) {
  return (
    <span className="ls-sev" data-sev={severity} data-dot={dot || undefined}>
      <i aria-hidden />
      {children ?? SEVERITY_LABEL[severity]}
    </span>
  );
}

/** How bad, as its round dot alone, with its word for a screen reader: the icon of a finding's row in a pane (PaneRow). */
export const SevSquare = ({ severity }: { severity: Severity }) => (
  <span className="ls-sev ls-sev-sq" data-sev={severity} role="img" aria-label={SEVERITY_LABEL[severity]}>
    <i />
  </span>
);

/** One part of a whole, for Parts and Legend: a tone the sheet knows, or its own `color` (a project's, "p0"…). */
export type Part = { tone: Tone | `p${number}`; value: number; label: string; title?: string; color?: string };

/** The parts that break into dots when they lead a split: the worst severities, the ones that want you first. */
const DOTTED: Part["tone"][] = ["critical", "high"];
const DOT_TONE: Partial<Record<Part["tone"], string>> = { critical: "var(--ls-sv-c)", high: "var(--ls-sv-h)" };

/** A whole split into parts: a thin bar per part, as wide as its share, the counts in the key under it (Overview's "How
    bad"). Parts of 0 are left out. The first part, when it is a worst severity, is solid then dots (the halftone's fill). */
export function Parts({ parts, label }: { parts: Part[]; label: string }) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="ls-parts" role="img" aria-label={`${label}: ${parts.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(", ")}`}>
      {shown.length ? (
        shown.map((p, i) => {
          const dots = i === 0 && DOTTED.includes(p.tone);
          return (
            <i key={p.tone} data-tone={p.tone} data-dots={dots || undefined} style={{ flex: p.value, ...(p.color ? { background: p.color } : {}) }} title={p.title ?? `${p.label}: ${p.value}`}>
              {dots && <span className="lc-ht lc-ht-fill" style={{ ["--lc-ht-c" as string]: DOT_TONE[p.tone] }} />}
            </i>
          );
        })
      ) : (
        <i data-tone="na" style={{ flex: 1 }} />
      )}
    </div>
  );
}

/** The key under a split: a round dot per part and its word; `count` shows a part's number (dimmed at 0, as "Critical 0"). */
export function Legend({ parts, count, tight }: { parts: Part[]; count?: (p: Part) => boolean; tight?: boolean }) {
  return (
    <div className="ls-leg" data-tight={tight || undefined}>
      {parts.map((p) => (
        <span key={p.tone} data-zero={(count?.(p) && p.value === 0) || undefined}>
          <i data-tone={p.tone} style={p.color ? { background: p.color } : undefined} />
          {p.label}
          {count?.(p) && <b>{p.value}</b>}
        </span>
      ))}
    </div>
  );
}

/** Severity counts as parts, worst first. */
export const sevParts = (c: SeverityCounts): Part[] => SEVERITIES.map((s) => ({ tone: s, value: c[s], label: SEVERITY_LABEL[s] }));

/** The open findings by severity as a split with its key: every part says its count, the bar has none; Critical shows
    its count at 0 too, so a 0 there reads as good news. */
export function SevSplit({ counts }: { counts: SeverityCounts }) {
  const parts = sevParts(counts);
  return (
    <>
      <Parts parts={parts} label="Open findings by severity" />
      <Legend parts={parts} count={() => true} tight />
    </>
  );
}

/** A thin bar of severities (a project's row, Found so far): one stretch per severity, nothing drawn for none. `width` in px. */
export function SevBar({ counts, width }: { counts: SeverityCounts; width?: number }) {
  return (
    <span className="ls-sevbar" style={width ? { width } : undefined} aria-hidden>
      {SEVERITIES.map((s) => counts[s] > 0 && <i key={s} data-tone={s} style={{ flex: counts[s] }} />)}
    </span>
  );
}

/** A short tag: a source ("npm audit"), the second look ("Confirmed", tone ok), or Professional (tone pro). */
export function Tag({ tone, children }: { tone?: "ok" | "pro"; children: ReactNode }) {
  return (
    <span className="ls-tag" data-tone={tone}>
      {children}
    </span>
  );
}

/** A bordered box with its name on top and a link or key at its end (Overview's groups, a project's card). */
export function Card({ title, end, children, className }: { title?: ReactNode; end?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ls-card${className ? ` ${className}` : ""}`}>
      {(title || end) && (
        <div className="ls-blkh">
          {title}
          {end && <span className="ls-blkh-end">{end}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** States as tabs with their counts (Open 4 · Fixed 1 · Dismissed 1). */
export function CountTabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div className="ls-segs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} className="ls-sg l-focus" onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="ls-num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Inside a box: the tool or model it would use, as a quiet tile with its mark and its action at the end. `nil`: nothing found. */
export function PickTile({ mark, title, note, action, nil }: { mark: ReactNode; title: ReactNode; note?: ReactNode; action?: ReactNode; nil?: boolean }) {
  return (
    <span className="ls-pick" data-nil={nil || undefined}>
      <span className="ls-mk">{mark}</span>
      <span className="ls-tl2">
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      {action}
    </span>
  );
}

/** An optional thing switched on or off (the second look), with the app's own switch. */
export function OnOff({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <Switch size="sm" checked={on} onCheckedChange={onChange} label={<span className="l-sr-only">{label}</span>} />;
}

/** Two lines in a row: a name and what it says under it. */
export function TwoLines({ title, note }: { title: ReactNode; note?: ReactNode }) {
  return (
    <span className="ls-tl2">
      <b>{title}</b>
      {note && <small>{note}</small>}
    </span>
  );
}

/** The top row of a Security page, as the app's other pages have it: Show the sidebar when it's hidden, the title, then what goes at its end. */
export function PageTop({ title, sidebar, onSidebar, children }: { title: ReactNode; sidebar: boolean; onSidebar: () => void; children?: ReactNode }) {
  return (
    <header className="lc-top ls-top" data-drag>
      {!sidebar && (
        <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" title={`Show the sidebar (${os.mod}\\)`} onClick={onSidebar}>
          <I.sidebar size={16} />
        </button>
      )}
      <h1 className="lc-title">{title}</h1>
      <span className="lc-grow" />
      {children}
    </header>
  );
}
