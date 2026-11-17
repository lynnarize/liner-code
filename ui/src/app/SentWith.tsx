/*
  Under your message, one grey line when the agent was also told which files changed since its last turn (engine/src/edits.ts):
  "Sent with: 3 files changed since the last turn". Liner knows a file changed outside the session's turns, not that a person
  changed it, so that's all it says. Your bubble shows your words only; the line opens the list, by who changed each file, with
  its line counts, the way the agent was told it.
*/
import { useState } from "react";
import type { EditedFile } from "@contracts";
import { I } from "./icons";
import { plural } from "./model";
import "./precheck.css";

/** Each group's words, in the order the agent is told them. */
const BY: { by: EditedFile["by"]; line: (n: number) => string; head: (f: EditedFile) => string }[] = [
  { by: "outside", line: (n) => `${plural(n, "file")} changed since the last turn`, head: () => "Changed outside its turns" },
  { by: "undo", line: (n) => `${plural(n, "file")} put back by Undo`, head: (f) => `Put back by an Undo of turn ${f.turn}` },
  { by: "rewind", line: (n) => `${plural(n, "file")} left by turns taken back`, head: () => "Left by turns taken back" },
  { by: "keep", line: (n) => `${plural(n, "file")} kept from Compare`, head: () => "Kept from Compare" },
  { by: "session", line: (n) => `${plural(n, "file")} from another session`, head: (f) => `Changed by ${f.title ? `“${f.title}”` : "another session"}` },
  { by: "branch", line: (n) => `${plural(n, "file")} from a branch change`, head: () => "Came with a pull, merge or branch switch" },
];

export function SentWith({ edits }: { edits: EditedFile[] }) {
  const [open, setOpen] = useState(false);
  const said = BY.map((b) => ({ ...b, files: edits.filter((f) => f.by === b.by) })).filter((b) => b.files.length);
  if (!said.length) return null;
  return (
    <>
      <button type="button" className="lc-you-told lc-sent l-focus" aria-expanded={open} title="The agent was told these files changed since its last turn: names and line counts, not their contents" onClick={() => setOpen(!open)}>
        <span className="lc-sent-t">Sent with: {said.map((b) => b.line(b.files.length)).join(", ")}</span>
        <I.chevR size={12} />
      </button>
      {open && (
        <div className="lc-sent-list">
          {said.map((b) => (
            <div key={b.by} className="lc-sent-g">
              {(said.length > 1 || b.by !== "outside") && <div className="lc-sent-h">{b.head(b.files[0])}</div>}
              {b.files.map((f) => (
                <div key={f.path} className="lc-sent-f">
                  <span className="lc-sent-p" title={f.from ? `${f.from} → ${f.path}` : f.path}>
                    {f.path}
                  </span>
                  <span className="lc-sent-n">{f.status === "deleted" ? "deleted" : f.status === "added" ? `new, +${f.added}` : `+${f.added} −${f.removed}`}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
