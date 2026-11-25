/*
  Picking a model: one picker, the same wherever a model is picked (the composer's who panel, the Reviewer's menu,
  Settings, a new agent, a scan, an app). Three parts side by side, their sizes in picker.ts: a rail of your tools; a
  middle card of one size whatever the tool, with Find and the rows a caller pins (Fusion, Automatic) at its top, the rail's
  tool's models scrolling under them (the starred first, then by maker, or by what each is for in a tool of one maker, its
  sources a switch over them), and at its foot the rows that open a list in its place (your agents, older versions); and a
  card at its side about the model pointed at: where it runs, its price and its effort levels exactly as its tool reports
  them. In a window too narrow for the card, its words are one line at the middle card's foot. The models are the ones
  each tool on this Mac said it runs, not a list kept in the app; one model a tool offers from several sources is one row.
*/
import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KeyEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import type { EffortInfo, ProviderInfo, Settings as EngineSettings } from "@contracts";
import { castOf, familyOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { getState, rpc, useEngine } from "./engine";
import { I, ModelMark, type MarkKind } from "./icons";
import { allModels, effortsFor, everyModel, isGoModel, makerName, markOf, modelLabel, pairReady, shortName, sourceMarkOf, toolMarkOf, type ModelChoice } from "./model";
import { aimAt, cardKey, DWELL_MS, dwellAt, effortIn, effortParts, effortShown, fillOf, focusAt, isFree, levelName, mergeOffers, noLevels, PICKER, PICKER_NARROW, PICKER_WIDE, pickerOut, pickerWide, priceSaid, releaseStop, settle, sliderNow, sourcesInOrder, sourceWriter, stopAt, stopKey, switchAsChip, switchExtra, toggleStars, toolList, type EffortShown, type Offered } from "./picker";
import { BackRow, ModelTag, NamedSwitch, Pop } from "./ui";
import "./models.css";

/** A tool with two sources or more shows them as a switch (OpenCode's Zen and Go); one with a source and models of no source does past this many. */
const SOURCES_FROM = 14;
/** A source's name from a model id's prefix ("opencode-go/kimi-k3" → "OpenCode Go"), when the tool didn't name it. */
const SOURCE_NAMES: Record<string, string> = { opencode: "OpenCode Zen", "opencode-go": "OpenCode Go", openrouter: "OpenRouter", deepseek: "DeepSeek", moonshotai: "Moonshot", zai: "Z.ai", "z-ai": "Z.ai", google: "Google", anthropic: "Anthropic", openai: "OpenAI", xai: "xAI", groq: "Groq", ollama: "Ollama", lmstudio: "LM Studio" };
/** Where a model comes from inside its tool: the source the tool reported (Nous Portal, OpenCode Go), else its id's prefix. */
function sourceOf(m: ModelChoice) {
  // OpenCode names its own catalogue after itself ("OpenCode/Big Pickle"): that's OpenCode Zen, beside OpenCode Go.
  // OpenCode now sends its providers' raw ids ("opencode", "opencode-go"): read through the same names as an id's prefix.
  if (m.group) return m.group === "OpenCode" ? "OpenCode Zen" : (SOURCE_NAMES[m.group] ?? m.group);
  const id = m.ref.slice(m.ref.indexOf(":") + 1);
  const at = id.indexOf("/");
  if (at < 1) return "";
  const key = id.slice(0, at).toLowerCase();
  return SOURCE_NAMES[key] ?? key.replace(/(^|[-_])(\w)/g, (_, sep: string, c: string) => `${sep ? " " : ""}${c.toUpperCase()}`);
}
/**
  A tool's sources, the biggest first (models no source claims last, as Other), and whether its
  list shows them as a switch: two sources or more, or a source and models of none past SOURCES_FROM.
*/
function sourcesIn(all: ModelChoice[]) {
  const count = (name: string) => all.filter((m) => !m.legacy && sourceOf(m) === name).length;
  const sources = [...new Set(all.filter((m) => !m.legacy).map(sourceOf))].sort((x, y) => Number(!x) - Number(!y) || count(y) - count(x));
  return { sources, stepped: sources.length > 1 && (sources.filter(Boolean).length > 1 || all.length > SOURCES_FROM) };
}
/** A source by its short name beside its tool's: "OpenCode Go" in OpenCode is "Go". */
const shortSource = (name: string, tool: string) => (name.startsWith(`${tool} `) ? name.slice(tool.length + 1) : name) || "Other";
/**
  The tool a model is listed under: its own, except OpenCode Go's models, which sit under OpenCode
  whichever tool reports them (Hermes runs them from a Go plan too). They still run in the tool that
  reported them, and their source says so ("through Hermes"). When OpenCode has Go itself, Hermes's
  never get here (allModels leaves them out).
*/
function tabberOf(tools: ProviderInfo[]) {
  const goTab = tools.find((p) => familyOf(p.id) === "opencode")?.id;
  return (m: ModelChoice) => (goTab && isGoModel({ group: m.group, id: m.ref.slice(m.ref.indexOf(":") + 1) }) ? goTab : m.providerId);
}
/** The tool whose list holds a model: its own, or OpenCode's for one of Go's that Hermes runs; undefined when no list has it. */
export function tabOfRef(ref: string, providers: ProviderInfo[]) {
  const tools = providers.filter((p) => p.available && p.adapter && p.models.length && p.id !== "demo");
  const m = allModels(tools, providers).find((x) => x.ref === ref);
  return m ? tabberOf(tools)(m) : undefined;
}
/** A tool's mark on the rail: an API endpoint's service's logo (as markOf has it), else the tool's own. */
const railMarkOf = (id: string): MarkKind => (/\.api-/.test(id) ? sourceMarkOf(id.slice(id.indexOf(".api-") + 5)) : toolMarkOf(id));

/**
  The models you starred (Settings' favoriteModels), first in every tool's list, and the toggle that stars one: every id of
  a model one tool offers from several sources together (picker.ts toggleStars), so a row is never half starred.
*/
export function useStars() {
  const favs = useEngine((s) => s.settings.favoriteModels) ?? [];
  const star = (refs: string | string[]) => {
    const next = toggleStars(getState().settings.favoriteModels ?? [], typeof refs === "string" ? [refs] : refs);
    void rpc("settings.save", { favoriteModels: next }).catch((e) => toast.error(String(e?.message ?? e)));
  };
  return { favs, star };
}
/**
  The sources you chose, kept beside the stars (Settings.modelSources): for a model one tool offers from several (Zen or
  Go), by the tool and the model's name; the source you chose last in a tool (`last:` and the tool), which runs the models
  you chose for none; and where a tool's source switch was left (`switch:` and the tool). Each choice is written from the
  latest value, not the one this render saw, so two quick ones both stay (picker.ts sourceWriter).
*/
const writeSources = sourceWriter(
  () => getState().settings.modelSources,
  (next) => rpc("settings.save", { modelSources: next }).then((s) => s.modelSources),
);
export function useSources() {
  const kept = useEngine((s) => s.settings.modelSources) ?? {};
  const keep = (patch: Record<string, string | undefined>) => void writeSources(patch).catch((e) => toast.error(String(e?.message ?? e)));
  return { kept, keep };
}
/** One model in one tool: the tool's list it is in and its name. */
const offerKey = (tab: string, label: string) => `${tab}/${label}`;

/**
  A tool's models as rows, one a model however many sources offer it, each with the offer that runs it (picker.ts
  mergeOffers): the one you chose for it, else the one from the source you chose last in that tool, else the tool's first.
*/
function useOffered(current?: string) {
  const providers = useEngine((s) => s.providers);
  const { kept } = useSources();
  return (models: ModelChoice[], tabOf: (m: ModelChoice) => string) => mergeOffers(models, { keyOf: (m) => offerKey(tabOf(m), modelLabel(m.ref, providers)), refOf: (m) => m.ref, sourceOf, remembered: (k) => kept[k], lastSource: (m) => kept[`last:${tabOf(m)}`], current });
}
/** Where a merged model comes from, in words for its tooltip: "Go · Zen". */
const fromWords = (row: Offered<ModelChoice>, tool: string) => {
  const { runs, others } = sourcesInOrder(shortSource(sourceOf(row.pick), tool), row.offers.map((m) => shortSource(sourceOf(m), tool)));
  return [runs, ...others].join(" · ");
};
/** Where a merged model comes from, at its row's end: the source that runs it in ink, the others after it in grey ("Go · Zen"). */
function FromSaid({ row, tool }: { row: Offered<ModelChoice>; tool: string }) {
  const { runs, others } = sourcesInOrder(shortSource(sourceOf(row.pick), tool), row.offers.map((m) => shortSource(sourceOf(m), tool)));
  return (
    <>
      <span className="lc-pk-runs">{runs}</span>
      {others.map((o) => (
        <Fragment key={o}> · {o}</Fragment>
      ))}
    </>
  );
}

/** Whether the window has room for the side card beside the list, kept as the window is resized. */
export function usePickerWide() {
  const [wide, setWide] = useState(() => pickerWide(document.documentElement.clientWidth));
  useEffect(() => {
    const on = () => setWide(pickerWide(document.documentElement.clientWidth));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

/**
  The arrow keys walk a column's rows (Home and End to its ends), as Tab does; from the search
  field only down leaves it. A list that takes the arrows itself (the search's results) has used them first.
  `within` walks a wider place than the column the key was pressed in.
*/
export function rove(e: KeyEvent<HTMLElement>, within?: HTMLElement | null) {
  if (e.defaultPrevented || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  if (e.target instanceof HTMLInputElement && e.key !== "ArrowDown") return;
  const rows = [...(within ?? e.currentTarget).querySelectorAll<HTMLElement>("[data-rove]:not(:disabled)")];
  if (!rows.length) return;
  const i = rows.indexOf(document.activeElement as HTMLElement);
  const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
  rows[to]?.focus();
  e.preventDefault();
}

/** The way back from a list opened in a place of its own (older versions, your agents, Fusion's Lead): the app's one back row (ui.tsx BackRow), one of the rows the arrows walk. */
export { BackRow };

/** The search over every tool and source. `autoFocus` marks it as where the keyboard starts when its panel opens (Pop). */
export function FindField({ value, onChange, field, label = "Find a model", autoFocus }: { value: string; onChange: (q: string) => void; field: RefObject<HTMLInputElement | null>; label?: string; autoFocus?: boolean }) {
  return (
    <label className="lc-mp-find lc-who-find">
      <I.search size={16} />
      <input ref={field} value={value} data-autofocus={autoFocus || undefined} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Escape" && value && (e.preventDefault(), onChange(""))} placeholder={label} aria-label={label} spellCheck={false} />
    </label>
  );
}

/**
  What a search finds, from every tool: one row a model, a model one tool offers from several sources once (the offer
  that runs it), where it comes from at its end (its sources' short names in a tool with several, "Zen · Go", else its
  tool's name). The arrows and Enter come from the search field (`keysFrom`), whose focus stays put while the lit row is
  said through aria-activedescendant; `onLit` hears which row is lit, so a card beside can follow it.
*/
export function ModelSearch({ query, keysFrom, value, also = [], only, height = 330, hint, onPick, onLit }: { query: string; keysFrom: RefObject<HTMLElement | null>; value?: string; also?: string[]; only?: (p: ProviderInfo) => boolean; height?: number; hint?: string; onPick: (ref: string, how: { shiftKey: boolean }) => void; onLit?: (ref: string) => void }) {
  const providers = useEngine((s) => s.providers);
  const { favs, star } = useStars();
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  // The same merge as the list's, the place's own model running from its own source, so a row ticked here never moves it.
  const offered = useOffered(value);
  const tools = useMemo(() => providers.filter((p) => p.available && p.adapter && p.models.length && (showDemo || p.id !== "demo") && (!only || only(p))), [providers, only, showDemo]);
  // Judged against every tool, so a search of some tools still leaves out Hermes's Go models when OpenCode has Go.
  const models = useMemo(() => allModels(tools, providers), [tools, providers]);
  const tabOf = tabberOf(tools);
  const fromOf = (r: Offered<ModelChoice>): ReactNode => {
    const tab = tabOf(r.pick);
    const toolLabel = tools.find((p) => p.id === tab)?.label ?? r.pick.provider;
    if (!sourcesIn(models.filter((x) => tabOf(x) === tab)).stepped) return r.pick.provider;
    return (
      <>
        <ModelMark kind={sourceMarkOf(sourceOf(r.pick))} size={12} />
        <FromSaid row={r} tool={toolLabel} />
      </>
    );
  };
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => offered(models.filter((m) => `${m.label} ${m.ref} ${m.group ?? ""} ${m.provider} ${m.description}`.toLowerCase().includes(q)), tabOf).slice(0, 80), [models, q, offered]);
  const isOn = (r: Offered<ModelChoice>) => Boolean(value && r.offers.some((m) => m.ref === value));
  const [hl, setHl] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const ids = useId();
  useEffect(() => setHl(Math.max(0, rows.findIndex(isOn))), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-hl]")?.scrollIntoView({ block: "nearest" });
    if (rows[hl]) onLit?.(rows[hl].pick.ref);
  }, [hl, rows[hl]?.pick.ref]);
  const keys = (e: KeyboardEvent) => {
    // The press stops here all the same, so ⌘1 to ⌘9 don't open a session from the sidebar while a model is being picked (App).
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) return void e.preventDefault();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHl((h) => Math.max(0, Math.min(rows.length - 1, h + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && rows[hl]) {
      e.preventDefault();
      onPick(rows[hl].pick.ref, { shiftKey: e.shiftKey });
    }
  };
  const live = useRef(keys);
  live.current = keys;
  useEffect(() => {
    const el = keysFrom.current;
    if (!el) return;
    const on = (e: KeyboardEvent) => live.current(e);
    el.addEventListener("keydown", on);
    return () => el.removeEventListener("keydown", on);
  }, [keysFrom]);
  const lit = rows[hl] ? `${ids}-${hl}` : undefined;
  useEffect(() => {
    const el = keysFrom.current;
    if (!el) return;
    el.setAttribute("aria-controls", `${ids}-list`);
    if (lit) el.setAttribute("aria-activedescendant", lit);
    else el.removeAttribute("aria-activedescendant");
    return () => (el.removeAttribute("aria-activedescendant"), el.removeAttribute("aria-controls"));
  }, [keysFrom, lit]);
  return (
    <div className="lc-mp" style={{ "--lc-mp-max": `${height}px` } as CSSProperties}>
      <div ref={list} id={`${ids}-list`} className="lc-mp-list" role="listbox" aria-label="Models">
        {rows.length === 0 && <p className="lc-quiet lc-mp-none">No model matches that.</p>}
        {rows.map((r, k) => {
          const m = r.pick;
          const on = isOn(r);
          const fav = r.offers.some((x) => favs.includes(x.ref));
          return (
            <div key={r.key} className="lc-mp-row" data-aim={m.ref} data-on={on || undefined} data-also={r.offers.some((x) => also.includes(x.ref)) || undefined} data-hl={k === hl || undefined} onMouseEnter={() => setHl(k)}>
              <button type="button" role="option" id={`${ids}-${k}`} aria-selected={on} className="lc-mp-pick l-focus" onClick={(e) => onPick(m.ref, { shiftKey: e.shiftKey })} title={[m.description, hint].filter(Boolean).join(". ") || undefined}>
                <span className="lc-mp-t">
                  <b>
                    <ModelTag kind={markOf(m.ref)} label={modelLabel(m.ref, providers)} size={12} />
                    {m.isDefault && <span className="lc-mp-def">Default</span>}
                  </b>
                </span>
                <span className="lc-mp-from">{fromOf(r)}</span>
              </button>
              <button type="button" className="lc-mp-star l-focus" data-on={fav || undefined} aria-label={fav ? `Unstar ${m.label}` : `Star ${m.label}`} aria-pressed={fav} onClick={() => star(r.offers.map((x) => x.ref))}>
                <I.star size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
  One model as a row, 28 high: its maker's mark, the name, where it comes from in grey in a tool of several sources ("Zen ·
  Go"), what it costs at its end in mono ("$4 / $20", "In plan"), then the tick on the one picked (a model added to compare
  gets a quiet one). An older version reads in the third ink. With `star`, a star follows at its very end (a picker with no
  side card to star from), shown while the row is pointed at or focused, and always once starred. `title` says what a
  shift-click does, where it does something. `aim` is the key the side card turns to. The name has first call on the room:
  the sources give way first (cut, their words whole in `fromTitle`), then the price.
*/
export function ModelRow({ model: id, label, on, also, old, from, fromTitle, price, star, title, aim, onPick }: { model: string; label: string; on?: boolean; also?: boolean; old?: boolean; from?: ReactNode; fromTitle?: string; price?: string; star?: { on: boolean; toggle: () => void }; title?: string; aim?: string; onPick: (ref: string, how: { shiftKey: boolean }) => void }) {
  const pick = (
    <button type="button" className="lc-who-row lc-pk-row l-focus" data-rove data-aim={aim ?? id} data-on={on || undefined} data-also={also || undefined} data-old={old || undefined} aria-pressed={on} title={title} onClick={(e) => onPick(id, { shiftKey: e.shiftKey })}>
      <ModelMark kind={markOf(id)} size={14} />
      <span className="lc-who-row-t">{label}</span>
      {from && (
        <span className="lc-pk-from" title={fromTitle}>
          {from}
        </span>
      )}
      {price && (
        <span className="lc-pk-price" title={price}>
          {price}
        </span>
      )}
      <span className="lc-pk-tick" aria-hidden>
        {(on || also) && <I.check size={14} />}
      </span>
    </button>
  );
  if (!star) return pick;
  return (
    <div className="lc-who-mrow">
      {pick}
      <button type="button" className="lc-mp-star l-focus" data-on={star.on || undefined} aria-label={star.on ? `Unstar ${label}` : `Star ${label}`} aria-pressed={star.on} onClick={star.toggle}>
        <I.star size={14} />
      </button>
    </div>
  );
}

/** The rail's own entries past the tools (the Demo): a mark, a name, and what the middle card shows for it. */
export type RailExtra = { id: string; label: string; mark: MarkKind; title?: string; body: ReactNode };
/**
  The rail: one 28px button a tool that is ready, its own mark, the tool whose models show pressed. A tool installed but
  not signed in is there all the same (its models can still be read), quieter, and says so in its name.
*/
function ToolRail({ tools, extras, on, rail, onPick }: { tools: ProviderInfo[]; extras: RailExtra[]; on: string; rail: RefObject<HTMLDivElement | null>; onPick: (id: string) => void }) {
  return (
    <div ref={rail} className="lc-pk-card lc-pk-rail" role="toolbar" aria-orientation="vertical" aria-label="Tools">
      {tools.map((p) => {
        const name = p.account ? `${p.label} · ${p.account}` : p.label;
        const say = p.signedIn === false ? `${name}, not signed in` : name;
        return (
          <button key={p.id} type="button" className="lc-pk-tool l-focus" data-off={p.signedIn === false || undefined} aria-pressed={p.id === on} aria-label={say} title={say} onClick={() => onPick(p.id)}>
            <ModelMark kind={railMarkOf(p.id)} size={16} />
          </button>
        );
      })}
      {extras.map((x) => (
        <button key={x.id} type="button" className="lc-pk-tool l-focus" aria-pressed={x.id === on} aria-label={x.label} title={x.title ?? x.label} onClick={() => onPick(x.id)}>
          <ModelMark kind={x.mark} size={16} />
        </button>
      ))}
    </div>
  );
}

/**
  How hard a model works, for a picker that lets you choose it: the effort word held (`of`, as stored, "" for the tool's own,
  never resolved to the tool's default), whether a model's card holds it (`held`: the session's own model; another model's
  card shows the level carried over, which a press picks rather than takes back), and what a press on a level does.
*/
export type EffortHook = { label?: string; of: (ref: string) => string | undefined; held?: (ref: string) => boolean; pick: (ref: string, id: string) => void };
/** What a caller draws for a row of its own the card turns to (Fusion): the card's words, and the narrow form's one line. */
export type OwnCard = { label: string; body: ReactNode; line: ReactNode };
/** A row at the middle card's foot that opens a list in its place (your agents). */
export type Place = { id: string; label: string; icon: ReactNode; on?: boolean; note?: string; body: ReactNode };

/** What Claude Code's extras do, in plain words, as claude.ts sends them; an extra of another name keeps its tool's description. */
const EXTRA_SAID: Record<string, string> = { ultracode: "Extra high effort, and it may run workflows", ultrathink: "Asks it to think as hard as it can in every message" };

/**
  Effort, the same part wherever a level is picked: a head with the label and the level it runs at, whose list the levels
  are on a line under it, then one slider of exactly the model's own levels in its tool's order (never a list of the app's),
  and Claude Code's Ultracode and Ultrathink as switches under it, since they are the app's and not levels the model reports.
  The engine holds one effort, an extra being one of its values: a switch on sets it, off goes back to the level picked
  before it while this part was up. A model with no levels says so, and offers none.
*/
export function EffortPart({ list, fallback, value, held = true, label = "Effort", tool, said, onPick }: { list: EffortInfo[]; fallback?: string; value?: string; held?: boolean; label?: string; tool?: string; said?: boolean; onPick: (id: string) => void }) {
  const { levels, extras } = effortParts(list);
  const shown = effortShown(list, value, fallback, held);
  // The level picked before an extra went on, for the switch to go back to; kept for this model's levels only.
  const key = levels.map((e) => e.id).join(" ");
  const before = useRef<{ key: string; level?: string }>({ key });
  if (before.current.key !== key) before.current = { key };
  if (shown.chosen) before.current.level = shown.level;
  if (!list.length) return <p className="lc-pk-none">{noLevels(tool, said)}</p>;
  const level = levels[shown.at];
  const name = level ? levelName(level.label) : "Its own default";
  const own = !shown.extra && !level;
  return (
    <div className="lc-pk-ef">
      <div className="lc-pk-eh">
        <div className="lc-pk-eh-top">
          <b>{label}</b>
          <span className="lc-pk-eh-now" data-own={!level || undefined}>
            {name}
          </span>
        </div>
        {tool && <span>{own ? `as ${tool} lists them · its own default until you pick` : `as ${tool} lists them`}</span>}
      </div>
      {levels.length > 0 && <EffortSlider levels={levels} shown={shown} fallback={fallback} label={label} name={name} onPick={onPick} />}
      {extras.map((e) => (
        <div key={e.id} className="lc-pk-xr">
          <span className="lc-pk-xr-t">
            <b>{levelName(e.label)}</b>
            <span>{EXTRA_SAID[e.id] ?? e.description}</span>
          </span>
          <NamedSwitch name={levelName(e.label)} size="sm" rove checked={shown.extra === e.id} onCheckedChange={(on) => onPick(switchExtra(e.id, on, before.current.level))} />
        </div>
      ))}
    </div>
  );
}

/**
  The levels as one pill: the stops stand from its start (the lowest) to its end (the highest), the knob on the one it runs
  at and the fill up to the knob, a tick on each stop past it. A press by a stop picks that level (its own again, the tool's default); a drag moves through the
  stops and picks on release. One focus stop: Left and Right change the level, Home and End go to the ends, Delete goes
  back to the tool's default, and Up and Down are left to the card, which walks its parts with them (rove).
*/
function EffortSlider({ levels, shown, fallback, label, name, onPick }: { levels: EffortInfo[]; shown: EffortShown; fallback?: string; label: string; name: string; onPick: (id: string) => void }) {
  const n = levels.length;
  // Where a drag is, drawn while the pointer is down; the pick waits for the release.
  const [drag, setDrag] = useState<number | null>(null);
  const press = useRef<{ from: number; moved: boolean } | null>(null);
  const at = drag ?? shown.at;
  const stopOfEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return stopAt(e.clientX - r.left, r.width, n);
  };
  const keys = (e: KeyEvent<HTMLDivElement>) => {
    const to = stopKey(e.key, shown.at, n);
    if (to === undefined) return;
    // Taken here, so the card's Left (back to the list) and its Home and End (its first and last part) wait for the slider's ends.
    e.preventDefault();
    if (to === "own") return (shown.chosen || shown.extra) && onPick("");
    if (to !== shown.at) onPick(levels[to].id);
  };
  const p = fillOf(at, n);
  return (
    <div
      className="lc-pk-slide l-focus"
      role="slider"
      tabIndex={0}
      data-rove
      data-drag={drag !== null || undefined}
      data-empty={at < 0 || undefined}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={sliderNow(shown.at)}
      aria-valuetext={name}
      style={{ "--lc-pk-fill": p } as CSSProperties}
      onKeyDown={keys}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const i = stopOfEvent(e);
        press.current = { from: i, moved: false };
        setDrag(i);
      }}
      onPointerMove={(e) => {
        if (!press.current) return;
        const i = stopOfEvent(e);
        if (i !== press.current.from) press.current.moved = true;
        setDrag(i);
      }}
      onPointerUp={(e) => {
        const s = press.current;
        press.current = null;
        setDrag(null);
        if (!s) return;
        // Pressed and let go in one stop: a press, which takes back the level chosen there. Dragged: the stop let go in.
        const id = releaseStop(levels, shown, s.from, stopOfEvent(e), s.moved);
        if (id !== undefined) onPick(id);
      }}
      onPointerCancel={() => ((press.current = null), setDrag(null))}
    >
      <span className="lc-pk-slide-fill" aria-hidden />
      {levels.map((e, i) => (
        <span key={e.id} className="lc-pk-slide-stop" aria-hidden data-tick={i > at || undefined} data-end={i === n - 1 ? "end" : i === 0 ? "start" : undefined} data-half={(n > 1 && (i === 0 || i === n - 1)) || undefined} style={{ "--lc-pk-at": fillOf(i, n) } as CSSProperties} title={stopTitle(e, i, shown, fallback)} />
      ))}
      {at >= 0 && <span className="lc-pk-slide-knob" aria-hidden />}
    </div>
  );
}
/** A stop's name for a mouse user, and on the one it runs at what a press there does. */
function stopTitle(e: EffortInfo, i: number, shown: EffortShown, fallback?: string) {
  const name = levelName(e.label);
  if (i !== shown.at || shown.extra) return name;
  if (shown.chosen) return `${name} · press again for its own default`;
  return e.id === fallback ? `${name} · its own default` : name;
}

/**
  The side card for a model: its mark and name, what its tool says it is, where it runs (the sources that offer it, as
  rows with their terms and a tick on the one that runs it, a press choosing it for that model), its price per million
  tokens when the tool says, then its Effort (with `effort`) and a button that stars it.
*/
function ModelCard({ row, effort, onSource }: { row: Offered<ModelChoice>; effort?: EffortHook; onSource: (ref: string) => void }) {
  const providers = useEngine((s) => s.providers);
  const { favs, star } = useStars();
  const m = row.pick;
  const tool = providers.find((p) => p.id === m.providerId);
  const toolLabel = tool?.label ?? m.provider;
  const { list, fallback, said } = effortsFor(m.ref, providers);
  // Starred when any source's id is, as the list's Starred has it (picker.ts toolList); the button acts on them all.
  const fav = row.offers.some((x) => favs.includes(x.ref));
  const src = sourceOf(m);
  const where = (x: ModelChoice) => shortSource(sourceOf(x), providers.find((p) => p.id === x.providerId)?.label ?? x.provider);
  return (
    <>
      <div className="lc-pk-sh">
        <ModelMark kind={markOf(m.ref)} size={14} />
        <span>{modelLabel(m.ref, providers)}</span>
      </div>
      {m.description && <p className="lc-pk-sd">{m.description}</p>}
      <div className="lc-pk-f">
        <span>Runs in</span>
        <b>
          <ModelMark kind={railMarkOf(m.providerId)} size={12} />
          {row.offers.length < 2 && src && src !== toolLabel ? `${toolLabel} · ${shortSource(src, toolLabel)}` : toolLabel}
        </b>
      </div>
      {row.offers.length > 1 && (
        <div className="lc-pk-lv" role="radiogroup" aria-label="Where it runs from">
          {row.offers.map((x) => (
            <button key={x.ref} type="button" role="radio" aria-checked={x.ref === m.ref} className="lc-pk-lvr l-focus" data-rove data-on={x.ref === m.ref || undefined} onClick={() => onSource(x.ref)}>
              <ModelMark kind={sourceMarkOf(sourceOf(x))} size={12} />
              <span className="lc-who-row-t">{where(x)}</span>
              <span className="lc-pk-price">{priceSaid(x.price)}</span>
              <span className="lc-pk-tick" aria-hidden>
                {x.ref === m.ref && <I.check size={14} />}
              </span>
            </button>
          ))}
        </div>
      )}
      {m.price && isFree(m.price) ? (
        <div className="lc-pk-f">
          <span>Per 1M</span>
          <b>Free</b>
        </div>
      ) : (
        m.price && (
          <>
            <div className="lc-pk-f">
              <span>Input per 1M</span>
              <b className="lc-pk-num">{m.price.input}</b>
            </div>
            <div className="lc-pk-f">
              <span>Output per 1M</span>
              <b className="lc-pk-num">{m.price.output}</b>
            </div>
          </>
        )
      )}
      {m.price?.note && <p className="lc-pk-pnote">{m.price.note}</p>}
      <div className="lc-pk-rule" />
      {effort && <EffortPart list={list} fallback={fallback} value={effort.of(m.ref)} held={effort.held?.(m.ref) ?? true} label={effort.label ?? "Effort"} tool={toolLabel} said={said} onPick={(id) => effort.pick(m.ref, id)} />}
      <button type="button" className="lc-pk-star l-focus" data-rove aria-pressed={fav} onClick={() => star(row.offers.map((x) => x.ref))}>
        <I.star size={14} />
        {fav ? "Starred" : "Star this model"}
      </button>
    </>
  );
}
/** The side card's words in one line, for a window too narrow for the card: the mark and name, the price, an Effort chip that opens the levels in place, a star. */
function ModelLine({ row, effort, onEffort }: { row: Offered<ModelChoice>; effort?: EffortHook; onEffort: () => void }) {
  const providers = useEngine((s) => s.providers);
  const { favs, star } = useStars();
  const m = row.pick;
  const { list, fallback } = effortsFor(m.ref, providers);
  // As the part it opens draws it: the extra switched on, else the level the engine runs at (the stored word resolved).
  const now = effort ? effortShown(list, effort.of(m.ref), fallback, effort.held?.(m.ref) ?? true) : undefined;
  const level = list.find((e) => e.id === (now?.extra ?? now?.level));
  const fav = row.offers.some((x) => favs.includes(x.ref));
  const price = priceSaid(m.price);
  return (
    <>
      <ModelMark kind={markOf(m.ref)} size={14} />
      <b className="lc-pk-line-t" title={m.description || undefined}>
        {modelLabel(m.ref, providers)}
      </b>
      {price && <span className="lc-pk-price">{price}</span>}
      {effort && list.length > 0 && (
        <button type="button" className="lc-pk-chip l-focus" data-rove data-view="effort" aria-label={`${effort.label ?? "Effort"}: ${level ? levelName(level.label) : "the tool's own default"}. Change it`} onClick={onEffort}>
          <span>{effort.label ?? "Effort"}</span>
          <b>{level ? levelName(level.label) : "Its own"}</b>
          {/* It opens its levels in the picker's place, so its mark is the › every such row has. */}
          <I.chevR size={12} />
        </button>
      )}
      <button type="button" className="lc-pk-ib l-focus" data-rove aria-pressed={fav} aria-label={fav ? "Starred" : "Star this model"} title={fav ? "Starred" : "Star this model"} onClick={() => star(row.offers.map((x) => x.ref))}>
        <I.star size={14} />
      </button>
    </>
  );
}

type Props = {
  /** The model picked now, as "<provider>:<model>". */
  value?: string;
  /** Others picked alongside, to compare. */
  also?: string[];
  onPick: (ref: string, how: { shiftKey: boolean }) => void;
  /** Which tools to offer; all that are ready by default. */
  only?: (p: ProviderInfo) => boolean;
  /** The middle card's one height; in a menu or a dialog (`side` false) it is the place's, smaller. */
  height?: number;
  autoFocus?: boolean;
  /** A line under the picker, like why some models aren't in it. */
  foot?: ReactNode;
  /** Rows pinned under Find for picks that aren't a model (Automatic, Fusion), given the rail's tool. */
  first?: ReactNode | ((tool: string) => ReactNode);
  /** Rows at the middle card's foot that open a list in its place (your agents); `open` opens on one. */
  places?: Place[];
  open?: string;
  /** The rail's entries past the tools (the Demo). */
  railExtras?: RailExtra[];
  /** The tool the rail opens on, when it isn't the one holding `value`. */
  startTool?: string;
  /** What a shift-click does, on each row's tooltip. */
  hint?: string;
  /** A line pinned over the foot rows (who else gets the ask). */
  note?: ReactNode;
  /** Where the card's words go: the card at the side, one line at the middle card's foot, or neither (in a menu or a dialog). */
  side?: "card" | "line" | false;
  /** How hard a model works, where the place lets you choose it. */
  effort?: EffortHook;
  /** A caller's own card for a key its pinned rows aim at (Fusion), given the rail's tool and what opens it in place. */
  card?: (key: string, tool: string, inPlace: () => void) => OwnCard | undefined;
  /** What the card shows with nothing pointed at: `value` unless said ("fusion" for a pair). */
  fallback?: string;
  /** Another source chosen for the model picked now: by default it is picked as any model is. */
  onSource?: (ref: string) => void;
};

/**
  The picker, wherever a model is picked: the rail, the middle card and (`side`) the card beside it. Pressing a tool only
  changes which models are listed; the pick is a model. The card turns to the row the pointer rests on (picker.ts Dwell)
  or the keyboard is on, else shows what is picked. Keys: Up and Down walk the rows, Left goes to the rail, Right into the
  card, Enter picks, a letter goes to Find, Escape steps back out of a list opened in place.
*/
export function ModelPicker({ value, also = [], onPick, only, height = PICKER.height, autoFocus, foot, first, places = [], open, railExtras = [], startTool, hint, note, side = false, effort, card, fallback, onSource }: Props) {
  const providers = useEngine((s) => s.providers);
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  const { favs, star } = useStars();
  const { kept, keep } = useSources();
  // The model picked now runs from the source it was picked from, whatever is kept for the others: its row says that one (as Find's does).
  const offered = useOffered(value);
  const tools = useMemo(() => providers.filter((p) => p.available && p.adapter && p.models.length && (showDemo || p.id !== "demo") && (!only || only(p))), [providers, only, showDemo]);
  const models = useMemo(() => allModels(tools, providers), [tools, providers]);
  const tabOf = tabberOf(tools);
  const picked = value ? models.find((m) => m.ref === value) : undefined;
  // The tool that holds the place's own pick: the card shows the pick (or its pair) with nothing pointed at only while the rail is on it.
  const home = startTool ?? (picked ? tabOf(picked) : tools.find((p) => value?.startsWith(`${p.id}:`))?.id);
  const [toolId, setToolId] = useState(() => home ?? tools[0]?.id ?? railExtras[0]?.id ?? "");
  const extra = railExtras.find((x) => x.id === toolId);
  const tool = extra ? undefined : (tools.find((p) => p.id === toolId) ?? tools[0]);
  const toolModels = useMemo(() => (tool ? models.filter((m) => tabOf(m) === tool.id) : []), [models, tool?.id]);
  const { sources, stepped } = sourcesIn(toolModels);
  // Where the tool's source switch was left, kept for the tool; a source it no longer has reads as All.
  const leftOn = tool ? kept[`switch:${tool.id}`] : undefined;
  const source = leftOn !== undefined && sources.includes(leftOn) ? leftOn : null;
  const setSource = (s: string | null) => tool && keep({ [`switch:${tool.id}`]: s ?? undefined });
  const [view, setView] = useState(open ?? "");
  const [query, setQuery] = useState("");
  const nameOf = (m: ModelChoice) => modelLabel(m.ref, providers);
  // Narrowed to one source, a row is that source's; across all, one row a model however many sources offer it. The older
  // versions and the count follow the switch too (picker.ts toolList).
  const { all: rowsAll, rows, sections, older, count, isStarred } = toolList(toolModels, { source: stepped ? source : null, sourceOf, merge: (list) => offered(list, tabOf), nameOf, makerOf: (m) => makerName(m.ref), legacy: (m) => Boolean(m.legacy), starred: (m) => favs.includes(m.ref) });
  const rowOf = (ref: string) => offered(models.filter((m) => m.ref === ref || (tabOf(m) === tabOfModel(ref) && nameOf(m) === labelOf(ref))), tabOf).find((r) => r.offers.some((m) => m.ref === ref));
  const every = useMemo(() => everyModel(providers), [providers]);
  const tabOfModel = (ref: string) => {
    const m = models.find((x) => x.ref === ref);
    return m ? tabOf(m) : undefined;
  };
  const labelOf = (ref: string) => modelLabel(ref, providers);

  const find = useRef<HTMLInputElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const mid = useRef<HTMLElement>(null);
  const card_ = useRef<HTMLElement>(null);
  useEffect(() => {
    if (autoFocus && !open) find.current?.focus({ preventScroll: true });
  }, []);

  // The side card: what the pointer rests on or the keyboard is on, else what is picked (`fallback`).
  const [dwell, setDwell] = useState(() => dwellAt(null));
  const overCard = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const point = (key: string | null) => {
    setDwell((d) => aimAt(d, key, performance.now()));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDwell((d) => settle(d, performance.now(), overCard.current)), DWELL_MS + 10);
  };
  const aimOf = (t: EventTarget) => (t instanceof Element ? (t.closest<HTMLElement>("[data-aim]")?.dataset.aim ?? undefined) : undefined);
  const pickSource = (ref: string) => {
    const r = rowOf(ref);
    if (!r) return;
    const m = r.offers.find((x) => x.ref === ref)!;
    keep({ [r.key]: ref, [`last:${tabOf(m)}`]: sourceOf(m) });
    setDwell(focusAt(ref));
    if (value && value !== ref && r.offers.some((m) => m.ref === value)) (onSource ?? ((x: string) => onPick(x, { shiftKey: false })))(ref);
  };
  const [effortOf, setEffortOf] = useState<string | null>(null);
  const shownOf = (key: string | null): OwnCard | undefined => {
    if (!key) return undefined;
    const own = card?.(key, toolId, () => enter("card"));
    if (own) return own;
    const r = rowOf(key) ?? (every.some((m) => m.ref === key) ? { key, pick: every.find((m) => m.ref === key)!, offers: [every.find((m) => m.ref === key)!] } : undefined);
    if (!r) return undefined;
    return {
      label: nameOf(r.pick),
      body: <ModelCard row={r} effort={effort} onSource={pickSource} />,
      line: <ModelLine row={r} effort={effort} onEffort={() => (setEffortOf(r.pick.ref), enter("effort"))} />,
    };
  };
  // Another tool's would-be pair, or the place's own model, never stands in on another tool's rail (picker.ts cardKey).
  const shown = shownOf(dwell.shown) ?? shownOf(cardKey(null, fallback ?? value ?? null, toolId, home));

  const refocus = (el: () => HTMLElement | null | undefined) => requestAnimationFrame(() => el()?.focus({ preventScroll: true }));
  const enter = (v: string) => (setView(v), refocus(() => mid.current?.querySelector<HTMLElement>(".lc-pk-scroll [data-rove][data-on]:not([data-back]), .lc-pk-scroll [data-rove]:not([data-back])")));
  const leave = () => {
    const was = view;
    setView("");
    refocus(() => mid.current?.querySelector<HTMLElement>(`[data-view="${was}"]`) ?? find.current);
  };
  // A row pointed at on the tool before isn't one of this tool's: the card starts again from nothing pointed at.
  const pickTool = (id: string) => (setToolId(id), setView(""), setQuery(""), window.clearTimeout(timer.current), setDwell(dwellAt(null)));
  const toRail = () => rail.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
  const toList = () => (mid.current?.querySelector<HTMLElement>(".lc-pk-scroll [data-rove][data-on]") ?? mid.current?.querySelector<HTMLElement>(".lc-pk-scroll [data-rove]") ?? find.current)?.focus();
  const keys = (e: KeyEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLInputElement;
    if (e.key === "Escape") {
      if (view && !typing) (e.preventDefault(), leave());
      return;
    }
    if (rail.current?.contains(t)) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const bs = [...rail.current.querySelectorAll<HTMLElement>("button")];
        bs[(bs.indexOf(t) + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length]?.focus();
        e.preventDefault();
      } else if (e.key === "ArrowRight") (e.preventDefault(), toList());
      return;
    }
    if (card_.current?.contains(t)) {
      if (e.key === "ArrowLeft" && !typing) {
        e.preventDefault();
        const back = mid.current?.querySelector<HTMLElement>(`[data-aim="${CSS.escape(dwell.shown ?? "")}"]`);
        if (back) back.focus();
        else toList();
      } else rove(e, card_.current);
      return;
    }
    if (mid.current?.contains(t)) {
      // In the source switch Left and Right walk its buttons; past its ends they go on to the rail and the card, as from a row.
      const sw = t.closest<HTMLElement>(".lc-pk-src");
      if (sw && !typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const bs = [...sw.querySelectorAll<HTMLElement>("button")];
        const to = bs[bs.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1)];
        if (to) return void (e.preventDefault(), to.focus());
      }
      // The switch is one stop of Up and Down: from whichever of its buttons, the walk goes on from the pressed one.
      if (sw && (e.key === "ArrowDown" || e.key === "ArrowUp")) sw.querySelector<HTMLElement>("[data-rove]")?.focus();
      if (e.key === "ArrowLeft" && !typing) (e.preventDefault(), toRail());
      else if (e.key === "ArrowRight" && !typing && card_.current) {
        e.preventDefault();
        (card_.current.querySelector<HTMLElement>("[data-rove]:not(:disabled)") ?? card_.current.querySelector<HTMLElement>("button:not(:disabled), input"))?.focus();
      } else if (!typing && e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) find.current?.focus();
      else rove(e, mid.current);
    }
  };

  if (!tools.length && !railExtras.length) return <p className="lc-quiet lc-mp-none">No tool is signed in yet. Settings › Models connects one.</p>;
  const row = (r: Offered<ModelChoice>, old?: boolean) => (
    <ModelRow
      key={r.key}
      model={r.pick.ref}
      label={nameOf(r.pick)}
      on={Boolean(value && r.offers.some((m) => m.ref === value))}
      also={r.offers.some((m) => also.includes(m.ref))}
      old={old}
      from={stepped && tool && source === null ? <FromSaid row={r} tool={tool.label} /> : undefined}
      fromTitle={stepped && tool && source === null ? fromWords(r, tool.label) : undefined}
      price={priceSaid(r.pick.price)}
      title={hint}
      star={side === false ? { on: isStarred(r), toggle: () => star((rowsAll.find((x) => x.key === r.key) ?? r).offers.map((x) => x.ref)) } : undefined}
      onPick={onPick}
    />
  );
  const placeOpen = places.find((p) => p.id === view);
  const sourceName = (s: string | null) => (s === null ? "All sources" : tool ? shortSource(s, tool.label) : s || "Other");
  let body: ReactNode;
  if (view === "sources" && tool)
    body = (
      <>
        <BackRow name="Where a model comes from" onBack={leave} />
        <div role="radiogroup" aria-label="Where a model comes from">
          {[null, ...sources].map((s) => (
            <button key={s ?? "\u0000all"} type="button" role="radio" aria-checked={source === s} className="lc-who-row l-focus" data-rove data-on={source === s || undefined} onClick={() => (setSource(s), leave())}>
              {s === null ? <I.layers size={14} /> : <ModelMark kind={sourceMarkOf(s)} size={14} />}
              <span className="lc-who-row-t">{s === null ? `Every source ${tool.label} has` : sourceName(s)}</span>
              {source === s && <I.check size={14} className="lc-who-tick" />}
            </button>
          ))}
        </div>
      </>
    );
  else if (view === "older")
    body = (
      <>
        <BackRow name="Older versions" onBack={leave} />
        {older.map((r) => row(r, true))}
      </>
    );
  else if (placeOpen)
    body = (
      <>
        <BackRow name={placeOpen.label} onBack={leave} />
        {placeOpen.body}
      </>
    );
  else if (view === "effort" && effort && effortOf) {
    const { list, fallback: def, said } = effortsFor(effortOf, providers);
    body = (
      <>
        <BackRow name={effort.label ?? "Effort"} onBack={leave} />
        {/* Left open after a pick, as the card's is: a slider's Left and Right and the switches change it a step at a time. */}
        <EffortPart list={list} fallback={def} value={effort.of(effortOf)} held={effort.held?.(effortOf) ?? true} label={effort.label ?? "Effort"} tool={providers.find((p) => effortOf.startsWith(`${p.id}:`))?.label} said={said} onPick={(id) => effort.pick(effortOf, id)} />
      </>
    );
  } else if (view === "card" && shown)
    body = (
      <>
        <BackRow name={shown.label} onBack={leave} />
        {shown.body}
      </>
    );
  else if (query.trim()) body = <ModelSearch query={query} keysFrom={find} value={value} also={also} only={only} height={2000} hint={hint} onPick={onPick} onLit={(ref) => setDwell(focusAt(ref))} />;
  else if (extra) body = extra.body;
  else if (tool)
    body = (
      <div className="lc-pk-models" role="group" aria-label={source === null ? `${tool.label}'s models` : `${tool.label}'s models from ${shortSource(source, tool.label)}`}>
        {sections.map((s, i) => (
          <Fragment key={`${s.kind}:${s.label}:${i}`}>
            {i > 0 && (s.kind === "maker" || sections[i - 1].kind === "starred") && <div className="lc-pk-rule" role="presentation" />}
            {s.kind === "starred" ? (
              <div className="lc-pk-lab">Starred</div>
            ) : s.kind === "maker" ? (
              <div className="lc-pk-lab">
                <ModelMark kind={markOf(s.items[0].pick.ref)} size={12} />
                {s.label || "Other"}
              </div>
            ) : (
              s.label && (
                <div className="lc-pk-lab" data-what title={s.label}>
                  <span>{s.label}</span>
                </div>
              )
            )}
            {s.items.map((r) => row(r))}
          </Fragment>
        ))}
        {rows.length === 0 && <p className="lc-who-note">This tool reported no models.</p>}
      </div>
    );
  // The tool's name and count, and its source switch at the right: one row pinned over the models, so the switch never scrolls away.
  const head = !view && !query.trim() && (extra || tool) && (
    <div className="lc-pk-head">
      <ModelMark kind={extra ? extra.mark : railMarkOf(tool!.id)} size={14} />
      <span className="lc-pk-head-t">{extra ? extra.label : tool!.label}</span>
      {tool && <span className="lc-pk-count">{count}</span>}
      {/* All and two sources fit beside the name as buttons, the pressed one a stop of Up and Down (Left and Right walk them);
          more becomes one chip naming the choice, which opens them as a list in place (picker.ts switchAsChip). */}
      {tool && stepped && !switchAsChip(sources.length) && (
        <span className="lc-pk-src" role="group" aria-label="Where a model comes from">
          {[null, ...sources].map((s) => (
            <button key={s ?? "\u0000all"} type="button" className="l-focus" data-rove={source === s || undefined} aria-pressed={source === s} title={s === null ? `Every source ${tool.label} has` : s || "Other"} onClick={() => setSource(s)}>
              {s === null ? "All" : shortSource(s, tool.label)}
            </button>
          ))}
        </span>
      )}
      {tool && stepped && switchAsChip(sources.length) && (
        <button type="button" className="lc-pk-chip lc-pk-srcchip l-focus" data-rove data-view="sources" aria-haspopup="true" aria-label={`Where a model comes from: ${sourceName(source)}. Change it`} title={source === null ? `Every source ${tool.label} has` : source || "Other"} onClick={() => enter("sources")}>
          <b>{sourceName(source)}</b>
          <I.chevD size={12} />
        </button>
      )}
    </div>
  );
  const pinned = typeof first === "function" ? first(toolId) : first;
  const hasFoot = places.length > 0 || older.length > 0;
  const wide = side === "card";
  return (
    <div className="lc-pk" data-side={side || undefined} style={{ "--lc-pk-h": `${height}px` } as CSSProperties} onKeyDown={keys}>
      <ToolRail tools={tools} extras={railExtras} on={extra ? extra.id : (tool?.id ?? "")} rail={rail} onPick={pickTool} />
      <section
        ref={mid}
        className="lc-pk-card lc-pk-mid"
        aria-label="Models"
        onPointerOver={(e) => {
          if (e.pointerType !== "mouse") return;
          const k = aimOf(e.target);
          if (k !== undefined) point(k);
        }}
        onPointerLeave={(e) => e.pointerType === "mouse" && point(null)}
        onFocus={(e) => {
          const k = aimOf(e.target);
          if (k) (window.clearTimeout(timer.current), setDwell(focusAt(k)));
        }}
      >
        <div className="lc-pk-top">
          <FindField value={query} onChange={(q) => (setQuery(q), q && setView(""))} field={find} autoFocus />
        </div>
        {pinned && <div className="lc-pk-pin">{pinned}</div>}
        {head}
        <div className="lc-pk-scroll">{body}</div>
        {note && <div className="lc-pk-note">{note}</div>}
        {hasFoot && (
          <div className="lc-pk-foot">
            {places.map((p) => (
              <button key={p.id} type="button" className="lc-who-row l-focus" data-rove data-view={p.id} data-on={p.on || undefined} aria-haspopup="true" onClick={() => enter(p.id)}>
                {p.icon}
                <span className="lc-who-row-t">{p.label}</span>
                {p.note && <span className="lc-who-row-n">{p.note}</span>}
                {p.on && <I.check size={14} className="lc-who-tick" />}
                <I.chevR size={14} />
              </button>
            ))}
            {older.length > 0 && (
              <button type="button" className="lc-who-row l-focus" data-rove data-view="older" aria-label={`Older versions: ${older.length}`} onClick={() => enter("older")}>
                <I.clock size={14} />
                <span className="lc-who-row-t">Older versions</span>
                <span className="lc-who-row-n">{older.length}</span>
                <I.chevR size={14} />
              </button>
            )}
          </div>
        )}
        {side === "line" && shown && <div className="lc-pk-line">{shown.line}</div>}
      </section>
      {wide && (
        <section ref={card_} className="lc-pk-card lc-pk-side" aria-label={shown?.label ?? "About the model"} onPointerEnter={() => ((overCard.current = true), window.clearTimeout(timer.current))} onPointerLeave={() => (overCard.current = false)}>
          {shown?.body ?? <p className="lc-who-note">Point at a model to read about it.</p>}
        </section>
      )}
      {foot && <div className="lc-mp-foot lc-pk-under">{foot}</div>}
    </div>
  );
}

/** A pick over the models that isn't one (Automatic, Fusion): a row pinned under Find, with what it means now at its end. */
export type PickChoice = { id: string; title: string; note?: string; show?: ReactNode; icon?: ReactNode; disabled?: boolean };
function ChoiceRows({ choices, value, onPick }: { choices: PickChoice[]; value?: string; onPick: (id: string) => void }) {
  return (
    <>
      {choices.map((c) => (
        <button key={c.id} type="button" className="lc-who-row l-focus" data-rove data-on={value === c.id || undefined} aria-pressed={value === c.id} disabled={c.disabled} title={c.disabled ? c.note : undefined} aria-label={c.note ? `${c.title}, ${c.note}` : c.title} onClick={() => onPick(c.id)}>
          {c.icon}
          <span className="lc-who-row-t lc-pk-word">{c.title}</span>
          {c.note && (
            <span className="lc-pk-pair" title={c.note}>
              {c.note}
            </span>
          )}
          {value === c.id && <I.check size={14} className="lc-who-tick" />}
        </button>
      ))}
    </>
  );
}

/**
  A model as a chip that opens the picker, its card at the side where the window has room (else in a line at the list's
  foot). `choices` are pinned under Find for picks that aren't a model ("Automatic", "Fusion"); `value` is then one of
  their ids or a model ref.
*/
export function ModelPop({ label, value, onPick, only, choices = [], align = "end" }: { label: string; value?: string; onPick: (v: string) => void; only?: (p: ProviderInfo) => boolean; choices?: PickChoice[]; align?: "start" | "end" }) {
  const providers = useEngine((s) => s.providers);
  const wide = usePickerWide();
  const choice = choices.find((c) => c.id === value);
  // Its name from every model, so a pick the lists now leave out (Hermes's Go, when OpenCode has Go) is still named.
  const model = !choice && value ? everyModel(providers).find((m) => m.ref === value) : undefined;
  // Named with what it holds, as the composer's chips are ("Effort: High. Change it"): its own name alone would hide the pick.
  const now = choice ? [choice.title, choice.note].filter(Boolean).join(", ") : value ? (model?.label ?? value.slice(value.indexOf(":") + 1)) : "none picked";
  return (
    <Pop
      label={`${label}: ${now}. Change it`}
      width={wide ? PICKER_WIDE : PICKER_NARROW}
      out={pickerOut(align, wide)}
      bare
      align={align}
      triggerClass="lc-mpop"
      trigger={
        <>
          {choice ? (choice.show ?? <span>{choice.title}</span>) : value ? <ModelTag kind={markOf(value)} label={model?.label ?? value.slice(value.indexOf(":") + 1)} size={12} /> : <span className="lc-quiet">Pick a model</span>}
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => <ModelPicker value={model?.ref} only={only} autoFocus side={wide ? "card" : "line"} first={choices.length > 0 && <ChoiceRows choices={choices} value={value} onPick={(id) => (onPick(id), close())} />} onPick={(ref) => (onPick(ref), close())} />}
    </Pop>
  );
}

type Start = NonNullable<EngineSettings["start"]>;
/** What a start says: Fusion, or the one model it starts on (a saved Best is your lead, a saved Fast your sidekick). */
export function startModel(start: Start, cast: { lead: string; sidekick: string } | null): "pair" | string | undefined {
  if (start === "pair") return pairReady(cast) ? "pair" : cast?.lead;
  if (start.startsWith("@")) return start.slice(1);
  return start === "fast" ? cast?.sidekick : cast?.lead;
}
/**
  What a new session starts with, as the message box offers it: Fusion, or a model picked through
  the same picker. `value` is the saved start (a saved Best or Fast reads as the model it means).
*/
export function StartPick({ value, onPick, align = "end" }: { value: Start; onPick: (s: Start) => void; align?: "start" | "end" }) {
  const providers = useEngine((s) => s.providers);
  const picks = useEngine((s) => s.settings.picks);
  const cast = useMemo(() => castOf(providers, { picks }), [providers, picks]);
  const two = pairReady(cast);
  const label = (ref: string) => shortName(modelLabel(ref, providers));
  const fusion: PickChoice = {
    id: "pair",
    title: "Fusion",
    note: two && cast ? `${label(cast.lead)} + ${label(cast.sidekick)}` : "Needs two different models ready",
    icon: <I.fusion size={14} />,
    disabled: !two,
    show: (
      <span className="lc-model">
        <I.fusion size={12} />
        Fusion
      </span>
    ),
  };
  return <ModelPop label="New sessions start with" value={startModel(value, cast)} choices={[fusion]} align={align} onPick={(v) => onPick(v === "pair" ? "pair" : `@${v}`)} />;
}

/**
  The effort as a chip that opens its levels, outside the composer (a new agent, Fusion's lead in Settings): exactly the
  levels of `modelRef` as its tool reports them. Disabled for a model that takes none. A level saved that this model
  doesn't take shows as the model's default, which is what will run, and is never offered. `leave`: levels the place can't
  run (a security scan denies workflows, so no Ultracode there).
*/
export function EffortPick({ modelRef, value, held = true, label = "Effort", onChange, triggerClass = "lc-mpop", align = "end", leave }: { modelRef?: string; value: string; held?: boolean; label?: string; onChange: (id: string) => void; triggerClass?: string; align?: "start" | "end"; leave?: string[] }) {
  const providers = useEngine((s) => s.providers);
  const all = modelRef ? effortsFor(modelRef, providers) : { list: [], fallback: undefined };
  const list = leave ? all.list.filter((e) => !leave.includes(e.id)) : all.list;
  const fallback = all.fallback;
  const shown = effortIn(list, value, fallback);
  const level = list.find((e) => e.id === shown);
  const name = level ? levelName(level.label) : list.length ? "Its own default" : "No effort levels";
  return (
    <Pop label={`${label}: ${name}. Change it`} align={align} width={PICKER.side} triggerClass={triggerClass} disabled={!list.length} trigger={
        <>
          <span className="lc-ctl-label">{name}</span>
          <I.chevD size={12} />
        </>
      }
    >
      {() => (
        <div className="lc-mp" onKeyDown={rove}>
          {/* Left open after a pick: the slider's Left and Right and the switches change it a step at a time. */}
          {/* The stored word, not `shown`: resolved, "" would come in as the tool's default and read as chosen. */}
          <EffortPart list={list} fallback={fallback} value={value} held={held} label={label} tool={providers.find((p) => modelRef?.startsWith(`${p.id}:`))?.label} said={all.said} onPick={onChange} />
        </div>
      )}
    </Pop>
  );
}
