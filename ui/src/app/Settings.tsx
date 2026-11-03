/*
  Settings take the whole window. The column on the left swaps the sessions for the settings'
  own places: you, a search that narrows them, the places in their groups, and under the open
  one the sections of its page, with a bar that follows the one you're reading. The right holds
  one place at a time: a title that says what it covers, then groups of rows on white cards with
  a 1px ring, each row a name, a line on what it does, and its control. Looks live in this
  window (localStorage) and apply at once; the rest lives in the engine. Escape, ⌘, or Back
  returns to the sessions.
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import type { Access, AddonInfo, AgentProfile, AppUpdate, BuiltinProvider, CustomModel, Endpoint, EndpointProtocol, KeyBinding, Mode, Project, ProjectRules, ProjectScript, ProviderInfo, RegistryAgent, Settings as EngineSettings, ToolAccount, ToolUpdate, UpdateMode } from "@contracts";
import { ACCOUNT_HOME, addonKey, castOf, ENDPOINT_TOOL, endpointKey, updateModes, VOUCHER } from "@contracts";
import { Breadcrumb } from "@liner/components/breadcrumb/breadcrumb";
import { RadioCards } from "@liner/components/radio-cards/radio-cards";
import { RadioGroup } from "@liner/components/radio-group/radio-group";
import { Progress } from "@liner/components/progress/progress";
import { Segmented } from "@liner/components/segmented/segmented";
import { Select } from "@liner/components/select/select";
import { Slider } from "@liner/components/slider/slider";
import { toast } from "@liner/components/toast/toast";
import { feedback } from "@liner/lib/feedback";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { Agentic } from "./Agentic";
import { Backdrop, ownChanged, useBackgroundUrl } from "./Backdrop";
import { bridge, isNative } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I, ModelMark } from "./icons";
import { ACCESS_LEVELS, accessOf, agentOf, ago, markOf, modelLabel, plural, providerLabel, since } from "./model";
import { Badge, Disc, Kbd, ModelTag, NamedSwitch, Pop, Row } from "./ui";
import { bindingsOf, commandOn, COMMANDS, FIXED, glyphs, onBindings, readBindings, specOf } from "./keymap";
import { current, fromVSCode, readThemes, saveThemes, type Theme } from "./themes";
import { appHasNews, sizeOf, updates } from "./Updates";
import { groupOf, SERVICES } from "./services";
import * as os from "./os";
import { applyLook, LOOK_DEFAULT, LOOK_KEY, readLook, type ActionColour, type DesignsWhere, type Look, type TrayGlass } from "./look";
import "./settings.css";

const isMac = /Mac/.test(navigator.platform);

const ACCENTS = [
  { id: "blue", color: "oklch(0.6 0.19 258)" },
  { id: "violet", color: "oklch(0.58 0.2 292)" },
  { id: "teal", color: "oklch(0.62 0.12 195)" },
  { id: "orange", color: "oklch(0.68 0.17 50)" },
  { id: "rose", color: "oklch(0.62 0.2 12)" },
];
/** The main buttons' colours (look.ts): red, the accent you picked, or the tray's ink. */
const ACTIONS: { id: ActionColour; label: string; color: string }[] = [
  { id: "red", label: "Red", color: "oklch(0.6 0.215 27)" },
  { id: "accent", label: "The accent", color: "var(--l-accent)" },
  { id: "ink", label: "Ink, like the tray", color: "var(--lc-ctl)" },
];

export type SettingsPage = "general" | "appearance" | "notifications" | "keyboard" | "models" | "agentic" | "team" | "safety" | "addons" | "projects" | "git" | "archive" | "updates" | "data";

/** Each place: where it sits, what it covers, and the words a search finds it by. */
const PLACES: { id: SettingsPage; label: string; icon: ReactNode; group: string; blurb: string; words: string }[] = [
  { id: "general", label: "General", icon: <I.sliders />, group: "Liner Code", blurb: "How new sessions start, and what Enter does while an agent works.", words: "work style lead coder team model worktree checkout enter queue steer setup first run done settle merge budget spend" },
  { id: "appearance", label: "Appearance", icon: <I.contrast />, group: "Liner Code", blurb: "Light or dark, the accent, the main buttons' colour, the glass, where designs open, and a picture behind the session.", words: "theme dark light accent color colour glass tint clear solid tray rail composer background wallpaper picture image photo blur main button buttons action send primary red design designs page pages html panel inline chat" },
  { id: "notifications", label: "Notifications", icon: <I.bell />, group: "Liner Code", blurb: "When Liner Code tells you something, and how.", words: "notify alert dock badge sound sounds feedback taskbar tray" },
  { id: "keyboard", label: "Keyboard", icon: <I.keyboard />, group: "Liner Code", blurb: "Every shortcut in one place.", words: "shortcut keys hotkey command" },
  { id: "models", label: "Models", icon: <I.chip />, group: "Agents", blurb: `The agent tools on ${os.here}, how they sign in, and the keys they bill to.`, words: "provider claude codex opencode hermes cursor grok install sign in key api billing anthropic openai voucher promo code redeem" },
  { id: "agentic", label: "Agentic features", icon: <I.flow />, group: "Agents", blurb: "Solo, Plan then build, or Auto; your frontier and cheaper models; check or refine each change; and how each mode went in your sessions.", words: "agentic mode solo plan build auto routed lead planner coder builder model frontier cheaper dual astra opus sonnet luna deepseek glm kimi qwen chinese opencode go hermes check refine reviewer judge critic compare cost" },
  { id: "team", label: "Team", icon: <I.agents />, group: "Agents", blurb: "The agents you open sessions with: their model, effort and soul.", words: "agent helm forge lead coder soul effort new agent run mode helpers escalate opus" },
  { id: "safety", label: "Safety", icon: <I.shield />, group: "Agents", blurb: "What a new session may do without asking, and what always asks.", words: "permission access auto manual full reviewer decides destructive guard rm force push" },
  { id: "addons", label: "Add-ons", icon: <I.blocks />, group: "Agents", blurb: "Connections your agents made for Liner Code. Each one asked first, keeps its versions, and turns off here.", words: "addon addons add-on add-ons connection connections mcp server servers plugin extension linear sentry version restore remove safe mode start without" },
  { id: "projects", label: "Projects", icon: <I.folder />, group: "Work", blurb: "The folders agents work in, who each one starts with, and how a new worktree is set up.", words: "project folder repository add remove finder explorer setup install worktree" },
  { id: "git", label: "Git and worktrees", icon: <I.branch />, group: "Work", blurb: "Branches, worktrees, and the snapshot Liner Code keeps of every turn.", words: "git branch prefix worktree snapshot checkpoint undo refs" },
  { id: "archive", label: "Archive", icon: <I.box />, group: "System", blurb: "Sessions you put away. Bring one back, or delete it for good.", words: "archived sessions restore delete" },
  { id: "updates", label: "Updates", icon: <I.download />, group: "System", blurb: "New versions of Liner Code, and of the agent tools it drives.", words: "update upgrade version release new download install restart github cli claude codex opencode hermes grok auto automatic" },
  { id: "data", label: "Data and about", icon: <I.drive />, group: "System", blurb: "Where Liner Code keeps its sessions and log, and which version this is.", words: "data storage folder log engine version about" },
];

type Props = { initial?: SettingsPage; onClose: () => void; onAgent: (agent?: AgentProfile) => void; onOpen?: (threadId: string) => void };

export function Settings({ initial = "general", onClose, onAgent, onOpen }: Props) {
  const [page, setPage] = useState<SettingsPage>(() => (sessionStorage.getItem("lc:settings") as SettingsPage) || initial);
  const [query, setQuery] = useState("");
  const [look, setLook] = useState<Look>(readLook);
  const [sound, setSound] = useState(feedback.enabled);
  const scroller = useRef<HTMLDivElement>(null);
  const find = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null);
  const place = PLACES.find((p) => p.id === page) ?? PLACES[0];
  const archived = useEngine((s) => s.threads.filter((t) => t.archived).length);
  const secs = useSections(scroller, page);
  const me = window.__LINER__?.user?.trim() || "You";

  useEffect(() => sessionStorage.setItem("lc:settings", page), [page]);
  // Asked for a place while already open (Check for Updates…, a notice's Details).
  useEffect(() => {
    const on = (e: Event) => setPage(((e as CustomEvent).detail as SettingsPage) ?? "general");
    window.addEventListener("lc:open-settings", on);
    return () => window.removeEventListener("lc:open-settings", on);
  }, []);
  useEffect(() => {
    const off = feedback.subscribe(setSound);
    return () => void off();
  }, []);
  // Escape goes back, unless something inside (a menu, a field, a dialog) takes it first; ⌘F finds a setting.
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
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setLookPart = (patch: Partial<Look>) => {
    const next = { ...look, ...patch };
    setLook(next);
    localStorage.setItem(LOOK_KEY, JSON.stringify(next));
    applyLook(next);
  };

  // A search narrows the places to those whose name or settings match.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = PLACES.filter((p) => !q || `${p.label} ${p.blurb} ${p.words}`.toLowerCase().includes(q));
    return [...new Set(hits.map((p) => p.group))].map((g) => ({ id: g, items: hits.filter((p) => p.group === g) }));
  }, [query]);
  // The open place again goes back to the top of its page.
  const go = (id: SettingsPage) => {
    if (id === page) return scroller.current?.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    setPage(id);
    feedback.play("tick", 3);
  };
  // A page of two or more sections lists them under its place, unless a search is on.
  const hasSecs = secs.titles.length > 1;
  const showSecs = hasSecs && !query;

  // The list keeps the open place, and the section you're reading, in sight when it runs past the column.
  useEffect(() => {
    const box = nav.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="location"]') ?? box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const room = 32;
    const by = r.top < b.top + room ? r.top - b.top - room : r.bottom > b.bottom - room ? r.bottom - b.bottom + room : 0;
    if (by) box.scrollBy({ top: by, behavior: calm() ? "auto" : "smooth" });
  }, [page, secs.at, showSecs]);
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
  // Up and Down walk the places and sections, Home and End jump to the ends.
  const walk = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(nav.current?.querySelectorAll<HTMLElement>("[data-walk]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  // What "Restore defaults" puts back on each place, if anything.
  const restore: Partial<Record<SettingsPage, () => void>> = {
    general: () => {
      save({ worktrees: false });
      localStorage.setItem("lc:enter", "queue");
    },
    // The parts LOOK_DEFAULT has no word for (your own theme, colours and picture) go too, or they'd stay on.
    appearance: () => setLookPart({ ...LOOK_DEFAULT, custom: undefined, accentColor: undefined, actionColor: undefined, background: undefined, bgBlur: undefined, bgShow: undefined }),
    notifications: () => {
      save({ notify: true, badge: true });
      feedback.setEnabled(false);
    },
    agentic: () => save({ dual: false, after: "check", reviewRounds: 2, reviewSmall: false, route: { level: "high" } }),
    safety: () => save({ defaultAccess: "auto", guardDestructive: true }),
    git: () => save({ branchPrefix: "liner/" }),
  };
  const reset = restore[page];

  return (
    <>
      <div className="lc-side lc-st-side">
        <div className="lc-sb-head lc-st-head" data-drag>
          <span className="lc-brand" data-drag>
            <button type="button" className="lc-ib l-focus" aria-label="Back to sessions" title="Back to sessions (Esc)" onClick={onClose}>
              <I.back size={16} />
            </button>
            Settings
          </span>
        </div>
        <div className="lc-st-me">
          <span className="lc-st-av" aria-hidden>
            {me[0].toUpperCase()}
          </span>
          <span className="lc-st-me-t">
            <b title={me}>{me}</b>
            {/* Your name is your account's on this computer; nothing in Liner Code changes it, so this opens General. */}
            <button type="button" className="lc-st-edit l-focus" onClick={() => go("general")}>
              Edit profile
              <I.edit size={11} />
            </button>
          </span>
        </div>
        <div className="lc-sb-find lc-st-find" role="search">
          <I.search size={15} />
          <input ref={find} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))} />
          {query ? (
            <button type="button" className="lc-ib l-focus" aria-label="Clear" onClick={() => (setQuery(""), find.current?.focus())}>
              <I.close size={12} />
            </button>
          ) : (
            <span className="lc-sb-key">{isMac ? "⌘F" : "Ctrl F"}</span>
          )}
        </div>
        <nav ref={nav} className="lc-st-nav" aria-label="Settings" onKeyDown={walk}>
          <div className="lc-st-nav-in">
            {groups.map((g, gi) => (
              <div key={g.id} className="lc-st-grp" role="group" aria-label={g.id}>
                {gi > 0 && <span className="lc-st-rule" aria-hidden />}
                {g.id !== PLACES[0].group && (
                  <span className="lc-st-label" aria-hidden>
                    {g.id}
                  </span>
                )}
                <ul className="lc-st-places">
                  {g.items.map((p) => {
                    const on = p.id === page;
                    return (
                      <li key={p.id}>
                        <button type="button" className="lc-st-place l-focus" data-walk aria-current={on ? "page" : undefined} aria-label={p.id === "archive" && archived ? `${p.label}, ${archived}` : undefined} onClick={() => go(p.id)}>
                          <span className="lc-st-place-i" aria-hidden>
                            {p.icon}
                          </span>
                          <span className="lc-st-place-t">{p.label}</span>
                          {p.id === "archive" && archived > 0 && (
                            <span className="lc-st-count" aria-hidden>
                              {archived}
                            </span>
                          )}
                        </button>
                        {on && showSecs && (
                          <div className="lc-st-secs" style={{ "--at": secs.at } as CSSProperties}>
                            <span className="lc-st-bar" aria-hidden />
                            <ul aria-label={`${p.label}, its sections`}>
                              {secs.titles.map((t, i) => (
                                <li key={`${i}${t}`}>
                                  <button type="button" className="lc-st-sec l-focus" data-walk aria-current={i === secs.at ? "location" : undefined} title={t} onClick={() => secs.go(i)}>
                                    {t}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {query && !groups.length && <p className="lc-sb-empty">No setting matches that.</p>}
          </div>
        </nav>
        <button type="button" className="lc-st-back l-focus" onClick={onClose}>
          <I.back size={15} />
          <span className="lc-grow">Back to sessions</span>
          <span className="lc-sb-key">esc</span>
        </button>
      </div>
      <main className="lc-paper lc-st-paper">
        <Backdrop />
        <header className="lc-top" data-drag>
          <Breadcrumb
            separator="slash"
            items={[
              { label: "Settings", onSelect: () => go("general") },
              hasSecs ? { label: place.label, onSelect: () => go(page) } : { label: place.label },
              ...(hasSecs && secs.titles[secs.at] ? [{ label: secs.titles[secs.at] }] : []),
            ]}
            className="lc-st-crumbs"
          />
          <span className="lc-grow" data-drag />
          {reset && (
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => (reset(), toast("Put back as it came"))}>
              <I.undo size={13} />
              Restore defaults
            </button>
          )}
        </header>
        <div ref={scroller} className="lc-st-scroll">
          <div className="lc-st-col" key={page} data-wide={page === "agentic" || undefined}>
            <div className="lc-st-hero">
              <span className="lc-st-hero-i" aria-hidden>
                {place.icon}
              </span>
              <h1>{place.label}</h1>
              <p>{place.blurb}</p>
            </div>
            {page === "general" && <General go={setPage} onSetup={onClose} />}
            {page === "appearance" && <Appearance look={look} set={setLookPart} />}
            {page === "notifications" && <Notifications sound={sound} />}
            {page === "keyboard" && <Keyboard />}
            {page === "models" && <Models />}
            {page === "agentic" && <Agentic onOpen={onOpen} />}
            {page === "team" && <Team onAgent={onAgent} />}
            {page === "safety" && <Safety />}
            {page === "addons" && <AddonsPlace />}
            {page === "projects" && <Projects />}
            {page === "git" && <Git />}
            {page === "archive" && <Archive />}
            {page === "updates" && <UpdatesPlace />}
            {page === "data" && <Data onSetup={onClose} />}
          </div>
        </div>
      </main>
    </>
  );
}

/** Reduced motion: scrolls jump rather than glide. */
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Whether this engine says when a scroll is done (scrollend); where it doesn't, the scroll events stopping does. */
const SCROLLEND = "onscrollend" in window;

/**
  The sections of the page showing, in order: each group's title (a `.lc-st-group`'s h2), or a
  part that names itself with `data-st-sec`. A group inside a named part, or inside another
  group, belongs to it and isn't listed; one that isn't drawn (display: none) isn't either.
*/
function sectionsIn(box: HTMLElement) {
  const found: { title: string; el: HTMLElement }[] = [];
  for (const n of box.querySelectorAll<HTMLElement>(".lc-st-group > header h2, [data-st-sec]")) {
    const named = n.dataset.stSec !== undefined;
    const el = named ? n : n.closest<HTMLElement>(".lc-st-group");
    if (!el || (named ? n.parentElement?.closest("[data-st-sec]") : el.closest("[data-st-sec]") || el.parentElement?.closest(".lc-st-group"))) continue;
    const title = (named ? n.dataset.stSec : (n.dataset.title ?? n.textContent))?.trim();
    if (title && el.getClientRects().length) found.push({ title, el });
  }
  return found;
}

/**
  Opens each place at its top, and follows the sections of its page in `scroller`: their titles,
  again whenever the page changes or its content does (debounced), and which one you're reading:
  the last whose top has passed 140px below the scroller's top, or the last one at the end (the
  line slides down over the final stretch when the page ends before the last ones reach it).
  `go` scrolls to one; the one you picked stays current until you scroll yourself, even when the
  page can't bring it up.
*/
function useSections(scroller: RefObject<HTMLDivElement | null>, page: SettingsPage) {
  const [titles, setTitles] = useState<string[]>([]);
  const [at, setAt] = useState(0);
  const els = useRef<HTMLElement[]>([]);
  // "moving": scrolling to a section you picked; "held": there, until you scroll.
  const hold = useRef<"moving" | "held" | null>(null);
  const fallback = useRef(0);

  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    // A place opens at its top.
    sc.scrollTop = 0;
    hold.current = null;
    setAt(0);
    let soon = 0;
    let idle = 0;
    // Scroll events come at most once a frame, and this reads a few boxes: no need to wait for one.
    const pick = () => {
      const list = els.current;
      if (hold.current || !list.length) return;
      const top = sc.getBoundingClientRect().top;
      const tops = list.map((el) => el.getBoundingClientRect().top - top);
      const max = sc.scrollHeight - sc.clientHeight;
      const left = max - sc.scrollTop;
      // The last sections may never come up to the line, the page ending first: over the final
      // stretch the line slides down to where the last one stops, so each still gets its turn.
      const short = max > 4 ? Math.max(0, tops[tops.length - 1] - left - 140) : 0;
      const stretch = Math.min(max, Math.max(short, 240));
      const line = 140 + (short && left < stretch ? short * (1 - left / stretch) : 0);
      let now = 0;
      tops.forEach((t, i) => {
        if (t <= line + 1) now = i;
      });
      if (max > 4 && left <= 4) now = list.length - 1;
      setAt(now);
    };
    const read = () => {
      soon = 0;
      const found = sectionsIn(sc);
      els.current = found.map((f) => f.el);
      const next = found.map((f) => f.title);
      setTitles((was) => (was.length === next.length && was.every((t, i) => t === next[i]) ? was : next));
      setAt((a) => Math.min(a, Math.max(0, next.length - 1)));
      pick();
    };
    const later = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(read, 120);
    };
    // A glide ends at scrollend, or where there's none, when the scroll events stop.
    const ended = () => {
      if (hold.current === "moving") hold.current = "held";
    };
    const onScroll = () => {
      if (hold.current === "moving") {
        if (!SCROLLEND) {
          window.clearTimeout(idle);
          idle = window.setTimeout(ended, 160);
        }
        return;
      }
      if (hold.current === "held") hold.current = null;
      pick();
    };
    // You took the wheel: the page decides again.
    const yours = () => {
      if (hold.current) hold.current = null;
    };
    const mo = new MutationObserver(later);
    mo.observe(sc, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-st-sec", "hidden"] });
    const ro = new ResizeObserver(later);
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    sc.addEventListener("scroll", onScroll, { passive: true });
    sc.addEventListener("scrollend", ended);
    for (const t of ["wheel", "touchstart", "keydown", "pointerdown"] as const) sc.addEventListener(t, yours, { passive: true });
    read();
    return () => {
      mo.disconnect();
      ro.disconnect();
      sc.removeEventListener("scroll", onScroll);
      sc.removeEventListener("scrollend", ended);
      for (const t of ["wheel", "touchstart", "keydown", "pointerdown"] as const) sc.removeEventListener(t, yours);
      window.clearTimeout(soon);
      window.clearTimeout(idle);
      window.clearTimeout(fallback.current);
    };
  }, [page]);

  const go = (i: number) => {
    const sc = scroller.current;
    const el = els.current[i];
    if (!sc || !el) return;
    const to = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16));
    setAt(i);
    window.clearTimeout(fallback.current);
    if (Math.abs(to - sc.scrollTop) < 2) return void (hold.current = "held");
    hold.current = "moving";
    sc.scrollTo({ top: to, behavior: calm() ? "auto" : "smooth" });
    fallback.current = window.setTimeout(() => hold.current === "moving" && (hold.current = "held"), 2000);
  };

  return { titles, at, go };
}

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
/** One empty list, so a store read of a missing one doesn't change every time. */
const NONE: never[] = [];
/** Tools with a driver that hasn't been run against the real tool yet. */
const UNTRIED = new Set(["cursor", "grok"]);
const save = (patch: Partial<EngineSettings>) => void rpc("settings.save", patch).catch(fail);
const tilde = os.tilde;

/** A small accent tag beside something that just arrived. */
const New = () => <span className="lc-st-new">New</span>;

/** A titled group of rows on a white card. Its title is a section in the sidebar (data-title keeps a tag out of it). */
function Group({ title, note, end, children, flush, tag }: { title: string; note?: ReactNode; end?: ReactNode; children: ReactNode; flush?: boolean; tag?: ReactNode }) {
  return (
    <section className="lc-st-group">
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
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card" data-flush={flush || undefined}>
          {children}
        </div>
      </div>
    </section>
  );
}

/** One setting: its name, a line on what it does, and its control. `below` puts the control under the words; `off` quiets a row that doesn't apply now. */
function Field({ title, note, children, below, lead, off }: { title: ReactNode; note?: ReactNode; children?: ReactNode; below?: boolean; lead?: ReactNode; off?: boolean }) {
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

/* ---------------------------------- General ---------------------------------- */

function General({ go, onSetup }: { go: (p: SettingsPage) => void; onSetup: () => void }) {
  const s = useEngine((x) => x.settings);
  const [enter, setEnter] = useState(() => (localStorage.getItem("lc:enter") as "queue" | "steer") ?? "queue");
  const providers = useEngine((x) => x.providers);
  // Who'd do what, from your two models.
  const cast = castOf(providers, { dual: s.dual, picks: s.picks });
  const label = (ref?: string) => (ref ? modelLabel(ref, providers) : "");
  return (
    <>
      <Group title="New sessions" note="What Home starts with. Each session can still change it.">
        <Field title="How they work" below>
          <RadioCards
            label="How they work"
            columns={3}
            value={s.mode}
            onValueChange={(v) => save({ mode: v as Mode })}
            options={[
              { value: "solo", title: "Solo", description: `One model does it all, as you allow${cast ? `: ${label(cast.everyday)}` : ""}.`, icon: <I.sparkle size={16} /> },
              { value: "plan", title: "Plan, then build", description: cast ? `${label(cast.strong)} plans, you approve, ${label(cast.everyday)} builds.` : "A stronger model plans, you approve, a cheaper one builds.", icon: <I.flow size={16} /> },
              { value: "auto", title: "Auto", description: cast ? `Each message gets the least work: ${label(cast.everyday)} for most, ${label(cast.strong)} for hard jobs.` : "Each message gets the least work likely to do it well.", icon: <I.branchIf size={16} /> },
            ]}
          />
          <span className="lc-st-more">
            <button type="button" className="lc-st-link l-focus" onClick={() => go("agentic")}>
              Which models, and how each mode works
              <I.chevR size={12} />
            </button>
          </span>
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
        <Field title="What they may do" note={accessOf(s.defaultAccess).note}>
          <button type="button" className="lc-st-link l-focus" onClick={() => go("safety")}>
            {accessOf(s.defaultAccess).label}
            <I.chevR size={12} />
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
              localStorage.setItem("lc:enter", v);
            }}
            options={[
              { value: "queue", label: "Queues it" },
              { value: "steer", label: "Steers now" },
            ]}
            aria-label="What Enter does"
          />
        </Field>
        <Field title={`Keep the ${os.machine} awake`} note="No idle sleep while a session or a routine run works, so a long run isn't cut off. The display still sleeps.">
          <NamedSwitch name={`Keep the ${os.machine} awake`} checked={s.keepAwake !== false} onCheckedChange={(keepAwake) => save({ keepAwake })} />
        </Field>
      </Group>
      <Group title="Settle sessions on their own" note="Settling is yours: a session stays in its project until you settle it from its row (D), and settled ones fold away under Settled, still searchable. These rules can do it for you; they're off unless you turn them on.">
        <Field title="When its pull request merges">
          <NamedSwitch name="When its pull request merges" checked={s.settleOnMerge ?? false} onCheckedChange={(settleOnMerge) => save({ settleOnMerge })} />
        </Field>
        <Field title="When a routine run handled everything itself" note="A run that waits for you stays in its project.">
          <NamedSwitch name="When a routine run handled everything itself" checked={s.settleOnRoutine ?? false} onCheckedChange={(settleOnRoutine) => save({ settleOnRoutine })} />
        </Field>
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
      <Group title="Usage limits">
        <Field title="When a tool runs out of usage" note="Carry on: another account of the same tool takes over, else a ready model from another family, with the conversation so far. Either way the session's card offers both.">
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
        <Field title="Carry on when the limit resets" note="A session that waits for its tool's usage to reset goes on by itself a minute after it does, when the tool said when. Off unless you turn it on.">
          <NamedSwitch name="Carry on when the limit resets" checked={s.resumeAtReset ?? false} onCheckedChange={(resumeAtReset) => save({ resumeAtReset })} />
        </Field>
        <Field title="Carry on after a restart" note={`A turn cut off when Liner Code quit or the ${os.machine} restarted goes on by itself when it opens again, up to three times in five minutes. A turn you stopped stays stopped.`}>
          <NamedSwitch name="Carry on after a restart" checked={s.continueAfterRestart ?? true} onCheckedChange={(continueAfterRestart) => save({ continueAfterRestart })} />
        </Field>
      </Group>
      <Group title="Spending">
        <Field title="A monthly budget" note="Usage shows how much of it is gone and where the month's pace ends. Nothing stops at the limit.">
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
                const n = Math.max(0, Math.round(Number(e.target.value.replace(/[^\d.]/g, "")) || 0));
                if (n !== (s.budgetUsd ?? 0)) save({ budgetUsd: n });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </span>
        </Field>
        <Field title="A cap per session" note="A session, or a routine run, that spends this much stops where it is and tells you; your next message lets it go on for another cap's worth. Claude Code reports cost; other tools can't be held to it.">
          <span className="lc-st-budget">
            <span className="lc-quiet">$</span>
            <input
              className="lc-input"
              key={s.capUsd ?? 0}
              defaultValue={s.capUsd || ""}
              placeholder="None"
              inputMode="decimal"
              aria-label="Spending cap per session in dollars"
              onBlur={(e) => {
                const n = Math.max(0, Math.round((Number(e.target.value.replace(/[^\d.]/g, "")) || 0) * 100) / 100);
                if (n !== (s.capUsd ?? 0)) save({ capUsd: n });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </span>
        </Field>
      </Group>
      <Group title="First run">
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

/** The window in miniature, in the look you're choosing: one ground, the session tray, the composer. */
function Preview({ look }: { look: Look }) {
  const bg = useBackgroundUrl(look.background);
  const vars = bg ? ({ "--lc-pv-bg": `url("${bg}")`, "--lc-pv-blur": `${Math.round((look.bgBlur ?? 28) * 0.3)}px`, "--lc-pv-show": String(look.bgShow ?? 0.45) } as CSSProperties) : undefined;
  const mode = look.theme === "system" ? "Matches the system" : look.theme === "dark" ? "Dark" : "Light";
  const accent = look.accent === "own" ? "your own colour" : look.accent;
  return (
    <div className="lc-st-preview" aria-hidden>
      <div className="lc-pv-win" data-tray={look.tray} style={vars}>
        <div className="lc-pv-side">
          <span className="lc-pv-lights">
            <i />
            <i />
            <i />
          </span>
          <span className="lc-pv-line" style={{ width: "62%" }} />
          <span className="lc-pv-plate">
            <span className="lc-pv-line" style={{ width: "70%" }} />
          </span>
          <span className="lc-pv-line" style={{ width: "54%" }} />
          <span className="lc-pv-line" style={{ width: "66%" }} />
        </div>
        <div className="lc-pv-paper" data-bg={bg ? "" : undefined}>
          <span className="lc-pv-you" />
          <span className="lc-pv-line" style={{ width: "86%" }} />
          <span className="lc-pv-line" style={{ width: "72%" }} />
          <span className="lc-pv-card">
            <span className="lc-pv-line" style={{ width: "40%" }} />
            <span className="lc-pv-btn" />
          </span>
          <span className="lc-pv-tray" />
          <span className="lc-pv-comp" />
        </div>
      </div>
      <span className="lc-pv-cap">
        {mode} · {accent} · {bg ? "a picture behind the session" : `${look.tray} tray`}
      </span>
    </div>
  );
}

const MODES: { value: Look["theme"]; title: string; note: string }[] = [
  { value: "light", title: "Light", note: "One light ground" },
  { value: "dark", title: "Dark", note: "One dark ground" },
  { value: "system", title: "Match the system", note: `Follows ${os.windows ? "Windows" : "macOS"}, day and night` },
];

/** Choices as cards: a small picture, the name, a line; the picked one ringed and ticked. */
function PictureCards<T extends string>({ label, value, options, onPick }: { label: string; value: T | ""; options: { value: T; title: string; note: string; picture: ReactNode }[]; onPick: (v: T) => void }) {
  return (
    <span className="lc-st-modes" role="radiogroup" aria-label={label} data-n={options.length}>
      {options.map((m) => (
        <button key={m.value} type="button" role="radio" aria-checked={value === m.value} className="lc-st-mode l-focus" data-on={value === m.value || undefined} onClick={() => onPick(m.value)}>
          {value === m.value && (
            <span className="lc-st-tick" aria-hidden>
              <I.check size={10} />
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

/** Light, dark or the system's, as cards: a swatch of the ground and its well, the name, a line. */
function ModeCards({ value, onPick }: { value: Look["theme"] | ""; onPick: (v: Look["theme"]) => void }) {
  const options = MODES.map((m) => ({
    ...m,
    picture: (
      <span className="lc-st-themechip" data-kind={m.value} aria-hidden>
        <i />
        <i />
      </span>
    ),
  }));
  return <PictureCards label="Theme" value={value} options={options} onPick={onPick} />;
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

function Appearance({ look, set }: { look: Look; set: (p: Partial<Look>) => void }) {
  // One of your themes holds the mode and the accent; choosing either goes back to Liner's own.
  const own = look.custom ? readThemes().find((t) => t.id === look.custom) : undefined;
  const held = own ? `${own.name} sets this while it's in use. Choosing one here goes back to Liner's own.` : undefined;
  return (
    <>
      <Preview look={look} />
      <Group title="Theme">
        <Field title="Mode" note={held} below>
          <ModeCards value={own ? "" : look.theme} onPick={(theme) => set({ theme, custom: undefined })} />
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
      <Group title="Main buttons" note="The most important button wherever it is: Send, Commit and push in the session tray, a card's main button.">
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
      <Group title="Glass" note="The session tray and the composer let the thread show through. Everything else sits on one solid ground.">
        <Field title="Session tray" note="How much of the thread shows through the tray.">
          <Segmented
            size="sm"
            value={look.tray}
            onValueChange={(tray) => set({ tray: tray as TrayGlass })}
            options={[
              { value: "clear", label: "Clear" },
              { value: "tinted", label: "Tinted" },
              { value: "solid", label: "Solid" },
            ]}
            aria-label="Session tray glass"
          />
        </Field>
        <Field
          title={
            <>
              Composer
              <New />
            </>
          }
          note="How much of the thread shows through the composer, blurred."
        >
          <Segmented
            size="sm"
            value={look.composer}
            onValueChange={(composer) => set({ composer: composer as TrayGlass })}
            options={[
              { value: "clear", label: "Clear" },
              { value: "tinted", label: "Tinted" },
              { value: "solid", label: "Solid" },
            ]}
            aria-label="Composer glass"
          />
        </Field>
      </Group>
      <Group title="Designs and pages" tag={<New />} note="Where a design or an HTML page an agent shows you opens. Any one of them can still open the other way from its own buttons.">
        <Field title="Open them" below>
          <PictureCards label="Where designs and pages open" value={look.designs} options={DESIGNS} onPick={(designs) => set({ designs })} />
        </Field>
        <Field title="Bring the panel up when an agent shows one" note="Beside the chat only, and not while you're in the diff or a terminal." off={look.designs === "chat"}>
          <NamedSwitch name="Bring the panel up when an agent shows one" checked={look.designsAuto} disabled={look.designs === "chat"} onCheckedChange={(designsAuto) => set({ designsAuto })} />
        </Field>
      </Group>
      <Group title="Background" note="A picture behind the session, blurred and under a wash, so the work stays easy to read. The sidebar never shows it.">
        <Field title="Picture" below>
          <Backgrounds value={look.background ?? "none"} onPick={(background) => set({ background })} />
        </Field>
        {look.background && look.background !== "none" && (
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

/** One picture as a tile. */
function BgTile({ id, label, on, onPick, children }: { id: string; label: string; on: boolean; onPick: () => void; children?: ReactNode }) {
  const url = useBackgroundUrl(id === "none" ? undefined : id);
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} title={label} className="lc-bgs-t l-focus" data-on={on || undefined} data-id={id} onClick={onPick}>
      {url ? <img src={url} alt="" draggable={false} /> : children}
    </button>
  );
}

/** None, your own picture, and the landscapes this Mac keeps; a new picture of your own from a file. */
function Backgrounds({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const [list, setList] = useState<{ pictures: { id: string; name: string }[]; own: boolean } | null>(null);
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
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
    void rpc("background.remove", {}).then(() => {
      ownChanged();
      setN((x) => x + 1);
      if (value === "own") onPick("none");
    });
  return (
    <div className="lc-bgs">
      <div className="lc-bgs-grid" role="radiogroup" aria-label="Background picture">
        <BgTile id="none" label="None" on={value === "none"} onPick={() => onPick("none")}>
          <span className="lc-bgs-none">None</span>
        </BgTile>
        {list?.own && <BgTile id="own" label="Your picture" on={value === "own"} onPick={() => onPick("own")} />}
        {list?.pictures.map((p) => <BgTile key={p.id} id={p.id} label={p.name} on={value === p.id} onPick={() => onPick(p.id)} />)}
        <label className="lc-bgs-t lc-bgs-add l-focus" title="A picture of your own" data-busy={busy || undefined}>
          <input type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/tiff,image/gif,image/webp" onChange={(e) => (e.target.files?.[0] && add(e.target.files[0]), (e.target.value = ""))} />
          {busy ? <span className="l-shimmer">Adding</span> : <I.plus size={14} />}
        </label>
      </div>
      <p className="lc-bgs-note">
        {list && !list.pictures.length ? "Add a picture of your own with +." : "Photos from this Mac's Desktop Pictures, or your own with +."}
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
      note="A VS Code colour theme, or one you make from a few colours. A theme sets the mode and the accent too."
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
            <I.plus size={12} />
            Make one
          </button>
        </span>
      }
    >
      <ThemeRow name="Liner" note="Light, dark and the accent above" colors={null} on={!look.custom} onUse={() => set({ custom: undefined })} />
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
              data-kind="accent"
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
            <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={!pasted.trim()} onClick={() => take(pasted)}>
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

function ThemeRow({ name, note, colors, on, onUse, onEdit, onRemove }: { name: string; note: string; colors: Theme["colors"] | null; on: boolean; onUse: () => void; onEdit?: () => void; onRemove?: () => void }) {
  return (
    <Field
      lead={
        <span className="lc-th-chip" aria-hidden style={colors ? { background: colors.bg } : undefined}>
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
          <I.trash size={13} />
        </button>
      )}
    </Field>
  );
}

/* -------------------------------- Notifications -------------------------------- */

function Notifications({ sound }: { sound: boolean }) {
  const s = useEngine((x) => x.settings);
  return (
    <>
      <Group title="When you're in another app">
        <Field title="Tell me when a session needs me" note="A notification when an agent waits for you, finishes, or runs into a problem.">
          <NamedSwitch name="Tell me when a session needs me" checked={s.notify} onCheckedChange={(notify) => save({ notify })} />
        </Field>
        <Field title={os.windows ? "Mark them on the taskbar" : "Count them on the Dock"} note={os.windows ? "A red dot on the taskbar button while sessions need you; its tooltip counts them." : "The Dock icon shows how many sessions need you."}>
          <NamedSwitch name={os.windows ? "Mark them on the taskbar" : "Count them on the Dock"} checked={s.badge} onCheckedChange={(badge) => save({ badge })} />
        </Field>
        <Field title={os.windows ? "Show them in the notification area" : "Show them in the menu bar"} note={os.windows ? "A ring in the notification area, its tooltip counting what works and what needs you; its menu opens a session, or allows a request waiting in one." : "A ring in the menu bar counts what works and what needs you; its menu opens a session, or allows a request waiting in one."}>
          <NamedSwitch name={os.windows ? "Show them in the notification area" : "Show them in the menu bar"} checked={s.menuBar !== false} onCheckedChange={(menuBar) => save({ menuBar })} />
        </Field>
      </Group>
      <Group title="In Liner Code">
        <Field title="Sounds" note="Soft ticks when you pick, toggle and send. Made on the fly, never loud.">
          <NamedSwitch name="Sounds" checked={sound} onCheckedChange={(on) => feedback.setEnabled(on)} />
        </Field>
      </Group>
    </>
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
      if (!/^(mod|ctrl|alt)\+/.test(spec) && !/^f\d+$/.test(spec)) return toast(os.macKeys ? "Use ⌘, ⌃ or ⌥ with it" : "Use Ctrl or Alt with it", { description: "A key on its own would fire while you type." });
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
      <Group title="As JSON" note={<>The way VS Code writes keybindings.json. An entry gives a command its keys in place of its own; <span className="lc-mono">-command</span> takes its keys away; <span className="lc-mono">when</span> narrows it to session, composer, review, settings or textInput, with ! and &&.</>}>
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
            <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={json.trim() === JSON.stringify(mine, null, 2).trim()} onClick={saveJson}>
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
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={looking} onClick={lookAgain}>
            <I.refresh size={13} />
            {looking ? "Looking" : "Look again"}
          </button>
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
                      <ModelMark kind={markOf(`${p.id}:`)} size={15} />
                    </span>
                  }
                  title={
                    <>
                      {p.label} <Badge tone={state === "Ready" ? "ok" : state === "Soon" ? "neutral" : "warn"}>{state}</Badge>
                      {UNTRIED.has(p.id) && p.adapter && <Badge tone="neutral">Beta</Badge>}
                    </>
                  }
                  note={p.available ? `${p.version ?? "Installed"}${p.adapter ? ` · ${p.detail ?? ""}` : " · Liner Code can't drive it yet"}` : (p.detail ?? "Not installed")}
                >
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
                      {p.modelsFrom === "cli" ? `${p.label} listed ${p.models.length === 1 ? "this" : `these ${p.models.length}`}${p.models.some((m) => m.legacy) ? `, ${p.models.filter((m) => m.legacy).length} older` : ""}${p.modelsAt ? `, ${since(p.modelsAt)}` : ""}` : `Asking ${p.label} for its models`}
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
      <CustomModels />
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
                <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => keyVal.trim() && void saveKey(id, keyVal.trim())}>
                  Save
                </button>
              </span>
            ) : keys.includes(id) ? (
              <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void saveKey(id, null)}>
                Remove
              </button>
            ) : (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setKeyFor(id)}>
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
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy || !code.trim()} onClick={() => void redeem(code.trim())}>
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

function ProviderRow({ p, fallback, onRemove, children }: { p?: ProviderInfo; fallback: string; onRemove: () => void; children?: ReactNode }) {
  const state = !p ? "Looking" : !p.available ? "Not found" : "Ready";
  return (
    <Field
      lead={
        <span className="lc-st-mark">
          <ModelMark kind={markOf(`${p?.id ?? "other"}:`)} size={15} />
        </span>
      }
      title={
        <>
          {p?.label ?? fallback} <Badge tone={state === "Ready" ? "ok" : state === "Looking" ? "neutral" : "warn"}>{state}</Badge>
        </>
      }
      note={p ? `${p.version ? `${p.version} · ` : ""}${p.detail ?? ""}` : "Looking for it"}
    >
      {children}
      <button type="button" className="lc-ib l-focus" aria-label={`Remove ${p?.label ?? fallback}`} title="Remove" onClick={onRemove}>
        <I.trash size={13} />
      </button>
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
      note="The same tool with a sign-in of its own: work and personal, or a router. Each one is a tool of its own in the model picker."
      end={
        !adding && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAdding(true)}>
            <I.plus size={12} />
            Add an account
          </button>
        )
      }
    >
      {adding && <AccountForm tools={tools} taken={accounts} onDone={() => setAdding(false)} />}
      {accounts.map((a) => {
        const p = providers.find((x) => x.id === `${a.provider}.${a.id}`);
        return (
          <ProviderRow key={`${a.provider}.${a.id}`} p={p} fallback={a.label} onRemove={() => save({ accounts: accounts.filter((x) => x !== a), favoriteModels: favs.filter((r) => !r.startsWith(`${a.provider}.${a.id}:`)) })}>
            {p?.available && (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" title={p.login} onClick={() => bridge.runInTerminal(p.login)}>
                Sign in
              </button>
            )}
          </ProviderRow>
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
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={!id || clash} onClick={add}>
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
        <Pop label="Add an agent" align="end" width={440} triggerClass="lc-btn lc-st-addb" trigger={<><I.plus size={12} />Add an agent</>}>
          {(close) => <Registry onDone={close} />}
        </Pop>
      }
    >
      {added.map((a) => (
        <ProviderRow key={a.id} p={providers.find((x) => x.id === `acp.${a.id}`)} fallback={a.label} onRemove={() => remove(a.id, a.label)} />
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
    void bridge.keychainSet(`key:${endpointKey(e.id)}`, null).catch(() => {});
    void rpc("keys.set", { provider: endpointKey(e.id), key: null }).catch(() => {});
  };
  return (
    <Group
      title="API endpoints"
      note="Models from an API, run through the tool that speaks it: Claude Code, Codex or OpenCode. They get that tool's files, commands and approvals, and Liner Code's Browser and designs."
      end={
        !adding && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAdding(true)}>
            <I.plus size={12} />
            Add an endpoint
          </button>
        )
      }
    >
      {adding && <EndpointForm taken={endpoints} onDone={() => setAdding(false)} />}
      {endpoints.map((e) => (
        <ProviderRow key={e.id} p={providers.find((x) => x.id === `${ENDPOINT_TOOL[e.protocol]}.${e.id}`)} fallback={e.label} onRemove={() => remove(e)}>
          <span className="lc-quiet" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            {e.models.length === 1 ? e.models[0] : `${e.models.length} models`}
          </span>
        </ProviderRow>
      ))}
      {!adding && !endpoints.length && <p className="lc-st-none lc-quiet">None yet. A DeepSeek or Kimi key, OpenRouter, or a model running on {os.here} in LM Studio or Ollama.</p>}
    </Group>
  );
}

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
              <button key={m} type="button" className="lc-btn" data-kind={list.includes(m) ? "primary" : "plain"} data-size="sm" aria-pressed={list.includes(m)} onClick={() => pick(m)}>
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
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={!slug(label) || clash || !url.trim() || !list.length || busy !== null} onClick={() => void add()}>
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
          <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={!command.trim() || busy !== null} onClick={() => void add({ label, command })}>
            {busy ? "Adding" : "Add"}
          </button>
        </div>
      </div>
    );
  return (
    <div className="lc-reg">
      <div className="lc-mp-find lc-reg-find">
        <I.search size={13} />
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
        <button type="button" className="lc-ib l-focus" aria-label="Read the registry again" title="Read the registry again" onClick={() => (setList(null), load(true))}>
          <I.refresh size={13} />
        </button>
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
    <Group title="Models you added" note="A model id a tool takes but doesn't list: a preview, a fine-tune, a router's name for one. It shows after the tool's own.">
      {mine.map((c) => (
        <Field key={`${c.provider}:${c.id}`} lead={<span className="lc-st-mark"><ModelMark kind={markOf(`${c.provider}:${c.id}`)} size={15} /></span>} title={c.label || c.id} note={`${providerLabel(`${c.provider}:`, providers)} · ${c.id}`}>
          <button type="button" className="lc-ib l-focus" aria-label={`Remove ${c.label || c.id}`} title="Remove" onClick={() => save({ customModels: mine.filter((x) => x !== c) })}>
            <I.trash size={13} />
          </button>
        </Field>
      ))}
      <div className="lc-st-form lc-st-cm">
        <Select options={tools.map((p) => ({ value: p.id, label: p.label }))} value={pick} onValueChange={setTool} placeholder="Tool" />
        <input className="lc-input lc-mono" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Model id" aria-label="Model id" aria-invalid={clash || undefined} spellCheck={false} />
        <input className="lc-input" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Name (optional)" aria-label="Name" />
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={!id.trim() || clash} title={clash ? "That tool lists it already" : undefined} onClick={add}>
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
  const threads = useEngine((x) => x.threads);
  return (
    <Group
      title="Agents"
      note="A name, a model, how hard it thinks, and a soul.md that says how it works."
      end={
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => onAgent()}>
          <I.plus size={13} />
          New agent
        </button>
      }
    >
      {agents.map((a) => {
        const used = threads.filter((t) => t.agent === a.id || t.lead === a.id).length;
        return (
          <Field key={a.id} lead={<Disc agent={a} size={28} />} title={a.name} note={`${a.role}${a.id === "demo" ? " · scripted, no account" : ` · ${a.effort} effort`} · ${plural(used, "session")}`}>
            <ModelTag kind={markOf(a.model)} label={modelLabel(a.model, providers)} />
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

/* ----------------------------------- Safety ----------------------------------- */

/**
  Agents outside Liner Code: Claude Code or Codex in a terminal may list, read, start and message
  sessions through Liner Code's MCP server, while this is on. Sessions they start ask you as any
  other does.
*/
function Outside() {
  const on = useEngine((x) => x.settings.outside === true);
  const [info, setInfo] = useState<{ claude: string; codex: string } | null>(null);
  useEffect(() => {
    if (on) void rpc("outside.info", {}).then(setInfo).catch(() => setInfo(null));
  }, [on]);
  const copy = (cmd: string) => void navigator.clipboard.writeText(cmd).then(() => toast("Copied", { description: "Run it once in a terminal." }));
  return (
    <Group title="Agents outside Liner Code" note="Claude Code or Codex in a terminal can list and read your sessions, start one in a project, message it and wait for it. What those sessions ask still comes to you here.">
      <Field title="Let them in" note={on ? "Through Liner Code's MCP server, with a key only you can read. Off, it turns them away." : "Off: nothing outside Liner Code can reach your sessions."}>
        <NamedSwitch name="Let agents outside Liner Code in" checked={on} onCheckedChange={(outside) => save({ outside })} />
      </Field>
      {on &&
        info &&
        (["claude", "codex"] as const).map((k) => (
          <Field key={k} title={k === "claude" ? "Add it to Claude Code" : "Add it to Codex"} note={<span className="lc-mono lc-st-cmd">{info[k]}</span>}>
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => copy(info[k])}>
              Copy
            </button>
          </Field>
        ))}
    </Group>
  );
}

function Safety() {
  const s = useEngine((x) => x.settings);
  return (
    <>
      <Group title="What a new session may do" note="Six steps, from looking only to acting on its own. A session can change it any time from its composer.">
        <div className="lc-st-radios">
          <RadioGroup label="Default access" showLabel={false} value={s.defaultAccess} onValueChange={(v) => save({ defaultAccess: v as Access })} options={ACCESS_LEVELS.map((l) => ({ value: l.id, label: l.label, description: l.note }))} />
        </div>
      </Group>
      <Group title="Always asks">
        <Field title="Commands that can't be undone" note="Even in Full access: force pushes, rm -rf, sudo, publishing. They come back to you as a request.">
          <NamedSwitch name="Always ask before commands that can't be undone" checked={s.guardDestructive} onCheckedChange={(guardDestructive) => save({ guardDestructive })} />
        </Field>
        <Field title="Committing, pushing and merging" note="Agents never commit, push or merge on their own. Commit stays a press in the Changes panel." />
      </Group>
      <Outside />
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
  const projects = useEngine((x) => x.projects);
  const keys = useEngine((x) => x.keys);
  const home = useEngine((x) => x.home);
  // A restart stops turns where they are, so it waits for the sessions at work.
  const working = useEngine((x) => x.threads.filter((t) => t.status === "running").length);
  const [adding, setAdding] = useState(false);
  const update = (id: string, p: { enabled?: boolean; version?: number; removed?: boolean }) => void rpc("addons.update", { id, ...p }).catch(fail);
  const shown = addons.filter((a) => !a.removed);
  const removed = addons.filter((a) => a.removed);
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
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <I.plus size={13} />
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
                <I.plug size={15} />
              </span>
            }
            title={a.name}
            note={[where(a), keyed(a), `added by ${a.by.agent}${a.by.title ? ` in “${a.by.title}”` : ""}, ${since(a.by.at)}`].filter(Boolean).join(" · ")}
          >
            {a.secrets.length > 0 && <AddonKeys a={a} />}
            <Pop label={`Versions of ${a.name}`} align="end" width={220} triggerClass="lc-st-ver lc-mono" disabled={a.versions.length < 2} trigger={<>v{a.version}{a.versions.length > 1 && <I.chevD size={11} />}</>}>
              {(close) => [...a.versions].reverse().map((v) => <Row key={v} title={`v${v}`} note={v === a.version ? "In use" : undefined} on={v === a.version} onPick={() => (update(a.id, { version: v }), close())} />)}
            </Pop>
            <NamedSwitch name={`${a.name} for every agent tool`} checked={a.enabled} onCheckedChange={(enabled) => update(a.id, { enabled })} />
          </Field>
        ))}
        {!shown.length && !adding && <p className="lc-st-none lc-quiet">None yet. Ask an agent to connect a service (“Connect Linear's MCP server”), and it asks you on a card in the session first.</p>}
        {removed.map((a) => (
          <div key={a.id} className="lc-st-removed">
            <I.box size={13} />
            <span>
              Removed: {a.name}, {since(a.removed!)}. Its files are kept.
            </span>
            <button type="button" className="lc-answered-act l-focus" onClick={() => update(a.id, { removed: false })}>
              Restore
            </button>
          </div>
        ))}
      </Group>
      <Group title="Who may add one" note="An agent never adds one on its own: it asks in the session, with what it reaches.">
        <Field title="Agents may offer add-ons" note="In a read-only session they can't, whatever this says.">
          <Segmented size="sm" value={offers} onValueChange={(v) => save({ addonOffers: v })} options={[{ value: "ask" as const, label: "They ask" }, { value: "never" as const, label: "Never" }]} aria-label="Agents may offer add-ons" />
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
            <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={!Object.values(values).some((v) => v.trim())} onClick={() => void keep(close)}>
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
function AddByHand({ onDone }: { onDone: () => void }) {
  const projects = useEngine((x) => x.projects);
  const [text, setText] = useState("");
  const [project, setProject] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => {
    try {
      const m = JSON.parse(text) as { id?: unknown; secrets?: { name?: unknown; label?: unknown }[] };
      return { id: String(m.id ?? ""), secrets: Array.isArray(m.secrets) ? m.secrets.map((k) => ({ name: String(k.name ?? ""), label: String(k.label ?? k.name ?? "") })).filter((k) => k.name) : [] };
    } catch {
      return null;
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
        autoFocus
        placeholder={'{\n  "apiVersion": 1,\n  "id": "linear",\n  "kind": "connection",\n  "name": "Linear",\n  "server": { "http": { "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer ${LINEAR_API_KEY}" } } },\n  "secrets": [{ "name": "LINEAR_API_KEY", "label": "Linear key" }]\n}'}
      />
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
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={busy || !parsed} onClick={() => void add()}>
          {busy ? "Adding" : "Add it"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- Projects ---------------------------------- */

function Projects() {
  const projects = useEngine((x) => x.projects);
  const agents = useEngine((x) => x.agents);
  const threads = useEngine((x) => x.threads);
  const [sure, setSure] = useState<string | null>(null);
  const add = () =>
    void bridge.pickFolder().then((p) => {
      if (p)
        void rpc("project.add", { path: p })
          .then((x) => toast.success(`Added ${x.name}`))
          .catch(fail);
    });
  const options = [{ value: "", label: "Whoever Home picks" }, ...agents.map((a) => ({ value: a.id, label: a.id === "demo" ? "Demo (scripted)" : `${a.name} · ${a.role}` }))];
  return (
    <Group
      title={plural(projects.length, "project")}
      note="Removing a project only forgets it here. Its folder stays as it is."
      end={
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={add}>
          <I.plus size={13} />
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
                  <I.folder size={15} />
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
                data-kind={sure === p.id ? "danger" : "ghost"}
                data-size="sm"
                onBlur={() => setSure(null)}
                onClick={() => {
                  if (sure !== p.id) return setSure(p.id);
                  setSure(null);
                  void rpc("project.remove", { id: p.id })
                    .then(() => toast(`Forgot ${p.name}`))
                    .catch(fail);
                }}
              >
                {sure === p.id ? "Remove it" : "Remove"}
              </button>
            </Field>
            <ScriptsEditor project={p} />
            <RulesEditor project={p} />
            <MemoryEditor project={p} />
            {p.git && (
              <Field title="Set up each new worktree" note="Runs in a session's own worktree before its first turn, since a new worktree has none of this checkout's installed packages.">
                <input
                  className="lc-input lc-mono lc-st-setup"
                  key={p.setup ?? ""}
                  defaultValue={p.setup ?? ""}
                  placeholder="npm install"
                  spellCheck={false}
                  aria-label={`Setup command for ${p.name}`}
                  onBlur={(e) => e.target.value.trim() !== (p.setup ?? "") && void rpc("project.update", { id: p.id, setup: e.target.value }).catch(fail)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </Field>
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
  const [draft, setDraft] = useState("");
  useEffect(() => {
    void rpc("memory.list", { projectId: project.id })
      .then(setFacts)
      .catch(() => setFacts([]));
  }, [project.id]);
  if (!facts) return null;
  const add = () => {
    if (!draft.trim()) return;
    void rpc("memory.add", { projectId: project.id, fact: draft })
      .then((f) => (setFacts(f), setDraft("")))
      .catch(fail);
  };
  return (
    <Field title="What agents remember" note={facts.length ? `${plural(facts.length, "fact")} agents saved here. Every new session in this project starts with them.` : "Nothing yet. Agents save facts here as they learn them (a command that works, a decision you made), and every new session starts with them."} below>
      <div className="lc-mem">
        {facts.map((f, i) => (
          <div key={`${i}:${f}`} className="lc-mem-row">
            <span>{f}</span>
            <button type="button" className="lc-ib l-focus" aria-label={`Forget: ${f}`} title="Forget it" onClick={() => void rpc("memory.forget", { projectId: project.id, index: i }).then(setFacts).catch(fail)}>
              <I.close size={12} />
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
      </div>
    </Field>
  );
}

function RulesEditor({ project }: { project: Project }) {
  const [rules, setRules] = useState<ProjectRules | null>(null);
  useEffect(() => {
    void rpc("project.rules", { id: project.id })
      .then(setRules)
      .catch(() => setRules(null));
  }, [project.id]);
  if (!rules) return null;
  const { claude, agents, linked } = rules;
  const same = linked || (claude !== undefined && agents !== undefined && claude.trim() === agents.trim());
  const note = !claude && !agents ? "None yet. Every agent here reads what you write." : same ? "One text for every agent: AGENTS.md, which CLAUDE.md points to." : !agents ? "Only in CLAUDE.md, so Codex, OpenCode and Cursor don't see them." : !claude ? "Only in AGENTS.md, so Claude Code doesn't see them." : "CLAUDE.md and AGENTS.md say different things.";
  // What the editor starts with: the one text, or both under their names so you can make them one.
  const start = linked || !claude ? (agents ?? "") : !agents || same ? claude : `${agents.trim()}\n\n<!-- From CLAUDE.md -->\n${claude.trim()}\n`;
  return (
    <Field title="Rules for every agent" note={note}>
      <Pop label={`Rules for ${project.name}`} align="end" width={520} triggerClass="lc-btn" trigger={<>{claude || agents ? "Edit" : "Write them"}</>}>
        {(close) => <RulesForm project={project} start={start} merging={!same && Boolean(claude && agents)} onSaved={(r) => (setRules(r), close())} />}
      </Pop>
    </Field>
  );
}

function RulesForm({ project, start, merging, onSaved }: { project: Project; start: string; merging: boolean; onSaved: (r: ProjectRules) => void }) {
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
      <textarea className="lc-input lc-mono lc-rules-t" value={text} onChange={(e) => setText(e.target.value)} placeholder={"How to build and test, what to leave alone, the house style…"} spellCheck={false} aria-label={`Rules for ${project.name}`} autoFocus />
      <p className="lc-quiet lc-rules-n">{merging ? "Both files are here, one under the other: make them one text. " : ""}Saving writes AGENTS.md and makes CLAUDE.md a one-line @AGENTS.md, which Claude Code follows. Commit them with the project.</p>
      <div className="lc-rules-f">
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={busy || !text.trim()} onClick={save}>
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
              <input type="checkbox" checked={Boolean(x.onWorktree)} onChange={(e) => commit(list.map((y, k) => (k === i ? { ...y, onWorktree: e.target.checked } : y)))} />
              New worktrees
            </label>
            <button type="button" className="lc-ib l-focus" aria-label={`Remove ${x.name || "the script"}`} onClick={() => commit(list.filter((_, k) => k !== i))}>
              <I.close size={12} />
            </button>
          </span>
        ))}
        <span className="lc-script-add">
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setList((l) => [...l, { id: `s${Date.now().toString(36)}`, name: "", command: "" }])}>
            <I.plus size={12} />
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
          <I.close size={10} />
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
  const [prefix, setPrefix] = useState(s.branchPrefix);
  useEffect(() => setPrefix(s.branchPrefix), [s.branchPrefix]);
  const trees = threads.filter((t) => t.worktree && !t.archived);
  const commitPrefix = () => {
    const v = prefix.trim().replace(/\s+/g, "-");
    if (v && v !== s.branchPrefix) save({ branchPrefix: v.endsWith("/") || v.endsWith("-") ? v : `${v}/` });
    else setPrefix(s.branchPrefix);
  };
  return (
    <>
      <Group title="Worktrees">
        <Field title="Start new sessions in a worktree" note="Each gets a branch and a folder of its own. Off, they work in the project's checkout.">
          <NamedSwitch name="Start new sessions in a worktree" checked={s.worktrees} onCheckedChange={(worktrees) => save({ worktrees })} />
        </Field>
        <Field title="Branch names start with" note={`A new worktree's branch is this, then the session's id: ${s.branchPrefix}mvpa5q8q`}>
          <span className="lc-st-input">
            <I.branch size={13} />
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} onBlur={commitPrefix} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} spellCheck={false} aria-label="Branch prefix" />
          </span>
        </Field>
        <Field title="Where worktrees live" note="Another drive or folder, for big projects. Worktrees already made stay where they are.">
          <span className="lc-st-input lc-st-wide">
            <I.folder size={13} />
            <input
              key={s.worktreeRoot ?? ""}
              defaultValue={s.worktreeRoot ?? ""}
              placeholder={tilde(`${home}/worktrees`)}
              spellCheck={false}
              aria-label="Where worktrees live"
              onBlur={(e) => e.target.value.trim() !== (s.worktreeRoot ?? "") && save({ worktreeRoot: e.target.value.trim() || undefined })}
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
        <Field title="Keep the default branch pulled" note="Every 15 minutes, a project whose checkout sits on its default branch with nothing changed fast-forwards to the remote, so new worktrees start from the latest.">
          <NamedSwitch name="Keep the default branch pulled" checked={Boolean(s.autoPull)} onCheckedChange={(autoPull) => save({ autoPull })} />
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
        <Field title="Every turn is kept" note="Before and after each turn, Liner Code saves the project as a commit under refs/liner/, without touching your staging area. That's what Undo turn and the diff use." />
        <Field title="Folders that aren't repositories" note="Get no snapshots, so no diff and no undo. Run git init in them to get both." />
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
      <div className="lc-st-empty">
        <I.box size={20} />
        <b>Nothing archived</b>
        <span>Archive a session from the command menu ({os.mod}K) to put it away without deleting it.</span>
      </div>
    );
  return (
    <Group title={plural(list.length, "session")}>
      {list.map((t) => (
        <Field key={t.id} title={t.title} note={`${projects.find((p) => p.id === t.projectId)?.name ?? "No project"} · ${agentOf(t.agent, agents, providers).name} · ${ago(t.updatedAt)}`}>
          <button
            type="button"
            className="lc-btn"
            data-kind="plain"
            data-size="sm"
            onClick={() =>
              void rpc("thread.update", { id: t.id, archived: false })
                .then(() => toast(`${t.title} is back in the sidebar`))
                .catch(fail)
            }
          >
            Restore
          </button>
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void rpc("thread.remove", { id: t.id }).catch(fail)}>
            Delete
          </button>
        </Field>
      ))}
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
        note={u.checkedAt ? `Looked ${since(u.checkedAt)}, and again every six hours.` : "Looks a few seconds after it opens, then every six hours."}
        end={
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy} onClick={() => void look()}>
            <I.refresh size={13} />
            {busy ? <span className="l-shimmer">Looking</span> : "Look now"}
          </button>
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
        <Field title="Updates" note={appMode === "auto" ? "Downloads a release in the background and checks it; it goes in when you restart or quit." : appMode === "notify" ? "Tells you on Home when a release is out, and you download it." : "Doesn't look for releases. Look now still does."}>
          <Segmented size="sm" value={appMode} onValueChange={(v) => save({ updateApp: v as UpdateMode })} options={UPDATE_MODES} aria-label="Liner Code's updates" />
        </Field>
        <Field title="Releases from" note={a.repo ? <span className="lc-mono">github.com/{a.repo}</span> : "No GitHub repository: this copy was built without one, so it has nowhere to look."}>
          {a.repo && (
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => bridge.openExternal(`https://github.com/${a.repo}/releases`)}>
              <I.external size={13} />
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
        <Field title="Updates" note={toolMode === "auto" ? "Runs a tool's updater as soon as a new version is out and nothing is working on it." : toolMode === "notify" ? "Tells you on Home when a tool has a new version, and you update it." : "Doesn't look for new versions. Look now still does."}>
          <Segmented size="sm" value={toolMode} onValueChange={(v) => save({ updateTools: v as UpdateMode })} options={UPDATE_MODES} aria-label="The agent tools' updates" />
        </Field>
        {u.tools.length ? u.tools.map((t) => <ToolRow key={t.id} t={t} />) : <Field title="No agent tools yet" note={u.checkedAt ? `None of Claude Code, Codex, OpenCode, Hermes or Grok Build is on ${os.here}. Install one in Models.` : "They show here after the first look."} />}
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
      <I.external size={13} />
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
        <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => void updates.restart()}>
          Restart to update
        </button>
      );
  } else if (a.state === "available") {
    if (a.can === "install") {
      note = `${a.latest} is out${a.size ? `, ${sizeOf(a.size)}` : ""}.`;
      control = (
        <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={updates.download}>
          <I.download size={13} />
          Download
        </button>
      );
    } else {
      note = a.can === "source" ? `${a.latest} is out. This copy runs from source: pull and build it to update.` : a.can === "translocated" ? `${a.latest} is out. Move Liner Code to Applications first, so it can update itself.` : `${a.latest} is out. Liner Code can't write to its folder, so get it from the release page.`;
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
    <Field lead={<ModelMark kind={markOf(`${t.id}:`)} size={16} />} title={<>{t.label} <Ver from={t.current} to={fresh ? t.latest : undefined} /></>} note={note}>
      {(t.state === "available" || t.state === "failed") && (
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => updates.tool(t.id)}>
          {t.state === "failed" ? "Try again" : "Update"}
        </button>
      )}
      {/* How far the updater has got when it says; a calm sweep while it doesn't. */}
      {t.state === "updating" && <Progress className="lc-up-bar" size="sm" value={t.progress} label={t.progress === undefined ? "Updating" : undefined} />}
      {t.state === "waiting" && <Badge tone="warn">Waiting</Badge>}
      {t.state === "updated" && <Badge tone="ok">Updated</Badge>}
    </Field>
  );
}

/* ------------------------------------ Data ------------------------------------ */

function Data({ onSetup }: { onSetup: () => void }) {
  const home = useEngine((x) => x.home);
  const version = useEngine((x) => x.version);
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
      <Group title={`On ${os.here}`}>
        <Field
          title="Sessions, projects and settings"
          note={
            <>
              <span className="lc-mono">{tilde(home)}</span> · {plural(threads, "session")}
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
      <Group title="About">
        <Field title={`Liner Code ${version}`} note="Your models, your code. Built from Liner UI.">
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "updates" }))}>
            Updates
          </button>
        </Field>
        <Field title="First run" note="Connect models, add projects and choose how you work, again.">
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => (save({ onboarded: false }), onSetup())}>
            Start setup
          </button>
        </Field>
      </Group>
    </>
  );
}
