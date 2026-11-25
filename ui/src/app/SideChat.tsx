/*
  Side chat: ask about a session beside it, without stopping it or adding to it. Who you talk to
  in the session answers from a fork of its conversation (the engine's thread.side), reads what
  it needs and changes nothing, and nothing said here reaches the session. It knows the session up
  to the turn it started from, as its head says; that line's menu has Catch up, which starts it
  again from where the session is now, and Start again. You write in the same message box as
  everywhere (Composer), its foot, with Permissions held at Read only, and a working answer is
  the same live line over it (LiveLine).
*/
import { useEffect, useMemo, useRef } from "react";
import type { Thread } from "@contracts";
import { useStickToBottom } from "@liner/pro/agents/agents";
import { toast } from "@liner/components/toast/toast";
import { Composer, type Outgoing, type RunSettings } from "./Composer";
import { loadItems, rpc, useEngine, useItems } from "./engine";
import { I } from "./icons";
import { agentOf } from "./model";
import { LiveLine, Timeline } from "./Timeline";
import { PANE_PICK, PaneHead, PaneNote, PaneWords } from "./Pane";
import { MenuFoot, Pop, Row } from "./ui";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function SideChat({ thread, visible }: { thread: Thread; visible: boolean }) {
  const side = useEngine((s) => s.sides.find((x) => x.sideOf === thread.id));
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const all = useItems(side?.id);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const who = agentOf(side?.agent ?? thread.agent, agents, providers);
  const from = side?.sideFrom ?? thread.turns;
  // Its own turns: the session's, copied in when it started, stay out of sight.
  const items = useMemo(() => all.filter((x) => x.turn > from), [all, from]);
  const seen = useRef<Set<string> | null>(null);
  const { ref: scroller, contentRef, follow, stick } = useStickToBottom();

  useEffect(() => {
    if (!side) return;
    seen.current = null;
    void loadItems(side.id).catch(() => {});
    stick();
  }, [side?.id]);
  if (seen.current === null && items.length) seen.current = new Set(items.map((x) => x.id));

  const running = side?.status === "running";
  const behind = thread.turns - from;
  // The first question, or a choice of who answers, starts it, from where the session is now.
  const started = async () => {
    if (side) return side;
    const s = await rpc("thread.side", { id: thread.id });
    await loadItems(s.id);
    return s;
  };
  const send = async (m: Outgoing) => {
    try {
      const s = await started();
      await rpc("thread.send", { id: s.id, text: m.text, files: m.files, mode: m.mode });
      stick();
    } catch (e) {
      // The box puts back what it sent.
      fail(e);
      throw e;
    }
  };
  // Who answers and how hard, as the box offers them: one model, never Fusion (the box is `aside`), and it only ever reads (the engine holds a side chat at Read only).
  const base = side ?? thread;
  const settings: RunSettings = { agent: base.agent, model: base.model, effort: base.effort ?? who.effort, access: "read" };
  const update = (patch: Partial<RunSettings>) => {
    void (async () => {
      const s = await started();
      const p: Parameters<typeof rpc<"thread.update">>[1] = { id: s.id };
      if ("agent" in patch) p.agent = patch.agent;
      if ("model" in patch) p.model = patch.model ?? null;
      if ("effort" in patch) p.effort = patch.effort;
      await rpc("thread.update", p);
    })().catch(fail);
  };
  const again = async () => {
    try {
      const s = await rpc("thread.side", { id: thread.id, fresh: true });
      await loadItems(s.id);
    } catch (e) {
      fail(e);
    }
  };

  // How far it knows the session, the head's one picker: Catch up (when the session has moved on) and Start again.
  const knows = `Knows up to turn ${from}${side && behind > 0 ? ` of ${thread.turns}` : ""}`;
  return (
    <div className="lc-sc">
      <PaneHead
        shows={
          side ? (
            <Pop label={`${who.name} ${knows.toLowerCase()}. Catch up or start again`} menu width={260} triggerClass={PANE_PICK} trigger={<>{knows}<I.chevD size={12} /></>}>
              {(close) => (
                <>
                  {/* Both start it again from where the session is now: behind it, that is catching up. */}
                  {behind > 0 ? <Row title="Catch up" icon={<I.refresh size={14} />} end={`To turn ${thread.turns}`} disabled={running} onPick={() => (close(), void again())} /> : <Row title="Start again" icon={<I.undo size={14} />} disabled={running} onPick={() => (close(), void again())} />}
                  <MenuFoot>{running ? `Once ${who.name} has answered` : behind > 0 ? `Starts it again from turn ${thread.turns}, where the session is now` : "Starts it again from where the session is now"}</MenuFoot>
                </>
              )}
            </Pop>
          ) : (
            <PaneWords>{knows}</PaneWords>
          )
        }
      />
      <div ref={scroller} className="lc-sc-scroll">
        <div ref={contentRef} className="lc-sc-in">
          {side && items.length ? (
            <Timeline threadId={side.id} items={items} seen={seen.current ?? new Set()} onGrow={follow} />
          ) : (
            <PaneNote icon={<I.comment size={20} />} title="Ask about this session on the side">
              {who.name} starts from the session so far and reads what it needs, but changes nothing. What you ask here stays here: the session carries on and never sees it.
            </PaneNote>
          )}
        </div>
      </div>
      {side && <LiveLine threadId={side.id} items={items} docked={false} className="lc-sc-live" />}
      {project && (
        <div className="lc-compose">
          <Composer
            variant="session"
            project={project}
            thread={side}
            draftKey={`side:${thread.id}`}
            settings={settings}
            onSettings={update}
            onSend={send}
            onStop={() => side && void rpc("thread.stop", { id: side.id }).catch(fail)}
            busy={running}
            placeholder={running ? "Ask more: it goes when this answer ends" : `Ask ${who.name} about this session`}
            autoFocus={visible}
            accessLock="A side chat only reads: it changes nothing"
            checkOff
            aside
          />
        </div>
      )}
    </div>
  );
}
