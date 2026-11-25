/*
  A question card's picks (Timeline.tsx QuestionCard), apart from React so plain Node can test it
  (engine/test/release-review-0-3-2.test.ts): the answer a set of picks says, and the picks and own words a saved partial
  answer comes back as when the card is drawn again (another session and back, a reload). No React and no alias imports.
*/

/** The pick that stands for your own words. */
export const OTHER = "Something else";

type Question = { question: string; multiSelect?: boolean; options: { label: string }[] };

/** What is picked for a question: what you picked, else your own words for a question with no options, else nothing. */
export const selectedOf = (x: Question, picks: Record<string, string[]>): string[] => picks[x.question] ?? (x.options.length === 0 ? [OTHER] : []);

/** The answer the picks say: the labels picked, your own words in place of OTHER, joined with ", " for a multiple choice. */
export function answerOf(x: Question, picks: Record<string, string[]>, other: Record<string, string>): string {
  const resolved = selectedOf(x, picks).map((v) => (v === OTHER ? other[x.question]?.trim() ?? "" : v)).filter(Boolean);
  return x.multiSelect ? resolved.join(", ") : (resolved[0] ?? "");
}

/** The picks and own words that a saved partial answer (`partial`, by question) comes back as. */
export function seedOf(questions: Question[], partial: Record<string, string> | undefined): { picks: Record<string, string[]>; other: Record<string, string> } {
  const picks: Record<string, string[]> = {};
  const other: Record<string, string> = {};
  for (const q of questions) {
    const saved = partial?.[q.question];
    if (!saved) continue;
    const known = new Set(q.options.map((o) => o.label));
    if (q.multiSelect) {
      // The answer is the labels joined with ", ", your own words among them, and a label or your words may hold ", "
      // too: the longest run of parts that is a label is that label, and the rest are your words, picked once.
      const parts = saved.split(", ");
      const mine: string[] = [];
      const list: string[] = [];
      for (let i = 0; i < parts.length; ) {
        let n = parts.length - i;
        while (n > 0 && !known.has(parts.slice(i, i + n).join(", "))) n--;
        if (n > 0) list.push(parts.slice(i, i + n).join(", ")), (i += n);
        else {
          if (!mine.length) list.push(OTHER);
          mine.push(parts[i]);
          i++;
        }
      }
      picks[q.question] = list;
      const custom = mine.join(", ").trim();
      if (custom) other[q.question] = custom;
    } else {
      picks[q.question] = [known.has(saved) ? saved : OTHER];
      if (!known.has(saved)) other[q.question] = saved;
    }
  }
  return { picks, other };
}
