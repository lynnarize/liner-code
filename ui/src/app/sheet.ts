/*
  A dialog's way out (the motion study after Kimi, 2026-11-27): the sheet and its scrim fade together over MOTION.sheetOut
  through a closing state (data-closing on the <dialog>, app.css), and only then is the dialog closed, which gives the focus
  back to what had it. Escape, a press on the scrim and the sheet's own buttons all leave through here. Opened again while it
  leaves, it stays open as it is.
*/
import { EXIT_SLACK, MOTION } from "./motion";

/** The exit under way for each dialog, so opening it again can stop it. */
const leaving = new WeakMap<HTMLDialogElement, () => void>();

/** Closes `d` with its exit, then calls `then` (the caller's own "it's shut", which may take the dialog away). */
export function closeSheet(d: HTMLDialogElement | null | undefined, then?: () => void) {
  if (!d || !d.open) return void then?.();
  // Already on its way out: the one exit is enough.
  if (leaving.has(d)) return;
  d.dataset.closing = "";
  let over = false;
  const finish = (close: boolean) => {
    if (over) return;
    over = true;
    window.clearTimeout(timer);
    d.removeEventListener("animationend", onEnd);
    leaving.delete(d);
    delete d.dataset.closing;
    if (!close) return;
    d.close();
    then?.();
  };
  // The sheet's own fade ending; the timer in case it never does (a hidden window, nothing to animate).
  const onEnd = (e: AnimationEvent) => e.animationName === "lc-sheet-out" && finish(true);
  const timer = window.setTimeout(() => finish(true), MOTION.sheetOut + EXIT_SLACK);
  d.addEventListener("animationend", onEnd);
  leaving.set(d, () => finish(false));
}

/** Opens `d` as a modal sheet, or keeps it open if it was on its way out. */
export function openSheet(d: HTMLDialogElement | null | undefined) {
  if (!d) return;
  leaving.get(d)?.();
  if (!d.open) d.showModal();
}
