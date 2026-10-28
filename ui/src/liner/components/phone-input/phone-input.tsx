/*
  Liner · Phone input
  A country and a number. The number is grouped the way that country writes it as you
  type, pasting a full +44… number picks the country for you, and a small check appears
  once there are enough digits. The value is always E.164.
*/
import { useId, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip, useRoving } from "../../lib/overlay";
import { countries as allCountries, type Country } from "./countries";
import "../../lib/field.css";
import "./phone-input.css";

export type { Country };
export type PhoneInputProps = {
  /** E.164, like +14155550123. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (e164: string, info: { country: Country; complete: boolean }) => void;
  defaultCountry?: string;
  countries?: Country[];
  label?: string;
  description?: string;
  className?: string;
};

const slots = (mask: string) => mask.split("").filter((c) => c === "#").length;

/** Lay digits into the mask, stopping after the last digit so no stray brackets trail. */
function applyMask(digits: string, mask: string) {
  let out = "";
  let d = 0;
  for (const ch of mask) {
    if (d >= digits.length) break;
    if (ch === "#") out += digits[d++];
    else out += ch;
  }
  return out + digits.slice(d);
}

function split(e164: string, list: Country[], fallback: Country) {
  const digits = e164.replace(/\D/g, "");
  if (!e164.trim().startsWith("+")) return { country: fallback, digits };
  // The longest dialing code that matches wins (971 before 9).
  const hit = [...list].sort((a, b) => b.dial.length - a.dial.length).find((c) => digits.startsWith(c.dial));
  return hit ? { country: fallback.dial === hit.dial ? fallback : hit, digits: digits.slice(hit.dial.length) } : { country: fallback, digits };
}

export function PhoneInput({ value, defaultValue = "", onValueChange, defaultCountry = "US", countries = allCountries, label = "Phone", description, className }: PhoneInputProps) {
  const id = useId();
  const initial = countries.find((c) => c.code === defaultCountry) ?? countries[0];
  const [state, setState] = useState(() => split(value ?? defaultValue, countries, initial));
  const { country, digits } = state;
  const max = slots(country.mask);
  const complete = digits.length === max;
  const input = useRef<HTMLInputElement>(null);

  const emit = (c: Country, d: string) => {
    setState({ country: c, digits: d });
    onValueChange?.(d ? `+${c.dial}${d}` : "", { country: c, complete: d.length === slots(c.mask) });
  };

  const onInput = (el: HTMLInputElement) => {
    const raw = el.value;
    if (raw.trim().startsWith("+")) {
      // A pasted international number: find its country.
      const s = split(raw, countries, country);
      emit(s.country, s.digits.slice(0, slots(s.country.mask)));
      return;
    }
    const caret = el.selectionStart ?? raw.length;
    const before = raw.slice(0, caret).replace(/\D/g, "").length;
    const next = raw.replace(/\D/g, "").slice(0, max);
    emit(country, next);
    requestAnimationFrame(() => {
      const text = applyMask(next, country.mask);
      let seen = 0;
      let pos = 0;
      while (pos < text.length && seen < before) {
        if (/\d/.test(text[pos])) seen++;
        pos++;
      }
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className={cx("l-in l-phone", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="l-in-box l-phone__box">
        <CountryPicker
          countries={countries}
          value={country}
          onPick={(c) => {
            emit(c, digits.slice(0, slots(c.mask)));
            input.current?.focus();
          }}
        />
        <span className="l-phone__dial" key={country.dial} aria-hidden>
          +{country.dial}
        </span>
        <input
          ref={input}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={country.mask.replace(/#/g, "0")}
          value={applyMask(digits, country.mask)}
          aria-describedby={description ? `${id}-msg` : undefined}
          onChange={(e) => onInput(e.target)}
        />
        <span className="l-phone__ok" data-on={complete || undefined} aria-hidden>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.6 8.4 6.6 11.3 12.4 5" />
          </svg>
        </span>
      </div>
      {description && (
        <span id={`${id}-msg`} className="l-in-hint">
          {description}
        </span>
      )}
    </div>
  );
}

function CountryPicker({ countries, value, onPick }: { countries: Country[]; value: Country; onPick: (c: Country) => void }) {
  const lid = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const side = useFlip(open, btn, panel);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^\+/, "");
    if (!s) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(s) || c.code.toLowerCase() === s || c.dial.startsWith(s));
  }, [q, countries]);
  const close = (refocus = true) => {
    setOpen(false);
    setQ("");
    if (refocus) btn.current?.focus();
  };
  useDismiss(open, () => close(false), [wrap]);
  const pick = (i: number) => {
    const c = shown[i];
    if (!c) return;
    onPick(c);
    feedback.play("tick", 4);
    setOpen(false);
    setQ("");
  };
  const nav = useRoving({ count: shown.length, onPick: pick, onEscape: () => close(), onTab: () => close(false), initial: Math.max(0, shown.indexOf(value)) });

  return (
    <div ref={wrap} className="l-anchor l-phone__country">
      <button
        ref={btn}
        type="button"
        className="l-phone__cbtn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country: ${value.name}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span key={value.code}>{value.code}</span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div ref={panel} className="l-pop l-phone__pop" data-side={side} data-align="start">
          <input
            autoFocus
            className="l-phone__q"
            placeholder="Search countries"
            aria-label="Search countries"
            aria-controls={lid}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              nav.setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === " ") return;
              nav.onKeyDown(e);
            }}
          />
          <div className="l-opts l-phone__list" ref={nav.listRef} role="listbox" id={lid} aria-label="Countries">
            {nav.hl && shown.length > 0 && <span className="l-opt-hl" style={{ transform: `translateY(${nav.hl.y}px)`, height: nav.hl.h }} aria-hidden />}
            {shown.map((c, i) => (
              <div
                key={c.code}
                data-index={i}
                role="option"
                aria-selected={c === value}
                className="l-opt"
                data-active={nav.active === i || undefined}
                onPointerMove={() => nav.active !== i && nav.setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="l-phone__code">{c.code}</span>
                <span className="l-opt-text">
                  <span className="l-opt-label">{c.name}</span>
                </span>
                <span className="l-opt-kbd">+{c.dial}</span>
              </div>
            ))}
            {shown.length === 0 && <div className="l-phone__none">No country matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
