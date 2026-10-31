/*
  Undo turn, from the Diff and the Review. The engine won't put a turn back over a file that
  changed after it (yours, or a later turn's) and says which; the toast then offers to undo
  anyway, which loses those changes. Either way the files as they were stay in a snapshot.
*/
import type { Item } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "./engine";
import { plural } from "./model";

type Checkpoint = Extract<Item, { kind: "checkpoint" }>;

export async function undoTurn(threadId: string, cp: Checkpoint, force = false): Promise<void> {
  try {
    await rpc("checkpoint.revert", { threadId, itemId: cp.id, force });
    toast(`Undid turn ${cp.turn}`, { description: `${plural(cp.files.length, "file")} back as they were` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!force && /^Changed after that turn:/.test(message))
      toast.error(`Turn ${cp.turn} wasn't undone`, { description: message, action: { label: "Undo anyway", onClick: () => void undoTurn(threadId, cp, true) }, duration: 10000 });
    else toast.error(message);
  }
}
