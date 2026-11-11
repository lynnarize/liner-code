/*
  What a pair is likely to cost, beside its lead alone (Best) and its sidekick alone (Fast): a dot
  on a bar from green to red, never a number. The bar runs from nothing to a little past the
  dearest model you have ready, so the same model sits in the same place whichever pair is picked.
  The figures, and how a pair shares a task, are contracts' (tiers.ts: COST, LEAD_SHARE).
*/
import type { CSSProperties } from "react";
import type { ProviderInfo } from "@contracts";
import { costOf, dearestOf, pairCostOf } from "@contracts";
import { useEngine } from "./engine";

/** The dearest model sits here, in percent, so a label still fits after its mark. */
const FAR = 85;

/** Where a cost sits on the bar, in percent of its width. `also` are costs that must fit on it (a pick whose tool isn't ready). */
export function costScale(providers: ProviderInfo[], ...also: (number | undefined)[]) {
  const top = Math.max(dearestOf(providers), ...also.map((c) => c ?? 0));
  return (cost: number) => (top ? Math.round((cost / top) * FAR * 10) / 10 : 0);
}

/** A choice's cost in a list, as a short bar: how far along the same scale picking it would put the pair. No figure, no bar (its room is kept). */
export function CostMini({ at }: { at?: number }) {
  return (
    <span className="lc-cost-mini" data-none={at === undefined || undefined} aria-hidden>
      {at !== undefined && <i style={{ width: `${Math.min(100, Math.round((at / FAR) * 100))}%` }} />}
    </span>
  );
}

export function PairCost({ lead, sidekick, names }: { lead: string; sidekick: string; names: { lead: string; sidekick: string } }) {
  const providers = useEngine((s) => s.providers);
  const l = costOf(lead);
  const s = costOf(sidekick);
  const pair = pairCostOf(lead, sidekick);
  if (l === undefined || s === undefined || !pair) {
    const missing = [l === undefined && names.lead, s === undefined && names.sidekick].filter(Boolean).join(" or ");
    return <p className="lc-who-note lc-cost-none">No cost estimate for {missing} yet.</p>;
  }
  const at = costScale(providers, l, s);
  const ratio = pair.total / l;
  const word = ratio > 1.05 ? "Above Best" : ratio >= 0.95 ? "About the same as Best" : ratio >= 0.8 ? "A little under Best" : ratio >= 0.55 ? "Under Best" : ratio >= 0.4 ? "About half of Best" : "Well under Best";
  const fast = pair.total > s * 1.05 ? "more than Fast" : pair.total < s * 0.95 ? "less than Fast" : "about the same as Fast";
  // The two marks under the bar, the cheaper first. Their names go either side of them, so two that
  // sit close never overlap; hard against the left edge they share one name after the second.
  const [lo, hi] = s <= l ? [{ k: "Fast", at: at(s) }, { k: "Best", at: at(l) }] : [{ k: "Best", at: at(l) }, { k: "Fast", at: at(s) }];
  const tight = lo.at < 12;
  const names2: { text: string; at: number; side: "before" | "after" }[] = tight && hi.at - lo.at < 14 ? [{ text: `${lo.k} · ${hi.k}`, at: hi.at, side: "after" }] : [{ text: lo.k, at: lo.at, side: tight ? "after" : "before" }, { text: hi.k, at: hi.at, side: "after" }];
  return (
    <div className="lc-cost">
      <div className="lc-cost-h">
        <span>Estimated cost</span>
        <span>{word}</span>
      </div>
      <div className="lc-cost-bar" role="img" aria-label={`Estimated cost of this pair: ${word[0].toLowerCase()}${word.slice(1)}, ${fast}.`} style={{ "--pair": `${at(pair.total)}%` } as CSSProperties}>
        <span className="lc-cost-pair">Pair</span>
        <i className="lc-cost-track" />
        <i className="lc-cost-dot" />
        {[lo, hi].map((t) => (
          <i key={t.k} className="lc-cost-tick" style={{ left: `${t.at}%` }} />
        ))}
        {names2.map((t) => (
          <span key={t.text} className="lc-cost-lab" data-side={t.side} style={{ "--at": `${t.at}%` } as CSSProperties}>
            {t.text}
          </span>
        ))}
      </div>
      <p className="lc-who-note lc-cost-note">From each model's price for a typical task, and how a pair shares the work. Your plan may differ.</p>
    </div>
  );
}
