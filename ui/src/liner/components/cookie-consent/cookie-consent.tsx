/*
  Liner · Cookie consent
  Asked once, plainly, on glass at the bottom. Rejecting is as easy as accepting, nothing
  optional starts switched on, and Customize opens the categories in place.
*/
import { useState } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Button } from "../button/button";
import { Switch } from "../switch/switch";
import "./cookie-consent.css";

export type CookieCategory = { id: string; label: string; description: string; required?: boolean };
export type CookieChoice = Record<string, boolean>;
export type CookieConsentProps = {
  categories?: CookieCategory[];
  onDecide: (choice: CookieChoice) => void;
  policyHref?: string;
  /** Pin to the bottom of the window instead of sitting in the flow. */
  fixed?: boolean;
  className?: string;
};

const DEFAULTS: CookieCategory[] = [
  { id: "necessary", label: "Necessary", description: "Sign-in, security and your settings. Always on.", required: true },
  { id: "analytics", label: "Analytics", description: "Anonymous counts that show us what to improve." },
  { id: "marketing", label: "Marketing", description: "Measuring campaigns on other sites." },
];

export function CookieConsent({ categories = DEFAULTS, onDecide, policyHref = "#", fixed, className }: CookieConsentProps) {
  const [custom, setCustom] = useState(false);
  const [choice, setChoice] = useState<CookieChoice>(() => Object.fromEntries(categories.map((c) => [c.id, !!c.required])));
  const [done, setDone] = useState(false);
  const decide = (c: CookieChoice) => {
    setDone(true);
    feedback.play("tap", 2);
    window.setTimeout(() => onDecide(c), 260);
  };
  const all = (on: boolean) => Object.fromEntries(categories.map((c) => [c.id, c.required ? true : on]));
  return (
    <section className={cx("l-cookie l-frame l-frame-float", className)} data-fixed={fixed || undefined} data-done={done || undefined} aria-label="Cookie preferences">
      <div className="l-frame-card l-cookie__card">
        <b className="l-cookie__title">Cookies, briefly</b>
        <p className="l-cookie__text">
          We use a few to keep you signed in. With your OK we also measure what helps. <a href={policyHref}>Our policy</a>
        </p>
        <div className="l-cookie__more" data-open={custom || undefined} inert={!custom || undefined}>
          <div className="l-cookie__clip">
            <ul className="l-cookie__list">
              {categories.map((c) => (
                <li key={c.id}>
                  <Switch label={c.label} description={c.description} size="sm" checked={choice[c.id]} disabled={c.required} onCheckedChange={(on) => setChoice((x) => ({ ...x, [c.id]: on }))} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="l-frame-strip l-cookie__strip">
        <Button variant="ghost" size="sm" onClick={() => (custom ? decide(choice) : setCustom(true))}>
          <span key={String(custom)}>{custom ? "Save choices" : "Customize"}</span>
        </Button>
        <span className="l-cookie__main">
          <Button variant="secondary" size="sm" onClick={() => decide(all(false))}>
            Reject all
          </Button>
          <Button size="sm" onClick={() => decide(all(true))}>
            Accept all
          </Button>
        </span>
      </div>
    </section>
  );
}
