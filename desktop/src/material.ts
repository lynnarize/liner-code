/*
  The window's material, as the page names it: solid, or see-through to the desktop, crisp (clear)
  or blurred (frost). Kept apart from Electron so it can be tested. Older shells also had Liquid
  Glass and Vibrancy behind the sidebar; the page stopped asking for them on 29 Oct, so a
  shell.json that still says one of them, or anything else this doesn't know, is solid.
*/

export type Material = "solid" | "clear" | "frost";

/** The window turned see-through, the desktop behind the whole app (Settings, Appearance, Background: Desktop). */
export const seeThrough = (m: string) => m === "clear" || m === "frost";

/** A material the shell can draw, from what the page sent or shell.json kept: anything else is solid. */
export const materialOf = (m: unknown): Material => (m === "clear" || m === "frost" ? m : "solid");
