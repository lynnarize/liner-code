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
