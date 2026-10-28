/*
  Liner · Avatar and Avatar group
  A person as a photo or their initials on a quiet grey, never a color per name. A small
  mark at the corner can say whether they are here. Groups overlap and fan out when the
  pointer comes near, so every face can be seen and named.
*/
import { useState, type CSSProperties } from "react";
import { cx } from "../../lib/hooks";
import "./avatar.css";

export type AvatarProps = {
  name: string;
  src?: string;
  size?: number;
  status?: "online" | "away" | "busy" | "offline";
  /** Rounded square, for teams and workspaces. */
  square?: boolean;
  className?: string;
  style?: CSSProperties;
};

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function Avatar({ name, src, size = 36, status, square, className, style }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cx("l-avatar", className)} data-square={square || undefined} style={{ ["--av" as string]: `${size}px`, ...style }} role="img" aria-label={status ? `${name}, ${status}` : name}>
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <span aria-hidden>{initialsOf(name)}</span>}
      {status && <i className="l-avatar__status" data-status={status} aria-hidden />}
    </span>
  );
}

export type AvatarGroupProps = {
  people: { name: string; src?: string }[];
  max?: number;
  size?: number;
  className?: string;
};

export function AvatarGroup({ people, max = 4, size = 34, className }: AvatarGroupProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const [tip, setTip] = useState<number | null>(null);
  return (
    <div className={cx("l-avgroup", className)} style={{ ["--av" as string]: `${size}px` }} role="group" aria-label={`${people.length} people: ${people.map((p) => p.name).join(", ")}`}>
      {shown.map((p, i) => (
        <span key={p.name} className="l-avgroup__item" style={{ zIndex: shown.length - i }} onPointerEnter={() => setTip(i)} onPointerLeave={() => setTip(null)}>
          <Avatar name={p.name} src={p.src} size={size} />
          {tip === i && (
            <span className="l-avgroup__tip l-glass" aria-hidden>
              {p.name}
            </span>
          )}
        </span>
      ))}
      {rest > 0 && (
        <span className="l-avgroup__item l-avgroup__more" aria-hidden title={people.slice(max).map((p) => p.name).join(", ")}>
          +{rest}
        </span>
      )}
    </div>
  );
}
