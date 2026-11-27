/*
  The app's own tip on a button that is an icon alone (the motion study after Kimi, 2026-11-27), in place of the system's
  title tooltip: the top row's toggles, the panel head's +, Fill the window and Hide the panel, the sidebar's top row, the
  message box's + and Send, a pane's tools, and every other icon-only button. One part for the whole window, mounted once
  (App.tsx): it watches the pointer and the keyboard over the page, so no button needs its own code. A button gives its tip
  as it always has, by its title ("Show the panel (⇧⌘D)"), or by data-tip where it has no title to give (a Pop's trigger,
  Pop's `tip`). An icon-only button's title moves to data-tip the first time it is pointed at or reached, so the system's
  own tooltip never shows beside this one; a button that carries words of its own keeps its title and the system's tip.
  It shows after MOTION.tipWait, and with no wait within MOTION.tipSkip of the last one hiding (motion.ts tipDelay); it
  grows out of the edge facing its button and goes back into it; it never shows for a touch, goes on a press, a scroll, a
  key's Escape and when its button goes. A screen reader hears the button as before: its name is its aria-label (given one
  from its title when it had none), words the tip adds go on as its aria-description, its key as aria-keyshortcuts, and the
  tip itself is hidden from it, so nothing is read twice.
*/
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ariaKeys, MOTION, originCss, originOf, sameWords, splitTip, tipDelay, tipPlace } from "./motion";
import { usePresence } from "./ui";

/** A button that is an icon and nothing else: no words of its own to read beside a tip. */
const iconOnly = (b: HTMLElement) => !(b.textContent ?? "").trim() && b.querySelector("svg, img") !== null;

/** The attributes this part put on a button from its title, so it can change or take them back. */
const OWN_LABEL = "data-tip-label";
const OWN_DESC = "data-tip-desc";
const OWN_KEYS = "data-tip-keys";

/**
  The button under `t` that has a tip, its title moved to data-tip on the way if it is an icon alone. A button whose title
  was moved and that has words again (a tab that is now wide enough for its name) gets its title back, and no tip here.
*/
function claim(t: EventTarget | null): HTMLElement | null {
  if (!(t instanceof Element)) return null;
  const b = t.closest<HTMLElement>("button, [role='button']");
  if (!b) return null;
  const title = b.getAttribute("title");
  if (title !== null) {
    if (!title.trim() || !iconOnly(b)) return b.dataset.tip && b.dataset.tipFrom !== "title" ? b : null;
    b.removeAttribute("title");
    b.dataset.tip = title;
    b.dataset.tipFrom = "title";
    const { words, keys } = splitTip(title);
    const label = b.getAttribute("aria-label");
    if ((label === null || b.hasAttribute(OWN_LABEL)) && !b.hasAttribute("aria-labelledby")) b.setAttribute("aria-label", words), b.setAttribute(OWN_LABEL, "");
    else if (!sameWords(words, label ?? "")) b.setAttribute("aria-description", words), b.setAttribute(OWN_DESC, "");
    else if (b.hasAttribute(OWN_DESC)) b.removeAttribute("aria-description"), b.removeAttribute(OWN_DESC);
    if (keys && (!b.hasAttribute("aria-keyshortcuts") || b.hasAttribute(OWN_KEYS))) b.setAttribute("aria-keyshortcuts", ariaKeys(keys)), b.setAttribute(OWN_KEYS, "");
  }
  if (!b.dataset.tip) return null;
  if (b.dataset.tipFrom === "title" && !iconOnly(b)) {
    b.setAttribute("title", b.dataset.tip);
    delete b.dataset.tip;
    delete b.dataset.tipFrom;
    return null;
  }
  return b;
}

type Shown = { el: HTMLElement; words: string; keys?: string; n: number };

export function Tips() {
  const [tip, setTip] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const life = usePresence(open, MOTION.tipOut);
  const box = useRef<HTMLSpanElement>(null);
  const wait = useRef(0);
  const lastHidden = useRef(-Infinity);
  const showing = useRef(false);
  showing.current = open;
  const pressed = useRef<HTMLElement | null>(null);
  const count = useRef(0);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (b: HTMLElement, now: boolean) => {
      // The pointer moving over the button's own icon is still the same button: its wait runs on.
      if (b === current.current) return;
      window.clearTimeout(wait.current);
      current.current = b;
      const go = () => {
        if (!b.isConnected || b.getAttribute("aria-expanded") === "true") return;
        const { words, keys } = splitTip(b.dataset.tip ?? "");
        setTip((was) => (was?.el === b ? { ...was, words, keys } : { el: b, words, keys, n: ++count.current }));
        setOpen(true);
      };
      const ms = now ? 0 : tipDelay(performance.now(), lastHidden.current, showing.current);
      if (ms === 0) go();
      else wait.current = window.setTimeout(go, ms);
    };
    // `now`: gone in this frame (a scroll, its button gone), not faded.
    const hide = (now = false) => {
      window.clearTimeout(wait.current);
      current.current = null;
      if (showing.current) lastHidden.current = performance.now();
      setOpen(false);
      if (now) setTip(null);
    };
    const over = (e: PointerEvent) => {
      // Never for a touch, nor while a button is held (a drag, a selection).
      if (e.pointerType === "touch" || e.buttons !== 0) return;
      const b = claim(e.target);
      if (!b) return void (current.current && hide());
      if (b === pressed.current) return;
      show(b, false);
    };
    const out = (e: PointerEvent) => {
      const from = current.current ?? pressed.current;
      if (!from || (e.relatedTarget instanceof Node && from.contains(e.relatedTarget))) return;
      if (pressed.current === from) pressed.current = null;
      if (current.current === from) hide();
    };
    const down = (e: PointerEvent) => {
      pressed.current = claim(e.target);
      if (current.current || showing.current) hide();
    };
    const focus = (e: FocusEvent) => {
      const b = e.target instanceof HTMLElement && e.target.matches(":focus-visible") ? claim(e.target) : null;
      if (b) show(b, true);
    };
    const blur = (e: FocusEvent) => e.target === current.current && hide();
    const key = (e: KeyboardEvent) => e.key === "Escape" && current.current && hide();
    const gone = () => current.current && hide(true);
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", blur, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", gone, { capture: true, passive: true });
    window.addEventListener("wheel", gone, { capture: true, passive: true });
    window.addEventListener("blur", gone);
    return () => {
      window.clearTimeout(wait.current);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", blur, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("wheel", gone, true);
      window.removeEventListener("blur", gone);
    };
  }, []);

  // Its button taken out of the page (a row that went, a toggle that turned into another) takes the tip with it, at once.
  useEffect(() => {
    const el = tip?.el;
    if (!el || !life.mounted) return;
    const watch = new MutationObserver(() => {
      if (el.isConnected) return;
      setOpen(false);
      setTip(null);
      current.current = null;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [tip?.el, life.mounted]);

  // Placed under its button (over it with no room under), centred on it, growing from the edge that faces it.
  useLayoutEffect(() => {
    const t = box.current;
    if (!t || !tip || !open) return;
    const r = tip.el.getBoundingClientRect();
    const size = t.getBoundingClientRect();
    const at = tipPlace(r, size, document.documentElement.clientWidth, window.innerHeight);
    t.style.left = `${at.left}px`;
    t.style.top = `${at.top}px`;
    t.style.transformOrigin = originCss(originOf(at.side, { left: at.left, top: at.top, width: size.width, height: size.height }, r));
    t.dataset.side = at.side;
    t.dataset.ready = "";
  }, [tip, open]);

  // Back on the button whose tip was fading, it returns from where the fade had got to; another button's comes in afresh (its own key).
  const fadingN = useRef(0);
  if (life.closing && tip) fadingN.current = tip.n;
  if (!tip || !life.mounted) return null;
  return createPortal(
    <span key={tip.n} ref={box} className="lc-tip" aria-hidden data-closing={life.closing || undefined} data-again={(life.again && tip.n === fadingN.current) || undefined} onTransitionEnd={life.onEnd}>
      {tip.words}
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </span>,
    document.body,
  );
}
