/*
  Which of the Design dock's tray rows draws its button in ink. The face has one ink action at a time: the inspector's
  foot (Send to code, Update code, Fix all) has it while it shows, and a tray row that does the same thing stays quiet
  beside it, so it is never offered twice in ink. Of the rest, a row is ink only when it is the one row in the tray with
  a button (Load it, Send to code, Update code, Keep, Fix all); two or more stacked are all quiet, as a menu of choices.
  Each row and the foot claim their kind while they show; the rows read the claims back to decide.
*/
import { useEffect, useSyncExternalStore } from "react";

export type InkKind = "send" | "update" | "fix" | "load" | "keep";

/** Whether the tray row of `kind` is ink, given every tray row with a button and every ink action the foot shows. */
export function trayInk(kind: InkKind, tray: readonly InkKind[], foot: readonly InkKind[]): boolean {
  if (foot.includes(kind)) return false;
  return tray.filter((k) => !foot.includes(k)).length === 1;
}

const claims = { tray: new Map<object, InkKind>(), foot: new Map<object, InkKind>() };
const watchers = new Set<() => void>();
let version = 0;
const changed = () => (version++, watchers.forEach((f) => f()));
const watch = (f: () => void) => (watchers.add(f), () => void watchers.delete(f));

/** Claims `kind` for the tray or the foot until the returned function is called. */
export function claimInk(where: "tray" | "foot", kind: InkKind): () => void {
  const key = {};
  claims[where].set(key, kind);
  changed();
  return () => (claims[where].delete(key), changed());
}

export const inkClaims = () => ({ tray: [...claims.tray.values()], foot: [...claims.foot.values()] });

/** Holds a claim while `kind` is given (a row or foot with its button showing); none while it is undefined. */
export function useInkClaim(where: "tray" | "foot", kind: InkKind | undefined) {
  useEffect(() => (kind ? claimInk(where, kind) : undefined), [where, kind]);
}

/** For a tray row: claims its kind while its button shows, and says whether that button is ink. */
export function useTrayInk(kind: InkKind | undefined): boolean {
  useInkClaim("tray", kind);
  useSyncExternalStore(watch, () => version);
  if (!kind) return false;
  const { tray, foot } = inkClaims();
  // On the first draw the row's own claim is not in yet (effects run after): count it, so the button does not flicker.
  return trayInk(kind, tray.includes(kind) ? tray : [...tray, kind], foot);
}
