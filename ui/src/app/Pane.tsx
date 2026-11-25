/*
  The one frame every surface in the right panel is drawn in (SPEC rule 3, boards Main, Files and
  Browser, 2026-11-25), so no surface draws its own head, rows or foot. Styles: pane.css.

  A surface is, top to bottom:

    <PaneHead name="Changes" shows={<TurnPicker … />} tools={<><PaneTool … /><PaneTool … /></>} />
    <PaneBody>
      <PaneFile status="M" path="src/tides.js" lines={{ added: 3, removed: 1 }}>…its own actions…</PaneFile>
      …or sections of rows:
      <PaneSection label="Commits" note="3">
        <PaneRow icon={<I.commit size={14} />} value="2m ago">Fix the wrap</PaneRow>
      </PaneSection>
    </PaneBody>
    <PaneFoot say="1 of 2 files viewed">
      <PaneButton icon={<I.undo size={14} />}>Undo turn 2</PaneButton>
      <PaneButton ink>Commit 2 files</PaneButton>
    </PaneFoot>

  The panel (Panel.tsx) puts each surface in a PaneFrame, which gives its head the surface's name,
  Full canvas and Close (Close hides the panel), and draws a plain head with the name alone until the
  surface draws its own PaneHead. Outside the panel (a popup, a page) there is no frame: PaneHead then
  draws no Full canvas and no Close unless it is handed `onClose`, so the same surface can be drawn in
  the panel, the full canvas and a popup.
*/
import { createContext, forwardRef, useContext, useLayoutEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "@liner/lib/hooks";
import { I } from "./icons";
import { Lines } from "./ui";
import "./pane.css";

/** What the panel tells a surface's head: its name, whether it fills the paper, and the panel's Full canvas and Close. */
type Frame = { name: string; full: boolean; onFull?: () => void; onClose?: () => void; claim: () => () => void };
const FrameCtx = createContext<Frame | null>(null);

/**
  The panel's frame round one surface (Panel.tsx uses it; a surface never does). Until the surface
  draws a PaneHead of its own, the frame draws one with the name alone, so every surface has a head
  with Full canvas and Close from the start.
*/
export function PaneFrame({ name, full, onFull, onClose, children }: { name: string; full: boolean; onFull?: () => void; onClose?: () => void; children: ReactNode }) {
  const [own, setOwn] = useState(0);
  const [claim] = useState(() => () => {
    setOwn((n) => n + 1);
    return () => setOwn((n) => n - 1);
  });
  return (
    <FrameCtx.Provider value={{ name, full, onFull, onClose, claim }}>
      {own === 0 && <HeadRow frame={{ name, full, onFull, onClose }} name={name} />}
      {children}
    </FrameCtx.Provider>
  );
}

/** Whether a surface is drawn in the panel (and over the whole paper), or somewhere else (a popup, a page). */
export function usePaneFrame() {
  const f = useContext(FrameCtx);
  return { inPanel: Boolean(f), full: f?.full ?? false, close: f?.onClose, toggleFull: f?.onFull };
}

/**
  A surface's head, 44px with a hairline under it, on the session header's row:
  - `name`: the surface's name (13.5px, 600). Left out, the panel's name for it.
  - `lead`: before the name, for a way back (one agent's back arrow).
  - `shows`: the one thing it shows: a picker (a Pop with triggerClass PANE_PICK), a field (PaneField),
    or a few quiet words (PaneWords).
  - `tools`: at most three icon buttons that act on the view (PaneTool, or a Pop with triggerClass PANE_TOOL).
  Then, a little apart, Full canvas and Close, which the panel gives it; `onClose` stands in for Close where
  there is no panel (a popup), and `canvas={false}` leaves Full canvas out. `closeLabel` is the Close's own
  name and tooltip where it hides something other than the panel ("Hide inspector (⌥⌘I)"). `hideName` keeps
  the name for a screen reader only, where what it shows already says it (the inspector's tabs).
*/
export function PaneHead({ name, lead, shows, tools, canvas = true, onClose, closeLabel, hideName }: { name?: ReactNode; lead?: ReactNode; shows?: ReactNode; tools?: ReactNode; canvas?: boolean; onClose?: () => void; closeLabel?: string; hideName?: boolean }) {
  const frame = useContext(FrameCtx);
  useLayoutEffect(() => frame?.claim(), [frame?.claim]);
  return <HeadRow frame={frame ? { ...frame, onFull: canvas ? frame.onFull : undefined, onClose: onClose ?? frame.onClose } : { name: "", full: false, onClose }} name={name ?? frame?.name ?? ""} lead={lead} shows={shows} tools={tools} closeLabel={closeLabel} hideName={hideName} />;
}

function HeadRow({ frame, name, lead, shows, tools, closeLabel = "Close the panel", hideName }: { frame: Omit<Frame, "claim">; name: ReactNode; lead?: ReactNode; shows?: ReactNode; tools?: ReactNode; closeLabel?: string; hideName?: boolean }) {
  const end = frame.onFull || frame.onClose;
  return (
    <div className="lc-pane-head">
      {lead}
      <h2 className={hideName ? "lc-pane-name l-sr-only" : "lc-pane-name"}>{name}</h2>
      {shows && <div className="lc-pane-shows">{shows}</div>}
      <span className="lc-grow" />
      {tools && <div className="lc-pane-tools">{tools}</div>}
      {end && (
        <div className="lc-pane-end">
          {frame.onFull && (
            <button type="button" className="lc-pane-tool l-focus" aria-label={frame.full ? "Leave the full canvas" : "Full canvas"} title={frame.full ? "Leave the full canvas" : "Full canvas"} aria-pressed={frame.full} onClick={frame.onFull}>
              {frame.full ? <I.shrink size={16} /> : <I.expand size={16} />}
            </button>
          )}
          {frame.onClose && (
            <button type="button" className="lc-pane-tool l-focus" aria-label={closeLabel} title={closeLabel} onClick={frame.onClose}>
              <I.close size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The class for a Pop that is one of a head's tools: `<Pop triggerClass={PANE_TOOL} menu trigger={<I.sliders size={16} />} …>`. */
export const PANE_TOOL = "lc-pane-tool";
/** The class for a Pop that is the head's picker ("Turn 2 of 2 ⌄", "#128 ⌄"): quiet 13px words and a small chevron. */
export const PANE_PICK = "lc-pane-pick";

/** One of a head's tools: a 28px icon button with its name for a screen reader and as its tooltip. `pressed` for a toggle (Files' "only changed files"). */
export function PaneTool({ label, icon, pressed, disabled, onClick }: { label: string; icon: ReactNode; pressed?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="lc-pane-tool l-focus" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}

/** Quiet words in the head or a foot ("2 files", "+12 −1", "Knows up to turn 4"). */
export const PaneWords = ({ children }: { children: ReactNode }) => <span className="lc-pane-words">{children}</span>;

/** A field in the head (Files' find, the Browser's address): 30px on a wash, a 10px corner, its icon then what it holds; it takes the room left. */
export const PaneField = ({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) => (
  <div className={cx("lc-pane-field", className)}>
    {icon}
    {children}
  </div>
);

/** What a surface shows under its head: a column that scrolls, no boxes, wells or tables. Its ref is the scroller, for a surface that scrolls to a row. */
export const PaneBody = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(function PaneBody({ children, className }, ref) {
  return (
    <div ref={ref} className={cx("lc-pane-body", className)}>
      {children}
    </div>
  );
});

/**
  A section of the body: its label (12.5px, 600, second ink) with a quiet `note` at its right end, then its
  rows. Every section after the first has an inset hairline over its label. Anything else (an aria-label, a
  data attribute a test or a style reads) goes on the section itself.
*/
export function PaneSection({ label, note, children, className, ...rest }: { label: ReactNode; note?: ReactNode; children?: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <section {...rest} className={cx("lc-pane-sec", className)}>
      <div className="lc-pane-lab">
        <span>{label}</span>
        {note !== undefined && note !== null && note !== false && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}

/**
  The inside of a body's row: a 14px icon, the words, and the value at the right end (`value`, in ink, or
  grey with `quiet`), with a › when it opens a menu or another place (`opens`). PaneRow draws it; a Pop
  that is a setting draws it as its trigger: `<Pop triggerClass={PANE_ROW} trigger={<PaneRowIn icon={…} value="Off" opens>Multi-agent</PaneRowIn>} …>`.
*/
export function PaneRowIn({ icon, value, quiet, opens, children }: { icon?: ReactNode; value?: ReactNode; quiet?: boolean; opens?: boolean; children: ReactNode }) {
  return (
    <>
      {icon && <span className="lc-pane-ri">{icon}</span>}
      <span className="lc-pane-rt">{children}</span>
      {(value !== undefined || opens) && (
        <span className="lc-pane-rv" data-quiet={quiet || undefined}>
          {value}
          {opens && <I.chevR size={14} />}
        </span>
      )}
    </>
  );
}
/** The class for a Pop drawn as a body's row (a setting): see PaneRowIn. */
export const PANE_ROW = "lc-pane-row";

/**
  A row of the body, 30px: a 14px icon, the words, the value at the right end, a › when it opens something.
  With `onClick` it is a button; without, a plain line. A setting is such a row, never a loose ghost button.
*/
export function PaneRow({ icon, value, quiet, opens, title, onClick, children }: { icon?: ReactNode; value?: ReactNode; quiet?: boolean; opens?: boolean; title?: string; onClick?: () => void; children: ReactNode }) {
  const inner = (
    <PaneRowIn icon={icon} value={value} quiet={quiet} opens={opens}>
      {children}
    </PaneRowIn>
  );
  return onClick ? (
    <button type="button" className="lc-pane-row l-focus" title={title} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="lc-pane-row" title={title}>
      {inner}
    </div>
  );
}

/** The letter a file's status is shown by, in its colour: M amber, A green, D red, the rest grey. */
export const PaneStatus = ({ status }: { status: string }) => (
  <span className="lc-pane-st" data-st={status} aria-label={STATUS_WORD[status] ?? status}>
    {status}
  </span>
);
const STATUS_WORD: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", U: "Untracked", "?": "Untracked" };

/**
  A file's own row, the same in Changes and Files: a strip tinted with the well, ruled above and below,
  36px in mono. `fold` puts a fold chevron first (Changes); then the status letter, the path (its folder
  grey, its name in ink), the lines, and at the right end the file's own actions (`children`: Open in
  your editor, a PaneCheck for Viewed, a `···`). `onOpen` makes the path a button (scroll to it, open it).
*/
export function PaneFile({ path, status, lines, fold, onOpen, children, className }: { path: string; status?: string; lines?: { added: number; removed: number }; fold?: { open: boolean; onToggle: () => void }; onOpen?: () => void; children?: ReactNode; className?: string }) {
  const cut = path.lastIndexOf("/") + 1;
  const words = (
    <span className="lc-pane-path" title={path}>
      <span className="lc-pane-dir">{path.slice(0, cut)}</span>
      <span>{path.slice(cut)}</span>
    </span>
  );
  return (
    <div className={cx("lc-pane-file", className)} data-open={fold ? fold.open || undefined : undefined}>
      {fold && (
        <button type="button" className="lc-pane-fold l-focus" aria-expanded={fold.open} aria-label={fold.open ? `Fold ${path}` : `Unfold ${path}`} onClick={fold.onToggle}>
          <I.chevD size={14} />
        </button>
      )}
      {status && <PaneStatus status={status} />}
      {onOpen ? (
        <button type="button" className="lc-pane-pathb l-focus" onClick={onOpen}>
          {words}
        </button>
      ) : (
        words
      )}
      {lines && (lines.added > 0 || lines.removed > 0) && <Lines {...lines} />}
      {children && <span className="lc-pane-fend">{children}</span>}
    </div>
  );
}

/** A bare tick box (Changes' Viewed): its name only in its tooltip and for a screen reader. */
export function PaneCheck({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="checkbox" className="lc-pane-check l-focus" aria-checked={checked} aria-label={label} title={label} onClick={() => onChange(!checked)}>
      {checked && <I.check size={12} />}
    </button>
  );
}

/**
  A surface's foot, 56px with a hairline over it, only when there is something to do: where things stand on
  the left (`say`), the buttons on the right (`children`, PaneButton), at most one of them ink, and last.
*/
export function PaneFoot({ say, children, className }: { say?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("lc-pane-foot", className)}>
      <span className="lc-pane-say">{say}</span>
      {children}
    </div>
  );
}

/** A foot's button, 30 high: quiet, or `ink` for the one action of the surface (white on dark, dark on light). */
export function PaneButton({ ink, icon, children, className, ...rest }: { ink?: boolean; icon?: ReactNode; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={cx("lc-pane-btn l-focus", className)} data-ink={ink || undefined}>
      {icon}
      {children}
    </button>
  );
}

/**
  The one empty or waiting state of every surface: centred, an icon, what is missing, a line on how to
  fill it, and at most one action. (Surfaces.tsx's SurfaceNote is this part.) `loading`: what it waits for
  is on its way ("Reading the findings"), so its title shimmers as the app's other waits do, with no icon.
*/
export function PaneNote({ icon, title, children, action, loading }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; loading?: boolean }) {
  return (
    <div className="lc-panel-empty" aria-busy={loading || undefined}>
      {!loading && icon}
      {loading ? <b className="l-shimmer">{title}</b> : <b>{title}</b>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
