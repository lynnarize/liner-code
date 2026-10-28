/*
  The native <dialog> lifecycle the modal surfaces share: showModal() for focus trapping
  and an inert page, a closing state so exits can animate, and Escape or a backdrop press
  routed through onOpenChange so the owner stays in charge.
*/
import { useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from "react";

export function useModal(open: boolean, onOpenChange: (open: boolean) => void, exitMs = 220) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setClosing(false);
      d.showModal();
    } else if (open && d.open) {
      // Reopened while the exit was playing: stay open. Left closing, the panel would end
      // invisible while the modal still blocks every tap on the page.
      setClosing(false);
    } else if (!open && d.open) {
      setClosing(true);
      const t = window.setTimeout(() => {
        d.close();
        setClosing(false);
      }, exitMs);
      return () => window.clearTimeout(t);
    }
  }, [open]);
  const props = {
    ref,
    onCancel: (e: SyntheticEvent) => {
      e.preventDefault();
      onOpenChange(false);
    },
    // A press that lands on the dialog element itself is on the backdrop around the panel.
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) onOpenChange(false);
    },
    "data-closing": closing || undefined,
  };
  return props;
}
