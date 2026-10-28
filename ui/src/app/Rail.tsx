/*
  The session's rail, floating at the right edge of the thread: the panel and the surfaces it
  holds, each a press away. Liner's glass rim holds pill segments, the way a call's controls sit
  together; the open one's icon rests on a tile. At the foot, committing and pushing, and every
  other surface. The bar keeps the session's own things (who works on it, its place, Changes).
*/
import type { ReactNode } from "react";
import type { Thread } from "@contracts";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { toast } from "@liner/components/toast/toast";
import { CommitForm, type Then } from "./Commit";
import { rpc } from "./engine";
import { I } from "./icons";
import { plural } from "./model";
import type { PanelState, SurfaceId } from "./Surfaces";
import { PanelHead, Pop, Row } from "./ui";

const SHOWN: { id: SurfaceId; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "terminal", label: "Terminal", icon: I.terminal },
  { id: "browser", label: "Browser", icon: I.globe },
  { id: "files", label: "Files", icon: I.file },
  { id: "device", label: "Device", icon: I.device },
  { id: "pr", label: "Pull request", icon: I.pr },
];

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const savedThen = (): Then => {
  try {
    return (localStorage.getItem("lc:commit-then") as Then) ?? "push";
  } catch {
    return "push";
  }
};

function Btn({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="left">
      <button type="button" className="lc-rail-b l-focus" aria-label={label} aria-pressed={on ?? false} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

export function Rail({ thread, panel, onPanel, onTab, files, branch }: { thread: Thread; panel: PanelState; onPanel: (f: (p: PanelState) => PanelState) => void; onTab: (tab: SurfaceId) => void; files: number; branch?: string }) {
  const showing = panel.open && !panel.picking ? panel.tab : null;
  const running = thread.status === "running";
  return (
    <nav className="lc-rail l-glass" aria-label="Panel and surfaces">
      <div className="lc-rail-seg">
        <Btn label={panel.open ? "Hide the panel" : "Show the panel"} on={panel.open} onClick={() => onPanel((p) => (p.open ? { ...p, open: false, wide: false, picking: false } : { ...p, open: true }))}>
          <I.panel size={16} />
        </Btn>
      </div>
      <div className="lc-rail-seg">
        {SHOWN.map((s) => (
          <Btn key={s.id} label={s.label} on={showing === s.id} onClick={() => onTab(s.id)}>
            <s.icon size={16} />
          </Btn>
        ))}
      </div>
      <div className="lc-rail-seg">
        <Tooltip content={files ? `Commit ${plural(files, "file")}` : "Push or open a PR"} side="left">
          <span className="lc-rail-pop">
            <Pop label="Commit and push" align="end" width={files ? 420 : 280} triggerClass="lc-rail-b" disabled={running} trigger={<I.push size={16} />}>
              {(close) =>
                files > 0 ? (
                  <CommitForm thread={thread} files={files} then={savedThen()} onDone={close} />
                ) : (
                  <>
                    <PanelHead>Nothing to commit</PanelHead>
                    <Row
                      title={`Push ${branch ?? "this branch"}`}
                      note="To its branch on GitHub"
                      icon={<I.push size={13} />}
                      onPick={() => {
                        close();
                        void rpc("git.push", { threadId: thread.id })
                          .then((p) => toast.success(`Pushed ${p.branch} to ${p.remote}`))
                          .catch(fail);
                      }}
                    />
                    <Row title="Open a pull request" note="The PR card, in the chat" icon={<I.pr size={13} />} onPick={() => (close(), void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail))} />
                  </>
                )
              }
            </Pop>
          </span>
        </Tooltip>
        <Btn label="Every surface" on={panel.open && panel.picking} onClick={() => onPanel((p) => ({ ...p, open: true, picking: !(p.open && p.picking) }))}>
          <I.more size={16} />
        </Btn>
      </div>
    </nav>
  );
}
