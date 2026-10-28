/*
  Agentic features: the ways to work (just a model, a lead and a coder, and setups you make and
  name), what each saves and what to watch for, side by side with numbers from your own sessions
  and one small task you can run in each for real; your setups, wired job by job (who takes your
  message, who writes in which stage and with what job, who checks), with what each one is
  handed; and how an agent writer runs. Every hand-off is a summary, so the page says where
  context thins out before you find out in a session.
*/
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentProfile, ProviderInfo, RunMode, Settings as EngineSettings, Setup, Thread, WayStats } from "@contracts";
import { familyOf, setupOf, setupsOf, splitModel, TRIAL } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I, ModelMark, Rays } from "./icons";
import { agentOf, allModels, compact, duration, effortName, markOf, modelLabel, money, onClaude, plural, providerLabel } from "./model";
import { ModelPop } from "./Models";
import { Badge, Disc, Num, PanelHead, Pop, Row } from "./ui";
import "./agentic.css";

/** A way to work, by key: "model", "lead", or one of your setups' ids. */
type Key = string;
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const save = (patch: Partial<EngineSettings>) => void rpc("settings.save", patch).catch(fail);
const OPUS = "claude:claude-opus-5-5";
const SONNET = "claude:claude-sonnet-5-5";
const HAIKU = "claude:claude-haiku-5-5";
const MAX_STAGES = 4;
/** Subagents are Claude Code's, so their pickers offer its models only. */
const onClaudeCode = (p: ProviderInfo) => familyOf(p.id) === "claude";

/** "Atlas", "Atlas and Quill", "Atlas, Quill and Prism". */
const names = (list: { name: string }[]) => (list.length < 2 ? (list[0]?.name ?? "") : `${list.slice(0, -1).map((a) => a.name).join(", ")} and ${list[list.length - 1].name}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const familyOfRef = (ref: string) => familyOf(splitModel(ref).provider);

/** The run mode an agent uses when it doesn't say (as the engine's review.ts `runModeOf`). */
const runModeOf = (a: AgentProfile): RunMode => a.runMode ?? (a.specialty === "coder" || a.specialty === "debugger" ? "helpers" : "single");

/** Who reviews an agent's work, picked the way the engine picks it (review.ts `reviewerFor`). */
function reviewerOf(agent: AgentProfile | undefined, providers: ProviderInfo[]): string | null {
  if (!agent) return null;
  const set = agent.subagents?.reviewer;
  const want = set === null ? null : (set ?? (agent.specialty === "coder" ? "auto" : null));
  if (!want) return null;
  if (want !== "auto") return want;
  const family = familyOf(splitModel(agent.model).provider);
  const ready = (id: string) => providers.find((p) => p.id === id && p.available && p.adapter && p.models.length);
  const other = family === "claude" ? (ready("codex") ?? ready("opencode")) : ready("claude");
  if (other) return `${other.id}:${other.id === "claude" ? "claude-opus-5-5" : other.models[0].id}`;
  return ready("claude") ? OPUS : null;
}

/** Who checks a setup's change: its own pick, or for "auto" another family than its last stage's model (as the runtime picks it). */
function checkerOf(s: Setup, agents: AgentProfile[], providers: ProviderInfo[]) {
  if (s.checks.by !== "auto") return s.checks.by;
  const last = agentOf(s.stages[s.stages.length - 1].who, agents, providers);
  return reviewerOf({ ...last, subagents: { ...last.subagents, reviewer: "auto" } }, providers);
}

/** Who each way puts to work today: the first ready model, the lead and its coder, and your setups. */
function useCast() {
  const all = useEngine((x) => x.agents);
  const providers = useEngine((x) => x.providers);
  const settings = useEngine((x) => x.settings);
  return useMemo(() => {
    const agents = all.filter((a) => a.id !== "demo");
    const first = providers.find((p) => p.available && p.adapter && p.id !== "demo");
    const lead = agents.find((a) => /lead/i.test(a.role));
    const coder = agents.find((a) => a.specialty === "coder") ?? agents.find((a) => a !== lead);
    const setups = setupsOf(settings, all);
    const active = setupOf(settings, all);
    return {
      all,
      agents,
      providers,
      setups,
      active,
      /** The way new sessions start with. */
      key: settings.workStyle === "team" ? (active?.id ?? "team") : settings.workStyle,
      model: first ? `${first.id}:${first.models[0]?.id ?? "default"}` : undefined,
      lead,
      coder,
      who: (id: string) => agentOf(id, all, providers),
    };
  }, [all, providers, settings]);
}
type Cast = ReturnType<typeof useCast>;

const pickWay = (k: Key) => save(k === "model" || k === "lead" ? { workStyle: k } : { workStyle: "team", setup: k });
const putSetups = (next: Setup[]) => save({ setups: next });

export function Agentic({ onOpen }: { onOpen?: (threadId: string) => void }) {
  const cast = useCast();
  // The setup open in the editor: the one you picked there, else the one new sessions use.
  const [editing, setEditing] = useState<string | undefined>();
  const open = cast.setups.find((s) => s.id === editing) ?? cast.active;
  const editor = useRef<HTMLDivElement>(null);
  const edit = (id: string) => {
    setEditing(id);
    requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div className="lc-ag">
      <Ways cast={cast} onEdit={edit} />
      <Compare cast={cast} />
      <Trial cast={cast} onOpen={onOpen} />
      <div ref={editor} className="lc-ag-anchor">
        <Setups cast={cast} open={open} onEdit={edit} />
      </div>
      <RunModes cast={cast} />
    </div>
  );
}

/** A titled part of the page, like Settings' groups but holding its own cards. */
function Part({ title, note, end, children }: { title: string; note?: ReactNode; end?: ReactNode; children: ReactNode }) {
  return (
    <section className="lc-st-group">
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

/** An agent (its disc, name and model) or a bare model (its maker's mark and name), as a chip. */
function Chip({ agent, model, providers, note }: { agent?: AgentProfile; model?: string; providers: ProviderInfo[]; note?: string }) {
  const ref = agent?.model ?? model ?? "";
  return (
    <span className="lc-ag-chip">
      {agent ? <Disc agent={agent} size={18} /> : <ModelMark kind={markOf(ref)} size={13} />}
      <b>{agent?.name ?? modelLabel(ref, providers)}</b>
      {(agent || note) && <span className="lc-quiet">{note ?? modelLabel(ref, providers)}</span>}
    </span>
  );
}
/** Whoever an id names, as a chip: "@<provider>:<model>" is a model on its own. */
const WhoChip = ({ id, cast }: { id: string; cast: Cast }) => (id.startsWith("@") ? <Chip model={id.slice(1)} providers={cast.providers} /> : <Chip agent={cast.who(id)} providers={cast.providers} />);
/** The word between two chips: "plans", "asks", "with". `to` adds an arrow. */
const Joint = ({ children, to }: { children?: ReactNode; to?: boolean }) => (
  <span className="lc-ag-joint">
    {children}
    {to && <I.forward size={12} />}
  </span>
);

/** One choice as a card: its radio and name, a tag, who it puts to work, and what it's like. */
function Choice({ on, title, tag, tone, chain, rows, onPick, slim, end }: { on: boolean; title: ReactNode; tag?: string; tone?: "accent"; chain?: ReactNode; rows?: [string, ReactNode][]; onPick: () => void; slim?: boolean; end?: ReactNode }) {
  return (
    <div className="lc-frame lc-ag-choice" data-on={on || undefined} data-slim={slim || undefined} onClick={onPick}>
      <div className="lc-fcard">
        <button
          type="button"
          role="radio"
          aria-checked={on}
          className="lc-ag-choice-h l-focus"
          onClick={(e) => {
            e.stopPropagation();
            onPick();
          }}
        >
          <span className="lc-ag-radio" aria-hidden />
          <b>{title}</b>
          <span className="lc-grow" />
          {tag && (
            <span className="lc-ag-tag" data-tone={tone}>
              {tag}
            </span>
          )}
        </button>
        {chain && <div className="lc-ag-chain">{chain}</div>}
        {rows && (
          <dl className="lc-ag-kv">
            {rows.map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        {end}
      </div>
    </div>
  );
}

/** A setup's people, as chips: the lead plans, the stages write in turn, the crew is on call. */
function SetupChain({ s, cast }: { s: Setup; cast: Cast }) {
  return (
    <>
      {s.lead && (
        <>
          <WhoChip id={s.lead} cast={cast} />
          <Joint to>plans</Joint>
        </>
      )}
      {s.stages.map((st, i) => (
        <Fragment key={i}>
          {i > 0 && <Joint to>then</Joint>}
          <WhoChip id={st.who} cast={cast} />
        </Fragment>
      ))}
      {!s.lead && s.stages.length === 1 && <Joint>straight to the code</Joint>}
      {s.crew.length > 0 && (
        <>
          <Joint>with</Joint>
          {s.crew.map((id) => (
            <WhoChip key={id} id={id} cast={cast} />
          ))}
        </>
      )}
    </>
  );
}

/** What each stage of a setup does, in order. */
const StageList = ({ s, cast }: { s: Setup; cast: Cast }) => (
  <ol className="lc-ag-stagelist">
    {s.stages.map((st, i) => (
      <li key={i}>
        <b>{cast.who(st.who).name}</b> {st.job.trim() ? lower(st.job.trim().replace(/[.\s]+$/, "")) : i === 0 ? "builds it" : "takes it on"}
      </li>
    ))}
  </ol>
);

/* ---------------------------------- The ways ---------------------------------- */

function Ways({ cast, onEdit }: { cast: Cast; onEdit: (id: string) => void }) {
  const { providers, model, lead, coder, setups, key } = cast;
  const cards: { id: Key; title: string; tag: string; chain: ReactNode; rows: [string, ReactNode][]; end?: ReactNode }[] = [
    {
      id: "model",
      title: "Just a model",
      tag: "Fastest to start",
      chain: model ? (
        <>
          <Chip model={model} providers={providers} />
          <Joint>on its own</Joint>
        </>
      ) : (
        <span className="lc-quiet">No model is ready yet</span>
      ),
      rows: [
        ["Answers", "The model itself, in one loop: it reads, answers and edits as you allow."],
        ["Saves by", "No planning turn and no hand-offs. Everything you said stays in its context."],
        ["Good for", "Questions, small fixes, trying an idea."],
        ["Watch for", "Bigger changes: nothing is planned or approved before it edits."],
      ],
    },
    {
      id: "lead",
      title: "A lead and a coder",
      tag: "Plan first",
      chain:
        lead && coder ? (
          <>
            <Chip agent={lead} providers={providers} />
            <Joint to>plans</Joint>
            <Chip agent={coder} providers={providers} />
            <Joint>builds</Joint>
          </>
        ) : (
          <span className="lc-quiet">Needs a lead and a coder in your team</span>
        ),
      rows: [
        ["Answers", `${lead?.name ?? "The lead"} answers and plans; you approve the plan; ${coder?.name ?? "the coder"} builds it.`],
        ["Saves by", `${lead?.name ?? "The lead"} does the talking and reading; ${coder?.name ?? "the coder"} starts from a plan, not the whole chat.`],
        ["Good for", "Changes you want to see before they happen."],
        ["Watch for", `${coder?.name ?? "The coder"} is handed the plan, not your conversation: put the details in the plan.`],
      ],
    },
    ...setups.map((s) => {
      const first = cast.who(s.stages[0].who);
      const people = (s.lead ? 1 : 0) + s.stages.length + s.crew.length;
      const checker = checkerOf(s, cast.all, providers);
      return {
        id: s.id,
        title: s.name,
        tag: "Your setup",
        chain: <SetupChain s={s} cast={cast} />,
        rows: [
          ["Answers", s.lead ? `${cast.who(s.lead).name} answers and plans; you approve; then it's written${s.stages.length > 1 ? ` in ${s.stages.length} stages` : ""}.` : `Straight to ${first.name}${s.stages.length > 1 ? `, then ${plural(s.stages.length - 1, "more stage")}` : ""}.`],
          ["Writes", <StageList key="w" s={s} cast={cast} />],
          ["Checked by", checker ? `${modelLabel(checker, providers)}, up to ${plural(s.checks.rounds, "round")}` : "Nobody"],
          ["Watch for", people >= 4 ? <span className="lc-ag-warnword">{plural(people - 1, "hand-off")}. Each is a summary, so details get lost on the way.</span> : s.stages.length > 1 ? "Each stage gets the change and its job, not the last one's reasoning." : "Every hand-off is a summary. Past three agents, details get lost on the way."],
        ] as [string, ReactNode][],
        end: (
          <button
            type="button"
            className="lc-st-link l-focus lc-ag-editlink"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(s.id);
            }}
          >
            Edit the wiring
            <I.chevR size={12} />
          </button>
        ),
      };
    }),
  ];
  return (
    <Part title="Who you talk to" note="What a new session starts with: one of the two built in, or a setup you made and named. Each session can still change it from its composer." end={<NewSetup cast={cast} onMade={onEdit} />}>
      <div className="lc-ag-ways" role="radiogroup" aria-label="Who you talk to">
        {cards.map((c) => (
          <Choice key={c.id} on={key === c.id} title={c.title} tag={c.tag} tone={key === c.id ? "accent" : undefined} chain={c.chain} rows={c.rows} end={c.end} onPick={() => key !== c.id && pickWay(c.id)} />
        ))}
      </div>
    </Part>
  );
}

/** A model to build fast: DeepSeek when a tool here runs it, else Sonnet, else the first model. */
function quickBuilder(providers: ProviderInfo[]) {
  const models = allModels(providers);
  // A tool's own name for it ("DeepSeek V4 Pro") over a bare id ("deepseek/deepseek-v4-pro").
  const named = (label: string) => (label.includes("/") ? 2 : 0) + (/[A-Z]/.test(label) ? 0 : 1);
  const deepseek = models.filter((m) => /deepseek/i.test(m.ref)).sort((a, b) => named(a.label) - named(b.label));
  return (deepseek[0] ?? models.find((m) => m.ref === SONNET) ?? models[0])?.ref;
}

/** A new setup, from a start that already says something: a writer alone, build-then-improve, or plan-build-improve. */
function NewSetup({ cast, onMade }: { cast: Cast; onMade: (id: string) => void }) {
  const { providers, setups, coder, lead } = cast;
  const quick = quickBuilder(providers);
  const opusReady = allModels(providers).some((m) => m.ref === OPUS);
  const build = { who: quick ? `@${quick}` : (coder?.id ?? ""), job: "Scan the program, build the core, reverse engineer what's there" };
  const improve = { who: opusReady ? `@${OPUS}` : (coder?.id ?? ""), job: "Improve the code: tighten it, fix edge cases, make it read well" };
  const make = (name: string, s: Omit<Setup, "id" | "name">) => {
    const taken = new Set(setups.map((x) => x.name));
    let n = name;
    for (let i = 2; taken.has(n); i++) n = `${name} ${i}`;
    const id = `s_${Date.now().toString(36)}`;
    putSetups([...setups, { id, name: n, ...s }]);
    onMade(id);
  };
  const checks = { by: "auto" as const, rounds: 2 };
  return (
    <Pop
      label="New setup"
      width={330}
      align="end"
      triggerClass="lc-btn lc-ag-newbtn"
      trigger={
        <>
          <I.plus size={13} />
          New setup
        </>
      }
    >
      {(close) => (
        <>
          <PanelHead>Start from</PanelHead>
          {coder && <Row title="A writer on its own" note={`${coder.name}, straight to the code. Then add stages, a lead or a crew.`} onPick={() => (make("My setup", { lead: null, stages: [{ who: coder.id, job: "" }], crew: [], checks }), close())} />}
          {quick && <Row title="Build, then improve" note={`${modelLabel(quick, providers)} scans and builds the core, then ${opusReady ? modelLabel(OPUS, providers) : coder?.name} improves it.`} onPick={() => (make("Build, then improve", { lead: null, stages: [build, improve], crew: [], checks }), close())} />}
          {quick && lead && <Row title="Plan, build, improve" note={`${lead.name} plans, ${modelLabel(quick, providers)} builds, ${opusReady ? modelLabel(OPUS, providers) : coder?.name} improves.`} onPick={() => (make("Plan, build, improve", { lead: lead.id, stages: [build, improve], crew: [], checks }), close())} />}
        </>
      )}
    </Pop>
  );
}

/* ---------------------------------- Compare ---------------------------------- */

/** The ways, in the order the page shows them: the two built in, then your setups. */
const keysOf = (cast: Cast): Key[] => ["model", "lead", ...cast.setups.map((s) => s.id)];
const nameOf = (cast: Cast, k: Key) => (k === "model" ? "Just a model" : k === "lead" ? "A lead and a coder" : (cast.setups.find((s) => s.id === k)?.name ?? "A setup you removed"));

function Compare({ cast }: { cast: Cast }) {
  const { providers, model, lead, coder, key } = cast;
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
  const of = (k: Key) => stats?.find((s) => s.way === k);
  const dash = <span className="lc-quiet">–</span>;
  const cols = keysOf(cast);
  const checked = (ref: string | null) => (ref ? `The Reviewer, on ${modelLabel(ref, providers)}` : "Nobody");
  // Each way by design: who takes your message, what comes before edits, the hand-offs, who writes, what the writer starts with, who checks.
  const design = (k: Key): ReactNode[] => {
    if (k === "model") return [model ? modelLabel(model, providers) : dash, "Nothing", "None", model ? modelLabel(model, providers) : dash, "Your whole conversation", "Nobody"];
    if (k === "lead") return [lead?.name ?? dash, "You approve a plan", "One: the plan", coder?.name ?? dash, "The plan", checked(reviewerOf(coder, providers))];
    const s = cast.setups.find((x) => x.id === k)!;
    const hops = (s.lead ? 1 : 0) + s.stages.length - 1 + (s.lead ? s.crew.length : 0);
    const writers = s.stages.map((st) => cast.who(st.who).name).join(", then ");
    return [cast.who(s.lead ?? s.stages[0].who).name, s.lead ? "You approve a plan" : "Nothing", hops ? `${hops}: ${[s.lead ? "the plan" : "", s.stages.length > 1 ? "stage to stage" : "", s.crew.length ? "steps to the crew" : ""].filter(Boolean).join(", ")}` : "None", writers, s.lead ? "The plan" : "Your whole conversation", `${checked(checkerOf(s, cast.all, providers))}${s.crew.length ? ", not the crew's steps" : ""}`];
  };
  const rows = ["Takes your message", "Before it edits", "Hand-offs", "Writes", "The writer starts with", "Checked by"];
  const measured: [string, (s: WayStats) => ReactNode][] = [
    ["Sessions", (s) => (s.sessions ? String(s.sessions) : dash)],
    ["Kept as is", (s) => (s.changed ? <>{pct(s.kept, s.changed)} <small>of {plural(s.changed, "change")}</small></> : dash)],
    ["Cost per kept change", (s) => (s.kept && s.costUsd ? money(s.costUsd / s.kept) : dash)],
    ["Time per turn", (s) => (s.turns ? duration(s.seconds / s.turns) : dash)],
    ["The Reviewer passed it first time", (s) => (s.reviewed ? pct(s.firstPass, s.reviewed) : dash)],
  ];
  const by = cols.map(design);
  const none = stats !== null && stats.every((s) => !s.sessions);
  return (
    <Part
      title="Side by side"
      note="How they differ by design, then how they went in your own sessions."
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
          <table className="lc-ag-table" data-cols={cols.length}>
            <thead>
              <tr>
                <th aria-label="What" />
                {cols.map((k) => (
                  <th key={k} scope="col" data-on={key === k || undefined}>
                    {nameOf(cast, k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((label, r) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {cols.map((k, i) => (
                    <td key={k} data-on={key === k || undefined}>
                      {by[i][r]}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="lc-ag-sub">
                <th scope="rowgroup">In your sessions, the last {days} days</th>
                {cols.map((k) => (
                  <td key={k} data-on={key === k || undefined} />
                ))}
              </tr>
              {measured.map(([label, f]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {cols.map((k) => {
                    const s = of(k);
                    return (
                      <td key={k} data-on={key === k || undefined} className="lc-ag-num">
                        {s ? f(s) : stats === null ? <span className="lc-ag-wait" /> : dash}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lc-ag-foot">
            {none
              ? "No sessions in this period yet. Numbers fill in as you work, whichever way you start."
              : "Sorted by how each session ran, whatever it started as; sessions from before setups count under your first. A change is kept when you didn't undo it; costs are at API prices, with the Reviewer's share counted in."}
          </p>
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- Cost test ---------------------------------- */

const lines = (text: string) => text.trimEnd().split("\n").length;

/**
  Try it for real: one small task in a project of its own (two short files), run once in each
  way on your own models, side by side as it goes: what it cost, how long it took, what changed
  and what the Reviewer said. Nobody watches those sessions, so a lead's plan is approved as it
  stands and commands are declined; each one stays a session you can open.
*/
function Trial({ cast, onOpen }: { cast: Cast; onOpen?: (threadId: string) => void }) {
  const { providers, model, lead, coder, key } = cast;
  const threads = useEngine((x) => x.threads);
  const keys = keysOf(cast);
  const [off, setOff] = useState<Key[]>([]);
  const [starting, setStarting] = useState(false);
  const [pace, setPace] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    void rpc("usage.summary", { days: 30 })
      .then((u) => live && setPace(u.totals.turns && u.totals.perTurn ? u.totals.perTurn : null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // The latest test: its sessions, one per way, in the page's order.
  const runs = useMemo(() => {
    const all = threads.filter((t) => t.trial);
    const last = all.reduce<Thread | undefined>((m, t) => (!m || t.trial!.at > m.trial!.at ? t : m), undefined);
    const at = (t: Thread) => (keys.includes(t.trial!.way) ? keys.indexOf(t.trial!.way) : keys.length);
    return last ? all.filter((t) => t.trial!.id === last.trial!.id).sort((a, b) => at(a) - at(b)) : [];
  }, [threads, keys.join()]);
  const running = runs.some((t) => !t.trial!.finished);
  // The clock on a way that's still working moves every second.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const ready = (k: Key) => (k === "model" ? Boolean(model) : k === "lead" ? Boolean(lead && coder) : true);
  // Turns each way should take on this task: the lead plans, each stage writes, the Reviewer reads.
  const turnsOf = (k: Key) => {
    if (k === "model") return 1;
    if (k === "lead") return 2 + (reviewerOf(coder, providers) ? 1 : 0);
    const s = cast.setups.find((x) => x.id === k)!;
    return (s.lead ? 1 : 0) + s.stages.length + (s.lead ? s.crew.length : 0) + (checkerOf(s, cast.all, providers) ? 1 : 0);
  };
  const chosen = keys.filter((k) => ready(k) && !off.includes(k));
  const most = chosen.reduce((n, k) => n + turnsOf(k), 0);
  const start = async () => {
    setStarting(true);
    try {
      await rpc("ways.trial", { ways: chosen });
    } catch (e) {
      fail(e);
    } finally {
      setStarting(false);
    }
  };
  const stop = () => runs.filter((t) => !t.trial!.finished).forEach((t) => void rpc("thread.stop", { id: t.id }).catch(fail));
  const putAway = () => {
    for (const t of runs) void rpc("thread.update", { id: t.id, archived: true }).catch(fail);
    toast("The test's sessions are in Archive");
  };

  const tookOf = (t: Thread) => ((t.trial!.finished ?? Date.now()) - t.trial!.at) / 1000;
  const tokensOf = (t: Thread) => t.usage.inputTokens + t.usage.outputTokens + t.usage.cacheReadTokens;
  const finished = runs.filter((t) => t.trial!.finished && !t.trial!.failed);
  const all = runs.length > 1 && !running;
  const best = (f: (t: Thread) => number) => (all && finished.length > 1 ? finished.reduce((m, t) => (f(t) < f(m) ? t : m)).id : undefined);
  const cheapest = best((t) => t.usage.costUsd || tokensOf(t) / 1e6);
  const fastest = best(tookOf);
  const who = (t: Thread) => (
    <>
      {t.lead && (
        <>
          <WhoChip id={t.lead} cast={cast} />
          <Joint to />
        </>
      )}
      {(t.stages?.length ? t.stages.map((s) => s.who) : [t.agent]).map((id, i) => (
        <Fragment key={i}>
          {i > 0 && <Joint to />}
          <WhoChip id={id} cast={cast} />
        </Fragment>
      ))}
      {(t.helpers ?? []).map((h) => (
        <WhoChip key={h} id={h} cast={cast} />
      ))}
    </>
  );
  const verdict = (t: Thread) => (t.verdict?.state === "verified" ? <Badge tone="ok">Verified</Badge> : t.verdict?.state === "blocked" ? <Badge tone="danger">Blocked</Badge> : t.verdict?.state === "checking" ? <Badge tone="accent">Checking</Badge> : <span className="lc-quiet">Nobody</span>);
  // What a working way is doing now, from its session: the lead, a stage, or the Reviewer.
  const doing = (t: Thread) => {
    if (t.verdict?.state === "checking") return "Reviewing";
    if (t.status === "idle") return "Building the plan";
    if (t.lead && t.turns <= 1) return `${cast.who(t.lead).name} is planning`;
    const stage = t.stages && t.stages.length > 1 ? Math.min(t.stages.length, Math.max(1, t.turns - (t.lead ? 1 : 0))) : 0;
    return stage ? `Stage ${stage} of ${t.stages!.length}` : "Working";
  };

  return (
    <Part
      title="Test it for real"
      note="One small task, run once in each way on your own models. The project holds two short files, so the context stays as small as it gets and the numbers show what each way adds."
    >
      <div className="lc-frame">
        <div className="lc-fcard lc-ag-trial">
          <div className="lc-ag-task">
            <span className="lc-ag-task-l">The task</span>
            <p>{TRIAL.task}</p>
            <span className="lc-ag-files">
              {Object.entries(TRIAL.files).map(([name, text]) => (
                <span key={name} className="lc-ag-file">
                  <I.file size={12} />
                  {name}
                  <span className="lc-quiet">{plural(lines(text), "line")}</span>
                </span>
              ))}
              <span className="lc-quiet">in a project of its own, Cost test</span>
            </span>
          </div>
          <div className="lc-ag-trialbar">
            <span className="lc-ag-crew" role="group" aria-label="Ways to test">
              {keys.map((k) => {
                const on = ready(k) && !off.includes(k);
                return (
                  <button key={k} type="button" className="lc-mchip lc-ag-crewchip l-focus" data-on={on || undefined} aria-pressed={on} disabled={!ready(k) || running} title={ready(k) ? undefined : k === "model" ? "No model is ready" : "Needs a lead and a coder in Team"} onClick={() => setOff(on ? [...off, k] : off.filter((x) => x !== k))}>
                    {nameOf(cast, k)}
                    {k === key && <span className="lc-quiet">yours</span>}
                    {on && <I.check size={11} />}
                  </button>
                );
              })}
            </span>
            <span className="lc-grow" />
            {running ? (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={stop}>
                <I.stop size={12} />
                Stop
              </button>
            ) : (
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!chosen.length || starting} onClick={() => void start()}>
                <I.play size={12} />
                {runs.length ? "Run it again" : "Run the test"}
              </button>
            )}
          </div>
          <p className="lc-ag-cost">
            {chosen.length ? (
              <>
                {plural(chosen.length, "session")}, about {plural(most, "turn")} in all, the Reviewer's included.{" "}
                {pace ? `Your average turn this month cost ${money(pace)}, and these are smaller, so it should come in under ${money(pace * most)}.` : "Costs show here as each way runs."} Costs are at API prices; on a Claude plan they count toward your usage limits instead.
              </>
            ) : (
              "Pick at least one way to test."
            )}
          </p>
          {runs.length > 0 && (
            <div className="lc-ag-results">
              {runs.map((t) => {
                const tr = t.trial!;
                const state = !tr.finished ? "working" : tr.failed ? "failed" : "done";
                return (
                  <div key={t.id} className="lc-ag-result" data-state={state}>
                    <span className="lc-ag-result-h">
                      <b>{t.setup?.name ?? nameOf(cast, tr.way)}</b>
                      <span className="lc-grow" />
                      {t.id === cheapest && <Badge tone="ok">Cheapest</Badge>}
                      {t.id === fastest && <Badge tone="accent">Fastest</Badge>}
                      {state === "working" && (
                        <span className="lc-ag-live">
                          <Rays size={11} />
                          <span className="l-shimmer">{doing(t)}</span>
                        </span>
                      )}
                      {state === "failed" && <Badge tone="warn">Stopped short</Badge>}
                      {state === "done" && t.id !== cheapest && t.id !== fastest && (
                        <span className="lc-ag-done">
                          <I.check size={12} />
                          Done
                        </span>
                      )}
                    </span>
                    <span className="lc-ag-chain">{who(t)}</span>
                    <span className="lc-ag-big">
                      {t.usage.costUsd ? <Num value={t.usage.costUsd} as="money" /> : <span className="lc-quiet">{state === "working" ? "$0.00" : "No cost reported"}</span>}
                      <small>at API prices</small>
                    </span>
                    <dl className="lc-ag-stats">
                      <dt>Tokens</dt>
                      <dd>{compact(tokensOf(t))}</dd>
                      <dt>Took</dt>
                      <dd>{duration(tookOf(t))}</dd>
                      <dt>Turns</dt>
                      <dd>{t.turns}</dd>
                      <dt>Files</dt>
                      <dd>{t.toReview ?? 0}</dd>
                      <dt>Reviewer</dt>
                      <dd>{verdict(t)}</dd>
                    </dl>
                    {tr.failed && <small className="lc-ag-why">{tr.failed}</small>}
                    {state === "done" && t.lead && (t.helpers?.length ?? 0) > 0 && t.turns < 2 + (t.stages?.length ?? 1) && (
                      <small className="lc-ag-aside">
                        {cast.who(t.lead).name} kept every step for the writers, so {names((t.helpers ?? []).map(cast.who))} had nothing to do and cost nothing.
                      </small>
                    )}
                    {onOpen && (
                      <button
                        type="button"
                        className="lc-st-link l-focus lc-ag-open"
                        onClick={() => {
                          // One you put away comes back from Archive first.
                          if (t.archived) void rpc("thread.update", { id: t.id, archived: false }).then(() => onOpen(t.id)).catch(fail);
                          else onOpen(t.id);
                        }}
                      >
                        Open the session
                        <I.chevR size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {runs.length > 0 && !running && (
            <p className="lc-ag-foot lc-ag-trialfoot">
              <span>
                Ran {new Date(runs[0].trial!.at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Each way worked in a worktree of its own, from the same commit.
              </span>
              {runs.some((t) => !t.archived) && (
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={putAway}>
                  <I.box size={12} />
                  Put these sessions away
                </button>
              )}
            </p>
          )}
        </div>
      </div>
    </Part>
  );
}

/* --------------------------------- Run modes --------------------------------- */

function RunModes({ cast }: { cast: Cast }) {
  const { all, providers, active } = cast;
  // The agent that writes in the way new sessions start with: a setup's first stage when that's an agent, else your coder.
  const first = cast.key !== "model" && cast.key !== "lead" && active ? active.stages[0].who : undefined;
  const who = first && !first.startsWith("@") ? cast.who(first) : cast.coder;
  if (!who) return null;
  const mine = (ref: string) => modelLabel(ref, providers);
  const claude = onClaude(who.model);
  const mode = runModeOf(who);
  const set = (runMode: RunMode) => runMode !== mode && void rpc("agents.save", { agents: all.map((a) => (a.id === who.id ? { ...a, runMode } : a)) }).catch(fail);
  const small = mine(who.subagents?.explorer ?? HAIKU);
  const own = mine(who.model);
  const opus = mine(OPUS);
  const sonnet = mine(SONNET);
  if (!claude) {
    return (
      <Part title={`How ${who.name} runs`} note="Whether it brings cheap helpers, or asks a bigger model when it's stuck.">
        <div className="lc-frame">
          <div className="lc-fcard lc-ag-pad">
            <p className="lc-ag-plain">
              Run modes are Claude Code's. {who.name} runs on {providerLabel(who.model, providers)}, so it reads the code and runs the tests itself, and its context fills faster on big changes. Pick a Claude model for {who.name} in Team to bring helpers.
            </p>
          </div>
        </div>
      </Part>
    );
  }
  return (
    <Part title={`How ${who.name} runs`} note={`A setting on each agent. All three keep ${who.name} as the one loop that writes; they differ in which model does the thinking.`}>
      <div className="lc-ag-modes" role="radiogroup" aria-label={`How ${who.name} runs`}>
        <Choice
          on={mode === "helpers"}
          title={`${own}, with cheap helpers`}
          tag={`Closest to ${own} quality`}
          tone="accent"
          onPick={() => set("helpers")}
          chain={
            <>
              <Chip agent={who} providers={providers} />
              <Joint>with</Joint>
              <span className="lc-ag-chip" data-soft>
                <I.bolt size={12} />
                Explorers on {small}
              </span>
              <span className="lc-ag-chip" data-soft>
                Tests as a tool
              </span>
            </>
          }
          rows={[
            ["Effort", `${effortName(who.effort, who.model, providers)}, higher on hard turns`],
            ["Saves by", `Keeping files out of ${own}'s context: explorers read, the test runner reads the failures.`],
            ["Good for", "Unclear asks, changes across many files, thin tests."],
          ]}
        />
        <Choice
          on={mode === "escalate"}
          title={`${sonnet}, escalates to ${opus}`}
          tag="Lowest cost on routine work"
          onPick={() => set("escalate")}
          chain={
            <>
              <Chip agent={who} providers={providers} note={sonnet} />
              <Joint to>asks</Joint>
              <span className="lc-ag-chip" data-soft>
                <ModelMark kind="claude" size={13} />
                {opus}, only when needed
              </span>
            </>
          }
          rows={[
            ["Asks Opus", "To plan a change across several areas, after tests fail twice, or when the Reviewer rejects twice."],
            ["Saves by", "Paying for Opus only on the hard parts."],
            ["Good for", "Routine edits in code with strong tests."],
          ]}
        />
        <Choice slim on={mode === "single"} title={`${own} alone`} tag="No helpers" onPick={() => set("single")} rows={[["Watch for", `${who.name} reads every file and runs every test itself, so its context fills with them on big changes.`]]} />
      </div>
      <div className="lc-ag-pair">
        <div className="lc-ag-panel">
          <span className="lc-ag-cap">An escalation, as it shows in the thread</span>
          <div className="lc-frame">
            <div className="lc-fcard lc-ag-sample">
              <span className="lc-ag-sample-h">
                <Disc agent={who} size={20} />
                <b>{who.name}</b>
                <span className="lc-quiet">{sonnet} · Turn 3</span>
              </span>
              <div className="lc-esc">
                <button type="button" className="lc-esc-h" disabled tabIndex={-1}>
                  <span className="lc-tile">
                    <I.sparkle size={11} />
                  </span>
                  <span>
                    Asked {opus} to plan this<span className="lc-quiet">, a change across sync/ and editor/</span>
                  </span>
                  <span className="lc-grow" />
                  <span className="lc-mono lc-quiet">24s</span>
                </button>
              </div>
              <p>Following {opus}'s plan: the queue first, then the pill. 1 of 3 files done.</p>
            </div>
          </div>
        </div>
        <div className="lc-ag-panel">
          <span className="lc-ag-cap">The three, by design</span>
          <div className="lc-frame">
            <div className="lc-fcard lc-ag-tablecard">
              <table className="lc-ag-table" data-compact>
                <thead>
                  <tr>
                    <th aria-label="What" />
                    <th scope="col" data-on={mode === "helpers" || undefined}>
                      Helpers
                    </th>
                    <th scope="col" data-on={mode === "escalate" || undefined}>
                      Escalates
                    </th>
                    <th scope="col" data-on={mode === "single" || undefined}>
                      Alone
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Thinks on", own, `${sonnet}; ${opus} plans`, own],
                      ["Reads the code", small, small, "Itself"],
                      ["Runs the tests", small, small, "Itself"],
                      ["Cost, routine work", "Middling", "Lowest", "Highest"],
                      ["Its context", "Stays on the work", "Stays on the work", "Fills with files"],
                    ] as const
                  ).map(([k, ...v]) => (
                    <tr key={k}>
                      <th scope="row">{k}</th>
                      {v.map((c, i) => (
                        <td key={i} data-on={mode === (["helpers", "escalate", "single"] as const)[i] || undefined}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Part>
  );
}

/* ----------------------------------- Setups ----------------------------------- */

type Note = { tone: "warn" | "note"; title: string; text: string };

/** What to watch for in a setup, warnings first. */
function notesOf(s: Setup, cast: Cast): Note[] {
  const { providers, who } = cast;
  const warn: Note[] = [];
  const note: Note[] = [];
  const lead = s.lead ? who(s.lead) : undefined;
  const stages = s.stages.map((st) => who(st.who));
  const crew = s.crew.map(who);
  const first = stages[0];
  const last = stages[stages.length - 1];
  const people = (lead ? 1 : 0) + stages.length + crew.length;
  const checker = checkerOf(s, cast.all, providers);
  const many = (list: unknown[], one: string, more: string) => (list.length === 1 ? one : more);
  if (people >= 4)
    warn.push({ tone: "warn", title: "Too many hand-offs lose context", text: `${people} agents pass this work along, and each hand-off is a summary: what you told ${(lead ?? first).name} thins out before it reaches ${(crew[crew.length - 1] ?? last).name}. Three is a fair ceiling. Put what matters in each stage's job, or give fewer agents bigger parts.` });
  if (crew.length) warn.push({ tone: "warn", title: "The crew's steps skip the Reviewer", text: `The Reviewer checks ${stages.length > 1 ? "the stages' change" : `${first.name}'s work`} before the crew starts. What ${names(crew)} ${many(crew, "does", "do")} after that comes to you as it is.` });
  if (!checker) warn.push({ tone: "warn", title: "Nobody checks the diff", text: `${stages.length > 1 ? "The stages'" : `${first.name}'s`} changes come straight to you. A Reviewer on another model family catches what the writers miss.` });
  if (stages.length > 1) note.push({ tone: "note", title: "Each stage starts fresh", text: `${stages[1].name} gets your ask, the change so far and its job, not ${first.name}'s reasoning. A clear job for each stage is what carries what you meant.` });
  const blank = s.stages.map((st, i) => ({ st, a: stages[i] })).filter((x, i) => i > 0 && !x.st.job.trim());
  if (blank.length) note.push({ tone: "note", title: `${names(blank.map((x) => x.a))} ${many(blank, "has", "have")} no job`, text: `${many(blank, "It's", "They're")} only told to take the change on. Say what you want from ${many(blank, "it", "them")}, like "improve the code" or "write the tests".` });
  if (crew.length) note.push({ tone: "note", title: "One folder, one at a time", text: `${names(crew)} ${many(crew, "starts", "start")} after the Reviewer is done, in the same files, with ${many(crew, "its", "their")} steps and the plan. ${many(crew, "It sees", "They see")} the changes, not why they were made.` });
  if (checker && familyOfRef(checker) === familyOfRef(last.model))
    note.push({ tone: "note", title: "The Reviewer shares the last writer's family", text: `${modelLabel(checker, providers)} and ${modelLabel(last.model, providers)} come from the same family, so they tend to miss the same things. Another family is a real second pair of eyes.` });
  if (checker && s.checks.rounds >= 3) note.push({ tone: "note", title: "A third round rarely helps", text: "Each round is a full review and a fix. What two rounds didn't settle usually needs you." });
  if (lead && /opus/i.test(lead.model) && stages.some((a) => /opus/i.test(a.model))) note.push({ tone: "note", title: "Two Opus loops on every change", text: `${lead.name} plans on Opus and a stage writes on it too. Planning is mostly reading; Sonnet plans well for less.` });
  // Explorers and the test runner come with a Claude Code agent; a model on its own, or another tool, reads and tests by itself.
  const alone = s.stages.map((st, i) => ({ st, a: stages[i] })).filter((x) => x.st.who.startsWith("@") || !onClaude(x.a.model) || runModeOf(x.a) === "single");
  if (alone.length) note.push({ tone: "note", title: `${names(alone.map((x) => x.a))} ${many(alone, "reads", "read")} every file ${many(alone, "itself", "themselves")}`, text: `No explorers or test runner, so ${many(alone, "its", "their")} context fills with files on big changes. Explorers come with a Claude Code agent; a model on its own works alone.` });
  if (!lead) note.push({ tone: "note", title: "No plan before edits", text: `Your message goes straight to ${first.name}. Give the setup a lead when you want to approve a plan first.` });
  return [...warn, ...note];
}

/** How much of what you said reaches a job: four bars for the whole conversation, one for a slice. */
function Sees({ level, text }: { level: number; text: string }) {
  return (
    <span className="lc-ag-sees">
      <span className="lc-ag-bars" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <i key={i} data-on={i <= level || undefined} />
        ))}
      </span>
      Starts with {lower(text)}
    </span>
  );
}

/** Who does a job: one of your agents, or any model on its own, in the same picker as the composer's. `none` adds "nobody". */
function WhoPick({ label, value, none, cast, exclude = [], onPick }: { label: string; value: string | null; none?: string; cast: Cast; exclude?: string[]; onPick: (v: string | null) => void }) {
  const agents = cast.agents.filter((a) => !exclude.includes(a.id));
  const choices = [
    ...(none ? [{ id: "none", title: none, show: <span className="lc-ag-nobody-t">{none}</span> }] : []),
    ...agents.map((a) => ({
      id: a.id,
      title: a.name,
      note: `${a.role} · ${modelLabel(a.model, cast.providers)}`,
      icon: <Disc agent={a} size={18} />,
      show: (
        <span className="lc-ag-who">
          <Disc agent={a} size={18} />
          <b>{a.name}</b>
          <span className="lc-quiet">{modelLabel(a.model, cast.providers)}</span>
        </span>
      ),
    })),
  ];
  const v = value === null ? "none" : value.startsWith("@") ? value.slice(1) : value;
  return <ModelPop label={label} value={v} choices={choices} width={420} onPick={(x) => onPick(x === "none" ? null : choices.some((c) => c.id === x) ? x : `@${x}`)} />;
}

/** A stage's job, in your words, with phrases to start from. Saved when you leave the field. */
function JobField({ value, first, onSave }: { value: string; first: boolean; onSave: (job: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const phrases = first ? ["Scan the program", "Build the core", "Reverse engineer what's there", "Write the first version"] : ["Improve the code", "Fix edge cases", "Write the tests", "Tidy and document"];
  const add = (p: string) => {
    const next = v.trim() ? `${v.trim().replace(/[.,\s]+$/, "")}, ${lower(p)}` : p;
    setV(next);
    onSave(next);
  };
  return (
    <div className="lc-ag-jobf">
      <label className="lc-ag-jobl">
        <span>Its job</span>
        <input
          className="lc-input"
          value={v}
          placeholder={first ? "Like: scan the program, build the core, reverse engineer" : "Like: improve the code, fix edge cases"}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => v !== value && onSave(v)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <span className="lc-ag-phrases">
        {phrases.map((p) => (
          <button key={p} type="button" className="lc-ag-phrase l-focus" onClick={() => add(p)}>
            <I.plus size={10} />
            {p}
          </button>
        ))}
      </span>
    </div>
  );
}

type Job = { id: string; node: ReactNode; title: ReactNode; note: ReactNode; sees?: [number, string]; control?: ReactNode; fixed?: boolean; off?: boolean; under?: ReactNode; back?: string; agent?: boolean };

/** Whoever an id names, as a node on the wire: an agent's disc, or a model's mark. */
const NodeOf = ({ id, cast }: { id: string; cast: Cast }) => (id.startsWith("@") ? <ModelMark kind={markOf(id.slice(1))} size={13} /> : <Disc agent={cast.who(id)} size={24} />);

/**
  Your setups, one at a time down a wire: you ask, the lead takes it and plans, you approve, the
  stages write in turn (each with its job), the crew takes its steps, the turn is snapshotted, the
  Reviewer checks the whole change, and you review. Solid is the work moving on; dashed is what
  comes back to the last stage.
*/
function Setups({ cast, open, onEdit }: { cast: Cast; open?: Setup; onEdit: (id: string) => void }) {
  const { all, agents, providers, setups, key } = cast;
  const wire = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ spine: string; loops: { d: string; id: string }[]; w: number; h: number } | null>(null);
  const s = open;
  const notes = useMemo(() => (s ? notesOf(s, cast) : []), [s, cast]);
  const checker = s ? checkerOf(s, all, providers) : null;
  const autoChecker = s ? checkerOf({ ...s, checks: { ...s.checks, by: "auto" } }, all, providers) : null;

  const patch = (p: Partial<Setup>) => s && putSetups(setups.map((x) => (x.id === s.id ? { ...x, ...p } : x)));
  const setStage = (i: number, p: Partial<Setup["stages"][number]>) => s && patch({ stages: s.stages.map((st, k) => (k === i ? { ...st, ...p } : st)) });
  const patchAgent = (id: string, p: Partial<AgentProfile>) => void rpc("agents.save", { agents: all.map((a) => (a.id === id ? { ...a, ...p } : a)) }).catch(fail);
  const remove = () => {
    if (!s || setups.length < 2) return;
    const before = setups;
    putSetups(setups.filter((x) => x.id !== s.id));
    onEdit(setups.find((x) => x.id !== s.id)!.id);
    toast(`${s.name} is gone`, { action: { label: "Undo", onClick: () => putSetups(before) }, duration: 6000 });
  };
  const copy = () => {
    if (!s) return;
    const id = `s_${Date.now().toString(36)}`;
    putSetups([...setups, { ...s, id, name: `${s.name} copy`, stages: s.stages.map((x) => ({ ...x })), crew: [...s.crew] }]);
    onEdit(id);
  };

  const jobs: Job[] = [];
  if (s) {
    const lead = s.lead;
    const stages = s.stages;
    const lastName = cast.who(stages[stages.length - 1].who).name;
    const firstName = cast.who(stages[0].who).name;
    const inStages = stages.map((st) => st.who);
    jobs.push({ id: "you", node: <I.compose size={12} />, title: "You ask", note: "A message, files, or lines you point at in the diff.", fixed: true });
    jobs.push({
      id: "lead",
      node: lead ? <NodeOf id={lead} cast={cast} /> : <I.hand size={12} />,
      agent: Boolean(lead && !lead.startsWith("@")),
      off: !lead,
      title: "Takes your message",
      note: lead ? "Answers questions itself; a change ends in a plan for you. It reads but never edits." : `Nobody: your message goes straight to ${firstName}.`,
      sees: lead ? [4, "Your whole conversation"] : undefined,
      control: <WhoPick label="Who takes your message" value={lead} none={`Nobody, straight to ${firstName}`} cast={cast} exclude={[stages[0].who]} onPick={(v) => patch({ lead: v })} />,
    });
    if (lead) jobs.push({ id: "approve", node: <I.check size={12} />, title: "You approve the plan", note: "Edit steps, hand a step to the crew, or send it back with a note.", fixed: true });
    stages.forEach((st, i) => {
      const a = cast.who(st.who);
      const claudeAgent = !st.who.startsWith("@") && onClaude(a.model);
      const mode = runModeOf(a);
      jobs.push({
        id: `stage-${i}`,
        node: <NodeOf id={st.who} cast={cast} />,
        agent: !st.who.startsWith("@"),
        title: (
          <>
            {i === 0 ? "Writes the code" : "Takes it on"}
            {stages.length > 1 && <span className="lc-ag-step">Stage {i + 1}</span>}
          </>
        ),
        note: i === 0 ? `The first to edit${lead ? ", once you approve" : ""}.${stages.length > 1 ? ` Then ${cast.who(stages[1].who).name} takes its change on.` : ""}` : `Gets your ask, the change so far and its job. It sees what ${cast.who(stages[i - 1].who).name} changed, not why.`,
        sees: i === 0 ? (lead ? [2, "The approved plan"] : [4, "Your whole conversation"]) : [2, "Your ask and the change so far"],
        control: (
          <span className="lc-ag-stagec">
            <WhoPick label={`Who writes in stage ${i + 1}`} value={st.who} cast={cast} exclude={lead ? [lead] : []} onPick={(v) => v && setStage(i, { who: v })} />
            {i > 0 && (
              <button type="button" className="lc-ib l-focus" aria-label={`Take stage ${i + 1} out`} title="Take this stage out" onClick={() => patch({ stages: stages.filter((_, k) => k !== i) })}>
                <I.close size={12} />
              </button>
            )}
          </span>
        ),
        under: (
          <>
            <JobField value={st.job} first={i === 0} onSave={(job) => setStage(i, { job })} />
            {claudeAgent && mode !== "single" && (
              <div className="lc-ag-helpers">
                <span className="lc-ag-helper">
                  <span className="lc-ag-helper-t">
                    <b>Explorers</b>
                    <Sees level={1} text="One question each" />
                  </span>
                  <ModelPop label="Explorers run on" value={a.subagents?.explorer ?? HAIKU} only={onClaudeCode} onPick={(v) => patchAgent(a.id, { subagents: { ...a.subagents, explorer: v } })} />
                </span>
                <span className="lc-ag-helper">
                  <span className="lc-ag-helper-t">
                    <b>Test runner</b>
                    <Sees level={1} text="The tests to run" />
                  </span>
                  <ModelPop label="The test runner runs on" value={a.subagents?.tests ?? HAIKU} only={onClaudeCode} onPick={(v) => patchAgent(a.id, { subagents: { ...a.subagents, tests: v } })} />
                </span>
              </div>
            )}
            {claudeAgent && mode === "single" && (
              <div className="lc-ag-helpers">
                <span className="lc-ag-helper" data-off>
                  <span className="lc-ag-helper-t">
                    <b>No helpers</b>
                    <small>{a.name} reads and runs tests itself.</small>
                  </span>
                  <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => patchAgent(a.id, { runMode: "helpers" })}>
                    Bring helpers
                  </button>
                </span>
              </div>
            )}
          </>
        ),
      });
    });
    if (stages.length < MAX_STAGES)
      jobs.push({
        id: "add",
        node: <I.plus size={11} />,
        fixed: true,
        title: "Hand it on",
        note: `Another model takes ${lastName}'s change on with a job of its own, like Opus improving what a faster model built.`,
        control: (
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => patch({ stages: [...stages, { who: allModels(providers).some((m) => m.ref === OPUS) ? `@${OPUS}` : stages[stages.length - 1].who, job: "Improve the code" }] })}>
            <I.plus size={12} />
            Add a stage
          </button>
        ),
      });
    const pool = agents.filter((a) => a.id !== lead && !inStages.includes(a.id));
    jobs.push({
      id: "crew",
      node: <I.agents size={12} />,
      off: !lead,
      title: "Takes steps from the plan",
      note: lead ? (s.crew.length ? `${cast.who(lead).name} may give ${s.crew.length === 1 ? "it" : "them"} a step; each goes after the Reviewer, in the same folder.` : `Agents ${cast.who(lead).name} may give a step to. Nobody yet.`) : "Needs a lead: only a lead hands out steps.",
      sees: lead && s.crew.length ? [1, "Its steps, and the plan to read"] : undefined,
      under: (
        <div className="lc-ag-crew" role="group" aria-label="The crew">
          {pool.map((a) => {
            const on = s.crew.includes(a.id);
            return (
              <button key={a.id} type="button" className="lc-mchip lc-ag-crewchip l-focus" data-on={on || undefined} aria-pressed={on} disabled={!lead} title={`${a.role} · ${modelLabel(a.model, providers)}`} onClick={() => patch({ crew: on ? s.crew.filter((c) => c !== a.id) : [...s.crew, a.id] })}>
                <Disc agent={a} size={16} />
                {a.name}
                {on && <I.check size={11} />}
              </button>
            );
          })}
          {!pool.length && <span className="lc-quiet">Make more agents in Team to give them steps.</span>}
        </div>
      ),
    });
    jobs.push({ id: "snap", node: <I.commit size={12} />, title: "Snapshot", note: "Liner Code keeps every turn, so Undo rewinds it. Nobody commits for you.", fixed: true });
    jobs.push({
      id: "review",
      node: <I.shield size={12} />,
      off: !checker,
      title: "Checks the diff",
      note: checker ? `Reads the whole change${stages.length > 1 ? " from every stage" : ""} against five fixed criteria. Blocking notes go back to ${lastName}, up to ${s.checks.rounds === 1 ? "once" : `${s.checks.rounds} times`}.` : "Nobody: changes come straight to you.",
      sees: checker ? [1, "Your first ask and the diff"] : undefined,
      back: checker ? `back to ${lastName}` : undefined,
      control: (
        <span className="lc-ag-revc">
          <ModelPop
            label="Who checks the diff"
            value={s.checks.by === null ? "none" : s.checks.by}
            choices={[
              {
                id: "auto",
                title: "Another model family",
                note: autoChecker ? `Picked for you: ${modelLabel(autoChecker, providers)}, so it doesn't share ${lastName}'s blind spots` : "Picked for you when one is ready",
                show: autoChecker ? (
                  <span className="lc-ag-auto">
                    <ModelMark kind={markOf(autoChecker)} size={12} />
                    Another family
                    <span className="lc-quiet">{modelLabel(autoChecker, providers)}</span>
                  </span>
                ) : undefined,
              },
              { id: "none", title: "Nobody", note: "Changes come straight to you" },
            ]}
            onPick={(v) => patch({ checks: { ...s.checks, by: v === "none" ? null : v } })}
          />
          {checker && (
            <>
              <Segmented
                size="sm"
                value={String(s.checks.rounds)}
                onValueChange={(v) => patch({ checks: { ...s.checks, rounds: Number(v) } })}
                options={[
                  { value: "1", label: "1" },
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                ]}
                aria-label="Rounds before it's yours"
              />
              <span className="lc-quiet lc-ag-unit">{s.checks.rounds === 1 ? "round" : "rounds"}</span>
            </>
          )}
        </span>
      ),
    });
    jobs.push({ id: "you2", node: <I.eye size={12} />, title: "You review", note: `Commit, Undo the turn, or point at lines and ask; your note goes straight to ${lastName}.`, fixed: true, back: `your lines, to ${lastName}` });
  }

  // The wire: a line through every node, and a dashed loop from each job that sends work back to the last stage.
  const last = s ? `stage-${s.stages.length - 1}` : "";
  const shape = jobs.map((j) => `${j.id}${j.back ? "<" : ""}`).join();
  useLayoutEffect(() => {
    const box = wire.current;
    if (!box) return;
    const draw = () => {
      const b = box.getBoundingClientRect();
      const at = (id: string) => box.querySelector<HTMLElement>(`[data-node="${id}"]`)?.getBoundingClientRect();
      const y = (id: string) => {
        const r = at(id);
        return r ? r.top - b.top + r.height / 2 : null;
      };
      const ys = jobs.map((j) => y(j.id)).filter((v): v is number => v !== null);
      const w = y(last);
      const node = at(last);
      if (ys.length < 2 || w === null || !node) return setPaths(null);
      // The spine runs through the nodes' centres; each loop leaves its node to the left, a lane further out than the last.
      const X = node.left - b.left + node.width / 2;
      const loops = jobs
        .filter((j) => j.back)
        .map((j, i) => {
          const from = y(j.id)!;
          // Each lands on the stage a little apart, the outer one higher, so the two never cross.
          const to = w + (i ? -4 : 4);
          const lx = X - 26 - i * 13;
          const r = 6;
          return { id: j.id, d: `M ${X - 17} ${from} H ${lx + r} Q ${lx} ${from} ${lx} ${from - r} V ${to + r} Q ${lx} ${to} ${lx + r} ${to} H ${X - 17}` };
        });
      setPaths({ spine: `M ${X} ${ys[0]} V ${ys[ys.length - 1]}`, loops, w: X + 16, h: box.offsetHeight });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [shape, s?.id]);

  if (!s) {
    return (
      <Part title="Your setups" note="Ways of working you make and name: who takes your message, who writes in which stage, who checks.">
        <div className="lc-st-empty">
          <b>No agents yet</b>
          Make a coder in Team, then set up how you work here.
        </div>
      </Part>
    );
  }
  const people = (s.lead ? 1 : 0) + s.stages.length + s.crew.length;
  const warns = notes.filter((n) => n.tone === "warn").length;
  return (
    <Part title="Your setups" note="Ways of working you make and name. Each says who takes your message, who writes in which stage and with what job, and who checks. Solid is the work moving on; dashed is what comes back." end={<NewSetup cast={cast} onMade={onEdit} />}>
      {setups.length > 1 && (
        <div className="lc-ag-tabs" role="tablist" aria-label="Your setups">
          {setups.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === s.id} className="lc-ag-tab l-focus" onClick={() => onEdit(x.id)}>
              {x.name}
              {x.id === key && <span className="lc-ag-inuse" title="New sessions use it" />}
            </button>
          ))}
        </div>
      )}
      <div className="lc-ag-board">
        <div className="lc-frame">
          <div className="lc-fcard lc-ag-wirecard">
            <div className="lc-ag-wirehead">
              <input
                key={`${s.id}:${s.name}`}
                className="lc-ag-name"
                defaultValue={s.name}
                aria-label="The setup's name"
                spellCheck={false}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== s.name) patch({ name });
                  else e.target.value = s.name;
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <span className="lc-quiet lc-ag-count">
                {plural(people, "agent")} · {people > 1 ? plural(people - 1, "hand-off") : "no hand-offs"}
              </span>
              <span className="lc-grow" />
              {key === s.id ? (
                <Badge tone="ok">New sessions use it</Badge>
              ) : (
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => pickWay(s.id)}>
                  Use for new sessions
                </button>
              )}
              <button type="button" className="lc-ib l-focus" aria-label={`Copy ${s.name}`} title="Make a copy" onClick={copy}>
                <I.copy size={14} />
              </button>
              <button type="button" className="lc-ib l-focus" aria-label={`Delete ${s.name}`} title={setups.length < 2 ? "Your only setup stays" : "Delete this setup"} disabled={setups.length < 2} onClick={remove}>
                <I.trash size={14} />
              </button>
            </div>
            <div ref={wire} className="lc-ag-wire">
              {paths && (
                <svg className="lc-ag-lines" width={paths.w} height={paths.h} aria-hidden>
                  <path d={paths.spine} className="lc-ag-spine" />
                  {paths.loops.map((l) => (
                    <path key={l.id} d={l.d} className="lc-ag-loop" markerEnd="url(#lc-ag-arrow)" />
                  ))}
                  <defs>
                    <marker id="lc-ag-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M1 1.2 6 4 1 6.8" className="lc-ag-head" />
                    </marker>
                  </defs>
                </svg>
              )}
              {jobs.map((j) => (
                <div key={j.id} className="lc-ag-job" data-fixed={j.fixed || undefined} data-off={j.off || undefined} data-add={j.id === "add" || undefined}>
                  <span className="lc-ag-node" data-node={j.id} data-agent={j.agent || undefined}>
                    {j.node}
                  </span>
                  <span className="lc-ag-job-t">
                    <b>
                      {j.title}
                      {j.back && (
                        <span className="lc-ag-back">
                          <I.undo size={11} />
                          {j.back}
                        </span>
                      )}
                    </b>
                    <small>{j.note}</small>
                    {j.sees && <Sees level={j.sees[0]} text={j.sees[1]} />}
                  </span>
                  {j.control && <span className="lc-ag-job-c">{j.control}</span>}
                  {j.under && <div className="lc-ag-job-u">{j.under}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="lc-ag-notes" aria-label="What to watch for">
          <span className="lc-ag-cap">
            What to watch for
            {warns > 0 && <Badge tone="warn">{plural(warns, "warning")}</Badge>}
          </span>
          <div className="lc-frame">
            <div className="lc-fcard lc-ag-notelist">
              {notes.length === 0 && (
                <div className="lc-ag-note" data-tone="ok">
                  <I.settle size={14} />
                  <span>
                    <b>Wired well</b>
                    Short hand-offs, a job for every stage, and a check from another family.
                  </span>
                </div>
              )}
              {notes.map((n) => (
                <div key={n.title} className="lc-ag-note" data-tone={n.tone}>
                  {n.tone === "warn" ? <I.alert size={14} /> : <I.idea size={14} />}
                  <span>
                    <b>{n.title}</b>
                    {n.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </Part>
  );
}
