/*
  Casting: who leads, who is the sidekick and who reviews, from your picks and the models that
  are ready, down the tier list in tiers.ts. Pure, so the engine and the app pick the same models.
*/
import type { ModelPicks, ProviderInfo, Settings } from "./index.ts";
import { familyOf, splitModel } from "./index.ts";
import { CAPPED, COST, FRONTIER, HOME, LEAD_SHARE, MAKERS, QUICKER, type Maker, type Tier } from "./tiers.ts";

export type { Maker } from "./tiers.ts";

/** Who made a model (tiers.ts, MAKERS), from its name, else from the tool it runs in. */
export function makerOf(ref: string): Maker {
  const { provider, model } = splitModel(ref);
  for (const [maker, re] of MAKERS) if (re.test(model)) return maker;
  const tool = familyOf(provider);
  return tool === "claude" ? "anthropic" : tool === "codex" ? "openai" : tool === "grok" ? "xai" : "other";
}

/** One of OpenCode Go's, which never leads (tiers.ts, CAPPED). */
const capped = (ref: string) => CAPPED.test(splitModel(ref).model);

const readyOf = (providers: ProviderInfo[]) => providers.filter((p) => p.available && p.adapter && p.id !== "demo" && p.models.length);

/** A row's model from what's ready, in its maker's own tool when that lists one, unless `skip` says no. */
function bestOf(ready: ProviderInfo[], [maker, res]: Tier, skip: (ref: string) => boolean) {
  const order = [...ready].sort((a, b) => Number(familyOf(b.id) === HOME[maker]) - Number(familyOf(a.id) === HOME[maker]));
  for (const re of res)
    for (const p of order)
      for (const m of p.models) {
        const ref = `${p.id}:${m.id}`;
        if (!m.legacy && re.test(m.id) && makerOf(ref) === maker && !skip(ref)) return ref;
      }
  return undefined;
}

/**
  The best model of that class ready, down its table: of none of the makers `not`, none of `except`,
  and for a frontier one not one of OpenCode Go's, unless `reads` lets them in (the Reviewer, last).
*/
function firstOf(ready: ProviderInfo[], kind: "frontier" | "quicker", o: { not?: Maker[]; except?: string[]; reads?: boolean } = {}) {
  for (const row of kind === "frontier" ? FRONTIER : QUICKER) {
    if (o.not?.includes(row[0])) continue;
    const ref = bestOf(ready, row, (r) => Boolean(o.except?.includes(r)) || (kind === "frontier" && !o.reads && capped(r)));
    if (ref) return ref;
  }
  return undefined;
}

/**
  The models to offer first for a pair's lead ("frontier") or its sidekick ("quicker"): the best one
  ready from each row of its table, down the table, `n` at most and none of `except`. The lead's
  never include OpenCode Go's, as they never lead.
*/
export function shortlistOf(providers: ProviderInfo[], kind: "frontier" | "quicker", o: { n?: number; except?: string[] } = {}): string[] {
  const ready = readyOf(providers);
  const out: string[] = [];
  for (const row of kind === "frontier" ? FRONTIER : QUICKER) {
    if (out.length >= (o.n ?? 4)) break;
    const ref = bestOf(ready, row, (r) => out.includes(r) || Boolean(o.except?.includes(r)) || (kind === "frontier" && capped(r)));
    if (ref) out.push(ref);
  }
  return out;
}

/** What a model costs for a typical task, in dollars (tiers.ts, COST); undefined when it hasn't been measured. */
export function costOf(ref: string): number | undefined {
  const { model } = splitModel(ref);
  const maker = makerOf(ref);
  return COST.find(([m, re]) => m === maker && re.test(model))?.[2];
}

/**
  A pair's estimate for the same task, and each one's part of it: the lead's share at the lead's
  price, the rest at the sidekick's (tiers.ts, LEAD_SHARE). Undefined when either has no figure.
*/
export function pairCostOf(lead: string, sidekick: string): { lead: number; sidekick: number; total: number } | undefined {
  const l = costOf(lead);
  const s = costOf(sidekick);
  if (l === undefined || s === undefined) return undefined;
  const mine = l * LEAD_SHARE;
  const theirs = s * (1 - LEAD_SHARE);
  return { lead: mine, sidekick: theirs, total: mine + theirs };
}

/** The dearest model with a figure among those ready: what a cost bar's far end stands for. 0 when none has one. */
export function dearestOf(providers: ProviderInfo[]): number {
  let top = 0;
  for (const p of readyOf(providers)) for (const m of p.models) if (!m.legacy) top = Math.max(top, costOf(`${p.id}:${m.id}`) ?? 0);
  return top;
}

/** A model whose tool is ready, or nothing (a pick whose tool went away falls back to automatic). */
const readyRef = (ready: ProviderInfo[], ref?: string) => (ref && ready.some((p) => p.id === splitModel(ref).provider) ? ref : undefined);

/**
  Your pair, each "<provider>:<model>": your picks while their tools are ready, else automatic. The
  lead is the top of FRONTIER (Opus, else GPT Astra, Fable, Gemini, Sol, GLM…, never one of
  OpenCode Go's); the sidekick the top of QUICKER that isn't the lead (DeepSeek Flash, else Sol,
  Sonnet, Terra, Luna…). With no frontier model ready the sidekick leads too, so both are the same
  model (OpenCode Go alone: DeepSeek Flash). Null with no model ready.
*/
export function castOf(providers: ProviderInfo[], o: { picks?: ModelPicks } = {}): { lead: string; sidekick: string } | null {
  const ready = readyOf(providers);
  if (!ready.length) return null;
  const picks = o.picks ?? {};
  const first = `${ready[0].id}:${(ready[0].models.find((m) => m.isDefault) ?? ready[0].models[0]).id}`;
  const lead = readyRef(ready, picks.lead) ?? firstOf(ready, "frontier");
  // A quicker model that isn't the lead (Sol leads when it's your best, and Terra works beside it).
  const sidekick = readyRef(ready, picks.sidekick) ?? firstOf(ready, "quicker", { except: lead ? [lead] : [] }) ?? firstOf(ready, "quicker") ?? first;
  return { lead: lead ?? sidekick, sidekick };
}

/**
  The Reviewer for a change and everyone who wrote it (`writers`: the lead first, then a pair's
  sidekick, which writes too): the one you picked (`picks.checker`) while its tool is ready, unless
  it is one of them; else the best reader of another maker than theirs, so they don't share blind
  spots, and when no maker but theirs is ready, one of another maker than the lead's at least. It reads every change, so the order minds the cost: a frontier
  model of another maker that isn't one of OpenCode Go's, else a quicker one, and only then one of
  Go's frontier-class models, which draw down the plan's capped monthly allowance at many times
  the price (tiers.ts, CAPPED). With only Go, DeepSeek Flash's change is read by GLM Flash, not by
  GLM-5.3 or Gemini Argon. Else any other ready model, your pair's first; null when there's none.
  Never one of the writers.
*/
export function reviewerOf(writers: string[], providers: ProviderInfo[], picks: ModelPicks = {}): string | null {
  const ready = readyOf(providers);
  const mine = readyRef(ready, picks.checker);
  if (mine && !writers.includes(mine)) return mine;
  const cast = castOf(providers, { picks });
  const pool = [cast?.lead, cast?.sidekick, ...ready.flatMap((p) => p.models.filter((m) => !m.legacy).map((m) => `${p.id}:${m.id}`))].filter((r): r is string => Boolean(r) && !writers.includes(r!));
  const makers = [...new Set(writers.map(makerOf))];
  // Every writer's maker avoided first, then fewer from the last, the lead's kept to the end.
  for (let k = makers.length; k > 0; k--) {
    const not = makers.slice(0, k);
    const o = { not, except: writers };
    const other = firstOf(ready, "frontier", o) ?? firstOf(ready, "quicker", o) ?? firstOf(ready, "frontier", { ...o, reads: true }) ?? pool.find((r) => !not.includes(makerOf(r)));
    if (other) return other;
  }
  return pool[0] ?? null;
}

/**
  Who a new session starts with, from what Settings say it starts with (`start`): a pair, the lead
  alone (best) or the sidekick alone (fast). Unset is a pair when two different models are ready,
  else one model; a pair asked for with one model ready is that model. Null with no model ready.
  The app's picker and the engine (a session started without an agent) both start from here.
*/
export function startOf(settings: Pick<Settings, "start" | "picks">, providers: ProviderInfo[]): { agent: string; sidekick?: string } | null {
  const cast = castOf(providers, { picks: settings.picks });
  if (!cast) return null;
  const two = cast.lead !== cast.sidekick;
  const start = settings.start ?? (two ? "pair" : "best");
  if (start === "pair" && two) return { agent: `@${cast.lead}`, sidekick: cast.sidekick };
  if (start === "fast") return { agent: `@${cast.sidekick}` };
  return { agent: `@${cast.lead}` };
}

/** A pair: a sidekick is set, and it isn't a side chat (which only reads). */
export const isPair = (t: { sidekick?: string; sideOf?: string }) => Boolean(t.sidekick && !t.sideOf);

/** Whether the Reviewer reads a session's changes: the session's own word, else Settings' (on unless false). */
export const reviewOn = (t: { review?: boolean }, s: Pick<Settings, "review">): boolean => t.review ?? s.review !== false;

/**
  A model of the FRONTIER table's class ("claude:claude-opus-5-5"): as a sidekick it gets lighter
  briefs and may push back, where a quicker model gets prescriptive ones. OpenCode Go's never are,
  as they never lead.
*/
export function frontierClass(ref: string): boolean {
  const { model } = splitModel(ref);
  return !capped(ref) && FRONTIER.some(([maker, res]) => makerOf(ref) === maker && res.some((re) => re.test(model)));
}
