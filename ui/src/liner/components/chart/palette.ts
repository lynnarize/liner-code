/*
  Which color a mark wears. Liner charts default to one accent (and its validated steps)
  or to emphasis: the series that matters in the accent, the rest in the context grey.
  The categorical palette is opt-in, for when every series is the subject; its eight hues
  are validated and assigned in a fixed order, never cycled.
*/
export type Palette = "emphasis" | "categorical";

export const ACCENT = "var(--l-accent)";
export const GRAY = "var(--l-viz-gray)";
export const STEPS = ["var(--l-viz-1)", "var(--l-viz-2)", "var(--l-viz-3)", "var(--l-viz-4)", "var(--l-viz-5)"];
export const CAT = Array.from({ length: 8 }, (_, i) => `var(--l-cat-${i + 1})`);

/** Color for series i of n; emphasis lights the focused one (or the first when none is). */
export function seriesColor(i: number, n: number, palette: Palette, focus: number | null) {
  if (n === 1) return ACCENT;
  if (palette === "categorical") return CAT[i % 8];
  return i === (focus ?? 0) ? ACCENT : GRAY;
}
