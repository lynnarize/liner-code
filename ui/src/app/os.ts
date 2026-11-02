/*
  The words that change on Windows. The Electron shell says which system it runs on; on Windows
  the copy says this PC and File Explorer, and keys are kept in Windows' encrypted storage
  (Electron's safeStorage, sealed to your Windows sign-in) rather than a keychain. The Mac shells
  and a plain browser (dev) keep the Mac's words. Shortcuts in hints go by keymap's glyphs, the
  keyboard it reads, so a hint names the keys that work: ⌘K on a Mac, Ctrl+K on a PC.
*/
import { glyphs } from "./keymap";

/** Windows, by the shell's word. */
export const windows = typeof window !== "undefined" && window.linerShell?.platform === "win32";

/** The computer: "Mac" or "PC", for "the Mac", "this Mac's". */
export const machine = windows ? "PC" : "Mac";
export const here = `this ${machine}`;
export const Here = `This ${machine}`;
/** Where "Show in …" opens a file. */
export const fileManager = windows ? "File Explorer" : "Finder";
/** Where API keys are kept, mid-sentence: the Mac's words as given ("the login keychain"), or Windows'. */
export const keyStore = (onMac = "the keychain") => (windows ? "Windows' encrypted storage" : onMac);

/** The keyboard keymap reads is a Mac's (⌘ ⌥ ⌃), not a PC's (Ctrl, Alt). */
export const macKeys = glyphs("mod+k")[0] === "⌘";
/** The modifiers ahead of a key in a hint: ⌘Enter and ⌘⇧Enter, or Ctrl+Enter and Ctrl+Shift+Enter. */
export const mod = macKeys ? "⌘" : "Ctrl+";
export const shift = macKeys ? "⇧" : "Shift+";
/** Keys in a line, from a spec ("mod+k") or keymap's glyphs: ⌘K, or Ctrl+K. `gap` goes between a Mac's symbols. */
export const keys = (k: string | string[], gap = "") => (typeof k === "string" ? glyphs(k) : k).join(macKeys ? gap : "+");

/** A path under your home folder as ~: /Users/you/a, or C:\Users\you\a on Windows. */
export const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^[a-z]:[\\/]users[\\/][^\\/]+/i, "~");
