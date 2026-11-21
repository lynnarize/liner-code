/*
  Liner Security's small shared pieces, so every page draws a severity, a split, a tag or a bordered box the same way.
  Translated from the mockup's sheet (sec.css: .sev, .parts, .sevbar, .sevleg, .tag, .card, .segs, .cb.chip, .bx, .pick,
  .sw) into the app's own tokens; the classes are security.css's `ls-` ones. Where the app has the thing already (Pop,
  Row, the Liner Switch, Num), these use it.
*/
import type { ReactNode } from "react";
import type { Severity, SeverityCounts } from "@contracts";
import { SEVERITIES, SEVERITY_LABEL } from "@contracts";
import { Switch } from "@liner/components/switch/switch";
import { I } from "../icons";
import { Pop, Row } from "../ui";
import * as os from "../os";
import "./security.css";

/** A colour key for a part of a whole: a severity, or the second look's three answers. */
export type Tone = Severity | "ok" | "no" | "na";

/** How bad: a small square in the severity's colour and its word, drawn this one way everywhere; in a list's fixed column, or as wide as it is (`dot`) where it stands alone (a finding's own top row). */
export function SevMark({ severity, dot, children }: { severity: Severity; dot?: boolean; children?: ReactNode }) {
  return (
    <span className="ls-sev" data-sev={severity} data-dot={dot || undefined}>
      <i aria-hidden />
      {children ?? SEVERITY_LABEL[severity]}
    </span>
  );
}

/** One part of a whole, for Parts and Legend. */
export type Part = { tone: Tone; value: number; label: string; title?: string };

/** A whole split into parts: a block per part, as wide as its share, its count inside (Overview's "Open, by how bad"). Parts of 0 are left out. */
export function Parts({ parts, label }: { parts: Part[]; label: string }) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="ls-parts" role="img" aria-label={`${label}: ${parts.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(", ")}`}>
      {shown.length ? (
        shown.map((p) => (
          <i key={p.tone} data-tone={p.tone} style={{ flex: p.value }} title={p.title ?? `${p.label}: ${p.value}`}>
            {p.value}
          </i>
        ))
      ) : (
        <i data-tone="na" style={{ flex: 1 }} />
      )}
    </div>
  );
}

/** The key under a split: a square per part and its word; `count` shows a part's number (dimmed at 0, as "Critical 0"). */
export function Legend({ parts, count, tight }: { parts: Part[]; count?: (p: Part) => boolean; tight?: boolean }) {
  return (
    <div className="ls-leg" data-tight={tight || undefined}>
      {parts.map((p) => (
        <span key={p.tone} data-zero={(count?.(p) && p.value === 0) || undefined}>
          <i data-tone={p.tone} />
          {p.label}
          {count?.(p) && <b>{p.value}</b>}
        </span>
      ))}
    </div>
  );
}

/** Severity counts as parts, worst first. */
export const sevParts = (c: SeverityCounts): Part[] => SEVERITIES.map((s) => ({ tone: s, value: c[s], label: SEVERITY_LABEL[s] }));

/** The open findings by severity as a split with its key: Critical shows its count, so a 0 there reads as good news. */
export function SevSplit({ counts }: { counts: SeverityCounts }) {
  const parts = sevParts(counts);
  return (
    <>
      <Parts parts={parts} label="Open findings by severity" />
      <Legend parts={parts} count={(p) => p.tone === "critical"} />
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

/** A filter as a chip that opens its choices (Source, Severity, Second look, Fix). `value` undefined: any. */
export function FilterChip<T extends string>({ label, value, options, onChange }: { label: string; value?: T; options: { value: T; label: string }[]; onChange: (v: T | undefined) => void }) {
  const on = options.find((o) => o.value === value);
  return (
    <Pop
      label={label}
      menu
      width={220}
      triggerClass="ls-chip l-focus"
      triggerAttrs={{ "data-on": on ? "" : undefined }}
      trigger={
        <>
          {on ? `${label}: ${on.label}` : label}
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => (
        <>
          <Row title="Any" on={!on} onPick={() => (close(), onChange(undefined))} />
          {options.map((o) => (
            <Row key={o.value} title={o.label} on={o.value === value} onPick={() => (close(), onChange(o.value))} />
          ))}
        </>
      )}
    </Pop>
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
