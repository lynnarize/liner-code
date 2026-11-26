/*
  Small decisions main.ts makes about its windows, kept apart from Electron so a test can make them too: when the
  menu-bar item reads the engine itself, what a window whose page went does next, which window a bridge call came from,
  and putting them all out of sight.
*/

/**
  Whether the menu-bar item reads the sessions from the engine itself. A page sends its status only when something
  changes, so a page that has said nothing for a while is a quiet one, not a gone one: reading the engine then would put
  a poorer list (no finished-unread, no routines) over the page's. Only with no window's page alive is there no one to say.
*/
export const engineStatusDue = (windows: readonly { destroyed: boolean }[]) => !windows.some((w) => !w.destroyed);

/**
  A window's page went (render-process-gone): loaded again three times a minute at most, then the person is asked, once.
  `gone` is when it went before; `asking` is whether that question is up already, so a page that keeps going while it's
  up doesn't stack another dialog on it.
*/
export function afterCrash(gone: readonly number[], now: number, asking: boolean): { gone: number[]; then: "reload" | "ask" | "nothing" } {
  const recent = gone.filter((t) => now - t < 60_000);
  if (recent.length < 3) return { gone: [...recent, now], then: "reload" };
  return { gone: recent, then: asking ? "nothing" : "ask" };
}

/**
  What closing a window does. The last one open keeps the app as a single window did: on a Mac it's hidden (the app and its
  sessions go on, and the Dock shows it again), elsewhere closing it quits, so the person is asked first while sessions work.
  Decided by how many are open, not by which was made first: with that, the first closed beside a New Window went for good,
  and the New Window, closed last, went too, leaving a Mac app no window to show and quitting elsewhere unasked.
*/
export const closeOf = (o: { open: number; quitting: boolean; mac: boolean }): "close" | "hide" | "ask" => (o.quitting || o.open > 1 ? "close" : o.mac ? "hide" : "ask");

/**
  Which of the app's windows a bridge call came from: the top frame of one of their pages, whichever is focused. A window
  behind another still sends its status, its badge and its notices, and a click lands before its focus does, so the
  focused window alone turned those away. Anything else is no window's: a frame inside a page (the Browser surface's, a
  panel's), a page drawn for a snapshot, a frame that has gone (Electron gives null for it).
*/
export function senderOf<W extends { isDestroyed(): boolean; webContents: { mainFrame: unknown } }>(windows: Iterable<W>, sender: unknown, frame: unknown): W | undefined {
  for (const w of windows) if (!w.isDestroyed() && w.webContents === sender) return frame != null && frame === w.webContents.mainFrame ? w : undefined;
  return undefined;
}

/** What hideEvery needs of a window. */
export type Hideable = { isDestroyed(): boolean; isFullScreen(): boolean; setFullScreen(on: boolean): void; once(event: "leave-full-screen", f: () => void): unknown; hide(): void };

/**
  Every window out of sight, for a quit that waits: a New Window left on screen said the app was still there after you
  quit it. A full-screen window leaves full screen first, as one closed does, and is hidden once out of it if the quit
  still waits by then (`still`). The windows it hid come back, to be shown again if the quit is
  called off.
*/
export function hideEvery<W extends Hideable>(windows: Iterable<W>, still: () => boolean): W[] {
  const hid: W[] = [];
  for (const w of windows) {
    if (w.isDestroyed()) continue;
    hid.push(w);
    if (w.isFullScreen()) {
      w.once("leave-full-screen", () => still() && !w.isDestroyed() && w.hide());
      w.setFullScreen(false);
    } else w.hide();
  }
  return hid;
}
