/*
  What Changes says in words (Review.tsx), apart from the component so it can be tested: the foot's
  "X of N files viewed", the files menu's foot line, and the lines a question is on.
*/

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** The foot's words, and the files menu's note: "1 of 2 files viewed", "0 of 1 file viewed". */
export const viewedSaid = (seen: number, total: number) => `${Math.min(seen, total)} of ${plural(total, "file")} viewed`;

/** The engine sends the first 60 files and counts the rest: what the files menu's foot line says of them. */
export function moreFilesSaid(n: number, turn: boolean, pick: string | null) {
  const where = turn ? "in this turn" : pick === "branch" ? "on this branch" : "across all turns";
  return `${plural(n, "more file")} ${where} ${n === 1 ? "isn't" : "aren't"} shown`;
}

/** The lines a question is on, as its chip says them: "Line 6", "Lines 6–8". A range of one line is that line. */
export const linesSaid = (a: { line: number; endLine?: number }) => (a.endLine && a.endLine !== a.line ? `Lines ${a.line}–${a.endLine}` : `Line ${a.line}`);

/** Where split view's changes are, for Previous and Next: CodeDiff draws each change as pairs of lines, the first pair of a change carrying its index. */
export const SPLIT_CHANGE = ".l-cdiff__pair[data-change]";
/**
  The line number pressed in split view to ask about that line: the new file's, on the right of each pair, as the
  unified view asks only by the new file's lines. The left holds the old file's numbers, which would anchor the wrong line.
*/
export const SPLIT_LINE = ".l-cdiff__pair > .l-cdiff__line:last-child > .l-cdiff__n";
