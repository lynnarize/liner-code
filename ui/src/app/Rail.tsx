/*
  The session tray, upright at the right edge of the thread in a lane of its own: the one glass
  surface left, holding three solid segments. The panel; the surfaces it holds, each a press
  away, the open one's icon on a tile; and shipping: commit and push (the files waiting to be
  committed in a small chip under the arrow) and every other surface. The bar keeps the
  session's own things (who works on it, its place, Changes).
*/
import { useEffect, useRef, type ReactNode } from "react";
import type { Thread } from "@contracts";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { toast } from "@liner/components/toast/toast";
import { CommitForm, type Then } from "./Commit";
import { ship } from "./Ship";
import { rpc } from "./engine";
import { I } from "./icons";
import { shortcutOf } from "./keymap";
import { plural } from "./model";
import { openTab, type PanelState, type SurfaceId } from "./Surfaces";
import { PanelHead, Pop, Row } from "./ui";

const SHOWN: { id: SurfaceId; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "side", label: "Side chat", icon: I.comment },
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

function Btn({ label, keys, on, onClick, children }: { label: string; keys?: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} shortcut={keys} side="left">
      <button type="button" className="lc-rail-b l-focus" aria-label={label} aria-pressed={on ?? false} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

/*
  The open session's panel, reachable from outside it: ⌘K's "Open Browser" and the like go to the
  session on screen through its tray, which holds the panel. Answers whether a session took it.
*/
const panels = new Map<string, (tab: SurfaceId) => void>();
export function openSurface(threadId: string, tab: SurfaceId) {
  const open = panels.get(threadId);
  open?.(tab);
  return Boolean(open);
}

export function Rail({ thread, panel, onPanel, onTab, files, branch }: { thread: Thread; panel: PanelState; onPanel: (f: (p: PanelState) => PanelState) => void; onTab: (tab: SurfaceId) => void; files: number; branch?: string }) {
  const showing = panel.open && !panel.picking ? panel.tab : null;
  const setPanel = useRef(onPanel);
  setPanel.current = onPanel;
  useEffect(() => {
    const open = (tab: SurfaceId) => setPanel.current((p) => openTab(p, tab));
    panels.set(thread.id, open);
    return () => {
      if (panels.get(thread.id) === open) panels.delete(thread.id);
    };
  }, [thread.id]);
  const running = thread.status === "running";
  return (
    <nav className="lc-rail" aria-label="Panel and surfaces">
      <div className="lc-rail-seg" data-solo>
        <Btn label={panel.open ? "Hide the panel" : "Show the panel"} on={panel.open} onClick={() => onPanel((p) => (p.open ? { ...p, open: false, wide: false, picking: false } : { ...p, open: true }))}>
          <I.panel size={17} />
        </Btn>
      </div>
      <div className="lc-rail-seg" role="group" aria-label="Surfaces">
        {SHOWN.map((s) => (
          <Btn key={s.id} label={s.label} keys={shortcutOf(`surface.${s.id}`)?.join("")} on={showing === s.id} onClick={() => onTab(s.id)}>
            <s.icon size={17} />
          </Btn>
        ))}
      </div>
      <div className="lc-rail-seg" role="group" aria-label="Ship" data-act>
        <Tooltip content={files ? `Commit ${plural(files, "file")}` : "Push or open a PR"} side="left">
          <span className="lc-rail-pop" data-count={files > 0 || undefined}>
            <Pop
              label={files ? `Commit and push, ${plural(files, "file")} waiting` : "Commit and push"}
              side="left"
              width={files ? 380 : 280}
              triggerClass="lc-rail-b lc-rail-ship"
              disabled={running}
              trigger={
                <>
                  <I.push size={17} />
                  {files > 0 && (
                    <span key={files} className="lc-rail-count l-num" aria-hidden>
                      {files > 99 ? "99+" : files}
                    </span>
                  )}
                </>
              }
            >
              {(close) =>
                files > 0 ? (
                  <CommitForm thread={thread} files={files} then={savedThen()} onDone={close} />
                ) : (
                  <div className="lc-ship-menu">
                    <PanelHead>Nothing to commit</PanelHead>
                    <Row
                      title={`Push ${branch ?? "this branch"}`}
                      note="To its branch on GitHub"
                      icon={<I.push size={13} />}
                      onPick={() => {
                        close();
                        void ship(thread, null);
                      }}
                    />
                    <Row title="Open a pull request" note="The PR card, in the chat" icon={<I.pr size={13} />} onPick={() => (close(), void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail))} />
                  </div>
                )
              }
            </Pop>
          </span>
        </Tooltip>
        <Btn label="Every surface" on={panel.open && panel.picking} onClick={() => onPanel((p) => ({ ...p, open: true, picking: !(p.open && p.picking) }))}>
          <I.more size={17} />
        </Btn>
      </div>
    </nav>
  );
}
