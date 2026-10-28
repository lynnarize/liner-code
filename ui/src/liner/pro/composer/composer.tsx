/*
  Liner Pro · Composer
  The prompt box for chat and AI. A flat white card; only what opens over it is glass.

  - /commands and @mentions become tokens painted on a mirror under a real <textarea>,
    so IME, autocorrect and undo all work. Backspace takes a whole token, arrows hop it.
  - The plus menu attaches files or starts a mention. Long pastes turn into a chip.
  - Search and Think are toggles whose label grows in when they are on.
  - The model chip opens the models and an effort row; its width springs to the label.
  - Dictation draws a live waveform while the words come into focus; the check keeps them.
  - Send morphs into stop while a reply streams, and Escape stops it.
  - An optional strip under the card holds the project and whether the assistant asks first.
*/
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cx, useReducedMotion, useSize } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { fuzzy } from "../command-menu/command-menu";
import { ModelMark } from "../ai-kit/marks";
import { AiMenu } from "../ai-kit/surface";
import "../ai-kit/ai-kit.css";
import "./composer.css";

export type ComposerMention = { id: string; label: string; handle: string; group: "People" | "Files" | "Docs"; note?: string };
export type ComposerCommand = { id: string; label: string; description: string };
export type ComposerEffort = "low" | "medium" | "high";
export type ComposerModel = { id: string; label: string; description: string; effort?: ComposerEffort };
export type ComposerAccess = "ask" | "auto";
export type ComposerMessage = {
  text: string;
  mentions: ComposerMention[];
  command?: ComposerCommand;
  files: File[];
  /** Long pastes that were turned into chips. */
  pasted: string[];
  model: ComposerModel;
  effort: ComposerEffort;
  search: boolean;
  think: boolean;
  access: ComposerAccess;
  project?: string;
};

export type ComposerProps = {
  mentions?: ComposerMention[];
  commands?: ComposerCommand[];
  models?: ComposerModel[];
  defaultModel?: string;
  maxLength?: number;
  /** Rotating hints shown while the field is empty. */
  hints?: string[];
  /** Show the Search and Think toggles. */
  tools?: boolean;
  /** Told whenever Search or Think flips, for things that send without the composer (starters). */
  onToolsChange?: (tools: { search: boolean; think: boolean }) => void;
  /** Show the mic. Dictation is simulated unless you pass `dictate`. */
  voice?: boolean;
  /** Your speech recognizer: call onText with the transcript so far, resolve when it ends. */
  dictate?: (onText: (text: string) => void, signal: AbortSignal) => Promise<void>;
  /** Projects for the strip under the card. */
  projects?: string[];
  /** Show the asks-first switch in the strip. */
  access?: boolean;
  /** Resolve when the reply has finished; the send button shows stop until then. */
  onSend?: (message: ComposerMessage) => void | Promise<void>;
  onStop?: () => void;
  /** Replace the simulated upload with a real one. Call onProgress with 0..1. */
  upload?: (file: File, onProgress: (p: number) => void) => Promise<void>;
  /** Hide the model chip when the surrounding surface already has a picker. */
  showModelPicker?: boolean;
  /** Told when the model or its effort changes. */
  onModelChange?: (model: ComposerModel, effort: ComposerEffort) => void;
  /** Drive the send/stop state from outside, e.g. a reply started elsewhere. */
  busy?: boolean;
  className?: string;
};

type Attachment = { id: number; kind: "file" | "paste"; name: string; file?: File; text?: string; lines?: number; url?: string; progress: number; error?: string; leaving?: boolean };
type Range = { start: number; end: number; kind: "mention" | "command" };
type Suggest = { kind: "mention" | "command"; start: number; query: string; x: number; y: number };
type SuggestOption = { key: string; mention?: ComposerMention; command?: ComposerCommand; hits: number[] };

const defaultMentions: ComposerMention[] = [
  { id: "maya", label: "Maya Chen", handle: "maya", group: "People", note: "Design" },
  { id: "jonas", label: "Jonas Weber", handle: "jonas", group: "People", note: "Engineering" },
  { id: "priya", label: "Priya Raman", handle: "priya", group: "People", note: "Research" },
  { id: "plan", label: "launch-plan.md", handle: "launch-plan.md", group: "Files", note: "12 KB" },
  { id: "pricing", label: "pricing.csv", handle: "pricing.csv", group: "Files", note: "4 KB" },
  { id: "roadmap", label: "Q4 roadmap", handle: "q4-roadmap", group: "Docs", note: "Edited today" },
  { id: "notes", label: "Interview notes", handle: "interview-notes", group: "Docs", note: "5 sessions" },
];
const defaultCommands: ComposerCommand[] = [
  { id: "summarize", label: "summarize", description: "Condense it into key points" },
  { id: "translate", label: "translate", description: "Put it in another language" },
  { id: "explain", label: "explain", description: "Walk through it step by step" },
  { id: "todo", label: "todo", description: "Turn it into a task list" },
];
const defaultModels: ComposerModel[] = [
  { id: "swift", label: "Swift", description: "Quick answers", effort: "low" },
  { id: "balanced", label: "Balanced", description: "Everyday work", effort: "medium" },
  { id: "deep", label: "Deep", description: "Thinks longer, cites sources", effort: "high" },
];
const defaultHints = ["Ask anything", "Type / for commands", "Type @ to add a file, doc or teammate", "Drop files to attach"];
const efforts: Array<{ id: ComposerEffort; label: string }> = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];
const groups: ComposerMention["group"][] = ["People", "Files", "Docs"];
const sampleDictation = "Summarize what changed in the launch plan since Monday and flag anything risky";

const TOKEN = /(^\/\w+)|((?:^|(?<=\s))@[\w-]+(?:\.[\w-]+)*)/g;
const LONG_PASTE = { chars: 400, lines: 8 };

const initials = (name: string) =>
  name
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const formatSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** A quiet initials disc. No per-person color: the name does the work. */
export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span className="l-cmp__avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

let seq = 1;

export function Composer({
  mentions = defaultMentions,
  commands = defaultCommands,
  models = defaultModels,
  defaultModel,
  maxLength = 600,
  hints = defaultHints,
  tools = true,
  onToolsChange,
  voice: voiceOn = true,
  dictate,
  projects,
  access: accessOn = false,
  onSend,
  onStop,
  upload,
  showModelPicker = true,
  onModelChange,
  busy: busyProp,
  className,
}: ComposerProps) {
  const id = useId();
  const reduce = useReducedMotion();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceTextRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const projectBtnRef = useRef<HTMLButtonElement>(null);

  const [text, setText] = useState("");
  const [natural, setNatural] = useState(24);
  const [voiceH, setVoiceH] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [focused, setFocused] = useState(false);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busyInner, setBusy] = useState(false);
  const busy = busyProp ?? busyInner;
  const [ghost, setGhost] = useState<{ key: number; text: string } | null>(null);
  const [model, setModel] = useState(() => models.find((m) => m.id === defaultModel) ?? models[1] ?? models[0]);
  const [effort, setEffort] = useState<ComposerEffort>(model.effort ?? "medium");
  const [search, setSearch] = useState(false);
  const [think, setThink] = useState(false);
  const [access, setAccess] = useState<ComposerAccess>("ask");
  const [project, setProject] = useState(projects?.[0]);
  const [menu, setMenu] = useState<"plus" | "model" | "project" | null>(null);
  const [hint, setHint] = useState(0);
  const [voice, setVoice] = useState<{ text: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const voiceCtrl = useRef<AbortController | null>(null);
  const history = useRef<string[]>([]);
  const dragDepth = useRef(0);

  const height = Math.min(196, Math.max(24, voice ? Math.max(natural, voiceH) : natural));

  // --- Tokens: a leading /command and @mentions of known handles.
  const byHandle = useMemo(() => new Map(mentions.map((m) => [m.handle.toLowerCase(), m])), [mentions]);
  const command = useMemo(() => {
    const m = /^\/(\w+)/.exec(text);
    return m ? commands.find((c) => c.label === m[1].toLowerCase()) : undefined;
  }, [text, commands]);
  const ranges = useMemo(() => {
    const out: Range[] = [];
    for (const m of text.matchAll(TOKEN)) {
      const token = m[0];
      const kind = token.startsWith("/") ? "command" : "mention";
      const valid = kind === "command" ? !!command && token.slice(1).toLowerCase() === command.label : byHandle.has(token.slice(1).toLowerCase());
      if (valid) out.push({ start: m.index!, end: m.index! + token.length, kind });
    }
    return out;
  }, [text, byHandle, command]);
  const found = useMemo(() => {
    const list: ComposerMention[] = [];
    for (const r of ranges) {
      const m = r.kind === "mention" ? byHandle.get(text.slice(r.start + 1, r.end).toLowerCase()) : undefined;
      if (m && !list.includes(m)) list.push(m);
    }
    return list;
  }, [ranges, text, byHandle]);

  const painted = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const r of ranges) {
      out.push(text.slice(last, r.start));
      out.push(
        <mark key={r.start} className="l-cmp__token" data-kind={r.kind}>
          {text.slice(r.start, r.end)}
        </mark>,
      );
      last = r.end;
    }
    out.push(text.slice(last));
    // A trailing newline needs a character after it, or the mirror won't grow a line.
    out.push("​");
    return out;
  }, [text, ranges]);

  // --- Height follows the mirror (and the transcript while dictating).
  useLayoutEffect(() => {
    const el = mirrorRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNatural(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = voiceTextRef.current;
    if (!voice || !el) return;
    const ro = new ResizeObserver(() => setVoiceH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!voice]);

  // --- Rotating placeholder while empty.
  useEffect(() => {
    if (text || hints.length < 2) return;
    const t = window.setInterval(() => setHint((h) => (h + 1) % hints.length), 2800);
    return () => window.clearInterval(t);
  }, [text, hints.length]);

  // --- Clean up object URLs and any running dictation.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => {
      itemsRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url));
      voiceCtrl.current?.abort();
    },
    [],
  );

  // --- Editing through the browser keeps native undo intact.
  function replace(from: number, to: number, value: string) {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(from, to);
    const ok = value ? document.execCommand?.("insertText", false, value) : document.execCommand?.("delete");
    if (!ok) {
      const next = ta.value.slice(0, from) + value + ta.value.slice(to);
      setText(next);
      requestAnimationFrame(() => ta.setSelectionRange(from + value.length, from + value.length));
    }
  }

  // --- Caret position, measured on a hidden clone of the field.
  function caretPoint(index: number) {
    const ta = taRef.current;
    const m = measureRef.current;
    if (!ta || !m) return { x: 0, y: 0 };
    m.textContent = ta.value.slice(0, index);
    const mark = document.createElement("span");
    mark.textContent = "​";
    m.appendChild(mark);
    return { x: mark.offsetLeft, y: mark.offsetTop - ta.scrollTop };
  }

  function detect(value: string, caret: number) {
    const before = value.slice(0, caret);
    const at = /(^|\s)@([\w.-]*)$/.exec(before);
    const slash = /^\/(\w*)$/.exec(before);
    if (at) {
      const start = caret - at[2].length - 1;
      const p = caretPoint(start);
      setSuggest((s) => ({ kind: "mention", start, query: at[2], ...p, ...(s?.kind === "mention" && s.start === start ? { x: s.x, y: s.y } : {}) }));
      return;
    }
    if (slash) {
      setSuggest({ kind: "command", start: 0, query: slash[1], ...caretPoint(0) });
      return;
    }
    setSuggest(null);
  }

  const options = useMemo((): SuggestOption[] => {
    if (!suggest) return [];
    if (suggest.kind === "mention")
      return mentions
        .map((m) => ({ m, f: fuzzy(suggest.query, m.label) ?? fuzzy(suggest.query, m.handle) }))
        .filter((x) => x.f)
        .sort((a, b) => groups.indexOf(a.m.group) - groups.indexOf(b.m.group) || b.f!.score - a.f!.score)
        .map((x) => ({ key: x.m.id, mention: x.m, hits: fuzzy(suggest.query, x.m.label)?.hits ?? [] }));
    return commands
      .map((c) => ({ c, f: fuzzy(suggest.query, c.label) }))
      .filter((x) => x.f)
      .map((x) => ({ key: x.c.id, command: x.c, hits: x.f!.hits }));
  }, [suggest, mentions, commands]);

  useEffect(() => {
    setActive(0);
  }, [suggest?.query, suggest?.kind]);

  function pick(option: SuggestOption) {
    const ta = taRef.current;
    if (!ta || !suggest) return;
    const token = option.mention ? `@${option.mention.handle} ` : `/${option.command!.label} `;
    const start = suggest.start;
    setSuggest(null);
    replace(start, ta.selectionStart, token);
    feedback.play("pop", 4);
  }

  /** Put a trigger character at the caret (or the start, for commands) and open its list. */
  function trigger(ch: "@" | "/") {
    const ta = taRef.current;
    if (!ta) return;
    if (ch === "/") {
      if (!ta.value.startsWith("/")) replace(0, 0, "/");
      else ta.focus();
      requestAnimationFrame(() => {
        ta.setSelectionRange(1, 1);
        detect(ta.value, 1);
      });
      return;
    }
    const pos = ta.selectionStart;
    const pre = ta.value.slice(0, pos);
    const add = (pre && !/\s$/.test(pre) ? " " : "") + "@";
    replace(pos, ta.selectionEnd, add);
    requestAnimationFrame(() => detect(ta.value, pos + add.length));
  }

  // --- Attachments: files upload in place, long pastes become chips.
  function swallow() {
    // The card swallows what it was given: a quick squash and settle.
    if (!reduce) cardRef.current?.animate([{ scale: "1.012" }, { scale: "0.992" }, { scale: "1.003" }, { scale: "1" }], { duration: 460, easing: "ease-out" });
  }
  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).slice(0, 6);
    if (!incoming.length) return;
    const added: Attachment[] = incoming.map((file) => ({ id: seq++, kind: "file", name: file.name, file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined, progress: 0 }));
    setItems((f) => [...f, ...added]);
    swallow();
    feedback.play("pop", 2);
    added.forEach(runUpload);
  }
  function addPaste(value: string) {
    const lines = value.split("\n").length;
    const first = value.trim().split("\n")[0].slice(0, 48);
    setItems((f) => [...f, { id: seq++, kind: "paste", name: first || "Pasted text", text: value, lines, progress: 1 }]);
    swallow();
    feedback.play("pop", 3);
    setAnnounce(`Long paste added as an attachment, ${lines} lines`);
  }
  function runUpload(f: Attachment) {
    const set = (p: number) => setItems((list) => list.map((x) => (x.id === f.id ? { ...x, progress: p } : x)));
    if (upload && f.file) {
      upload(f.file, set).then(
        () => set(1),
        () => setItems((list) => list.map((x) => (x.id === f.id ? { ...x, error: "Upload failed" } : x))),
      );
      return;
    }
    let p = 0;
    const tick = () => {
      if (!itemsRef.current.some((x) => x.id === f.id && !x.leaving)) return;
      p = Math.min(1, p + 0.08 + Math.random() * 0.16);
      set(p);
      if (p < 1) window.setTimeout(tick, 140 + Math.random() * 160);
      else feedback.play("tick", 8);
    };
    window.setTimeout(tick, 200);
  }
  function removeItem(a: Attachment) {
    setItems((list) => list.map((x) => (x.id === a.id ? { ...x, leaving: true } : x)));
    feedback.play("tap", -2);
    setAnnounce(`Removed ${a.kind === "paste" ? "pasted text" : a.name}`);
  }

  // --- Dictation
  function startVoice() {
    if (voice) return;
    const ctrl = new AbortController();
    voiceCtrl.current = ctrl;
    setVoice({ text: "" });
    setSuggest(null);
    setMenu(null);
    // Keep focus in the field: Enter keeps the words, Escape drops them.
    taRef.current?.focus();
    feedback.play("tick", 4);
    setAnnounce("Listening");
    (dictate ?? simulateDictation)((t) => !ctrl.signal.aborted && setVoice({ text: t }), ctrl.signal).catch(() => {});
  }
  function endVoice(keep: boolean) {
    const said = voice?.text.trim() ?? "";
    voiceCtrl.current?.abort();
    voiceCtrl.current = null;
    setVoice(null);
    const ta = taRef.current;
    if (keep && said && ta) {
      const pos = ta.selectionStart;
      const pre = ta.value.slice(0, pos);
      replace(pos, ta.selectionEnd, (pre && !/\s$/.test(pre) ? " " : "") + said);
      feedback.play("pop", 5);
      setAnnounce("Dictation added");
    } else {
      ta?.focus();
      setAnnounce(keep ? "" : "Dictation cancelled");
    }
  }

  // --- Send
  const count = text.length;
  const over = count > maxLength;
  const live = items.filter((f) => !f.leaving);
  const uploading = live.some((f) => f.progress < 1 && !f.error);
  const canSend = !busy && !voice && !over && !uploading && (text.trim().length > 0 || live.length > 0);

  async function send() {
    if (busy) {
      onStop?.();
      setBusy(false);
      setAnnounce("Stopped");
      return;
    }
    if (over) {
      if (!reduce) cardRef.current?.animate([{ translate: "0" }, { translate: "-5px" }, { translate: "4px" }, { translate: "-2px" }, { translate: "0" }], { duration: 340 });
      feedback.play("error");
      return;
    }
    if (!canSend) return;
    const message: ComposerMessage = {
      text: text.trim(),
      mentions: found,
      command,
      files: live.filter((f) => f.file).map((f) => f.file!),
      pasted: live.filter((f) => f.kind === "paste").map((f) => f.text!),
      model,
      effort,
      search,
      think,
      access,
      project,
    };
    history.current.push(text);
    setGhost({ key: Date.now(), text });
    setText("");
    setSuggest(null);
    items.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    setItems([]);
    feedback.play("success");
    const result = onSend?.(message);
    if (result && typeof (result as Promise<void>).then === "function") {
      setBusy(true);
      try {
        await result;
      } finally {
        setBusy(false);
      }
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (suggest && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = options.length;
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
        feedback.play("tick");
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[active]);
        return;
      }
    }
    if (e.key === "Escape") {
      // One thing at a time: the list, then dictation, then a running reply.
      if (suggest) {
        e.preventDefault();
        setSuggest(null);
      } else if (voice) {
        e.preventDefault();
        endVoice(false);
      } else if (busy) {
        e.preventDefault();
        send();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (voice) endVoice(true);
      else send();
      return;
    }
    // Tokens behave as one piece: delete them whole, step over them.
    const ta = e.currentTarget;
    const s = ta.selectionStart;
    if (s === ta.selectionEnd && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const hit =
        e.key === "Backspace" ? ranges.find((r) => r.end === s) : e.key === "Delete" ? ranges.find((r) => r.start === s) : e.key === "ArrowLeft" ? ranges.find((r) => s > r.start && s <= r.end) : e.key === "ArrowRight" ? ranges.find((r) => s >= r.start && s < r.end) : undefined;
      if (hit) {
        e.preventDefault();
        if (e.key === "Backspace" || e.key === "Delete") {
          replace(hit.start, hit.end, "");
          feedback.play("tap", -3);
        } else {
          const to = e.key === "ArrowLeft" ? hit.start : hit.end;
          ta.setSelectionRange(to, to);
        }
        return;
      }
    }
    // Up on an empty field brings back what you sent last.
    if (e.key === "ArrowUp" && !text && history.current.length) {
      e.preventDefault();
      const last = history.current[history.current.length - 1];
      replace(0, 0, last);
    }
  }

  const ratio = count / maxLength;
  const ringShown = ratio > 0.8;
  const R = 9;
  const C = 2 * Math.PI * R;
  const strip = !!projects?.length || accessOn;

  return (
    <div className={cx("l-cmp l-frame", className)} data-strip={strip || undefined}>
      <div
        ref={cardRef}
        className="l-cmp__card l-frame-card"
        data-focus={focused || undefined}
        data-drag={dragOver || undefined}
        data-busy={busy || undefined}
        data-over={over || undefined}
        data-voice={voice ? true : undefined}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current++;
          setDragOver(true);
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragOver(false);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="l-cmp__drop" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 15V4.5m0 0L7.5 9M12 4.5 16.5 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.5 14.5v2.25A2.75 2.75 0 0 0 7.25 19.5h9.5a2.75 2.75 0 0 0 2.75-2.75V14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          Drop to attach
        </div>

        {/* Attachments: the row opens with grid rows, chips grow in place. */}
        <div className="l-cmp__files" data-show={live.length > 0 || undefined}>
          <div className="l-cmp__files-inner">
            <div className="l-cmp__files-row">
              {items.map((f) => (
                <Chip key={f.id} a={f} onRemove={() => removeItem(f)} onGone={() => setItems((list) => list.filter((x) => x.id !== f.id))} />
              ))}
            </div>
          </div>
        </div>

        <div className="l-cmp__field" style={{ height }}>
          {ghost && (
            <div className="l-cmp__ghost" key={ghost.key} aria-hidden onAnimationEnd={() => setGhost(null)}>
              {ghost.text}
            </div>
          )}
          <div
            className="l-cmp__clip"
            data-overflow={natural > 196 || undefined}
            data-top={scrollTop > 2 || undefined}
            data-bottom={natural > 196 && scrollTop < natural - 196 - 2 ? true : undefined}
          >
            <div className="l-cmp__mirror" ref={mirrorRef} aria-hidden style={{ transform: `translateY(${-scrollTop}px)` }}>
              {painted}
            </div>
            <div className="l-cmp__measure" ref={measureRef} aria-hidden />
            {!text && !voice && (
              <span className="l-cmp__placeholder" aria-hidden key={hint}>
                {hints[hint]}
              </span>
            )}
            <textarea
              ref={taRef}
              id={id}
              className="l-cmp__input"
              value={text}
              rows={1}
              aria-label="Message"
              aria-describedby={`${id}-hint ${id}-count`}
              aria-autocomplete="list"
              aria-controls={suggest ? `${id}-suggest` : undefined}
              aria-activedescendant={suggest && options[active] ? `${id}-opt-${options[active].key}` : undefined}
              onChange={(e) => {
                setText(e.target.value);
                detect(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => {
                const t = e.currentTarget;
                if (t.selectionStart === t.selectionEnd) detect(t.value, t.selectionStart);
              }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                window.setTimeout(() => setSuggest(null), 120);
              }}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  addFiles(e.clipboardData.files);
                  return;
                }
                const pasted = e.clipboardData.getData("text/plain");
                if (pasted.length > LONG_PASTE.chars || pasted.split("\n").length > LONG_PASTE.lines) {
                  e.preventDefault();
                  addPaste(pasted);
                }
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {voice && (
            <div className="l-cmp__voice-text" ref={voiceTextRef} aria-live="polite">
              {voice.text ? (
                voice.text.split(/(\s+)/).map((w, i) =>
                  /^\s+$/.test(w) ? (
                    w
                  ) : (
                    <span key={i} className="l-cmp__word">
                      {w}
                    </span>
                  ),
                )
              ) : (
                <span className="l-cmp__listening l-shimmer">Listening</span>
              )}
            </div>
          )}

          {suggest && options.length > 0 && (
            <SuggestList
              id={`${id}-suggest`}
              optionId={(k) => `${id}-opt-${k}`}
              kind={suggest.kind}
              x={suggest.x}
              y={suggest.y}
              options={options}
              active={active}
              onActive={setActive}
              onPick={pick}
            />
          )}
        </div>
        <span className="l-sr-only" id={`${id}-hint`}>
          Enter sends, Shift Enter adds a line. Type slash for commands and at for files, docs and people.
        </span>

        <div className="l-cmp__bar">
          <div className="l-cmp__tools">
            <div className="l-cmp__anchor">
              <button
                ref={plusRef}
                type="button"
                className="l-cmp__tool l-plate l-focus"
                aria-label="Add"
                aria-haspopup="menu"
                aria-expanded={menu === "plus"}
                data-open={menu === "plus" || undefined}
                onClick={() => setMenu((m) => (m === "plus" ? null : "plus"))}
              >
                <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-cmp__plus">
                  <path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              {menu === "plus" && (
                <AiMenu
                  label="Add"
                  place="start"
                  anchor={plusRef}
                  items={[
                    { id: "files", label: "Upload files", note: "Or drop them on the box", icon: <Glyph name="clip" /> },
                    { id: "mention", label: "Add a file or doc", note: "@", icon: <Glyph name="at" /> },
                    { id: "command", label: "Use a command", note: "/", icon: <Glyph name="slash" /> },
                  ]}
                  onClose={() => setMenu(null)}
                  onPick={(it) => {
                    setMenu(null);
                    if (it.id === "files") fileInputRef.current?.click();
                    else trigger(it.id === "mention" ? "@" : "/");
                  }}
                />
              )}
            </div>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => e.target.files && (addFiles(e.target.files), (e.target.value = ""))} />
            {tools && (
              <>
                <Toggle
                  on={search}
                  label="Search"
                  title="Search the web"
                  icon={<Glyph name="globe" />}
                  onChange={(v) => {
                    setSearch(v);
                    onToolsChange?.({ search: v, think });
                    setAnnounce(v ? "Web search on" : "Web search off");
                  }}
                />
                <Toggle
                  on={think}
                  label="Think"
                  title="Think it through first"
                  icon={<Glyph name="bulb" />}
                  onChange={(v) => {
                    setThink(v);
                    onToolsChange?.({ search, think: v });
                    setAnnounce(v ? "Thinking on" : "Thinking off");
                  }}
                />
              </>
            )}
          </div>

          <div className="l-cmp__end">
            {voice ? (
              <div className="l-cmp__voice-ctl" key="voice">
                <Waveform />
                <button type="button" className="l-cmp__tool l-plate l-focus" aria-label="Cancel dictation" onClick={() => endVoice(false)}>
                  <Glyph name="x" />
                </button>
                <button type="button" className="l-cmp__keep l-focus" aria-label="Keep dictation" onClick={() => endVoice(true)}>
                  <Glyph name="check" />
                </button>
              </div>
            ) : (
              <div className="l-cmp__send-wrap" key="send">
                <span className="l-cmp__count l-num" id={`${id}-count`} data-show={ringShown || undefined} data-over={over || undefined} aria-live="polite">
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <circle cx="12" cy="12" r={R} className="l-cmp__count-track" />
                    <circle cx="12" cy="12" r={R} className="l-cmp__count-fill" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - Math.min(1, ratio)) }} />
                  </svg>
                  {ratio > 0.95 && <span key={maxLength - count > 0 ? "n" : "o"}>{maxLength - count}</span>}
                </span>
                {showModelPicker && (
                  <div className="l-cmp__anchor">
                    <ModelChip
                      btnRef={modelBtnRef}
                      model={model}
                      effort={effort}
                      open={menu === "model"}
                      onToggle={() => setMenu((m) => (m === "model" ? null : "model"))}
                    />
                    {menu === "model" && (
                      <AiMenu
                        label="Model"
                        place="end"
                        anchor={modelBtnRef}
                        items={models.map((m) => ({ id: m.id, label: m.label, note: m.description, icon: <ModelMark id={m.id} size={15} />, checked: m.id === model.id }))}
                        onClose={() => setMenu(null)}
                        onPick={(it) => {
                          const m = models.find((x) => x.id === it.id)!;
                          setModel(m);
                          const e = m.effort ?? effort;
                          setEffort(e);
                          onModelChange?.(m, e);
                          setMenu(null);
                          modelBtnRef.current?.focus({ preventScroll: true });
                          feedback.play("tick", 6);
                          setAnnounce(`Model ${m.label}, ${e} effort`);
                        }}
                        onSide={(dir) => {
                          const i = efforts.findIndex((x) => x.id === effort);
                          const next = efforts[Math.min(efforts.length - 1, Math.max(0, i + dir))].id;
                          if (next !== effort) {
                            setEffort(next);
                            onModelChange?.(model, next);
                            feedback.play("tick", 4);
                          }
                        }}
                        footer={
                          <Effort
                            value={effort}
                            onChange={(e) => {
                              setEffort(e);
                              onModelChange?.(model, e);
                              feedback.play("tick", 4);
                              setAnnounce(`${e} effort`);
                            }}
                          />
                        }
                      />
                    )}
                  </div>
                )}
                {voiceOn && (
                  <button type="button" className="l-cmp__tool l-plate l-focus" aria-label="Dictate" title="Dictate" onClick={startVoice} disabled={busy}>
                    <Glyph name="mic" />
                  </button>
                )}
                <button
                  type="button"
                  className="l-cmp__send l-focus"
                  data-ready={canSend || undefined}
                  data-busy={busy || undefined}
                  aria-label={busy ? "Stop generating" : uploading ? "Send after uploads finish" : over ? "Message is over the limit" : "Send message"}
                  aria-disabled={!busy && !canSend}
                  onClick={send}
                >
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-cmp__arrow">
                    <path d="M8 12.75V3.5M3.9 7.4 8 3.25l4.1 4.15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="l-cmp__stop" aria-hidden />
                  <span className="l-cmp__busy-ring" aria-hidden>
                    <svg viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="16.5" pathLength="1" />
                    </svg>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {strip && (
        <div className="l-cmp__strip l-frame-strip">
          {projects?.length ? (
            <div className="l-cmp__anchor">
              <button
                ref={projectBtnRef}
                type="button"
                className="l-cmp__chip l-focus"
                aria-haspopup="menu"
                aria-expanded={menu === "project"}
                data-open={menu === "project" || undefined}
                onClick={() => setMenu((m) => (m === "project" ? null : "project"))}
              >
                <Glyph name="folder" />
                <span key={project} className="l-cmp__swap">
                  {project}
                </span>
                <Glyph name="chev" />
              </button>
              {menu === "project" && (
                <AiMenu
                  label="Project"
                  place="start"
                  anchor={projectBtnRef}
                  items={projects.map((p) => ({ id: p, label: p, icon: <Glyph name="folder" />, checked: p === project }))}
                  onClose={() => setMenu(null)}
                  onPick={(it) => {
                    setProject(it.id);
                    setMenu(null);
                    projectBtnRef.current?.focus({ preventScroll: true });
                    feedback.play("tick", 5);
                    setAnnounce(`Project ${it.id}`);
                  }}
                />
              )}
            </div>
          ) : (
            <span />
          )}
          {accessOn && (
            <AccessSwitch
              value={access}
              onChange={(v) => {
                setAccess(v);
                feedback.play("tick", v === "auto" ? 7 : 3);
                setAnnounce(v === "auto" ? "Acts without asking" : "Asks before acting");
              }}
            />
          )}
        </div>
      )}

      <span className="l-sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/* ---------------- Pieces ---------------- */

function Chip({ a, onRemove, onGone }: { a: Attachment; onRemove: () => void; onGone: () => void }) {
  const done = a.progress >= 1;
  const ext = a.kind === "paste" ? "TXT" : (a.name.split(".").pop() ?? "file").slice(0, 4).toUpperCase();
  return (
    <div
      className="l-cmp__file"
      data-kind={a.kind}
      data-leaving={a.leaving || undefined}
      data-done={done || undefined}
      data-error={a.error ? true : undefined}
      onAnimationEnd={(e) => {
        if (a.leaving && e.animationName === "l-cmp-file-out") {
          if (a.url) URL.revokeObjectURL(a.url);
          onGone();
        }
      }}
    >
      <div className="l-cmp__file-in">
        <span className="l-cmp__thumb" style={a.url ? { backgroundImage: `url(${a.url})` } : undefined}>
          {!a.url && (a.kind === "paste" ? <Glyph name="text" /> : <span className="l-cmp__ext">{ext}</span>)}
          <svg className="l-cmp__ring" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="9" pathLength="1" style={{ strokeDashoffset: 1 - a.progress }} />
          </svg>
          <span className="l-cmp__tick" aria-hidden>
            <Glyph name="check" />
          </span>
        </span>
        <span className="l-cmp__file-meta">
          <span className="l-cmp__file-name">{a.kind === "paste" ? "Pasted text" : a.name}</span>
          <span className="l-cmp__file-size l-num" key={done ? "d" : "u"}>
            {a.error ?? (a.kind === "paste" ? `${a.lines} lines · ${a.name}` : done ? formatSize(a.file?.size ?? 0) : `Uploading ${Math.round(a.progress * 100)}%`)}
          </span>
        </span>
        <button type="button" className="l-cmp__file-x" aria-label={done || a.error ? `Remove ${a.kind === "paste" ? "pasted text" : a.name}` : "Cancel upload"} onClick={onRemove}>
          <Glyph name="x" />
        </button>
      </div>
    </div>
  );
}

/** Off it is just an icon; on, its label grows in and it takes the accent tint. */
function Toggle({ on, label, title, icon, onChange }: { on: boolean; label: string; title: string; icon: ReactNode; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className="l-cmp__toggle l-focus"
      aria-pressed={on}
      aria-label={label}
      title={on ? undefined : title}
      data-on={on || undefined}
      onClick={() => {
        onChange(!on);
        feedback.play(on ? "tap" : "pop", on ? -1 : 4);
      }}
    >
      {icon}
      <span className="l-cmp__toggle-label" aria-hidden>
        <span>{label}</span>
      </span>
    </button>
  );
}

function ModelChip({ btnRef, model, effort, open, onToggle }: { btnRef: React.RefObject<HTMLButtonElement | null>; model: ComposerModel; effort: ComposerEffort; open: boolean; onToggle: () => void }) {
  // The chip springs to the width of its new label instead of jumping.
  const [innerRef, size] = useSize<HTMLSpanElement>();
  return (
    <button
      ref={btnRef}
      type="button"
      className="l-cmp__model l-focus"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Model: ${model.label}, ${effort} effort`}
      data-open={open || undefined}
      style={size ? { width: size.width + 18 } : undefined}
      onClick={onToggle}
    >
      <span className="l-cmp__model-in" ref={innerRef}>
        <ModelMark id={model.id} size={14} />
        <span key={model.id} className="l-cmp__swap">
          {model.label}
        </span>
        <span key={effort} className="l-cmp__swap l-cmp__model-effort">
          {efforts.find((e) => e.id === effort)?.label}
        </span>
        <Glyph name="chev" />
      </span>
    </button>
  );
}

function Effort({ value, onChange }: { value: ComposerEffort; onChange: (e: ComposerEffort) => void }) {
  const i = efforts.findIndex((e) => e.id === value);
  return (
    <div className="l-cmp__effort">
      <div className="l-cmp__effort-head">
        <span>Effort</span>
        <span className="l-cmp__effort-hint">← →</span>
      </div>
      <div className="l-cmp__effort-row" role="radiogroup" aria-label="Effort" style={{ ["--i" as string]: i }}>
        <span className="l-cmp__effort-pill" aria-hidden />
        {efforts.map((e) => (
          <button key={e.id} type="button" role="radio" aria-checked={e.id === value} tabIndex={-1} data-on={e.id === value || undefined} onClick={() => onChange(e.id)}>
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AccessSwitch({ value, onChange }: { value: ComposerAccess; onChange: (v: ComposerAccess) => void }) {
  const [innerRef, size] = useSize<HTMLSpanElement>();
  const auto = value === "auto";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={auto}
      aria-label="Act without asking"
      className="l-cmp__access l-focus"
      data-mode={value}
      style={size ? { width: size.width + 20 } : undefined}
      onClick={() => onChange(auto ? "ask" : "auto")}
    >
      <span className="l-cmp__access-in" ref={innerRef}>
        <Glyph name={auto ? "bolt" : "shield"} />
        <span key={value} className="l-cmp__swap">
          <span className="l-cmp__long">{auto ? "Acts without asking" : "Asks before acting"}</span>
          <span className="l-cmp__short">{auto ? "Acts alone" : "Asks first"}</span>
        </span>
      </span>
    </button>
  );
}

function SuggestList({
  id,
  optionId,
  kind,
  x,
  y,
  options,
  active,
  onActive,
  onPick,
}: {
  id: string;
  optionId: (key: string) => string;
  kind: "mention" | "command";
  x: number;
  y: number;
  options: SuggestOption[];
  active: number;
  onActive: (i: number) => void;
  onPick: (o: SuggestOption) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [hl, setHl] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const row = listRef.current?.querySelectorAll<HTMLElement>("[role=option]")[active];
    if (row) setHl({ y: row.offsetTop, h: row.offsetHeight });
  }, [active, options]);

  let lastGroup = "";
  return (
    <div className="l-cmp__pop l-glass-rim" style={{ ["--x" as string]: `${x}px`, ["--y" as string]: `${y}px` }} data-kind={kind}>
      <div className="l-cmp__pop-list" ref={listRef} id={id} role="listbox" aria-label={kind === "mention" ? "Files, docs and people" : "Commands"}>
        {hl && <span className="l-cmp__hl" style={{ transform: `translateY(${hl.y}px)`, height: hl.h }} aria-hidden />}
        {kind === "command" && <div className="l-cmp__pop-head">Commands</div>}
        {options.map((o, i) => {
          const head = o.mention && o.mention.group !== lastGroup ? o.mention.group : null;
          if (o.mention) lastGroup = o.mention.group;
          return (
            <div key={o.key} role="presentation">
              {head && <div className="l-cmp__pop-head">{head}</div>}
              <div
                id={optionId(o.key)}
                role="option"
                aria-selected={i === active}
                data-active={i === active || undefined}
                className="l-cmp__opt"
                onPointerMove={() => i !== active && onActive(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onPick(o)}
              >
                {o.mention ? (
                  <>
                    {o.mention.group === "People" ? (
                      <Avatar name={o.mention.label} size={24} />
                    ) : (
                      <span className="l-cmp__opt-tile">
                        <Glyph name={o.mention.group === "Files" ? "file" : "doc"} />
                      </span>
                    )}
                    <span className="l-cmp__opt-name">
                      <Marked text={o.mention.label} hits={o.hits} />
                    </span>
                    {o.mention.note && <span className="l-cmp__opt-sub">{o.mention.note}</span>}
                  </>
                ) : (
                  <>
                    <span className="l-cmp__opt-tile l-cmp__opt-slash">/</span>
                    <span className="l-cmp__opt-name">
                      <Marked text={o.command!.label} hits={o.hits} />
                    </span>
                    <span className="l-cmp__opt-sub">{o.command!.description}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Marked({ text, hits }: { text: string; hits: number[] }) {
  const set = new Set(hits);
  return (
    <>
      {Array.from(text).map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}
    </>
  );
}

/** Bars that follow the voice. Written straight to the DOM on animation frames. */
function Waveform() {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const bars = Array.from(ref.current?.children ?? []) as HTMLElement[];
    if (reduce || !bars.length) return;
    const levels = bars.map(() => 0.2);
    let raf = 0;
    let t = 0;
    const loop = () => {
      t += 1;
      // A slow "breath" plus per-bar jitter reads like speech without real audio.
      const breath = 0.45 + 0.35 * Math.sin(t / 18) * Math.sin(t / 7);
      bars.forEach((b, i) => {
        const target = Math.max(0.12, Math.min(1, breath * (0.5 + Math.random() * 0.9) * (1 - Math.abs(i - bars.length / 2) / bars.length)));
        levels[i] += (target - levels[i]) * 0.35;
        b.style.transform = `scaleY(${levels[i].toFixed(3)})`;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);
  return (
    <span className="l-cmp__wave" ref={ref} aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

/** Plays a transcript word by word, the way a recognizer reports partial results. */
async function simulateDictation(onText: (t: string) => void, signal: AbortSignal) {
  const words = sampleDictation.split(" ");
  await sleep(700, signal);
  for (let i = 1; i <= words.length; i++) {
    onText(words.slice(0, i).join(" "));
    await sleep(170 + Math.random() * 190, signal);
  }
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = window.setTimeout(res, ms);
    signal.addEventListener("abort", () => (window.clearTimeout(t), rej(new DOMException("Aborted", "AbortError"))), { once: true });
  });

const glyphPaths: Record<string, ReactNode> = {
  clip: <path d="M13.2 7.6 8 12.8a3.25 3.25 0 0 1-4.6-4.6l5.6-5.6a2.1 2.1 0 0 1 3 3L6.5 11.1a.95.95 0 0 1-1.35-1.35L10.2 4.7" />,
  at: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M10.6 8v.9a1.85 1.85 0 0 0 3.7 0V8A6.3 6.3 0 1 0 11.7 13" />
    </>
  ),
  slash: <path d="M10.2 2.8 5.8 13.2" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.4 8h11.2M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75C6.4 12.15 5.6 10.25 5.6 8S6.4 3.85 8 2.25Z" />
    </>
  ),
  bulb: <path d="M6 12.25h4M6.6 14.25h2.8M8 1.75a4.25 4.25 0 0 0-2.6 7.6c.4.3.6.75.6 1.25v.4h4v-.4c0-.5.2-.95.6-1.25A4.25 4.25 0 0 0 8 1.75Z" />,
  mic: (
    <>
      <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
      <path d="M3.5 7.75a4.5 4.5 0 0 0 9 0M8 12.25v2" />
    </>
  ),
  x: <path d="M5 5l6 6M11 5l-6 6" />,
  check: <path d="M3.6 8.4 6.6 11.3 12.4 5" />,
  chev: <path d="M5 6.5 8 9.5l3-3" />,
  folder: <path d="M2.25 4.75c0-.55.45-1 1-1h3l1.4 1.5h5.1c.55 0 1 .45 1 1v5.5c0 .55-.45 1-1 1H3.25c-.55 0-1-.45-1-1v-7Z" />,
  shield: (
    <>
      <path d="M8 1.9 3 3.8v3.9c0 3 2.1 5.2 5 6.4 2.9-1.2 5-3.4 5-6.4V3.8L8 1.9Z" />
      <path d="M5.9 8.1 7.4 9.5 10.2 6.6" />
    </>
  ),
  bolt: <path d="M8.9 1.9 3.9 8.9h3.6l-.4 5.2 5-7h-3.6l.4-5.2Z" />,
  file: (
    <>
      <path d="M4.25 2.25h4.5l3 3v8a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-10.5a.5.5 0 0 1 .5-.5Z" />
      <path d="M8.75 2.25v3h3" />
    </>
  ),
  doc: (
    <>
      <rect x="3" y="2.25" width="10" height="11.5" rx="1.75" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </>
  ),
  text: <path d="M3.5 4.5h9M3.5 7.25h9M3.5 10h9M3.5 12.75h5" />,
};

function Glyph({ name }: { name: keyof typeof glyphPaths }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="l-cmp__glyph">
      {glyphPaths[name]}
    </svg>
  );
}
