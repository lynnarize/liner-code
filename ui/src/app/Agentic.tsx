/*
  Agentic features: the three modes a session works in (Solo, Plan then build, Auto), with who'd
  do what in each and what each saves; your two models, frontier and cheaper, that everything else
  follows from (and Dual frontier); what happens after each change (checked, refined, or not);
  and how each mode went in your own sessions. One model writes at a time in all three. How one
  of your agents runs (with helpers or alone) is the agent's own setting, in Team.
*/
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { After as AfterKind, Mode, ModelPicks, RouteLevel, Settings as EngineSettings, WayStats } from "@contracts";
import { AFTER, castOf, checkerOf, frontiersOf, MODES, ROUTE_LEVELS, SMALL_CHANGE } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I, ModelMark } from "./icons";
import { duration, markOf, modelLabel, money, plural } from "./model";
import { ModelPop } from "./Models";
import { NamedSwitch } from "./ui";
import * as os from "./os";
import "./agentic.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const save = (patch: Partial<EngineSettings>) => void rpc("settings.save", patch).catch(fail);

/** Who'd do what today: your two models (automatic where you haven't picked) and Dual frontier, from the models that are ready. */
function useCast() {
  const providers = useEngine((x) => x.providers);
  const settings = useEngine((x) => x.settings);
  return useMemo(() => {
    const picks = settings.picks ?? {};
    const dual = settings.dual ?? false;
    return {
      providers,
      settings,
      picks,
      dual,
      cast: castOf(providers, { dual, picks }),
      auto: castOf(providers),
      fronts: frontiersOf(providers, picks),
      label: (ref: string) => modelLabel(ref, providers),
    };
  }, [providers, settings]);
}
type Cast = ReturnType<typeof useCast>;

export function Agentic(_: { onOpen?: (threadId: string) => void }) {
  const c = useCast();
  return (
    <div className="lc-ag">
      <Modes c={c} />
      <Models c={c} />
      <After c={c} />
      <Compare c={c} />
    </div>
  );
}

/**
  A titled part of the page, like Settings' groups but holding its own cards. Its title is also
  its name in Settings' sidebar, which lists a page's parts from `data-st-sec` and lights the one
  you've scrolled to.
*/
function Part({ title, note, end, children, ref }: { title: string; note?: ReactNode; end?: ReactNode; children: ReactNode; ref?: Ref<HTMLElement> }) {
  return (
    <section ref={ref} className="lc-st-group lc-ag-part" data-st-sec={title}>
      <header>
        <span>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </span>
        {end}
      </header>
      {children}
    </section>
  );
}

/** A model, inline: its maker's mark and its name. */
function Chip({ model, c }: { model: string; c: Cast }) {
  return (
    <span className="lc-ag-chip">
      <ModelMark kind={markOf(model)} size={13} />
      <b>{c.label(model)}</b>
    </span>
  );
}
/** The word between two chips: "plans", "builds". `to` adds an arrow. */
const Joint = ({ children, to }: { children?: ReactNode; to?: boolean }) => (
  <span className="lc-ag-joint">
    {children}
    {to && <I.forward size={12} />}
  </span>
);

/**
  One choice as a row of a list: its radio, name and tag, who it puts to work on the right, and a
  line on what it does. Only the picked one opens what it's like, in three columns, so the list
  stays short. The row takes a click anywhere; the radio itself is the one the keyboard reaches.
*/
function Choice({ on, title, tag, chain, line, more, end, tabbable, disabled, onPick }: { on: boolean; title: ReactNode; tag?: string; chain?: ReactNode; line: ReactNode; more?: [string, ReactNode][]; end?: ReactNode; tabbable: boolean; disabled?: boolean; onPick: () => void }) {
  return (
    <div className="lc-ag-way" data-on={on || undefined} data-end={end ? true : undefined} data-off={disabled || undefined} onClick={() => !disabled && onPick()}>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        aria-disabled={disabled || undefined}
        tabIndex={tabbable ? 0 : -1}
        className="lc-ag-way-h l-focus"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onPick();
        }}
      >
        <span className="lc-ag-radio" aria-hidden />
        <b>{title}</b>{" "}
        {tag && <span className="lc-ag-tag">{tag}</span>}
      </button>
      {chain && <span className="lc-ag-chain">{chain}</span>}
      <p className="lc-ag-way-line">{line}</p>
      {end}
      {on && more && (
        <dl className="lc-ag-way-more">
          {more.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Arrows move through a list of choices and pick as they go, as a group of radios does; Tab stops once, on the picked one. */
const radioKeys = (ids: string[], on: string, pick: (id: string) => void) => (e: KeyboardEvent<HTMLDivElement>) => {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  // The choices' own radios: a control open inside one (Auto's level) has radios of its own, and keeps its arrows.
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > .lc-ag-way > [role="radio"]:not([aria-disabled])')];
  const at = radios.indexOf(e.target as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const next = (at + step + radios.length) % radios.length;
  radios[next].focus();
  const id = ids[[...e.currentTarget.querySelectorAll<HTMLElement>(':scope > .lc-ag-way > [role="radio"]')].indexOf(radios[next])];
  if (id && id !== on) pick(id);
};

/* ---------------------------------- The modes ---------------------------------- */

function Modes({ c }: { c: Cast }) {
  const { cast, settings, label } = c;
  const mode = settings.mode;
  const level = settings.route?.level ?? "high";
  const after = settings.after ?? "check";
  const checker = after === "check" && cast ? checkerOf(cast.everyday, cast) : null;
  const refiner = after === "refine" && cast && cast.strong !== cast.everyday ? cast.strong : null;
  const none = <span className="lc-quiet">No model is ready yet</span>;
  const rows: { id: Mode; tag: string; chain: ReactNode; line: ReactNode; more: [string, ReactNode][] }[] = [
    {
      id: "solo",
      tag: "Fastest to start",
      chain: cast ? (
        <>
          <Chip model={cast.everyday} c={c} />
          <Joint>alone{refiner ? `, ${label(refiner)} refines` : checker ? `, ${label(checker)} checks` : ""}</Joint>
        </>
      ) : (
        none
      ),
      line: `One model in one loop: it reads, answers and edits as you allow. Pick any model, or one of your agents, for each session.`,
      more: [
        ["Saves by", "No planning turn and no hand-offs. Everything you said stays in its context and its cache."],
        ["Good for", "Questions, small fixes, trying an idea."],
        ["Watch for", "Bigger changes: nothing is planned or approved before it edits."],
      ],
    },
    {
      id: "plan",
      tag: "Plans the hard ones",
      chain: cast ? (
        <>
          <Chip model={cast.strong} c={c} />
          <Joint to>plans</Joint>
          <Chip model={cast.everyday} c={c} />
          <Joint>builds</Joint>
        </>
      ) : (
        none
      ),
      line: cast ? `Most messages go straight to ${label(cast.everyday)}, so work starts at once. A hard job goes to ${label(cast.strong)} first, which reads and plans, and ${label(cast.everyday)} builds the plan straight after, in the same turn.` : "A stronger model plans the hard jobs, a cheaper one builds everything.",
      more: [
        ["Saves by", "The frontier model only reads and plans, and only when a job is hard; the long work of building and testing, and your questions, go to the cheaper one."],
        ["Good for", "Real work in a big codebase, where the hard part is knowing what to change."],
        [
          "Approve plans first",
          <span key="approve" className="lc-ag-revc" onClick={(e) => e.stopPropagation()}>
            <NamedSwitch name="Approve plans first" checked={settings.approvePlans === true} onCheckedChange={(approvePlans) => save({ approvePlans })} />
            <span className="lc-quiet lc-ag-unit">{settings.approvePlans ? "Every change is planned and waits for your OK." : "Off: a plan waits only when you ask for one (\"plan it first\")."}</span>
          </span>,
        ],
      ],
    },
    {
      id: "auto",
      tag: "Least work per message",
      chain: cast ? (
        <>
          <Chip model={cast.everyday} c={c} />
          <Joint>for most,</Joint>
          <Chip model={cast.strong} c={c} />
          <Joint>for hard jobs</Joint>
        </>
      ) : (
        none
      ),
      line: cast ? `Each message is weighed on ${os.here}, at no cost: light work goes to ${label(cast.everyday)} alone, a medium job is checked by ${label(cast.judge)}, a hard one goes to ${label(cast.strong)} with a critic.` : "Each message gets the least work likely to do it well.",
      more: [
        ["Saves by", "The frontier model works only when a job needs it. A judge reads instead of rewriting, and the strong model writes only what the judge won't pass."],
        ["Good for", "A long session of mixed work: questions, fixes and features."],
        ["Watch for", "A message weighed wrong. Max checks everything; Plan, then build is there for a change you want to approve first."],
        [
          "How far it goes",
          <span key="level" className="lc-ag-revc" onClick={(e) => e.stopPropagation()}>
            <Segmented size="sm" value={level} onValueChange={(v) => save({ route: { level: v as RouteLevel } })} options={ROUTE_LEVELS.map((l) => ({ value: l.id, label: l.label }))} aria-label="How far Auto goes" />
            <span className="lc-quiet lc-ag-unit">{ROUTE_LEVELS.find((l) => l.id === level)?.note}.</span>
          </span>,
        ],
      ],
    },
  ];
  return (
    <Part title="How sessions work" note="What a new session starts with. Each session can still change it from its composer. One model writes at a time in all three.">
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-ways" role="radiogroup" aria-label="How sessions work" onKeyDown={radioKeys(MODES.map((m) => m.id), mode, (id) => save({ mode: id as Mode }))}>
          {rows.map((r) => (
            <Choice key={r.id} on={mode === r.id} tabbable={mode === r.id} title={MODES.find((m) => m.id === r.id)!.label} tag={r.tag} chain={r.chain} line={r.line} more={r.more} onPick={() => mode !== r.id && save({ mode: r.id })} />
          ))}
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- The models ---------------------------------- */

/**
  Your two models, and everything else follows from them: the frontier one plans, takes the hard
  jobs and refines; the cheaper one builds and answers. Dual frontier swaps the cheaper one for a
  second frontier model. Each picker opens the same tool, source, model steps as the composer's,
  and starts on Automatic, which says what it lands on.
*/
function Models({ c }: { c: Cast }) {
  const { picks, dual, auto, fronts, cast, label } = c;
  const put = (next: ModelPicks) => save({ picks: Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as ModelPicks });
  const automatic = (ref: string | undefined) => ({
    id: "auto",
    title: "Automatic",
    note: ref ? `${label(ref)} now, from what's ready` : "Nothing ready yet",
    show: (
      <span className="lc-ag-who">
        <span className="lc-quiet">Automatic</span>
        <b>{ref ? label(ref) : "none"}</b>
      </span>
    ),
  });
  const pick = (title: string, key: keyof ModelPicks, fallback: string | undefined) => <ModelPop label={title} value={picks[key] ?? "auto"} choices={[automatic(fallback)]} width={440} onPick={(v) => put({ ...picks, [key]: v === "auto" ? undefined : v })} />;
  // What each falls back to with your other picks as they are.
  const base = castOf(c.providers, { picks: { ...picks, frontier: undefined, cheaper: undefined, checker: undefined } });
  const same = cast && !dual && cast.strong === cast.everyday;
  const gone = (key: keyof ModelPicks) => picks[key] && !c.providers.some((p) => p.available && p.adapter && picks[key]!.startsWith(`${p.id}:`));
  const row = (title: string, note: ReactNode, control: ReactNode, off?: boolean) => (
    <div className="lc-st-row" data-off={off || undefined}>
      <span className="lc-st-t">
        <b>{title}</b>
        <small>{note}</small>
      </span>
      <span className="lc-st-c">{control}</span>
    </div>
  );
  return (
    <Part
      title="Which models"
      note="Your two models, and everything else follows from them. Any model a tool here runs, Chinese ones through OpenCode, Hermes or an API endpoint too. Each session can change them from its composer."
      end={
        Object.keys(picks).length > 0 ? (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => save({ picks: {} })}>
            All automatic
          </button>
        ) : undefined
      }
    >
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-routed">
          {row("Frontier", <>Plans, takes the hard jobs, and refines.{gone("frontier") ? " Your pick's tool isn't ready, so it's automatic for now." : ""}</>, pick("Frontier model", "frontier", base?.strong ?? auto?.strong))}
          {row(
            dual ? "Cheaper (Dual frontier builds instead)" : "Cheaper",
            <>
              Builds, answers your questions, and does the everyday work. Solo starts on it.
              {gone("cheaper") ? " Your pick's tool isn't ready, so it's automatic for now." : ""}
              {same ? " It's the same as your frontier model, so Plan, then build runs as Solo." : ""}
            </>,
            pick("Cheaper model", "cheaper", base?.everyday ?? auto?.everyday),
            dual,
          )}
          {row(
            "Dual frontier",
            fronts.second ? <>A second frontier model, from another maker, builds in the cheaper one's place, and the two check each other. The most it costs, for the hardest work.</> : <>Needs a frontier model from another maker than {fronts.frontier ? label(fronts.frontier) : "your frontier one"}: Opus, GPT Astra or Sol, Gemini Pro, DeepSeek V4 Pro, Kimi K3… An API endpoint (Settings › Models) brings one in with just a key.</>,
            <NamedSwitch name="Dual frontier" checked={dual && Boolean(fronts.second)} disabled={!fronts.second} onCheckedChange={(on) => save({ dual: on })} />,
          )}
          {dual && fronts.second && row("Second frontier", <>Builds and does the everyday work, from another maker than {fronts.frontier ? label(fronts.frontier) : "your frontier model"}.</>, pick("Second frontier model", "second", castOf(c.providers, { dual: true, picks: { ...picks, second: undefined } })?.everyday))}
          {row("Checks", <>Reads changes before they're yours, and judges a medium job in Auto. Best from another maker than the writer's, so the two don't share blind spots.</>, pick("Checker", "checker", castOf(c.providers, { dual, picks: { ...picks, checker: undefined } })?.judge))}
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- After each change ---------------------------------- */

function After({ c }: { c: Cast }) {
  const { settings, cast, label } = c;
  const after = settings.after ?? "check";
  const rounds = settings.reviewRounds ?? 2;
  const small = settings.reviewSmall === true;
  const checker = cast ? checkerOf(cast.everyday, cast) : null;
  const lines: Record<AfterKind, ReactNode> = {
    check: checker ? `${label(checker)} reads what ${cast ? label(cast.everyday) : "the writer"} writes against five fixed criteria, and sends back what must be fixed.` : "Nobody else is ready to read changes yet.",
    refine: cast && cast.strong !== cast.everyday ? `${label(cast.strong)} takes ${label(cast.everyday)}'s draft on and finishes it: fixes what's wrong or missing, then tightens the rest. A Chinese model can build the first pass and a frontier one fine-tune it. When the frontier model wrote the change itself, it's checked instead.` : "Needs a frontier model stronger than the one writing; until then, changes are checked.",
    off: "Changes are yours as they are, unread.",
  };
  return (
    <Part title="After each change" note="What happens to a change in Solo and Plan before it's yours. Auto has its own judge and critics.">
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-ways" role="radiogroup" aria-label="After each change" onKeyDown={radioKeys(AFTER.map((x) => x.id), after, (id) => save({ after: id as AfterKind }))}>
          {AFTER.map((x) => (
            <Choice key={x.id} on={after === x.id} tabbable={after === x.id} title={x.label} tag={x.id === "check" ? "The default" : x.id === "refine" ? "Draft, then finish" : undefined} line={lines[x.id]} onPick={() => after !== x.id && save({ after: x.id })} />
          ))}
        </div>
      </div>
      {after !== "off" && (
        <div className="lc-frame">
          <div className="lc-fcard lc-st-card">
            {after === "check" && (
              <div className="lc-st-row">
                <span className="lc-st-t">
                  <b>Rounds before it's yours</b>
                  <small>How many times the checker sends findings back. After that, you decide.</small>
                </span>
                <span className="lc-st-c">
                  <Segmented size="sm" value={String(rounds)} onValueChange={(v) => save({ reviewRounds: Number(v) })} options={["1", "2", "3"].map((v) => ({ value: v, label: v }))} aria-label="Rounds before it's yours" />
                </span>
              </div>
            )}
            <div className="lc-st-row">
              <span className="lc-st-t">
                <b>Small changes too</b>
                <small>{SMALL_CHANGE} lines or fewer, or docs alone, go through as they are unless this is on.</small>
              </span>
              <span className="lc-st-c">
                <NamedSwitch name="Small changes too" checked={small} onCheckedChange={(reviewSmall) => save({ reviewSmall })} />
              </span>
            </div>
          </div>
        </div>
      )}
    </Part>
  );
}

/* ---------------------------------- Compare ---------------------------------- */

function Compare({ c }: { c: Cast }) {
  const { settings, cast, label } = c;
  const sessions = useEngine((x) => x.threads.length);
  const [days, setDays] = useState<"30" | "90">("30");
  const [stats, setStats] = useState<WayStats[] | null>(null);
  useEffect(() => {
    let live = true;
    void rpc("ways.compare", { days: Number(days) })
      .then((s) => live && setStats(s))
      .catch(() => live && setStats([]));
    return () => {
      live = false;
    };
  }, [days, sessions]);

  const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
  const of = (k: Mode) => stats?.find((s) => s.way === k);
  const dash = <span className="lc-quiet">–</span>;
  const cols = MODES.map((m) => m.id);
  const after = settings.after ?? "check";
  const checks = cast ? checkerOf(cast.everyday, cast) : null;
  const then = !cast || after === "off" ? "Nobody" : after === "refine" && cast.strong !== cast.everyday ? `${label(cast.strong)} refines it` : checks ? `${label(checks)} checks it` : "Nobody";
  // Each mode by design: who takes your message, what comes before edits, who writes, what happens after.
  const design = (k: Mode): ReactNode[] => {
    if (!cast) return [dash, dash, dash, dash];
    if (k === "solo") return [label(cast.everyday), "Nothing", label(cast.everyday), then];
    if (k === "plan") return [`${label(cast.strong)} (changes), ${label(cast.everyday)} (questions)`, "You approve a plan", label(cast.everyday), then];
    return [label(cast.everyday), "Nothing", `${label(cast.everyday)}, ${label(cast.strong)} for hard jobs`, `${label(cast.judge)} judges; critics on hard jobs`];
  };
  const rows = ["Takes your message", "Before it edits", "Writes", "After the change"];
  const measured: [string, (s: WayStats) => ReactNode][] = [
    ["Sessions", (s) => (s.sessions ? String(s.sessions) : dash)],
    ["Kept as is", (s) => (s.changed ? <>{pct(s.kept, s.changed)} <small>of {plural(s.changed, "change")}</small></> : dash)],
    ["Cost per kept change", (s) => (s.kept && s.costUsd ? money(s.costUsd / s.kept) : dash)],
    ["Time per turn", (s) => (s.turns ? duration(s.seconds / s.turns) : dash)],
    ["Passed the first read", (s) => (s.reviewed ? pct(s.firstPass, s.reviewed) : dash)],
  ];
  const by = cols.map(design);
  const none = stats !== null && stats.every((s) => !s.sessions);
  return (
    <Part
      title="Side by side"
      note="How the modes differ by design, then how they went in your own sessions."
      end={
        <Segmented
          size="sm"
          value={days}
          onValueChange={setDays}
          options={[
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
          aria-label="Your sessions from the last"
        />
      }
    >
      <div className="lc-frame">
        <div className="lc-fcard lc-ag-tablecard">
          {/* Narrow, the table keeps its columns readable and scrolls sideways in its card. */}
          <div className="lc-ag-tablewrap">
            <table className="lc-ag-table" style={{ "--cols": cols.length } as CSSProperties}>
              <thead>
                <tr>
                  <th aria-label="What" />
                  {cols.map((k) => (
                    <th key={k} scope="col" data-on={settings.mode === k || undefined}>
                      {MODES.find((m) => m.id === k)!.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((name, r) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    {cols.map((k, i) => (
                      <td key={k} data-on={settings.mode === k || undefined}>
                        {by[i][r]}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="lc-ag-sub">
                  <th scope="rowgroup" colSpan={cols.length + 1}>
                    In your sessions, the last {days} days <small>{stats === null ? "" : plural(stats.reduce((n, s) => n + s.sessions, 0), "session")}</small>
                  </th>
                </tr>
                {measured.map(([name, f], r) => (
                  <tr key={name} data-start={r === 0 || undefined} data-end={r === measured.length - 1 || undefined}>
                    <th scope="row">{name}</th>
                    {cols.map((k) => {
                      const s = of(k);
                      return (
                        <td key={k} data-on={settings.mode === k || undefined} className="lc-ag-num">
                          {s ? f(s) : stats === null ? <span className="lc-ag-wait" /> : dash}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lc-ag-foot">{none ? "No sessions in this period yet. Numbers fill in as you work, whichever mode you start in." : "Sorted by how each session ran, whatever it started as. A change is kept when you didn't undo it; costs are at API prices, with the checks' share counted in."}</p>
        </div>
      </div>
    </Part>
  );
}
