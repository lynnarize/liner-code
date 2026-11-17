/*
  What the prompt check remembers of the draft in the box (Precheck.tsx), kept apart from React so a test can hold it to its
  promises: a suggestion you closed doesn't come back for that draft, a draft the Send check has read goes on the next Send,
  and a new draft (the box emptied: sent, split, cleared) starts with neither. Words changed on the way are the same draft.
*/
// By path, not the app's @contracts alias, so the engine's tests can read this file too.
import type { Precheck } from "../../../contracts/src/index.ts";

export class DraftMemory {
  /** The kinds closed on this draft. */
  private closed = new Set<Precheck["kind"]>();
  /** The words the Send check last read. */
  private checked = "";

  /** The box now holds `draft` (its trimmed words); empty is the end of the draft. */
  see(draft: string) {
    if (draft) return;
    this.closed.clear();
    this.checked = "";
  }

  /** You closed this suggestion: it stays away until the draft ends. */
  close(kind: Precheck["kind"]) {
    this.closed.add(kind);
  }

  /** What to show of a suggestion: nothing when it was closed on this draft. */
  shown(p: Precheck | null): Precheck | null {
    return p && this.closed.has(p.kind) ? null : p;
  }

  /** The Send check has read these words. */
  read(draft: string) {
    this.checked = draft;
  }

  /** Send goes without asking again: the check read these very words already, or you closed what it said on this draft. */
  passes(draft: string) {
    return this.checked === draft || this.closed.has("unrelated");
  }

  /** The words the Send check read, while they're still in the box. */
  readNow(draft: string) {
    return Boolean(draft) && this.checked === draft;
  }

  /** The draft went (sent, moved, split). */
  reset() {
    this.closed.clear();
    this.checked = "";
  }
}
