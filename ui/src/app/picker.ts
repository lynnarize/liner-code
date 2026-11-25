/*
  The model picker's rules that hold without a page, so plain Node can test them (engine/test/picker.test.ts): its sizes,
  how its side card keeps still while the pointer travels to it, how a tool's models are grouped in its list, and what a
  row says it costs. No React and no alias imports here.
*/
import { lineupOf, nearestEffort } from "../../../contracts/src/index.ts";

/** The picker's parts, in px: the rail of tools, the fixed middle card with the models, the side card, and the room between them. */
export const PICKER = { rail: 40, gap: 8, list: 312, height: 476, side: 268 } as const;
/** The whole picker side by side: rail, list and card. */
export const PICKER_WIDE = PICKER.rail + PICKER.gap + PICKER.list + PICKER.gap + PICKER.side;
/** The picker without its side card, whose words then sit in one line at the list's foot. */
export const PICKER_NARROW = PICKER.rail + PICKER.gap + PICKER.list;
/** Whether a window this wide has room for the side card beside the list, a menu's 10px kept from each edge (menu-place.ts EDGE). */
export const pickerWide = (windowWidth: number) => windowWidth >= PICKER_WIDE + 20;
/**
  How far the picker hangs out past the edge of its chip it is aligned on (Pop's `out`), so that the list is the part that
  stands over the chip: hung by its right, the side card goes past the chip's right edge (nothing does without the card);
  hung by its left, the rail goes before the chip's left edge. The owner asked for the list over its button, the card beside.
*/
export const pickerOut = (align: "start" | "end", wide: boolean) => (align === "end" ? (wide ? PICKER.gap + PICKER.side : 0) : PICKER.rail + PICKER.gap);

/** How long the pointer rests on a row before the side card turns to it. */
export const DWELL_MS = 100;
/**
  What the side card shows (`shown`: a row's key, or null for the session's own), and the row the pointer last came to
  (`aim`) with when it came. The card turns to a row only once the pointer has rested on it, so travelling to the card
  across other rows leaves it as it was.
*/
export type Dwell = { shown: string | null; aim: string | null; at: number };
export const dwellAt = (shown: string | null): Dwell => ({ shown, aim: shown, at: 0 });
/** The pointer came to a row (null: it left the list). The same row again keeps the time it first came. */
export const aimAt = (d: Dwell, key: string | null, now: number): Dwell => (key === d.aim ? d : { ...d, aim: key, at: now });
/** The card turns to the row aimed at once it has rested DWELL_MS, and never while the pointer is over the card itself. */
export function settle(d: Dwell, now: number, overCard: boolean): Dwell {
  if (overCard || d.aim === d.shown || now - d.at < DWELL_MS) return d;
  return { ...d, shown: d.aim };
}
/** The keyboard on a row turns the card at once: there's no pointer travelling across rows to wait out. */
export const focusAt = (key: string | null): Dwell => ({ shown: key, aim: key, at: 0 });

/**
  A part of a tool's list: the models you starred, a maker's (its name over them), or a tool of one maker's own models
  ("plain": no label over them), each in the tool's order.
*/
export type Section<T> = { kind: "starred" | "maker" | "plain"; label: string; items: T[] };

/**
  A tool's list as the picker shows it. The starred first, under Starred. Then, when the tool's models come from several
  makers, one part a maker, in the order the tool first names each (`newest` comes so, contracts' lineupOf); a tool of one
  maker (Claude Code, Codex) lists its models plainly in the tool's order, with no line over each saying what it is for:
  the names say it, and a line a model made the list twice as long. `older` are the older versions, behind their own row;
  one starred is with the starred, not there.
*/
export function sectionsOf<T>(groups: { maker: string; newest: T[]; older: T[] }[], o: { starred: (t: T) => boolean }): { sections: Section<T>[]; older: T[]; makers: number } {
  const all = groups.flatMap((g) => [...g.newest, ...g.older]);
  const starred = all.filter(o.starred);
  const makers = groups.filter((g) => g.newest.some((t) => !o.starred(t)) || g.older.some((t) => !o.starred(t))).length;
  const sections: Section<T>[] = starred.length ? [{ kind: "starred", label: "Starred", items: starred }] : [];
  if (makers > 1) {
    for (const g of groups) {
      const items = g.newest.filter((t) => !o.starred(t));
      if (items.length) sections.push({ kind: "maker", label: g.maker, items });
    }
  } else {
    const items = groups.flatMap((g) => g.newest).filter((t) => !o.starred(t));
    if (items.length) sections.push({ kind: "plain", label: "", items });
  }
  return { sections, older: groups.flatMap((g) => g.older).filter((t) => !o.starred(t)), makers };
}

/** A price of nothing in and nothing out: a free model. */
export const isFree = (price: { input: string; output: string } | undefined) => Boolean(price && /^\D*0(\.0+)?$/.test(price.input) && /^\D*0(\.0+)?$/.test(price.output));
/** What a row says a model costs: a million tokens in and out as its tool reports them for that source ("$4 / $20"), "Free" for nothing; nothing when it reports none. */
export function priceSaid(price: { input: string; output: string } | undefined): string {
  if (!price?.input || !price.output) return "";
  return isFree(price) ? "Free" : `${price.input} / ${price.output}`;
}

/**
  One model from several sources of one tool (OpenCode Zen and Go both offer GLM-5.3, as two ids with one name) is one row.
  `keyOf` says which are one model (the tool and the name); each row keeps every offer in the tool's order and the one that
  runs it: the one you chose for that model (`remembered`, a ref), else the one from the source you chose last for any
  model (`lastSource`, asked of the row's first offer since it is the tool's, by `sourceOf`), else the first the tool lists. Rows keep the order each model is first named in. Each
  offer stays its own id: its effort levels and price are never merged with another's (Kimi K3 takes low, high and max
  from Zen, only max from Go).
*/
export type Offered<T> = { key: string; pick: T; offers: T[] };
/**
  `current` is the model the place runs now (a session's): its row runs from the source it runs from, whatever is kept for
  the model, so a row ticked as the session's never moves it to another source when picked. Find and the list both merge
  through here, so they can't disagree.
*/
export function mergeOffers<T>(items: T[], o: { keyOf: (t: T) => string; refOf: (t: T) => string; sourceOf: (t: T) => string; remembered?: (key: string) => string | undefined; lastSource?: (t: T) => string | undefined; current?: string }): Offered<T>[] {
  const rows = new Map<string, T[]>();
  for (const t of items) {
    const k = o.keyOf(t);
    const had = rows.get(k);
    if (had) had.push(t);
    else rows.set(k, [t]);
  }
  return [...rows].map(([key, offers]) => {
    const kept = o.remembered?.(key);
    const last = o.lastSource?.(offers[0]);
    const pick = (o.current ? offers.find((t) => o.refOf(t) === o.current) : undefined) ?? offers.find((t) => o.refOf(t) === kept) ?? (last !== undefined ? offers.find((t) => o.sourceOf(t) === last) : undefined) ?? offers[0];
    return { key, pick, offers };
  });
}

/**
  A tool's list under its source switch (`source`, null for All): the rows, its parts, the older versions behind their own
  row and the count by its name all follow the switch, so narrowed to Go nothing of Zen's is offered or counted. A row is
  starred when any source's id of its model is, whatever the switch, so the side card (which reads every source) says
  "Starred" exactly when the row is under Starred.
*/
export function toolList<T>(items: T[], o: { source: string | null; sourceOf: (t: T) => string; merge: (items: T[]) => Offered<T>[]; nameOf: (t: T) => string; makerOf: (t: T) => string; legacy: (t: T) => boolean; starred: (t: T) => boolean }) {
  const all = o.merge(items);
  const rows = o.source === null ? all : o.merge(items.filter((t) => o.sourceOf(t) === o.source));
  const starredKeys = new Set(all.filter((r) => r.offers.some(o.starred)).map((r) => r.key));
  const isStarred = (r: Offered<T>) => starredKeys.has(r.key);
  const groups = lineupOf(rows, (r) => o.nameOf(r.pick), (r) => o.makerOf(r.pick), (r) => o.legacy(r.pick));
  const { sections, older } = sectionsOf(groups, { starred: isStarred });
  return { all, rows, sections, older, count: rows.length, isStarred };
}

/** Starring a row stars every id of its model (Zen's and Go's together), and unstarring one starred anywhere unstars them all. */
export function toggleStars(favs: string[], refs: string[]): string[] {
  return refs.some((r) => favs.includes(r)) ? favs.filter((f) => !refs.includes(f)) : [...favs, ...refs.filter((r) => !favs.includes(r))];
}

/**
  Which key the side card shows: the row pointed at or focused, else the place's own (`fallback`: the session's model, or
  "fusion" for its pair) only while the rail shows the place's own tool (`home`). With the rail on another tool and nothing
  pointed at, none: the card asks to point at a model rather than show another tool's would-be pair as the session's.
*/
export function cardKey(pointed: string | null, fallback: string | null, rail: string, home: string | undefined): string | null {
  return pointed ?? (home === undefined || rail === home ? fallback : null);
}

/** A source switch shows its buttons beside the tool's name up to All and two sources; past that it is one chip that opens them as a list. */
export const SWITCH_BUTTONS = 2;
export const switchAsChip = (sources: number) => sources > SWITCH_BUTTONS;

/**
  Writes the sources kept (Settings.modelSources) from the latest value: the one last written while the engine's copy hasn't
  caught up yet, else the engine's. Two quick choices each patch what the other left, so neither is lost.
*/
export function sourceWriter(read: () => Record<string, string> | undefined, save: (next: Record<string, string>) => Promise<Record<string, string> | undefined>) {
  let pending: Record<string, string> | undefined;
  const same = (a?: Record<string, string>, b?: Record<string, string>) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  return (patch: Record<string, string | undefined>) => {
    const stored = read();
    if (pending && same(pending, stored)) pending = undefined;
    const next: Record<string, string> = { ...(pending ?? stored ?? {}) };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    else next[k] = v;
    pending = next;
    return save(next).then(
      (saved) => {
        // The engine's answer is what it kept (it keeps only so many); it stands until the engine's copy shows it.
        if (pending === next) pending = same(saved, read()) ? undefined : (saved ?? next);
      },
      (e) => {
        if (pending === next) pending = undefined;
        throw e;
      },
    );
  };
}
/** Where a merged model comes from, the source that runs it first and the others after it, each once ("Go · Zen" when Go runs it). */
export function sourcesInOrder(chosen: string, names: string[]): { runs: string; others: string[] } {
  return { runs: chosen, others: [...new Set(names)].filter((n) => n !== chosen) };
}

/** Claude Code's two extras, which the app adds after a model's own levels: a level its tool marks so, or one of these ids. */
const EXTRA_IDS = new Set(["ultracode", "ultrathink"]);
export const isExtraEffort = (e: { id: string; extra?: boolean }) => e.extra === true || EXTRA_IDS.has(e.id);
/** A model's effort levels as the picker lists them: its own, lowest first as its tool gives them, then the extras apart. */
export function effortParts<E extends { id: string; extra?: boolean }>(list: E[]): { levels: E[]; extras: E[] } {
  return { levels: list.filter((e) => !isExtraEffort(e)), extras: list.filter(isExtraEffort) };
}
/**
  The level a model runs at, as the engine resolves it (runtime.ts effortFor, contracts' nearestEffort): the one asked for
  when the model takes it, else the nearest it takes, else its tool's default when the tool names one. None (no tick)
  when the model takes no level, or the tool's own default runs and the tool doesn't say which it is.
*/
export function effortIn(list: { id: string }[], asked: string | undefined, fallback: string | undefined): string | undefined {
  if (!list.length) return undefined;
  const runs = asked ? nearestEffort(asked, list, fallback) : fallback;
  return runs && list.some((e) => e.id === runs) ? runs : undefined;
}
/**
  The level a fresh start asks of a model before anyone picks one (a new session, the Demo, a preset the model doesn't take):
  only ever one its tool listed for it. Its tool's default when the tool names one it lists, else "": the tool is given no
  level and runs at its own, and the picker ticks none. Never a word of the app's own, which a model may not take (GLM-5.3
  has no Medium).
*/
export function startLevel(list: { id: string }[], fallback: string | undefined): string {
  return fallback && list.some((e) => e.id === fallback) ? fallback : "";
}
/**
  The level kept for a model when a level was asked (a pair's lead at Settings' word, an agent's preset or its saved level):
  the one asked when the model lists it. When it doesn't, a choice that was the person's own (`mine`) runs as the nearest the
  model lists, as the engine would run it; a word the app put there (a preset) is dropped for startLevel, so nothing is saved
  that the person never chose and the model never listed.
*/
export function keptLevel(list: { id: string }[], asked: string | undefined, fallback: string | undefined, mine: boolean): string {
  if (asked && list.some((e) => e.id === asked)) return asked;
  return (mine ? effortIn(list, asked, fallback) : undefined) ?? startLevel(list, fallback);
}
/** A level's name as shown:the tool's own word, its first letter made a capital where the tool sent it lower case ("minimal" reads "Minimal"). */
export const levelName = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/** Where a level sits on the Effort slider: its stop among the model's own levels (effortParts' `levels`), -1 for none. */
export const stopOf = (levels: { id: string }[], id: string | undefined) => (id ? levels.findIndex((e) => e.id === id) : -1);
/**
  What the Effort slider shows for the effort a place holds (`value`: the word it stores, a level, one of Claude Code's
  extras, or "" for the tool's own, never one already resolved to the tool's default): the stop it runs at (`at`, -1 for an
  empty track), that level, the extra switched on, and whether that very level was asked for plainly (`chosen`), which a
  press on its stop takes back. `held` false is a model's card that doesn't hold the effort (another model than the
  session's, another tool's pair): the level carried over shows, but nothing there was chosen for that model, so a press
  picks it. A level the model lacks shows as the nearest it takes, which isn't chosen either. Drawn from what the engine
  sends: Ultracode runs at extra high (claude.ts sdkEffort sends "xhigh" with ultracode on), and Ultrathink sends no level
  at all, only its word in each message, so the tool's own default runs under it whatever was picked before.
*/
export type EffortShown = { at: number; level: string | undefined; extra: string | undefined; chosen: boolean };
export function effortShown(list: { id: string; extra?: boolean }[], value: string | undefined, fallback: string | undefined, held = true): EffortShown {
  const { levels, extras } = effortParts(list);
  const extra = value && extras.some((e) => e.id === value) ? value : undefined;
  const asked = extra === "ultracode" ? "xhigh" : extra ? undefined : value;
  const level = effortIn(levels, asked, fallback);
  return { at: stopOf(levels, level), level, extra, chosen: held && !extra && Boolean(value) && level === value };
}
/**
  What a press on stop `i` asks for: its level; the level asked for plainly pressed again, the tool's own default (""), so
  there is a way back to it without a button of its own. With an extra on, any stop is a level picked, turning the extra off.
*/
export function pressStop(levels: { id: string }[], shown: EffortShown, i: number): string | undefined {
  if (i < 0 || i >= levels.length) return undefined;
  return shown.chosen && i === shown.at ? "" : levels[i].id;
}
/**
  The effort a switch leaves, the engine holding one effort a session: switched on, its extra (so the other goes off);
  switched off, the level picked before it while the picker was open, else the tool's own default.
*/
export const switchExtra = (id: string, on: boolean, before: string | undefined) => (on ? id : (before ?? ""));
/**
  What letting go of a press on the track asks for: let go in the stop it began in, a press (pressStop); dragged, the stop
  let go in, unless that is the level already chosen there. A level only shown (the tool's default, or one carried over from
  another model) is picked, so a drag onto it on another model's card picks that model at it.
*/
export function releaseStop(levels: { id: string }[], shown: EffortShown, from: number, to: number, moved: boolean): string | undefined {
  if (to < 0 || to >= levels.length) return undefined;
  if (!moved && to === from) return pressStop(levels, shown, to);
  return to !== shown.at || shown.extra || !shown.chosen ? levels[to].id : undefined;
}
/**
  The slider's aria-valuenow, which a role="slider" must always have: the stop it runs at, and on an empty track (the tool's
  own default) the lowest stop, the one Right would go to, with aria-valuetext saying "Its own default" so it is read as none.
*/
export const sliderNow = (at: number) => Math.max(0, at);
/** What a place that saves its effort in Settings stores for a pick: a level, and for the tool's own default no word (null), which Settings takes as unset where "" is refused. */
export const settingLevel = (id: string): string | null => id || null;
/** The stop a pointer `x` px along a track `width` px wide is nearest: the stops stand at equal steps from the track's start (the lowest) to its end (the highest), the ends taking what lies past them. */
export function stopAt(x: number, width: number, stops: number): number {
  if (stops < 1 || width <= 0) return -1;
  if (stops === 1) return 0;
  return Math.min(stops - 1, Math.max(0, Math.round((x / width) * (stops - 1))));
}
/**
  Where the slider's knob stands, as a share of its travel: the start for a model's lowest level and the end for its highest,
  so the lowest of two (OpenCode's "none") is an empty track and never half of one. One level alone stands at the end; none, 0.
*/
export const fillOf = (at: number, stops: number) => (at < 0 || stops < 1 ? 0 : stops === 1 ? 1 : at / (stops - 1));
/**
  A key on the slider: Left one level lower, Right one higher (from an empty track either starts at the lowest), Home and
  End the ends, Delete or Backspace the tool's own default ("own"). Up and Down are not its: they walk the card's parts.
*/
export function stopKey(key: string, at: number, stops: number): number | "own" | undefined {
  if (stops < 1) return undefined;
  if (key === "Delete" || key === "Backspace") return "own";
  if (key === "Home") return 0;
  if (key === "End") return stops - 1;
  if (key === "ArrowLeft") return Math.max(0, at - 1);
  if (key === "ArrowRight") return Math.min(stops - 1, at + 1);
  return undefined;
}

/**
  Why a model shows no levels, in the words of what its tool said: that it takes none (OpenCode lists no variants for it), or
  nothing yet (a Hermes model no session has run on, before its listing showed Hermes's levels are the same for every model).
  One line said both once, and a model that takes Hermes's levels read as taking none. Unknown (`said` unset): the plain line.
*/
export function noLevels(tool: string | undefined, said: boolean | undefined): string {
  if (said === undefined) return "This model has no effort levels.";
  const who = tool ?? "Its tool";
  return said ? `${who} lists no effort levels for this model.` : `${who} hasn't said which effort levels this model takes, so it thinks at its own default.`;
}
