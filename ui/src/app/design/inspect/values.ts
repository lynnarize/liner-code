/*
  Small pure picks over CSS values, apart from css.ts (which asks the browser's canvas for colours), so plain Node can
  test them (engine/test/ui-faults-2026-11-27.test.ts): the type style nearest a text's size, and a url written as CSS.
*/

/**
  The type style nearest a text's size, when its size is none of the styles' sizes; undefined when it is one, when it has
  none, or when no style has a size. A lean can name families only ("Headings in Fraunces, body in Inter."), and a pick
  over styles without sizes threw "Reduce of empty array" as the text layer was selected.
*/
export function nearestSize<T extends { size?: number }>(styles: T[], size: number | undefined): T | undefined {
  if (size === undefined) return undefined;
  const sized = styles.filter((s) => s.size !== undefined);
  if (!sized.length || sized.some((s) => s.size === size)) return undefined;
  return sized.reduce((a, b) => (Math.abs(b.size! - size) < Math.abs(a.size! - size) ? b : a));
}

/** A url as a CSS value, quoted, so a path with a space in it ("Screen Shot 1.png") or a quote is still one url. */
export const cssUrl = (url: string) => `url("${url.replace(/["\\]/g, "\\$&")}")`;
