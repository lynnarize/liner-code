/*
  A working session's ETA as words that count down by themselves, for its sidebar row and its own live line. The
  wording is eta.ts's, kept pure there because the engine's tests read it.
*/
import { useEffect, useState } from "react";
import type { Thread } from "@contracts";
import { etaWords } from "./eta";

/**
  A working session's ETA ("about 2 min left", then "longer than usual"), counting down by itself; nothing with no
  estimate. Grey words like the rest of the row's second line (Sidebar D). The session's live line says the same.
*/
export function EtaLeft({ eta, lead = "" }: { eta?: Thread["eta"]; lead?: string }) {
  const [now, setNow] = useState(Date.now);
  const from = eta?.from;
  const ms = eta?.ms;
  useEffect(() => {
    if (from === undefined) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, [from, ms]);
  const words = etaWords(eta, now);
  return words ? (
    <span title="From how long its last turns on this model took">
      {lead}
      {words}
    </span>
  ) : null;
}
