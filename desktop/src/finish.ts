/*
  "Quit when they finish": the app goes out of sight and quits by itself once no session works.
  The engine stays a child of the app (its token and keys come over stdin, and it stops when that
  pipe closes), so the app can't leave and let the work go on; it waits instead, with only the
  menu bar item showing. This is the deciding part, kept apart from Electron so it can be tested:
  main.ts reads the engine's sessions every few seconds and asks it what to do.

  T3 Code has no such choice (apps/desktop/src/app/DesktopLifecycle.ts only holds or allows a quit);
  this follows its rule that the quit goes through the normal before-quit path.
*/

/** What the engine's state.get says of a session, as much as this needs. */
export type Live = { id: string; title: string; status: string; archived?: boolean; agentsAtWork?: number };
type Session = { id: string; title: string };
/** What still keeps the app: sessions with a turn or agents going, and sessions that wait on you. */
export type Left = { working: Session[]; waiting: Session[] };
export type Reading = { left: Left; quit: boolean; tell: Session[] };

/** The kinds of ask that hold a turn open until you answer (the same three runtime.ts looks for). */
const ASKS = new Set(["approval", "question", "proposal"]);
/** Whether a session's timeline has a request still open: then its "waiting" is a live turn, not an old one. */
export const openAsk = (items: unknown) => Array.isArray(items) && items.some((i) => i && typeof i === "object" && ASKS.has((i as { kind?: string }).kind ?? "") && (i as { state?: string }).state === "asking");

/** How long nothing may work before the app quits: a turn's end can start the next (a queued message, a review) a moment later. */
export const SETTLE_MS = 2500;
/** A notice the page already gave about a session counts for this long, so the same news doesn't come twice. */
const HEARD_MS = 20_000;

export class QuitWhenDone {
  /**
    The sessions this quit waits for: those working when it was asked, those that start while it
    waits, and those that were already waiting on a live request. A session in "waiting" for days
    (a review that blocked, a plan nobody answered) isn't among them, or the app would never quit.
  */
  private readonly watched = new Set<string>();
  /** Waiting sessions already looked at for an open request, either way. */
  private readonly checked = new Set<string>();
  /** Sessions the notice "needs you before Liner Code can quit" was due for, once each, and when it went out. */
  private readonly told = new Map<string, number>();
  /** When the page last sent a notice about a session (its own "needs you"). */
  private readonly heardAt = new Map<string, number>();
  private quietSince: number | undefined;
  private readonly settle: number;

  constructor(settle = SETTLE_MS) {
    this.settle = settle;
  }

  /** Waiting sessions not yet known to hold a live request: main.ts reads their timelines and says (mark). */
  toCheck(threads: Live[]) {
    return threads.filter((t) => !t.archived && t.status === "waiting" && !this.watched.has(t.id) && !this.checked.has(t.id)).map((t) => t.id);
  }

  mark(id: string, open: boolean) {
    this.checked.add(id);
    if (open) this.watched.add(id);
  }

  /** The page sent a notice about this session (the shell shows it); one of ours about it would say the same. */
  heard(id: string, now: number) {
    this.heardAt.set(id, now);
  }

  /** Whether a notice about this session went out from here a moment ago, so the page's needn't say the same. */
  toldLately(id: string, now: number) {
    return now - (this.told.get(id) ?? -Infinity) < HEARD_MS;
  }

  /** What the engine says now, and what to do: wait (and what for), quit, and whom to tell they're waited on. */
  read(threads: Live[], now: number): Reading {
    const live = threads.filter((t) => !t.archived);
    const working = live.filter((t) => t.status === "running" || (t.agentsAtWork ?? 0) > 0);
    for (const t of working) this.watched.add(t.id);
    const busy = new Set(working.map((t) => t.id));
    const waiting = live.filter((t) => t.status === "waiting" && !busy.has(t.id) && this.watched.has(t.id));
    const tell = waiting.filter((t) => !this.told.has(t.id) && now - (this.heardAt.get(t.id) ?? -Infinity) > HEARD_MS);
    for (const t of tell) this.told.set(t.id, now);
    // One the page told of is done with too: it isn't told again later.
    for (const t of waiting) if (!this.told.has(t.id)) this.told.set(t.id, -Infinity);
    const pick = (t: Live) => ({ id: t.id, title: t.title });
    const left = { working: working.map(pick), waiting: waiting.map(pick) };
    if (working.length || waiting.length) {
      this.quietSince = undefined;
      return { left, quit: false, tell: tell.map(pick) };
    }
    this.quietSince ??= now;
    return { left, quit: now - this.quietSince >= this.settle, tell: [] };
  }
}

/** The menu bar item's first line while the app waits to quit. */
export function waitLine(left: Left) {
  const n = left.working.length + left.waiting.length;
  if (!n) return "Quitting in a moment";
  return n === 1 ? "Quits when the session finishes" : `Quits when ${n} sessions finish`;
}
