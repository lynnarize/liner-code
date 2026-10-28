/*
  Liner · Chat thread
  A conversation between people. Messages from the same person group into one run with a
  single name and tail; yours sit on the right in ink. New messages rise in, the thread
  keeps to the bottom unless you have scrolled up (then a glass pill offers to jump), and
  someone typing is said in words that shimmer, not dots.
*/
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Avatar } from "../avatar/avatar";
import "./chat-thread.css";

export type ChatMessage = { id: string; from: string; text: string; time: string; status?: "sending" | "sent" | "read" };
export type ChatThreadProps = {
  messages: ChatMessage[];
  me: string;
  onSend?: (text: string) => void;
  /** Name of whoever is typing. */
  typing?: string | null;
  height?: number;
  className?: string;
};

export function ChatThread({ messages, me, onSend, typing, height = 380, className }: ChatThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const seen = useRef(messages.length);
  const atBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // Stay pinned to the bottom for new messages, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const added = messages.length - seen.current;
    seen.current = messages.length;
    const mine = messages[messages.length - 1]?.from === me;
    if (!away || mine) {
      el.scrollTo({ top: el.scrollHeight, behavior: added > 0 && el.dataset.ready ? "smooth" : "auto" });
      setUnseen(0);
    } else if (added > 0) setUnseen((n) => n + added);
    el.dataset.ready = "";
  }, [messages.length, typing]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    onSend?.(t);
    setDraft("");
    feedback.play("pop", 4);
  };

  return (
    <section className={cx("l-chatx l-frame", className)} aria-label="Conversation">
      <div className="l-frame-card l-chatx__card">
        <div
          ref={scroller}
          className="l-chatx__scroll"
          style={{ height }}
          role="log"
          aria-live="polite"
          onScroll={() => {
            const b = atBottom();
            setAway(!b);
            if (b) setUnseen(0);
          }}
        >
          <div className="l-chatx__day">Today</div>
          {messages.map((m, i) => {
            const mine = m.from === me;
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const first = !prev || prev.from !== m.from;
            const last = !next || next.from !== m.from;
            return (
              <div key={m.id} className="l-chatx__msg" data-mine={mine || undefined} data-first={first || undefined} data-last={last || undefined}>
                {!mine && <span className="l-chatx__face">{last && <Avatar name={m.from} size={28} />}</span>}
                <div className="l-chatx__col">
                  {first && !mine && <span className="l-chatx__name">{m.from}</span>}
                  <div className="l-chatx__bubble">{m.text}</div>
                  {last && (
                    <span className="l-chatx__meta">
                      {m.time}
                      {mine && m.status && <span key={m.status}> · {m.status === "sending" ? "Sending" : m.status === "read" ? "Read" : "Delivered"}</span>}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {typing && (
            <div className="l-chatx__typing" key={typing}>
              <span className="l-shimmer">{typing} is typing</span>
            </div>
          )}
        </div>
        {unseen > 0 && (
          <button type="button" className="l-chatx__jump l-glass" onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}>
            {unseen} new {unseen === 1 ? "message" : "messages"}
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3.5v9m0 0-3.5-3.5M8 12.5l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="l-frame-strip l-chatx__compose">
        <input
          aria-label="Message"
          placeholder="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="l-chatx__send" disabled={!draft.trim()} onClick={send} aria-label="Send">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </section>
  );
}
