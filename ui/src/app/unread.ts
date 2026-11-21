/*
  A session is read once you're looking at it: on screen in a focused window. In the background it stays unread, in Needs
  you, as the notification says, and a question it asks stays amber in every face's list (session-state.ts, seenAsk). Every
  view that shows a session as the one open uses this, so opening it in any face clears it: Code's Session, Liner Design's
  face, Liner Security's scan and ask sessions.
*/
import { useEffect } from "react";
import { rpc } from "./engine";

/** Clears the session's unread mark while it is on screen and the window has focus, now and whenever the window comes back. */
export function useReadWhileShown(id: string | undefined, unread: boolean | undefined) {
  useEffect(() => {
    if (!id) return;
    const clear = () => {
      if (unread && document.hasFocus()) void rpc("thread.update", { id, unread: false });
    };
    clear();
    window.addEventListener("focus", clear);
    return () => window.removeEventListener("focus", clear);
  }, [id, unread]);
}
