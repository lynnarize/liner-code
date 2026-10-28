/*
  Liner Pro · Approval card
  An agent asking before it acts, in its own words: who wants to do what, how risky it is,
  and exactly what will go out, as plain rows. Low and medium risk approve with a press;
  high risk asks you to hold, so nothing far-reaching happens by a stray click. Saying no
  asks, in one line, what to do instead. The card glides to each new height.
*/
import { useRef, useState, type ReactNode } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Button } from "../../components/button/button";
import { Badge } from "../../components/badge/badge";
import { HoldToConfirm } from "../../components/hold-to-confirm/hold-to-confirm";
import "./approval-card.css";

export type ApprovalField = { label: string; value: ReactNode };
export type ApprovalState = "asking" | "approving" | "approved" | "explaining" | "denying" | "denied";
export type ApprovalCardProps = {
  /** What it wants to do: "Publish the changelog". */
  title: string;
  /** Who is asking, by name. */
  agent?: string;
  description?: string;
  icon?: ReactNode;
  /** High risk approves with a hold instead of a press. */
  risk?: "low" | "medium" | "high";
  /** Exactly what will happen: where, when, to whom. */
  fields?: ApprovalField[];
  approveLabel?: string;
  denyLabel?: string;
  onApprove?: () => Promise<void> | void;
  /** Receives what to do instead, possibly empty. */
  onDeny?: (reason: string) => Promise<void> | void;
  approvedText?: string;
  deniedText?: string;
  className?: string;
};

const RISK = { low: ["neutral", "Low risk"], medium: ["warning", "Medium risk"], high: ["danger", "High risk"] } as const;

export function ApprovalCard({
  title,
  agent,
  description,
  icon,
  risk,
  fields = [],
  approveLabel,
  denyLabel = "Not now",
  onApprove,
  onDeny,
  approvedText = "Approved. It's on its way.",
  deniedText = "Sent back with your note.",
  className,
}: ApprovalCardProps) {
  const [state, setState] = useState<ApprovalState>("asking");
  const [reason, setReason] = useState("");
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useIsoLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A failed call puts the question back, so nothing is lost.
  const approve = async () => {
    setState("approving");
    try {
      await onApprove?.();
      setState("approved");
      feedback.play("success");
    } catch {
      setState("asking");
      feedback.play("error");
    }
  };
  const deny = async () => {
    setState("denying");
    try {
      await onDeny?.(reason.trim());
      setState("denied");
      feedback.play("tap", -2);
    } catch {
      setState("explaining");
      feedback.play("error");
    }
  };
  const settled = state === "approved" || state === "denied";
  const asking = state === "explaining" || state === "denying";
  const hold = risk === "high";

  return (
    <section className={cx("l-appr l-frame", className)} data-state={state} aria-label={`${agent ?? "An agent"} asks to ${title.toLowerCase()}`}>
      <div className="l-frame-card l-appr__card" style={{ height: h ?? undefined }}>
        <div ref={inner}>
          {settled ? (
            <div className="l-appr__receipt" key={state} role="status">
              <span className="l-appr__tick" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none">
                  {state === "approved" ? <path d="M4.4 8.3 7 10.8l4.7-5.1" pathLength="1" /> : <path d="m5.2 5.2 5.6 5.6m0-5.6-5.6 5.6" pathLength="1" />}
                </svg>
              </span>
              <div>
                <b>{state === "approved" ? approvedText : deniedText}</b>
                <span>{title}</span>
              </div>
            </div>
          ) : (
            <div className="l-appr__ask" key="ask">
              <div className="l-appr__head">
                {icon && (
                  <span className="l-appr__icon" aria-hidden>
                    {icon}
                  </span>
                )}
                <div className="l-appr__titles">
                  <span>{agent ? `${agent} asks to` : "Asks to"}</span>
                  <b>{title}</b>
                </div>
                {risk && (
                  <Badge size="sm" tone={RISK[risk][0]} dot>
                    {RISK[risk][1]}
                  </Badge>
                )}
              </div>
              {description && <p className="l-appr__desc">{description}</p>}
              {fields.length > 0 && (
                <dl className="l-appr__fields">
                  {fields.map((f) => (
                    <div key={f.label}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {asking && (
                <label className="l-appr__why">
                  <span>{agent ? `What should ${agent} do instead?` : "What should it do instead?"}</span>
                  <textarea
                    value={reason}
                    rows={2}
                    autoFocus
                    placeholder="Optional. You can send it back without a note."
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) deny();
                      if (e.key === "Escape") setState("asking");
                    }}
                  />
                </label>
              )}
              <div className="l-appr__actions">
                {asking ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setState("asking")} disabled={state === "denying"}>
                      Back
                    </Button>
                    <Button size="sm" variant="secondary" loading={state === "denying"} onClick={deny}>
                      Send back
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setState("explaining")} disabled={state === "approving"}>
                      {denyLabel}
                    </Button>
                    {hold ? (
                      <HoldToConfirm duration={900} resetAfter={null} onConfirm={approve} hintLabel="Keep holding">
                        {approveLabel ?? "Hold to approve"}
                      </HoldToConfirm>
                    ) : (
                      <Button size="sm" loading={state === "approving"} onClick={approve}>
                        {approveLabel ?? "Approve"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
