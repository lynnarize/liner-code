/*
  The inspector's controls, drawn the way the app draws its own: a section with its label and one
  quiet icon button (the sliders open every control, a plus adds, a minus takes away), rows of
  choices on a well, fields with a quiet prefix, swatches that say their names, and the quiet
  "Off the lean" note. Every one is a real button or input with a label. Numbers nudge by 1 with
  the arrows, 10 with shift; dragging a field's prefix scrubs it, as one undo step.
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Segmented } from "@liner/components/segmented/segmented";
import { I } from "../../icons";
import { fmt } from "./css";

// ---------- Which sections are open, per window

const OPEN_KEY = "liner.ld.open";
let opened: Set<string> = (() => {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
})();
const openFns = new Set<() => void>();
export function useOpen(id: string): [boolean, () => void] {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    openFns.add(f);
    return () => void openFns.delete(f);
  }, []);
  const toggle = () => {
    opened = new Set(opened);
    if (opened.has(id)) opened.delete(id);
    else opened.add(id);
    try {
      sessionStorage.setItem(OPEN_KEY, JSON.stringify([...opened]));
    } catch {
      // a window without storage keeps them open until it closes
    }
    openFns.forEach((f) => f());
  };
  return [opened.has(id), toggle];
}

// ---------- Section

type SectionProps = {
  id: string;
  title: string;
  /** "open": the sliders show every control (`more`); "add": a plus, for a section that is empty; "remove": a minus. */
  action?: "open" | "add" | "remove";
  onAction?: () => void;
  /** What the sliders, plus or minus say to a screen reader. */
  actionLabel?: string;
  children?: ReactNode;
  more?: ReactNode;
  /** No lean: there are no choices to show first, so every control shows and there is nothing to open. */
  plain?: boolean;
};

export function Section({ id, title, action = "open", onAction, actionLabel, children, more, plain }: SectionProps) {
  const [open, toggle] = useOpen(id);
  const isOpen = action === "open" && (open || Boolean(plain));
  const label = actionLabel ?? (action === "open" ? (isOpen ? `Fewer ${title.toLowerCase()} controls` : `Every ${title.toLowerCase()} control`) : action === "add" ? `Add ${title.toLowerCase()}` : `Take the ${title.toLowerCase()} off`);
  return (
    <section className="ld-sec" data-open={isOpen || undefined} aria-label={title}>
      <div className="ld-sech">
        <span>{title}</span>
        {!(plain && action === "open") && (more || action !== "open") && (
          <button type="button" className="ld-ib l-focus" aria-label={label} title={label} aria-pressed={action === "open" ? isOpen : undefined} aria-expanded={action === "open" && more ? isOpen : undefined} onClick={action === "open" ? toggle : onAction}>
            {action === "open" ? <I.sliders size={14} /> : action === "add" ? <I.plus size={14} /> : <I.minus size={14} />}
          </button>
        )}
      </div>
      {children}
      {isOpen && more && <div className="ld-more">{more}</div>}
    </section>
  );
}

/** A row: a quiet label on the left (or none), the control filling the rest. */
export const Row = ({ label, children, top }: { label?: string; children: ReactNode; top?: boolean }) => (
  <div className="ld-r" data-top={top || undefined}>
    {label && <span className="ld-l">{label}</span>}
    {children}
  </div>
);

// ---------- Choices

export type Stop<T> = { value: T; label: string; name?: string };

/**
  A row of choices where none may be the current one (a value off the lean, or mixed): buttons with
  aria-pressed. Where one always is, use Choice (the app's Segmented).
*/
export function Stops<T extends string | number>({ label, options, value, onPick }: { label: string; options: Stop<T>[]; value?: T; onPick: (v: T) => void }) {
  return (
    <div className="ld-stops" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="l-focus" aria-pressed={o.value === value} aria-label={o.name && o.name !== o.label ? `${o.name}, ${o.label}` : undefined} title={o.name && o.name !== o.label ? o.name : undefined} onClick={() => onPick(o.value)}>
          <span className="ld-stop-t">{o.label}</span>
          <span className="ld-stop-on" aria-hidden>
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A choice of a few where one always is: the app's Segmented, at the inspector's size. Mixed (no value of its own), it is Stops with none pressed. */
export function Choice<T extends string>({ label, options, value, onPick, fit }: { label: string; options: { value: T; label: string }[]; value: T | undefined; onPick: (v: T) => void; fit?: boolean }) {
  if (!options.some((o) => o.value === value)) return <Stops label={label} options={options} onPick={onPick} />;
  return <Segmented full={!fit} size="sm" className="ld-seg" value={value} onValueChange={onPick} options={options} aria-label={label} />;
}

// ---------- Fields

type NumProps = {
  /** The quiet prefix ("W", "Gap", "◜"); also what a screen reader hears unless `name` says more. */
  prefix: ReactNode;
  name: string;
  value?: number;
  /** Shown when the selection differs. */
  mixed?: boolean;
  /** `key` is the same for one gesture (a scrub, a run of arrow presses), so it is one undo step. */
  onChange: (v: number, key: string) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  title?: string;
  wide?: number;
};

let gestures = 0;
const gesture = () => `g${++gestures}`;

/** A number field: type and press Enter (or leave), arrows nudge, drag the prefix to scrub. */
export function Num({ prefix, name, value, mixed, onChange, min = -Infinity, max = Infinity, step = 1, suffix, disabled, title, wide }: NumProps) {
  const [text, setText] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  const run = useRef<{ key: string; at: number }>({ key: gesture(), at: 0 });
  useEffect(() => {
    if (!editing) setText(fmt(value));
  }, [value, editing]);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  // Presses close together are one gesture (one undo step).
  const keyNow = () => {
    const now = Date.now();
    if (now - run.current.at > 900) run.current.key = gesture();
    run.current.at = now;
    return run.current.key;
  };
  const commit = () => {
    setEditing(false);
    const v = Number(text.replace(/[^\d.\-]/g, ""));
    if (text.trim() === "" || !Number.isFinite(v)) return setText(fmt(value));
    if (v !== value) onChange(clamp(v), gesture());
  };
  const scrub = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = value ?? 0;
    const key = gesture();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      const d = Math.round((m.clientX - x0) / 2) * step * (m.shiftKey ? 10 : 1);
      onChange(clamp(v0 + d), key);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return (
    <label className="ld-fld" data-disabled={disabled || undefined} title={title} style={wide ? { flex: `0 0 ${wide}px` } : undefined}>
      <span className="ld-pre" onPointerDown={scrub} data-scrub={!disabled || undefined} aria-hidden>
        {prefix}
      </span>
      <input
        className="ld-in"
        aria-label={name}
        inputMode="decimal"
        disabled={disabled}
        value={mixed && !editing ? "" : text}
        placeholder={mixed ? "Mixed" : undefined}
        onFocus={(e) => (setEditing(true), e.currentTarget.select())}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") return void e.currentTarget.blur();
          if (e.key === "Escape") return void (setText(fmt(value)), setEditing(false), e.currentTarget.blur());
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const base = Number(text) || value || 0;
          const v = clamp(base + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          setText(fmt(v));
          onChange(v, keyNow());
        }}
      />
      {suffix && <span className="ld-suf">{suffix}</span>}
    </label>
  );
}

/** A text field with a quiet prefix (a hex, a font, a picture's path): applies on Enter or on leaving it. */
export function Text({ prefix, name, value, onChange, mono, placeholder, wide }: { prefix?: ReactNode; name: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; wide?: number }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  return (
    <label className="ld-fld" data-mono={mono || undefined} style={wide ? { flex: `0 0 ${wide}px` } : undefined}>
      {prefix !== undefined && (
        <span className="ld-pre" aria-hidden>
          {prefix}
        </span>
      )}
      <input
        className="ld-in"
        aria-label={name}
        spellCheck={false}
        value={text}
        placeholder={placeholder}
        onFocus={(e) => (setEditing(true), e.currentTarget.select())}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (text !== value) onChange(text.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setText(value), setEditing(false);
        }}
      />
    </label>
  );
}

/** A native select drawn as a field. */
export function Select<T extends string>({ name, value, options, onChange, prefix }: { name: string; value: T | ""; options: { value: T; label: string }[]; onChange: (v: T) => void; prefix?: string }) {
  return (
    <label className="ld-fld ld-sel">
      {prefix && (
        <span className="ld-pre" aria-hidden>
          {prefix}
        </span>
      )}
      <select className="ld-in" aria-label={name} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {value === "" && <option value="">Mixed</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <I.chevD size={12} className="ld-sel-c" />
    </label>
  );
}

/** A quiet on/off, drawn as a field that says which ("Clip Off"). */
export const Toggle = ({ prefix, name, on, onChange }: { prefix: string; name: string; on: boolean; onChange: (on: boolean) => void }) => (
  <button type="button" className="ld-fld ld-tog l-focus" aria-pressed={on} aria-label={name} onClick={() => onChange(!on)}>
    <span className="ld-pre">{prefix}</span>
    {on ? "On" : "Off"}
  </button>
);

// ---------- Swatches

export function Swatches({ label, colours, value, onPick, end }: { label: string; colours: { name: string; value: string }[]; value?: string; onPick: (c: { name: string; value: string }) => void; end?: ReactNode }) {
  return (
    <div className="ld-sws" role="group" aria-label={label}>
      {colours.map((c) => (
        <button key={c.name} type="button" className="ld-swt l-focus" aria-label={c.name} title={`${c.name} · ${c.value}`} aria-pressed={c.name === value} style={{ background: c.value }} onClick={() => onPick(c)} />
      ))}
      {end !== undefined && <span className="ld-nm">{end}</span>}
    </div>
  );
}

/** One swatch that isn't a choice: the colour a thing is now. */
export const Chip = ({ colour, name }: { colour: string; name: string }) => <span className="ld-swt" role="img" aria-label={name} style={{ background: colour }} />;

// ---------- Off the lean

/** What another part adds after the note's press, from its words (E's "Add to the lean", design/Skills.tsx). */
export type OffAbout = { kind: "colour" | "space" | "corner" | "type"; value: string; prop?: string };
export const offLeanMore: { render?: (about: OffAbout) => ReactNode } = {};

/** The quiet note under a value the lean doesn't have, with one press to bring it back (or take it off). */
export const OffLean = ({ why, act, onAct, about }: { why: string; act: string; onAct: () => void; /** What the note is about, for what fills offLeanMore. */ about?: OffAbout }) => (
  <div className="ld-off" role="note">
    <I.info size={14} />
    <span>
      <b>Off the lean.</b> {why}{" "}
      <button type="button" className="l-focus" onClick={onAct}>
        {act}
      </button>
      {about && offLeanMore.render?.(about)}
    </span>
  </div>
);
