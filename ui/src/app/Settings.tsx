/*
  Settings take the whole window. The glass column swaps the sessions for the settings' own
  places (Liner's Sidebar, with a search that narrows them), and the paper holds one place at a
  time: a title that says what it covers, then groups of rows in glass frames, each row a name,
  a line on what it does, and its control. Looks live in this window (localStorage) and apply at
  once; the rest lives in the engine. Escape, ⌘, or Back returns to the sessions.
*/
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Access, AgentProfile, AppUpdate, BuiltinProvider, CustomModel, KeyBinding, Project, ProjectRules, ProjectScript, ProviderInfo, RegistryAgent, Settings as EngineSettings, ToolAccount, ToolUpdate, UpdateMode } from "@contracts";
import { ACCOUNT_HOME, updateModes } from "@contracts";
import { Breadcrumb } from "@liner/components/breadcrumb/breadcrumb";
import { RadioCards } from "@liner/components/radio-cards/radio-cards";
import { RadioGroup } from "@liner/components/radio-group/radio-group";
import { Segmented } from "@liner/components/segmented/segmented";
import { Select } from "@liner/components/select/select";
import { Slider } from "@liner/components/slider/slider";
import { Sidebar, type SidebarSection } from "@liner/components/sidebar/sidebar";
import { Switch } from "@liner/components/switch/switch";
import { toast } from "@liner/components/toast/toast";
import { feedback } from "@liner/lib/feedback";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { Agentic } from "./Agentic";
import { Backdrop, ownChanged, sceneOf, useBackgroundUrl } from "./Backdrop";
import { bridge, isNative } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I, ModelMark } from "./icons";
import { ACCESS_LEVELS, accessOf, agentOf, ago, markOf, modelLabel, plural, providerLabel, setupLine, setupOf, setupsOf, since } from "./model";
import { Badge, Disc, Kbd, ModelTag, Pop } from "./ui";
import { bindingsOf, commandOn, COMMANDS, FIXED, glyphs, onBindings, readBindings, specOf } from "./keymap";
import { current, fromVSCode, readThemes, saveThemes, type Theme } from "./themes";
import { appHasNews, sizeOf, updates } from "./Updates";
import { applyLook, LOOK_DEFAULT, LOOK_KEY, readLook, type Look } from "./look";

const isMac = /Mac/.test(navigator.platform);

const ACCENTS = [
  { id: "blue", color: "oklch(0.6 0.19 258)" },
  { id: "violet", color: "oklch(0.58 0.2 292)" },
  { id: "teal", color: "oklch(0.62 0.12 195)" },
  { id: "orange", color: "oklch(0.68 0.17 50)" },
  { id: "rose", color: "oklch(0.62 0.2 12)" },
];

export type SettingsPage = "general" | "appearance" | "notifications" | "keyboard" | "models" | "agentic" | "team" | "safety" | "projects" | "git" | "archive" | "updates" | "data";

/** Each place: where it sits, what it covers, and the words a search finds it by. */
const PLACES: { id: SettingsPage; label: string; icon: ReactNode; group: string; blurb: string; words: string }[] = [
  { id: "general", label: "General", icon: <I.sliders />, group: "Liner Code", blurb: "How new sessions start, and what Enter does while an agent works.", words: "work style lead coder team model worktree checkout enter queue steer setup first run done settle merge budget spend" },
  { id: "appearance", label: "Appearance", icon: <I.contrast />, group: "Liner Code", blurb: "Light or dark, the accent, the window's glass, and a picture behind the session.", words: "theme dark light accent color glass tint clear material vibrancy liquid background wallpaper picture image photo blur" },
  { id: "notifications", label: "Notifications", icon: <I.bell />, group: "Liner Code", blurb: "When Liner Code tells you something, and how.", words: "notify alert dock badge sound sounds feedback" },
  { id: "keyboard", label: "Keyboard", icon: <I.keyboard />, group: "Liner Code", blurb: "Every shortcut in one place.", words: "shortcut keys hotkey command" },
  { id: "models", label: "Models", icon: <I.chip />, group: "Agents", blurb: "The agent tools on this Mac, how they sign in, and the keys they bill to.", words: "provider claude codex opencode hermes cursor grok install sign in key api billing anthropic openai" },
  { id: "agentic", label: "Agentic features", icon: <I.flow />, group: "Agents", blurb: "The ways to work side by side, a small task to test them for real, and your own setups, wired job by job.", words: "agentic way work style lead coder team model setup stage hand-off handoff context crew writer reviewer explorer test runner opus sonnet deepseek wiring wired compare cost test warning" },
  { id: "team", label: "Team", icon: <I.agents />, group: "Agents", blurb: "The agents you open sessions with: their model, effort and soul.", words: "agent helm forge lead coder soul effort new agent run mode helpers escalate opus" },
  { id: "safety", label: "Safety", icon: <I.shield />, group: "Agents", blurb: "What a new session may do without asking, and what always asks.", words: "permission access read only asks first edits full reviewer destructive guard rm force push" },
  { id: "projects", label: "Projects", icon: <I.folder />, group: "Work", blurb: "The folders agents work in, who each one starts with, and how a new worktree is set up.", words: "project folder repository add remove finder setup install worktree" },
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
  const place = PLACES.find((p) => p.id === page) ?? PLACES[0];
  const archived = useEngine((s) => s.threads.filter((t) => t.archived).length);

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
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [page]);
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
  const sections = useMemo<SidebarSection[]>(() => {
    const q = query.trim().toLowerCase();
    const hits = PLACES.filter((p) => !q || `${p.label} ${p.blurb} ${p.words}`.toLowerCase().includes(q));
    const groups = [...new Set(hits.map((p) => p.group))];
    return groups.map((g) => ({ id: g, label: g, items: hits.filter((p) => p.group === g).map((p) => ({ id: p.id, label: p.label, icon: p.icon, count: p.id === "archive" && archived ? archived : undefined })) }));
  }, [query, archived]);

  // What "Restore defaults" puts back on each place, if anything.
  const restore: Partial<Record<SettingsPage, () => void>> = {
    general: () => {
      save({ worktrees: false });
      localStorage.setItem("lc:enter", "queue");
    },
    appearance: () => setLookPart(LOOK_DEFAULT),
    notifications: () => {
      save({ notify: true, badge: true });
      feedback.setEnabled(false);
    },
    agentic: () => save({ reviewRounds: 2 }),
    safety: () => save({ defaultAccess: "ask", guardDestructive: true }),
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
        <div className="lc-sb-find lc-st-find" role="search">
          <I.search size={14} />
          <input ref={find} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))} />
          {query ? (
            <button type="button" className="lc-ib l-focus" aria-label="Clear" onClick={() => (setQuery(""), find.current?.focus())}>
              <I.close size={12} />
            </button>
          ) : (
            <span className="lc-sb-key">{isMac ? "⌘F" : "Ctrl F"}</span>
          )}
        </div>
        <Sidebar
          className="lc-st-nav"
          label="Settings"
          collapsible={false}
          sections={sections}
          value={page}
          onValueChange={(id) => setPage(id as SettingsPage)}
          footer={query && !sections.length ? <p className="lc-sb-empty">No setting matches that.</p> : undefined}
          user={
            <button type="button" className="lc-st-back l-focus" onClick={onClose}>
              <I.back size={16} />
              Back to sessions
              <span className="lc-grow" />
              <span className="lc-sb-key">esc</span>
            </button>
          }
        />
      </div>
      <main className="lc-paper lc-st-paper">
        <Backdrop />
        <header className="lc-top" data-drag>
          <Breadcrumb separator="slash" items={[{ label: "Settings", onSelect: () => setPage("general") }, { label: place.label }]} className="lc-st-crumbs" />
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

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
/** One empty list, so a store read of a missing one doesn't change every time. */
const NONE: never[] = [];
/** Tools with a driver that hasn't been run against the real tool yet. */
const UNTRIED = new Set(["cursor", "grok"]);
const save = (patch: Partial<EngineSettings>) => void rpc("settings.save", patch).catch(fail);
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/** A titled group of rows in a glass frame. */
function Group({ title, note, end, children, flush }: { title: string; note?: ReactNode; end?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="lc-st-group">
      <header>
        <span>
          <h2>{title}</h2>
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

/** One setting: its name, a line on what it does, and its control. `below` puts the control under the words. */
function Field({ title, note, children, below, lead }: { title: ReactNode; note?: ReactNode; children?: ReactNode; below?: boolean; lead?: ReactNode }) {
  return (
    <div className="lc-st-row" data-below={below || undefined}>
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
  const agents = useEngine((x) => x.agents);
  const [enter, setEnter] = useState(() => (localStorage.getItem("lc:enter") as "queue" | "steer") ?? "queue");
  const lead = agents.find((a) => /lead/i.test(a.role));
  const coder = agents.find((a) => a.specialty === "coder") ?? agents.find((a) => a.id !== "demo" && a !== lead);
  const providers = useEngine((x) => x.providers);
  const setups = setupsOf(s, agents);
  const current = s.workStyle === "team" ? `setup:${setupOf(s, agents)?.id ?? ""}` : s.workStyle;
  return (
    <>
      <Group title="New sessions" note="What Home starts with. Each session can still change it.">
        <Field title="Who you talk to" below>
          <RadioCards
            label="Who you talk to"
            columns={3}
            value={current}
            onValueChange={(v) => save(v.startsWith("setup:") ? { workStyle: "team", setup: v.slice(6) } : { workStyle: v as EngineSettings["workStyle"] })}
            options={[
              { value: "model", title: "Just a model", description: "One model answers, and edits as you allow.", icon: <I.sparkle size={16} /> },
              { value: "lead", title: "A lead and a coder", description: `${lead?.name ?? "The lead"} answers and plans changes; ${coder?.name ?? "the coder"} builds what you approve.`, icon: <I.agents size={16} /> },
              ...setups.map((x) => ({ value: `setup:${x.id}`, title: x.name, description: `${setupLine(x, agents, providers)}.`, icon: <I.flow size={16} /> })),
            ]}
          />
          <span className="lc-st-more">
            <button type="button" className="lc-st-link l-focus" onClick={() => go("agentic")}>
              {s.workStyle === "team" ? "Edit your setups" : "How each one works, side by side"}
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
        <Field title="Enter" note="What Enter does with a message you write while a turn runs. ⌘Enter does the other.">
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
        <Field title="Keep the Mac awake" note="No idle sleep while a session or a routine run works, so a long run isn't cut off. The display still sleeps.">
          <Switch checked={s.keepAwake !== false} onCheckedChange={(keepAwake) => save({ keepAwake })} label="" />
        </Field>
      </Group>
      <Group title="Settle sessions on their own" note="Settling is yours: a session stays in its project until you settle it from its row (D), and settled ones fold away under Settled, still searchable. These rules can do it for you; they're off unless you turn them on.">
        <Field title="When its pull request merges">
          <Switch checked={s.settleOnMerge ?? false} onCheckedChange={(settleOnMerge) => save({ settleOnMerge })} label="" />
        </Field>
        <Field title="When a routine run handled everything itself" note="A run that waits for you stays in its project.">
          <Switch checked={s.settleOnRoutine ?? false} onCheckedChange={(settleOnRoutine) => save({ settleOnRoutine })} label="" />
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
        <Field title="Run the setup again" note="Find the agent tools on this Mac, add projects, and choose how you work.">
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => (save({ onboarded: false }), onSetup())}>
            Start setup
          </button>
        </Field>
      </Group>
    </>
  );
}

/* --------------------------------- Appearance --------------------------------- */

/** The window in miniature: the glass column and the paper, in the look you're choosing. */
function Preview({ look }: { look: Look }) {
  const bg = useBackgroundUrl(look.background);
  // The same scene as the window: the desktop behind the frame (the stage's blur stands in for it), or the frame alone.
  const vars = bg ? ({ "--lc-pv-bg": `url("${bg}")`, "--lc-pv-blur": `${Math.round((look.bgBlur ?? 28) * 0.3)}px`, "--lc-pv-show": String(look.bgShow ?? 0.45) } as CSSProperties) : undefined;
  return (
    <div className="lc-st-preview" aria-hidden>
      <div className="lc-pv-win" data-scene={sceneOf(look)} style={vars}>
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
        </div>
      </div>
      <span className="lc-pv-cap">
        {look.theme === "system" ? "Matches the system" : look.theme === "dark" ? "Dark" : "Light"} · {look.accent} · {look.glass === "0.25" ? "clear" : look.glass === "0.9" ? "tinted" : "balanced"} glass
      </span>
    </div>
  );
}

const ThemeChip = ({ kind }: { kind: "light" | "dark" | "system" }) => <span className="lc-st-themechip" data-kind={kind} />;

function Appearance({ look, set }: { look: Look; set: (p: Partial<Look>) => void }) {
  // One of your themes holds the mode and the accent; choosing either goes back to Liner's own.
  const own = look.custom ? readThemes().find((t) => t.id === look.custom) : undefined;
  const held = own ? `${own.name} sets this while it's in use. Choosing one here goes back to Liner's own.` : undefined;
  return (
    <>
      <Preview look={look} />
      <Group title="Theme">
        <Field title="Mode" note={held} below>
          <RadioCards
            label="Theme"
            columns={3}
            value={own ? "" : look.theme}
            onValueChange={(theme) => set({ theme: theme as Look["theme"], custom: undefined })}
            options={[
              { value: "light", title: "Light", description: "White paper on light glass.", icon: <ThemeChip kind="light" /> },
              { value: "dark", title: "Dark", description: "Ink paper on dark glass.", icon: <ThemeChip kind="dark" /> },
              { value: "system", title: "Match the system", description: "Follows macOS, day and night.", icon: <ThemeChip kind="system" /> },
            ]}
          />
        </Field>
        <Field title="Accent" note={held ?? "One colour, spent on selection, focus and the main action."}>
          <span className="lc-swatches" role="radiogroup" aria-label="Accent">
            {ACCENTS.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={!own && look.accent === a.id} aria-label={a.id} title={a.id} className="lc-swatch l-focus" data-on={(!own && look.accent === a.id) || undefined} style={{ background: a.color }} onClick={() => set({ accent: a.id, custom: undefined })} />
            ))}
            <label className="lc-swatch lc-swatch-own l-focus" data-on={(!own && look.accent === "own") || undefined} title="A colour of your own" style={look.accentColor ? { background: look.accentColor } : undefined}>
              <input type="color" aria-label="A colour of your own" value={look.accentColor ?? "#2f7ae5"} onChange={(e) => set({ accent: "own", accentColor: e.target.value, custom: undefined })} onClick={() => look.accentColor && set({ accent: "own", custom: undefined })} />
              {!look.accentColor && <I.plus size={11} />}
            </label>
          </span>
        </Field>
      </Group>
      <Themes look={look} set={set} />
      <Group title="Glass" note="The window is one glass frame around the paper, and what floats over the session (menus, the rail) is glass too.">
        <Field title="Glass" note="How much of what's behind it comes through, from clear to tinted, as in macOS Appearance.">
          <Segmented
            size="sm"
            value={look.glass}
            onValueChange={(glass) => set({ glass })}
            options={[
              { value: "0.25", label: "Clear" },
              { value: "0.575", label: "Balanced" },
              { value: "0.9", label: "Tinted" },
            ]}
            aria-label="Glass"
          />
        </Field>
        {isNative() && (
          <Field title="Behind the glass" note="Vibrancy and Liquid Glass show the desktop through the frame, which keeps the graphics card working while the window is in front. Solid costs nothing.">
            <Segmented
              size="sm"
              value={look.material}
              onValueChange={(material) => set({ material })}
              options={[
                { value: "solid", label: "Solid" },
                { value: "vibrancy", label: "Vibrancy" },
                { value: "glass", label: "Liquid Glass" },
              ]}
              aria-label="Window material"
            />
          </Field>
        )}
      </Group>
      <Group title="Background" note="A picture behind the session, blurred and under the paper, so the work stays easy to read. The sidebar keeps its glass.">
        <Field title="Picture" below>
          <Backgrounds value={look.background ?? "none"} onPick={(background) => set({ background })} />
        </Field>
        {look.background && look.background !== "none" && (
          <>
            <Field title="Blur" note="Softer keeps the eye on the work.">
              <Slider label="Blur" min={8} max={48} step={2} unit="px" marks={false} value={look.bgBlur ?? 28} onValueChange={(bgBlur) => set({ bgBlur })} />
            </Field>
            <Field title="Shows through" note="How much of the picture comes through the paper.">
              <Slider label="Shows through" min={15} max={75} step={5} unit="%" marks={false} value={Math.round((look.bgShow ?? 0.45) * 100)} onValueChange={(v) => set({ bgShow: v / 100 })} />
            </Field>
          </>
        )}
      </Group>
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
          <Switch checked={s.notify} onCheckedChange={(notify) => save({ notify })} label="" />
        </Field>
        <Field title="Count them on the Dock" note="The Dock icon shows how many sessions need you.">
          <Switch checked={s.badge} onCheckedChange={(badge) => save({ badge })} label="" />
        </Field>
        <Field title="Show them in the menu bar" note="A ring in the menu bar counts what works and what needs you; its menu opens a session, or allows a request waiting in one.">
          <Switch checked={s.menuBar !== false} onCheckedChange={(menuBar) => save({ menuBar })} label="" />
        </Field>
      </Group>
      <Group title="In Liner Code">
        <Field title="Sounds" note="Soft ticks when you pick, toggle and send. Made on the fly, never loud.">
          <Switch checked={sound} onCheckedChange={(on) => feedback.setEnabled(on)} label="" />
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
      if (!/^(mod|ctrl|alt)\+/.test(spec) && !/^f\d+$/.test(spec)) return toast("Use ⌘, ⌃ or ⌥ with it", { description: "A key on its own would fire while you type." });
      const clash = COMMANDS.find((c) => c.id !== recording && bindingsOf(c.id).some((b) => b.key === spec));
      put([...mine.filter((b) => b.command !== recording && b.command !== `-${recording}`), { key: spec, command: recording }]);
      if (clash) toast(`${glyphs(spec).join("")} is also ${clash.label.split(":")[0].toLowerCase()}`, { description: "The first in the list wins. Change one of them, or narrow it with when." });
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
      toast.success(key ? "Key saved in the keychain" : "Key removed");
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
        title="Agent tools on this Mac"
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
      <CustomModels />
      <Group title="Billing and keys" note="Keys stay in the login keychain. The engine only holds them in memory.">
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
      </Group>
    </>
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
              <span className="lc-quiet lc-reg-tag" title={a.how === "uvx" ? "Install uv (brew install uv) to run it" : a.how === "npx" ? "Install Node.js to run it" : "There's no build for this Mac"}>
                {a.how === "binary" ? "Not for this Mac" : `Needs ${a.how}`}
              </span>
            ) : (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy !== null} title={a.how === "binary" ? "Downloads it for this Mac and checks it" : `Runs through ${a.how}`} onClick={() => void add({ registryId: a.id })}>
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

function Safety() {
  const s = useEngine((x) => x.settings);
  return (
    <>
      <Group title="What a new session may do" note="Five steps, from looking only to acting on its own. A session can change it any time from its composer.">
        <div className="lc-st-radios">
          <RadioGroup label="Default access" showLabel={false} value={s.defaultAccess} onValueChange={(v) => save({ defaultAccess: v as Access })} options={ACCESS_LEVELS.map((l) => ({ value: l.id, label: l.label, description: l.note }))} />
        </div>
      </Group>
      <Group title="Always asks">
        <Field title="Commands that can't be undone" note="Even in Full access: force pushes, rm -rf, sudo, publishing. They come back to you as a request.">
          <Switch checked={s.guardDestructive} onCheckedChange={(guardDestructive) => save({ guardDestructive })} label="" />
        </Field>
        <Field title="Committing, pushing and merging" note="Agents never commit, push or merge on their own. Commit stays a press in the Changes panel." />
      </Group>
    </>
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
                <button type="button" className="lc-ib l-focus" aria-label={`Show ${p.name} in Finder`} title="Show in Finder" onClick={() => bridge.reveal(p.path)}>
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
      if (!/^(mod|ctrl|alt)\+/.test(spec)) return toast("Use ⌘, ⌃ or ⌥ with it", { description: "A key on its own would fire while you type." });
      const taken = commandOn(spec);
      if (others.includes(spec)) return toast(`${glyphs(spec).join("")} already runs another script here`);
      if (taken) toast(`${glyphs(spec).join("")} is also ${taken.label.split(":")[0].toLowerCase()}`, { description: "In a session the script wins. Change one of them in Keyboard." });
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
          <Switch checked={s.worktrees} onCheckedChange={(worktrees) => save({ worktrees })} label="" />
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
          <Switch checked={Boolean(s.autoPull)} onCheckedChange={(autoPull) => save({ autoPull })} label="" />
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
        <span>Archive a session from the command menu (⌘K) to put it away without deleting it.</span>
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
        {u.tools.length ? u.tools.map((t) => <ToolRow key={t.id} t={t} />) : <Field title="No agent tools yet" note={u.checkedAt ? "None of Claude Code, Codex, OpenCode, Hermes or Grok Build is on this Mac. Install one in Models." : "They show here after the first look."} />}
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
      <>Running {cmd}</>
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
      {t.state === "updating" && <span className="l-shimmer lc-up-quiet">Updating</span>}
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
  const log = userHome ? `${userHome}/Library/Logs/Liner Code/engine.log` : null;
  return (
    <>
      <Group title="On this Mac">
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
              Show in Finder
            </button>
          )}
        </Field>
        <Field title="Engine log" note={log ? <span className="lc-mono">{tilde(log)}</span> : "What the engine did, for when something goes wrong"}>
          {isNative() && log && (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => bridge.reveal(log)}>
              Show in Finder
            </button>
          )}
        </Field>
        <Field title="API keys" note="In the login keychain, under “Liner Code”. Never written to the data folder." />
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
