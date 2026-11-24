/*
  Small decisions main.ts makes about its windows, kept apart from Electron so a test can make them too: when the
  menu-bar item reads the engine itself, and what a window whose page went does next.
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
