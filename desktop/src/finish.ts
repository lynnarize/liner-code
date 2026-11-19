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
/**
  Whether a session's timeline has a request still open that a quit would end: then its "waiting" is a live turn, not an old
  one. An approval or a plan still asking always is. A question is only while its turn still runs: the engine keeps a question
  across a quit (your answer goes as the next message), so one left from an earlier run, or from a turn that has ended, loses
  nothing to a quit and must not hold one for good. With no turn marker to read (a partial timeline), a question counts.
*/
export const openAsk = (items: unknown) => {
  if (!Array.isArray(items)) return false;
  const of = (i: unknown) => (i && typeof i === "object" ? (i as { kind?: string; state?: string; status?: string }) : {});
  const asking = items.map(of).filter((i) => ASKS.has(i.kind ?? "") && i.state === "asking");
  if (!asking.length) return false;
  if (asking.some((i) => i.kind !== "question")) return true;
  const last = items.map(of).findLast((i) => i.kind === "turn");
  return last ? last.status === "running" : true;
};

/** How long nothing may work before the app quits: a turn's end can start the next (a queued message, a review) a moment later. */
export const SETTLE_MS = 2500;
/** A notice the page already gave about a session counts for this long, so the same news doesn't come twice. */
const HEARD_MS = 20_000;
/**
  How long the engine may go without answering (each look times out, or finds nothing listening) before the quit goes ahead,
  counted in time the Mac was awake. Work is known to run only from its answers: an engine that has said nothing for a minute
  is stuck or gone, its turns can't be saved or finished through it, and the app would otherwise wait out of sight for ever.
  Quitting takes the normal path, which asks it to save and stop.
*/
export const SILENT_MS = 60_000;
/** And at least this many looks in a row unanswered, each one a real try: one slow moment isn't silence. */
export const SILENT_LOOKS = 8;
/**
  Two looks further apart than this weren't a minute of silence but a sleep (main.ts looks every few seconds, each held to a
  few more): the count starts again from the look after it, since an engine just woken may take a moment to answer.
*/
export const SLEEP_GAP_MS = 30_000;

export class QuitWhenDone {
  /**
    The sessions this quit waits for: those working when it was asked, those that start while it
    waits, and those that were already waiting on a live request. A session in "waiting" for days
    (a review that blocked, a plan nobody answered) isn't among them, or the app would never quit.
  */
  private readonly watched = new Set<string>();
  /** Waiting sessions already looked at for an open request, either way. */
  private readonly checked = new Set<string>();
  /** Waiting sessions whose timeline didn't come in time: held, as if their request were open, and looked at again next time. */
  private readonly unsure = new Set<string>();
  /** Sessions the notice "needs you before Liner Code can quit" was due for, once each, and when it went out. */
  private readonly told = new Map<string, number>();
  /** When the page last sent a notice about a session (its own "needs you"). */
  private readonly heardAt = new Map<string, number>();
  private quietSince: number | undefined;
  /** The looks unanswered in a row since the engine last answered, the awake time they span, and when the last one was. */
  private silence: { looks: number; awake: number; last: number } | undefined;
  private readonly settle: number;
  private readonly silent: number;

  constructor(settle = SETTLE_MS, silent = SILENT_MS) {
    this.settle = settle;
    this.silent = silent;
  }

  /**
    A look the engine didn't answer at all (it timed out, or nothing was listening): whether it has now been silent long
    enough to quit, SILENT_LOOKS looks in a row over SILENT_MS of time awake. A gap longer than SLEEP_GAP_MS between two looks
    is a sleep, not silence: the count starts again. Any answer, even one that says no, is the engine there (answered).
  */
  unanswered(now: number) {
    const s = this.silence;
    if (!s || now - s.last > SLEEP_GAP_MS || now < s.last) this.silence = { looks: 1, awake: 0, last: now };
    else this.silence = { looks: s.looks + 1, awake: s.awake + (now - s.last), last: now };
    return this.silence.looks >= SILENT_LOOKS && this.silence.awake >= this.silent;
  }

  /** The engine answered (an error of its own included): it's there, so whatever it said, its silence is over. */
  answered() {
    this.silence = undefined;
  }

  /** Waiting sessions not yet known to hold a live request: main.ts reads their timelines and says (mark). */
  toCheck(threads: Live[]) {
    return threads.filter((t) => !t.archived && t.status === "waiting" && !this.watched.has(t.id) && !this.checked.has(t.id)).map((t) => t.id);
  }

  /** What a waiting session's timeline said: a request open or not, or undefined when it couldn't be read (held until it can). */
  mark(id: string, open: boolean | undefined) {
    if (open === undefined) {
      this.unsure.add(id);
      return;
    }
    this.unsure.delete(id);
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
    this.answered();
    const live = threads.filter((t) => !t.archived);
    const working = live.filter((t) => t.status === "running" || (t.agentsAtWork ?? 0) > 0);
    for (const t of working) this.watched.add(t.id);
    const busy = new Set(working.map((t) => t.id));
    const waiting = live.filter((t) => t.status === "waiting" && !busy.has(t.id) && (this.watched.has(t.id) || this.unsure.has(t.id)));
    // Told of only once it's known to wait on you: one whose timeline didn't come in time is held, not told of.
    const tell = waiting.filter((t) => this.watched.has(t.id) && !this.told.has(t.id) && now - (this.heardAt.get(t.id) ?? -Infinity) > HEARD_MS);
    for (const t of tell) this.told.set(t.id, now);
    // One the page told of is done with too: it isn't told again later.
    for (const t of waiting) if (this.watched.has(t.id) && !this.told.has(t.id)) this.told.set(t.id, -Infinity);
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

/**
  How many of the sessions that wait on you (status "waiting") would lose a live turn to a quit: those whose timeline has a
  request open, and those whose timeline didn't come (`items` failed or timed out), since they may well. ⌘Q asks first
  for these as for working ones (main.ts).
*/
export async function heldOnYou(ids: string[], items: (id: string) => Promise<unknown>) {
  const open = await Promise.all(ids.map((id) => items(id).then(openAsk, () => true)));
  return open.filter(Boolean).length;
}

/** ⌘Q's question while sessions work (`working`) or wait on you with a live request (`held`). */
export function quitQuestion(working: number, held: number) {
  const n = working + held;
  if (!held) return n === 1 ? "A session is still working. Quit anyway?" : `${n} sessions are still working. Quit anyway?`;
  if (!working) return held === 1 ? "A session is waiting on you. Quit anyway?" : `${held} sessions are waiting on you. Quit anyway?`;
  return `${working} ${working === 1 ? "session is" : "sessions are"} still working and ${held} ${held === 1 ? "is" : "are"} waiting on you. Quit anyway?`;
}

/** The menu bar item's first line while the app waits to quit. */
export function waitLine(left: Left) {
  const n = left.working.length + left.waiting.length;
  if (!n) return "Quitting in a moment";
  return n === 1 ? "Quits when the session finishes" : `Quits when ${n} sessions finish`;
}
