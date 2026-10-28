/*
  Liner Pro · Share access
  Everything about who can open a thing, in one card: invite by email with a role, change
  or remove anyone's access, and decide what the link does. Changes land in place; new
  people come into focus at the top of the list.
*/
import { useId, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { DropdownMenu } from "../../components/menu/menu";
import { Button } from "../../components/button/button";
import { CopyButton } from "../../components/copy-button/copy-button";
import "./share-access.css";

export type ShareRole = "view" | "comment" | "edit";
export type SharePerson = { id: string; name: string; email: string; role: ShareRole | "owner"; pending?: boolean };
export type LinkAccess = "restricted" | "anyone";
export type ShareAccessProps = {
  title: string;
  people: SharePerson[];
  onPeopleChange?: (people: SharePerson[]) => void;
  link: string;
  linkAccess?: LinkAccess;
  onLinkAccessChange?: (access: LinkAccess) => void;
  onDone?: () => void;
  className?: string;
};

const ROLES: Record<ShareRole, string> = { view: "Can view", comment: "Can comment", edit: "Can edit" };
const CHECK = (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function RoleMenu({ role, onRole, onRemove, label }: { role: ShareRole; onRole: (r: ShareRole) => void; onRemove?: () => void; label: string }) {
  return (
    <DropdownMenu
      label={label}
      align="end"
      className="l-share__role"
      trigger={
        <>
          <span key={role}>{ROLES[role]}</span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-menu-chev">
            <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      }
      items={[
        ...(Object.keys(ROLES) as ShareRole[]).map((r) => ({ id: r, label: ROLES[r], icon: r === role ? CHECK : <span />, onSelect: () => onRole(r) })),
        ...(onRemove ? [{ type: "separator" as const, id: "sep" }, { id: "remove", label: "Remove access", danger: true, onSelect: onRemove }] : []),
      ]}
    />
  );
}

const initials = (n: string) =>
  n
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function ShareAccess({ title, people: initial, onPeopleChange, link, linkAccess = "restricted", onLinkAccessChange, onDone, className }: ShareAccessProps) {
  const id = useId();
  const [people, setPeople] = useState(initial);
  const [draft, setDraft] = useState("");
  const [invites, setInvites] = useState<string[]>([]);
  const [role, setRole] = useState<ShareRole>("edit");
  const [access, setAccess] = useState(linkAccess);
  const [linkRole, setLinkRole] = useState<ShareRole>("view");
  const [error, setError] = useState<string | null>(null);

  const update = (next: SharePerson[]) => {
    setPeople(next);
    onPeopleChange?.(next);
  };
  const addDraft = () => {
    const parts = draft
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return true;
    const bad = parts.find((p) => !isEmail(p));
    if (bad) {
      setError(`“${bad}” isn't an email address`);
      feedback.play("error");
      return false;
    }
    setInvites((x) => [...x, ...parts.filter((p) => !x.includes(p) && !people.some((q) => q.email === p))]);
    setDraft("");
    setError(null);
    return true;
  };
  const invite = () => {
    if (!addDraft()) return;
    const emails = [...invites, ...(isEmail(draft.trim()) ? [draft.trim()] : [])];
    if (!emails.length) return;
    const added = emails.map((e) => ({ id: `${e}-${Date.now()}`, name: e.split("@")[0].replace(/[._]/g, " "), email: e, role, pending: true }));
    update([...added, ...people]);
    setInvites([]);
    setDraft("");
    feedback.play("success");
  };

  const accessIcon: Record<LinkAccess, ReactNode> = {
    restricted: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
        <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.75" />
        <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
      </svg>
    ),
    anyone: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M2.25 8h11.5M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75M8 2.25C6.4 3.85 5.6 5.75 5.6 8s.8 4.15 2.4 5.75" />
      </svg>
    ),
  };

  return (
    <section className={cx("l-share l-frame", className)} aria-labelledby={`${id}-t`}>
      <div className="l-frame-card l-share__card">
        <h3 id={`${id}-t`} className="l-share__title">
          Share “{title}”
        </h3>
        <div className="l-share__invite">
          <div className="l-share__field" data-invalid={error ? "" : undefined} onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
            {invites.map((e) => (
              <span key={e} className="l-share__chip">
                {e}
                <button type="button" aria-label={`Remove ${e}`} onClick={() => setInvites((x) => x.filter((y) => y !== e))}>
                  ×
                </button>
              </span>
            ))}
            <input
              aria-label="Add people by email"
              placeholder={invites.length ? "" : "Add people by email"}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === " ") {
                  if (!draft.trim()) {
                    if (e.key === "Enter") invite();
                    return;
                  }
                  e.preventDefault();
                  addDraft();
                } else if (e.key === "Backspace" && !draft && invites.length) setInvites((x) => x.slice(0, -1));
              }}
              onBlur={() => draft.trim() && addDraft()}
            />
            {(invites.length > 0 || draft) && <RoleMenu label="Role for invited people" role={role} onRole={setRole} />}
          </div>
          <Button size="sm" disabled={!invites.length && !isEmail(draft.trim())} onClick={invite}>
            Invite
          </Button>
        </div>
        {error && (
          <span className="l-share__error" role="alert" key={error}>
            {error}
          </span>
        )}
        <div className="l-share__label">People with access</div>
        <ul className="l-share__people">
          {people.map((p) => (
            <li key={p.id}>
              <span className="l-share__avatar" aria-hidden>
                {initials(p.name)}
              </span>
              <span className="l-share__who">
                <b>
                  {p.name}
                  {p.pending && <em>Invited</em>}
                </b>
                <span>{p.email}</span>
              </span>
              {p.role === "owner" ? (
                <span className="l-share__owner">Owner</span>
              ) : (
                <RoleMenu
                  label={`Access for ${p.name}`}
                  role={p.role}
                  onRole={(r) => update(people.map((q) => (q.id === p.id ? { ...q, role: r } : q)))}
                  onRemove={() => update(people.filter((q) => q.id !== p.id))}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="l-share__label">General access</div>
        <div className="l-share__general">
          <span className="l-share__gicon" data-access={access} key={access}>
            {accessIcon[access]}
          </span>
          <span className="l-share__gtext">
            <DropdownMenu
              label="Link access"
              className="l-share__access"
              trigger={
                <>
                  <span key={access}>{access === "anyone" ? "Anyone with the link" : "Restricted"}</span>
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden className="l-menu-chev">
                    <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              }
              items={(["restricted", "anyone"] as LinkAccess[]).map((a) => ({
                id: a,
                label: a === "anyone" ? "Anyone with the link" : "Restricted",
                hint: a === "anyone" ? "No sign-in needed" : "Only people added above",
                icon: accessIcon[a],
                onSelect: () => {
                  setAccess(a);
                  onLinkAccessChange?.(a);
                },
              }))}
            />
            <span className="l-share__ghint" key={access}>
              {access === "anyone" ? "Anyone on the internet with the link" : "Only people with access can open it"}
            </span>
          </span>
          {access === "anyone" && <RoleMenu label="Role for link" role={linkRole} onRole={setLinkRole} />}
        </div>
      </div>
      <div className="l-frame-strip l-share__strip">
        <CopyButton value={link} label="Copy link" copiedLabel="Link copied" size="sm" variant="ghost" />
        <Button size="sm" variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
