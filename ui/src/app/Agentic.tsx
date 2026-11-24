/*
  Agentic features: your pair, the lead and the sidekick that new sessions start with (each
  automatic until you pick one), and what a new session starts with (Fusion, or a model picked in the
  message box's own panel); how a pair
  works, by the class of its sidekick, with your models in their classes; the lead in a pair (how it
  hands over, and its effort); then the Reviewer, which reads each change before it's yours. How one of your agents runs (with helpers
  or alone) is the agent's own setting, in Team.
*/
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { ModelPicks, ProviderInfo, Settings as EngineSettings, SidekickClass } from "@contracts";
import { castOf, clampSubagentMax, clampSwarmHibernate, clampSwarmMax, CLASS_WAYS, frontierClass, makerOf, placedOf, reviewerOf, sidekickClassOf, SMALL_CHANGE, startOf } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I, ModelMark } from "./icons";
import { allModels, markOf, modelLabel, plural } from "./model";
import { EffortPick, ModelPop, startModel, StartPick } from "./Models";
import { settingLevel } from "./picker";
import { NamedSwitch, PanelHead, Pop, Row, Sep } from "./ui";
import "./agentic.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const save = (patch: Partial<EngineSettings>) => void rpc("settings.save", patch).catch(fail);

/** Your own picks for the pair and the Reviewer (unset is automatic), as Settings keep them. */
type Picks = ModelPicks;
export const myPicks = (s: Pick<EngineSettings, "picks">): Picks => s.picks ?? {};
/** Picks a model for a part (undefined: back to automatic), keeping your other picks. */
export function savePick(s: Pick<EngineSettings, "picks">, part: keyof Picks, ref: string | undefined) {
  const p: Picks = { ...myPicks(s), [part]: ref };
  save({ picks: Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Picks });
}
/** The lead and the sidekick both back to automatic; the Reviewer's pick stays. */
function clearPair(s: Pick<EngineSettings, "picks">) {
  const { lead: _l, sidekick: _s, ...rest } = myPicks(s);
  save({ picks: rest });
}

/**
  The Reviewer for those who write a change (the lead first, then a pair's sidekick): your pick unless it is one of them,
  else the best reader of another maker. Automatic leaves your pick out.
*/
export function reviewerFor(writers: string[], providers: ProviderInfo[], p: Picks, automatic = false) {
  return reviewerOf(writers, providers, automatic ? { ...p, checker: undefined } : p);
}

/** Who'd do what today, from your picks and what's ready, and what each part falls back to. */
function usePair() {
  const providers = useEngine((x) => x.providers);
  const settings = useEngine((x) => x.settings);
  return useMemo(() => {
    const picks = myPicks(settings);
    const cast = castOf(providers, { picks });
    const lead = cast?.lead;
    const side = cast?.sidekick;
    // What a part lands on left automatic, beside your pick for the other (a sidekick for a picked lead isn't it; with no frontier model ready a lead is the sidekick).
    const fall = { lead: castOf(providers, { picks: { ...picks, lead: undefined } })?.lead, sidekick: castOf(providers, { picks: { ...picks, sidekick: undefined } })?.sidekick };
    const models = providers.filter((p) => p.available && p.adapter && p.id !== "demo").reduce((n, p) => n + p.models.length, 0);
    return { providers, settings, picks, cast, fall, models, lead, side, two: Boolean(lead && side && lead !== side), label: (ref: string) => modelLabel(ref, providers) };
  }, [providers, settings]);
}
type Pair = ReturnType<typeof usePair>;

export function Agentic(_: { onOpen?: (threadId: string) => void }) {
  const c = usePair();
  return (
    <div className="lc-ag">
      <YourPair c={c} />
      <PairClasses c={c} />
      <LeadInPair c={c} />
      <Reviewer c={c} />
      <Subagents c={c} />
      <Teamwork c={c} />
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

function Line({ title, note, off, below, children }: { title: string; note: ReactNode; off?: boolean; below?: boolean; children: ReactNode }) {
  const noteId = useId();
  const box = useRef<HTMLSpanElement>(null);
  // The row's explanation is read with its control. The controls come from elsewhere (a picker's trigger, a
  // switch, a segmented row), so it's tied on here, after each render, as NamedSwitch names its switch.
  useEffect(() => {
    box.current?.querySelector('[role="switch"], [role="radiogroup"], button, input')?.setAttribute("aria-describedby", noteId);
  });
  return (
    <div className="lc-st-row" data-off={off || undefined} data-below={below || undefined}>
      <span className="lc-st-t">
        <b>{title}</b>
        <small id={noteId}>{note}</small>
      </span>
      <span ref={box} className="lc-st-c">
        {children}
      </span>
    </div>
  );
}

/** A model picker that starts on Automatic, which says what it lands on now. */
function Pick({ c, title, part, fallback, disabled }: { c: Pair; title: string; part: keyof Picks; fallback: string | undefined | null; disabled?: boolean }) {
  const automatic = {
    id: "auto",
    title: "Automatic",
    note: fallback ? `${c.label(fallback)} now, from what's ready` : "Nothing ready yet",
    show: (
      <span className="lc-ag-who">
        <span className="lc-quiet">Automatic</span>
        <b>{fallback ? c.label(fallback) : "none"}</b>
      </span>
    ),
  };
  if (disabled) return <span className="lc-ag-who lc-quiet">{fallback ? c.label(fallback) : "None"}</span>;
  const pick = (v: string) => {
    const ref = v === "auto" ? undefined : v;
    if (part !== "checker" && oneModelPair(c, part, ref)) return part === "lead" ? toast("The lead and its sidekick are two different models", { description: "Pick another sidekick first, or another lead." }) : toast("The lead and its sidekick are two different models", { description: `${c.lead ? c.label(c.lead) : "The lead"} leads: pick another model to work for it.` });
    savePick(c.settings, part, ref);
  };
  return <ModelPop label={title} value={c.picks[part] ?? "auto"} choices={[automatic]} onPick={pick} />;
}

/**
  A pair is two models, as the composer holds it: a pick that would make the lead and the sidekick the same
  model is refused, while more than one model is ready (with one, both are it, and the page says so).
  An automatic lead with no frontier model to take is the sidekick, whichever it is (castOf): that's Liner
  Code's one model, not a clash, so then a sidekick you pick is held to the lead shown now.
*/
function oneModelPair(c: Pair, part: "lead" | "sidekick", ref: string | undefined) {
  const picks = { ...c.picks, [part]: ref };
  const next = castOf(c.providers, { picks });
  if (!next || next.lead !== next.sidekick || c.models < 2) return false;
  if ((!picks.lead || gone(c, picks.lead)) && !frontierClass(next.lead)) return part === "sidekick" && ref === c.lead;
  return true;
}

/** A pick whose tool went away is automatic until it's back. */
const gone = (c: Pair, ref?: string) => Boolean(ref && !c.providers.some((p) => p.available && p.adapter && ref.startsWith(`${p.id}:`)));

/* ---------------------------------- Your pair ---------------------------------- */

function YourPair({ c }: { c: Pair }) {
  const { settings, picks, lead, side, two, label } = c;
  // Unset, a new session starts as a pair when two different models are ready, else on the one there is.
  const start = settings.start ?? (two ? "pair" : "best");
  // Fusion, or the one model it starts on (a Best or Fast saved before reads as the lead or the sidekick alone).
  const shown = startModel(start, c.cast);
  const line = shown === "pair" ? (lead && side ? `${label(lead)} leads: it plans, decides and reviews, and hands ${label(side)} the work it can spell out.` : "The lead plans, decides and reviews; the sidekick does the work the lead hands it.") : shown ? `${label(shown)} alone.` : "No model is ready yet.";
  return (
    <Part
      title="Fusion"
      note="The lead owns a session and hands bounded work to its sidekick, a quicker model, then reads what it changed. Each session can change them from its composer."
      end={
        picks.lead || picks.sidekick ? (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => clearPair(settings)}>
            Both automatic
          </button>
        ) : undefined
      }
    >
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-pair">
          <Line title="Lead" note={<>Plans, takes the judgment calls and reviews the sidekick's work.{gone(c, picks.lead) ? " Your pick's tool isn't ready, so it's automatic for now." : ""}</>}>
            <Pick c={c} title="Lead model" part="lead" fallback={c.fall.lead} />
          </Line>
          <Line title="Sidekick" note={<>Does the work the lead hands it: edits it can specify, the same change across files, slow test runs.{gone(c, picks.sidekick) ? " Your pick's tool isn't ready, so it's automatic for now." : ""}</>}>
            <Pick c={c} title="Sidekick model" part="sidekick" fallback={c.fall.sidekick} />
          </Line>
          <Line title="New sessions start with" note={two || shown !== c.lead ? line : lead && c.models > 1 ? `No model of a lead's class is ready, so ${label(lead)} does it all. Pick a lead above for Fusion.` : lead ? `Fusion needs a second model, and ${label(lead)} is the only one ready. Sign in to another tool, or add an API endpoint in Settings › Models.` : "No model is ready yet."}>
            <StartPick value={start} onPick={(v) => save({ start: v })} />
          </Line>
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- How a pair works ---------------------------------- */

/*
  The three classes a sidekick can be in (contracts' tuning.ts): what each is like, what the lead
  does with it in a sentence, and its four ways as words. What a class means isn't set here; which
  class a model is in is, one model at a time.
*/
const CLASSES: { cls: SidekickClass; name: string; tag: string; line: string }[] = [
  { cls: "small", name: "Small", tag: "Quick and literal", line: "The lead names every file and function, one task per brief. The sidekick does not go looking. The lead reads every file it changed." },
  { cls: "mid", name: "Mid", tag: "Capable with a clear goal", line: "The lead gives the goal, the files involved and the limits. The sidekick may run a few searches. The lead reads the diff and trusts a check the sidekick reports." },
  { cls: "frontier", name: "Frontier-class", tag: "Could lead itself", line: "The lead says what it wants and why and leaves the how. The sidekick explores freely and may push back. The lead reads the diff where it matters." },
];
const BRIEF_WORD = { exact: "Exact files and functions", scoped: "Goal, files and limits", open: "Goal and why" } as const;
const EXPLORE_WORD = { none: "None", bounded: "A few searches", open: "Open" } as const;
const REVIEW_WORD = { all: "Every changed file", diff: "The diff, trusts a reported check", risk: "The diff where it matters" } as const;
const classWord = (cls: SidekickClass) => CLASSES.find((x) => x.cls === cls)!.name;

/*
  JSON leaves an undefined out, so a setting goes back to unset by null, which every reader of it
  takes as unset (`??`, `!`).
*/
const UNSET = null as unknown as undefined;

/**
  Each class with your own ready models in it, a chip each; a chip is a small menu that moves the
  model to another class, or back to where the lists put it. A model no list knows waits under
  "Not placed yet", treated as small until you place it.
*/
function PairClasses({ c }: { c: Pair }) {
  const { providers, settings } = c;
  const moved = settings.classes ?? {};
  // A tool's "default" (an ACP tool's "Hermes default", Codex's configured model) names no model a class could hold: left out.
  const models = useMemo(() => [...new Map(allModels(providers).filter((m) => m.providerId !== "demo" && !m.legacy && !m.ref.endsWith(":default")).map((m) => [m.ref, m])).values()], [providers]);
  // Past six not placed, the rest wait behind "Show all".
  const [allUnplaced, setAllUnplaced] = useState(false);
  // A name two tools share says which tool it is.
  const twice = new Set(models.map((m) => m.label).filter((l, i, all) => all.indexOf(l) !== i));
  // A moved chip is a new one in another row: the focus follows it there once Settings come back.
  const card = useRef<HTMLDivElement>(null);
  const follow = useRef<string | null>(null);
  useEffect(() => {
    const ref = follow.current;
    if (!ref) return;
    follow.current = null;
    requestAnimationFrame(() => card.current?.querySelector<HTMLElement>(`[data-ref="${CSS.escape(ref)}"]`)?.focus({ preventScroll: true }));
  }, [settings.classes]);
  const place = (ref: string, cls: SidekickClass | undefined) => {
    follow.current = ref;
    const next = { ...moved };
    // A move to the class the lists give it anyway isn't kept as one, unless it places a model no list knows.
    if (!cls || (cls === sidekickClassOf(ref) && placedOf(ref))) delete next[ref];
    else next[ref] = cls;
    save({ classes: next });
  };
  const chip = (m: (typeof models)[number]) => {
    const own = moved[m.ref];
    const cls = sidekickClassOf(m.ref, moved);
    const name = twice.has(m.label) ? `${m.label} · ${m.provider}` : m.label;
    const placed = placedOf(m.ref);
    return (
      <Pop
        key={m.ref}
        menu
        width={260}
        label={`${name}: ${own || placed ? `${classWord(cls)}${own ? ", moved by you" : ""}` : "not placed yet, treated as small"}. Move it`}
        triggerClass="lc-ag-mchip"
        triggerAttrs={{ "data-own": Boolean(own) || undefined, "data-ref": m.ref, title: `${m.label}, ${m.provider}` }}
        trigger={
          <>
            <ModelMark kind={markOf(m.ref)} size={12} />
            <span>{name}</span>
          </>
        }
      >
        {(close) => (
          <>
            <PanelHead>Move {m.label} as a sidekick</PanelHead>
            {CLASSES.map((k) => (
              <Row key={k.cls} title={k.name} note={k.tag} on={(own || placed) && cls === k.cls} onPick={() => (place(m.ref, k.cls), close())} />
            ))}
            {own && (
              <>
                <Sep />
                <Row title="Back to automatic" note={placed ? `${classWord(sidekickClassOf(m.ref))}, from the lists` : "Not placed yet, treated as small"} onPick={() => (place(m.ref, undefined), close())} />
              </>
            )}
          </>
        )}
      </Pop>
    );
  };
  const unplaced = models.filter((m) => !moved[m.ref] && !placedOf(m.ref));
  return (
    <Part
      title="How Fusion works"
      note="The lead writes for the sidekick it has. Each of your models sits in a class, and the class sets how the lead briefs it and checks its work."
      end={
        Object.keys(moved).length ? (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => save({ classes: {} })}>
            All automatic
          </button>
        ) : undefined
      }
    >
      <div className="lc-frame">
        <div ref={card} className="lc-fcard lc-st-card lc-ag-pair">
          {CLASSES.map((k) => {
            const ways = CLASS_WAYS[k.cls];
            const mine = models.filter((m) => (moved[m.ref] || placedOf(m.ref)) && sidekickClassOf(m.ref, moved) === k.cls);
            return (
              <div key={k.cls} className="lc-ag-cls">
                <div>
                  <h3>{k.name}</h3>
                  <small>{k.tag}</small>
                </div>
                <div>
                  <div className="lc-ag-models">{mine.length ? mine.map(chip) : <span className="lc-quiet">None of your models</span>}</div>
                  <p>{k.line}</p>
                  <dl>
                    <div>
                      <dt>Brief</dt>
                      <dd>{BRIEF_WORD[ways.brief]}</dd>
                    </div>
                    <div>
                      <dt>Exploration</dt>
                      <dd>{EXPLORE_WORD[ways.explore]}</dd>
                    </div>
                    <div>
                      <dt>Review</dt>
                      <dd>{REVIEW_WORD[ways.review]}</dd>
                    </div>
                    <div>
                      <dt>Take back after</dt>
                      <dd>{plural(ways.takeBack, "failure")}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            );
          })}
          {unplaced.length > 0 && (
            <Line title="Not placed yet" note={`${unplaced.length === 1 ? "No list knows this model, so it is" : "No list knows these models, so they are"} treated as small until you place ${unplaced.length === 1 ? "it" : "them"}.`} below>
              <div className="lc-ag-models">
                {(allUnplaced ? unplaced : unplaced.slice(0, 6)).map(chip)}
                {!allUnplaced && unplaced.length > 6 && (
                  <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => (setAllUnplaced(true), requestAnimationFrame(() => card.current?.querySelector<HTMLElement>(`[data-ref="${CSS.escape(unplaced[6].ref)}"]`)?.focus({ preventScroll: true })))}>
                    Show all {unplaced.length}
                  </button>
                )}
              </div>
            </Line>
          )}
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- The lead in a pair ---------------------------------- */

const HAND_OVER = [
  { id: "auto", title: "Automatic", note: "By default. A lead that isn't frontier-class is told more firmly." },
  { id: "default", title: "By default", note: "Slow runs, edits across files and repeated changes go to the sidekick." },
  { id: "asked", title: "When asked", note: "The lead keeps the work unless you ask it to use its sidekick." },
] as const;

/** How a pair's lead hands work over, and the effort a session gets when it becomes a pair. */
function LeadInPair({ c }: { c: Pair }) {
  const { settings } = c;
  const hand = settings.handOver ?? "auto";
  const now = HAND_OVER.find((h) => h.id === hand) ?? HAND_OVER[0];
  return (
    <Part title="The lead in Fusion">
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-pair">
          <Line title="Hands over" note="A frontier-class lead hands over slow runs and spelled-out edits by default. Any other lead tends to keep the work, so it is told more firmly.">
            <Pop
              menu
              width={300}
              align="end"
              label={`Hands over: ${hand === "auto" ? "Automatic, by default" : now.title}. Change it`}
              triggerClass="lc-mpop"
              trigger={
                <>
                  <span className="lc-ag-who">
                    {hand === "auto" ? (
                      <>
                        <span className="lc-quiet">Automatic</span>
                        <b>By default</b>
                      </>
                    ) : (
                      <b>{now.title}</b>
                    )}
                  </span>
                  <I.chevD size={12} />
                </>
              }
            >
              {(close) => HAND_OVER.map((h) => <Row key={h.id} title={h.title} note={h.note} on={hand === h.id} onPick={() => (save({ handOver: h.id === "auto" ? UNSET : h.id }), close())} />)}
            </Pop>
          </Line>
          <Line title="The lead's effort" note="In Fusion, in the levels your lead's model takes. Planning and reading a diff rarely need its most. Alone, the lead keeps its own effort.">
            {/* The levels your lead's model takes, as its tool lists them: Settings' word shows as the nearest it takes, unset as the lead's default. Its own default picked is no word (null): the engine refuses "". */}
            <EffortPick modelRef={c.lead} value={settings.pairEffort ?? ""} label="The lead's effort" onChange={(v) => save({ pairEffort: settingLevel(v) ?? UNSET })} />
          </Line>
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- The Reviewer ---------------------------------- */

function Reviewer({ c }: { c: Pair }) {
  const { settings, picks, providers, label } = c;
  const on = settings.review !== false;
  const rounds = settings.reviewRounds ?? 2;
  const small = settings.reviewSmall === true;
  // There's no session here: the writers are those new sessions start with (the lead, and the sidekick in a pair).
  const start = startOf(settings, providers);
  const writers = start ? [start.agent.slice(1), ...(start.sidekick ? [start.sidekick] : [])] : [];
  const now = writers.length ? reviewerFor(writers, providers, picks) : null;
  const auto = writers.length ? reviewerFor(writers, providers, picks, true) : null;
  return (
    <Part title="The Reviewer" note="Reads each change before it's yours and sends back what must be fixed. Each session can turn it off from the word in its bar.">
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-pair">
          <Line title="Read each change" note={on ? (now && start ? `In new sessions ${label(now)} reads what ${label(writers[0])}${start.sidekick ? " and its sidekick" : ""} change${start.sidekick ? "" : "s"}.` : "Nobody else is ready to read changes yet.") : "Off: changes in new sessions are yours as they are."}>
            <NamedSwitch name="Read each change" checked={on} onCheckedChange={(review) => save({ review })} />
          </Line>
          <Line title="Who reads" note={<>{now && writers.length && makerOf(now) === makerOf(writers[0]) ? `${label(now)} reads, of the lead's own maker: ${now === picks.checker ? "your pick" : "nothing of another maker is ready"}.` : "Best from another maker than the lead's and the sidekick's, so they don't share blind spots."}{gone(c, picks.checker) ? " Your pick's tool isn't ready, so it's automatic for now." : ""}</>} off={!on}>
            <Pick c={c} title="Reviewer model" part="checker" fallback={auto} />
          </Line>
          <Line title="Rounds before it's yours" note="How many times it sends findings back. After that, you decide." off={!on}>
            <Segmented size="sm" value={String(rounds)} onValueChange={(v) => save({ reviewRounds: Number(v) })} options={["1", "2", "3"].map((v) => ({ value: v, label: v }))} aria-label="Rounds before it's yours" />
          </Line>
          <Line title="Small changes too" note={`${SMALL_CHANGE} lines or fewer, or docs alone, go through as they are unless this is on.`} off={!on}>
            <NamedSwitch name="Small changes too" checked={small} onCheckedChange={(reviewSmall) => save({ reviewSmall })} />
          </Line>
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- Subagents ---------------------------------- */

function Subagents({ c }: { c: Pair }) {
  const max = clampSubagentMax(c.settings.maxActiveSubagents);
  const choices = [1, 2, 4, 6, 8];
  if (!choices.includes(max)) {
    choices.push(max);
    choices.sort((a, b) => a - b);
  }
  return (
    <Part title="Subagents" note="For tools without native subagents (Cursor, Grok, added ACP agents). Claude Code, Codex, OpenCode, Hermes and Antigravity use their own.">
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-pair">
          <Line title="Parallel read-only subagents" note="How many read-only subagents run side by side per session; extra calls queue until a slot opens. Higher values start more processes and use more RAM and API concurrency. Write subagents always run one at a time.">
            <Segmented size="sm" value={String(max)} onValueChange={(v) => save({ maxActiveSubagents: Number(v) })} options={choices.map((v) => ({ value: String(v), label: String(v) }))} aria-label="Parallel read-only subagents" />
          </Line>
        </div>
      </div>
    </Part>
  );
}

/* ---------------------------------- Teamwork & Swarm ---------------------------------- */

const HIBERNATE_CHOICES = [
  { value: "0", label: "Immediately" },
  { value: "30", label: "30 s" },
  { value: "120", label: "2 min" },
];

function Teamwork({ c }: { c: Pair }) {
  const maxActive = clampSwarmMax(c.settings.swarmMaxActive);
  const hibernate = clampSwarmHibernate(c.settings.swarmHibernateSec);
  const hibVal = HIBERNATE_CHOICES.some((x) => Number(x.value) === hibernate) ? String(hibernate) : "30";
  const workspace = c.settings.swarmWorkspace ?? "share";
  const stall = c.settings.swarmStallMonitor !== false;
  const autoPost = c.settings.swarmAutoPost !== false;
  const workerModel = c.settings.swarmWorkerModel?.trim() || "";
  const sameChoice = {
    id: "same",
    title: "Same as main model",
    note: "Workers inherit the session's coordinator model and CLI",
    show: (
      <span className="lc-ag-who">
        <span className="lc-quiet">Default</span>
        <b>Same as main model</b>
      </span>
    ),
  };
  return (
    <Part title="Teamwork & Swarm" note="Liner Code's own multi-agent board and worker pool, working across every CLI and API endpoint. Waiting workers hibernate to 0 MB RAM until mentioned again.">
      <div className="lc-frame">
        <div className="lc-fcard lc-st-card lc-ag-pair">
          <Line
            title="Default worker model"
            note={
              workerModel && gone(c, workerModel)
                ? "Your picked tool isn't ready right now, so workers inherit the session's main model instead."
                : "Used for new Swarm and Teamwork workers when no specific model is requested. Default keeps every worker on your session's main model."
            }
          >
            <ModelPop
              label="Default worker model"
              value={workerModel || "same"}
              choices={[sameChoice]}
              onPick={(v) => save({ swarmWorkerModel: v === "same" ? "" : v })}
            />
          </Line>
          <Line title="Active worker processes" note="How many CLI workers run at the same time in a Swarm. Larger rosters queue at 0 MB until a slot opens.">
            <Segmented size="sm" value={String(maxActive)} onValueChange={(v) => save({ swarmMaxActive: Number(v) })} options={[1, 2, 3, 4].map((v) => ({ value: String(v), label: String(v) }))} aria-label="Active worker processes" />
          </Line>
          <Line title="Hibernate waiting workers" note="Closes a parked worker's process after it posts to the board and resumes it on the next @mention.">
            <Segmented size="sm" value={hibVal} onValueChange={(v) => save({ swarmHibernateSec: Number(v) })} options={HIBERNATE_CHOICES} aria-label="Hibernate waiting workers" />
          </Line>
          <Line title="Writer workspace" note="Isolated git worktrees let parallel writers edit without colliding; researchers and verifiers always stay read-only.">
            <Segmented size="sm" value={workspace} onValueChange={(v) => save({ swarmWorkspace: v as "share" | "inherit" })} options={[{ value: "share", label: "Worktree" }, { value: "inherit", label: "Shared folder" }]} aria-label="Writer workspace" />
          </Line>
          <Line title="Stall monitor" note="Deterministic engine timer (0 MB RAM, 0 tokens) that nudges unanswered @mentions or unread board results.">
            <NamedSwitch name="Stall monitor" checked={stall} onCheckedChange={(swarmStallMonitor) => save({ swarmStallMonitor })} />
          </Line>
          <Line title="Auto-post fallback" note="Publishes a worker's final reply to @coordinator if it ends a turn without calling swarm_post.">
            <NamedSwitch name="Auto-post fallback" checked={autoPost} onCheckedChange={(swarmAutoPost) => save({ swarmAutoPost })} />
          </Line>
        </div>
      </div>
    </Part>
  );
}
