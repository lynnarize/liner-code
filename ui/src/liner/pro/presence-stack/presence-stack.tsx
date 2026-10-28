/*
  Liner Pro · Presence stack
  Who is here right now. Faces join the stack with a soft ring that settles, and blur away
  when someone leaves. A line says it in words, and the stack opens into a glass list of
  who is viewing, who is editing, and who is typing.
*/
import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { useDismiss } from "../../lib/overlay";
import { Avatar } from "../../components/avatar/avatar";
import "./presence-stack.css";

export type Presence = { id: string; name: string; src?: string; activity?: "viewing" | "editing" | "typing" };
export type PresenceStackProps = { people: Presence[]; max?: number; size?: number; className?: string };

type Live = Presence & { leaving?: boolean; joined?: boolean };

export function PresenceStack({ people, max = 4, size = 30, className }: PresenceStackProps) {
  const [list, setList] = useState<Live[]>(people);
  const first = useRef(true);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), [wrap], btn);

  // Keep people who just left for a moment, so they can blur away instead of vanishing.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setList((cur) => {
      const ids = new Set(people.map((p) => p.id));
      const stay = cur.filter((p) => !p.leaving || ids.has(p.id)).map((p) => (ids.has(p.id) ? { ...p, ...people.find((q) => q.id === p.id)!, leaving: false } : { ...p, leaving: true }));
      const added = people.filter((p) => !cur.some((c) => c.id === p.id)).map((p) => ({ ...p, joined: true }));
      return [...added, ...stay];
    });
    const t = window.setTimeout(() => setList((cur) => cur.filter((p) => !p.leaving)), 360);
    return () => window.clearTimeout(t);
  }, [people]);

  const here = list.filter((p) => !p.leaving);
  const shown = list.slice(0, max);
  const rest = here.length - shown.filter((p) => !p.leaving).length;
  const typing = here.filter((p) => p.activity === "typing");
  const line =
    here.length === 0
      ? "Just you"
      : typing.length
        ? `${typing[0].name.split(" ")[0]}${typing.length > 1 ? ` and ${typing.length - 1} more` : ""} typing`
        : here.length === 1
          ? `${here[0].name.split(" ")[0]} is here`
          : `${here[0].name.split(" ")[0]} and ${here.length - 1} ${here.length === 2 ? "other" : "others"} here`;

  return (
    <div ref={wrap} className={cx("l-anchor l-presence", className)} style={{ ["--av" as string]: `${size}px` }}>
      <button ref={btn} type="button" className="l-presence__btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`${here.length} people here. Show who`} onClick={() => setOpen((o) => !o)}>
        <span className="l-presence__stack">
          {shown.map((p, i) => (
            <span key={p.id} className="l-presence__face" data-leaving={p.leaving || undefined} data-joined={p.joined || undefined} data-activity={p.activity} style={{ zIndex: shown.length - i }}>
              <Avatar name={p.name} src={p.src} size={size} />
            </span>
          ))}
          {rest > 0 && <span className="l-presence__face l-presence__more">+{rest}</span>}
        </span>
        <span className="l-presence__line" key={line} data-typing={typing.length > 0 || undefined} aria-live="polite">
          {line}
        </span>
      </button>
      {open && (
        <div className="l-pop l-presence__pop" data-side="bottom" data-align="end" role="dialog" aria-label="People here">
          <div className="l-presence__head">{here.length} here now</div>
          <ul>
            {here.map((p) => (
              <li key={p.id}>
                <Avatar name={p.name} src={p.src} size={28} status="online" />
                <span>{p.name}</span>
                <em data-activity={p.activity ?? "viewing"}>{p.activity ?? "viewing"}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
