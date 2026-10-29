/*
  Usage and cost: what each account spent, by day, by agent and by model. Numbers come from
  each turn's own report, so they are estimates at API prices, not your bill; plan sessions
  show their tokens with no cost.
*/
import { useEffect, useState } from "react";
import type { ToolLimits, UsageSummary } from "@contracts";
import { BarChart } from "@liner/components/bar-chart/bar-chart";
import { Segmented } from "@liner/components/segmented/segmented";
import { RollingNumber } from "@liner/components/rolling-number/rolling-number";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, clock, compact, markOf, modelLabel, money } from "./model";
import { ModelTag } from "./ui";

export function Usage({ sidebar, onSidebar }: { sidebar: boolean; onSidebar: () => void }) {
  const [days, setDays] = useState<"7" | "30" | "month">("month");
  const [data, setData] = useState<UsageSummary | null>(null);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const threads = useEngine((s) => s.threads.length);
  const budget = useEngine((s) => s.settings.budgetUsd ?? 0);
  const [editing, setEditing] = useState(false);
  const n = days === "month" ? new Date().getDate() : Number(days);

  useEffect(() => {
    let live = true;
    void rpc("usage.summary", { days: n }).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [n, threads]);

  const t = data?.totals;
  const maxAgent = Math.max(1e-9, ...(data?.byAgent ?? []).map((a) => a.costUsd || a.tokens / 1e6));
  // Day numbers on the axis; the month is in the subtitle.
  const dayLabel = (day: string) => String(new Date(`${day}T12:00`).getDate());
  const spend = (data?.days ?? []).map((d) => ({ label: dayLabel(d.day), value: d.costUsd || 0 }));
  const anyCost = (data?.days ?? []).some((d) => d.costUsd > 0);

  return (
    <div className="lc-usage">
      <header className="lc-top" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <h1 className="lc-title">Usage</h1>
        <Segmented
          size="sm"
          value={days}
          onValueChange={setDays}
          options={[
            { value: "month", label: "This month" },
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
          ]}
          aria-label="Period"
        />
        <span className="lc-grow" data-drag />
        <span className="lc-quiet">Estimates at API prices, not your bill</span>
      </header>
      <div className="lc-usage-in">
        <div className="lc-usage-top">
          <section className="lc-frame lc-usage-hero">
            <div className="lc-fcard">
              <div className="lc-usage-h">
                <b>{days === "month" ? "This month" : `Last ${n} days`}</b>
                <span className="lc-quiet">{data ? `${(days === "month" ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(data.from)).toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${new Date(data.to).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
              </div>
              <div className="lc-usage-big">
                <RollingNumber value={t?.costUsd ?? 0} format={{ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
              </div>
              <p className="lc-quiet">
                {t?.turns ? `${t.turns} turns across your sessions. Sessions on a plan show tokens without a cost.` : "Nothing has run in this period yet. Each turn adds its tokens and cost here."}
              </p>
              <Budget spent={days === "month" ? (t?.costUsd ?? 0) : null} budget={budget} editing={editing} onEdit={setEditing} />
            </div>
          </section>
          <div className="lc-usage-tiles">
            <Tile label="Tokens" value={compact(t?.tokens ?? 0)} note={`${t?.turns ?? 0} turns`} />
            <Tile label="Per turn" value={money(t?.perTurn ?? 0)} note="on average" />
            <Tile label="From the cache" value={`${Math.round((t?.cacheShare ?? 0) * 100)}%`} note="of input tokens" />
            <Tile label="Most expensive turn" value={money(t?.priciest?.costUsd ?? 0)} note={t?.priciest?.title ?? "—"} />
          </div>
        </div>
        <Limits />
        <div className="lc-usage-mid">
          {anyCost ? (
            <BarChart title="Spend per day" subtitle={days === "month" ? new Date().toLocaleDateString("en-US", { month: "long" }) : `Last ${n} days`} data={spend} height={190} format={(v) => `$${v.toFixed(v < 10 ? 2 : 0)}`} />
          ) : (
            <BarChart title="Tokens per day" subtitle={`${days === "month" ? new Date().toLocaleDateString("en-US", { month: "long" }) : `Last ${n} days`} · no cost reported, these ran on a plan`} data={(data?.days ?? []).map((d) => ({ label: dayLabel(d.day), value: d.tokens }))} height={190} format={compact} />
          )}
          <section className="lc-frame">
            <div className="lc-fcard lc-usage-list">
              <div className="lc-usage-h">
                <b>By agent</b>
              </div>
              {(data?.byAgent ?? []).map((a) => {
                const ag = agentOf(a.agent, agents, providers);
                const v = a.costUsd || a.tokens / 1e6;
                return (
                  <div key={a.agent} className="lc-bar-row">
                    <span>
                      <b>{ag.name}</b>
                      <small>
                        {ag.role} · {a.turns} turns
                      </small>
                    </span>
                    <span className="lc-bar">
                      <i style={{ width: `${(v / maxAgent) * 100}%` }} />
                    </span>
                    <span className="lc-mono">{a.costUsd ? money(a.costUsd) : compact(a.tokens)}</span>
                  </div>
                );
              })}
              {!data?.byAgent.length && <p className="lc-quiet">No turns yet.</p>}
            </div>
          </section>
        </div>
        <section className="lc-frame">
          <div className="lc-fcard">
            <div className="lc-usage-h">
              <b>By model</b>
              <span className="lc-quiet">tokens, cache hits and cost</span>
            </div>
            <table className="lc-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Tokens</th>
                  <th>Cache hits</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byModel ?? []).map((m) => (
                  <tr key={`${m.provider}:${m.model}`}>
                    <td>
                      <ModelTag kind={markOf(`${m.provider}:${m.model}`)} label={modelLabel(`${m.provider}:${m.model}`, providers)} />
                    </td>
                    <td className="lc-mono">{compact(m.tokens)}</td>
                    <td className="lc-mono">{Math.round(m.cacheShare * 100)}%</td>
                    <td className="lc-mono">{m.costUsd ? money(m.costUsd) : "Plan"}</td>
                  </tr>
                ))}
              </tbody>
              {data && data.byModel.length > 0 && (
                <tfoot>
                  <tr>
                    <td>All models</td>
                    <td className="lc-mono">{compact(t?.tokens ?? 0)}</td>
                    <td className="lc-mono">{Math.round((t?.cacheShare ?? 0) * 100)}%</td>
                    <td className="lc-mono">{money(t?.costUsd ?? 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

const Tile = ({ label, value, note }: { label: string; value: string; note: string }) => (
  <div className="lc-frame">
    <div className="lc-fcard lc-tile-card">
      <small>{label}</small>
      <b className="l-num">{value}</b>
      <span className="lc-quiet">{note}</span>
    </div>
  </div>
);

/** The month against a budget you set: how much is gone, and where this pace ends the month. */
function Budget({ spent, budget, editing, onEdit }: { spent: number | null; budget: number; editing: boolean; onEdit: (on: boolean) => void }) {
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pace = spent === null ? 0 : (spent / Math.max(1, now.getDate() - 1 + now.getHours() / 24)) * days;
  const save = (v: string) => {
    const n = Math.max(0, Math.round(Number(v.replace(/[^\d.]/g, "")) || 0));
    void rpc("settings.save", { budgetUsd: n });
    onEdit(false);
  };
  if (editing || !budget)
    return editing ? (
      <form
        className="lc-budget-edit"
        onSubmit={(e) => {
          e.preventDefault();
          save(String(new FormData(e.currentTarget).get("b") ?? ""));
        }}
      >
        <span className="lc-quiet">A monthly budget of $</span>
        <input name="b" className="lc-input" defaultValue={budget || ""} autoFocus inputMode="decimal" placeholder="200" aria-label="Monthly budget in dollars" onKeyDown={(e) => e.key === "Escape" && onEdit(false)} />
        <button type="submit" className="lc-btn" data-kind="primary" data-size="sm">
          Set it
        </button>
        {budget > 0 && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => save("0")}>
            No budget
          </button>
        )}
      </form>
    ) : (
      <button type="button" className="lc-link l-focus lc-budget-set" onClick={() => onEdit(true)}>
        Set a monthly budget
      </button>
    );
  if (spent === null)
    return (
      <p className="lc-budget-line lc-quiet">
        Budget {money(budget)} a month.{" "}
        <button type="button" className="lc-link l-focus" onClick={() => onEdit(true)}>
          Change it
        </button>
      </p>
    );
  const used = Math.min(1, spent / budget);
  const over = pace > budget;
  return (
    <div className="lc-budget">
      <div className="lc-budget-bar" data-over={over || undefined} role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={spent} aria-label="Spent of the monthly budget">
        <i style={{ width: `${used * 100}%` }} />
        <b style={{ left: `${Math.min(100, (now.getDate() / days) * 100)}%` }} aria-hidden />
      </div>
      <p className="lc-budget-line">
        <span>
          {money(spent)} of {money(budget)}
        </span>
        <span className={over ? "lc-budget-over" : "lc-quiet"}>{over ? `On pace for ${money(pace)}, over by ${money(pace - budget)}` : `On pace for ${money(pace)} by the ${days}${days === 31 ? "st" : "th"}`}</span>
        <button type="button" className="lc-link l-focus" onClick={() => onEdit(true)}>
          Change
        </button>
      </p>
    </div>
  );
}

/** Each plan's windows, as the tool reports them: how much is used, and when it resets. */
function Limits() {
  const [tools, setTools] = useState<ToolLimits[] | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    setTools(null);
    void rpc("usage.limits", {})
      .then((r) => live && setTools(r.tools))
      .catch(() => live && setTools([]));
    return () => {
      live = false;
    };
  }, [again]);
  return (
    <section className="lc-frame lc-limits">
      <div className="lc-fcard">
        <div className="lc-usage-h">
          <b>Limits</b>
          <span className="lc-quiet">What each plan has left, from the tool itself</span>
          <span className="lc-grow" />
          <button type="button" className="lc-ib l-focus" aria-label="Look again" title="Look again" onClick={() => setAgain((n) => n + 1)}>
            <I.refresh size={14} />
          </button>
        </div>
        {tools === null ? (
          <p className="l-shimmer lc-limits-none">Asking each tool</p>
        ) : tools.length === 0 ? (
          <p className="lc-quiet lc-limits-none">No signed-in tool reports plan limits.</p>
        ) : (
          <div className="lc-limits-grid">
            {tools.map((t) => (
              <div key={t.provider} className="lc-limits-tool">
                <div className="lc-limits-h">
                  <b>{t.label}</b>
                  {t.plan && <span className="lc-mp-def">{t.plan[0].toUpperCase() + t.plan.slice(1)}</span>}
                </div>
                {t.windows.map((w) => (
                  <div key={w.label} className="lc-limits-w" data-high={w.usedPercent >= 80 || undefined}>
                    <span className="lc-limits-l">
                      <span>{w.label}</span>
                      <span className="lc-mono">{Math.round(w.usedPercent)}%</span>
                    </span>
                    <span className="lc-limits-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.usedPercent)} aria-label={`${t.label}, ${w.label}`}>
                      <i style={{ width: `${Math.min(100, w.usedPercent)}%` }} />
                    </span>
                    {w.resetsAt && <small className="lc-quiet">Resets {clock(w.resetsAt)}</small>}
                  </div>
                ))}
                {!t.windows.length && <small className="lc-quiet">{t.detail ?? "It didn't report any windows."}</small>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
