/*
  The Design face's chat: the session's real conversation (Timeline.tsx, the one Liner Code shows), at one of three sizes
  kept for the window (store.ts useChat). Minimised it is one row at the top of the composer's own tray: what the agent is
  doing now and the turn's clock, or the first line of its last reply. Open, the conversation sits in the same tray above
  the composer box, and scrolls inside it. Pinned, it is a column between the sidebar and the canvas with the composer at
  its foot, and the dock leaves the canvas. The composer is always Dock.tsx's.

  What the old head row said (who draws which frame, the sidekick's part) is said here: on the row, and in the open
  chat's header. A step's words are the trail's own (trailSteps), so a frame is called by its name on both.
*/
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { DesignFile, Item, Thread } from "@contracts";
import { useEngine, useItems, useItemsWhere } from "../engine";
import { isDockable } from "../Ask";
import { I } from "../icons";
import { agentOf } from "../model";
import { pairOf } from "../Crew";
import { FrameNames, isStep, liveOf, readableFrame, Tick, Timeline, trailSteps, type FrameNamer, type Mark } from "../Timeline";
import { design, getDesign, setChat, useChat, useDesign, type ChatSize } from "./store";
import "./chat.css";

type Tool = Extract<Item, { kind: "tool" }>;

/** A frame's name from its id (or its name), as the design file has it now. */
/**
  Only the open design file's frames are named here. A call names its design by slug or by title (as the engine's
  designFor takes either); one about another design gets no name from this one. A call that names none is taken for the
  open design only while the session works on one design (`many`: it has touched more than one).
*/
const nameIn = (file: DesignFile | undefined, id: string, design?: string, many = false) => {
  if (design ? design !== file?.id && design !== file?.title : many) return undefined;
  return file?.frames.find((f) => f.id === id || f.name === id)?.name;
};
const frameName: FrameNamer = (id, design) => nameIn(getDesign().file, id, design);
/**
  The same, as a value that changes when the design file's frames do: the timeline's turns draw again only when it changes,
  so steps written before the file came in (or before a frame joined it) take their names once it does.
*/
function useFrameNamer(threadId?: string): FrameNamer {
  const file = useDesign((s) => s.file);
  const items = useItems(threadId);
  // The first whole write of each frame's file in the session drew it; writes and edits after it change it. And which
  // design files the session has touched, by its frame files and its canvas calls' `design`.
  const { drew, many } = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();
    const designs = new Set<string>();
    for (const it of items) {
      if (it.kind !== "tool") continue;
      const named = /"design"\s*:\s*"([^"]+)"/.exec(it.input ?? "")?.[1];
      if (named) designs.add(named);
      const m = it.path ? /\.liner\/designs\/([^/]+)\/frames\/[^/]+\.html$/.exec(it.path.replace(/\\/g, "/")) : null;
      if (!m) continue;
      designs.add(m[1]);
      if (!seen.has(it.path!) && it.toolKind === "write") first.add(it.id);
      seen.add(it.path!);
    }
    // A design named by its title and by its slug is one design.
    const one = new Set([...designs].map((d) => (d === file?.title ? file.id : d)));
    return { drew: first, many: one.size > 1 };
  }, [items, file?.id, file?.title]);
  return useMemo(() => Object.assign((id: string, design?: string) => nameIn(file, id, design, many), { drew: (toolId: string) => drew.has(toolId), open: file?.id }), [file, drew, many]);
}

/** Its first line said plainly: no list marks, headings, code ticks or bold. */
const firstLine = (s?: string) =>
  s
    ?.split("\n")
    .map((x) => x.replace(/^[#>*\-\s]+/, "").replace(/`|\*\*|__/g, "").trim())
    .find(Boolean);

/*
  The last reply each session's chat has shown you, for the window, so the row can say a reply came while it was small.
  A session seen for the first time counts as read up to where it is.
*/
const SEEN_KEY = "liner.design-chat-seen";
const seenReplies: Record<string, string> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
})();
function markSeen(threadId: string, itemId: string) {
  if (seenReplies[threadId] === itemId) return;
  seenReplies[threadId] = itemId;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seenReplies));
  } catch {
    // a window without storage forgets on reload
  }
}

/** The newest turn's items and marks, and its last reply. */
function lastTurnOf(items: Item[]) {
  let n = -1;
  for (const it of items) if (it.kind === "turn" && it.turn > n) n = it.turn;
  const list = n < 0 ? [] : items.filter((x) => x.turn === n);
  const marks = list.filter((x): x is Mark => x.kind === "turn");
  const reply = items.findLast((x): x is Extract<Item, { kind: "text" }> => x.kind === "text" && Boolean(x.text.trim()));
  return { list, marks, reply };
}

/**
  What the session is doing now, in words: the step under way as the trail names it ("Reading Phone / Today"), else
  "Drawing <frame>" while its outline is on one, else the status line's word. Who draws and the sidekick's part, from
  the canvas's presence.
*/
function useNow(thread: Thread, items: Item[]) {
  const presence = useDesign((s) => s.presence);
  // Read so the row draws again when a frame joins the file; its names and what drew a frame.
  const namer = useFrameNamer(thread.id);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const running = thread.status === "running" || thread.status === "waiting";
  const { list, marks, reply } = useMemo(() => lastTurnOf(items), [items]);
  const ps = Object.entries(presence);
  const lead = ps.find(([, p]) => p.lead);
  const side = ps.find(([, p]) => !p.lead);
  const who = pairOf(thread, agents, providers)?.lead ?? agentOf(thread.agent, agents, providers).name;
  const live = running && marks.length ? liveOf(marks, list) : undefined;
  const step = running ? list.findLast((x): x is Tool => x.kind === "tool" && x.status === "running" && isStep(x)) : undefined;
  const named = step ? trailSteps([step], undefined, namer)[0] : undefined;
  const leadFrame = lead ? (frameName(lead[0]) ?? readableFrame(lead[0])) : undefined;
  const words = live?.waiting ? live.word : named ? [named.verb, named.target].filter(Boolean).join(" ") : leadFrame ? `Drawing ${leadFrame}` : (live?.word ?? "Working");
  const sideWords = side ? `${side[1].name}${side[1].label && side[1].label !== side[1].name ? `, ${side[1].label}` : ""} on ${frameName(side[0]) ?? readableFrame(side[0])}` : undefined;
  // The header's longer line: who is drawing which frame, as the old head row said it.
  // The step's own verb when one is under way ("is changing Phone / Today" in a fix), so the header and the row agree.
  const lower = (w: string) => `${w.charAt(0).toLowerCase()}${w.slice(1)}`;
  const doing = named && /ing\b/.test(named.verb.split(" ")[0]) ? `${lower(named.verb)}${named.target ? ` ${named.target}` : ""}` : undefined;
  const header = !running ? undefined : doing && !live?.waiting ? `${lead?.[1].name || who} is ${doing}` : leadFrame && !live?.waiting ? `${lead![1].name || who} is drawing ${leadFrame}` : `${who}: ${lower(words)}`;
  return { running, live, words, sideWords, header, reply };
}

/**
  The buttons every size shares: pin (pressed while the chat is pinned, even when a narrow window shows it open for now) and
  the way back to Liner Code.
*/
function Pin() {
  const pinned = useChat() === "pinned";
  return (
    // A press with the pointer leaves the focus where it was (in the composer, say), so the move gives it back there.
    <button type="button" className="lc-tb l-focus" onMouseDown={(e) => e.preventDefault()} aria-pressed={pinned} aria-label={pinned ? "Unpin the chat" : "Pin the chat beside the canvas"} title={pinned ? "Unpin the chat" : "Pin the chat beside the canvas"} onClick={(e) => {
        // Pressed from the keyboard, the focus goes on to the pin button in the chat's new place (the column's isn't in a host, so nothing else gives it back).
        const keys = document.activeElement === e.currentTarget;
        setChat(pinned ? "open" : "pinned");
        if (keys) requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-label='Unpin the chat'], [aria-label='Pin the chat beside the canvas']")?.focus({ preventScroll: true }));
      }}>
      <I.sidebar size={15} />
    </button>
  );
}
function OpenInCode() {
  return (
    <button type="button" className="ld-lk l-focus" onClick={() => design.setFace("code")}>
      Open in Liner Code
      <I.external size={13} />
    </button>
  );
}

/**
  Minimised: one row at the top of the composer's tray. Working: the lead's dot, what it does now, the sidekick's part and
  the clock. Done: the first line of its last reply, with a dot until the chat has shown it. No row before there is any.
*/
export function ChatMin({ thread }: { thread: Thread }) {
  const items = useItems(thread.id);
  const now = useNow(thread, items);
  const reply = now.reply;
  // Met for the first time (its timeline in), a session is read up to where it is: a dot only for a reply that comes while
  // you're here. One met mid-turn has read nothing of the reply under way.
  useEffect(() => {
    if (items.length && !(thread.id in seenReplies)) markSeen(thread.id, now.running ? "" : (reply?.id ?? ""));
  }, [thread.id, items.length > 0]);
  if (!items.length) return null;
  const unread = !now.running && Boolean(reply) && seenReplies[thread.id] !== reply!.id;
  const line = firstLine(reply?.text);
  if (!now.running && !line) return null;
  const open = () => {
    // From the keyboard on the row, the focus goes on to the open chat (the row goes away): ChatOpen picks it up.
    fromRow = Boolean(document.activeElement?.closest(".ldc-min"));
    setChat("open");
  };
  return (
    <div className="ldc-min" data-running={now.running || undefined} data-unread={unread || undefined}>
      <button type="button" className="ldc-min-t l-focus" onClick={open} title="Open the chat">
        {now.running ? <span className="ld-pd" data-lead aria-hidden /> : unread ? <span className="ldc-dot" aria-hidden /> : null}
        <span className="ldc-min-w">{now.running ? now.words : line}</span>
        {now.running && now.sideWords && <span className="ldc-q ldc-side">{now.sideWords}</span>}
      </button>
      {now.running && now.live && (
        <span className="ldc-q l-num" data-wait={now.live.waiting || undefined}>
          <Tick text={now.live.clock} />
        </span>
      )}
      <span className="ldc-v" aria-hidden />
      <button type="button" className="lc-tb l-focus" aria-label="Open the chat" title="Open the chat" onClick={open}>
        <I.chevU size={15} />
      </button>
      <Pin />
    </div>
  );
}

const NONE = new Set<string>();

/**
  The conversation itself: the real timeline, scrolled to its end and kept there while you're at the end. What was in it
  when it opened draws at once; what comes after comes in as it does in Liner Code. An ask waits at the composer (docked).
*/
export function ChatBody({ thread, visible = true }: { thread: Thread; visible?: boolean }) {
  const items = useItems(thread.id);
  const names = useFrameNamer(thread.id);
  // What was there when the chat opened (or when the timeline came in, for a chat open from the start) draws at once.
  const seen = useRef<Set<string> | null>(null);
  if (!seen.current && items.length) seen.current = new Set(items.map((x) => x.id));
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  // Where you were, for when the box comes back from a move (a pin or an unpin puts its node elsewhere, which scrolls it to the top).
  const at = useRef(0);
  const toEnd = useCallback(() => {
    const el = box.current;
    if (!el || !el.clientHeight) return;
    if (stuck.current) el.scrollTop = el.scrollHeight;
    else if (Math.abs(el.scrollTop - at.current) > 1) el.scrollTop = at.current;
  }, []);
  useLayoutEffect(toEnd, [items, toEnd]);
  // A reply that streams, a trail that opens: it grows without new items. The box itself changes height with the canvas.
  useEffect(() => {
    const ro = new ResizeObserver(toEnd);
    for (const el of [inner.current, box.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [toEnd]);
  // Shown here, the last reply is read.
  const reply = useMemo(() => lastTurnOf(items).reply, [items]);
  // Kept drawn while the chat is small (so a note in a plan or an open fold stays), it reads nothing for you then.
  useEffect(() => {
    if (reply && visible) markSeen(thread.id, reply.id);
  }, [reply?.id, thread.id, visible]);
  return (
    <div
      ref={box}
      className="ldc-body"
      onScroll={(e) => {
        const el = e.currentTarget;
        // A box out of the page, or just put back, says nothing about where you read.
        if (!el.isConnected || !el.clientHeight) return;
        at.current = el.scrollTop;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      <div ref={inner} className="ldc-in">
        {items.length ? (
          <FrameNames.Provider value={names}>
            <Timeline threadId={thread.id} items={items} docked seen={seen.current ?? NONE} onReview={() => design.setFace("code")} onGrow={toEnd} />
          </FrameNames.Provider>
        ) : (
          <p className="ldc-empty">Nothing said yet. Say what to draw below.</p>
        )}
      </div>
    </div>
  );
}

/*
  One composer and one conversation per design tab, whatever the size: Dock.tsx renders them once, into two hosts that
  never move in React's tree, and each place the chat can be (the floating dock, the open chat, the column) holds a Slot the
  host is put into. Pinning or unpinning moves the hosts' nodes, so the draft, an open fold, the scroll and an ask's own
  state stay as they were, and the canvas is never drawn anew. `size` is the size shown, which a narrow window can make
  open while the size kept is pinned (useShownSize).
*/
export type Hosts = { composer: HTMLDivElement; body: HTMLDivElement; size: ChatSize; /** Make the chat small: kept as min, or, shown open for something waiting on you, only for now. */ minimise: () => void };
export const DockHosts = createContext<Hosts | null>(null);
export function useHosts(): Omit<Hosts, "size" | "minimise"> {
  const hosts = useMemo(() => {
    const composer = document.createElement("div");
    const body = document.createElement("div");
    composer.className = "ldc-host";
    body.className = "ldc-host";
    return { composer, body };
  }, []);
  return hosts;
}
/*
  A node taken out of the page loses the focus and a field's caret. What a host held is noted before it moves (by the slot
  it leaves, or by the one it goes to when that comes first) and given back after: the focus to the same element, or to the
  pin button when that element went with the old place; each field its caret, focused or not.
*/
type Held = { focus: HTMLElement | null; fields: [HTMLTextAreaElement | HTMLInputElement, number, number, string][] };
const held = new WeakMap<HTMLElement, Held>();
function note(host: HTMLElement) {
  if (!host.isConnected) return;
  const a = document.activeElement;
  const fields = [...host.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea, input:is(:not([type]), [type='text'], [type='search'])")].map((f): Held["fields"][number] => [f, f.selectionStart ?? 0, f.selectionEnd ?? 0, f.selectionDirection ?? "none"]);
  held.set(host, { focus: a instanceof HTMLElement && host.contains(a) ? a : null, fields });
}
function giveBack(host: HTMLElement) {
  const h = held.get(host);
  held.delete(host);
  if (!h) return;
  const put = ([f, start, end, dir]: Held["fields"][number]) => {
    try {
      if (f.isConnected) f.setSelectionRange(start, end, dir as "forward" | "backward" | "none");
    } catch {
      // a field that takes no caret keeps none
    }
  };
  h.fields.forEach(put);
  if (!h.focus) return;
  const to = h.focus.isConnected ? h.focus : document.querySelector<HTMLElement>("[aria-label='Unpin the chat'], [aria-label='Pin the chat beside the canvas']");
  to?.focus({ preventScroll: true });
  // Focusing a field can put its caret at the end: the noted one stands.
  const f = h.fields.find(([x]) => x === to);
  if (f) put(f);
}
/** A place a host goes: it holds it while it is drawn. */
function Slot({ host, className, style }: { host: HTMLElement; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (host.parentNode !== el) note(host);
    el.appendChild(host);
    giveBack(host);
    return () => {
      if (host.parentNode !== el) return;
      note(host);
      el.removeChild(host);
    };
  }, [host]);
  return <div ref={ref} className={className} style={style} />;
}

/** Something waiting on you that the composer doesn't hold (a plan, a question, an add-on's card, the PR card's tests): it is in the conversation. */
const isUndocked = (it: Item) => ((it.kind === "question" || it.kind === "proposal") && it.state === "asking") || (it.kind === "approval" && it.state === "asking" && !isDockable(it));

/*
  The size shown. Something waiting on you that isn't docked at the composer shows a small chat open, the size kept
  staying min: answered, it folds back by itself, unless you changed the size meanwhile; made small while it waits, it
  stays small for that one. Pinned, the column takes 312px of the canvas's row: when the canvas would be left narrower than about
  420px the chat shows open, floating, and the size kept stays pinned; it goes back to the column once there are 460px. The
  row's width doesn't depend on the column (it is inside it), so the two lines can't chase each other.
*/
const COLUMN = 312;
export function useShownSize(row: RefObject<HTMLElement | null>, threadId?: string): { size: ChatSize; minimise: () => void } {
  const kept = useChat();
  const [narrow, setNarrow] = useState(false);
  const waiting = useItemsWhere(threadId, isUndocked).map((x) => x.id);
  const [letGo, setLetGo] = useState<string[]>([]);
  const forced = kept === "min" && waiting.some((id) => !letGo.includes(id));
  const key = waiting.join();
  // One press always makes it small: what waits now is let go and the size kept is min. The focus goes to the row's open button.
  const minimise = useCallback(() => {
    if (key) setLetGo((l) => [...l, ...key.split(",")]);
    setChat("min");
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".ldc-min [aria-label='Open the chat']")?.focus({ preventScroll: true }));
  }, [key]);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || kept !== "pinned") return void setNarrow(false);
    const look = () => {
      const left = el.clientWidth - COLUMN;
      setNarrow((was) => (was ? left < 460 : left < 420));
    };
    const ro = new ResizeObserver(look);
    ro.observe(el);
    look();
    return () => ro.disconnect();
  }, [kept, row]);
  return { size: forced || (kept === "pinned" && narrow) ? "open" : kept, minimise };
}

/** Set by the small row as it opens the chat with the focus on it. */
let fromRow = false;

/** Open: in the composer's tray above its box, as wide as it, at most about half the canvas tall. */
export function ChatOpen({ thread }: { thread: Thread }) {
  const items = useItems(thread.id);
  const now = useNow(thread, items);
  const hosts = useContext(DockHosts);
  // Focus comes here when the chat opens from the small row by the keyboard (its button goes with the row).
  const mini = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (fromRow && (document.activeElement === document.body || !document.activeElement)) mini.current?.focus({ preventScroll: true });
    fromRow = false;
  }, []);
  return (
    <div className="ldc-open" role="region" aria-label="Chat">
      <div className="ldc-h">
        <b>Chat</b>
        {now.header && (
          <span className="ldc-q ldc-status">
            {now.header}
            {now.sideWords ? `; ${now.sideWords}` : ""}
          </span>
        )}
        <span className="lc-grow" />
        <button ref={mini} type="button" className="lc-tb l-focus" aria-label="Make the chat small" title="Make the chat small" onClick={() => (hosts ? hosts.minimise() : setChat("min"))}>
          <I.chevD size={15} />
        </button>
        <Pin />
        <OpenInCode />
      </div>
      {hosts && <Slot host={hosts.body} className="ldc-slot" />}
    </div>
  );
}

/** Pinned: a column beside the canvas, the conversation filling it and the composer at its foot. */
export function ChatColumn({ thread }: { thread?: Thread }) {
  const hosts = useContext(DockHosts);
  return (
    <aside className="ldc-col" aria-label="Chat">
      <div className="ldc-h">
        <b>Chat</b>
        <span className="lc-grow" />
        <Pin />
        <button type="button" className="lc-tb l-focus" aria-label="Open in Liner Code" title="Open in Liner Code" onClick={() => design.setFace("code")}>
          <I.external size={15} />
        </button>
      </div>
      {thread && hosts ? <Slot host={hosts.body} className="ldc-slot ldc-grow" /> : <p className="ldc-empty ldc-grow">Nothing said yet. Say what to draw below.</p>}
      <div className="ldc-foot">
        <div className="ld-dock" data-place="column">
          {hosts && <Slot host={hosts.composer} className="ldc-slot" />}
        </div>
      </div>
    </aside>
  );
}

/*
  The dock on the canvas, for min and open: the composer's place at the foot of the canvas. It never reaches past the
  canvas's top: what it holds gives way in order. The conversation first, down to 80px (and never over 46% of the canvas);
  then the queue, down to a row (it scrolls); the tray's rows and the composer's box keep their height. The dock's inner
  box is measured, not the dock (which a cap would hide the overflow of), and what is sized is left out of what it is
  sized against, so nothing chases itself. The sizes go on the dock as --ldc-body-max and --ldc-queue-max (chat.css).
*/
const BODY_MIN = 80;
const QUEUE_MAX = 168;
const QUEUE_MIN = 64;
function useDockFit(dock: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = dock.current;
    const inner = el?.firstElementChild as HTMLElement | null;
    const cv = el?.closest(".ld-cv") as HTMLElement | null;
    if (!el || !inner || !cv) return;
    let last = "";
    const fit = () => {
      const limit = cv.clientHeight - 16;
      const slot = el.querySelector<HTMLElement>(".ldc-open .ldc-slot");
      const body = slot?.querySelector<HTMLElement>(".ldc-body");
      const queue = el.querySelector<HTMLElement>(".lc-tray > .lc-queued");
      const slotH = slot?.getBoundingClientRect().height ?? 0;
      const queueH = queue?.getBoundingClientRect().height ?? 0;
      const other = inner.getBoundingClientRect().height - slotH - queueH;
      const queueWant = queue ? Math.min(queue.scrollHeight, QUEUE_MAX) : 0;
      const bodyMax = Math.round(Math.max(BODY_MIN, Math.min(cv.clientHeight * 0.46, limit - other - queueWant)));
      const bodyUsed = slot ? Math.min(body?.scrollHeight ?? slotH, bodyMax) : 0;
      const queueMax = Math.round(Math.max(QUEUE_MIN, Math.min(QUEUE_MAX, limit - other - bodyUsed)));
      const next = `${bodyMax}|${queueMax}`;
      if (next === last) return;
      last = next;
      el.style.setProperty("--ldc-body-max", `${bodyMax}px`);
      el.style.setProperty("--ldc-queue-max", `${queueMax}px`);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    ro.observe(inner);
    // A queue or a conversation that grows inside its cap changes no box the observer sees: watch what is put in.
    let soon = 0;
    const mo = new MutationObserver(() => void (soon ||= requestAnimationFrame(() => ((soon = 0), fit()))));
    mo.observe(inner, { childList: true, subtree: true });
    fit();
    return () => (ro.disconnect(), mo.disconnect(), cancelAnimationFrame(soon));
  }, [dock]);
}

/** The dock on the canvas, for min and open: the composer's place at the foot of the canvas. */
export function DockFloat() {
  const hosts = useContext(DockHosts);
  const ref = useRef<HTMLDivElement>(null);
  useDockFit(ref);
  if (!hosts) return null;
  return (
    <div ref={ref} className="ld-dock" data-chat={hosts.size}>
      <div className="ld-dock-in">
        <Slot host={hosts.composer} className="ldc-slot" />
      </div>
    </div>
  );
}
