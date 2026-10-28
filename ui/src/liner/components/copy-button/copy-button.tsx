import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "../button/button";
import { feedback } from "../../lib/feedback";
import "./copy-button.css";

export type CopyButtonProps = Omit<ButtonProps, "onClick" | "icon" | "children" | "value" | "onCopy"> & {
  value: string | (() => string);
  label?: string;
  copiedLabel?: string;
  /** How long the confirmation holds before it settles back. */
  timeout?: number;
  onCopy?: (value: string) => void;
};

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and some iframes: fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyIcon({ done, failed }: { done?: boolean; failed?: boolean }) {
  const state = failed ? "failed" : done ? "done" : "idle";
  return (
    <span className="l-copy-icon" data-state={state}>
      <svg className="l-copy-icon__copy" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="5.25" y="5.25" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.75 3.6A1.85 1.85 0 0 0 9 2.75H4.6A1.85 1.85 0 0 0 2.75 4.6V9a1.85 1.85 0 0 0 .85 1.56" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <svg className="l-copy-icon__check" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3.5 8.4 6.6 11.3 12.5 4.9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
      </svg>
      <svg className="l-copy-icon__fail" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", timeout = 1600, onCopy, variant = "secondary", iconOnly, ...rest }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    const text = typeof value === "function" ? value() : value;
    const ok = await writeClipboard(text);
    setState(ok ? "done" : "failed");
    feedback.play(ok ? "success" : "error");
    if (ok) onCopy?.(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), timeout);
  }

  const text = state === "done" ? copiedLabel : state === "failed" ? "Failed" : label;
  return (
    <>
      <Button
        {...rest}
        variant={variant}
        iconOnly={iconOnly}
        aria-label={iconOnly ? text : rest["aria-label"]}
        data-copied={state === "done" || undefined}
        icon={<CopyIcon done={state === "done"} failed={state === "failed"} />}
        onClick={copy}
      >
        {text}
      </Button>
      <span className="l-sr-only" role="status" aria-live="polite">
        {state === "done" ? copiedLabel : state === "failed" ? "Copy failed" : ""}
      </span>
    </>
  );
}
