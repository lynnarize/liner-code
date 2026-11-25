/*
  The session's surfaces, as a row of icons at the right end of its header, after the Reviewer (SPEC
  rule 1, board Main, 2026-11-25; surface-row.ts says what is lit and what ··· lists). They were a rail down
  the paper's right edge (0.2.7) and a strip of tabs over the panel before that.
  Session pins its card at the chat's right, as T3 Code's is, and a second press takes it away; the Terminal shows or hides the bottom panel; Changes, Browser and Files show
  their surface, and pressing the lit one hides the panel (dock.ts toggleTab, as the rail did). ··· is a
  menu of the rest: Pull request, Design, Side chat, Device, and Your apps to the side (each app, then New
  add-on). Each row's key is at its end, your binding (keymap.ts). 20px navigation icons in 32px buttons,
  as the sidebar's own top icons.
*/
import { type ReactNode } from "react";
import type { Thread } from "@contracts";
import { useEngine } from "./engine";
import { I, N } from "./icons";
import { plural } from "./model";
import { appIcon, appsFor } from "./Addon";
import { usePins } from "./TopBar";
import { shortcutOf } from "./keymap";
import { surfaceOf } from "./Surfaces";
import { openTab, toggleTab, type DockState } from "./dock";
import { iconLit, moreLit, moreRows, type IconId } from "./surface-row";
import { Pop, Row, Sep, SubMenu } from "./ui";
import * as os from "./os";

const ICON: Record<IconId, { label: string; icon: (p: { size?: number }) => ReactNode }> = {
  session: { label: "Session", icon: N.session },
  terminal: { label: "Terminal", icon: N.terminal },
  changes: { label: "Changes", icon: N.changes },
  browser: { label: "Browser", icon: N.globe },
  files: { label: "Files", icon: N.folder },
};
const keys = (id: string) => os.keys(shortcutOf(id) ?? []) || undefined;
/** "Changes (⇧⌘D)": a button's tooltip with its key, when it has one. */
const tip = (words: string, id: string) => (keys(id) ? `${words} (${keys(id)})` : words);

export function Switcher({ thread, dock, onDock, below, onBelow, files, session, onMake }: {
  thread: Thread;
  dock: DockState;
  onDock: (d: DockState) => void;
  below: boolean;
  onBelow: () => void;
  /** Files waiting to be committed: said in Changes' name for a screen reader. */
  files: number;
  /** The Session card: pinned or not (Session.tsx draws SessionInfo in the pinned column). */
  session: { open: boolean; onOpen: (open: boolean) => void };
  /** New add-on: asks the agent for one in the composer. */
  onMake: () => void;
}) {
  const addons = useEngine((s) => s.addons);
  const pins = usePins();
  const apps = appsFor(addons, thread.projectId);
  const rows = moreRows(dock, apps, pins);
  const more = moreLit(dock);
  return (
    <div className="lc-sw" role="toolbar" aria-label="Surfaces">
      <button
        type="button"
        className="lc-sw-b l-focus"
        aria-pressed={session.open}
        aria-label={session.open ? "Session: where it runs, its context and its setup, pinned. Press to unpin" : "Session: where it runs, its context and its setup"}
        title={session.open ? tip("Unpin the Session card", "surface.session") : tip("Session", "surface.session")}
        onClick={() => session.onOpen(!session.open)}
      >
        <N.session />
      </button>
      {(["terminal", "changes", "browser", "files"] as const).map((id) => {
        const on = iconLit(id, dock, below, session.open);
        const { label, icon: Icon } = ICON[id];
        const name = id === "changes" && files ? `Changes, ${plural(files, "file")} to commit` : label;
        return (
          <button
            key={id}
            type="button"
            className="lc-sw-b l-focus"
            aria-pressed={on}
            aria-label={on && id !== "terminal" ? `${name}: showing. Press to hide the panel` : name}
            title={on ? (id === "terminal" ? tip("Hide the bottom panel", "surface.terminal") : tip("Hide the panel", `surface.${id}`)) : tip(label, `surface.${id}`)}
            onClick={() => (id === "terminal" ? onBelow() : onDock(toggleTab(dock, id)))}
          >
            <Icon />
          </button>
        );
      })}
      <Pop label="More surfaces: Pull request, Design, Side chat, Device and your apps" menu align="end" width={260} triggerClass="lc-sw-b" triggerAttrs={{ "aria-pressed": more, title: "More surfaces" }} trigger={<N.more />}>
        {(close) => (
          <>
            {rows.surfaces.map((r) => {
              const s = surfaceOf(r.id);
              if (!s) return null;
              return <Row key={r.id} title={s.label} icon={<s.icon size={14} />} on={r.on || undefined} end={keys(`surface.${r.id}`)} onPick={() => (close(), onDock(openTab(dock, r.id)))} />;
            })}
            <Sep />
            <SubMenu title="Your apps" icon={<I.app size={14} />} value={rows.appOn ? <I.check size={14} className="lc-row-on" /> : apps.length || undefined} label="Your apps" width={250}>
              {() => (
                <>
                  {rows.apps.map((a) => {
                    const Icon = appIcon(addons.find((x) => x.id === a.id)?.panel?.icon);
                    return <Row key={a.id} title={a.name} icon={<Icon size={14} />} on={a.on || undefined} onPick={() => (close(), onDock(openTab(dock, a.tab)))} />;
                  })}
                  {rows.apps.length > 0 && <Sep />}
                  <Row title="New add-on" icon={<I.plus size={14} />} onPick={() => (close(), onMake())} />
                </>
              )}
            </SubMenu>
          </>
        )}
      </Pop>
    </div>
  );
}
