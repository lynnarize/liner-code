/*
  A target's chip state from a scan's own record, as the engine sends it (security.scan): no React here, so plain Node can
  test it (engine/test/security-targets.test.ts). The chip moves the moment the record does (running, finished, stopped);
  what it found, by severity, follows from security.targetStatus.
*/
import type { ScanRecord, ScanSummary } from "../../../../contracts/src/index.ts";

/** The summary a chip shows once a scan's record moved: its state and words from the record, its counts kept until asked again. */
export function summaryFromRecord(prev: ScanSummary | null | undefined, rec: ScanRecord): ScanSummary {
  const same = prev && prev.scanId === rec.id;
  const state: ScanSummary["state"] = rec.state === "asking" ? "running" : rec.state;
  return {
    scanId: rec.id,
    threadId: rec.threadId ?? "",
    state,
    // A new scan starts from nothing; the same one keeps what it had counted (a count can't go down while it runs).
    high: same ? prev.high : rec.counts.bySeverity.critical + rec.counts.bySeverity.high,
    medium: same ? prev.medium : rec.counts.bySeverity.medium,
    low: same ? prev.low : rec.counts.bySeverity.low,
    ...(rec.summary ? { lead: rec.summary } : {}),
    at: rec.finishedAt ?? rec.startedAt,
    ...(rec.verdict ? { verdict: rec.verdict } : {}),
    ...(rec.verdictSeverity ? { severity: rec.verdictSeverity } : {}),
  };
}
