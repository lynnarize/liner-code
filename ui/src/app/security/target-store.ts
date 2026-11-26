/*
  What the scan chips (ScanChip.tsx) and the scan dock (ScanDock.tsx) share: each target's last scan, asked for in one
  security.targetStatus call however many chips a list draws, and asked again when Liner Security says something changed;
  who can scan a project's targets (security.readers, once a project); which scans the dock shows, folded or open (kept per
  window, like the face); and starting a scan, which shows it in the dock.
*/
import { useEffect, useSyncExternalStore } from "react";
import type { ScanReaderChoice, ScanSummary, ScanTarget } from "@contracts";
import { targetKey } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { onStream, rpc } from "../engine";
import { summaryFromRecord } from "./target-summary";

/* ---------- Each target's last scan ---------- */

const status = new Map<string, ScanSummary | null>();
/** The targets on screen, with how many chips show each. */
const shown = new Map<string, { target: ScanTarget; n: number }>();
const listeners = new Set<() => void>();
let version = 0;
let soon = 0;
/** The look waiting to go asks for every target, not only the new ones. */
let soonAll = false;
let asking = false;
let again = false;
const tell = () => {
  version++;
  for (const l of listeners) l();
};

/** Asks for every target on screen (or only those never asked about), once, a moment after the chips that want them mount. */
function ask(all: boolean) {
  soonAll ||= all;
  if (soon) return;
  soon = window.setTimeout(async () => {
    soon = 0;
    all = soonAll;
    soonAll = false;
    if (asking) return void (again = true);
    const list = [...shown.values()].map((x) => x.target).filter((t) => all || !status.has(targetKey(t)));
    if (!list.length) return;
    asking = true;
    try {
      const got = await rpc("security.targetStatus", { targets: list });
      for (const t of list) status.set(targetKey(t), got[targetKey(t)] ?? null);
      tell();
    } catch {
      // the engine is away: the chips keep what they had, and ask again at the next change
    } finally {
      asking = false;
      if (again) {
        again = false;
        ask(true);
      }
    }
  }, all ? 250 : 0);
}

let listening = false;
/** Every change Liner Security reports may move a chip: a scan's progress, a finding found, fixed or dismissed. */
function listen() {
  if (listening) return;
  listening = true;
  onStream((e) => {
    if (e.type === "security.scan" && e.scan.target) {
      // The chip moves with the record at once (a scan that just finished reads finished); its counts follow from the engine.
      const key = targetKey(e.scan.target);
      const had = status.get(key);
      if (shown.has(key) && (!had || had.scanId === e.scan.id || e.scan.startedAt >= had.at)) {
        status.set(key, summaryFromRecord(had, e.scan));
        tell();
      }
      if (dock.auto && e.scan.auto && (e.scan.state === "running" || e.scan.state === "asking") && !dockList.some((d) => d.scanId === e.scan.id)) dockScan(e.scan.id, true);
      ask(true);
    } else if (e.type === "security.changed") ask(true);
  });
}

/** Starts following Liner Security's events (the dock does, as it mounts): Scan new PRs' scans come into the dock as pills. */
export const watchScans = () => listen();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const getVersion = () => version;

/** A target's last scan: undefined while it's being asked, null when it was never scanned. */
export function useScanSummary(target: ScanTarget | undefined): ScanSummary | null | undefined {
  const key = target ? targetKey(target) : "";
  useSyncExternalStore(subscribe, getVersion);
  useEffect(() => {
    if (!target) return;
    listen();
    const had = shown.get(key);
    shown.set(key, { target, n: (had?.n ?? 0) + 1 });
    ask(false);
    return () => {
      const now = shown.get(key);
      if (now && now.n > 1) shown.set(key, { ...now, n: now.n - 1 });
      else shown.delete(key);
    };
  }, [key]);
  return key ? status.get(key) : undefined;
}

/* ---------- Who can scan ---------- */

const readers = new Map<string, ScanReaderChoice[]>();
const readersAsked = new Map<string, Promise<void>>();
/** Who can scan a project's targets: asked once a project (and again after a pick fails). Null until it answers. */
export function useReaders(projectId: string | undefined): ScanReaderChoice[] | null {
  useSyncExternalStore(subscribe, getVersion);
  useEffect(() => {
    if (!projectId || readers.has(projectId) || readersAsked.has(projectId)) return;
    readersAsked.set(
      projectId,
      rpc("security.readers", { projectId }).then(
        (r) => (readers.set(projectId, r), tell()),
        () => void readersAsked.delete(projectId),
      ),
    );
  }, [projectId]);
  return projectId ? (readers.get(projectId) ?? null) : null;
}
/** Asks who can scan again (a tool signed in or out since). */
export const forgetReaders = () => (readers.clear(), readersAsked.clear(), tell());

/** The reader each project's chips run with, once you picked one in this window; else the default. */
const picked = new Map<string, string>();
export const pickedReader = (projectId: string) => picked.get(projectId);
/** Whether scans end with the second look (on unless you turned it off in the menu, for this window). */
let looking = true;
export const lookOn = () => looking;
export const setLookOn = (v: boolean) => ((looking = v), tell());

/* ---------- The dock ---------- */

export type Docked = { scanId: string; folded: boolean; at: number };
const DOCK_KEY = "liner.scan-dock";
let dockList: Docked[] = (() => {
  try {
    const v = JSON.parse(sessionStorage.getItem(DOCK_KEY) ?? "[]") as Docked[];
    return Array.isArray(v) ? v.filter((d) => d && typeof d.scanId === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
})();
const dock = { auto: true };
const dockListeners = new Set<() => void>();
function setDock(next: Docked[]) {
  dockList = next;
  try {
    sessionStorage.setItem(DOCK_KEY, JSON.stringify(next));
  } catch {
    // a window without storage keeps the dock until it closes
  }
  for (const l of dockListeners) l();
}
export const useDock = () =>
  useSyncExternalStore(
    (fn) => {
      dockListeners.add(fn);
      return () => void dockListeners.delete(fn);
    },
    () => dockList,
  );
/** Shows a scan in the dock: open, and the one open before it folds to a pill; `folded` adds it as a pill (Scan new PRs). */
export function dockScan(scanId: string, folded = false) {
  listen();
  const rest = dockList.filter((d) => d.scanId !== scanId).map((d) => (folded ? d : { ...d, folded: true }));
  setDock([...rest, { scanId, folded, at: Date.now() }].slice(-8));
}
export const foldScan = (scanId: string, folded: boolean) => setDock(dockList.map((d) => (d.scanId === scanId ? { ...d, folded } : folded ? d : { ...d, folded: true })));
export const closeScan = (scanId: string) => setDock(dockList.filter((d) => d.scanId !== scanId));

/* ---------- Starting one ---------- */

/** Starts a scan of a target (the chip's left half, a pick in its menu, Check again) and shows it in the dock. Its scan's id, or undefined when it didn't start (said in a toast). */
export async function startTargetScan(target: ScanTarget, reader?: string): Promise<string | undefined> {
  listen();
  try {
    const r = await rpc("security.scanTarget", { target, ...(reader ? { reader } : {}), ...(looking ? {} : { look: false }) });
    if (reader) picked.set(target.projectId, reader);
    dockScan(r.scanId);
    ask(true);
    return r.scanId;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
    if (reader) forgetReaders();
    return undefined;
  }
}
