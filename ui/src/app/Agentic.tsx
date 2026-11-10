/*
  Agentic features: your pair, the lead and the sidekick that new sessions start with (each
  automatic until you pick one), and what a new session starts as (Pair, Best or Fast); then the
  Reviewer, which reads each change before it's yours. How one of your agents runs (with helpers
  or alone) is the agent's own setting, in Team.
*/
import { useEffect, useId, useMemo, useRef, type ReactNode, type Ref } from "react";
import type { ModelPicks, ProviderInfo, Settings as EngineSettings } from "@contracts";
import { castOf, frontierClass, makerOf, reviewerOf, SMALL_CHANGE, startOf } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { modelLabel } from "./model";
import { ModelPop } from "./Models";
import { NamedSwitch } from "./ui";
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
      <Reviewer c={c} />
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
  return <ModelPop label={title} value={c.picks[part] ?? "auto"} choices={[automatic]} width={440} onPick={pick} />;
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

const STARTS = [
  { value: "pair", label: "Pair" },
  { value: "best", label: "Best" },
  { value: "fast", label: "Fast" },
] as const;

function YourPair({ c }: { c: Pair }) {
  const { settings, picks, lead, side, two, label } = c;
  // Unset, a new session starts as a pair when two different models are ready, else on the one there is.
  const start = settings.start ?? (two ? "pair" : "best");
  const shown = start === "pair" && !two ? "best" : start;
  const lines: Record<(typeof STARTS)[number]["value"], string> = {
    pair: lead && side && two ? `${label(lead)} leads: it plans, decides and reviews, and hands ${label(side)} the work it can spell out.` : "The lead plans, decides and reviews; the sidekick does the work the lead hands it.",
    best: lead ? `${label(lead)} alone, for the hardest work.` : "Your lead model alone.",
    fast: side ? `${label(side)} alone: the quickest, and the least it costs.` : "Your sidekick model alone.",
  };
  return (
    <Part
      title="Your pair"
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
          <Line title="New sessions start with" note={two ? lines[shown] : lead && c.models > 1 ? `No model of a lead's class is ready, so ${label(lead)} does it all. Pick a lead above for a pair.` : lead ? `A pair needs a second model, and ${label(lead)} is the only one ready. Sign in to another tool, or add an API endpoint in Settings › Models.` : "No model is ready yet."} below>
            <Segmented
              size="sm"
              value={shown}
              onValueChange={(v) => save({ start: v as EngineSettings["start"] })}
              options={STARTS.map((s) => ({ value: s.value, label: s.label, disabled: !two && s.value !== "best" }))}
              aria-label="New sessions start with"
            />
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
          <Line title="Who reads" note={<>{now && writers.length && makerOf(now) === makerOf(writers[0]) ? `${label(now)} reads, of the lead's own maker: ${now === picks.checker ? "your pick" : "nothing of another maker is ready"}.` : "Best from another maker than the pair's, so they don't share blind spots."}{gone(c, picks.checker) ? " Your pick's tool isn't ready, so it's automatic for now." : ""}</>} off={!on}>
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
