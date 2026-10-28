/*
  Liner · Payment method
  The card on file as one row: a quiet mark for its network, the last four digits, when it
  expires and a button to change it. Marks are drawn in ink, like everything else; a card
  close to expiry says so with a small amber badge, an expired one in red.
*/
import { cx } from "../../lib/hooks";
import { Badge } from "../badge/badge";
import { Button } from "../button/button";
import { ListItem } from "../list-item/list-item";
import "./payment-method.css";

export type CardBrandName = "visa" | "mastercard" | "amex" | "discover" | "card";
export type PaymentMethodProps = {
  brand: CardBrandName;
  last4: string;
  /** MM/YYYY. */
  expires: string;
  updateLabel?: string;
  onUpdate?: () => void;
  /** Months before expiry when the warning shows. */
  warnMonths?: number;
  className?: string;
};

const NAMES: Record<CardBrandName, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", card: "Card" };

/** A card network's mark, monochrome, 40 by 28. */
export function CardBrand({ brand, className }: { brand: CardBrandName; className?: string }) {
  return (
    <span className={cx("l-cbrand", className)} data-brand={brand} role="img" aria-label={NAMES[brand]}>
      {brand === "visa" ? (
        <b>VISA</b>
      ) : brand === "mastercard" ? (
        <svg viewBox="0 0 28 18" aria-hidden>
          <circle cx="10.5" cy="9" r="6.5" />
          <circle cx="17.5" cy="9" r="6.5" />
        </svg>
      ) : brand === "amex" ? (
        <b>AMEX</b>
      ) : brand === "discover" ? (
        <b>
          DISC<i />
          VER
        </b>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="1.75" y="3.5" width="12.5" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.75 6.5h12.5M4.5 10h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

export function PaymentMethod({ brand, last4, expires, updateLabel = "Update", onUpdate, warnMonths = 2, className }: PaymentMethodProps) {
  const [mm, yyyy] = expires.split("/").map(Number);
  const now = new Date();
  const left = (yyyy - now.getFullYear()) * 12 + (mm - (now.getMonth() + 1));
  const state = !mm || !yyyy ? "ok" : left < 0 ? "expired" : left < warnMonths ? "soon" : "ok";
  return (
    <ListItem
      className={cx("l-paym", className)}
      leading={<CardBrand brand={brand} />}
      title={
        <>
          {NAMES[brand]} <span className="l-paym__dots">••••</span> {last4}
        </>
      }
      description={
        <span className="l-paym__exp">
          {state === "expired" ? "Expired" : "Expires"} {expires}
          {state !== "ok" && (
            <Badge size="sm" tone={state === "expired" ? "danger" : "warning"}>
              {state === "expired" ? "Update it" : "Soon"}
            </Badge>
          )}
        </span>
      }
      trailing={
        <Button
          size="sm"
          variant="secondary"
          onClick={onUpdate}
          icon={
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.75" y="3.5" width="12.5" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M1.75 6.5h12.5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          }
        >
          {updateLabel}
        </Button>
      }
    />
  );
}
