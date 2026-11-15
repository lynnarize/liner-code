/*
  How a pair works: what the lead is told about briefing, letting the sidekick look around, reading
  what comes back, taking work back and handing it over, by the class of its sidekick (small, mid or
  frontier-class, down the lists in tiers.ts). Settings move a model to another class and say how a
  lead hands over; a session can change any of it for itself. Pure, so the engine's rules for the
  lead and the app's picker read the same ways.
*/
import type { Settings } from "./index.ts";
import { splitModel } from "./index.ts";
import { frontierClass, makerOf } from "./cast.ts";
import { FRONTIER, MID, QUICKER, type Tier } from "./tiers.ts";

export type SidekickClass = "small" | "mid" | "frontier";
/** exact: the files and functions to change; scoped: the goal, the files and the limits; open: the goal and why. */
export type BriefStyle = "exact" | "scoped" | "open";
/** none: it doesn't go looking; bounded: a few searches; open: it reads what it needs. */
export type Exploring = "none" | "bounded" | "open";
/** all: every file it changed; diff: the diff, trusting a check it reported; risk: the diff where it matters. */
export type Reviewing = "all" | "diff" | "risk";
/** default: the lead hands work over by default; asked: only when the person asks. */
export type HandOver = "default" | "asked";
/** A session's own changes to how its pair works; unset keys are automatic. */
export type PairTuning = { brief?: BriefStyle; explore?: Exploring; review?: Reviewing; takeBack?: 1 | 2; handOver?: HandOver };
/**
  How a pair works, resolved. `placed`: one of the lists in tiers.ts knows the sidekick. `firm`: an
  automatic "default" for a lead that isn't frontier-class, told more firmly. `own`: the keys the
  session changed from automatic.
*/
export type PairWays = { cls: SidekickClass; placed: boolean; brief: BriefStyle; explore: Exploring; review: Reviewing; takeBack: 1 | 2; handOver: HandOver; firm: boolean; own: (keyof PairTuning)[] };

/**
  What each class of sidekick gets unless someone changes it. A small one is told exactly what to
  change, doesn't look around, has every file it changed read and loses the piece at its first
  failure; a mid one gets the goal, the files and the limits, may search a little, has its diff
  read and gets one correction; a frontier-class one is told what and why and left the how.
*/
export const CLASS_WAYS: Record<SidekickClass, { brief: BriefStyle; explore: Exploring; review: Reviewing; takeBack: 1 | 2 }> = {
  small: { brief: "exact", explore: "none", review: "all", takeBack: 1 },
  mid: { brief: "scoped", explore: "bounded", review: "diff", takeBack: 2 },
  frontier: { brief: "open", explore: "open", review: "risk", takeBack: 2 },
};

/** A pair's lead comes as a bare model ("@claude:claude-opus-5-5") as often as a ref: either reads. */
const bare = (ref: string) => (ref.startsWith("@") ? ref.slice(1) : ref);

/** One of a list's rows knows the model, by its maker and its name, as cast.ts matches them. */
const listed = (ref: string, list: Tier[]) => {
  const { model } = splitModel(ref);
  const maker = makerOf(ref);
  return list.some(([m, res]) => m === maker && res.some((re) => re.test(model)));
};

/**
  Whether any list in tiers.ts knows the model. One none of them knows isn't placed yet: it's
  treated as small, the safe end, until the lists or the person place it.
*/
export function placedOf(ref: string): boolean {
  const r = bare(ref);
  return listed(r, MID) || listed(r, FRONTIER) || listed(r, QUICKER);
}

/**
  The class of a model as a sidekick: where the person moved it (`moved`, Settings.classes, by model
  ref), else mid when MID knows it, frontier when it's frontier-class, else small. MID comes before
  FRONTIER, so Sol, which leads when it's the best you have, is mid beside a stronger lead.
*/
export function sidekickClassOf(ref: string, moved?: Record<string, SidekickClass>): SidekickClass {
  const r = bare(ref);
  const mine = moved?.[r] ?? moved?.[ref];
  if (mine) return mine;
  if (listed(r, MID)) return "mid";
  if (frontierClass(r)) return "frontier";
  return "small";
}

/**
  How a pair works, resolved: the sidekick's class's ways, then Settings' word on handing over, then
  the session's own on top. Automatic hand-over is "default"; with a lead that isn't frontier-class
  it is told more firmly (`firm`), as such a lead keeps work it should hand over. "By default" set in
  Settings is the person's word and said plainly. A session's own "By default" only counts where
  Settings say "When asked" (otherwise it equals automatic, isn't kept, and the lead is told as
  automatic would be); there it is plain too, since Settings then have a word. A key the session
  set to what automatic would be anyway isn't counted in `own`.
*/
export function waysOf(lead: string, sidekick: string, settings: Pick<Settings, "classes" | "handOver">, own: PairTuning = {}): PairWays {
  const cls = sidekickClassOf(sidekick, settings.classes);
  const auto = { ...CLASS_WAYS[cls], handOver: settings.handOver ?? ("default" as HandOver) };
  const keys = ["brief", "explore", "review", "takeBack", "handOver"] as const;
  const mine = keys.filter((k) => own[k] !== undefined && own[k] !== auto[k]);
  const ways = { ...auto };
  for (const k of mine) (ways as Record<string, unknown>)[k] = own[k];
  const firm = ways.handOver === "default" && !settings.handOver && !frontierClass(bare(lead));
  return { cls, placed: placedOf(sidekick), ...ways, firm, own: [...mine] };
}
