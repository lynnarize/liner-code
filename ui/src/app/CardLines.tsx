/*
  The cards at the end of a chat (Timeline.tsx PlanCard, Crew.tsx CrewCard) folded to one line each, as the board Tray
  draws them folded, for the places too small for the cards themselves: a Wall tile, under its live line, and Liner
  Design's chat at its smallest, over its live line. Read-only: the words are the cards' own folded heads
  (chat-cards.ts), and the cards show when these do. `onOpen` makes each line a button that opens where the cards are.
*/
import { useMemo } from "react";
import { isSwarm, type Item, type Thread } from "@contracts";
import { useEngine, useSwarm } from "./engine";
import { I } from "./icons";
import { planEnd, planStatus } from "./model";
import { agentName, agentNow, doing, isSidekick, shortModel, stateOf, useCrew, whoIs, type AgentNode } from "./Crew";
import { crewCounts, planCard, planCount, planLine, teamCounts, teamLine } from "./chat-cards";

type Line = { key: string; name: string; counts: string; line?: string };

export function CardLines({ thread, items, onOpen, className }: { thread: Thread; items: Item[]; onOpen?: () => void; className?: string }) {
  const providers = useEngine((s) => s.providers);
  const card = useMemo(() => planCard(items, (t) => planEnd(planStatus(items, t)) === "stopped"), [items]);
  const crew = useCrew(thread);
  const swarmOn = isSwarm(thread);
  const swarm = useSwarm(thread.id, swarmOn);
  const lines: Line[] = [];
  if (card) lines.push({ key: "plan", name: "Plan", counts: planCount(card.plan.entries), line: planLine(card.plan.entries) });
  if (swarmOn) {
    // As the team's card shows (Crew.tsx CrewCardOf): while a member works or waits for a slot, or the team is paused.
    const workers = swarm?.members.filter((m) => m.name !== "coordinator" && m.state !== "killed") ?? [];
    const busy = workers.some((m) => m.state === "working" || m.state === "queued") || Boolean(swarm?.members.some((m) => m.name === "coordinator" && m.state === "working"));
    if (swarm && workers.length && (busy || swarm.paused || thread.status === "running"))
      lines.push({ key: "team", name: swarm.mode === "swarm" ? "Swarm" : "Teamwork", counts: swarm.paused ? "paused" : teamCounts(swarm.members), line: teamLine(swarm.members.filter((m) => m.state !== "killed")) });
  } else if (crew) {
    // A plain crew's card shows while two or more agents work, or one goes on past its turn (Crew.tsx CrewCardOf).
    const all = [...every(crew.members.flatMap((m) => m.agents)), ...crew.earlier];
    const working = [...crew.agents.filter((t) => stateOf(t) === "running"), ...crew.earlier];
    if (working.length && !(working.length === 1 && thread.status === "running")) {
      const busy = working.find((t) => t.agent?.now) ?? working[0];
      lines.push({ key: "crew", name: crew.pair ? "Fusion" : "Agents", counts: crewCounts(working.length, all.filter((t) => stateOf(t) !== "running").length), line: `${isSidekick(busy) ? shortModel(whoIs(busy, providers)) : agentName(busy)}: ${doing(agentNow(busy))}` });
    }
  }
  if (!lines.length) return null;
  return (
    <div className={className ? `lc-cardl ${className}` : "lc-cardl"} role="group" aria-label="The cards, folded">
      {lines.map((l) => {
        const words = (
          <>
            <b>{l.name}</b>
            {l.counts && <span className="lc-cardl-n">{l.counts}</span>}
            {l.line && <span className="lc-cardl-t">{l.line}</span>}
          </>
        );
        return onOpen ? (
          <button key={l.key} type="button" className="lc-cardl-r l-focus" title="Open the chat" onClick={onOpen}>
            {words}
            <I.chevR size={12} className="lc-cardl-go" />
          </button>
        ) : (
          <div key={l.key} className="lc-cardl-r">
            {words}
          </div>
        );
      })}
    </div>
  );
}

/** Every agent under these, agents of agents too. */
const every = (nodes: AgentNode[]): AgentNode["it"][] => nodes.flatMap((n) => [n.it, ...every(n.kids)]);
