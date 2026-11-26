/*
  The parts every face's sidebar list is made of (Code's sessions, Liner Design's designs, Liner
  Security's scans and fixes), so the three read as one: a heading with its one menu, a group's
  label, a folder that folds, and a two-line row with its mark.
  Liner 2.0: no borders, no fills, no dividers in the list; space and labels part the groups. In
  Design and Security a row reads left to right (Rows.dc.html): the mark in a 24px column, the title
  and the time since it last did something; under it what it does, how it ended or what it wants,
  and its facts at the line's end (SideFacts: its own worktree, who works on it, its pull request's
  number). The Wall's tiles take the same words (rowWords) and facts.
  Since 2026-11-26 (Capy's layout) every face's folders are `compact`: a group's header is one small
  grey line (the folder, its name, its count, a chevron while folded). Code's rows are `compact` too:
  the title with the mark at its end, and under it the words, the facts and the time.
  Styles: app.css, the block headed "The sidebar's list parts" (class prefix lc-sl-).

  Tints. A working mark is in the second ink whoever works (the state mark's choice B, board Marks,
  2026-11-25): `brand` is still passed through but no longer colours it, and `tint` (any CSS colour)
  does only where a holder's own colour says who it is.
  Action buttons in a row's `acts` or a folder's `actions`: use className "lc-sb-a l-focus" (24px in a row, 28px on a folder).
*/
import { forwardRef, useRef, useSyncExternalStore, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { Thread } from "@contracts";
import { cx } from "@liner/lib/hooks";
import { I, MARK_WORD, ModelMark, N, StateMark, type MarkKind } from "./icons";
import { clock, plural } from "./model";
import { Num, Pop } from "./ui";
import { askWords, prSaid, reviewHeld, type MarkState, type PrTone, type SideState } from "./session-state";

/**
  ↑ and ↓ in every face's list (.lc-sl-list): from a row or a folder's header to the next one as they
  show, so a folded folder is reached and opened from the keyboard too. A handler of the row's own
  that took the key first (it prevented it) has the say.
*/
export function listArrows(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented || e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  const stops = [...(e.currentTarget.closest(".lc-sl-list")?.querySelectorAll<HTMLElement>(".lc-sl-pick[tabindex]:not([tabindex='-1']), .lc-sl-fold-b") ?? [])];
  const to = stops[stops.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)];
  e.preventDefault();
  to?.focus();
}

export type { SideState } from "./session-state";

/**
  Whether this window is focused. The open session in a focused window is being looked at, so every face's list draws it as
  seen (session-state.ts, seenAsk and newsForYou), with no amber in its row, its folder or the pill.
*/
export function useWindowFocused() {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener("focus", f);
      window.addEventListener("blur", f);
      return () => {
        window.removeEventListener("focus", f);
        window.removeEventListener("blur", f);
      };
    },
    () => document.hasFocus(),
  );
}

/**
  A row's mark, in the 24px column: the state mark (icons.tsx StateMark) for how it stands. `state` is
  a mark's state or a row's (session-state.ts SideState: limited and error draw as limit and
  problem). Each keeps its words for a screen reader (`label` says something else, as a folded
  folder's "One of its sessions is working"). A working mark is never tinted by its model (SPEC rule 7):
  `tint` and `brand` are taken for the other states only, so callers need not tell them apart.
*/
export function SideMark({ state, tint, brand, label, size }: { state: SideState | MarkState; tint?: string; brand?: MarkKind; label?: string; size?: number }) {
  const s: MarkState = state === "limited" ? "limit" : state === "error" ? "problem" : state;
  const working = s === "working";
  return <StateMark state={s} size={size} tint={working ? undefined : tint} brand={working ? undefined : brand} label={label ?? MARK_WORD[s]} />;
}

/**
  The heading over a face's list: its name, then (in grey) another view's name and how many it
  holds, and at the right the one button that opens its menu: what the list shows, how it's sorted,
  and what you add to it. `children` are the menu's rows, given `close` as Pop gives it. With
  `onFilter` a Filter button comes before it, for a field that narrows the list (`filtering`
  while that field is open).
*/
export function SideHead({ title, note, count, menuLabel, onFilter, filtering, children }: { title: string; note?: ReactNode; count?: number; menuLabel: string; onFilter?: () => void; filtering?: boolean; children: (close: () => void) => ReactNode }) {
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
      {onFilter && (
        // Pressed down, it keeps the focus off the field, so the field's own close on blur doesn't run before this press shuts it.
        <button type="button" className="lc-ib lc-sl-head-b l-focus" data-filter aria-label="Filter the list" title="Filter the list" aria-pressed={Boolean(filtering)} onMouseDown={(e) => e.preventDefault()} onClick={onFilter}>
          <N.search size={14} />
        </button>
      )}
      {/* The ··· drawn on the navigation grid, so it weighs what the Filter beside it does. */}
      <Pop label={menuLabel} menu align="end" width={236} triggerClass="lc-ib lc-sl-head-b" trigger={<N.more size={14} />}>
        {(close) => <div className="lc-sb-menu lc-sl-menu">{children(close)}</div>}
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
  its rows. Folded, its end says what hides in it: the needs mark when a session needs you, the
  working mark when one works, then how many; open, its rows say it themselves, so the end is empty.
  `actions` take the end's place while you point at it.
  `compact` (Code's sidebar): one small grey line, the icon at 12, then the name with its count
  always right after it, then the chevron, and folded, a small mark for what waits or works in it.
*/
export function SideFolder({ name, count, open, onToggle, needs, working, tint, brand, icon, actions, onContextMenu, what = "sessions", compact, children }: {
  name: string; count: number; open: boolean; onToggle: () => void; needs?: boolean; working?: boolean; tint?: string; brand?: MarkKind; icon?: ReactNode; actions?: ReactNode;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  /** What it holds, for its tooltip: "Fold its sessions", "Show its designs". */
  what?: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="lc-sl-folder" aria-label={name} data-compact={compact || undefined}>
      <div className="lc-sl-fold" data-acts={actions ? "" : undefined} onContextMenu={onContextMenu}>
        {compact ? (
          <button type="button" className="lc-sl-fold-b l-focus" aria-expanded={open} title={open ? `Fold its ${what}` : `Show its ${what}`} onClick={onToggle} onKeyDown={listArrows}>
            <span className="lc-sl-fold-i">{icon ?? <I.folder size={12} />}</span>
            <span className="lc-sl-fold-n">
              <span>{name}</span>
            </span>
            <span className="lc-sl-count">
              <Num value={count} />
            </span>
            <I.chevR size={12} />
            {/* One small mark, the one that matters more: something waiting on you before something at work. */}
            {!open && needs && <SideMark state="needs" size={12} label={`One of its ${what} needs you`} />}
            {!open && !needs && working && <SideMark state="working" size={12} tint={tint} brand={brand} label={`One of its ${what} is working`} />}
          </button>
        ) : (
        <button type="button" className="lc-sl-fold-b l-focus" aria-expanded={open} title={open ? `Fold its ${what}` : `Show its ${what}`} onClick={onToggle} onKeyDown={listArrows}>
          <span className="lc-sl-fold-i">{icon ?? <I.folder size={16} />}</span>
          <span className="lc-sl-fold-n">
            <span>{name}</span>
            <I.chevR size={12} />
          </span>
          <span className="lc-sl-fold-end">
            {!open && needs && <SideMark state="needs" label={`One of its ${what} needs you`} />}
            {!open && working && <SideMark state="working" tint={tint} brand={brand} label={`One of its ${what} is working`} />}
            {!open && (
              <span className="lc-sl-count">
                <Num value={count} />
              </span>
            )}
          </span>
        </button>
        )}
        {actions && <span className="lc-sl-acts">{actions}</span>}
      </div>
      {open && children}
    </section>
  );
}

type SideRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  mark: ReactNode;
  title: ReactNode;
  /** The time since it last did something, at the title's end, or with `compact` at the second line's end ("now", "2m", "2h", a day, a date: model.ts ago). */
  ago?: string;
  sub?: string;
  /** The second line's colour: amber, red, or `strong`, a step darker than grey for something left for you (files to review). */
  tone?: "warn" | "danger" | "strong";
  /** Where it is, when no folder over the row says it (By status, Pinned, a group): a small folder and the project's name start the second line, before " · " and `sub`. */
  where?: string;
  /** Its facts, small and grey at the second line's end (SideFacts). They never wrap: the words give way. Never a state: the mark says that. */
  facts?: ReactNode;
  /** The open one: a small card, its title in full ink. Say it to a screen reader too (aria-current, aria-selected) in the root's props. */
  current?: boolean;
  /** Finished: the title steps back to the second ink, unless it's the open one. */
  quiet?: boolean;
  /** The title takes two lines and is never cut (Liner Security: no line ends in "…"). */
  wrap?: boolean;
  /** What sits at the title's end while you point at the row or it has the keyboard, in the time's place (with `compact`, the mark's): 24px buttons (Code's Settle, Archive and ···; one where a row has one, a close cross, an Archive). It sits outside `pick`, so no button is inside another. */
  acts?: ReactNode;
  /** Props for the part that holds the mark and the words: give it the row's own control (role, tabIndex, onClick, onKeyDown) when the row has `acts`. */
  pick?: HTMLAttributes<HTMLDivElement>;
  /** Anything more, laid over the row (a session's forks toggle). */
  children?: ReactNode;
  /** Code's sidebar (Capy's layout): the title in the second ink with the mark at its end, and the time at the second line's end after the facts. */
  compact?: boolean;
  /** With `compact`: it waits on you or has news you haven't seen, so its title is in full ink like the open one's. */
  loud?: boolean;
};

/**
  A row in the list, two lines and 44px high: the mark level with the title, the title at 13.5 in
  ink with the time at its end, and under it what it is doing now, how it ended or what it wants,
  with its facts at the line's end. The open one (`current`) is a small card (app.css). Its root
  takes a ref and any props (drag, a context menu, a hover card); its words are in `pick`.
*/
export const SideRow = forwardRef<HTMLDivElement, SideRowProps>(function SideRow({ mark, title, ago, sub, tone, where, facts, current, quiet, wrap, acts, pick, compact, loud, children, className, ...rest }, ref) {
  const words = where ? (sub ? `${where} · ${sub}` : where) : sub;
  // The second line is drawn anew when it says something else ("Reading a.ts", then "Running npm test"), so the new words fade in
  // over the old one's place; a line other than the one the row came with is a swap, which fades even where the row came without its fade (data-fresh, app.css).
  const first = useRef(words);
  const second = words && (
    <span key={words} className="lc-sl-sub" data-tone={tone} data-swap={words !== first.current || undefined}>
      {where && <I.folder size={12} />}
      <span className="lc-sl-words">{words}</span>
    </span>
  );
  if (compact)
    return (
      <div ref={ref} {...rest} className={cx("lc-sl-row", className)} data-compact data-current={current || undefined} data-loud={loud || undefined} data-quiet={quiet || undefined}>
        <div {...pick} className={cx("lc-sl-pick", pick?.className)} onKeyDown={(e) => (pick?.onKeyDown?.(e), listArrows(e))}>
          <span className="lc-sl-title">{title}</span>
          <span className="lc-sl-mark">{mark}</span>
          {(words || facts || ago) && (
            <span className="lc-sl-l2">
              {second}
              {facts && <span className="lc-sl-facts">{facts}</span>}
              {ago && <span className="lc-sl-ago">{ago}</span>}
            </span>
          )}
        </div>
        {acts && <span className="lc-sl-acts">{acts}</span>}
        {children}
      </div>
    );
  return (
    <div ref={ref} {...rest} className={cx("lc-sl-row", className)} data-current={current || undefined} data-quiet={quiet || undefined} data-wrap={wrap || undefined}>
      <div {...pick} className={cx("lc-sl-pick", pick?.className)} onKeyDown={(e) => (pick?.onKeyDown?.(e), listArrows(e))}>
        <span className="lc-sl-mark">{mark}</span>
        <span className="lc-sl-title">{title}</span>
        {ago && <span className="lc-sl-ago">{ago}</span>}
        {(words || facts) && (
          <span className="lc-sl-l2">
            {second}
            {facts && <span className="lc-sl-facts">{facts}</span>}
          </span>
        )}
      </div>
      {acts && <span className="lc-sl-acts">{acts}</span>}
      {children}
    </div>
  );
});

/**
  A row's facts, in this order and each only when it applies: the branch mark when it works in a
  worktree of its own (its name in the tooltip), the mark of the model that works on it (a pair's
  lead), and its pull request's number in mono, coloured by how it stands (PrTone). Bare marks, no
  tiles. A session carries one pull request (Thread.pr), so the drawing's "+1" has nothing to
  count yet.
*/
export function SideFacts({ branch, model, modelName, pr }: { branch?: string; model?: MarkKind; modelName?: string; pr?: { number: number; tone: PrTone; said: string } }) {
  if (!branch && !model && !pr) return null;
  return (
    <>
      {branch && (
        <span className="lc-sl-fact" role="img" aria-label={`In its own worktree, on ${branch}`} title={`In its own worktree, on ${branch}`}>
          <I.branch size={14} />
        </span>
      )}
      {model && (
        <span className="lc-sl-fact" role="img" aria-label={modelName ? `On ${modelName}` : "Its model"}>
          <ModelMark kind={model} size={12} />
        </span>
      )}
      {pr && (
        <span className="lc-sl-pr" data-s={pr.tone} aria-label={`Pull request #${pr.number}, ${pr.said.toLowerCase()}`}>
          #{pr.number}
        </span>
      )}
    </>
  );
}

/**
  A session's second line, the same in every list and on The Wall: what it is doing while it works
  (the engine's Thread.doing, the agents it sent after it), else how it stands or ended, the first
  that applies: the Reviewer's block, what it waits on you for in its own words (askWords: amber
  until you open it, `seenQ`), a problem, its plan's limit, a snooze, not started, its pull request
  (prSaid), changes left to review (a step darker), else Finished. The time is the row's own (at
  the title's end, or the second line's end in Code), so it is never said here. `asks`: the words are its question, which matters
  more than where it is (a row's `where` steps aside for it).
*/
export function rowWords(t: Thread, o: { busy: boolean; agents?: number; seenQ?: boolean; snoozed?: boolean; now?: number }): { text: string; tone?: "warn" | "danger" | "strong"; asks?: boolean } {
  const agents = o.agents ?? 0;
  if (o.busy) {
    const doing = t.status === "running" ? t.doing?.text || "Working" : "Working";
    // The engine's own line for sending agents ("Sending an agent"): only how many are at work, not the same word twice.
    if (agents > 0 && doing.startsWith("Sending an agent")) return { text: `${plural(agents, "agent")} at work` };
    return { text: agents > 0 ? `${doing} · ${plural(agents, "agent")}` : doing };
  }
  if (reviewHeld(t)) return { text: "Reviewer blocked it" };
  if (t.status === "waiting") return { text: askWords(t), tone: o.seenQ ? undefined : "warn", asks: true };
  if (t.status === "error") return { text: "Ran into a problem", tone: "danger" };
  if (t.status === "limited") return { text: `Hit its plan's limit${t.limit?.until ? `, back at ${clock(t.limit.until, o.now)}` : ""}`, tone: "warn" };
  if (o.snoozed) {
    if (t.wake) return { text: t.wake.kind === "checks" ? `Until #${t.wake.pr}'s checks finish` : `Until a reply on #${t.wake.pr}` };
    if (t.snoozedUntil) return { text: `Until ${clock(t.snoozedUntil, o.now)}` };
  }
  if (t.turns === 0) return { text: "Not started" };
  if (t.pr) {
    const pr = prSaid(t.pr);
    return { text: pr.text, tone: pr.tone };
  }
  if ((t.toReview ?? 0) > 0) return { text: `${plural(t.toReview!, "file")} to review`, tone: "strong" };
  return { text: "Finished" };
}
