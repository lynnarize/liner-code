/*
  The rows every Settings page is made of, so a page written in another file (Source control, Liner MCP) reads as the
  rest do: a 15px title over each group, the group a bordered card, and in it rows of a name, one line on why, and one
  control at the right end. A row can open sub-rows under it (RowMore), and a thing found on this Mac (Git, gh, a
  tunnel) leads its row with a small tile and a dot that says whether it is there (HostTile). The look is in
  settings.css and app.css (.lc-st-*); Settings.tsx uses these same parts.
*/
import type { ReactNode } from "react";

/**
  A titled group of rows on a card. `end` sits at the right of the title (a Look again, a count); `note` is one quiet
  line under the title; `anchor` names it, so Settings can open a place at this group (an old place that moved here).
  `flush` drops the card's side padding, for a list that draws its own; `bare` drops the card, for cards of their own
  (the modes' grid).
*/
export function Section({ title, tag, note, end, anchor, flush, bare, children }: { title: string; tag?: ReactNode; note?: ReactNode; end?: ReactNode; anchor?: string; flush?: boolean; bare?: boolean; children: ReactNode }) {
  return (
    <section className="lc-st-group" data-anchor={anchor}>
      <header>
        <span>
          <h2 data-title={title}>
            {title}
            {tag}
          </h2>
          {note && <p>{note}</p>}
        </span>
        {end}
      </header>
      {bare ? (
        children
      ) : (
        <div className="lc-st-card" data-flush={flush || undefined}>
          {children}
        </div>
      )}
    </section>
  );
}

/**
  One setting: its name, one line on why, and its control at the right end. `lead` goes before the words (a mark, a
  HostTile); `below` puts the control under the words, for one too wide to sit beside them (pictures, a list); `off`
  quiets a row that doesn't apply now.
*/
export function Row({ title, note, lead, below, off, children }: { title: ReactNode; note?: ReactNode; lead?: ReactNode; below?: boolean; off?: boolean; children?: ReactNode }) {
  return (
    <div className="lc-st-row" data-below={below || undefined} data-off={off || undefined}>
      {lead && <span className="lc-st-lead">{lead}</span>}
      <span className="lc-st-t">
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      {children && <span className="lc-st-c">{children}</span>}
    </div>
  );
}

/** What a row holds when it is opened: quieter sub-rows under it, set in line with its words. Put SubRows (or anything) in it, right after the Row. */
export function RowMore({ children, lead = true }: { children: ReactNode; lead?: boolean }) {
  return (
    <div className="lc-st-more" data-lead={lead || undefined}>
      {children}
    </div>
  );
}

/** One line in a RowMore: a name on the left, its value or a small control on the right. */
export function SubRow({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="lc-st-sub">
      <span className="lc-st-sub-t">{title}</span>
      {children && <span className="lc-st-sub-v">{children}</span>}
    </div>
  );
}

/**
  A logo on a small tile, for a row about something found on this Mac or an app outside: a green dot when it is there
  and working (`on`), a grey one when it isn't, none when `on` is left out.
*/
export function HostTile({ children, on, label }: { children: ReactNode; on?: boolean; label?: string }) {
  return (
    <span className="lc-st-tile" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {children}
      {on !== undefined && <i className="lc-st-dot" data-on={on || undefined} />}
    </span>
  );
}

/** A small tag beside a name or a title: "New" in the accent's tint, "In use" in green, a warning in amber, else grey. */
export function Tag({ tone, children }: { tone?: "new" | "ok" | "warn"; children: ReactNode }) {
  return (
    <span className="lc-st-tag" data-tone={tone}>
      {children}
    </span>
  );
}

/** A version or a command in a row's name or line, in mono and quiet. */
export function Mono({ children }: { children: ReactNode }) {
  return <code className="lc-st-code">{children}</code>;
}
