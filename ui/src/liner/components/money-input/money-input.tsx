/*
  Liner · Money input
  Amounts grouped as you type, with the caret kept where your finger is. The currency's own
  decimals decide how many places you can enter, and its symbol sits where the locale puts
  it. The large size is for the one number a checkout or transfer is about.
*/
import { useId, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { useDismiss } from "../../lib/overlay";
import { MenuPanel } from "../menu/menu";
import "../../lib/field.css";
import "./money-input.css";

export type MoneyInputProps = {
  value?: number | null;
  defaultValue?: number | null;
  onValueChange?: (value: number | null, currency: string) => void;
  currency?: string;
  /** Offer a switch between these. */
  currencies?: string[];
  onCurrencyChange?: (currency: string) => void;
  locale?: string;
  label?: string;
  description?: string;
  max?: number;
  size?: "md" | "lg";
  placeholder?: string;
  className?: string;
};

type Fmt = { group: string; decimal: string; frac: number; symbol: string; suffix: boolean };

function readFormat(locale: string, currency: string): Fmt {
  const n = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const c = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" });
  const parts = c.formatToParts(1);
  const at = parts.findIndex((p) => p.type === "currency");
  const int = parts.findIndex((p) => p.type === "integer");
  return {
    group: n.find((p) => p.type === "group")?.value ?? ",",
    decimal: n.find((p) => p.type === "decimal")?.value ?? ".",
    frac: c.resolvedOptions().maximumFractionDigits ?? 2,
    symbol: parts[at]?.value ?? currency,
    suffix: at > int,
  };
}

/** Clean what was typed into grouped text and a number. Digits and one decimal mark survive. */
function shape(raw: string, f: Fmt) {
  let out = "";
  let dec = false;
  for (const ch of raw) {
    if (/\d/.test(ch)) out += ch;
    else if (!dec && f.frac > 0 && (ch === f.decimal || (ch === "." && f.group !== "."))) {
      out += ".";
      dec = true;
    }
  }
  const [rawInt, rawFrac] = out.split(".");
  const int = rawInt.replace(/^0+(?=\d)/, "");
  const frac = rawFrac?.slice(0, f.frac);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, f.group);
  const text = frac !== undefined ? `${grouped || "0"}${f.decimal}${frac}` : grouped;
  return { text, num: out === "" || out === "." ? null : Number(`${int || "0"}${frac ? `.${frac}` : ""}`) };
}

const significant = (s: string, f: Fmt) => [...s].filter((ch) => /\d/.test(ch) || ch === f.decimal || (ch === "." && f.group !== ".")).length;

function display(n: number | null | undefined, f: Fmt) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  const s = Number.isInteger(n) ? String(n) : n.toFixed(f.frac);
  return shape(s.replace(".", f.decimal), f).text;
}

export function MoneyInput({
  value,
  defaultValue = null,
  onValueChange,
  currency: currencyProp = "USD",
  currencies,
  onCurrencyChange,
  locale = "en-US",
  label,
  description,
  max,
  size = "md",
  placeholder = "0",
  className,
}: MoneyInputProps) {
  const id = useId();
  const [currency, setCurrency] = useState(currencyProp);
  const f = useMemo(() => readFormat(locale, currency), [locale, currency]);
  const controlled = value !== undefined;
  const [text, setText] = useState(() => display(controlled ? value : defaultValue, f));
  const num = shape(text, f).num;
  // Follow a value changed from outside, unless it is what the text already says.
  if (controlled && value !== num && !(value === null && text === "")) setText(display(value, f));
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const curBtn = useRef<HTMLButtonElement>(null);
  useDismiss(menu, () => setMenu(false), [wrap]);
  const over = max !== undefined && num !== null && num > max;
  const maxText = max !== undefined ? new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(max) : "";

  const onInput = (el: HTMLInputElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const before = significant(el.value.slice(0, caret), f);
    const next = shape(el.value, f);
    setText(next.text);
    onValueChange?.(next.num, currency);
    // Put the caret after the same number of digits it was after.
    requestAnimationFrame(() => {
      let seen = 0;
      let pos = 0;
      while (pos < next.text.length && seen < before) {
        if (/\d/.test(next.text[pos]) || next.text[pos] === f.decimal) seen++;
        pos++;
      }
      el.setSelectionRange(pos, pos);
    });
  };

  const symbol = (
    <span className="l-money__sym" aria-hidden key={f.symbol}>
      {f.symbol}
    </span>
  );
  const msg = over ? `Up to ${maxText}` : description;
  return (
    <div className={cx("l-in l-money", className)} data-size={size}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="l-in-box l-money__box" data-invalid={over || undefined} onClick={() => input.current?.focus()}>
        {!f.suffix && symbol}
        <span className="l-money__grow">
          <span className="l-money__sizer" aria-hidden>
            {text || placeholder}
          </span>
          <input
            ref={input}
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            placeholder={placeholder}
            aria-invalid={over || undefined}
            aria-describedby={msg ? `${id}-msg` : undefined}
            aria-label={label ? undefined : `Amount in ${currency}`}
            onChange={(e) => onInput(e.target)}
            onBlur={() => {
              // Settle a dangling decimal mark or missing places on the way out.
              if (num !== null && size === "lg") setText(display(num, f));
              else if (text.endsWith(f.decimal)) setText(text.slice(0, -1));
            }}
          />
        </span>
        {f.suffix && symbol}
        {currencies && currencies.length > 1 ? (
          <div ref={wrap} className="l-anchor l-money__cur">
            <button
              ref={curBtn}
              type="button"
              className="l-money__curbtn"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={`Currency: ${currency}`}
              onClick={(e) => {
                e.stopPropagation();
                setMenu((m) => !m);
              }}
            >
              <span key={currency}>{currency}</span>
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {menu && (
              <MenuPanel
                label="Currency"
                align="end"
                className="l-money__menu"
                items={currencies.map((c) => ({
                  id: c,
                  label: c,
                  hint: new Intl.DisplayNames([locale], { type: "currency" }).of(c),
                  checked: c === currency,
                  onSelect: () => {
                    setCurrency(c);
                    onCurrencyChange?.(c);
                    const nf = readFormat(locale, c);
                    const v = num === null ? null : Number(num.toFixed(nf.frac));
                    setText(display(v, nf));
                    onValueChange?.(v, c);
                    setMenu(false);
                    curBtn.current?.focus();
                  },
                }))}
                onClose={(refocus) => {
                  setMenu(false);
                  if (refocus) curBtn.current?.focus();
                }}
              />
            )}
          </div>
        ) : (
          size === "md" && <span className="l-money__code">{currency}</span>
        )}
      </div>
      {msg && (
        <span id={`${id}-msg`} className="l-in-hint" data-tone={over ? "danger" : undefined} key={msg}>
          {msg}
        </span>
      )}
    </div>
  );
}
