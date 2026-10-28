/*
  Liner · Color picker
  A saturation field, a hue strip and, if you want it, an alpha strip, with a hex field and
  your swatches below. Where the browser has an eyedropper, a button picks a color from
  anywhere on screen. ColorPanel is the panel; ColorPicker puts it on glass behind a swatch.
*/
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useDismiss, useFlip } from "../../lib/overlay";
import { clamp } from "../../lib/spring";
import { hexToHsv, hsvToHex, readableOn, type Hsv } from "./color";
import "./color-picker.css";

export type ColorPanelProps = {
  value: string;
  onValueChange: (hex: string) => void;
  alpha?: boolean;
  swatches?: string[];
  className?: string;
};

function useDrag(onMove: (x: number, y: number) => void) {
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = e.currentTarget.getBoundingClientRect();
      onMove(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const r = e.currentTarget.getBoundingClientRect();
      onMove(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    },
  };
}

export function ColorPanel({ value, onValueChange, alpha, swatches, className }: ColorPanelProps) {
  // Hue is kept separately so it survives greys and black, where hex can't hold it.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 220, s: 0.6, v: 0.9, a: 1 });
  const [text, setText] = useState(value.toUpperCase());
  const last = useRef(value.toUpperCase());
  useEffect(() => {
    if (value.toUpperCase() === last.current) return;
    const next = hexToHsv(value);
    if (next) setHsv((c) => ({ ...next, h: next.s === 0 || next.v === 0 ? c.h : next.h }));
    setText(value.toUpperCase());
    last.current = value.toUpperCase();
  }, [value]);

  const set = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next, alpha);
    last.current = hex;
    setText(hex);
    onValueChange(hex);
  };
  const area = useDrag((x, y) => set({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => set({ ...hsv, h: x * 360 }));
  const alp = useDrag((x) => set({ ...hsv, a: Math.round(x * 100) / 100 }));
  const keyArea = (e: KeyboardEvent) => {
    const k = e.shiftKey ? 0.1 : 0.01;
    const m: Record<string, [number, number]> = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] };
    if (!m[e.key]) return;
    e.preventDefault();
    set({ ...hsv, s: clamp(hsv.s + m[e.key][0], 0, 1), v: clamp(hsv.v + m[e.key][1], 0, 1) });
  };
  const keyStrip = (key: "h" | "a", max: number) => (e: KeyboardEvent) => {
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (key === "h" ? 1 : 0.01);
    set({ ...hsv, [key]: clamp(hsv[key] + d * step, 0, max) });
  };
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1, a: 1 });
  const solid = hsvToHex({ ...hsv, a: 1 });
  const canDrop = typeof window !== "undefined" && "EyeDropper" in window;

  return (
    <div className={cx("l-color", className)} style={{ ["--hue" as string]: pure, ["--solid" as string]: solid }}>
      <div
        className="l-color__area"
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onKeyDown={keyArea}
        {...area}
      >
        <span className="l-color__knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="l-color__row">
        {canDrop && (
          <button
            type="button"
            className="l-color__drop"
            aria-label="Pick a color from the screen"
            onClick={async () => {
              try {
                const r = await new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open();
                const c = hexToHsv(r.sRGBHex);
                if (c) set({ ...c, a: hsv.a });
                feedback.play("pop", 3);
              } catch {
                /* cancelled */
              }
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9.5 4.5 2 2M11 2.6a1.4 1.4 0 0 1 2 2L11.4 6.2 9.8 4.6 11 2.6ZM10.6 5.4 4.5 11.5l-.9 2.4-.5.5M10.6 5.4l-6.1 6.1 2.4-.9" />
            </svg>
          </button>
        )}
        <div className="l-color__strips">
          <div className="l-color__strip l-color__hue" role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onKeyDown={keyStrip("h", 360)} {...hue}>
            <span className="l-color__knob" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          {alpha && (
            <div className="l-color__strip l-color__alpha" role="slider" tabIndex={0} aria-label="Opacity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.a * 100)} onKeyDown={keyStrip("a", 1)} {...alp}>
              <span className="l-color__knob" style={{ left: `${hsv.a * 100}%` }} />
            </div>
          )}
        </div>
      </div>
      <div className="l-color__fields">
        <span className="l-color__chip" style={{ background: hsvToHex(hsv, true) }} aria-hidden />
        <input
          className="l-color__hex"
          aria-label="Hex color"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const c = hexToHsv(e.target.value);
            if (c && /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.target.value.trim())) set(alpha ? c : { ...c, a: 1 });
          }}
          onBlur={() => setText(hsvToHex(hsv, alpha))}
        />
        {alpha && <span className="l-color__pct">{Math.round(hsv.a * 100)}%</span>}
      </div>
      {swatches && swatches.length > 0 && (
        <div className="l-color__swatches" role="group" aria-label="Swatches">
          {swatches.map((s) => {
            const c = hexToHsv(s);
            const on = s.toUpperCase() === hsvToHex(hsv, alpha);
            return (
              <button
                key={s}
                type="button"
                className="l-color__swatch"
                style={{ background: s, color: c ? readableOn(c) : "#fff" }}
                aria-label={s}
                aria-pressed={on}
                onClick={() => {
                  if (c) set(c);
                  feedback.play("tick", 3);
                }}
              >
                {on && (
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type ColorPickerProps = Omit<ColorPanelProps, "value" | "onValueChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (hex: string) => void;
  label?: string;
};

export function ColorPicker({ value, defaultValue = "#3B82F6", onValueChange, label = "Color", ...panel }: ColorPickerProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const side = useFlip(open, btn, pop);
  useDismiss(open, () => setOpen(false), [wrap], btn);
  return (
    <div ref={wrap} className="l-anchor l-colorpick">
      <button ref={btn} id={id} type="button" className="l-colorpick__btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${current}`} onClick={() => setOpen((o) => !o)}>
        <span className="l-colorpick__swatch" style={{ background: current }} />
        <span className="l-colorpick__hex" key={current}>
          {current.toUpperCase()}
        </span>
      </button>
      {open && (
        <div ref={pop} className="l-pop l-colorpick__pop" data-side={side} data-align="start" role="dialog" aria-label={label}>
          <ColorPanel
            {...panel}
            value={current}
            onValueChange={(hex) => {
              if (!controlled) setInner(hex);
              onValueChange?.(hex);
            }}
          />
        </div>
      )}
    </div>
  );
}
