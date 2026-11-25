/*
  The findings a bulk action on the Findings page acts on (Findings.tsx), apart from React so plain Node can test it
  (engine/test/release-review-0-3-2.test.ts). No React and no alias imports here.
*/
import type { SecurityFinding } from "../../../../contracts/src/index.ts";

/**
  The picked findings a bulk Dismiss or Reopen acts on: those still shown in the tab, in its order. A pick outlives the
  find field and the filters, and a finding can leave the tab while picked (its fix merged), so acting on every pick
  dismissed findings out of sight, and a fixed one lost its fix.
*/
export const pickedToAct = (picked: ReadonlySet<string>, shown: Pick<SecurityFinding, "id">[]) => shown.filter((f) => picked.has(f.id)).map((f) => f.id);
