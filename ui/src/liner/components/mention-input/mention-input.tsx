/*
  Liner · Mention input
  Type @ and the people who match appear in a glass list right at the caret. Picking one
  writes @handle, which reads as a mention from then on. Under the hood it is a plain
  textarea over a mirror that draws the styled text, so typing, selection and undo are
  all native.
*/
import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { useRoving } from "../../lib/overlay";
import "../../lib/field.css";
import "./mention-input.css";

export type MentionPerson = { id: string; name: string; handle: string; hint?: string };
export type MentionInputProps = {
  people: MentionPerson[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (text: string, mentioned: MentionPerson[]) => void;
  onSubmit?: (text: string) => void;
  label?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
};

type Query = { at: number; text: string };

export function MentionInput({ people, value, defaultValue = "", onValueChange, onSubmit, label, placeholder = "Write a comment, @ to mention", rows = 3, className }: MentionInputProps) {
  const id = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const text = controlled ? value : inner;
  const [query, setQuery] = useState<Query | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const byHandle = useMemo(() => new Map(people.map((p) => [p.handle.toLowerCase(), p])), [people]);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return people.filter((p) => p.handle.toLowerCase().startsWith(q) || p.name.toLowerCase().split(" ").some((w) => w.startsWith(q))).slice(0, 6);
  }, [query, people]);
  const open = !!query && matches.length > 0;

  const mentioned = (t: string) => {
    const seen = new Map<string, MentionPerson>();
    for (const m of t.matchAll(/@([\w.-]+)/g)) {
      const p = byHandle.get(m[1].toLowerCase());
      if (p) seen.set(p.id, p);
    }
    return [...seen.values()];
  };
  const set = (t: string) => {
    if (!controlled) setInner(t);
    onValueChange?.(t, mentioned(t));
  };

  // What is being typed after an @, if the caret is in one.
  const readQuery = () => {
    const el = area.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setQuery(null);
    const before = el.value.slice(0, el.selectionStart);
    const m = /(^|\s)@([\w.-]{0,24})$/.exec(before);
    setQuery(m ? { at: before.length - m[2].length - 1, text: m[2] } : null);
  };

  // Place the list under the @, measured from the mirror, which wraps exactly like the textarea.
  useLayoutEffect(() => {
    if (!query) return setPos(null);
    const anchor = mirror.current?.querySelector<HTMLElement>("[data-anchor]");
    const el = area.current;
    if (!anchor || !el) return;
    setPos({ x: Math.min(anchor.offsetLeft, el.clientWidth - 240), y: anchor.offsetTop + anchor.offsetHeight - el.scrollTop });
  }, [query?.at, text]);

  const pick = (i: number) => {
    const p = matches[i];
    const el = area.current;
    if (!p || !el || !query) return;
    const end = query.at + 1 + query.text.length;
    const insert = `@${p.handle} `;
    const next = text.slice(0, query.at) + insert + text.slice(end);
    set(next);
    setQuery(null);
    feedback.play("tick", 4);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(query.at + insert.length, query.at + insert.length);
    });
  };
  const nav = useRoving({ count: matches.length, onPick: pick, onEscape: () => setQuery(null) });

  // The mirror: same text, with known mentions styled and an anchor at the open @.
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/@([\w.-]+)/g)) {
    const at = m.index!;
    if (byHandle.has(m[1].toLowerCase())) {
      parts.push(text.slice(last, at));
      parts.push(
        <span key={at} className="l-mention__tag">
          {m[0]}
        </span>,
      );
      last = at + m[0].length;
    }
  }
  parts.push(text.slice(last));
  const mirrored: ReactNode[] = [];
  if (query) {
    // Split again at the @ being typed so the anchor sits right there.
    let offset = 0;
    let placed = false;
    parts.forEach((part, k) => {
      const len = typeof part === "string" ? part.length : String((part as ReactElement<{ children: string }>).props.children).length;
      if (!placed && typeof part === "string" && query.at >= offset && query.at <= offset + len) {
        mirrored.push(part.slice(0, query.at - offset), <span key="anchor" data-anchor />, part.slice(query.at - offset));
        placed = true;
      } else mirrored.push(<Fragment key={`p${k}`}>{part}</Fragment>);
      offset += len;
    });
  }

  return (
    <div className={cx("l-in l-mention", className)}>
      {label && (
        <label className="l-in-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={box} className="l-in-box l-mention__box" style={{ ["--rows" as string]: rows }}>
        <div ref={mirror} className="l-mention__mirror" aria-hidden>
          {query ? mirrored : parts}
          {"​"}
        </div>
        <textarea
          ref={area}
          id={id}
          value={text}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && nav.active >= 0 ? `${id}-o${nav.active}` : undefined}
          onChange={(e) => {
            set(e.target.value);
            requestAnimationFrame(readQuery);
          }}
          onSelect={readQuery}
          onBlur={() => setTimeout(() => setQuery(null), 120)}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            if (open && ["ArrowDown", "ArrowUp", "Enter", "Escape", "Home", "End"].includes(e.key)) return nav.onKeyDown(e);
            if (open && e.key === "Tab") {
              e.preventDefault();
              return pick(Math.max(0, nav.active));
            }
            if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit(text);
            }
          }}
        />
        {open && pos && (
          <div className="l-pop l-mention__pop" data-side="bottom" style={{ top: pos.y + 6, left: pos.x }}>
            <div className="l-opts" ref={nav.listRef} role="listbox" id={`${id}-list`} aria-label="People">
              {nav.hl && <span className="l-opt-hl" style={{ transform: `translateY(${nav.hl.y}px)`, height: nav.hl.h }} aria-hidden />}
              {matches.map((p, i) => (
                <div
                  key={p.id}
                  id={`${id}-o${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={nav.active === i}
                  className="l-opt"
                  data-active={nav.active === i || undefined}
                  onPointerMove={() => nav.active !== i && nav.setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                >
                  <span className="l-mention__avatar" aria-hidden>
                    {p.name
                      .split(" ")
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span className="l-opt-text">
                    <span className="l-opt-label">{p.name}</span>
                    <span className="l-opt-hint">@{p.handle}{p.hint ? ` · ${p.hint}` : ""}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
