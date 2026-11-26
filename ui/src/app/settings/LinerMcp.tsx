/*
  Settings › Connections › Liner MCP (board Mcp): apps outside Liner Code that reach it, and what Liner's own agents can
  reach. Let them in (the switch), On this Mac (the stdio server terminal agents start, with the command to copy), From the
  internet (off, Tailscale Funnel, a Cloudflare quick tunnel or your own address, with its address and state), the apps let
  in (each with its level, how it comes in, its last call and its key's end, Revoke), the three levels and their tools, and
  Tell an app (a webhook when a session needs you). Add an app (boards Pair, PairMuse) makes a key, shown once, and the
  message to send the app. The engine holds every app to its level (engine/src/mcp-apps.ts); this only shows and asks.
*/
import { useEffect, useRef, useState } from "react";
import type { AddonInfo, McpApp, McpAppKind, McpLevel, McpNewKey, McpReach, McpStatus, Settings } from "@contracts";
import { MCP_KIND_NAMES, MCP_LEVEL_NAMES, MCP_TOOL_LEVELS } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { APP_LOGO } from "../app-logos";
import { bridge } from "../bridge";
import { onStream, rpc, useEngine } from "../engine";
import { I } from "../icons";
import { ago, plural } from "../model";
import * as os from "../os";
import { NamedSwitch, Pop, Row as MenuRow } from "../ui";
import { wordRead, wordWrite } from "../kept";
import { HostTile, Mono, Row, RowMore, Section, SubRow, Tag } from "./parts";
import "./liner-mcp.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const save = (patch: Partial<Settings>) => rpc("settings.save", patch).catch((e) => (fail(e), null));
const copy = (text: string, said = "Copied") => void navigator.clipboard.writeText(text).then(() => toast(said));

/** An app's logo on a tile: T3 Code's pictures for the four apps (app-logos.ts), an icon for a terminal agent or another app. */
export function AppLogo({ kind, size = 18 }: { kind: McpAppKind; size?: number }) {
  const src = APP_LOGO[kind];
  if (src) return <img src={src} width={size} height={size} alt="" className="lc-mcp-logo" />;
  return kind === "terminal" ? <I.terminal size={size - 4} /> : <I.cube size={size - 4} />;
}

/** The three levels in words, as the board's What an app may do lists them. */
const LEVEL_SAID: Record<McpLevel, string> = {
  read: "Reads sessions, pull requests, issues and findings.",
  ask: "Starts and messages sessions and scans once you allow each here.",
  trusted: "The same without asking, at your default permissions.",
};
const toolsAt = (level: McpLevel) => Object.entries(MCP_TOOL_LEVELS).flatMap(([t, l]) => (l === level ? [t] : []));

/** The way in from the internet you used last, on this Mac: Add an app's Turn it on goes back to it. */
const REACH_KEY = "lc:mcp-reach";
const REACH: { value: McpReach; label: string; note: string }[] = [
  { value: "off", label: "Off", note: "Only apps on this Mac" },
  { value: "tailscale", label: "Tailscale Funnel", note: "Your tailnet's address, kept across launches" },
  { value: "cloudflare", label: "Cloudflare quick tunnel", note: "No account; a new address each launch" },
  { value: "own", label: "Your own address", note: "An https address you forward here" },
];

/** A small menu in a row's end: the choice on its button, the others under it. */
function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { value: T; label: string; note?: string }[]; onPick: (v: T) => void }) {
  const shown = options.find((o) => o.value === value) ?? options[0];
  return (
    <Pop label={label} menu align="end" width={260} triggerClass="lc-btn" triggerAttrs={{ "data-kind": "plain", "data-size": "sm", "aria-label": label }} trigger={<>{shown.label}<I.chevD size={12} /></>}>
      {(close) => (
        <>
          {options.map((o) => (
            <MenuRow key={o.value} title={o.label} note={o.note} keepNote={Boolean(o.note)} on={o.value === value} onPick={() => (close(), onPick(o.value))} />
          ))}
        </>
      )}
    </Pop>
  );
}

/** Liner MCP's state from the engine, asked again whenever an app, a card or the tunnel changes. */
function useStatus() {
  const [s, setS] = useState<McpStatus | null>(null);
  const on = useEngine((x) => x.settings.outside === true);
  const reach = useEngine((x) => x.settings.mcpReach);
  const own = useEngine((x) => x.settings.mcpOwnUrl);
  const hook = useEngine((x) => x.settings.mcpWebhook);
  const keys = useEngine((x) => x.keys);
  useEffect(() => {
    let live = true;
    let t = 0;
    const read = () => void rpc("mcp.status", {}).then((r) => live && setS(r)).catch(() => {});
    read();
    // A burst (an app calling, the tunnel coming up) is read once.
    const off = onStream((e) => void (e.type === "mcp" && (clearTimeout(t), (t = window.setTimeout(read, 250)))));
    return () => ((live = false), clearTimeout(t), off());
  }, [on, reach, own, hook, keys]);
  return [s, setS] as const;
}

export function LinerMcpPlace() {
  const [s, setS] = useStatus();
  const on = useEngine((x) => x.settings.outside === true);
  const reach = useEngine((x) => x.settings.mcpReach ?? "off");
  const [adding, setAdding] = useState(false);
  const up = s?.tunnel.state === "up";
  return (
    <>
      <Section title="Liner MCP">
        <Row title="Let apps outside Liner Code in" note="They list and read your sessions, start one in a project, message it and wait for it, and read pull requests, issues and scans. What a session asks still comes to you here.">
          <NamedSwitch name="Let apps outside Liner Code in" checked={on} onCheckedChange={(outside) => void save({ outside })} />
        </Row>
        <Row
          off={!on}
          lead={
            <HostTile>
              <I.terminal size={14} />
            </HostTile>
          }
          title="On this Mac"
          note="Claude Code, Codex or Hermes in a terminal, through Liner's server on stdio. Nothing leaves the Mac."
        >
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={!on || !s?.command} onClick={() => s?.command && copy(s.command, "Copied. Run it once in a terminal.")}>
            <I.copy size={13} />
            Copy command
          </button>
        </Row>
        {on && s && (
          <RowMore>
            <SubRow title="Terminal agents may">
              <Choice label="What terminal agents may do" value={s.stdioLevel} options={(["read", "ask", "trusted"] as const).map((l) => ({ value: l, label: MCP_LEVEL_NAMES[l], note: LEVEL_SAID[l] }))} onPick={(mcpStdioLevel) => void save({ mcpStdioLevel }).then(() => rpc("mcp.status", {}).then(setS))} />
            </SubRow>
          </RowMore>
        )}
        <Row
          off={!on}
          lead={
            <HostTile on={on && reach !== "off" ? up : undefined}>
              <I.globe size={14} />
            </HostTile>
          }
          title={
            <>
              From the internet <Tag tone="new">New</Tag>
            </>
          }
          note="Grok Bot and Muse run in the cloud, so they need an https address that reaches this Mac. Liner starts the tunnel you pick and stops it when it quits."
        >
          <Choice label="From the internet" value={reach} options={REACH} onPick={(mcpReach) => (mcpReach !== "off" && wordWrite(localStorage, REACH_KEY, mcpReach), void save({ mcpReach }))} />
        </Row>
        {on && reach !== "off" && s && <Reach s={s} onRetry={() => void rpc("mcp.retry", {}).then(setS).catch(fail)} />}
      </Section>

      <Section
        title="Apps"
        end={
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setAdding(true)}>
            <I.plus size={13} />
            Add an app
          </button>
        }
      >
        {s?.apps.length ? s.apps.map((a) => <AppRow key={a.id} a={a} stdioLevel={s.stdioLevel} publicUp={Boolean(s.publicUrl)} />) : <Row title="No apps yet" note={on ? "Add one, or start Liner's server from a terminal agent with the command above." : "Let apps in first, then add one."} />}
      </Section>

      <Section title="What an app may do">
        {(["read", "ask", "trusted"] as const).map((l) => (
          <Row
            key={l}
            below
            title={MCP_LEVEL_NAMES[l]}
            note={
              l === "read"
                ? undefined
                : l === "ask"
                  ? "Also starts and messages sessions and starts scans, each once you allow it here. It answers a session's questions, never its permission asks."
                  : "The same without asking. Its sessions run at your default permissions; Full access is never given to an app outside."
            }
          >
            {l !== "trusted" ? (
              <span className="lc-mcp-tools">
                {toolsAt(l).map((t) => (
                  <Mono key={t}>{t}</Mono>
                ))}
                <small>{l === "read" ? plural(toolsAt(l).length, "tool") : `+${plural(toolsAt(l).length, "tool")}`}</small>
              </span>
            ) : (
              <small className="lc-mcp-quiet">same {Object.keys(MCP_TOOL_LEVELS).length}</small>
            )}
          </Row>
        ))}
      </Section>

      <TellAnApp />

      <Reaches />

      {adding && <AddApp status={s} onClose={() => (setAdding(false), void rpc("mcp.status", {}).then(setS).catch(() => {}))} />}
    </>
  );
}

/** The address and the tunnel's state under From the internet, or the field for your own address. */
function Reach({ s, onRetry }: { s: McpStatus; onRetry: () => void }) {
  const own = useEngine((x) => x.settings.mcpOwnUrl ?? "");
  const [v, setV] = useState(own);
  useEffect(() => setV(own), [own]);
  const found = s.tunnel.found;
  const missing = (s.reach === "tailscale" && found && !found.tailscale) || (s.reach === "cloudflare" && found && !found.cloudflared);
  return (
    <RowMore>
      {s.reach === "own" && (
        <SubRow title="Your address">
          <span className="lc-st-input lc-mcp-own">
            <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save({ mcpOwnUrl: v.trim() })} onBlur={() => v.trim() !== own && void save({ mcpOwnUrl: v.trim() })} placeholder="https://liner.example.com" spellCheck={false} autoComplete="off" aria-label="Your own https address" />
          </span>
        </SubRow>
      )}
      <SubRow title="Address">
        {s.publicUrl ? (
          <span className="lc-mcp-addr">
            <Mono>{s.publicUrl}</Mono>
            <button type="button" className="lc-ib l-focus" aria-label="Copy the address" onClick={() => copy(s.publicUrl!)}>
              <I.copy size={13} />
            </button>
          </span>
        ) : (
          <span className="lc-mcp-quiet">None yet</span>
        )}
      </SubRow>
      <SubRow title={s.reach === "own" ? "Forwarding" : "Tunnel"}>
        <span className="lc-mcp-state" data-state={s.tunnel.state}>
          <i />
          {s.tunnel.state === "starting" ? "Starting" : s.tunnel.state === "up" ? (s.tunnel.note ?? (s.reach === "own" ? `To port ${s.port} on this Mac` : "Up")) : s.tunnel.state === "down" ? (s.tunnel.note ?? "Down") : "Off"}
          {(s.tunnel.state === "down" || missing) && (
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onRetry}>
              Try again
            </button>
          )}
        </span>
      </SubRow>
      {s.reach === "cloudflare" && <SubRow title="Note">The address is new each time Liner starts the tunnel: apps you added need the new one.</SubRow>}
      {s.reach === "tailscale" && <SubRow title="Or">Cloudflare quick tunnel, no account, a new address each launch</SubRow>}
    </RowMore>
  );
}

/** One app let in: its logo, name and level, how it comes in, its last call, its key's end and days left, and Revoke. */
function AppRow({ a, stdioLevel, publicUp }: { a: McpApp; stdioLevel: McpLevel; publicUp: boolean }) {
  const [naming, setNaming] = useState<string | null>(null);
  const rename = () => {
    const n = naming?.trim();
    setNaming(null);
    if (n && n !== a.name) void rpc("mcp.rename", { id: a.id, name: n }).catch(fail);
  };
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = window.setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(t);
  }, [sure]);
  const level = a.via === "stdio" ? stdioLevel : a.level;
  const days = a.via === "stdio" ? null : Math.max(0, Math.ceil((a.expiresAt - Date.now()) / 86_400_000));
  const recent = Boolean(a.lastCallAt && Date.now() - a.lastCallAt < 10 * 60_000);
  // How it really comes in now: an app with a key reaches the internet address only while one is up, else this Mac's.
  const way = a.via === "stdio" ? "On this Mac, in a terminal" : !publicUp ? "Over HTTP on this Mac" : a.auth === "oauth" ? "From the internet, signed in" : "From the internet";
  const bits = [way, a.lastCallAt ? `last call ${ago(a.lastCallAt)}${a.lastTool ? `, ${a.lastTool}` : ""}` : "waiting for its first call", ...(a.keyEnd && a.auth === "key" ? [`key …${a.keyEnd}`] : []), ...(days === null ? [] : [days ? `${plural(days, "day")} left` : "ran out"])];
  const revoke = () => {
    if (!sure) return setSure(true);
    void rpc("mcp.revoke", { id: a.id }).then(() => toast(a.via === "stdio" ? `Liner turns ${a.name} away by its name` : `${a.name} can't reach Liner Code any more`, a.via === "stdio" ? { description: "To keep every terminal agent out, switch Let apps outside Liner Code in off." } : undefined)).catch(fail);
  };
  if (a.blocked)
    return (
      <Row
        off
        lead={
          <HostTile label={a.name}>
            <AppLogo kind={a.kind} />
          </HostTile>
        }
        title={
          <>
            {a.name} <Tag tone="warn">Turned away</Tag>
          </>
        }
        note="On this Mac, in a terminal · refused by the name it gives"
      >
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void rpc("mcp.unblock", { id: a.id }).catch(fail)}>
          Let in again
        </button>
      </Row>
    );
  return (
    <Row
      lead={
        <HostTile on={recent} label={a.name}>
          <AppLogo kind={a.kind} />
        </HostTile>
      }
      title={
        naming !== null ? (
          <span className="lc-st-input lc-mcp-rename">
            <input autoFocus value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? rename() : e.key === "Escape" ? setNaming(null) : undefined)} onBlur={rename} aria-label={`A name for ${a.name}`} />
          </span>
        ) : (
          <>
            {a.via === "stdio" ? (
              a.name
            ) : (
              <button type="button" className="lc-mcp-name l-focus" title="Rename" onClick={() => setNaming(a.name)}>
                {a.name}
              </button>
            )}
            {/* A terminal agent's level is the setting's, with no menu of its own: said here. The others show it in their menu alone. */}
            {a.via === "stdio" && <Tag>{MCP_LEVEL_NAMES[level]}</Tag>}
          </>
        )
      }
      note={bits.join(" · ")}
    >
      {a.via !== "stdio" && <Choice label={`What ${a.name} may do`} value={a.level} options={(["read", "ask", "trusted"] as const).map((l) => ({ value: l, label: MCP_LEVEL_NAMES[l], note: LEVEL_SAID[l] }))} onPick={(level) => void rpc("mcp.setLevel", { id: a.id, level }).catch(fail)} />}
      <button type="button" className="lc-btn" data-kind={sure ? "danger" : "ghost"} data-size="sm" onClick={revoke}>
        {sure ? (a.via === "stdio" ? "Turn it away by name" : "Revoke it") : "Revoke"}
      </button>
    </Row>
  );
}

/** Tell an app: an https address posted to when a session needs you, and an optional secret kept in the keychain. */
function TellAnApp() {
  const url = useEngine((x) => x.settings.mcpWebhook ?? "");
  const hasSecret = useEngine((x) => x.keys.includes("mcp.webhook"));
  const [open, setOpen] = useState(false);
  const [u, setU] = useState(url);
  const [secret, setSecret] = useState("");
  useEffect(() => setU(url), [url]);
  const keep = async () => {
    const r = await save({ mcpWebhook: u.trim() });
    if (!r) return;
    if (secret.trim()) {
      try {
        await bridge.keychainSet("key:mcp.webhook", secret.trim());
        await rpc("keys.set", { provider: "mcp.webhook", key: secret.trim() });
      } catch (e) {
        return fail(e);
      }
    }
    setSecret("");
    setOpen(false);
    toast.success(u.trim() ? "Liner tells it when a session needs you" : "Tell an app is off");
  };
  const remove = async () => {
    await save({ mcpWebhook: "" });
    await bridge.keychainSet("key:mcp.webhook", null).catch(() => {});
    await rpc("keys.set", { provider: "mcp.webhook", key: null }).catch(() => {});
    setOpen(false);
  };
  return (
    <Section title="Tell an app">
      <Row
        title={
          <>
            When a session needs you <Tag tone="new">New</Tag>
          </>
        }
        note={url ? `Posts to ${safeHost(url)}${hasSecret ? " with your secret" : ""}. No code or words from the session go with it, only its title. Works even while apps are kept out.` : "Posts one line to an app's webhook, such as a Grok Bot routine, so it can reach you on your phone. No code or words from the session go with it. Works even while apps are kept out."}
      >
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setOpen((o) => !o)}>
          {url ? "Change" : "Set up"}
        </button>
      </Row>
      {open && (
        <RowMore>
          <SubRow title="Address">
            <span className="lc-st-input lc-mcp-own">
              <input autoFocus value={u} onChange={(e) => setU(e.target.value)} placeholder="https://…" spellCheck={false} autoComplete="off" aria-label="The webhook's https address" />
            </span>
          </SubRow>
          <SubRow title="Secret, if it wants one">
            <span className="lc-st-input lc-mcp-own">
              <I.lock size={14} />
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={hasSecret ? `Kept in ${os.keyStore()}` : "Sent as a bearer token"} spellCheck={false} autoComplete="off" aria-label="The webhook's secret" />
            </span>
          </SubRow>
          <SubRow title="">
            <span className="lc-mcp-acts">
              {url && (
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void remove()}>
                  Turn off
                </button>
              )}
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!u.trim()} onClick={() => void keep()}>
                Save
              </button>
            </span>
          </SubRow>
        </RowMore>
      )}
    </Section>
  );
}
const safeHost = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/** The other direction: the connections (add-ons) Liner hands its own agents, to read here and change in Add-ons. */
function Reaches() {
  const addons = useEngine((x) => x.addons);
  const list = addons.filter((a: AddonInfo) => a.kind === "connection" && !a.removed);
  return (
    <Section
      title="What Liner's agents can reach"
      note="Connections your agents are handed, in every tool. They're added and switched in Add-ons."
      end={
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "addons" }))}>
          Open Add-ons
        </button>
      }
    >
      {list.length ? (
        list.map((a) => (
          <Row
            key={a.id}
            off={!a.enabled}
            lead={
              <HostTile on={a.enabled}>
                <I.cube size={14} />
              </HostTile>
            }
            title={a.name}
            note={`${a.transport === "http" ? "An address" : "A program on this Mac"} · ${a.reaches}${a.enabled ? "" : " · off"}`}
          />
        ))
      ) : (
        <Row title="No connections yet" note="Ask an agent in Workshop to add one, or add one in Add-ons." />
      )}
    </Section>
  );
}

const KINDS: McpAppKind[] = ["grokbot", "muse", "claude", "chatgpt", "other"];

/** Add an app (boards Pair, PairMuse): which app, what it may do, and how to send it what it needs. The key shows once. */
function AddApp({ status, onClose }: { status: McpStatus | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const [kind, setKind] = useState<McpAppKind>("grokbot");
  const [level, setLevel] = useState<McpLevel>("ask");
  const [made, setMade] = useState<McpNewKey | null>(null);
  const [named, setNamed] = useState("");
  const [turning, setTurning] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => void ref.current?.showModal(), []);
  const oauth = kind === "claude" || kind === "chatgpt";
  // An app that signs in itself: Liner takes a sign-in for the next 15 minutes, and none at any other time (mcp-oauth.ts).
  useEffect(() => {
    if (oauth || kind === "other") void rpc("mcp.expectSignIn", { kind }).catch(() => {});
  }, [kind, oauth]);
  const internet = Boolean(status?.publicUrl);
  const name = MCP_KIND_NAMES[kind];
  // A key for the app picked, made when you ask for it: one made and then left unused is revoked as you change the app or level.
  const make = async () => {
    setBusy(true);
    try {
      if (made) await rpc("mcp.revoke", { id: made.app.id }).catch(() => {});
      setMade(await rpc("mcp.addApp", { kind, level, ...(kind === "other" && named.trim() ? { name: named.trim() } : {}) }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const change = (k: McpAppKind, l: McpLevel) => {
    if (made) void rpc("mcp.revoke", { id: made.app.id }).catch(() => {});
    setMade(null);
    setKind(k);
    setLevel(l);
  };
  /*
    From the internet, on: the way you used last (kept on this Mac as you pick one), and apps let in with it. With none
    used yet, the choice is yours: the sheet closes onto that row with its menu open.
  */
  const turnOn = async () => {
    const last = wordRead(localStorage, REACH_KEY, ["tailscale", "cloudflare", "own"], "");
    if (!last) {
      onClose();
      window.setTimeout(() => {
        const b = document.querySelector<HTMLElement>('[aria-label="From the internet"]');
        b?.scrollIntoView({ block: "center", behavior: "smooth" });
        b?.click();
      }, 80);
      return;
    }
    setTurning(true);
    const r = await save({ outside: true, mcpReach: last as McpReach });
    setTurning(false);
    if (r) toast(`From the internet: ${REACH.find((x) => x.value === last)?.label ?? last}`, { description: "The address shows here once the tunnel is up." });
  };
  const url = made?.url ?? status?.publicUrl ?? "";
  const message = kind === "grokbot" ? `Add the MCP server ${url} with the header Authorization: Bearer ${made?.key ?? "<key>"} and connect it.` : kind === "muse" ? `Create a custom connector for the MCP server ${url}.` : `Add the MCP server ${url} with the header Authorization: Bearer ${made?.key ?? "<key>"}.`;
  return (
    <dialog ref={ref} className="lc-sheet lc-mcp-add" aria-labelledby="lc-mcp-add-t" onCancel={(e) => (e.preventDefault(), onClose())} onPointerDown={(e) => (pressedOutside.current = e.target === ref.current)} onClick={(e) => e.target === ref.current && pressedOutside.current && onClose()}>
      <div className="lc-sheet-frame">
        <div className="lc-sheet-head">
          <span>
            <b id="lc-mcp-add-t">Add an app</b>
          </span>
          <button type="button" className="lc-ib l-focus" aria-label="Close" onClick={onClose}>
            <I.close size={14} />
          </button>
        </div>
        <div className="lc-mcp-add-body">
          <h3>
            <i>1</i>Which app
          </h3>
          <div className="lc-mcp-kinds" role="radiogroup" aria-label="Which app">
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className="lc-mcp-kind l-focus" data-on={kind === k || undefined} onClick={() => change(k, level)}>
                <span className="lc-mcp-kind-logo">
                  <AppLogo kind={k} size={20} />
                </span>
                {MCP_KIND_NAMES[k]}
              </button>
            ))}
          </div>
          {kind === "other" && !made && (
            <span className="lc-st-input lc-mcp-own lc-mcp-named">
              <input value={named} maxLength={60} onChange={(e) => setNamed(e.target.value)} placeholder="Its name, like Home Assistant (Another app when left empty)" aria-label="The app's name" />
            </span>
          )}
          {!oauth && (
            <>
              <h3>
                <i>2</i>What it may do
              </h3>
              <div className="lc-mcp-levels" role="radiogroup" aria-label="What it may do">
                {(["read", "ask", "trusted"] as const).map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={level === l} className="lc-mcp-level l-focus" data-on={level === l || undefined} onClick={() => change(kind, l)}>
                    <i className="lc-mcp-radio" />
                    <span>
                      <b>{MCP_LEVEL_NAMES[l]}</b>
                      <small>{LEVEL_SAID[l]}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <h3>
            <i>{oauth ? 2 : 3}</i>
            {oauth ? `Connect it in ${name}` : `Send it to ${name}`}
          </h3>
          {!internet && kind !== "other" ? (
            <div className="lc-mcp-step">
              <p>{name} works from the cloud, so it reaches Liner through an address from the internet. Turn From the internet on first, in Liner MCP.</p>
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={turning} onClick={() => void turnOn()}>
                {turning ? "Turning it on" : "Turn it on"}
              </button>
            </div>
          ) : oauth ? (
            <div className="lc-mcp-step">
              <p>{kind === "claude" ? "In claude.ai: Customize › Connectors › Add custom connector. Give it this address only; Claude signs in by itself." : "In ChatGPT: Settings › Connectors › Create, with this address and OAuth. ChatGPT signs in by itself."} The sign-in finishes on a card here in Liner, where you choose what it may do.</p>
              <pre className="lc-mcp-msg">{status?.publicUrl}</pre>
              <span className="lc-mcp-acts">
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => copy(status?.publicUrl ?? "", "Address copied")}>
                  <I.copy size={13} />
                  Copy the address
                </button>
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => bridge.openExternal(kind === "claude" ? "https://claude.ai/settings/connectors" : "https://chatgpt.com")}>
                  <I.external size={13} />
                  Open {name}
                </button>
              </span>
            </div>
          ) : !made ? (
            <div className="lc-mcp-step">
              <p>{kind === "other" ? "A key for an app that speaks MCP over HTTP, on this Mac or through your address from the internet. An app that signs in by itself can do so for the next 15 minutes; the sign-in finishes on a card here." : `${name} works from the cloud, so it reaches Liner through your address from the internet.`}</p>
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy} onClick={() => void make()}>
                {busy ? "Making the key" : "Make its key"}
              </button>
            </div>
          ) : (
            <div className="lc-mcp-step">
              <p>
                {kind === "grokbot"
                  ? "Send any of your Grok Bots this; the connector is shared with all of them."
                  : kind === "muse"
                    ? "Muse has no form for this: you ask it in chat, and it asks for the key in its own secure prompt."
                    : "Give the app this address and the header."}
              </p>
              <pre className="lc-mcp-msg">{message}</pre>
              <span className="lc-mcp-acts">
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => copy(message, "Message copied")}>
                  <I.copy size={13} />
                  Copy the message
                </button>
                {kind === "grokbot" && (
                  <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => (copy(message, "Message copied. Paste it in Grok Bot."), bridge.openExternal("https://x.ai/bot"))}>
                    <I.external size={13} />
                    Open Grok Bot
                  </button>
                )}
                {kind === "muse" && (
                  <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => bridge.openExternal("https://muse.ai")}>
                    <I.external size={13} />
                    Open Muse
                  </button>
                )}
              </span>
              {kind === "muse" && (
                <span className="lc-mcp-keyrow">
                  <span>When Muse asks for a key</span>
                  <Mono>{made.key}</Mono>
                  <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => copy(made.key, "Key copied")}>
                    <I.copy size={13} />
                    Copy key
                  </button>
                </span>
              )}
              <small className="lc-mcp-quiet">{kind === "grokbot" ? "By hand: in Grok Bot, Connect apps › Add a custom connector › Remote HTTPS, with the address and that header." : kind === "muse" ? "Muse sends it as a bearer token. Paste it only into Muse's own prompt, never into the chat." : "Keep the key out of chats and files others can read."}</small>
            </div>
          )}
        </div>
        <div className="lc-sheet-foot lc-mcp-add-foot">
          <small>{oauth ? "A sign-in lasts 30 days. Revoke it in Liner MCP." : "The key shows once and lasts 30 days. Revoke it in Liner MCP."}</small>
          <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
