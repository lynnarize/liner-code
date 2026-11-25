/*
  Where the notices hang (F50, 2026-11-25). The toaster hangs at the window's top right, under the header row;
  since the right panel became a flush column of the paper, a notice there covered the panel's head (Changes'
  file strip, Files' tree). While a session shows its panel, the notices hang at the chat column's right edge
  instead, clear of the panel. App.tsx (useToastPlace) measures the column when a notice comes and when the window changes
  size, and sets --lc-toast-right on the page for app.css. Apart from it, with no imports, so plain Node can test it.
*/
/** The gap between a notice and the edge it hangs from. */
export const TOAST_EDGE = 16;

/** How far from the window's right edge the notices hang: the chat column's right edge while a panel shows beside it (`columnRight`), else the window's. */
export const toastRight = (windowWidth: number, columnRight: number | null) => (columnRight === null ? TOAST_EDGE : Math.max(TOAST_EDGE, Math.round(windowWidth - columnRight + TOAST_EDGE)));
