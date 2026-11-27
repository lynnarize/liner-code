/*
  The commit message the app already holds for a session's changes, as plain code so engine/test/panel-tabs.test.ts runs
  it (no React, no alias imports). The commit form (Commit.tsx) keeps the message it wrote or you typed under
  `lc:commit-messages`, with the change set it was written for; the message box's commit tab (Session.tsx ToCommit) shows
  its first line, dim, only while that change set is still the one waiting. Nothing here asks a model for one.
*/
import type { Item } from "../../../contracts/src/index.ts";

export const HELD_KEY = "lc:commit-messages";

/** What a message was written for: each turn's snapshot still to commit, so any change to the files makes a new one. */
export function changeKey(items: Item[], files: number) {
  const waiting = items.flatMap((x) => (x.kind === "checkpoint" && !x.reverted && !x.committed ? [x] : []));
  return waiting.map((c) => `${c.id}:${c.to ?? ""}:${c.files.map((f) => `${f.path}+${f.added}-${f.removed}`).join(",")}`).join("|") || `files:${files}`;
}

/** The first line of the message held for these changes as they are now, or nothing (none kept, or kept for others). */
export function heldMessage(threadId: string, items: Item[], files: number): string | undefined {
  let kept: { key?: string; message?: string } | undefined;
  try {
    kept = (JSON.parse(localStorage.getItem(HELD_KEY) || "{}") as Record<string, { key?: string; message?: string }>)[threadId];
  } catch {
    return undefined;
  }
  if (!kept?.message || kept.key !== changeKey(items, files)) return undefined;
  return kept.message.split("\n").find((l) => l.trim())?.trim() || undefined;
}
