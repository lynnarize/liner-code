/*
  Liner · Comment thread
  A conversation pinned to something. Comments sit on one hairline with replies indented
  beneath; reactions are small counters; a reply field opens in place; and resolving folds
  the whole thread to a single line you can open again.
*/
import { useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Avatar } from "../avatar/avatar";
import "./comment-thread.css";

export type ThreadComment = { id: string; author: string; time: string; body: ReactNode; reactions?: Record<string, number>; mine?: string[] };
export type CommentThreadProps = {
  comments: ThreadComment[];
  me: string;
  /** What the thread is about, like a quoted line. */
  anchor?: ReactNode;
  onReply?: (text: string) => void;
  onResolve?: (resolved: boolean) => void;
  className?: string;
};

export function CommentThread({ comments: initial, me, anchor, onReply, onResolve, className }: CommentThreadProps) {
  const [comments, setComments] = useState(initial);
  const [draft, setDraft] = useState("");
  const [resolved, setResolved] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const c: ThreadComment = { id: `c${Date.now()}`, author: me, time: "now", body: text };
    setComments((x) => [...x, c]);
    setFresh(c.id);
    setDraft("");
    onReply?.(text);
    feedback.play("pop", 4);
  };
  const react = (id: string, emoji: string) =>
    setComments((x) =>
      x.map((c) => {
        if (c.id !== id) return c;
        const mine = c.mine ?? [];
        const on = mine.includes(emoji);
        const count = (c.reactions?.[emoji] ?? 0) + (on ? -1 : 1);
        return { ...c, mine: on ? mine.filter((e) => e !== emoji) : [...mine, emoji], reactions: { ...c.reactions, [emoji]: count } };
      }),
    );

  return (
    <section className={cx("l-thread l-frame", className)} data-resolved={resolved || undefined} aria-label="Comments">
      <div className="l-frame-strip l-thread__bar">
        <span className="l-thread__count">
          {comments.length} {comments.length === 1 ? "comment" : "comments"}
        </span>
        <button
          type="button"
          className="l-thread__resolve"
          aria-pressed={resolved}
          onClick={() => {
            setResolved((r) => !r);
            onResolve?.(!resolved);
            feedback.play(resolved ? "tap" : "success");
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.6 8.2 7.2 9.8l3.2-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span key={String(resolved)}>{resolved ? "Resolved" : "Resolve"}</span>
        </button>
      </div>
      <div className="l-thread__fold">
        <div className="l-frame-card l-thread__card">
          {anchor && <blockquote className="l-thread__anchor">{anchor}</blockquote>}
          <ol className="l-thread__list">
            {comments.map((c, i) => (
              <li key={c.id} className="l-thread__item" data-reply={i > 0 || undefined} data-fresh={c.id === fresh || undefined}>
                <Avatar name={c.author} size={i > 0 ? 26 : 30} />
                <div className="l-thread__main">
                  <div className="l-thread__meta">
                    <b>{c.author}</b>
                    <time>{c.time}</time>
                  </div>
                  <div className="l-thread__body">{c.body}</div>
                  <div className="l-thread__reacts">
                    {Object.entries(c.reactions ?? {})
                      .filter(([, n]) => n > 0)
                      .map(([e, n]) => (
                        <button key={e} type="button" aria-pressed={c.mine?.includes(e)} onClick={() => react(c.id, e)} aria-label={`${e} ${n}`}>
                          {e} <span key={n}>{n}</span>
                        </button>
                      ))}
                    {["👍", "🎉"]
                      .filter((e) => !(c.reactions?.[e] ?? 0))
                      .slice(0, 1)
                      .map((e) => (
                        <button key={e} type="button" className="l-thread__add" onClick={() => react(c.id, e)} aria-label={`React ${e}`}>
                          +{e}
                        </button>
                      ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="l-thread__reply" onClick={() => field.current?.focus()}>
            <Avatar name={me} size={26} />
            <textarea
              ref={field}
              rows={1}
              placeholder="Reply…"
              aria-label="Reply"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="button" className="l-thread__send" disabled={!draft.trim()} onClick={send} aria-label="Send reply">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
