/*
  Liner Pro · Agent feed
  One agent making the case for one decision. Everything that has to hold is a claim the
  agent checks in turn, and each comes back with its proof: a count that fills, a detour
  when someone has to help, the evidence in a line, or what fails when it doesn't hold. The
  one thing left for you waits on the glass under the card, where the PR flow keeps its one
  press too, and a question about a claim is answered right under that claim. Live, the
  checks arrive from your data and the press is yours to carry out.
*/
import { useEffect, useState, type ReactNode } from "react";
import { cx, useSeen } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Button } from "../../components/button/button";
import { StreamedMarkdown } from "../ai-kit/streamed";
import { Rays } from "../ai-kit/marks";
import { AskLine, AgentAvatar, Who, sampleAgents, useStickToBottom, type Agent } from "../agents/agents";
import "../ai-kit/ai-kit.css";
import "./agent-feed.css";

export type FeedCheck = {
  id: string;
  /** What has to hold, said as a claim: "Usage matches the bill". */
  claim: string;
  /** The evidence once it holds. */
  proof: string;
  /** Things to count while checking, like usage reports. */
  count?: number;
  /** Where the count stalls because someone has to help: after `at` items, waiting on `who`. */
  detour?: { at: number; text: string; who: string; then: string };
  /** The claim that holds once you decide: what it says until then, and after. */
  yours?: { ask: string; then: string };
  /** What it says when the claim doesn't hold (mark "failed"). */
  fail?: string;
  /** Live only: how the claim stands now, and how many of `count` are in. */
  mark?: FeedMark;
  n?: number;
};
export type FeedDecision = {
  title: string;
  amount: string;
  sub: string;
  act: string;
  receipt: string;
  receiptDetail: string;
  held?: string;
  /** The press once you've held it, like "Pay now instead". Defaults to `act`. */
  again?: string;
};
export type FeedQuestion = { q: string; /** Left out, the question goes to `ask`. */ a?: string; reading?: string; /** The claim it is about; the answer opens under it. */ about?: string };

export type AgentFeedProps = {
  agent?: Agent;
  checks?: FeedCheck[];
  decision?: FeedDecision;
  questions?: FeedQuestion[];
  /** Answer free-form questions, and the ones about a claim (`about` is its id). Resolve with the reply text. */
  ask?: (question: string, about?: string) => Promise<string>;
  placeholder?: string;
  /** Check the claims one by one, as if live. */
  autoPlay?: boolean;
  /**
    Live data: each check says how it stands (`mark`, `n`), nothing plays by itself, and the
    press is yours to carry out in `onDecide`.
  */
  live?: boolean;
  /** The one press. The button waits while it runs; resolve to show the receipt, throw to stay. */
  onDecide?: () => unknown;
  /** Not yet. */
  onHold?: () => void;
  className?: string;
};

const sampleChecks: FeedCheck[] = [
  { id: "real", claim: "The invoice is genuine", proof: "Signed by Nimbus and sent from billing@nimbus.dev on 1 November" },
  {
    id: "usage",
    claim: "Usage matches the bill",
    proof: "All 7 regional reports add up to 62,400 compute hours",
    count: 7,
    detour: { at: 5, text: "Two APAC reports are missing. I asked Jonas for them", who: "Jonas", then: "sent the two missing reports" },
  },
  { id: "rate", claim: "The rate is the agreed one", proof: "29.5¢ an hour, fixed in March through December" },
  { id: "sign", claim: "Two people sign it off", proof: "Priya at 08:12, and you", yours: { ask: "Priya signed at 08:12. The second name is yours", then: "Priya at 08:12, you at 09:32" } },
];
const sampleDecision: FeedDecision = {
  title: "Pay Nimbus for October",
  amount: "$18,420.60",
  sub: "Invoice NW-1022 · 62,400 compute hours · from the operating account",
  act: "Pay $18,420.60",
  receipt: "Paid $18,420.60 to Nimbus",
  receiptDetail: "09:32 · reference NW-1022 · filed with October",
  held: "Held. I'll ask again tomorrow at 09:00",
  again: "Pay now instead",
};
const sampleQuestions: FeedQuestion[] = [
  { q: "Why 29.5¢ an hour?", about: "rate", reading: "Reading the contract", a: "It's the rate Nimbus agreed in March, fixed through December. October's 62,400 hours at 29.5¢ come to **$18,420.60**, the invoice to the cent." },
  { q: "Who else signs it off?", about: "sign", reading: "Checking the approval rules", a: "Anything over $10,000 needs two names. **Priya** signed at 08:12, once the reports were in; yours is the second." },
];

export type FeedMark = "pending" | "checking" | "detour" | "waiting" | "passed" | "failed";
type Mark = FeedMark;
type CheckState = { mark: Mark; n: number; helped?: boolean };
type Pay = "waiting" | "paying" | "paid" | "held";
type Qa = { id: number; q: string; a: string; reading: string; about?: string; phase: "reading" | "writing" | "done" };
let seq = 1;

/** Where every claim ends up once the agent has done its part. */
const settled = (checks: FeedCheck[]): CheckState[] => checks.map((c) => ({ mark: c.yours ? "waiting" : "passed", n: c.count ?? 0, helped: !!c.detour }));

export function AgentFeed({
  agent = sampleAgents[0],
  checks = sampleChecks,
  decision = sampleDecision,
  questions = sampleQuestions,
  ask,
  placeholder,
  autoPlay = true,
  live = false,
  onDecide,
  onHold,
  className,
}: AgentFeedProps) {
  const play = autoPlay && !live;
  const [own, setSt] = useState<CheckState[]>(() => (play ? checks.map(() => ({ mark: "pending", n: 0 })) : settled(checks)));
  const [pay, setPay] = useState<Pay>("waiting");
  const [qa, setQa] = useState<Qa[]>([]);
  const [left, setLeft] = useState(questions);
  const [rootRef, seen] = useSeen<HTMLElement>(play);
  const { ref, contentRef, away, jump, stick } = useStickToBottom();
  const busy = qa.some((x) => x.phase !== "done");
  // Live, the checks say how they stand; once you have decided, your own claim holds too.
  const st: CheckState[] = (live ? checks.map((c): CheckState => ({ mark: c.mark ?? "pending", n: c.n ?? 0, helped: c.mark === "checking" && !!c.detour && (c.n ?? 0) > c.detour.at })) : own).map((s, i) => (pay === "paid" && checks[i]?.yours ? { ...s, mark: "passed" } : s));

  // The case, built claim by claim: a count fills, stalls on a detour, then carries on.
  useEffect(() => {
    if (!play || !seen) return;
    const set = (i: number, p: Partial<CheckState>) => setSt((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));
    const steps: Array<[number, () => void]> = [];
    let t = 500;
    checks.forEach((c, i) => {
      steps.push([t, () => set(i, { mark: "checking" })]);
      if (c.count) {
        for (let n = 1; n <= c.count; n++) {
          if (c.detour && n === c.detour.at + 1) {
            steps.push([t, () => set(i, { mark: "detour" })]);
            t += 1900;
            steps.push([t, () => set(i, { mark: "checking", helped: true })]);
            t += 400;
          }
          t += 230;
          steps.push([t, () => set(i, { n })]);
        }
        t += 320;
      } else t += 760;
      steps.push([t, () => set(i, { mark: c.yours ? "waiting" : "passed" })]);
      t += 280;
    });
    const ids = steps.map(([ms, fn]) => window.setTimeout(fn, ms));
    return () => ids.forEach(clearTimeout);
  }, [play, seen]);

  const ready = st.every((s, i) => s.mark === "passed" || s.mark === "failed" || (checks[i].yours && s.mark === "waiting"));
  const passed = st.filter((s) => s.mark === "passed").length;
  const failing = st.filter((s) => s.mark === "failed").length;
  const at = st.findIndex((s) => s.mark !== "passed" && s.mark !== "waiting" && s.mark !== "failed");
  const status = pay === "paid" ? "done" : pay === "held" ? "holding for you" : ready ? "waiting on you" : "checking";

  function askQuestion(q: string, a: Promise<string> | string, reading = "Thinking it through", about?: string) {
    if (busy) return;
    const id = seq++;
    setQa((list) => [...list, { id, q, a: "", reading, about, phase: "reading" }]);
    if (!about) stick();
    feedback.play("tap", 4);
    const answer = Promise.resolve(a).catch((e: unknown) => (e instanceof Error ? e.message : "No answer this time. Ask again in a moment."));
    Promise.all([answer, new Promise((r) => setTimeout(r, 1100))]).then(([text]) => setQa((list) => list.map((x) => (x.id === id ? { ...x, a: text as string, phase: "writing" } : x))));
  }
  const settle = (id: number) => setQa((list) => list.map((x) => (x.id === id ? { ...x, phase: "done" } : x)));
  function payNow() {
    setPay("paying");
    if (live) {
      Promise.resolve(onDecide?.()).then(
        () => {
          setPay("paid");
          feedback.play("success");
        },
        () => setPay("waiting"),
      );
      return;
    }
    window.setTimeout(() => {
      setPay("paid");
      setSt((s) => s.map((x, i) => (checks[i].yours ? { ...x, mark: "passed" } : x)));
      feedback.play("success");
    }, 900);
  }

  const answers = (about?: string) =>
    qa
      .filter((x) => x.about === about)
      .map((x) => (
        <div key={x.id} className="l-feed-qa" data-free={!about || undefined}>
          <span className="l-feed-q">{x.q}</span>
          <div className="l-feed-a">
            <AgentAvatar a={agent} size={18} />
            {x.phase === "reading" ? <span className="l-feed-reading l-shimmer">{x.reading}</span> : <StreamedMarkdown className="l-feed-md" text={x.a} speed={34} onCaughtUp={() => settle(x.id)} />}
          </div>
        </div>
      ));

  return (
    <section ref={rootRef} className={cx("l-feed l-frame", className)} aria-label={`${agent.name}: ${decision.title}`}>
      <div className="l-frame-card l-feed-card">
        <header className="l-feed-head">
          <AgentAvatar a={agent} size={30} status={status === "checking" ? "working" : status === "waiting on you" ? "waiting" : status === "done" ? "done" : undefined} />
          <span className="l-feed-who">
            <b>{decision.title}</b>
            <span>
              {agent.name} ·{" "}
              <span key={status} className="l-feed-state" data-status={status}>
                {status}
              </span>
            </span>
          </span>
          <span className="l-feed-tally l-num" key={passed}>
            {passed} of {checks.length} hold
          </span>
        </header>

        <div className="l-feed-scroll" ref={ref}>
          <div className="l-feed-content" ref={contentRef}>
            <div className="l-feed-case">
              <span className="l-feed-amount l-num">{decision.amount}</span>
              <span className="l-feed-case-sub">{decision.sub}</span>
            </div>

            <ol className="l-feed-checks">
              {checks.map((c, i) => {
                const s = st[i];
                return (
                  <li key={c.id} className="l-feed-check" data-mark={s.mark}>
                    <span className="l-feed-mark" key={s.mark} aria-hidden>
                      <CheckMark mark={s.mark} n={i + 1} />
                    </span>
                    <div className="l-feed-check-body">
                      <span className="l-feed-claim">{c.claim}</span>
                      <Proof c={c} s={s} paid={pay === "paid"} />
                      {!!c.count && (
                        <span className="l-feed-pips" aria-hidden>
                          {Array.from({ length: c.count }, (_, k) => (
                            <i key={k} data-on={k < s.n || undefined} data-missing={(s.mark === "detour" && k >= s.n) || undefined} data-bad={(s.mark === "failed" && k >= s.n) || undefined} />
                          ))}
                        </span>
                      )}
                      {answers(c.id)}
                    </div>
                    <span className="l-sr-only">{s.mark === "passed" ? "Holds" : s.mark === "failed" ? "Doesn't hold" : s.mark === "waiting" ? "Waiting on you" : s.mark === "detour" ? `Waiting on ${c.detour?.who}` : s.mark === "checking" ? "Checking" : "Not checked yet"}</span>
                  </li>
                );
              })}
            </ol>

            {answers(undefined)}

            {ready && left.length > 0 && !busy && (
              <div className="l-feed-chips">
                {left.map((q, i) => (
                  <button
                    key={q.q}
                    type="button"
                    className="l-feed-chip l-focus"
                    style={{ animationDelay: `${i * 70}ms` }}
                    onClick={() => {
                      setLeft((l) => l.filter((x) => x.q !== q.q));
                      askQuestion(q.q, q.a ?? (ask ? ask(q.q, q.about) : "I can't look that up from here."), q.reading, q.about);
                    }}
                  >
                    {q.q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button type="button" className="l-feed-jump l-focus" data-show={away || undefined} tabIndex={away ? 0 : -1} aria-label="Jump to latest" onClick={jump}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 3.25v9.5M4.1 8.9 8 12.8l3.9-3.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Where it stands, and the one press that is yours, on the glass under the case. */}
      <div className="l-frame-strip l-feed-decide" role="status">
        {pay === "paid" ? (
          <span className="l-feed-receipt" key="paid">
            <span className="l-feed-tick" aria-hidden>
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M4.6 8.3 7 10.6l4.5-4.9" pathLength="1" />
              </svg>
            </span>
            <span>
              <b>{decision.receipt}</b>
              <span>{decision.receiptDetail}</span>
            </span>
          </span>
        ) : ready ? (
          <>
            <span className="l-feed-now" key={`${pay}${failing}`}>
              {pay === "held" ? (
                decision.held ?? "Held for now"
              ) : failing ? (
                <>
                  <span className="l-feed-now-ico" data-tone="bad" aria-hidden />
                  {failing === 1 ? "One claim doesn't hold" : `${failing} claims don't hold`}
                </>
              ) : (
                "Everything else holds."
              )}
            </span>
            <span className="l-feed-buttons" key={`b${pay}`}>
              {pay !== "held" && (
                <Button size="sm" variant="ghost" disabled={pay === "paying"} onClick={() => {
                    setPay("held");
                    onHold?.();
                    feedback.play("tap", -2);
                  }}>
                  Not yet
                </Button>
              )}
              <Button size="sm" variant={failing ? "secondary" : "accent"} loading={pay === "paying"} onClick={payNow}>
                {pay === "held" ? (decision.again ?? decision.act) : decision.act}
              </Button>
            </span>
          </>
        ) : (
          <>
            <span className="l-feed-now" key={`${at}${st[at]?.mark}`}>
              {at >= 0 && st[at].mark === "detour" ? (
                <>
                  <span className="l-feed-now-ico" data-tone="warn" aria-hidden />
                  Waiting on {checks[at].detour?.who}
                </>
              ) : at >= 0 ? (
                <>
                  <span className="l-feed-now-ico" aria-hidden>
                    <Rays />
                  </span>
                  <span className="l-shimmer">Checking that {checks[at].claim.charAt(0).toLowerCase() + checks[at].claim.slice(1)}</span>
                </>
              ) : (
                "Ready to check"
              )}
            </span>
            <span className="l-feed-step l-num">
              {Math.max(at, 0) + 1} of {checks.length}
            </span>
          </>
        )}
      </div>

      <AskLine
        icon={<AgentAvatar a={agent} size={24} />}
        placeholder={placeholder ?? `Ask ${agent.name} about this`}
        label={`Ask ${agent.name}`}
        busy={busy}
        onSubmit={(q) => askQuestion(q, ask ? ask(q) : "Every claim above holds, with its proof under it. Ask me about any of them, or about the amount.", "Reading the case")}
      />
    </section>
  );
}

function CheckMark({ mark, n }: { mark: Mark; n: number }): ReactNode {
  if (mark === "checking") return <Rays />;
  if (mark === "passed")
    return (
      <svg viewBox="0 0 20 20" fill="none" className="l-feed-mark-ok">
        <path d="M6 10.3 8.7 13l5.3-5.6" pathLength="1" />
      </svg>
    );
  if (mark === "detour")
    return (
      <svg viewBox="0 0 20 20" fill="none" className="l-feed-mark-wait">
        <path d="M8 7v6M12 7v6" />
      </svg>
    );
  if (mark === "waiting") return <i className="l-feed-mark-you" />;
  if (mark === "failed")
    return (
      <svg viewBox="0 0 20 20" fill="none" className="l-feed-mark-no">
        <path d="M10 6.2v4.6M10 13.6v.2" />
      </svg>
    );
  return <span className="l-feed-mark-n l-num">{n}</span>;
}

/** The line under a claim: what the agent is doing about it, then its evidence. */
function Proof({ c, s, paid }: { c: FeedCheck; s: CheckState; paid: boolean }) {
  const [text, tone, key]: [ReactNode, string | undefined, string] =
    s.mark === "passed"
      ? [paid && c.yours ? c.yours.then : c.proof, undefined, "p"]
      : s.mark === "failed"
        ? [c.fail ?? c.proof, "bad", "f"]
      : s.mark === "waiting"
        ? [c.yours?.ask, "warn", "w"]
        : s.mark === "detour"
          ? [c.detour?.text, "warn", "d"]
          : s.mark === "checking"
            ? [
                s.helped && c.detour ? (
                  <>
                    <Who name={c.detour.who} /> {c.detour.then}
                  </>
                ) : c.count ? (
                  "Counting them up"
                ) : (
                  "Looking into it"
                ),
                s.helped ? undefined : "live",
                s.helped ? "h" : "c",
              ]
            : ["Not checked yet", "quiet", "n"];
  return (
    <span className="l-feed-proof" data-tone={tone} key={key}>
      {text}
    </span>
  );
}
