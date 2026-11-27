/*
  Settings open as a pop-up over the app, as T3 Code's do: a large rounded sheet over the dimmed window, with the
  places down its left (a search that narrows them, then five groups, the first and the last with no heading) and one
  place at a time on the right, under a header that says where you are and closes it. Every page has one shape: a
  title over each group, the group a bordered card, and each row a name, one line on why, and one control at its right
  end (settings/parts.tsx, which other pages use too). Looks live in this window (localStorage) and apply at once;
  the rest lives in the engine. Escape, the ×, ⌘, or a click on the dim closes it, and the keys go back to where
  they were.
*/
import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Access, AddonInfo, AgentProfile, AppUpdate, BuiltinProvider, CustomModel, Endpoint, EndpointProtocol, KeyBinding, Project, ProjectRules, ProjectScript, ProviderInfo, RegistryAgent, Thread, Settings as EngineSettings, CheckTier, ToolAccount, ToolCheck, ToolCheckRow, ToolUpdate, UpdateMode } from "@contracts";
import { ACCOUNT_HOME, addonKey, carryOnOn, castOf, ENDPOINT_TOOL, endpointKey, picturesGuess, ROUTINES_ON, toolPicturesKey, updateModes, VOUCHER } from "@contracts";
import { Breadcrumb } from "@liner/components/breadcrumb/breadcrumb";
import { RadioGroup } from "@liner/components/radio-group/radio-group";
import { Segmented } from "@liner/components/segmented/segmented";
import { Select } from "@liner/components/select/select";
import { Slider } from "@liner/components/slider/slider";
import { toast } from "@liner/components/toast/toast";
import { feedback } from "@liner/lib/feedback";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { Agentic } from "./Agentic";
import { ownChanged, useBackgroundUrl } from "./Backdrop";
import { bridge, isNative } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I, ModelMark, StepMark } from "./icons";
import { ACCESS_LEVELS, accessOf, agentOf, ago, dollars, effortIn, effortsFor, levelName, listedProjects, markOf, modelLabel, plural, providerLabel, shortName, since } from "./model";
import { appIcon, dayOf } from "./Addon";
import { rowWords, SideFacts, SideMark, SideRow } from "./SideList";
import { markLabelOf, markStateOf, prSaid } from "./session-state";
// Liner Design's picture model settings load when that page of Settings is shown.
const PicturesSettings = lazy(() => import("./design/Pictures").then((m) => ({ default: m.PicturesSettings })));
import { ModesPlace } from "./Modes";
import { StartPick } from "./Models";
import { startSaid } from "./start-words";
import { Badge, ConfirmRow, Disc, Kbd, LookAgain, MenuFoot, ModelTag, NamedSwitch, PanelHead, Pop, Row, Sep } from "./ui";
import { confirmPress } from "./confirm";
import { CONFIRM_LAPSE } from "./confirm";
import { bindingsOf, commandOn, COMMANDS, FIXED, glyphs, onBindings, readBindings, specOf } from "./keymap";
import { current, fromVSCode, readThemes, saveThemes, type Theme } from "./themes";
import { appHasNews, sizeOf, updates } from "./Updates";
import { groupOf, SERVICES } from "./services";
import * as os from "./os";
import { applyLook, DESK_MAX, deskShow, entering, homeInOf, homeOf, lessGlass, LOOK_DEFAULT, LOOK_KEY, readLook, seeThrough, type ActionColour, type BehindHome, type DesignsWhere, type Glass, type Look, type Motion } from "./look";
import { openBehindHome } from "./Dots";
import { keptWrite, wordRead, wordWrite } from "./kept.ts";
import { jsonFault } from "./json-words";
import { PaneCheck, PaneNote } from "./Pane";
import { Section as Group, Row as Field, Tag } from "./settings/parts";
import { findPlaces, MOVED, PAGE_IDS, PLACES, placeOf, type PlaceGroup, type SettingsPage } from "./settings/places";
import { SourceControlPlace } from "./settings/SourceControl";
import { LinerMcpPlace } from "./settings/LinerMcp";
import "./settings.css";

const isMac = /Mac/.test(navigator.platform);

const ACCENTS = [
  { id: "blue", color: "oklch(0.6 0.19 258)" },
  { id: "violet", color: "oklch(0.58 0.2 292)" },
  { id: "teal", color: "oklch(0.62 0.12 195)" },
  { id: "orange", color: "oklch(0.68 0.17 50)" },
  { id: "rose", color: "oklch(0.62 0.2 12)" },
];
/** The main buttons' colours (look.ts): red, the accent you picked, or ink. */
const ACTIONS: { id: ActionColour; label: string; color: string }[] = [
  { id: "red", label: "Red", color: "oklch(0.6 0.215 27)" },
  { id: "accent", label: "The accent", color: "var(--l-accent)" },
  { id: "ink", label: "Ink", color: "var(--lc-ctl)" },
];

/** Each place's icon in the column; its name, group and search words are in settings/places.ts. */
const ICONS: Record<SettingsPage, ReactNode> = {
  general: <I.sliders />,
  appearance: <I.contrast />,
  keyboard: <I.keyboard />,
  tools: <I.chip />,
  agents: <I.agents />,
  fusion: <I.flow />,
  permissions: <I.shield />,
  projects: <I.folder />,
  source: <I.branch />,
  worktrees: <I.fork />,
  mcp: <I.plug />,
  addons: <I.blocks />,
  archive: <I.box />,
  about: <I.info />,
};
const HEADINGS: PlaceGroup[] = ["", "Agents", "Code", "Connections", "foot"];
/** Each page's one grey line under its title (board Settings): what the page is for, in a sentence. */
const PAGE_LINES: Record<SettingsPage, string> = {
  general: "How Liner Code opens, how new sessions start, and what it tells you while agents work.",
  appearance: "The look of the app: its mode and colours, what sits behind Home, and how things move.",
  keyboard: "Every shortcut, and the keys you gave them.",
  tools: `Liner Code runs the agent tools already on ${os.here}, signed in as you. It has no model of its own.`,
  agents: "Agents of your own, and the modes a session starts in.",
  fusion: "Who leads, who is its sidekick, and who reads each change.",
  permissions: "What an agent may do without asking, and what always asks.",
  projects: "The folders agents work in, and what each starts with.",
  source: "Where your code lives, its pull requests and issues, and how commits are written.",
  worktrees: "A branch and folder of its own for each session, so sessions never edit the same files.",
  mcp: "Agents and apps outside Liner Code that may use it, and how far they reach.",
  addons: "Connections, panels and apps added to Liner Code.",
  archive: "Sessions you archived: bring one back, or delete it for good.",
  about: "Liner Code's version and updates, the agent tools' updates, and where its data lives.",
};

type Props = { initial?: string; onClose: () => void; onAgent: (agent?: AgentProfile) => void; onOpen?: (threadId: string) => void; /** Shut and on its way out (App keeps it for its fade, as a dialog's): it takes no presses and has given the keyboard back. */ closing?: boolean };

/** What can take the keyboard inside the sheet, for keeping Tab in it. */
const TABBABLE = "a[href], button:not(:disabled), input:not(:disabled):not([type='hidden']), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1']), [contenteditable='true']";

/** Memoised: App hands it callbacks of one identity, so a session's news elsewhere doesn't redraw the page you're reading. */
export const Settings = memo(function Settings({ initial = "general", onClose, onAgent, onOpen, closing: leaving = false }: Props) {
  // The place asked for last (App writes it for lc:open-settings), by its own id or an old one (settings/places.ts MOVED).
  const [ask] = useState(() => placeOf(wordRead(sessionStorage, "lc:settings", [...PAGE_IDS, ...Object.keys(MOVED)], initial)));
  const [page, setPage] = useState<SettingsPage>(ask.page);
  // The group to bring up once the page is drawn, when an old place became one group of a page (Notifications in General).
  const [at, setAt] = useState<string | undefined>(ask.at);
  const [query, setQuery] = useState("");
  const [look, setLook] = useState<Look>(readLook);
  const [sound, setSound] = useState(feedback.enabled);
  // Held here, not in General, so Restore defaults shows the Enter it puts back.
  const [enter, setEnter] = useState<"queue" | "steer">(() => wordRead(localStorage, "lc:enter", ["queue", "steer"], "queue") as "queue" | "steer");
  const scroller = useRef<HTMLDivElement>(null);
  const find = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // At Quick motion each place shows as it is when you open it, its header's crumbs too (look.ts, entering).
  const paper = useRef<HTMLElement>(null);
  useLayoutEffect(() => entering(paper.current), [page]);
  const place = PLACES.find((p) => p.id === page) ?? PLACES[0];
  const archived = useEngine((s) => s.threads.filter((t) => t.archived).length);

  useEffect(() => wordWrite(sessionStorage, "lc:settings", page), [page]);
  // The sheet takes the keyboard as it opens (its page's heading, for a screen reader), and gives it back, when it
  // closes, to what had it: the button or the field you opened Settings from.
  // It gives it back as it starts to leave, not when its fade ends. What had it is read as the sheet is first drawn: by the
  // time an effect runs, the app under it has gone inert and the browser has already moved the focus off it to the page.
  const [was] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const giveBack = useRef(() => {});
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    let given = false;
    giveBack.current = () => {
      if (given) return;
      given = true;
      if (was?.isConnected && !was.closest("[inert]")) was.focus({ preventScroll: true });
    };
    return () => giveBack.current();
  }, []);
  useEffect(() => {
    if (leaving) giveBack.current();
  }, [leaving]);
  // Asked for a place while already open (Check for Updates…, a notice's Details); the place's heading takes the focus.
  useEffect(() => {
    const on = (e: Event) => {
      const to = placeOf((e as CustomEvent).detail);
      setPage(to.page);
      setAt(to.at);
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("lc:open-settings", on);
    return () => window.removeEventListener("lc:open-settings", on);
  }, []);
  // A place opens at its top, or at the group an old place became.
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const el = at ? sc.querySelector<HTMLElement>(`[data-anchor="${at}"]`) : null;
    sc.scrollTop = el ? Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16) : 0;
  }, [page, at]);
  useEffect(() => {
    const off = feedback.subscribe(setSound);
    return () => void off();
  }, []);
  // Escape closes, unless something inside (a menu, a field, a dialog) takes it first; ⌘F finds a setting. The listener stays; it calls the latest onClose.
  const closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        find.current?.focus();
        find.current?.select();
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector("dialog[open]")) return;
      closing.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Tab and Shift-Tab go round the sheet, never out to the app under it.
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const box = sheet.current;
    if (!box || !box.contains(e.target as Node)) return;
    const all = [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.checkVisibility() && !el.closest("[inert]"));
    if (!all.length) return;
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
  };
  // In Find a setting: Escape clears what you typed and keeps the field, the next one closes Settings; Enter opens the first place found.
  const onFindKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      return query ? setQuery("") : onClose();
    }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const first = findPlaces(query)[0];
    if (first) (e.preventDefault(), go(first.id));
  };
  // A click that starts and ends on the dim closes; one that starts in the sheet (a text selection dragged out) doesn't.
  const downOnDim = useRef(false);

  const setLookPart = (patch: Partial<Look>) => {
    const next = { ...look, ...patch };
    setLook(next);
    keptWrite(localStorage, LOOK_KEY, next);
    applyLook(next);
  };

  // A search narrows the places to those whose name or settings match.
  const groups = useMemo(() => {
    const hits = findPlaces(query);
    return HEADINGS.map((g) => ({ id: g, items: hits.filter((p) => p.group === g) })).filter((g) => g.items.length);
  }, [query]);
  // The open place again goes back to the top of its page.
  const go = (id: SettingsPage) => {
    setAt(undefined);
    if (id === page) return scroller.current?.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    setPage(id);
    feedback.play("tick", 3);
  };

  // The list keeps the open place in sight when it runs past the column.
  useEffect(() => {
    const box = nav.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const room = 32;
    const by = r.top < b.top + room ? r.top - b.top - room : r.bottom > b.bottom - room ? r.bottom - b.bottom + room : 0;
    if (by) box.scrollBy({ top: by, behavior: calm() ? "auto" : "smooth" });
  }, [page]);
  // The list fades where it runs on past an edge.
  useEffect(() => {
    const box = nav.current;
    if (!box) return;
    const edges = () => {
      box.toggleAttribute("data-up", box.scrollTop > 2);
      box.toggleAttribute("data-down", box.scrollTop + box.clientHeight < box.scrollHeight - 2);
    };
    edges();
    box.addEventListener("scroll", edges, { passive: true });
    const ro = new ResizeObserver(edges);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    return () => (box.removeEventListener("scroll", edges), ro.disconnect());
  }, []);
  // Up and Down walk the places, Home and End jump to the ends.
  const walk = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(nav.current?.querySelectorAll<HTMLElement>("[data-walk]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  // What "Restore defaults" puts back on each place, if anything. General's takes Notifications' with it, as they share a page now.
  const restore: Partial<Record<SettingsPage, () => void>> = {
    general: () => {
      save({ worktrees: false, notify: true, badge: true, menuBar: true });
      feedback.setEnabled(false);
      setEnter("queue");
      wordWrite(localStorage, "lc:enter", "queue");
    },
    // The parts LOOK_DEFAULT has no word for (your own theme, colours and picture) go too, or they'd stay on.
    appearance: () => setLookPart({ ...LOOK_DEFAULT, custom: undefined, accentColor: undefined, actionColor: undefined, background: undefined, bgBlur: undefined, bgShow: undefined, bgFrost: undefined, sea: undefined, home: "sea", homeIn: undefined, dots: undefined }),
    fusion: () => save({ review: true, reviewRounds: 2, reviewSmall: false, maxActiveSubagents: 4 }),
    permissions: () => save({ defaultAccess: "auto", guardDestructive: true }),
  };
  const reset = restore[page];
  // The app's version, at the foot of the column of places.
  const version = useEngine((x) => x.version);

  const row = (p: (typeof PLACES)[number]) => {
    const on = p.id === page;
    return (
      <li key={p.id}>
        <button type="button" className="lc-st-place l-focus" data-walk aria-current={on ? "page" : undefined} aria-label={p.id === "archive" && archived ? `${p.label}, ${archived}` : undefined} onClick={() => go(p.id)}>
          <span className="lc-st-place-i" aria-hidden>
            {ICONS[p.id]}
          </span>
          <span className="lc-st-place-t">{p.label}</span>
          {p.id === "archive" && archived > 0 && (
            <span className="lc-st-count" aria-hidden>
              {archived}
            </span>
          )}
          {p.fresh && <Tag tone="new">New</Tag>}
        </button>
      </li>
    );
  };

  return (
    <div
      className="lc-st-pop"
      data-closing={leaving || undefined}
      inert={leaving || undefined}
      onPointerDown={(e) => (downOnDim.current = e.target === e.currentTarget)}
      onClick={(e) => e.target === e.currentTarget && downOnDim.current && onClose()}
    >
      <div ref={sheet} className="lc-st-sheet" role="dialog" aria-modal="true" aria-label="Settings" onKeyDown={trap}>
        <div className="lc-st-side">
          <div className="lc-sb-find lc-st-find" role="search">
            <I.search size={16} />
            <input ref={find} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" onKeyDown={onFindKey} />
            {query ? (
              <button type="button" className="lc-ib l-focus" aria-label="Clear" onClick={() => (setQuery(""), find.current?.focus())}>
                <I.close size={14} />
              </button>
            ) : (
              <span className="lc-sb-key">{isMac ? "⌘F" : "Ctrl F"}</span>
            )}
          </div>
          <nav ref={nav} className="lc-st-nav" aria-label="Settings" onKeyDown={walk}>
            <div className="lc-st-nav-in">
              {groups.map((g) => (
                <div key={g.id || "first"} className="lc-st-grp" role="group" aria-label={g.id === "" ? "Liner Code" : g.id === "foot" ? "Archive and about" : g.id} data-foot={(g.id === "foot" && !query) || undefined}>
                  {g.id !== "" && g.id !== "foot" && (
                    <span className="lc-st-label" aria-hidden>
                      {g.id}
                    </span>
                  )}
                  <ul className="lc-st-places">{g.items.map(row)}</ul>
                </div>
              ))}
              {query && !groups.length && <p className="lc-sb-empty">No setting matches that.</p>}
            </div>
          </nav>
          {version && <p className="lc-st-version">Liner Code {version}</p>}
        </div>
        <main ref={paper} className="lc-st-paper">
          <header className="lc-st-top">
            <Breadcrumb separator="slash" items={[{ label: "Settings", onSelect: () => go("general") }, { label: place.label }]} className="lc-st-crumbs" />
            <span className="lc-grow" />
            <button type="button" className="lc-ib l-focus" aria-label="Close Settings" title="Close (Esc)" onClick={onClose}>
              <I.close size={16} />
            </button>
          </header>
          <div ref={scroller} className="lc-st-scroll">
            <div className="lc-st-col" key={page}>
              {/* The page's title in the name's face and one grey line on what it is for; focus lands on the title when Settings opens or changes place. */}
              <header className="lc-st-head">
                <h1 ref={heading} tabIndex={-1}>
                  {place.label}
                </h1>
                <p>{PAGE_LINES[place.id]}</p>
              </header>
              {page === "general" && <General go={go} onSetup={onClose} enter={enter} setEnter={setEnter} sound={sound} />}
              {page === "appearance" && <Appearance look={look} set={setLookPart} />}
              {page === "keyboard" && <Keyboard />}
              {page === "tools" && <Models />}
              {page === "agents" && <AgentsAndModes onAgent={onAgent} onClose={onClose} />}
              {page === "fusion" && <Agentic onOpen={onOpen} />}
              {page === "permissions" && <Safety />}
              {page === "projects" && <Projects />}
              {page === "source" && <SourceControlPlace />}
              {page === "worktrees" && <Git />}
              {page === "mcp" && <LinerMcpPlace />}
              {page === "addons" && <AddonsPlace />}
              {page === "archive" && <Archive />}
              {page === "about" && <About />}
              {reset && (
                <p className="lc-st-restore">
                  <button type="button" className="lc-linkbtn l-focus" onClick={() => (reset(), toast("Put back as it came"))}>
                    Restore defaults
                  </button>
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
});


/** Reduced motion: scrolls jump rather than glide. */
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
/** One empty list, so a store read of a missing one doesn't change every time. */
const NONE: never[] = [];
/** Tools with a driver that hasn't been run against the real tool yet. */
const UNTRIED = new Set(["cursor", "grok", "antigravity"]);
/** The models a tool listed, as its chips show them: its "default" stands for one of them, so it isn't counted. */
const listedCount = (p: ProviderInfo) => p.models.filter((m) => m.id !== "default").length;
/** Where Google says how Antigravity may be used, which the tool's row points to. */
const ANTIGRAVITY_TERMS = "https://antigravity.google/terms";
const save = (patch: Partial<EngineSettings>) => void rpc("settings.save", patch).catch(fail);
const tilde = os.tilde;

/** A small accent tag beside something that just arrived. */
const New = () => <Tag tone="new">New</Tag>;

/* ---------------------------------- General ---------------------------------- */

function General({ go, onSetup, enter, setEnter, sound }: { go: (p: SettingsPage) => void; onSetup: () => void; enter: "queue" | "steer"; setEnter: (v: "queue" | "steer") => void; sound: boolean }) {
  const s = useEngine((x) => x.settings);
  const providers = useEngine((x) => x.providers);
  // Who'd do what, from your picks (Agentic.tsx writes them).
  const cast = castOf(providers, { picks: s.picks });
  const label = (ref?: string) => (ref ? modelLabel(ref, providers) : "");
  const start = s.start ?? (cast && cast.lead !== cast.sidekick ? "pair" : "best");
  return (
    <>
      <Group title="When Liner Code opens">
        <Field title="Opens in" note="Code for sessions, Design for front ends, Security for looking after projects.">
          <Segmented
            size="sm"
            value={s.openIn ?? "code"}
            onValueChange={(v) => save({ openIn: v as "code" | "design" | "security" })}
            options={[
              { value: "code", label: "Code" },
              { value: "design", label: "Design" },
              { value: "security", label: "Security" },
            ]}
            aria-label="Liner opens in"
          />
        </Field>
      </Group>
      <Group title="New sessions">
        {/* The message box's own choice: Fusion, or a model picked through the same panel. */}
        {/* The note says what Home will really start with (startOf, as Home reads it), and when your pick's tool isn't ready, that it waits. */}
        <Field title="Start with" note={startSaid(s, providers, label, shortName)}>
          <StartPick value={start} onPick={(v) => save({ start: v })} />
        </Field>
        <Field title="Where they run" note="A worktree is a branch and folder of its own, so sessions never edit the same files.">
          <Segmented
            size="sm"
            value={s.worktrees ? "tree" : "here"}
            onValueChange={(v) => save({ worktrees: v === "tree" })}
            options={[
              { value: "here", label: "This checkout" },
              { value: "tree", label: "A new worktree" },
            ]}
            aria-label="Where new sessions run"
          />
        </Field>
        {/* The level itself is picked under Permissions, where each one says what it lets through. */}
        <Field title="Permissions" note={accessOf(s.defaultAccess).note}>
          <button type="button" className="lc-st-link l-focus" onClick={() => go("permissions")}>
            {accessOf(s.defaultAccess).label}
            <I.chevR size={14} />
          </button>
        </Field>
        <Field title="Fusion and the Reviewer" note="Who leads, who is its sidekick, and who reads each change.">
          <button type="button" className="lc-st-link l-focus" onClick={() => go("fusion")}>
            Open
            <I.chevR size={14} />
          </button>
        </Field>
      </Group>
      <Group title="While an agent works">
        <Field title="Enter" note={`What Enter does with a message you write while a turn runs. ${os.mod}Enter does the other.`}>
          <Segmented
            size="sm"
            value={enter}
            onValueChange={(v) => {
              setEnter(v);
              wordWrite(localStorage, "lc:enter", v);
            }}
            options={[
              { value: "queue", label: "Queues it" },
              { value: "steer", label: "Steers now" },
            ]}
            aria-label="What Enter does"
          />
        </Field>
        <Field title={`Keep the ${os.machine} awake`} note={`No idle sleep while a session${ROUTINES_ON ? " or a routine run" : ""} works. The display still sleeps.`}>
          <NamedSwitch name={`Keep the ${os.machine} awake`} checked={s.keepAwake !== false} onCheckedChange={(keepAwake) => save({ keepAwake })} />
        </Field>
      </Group>
      {/* Notifications had a place of their own; an old link to it lands here (settings/places.ts). */}
      <Group title="Notifications" anchor="notifications">
        <Field title="Tell me when a session needs me" note="When an agent waits for you, finishes, or runs into a problem.">
          <NamedSwitch name="Tell me when a session needs me" checked={s.notify} onCheckedChange={(notify) => save({ notify })} />
        </Field>
        <Field title={os.windows ? "Mark them on the taskbar" : "Count them on the Dock"} note={os.windows ? "A red dot on the taskbar button while sessions need you." : "The Dock icon shows how many sessions need you."}>
          <NamedSwitch name={os.windows ? "Mark them on the taskbar" : "Count them on the Dock"} checked={s.badge} onCheckedChange={(badge) => save({ badge })} />
        </Field>
        <Field title={os.windows ? "Show them in the notification area" : "Show them in the menu bar"} note="A ring that counts what works and what waits; its menu opens a session or allows a request.">
          <NamedSwitch name={os.windows ? "Show them in the notification area" : "Show them in the menu bar"} checked={s.menuBar !== false} onCheckedChange={(menuBar) => save({ menuBar })} />
        </Field>
        <Field title="Sounds" note="Soft ticks when you pick, toggle and send.">
          <NamedSwitch name="Sounds" checked={sound} onCheckedChange={(on) => feedback.setEnabled(on)} />
        </Field>
      </Group>
      {/* The prompt check (Precheck.tsx, engine/src/precheck.ts) and the note of your own changes (engine/src/edits.ts): both change what reaches the agent. */}
      <Group title="When you send">
        <Field title="Check a message before it goes" note="A row over the box when a draft looks like several tasks. It reads only your words and never holds the message.">
          <NamedSwitch name="Check a message before it goes" checked={s.precheck !== false} onCheckedChange={(precheck) => save({ precheck })} />
        </Field>
        <Field title="Ask whether it belongs in this session" note="On a new subject, the tool's quick model asks one short question, on your plan or key. Off unless you turn it on." off={s.precheck === false}>
          <NamedSwitch name="Ask whether it belongs in this session" checked={s.precheckModel === true} disabled={s.precheck === false} onCheckedChange={(precheckModel) => save({ precheckModel })} />
        </Field>
        <Field title="Tell the agent which files changed" note="Names and line counts only, never what's in them, ahead of your message.">
          <NamedSwitch name="Tell the agent which files changed between turns" checked={s.shareEdits !== false} onCheckedChange={(shareEdits) => save({ shareEdits })} />
        </Field>
      </Group>
      <Group title="Usage and spending">
        <Field title="When a tool runs out of usage" note="Carry on: another account or a ready model takes over, with the conversation so far.">
          <Segmented
            size="sm"
            value={s.onLimit ?? "wait"}
            onValueChange={(v) => save({ onLimit: v as "wait" | "carry" })}
            options={[
              { value: "wait", label: "Wait for it" },
              { value: "carry", label: "Carry on" },
            ]}
            aria-label="When a tool runs out of usage"
          />
        </Field>
        <Field title="Carry on when the limit resets" note="A session waiting on its tool's limit goes on a minute after it resets. Off unless you turn it on.">
          <NamedSwitch name="Carry on when the limit resets" checked={s.resumeAtReset ?? false} onCheckedChange={(resumeAtReset) => save({ resumeAtReset })} />
        </Field>
        <Field title="Carry on after a restart" note="A turn cut off by a quit or a restart goes on when Liner Code opens again; one you stopped stays stopped.">
          <NamedSwitch name="Carry on after a restart" checked={s.continueAfterRestart ?? true} onCheckedChange={(continueAfterRestart) => save({ continueAfterRestart })} />
        </Field>
        <Field title="Monthly budget" note="Usage shows how much is gone. Nothing stops at it.">
          <span className="lc-st-budget">
            <span className="lc-quiet">$</span>
            <input
              className="lc-input"
              key={s.budgetUsd ?? 0}
              defaultValue={s.budgetUsd || ""}
              placeholder="None"
              inputMode="decimal"
              aria-label="Monthly budget in dollars"
              onBlur={(e) => {
                const n = Math.round(dollars(e.target.value));
                // The field says what's kept, whatever was typed.
                e.target.value = n ? String(n) : "";
                if (n !== (s.budgetUsd ?? 0)) save({ budgetUsd: n });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </span>
        </Field>
        <Field title="Spend limit" note={`A session${ROUTINES_ON ? " or routine run" : ""} that spends this much stops and tells you; only Claude Code reports cost.`}>
          <span className="lc-st-budget">
            <span className="lc-quiet">$</span>
            <input
              className="lc-input"
              key={s.capUsd ?? 0}
              defaultValue={s.capUsd || ""}
              placeholder="None"
              inputMode="decimal"
              aria-label="Spend limit per session in dollars"
              onBlur={(e) => {
                const n = Math.round(dollars(e.target.value) * 100) / 100;
                e.target.value = n ? String(n) : "";
                if (n !== (s.capUsd ?? 0)) save({ capUsd: n });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </span>
        </Field>
      </Group>
      <Group title="Settle sessions on their own">
        <Field title="When its pull request merges" note="Settled sessions fold away under Settled, still searchable. Off unless you turn it on.">
          <NamedSwitch name="When its pull request merges" checked={s.settleOnMerge ?? false} onCheckedChange={(settleOnMerge) => save({ settleOnMerge })} />
        </Field>
        {/* Only about routine runs, so it goes while routines are switched off (contracts, ROUTINES_ON). */}
        {ROUTINES_ON && (
          <Field title="When a routine run handled everything itself" note="A run that waits for you stays in its project.">
            <NamedSwitch name="When a routine run handled everything itself" checked={s.settleOnRoutine ?? false} onCheckedChange={(settleOnRoutine) => save({ settleOnRoutine })} />
          </Field>
        )}
        <Field title="When nothing has happened for a while" note="Only sessions that wait on nothing from you.">
          <Segmented
            size="sm"
            value={String(s.settleDays)}
            onValueChange={(v) => save({ settleDays: Number(v) })}
            options={[
              { value: "0", label: "Never" },
              { value: "1", label: "1 day" },
              { value: "3", label: "3 days" },
              { value: "7", label: "A week" },
            ]}
            aria-label="Settle after"
          />
        </Field>
      </Group>
      {/* Anonymous usage counts (engine/src/usage-ping.ts): on unless turned off, and off drops what was counted. */}
      <Group title="Liner Code itself">
        <Field title="Share anonymous usage counts" note="Once a day: an install id, the version, your OS and chip, and token counts. Never your code, words, projects or models.">
          <NamedSwitch name="Share anonymous usage counts" checked={s.usagePing !== false} onCheckedChange={(usagePing) => save({ usagePing })} />
        </Field>
        {/* Another tool's sign-in is read only with this on (engine/src/providers/opencode-go.ts). */}
        <Field title="Read OpenCode Go's key for its limits" note="Sends the Go key OpenCode or Hermes saved to opencode.ai only, to show what your plan has left. Off unless you turn it on.">
          <NamedSwitch name="Read OpenCode Go's key for its limits" checked={s.readGoKey === true} onCheckedChange={(readGoKey) => save({ readGoKey })} />
        </Field>
        <Field title="Show the Demo" note="A scripted agent and sample project, for trying Liner Code without a model or account.">
          <NamedSwitch name="Show the Demo" checked={s.showDemo === true} onCheckedChange={(showDemo) => save({ showDemo })} />
        </Field>
        <Field title="Run the setup again" note={`Find the agent tools on ${os.here}, add projects, and choose how you work.`}>
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => (save({ onboarded: false }), onSetup())}>
            Start setup
          </button>
        </Field>
      </Group>
    </>
  );
}

/* --------------------------------- Appearance --------------------------------- */

/** Choices as cards: a small picture, the name, a line; the picked one ringed and ticked. */
function PictureCards<T extends string>({ label, value, options, onPick }: { label: string; value: T | ""; options: { value: T; title: string; note: string; picture: ReactNode }[]; onPick: (v: T) => void }) {
  return (
    <span className="lc-st-modes" role="radiogroup" aria-label={label} data-n={options.length}>
      {options.map((m) => (
        <button key={m.value} type="button" role="radio" aria-checked={value === m.value} className="lc-st-mode l-focus" data-on={value === m.value || undefined} onClick={() => onPick(m.value)}>
          {value === m.value && (
            <span className="lc-st-tick" aria-hidden>
              <I.check size={12} />
            </span>
          )}
          {m.picture}
          <span className="lc-st-mode-t">
            <b>{m.title}</b>
            <small>{m.note}</small>
          </span>
        </button>
      ))}
    </span>
  );
}

/** Where designs and pages open, each drawn small: the chat with a card and the design in the panel, or the design wide in the chat. */
const DESIGNS: { value: DesignsWhere; title: string; note: string; picture: ReactNode }[] = [
  {
    value: "panel",
    title: "Beside the chat",
    note: "Full size in the panel, a small card in the chat",
    picture: (
      <span className="lc-st-pic" data-kind="panel" aria-hidden>
        <span className="lc-st-pic-chat">
          <span className="lc-st-pic-l" style={{ width: "70%" }} />
          <span className="lc-st-pic-card" />
          <span className="lc-st-pic-l" style={{ width: "80%" }} />
          <span className="lc-st-pic-in" />
        </span>
        <span className="lc-st-pic-panel">
          <span className="lc-st-pic-art" />
        </span>
      </span>
    ),
  },
  {
    value: "chat",
    title: "In the chat",
    note: "Wide, as part of the answer",
    picture: (
      <span className="lc-st-pic" data-kind="chat" aria-hidden>
        <span className="lc-st-pic-chat">
          <span className="lc-st-pic-l" style={{ width: "55%" }} />
          <span className="lc-st-pic-art" />
          <span className="lc-st-pic-in" />
        </span>
      </span>
    ),
  },
];

/** What's behind Home, under its control. */
const HOME_NOTES: Record<BehindHome, string> = {
  none: "Plain paper behind the message box on Home.",
  sea: "A whale in fine dots swims behind the message box on Home.",
  dots: "A picture, words or a drawing of your own, in dots, behind the message box on Home.",
};

/** What each level of Motion does, under its control. */
const MOTION_NOTES: Record<Motion, string> = {
  full: "Every view slides in and comes into focus each time you open it. Reduce motion turns it all off.",
  quick: "A view you open is there at once; what arrives while you watch still comes into focus.",
};

/**
  Carry on's one switch (the owner's ruling, 2026-11-27): on by default; off, Home has no cards, the sidebar's More menu
  no Carry on row, and nothing looks for work to carry on (CarryOn.tsx is not mounted). It is the engine's, so it holds
  in every window.
*/
function CarryOnField() {
  const on = useEngine((x) => carryOnOn(x.settings));
  return (
    <Field title="Carry on" note="Work to pick up, as three cards under the box. Off, it leaves the sidebar's More menu too.">
      <NamedSwitch name="Show Carry on on Home" checked={on} onCheckedChange={(carryOn) => save({ carryOn })} />
    </Field>
  );
}

function Appearance({ look, set }: { look: Look; set: (p: Partial<Look>) => void }) {
  // One of your themes holds the mode and the accent; choosing either goes back to Liner's own.
  const own = look.custom ? readThemes().find((t) => t.id === look.custom) : undefined;
  const held = own ? `${own.name} sets this while it's in use. Choosing one here goes back to Liner's own.` : undefined;
  return (
    <>
      <Group title="Theme">
        <Field title="Mode" note={held ?? `Light, dark, or whatever ${os.windows ? "Windows" : "the Mac"} is set to.`}>
          <Segmented
            size="sm"
            value={own ? "" : look.theme}
            onValueChange={(theme) => set({ theme: theme as Look["theme"], custom: undefined })}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
            aria-label="Mode"
          />
        </Field>
        <Field title="Accent" note={held ?? "One colour, spent on selection and focus."}>
          <span className="lc-swatches" role="radiogroup" aria-label="Accent">
            {ACCENTS.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={!own && look.accent === a.id} aria-label={a.id} title={a.id} className="lc-swatch l-focus" data-on={(!own && look.accent === a.id) || undefined} style={{ background: a.color }} onClick={() => set({ accent: a.id, custom: undefined })} />
            ))}
            {look.accentColor && (
              <button type="button" role="radio" aria-checked={!own && look.accent === "own"} aria-label="Your own colour" title="Your own colour" className="lc-swatch l-focus" data-on={(!own && look.accent === "own") || undefined} style={{ background: look.accentColor }} onClick={() => set({ accent: "own", custom: undefined })} />
            )}
          </span>
        </Field>
        <Field title="A colour of your own" note="Liner keeps the text on it easy to read.">
          <label className="lc-btn lc-st-colour l-focus-within" data-kind="secondary" data-size="sm">
            <input type="color" aria-label="A colour of your own" value={look.accentColor ?? "#2f7ae5"} onChange={(e) => set({ accent: "own", accentColor: e.target.value, custom: undefined })} />
            {look.accentColor && <span className="lc-st-colour-dot" style={{ background: look.accentColor }} aria-hidden />}
            Choose a colour
          </label>
        </Field>
      </Group>
      <Group title="Home" tag={<New />}>
        <Field title="Behind Home" note={HOME_NOTES[homeOf(look)]}>
          <Segmented
            size="sm"
            value={homeOf(look)}
            onValueChange={(home) => set({ home })}
            options={[
              { value: "none", label: "Nothing" },
              { value: "sea", label: "The sea" },
              { value: "dots", label: "Your dots" },
            ]}
            aria-label="Behind Home"
          />
        </Field>
        {homeOf(look) !== "none" && (
          <Field title="Shows in" note="For the sea or your dots. With one look only, the other shows plain paper.">
            <Segmented
              size="sm"
              value={homeInOf(look)}
              onValueChange={(homeIn) => set({ homeIn })}
              options={[
                { value: "both", label: "Both looks" },
                { value: "dark", label: "Dark only" },
                { value: "light", label: "Light only" },
              ]}
              aria-label="Shows in"
            />
          </Field>
        )}
        {homeOf(look) === "dots" && (
          <Field lead={<span className="lc-st-tile lc-st-dots" aria-hidden />} title="Your dots" note="The picture, dots, colour, light and motion are set on Home itself.">
            <button type="button" className="lc-btn" data-kind="secondary" data-size="sm" onClick={openBehindHome}>
              Change on Home
            </button>
          </Field>
        )}
        <CarryOnField />
      </Group>
      <Group title="Main buttons" note="Send, and Start in the first-run setup; every other action is in ink.">
        <Field title="Colour">
          <span className="lc-swatches" role="radiogroup" aria-label="Main buttons">
            {ACTIONS.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={look.action === a.id} aria-label={a.label} title={a.label} className="lc-swatch l-focus" data-on={look.action === a.id || undefined} style={{ background: a.color }} onClick={() => set({ action: a.id })} />
            ))}
            {look.actionColor && (
              <button type="button" role="radio" aria-checked={look.action === "own"} aria-label="Your own colour" title="Your own colour" className="lc-swatch l-focus" data-on={look.action === "own" || undefined} style={{ background: look.actionColor }} onClick={() => set({ action: "own" })} />
            )}
          </span>
        </Field>
        <Field title="A colour of your own" note="Liner keeps the text on it easy to read.">
          <label className="lc-btn lc-st-colour l-focus-within" data-kind="secondary" data-size="sm">
            <input type="color" aria-label="A colour of your own for the main buttons" value={look.actionColor ?? "#e5484d"} onChange={(e) => set({ action: "own", actionColor: e.target.value })} />
            {look.actionColor && <span className="lc-st-colour-dot" style={{ background: look.actionColor }} aria-hidden />}
            Choose a colour
          </label>
        </Field>
      </Group>
      <Group title="Glass">
        <Field title="Message box" note="How much of the thread shows through the message box, blurred.">
          <Segmented
            size="sm"
            value={look.composer}
            onValueChange={(composer) => set({ composer: composer as Glass })}
            options={[
              { value: "clear", label: "Clear" },
              { value: "tinted", label: "Tinted" },
              { value: "solid", label: "Solid" },
            ]}
            aria-label="Message box glass"
          />
        </Field>
      </Group>
      <Group title="Motion">
        <Field title="How much moves" note={MOTION_NOTES[look.motion]}>
          <Segmented
            size="sm"
            value={look.motion}
            onValueChange={(motion) => set({ motion: motion as Motion })}
            options={[
              { value: "full", label: "Full" },
              { value: "quick", label: "Quick" },
            ]}
            aria-label="Motion"
          />
        </Field>
      </Group>
      <Group title="Designs and pages" note="Where a design or page an agent shows you opens; each can still open the other way.">
        <Field title="Open them" below>
          <PictureCards label="Where designs and pages open" value={look.designs} options={DESIGNS} onPick={(designs) => set({ designs })} />
        </Field>
        <Field title="Bring the panel up when an agent shows one" note="Beside the chat only, and not while you're in Changes or a terminal." off={look.designs === "chat"}>
          <NamedSwitch name="Bring the panel up when an agent shows one" checked={look.designsAuto} disabled={look.designs === "chat"} onCheckedChange={(designsAuto) => set({ designsAuto })} />
        </Field>
      </Group>
      <Group title="Background" note="A picture behind the session, or the desktop behind the whole window.">
        <Field title="Behind the work" below>
          <Backgrounds value={look.background ?? "none"} onPick={(background) => set({ background })} />
        </Field>
        {look.background === "desktop" ? (
          seeThrough() && (
            <>
              {lessGlass() && <Field title="The window stays solid" note="Reduce transparency is on (System Settings › Accessibility › Display); turn it off to see the desktop." />}
              <Field title="Shows through" note="How much of the desktop comes through, never so much that the text gets hard to read.">
                <Slider label="Shows through" min={15} max={DESK_MAX * 100} step={5} unit="%" marks={false} value={Math.round(deskShow(look) * 100)} onValueChange={(v) => set({ bgShow: v / 100 })} />
              </Field>
              <Field title="Blur the desktop" note="Softens what's behind into colour; it costs the graphics card more when something moves behind.">
                <NamedSwitch name="Blur the desktop" checked={look.bgFrost === true} onCheckedChange={(bgFrost) => set({ bgFrost })} />
              </Field>
            </>
          )
        ) : look.background && look.background !== "none" && (
          <>
            <Field title="Blur" note="Softer keeps the eye on the work.">
              <Slider label="Blur" min={8} max={48} step={2} unit="px" marks={false} value={look.bgBlur ?? 28} onValueChange={(bgBlur) => set({ bgBlur })} />
            </Field>
            <Field title="Shows through" note="How much of the picture comes through.">
              <Slider label="Shows through" min={15} max={75} step={5} unit="%" marks={false} value={Math.round((look.bgShow ?? 0.45) * 100)} onValueChange={(v) => set({ bgShow: v / 100 })} />
            </Field>
          </>
        )}
      </Group>
      <Themes look={look} set={set} />
    </>
  );
}

/** One picture as a tile; None and Desktop draw their own. `off`: it can't be picked here, and says why. */
function BgTile({ id, label, on, onPick, children, off }: { id: string; label: string; on: boolean; onPick: () => void; children?: ReactNode; off?: string }) {
  const url = useBackgroundUrl(id);
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} aria-disabled={off ? true : undefined} title={off ?? label} className="lc-bgs-t l-focus" data-on={on || undefined} data-id={id} onClick={off ? undefined : onPick}>
      {url ? <img src={url} alt="" draggable={false} /> : children}
    </button>
  );
}

/** None, the desktop behind the window, your own picture, and the landscapes this Mac keeps; a new picture of your own from a file. */
function Backgrounds({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const [list, setList] = useState<{ pictures: { id: string; name: string }[]; own: boolean } | null>(null);
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const desk = seeThrough();
  // Where Desktop can't be picked, why: the Mac app without its addon (a build from source without Node's headers), or not the Mac app.
  const why = window.linerShell?.platform === "darwin" ? "isn't available in this build" : "is only in the Mac app";
  useEffect(() => {
    void rpc("background.list", {})
      .then(setList)
      .catch(() => setList({ pictures: [], own: false }));
  }, [n]);
  const add = (file: File) => {
    setBusy(true);
    const r = new FileReader();
    r.onload = () => {
      const data = String(r.result).split(",")[1] ?? "";
      void rpc("background.save", { data, name: file.name })
        .then(() => {
          ownChanged();
          setN((x) => x + 1);
          onPick("own");
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    };
    r.onerror = () => (setBusy(false), toast.error("Liner Code couldn't read that file."));
    r.readAsDataURL(file);
  };
  const remove = () =>
    void rpc("background.remove", {})
      .then(() => {
        ownChanged();
        setN((x) => x + 1);
        if (value === "own") onPick("none");
      })
      .catch(fail);
  return (
    <div className="lc-bgs">
      <div className="lc-bgs-grid" role="radiogroup" aria-label="Behind the work">
        <BgTile id="none" label="None" on={value === "none" || (value === "desktop" && !desk)} onPick={() => onPick("none")}>
          None
        </BgTile>
        <BgTile id="desktop" label="Desktop" on={value === "desktop" && desk} onPick={() => onPick("desktop")} off={desk ? undefined : `Desktop ${why}`}>
          <span className="lc-bgs-desk" />
          <span>Desktop</span>
        </BgTile>
        {list?.own && <BgTile id="own" label="Your picture" on={value === "own"} onPick={() => onPick("own")} />}
        {list?.pictures.map((p) => <BgTile key={p.id} id={p.id} label={p.name} on={value === p.id} onPick={() => onPick(p.id)} />)}
        <label className="lc-bgs-t lc-bgs-add l-focus-within" title="A picture of your own" data-busy={busy || undefined}>
          <input type="file" aria-label="A picture of your own" accept="image/jpeg,image/png,image/heic,image/heif,image/tiff,image/gif,image/webp" onChange={(e) => (e.target.files?.[0] && add(e.target.files[0]), (e.target.value = ""))} />
          {busy ? <span className="l-shimmer">Adding</span> : <I.plus size={16} />}
        </label>
      </div>
      <p className="lc-bgs-note">
        {list && !list.pictures.length ? "Add a picture of your own with +." : "Photos from this Mac's Desktop Pictures, or your own with +."}
        {desk ? " Desktop makes the window see-through." : ` Desktop, a see-through window, ${why}.`}
        {list?.own && (
          <>
            {" "}
            <button type="button" className="lc-linkbtn l-focus" onClick={remove}>
              Remove your picture
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/* Themes of your own: a VS Code theme brought in, or a few colours of your choosing. */
function Themes({ look, set }: { look: Look; set: (p: Partial<Look>) => void }) {
  const [list, setList] = useState<Theme[]>(readThemes);
  const [making, setMaking] = useState<Theme | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const keep = (next: Theme[]) => (saveThemes(next), setList(next));
  // While one of your themes is on, the page's colours are its: Liner's chip names its own axes so it shows what Use gives.
  // Your own accent is already on the page, over the theme's, so the chip takes it from there.
  const dark = look.theme === "dark" || (look.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const liner = look.custom ? { theme: dark ? "dark" : "light", accent: look.accent === "own" ? (look.accentColor ? undefined : "blue") : look.accent } : undefined;
  const take = (text: string, name?: string) => {
    const r = fromVSCode(text, name);
    if (!r.theme) return void toast.error(r.error ?? "That theme didn't read.");
    keep([...list, r.theme]);
    set({ custom: r.theme.id });
    setPasting(false);
    setPasted("");
    toast.success(`Using ${r.theme.name}`, { description: `A ${r.theme.base} theme from VS Code` });
  };
  const make = () => {
    const base = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setMaking({ id: `t${Date.now().toString(36)}`, name: "", base, from: "mine", colors: current(base) });
  };
  return (
    <Group
      title="Your themes"
      note="A VS Code colour theme, or one you make from a few colours; it sets the mode and accent too."
      end={
        <span className="lc-st-c">
          <input ref={file} type="file" accept=".json,.jsonc,application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((t) => take(t, f.name));
            e.target.value = "";
          }} />
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => file.current?.click()}>
            Import from VS Code
          </button>
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={make}>
            <I.plus size={14} />
            Make one
          </button>
        </span>
      }
    >
      <ThemeRow name="Liner" note="Light, dark and the accent above" colors={null} liner={liner} on={!look.custom} onUse={() => set({ custom: undefined })} />
      {list.map((t) => (
        <ThemeRow
          key={t.id}
          name={t.name}
          note={`${t.base === "dark" ? "Dark" : "Light"}${t.from === "vscode" ? ", from VS Code" : ", your own"}`}
          colors={t.colors}
          on={look.custom === t.id}
          onUse={() => set({ custom: t.id })}
          onEdit={t.from === "mine" ? () => setMaking(t) : undefined}
          onRemove={() => {
            keep(list.filter((x) => x.id !== t.id));
            if (look.custom === t.id) set({ custom: undefined });
          }}
        />
      ))}
      {making && (
        <div className="lc-st-form lc-th-make">
          <div className="lc-st-form-g">
            <label>
              <span>Name</span>
              <input className="lc-input" autoFocus value={making.name} onChange={(e) => setMaking({ ...making, name: e.target.value })} placeholder="Evening" />
            </label>
            <label>
              <span>Base</span>
              <Segmented size="sm" value={making.base} onValueChange={(base) => setMaking({ ...making, base: base as Theme["base"] })} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} aria-label="Base" />
            </label>
            <span className="lc-th-colors lc-st-form-w">
              {(["bg", "surface", "ink", "accent"] as const).map((k) => (
                <label key={k} className="lc-th-color">
                  <input type="color" value={making.colors[k]} onChange={(e) => setMaking({ ...making, colors: { ...making.colors, [k]: e.target.value } })} />
                  <span>{{ bg: "Window", surface: "Paper", ink: "Ink", accent: "Accent" }[k]}</span>
                </label>
              ))}
            </span>
          </div>
          <div className="lc-st-form-f">
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setMaking(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="lc-btn"
              data-kind="ink"
              data-size="sm"
              disabled={!making.name.trim()}
              onClick={() => {
                const t = { ...making, name: making.name.trim() };
                keep(list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]);
                set({ custom: t.id });
                setMaking(null);
              }}
            >
              {list.some((x) => x.id === making.id) ? "Save" : "Use it"}
            </button>
          </div>
        </div>
      )}
      {pasting ? (
        <div className="lc-st-form">
          <textarea className="lc-input lc-mono" rows={6} autoFocus value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{ "name": "My theme", "type": "dark", "colors": { "editor.background": "#1e1e2e", … } }' spellCheck={false} aria-label="A VS Code theme's JSON" />
          <div className="lc-st-form-f">
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setPasting(false)}>
              Cancel
            </button>
            <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={!pasted.trim()} onClick={() => take(pasted)}>
              Use it
            </button>
          </div>
        </div>
      ) : (
        <p className="lc-st-none lc-quiet">
          Or{" "}
          <button type="button" className="lc-linkbtn l-focus" onClick={() => setPasting(true)}>
            paste a theme's JSON
          </button>
          . In VS Code, Developer: Generate Color Theme From Current Settings writes one.
        </p>
      )}
    </Group>
  );
}

function ThemeRow({ name, note, colors, liner, on, onUse, onEdit, onRemove }: { name: string; note: string; colors: Theme["colors"] | null; liner?: { theme: string; accent?: string }; on: boolean; onUse: () => void; onEdit?: () => void; onRemove?: () => void }) {
  return (
    <Field
      lead={
        <span className="lc-th-chip" aria-hidden data-theme={liner?.theme} data-accent={liner?.accent} style={colors ? { background: colors.bg } : undefined}>
          <span style={colors ? { background: colors.surface, color: colors.ink } : undefined}>Aa</span>
          <i style={colors ? { background: colors.accent } : undefined} />
        </span>
      }
      title={
        <>
          {name} {on && <Badge tone="ok">In use</Badge>}
        </>
      }
      note={note}
    >
      {onEdit && (
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onEdit}>
          Change
        </button>
      )}
      {!on && (
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={onUse}>
          Use
        </button>
      )}
      {onRemove && (
        <button type="button" className="lc-ib l-focus" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}>
          <I.trash size={14} />
        </button>
      )}
    </Field>
  );
}

/* ---------------------------------- Keyboard ---------------------------------- */

function Keyboard() {
  const mine = useEngine((x) => x.settings.keybindings) ?? NONE;
  const [, setSeen] = useState(0);
  useEffect(() => onBindings(() => setSeen((n) => n + 1)), []);
  const [recording, setRecording] = useState<string | null>(null);
  const [json, setJson] = useState(() => JSON.stringify(mine, null, 2));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setJson(JSON.stringify(mine, null, 2)), [JSON.stringify(mine)]);
  const put = (list: KeyBinding[]) => save({ keybindings: list });
  // Recording: the next press with a modifier (or a function key) becomes the command's keys.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      const spec = specOf(e);
      if (!spec) return;
      if (!/^(mod|ctrl|alt)\+/.test(spec) && !/^(shift\+)?f\d+$/.test(spec)) return toast(os.macKeys ? "Use ⌘, ⌃ or ⌥ with it" : "Use Ctrl or Alt with it", { description: "A key on its own would fire while you type." });
      const clash = COMMANDS.find((c) => c.id !== recording && bindingsOf(c.id).some((b) => b.key === spec));
      put([...mine.filter((b) => b.command !== recording && b.command !== `-${recording}`), { key: spec, command: recording }]);
      if (clash) toast(`${os.keys(spec)} is also ${clash.label.split(":")[0].toLowerCase()}`, { description: "The first in the list wins. Change one of them, or narrow it with when." });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, JSON.stringify(mine)]);
  const groups = [...new Set([...COMMANDS.map((c) => c.group), ...FIXED.map((f) => f.group)])];
  const saveJson = () => {
    const r = readBindings(json);
    if (r.error) return setError(r.error);
    setError(undefined);
    put(r.list ?? []);
    toast.success("Shortcuts saved");
  };
  return (
    <>
      {groups.map((g) => (
        <Group key={g} title={g}>
          {COMMANDS.filter((c) => c.group === g).map((c) => {
            const now = bindingsOf(c.id);
            const changed = mine.some((b) => b.command === c.id || b.command === `-${c.id}`);
            return (
              <Field key={c.id} title={c.label} note={<span className="lc-mono lc-kb-id">{c.id}{now[0]?.when ? ` · when ${now[0].when}` : ""}</span>}>
                {changed && (
                  <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => put(mine.filter((b) => b.command !== c.id && b.command !== `-${c.id}`))}>
                    Reset
                  </button>
                )}
                <button type="button" className="lc-kb-rec l-focus" data-on={recording === c.id || undefined} aria-label={`Change the keys for ${c.label}`} title="Click, then press the new keys" onClick={() => setRecording((r) => (r === c.id ? null : c.id))}>
                  {recording === c.id ? (
                    <span className="lc-quiet">Press the keys</span>
                  ) : now.length ? (
                    <span className="lc-st-keys">
                      {glyphs(now[0].key).map((x, i) => (
                        <Kbd key={i}>{x}</Kbd>
                      ))}
                    </span>
                  ) : (
                    <span className="lc-quiet">None</span>
                  )}
                </button>
              </Field>
            );
          })}
          {FIXED.filter((f) => f.group === g).map((f) => (
            <Field key={f.label} title={f.label}>
              <span className="lc-st-keys">
                {f.keys.map((x) => (
                  <Kbd key={x}>{x}</Kbd>
                ))}
              </span>
            </Field>
          ))}
        </Group>
      ))}
      <Group title="As JSON" note={<>As VS Code's keybindings.json: <span className="lc-mono">-command</span> takes a command's keys away, and <span className="lc-mono">when</span> narrows one to session, composer, review, settings or textInput.</>}>
        <Field title="Your shortcuts" below>
          <textarea className="lc-input lc-mono lc-kb-json" value={json} onChange={(e) => (setJson(e.target.value), setError(undefined))} spellCheck={false} aria-label="Your shortcuts as JSON" rows={Math.min(14, Math.max(5, json.split("\n").length + 1))} placeholder={'[\n  { "key": "mod+shift+n", "command": "new" }\n]'} />
          <span className="lc-kb-f">
            <span className={error ? "lc-kb-err" : "lc-quiet"} role={error ? "alert" : undefined}>
              {error ?? (mine.length ? plural(mine.length, "shortcut") + " of your own" : "Liner Code's own shortcuts, for now")}
            </span>
            <span className="lc-grow" />
            {mine.length > 0 && (
              <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => put([])}>
                Back to the defaults
              </button>
            )}
            <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={json.trim() === JSON.stringify(mine, null, 2).trim()} onClick={saveJson}>
              Save
            </button>
          </span>
        </Field>
      </Group>
    </>
  );
}

/* ----------------------------------- Models ----------------------------------- */

function Models() {
  const providers = useEngine((x) => x.providers);
  const keys = useEngine((x) => x.keys);
  const s = useEngine((x) => x.settings);
  const [looking, setLooking] = useState(false);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyVal, setKeyVal] = useState("");
  const saveKey = async (id: string, key: string | null) => {
    try {
      await bridge.keychainSet(`key:${id}`, key);
      await rpc("keys.set", { provider: id, key });
      // With its key gone Claude Code bills to the plan anyway: the switch says so rather than sitting on a choice it can't take.
      if (id === "anthropic" && !key && s.claudeBilling === "key") save({ claudeBilling: "plan" });
      setKeyFor(null);
      setKeyVal("");
      toast.success(key ? `Key saved in ${os.keyStore()}` : "Key removed");
    } catch (e) {
      fail(e);
    }
  };
  const lookAgain = () => {
    setLooking(true);
    void rpc("providers.refresh", {})
      .catch(fail)
      .finally(() => setLooking(false));
  };
  return (
    <>
      <Group
        title={`Agent tools on ${os.here}`}
        note="Liner Code drives the tools you already have, with your own sign-ins."
        end={
          <LookAgain looking={looking} onLook={lookAgain} />
        }
      >
        {providers
          .filter((p) => p.id !== "demo" && !p.id.includes("."))
          .map((p) => {
            const state = !p.available ? "Not installed" : !p.adapter ? "Soon" : p.signedIn === false ? "Signed out" : "Ready";
            return (
              <div key={p.id} className="lc-st-prov">
                <Field
                  lead={
                    <span className="lc-st-mark">
                      <ModelMark kind={markOf(`${p.id}:`)} size={16} />
                    </span>
                  }
                  title={
                    <>
                      {p.label} <Badge tone={state === "Ready" ? "ok" : state === "Soon" ? "neutral" : "warn"}>{state}</Badge>
                      {UNTRIED.has(p.id) && p.adapter && <Badge tone="neutral">Beta</Badge>}
                    </>
                  }
                  note={p.available ? [p.version ?? "Installed", p.adapter ? p.detail : "Liner Code can't drive it yet"].filter(Boolean).join(" · ") : (p.detail ?? "Not installed")}
                >
                  {p.available && p.adapter && <ToolPictures p={p} />}
                  {p.available && p.adapter ? (
                    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.runInTerminal(p.login)}>
                      {p.signedIn === false ? "Sign in" : "Sign in again"}
                    </button>
                  ) : !p.available && p.install ? (
                    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.runInTerminal(p.install!)}>
                      Install
                    </button>
                  ) : null}
                </Field>
                {p.id === "antigravity" && (
                  <p className="lc-st-terms lc-quiet">
                    Liner Code runs Google's own <code>agy</code>, and Google's terms for Antigravity restrict third-party tools.{" "}
                    <a
                      href={ANTIGRAVITY_TERMS}
                      onClick={(e) => {
                        e.preventDefault();
                        bridge.openExternal(ANTIGRAVITY_TERMS);
                      }}
                    >
                      Google's terms
                    </a>
                  </p>
                )}
                {p.id === "antigravity" && <p className="lc-st-terms lc-quiet">Your own connections reach it only at Full access, never in a side chat: it runs their tools without asking. Only connections that run as a command on this Mac reach it at all; one at an address never does.</p>}
                {p.available && p.adapter && p.models.length > 0 && (
                  <div className="lc-st-models">
                    {p.models
                      .filter((m) => !m.legacy && m.id !== "default")
                      .slice(0, 8)
                      .map((m) => (
                        <span key={m.id} className="lc-st-model" title={m.description}>
                          <ModelTag kind={markOf(`${p.id}:${m.id}`)} label={m.label} />
                        </span>
                      ))}
                    {p.models.filter((m) => !m.legacy && m.id !== "default").length > 8 && <span className="lc-st-model lc-quiet">{p.models.filter((m) => !m.legacy && m.id !== "default").length - 8} more</span>}
                    <span className="lc-st-src lc-quiet">
                      {p.modelsFrom === "cli" ? `${p.label} listed ${listedCount(p) === 1 ? "this" : `these ${listedCount(p)}`}${p.models.some((m) => m.legacy) ? `, ${p.models.filter((m) => m.legacy).length} older` : ""}${p.modelsAt ? `, ${since(p.modelsAt)}` : ""}` : `Asking ${p.label} for its models`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
      </Group>
      <Accounts />
      <AddedAgents />
      <Endpoints />
      <Suspense fallback={null}>
        <PicturesSettings Group={Group} Field={Field} />
      </Suspense>
      <CustomModels />
      <ToolChecks />
      <Group title="Billing and keys" note={`Keys stay in ${os.keyStore("the login keychain")}. The engine only holds them in memory.`}>
        <Field title="Claude Code bills to" note={keys.includes("anthropic") ? "Your plan through Claude Code's own sign-in, or the Anthropic key you added" : "Anthropic asks apps built on its Agent SDK to use an API key: add one below"}>
          <Segmented
            size="sm"
            value={s.claudeBilling}
            onValueChange={(claudeBilling) => save({ claudeBilling })}
            options={[
              { value: "plan", label: "Your Claude plan" },
              { value: "key", label: "API key", disabled: !keys.includes("anthropic") },
            ]}
            aria-label="Claude billing"
          />
        </Field>
        {(["anthropic", "openai"] as const).map((id) => (
          <Field key={id} title={id === "anthropic" ? "Anthropic key" : "OpenAI key"} note={`${id === "anthropic" ? "Used by Claude Code when it bills to the key" : "Used by Codex"} · ${keys.includes(id) ? "saved" : "not set"}`}>
            {keyFor === id ? (
              <span className="lc-keyin">
                <span className="lc-keyin-f">
                  <I.lock size={12} />
                  <input autoFocus type="password" value={keyVal} onChange={(e) => setKeyVal(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && keyVal.trim() ? void saveKey(id, keyVal.trim()) : e.key === "Escape" && setKeyFor(null))} placeholder="Paste the key" aria-label="Key" />
                </span>
                <button type="button" className="lc-btn" data-kind="ink" data-size="sm" onClick={() => keyVal.trim() && void saveKey(id, keyVal.trim())}>
                  Save
                </button>
              </span>
            ) : keys.includes(id) ? (
              <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void saveKey(id, null)}>
                Remove
              </button>
            ) : (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => (setKeyFor(id), setKeyVal(""))}>
                Add key
              </button>
            )}
          </Field>
        ))}
        <Voucher />
      </Group>
    </>
  );
}

/*
  Check my tools (engine/src/doctor.ts): is each tool there, does it work, and does it still do what Liner Code tells it. Tier 1
  runs when this page opens and on Look again; tier 2 (does it obey Read only and Manual) on its button, a few seconds a tool,
  free; tier 3 only from a tool's own button, which says what it spends. Results live in the engine's memory, so they're still
  here when you come back to the page in this run.
*/
const TIER_NAME: Record<CheckTier, string> = { 1: "Found and working", 2: "Obeys Read only and Manual", 3: "Test message" };
function ToolChecks() {
  // The Demo only once you've turned it on, as the model picker has it.
  const showDemo = useEngine((x) => x.settings.showDemo === true);
  const all = useEngine((x) => x.providers);
  const providers = useMemo(() => all.filter((p) => showDemo || p.id !== "demo"), [all, showDemo]);
  const [rows, setRows] = useState<ToolCheckRow[]>([]);
  // What runs now, by tool: the tier it's on.
  const [busy, setBusy] = useState<Record<string, CheckTier>>({});
  const merge = (got: ToolCheckRow[]) =>
    setRows((had) => {
      const by = new Map(had.map((r) => [r.tool, r]));
      for (const r of got) by.set(r.tool, r);
      return [...by.values()];
    });
  const run = async (tier: CheckTier, tools: string[]) => {
    setBusy((b) => ({ ...b, ...Object.fromEntries(tools.map((t) => [t, tier])) }));
    // Every tool in one call: the engine looks at the tools once and starts what each check needs once, which one call a tool
    // at the same time would do over for each of them.
    await rpc("tools.check", tools.length === 1 ? { tool: tools[0] as ProviderInfo["id"], tier } : { tier })
      .then(merge)
      .catch(fail)
      .finally(() =>
        setBusy((b) => {
          const rest = { ...b };
          for (const t of tools) delete rest[t];
          return rest;
        }),
      );
  };
  const ids = providers.map((p) => p.id);
  const key = ids.join(",");
  useEffect(() => {
    void rpc("tools.checked", {})
      .then(merge)
      .catch(() => {});
    if (ids.length) void run(1, ids);
    // Once a page opens, and again when the tools found change (one added or removed).
  }, [key]);
  const any = (tier: CheckTier) => Object.values(busy).includes(tier);
  return (
    <Group
      title="Check my tools"
      note="Whether each tool is there, works, and still obeys the access levels after an update."
      end={
        <LookAgain looking={any(1)} title="Check every tool again" onLook={() => void run(1, ids)} />
      }
    >
      <Field title="Found and working" note="Free and instant; runs when you open this page." />
      <Field title={`Does it obey Read only and ${accessOf("ask").label}?`} note="Free: each tool is pointed at a test model on this Mac with a dummy key, and your sign-ins, settings and sessions aren't touched.">
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={any(2) || !providers.length} onClick={() => void run(2, ids)}>
          {any(2) ? "Checking" : "Check access"}
        </button>
      </Field>
      <Field title="Send it a test message" note="Costs one short message on your plan or key (two for an API endpoint), from a tool's own button below." />
      {providers.map((p) => (
        <ToolCheckRowView key={p.id} p={p} row={rows.find((r) => r.tool === p.id)} busy={busy[p.id]} onMessage={() => void run(3, [p.id])} />
      ))}
    </Group>
  );
}

const STEP_OF: Record<ToolCheck["state"], "done" | "failed" | "skipped"> = { passed: "done", failed: "failed", skipped: "skipped" };
function ToolCheckRowView({ p, row, busy, onMessage }: { p: ProviderInfo; row?: ToolCheckRow; busy?: CheckTier; onMessage: () => void }) {
  const checks = row?.checks ?? [];
  const bad = checks.filter((c) => c.state === "failed").length;
  const at = Math.max(0, ...checks.map((c) => c.at));
  const tiers = ([1, 2, 3] as CheckTier[]).filter((t) => checks.some((c) => c.tier === t) || busy === t);
  const endpoint = p.endpoint !== undefined;
  const ready = p.available && p.signedIn !== false;
  return (
    <div className="lc-ck">
      <Field
        lead={
          <span className="lc-st-mark">
            <ModelMark kind={markOf(`${p.id}:`)} size={16} />
          </span>
        }
        title={
          <>
            {p.label} {busy ? <Badge tone="neutral" mark="working">Checking</Badge> : !p.available && p.endpoint === undefined && p.id !== "demo" ? <Badge tone="warn">Not installed</Badge> : bad ? <Badge tone="danger">{bad === 1 ? "1 check failed" : `${bad} checks failed`}</Badge> : checks.length ? <Badge tone="ok">Passed</Badge> : null}
          </>
        }
        note={busy ? `Running: ${TIER_NAME[busy].toLowerCase()}` : at ? `Checked ${since(at)}` : "Not checked yet"}
      >
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={Boolean(busy) || !ready} title={endpoint ? "Costs two short messages on this endpoint's key" : p.id === "demo" ? "The Demo answers on this Mac, for nothing" : "Costs one short message on this tool's plan or key"} onClick={onMessage}>
          {endpoint ? "Send 2 test messages" : "Send a test message"}
        </button>
      </Field>
      {tiers.length > 0 && (
        <div className="lc-ck-tiers">
          {tiers.map((t) => (
            <div key={t} className="lc-ck-tier">
              <span className="lc-ck-label">{TIER_NAME[t]}</span>
              <ul>
                {busy === t && !checks.some((c) => c.tier === t) ? (
                  <li>
                    <StepMark state="working" size={14} live />
                    <span className="lc-ck-t">
                      <b>Checking</b>
                    </span>
                  </li>
                ) : (
                  checks
                    .filter((c) => c.tier === t)
                    .map((c) => (
                      <li key={c.id} data-s={c.state}>
                        <StepMark state={busy === t ? "working" : STEP_OF[c.state]} live={busy === t} size={14} label={c.state === "skipped" ? "Not checked" : undefined} tone={busy !== t && c.state === "passed" ? "ok" : undefined} />
                        <span className="lc-ck-t">
                          <b>{c.label}</b>
                          {c.detail && <small>{c.detail}</small>}
                        </span>
                      </li>
                    ))
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* A voucher from Liner Code's site: while it's good, its one model is in the picker, under Promo. */
function Voucher() {
  const on = useEngine((x) => x.settings.voucher) ?? false;
  const tool = useEngine((x) => x.providers.find((p) => p.id === `${ENDPOINT_TOOL[VOUCHER.protocol]}.${VOUCHER.id}`));
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const redeem = async (c: string | null) => {
    setBusy(true);
    try {
      // The site checks the code first; only a good one is kept, like a key.
      await rpc("voucher.redeem", { code: c });
      await bridge.keychainSet(`key:${endpointKey(VOUCHER.id)}`, c);
      setOpen(false);
      setCode("");
      if (c) toast.success("Voucher redeemed", { description: "DeepSeek V4.1 Flash is in the model picker, under Promo." });
      else toast("Voucher removed");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const note = !on ? "A code for a model on the house" : tool && !tool.available ? "DeepSeek V4.1 Flash runs through OpenCode: install it above to use it" : "DeepSeek V4.1 Flash, under Promo in the model picker. Its 5-hour and weekly limits show with your others.";
  return (
    <Field title="Voucher" note={note}>
      {open ? (
        <span className="lc-keyin">
          <span className="lc-keyin-f">
            <I.lock size={12} />
            <input autoFocus value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && code.trim() ? void redeem(code.trim()) : e.key === "Escape" && setOpen(false))} placeholder="Type the code" aria-label="Voucher" autoComplete="off" spellCheck={false} />
          </span>
          <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={busy || !code.trim()} onClick={() => void redeem(code.trim())}>
            Redeem
          </button>
        </span>
      ) : on ? (
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={busy} onClick={() => void redeem(null)}>
          Remove
        </button>
      ) : (
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setOpen(true)}>
          Redeem
        </button>
      )}
    </Field>
  );
}

/* Other accounts of a tool: its own config folder, variables and copy of the binary. */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
function envOf(text: string) {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/*
  A row's actions: one is its own button; two or more go under one ··· (the sidebar's rule), so a
  row never shows a line of buttons. `login` is the command a Sign in runs in the Terminal.
*/
function ProviderRow({ p, fallback, onRemove, login, children }: { p?: ProviderInfo; fallback: string; onRemove: () => void; login?: string; children?: ReactNode }) {
  const state = !p ? "Looking" : !p.available ? "Not found" : "Ready";
  return (
    <Field
      lead={
        <span className="lc-st-mark">
          <ModelMark kind={markOf(`${p?.id ?? "other"}:`)} size={16} />
        </span>
      }
      title={
        <>
          {p?.label ?? fallback} <Badge tone={state === "Ready" ? "ok" : state === "Looking" ? "neutral" : "warn"}>{state}</Badge>
        </>
      }
      note={p ? [p.version, p.detail].filter(Boolean).join(" · ") : "Looking for it"}
    >
      {children}
      {login ? (
        <Pop label={`More for ${p?.label ?? fallback}`} menu align="end" width={220} triggerClass="lc-ib" triggerAttrs={{ title: "More" }} trigger={<I.more size={14} />}>
          {(close) => (
            <>
              <Row title="Sign in" note="In the Terminal" icon={<I.terminal size={16} />} onPick={() => (close(), bridge.runInTerminal(login))} />
              <Row title="Remove" icon={<I.trash size={16} />} onPick={() => (close(), onRemove())} />
            </>
          )}
        </Pop>
      ) : (
        <button type="button" className="lc-ib l-focus" aria-label={`Remove ${p?.label ?? fallback}`} title="Remove" onClick={onRemove}>
          <I.trash size={14} />
        </button>
      )}
    </Field>
  );
}

function Accounts() {
  const providers = useEngine((x) => x.providers);
  const accounts = useEngine((x) => x.settings.accounts) ?? NONE;
  const favs = useEngine((x) => x.settings.favoriteModels) ?? NONE;
  const [adding, setAdding] = useState(false);
  const tools = providers.filter((p) => !p.id.includes(".") && p.id !== "demo" && p.adapter);
  return (
    <Group
      title="Other accounts"
      note="The same tool with a sign-in of its own, work and personal or a router, as a tool of its own in the picker."
      end={
        !adding && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAdding(true)}>
            <I.plus size={14} />
            Add an account
          </button>
        )
      }
    >
      {adding && <AccountForm tools={tools} taken={accounts} onDone={() => setAdding(false)} />}
      {accounts.map((a) => {
        const p = providers.find((x) => x.id === `${a.provider}.${a.id}`);
        return (
          <ProviderRow key={`${a.provider}.${a.id}`} p={p} fallback={a.label} login={p?.available ? p.login : undefined} onRemove={() => save({ accounts: accounts.filter((x) => x !== a), favoriteModels: favs.filter((r) => !r.startsWith(`${a.provider}.${a.id}:`)) })} />
        );
      })}
      {!adding && !accounts.length && <p className="lc-st-none lc-quiet">One sign-in per tool so far.</p>}
    </Group>
  );
}

function AccountForm({ tools, taken, onDone }: { tools: ProviderInfo[]; taken: ToolAccount[]; onDone: () => void }) {
  const [tool, setTool] = useState<string>(tools.find((p) => p.available)?.id ?? "claude");
  const [label, setLabel] = useState("");
  const [home, setHome] = useState("");
  const [vars, setVars] = useState("");
  const [binary, setBinary] = useState("");
  const homeVar = ACCOUNT_HOME[tool as BuiltinProvider];
  const id = slug(label);
  const clash = taken.some((a) => a.provider === tool && a.id === id);
  const suggested = `~/.${tool}-${id || "work"}`;
  const add = () => {
    if (!id || clash) return;
    const account: ToolAccount = { id, provider: tool as BuiltinProvider, label: label.trim(), home: homeVar ? home.trim() || suggested : undefined, env: Object.keys(envOf(vars)).length ? envOf(vars) : undefined, binary: binary.trim() || undefined };
    save({ accounts: [...taken, account] });
    toast.success(`Added ${label.trim()}`, { description: "Sign in to it from its row, once Liner Code finds it." });
    onDone();
  };
  return (
    <div className="lc-st-form">
      <div className="lc-st-form-g">
        <label>
          <span>Tool</span>
          <Select options={tools.map((p) => ({ value: p.id, label: p.label }))} value={tool} onValueChange={setTool} placeholder="Tool" />
        </label>
        <label>
          <span>Name</span>
          <input className="lc-input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Work" aria-invalid={clash || undefined} />
        </label>
        {homeVar && (
          <label className="lc-st-form-w">
            <span>Config folder ({homeVar})</span>
            <input className="lc-input lc-mono" value={home} onChange={(e) => setHome(e.target.value)} placeholder={suggested} spellCheck={false} />
          </label>
        )}
        <label className="lc-st-form-w">
          <span>Variables, one a line</span>
          <textarea className="lc-input lc-mono" rows={2} value={vars} onChange={(e) => setVars(e.target.value)} placeholder={tool === "claude" ? "ANTHROPIC_BASE_URL=https://openrouter.ai/api" : "NAME=value"} spellCheck={false} />
        </label>
        <label className="lc-st-form-w">
          <span>Its own copy of the tool (optional)</span>
          <input className="lc-input lc-mono" value={binary} onChange={(e) => setBinary(e.target.value)} placeholder="The one on your PATH" spellCheck={false} />
        </label>
      </div>
      <p className="lc-quiet lc-st-form-n">{clash ? `There's already a ${label.trim()} account for this tool.` : "Variables are kept in Liner Code's settings file. For a secret, use the tool's own sign-in where it has one."}</p>
      <div className="lc-st-form-f">
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={!id || clash} onClick={add}>
          Add account
        </button>
      </div>
    </div>
  );
}

/* Agents you added: from the ACP registry, or a command of your own. */

function AddedAgents() {
  const providers = useEngine((x) => x.providers);
  const added = useEngine((x) => x.settings.addedAgents) ?? NONE;
  const remove = (id: string, label: string) =>
    void rpc("acp.remove", { id })
      .then(() => toast.success(`Removed ${label}`))
      .catch(fail);
  return (
    <Group
      title="Agents you added"
      note="Any agent that speaks the Agent Client Protocol, from the ACP registry or a command you give."
      end={
        <Pop label="Add an agent" align="end" width={440} triggerClass="lc-btn" triggerAttrs={{ "data-kind": "ghost", "data-size": "sm" }} trigger={<><I.plus size={14} />Add an agent</>}>
          {(close) => <Registry onDone={close} />}
        </Pop>
      }
    >
      {added.map((a) => (
        <ProviderRow key={a.id} p={providers.find((x) => x.id === `acp.${a.id}`)} fallback={a.label} onRemove={() => remove(a.id, a.label)}>
          {providers.some((x) => x.id === `acp.${a.id}` && x.available) && <ToolPictures p={providers.find((x) => x.id === `acp.${a.id}`)!} />}
        </ProviderRow>
      ))}
      {!added.length && <p className="lc-st-none lc-quiet">None yet. Gemini CLI, Goose, Amp and many more are in the registry.</p>}
    </Group>
  );
}

/*
  API endpoints: an Anthropic- or OpenAI-compatible service and the models you use from it, run
  through the tool that speaks its protocol (engine/src/providers/endpoint.ts). Its key goes to the
  keychain like the others.
*/
const PROTOCOLS: { value: EndpointProtocol; label: string; note: string; url: string }[] = [
  { value: "anthropic", label: "Anthropic Messages", note: "Runs through Claude Code. DeepSeek, Kimi, GLM and MiniMax have Anthropic-compatible addresses.", url: "https://api.deepseek.com/anthropic" },
  { value: "responses", label: "OpenAI Responses", note: "Runs through Codex. OpenAI, OpenRouter, LM Studio and Ollama speak it.", url: "http://localhost:1234/v1" },
  { value: "chat", label: "OpenAI Chat Completions", note: "Runs through OpenCode: anything else OpenAI-compatible.", url: "https://api.example.com/v1" },
];

function Endpoints() {
  const providers = useEngine((x) => x.providers);
  const endpoints = useEngine((x) => x.settings.endpoints) ?? NONE;
  const favs = useEngine((x) => x.settings.favoriteModels) ?? NONE;
  const [adding, setAdding] = useState(false);
  const remove = (e: Endpoint) => {
    const id = `${ENDPOINT_TOOL[e.protocol]}.${e.id}`;
    save({ endpoints: endpoints.filter((x) => x !== e), favoriteModels: favs.filter((r) => !r.startsWith(`${id}:`)) });
    // The endpoint goes either way; a key left behind is said, as one re-added with the same name would pick it up.
    const kept = (err: unknown) => toast.error("The endpoint is gone, but its key couldn't be removed", { description: err instanceof Error ? err.message : String(err) });
    void bridge.keychainSet(`key:${endpointKey(e.id)}`, null).catch(kept);
    void rpc("keys.set", { provider: endpointKey(e.id), key: null }).catch(kept);
  };
  return (
    <Group
      title="API endpoints"
      note="Models from an API, run through the tool that speaks it: Claude Code, Codex or OpenCode."
      end={
        !adding && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAdding(true)}>
            <I.plus size={14} />
            Add an endpoint
          </button>
        )
      }
    >
      {adding && <EndpointForm taken={endpoints} onDone={() => setAdding(false)} />}
      {endpoints.map((e) => (
        <ProviderRow key={e.id} p={providers.find((x) => x.id === `${ENDPOINT_TOOL[e.protocol]}.${e.id}`)} fallback={e.label} onRemove={() => remove(e)}>
          <EndpointModels e={e} all={endpoints} />
        </ProviderRow>
      ))}
      {!adding && !endpoints.length && <p className="lc-st-none lc-quiet">None yet. A DeepSeek or Kimi key, OpenRouter, or a model running on {os.here} in LM Studio or Ollama.</p>}
    </Group>
  );
}

/**
  An endpoint's models, and whether each takes pictures: what you set, or the guess from its name
  (PICTURE_GUESS), said apart. A model that takes none gets a frame's outline and console errors in
  words instead of its picture (agent-tools.ts wordsOnly); OpenCode is told which kind it is.
*/
function EndpointModels({ e, all }: { e: Endpoint; all: Endpoint[] }) {
  const set = (m: string, v: boolean | null) => {
    const { [m]: _was, ...rest } = e.pictures ?? {};
    const pictures = v === null ? rest : { ...rest, [m]: v };
    save({ endpoints: all.map((x) => (x === e ? { ...e, pictures: Object.keys(pictures).length ? pictures : undefined } : x)) });
  };
  // Back to the guess for every model you set: the menu's ticks set a model each, so a way back to the guesses sits under them.
  const guessAgain = () => save({ endpoints: all.map((x) => (x === e ? { ...e, pictures: undefined } : x)) });
  return (
    <Pop menu label={`Models of ${e.label}`} align="end" width={300} triggerClass="lc-st-ver" trigger={<>{e.models.length === 1 ? e.models[0] : `${e.models.length} models`}<I.chevD size={12} /></>}>
      {() => (
        <>
          <PanelHead>Takes pictures</PanelHead>
          {e.models.map((m) => {
            const mine = e.pictures?.[m];
            const guess = picturesGuess(e.protocol, m);
            return <Row key={m} title={m} which={mine === undefined ? "A guess" : "You set this"} on={mine ?? guess} onPick={() => set(m, !(mine ?? guess))} />;
          })}
          {e.models.some((m) => e.pictures?.[m] !== undefined && e.pictures[m] !== picturesGuess(e.protocol, m)) && (
            <>
              <Sep />
              <Row title="Use the guesses" icon={<I.undo size={14} />} onPick={guessAgain} />
            </>
          )}
          <Sep />
          <MenuFoot>A model that doesn't take pictures gets a frame's outline and console errors in words instead.</MenuFoot>
        </>
      )}
    </Pop>
  );
}

/**
  A tool's own models, and whether each takes pictures: yes unless you say otherwise (Settings.toolPictures,
  read by picturesOf). A model that takes none gets a frame's outline and console errors in words instead of
  its picture (agent-tools.ts wordsOnly).
*/
function ToolPictures({ p }: { p: ProviderInfo }) {
  const mine = useEngine((x) => x.settings.toolPictures) ?? NO_PICS;
  const models = p.models.filter((m) => !m.legacy);
  if (!models.length) return null;
  const set = (m: string, v: boolean | null) => {
    const { [toolPicturesKey(p.id, m)]: _was, ...rest } = mine;
    save({ toolPictures: v === null ? rest : { ...rest, [toolPicturesKey(p.id, m)]: v } });
  };
  // Ticking a model on is going back to the default (null), so the tick alone sets it either way.
  return (
    <Pop menu label={`Pictures for ${p.label}`} align="end" width={300} triggerClass="lc-st-ver" trigger={<>Pictures<I.chevD size={12} /></>}>
      {() => (
        <>
          <PanelHead>Takes pictures</PanelHead>
          {models.map((m) => {
            const set_ = mine[toolPicturesKey(p.id, m.id)];
            return <Row key={m.id} title={m.id === "default" ? m.label : m.id} which={set_ === undefined ? undefined : "You set this"} on={set_ ?? true} onPick={() => set(m.id, set_ === false ? null : false)} />;
          })}
          <Sep />
          <MenuFoot>A model that doesn't take pictures gets a frame's outline and console errors in words instead.</MenuFoot>
        </>
      )}
    </Pop>
  );
}
const NO_PICS: Record<string, boolean> = {};

function EndpointForm({ taken, onDone }: { taken: Endpoint[]; onDone: () => void }) {
  const [service, setService] = useState<string>("other");
  const [label, setLabel] = useState("");
  const [protocol, setProtocol] = useState<EndpointProtocol>("anthropic");
  const [url, setUrl] = useState("");
  const known = SERVICES.find((x) => x.id === service);
  // A service fills in what it is; its name too, unless you've written your own.
  const pickService = (id: string) => {
    const s = SERVICES.find((x) => x.id === id);
    setService(id);
    setFound(null);
    if (!s) return;
    if (!label.trim() || SERVICES.some((x) => x.label === label.trim())) setLabel(s.label);
    setProtocol(s.protocol);
    setUrl(s.url);
  };
  const [key, setKey] = useState("");
  const [models, setModels] = useState("");
  const [found, setFound] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"find" | "add" | null>(null);
  const id = `api-${slug(label)}`;
  const clash = taken.some((e) => e.id === id);
  const list = [...new Set(models.split(/[\s,]+/).map((m) => m.trim()).filter(Boolean))];
  const proto = PROTOCOLS.find((p) => p.value === protocol)!;
  const find = async () => {
    setBusy("find");
    try {
      const ids = await rpc("endpoint.models", { url: url.trim(), protocol, key: key.trim() || undefined });
      setFound(ids);
      if (!ids.length) toast("It listed no models", { description: "Type the ones you use." });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const pick = (m: string) => setModels((list.includes(m) ? list.filter((x) => x !== m) : [...list, m]).join("\n"));
  const add = async () => {
    if (!slug(label) || clash || !url.trim() || !list.length) return;
    setBusy("add");
    try {
      if (key.trim()) {
        await bridge.keychainSet(`key:${endpointKey(id)}`, key.trim());
        await rpc("keys.set", { provider: endpointKey(id), key: key.trim() });
      }
      await rpc("settings.save", { endpoints: [...taken, { id, label: label.trim(), url: url.trim(), protocol, models: list }] });
      toast.success(`Added ${label.trim()}`, { description: `Its models are in the model picker, through ${proto.note.split(".")[0].replace("Runs through ", "")}.` });
      onDone();
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };
  return (
    <div className="lc-st-form">
      <div className="lc-st-form-g">
        <label className="lc-st-form-w">
          <span>Service</span>
          <Select
            options={[...SERVICES.map((s) => ({ value: s.id, label: s.label, hint: s.local ? "no key" : new URL(s.url).host, group: groupOf(s) })), { value: "other", label: "Another service", hint: "its address and protocol", group: "Anything else" }]}
            value={service}
            onValueChange={pickService}
            placeholder="Pick a service"
          />
        </label>
        <label>
          <span>Name</span>
          <input className="lc-input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="DeepSeek" aria-invalid={clash || undefined} />
        </label>
        <label>
          <span>Speaks</span>
          <Select options={PROTOCOLS.map((p) => ({ value: p.value, label: p.label }))} value={protocol} onValueChange={(v) => setProtocol(v as EndpointProtocol)} placeholder="Protocol" />
        </label>
        <p className="lc-st-form-w lc-quiet" style={{ margin: 0, fontSize: 12 }}>
          {proto.note}
        </p>
        <label className="lc-st-form-w">
          <span>Address</span>
          <input className="lc-input lc-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={proto.url} spellCheck={false} />
        </label>
        <label className="lc-st-form-w">
          <span>
            Key {known?.local ? "(none needed)" : `(none for one on ${os.here})`}
            {known?.keys && (
              <>
                {" · "}
                <a
                  href={known.keys}
                  onClick={(e) => {
                    e.preventDefault();
                    bridge.openExternal(known.keys!);
                  }}
                >
                  Get a key
                </a>
              </>
            )}
          </span>
          <input className="lc-input lc-mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={known?.local ? "None needed" : `Kept in ${os.keyStore()}`} autoComplete="off" />
        </label>
        <label className="lc-st-form-w">
          <span>Models, one a line</span>
          <textarea className="lc-input lc-mono" rows={2} value={models} onChange={(e) => setModels(e.target.value)} placeholder="Its model ids, as its docs give them" spellCheck={false} />
        </label>
        {found && found.length > 0 && (
          <div className="lc-st-form-w" style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="Models it lists">
            {found.slice(0, 40).map((m) => (
              // Picked is the pressed plate, not ink: ink is the form's one action, Add endpoint.
              <button key={m} type="button" className="lc-btn lc-st-pick" data-kind="plain" data-size="sm" aria-pressed={list.includes(m)} onClick={() => pick(m)}>
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="lc-quiet lc-st-form-n">{clash ? `There's already an endpoint called ${label.trim()}.` : `Its key goes to ${os.keyStore()}, and only to the tool's process when a session runs on it.`}</p>
      <div className="lc-st-form-f">
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={!url.trim() || busy !== null} onClick={() => void find()}>
          {busy === "find" ? "Asking it" : "Find its models"}
        </button>
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={!slug(label) || clash || !url.trim() || !list.length || busy !== null} onClick={() => void add()}>
          Add endpoint
        </button>
      </div>
    </div>
  );
}

function Registry({ onDone }: { onDone: () => void }) {
  const [list, setList] = useState<RegistryAgent[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [own, setOwn] = useState(false);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const load = (force = false) =>
    void rpc("acp.registry", { force })
      .then((r) => (setList(r.agents), setError(r.error)))
      .catch((e) => (setList([]), setError(e instanceof Error ? e.message : String(e))));
  useEffect(() => load(), []);
  const add = async (params: { registryId: string } | { label: string; command: string }) => {
    setBusy("registryId" in params ? params.registryId : "own");
    try {
      const a = await rpc("acp.add", params);
      toast.success(`Added ${a.label}`, { description: "It's in the model picker now." });
      onDone();
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };
  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter((a) => !q || `${a.name} ${a.description} ${a.id}`.toLowerCase().includes(q));
  if (own)
    return (
      <div className="lc-reg">
        <div className="lc-reg-h">
          <b>A command of your own</b>
          <span className="lc-quiet">It must speak ACP on stdio.</span>
        </div>
        <div className="lc-st-form-g lc-reg-own">
          <label>
            <span>Name</span>
            <input className="lc-input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My agent" />
          </label>
          <label className="lc-st-form-w">
            <span>Command</span>
            <input className="lc-input lc-mono" value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && command.trim() && void add({ label, command })} placeholder="gemini --acp" spellCheck={false} />
          </label>
        </div>
        <div className="lc-st-form-f">
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setOwn(false)}>
            Back to the registry
          </button>
          <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={!command.trim() || busy !== null} onClick={() => void add({ label, command })}>
            {busy ? "Adding" : "Add"}
          </button>
        </div>
      </div>
    );
  return (
    <div className="lc-reg">
      <div className="lc-mp-find lc-reg-find">
        <I.search size={14} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={list ? `Find among ${list.length} agents` : "Reading the ACP registry"} aria-label="Find an agent" spellCheck={false} />
      </div>
      <div className="lc-reg-list" role="list">
        {!list && <p className="l-shimmer lc-reg-none">Reading the ACP registry</p>}
        {list && !shown.length && <p className="lc-quiet lc-reg-none">{error ? `Couldn't read the registry: ${error}` : "No agent matches that."}</p>}
        {shown.map((a) => (
          <div key={a.id} className="lc-reg-row" role="listitem" data-off={!a.runnable || undefined}>
            <span className="lc-reg-t">
              <b>
                {a.name} <span className="lc-quiet l-num">{a.version}</span>
              </b>
              <small title={a.description}>{a.description}</small>
            </span>
            {a.added ? (
              <span className="lc-quiet lc-reg-tag">Added</span>
            ) : !a.runnable ? (
              <span className="lc-quiet lc-reg-tag" title={a.how === "uvx" ? `Install uv (${os.windows ? "winget install astral-sh.uv" : "brew install uv"}) to run it` : a.how === "npx" ? "Install Node.js to run it" : `There's no build for ${os.here}`}>
                {a.how === "binary" ? `Not for ${os.here}` : `Needs ${a.how}`}
              </span>
            ) : (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy !== null} title={a.how === "binary" ? `Downloads it for ${os.here} and checks it` : `Runs through ${a.how}`} onClick={() => void add({ registryId: a.id })}>
                {busy === a.id ? (a.how === "binary" ? "Downloading" : "Adding") : "Add"}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="lc-reg-f">
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setOwn(true)}>
          <I.terminal size={12} />A command of your own
        </button>
        <span className="lc-grow" />
        <LookAgain looking={!list} title="Read the registry again" onLook={() => (setList(null), load(true))} />
      </div>
    </div>
  );
}

/* Model ids a tool takes but doesn't list. */

function CustomModels() {
  const providers = useEngine((x) => x.providers);
  const mine = useEngine((x) => x.settings.customModels) ?? NONE;
  const tools = providers.filter((p) => p.available && p.adapter && p.id !== "demo");
  const [tool, setTool] = useState<string>("");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const pick = tool || tools[0]?.id || "";
  const clash = providers.find((p) => p.id === pick)?.models.some((m) => m.id === id.trim());
  const add = () => {
    if (!pick || !id.trim() || clash) return;
    save({ customModels: [...mine, { provider: pick as CustomModel["provider"], id: id.trim(), label: label.trim() || undefined }] });
    setId("");
    setLabel("");
  };
  return (
    <Group title="Models you added" note="A model id a tool takes but doesn't list, such as a preview or a fine-tune.">
      {mine.map((c) => (
        <Field key={`${c.provider}:${c.id}`} lead={<span className="lc-st-mark"><ModelMark kind={markOf(`${c.provider}:${c.id}`)} size={16} /></span>} title={c.label || c.id} note={`${providerLabel(`${c.provider}:`, providers)} · ${c.id}`}>
          <button type="button" className="lc-ib l-focus" aria-label={`Remove ${c.label || c.id}`} title="Remove" onClick={() => save({ customModels: mine.filter((x) => x !== c) })}>
            <I.trash size={14} />
          </button>
        </Field>
      ))}
      <div className="lc-st-form lc-st-cm">
        <Select options={tools.map((p) => ({ value: p.id, label: p.label }))} value={pick} onValueChange={setTool} placeholder="Tool" />
        <input className="lc-input lc-mono" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Model id" aria-label="Model id" aria-invalid={clash || undefined} spellCheck={false} />
        <input className="lc-input" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Name (optional)" aria-label="Name" />
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={!pick || !id.trim() || clash} title={clash ? "That tool lists it already" : undefined} onClick={add}>
          Add
        </button>
      </div>
    </Group>
  );
}

/* ------------------------------------ Team ------------------------------------ */

function Team({ onAgent }: { onAgent: (agent?: AgentProfile) => void }) {
  const agents = useEngine((x) => x.agents);
  const providers = useEngine((x) => x.providers);
  // An agent's effort by its model's own name for it; a level its model doesn't take reads as the model's default, and a model of no levels shows none.
  const effortNameOf = (model: string, asked: string) => {
    const { list, fallback } = effortsFor(model, providers);
    const at = effortIn(list, asked, fallback);
    const level = list.find((e) => e.id === at);
    return level ? levelName(level.label) : "";
  };
  const threads = useEngine((x) => x.threads);
  // The Demo stays out of sight until you turn it on, here as in the pickers.
  const showDemo = useEngine((x) => x.settings.showDemo === true);
  return (
    <Group
      title="Agents"
      anchor="agents"
      note="A name, a model, its effort, and a soul.md that says how it works."
      end={
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => onAgent()}>
          <I.plus size={14} />
          New agent
        </button>
      }
    >
      {agents.filter((a) => a.id !== "demo" || showDemo).map((a) => {
        const used = threads.filter((t) => t.agent === a.id).length;
        return (
          <Field key={a.id} lead={<span className="lc-st-mark"><Disc agent={a} size={20} /></span>} title={a.name} note={[a.role, a.id === "demo" ? "scripted, no account" : "", plural(used, "session")].filter(Boolean).join(" · ")}>
            {/* Its effort after its model's name, as the message box's who reads: "Sonnet 5.5 · High". */}
            <ModelTag kind={markOf(a.model)} label={a.id === "demo" ? modelLabel(a.model, providers) : [modelLabel(a.model, providers), effortNameOf(a.model, a.effort)].filter(Boolean).join(" · ")} />
            {a.id !== "demo" && (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => onAgent(a)}>
                Edit
              </button>
            )}
          </Field>
        );
      })}
    </Group>
  );
}

/** Agents and modes: your agents, then the modes a new session starts in (Modes.tsx), which were two places. */
function AgentsAndModes({ onAgent, onClose }: { onAgent: (agent?: AgentProfile) => void; onClose: () => void }) {
  return (
    <>
      <Team onAgent={onAgent} />
      <Group title="Modes" anchor="modes" bare note="Standard for everyday tasks, Workshop to add to Liner Code, or one of your own.">
        <ModesPlace onAgent={onAgent} onClose={onClose} />
      </Group>
    </>
  );
}

/* ----------------------------------- Safety ----------------------------------- */

/** Last-match-wins glob permission matrix (allow / ask / deny) evaluated before Auto allowlists. */
function PermissionMatrix({ rules, onSave }: { rules: { kind: "command" | "path"; pattern: string; action: "allow" | "ask" | "deny" }[]; onSave: (next: { kind: "command" | "path"; pattern: string; action: "allow" | "ask" | "deny" }[]) => void }) {
  const [kind, setKind] = useState<"command" | "path">("command");
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<"allow" | "ask" | "deny">("deny");
  // The rule whose × was pressed once, and when (confirm.ts): a deny dropped by a stray click would quietly let a step through.
  const [sure, setSure] = useState<{ key: string; at: number } | null>(null);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(null), CONFIRM_LAPSE);
    return () => clearTimeout(t);
  }, [sure]);
  const add = () => {
    const p = pattern.trim();
    if (!p) return;
    onSave([...rules, { kind, pattern: p, action }]);
    setPattern("");
  };
  return (
    <Group title="Permission rules" note="The last match wins, and Deny beats Auto. At Full access, or where a tool's own Auto lets a step through, nothing is asked, so no rule is read.">
      <Field title="Command and path globs" below>
        <div className="lc-mem">
          {rules.map((r, i) => {
            const key = `${i}:${r.kind}:${r.pattern}`;
            const asked = sure?.key === key;
            return (
              <div key={key} className="lc-mem-row">
                <span className="lc-mono">
                  <b>{r.action.toUpperCase()}</b> · {r.kind}: {r.pattern}
                </span>
                {/* The first press asks, as a project's Remove does; the second click of a double-click is held back. */}
                <button
                  type="button"
                  className={asked ? "lc-btn" : "lc-ib l-focus"}
                  data-kind={asked ? "danger" : undefined}
                  data-size={asked ? "sm" : undefined}
                  aria-label={asked ? `Remove rule ${r.pattern}: press again to remove it` : `Remove rule ${r.pattern}`}
                  onBlur={() => setSure(null)}
                  onClick={() => {
                    const now = performance.now();
                    const step = confirmPress(sure?.key === key ? sure.at : null, now);
                    if (step === "ask") return setSure({ key, at: now });
                    if (step === "wait") return;
                    setSure(null);
                    onSave(rules.filter((_, j) => j !== i));
                  }}
                >
                  {asked ? "Remove it" : <I.close size={14} />}
                </button>
              </div>
            );
          })}
          <form
            className="lc-mem-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            {/* The app's own pickers, not the system's: the group names each for a screen reader, as aria-label did. */}
            <span role="group" aria-label="Rule kind" className="lc-st-rulesel" data-w="kind">
              <Select className="lc-st-sel" options={[{ value: "command", label: "command" }, { value: "path", label: "path" }]} value={kind} onValueChange={(v) => setKind(v as "command" | "path")} />
            </span>
            <input className="lc-input lc-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={kind === "command" ? "git push* or npm publish*" : "**/.env* or secrets/**"} aria-label="Glob pattern" />
            <span role="group" aria-label="Rule action" className="lc-st-rulesel" data-w="action">
              <Select className="lc-st-sel" options={[{ value: "deny", label: "deny" }, { value: "ask", label: "ask" }, { value: "allow", label: "allow" }]} value={action} onValueChange={(v) => setAction(v as "allow" | "ask" | "deny")} />
            </span>
            <button type="submit" className="lc-btn" data-kind="plain" data-size="sm" disabled={!pattern.trim()}>
              Add
            </button>
          </form>
        </div>
      </Field>
    </Group>
  );
}

function Safety() {
  const s = useEngine((x) => x.settings);
  return (
    <>
      <Group title="Permissions" note="What a new session may do without asking; a session can change it from its message box.">
        <div className="lc-st-radios">
          <RadioGroup label="Permissions" showLabel={false} value={s.defaultAccess} onValueChange={(v) => save({ defaultAccess: v as Access })} options={ACCESS_LEVELS.map((l) => ({ value: l.id, label: l.label, description: l.note }))} />
        </div>
      </Group>
      <Group title="Always asks">
        <Field title="Commands that can't be undone" note="Even in Full access: force pushes, rm -rf, sudo, publishing. They come back to you as a request.">
          <NamedSwitch name="Always ask before commands that can't be undone" checked={s.guardDestructive} onCheckedChange={(guardDestructive) => save({ guardDestructive })} />
        </Field>
        <Field title="Committing, pushing and merging" note="Agents never commit, push or merge on their own. Commit stays a press in the Changes panel." />
      </Group>
      <PermissionMatrix rules={s.permissionRules ?? []} onSave={(permissionRules) => save({ permissionRules })} />
    </>
  );
}

/* ---------------------------------- Add-ons ---------------------------------- */

/**
  Add-ons, phase 1: connections, the MCP servers agents asked to add (engine/src/addons.ts). A row
  each, with its versions and a switch; a removed one waits under them to come back. Then who may
  offer one, a start without any, and where they're kept.
*/
function AddonsPlace() {
  const addons = useEngine((x) => x.addons);
  const off = useEngine((x) => x.addonsOff);
  const offers = useEngine((x) => x.settings.addonOffers ?? "ask");
  const network = useEngine((x) => x.settings.addonNetwork ?? "ask");
  const projects = useEngine((x) => x.projects);
  const keys = useEngine((x) => x.keys);
  const home = useEngine((x) => x.home);
  // A restart stops turns where they are, so it waits for the sessions at work.
  const working = useEngine((x) => x.threads.filter((t) => t.status === "running").length);
  const [adding, setAdding] = useState(false);
  const update = (id: string, p: { enabled?: boolean; version?: number; removed?: boolean }) => void rpc("addons.update", { id, ...p }).catch(fail);
  const shown = addons.filter((a) => !a.removed && !a.panel);
  const removed = addons.filter((a) => a.removed && !a.panel);
  const panels = addons.filter((a) => !a.removed && a.panel);
  const gone = addons.filter((a) => a.removed && a.panel);
  const versions = (a: AddonInfo) => (
    <Pop label={`Versions of ${a.name}`} align="end" width={220} triggerClass="lc-st-ver lc-mono" disabled={a.versions.length < 2} trigger={<>v{a.version}{a.versions.length > 1 && <I.chevD size={12} />}</>}>
      {(close) => [...a.versions].reverse().map((v) => <Row key={v} title={`v${v}`} note={[v === a.version ? "In use" : "", a.dates?.[v] ? dayOf(a.dates[v]) : ""].filter(Boolean).join(" · ") || undefined} end={a.dates?.[v] ? dayOf(a.dates[v]) : undefined} on={v === a.version} onPick={() => (update(a.id, { version: v }), close())} />)}
    </Pop>
  );
  const where = (a: AddonInfo) => (a.project ? `${projects.find((p) => p.id === a.project)?.name ?? "One project"} only` : "Every project");
  const keyed = (a: AddonInfo) => (!a.secrets.length ? null : a.secrets.every((k) => keys.includes(addonKey(a.id, k.name))) ? `${a.secrets.length === 1 ? "key" : "keys"} in the keychain` : "a key is missing");
  // The app opens again without them; a window that can't (the browser preview) turns them off until the engine next starts.
  const restart = async () => {
    try {
      await rpc("addons.off", { next: isNative() });
      if (!(await bridge.relaunch())) toast("Add-ons are off", { description: "No tool gets them until Liner Code next starts." });
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      {off && <p className="lc-st-banner">Add-ons are off until Liner Code starts again: none reach any tool.</p>}
      <Group
        title="Connections"
        note="MCP servers that every agent tool gets: Claude Code, Codex, OpenCode and Hermes."
        end={
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <I.plus size={14} />
            Add one by hand
          </button>
        }
      >
        {adding && <AddByHand onDone={() => setAdding(false)} />}
        {shown.map((a) => (
          <Field
            key={a.id}
            lead={
              <span className="lc-st-mark">
                <I.plug size={16} />
              </span>
            }
            title={a.name}
            note={[where(a), keyed(a), `added by ${a.by.agent}${a.by.title ? ` in “${a.by.title}”` : ""}, ${since(a.by.at)}`].filter(Boolean).join(" · ")}
          >
            {a.secrets.length > 0 && <AddonKeys a={a} />}
            {versions(a)}
            <NamedSwitch name={`${a.name} for every agent tool`} checked={a.enabled} onCheckedChange={(enabled) => update(a.id, { enabled })} />
          </Field>
        ))}
        {!shown.length && !adding && <p className="lc-st-none lc-quiet">None yet. Ask an agent to connect a service (“Connect Linear's MCP server”), and it asks you on a card in the session first.</p>}
        {removed.map((a) => (
          <div key={a.id} className="lc-st-removed">
            <I.box size={14} />
            <span>
              Removed: {a.name}, {since(a.removed!)}. Its files are kept.
            </span>
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => update(a.id, { removed: false })}>
              Bring it back
            </button>
          </div>
        ))}
      </Group>
      <Group title="Panels" note="Beside your sessions or on pages of their own, each in a sealed frame with only what it asked for.">
        {panels.map((a) => {
          const Icon = appIcon(a.panel?.icon);
          return (
            <Field
              key={a.id}
              lead={
                <span className="lc-st-mark">
                  <Icon size={16} />
                </span>
              }
              title={a.name}
              note={[a.panel?.place === "page" ? "A page of its own" : where(a).replace(/ only$/, ""), a.reaches, `made by ${a.by.agent}${a.by.title ? ` in “${a.by.title}”` : ""}`].filter(Boolean).join(" · ")}
            >
              {versions(a)}
              <NamedSwitch name={a.name} checked={a.enabled} onCheckedChange={(enabled) => update(a.id, { enabled })} />
            </Field>
          );
        })}
        {!panels.length && <p className="lc-st-none lc-quiet">None yet. Ask an agent for one (“Make me a panel that lists the TODOs”), and it shows it to you, live, before you add it.</p>}
        {gone.map((a) => (
          <div key={a.id} className="lc-st-removed">
            <I.box size={14} />
            <span>
              Removed: {a.name}, {since(a.removed!)}. Its files are kept.
            </span>
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => update(a.id, { removed: false })}>
              Bring it back
            </button>
          </div>
        ))}
      </Group>
      <Group title="Who may add one" note="An agent never adds one on its own: it asks in the session, with what it can touch.">
        <Field title="Agents may offer add-ons" note="In a read-only session they can't, whatever this says.">
          <Segmented size="sm" value={offers} onValueChange={(v) => save({ addonOffers: v })} options={[{ value: "ask" as const, label: "They ask" }, { value: "never" as const, label: "Never" }]} aria-label="Agents may offer add-ons" />
        </Field>
        <Field title="Panels that reach the internet" note="Held like a push: you hold the button, and each names its one address.">
          <Segmented size="sm" value={network} onValueChange={(v) => save({ addonNetwork: v })} options={[{ value: "ask" as const, label: "They ask" }, { value: "never" as const, label: "Never" }]} aria-label="Panels that reach the internet" />
        </Field>
        <Field title="Start without add-ons" note={working ? `Waits for ${plural(working, "working session")} to finish: a restart would stop them.` : "If one gets in the way, open Liner Code once with all of them off."}>
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={working > 0} onClick={() => void restart()}>
            Restart without them
          </button>
        </Field>
        <Field title="Where they live" note={<span className="lc-mono">{tilde(`${home}/addons`)}, version by version</span>}>
          {isNative() && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.reveal(`${home}/addons`)}>
              Show in {os.fileManager}
            </button>
          )}
        </Field>
      </Group>
    </>
  );
}

/** A connection's keys, typed again (one missing, or a new one): sealed in the keychain and handed to the engine, as on its card. */
function AddonKeys({ a }: { a: AddonInfo }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const keep = async (close: () => void) => {
    try {
      for (const k of a.secrets) {
        const v = values[k.name]?.trim();
        if (!v) continue;
        await bridge.keychainSet(`key:${addonKey(a.id, k.name)}`, v);
        await rpc("keys.set", { provider: addonKey(a.id, k.name), key: v });
      }
      setValues({});
      toast.success(`Saved in ${os.keyStore()}`);
      close();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Pop label={`Keys for ${a.name}`} align="end" width={320} triggerClass="lc-st-ver" trigger={a.secrets.length === 1 ? "Key" : "Keys"}>
      {(close) => (
        <div className="lc-st-form lc-st-keys">
          <div className="lc-st-form-g">
            {a.secrets.map((k) => (
              <label key={k.name} className="lc-st-form-w">
                <span>{k.label}</span>
                <input className="lc-input lc-mono" type="password" autoComplete="off" placeholder={k.name} value={values[k.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k.name]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="lc-st-form-f">
            <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={!Object.values(values).some((v) => v.trim())} onClick={() => void keep(close)}>
              Save
            </button>
          </div>
        </div>
      )}
    </Pop>
  );
}

/**
  A connection you add yourself: its manifest, checked as an agent's would be, and a field for each
  key it names. The keys go to the keychain and the engine first, as on the install card.
*/
export function AddByHand({ onDone }: { onDone: () => void }) {
  // Designs on their own are Liner Design's: listed there, not here.
  const projects = listedProjects(useEngine((x) => x.projects));
  const [text, setText] = useState("");
  const [project, setProject] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // The parse's own words, kept beside the manifest: a grey Add it with no reason reads as a broken form.
  const [parsed, why] = useMemo(() => {
    try {
      const m = JSON.parse(text) as { id?: unknown; secrets?: { name?: unknown; label?: unknown }[] } | null;
      // null, a number or a list is JSON too, but no manifest: say that, not a parse error or a TypeError from reading its id.
      if (typeof m !== "object" || m === null || Array.isArray(m)) return [null, "A manifest is a JSON object, between { and }."] as const;
      return [{ id: String(m.id ?? ""), secrets: Array.isArray(m.secrets) ? m.secrets.map((k) => ({ name: String(k.name ?? ""), label: String(k.label ?? k.name ?? "") })).filter((k) => k.name) : [] }, ""] as const;
    } catch (e) {
      // What is wrong and where, without the offset or the manifest echoed back.
      return [null, `That isn't JSON yet: ${jsonFault(e instanceof Error ? e.message : String(e))}`] as const;
    }
  }, [text]);
  const add = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      for (const k of parsed.secrets) {
        const v = values[k.name]?.trim();
        if (!v) continue;
        await bridge.keychainSet(`key:${addonKey(parsed.id, k.name)}`, v);
        await rpc("keys.set", { provider: addonKey(parsed.id, k.name), key: v });
      }
      await rpc("addons.add", { manifest: text, project: project || undefined });
      toast.success("Added for every agent tool");
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lc-st-form lc-st-addhand">
      <textarea
        className="lc-input lc-mono lc-rules-t"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="The connection's manifest"
        aria-invalid={(Boolean(text.trim()) && !parsed) || undefined}
        aria-describedby={Boolean(text.trim()) && !parsed ? "lc-st-addhand-why" : undefined}
        autoFocus
        placeholder={'{\n  "apiVersion": 1,\n  "id": "linear",\n  "kind": "connection",\n  "name": "Linear",\n  "server": { "http": { "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer ${LINEAR_API_KEY}" } } },\n  "secrets": [{ "name": "LINEAR_API_KEY", "label": "Linear key" }]\n}'}
      />
      {text.trim() && !parsed && (
        <p id="lc-st-addhand-why" className="lc-sinfo-note" role="alert">
          {why}
        </p>
      )}
      {Boolean(parsed?.secrets.length) && (
        <div className="lc-st-form-g">
          {parsed!.secrets.map((k) => (
            <label key={k.name}>
              <span>{k.label}</span>
              <input className="lc-input lc-mono" type="password" autoComplete="off" value={values[k.name] ?? ""} placeholder={k.name} onChange={(e) => setValues((v) => ({ ...v, [k.name]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}
      <div className="lc-st-form-f">
        <span className="lc-st-push">
          <Select options={[{ value: "", label: "Every project" }, ...projects.map((p) => ({ value: p.id, label: `${p.name} only` }))]} value={project} onValueChange={setProject} placeholder="Where" />
        </span>
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={busy || !parsed} onClick={() => void add()}>
          {busy ? "Adding" : "Add it"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- Projects ---------------------------------- */

function Projects() {
  // Designs on their own are Liner Design's: listed there, not here.
  const projects = listedProjects(useEngine((x) => x.projects));
  const agents = useEngine((x) => x.agents);
  const threads = useEngine((x) => x.threads);
  const showDemo = useEngine((x) => x.settings.showDemo === true);
  // The fallback goes outside the selector: a fresh [] from inside it is a new snapshot on every read, and React loops until the page breaks.
  const hooksTrusted = useEngine((x) => x.settings.worktreeHooksTrusted) ?? NONE;
  // The project whose Remove was pressed once, and when: a press inside the settle is the same double-click (confirm.ts).
  const [sure, setSure] = useState<{ id: string; at: number } | null>(null);
  const add = () =>
    void bridge.pickFolder().then((p) => {
      if (p)
        void rpc("project.add", { path: p })
          .then((x) => toast.success(`Added ${x.name}`))
          .catch(fail);
    });
  // The Demo is offered while it's on, or while a project (the sample) starts with it, so that one still names who it has.
  const demo = showDemo || projects.some((p) => p.agent === "demo");
  const options = [{ value: "", label: "Whoever Home picks" }, ...agents.filter((a) => a.id !== "demo" || demo).map((a) => ({ value: a.id, label: a.id === "demo" ? "Demo (scripted)" : `${a.name} · ${a.role}` }))];
  return (
    <Group
      title={plural(projects.length, "project")}
      note="Removing a project only forgets it here. Its folder stays as it is."
      end={
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={add}>
          <I.plus size={14} />
          Add a project
        </button>
      }
    >
      {projects.map((p) => {
        const n = threads.filter((t) => t.projectId === p.id && !t.archived).length;
        return (
          <div key={p.id} className="lc-st-proj">
            <Field
              lead={
                <span className="lc-st-mark">
                  <I.folder size={16} />
                </span>
              }
              title={p.name}
              note={
                <>
                  <span className="lc-st-path lc-mono" title={p.path}>
                    {tilde(p.path)}
                  </span>
                  <span>
                    {p.git ? (p.branch ? `On ${p.branch}` : "Git") : "Not a Git repository, so no undo"} · {plural(n, "session")}
                  </span>
                </>
              }
            >
              <span className="lc-st-sel">
                <Select options={options} value={p.agent ?? ""} onValueChange={(agent) => void rpc("project.update", { id: p.id, agent }).catch(fail)} placeholder="Starts with" />
              </span>
              {isNative() && (
                <button type="button" className="lc-ib l-focus" aria-label={`Show ${p.name} in ${os.fileManager}`} title={`Show in ${os.fileManager}`} onClick={() => bridge.reveal(p.path)}>
                  <I.folder size={14} />
                </button>
              )}
              <button
                type="button"
                className="lc-btn"
                data-kind={sure?.id === p.id ? "danger" : "ghost"}
                data-size="sm"
                onBlur={() => setSure(null)}
                onClick={() => {
                  // Every session in it goes too, so the second click of a double-click on Remove is held back, not taken as the confirm.
                  const now = performance.now();
                  const step = confirmPress(sure?.id === p.id ? sure.at : null, now);
                  if (step === "ask") return setSure({ id: p.id, at: now });
                  if (step === "wait") return;
                  setSure(null);
                  void rpc("project.remove", { id: p.id })
                    .then(() => toast(`Forgot ${p.name}`))
                    .catch(fail);
                }}
              >
                {sure?.id === p.id ? "Remove it" : "Remove"}
              </button>
            </Field>
            <ScriptsEditor project={p} />
            <RulesEditor project={p} />
            <MemoryEditor project={p} />
            {p.git && (
              <>
                <Field title="Set up each new worktree" note="Runs in a new worktree before its first turn, since it has none of this checkout's packages.">
                  <input
                    className="lc-input lc-mono lc-st-setup"
                    key={p.setup ?? ""}
                    defaultValue={p.setup ?? ""}
                    placeholder="npm install"
                    spellCheck={false}
                    aria-label={`Setup command for ${p.name}`}
                    onBlur={(e) => e.target.value.trim() !== (p.setup ?? "") && void rpc("project.update", { id: p.id, setup: e.target.value.trim() }).catch(fail)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </Field>
                <Field title="Trust .liner/worktree-setup.sh" note="Runs this repo's worktree-setup.sh on new worktrees, with LINER_WORKTREE_PORT_OFFSET set.">
                  <NamedSwitch
                    name={`Trust worktree setup hook for ${p.name}`}
                    checked={hooksTrusted.includes(p.id)}
                    onCheckedChange={(on) => {
                      const next = on ? [...new Set([...hooksTrusted, p.id])] : hooksTrusted.filter((id) => id !== p.id);
                      save({ worktreeHooksTrusted: next });
                    }}
                  />
                </Field>
              </>
            )}
          </div>
        );
      })}
      {projects.length === 0 && <Field title="No projects yet" note="Add a folder to start a session in it." />}
    </Group>
  );
}

/**
  A project's rules for every agent. Claude Code reads CLAUDE.md and the rest read AGENTS.md, so
  the rules live in AGENTS.md and CLAUDE.md imports it: one text, the same for every tool. Two files
  that differ open together, so nothing is lost when they become one.
*/
/** What agents saved about a project with memory_add: every new session there starts with it. */
function MemoryEditor({ project }: { project: Project }) {
  const [facts, setFacts] = useState<string[] | null>(null);
  const [memFile, setMemFile] = useState<{ exists: boolean; text: string; path: string } | null>(null);
  const [memDraft, setMemDraft] = useState("");
  const [memOpen, setMemOpen] = useState(false);
  const [memSaving, setMemSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [again, setAgain] = useState(0);
  useEffect(() => {
    void Promise.all([rpc("memory.list", { projectId: project.id }), rpc("memory.file.read", { projectId: project.id }).catch(() => null)])
      .then(([f, m]) => {
        setFacts(f);
        if (m) {
          setMemFile(m);
          setMemDraft(m.text);
        }
        setFailed(null);
      })
      .catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [project.id, again]);
  // The field stays while the first read is out, and says a failed one: empty words would read as nothing saved.
  if (failed)
    return (
      <Field title="Workspace memory" below>
        <p className="lc-sinfo-note" role="alert">{failed}</p>
        <LookAgain onLook={() => (setFailed(null), setFacts(null), setAgain((n) => n + 1))} />
      </Field>
    );
  if (!facts) return <Field title="Workspace memory" note={<span className="l-shimmer">Reading what agents saved</span>} below />;
  const add = () => {
    if (!draft.trim()) return;
    void rpc("memory.add", { projectId: project.id, fact: draft })
      .then((f) => (setFacts(f), setDraft("")))
      .catch(fail);
  };
  const saveFile = () => {
    setMemSaving(true);
    void rpc("memory.file.write", { projectId: project.id, text: memDraft })
      .then((m) => {
        setMemFile(m);
        setMemDraft(m.text);
        toast("Saved MEMORY.md");
      })
      .catch(fail)
      .finally(() => setMemSaving(false));
  };
  return (
    <Field title="Workspace memory" note={facts.length ? `${plural(facts.length, "fact")} agents saved here. Every new session in this project starts with them.` : "Nothing yet. Agents save facts here as they learn them (a command that works, a decision you made), and every new session starts with them."} below>
      <div className="lc-mem">
        {facts.map((f, i) => (
          <div key={`${i}:${f}`} className="lc-mem-row">
            <span>{f}</span>
            <button type="button" className="lc-ib l-focus" aria-label={`Forget: ${f}`} title="Forget it" onClick={() => void rpc("memory.forget", { projectId: project.id, fact: f }).then(setFacts).catch(fail)}>
              <I.close size={14} />
            </button>
          </div>
        ))}
        <form
          className="lc-mem-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="lc-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add one yourself, like: tests run with npm test -- --run" aria-label={`Something agents should remember about ${project.name}`} />
          <button type="submit" className="lc-btn" data-kind="plain" data-size="sm" disabled={!draft.trim()}>
            Remember
          </button>
        </form>
        <div style={{ marginTop: 10 }}>
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setMemOpen((o) => !o)}>
            <I.notes size={13} />
            {memOpen ? "Hide MEMORY.md" : memFile?.exists ? "Edit MEMORY.md" : "Create MEMORY.md"}
          </button>
          {memOpen && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                className="lc-input lc-mono"
                rows={6}
                value={memDraft}
                onChange={(e) => setMemDraft(e.target.value)}
                placeholder="# Project Memory\n\n- Build commands, conventions, and decisions distilled from sessions"
                aria-label={`MEMORY.md for ${project.name}`}
              />
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={memSaving} onClick={saveFile}>
                  {memSaving ? "Saving…" : "Save MEMORY.md"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Field>
  );
}

function RulesEditor({ project }: { project: Project }) {
  const [rules, setRules] = useState<ProjectRules | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  // What you've written so far: a press outside closes the pop, and that mustn't lose it.
  const draft = useRef<string | null>(null);
  useEffect(() => {
    void rpc("project.rules", { id: project.id })
      .then((r) => (setRules(r), setFailed(null)))
      .catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [project.id, again]);
  // The field stays while the first read is out, and says a failed one instead of vanishing.
  if (failed)
    return (
      <Field title="Rules for every agent" below>
        <p className="lc-sinfo-note" role="alert">{failed}</p>
        <LookAgain onLook={() => (setFailed(null), setRules(null), setAgain((n) => n + 1))} />
      </Field>
    );
  if (!rules) return <Field title="Rules for every agent" note={<span className="l-shimmer">Reading the rules</span>} />;
  const { claude, agents, linked } = rules;
  const same = linked || (claude !== undefined && agents !== undefined && claude.trim() === agents.trim());
  const note = !claude && !agents ? "None yet. Every agent here reads what you write." : same ? "One text for every agent: AGENTS.md, which CLAUDE.md points to." : !agents ? "Only in CLAUDE.md, so Codex, OpenCode and Cursor don't see them." : !claude ? "Only in AGENTS.md, so Claude Code doesn't see them." : "CLAUDE.md and AGENTS.md say different things.";
  // What the editor starts with: the one text, or both under their names so you can make them one.
  const start = linked || !claude ? (agents ?? "") : !agents || same ? claude : `${agents.trim()}\n\n<!-- From CLAUDE.md -->\n${claude.trim()}\n`;
  return (
    <Field title="Rules for every agent" note={note}>
      <Pop label={`Rules for ${project.name}`} align="end" width={520} triggerClass="lc-btn" trigger={<>{claude || agents ? "Edit" : "Write them"}</>}>
        {(close) => <RulesForm project={project} start={draft.current ?? start} merging={!same && Boolean(claude && agents)} onDraft={(t) => (draft.current = t)} onSaved={(r) => ((draft.current = null), setRules(r), close())} />}
      </Pop>
    </Field>
  );
}

function RulesForm({ project, start, merging, onDraft, onSaved }: { project: Project; start: string; merging: boolean; onDraft: (text: string) => void; onSaved: (r: ProjectRules) => void }) {
  const [text, setText] = useState(start);
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    void rpc("project.rules.save", { id: project.id, text })
      .then((r) => (toast.success("Rules saved", { description: "AGENTS.md has them; CLAUDE.md points to it." }), onSaved(r)))
      .catch(fail)
      .finally(() => setBusy(false));
  };
  return (
    <div className="lc-rules">
      <textarea className="lc-input lc-mono lc-rules-t" value={text} onChange={(e) => (setText(e.target.value), onDraft(e.target.value))} placeholder={"How to build and test, what to leave alone, the house style…"} spellCheck={false} aria-label={`Rules for ${project.name}`} autoFocus />
      <p className="lc-quiet lc-rules-n">{merging ? "Both files are here, one under the other: make them one text. " : ""}Saving writes AGENTS.md and makes CLAUDE.md a one-line @AGENTS.md, which Claude Code follows. Commit them with the project.</p>
      <div className="lc-rules-f">
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={busy || !text.trim()} onClick={save}>
          {busy ? "Saving" : "Save for every agent"}
        </button>
      </div>
    </div>
  );
}

/** A project's scripts: a name, a command, and whether it runs in each new worktree. */
function ScriptsEditor({ project }: { project: Project }) {
  const [list, setList] = useState<ProjectScript[]>(project.scripts ?? []);
  const [npm, setNpm] = useState<string[]>([]);
  useEffect(() => setList(project.scripts ?? []), [JSON.stringify(project.scripts ?? [])]);
  useEffect(() => {
    void rpc("git.branches", { projectId: project.id })
      .then((r) => setNpm(r.npmScripts))
      .catch(() => {});
  }, [project.id]);
  const commit = (next: ProjectScript[]) => {
    setList(next);
    void rpc("project.update", { id: project.id, scripts: next }).catch(fail);
  };
  const edit = (i: number, patch: Partial<ProjectScript>) => setList((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const fresh = npm.filter((n) => !list.some((x) => x.command === `npm run ${n}`)).slice(0, 5);
  return (
    <Field title="Scripts" note="Each gets a run button in the session's header and runs in a Terminal tab of its own. Give one keys to run it from the keyboard in a session." below>
      <span className="lc-scripts">
        {list.map((x, i) => (
          <span key={x.id} className="lc-script">
            <input className="lc-input" value={x.name} onChange={(e) => edit(i, { name: e.target.value })} onBlur={() => commit(list)} placeholder="Name" aria-label="Script name" />
            <input className="lc-input lc-mono" value={x.command} onChange={(e) => edit(i, { command: e.target.value })} onBlur={() => commit(list)} placeholder="npm run dev" aria-label="Command" spellCheck={false} />
            <ScriptKey value={x.key} name={x.name || "the script"} others={list.filter((_, k) => k !== i).map((y) => y.key).filter(Boolean) as string[]} onChange={(key) => commit(list.map((y, k) => (k === i ? { ...y, key } : y)))} />
            <label className="lc-script-wt" title="Also runs in each new worktree, before its first turn">
              <PaneCheck checked={Boolean(x.onWorktree)} label={`Run ${x.name || "the script"} in each new worktree`} onChange={(on) => commit(list.map((y, k) => (k === i ? { ...y, onWorktree: on } : y)))} />
              New worktrees
            </label>
            <button type="button" className="lc-ib l-focus" aria-label={`Remove ${x.name || "the script"}`} onClick={() => commit(list.filter((_, k) => k !== i))}>
              <I.close size={14} />
            </button>
          </span>
        ))}
        <span className="lc-script-add">
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setList((l) => [...l, { id: `s${Date.now().toString(36)}`, name: "", command: "" }])}>
            <I.plus size={14} />
            Add a script
          </button>
          {fresh.map((n) => (
            <button key={n} type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => commit([...list, { id: `s${Date.now().toString(36)}${n}`, name: n, command: `npm run ${n}` }])}>
              npm run {n}
            </button>
          ))}
        </span>
      </span>
    </Field>
  );
}

/** A script's keys: click, then press them (with ⌘, ⌃ or ⌥); the × takes them away. */
function ScriptKey({ value, name, others, onChange }: { value?: string; name: string; others: string[]; onChange: (key: string | undefined) => void }) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const spec = specOf(e);
      if (!spec) return;
      if (!/^(mod|ctrl|alt)\+/.test(spec)) return toast(os.macKeys ? "Use ⌘, ⌃ or ⌥ with it" : "Use Ctrl or Alt with it", { description: "A key on its own would fire while you type." });
      const taken = commandOn(spec);
      if (others.includes(spec)) return toast(`${os.keys(spec)} already runs another script here`);
      if (taken) toast(`${os.keys(spec)} is also ${taken.label.split(":")[0].toLowerCase()}`, { description: "In a session the script wins. Change one of them in Keyboard." });
      onChange(spec);
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, others.join()]);
  return (
    <span className="lc-script-key">
      <button type="button" className="lc-kb-rec lc-script-rec l-focus" data-on={recording || undefined} aria-label={`Keys for ${name}`} title="Click, then press the keys" onClick={() => setRecording((r) => !r)}>
        {recording ? (
          <span className="lc-quiet">Press the keys</span>
        ) : value ? (
          <span className="lc-st-keys">
            {glyphs(value).map((k, i) => (
              <Kbd key={i}>{k}</Kbd>
            ))}
          </span>
        ) : (
          <span className="lc-quiet">Keys</span>
        )}
      </button>
      {value && !recording && (
        <button type="button" className="lc-ib l-focus" aria-label={`Take the keys off ${name}`} title="No keys" onClick={() => onChange(undefined)}>
          <I.close size={14} />
        </button>
      )}
    </span>
  );
}

/* ------------------------------------- Git ------------------------------------- */

function Git() {
  const s = useEngine((x) => x.settings);
  const home = useEngine((x) => x.home);
  const threads = useEngine((x) => x.threads);
  const projects = useEngine((x) => x.projects);
  const trees = threads.filter((t) => t.worktree && !t.archived);
  return (
    <>
      <Group title="Worktrees">
        <Field title="Start new sessions in a worktree" note="Each gets a branch and folder of its own; the same choice as General › Where they run.">
          <NamedSwitch name="Start new sessions in a worktree" checked={s.worktrees} onCheckedChange={(worktrees) => save({ worktrees })} />
        </Field>
        <Field title="Worktree layout" note="New worktrees go under Liner's worktrees folder, or inside the repo in .worktrees/ for direnv and monorepo tools.">
          <Segmented
            size="sm"
            value={s.worktreePlace ?? "sibling"}
            onValueChange={(v) => save({ worktreePlace: v as "sibling" | "inside" })}
            options={[
              { value: "sibling", label: "Liner's folder" },
              { value: "inside", label: "Inside the repo" },
            ]}
            aria-label="Worktree layout"
          />
        </Field>
        <Field title="Where worktrees live" note="Another drive or folder, for big projects; ones already made stay where they are.">
          <span className="lc-st-input lc-st-wide">
            <I.folder size={14} />
            <input
              key={s.worktreeRoot ?? ""}
              defaultValue={s.worktreeRoot ?? ""}
              placeholder={tilde(`${home}/worktrees`)}
              spellCheck={false}
              aria-label="Where worktrees live"
              // Emptied, it goes back to the default: an undefined wouldn't survive the trip to the engine, which would keep the old folder.
              onBlur={(e) => e.target.value.trim() !== (s.worktreeRoot ?? "") && save({ worktreeRoot: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </span>
          {isNative() && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.reveal(s.worktreeRoot?.trim() || `${home}/worktrees`)}>
              Show
            </button>
          )}
        </Field>
        <Field title="Clean up worktrees" note="Removes the worktrees of sessions you archived or deleted. Their branches stay.">
          <button
            type="button"
            className="lc-btn"
            data-kind="plain"
            data-size="sm"
            onClick={() =>
              void rpc("worktrees.clean", {})
                .then((r) => toast(r.removed ? `Removed ${plural(r.removed, "worktree")}` : "Nothing to clean up", { description: `${plural(r.kept, "worktree")} still in use` }))
                .catch(fail)
            }
          >
            Clean up
          </button>
        </Field>
      </Group>
      {trees.length > 0 && (
        <Group title={`In use · ${trees.length}`} note="Deleting a session removes its worktree; the branch stays.">
          {trees.map((t) => (
            <Field
              key={t.id}
              lead={
                <span className="lc-st-mark">
                  <I.branch size={14} />
                </span>
              }
              title={t.title}
              note={
                <>
                  <span className="lc-mono">{t.worktree!.branch}</span> · {projects.find((p) => p.id === t.projectId)?.name ?? "No project"}
                </>
              }
            >
              {isNative() && (
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => bridge.reveal(t.worktree!.path)}>
                  Show
                </button>
              )}
            </Field>
          ))}
        </Group>
      )}
      <Group title="Snapshots">
        <Field title="Every turn is kept" note="Saved as a commit under refs/liner/ before and after each turn, for Undo turn and Changes; your staging area isn't touched." />
        <Field title="Folders that aren't repositories" note="Get no snapshots, so no diff and no undo; git init gives them both." />
      </Group>
    </>
  );
}

/* ----------------------------------- Archive ----------------------------------- */

function Archive() {
  const threads = useEngine((x) => x.threads);
  const projects = useEngine((x) => x.projects);
  const agents = useEngine((x) => x.agents);
  const providers = useEngine((x) => x.providers);
  const list = threads.filter((t) => t.archived).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!list.length)
    return (
      <PaneNote icon={<I.box size={20} />} title="Nothing archived">
        Archive a session from its row's ··· or the command menu ({os.mod}K) to put it away without deleting it.
      </PaneNote>
    );
  const back = (t: Thread) =>
    void rpc("thread.update", { id: t.id, archived: false })
      .then(() => toast(`Brought ${t.title} back`, { description: "Out of Archive, back in the list." }))
      .catch(fail);
  // The sidebar's row (SideList.tsx): the mark, the title and its time, the project and how it ended, its facts; its two actions under one ···.
  return (
    <Group title={plural(list.length, "session")}>
      <div className="lc-sl-list lc-st-arch">
        {list.map((t) => {
          const mark = markStateOf(t);
          const said = rowWords(t, { busy: false });
          const ref = t.model ?? agentOf(t.agent, agents, providers).model;
          return (
            <SideRow
              key={t.id}
              quiet
              mark={<SideMark state={mark} label={markLabelOf(t, mark)} />}
              title={t.title || "New session"}
              ago={ago(t.updatedAt)}
              where={projects.find((p) => p.id === t.projectId)?.name ?? "No project"}
              sub={said.text === "Finished" ? undefined : said.text}
              tone={said.tone}
              facts={<SideFacts branch={t.worktree?.branch} model={ref ? markOf(ref) : undefined} modelName={ref ? modelLabel(ref, providers) : undefined} pr={t.pr && { number: t.pr.number, tone: prSaid(t.pr).num, said: prSaid(t.pr).text }} />}
              acts={
                <Pop label={`Bring back or delete ${t.title || "this session"}`} menu align="end" width={220} triggerClass="lc-sb-a" triggerAttrs={{ title: "Bring it back, delete" }} trigger={<I.more size={14} />}>
                  {(close) => (
                    <>
                      <Row title="Bring it back" note="Out of Archive, back in the list" icon={<I.undo size={16} />} onPick={() => (close(), back(t))} />
                      <Sep />
                      {/* Deleting can't be undone, so the first press only asks: the row says "Delete for good" and the menu stays open for the second. The ask goes with the menu (ConfirmRow). It is red from the start. */}
                      <ConfirmRow
                        title="Delete"
                        sure="Delete for good"
                        sureNote="It can't be brought back"
                        forGood
                        icon={<I.trash size={16} />}
                        onConfirm={() => {
                          close();
                          void rpc("thread.remove", { id: t.id })
                            .then((r) => toast(`Deleted ${t.title}`, r?.kept ? { description: `Its worktree is kept: ${r.kept}` } : undefined))
                            .catch(fail);
                        }}
                      />
                    </>
                  )}
                </Pop>
              }
            />
          );
        })}
      </div>
    </Group>
  );
}

/* ----------------------------------- Updates ----------------------------------- */

const UPDATE_MODES: { value: UpdateMode; label: string }[] = [
  { value: "auto", label: "Automatically" },
  { value: "notify", label: "Just tell me" },
  { value: "off", label: "Off" },
];

function UpdatesPlace() {
  const u = useEngine((x) => x.updates);
  const s = useEngine((x) => x.settings);
  const [looking, setLooking] = useState(false);
  const a = u.app;
  const busy = looking || u.checking;
  const look = async () => {
    setLooking(true);
    await updates.check();
    setLooking(false);
  };
  const due = u.tools.filter((t) => t.state === "available" || t.state === "failed");
  const { app: appMode, tools: toolMode } = updateModes(s);
  return (
    <>
      <Group
        title="Liner Code"
        anchor="updates"
        note={appMode === "off" && toolMode === "off" ? `Updates are off for Liner Code and the agent tools; Look again still looks${u.checkedAt ? `, last ${since(u.checkedAt)}` : ""}.` : u.checkedAt ? `Looked ${since(u.checkedAt)}, and again every six hours.` : "Looks a few seconds after it opens, then every six hours."}
        end={
          <LookAgain looking={busy} onLook={() => void look()} />
        }
      >
        <AppRow a={a} />
        {appHasNews(a) && a.notes && (
          <Field below title={`What's new in ${a.latest}`}>
            <div className="lc-up-notes">
              <StreamedMarkdown className="lc-md" text={a.notes.replace(/^\s*#+\s*(what'?s new|changes|changelog|release notes)\b.*\n+/i, "")} animate={false} />
            </div>
          </Field>
        )}
        <Field title="Updates" note={appMode === "auto" ? "Downloads a release in the background and checks it; it goes in when you restart or quit." : appMode === "notify" ? "Tells you on Home when a release is out, and you download it." : "Doesn't look for releases. Look again still does."}>
          <Segmented size="sm" value={appMode} onValueChange={(v) => save({ updateApp: v as UpdateMode })} options={UPDATE_MODES} aria-label="Liner Code's updates" />
        </Field>
        <Field title="Releases from" note={a.repo ? <span className="lc-mono">github.com/{a.repo}</span> : "No GitHub repository: this copy was built without one, so it has nowhere to look."}>
          {a.repo && (
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => bridge.openExternal(`https://github.com/${a.repo}/releases`)}>
              <I.external size={14} />
              Releases
            </button>
          )}
        </Field>
      </Group>
      <Group
        title="Agent tools"
        note="Each tool updates with its own updater, and only while no session is working on it."
        end={
          due.length > 1 && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => updates.tool()}>
              Update all {due.length}
            </button>
          )
        }
      >
        <Field title="Updates" note={toolMode === "auto" ? "Runs a tool's updater as soon as a new version is out and nothing is working on it." : toolMode === "notify" ? "Tells you on Home when a tool has a new version, and you update it." : "Doesn't look for new versions. Look again still does."}>
          <Segmented size="sm" value={toolMode} onValueChange={(v) => save({ updateTools: v as UpdateMode })} options={UPDATE_MODES} aria-label="The agent tools' updates" />
        </Field>
        {u.tools.length ? u.tools.map((t) => <ToolRow key={t.id} t={t} />) : <Field title="No agent tools yet" note={u.checkedAt ? `None of Claude Code, Codex, OpenCode, Hermes, Grok Build or Antigravity CLI is on ${os.here}. Install one in Agent tools.` : "They show here after the first look."} />}
      </Group>
    </>
  );
}

const Ver = ({ from, to }: { from?: string; to?: string }) => (
  <span className="lc-up-ver">
    {from ?? "?"}
    {to && to !== from && (
      <>
        {" "}
        <span className="lc-up-arrow">→</span> {to}
      </>
    )}
  </span>
);

function AppRow({ a }: { a: AppUpdate }) {
  const native = isNative();
  const news = appHasNews(a);
  const page = a.url && (
    <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.openExternal(a.url!)}>
      <I.external size={14} />
      Release page
    </button>
  );
  let note: ReactNode = a.repo ? "Up to date" : "Built without a release feed";
  let control: ReactNode = null;
  if (a.state === "failed") {
    note = <span className="lc-up-err">{a.error}</span>;
    if (a.stuck) control = page;
    else if (news && a.can === "install")
      control = (
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={updates.download}>
          Try again
        </button>
      );
  } else if (a.state === "downloading") {
    note = `Downloading ${Math.round((a.progress ?? 0) * 100)}%${a.size ? ` of ${sizeOf(a.size)}` : ""}, then checking it`;
    control = (
      <span className="lc-up-bar" role="progressbar" aria-label="Download" aria-valuenow={Math.round((a.progress ?? 0) * 100)}>
        <i style={{ transform: `scaleX(${a.progress ?? 0})` }} />
      </span>
    );
  } else if (a.state === "ready") {
    note = native ? "Downloaded and checked. It goes in when you quit, or now." : "Downloaded and checked. It goes in when the app restarts.";
    if (native)
      control = (
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" onClick={() => void updates.restart()}>
          Restart to update
        </button>
      );
  } else if (a.state === "available") {
    if (a.can === "install") {
      note = `${a.latest} is out${a.size ? `, ${sizeOf(a.size)}` : ""}.`;
      control = (
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" onClick={updates.download}>
          <I.download size={14} />
          Download
        </button>
      );
    } else {
      note = a.can === "source" ? `${a.latest} is out. This copy runs from source: pull and build it to update.` : a.can === "manual" ? `${a.latest} is out. Download the new one from the release page.` : a.can === "translocated" ? `${a.latest} is out. Move Liner Code to Applications first, so it can update itself.` : `${a.latest} is out. Liner Code can't write to its folder, so get it from the release page.`;
      control = page;
    }
  } else if (a.state === "idle" && a.repo) note = "Hasn't looked yet";
  return (
    <Field
      title={
        <>
          Liner Code <Ver from={a.current} to={news ? a.latest : undefined} /> {a.state === "current" && <Badge tone="ok">Up to date</Badge>}
        </>
      }
      note={a.state === "current" ? (a.publishedAt ? `The latest release, from ${since(a.publishedAt)}` : "The latest release") : note}
    >
      {control}
    </Field>
  );
}

function ToolRow({ t }: { t: ToolUpdate }) {
  const fresh = t.state === "available" || t.state === "waiting" || t.state === "updating" || t.state === "failed";
  const cmd = t.command ? <span className="lc-mono">{t.command}</span> : null;
  const note: ReactNode =
    t.state === "available" ? (
      <>{t.latest} is out. Updates with {cmd}</>
    ) : t.state === "waiting" ? (
      `Waits for the ${plural(t.busy ?? 1, "session")} working on it`
    ) : t.state === "updating" ? (
      t.step ? <span className="lc-mono lc-up-step">{t.step}</span> : <>Running {cmd}</>
    ) : t.state === "updated" ? (
      `Updated from ${t.from}${t.at ? ` ${since(t.at)}` : ""}. Sessions on it pick it up on their next turn.`
    ) : t.state === "failed" ? (
      <span className="lc-up-err">{t.error}</span>
    ) : t.error ? (
      t.error
    ) : (
      <>Up to date{cmd && <>, updates with {cmd}</>}</>
    );
  return (
    <Field lead={<span className="lc-st-mark"><ModelMark kind={markOf(`${t.id}:`)} size={16} /></span>} title={<>{t.label} <Ver from={t.current} to={fresh ? t.latest : undefined} /></>} note={note}>
      {(t.state === "available" || t.state === "failed") && (
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => updates.tool(t.id)}>
          {t.state === "failed" ? "Try again" : "Update"}
        </button>
      )}
      {/* An update is a thing at work: the state mark, with how far the updater has got when it says. */}
      {t.state === "updating" && <Badge tone="neutral" mark="working">{t.progress === undefined ? "Updating" : `Updating, ${Math.round(t.progress * 100)}%`}</Badge>}
      {t.state === "waiting" && <Badge tone="warn">Waiting</Badge>}
      {t.state === "updated" && <Badge tone="ok">Updated</Badge>}
    </Field>
  );
}

/* ------------------------------------ Data ------------------------------------ */

/** About and updates: Liner Code's version and updates, the agent tools' updates, then where its data lives. */
function About() {
  return (
    <>
      <UpdatesPlace />
      <Data />
    </>
  );
}

function Data() {
  const home = useEngine((x) => x.home);
  const threads = useEngine((x) => x.threads.length);
  const [userHome, setUserHome] = useState<string | null>(null);
  useEffect(
    () =>
      void rpc("machine.info", {})
        .then((m) => setUserHome(m.home))
        .catch(() => {}),
    [],
  );
  // Where the shell writes it (desktop/src/engine.ts): the Mac's Logs folder, else (Windows, or a test home) the data folder's logs.
  const sep = home.includes("\\") ? "\\" : "/";
  const log = !userHome ? null : isMac && home === `${userHome}/.liner-code` ? `${userHome}/Library/Logs/Liner Code/engine.log` : [home, "logs", "engine.log"].join(sep);
  return (
    <>
      <Group title={`On ${os.here}`} anchor="data">
        <Field
          title="Sessions, projects and settings"
          note={
            <>
              {plural(threads, "session")} · <span className="lc-mono">{tilde(home)}</span>
            </>
          }
        >
          {isNative() && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.reveal(home)}>
              Show in {os.fileManager}
            </button>
          )}
        </Field>
        <Field title="Engine log" note={log ? <span className="lc-mono">{tilde(log)}</span> : "What the engine did, for when something goes wrong"}>
          {isNative() && log && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.reveal(log)}>
              Show in {os.fileManager}
            </button>
          )}
        </Field>
        <Field title="API keys" note={os.windows ? "In Windows' encrypted storage, sealed to your Windows sign-in. Never written to the data folder." : "In the login keychain, under “Liner Code”. Never written to the data folder."} />
      </Group>
    </>
  );
}
