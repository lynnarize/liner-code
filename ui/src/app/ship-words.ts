/*
  What the push card says: the count of commits a push carries, and which of its stacked words is the live one at
  each stage. Pure, so a node test can pin it (the card itself has no component tests).
*/
/** The commits a push carries: a shipment with files commits first (its rows), a push-only one takes what's outgoing.
    A push-only shipment can carry NOTHING — that case keeps its zero, it is the truth the card must say. */
export const pushCount = (s: { files: number; rows: number; commits: number }) =>
  s.files ? Math.max(1, s.rows) : s.commits;
/** The stage map app.css draws (.lc-ship[data-p] …): which stacked span is in focus at each stage. */
export const shipLive = (stage: number) => ({
  h1: stage === 1, h2: stage === 2, h3: stage === 3 || stage === 4,
  m0: stage <= 2, m1: stage >= 3,
  x0: stage === 0, x1: stage === 1, x2: stage === 2, x3: stage === 3, x4: stage === 4,
});
