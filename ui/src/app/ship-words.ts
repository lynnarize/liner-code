/*
  What the push card says: the count of commits a push carries, its words for that count, and which of its stacked
  parts is the live one at each stage. Pure, so a node test can pin it (the card itself has no component tests).
*/
/** The commits a push carries, from what git.outgoing counted (`commits`, every one, not only the thirty it lists). A shipment with files adds the
    commit it makes until git lists it (`listed`); a push-only one can carry NOTHING, and that zero is the truth the card
    must say. Null when git.outgoing never answered (`counted` false): then the card can't know, so it gives no count. */
export const pushCount = (s: { files: number; commits: number; listed: boolean; counted: boolean }): number | null =>
  !s.counted ? null : s.files && !s.listed ? s.commits + 1 : s.commits;
const commits = (n: number) => `${n} ${n === 1 ? "commit" : "commits"}`;
/** The card's words for a count: "up to date" only for a push known to carry nothing, never for one whose count is
    unknown, nor for a branch with no upstream yet, whose push publishes it even with no commit of its own. */
export const shipWords = (n: number | null, remote: string, published = true) =>
  n === 0 && !published
    ? { meta: `new on ${remote}`, pushing: `Publishing to ${remote}`, pushed: `Published to ${remote}` }
    : {
        meta: n === null ? "" : n ? `${commits(n)} to push` : "up to date",
        pushing: n ? `Pushing ${commits(n)} to ${remote}` : `Pushing to ${remote}`,
        pushed: n ? `Pushed ${commits(n)}` : n === 0 ? "Everything is up to date" : `Pushed to ${remote}`,
      };
/** The stage map app.css draws (.lc-ship[data-p] …): which stacked span is in focus at each stage, when the rows are
    open (body), and when the last stage's message and its next button show (msg, next). */
export const shipLive = (stage: number) => ({
  h1: stage === 1, h2: stage === 2, h3: stage === 3 || stage === 4,
  m0: stage <= 2, m1: stage >= 3,
  x0: stage === 0, x1: stage === 1, x2: stage === 2, x3: stage === 3, x4: stage === 4,
  body: stage >= 1 && stage <= 3, msg: stage === 4, next: stage === 4,
});
