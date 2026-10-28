/*
  Liner Pro · Reply bar
  The line you answer an agent on, at the foot of a running session. It is a frame, like
  every container: replies the agent expects on the glass above, the white card you write
  in, and the run's settings on the glass below.

  - The field starts as one line and eases taller as you write, up to six; the newest line
    stays put and the earlier ones rise into view.
  - Suggested replies come into focus above the card and step aside once you start writing.
    A press sends one.
  - Files come from the clip, a paste or a drop, and sit as chips in the card.
  - The strip holds model, effort and access. Each opens a glass menu over it, its label
    comes into focus when it changes, and its width springs to the new label.
  - Send lifts its arrow in once there is something to send and turns into stop while the
    agent answers; Escape stops it. ↑ on an empty line brings your last reply back.
*/
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cx, useSize } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { AiMark, ModelMark } from "../ai-kit/marks";
import { AiMenu } from "../ai-kit/surface";
import "../ai-kit/ai-kit.css";
import "./reply-bar.css";

export type ReplyEffort = "low" | "medium" | "high";
export type ReplyAccess = "read" | "ask" | "full";
export type ReplyModel = { id: string; label: string; description: string };
export type ReplySettings = { model: ReplyModel; effort: ReplyEffort; access: ReplyAccess };
export type ReplyMessage = ReplySettings & { text: string; files: File[] };

export type ReplyBarProps = {
  /** Who you are answering, for the placeholder and labels: “Herald”. */
  to: string;
  /** The mark at the start of the line. The Liner AI mark by default, thinking while the agent answers. */
  icon?: ReactNode;
  placeholder?: string;
  /** Short replies the agent expects, offered above the card until you write. A press sends one. */
  suggestions?: string[];
  models?: ReplyModel[];
  defaultModel?: string;
  defaultEffort?: ReplyEffort;
  defaultAccess?: ReplyAccess;
  /** Show the strip of run settings under the card. */
  settings?: boolean;
  onSettingsChange?: (settings: ReplySettings) => void;
  /** Show the clip, and take pasted and dropped files. */
  attach?: boolean;
  /** The agent is answering: send shows stop. */
  busy?: boolean;
  /** Return a promise to show stop until it settles. */
  onSend: (reply: ReplyMessage) => void | Promise<void>;
  onStop?: () => void;
  className?: string;
};

type Item = { id: number; file: File; url?: string; leaving?: boolean };
type Menu = "model" | "effort" | "access";

const defaultModels: ReplyModel[] = [
  { id: "swift", label: "Swift", description: "Quick answers" },
  { id: "balanced", label: "Balanced", description: "Everyday work" },
  { id: "deep", label: "Deep", description: "For the hard problems" },
];
// Notes stay short enough to fit the menu on one line.
const efforts: Array<{ id: ReplyEffort; label: string; note: string }> = [
  { id: "low", label: "Low", note: "Fast, for small asks" },
  { id: "medium", label: "Medium", note: "Thinks it through" },
  { id: "high", label: "High", note: "Slower, checks its work" },
];
const levels: Array<{ id: ReplyAccess; label: string; note: string }> = [
  { id: "read", label: "Read only", note: "Answers, changes nothing" },
  { id: "ask", label: "Asks first", note: "Before it sends or pays" },
  { id: "full", label: "Full access", note: "Acts, then tells you" },
];

// Six lines of 24px; past that the field scrolls and its edges fade.
const LINE = 24;
const MAX_H = LINE * 6;
const formatSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
let seq = 1;

export function ReplyBar({
  to,
  icon,
  placeholder,
  suggestions = [],
  models = defaultModels,
  defaultModel,
  defaultEffort = "medium",
  defaultAccess = "ask",
  settings = true,
  onSettingsChange,
  attach = true,
  busy = false,
  onSend,
  onStop,
  className,
}: ReplyBarProps) {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [model, setModel] = useState(() => models.find((m) => m.id === defaultModel) ?? models[1] ?? models[0]);
  const [effort, setEffort] = useState<ReplyEffort>(defaultEffort);
  const [access, setAccess] = useState<ReplyAccess>(defaultAccess);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pending, setPending] = useState(false);
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const [natural, setNatural] = useState(LINE);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [ghost, setGhost] = useState<{ id: number; text: string } | null>(null);
  const [nudge, setNudge] = useState(false);
  const [announce, setAnnounce] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const anchors = { model: useRef<HTMLButtonElement>(null), effort: useRef<HTMLButtonElement>(null), access: useRef<HTMLButtonElement>(null) };
  const history = useRef<string[]>([]);
  const dragDepth = useRef(0);
  const urls = useRef(new Set<string>());

  const working = busy || pending;
  const files = items.filter((i) => !i.leaving);
  const ready = !working && (!!draft.trim() || files.length > 0);
  const height = Math.min(MAX_H, natural);
  const ideas = suggestions.length > 0 && !draft.trim() && !files.length && !working;

  // The mirror lays out the same text, so the field knows its natural height before it paints.
  useLayoutEffect(() => {
    const el = mirror.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNatural(el.offsetHeight));
    ro.observe(el);
    setNatural(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const u = urls.current;
    return () => u.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const readEdges = () => {
    const el = area.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  };
  useLayoutEffect(readEdges, [draft, height]);

  const change = (next: Partial<ReplySettings>, said: string) => {
    const s = { model, effort, access, ...next };
    if (next.model) setModel(next.model);
    if (next.effort) setEffort(next.effort);
    if (next.access) setAccess(next.access);
    onSettingsChange?.(s);
    setAnnounce(said);
    feedback.play("tick", 5);
  };

  const addFiles = (list: FileList | File[]) => {
    const add = Array.from(list).map((file): Item => {
      const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (url) urls.current.add(url);
      return { id: seq++, file, url };
    });
    if (!add.length) return;
    setItems((f) => [...f, ...add]);
    setAnnounce(add.length === 1 ? `${add[0].file.name} attached` : `${add.length} files attached`);
    feedback.play("pop", 2);
  };
  const removeFile = (id: number) => {
    setItems((f) => f.map((i) => (i.id === id ? { ...i, leaving: true } : i)));
    area.current?.focus({ preventScroll: true });
  };
  const dropFile = (id: number) =>
    setItems((f) => {
      const gone = f.find((i) => i.id === id);
      if (gone?.url) {
        URL.revokeObjectURL(gone.url);
        urls.current.delete(gone.url);
      }
      return f.filter((i) => i.id !== id);
    });

  const send = async (raw: string, fromIdea = false) => {
    const text = raw.trim();
    if (working || (!text && !files.length)) return;
    const reply: ReplyMessage = { text, files: files.map((i) => i.file), model, effort, access };
    if (text) history.current.push(text);
    if (!fromIdea && text) setGhost({ id: seq++, text });
    setDraft("");
    setItems((f) => f.map((i) => ({ ...i, leaving: true })));
    setAnnounce(`Sent to ${to}`);
    feedback.play("pop", 4);
    const done = onSend(reply) as Promise<void> | undefined;
    if (!done) return;
    setPending(true);
    try {
      await done;
    } finally {
      setPending(false);
    }
  };
  const stop = () => {
    onStop?.();
    setPending(false);
    setAnnounce("Stopped");
    feedback.play("tap", -2);
  };

  const pick = (m: Menu) => setMenu((open) => (open === m ? null : m));
  const effortAt = efforts.findIndex((e) => e.id === effort);
  const level = levels.find((l) => l.id === access)!;

  return (
    <form
      className={cx("l-frame l-reply", className)}
      data-focus={focus || undefined}
      data-busy={working || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (working) stop();
        else send(draft);
      }}
      onDragEnter={(e) => {
        if (!attach || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current++;
        setDrag(true);
      }}
      onDragOver={(e) => attach && e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={() => {
        if (!attach) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDrag(false);
      }}
      onDrop={(e) => {
        if (!attach || !e.dataTransfer.files.length) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDrag(false);
        addFiles(e.dataTransfer.files);
        area.current?.focus({ preventScroll: true });
      }}
    >
      {suggestions.length > 0 && (
        <div className="l-reply__above" data-open={ideas || undefined} inert={!ideas || undefined}>
          <div className="l-reply__clip">
            <div className="l-frame-strip l-reply__ideas" role="group" aria-label={`Suggested replies to ${to}`} key={suggestions.join("\n")}>
              {suggestions.map((s, i) => (
                <button key={s} type="button" className="l-reply__idea l-focus" style={{ ["--i" as string]: i }} onClick={() => send(s, true)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="l-frame-card l-reply__card" data-drag={drag || undefined}>
        {attach && (
          <div className="l-reply__files" data-open={items.length > 0 || undefined}>
            <div className="l-reply__clip">
              <div className="l-reply__files-in">
                {items.map((i) => (
                  <FileChip key={i.id} item={i} onRemove={() => removeFile(i.id)} onGone={() => dropFile(i.id)} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="l-reply__row">
          <span className="l-reply__icon" aria-hidden>
            {icon ?? <AiMark phase={working ? "thinking" : "idle"} size={24} />}
          </span>
          <div className="l-reply__field" data-top={edges.top || undefined} data-bottom={edges.bottom || undefined} style={{ height }}>
            <div ref={mirror} className="l-reply__mirror" aria-hidden>
              {draft}
              {"​"}
            </div>
            <textarea
              ref={area}
              rows={1}
              value={draft}
              placeholder={placeholder ?? `Reply to ${to}`}
              aria-label={placeholder ?? `Reply to ${to}`}
              enterKeyHint="send"
              style={{ height }}
              onChange={(e) => setDraft(e.target.value)}
              onScroll={readEdges}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              onPaste={(e) => {
                if (!attach || !e.clipboardData.files.length) return;
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!working) send(draft);
                  else if (draft.trim()) {
                    // Nothing goes while the agent answers: stop nudges, and the draft waits.
                    setNudge(true);
                    setAnnounce(`${to} is still answering. Press Escape to stop`);
                  }
                } else if (e.key === "Escape" && working) {
                  e.preventDefault();
                  stop();
                } else if (e.key === "ArrowUp" && !draft && history.current.length) {
                  e.preventDefault();
                  setDraft(history.current[history.current.length - 1]);
                }
              }}
            />
            {ghost && (
              <span key={ghost.id} className="l-reply__ghost" aria-hidden onAnimationEnd={() => setGhost(null)}>
                {ghost.text}
              </span>
            )}
          </div>
          <div className="l-reply__tools">
            {attach && (
              <>
                <button type="button" className="l-reply__tool l-plate l-focus" aria-label="Attach files" onClick={() => fileInput.current?.click()}>
                  <Glyph name="clip" />
                </button>
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && (addFiles(e.target.files), (e.target.value = ""))} />
              </>
            )}
            <button
              type="submit"
              className="l-reply__send l-focus"
              data-ready={ready || undefined}
              data-busy={working || undefined}
              data-nudge={nudge || undefined}
              aria-disabled={!ready && !working ? true : undefined}
              aria-label={working ? `Stop ${to}` : ready ? `Send to ${to}` : "Write a reply to send"}
              onAnimationEnd={(e) => e.animationName === "l-shake" && setNudge(false)}
            >
              <svg className="l-reply__arrow" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 12.75V3.5M4 7.4 8 3.4l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="l-reply__stop" aria-hidden />
            </button>
          </div>
        </div>
        <span className="l-reply__drop" aria-hidden>
          <Glyph name="clip" />
          Drop to attach
        </span>
      </div>

      {settings && (
        <div className="l-frame-strip l-reply__strip">
          <div className="l-reply__sets" role="group" aria-label="Run settings">
            <Setting
              btnRef={anchors.model}
              open={menu === "model"}
              onToggle={() => pick("model")}
              label={`Model: ${model.label}`}
              glyph={<ModelMark id={model.id} size={14} />}
              text={model.label}
            >
              <AiMenu
                label="Model"
                place="start"
                anchor={anchors.model}
                items={models.map((m) => ({ id: m.id, label: m.label, note: m.description, icon: <ModelMark id={m.id} size={15} />, checked: m.id === model.id }))}
                onClose={() => setMenu(null)}
                onPick={(it) => {
                  setMenu(null);
                  anchors.model.current?.focus({ preventScroll: true });
                  const m = models.find((x) => x.id === it.id);
                  if (m && m.id !== model.id) change({ model: m }, `Model ${m.label}`);
                }}
              />
            </Setting>
            <i className="l-reply__sep" aria-hidden />
            <Setting
              btnRef={anchors.effort}
              open={menu === "effort"}
              onToggle={() => pick("effort")}
              label={`Effort: ${efforts[effortAt].label}`}
              glyph={<EffortGlyph level={effortAt + 1} />}
              text={efforts[effortAt].label}
              squeeze
            >
              <AiMenu
                label="Effort"
                place="start"
                anchor={anchors.effort}
                items={efforts.map((e, i) => ({ id: e.id, label: e.label, note: e.note, icon: <EffortGlyph level={i + 1} />, checked: e.id === effort }))}
                onClose={() => setMenu(null)}
                onPick={(it) => {
                  setMenu(null);
                  anchors.effort.current?.focus({ preventScroll: true });
                  if (it.id !== effort) change({ effort: it.id as ReplyEffort }, `${efforts.find((e) => e.id === it.id)?.label} effort`);
                }}
              />
            </Setting>
            <i className="l-reply__sep" aria-hidden />
            <Setting
              btnRef={anchors.access}
              open={menu === "access"}
              onToggle={() => pick("access")}
              label={`Access: ${level.label}`}
              glyph={<Glyph name={access} />}
              text={level.label}
              tone={access === "full" ? "warn" : undefined}
              squeeze
            >
              <AiMenu
                label="Access"
                place="end"
                anchor={anchors.access}
                items={levels.map((l) => ({ id: l.id, label: l.label, note: l.note, icon: <Glyph name={l.id} />, checked: l.id === access }))}
                onClose={() => setMenu(null)}
                onPick={(it) => {
                  setMenu(null);
                  anchors.access.current?.focus({ preventScroll: true });
                  if (it.id !== access) change({ access: it.id as ReplyAccess }, levels.find((l) => l.id === it.id)!.label);
                }}
              />
            </Setting>
          </div>
          <span className="l-reply__keys" data-show={focus || working || undefined} aria-hidden key={working ? "busy" : "idle"}>
            {working ? (
              <>
                <kbd>Esc</kbd> to stop
              </>
            ) : (
              <>
                <kbd>↵</kbd> to send <kbd>⇧ ↵</kbd> new line
              </>
            )}
          </span>
        </div>
      )}

      <span className="l-sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </form>
  );
}

/* ---------------- Pieces ---------------- */

/** A quiet setting on the strip. Its width springs to the new label, which comes into focus. */
function Setting({
  btnRef,
  open,
  onToggle,
  label,
  glyph,
  text,
  tone,
  squeeze,
  children,
}: {
  btnRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onToggle: () => void;
  label: string;
  glyph: ReactNode;
  text: string;
  tone?: "warn";
  /** Drops the label first when the strip is narrow. */
  squeeze?: boolean;
  children: ReactNode;
}) {
  const [inner, size] = useSize<HTMLSpanElement>();
  return (
    <span className="l-reply__anchor">
      <button
        ref={btnRef}
        type="button"
        className="l-reply__set l-plate l-focus"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-on={open || undefined}
        data-tone={tone}
        data-squeeze={squeeze || undefined}
        style={size ? { width: size.width + 16 } : undefined}
        onClick={onToggle}
      >
        <span ref={inner} className="l-reply__set-in">
          {glyph}
          <span key={text} className="l-reply__swap">
            {text}
          </span>
          <Glyph name="chev" />
        </span>
      </button>
      {open && children}
    </span>
  );
}

/** Three bars that fill to the effort. */
function EffortGlyph({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 16 16" className="l-reply__bars" data-level={level} aria-hidden>
      <rect x="2.25" y="9.25" width="2.75" height="4.5" rx="1.1" />
      <rect x="6.625" y="6.25" width="2.75" height="7.5" rx="1.1" />
      <rect x="11" y="3.25" width="2.75" height="10.5" rx="1.1" />
    </svg>
  );
}

function FileChip({ item, onRemove, onGone }: { item: Item; onRemove: () => void; onGone: () => void }) {
  const ext = (item.file.name.split(".").pop() ?? "file").slice(0, 4).toUpperCase();
  return (
    <div
      className="l-reply__file"
      data-leaving={item.leaving || undefined}
      onAnimationEnd={(e) => {
        if (item.leaving && e.animationName === "l-reply-file-out") onGone();
      }}
    >
      <div className="l-reply__file-in">
        <span className="l-reply__thumb" style={item.url ? { backgroundImage: `url(${item.url})` } : undefined}>
          {!item.url && ext}
        </span>
        <span className="l-reply__file-meta">
          <span className="l-reply__file-name">{item.file.name}</span>
          <span className="l-reply__file-size l-num">{formatSize(item.file.size)}</span>
        </span>
        <button type="button" className="l-reply__file-x l-focus" aria-label={`Remove ${item.file.name}`} onClick={onRemove}>
          <Glyph name="x" />
        </button>
      </div>
    </div>
  );
}

const glyphPaths = {
  clip: <path d="M13.2 7.6 8 12.8a3.25 3.25 0 0 1-4.6-4.6l5.6-5.6a2.1 2.1 0 0 1 3 3L6.5 11.1a.95.95 0 0 1-1.35-1.35L10.2 4.7" />,
  x: <path d="M5 5l6 6M11 5l-6 6" />,
  chev: <path d="M5.5 6.75 8 9.25l2.5-2.5" />,
  read: (
    <>
      <path d="M1.9 8c1.3-2.6 3.4-4 6.1-4s4.8 1.4 6.1 4c-1.3 2.6-3.4 4-6.1 4S3.2 10.6 1.9 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  ask: (
    <>
      <path d="M8 1.9 3 3.8v3.9c0 3 2.1 5.2 5 6.4 2.9-1.2 5-3.4 5-6.4V3.8L8 1.9Z" />
      <path d="M5.9 8.1 7.4 9.5 10.2 6.6" />
    </>
  ),
  full: <path d="M8.9 1.9 3.9 8.9h3.6l-.4 5.2 5-7h-3.6l.4-5.2Z" />,
};

function Glyph({ name }: { name: keyof typeof glyphPaths }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="l-reply__glyph" data-glyph={name}>
      {glyphPaths[name]}
    </svg>
  );
}
