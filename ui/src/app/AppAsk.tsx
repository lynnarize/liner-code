/*
  An app outside Liner Code waiting on you (board Approve), as a card at the window's bottom right on every face, mounted
  once in App.tsx. Two kinds: an app at Asks first that wants to start a session, send a message, scan or stop (what, the
  project, who runs it, the permissions, the message quoted, "Trust it from now on", Deny / Open it first / Allow), and an
  app signing in through OAuth (Claude, ChatGPT), where you choose what it may do before it gets in. Nothing goes ahead
  until you answer here; the engine refuses it after ten minutes (engine/src/mcp-apps.ts, mcp-oauth.ts).
  It stands above the message box and above the scans' dock (ScanDock writes its height as --lc-scan-dock).
*/
import { useEffect, useState } from "react";
import type { McpAsk, McpLevel, McpSignIn } from "@contracts";
import { MCP_KIND_NAMES, MCP_LEVEL_NAMES, mcpTrustWords } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { onStream, rpc, useEngine } from "./engine";
import { ModelMark } from "./icons";
import { ago, markOf } from "./model";
import { NamedSwitch } from "./ui";
import { AppLogo } from "./settings/LinerMcp";
import "./app-ask.css";

const GAP = 16;
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const when = (at: number) => (Date.now() - at < 60_000 ? "now" : ago(at));

/** The cards waiting, from the engine: read as the window opens or reconnects, then kept by its "mcp" events. */
function useCards() {
  const [cards, setCards] = useState<{ asks: McpAsk[]; signIns: McpSignIn[] }>({ asks: [], signIns: [] });
  const connected = useEngine((x) => x.connected);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    void rpc("mcp.cards", {}).then((c) => live && setCards(c)).catch(() => {});
    const off = onStream((e) => void (e.type === "mcp" && setCards({ asks: e.asks, signIns: e.signIns })));
    return () => ((live = false), off());
  }, [connected]);
  return cards;
}

type Place = { bottom: number; right: number; width?: number };
/**
  Where the stack stands (board Approve): just above the message box, its right edge on the box's, wherever the box is (on
  Home it's centred); at the window's bottom right when there's none on screen.
*/
function usePlace(any: boolean) {
  const [at, setAt] = useState<Place>({ bottom: GAP, right: GAP });
  useEffect(() => {
    if (!any) return;
    const place = () => {
      const c = [...document.querySelectorAll<HTMLElement>(".lc-composer")].find((x) => x.getBoundingClientRect().width > 0);
      const r = c?.getBoundingClientRect();
      if (!r || r.top >= window.innerHeight) return setAt((was) => (was.bottom === GAP && was.right === GAP && !was.width ? was : { bottom: GAP, right: GAP }));
      const next = { bottom: Math.max(GAP, Math.round(window.innerHeight - r.top + 10)), right: Math.max(GAP, Math.round(window.innerWidth - r.right)), width: Math.round(Math.min(420, r.width)) };
      setAt((was) => (was.bottom === next.bottom && was.right === next.right && was.width === next.width ? was : next));
    };
    place();
    window.addEventListener("resize", place);
    const t = window.setInterval(place, 1000);
    return () => (window.removeEventListener("resize", place), clearInterval(t));
  }, [any]);
  return at;
}

export function AppAsk() {
  const { asks, signIns } = useCards();
  const any = asks.length + signIns.length > 0;
  const at = usePlace(any);
  if (!any) return null;
  return (
    <div className="lc-appask" style={{ bottom: `max(${at.bottom}px, calc(var(--lc-scan-dock, 0px) + 10px))`, right: at.right, ...(at.width ? { width: at.width } : {}) }} role="region" aria-label="Apps waiting on you">
      {signIns.map((s) => (
        <SignInCard key={s.id} s={s} />
      ))}
      {asks.map((a) => (
        <AskCard key={a.id} a={a} />
      ))}
    </div>
  );
}

function AskCard({ a }: { a: McpAsk }) {
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const answer = (allow: boolean) => {
    setBusy(true);
    void rpc("mcp.decide", { id: a.id, allow, trust: allow && trust }).catch((e) => (setBusy(false), fail(e)));
  };
  return (
    <section className="lc-appask-card" aria-label={`${a.appName} asks first`}>
      <header>
        <span className="lc-appask-logo">
          <AppLogo kind={a.appKind} size={16} />
        </span>
        <b>{a.appName} asks first</b>
        <small>through Liner MCP · {when(a.at)}</small>
      </header>
      <div className="lc-appask-body">
        <p>{a.summary}</p>
        <dl>
          {a.project && (
            <>
              <dt>Project</dt>
              <dd>{a.project}</dd>
            </>
          )}
          {a.runsOn && (
            <>
              <dt>Runs on</dt>
              <dd className="lc-appask-runs">
                {a.runsOnRef && <ModelMark kind={markOf(a.runsOnRef)} size={13} />}
                {a.runsOn}
              </dd>
            </>
          )}
          {a.access && (
            <>
              <dt>Permissions</dt>
              <dd>{a.access}</dd>
            </>
          )}
        </dl>
        {a.message && <blockquote>{a.message}</blockquote>}
        <label className="lc-appask-trust">
          <NamedSwitch name={mcpTrustWords(a.appKind, a.appName)} checked={trust} onCheckedChange={setTrust} />
          {mcpTrustWords(a.appKind, a.appName)}
        </label>
      </div>
      <footer>
        <button type="button" className="lc-btn lc-appask-deny" data-kind="ghost" data-size="sm" disabled={busy} onClick={() => answer(false)}>
          Deny
        </button>
        <span />
        {a.threadId && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-session", { detail: { id: a.threadId } }))}>
            Open it first
          </button>
        )}
        <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy} onClick={() => answer(true)}>
          Allow
        </button>
      </footer>
    </section>
  );
}

const LEVEL_NOTE: Record<McpLevel, string> = { read: "Reads sessions, pull requests, issues and findings", ask: "Starts and messages sessions once you allow each here", trusted: "The same without asking, never at Full access" };

function SignInCard({ s }: { s: McpSignIn }) {
  const [level, setLevel] = useState<McpLevel>("read");
  const [busy, setBusy] = useState(false);
  const answer = (allow: boolean) => {
    setBusy(true);
    void rpc("mcp.signIn", { id: s.id, allow, level })
      .then(() => allow && toast(`${s.clientName} is in, at ${MCP_LEVEL_NAMES[level]}`))
      .catch((e) => (setBusy(false), fail(e)));
  };
  return (
    <section className="lc-appask-card" aria-label={`An app calling itself ${s.clientName} wants to connect`}>
      <header>
        {/* No logo: the name is only what the app calls itself, and anyone can call themselves Claude. */}
        <span className="lc-appask-logo">
          <AppLogo kind="other" size={16} />
        </span>
        <b>An app wants to connect</b>
        <small>through Liner MCP · {when(s.at)}</small>
      </header>
      <div className="lc-appask-body">
        <p className="lc-appask-host">
          It goes back to <b>{s.redirectHost}</b>
        </p>
        <p>
          It calls itself “{s.clientName}”. You started adding {s.expect === "other" ? "an app" : MCP_KIND_NAMES[s.expect]} in Liner MCP; allow it only if you just connected it there{s.expect === "claude" ? ", and claude.ai is where it goes back to" : s.expect === "chatgpt" ? ", and chatgpt.com or openai.com is where it goes back to" : ""}.
        </p>
        <div className="lc-appask-levels" role="radiogroup" aria-label="What it may do">
          {(["read", "ask", "trusted"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={level === l} className="lc-appask-level l-focus" data-on={level === l || undefined} onClick={() => setLevel(l)}>
              <i />
              <span>
                <b>{MCP_LEVEL_NAMES[l]}</b>
                <small>{LEVEL_NOTE[l]}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <footer>
        <button type="button" className="lc-btn lc-appask-deny" data-kind="ghost" data-size="sm" disabled={busy} onClick={() => answer(false)}>
          Deny
        </button>
        <span />
        <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy} onClick={() => answer(true)}>
          Allow
        </button>
      </footer>
    </section>
  );
}
