/*
  What a turn's live line says of its thinking (Timeline.tsx Live): "Thinking", then the thought's last sentence in the
  quiet style, as the live row did before the live line. No React here, so plain Node can test it
  (engine/test/reviewed-faults.test.ts).
*/

/** Markdown as plain words on one line: what a line of a few words shows of a thought written in it. */
export const flat = (md: string) =>
  md
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|\*|~~)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();

/**
  The thought's last sentence, the newest being what it is at, and which sentence that is. `n` grows only when a new
  sentence begins, so the line slides once per sentence and says each token in place in between.
*/
export function thoughtLine(texts: string[]): { sentence: string; n: number } {
  const text = flat(texts.join(" "));
  const all = text.split(/(?<=[.!?:])\s+/).filter(Boolean);
  return { sentence: all.at(-1) ?? text, n: all.length };
}
