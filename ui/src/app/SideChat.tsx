/*
  Side chat: ask about a session beside it, without stopping it or adding to it. Who you talk to
  in the session answers from a fork of its conversation (the engine's thread.side), reads what
  it needs and changes nothing, and nothing said here reaches the session. It knows the session up
  to the turn it started from; Catch up starts it again from where the session is now.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Thread } from "@contracts";
import { useStickToBottom } from "@liner/pro/agents/agents";
import { toast } from "@liner/components/toast/toast";
import { loadItems, rpc, useEngine, useItems } from "./engine";
import { I } from "./icons";
import { agentOf } from "./model";
import { Timeline } from "./Timeline";
import { Disc } from "./ui";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function SideChat({ thread, visible }: { thread: Thread; visible: boolean }) {
  const side = useEngine((s) => s.sides.find((x) => x.sideOf === thread.id));
  const all = useItems(side?.id);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const who = agentOf(side?.agent ?? thread.lead ?? thread.agent, agents, providers);
  const from = side?.sideFrom ?? thread.turns;
  // Its own turns: the session's, copied in when it started, stay out of sight.
  const items = useMemo(() => all.filter((x) => x.turn > from), [all, from]);
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const { ref: scroller, contentRef, follow, stick } = useStickToBottom();

  useEffect(() => {
    if (!side) return;
    seen.current = null;
    void loadItems(side.id);
    stick();
  }, [side?.id]);
  if (seen.current === null && items.length) seen.current = new Set(items.map((x) => x.id));
  useEffect(() => {
    if (visible) field.current?.focus({ preventScroll: true });
  }, [visible]);

  const running = side?.status === "running";
  const behind = thread.turns - from;
  const send = async () => {
    const ask = text.trim();
    if (!ask || starting) return;
    setText("");
    try {
      let s = side;
      // The first question starts it, from where the session is now.
      if (!s) {
        setStarting(true);
        s = await rpc("thread.side", { id: thread.id });
        await loadItems(s.id);
      }
      await rpc("thread.send", { id: s.id, text: ask });
    } catch (e) {
      setText(ask);
      fail(e);
    } finally {
      setStarting(false);
    }
  };
  const again = async () => {
    try {
      const s = await rpc("thread.side", { id: thread.id, fresh: true });
      await loadItems(s.id);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="lc-sc">
      <div className="lc-sc-head">
        <Disc agent={who} size={18} />
        <span className="lc-sc-note">
          <b>{who.name}</b> knows up to turn {from}
          {side && behind > 0 ? ` of ${thread.turns}` : ""}
        </span>
        {side && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={running} title={behind > 0 ? `Start the side chat again from turn ${thread.turns}` : "Start the side chat again"} onClick={() => void again()}>
            {behind > 0 ? "Catch up" : "Start again"}
          </button>
        )}
      </div>
      <div ref={scroller} className="lc-sc-scroll">
        <div ref={contentRef} className="lc-sc-in">
          {side && items.length ? (
            <Timeline threadId={side.id} items={items} seen={seen.current ?? new Set()} onReview={() => {}} onGrow={follow} />
          ) : (
            <div className="lc-sc-empty">
              <span className="lc-sc-empty-i">
                <I.comment size={18} />
              </span>
              <b>Ask about this session on the side</b>
              <span>
                {who.name} starts from the session so far and reads what it needs, but changes nothing. What you ask here stays here: the session carries on and never sees it.
              </span>
            </div>
          )}
        </div>
      </div>
      <form
        className="lc-sc-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={field}
          rows={1}
          value={text}
          aria-label={`Ask ${who.name} on the side`}
          placeholder={running ? "Ask more: it goes when this answer ends" : `Ask ${who.name} about this session`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void send();
          }}
        />
        {running && (
          <button type="button" className="lc-stop l-focus" aria-label="Stop" title="Stop" onClick={() => void rpc("thread.stop", { id: side.id }).catch(fail)}>
            <I.stop />
          </button>
        )}
        <button type="submit" className="lc-send l-focus" aria-label="Ask" title="Ask (Enter)" data-ready={(Boolean(text.trim()) && !starting) || undefined}>
          <I.send size={16} />
        </button>
      </form>
    </div>
  );
}
