/*
  What the Pull requests page last read, kept for the window's life, so the amber dot on Pull requests at the sidebar's
  foot can say one waits on your review without the page open. The engine asks gh (worklists.prs); nothing here asks on
  its own until you have opened Pull requests once on this Mac (lc:prs-seen), so someone who never uses the page sends
  nothing to GitHub for it. After that the sidebar reads the open list again every worklistRefresh seconds while the
  window shows (Settings › Source control & issues; 0 is only when the page is opened).
*/
import { useEffect, useSyncExternalStore } from "react";
import type { PrItem, WorklistQuery, WorklistResult } from "@contracts";
import { scmSettings } from "@contracts";
import { rpc, useEngine } from "./engine";
import { waitsOnYourReview } from "./worklists-logic";

let last: PrItem[] | null = null;
const subs = new Set<() => void>();
const SEEN = "lc:prs-seen";

/** The open pull requests as the page or the sidebar last read them. */
export function keepPrs(items: PrItem[], q: WorklistQuery) {
  // Only an unfiltered read of what's open says whether one waits on you; a search or another state would hide it.
  if ((q.state ?? "open") !== "open" || q.projectId || q.q) return;
  last = items;
  for (const f of subs) f();
}

/** The page was opened: from now on the sidebar may read the list on its own. */
export function markPrsSeen() {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {
    // private window: the dot shows only while the page has been opened in this window
  }
}
const seen = () => {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
};

/** A pull request's title as the open list last had it, for an issue's Linked line; unknown is undefined. */
export const knownPrTitle = (projectId: string, n: number) => last?.find((p) => p.projectId === projectId && p.number === n)?.title;

/** Whether a pull request waits on your review, as last read. */
export function usePrDot() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => (last ? waitsOnYourReview(last) : false),
  );
}

/** One read of the open list for the dot; a failure leaves the last answer as it was. */
const readOpen = () =>
  rpc("worklists.prs", { state: "open" }).then(
    (r: WorklistResult<PrItem>) => keepPrs(r.items, { state: "open" }),
    () => {},
  );

/** The sidebar's own reads for the dot: a moment after the window is up, then every worklistRefresh seconds while it shows. */
export function usePrWatch() {
  const every = useEngine((s) => scmSettings(s.settings).worklistRefresh);
  useEffect(() => {
    if (!every) return;
    let timer = 0;
    const tick = () => {
      if (document.visibilityState === "visible" && seen()) void readOpen();
      timer = window.setTimeout(tick, Math.max(60, every) * 1000);
    };
    timer = window.setTimeout(tick, 5000);
    return () => window.clearTimeout(timer);
  }, [every]);
}
