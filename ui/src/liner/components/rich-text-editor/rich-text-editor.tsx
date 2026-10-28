/*
  Liner · Rich text editor
  Writing first. A quiet toolbar on the glass, a white page below, and Markdown habits that
  just work: # for a heading, - or 1. for a list, > for a quote, ⌘K for a link. Built on
  contenteditable, so selection, undo and paste behave the way the platform does.
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { ActionButton } from "../action-button/action-button";
import "./rich-text-editor.css";

export type RichTextEditorProps = {
  /** Starting HTML. The editor is uncontrolled after that. */
  defaultValue?: string;
  onChange?: (html: string, text: string) => void;
  placeholder?: string;
  label?: string;
  minHeight?: number;
  className?: string;
};

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const I = {
  bold: svg(<path d="M5 3h3.6a2.4 2.4 0 0 1 0 4.8H5V3Zm0 4.8h4.2a2.6 2.6 0 0 1 0 5.2H5V7.8Z" />),
  italic: svg(<path d="M9.5 3H13M3 13h3.5M9.8 3 6.2 13" />),
  strike: svg(<path d="M3 8h10M10.8 4.6C10.3 3.6 9.3 3 8 3 6.3 3 5 3.9 5 5.2c0 .9.5 1.5 1.3 2M5.2 11c.5 1.2 1.6 2 2.9 2 1.8 0 3-1 3-2.4 0-.6-.2-1-.5-1.4" />),
  heading: svg(<path d="M3.5 3v10M10 3v10M3.5 8H10M12.5 8.5l1.5-1v5.5" />),
  quote: svg(<path d="M3.5 4v8M6.5 5.5h6M6.5 8h6M6.5 10.5h4" />),
  ul: svg(<path d="M6 4h7.5M6 8h7.5M6 12h7.5M3 4h.01M3 8h.01M3 12h.01" />),
  ol: svg(<path d="M6.5 4H13.5M6.5 8H13.5M6.5 12H13.5M2.5 3.2 3.4 2.7V5.6M2.4 10.4c.2-.4.6-.6 1-.6.5 0 .9.3.9.8 0 .7-1.9 1.3-1.9 2.1h1.9" />),
  link: svg(<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.7.7M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l.7-.7" />),
};

type State = { bold: boolean; italic: boolean; strikeThrough: boolean; h2: boolean; blockquote: boolean; ul: boolean; ol: boolean; link: boolean };
const EMPTY: State = { bold: false, italic: false, strikeThrough: false, h2: false, blockquote: false, ul: false, ol: false, link: false };
const BLOCKS = "p, div, h1, h2, h3, li, blockquote";

export function RichTextEditor({ defaultValue = "", onChange, placeholder = "Start writing…", label = "Document", minHeight = 180, className }: RichTextEditorProps) {
  const ed = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(EMPTY);
  const [words, setWords] = useState(0);
  const [empty, setEmpty] = useState(true);
  const [linking, setLinking] = useState<{ range: Range; url: string } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  const read = () => {
    const el = ed.current;
    if (!el) return;
    const text = el.innerText.trim();
    setWords(text ? text.split(/\s+/).length : 0);
    setEmpty(!text && !el.querySelector("li, blockquote, h2"));
    onChange?.(el.innerHTML, text);
  };

  useEffect(() => {
    const el = ed.current!;
    el.innerHTML = defaultValue || "<p><br></p>";
    read();
    const onSel = () => {
      const sel = document.getSelection();
      if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return;
      const block = String(document.queryCommandValue("formatBlock")).toLowerCase();
      const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      setState({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        strikeThrough: document.queryCommandState("strikeThrough"),
        h2: block === "h2",
        blockquote: block === "blockquote" || !!node?.closest("blockquote"),
        ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
        link: !!node?.closest("a"),
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const run = (cmd: string, arg?: string) => {
    ed.current?.focus();
    document.execCommand(cmd, false, arg);
    read();
    document.dispatchEvent(new Event("selectionchange"));
  };
  const block = (tag: "h2" | "blockquote") => run("formatBlock", state[tag] ? "p" : tag);

  const openLink = () => {
    const sel = document.getSelection();
    if (!sel?.rangeCount || !ed.current?.contains(sel.anchorNode)) return;
    if (state.link) return run("unlink");
    setLinking({ range: sel.getRangeAt(0).cloneRange(), url: "" });
    requestAnimationFrame(() => linkInput.current?.focus());
  };
  const applyLink = () => {
    if (!linking) return;
    const url = linking.url.trim();
    const sel = document.getSelection();
    ed.current?.focus();
    sel?.removeAllRanges();
    sel?.addRange(linking.range);
    if (url) {
      const href = /^(https?:|mailto:|\/|#)/.test(url) ? url : `https://${url}`;
      if (linking.range.collapsed) run("insertHTML", `<a href="${href.replace(/"/g, "&quot;")}">${url.replace(/</g, "&lt;")}</a>`);
      else run("createLink", href);
      feedback.play("pop", 2);
    }
    setLinking(null);
  };

  // Markdown at the start of a line: the prefix and a space become the format.
  const markdown = () => {
    const sel = document.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return false;
    const node = sel.anchorNode;
    const blockEl = (node instanceof Element ? node : node?.parentElement)?.closest(BLOCKS);
    if (!blockEl || !ed.current?.contains(blockEl) || blockEl.closest("li")) return false;
    const r = document.createRange();
    r.setStart(blockEl, 0);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    const prefix = r.toString();
    const action = ({ "#": ["formatBlock", "h2"], "##": ["formatBlock", "h2"], ">": ["formatBlock", "blockquote"], "-": ["insertUnorderedList"], "*": ["insertUnorderedList"], "1.": ["insertOrderedList"] } as Record<string, string[]>)[prefix];
    if (!action) return false;
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand("delete");
    run(action[0], action[1]);
    return true;
  };

  const tools: Array<{ id: keyof State; label: string; icon: ReactNode; key?: string; act: () => void } | "sep"> = [
    { id: "bold", label: "Bold", icon: I.bold, key: "⌘B", act: () => run("bold") },
    { id: "italic", label: "Italic", icon: I.italic, key: "⌘I", act: () => run("italic") },
    { id: "strikeThrough", label: "Strikethrough", icon: I.strike, act: () => run("strikeThrough") },
    "sep",
    { id: "h2", label: "Heading", icon: I.heading, key: "#", act: () => block("h2") },
    { id: "blockquote", label: "Quote", icon: I.quote, key: ">", act: () => block("blockquote") },
    { id: "ul", label: "Bulleted list", icon: I.ul, key: "-", act: () => run("insertUnorderedList") },
    { id: "ol", label: "Numbered list", icon: I.ol, key: "1.", act: () => run("insertOrderedList") },
    "sep",
    { id: "link", label: state.link ? "Remove link" : "Link", icon: I.link, key: "⌘K", act: openLink },
  ];

  return (
    <div className={cx("l-rte l-frame", className)}>
      {/* Mouse down on a tool would steal the selection; keep it in the page. */}
      <div className="l-frame-strip l-rte__bar" role="toolbar" aria-label="Formatting" onMouseDown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}>
        <span className="l-rte__tools">
          {tools.map((t, i) =>
            t === "sep" ? (
              <span key={`s${i}`} className="l-rte__sep" aria-hidden />
            ) : (
              <ActionButton key={t.id} size="sm" icon={t.icon} label={t.label} shortcut={t.key} pressed={state[t.id]} onPressedChange={t.act} />
            ),
          )}
        </span>
        <span className="l-rte__count" key={words} aria-live="off">
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
      <div className="l-frame-card l-rte__card">
        <div
          ref={ed}
          className="l-rte__page"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label={label}
          data-empty={empty || undefined}
          data-placeholder={placeholder}
          style={{ minHeight }}
          onFocus={() => document.execCommand("defaultParagraphSeparator", false, "p")}
          onInput={read}
          onKeyDown={(e) => {
            const mod = e.metaKey || e.ctrlKey;
            if (e.key === " " && markdown()) e.preventDefault();
            else if (mod && e.key.toLowerCase() === "k") {
              e.preventDefault();
              openLink();
            } else if (mod && e.shiftKey && e.key.toLowerCase() === "x") {
              e.preventDefault();
              run("strikeThrough");
            }
          }}
          onPaste={(e) => {
            // Paste as text: formatting from elsewhere rarely belongs here.
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
        />
        {linking && (
          <div className="l-rte__link l-glass">
            <input
              ref={linkInput}
              placeholder="Paste or type a link"
              aria-label="Link address"
              value={linking.url}
              onChange={(e) => setLinking({ ...linking, url: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setLinking(null);
                  ed.current?.focus();
                }
              }}
              onBlur={() => setLinking(null)}
            />
            <kbd className="l-rte__enter">↩</kbd>
          </div>
        )}
      </div>
    </div>
  );
}
