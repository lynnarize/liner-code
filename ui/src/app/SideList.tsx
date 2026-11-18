/*
  The parts every face's sidebar list is made of (Code's sessions, Liner Design's designs, Liner
  Security's scans and fixes), so the three read as one: a heading with its one menu, a group's
  label, a folder that folds, a two-line row with its mark, and the counts pill in the top row.
  Liner 2.0: no borders, no fills, no dividers in the list; space and labels part the groups. The
  rows sit on the places' grid: a 24px mark column under their icons, the words on their text edge.
  Styles: app.css, the block headed "The sidebar's list parts" (class prefix lc-sl-).

  Tints. A working mark's spinner takes `tint` (any CSS colour) when it is given; otherwise `brand`
  (a model's MarkKind, as markOf gives it) colours it the way .lc-mk[data-s="run"][data-brand] does,
  so a session's spinner is in its model's colour without a second list of colours here.
  Action buttons in a row's `acts` or a folder's `actions`: use className "lc-sb-a l-focus" (22px).
*/
import { forwardRef, type CSSProperties, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { cx } from "@liner/lib/hooks";
import { I, Spinner, wt, type MarkKind } from "./icons";
import { Num, Pop } from "./ui";

/** How a row stands, as its mark shows it. */
export type SideState = "working" | "needs" | "limited" | "error" | "done" | "new";

const tinted = (tint?: string): CSSProperties | undefined => (tint ? { color: tint } : undefined);

/**
  A row's mark, in the 24px column: the spinner while it works (in the agent's tint), the amber dot
  with its halo when it needs you, the clock when its plan's limit stopped it, the error mark, a
  small grey dot when it's done, the hollow ring before it starts. Each keeps its words for a screen
  reader (`label` says something else, as a folded folder's "A session here is working").
*/
export function SideMark({ state, tint, brand, label }: { state: SideState; tint?: string; brand?: MarkKind; label?: string }) {
  if (state === "working")
    return (
      <span className="lc-mk" role="img" data-s="run" data-brand={brand} aria-label={label ?? "Working"} style={tinted(tint)}>
        <Spinner size={14} />
      </span>
    );
  if (state === "needs")
    return (
      <span className="lc-mk" role="img" data-s="needs" aria-label={label ?? "Needs you"}>
        <i />
      </span>
    );
  if (state === "limited")
    return (
      <span className="lc-mk" role="img" data-s="needs" aria-label={label ?? "Limited"}>
        <I.clock size={14} />
      </span>
    );
  if (state === "error")
    return (
      <span className="lc-mk" role="img" data-s="error" aria-label={label ?? "Ran into a problem"}>
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={wt(14, 16, 1.6)} strokeLinecap="round" aria-hidden>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 5.1v3.4M8 10.9v.01" />
        </svg>
      </span>
    );
  if (state === "new")
    return (
      <span className="lc-mk" role="img" data-s="new" aria-label={label ?? "Not started"}>
        <i />
      </span>
    );
  return (
    <span className="lc-mk lc-sl-dot" role="img" data-s="done" aria-label={label ?? "Done"}>
      <i />
    </span>
  );
}

/**
  The heading over a face's list: its name, then (in grey) another view's name and how many it
  holds, and at the right the one button that opens its menu: what the list shows, how it's sorted,
  and what you add to it. `children` are the menu's rows, given `close` as Pop gives it.
*/
export function SideHead({ title, note, count, menuLabel, children }: { title: string; note?: ReactNode; count?: number; menuLabel: string; children: (close: () => void) => ReactNode }) {
  return (
    <div className="lc-sl-head">
      <h2>{title}</h2>
      {note && <span className="lc-sl-head-note">{note}</span>}
      {count !== undefined && (
        <span className="lc-sl-count">
          <Num value={count} />
        </span>
      )}
      <span className="lc-grow" />
      <Pop label={menuLabel} menu align="end" width={236} triggerClass="lc-ib lc-sl-head-b" trigger={<I.sliders size={16} />}>
        {(close) => <div className="lc-sb-menu">{children(close)}</div>}
      </Pop>
    </div>
  );
}

/** A group's label in the list: its name in grey on the places' edge, how many right after it, an icon before it (Pinned's pin) and something at its end (a + menu). */
export function SideLabel({ name, count, icon, end }: { name: ReactNode; count?: number; icon?: ReactNode; end?: ReactNode }) {
  return (
    <div className="lc-sl-label">
      {icon && <span className="lc-sl-label-i">{icon}</span>}
      <span className="lc-sl-label-n">{name}</span>
      {count !== undefined && (
        <span className="lc-sl-count">
          <Num value={count} />
        </span>
      )}
      {end && <span className="lc-sl-label-end">{end}</span>}
    </div>
  );
}

/**
  A folder in the list: its header (the folder in the mark column, the name, a chevron that comes
  when you point at it or it has the keyboard, and stays while it's folded) and, while it's open,
  its rows. Folded, its end says what hides in it: the amber dot when a session needs you, the
  spinner when one works, then how many. `actions` take the end's place while you point at it.
*/
export function SideFolder({ name, count, open, onToggle, needs, working, tint, brand, icon, actions, onContextMenu, what = "sessions", children }: {
  name: string; count: number; open: boolean; onToggle: () => void; needs?: boolean; working?: boolean; tint?: string; brand?: MarkKind; icon?: ReactNode; actions?: ReactNode;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  /** What it holds, for its tooltip: "Fold its sessions", "Show its designs". */
  what?: string;
  children?: ReactNode;
}) {
  return (
    <section className="lc-sl-folder" aria-label={name}>
      <div className="lc-sl-fold" data-acts={actions ? "" : undefined} onContextMenu={onContextMenu}>
        <button type="button" className="lc-sl-fold-b l-focus" aria-expanded={open} title={open ? `Fold its ${what}` : `Show its ${what}`} onClick={onToggle}>
          <span className="lc-sl-fold-i">{icon ?? <I.folder size={16} />}</span>
          <span className="lc-sl-fold-n">
            <span>{name}</span>
            <I.chevR size={12} />
          </span>
          <span className="lc-sl-fold-end">
            {!open && needs && <span className="lc-sl-ndot" role="img" aria-label="A session here needs you" />}
            {!open && working && <SideMark state="working" tint={tint} brand={brand} label="A session here is working" />}
            <span className="lc-sl-count">
              <Num value={count} />
            </span>
          </span>
        </button>
        {actions && <span className="lc-sl-acts">{actions}</span>}
      </div>
      {open && children}
    </section>
  );
}

type SideRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  mark: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  tone?: "warn" | "danger";
  /** A 20px slot at the row's end, vertically centred: a pull request's mark, changes to review. */
  end?: ReactNode;
  /** The open one: on the plate, its title in full ink. Say it to a screen reader too (aria-current, aria-selected) in the root's props. */
  current?: boolean;
  /** Finished: the title steps back to the second ink, unless it's the open one. */
  quiet?: boolean;
  /** The title takes two lines and is never cut (Liner Security: no line ends in "…"). */
  wrap?: boolean;
  /** Buttons that take the end's place while you point at the row or it has the keyboard (Pin, Snooze, Settle; a close cross). They sit outside `pick`, so no button is inside another. */
  acts?: ReactNode;
  /** Props for the part that holds the mark and the words: give it the row's own control (role, tabIndex, onClick, onKeyDown) when the row has `acts`. */
  pick?: HTMLAttributes<HTMLDivElement>;
  /** Anything more, laid over the row (a session's forks toggle). */
  children?: ReactNode;
};

/**
  A row in the list, two lines and 44px high: the mark level with the title, the title at 13.5 in
  ink, under it what it is doing now or how it ended, and a 20px end. Its root takes a ref and any
  props (drag, a context menu, a hover card); its words are in `pick`.
*/
export const SideRow = forwardRef<HTMLDivElement, SideRowProps>(function SideRow({ mark, title, sub, tone, end, current, quiet, wrap, acts, pick, children, className, ...rest }, ref) {
  return (
    <div ref={ref} {...rest} className={cx("lc-sl-row", className)} data-current={current || undefined} data-quiet={quiet || undefined} data-wrap={wrap || undefined}>
      <div {...pick} className={cx("lc-sl-pick", pick?.className)}>
        <span className="lc-sl-mark">{mark}</span>
        <span className="lc-sl-title">{title}</span>
        {sub !== undefined && sub !== null && sub !== "" && (
          <span className="lc-sl-sub" data-tone={tone}>
            {sub}
          </span>
        )}
        {end && <span className="lc-sl-end">{end}</span>}
      </div>
      {acts && <span className="lc-sl-acts">{acts}</span>}
      {children}
    </div>
  );
});

/**
  The top row's counts, at its far right: the spinner and how many sessions work, then the amber dot
  and how many wait on you, each only while it's above nought; with both at nought, nothing. It
  opens The Wall.
*/
export function SideCounts({ working, waiting, tint, brand, onOpen }: { working: number; waiting: number; tint?: string; brand?: MarkKind; onOpen: () => void }) {
  if (working <= 0 && waiting <= 0) return null;
  const says = [working > 0 ? `${working} working` : "", waiting > 0 ? `${waiting} waiting on you` : ""].filter(Boolean).join(", ");
  return (
    <button type="button" className="lc-sl-counts l-focus" aria-label={`${says}. Open The Wall`} title="The Wall: every session at once" onClick={onOpen}>
      {working > 0 && (
        <>
          <span className="lc-mk" data-s="run" data-brand={brand} style={tinted(tint)} aria-hidden>
            <Spinner size={14} />
          </span>
          <Num value={working} />
        </>
      )}
      {waiting > 0 && (
        <>
          <span className="lc-sl-counts-dot" aria-hidden />
          <Num value={waiting} />
        </>
      )}
    </button>
  );
}
