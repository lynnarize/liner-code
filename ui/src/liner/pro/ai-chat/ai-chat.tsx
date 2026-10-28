/*
  Liner Pro · AI chat
  A whole assistant in one card. Replies run on an event stream (reasoning, tools,
  sources, text deltas, errors) that the reveal clock paces, so any model's chunk
  sizes read the same. The thread follows new lines on a soft lerp until you scroll
  away, then offers a way back.
*/
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback as sound } from "../../lib/feedback";
import { prefersReducedMotion } from "../../lib/spring";
import { CopyButton } from "../../components/copy-button/copy-button";
import { Reasoning } from "../../components/reasoning/reasoning";
import { Composer } from "../composer/composer";
import { CiteScope, type Source } from "../ai-kit/cite";
import { SourceMark, type AiPhase } from "../ai-kit/marks";
import { UnblurText } from "../../components/unblur-text/unblur-text";
import { AiActions, AiMenu, AiWho, SourceCards, type AiVote } from "../ai-kit/surface";
import { StreamedMarkdown } from "../ai-kit/streamed";
import { toPlain } from "../ai-kit/markdown";
import { sampleModels, sampleSuggestions, simulatedRespond, type ChatModel, type ChatRespond, type ChatSuggestion, type ChatTool } from "./sample";

type AskOptions = { search?: boolean; think?: boolean; effort?: "low" | "medium" | "high" };
import "../ai-kit/ai-kit.css";
import "./ai-chat.css";

export type { ChatModel, ChatRespond, ChatSuggestion, ChatTool };

type Status = "thinking" | "streaming" | "done" | "stopped" | "error";
type Version = {
  reasoning: string[];
  thoughtFor?: number;
  tools: ChatTool[];
  sources: Source[];
  text: string;
  status: Status;
  error?: string;
  feedback: AiVote;
  /** Seconds the reply took, formatted. */
  took?: string;
  /** Revealed to the end: actions may appear. */
  shown: boolean;
  /** Stream it in. History and paged versions show at once. */
  animate: boolean;
};
type Turn = { id: number; role: "user"; text: string } | { id: number; role: "assistant"; model: ChatModel; versions: Version[]; active: number };
type Chat = { id: string; title: string; group: string; turns: Turn[] };

export type AiChatProps = {
  respond?: ChatRespond;
  models?: ChatModel[];
  suggestions?: ChatSuggestion[];
  greeting?: string;
  onFeedback?: (value: AiVote, text: string, reason?: string) => void;
  feedbackReasons?: string[];
  /** Projects for the strip under the composer. */
  projects?: string[];
  /** Show the asks-first switch in the strip. */
  access?: boolean;
  className?: string;
};

let seq = 1;
const emptyVersion = (): Version => ({ reasoning: [], tools: [], sources: [], text: "", status: "thinking", feedback: null, shown: false, animate: true });

const historyChats = (models: ChatModel[]): Chat[] => [
  {
    id: "h1",
    title: "Contrast check for the blue accent",
    group: "Earlier",
    turns: [
      { id: seq++, role: "user", text: "Is the blue accent readable as text on white?" },
      {
        id: seq++,
        role: "assistant",
        model: models[0],
        active: 0,
        versions: [
          {
            ...emptyVersion(),
            reasoning: ["Checking the contrast ratio"],
            thoughtFor: 2,
            status: "done",
            shown: true,
            animate: false,
            text: "Yes for labels and links. The accent on white lands near **4.6:1**, just over the 4.5:1 body text needs.\n\nFor small text in light mode, use **--l-accent-text**, which mixes the accent a little toward ink and keeps it comfortably readable.",
          },
        ],
      },
    ],
  },
];

const Icons: Record<string, ReactNode> = {
  launch: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M9.6 2.5c2.2.2 3.7 1.7 3.9 3.9L8.9 11 5 7.1l4.6-4.6ZM5 7.1 3 7.4l-1 2 3.1.5M8.9 11l-.3 2-2 1-.5-3.1M10.4 5.6h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.75 13.25h10.5M4.5 10.5V8M7.25 10.5V5M10 10.5V7M12.75 10.5V3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  pen: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m10.4 2.9 2.7 2.7-7.5 7.5H2.9v-2.7l7.5-7.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
};

export function AiChat({
  respond = simulatedRespond,
  models = sampleModels,
  suggestions = sampleSuggestions,
  greeting = "What are we working on?",
  onFeedback,
  feedbackReasons = ["Not accurate", "Wrong source", "Too long", "Out of date"],
  projects = ["Liner UI", "Launch week", "Personal"],
  access = true,
  className,
}: AiChatProps) {
  const [chats, setChats] = useState<Chat[]>(() => [{ id: "c0", title: "New chat", group: "Today", turns: [] }, ...historyChats(models)]);
  const [current, setCurrent] = useState("c0");
  const [model, setModel] = useState(models[0]);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const doneRef = useRef<(() => void) | null>(null);
  const threadRef = useRef<ThreadHandle | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<AskOptions>({});
  const effortRef = useRef(models[0].effort ?? "medium");
  const flipFrom = useRef<number | null>(null);
  const chat = chats.find((c) => c.id === current)!;
  const empty = chat.turns.length === 0;

  // Once there is a thread, the composer floats over it as glass; the thread keeps room
  // for it under the last reply, measured so attachments or a taller draft never cover text.
  useIsoLayoutEffect(() => {
    const dock = dockRef.current;
    const root = rootRef.current;
    if (!dock || !root) return;
    const ro = new ResizeObserver(() => root.style.setProperty("--dock-h", `${dock.offsetHeight}px`));
    ro.observe(dock);
    return () => ro.disconnect();
  }, []);

  // A new chat holds the composer in the middle under the greeting. The first message
  // sends it gliding to the bottom (and a new chat brings it back) on the smooth spring.
  const markFlip = () => {
    flipFrom.current = dockRef.current?.getBoundingClientRect().top ?? null;
  };
  useIsoLayoutEffect(() => {
    const el = dockRef.current;
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!el || from === null || prefersReducedMotion()) return;
    const dy = from - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 2) return;
    const css = getComputedStyle(el);
    el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], {
      duration: parseFloat(css.getPropertyValue("--l-dur-spring")) || 730,
      easing: css.getPropertyValue("--l-spring-smooth").trim() || "ease-out",
    });
  }, [empty]);

  const patchChat = useCallback((id: string, fn: (c: Chat) => Chat) => setChats((list) => list.map((c) => (c.id === id ? fn(c) : c))), []);
  const patchVersion = useCallback(
    (chatId: string, turnId: number, fn: (v: Version) => Version) =>
      patchChat(chatId, (c) => ({
        ...c,
        turns: c.turns.map((t) => (t.id === turnId && t.role === "assistant" ? { ...t, versions: t.versions.map((v, i) => (i === t.active ? fn(v) : v)) } : t)),
      })),
    [patchChat],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Runs one reply into the active version of an assistant turn. Resolves once it has fully shown. */
  async function run(chatId: string, turnId: number, history: Turn[], options: AskOptions = {}) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setAnnounce("Reply started");
    const messages = history.map((t) => (t.role === "user" ? { role: "user" as const, content: t.text } : { role: "assistant" as const, content: t.versions[t.active].text }));
    const settled = new Promise<void>((res) => (doneRef.current = res));
    const t0 = performance.now();
    let failed = false;
    try {
      for await (const ev of respond(messages, { signal: ctrl.signal, model, effort: effortRef.current, ...options })) {
        if (ctrl.signal.aborted) break;
        if (ev.type === "error") failed = true;
        patchVersion(chatId, turnId, (v) => {
          switch (ev.type) {
            case "reasoning":
              return { ...v, reasoning: [...v.reasoning, ev.step] };
            case "reasoning-end":
              return { ...v, thoughtFor: ev.seconds, status: "streaming" };
            case "tool": {
              const has = v.tools.some((t) => t.id === ev.tool.id);
              return { ...v, status: "streaming", tools: has ? v.tools.map((t) => (t.id === ev.tool.id ? ev.tool : t)) : [...v.tools, ev.tool] };
            }
            case "sources":
              return { ...v, sources: ev.sources };
            case "text":
              return { ...v, status: "streaming", text: v.text + ev.delta };
            case "error":
              return { ...v, status: "error", error: ev.message, shown: true };
          }
        });
      }
      if (failed) {
        setAnnounce("Reply failed");
        doneRef.current?.();
      } else {
        patchVersion(chatId, turnId, (v) => ({ ...v, status: "done", took: ((performance.now() - t0) / 1000).toFixed(1) }));
        setAnnounce("Reply finished");
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        patchVersion(chatId, turnId, (v) => ({ ...v, status: "stopped", shown: true }));
        setAnnounce("Reply stopped");
        doneRef.current?.();
      } else {
        patchVersion(chatId, turnId, (v) => ({ ...v, status: "error", error: (e as Error).message, shown: true }));
        setAnnounce("Reply failed");
        doneRef.current?.();
      }
    }
    await settled;
    setBusy(false);
  }

  function ask(text: string, options?: AskOptions) {
    const prompt = text.trim();
    if (!prompt || busy) return Promise.resolve();
    if (empty) markFlip();
    const userTurn: Turn = { id: seq++, role: "user", text: prompt };
    const replyTurn: Turn = { id: seq++, role: "assistant", model, versions: [emptyVersion()], active: 0 };
    const history = [...chat.turns, userTurn];
    patchChat(chat.id, (c) => ({ ...c, title: c.turns.length ? c.title : prompt.length > 34 ? `${prompt.slice(0, 33).trimEnd()}…` : prompt, turns: [...history, replyTurn] }));
    threadRef.current?.stick();
    sound.play("tap", 4);
    return run(chat.id, replyTurn.id, history, options);
  }

  function retry(turnId: number) {
    if (busy) return;
    const idx = chat.turns.findIndex((t) => t.id === turnId);
    const history = chat.turns.slice(0, idx);
    patchChat(chat.id, (c) => ({
      ...c,
      turns: c.turns.map((t) => (t.id === turnId && t.role === "assistant" ? { ...t, model, versions: [...t.versions, emptyVersion()], active: t.versions.length } : t)),
    }));
    threadRef.current?.stick();
    run(chat.id, turnId, history, toolsRef.current);
  }

  function stop() {
    abortRef.current?.abort();
    sound.play("tap", -2);
  }

  function newChat() {
    if (busy) stop();
    if (!empty) markFlip();
    const existing = chats.find((c) => !c.turns.length);
    if (existing) return setCurrent(existing.id);
    const id = `c${seq++}`;
    setChats((list) => [{ id, title: "New chat", group: "Today", turns: [] }, ...list]);
    setCurrent(id);
    setAnnounce("New chat");
  }

  return (
    <section
      ref={rootRef}
      className={cx("l-chat", className)}
      data-empty={empty || undefined}
      aria-label="AI chat"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented && busy) {
          e.preventDefault();
          stop();
        }
      }}
    >
      <header className="l-chat-bar">
        <TitleMenu
          chats={chats}
          current={chat}
          onPick={(id) => {
            if (busy) stop();
            threadRef.current?.save(current);
            setCurrent(id);
            setAnnounce(`Opened ${chats.find((c) => c.id === id)?.title}`);
          }}
          onNew={newChat}
        />
        <div className="l-chat-bar-end">
          <button type="button" className="l-chat-icon l-plate l-focus" aria-label="New chat" title="New chat" onClick={newChat}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M7.25 2.75H4.5A1.75 1.75 0 0 0 2.75 4.5v7a1.75 1.75 0 0 0 1.75 1.75h7a1.75 1.75 0 0 0 1.75-1.75V8.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="m11.9 2.6 1.5 1.5-5.6 5.6-2.1.6.6-2.1 5.6-5.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      <Thread
        key={chat.id}
        chatId={chat.id}
        live={busy}
        handle={threadRef}
        empty={
          <div className="l-chat-empty">
            {/* The greeting comes into focus word by word, right above the composer. */}
            <UnblurText key={chat.id} as="h3" text={greeting} inView={false} delay={80} className="l-chat-greeting" />
          </div>
        }
      >
        {chat.turns.map((t, i) =>
          t.role === "user" ? (
            <article key={t.id} className="l-chat-turn" data-role="user">
              <div className="l-chat-bubble">{t.text}</div>
              <div className="l-chat-user-actions">
                <CopyButton value={t.text} iconOnly size="sm" variant="ghost" />
              </div>
            </article>
          ) : (
            <AssistantTurn
              key={t.id}
              turn={t}
              last={i === chat.turns.length - 1}
              busy={busy}
              onGrow={() => busy && threadRef.current?.follow()}
              onShown={() => {
                patchVersion(chat.id, t.id, (v) => ({ ...v, shown: true }));
                doneRef.current?.();
              }}
              onRetry={() => retry(t.id)}
              onPage={(dir) => patchChat(chat.id, (c) => ({ ...c, turns: c.turns.map((x) => (x.id === t.id && x.role === "assistant" ? { ...x, active: x.active + dir, versions: x.versions.map((v) => ({ ...v, animate: false })) } : x)) }))}
              reasons={feedbackReasons}
              onFeedback={(value) => {
                patchVersion(chat.id, t.id, (v) => ({ ...v, feedback: value }));
                onFeedback?.(value, t.versions[t.active].text);
                setAnnounce(value === "up" ? "Marked as a good reply" : value === "down" ? "Marked as a bad reply" : "Rating cleared");
              }}
              onReason={(reason) => onFeedback?.("down", t.versions[t.active].text, reason)}
            />
          ),
        )}
      </Thread>

      <div className="l-chat-composer" ref={dockRef}>
        <Composer
          models={models.map((m) => ({ id: m.id, label: m.name, description: m.note, effort: m.effort }))}
          defaultModel={model.id}
          onModelChange={(m, effort) => {
            const next = models.find((x) => x.id === m.id) ?? model;
            setModel(next);
            effortRef.current = effort;
            setAnnounce(`Model ${next.name}, ${effort} effort`);
          }}
          projects={projects}
          access={access}
          busy={busy}
          maxLength={2000}
          hints={["Ask anything", "Type / for commands", "Type @ to add a file or doc", "Esc stops a reply"]}
          onSend={(m) => {
            const about = m.pasted.length ? "the text I pasted" : m.files.length ? m.files.map((f) => f.name).join(", ") : "";
            return ask(m.text || (about ? `Take a look at ${about}` : ""), { search: m.search, think: m.think, effort: m.effort });
          }}
          onStop={stop}
          onToolsChange={(t) => (toolsRef.current = t)}
        />
      </div>
      {empty && (
        <div className="l-chat-starters">
          {suggestions.slice(0, 3).map((s, i) => (
            <button key={s.label} type="button" className="l-chat-suggestion l-focus" style={{ animationDelay: `${160 + i * 70}ms` }} onClick={() => ask(s.prompt ?? s.label, toolsRef.current)}>
              <span className="l-chat-suggestion-icon">{Icons[s.icon]}</span>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <span className="l-sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </section>
  );
}

/* ---------------- Thread: stick to the bottom, softly ---------------- */

type ThreadHandle = { stick: () => void; follow: () => void; save: (id: string) => void };
const scrollMemory = new Map<string, number>();

function Thread({ chatId, live, handle, empty, children }: { chatId: string; live: boolean; handle: React.MutableRefObject<ThreadHandle | null>; empty: ReactNode; children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Only a live reply pulls the thread down; opening reasoning or a tool later must not.
  const liveRef = useRef(live);
  liveRef.current = live;
  const contentRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const raf = useRef(0);
  const [jump, setJump] = useState(false);

  const follow = useCallback(() => {
    const el = ref.current;
    if (!el || !stuck.current) return;
    cancelAnimationFrame(raf.current);
    if (prefersReducedMotion()) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // A soft lerp: new lines glide up instead of jumping a line at a time.
    const step = () => {
      const target = el.scrollHeight - el.clientHeight;
      const d = target - el.scrollTop;
      if (!stuck.current) return;
      if (Math.abs(d) < 1) {
        el.scrollTop = target;
        return;
      }
      const from = el.scrollTop;
      el.scrollTop += d * 0.18;
      // Content a fraction of a pixel taller than the box, or a step under one device pixel,
      // leaves scrollTop where it was. Land and stop, or this asks for a layout every frame forever.
      if (el.scrollTop === from) {
        el.scrollTop = target;
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  handle.current = {
    stick: () => {
      stuck.current = true;
      setJump(false);
      requestAnimationFrame(follow);
    },
    follow,
    save: (id) => ref.current && scrollMemory.set(id, ref.current.scrollTop),
  };

  // Each chat keeps its own scroll position; a fresh one starts at the bottom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = scrollMemory.get(chatId);
    el.scrollTop = saved ?? el.scrollHeight;
    stuck.current = saved === undefined || el.scrollHeight - el.clientHeight - el.scrollTop < 40;
    setJump(!stuck.current);
    return () => cancelAnimationFrame(raf.current);
  }, [chatId]);

  useIsoLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => liveRef.current && follow());
    ro.observe(el);
    return () => ro.disconnect();
  }, [follow]);

  return (
    <div className="l-chat-scroll-wrap">
      <div
        ref={ref}
        className="l-chat-scroll"
        onWheel={(e) => {
          if (e.deltaY < 0) {
            stuck.current = false;
            cancelAnimationFrame(raf.current);
          }
        }}
        onTouchMove={() => {
          stuck.current = false;
          cancelAnimationFrame(raf.current);
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const away = el.scrollHeight - el.clientHeight - el.scrollTop;
          if (away < 40) stuck.current = true;
          setJump(away > 120 && !stuck.current);
        }}
      >
        <div ref={contentRef} className="l-chat-thread">
          {children.length ? children : empty}
        </div>
      </div>
      <button
        type="button"
        className="l-chat-jump l-focus"
        data-show={jump || undefined}
        tabIndex={jump ? 0 : -1}
        aria-label="Jump to latest"
        onClick={() => {
          const el = ref.current!;
          stuck.current = true;
          setJump(false);
          el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3.25v9.5M4.1 8.9 8 12.8l3.9-3.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

/* ---------------- One assistant turn ---------------- */

function AssistantTurn({
  turn,
  last,
  busy,
  reasons,
  onGrow,
  onShown,
  onRetry,
  onPage,
  onFeedback,
  onReason,
}: {
  turn: Extract<Turn, { role: "assistant" }>;
  last: boolean;
  busy: boolean;
  reasons: string[];
  onGrow: () => void;
  onShown: () => void;
  onRetry: () => void;
  onPage: (dir: 1 | -1) => void;
  onFeedback: (v: AiVote) => void;
  onReason: (reason: string) => void;
}) {
  const v = turn.versions[turn.active];
  const phase: AiPhase = v.status === "thinking" ? "thinking" : v.status === "streaming" ? "writing" : v.status === "stopped" ? "stopped" : v.status === "error" ? "error" : "done";
  const working = v.status === "thinking" || v.status === "streaming";
  return (
    <article className="l-chat-turn" data-role="assistant" data-last={last || undefined} aria-busy={working || undefined}>
      {/* Tools, sources and text share one citation scope, so a source card lights its sentence. */}
      <CiteScope sources={v.sources} className="l-chat-reply" key={turn.active}>
        <div className="l-chat-reply-in" data-paged={!v.animate || undefined}>
          <AiWho working={working} phase={phase} model={turn.model} status={v.status === "error" ? "Couldn't reply" : undefined}>
            {v.reasoning.length > 0 || v.status === "thinking" ? (
              <Reasoning
                steps={v.reasoning.map((label, i) => ({ id: String(i), label }))}
                running={v.status === "thinking"}
                defaultOpen={false}
                collapseOnDone
                doneLabel={(s) => `Thought for ${v.thoughtFor ?? Math.max(1, s)}s`}
                finalLabel="Ready to answer"
              />
            ) : undefined}
          </AiWho>

          {v.tools.length > 0 && (
            <div className="l-chat-tools">
              {v.tools.map((t) => (
                <ToolChip key={t.id} tool={t} cited={v.sources} />
              ))}
            </div>
          )}

          {v.text && (
            <StreamedMarkdown
              text={v.text}
              streaming={v.status === "streaming" || v.status === "thinking"}
              paused={v.status === "stopped"}
              animate={v.animate}
              speed={100}
              sentences
              onGrow={onGrow}
              onCaughtUp={() => {
                if (v.status === "done") onShown();
              }}
            />
          )}
          {v.status === "done" && !v.shown && !v.text && <ShownNow onShown={onShown} />}

          {v.status === "error" && (
            <div className="l-chat-error" role="alert">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 4.9v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="8" cy="10.9" r=".95" fill="currentColor" />
              </svg>
              <span>
                <b>Reply failed.</b> {v.error}
              </span>
              <button type="button" className="l-chat-retry l-focus" onClick={onRetry} disabled={busy}>
                Retry
              </button>
            </div>
          )}
        </div>
      </CiteScope>

      <div className="l-chat-actions" data-hidden={!v.shown || working || v.status === "error" || undefined}>
        <AiActions
          className="l-chat-hover"
          copy={() => toPlain(v.text, v.sources)}
          onRegenerate={onRetry}
          busy={busy}
          vote={v.feedback}
          onVote={onFeedback}
          reasons={reasons}
          onReason={onReason}
          versions={{ index: turn.active, count: turn.versions.length, onPage }}
          took={v.took}
          stopped={v.status === "stopped"}
        />
      </div>
    </article>
  );
}

function ShownNow({ onShown }: { onShown: () => void }) {
  useEffect(() => {
    onShown();
  }, []);
  return null;
}

/* ---------------- Tool chips ---------------- */

function ToolChip({ tool, cited }: { tool: ChatTool; cited: Source[] }) {
  const [open, setOpen] = useState(false);
  const running = tool.status === "running";
  const detailRef = useRef<HTMLDivElement>(null);
  return (
    <div className="l-chat-tool" data-open={open || undefined}>
      <button type="button" className="l-chat-chip l-focus" data-status={tool.status} aria-expanded={open} disabled={running} onClick={() => setOpen((o) => !o)}>
        <span className="l-chat-chip-icon" aria-hidden>
          {running ? (
            <svg viewBox="0 0 16 16" fill="none" className="l-chat-spin">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.6" />
              <path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : tool.kind === "search" ? (
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="7.2" cy="7.2" r="4.6" stroke="currentColor" strokeWidth="1.5" />
              <path d="m10.6 10.6 2.9 2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="none">
              <ellipse cx="8" cy="4" rx="5" ry="1.9" stroke="currentColor" strokeWidth="1.4" />
              <path d="M3 4v8c0 1.05 2.24 1.9 5 1.9s5-.85 5-1.9V4M3 8c0 1.05 2.24 1.9 5 1.9s5-.85 5-1.9" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          )}
        </span>
        <span key={tool.status} className={running ? "l-chat-chip-label l-shimmer" : "l-chat-chip-label l-swap"}>
          {tool.label}
        </span>
        {!running && tool.sources && (
          <span className="l-chat-chip-marks" aria-hidden>
            {tool.sources.slice(0, 3).map((s) => (
              <SourceMark key={s.title} name={s.name} hue={s.hue} size={13} />
            ))}
          </span>
        )}
        {!running && tool.summary && <span className="l-chat-chip-sum l-swap">{tool.summary}</span>}
        {!running && (
          <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-chat-chip-chev">
            <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <div className="l-chat-detail" data-open={open || undefined} aria-hidden={!open} inert={!open}>
        <div ref={detailRef}>
          <div className="l-chat-detail-in">
            {tool.sources ? (
              open && <SourceCards sources={tool.sources} ids={tool.sources.map((s) => cited.findIndex((c) => c.title === s.title) + 1)} stagger={60} />
            ) : (
              <>
                <pre className="l-chat-query">{tool.input}</pre>
                {tool.output && (
                  <div className="l-chat-output">
                    Result <code className="l-num">{tool.output}</code>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Chats: the shared glass menu ---------------- */

function TitleMenu({ chats, current, onPick, onNew }: { chats: Chat[]; current: Chat; onPick: (id: string) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const items = [
    {
      id: "new",
      label: "New chat",
      icon: (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    ...chats.filter((c) => c.turns.length).map((c) => ({ id: c.id, label: c.title, note: c.group, checked: c.id === current.id })),
  ];
  return (
    <div className="l-chat-title-wrap">
      <button ref={ref} type="button" className="l-chat-title l-focus" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span key={current.title} className="l-swap l-chat-title-text">
          {current.title}
        </span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-chat-chev">
          <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <AiMenu
          label="Chats"
          place="start"
          below
          anchor={ref}
          items={items}
          onClose={() => setOpen(false)}
          onPick={(it) => {
            setOpen(false);
            ref.current?.focus({ preventScroll: true });
            if (it.id === "new") onNew();
            else onPick(it.id);
          }}
        />
      )}
    </div>
  );
}
