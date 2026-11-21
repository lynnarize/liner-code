/*
  What Settings › General says a new session starts with. No React and no alias imports here, so plain Node can test it
  (engine/test/reviewed-faults.test.ts).
*/
import { startOf, type ProviderInfo, type Settings } from "../../../contracts/src/index.ts";

/**
  What Home will really start a new session with, read by the function Home starts it by (contracts' startOf), so the two
  can't disagree. A saved model whose tool isn't ready doesn't start (startOf falls back to Fusion or the lead), and the
  words say so. `label` names a model; `short` gives a sidekick its short name.
*/
export function startSaid(settings: Pick<Settings, "start" | "picks">, providers: ProviderInfo[], label: (ref: string) => string, short: (name: string) => string = (n) => n): string {
  const real = startOf(settings, providers);
  const saved = typeof settings.start === "string" && settings.start.startsWith("@") ? settings.start.slice(1) : undefined;
  const now = !real ? "No model is ready yet." : real.sidekick ? `Fusion: ${label(real.agent.slice(1))} leads, ${short(label(real.sidekick))} does the work it hands over.` : `${label(real.agent.slice(1))} alone.`;
  if (!saved || real?.agent === `@${saved}`) return now;
  return real ? `${now} Your pick, ${label(saved)}, waits until its tool is ready.` : `Your pick, ${label(saved)}, waits until its tool is ready, and no other model is ready yet.`;
}
