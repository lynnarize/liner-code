/*
  Liner · Shortcut recorder
  Press it, then press the keys. Modifiers show up as you hold them; the first ordinary
  key completes the shortcut. Escape cancels, Delete clears, and a shortcut that is
  already taken says by what.
*/
import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "../../lib/field.css";
import "./shortcut-recorder.css";

export type ShortcutRecorderProps = {
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (keys: string[]) => void;
  /** Names the action this shortcut runs, like "Open command menu". */
  label: string;
  /** Shortcuts already in use: "⌘+K" → "Search". */
  taken?: Record<string, string>;
  className?: string;
};

const MODS = ["Control", "Alt", "Shift", "Meta"] as const;
const isMac = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);
const MOD_LABEL: Record<string, string> = isMac ? { Control: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" } : { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };
const NAMED: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↩",
  Tab: "⇥",
  Space: "Space",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "Esc",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/** A key's name from its physical position, so ⌥ never turns K into ˚. */
function keyName(e: KeyboardEvent) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  return NAMED[e.code] ?? NAMED[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
}

export const formatShortcut = (keys: string[]) => keys.map((k) => MOD_LABEL[k] ?? k);

export function ShortcutRecorder({ value, defaultValue = [], onValueChange, label, taken, className }: ShortcutRecorderProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const keys = controlled ? value : inner;
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [note, setNote] = useState<{ text: string; tone?: "warn" | "danger" } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const set = (k: string[]) => {
    if (!controlled) setInner(k);
    onValueChange?.(k);
  };
  const combo = (k: string[]) => k.join("+");
  const clash = keys.length ? taken?.[combo(formatShortcut(keys))] ?? taken?.[combo(keys)] : undefined;

  useEffect(() => {
    if (!recording) return;
    const mods = (e: KeyboardEvent) => MODS.filter((m) => e.getModifierState(m));
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const m = mods(e);
      if ((MODS as readonly string[]).includes(e.key)) return setHeld(m);
      if (!m.length && e.key === "Escape") {
        setRecording(false);
        setHeld([]);
        return;
      }
      if (!m.length && (e.key === "Backspace" || e.key === "Delete")) {
        set([]);
        setRecording(false);
        setHeld([]);
        setNote({ text: "Shortcut removed" });
        return;
      }
      const k = keyName(e);
      // Plain letters and numbers need a modifier; function keys can stand alone.
      if (!m.length && !/^F\d{1,2}$/.test(k)) {
        setNote({ text: `Hold ${isMac ? "⌘, ⌥, ⌃ or ⇧" : "Ctrl, Alt or Shift"} with a key`, tone: "danger" });
        feedback.play("error");
        btn.current?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], { duration: 300 });
        return;
      }
      const next = [...m, k];
      set(next);
      setHeld([]);
      setRecording(false);
      setNote(null);
      feedback.play("success");
    };
    const up = (e: KeyboardEvent) => setHeld(mods(e));
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [recording]);

  const shown = recording ? held : keys;
  const message = recording ? null : clash ? { text: `Also used by ${clash}`, tone: "warn" as const } : note;
  return (
    <div className={cx("l-in l-keys", className)}>
      <button
        ref={btn}
        type="button"
        className="l-keys__btn"
        data-recording={recording || undefined}
        aria-label={`${label} shortcut: ${keys.length ? formatShortcut(keys).join(" ") : "none"}. ${recording ? "Recording, press keys" : "Press to record"}`}
        onClick={() => {
          setRecording((r) => !r);
          setHeld([]);
          setNote(null);
        }}
        onBlur={() => {
          setRecording(false);
          setHeld([]);
        }}
      >
        <span className="l-keys__row" aria-hidden>
          {shown.length ? (
            formatShortcut(shown).map((k, i) => (
              <kbd key={`${k}${i}`} className="l-kbd l-keys__kbd" style={{ animationDelay: `${i * 30}ms` }}>
                {k}
              </kbd>
            ))
          ) : (
            <span className="l-keys__empty" key={recording ? "r" : "e"}>
              {recording ? "Press keys" : "Record shortcut"}
            </span>
          )}
        </span>
        {recording && (
          <span className="l-keys__esc" aria-hidden>
            Esc to cancel
          </span>
        )}
      </button>
      {message && (
        <span className="l-in-hint" data-tone={message.tone} role="status" key={message.text}>
          {message.text}
        </span>
      )}
    </div>
  );
}
