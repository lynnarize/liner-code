/*
  Add-ons, from the left sidebar (DeepSeek Harness's Plugins page): what you've added to Liner Code,
  each in a plain sentence with its switch, and the ways to add another: an agent makes it in
  Workshop, it comes from GitHub or a folder, or you connect a service with its key. A row opens
  its details: where it shows, what it can touch, its versions, who made it, and Remove. Settings ›
  Add-ons keeps the detailed view, manifest words and all.

  One from GitHub or a folder gets nothing an agent's draft doesn't. The engine checks it as it
  checks theirs (engine/src/sources.ts), it's shown on the same card with the network held, and
  only that card's yes adds it. It runs where every add-on does: never inside Liner Code itself.
*/
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { AddonAsk, AddonInfo, ConnectionAsk, PanelAccess, PanelAsk, PanelIcon, PanelPlace } from "@contracts";
import { addonKey, summaryOf } from "@contracts";
import { ApprovalCard } from "@liner/pro/approval-card/approval-card";
import { Dialog } from "@liner/components/dialog/dialog";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { toast } from "@liner/components/toast/toast";
import { appIcon, dayOf, openApp, openSession } from "./Addon";
import { bridge, isNative } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { plural, since } from "./model";
import { startCreator } from "./Modes";
import { retryPanel, useStoppedPanels } from "./panelLife";
import { NamedSwitch, Pop } from "./ui";
import * as os from "./os";
import "./addons-page.css";

/** What a stopped panel's row says, in DeepSeek Harness's shape: a reason, with the Problem tag beside the name. */
const STOPPED_REASON = "Reason: it stopped running. Anything it was showing is gone.";

// The by-hand form for a connection lives with Settings, which loads only when it's needed.
const AddByHand = lazy(() => import("./Settings").then((m) => ({ default: m.AddByHand })));
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error: /, "");

/** Each tile's colour, by its icon: the same add-on always looks the same. */
const TINT: Record<PanelIcon | "plug", [string, string]> = {
  notes: ["oklch(0.5 0.15 258)", "#fff"],
  list: ["oklch(0.62 0.13 152)", "#fff"],
  check: ["oklch(0.62 0.13 152)", "#fff"],
  clock: ["oklch(0.86 0.1 85)", "oklch(0.4 0.08 70)"],
  star: ["oklch(0.86 0.1 85)", "oklch(0.4 0.08 70)"],
  bolt: ["oklch(0.86 0.1 85)", "oklch(0.4 0.08 70)"],
  chart: ["oklch(0.6 0.11 200)", "#fff"],
  globe: ["oklch(0.55 0.12 235)", "#fff"],
  flask: ["oklch(0.58 0.16 340)", "#fff"],
  inbox: ["oklch(0.66 0.15 45)", "#fff"],
  app: ["oklch(0.4 0.03 265)", "#fff"],
  blocks: ["oklch(0.4 0.03 265)", "#fff"],
  plug: ["oklch(0.45 0.14 285)", "#fff"],
};
function Tile({ a, size = 52 }: { a: { kind?: string; panel?: { icon?: PanelIcon }; icon?: PanelIcon }; size?: number }) {
  const icon = a.kind === "connection" || (!a.panel && !a.icon) ? "plug" : (a.panel?.icon ?? a.icon ?? "blocks");
  const Icon = icon === "plug" ? I.plug : appIcon(icon);
  const [bg, fg] = TINT[icon];
  return (
    <span className="lc-ao-tile" style={{ width: size, height: size }} aria-hidden>
      <span style={{ background: bg, color: fg }}>
        <Icon size={size > 50 ? 19 : 18} />
      </span>
    </span>
  );
}

const SHOWS: Record<PanelPlace, string> = { page: "Its own page, from the sidebar", tab: "A tab beside Chat in your sessions", dock: "A panel in the right dock, beside your sessions" };
const KIND: Record<PanelPlace, string> = { page: "App · its own page", tab: "App · a tab beside Chat", dock: "Panel · beside the session" };

/** What a panel can touch, in a few plain words: "This project's files · no internet". */
function touches(a: PanelAccess, place: PanelPlace) {
  const reads = [a.files && "This project's files", a.sessions === "this" && (place === "tab" ? "This session" : "The session it's beside"), a.sessions === "all" && "Your sessions' titles and changes", a.composer && "The composer, to put text in for you"].filter(Boolean) as string[];
  if (a.storage) reads.push(reads.length ? "its own storage" : "Only its own storage");
  if (a.ai) reads.push("a model you pick");
  reads.push(a.network ? `${a.network}, and no other address` : "no internet");
  return reads.join(" · ");
}

/** Who added it: an agent in a session (a link to it), or you, from GitHub or a folder. */
function madeBy(a: AddonInfo, open: boolean): ReactNode {
  if (a.by.from) return `You, from ${a.by.from}`;
  if (!a.by.title) return a.by.agent;
  return (
    <>
      {a.by.agent}, in{" "}
      {open && a.by.threadId ? (
        <button type="button" className="lc-ao-link l-focus" onClick={() => openSession(a.by.threadId!)}>
          “{a.by.title}”
        </button>
      ) : (
        `“${a.by.title}”`
      )}
    </>
  );
}

export function AddonsPage({ sidebar, onSidebar, onMake }: { sidebar: boolean; onSidebar: () => void; onMake: () => void }) {
  const addons = useEngine((x) => x.addons);
  const off = useEngine((x) => x.addonsOff);
  const stopped = useStoppedPanels();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<"source" | "connect" | null>(null);
  const [looking, setLooking] = useState(false);
  const shown = addons.filter((a) => !a.removed);
  const removed = addons.filter((a) => a.removed);
  const picked = addons.find((a) => a.id === open);
  const update = (id: string, p: { enabled?: boolean; version?: number; removed?: boolean }) => void rpc("addons.update", { id, ...p }).catch(fail);
  const refresh = () => {
    setLooking(true);
    void rpc("addons.list", {})
      .catch(fail)
      .finally(() => setLooking(false));
  };
  return (
    <div className="lc-apppage lc-ao-page">
      <header className="lc-top" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <span className="lc-grow" data-drag />
      </header>
      <div className="lc-ao-scroll">
        <div className="lc-ao-col">
          <header className="lc-ao-head">
            <div>
              <h1>Add-ons</h1>
              <p>
                Turn on and set up what you've added to Liner Code
                <Tooltip content="Connections let your agents work with a service. Panels show beside your sessions, and apps have a page of their own. Each one asked you first, runs sealed off with only what you allowed, and keeps its versions.">
                  <button type="button" className="lc-ao-info l-focus" aria-label="About add-ons">
                    <I.info size={13} />
                  </button>
                </Tooltip>
              </p>
            </div>
            <button type="button" className="lc-ao-ghost l-focus" aria-label="Look again" title="Look again" data-busy={looking || undefined} onClick={refresh}>
              <I.refresh size={16} />
            </button>
            <span className="lc-ao-split">
              <button type="button" className="l-focus" onClick={() => setAdding("source")}>
                <I.plus size={14} />
                Add add-on
              </button>
              <Pop label="More ways to add one" align="end" width={290} triggerClass="lc-ao-split-more" trigger={<I.chevD size={13} />}>
                {(close) => (
                  <div className="lc-ao-ways" role="menu" aria-label="Ways to add one">
                    {(
                      [
                        { icon: I.sparkle, label: "Make one with an agent", note: "Describe it, and Workshop builds it", pick: onMake },
                        { icon: I.link, label: "From GitHub or a folder", note: "Add one someone else made", pick: () => setAdding("source") },
                        { icon: I.plug, label: "Connect a service", note: "Linear, Sentry and others, with a key", pick: () => setAdding("connect") },
                      ] as const
                    ).map((w) => (
                      <button key={w.label} type="button" role="menuitem" className="l-focus" onClick={() => (close(), w.pick())}>
                        <w.icon size={15} />
                        <span>
                          <b>{w.label}</b>
                          <small>{w.note}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Pop>
            </span>
          </header>
          {off && <p className="lc-ao-banner">Add-ons are off until Liner Code starts again: none reach any tool.</p>}
          <section className="lc-ao-list" aria-labelledby="lc-ao-installed">
            <h2 id="lc-ao-installed">Installed</h2>
            {shown.map((a) => (
              <div key={a.id} className="lc-ao-row" data-off={!a.enabled || undefined} data-state={a.enabled && stopped.has(a.id) ? "failed" : undefined}>
                <button type="button" className="lc-ao-open l-focus" aria-label={`Details for ${a.name}`} onClick={() => setOpen(a.id)}>
                  <Tile a={a} />
                  <span>
                    <b>
                      {a.name}
                      {a.enabled && stopped.has(a.id) && <i className="lc-ao-tag">Problem</i>}
                    </b>
                    <small>{a.enabled && stopped.has(a.id) ? STOPPED_REASON : summaryOf(a)}</small>
                  </span>
                </button>
                {a.enabled && stopped.has(a.id) && (
                  <button type="button" className="lc-btn" data-size="sm" onClick={() => retryPanel(a.id)}>
                    Retry
                  </button>
                )}
                <NamedSwitch name={a.enabled ? `Turn off ${a.name}` : `Turn on ${a.name}`} checked={a.enabled} onCheckedChange={(enabled) => update(a.id, { enabled })} />
              </div>
            ))}
            {!shown.length && (
              <div className="lc-ao-empty">
                <b>Nothing added yet</b>
                <p>Say what you'd like, and an agent makes it in Workshop: a page for your notes, a panel of TODOs, a connection to Linear. Or add one someone else made.</p>
                <span>
                  <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={onMake}>
                    <I.sparkle size={13} />
                    Make one with an agent
                  </button>
                  <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setAdding("source")}>
                    From GitHub or a folder
                  </button>
                </span>
              </div>
            )}
          </section>
          {removed.length > 0 && (
            <section className="lc-ao-list" aria-labelledby="lc-ao-removed">
              <h2 id="lc-ao-removed">Removed</h2>
              {removed.map((a) => (
                <div key={a.id} className="lc-ao-row" data-removed>
                  <span className="lc-ao-open">
                    <Tile a={a} />
                    <span>
                      <b>{a.name}</b>
                      <small>Removed {since(a.removed!)}. Its files are kept, so it can come back.</small>
                    </span>
                  </span>
                  <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => update(a.id, { removed: false })}>
                    Restore
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
      {picked && !picked.removed && <Details a={picked} onClose={() => setOpen(null)} />}
      {adding === "source" && (
        <AddFrom
          onClose={() => setAdding(null)}
          onMake={() => {
            setAdding(null);
            onMake();
          }}
        />
      )}
      {adding === "connect" && (
        <Dialog open onOpenChange={(o) => !o && setAdding(null)} title="Connect a service" description={`Paste the connection's settings, as its maker gives them, and type its key. The key goes to ${os.keyStore(`${os.here}'s keychain`)}, never into a chat.`} size="lg" className="lc-ao-connect">
          <Suspense fallback={null}>
            <AddByHand onDone={() => setAdding(null)} />
          </Suspense>
        </Dialog>
      )}
    </div>
  );
}

/**
  One add-on's details, in a panel from the right: what it does, where it shows, what it can touch,
  its version (and the way back to the one before), who made it, its projects; then ask an agent to
  change it, its files, and Remove, which keeps its files so it can come back.
*/
function Details({ a, onClose }: { a: AddonInfo; onClose: () => void }) {
  const projects = useEngine((x) => x.projects);
  const keys = useEngine((x) => x.keys);
  const threads = useEngine((x) => x.threads);
  const home = useEngine((x) => x.home);
  const [files, setFiles] = useState<{ path: string; size: number }[] | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  // Another version has other files: the list shown was the old one's.
  useEffect(() => setFiles(null), [a.id, a.version]);
  useEffect(() => setSure(false), [a.id]);
  const update = (p: { version?: number; removed?: boolean }) => rpc("addons.update", { id: a.id, ...p });
  const prev = Math.max(0, ...a.versions.filter((v) => v < a.version));
  const latest = Math.max(...a.versions);
  const day = a.dates?.[a.version];
  const when = day ? (new Date(day).toDateString() === new Date().toDateString() ? "updated today" : dayOf(day)) : "";
  const where = a.project ? (projects.find((p) => p.id === a.project)?.name ?? "One project") : "Every project";
  const missing = a.secrets.filter((k) => !keys.includes(addonKey(a.id, k.name)));
  const facts: [string, ReactNode][] = a.panel
    ? [
        ["Shows", a.panel.place === "page" ? `Its own page, from ${a.name} in the sidebar` : SHOWS[a.panel.place]],
        ["Can touch", touches(a.panel.access, a.panel.place)],
        ["Version", [`v${a.version}`, when, a.version < latest ? `v${latest} is kept` : ""].filter(Boolean).join(" · ")],
        [a.by.from ? "Added by" : "Made by", madeBy(a, threads.some((t) => t.id === a.by.threadId))],
        ["Projects", a.panel.place === "page" ? "Every project" : where],
      ]
    : [
        ["Works with", "Claude Code, Codex, OpenCode and Hermes"],
        ["Signs in", !a.secrets.length ? "It needs no key" : missing.length ? `Its ${missing[0].label} is missing: type it in Settings › Add-ons` : `With your ${a.secrets.map((k) => k.label).join(" and ")}, kept in ${os.keyStore("this Mac's keychain")}`],
        ["Version", [`v${a.version}`, when, a.version < latest ? `v${latest} is kept` : ""].filter(Boolean).join(" · ")],
        ["Added by", madeBy(a, threads.some((t) => t.id === a.by.threadId))],
        ["Projects", where],
      ];
  const showFiles = async () => {
    if (files) return setFiles(null);
    if (!a.panel) return setFiles([{ path: "addon.json", size: 0 }]);
    try {
      const got = await rpc("addons.files", { id: a.id });
      setFiles(Object.entries(got.files).map(([path, text]) => ({ path, size: new Blob([text]).size })));
    } catch (e) {
      fail(e);
    }
  };
  const change = () => {
    onClose();
    void startCreator({ title: `Change ${a.name}`, text: `I'd like to change the ${a.name} add-on (${a.id}). Read how it is now with liner_inspect, then ask me what to change.` });
  };
  return (
    <div className="lc-ao-sheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside aria-label={a.name}>
        <header>
          <Tile a={a} size={48} />
          <div>
            <b>{a.name}</b>
            <span>{a.panel ? KIND[a.panel.place] : "Connection"}</span>
          </div>
          <button type="button" className="lc-ao-ghost l-focus" aria-label="Close" autoFocus onClick={onClose}>
            <I.close size={15} />
          </button>
        </header>
        <div className="lc-ao-sheet-body">
          <p>{summaryOf(a)}</p>
          <dl>
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="lc-ao-acts">
            {prev > 0 && (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void update({ version: prev }).then(() => toast(`${a.name} is back to v${prev}`), fail)}>
                Back to v{prev}
              </button>
            )}
            {a.version < latest && (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => void update({ version: latest }).then(() => toast(`${a.name} is on v${latest}`), fail)}>
                Up to v{latest}
              </button>
            )}
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={change}>
              Ask an agent to change it
            </button>
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" aria-expanded={Boolean(files)} onClick={() => void showFiles()}>
              {files ? "Hide its files" : "Show its files"}
            </button>
            {a.panel?.place === "page" && a.enabled && (
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => (onClose(), openApp({ id: a.id, place: "page" }))}>
                Open it
              </button>
            )}
          </div>
          {files && (
            <div className="lc-ao-files">
              <ul>
                {files.map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code>
                    {f.size > 0 && <small>{f.size < 1000 ? `${f.size} B` : `${Math.round(f.size / 1000)} KB`}</small>}
                  </li>
                ))}
              </ul>
              <span className="lc-quiet lc-mono">{os.tilde(`${home}/addons/${a.id}/v${a.version}`)}</span>
              {isNative() && (
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => bridge.reveal(`${home}/addons/${a.id}/v${a.version}`)}>
                  Show in {os.fileManager}
                </button>
              )}
            </div>
          )}
        </div>
        <footer>
          {sure ? (
            <>
              <span className="lc-quiet">It turns off everywhere. Its files are kept, so it can come back.</span>
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => setSure(false)}>
                Keep it
              </button>
              <button type="button" className="lc-btn lc-ao-remove" data-kind="plain" data-size="sm" autoFocus onClick={() => void update({ removed: true }).then(() => (toast(`Removed ${a.name}`, { description: "Its files are kept: Restore brings it back." }), onClose()), fail)}>
                Remove
              </button>
            </>
          ) : (
            <button type="button" className="lc-ao-remove l-focus" onClick={() => setSure(true)}>
              Remove {a.name}…
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

type Opened = { token: string; from: string; ask: AddonAsk };

/**
  From GitHub or a folder: an address or a folder, then the card. "Add" asks the engine to fetch and
  check it; nothing is kept until the card's yes, and closing the dialog drops what was fetched.
*/
function AddFrom({ onClose, onMake }: { onClose: () => void; onMake: () => void }) {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [about, setAbout] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  // Whatever was fetched and not answered goes when the dialog does.
  useEffect(() => () => void (opened && rpc("addons.drop", { token: opened.token }).catch(() => {})), [opened]);
  const look = async () => {
    setBusy(true);
    setWhy("");
    try {
      setOpened(await rpc("addons.source", { source }));
    } catch (e) {
      setWhy(message(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = () =>
    void bridge.pickFolder().then((p) => {
      if (p) setSource(p);
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add an add-on" size="md" className="lc-ao-add">
      {opened ? (
        <SourceCard
          o={opened}
          onAdded={(a) => {
            setOpened(null);
            onClose();
            toast.success(`${a.name} is added`, a.panel?.place === "page" ? { action: { label: "Open", onClick: () => openApp({ id: a.id, place: "page" }) } } : undefined);
          }}
          onNo={() => setOpened(null)}
        />
      ) : (
        <form
          className="lc-ao-from"
          onSubmit={(e) => {
            e.preventDefault();
            if (source.trim() && !busy) void look();
          }}
        >
          <p>Paste a GitHub address, or choose a folder that has an add-on in it.</p>
          <input className="lc-input" type="text" aria-label="Where the add-on is" placeholder="for example github.com/someone/liner-pomodoro" spellCheck={false} autoComplete="off" autoFocus value={source} onChange={(e) => (setSource(e.target.value), setWhy(""))} aria-invalid={Boolean(why) || undefined} aria-describedby={why ? "lc-ao-why" : undefined} />
          {why && (
            <p id="lc-ao-why" className="lc-ao-why" role="alert">
              {why}
            </p>
          )}
          <div className="lc-ao-from-row">
            <button type="button" className="lc-ao-quiet l-focus" aria-expanded={about} onClick={() => setAbout((x) => !x)}>
              <I.chevR size={12} />
              What can I add?
            </button>
            <span className="lc-grow" />
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={pick}>
              <I.folder size={13} />
              Choose a folder…
            </button>
          </div>
          {about && <p className="lc-ao-about">A connection, which lets your agents work with a service, or a panel or app, which shows beside your sessions or on a page of its own. It's a folder with an addon.json in it. On GitHub, paste the repository's address, or the address of the folder in it that holds the add-on.</p>}
          <div className="lc-ao-trust">
            <I.alert size={15} />
            <span>Add only what you trust. Before it's turned on, you'll see what it can touch, and it never runs inside Liner Code itself.</span>
          </div>
          <button type="submit" className="lc-btn lc-ao-go" data-kind="primary" disabled={!source.trim() || busy}>
            {busy ? (/github/i.test(source) ? "Fetching it from GitHub…" : "Reading it…") : "Add"}
          </button>
          <button type="button" className="lc-ao-quiet lc-ao-make l-focus" onClick={onMake}>
            <I.sparkle size={13} />
            Or describe it, and an agent makes it in Workshop
          </button>
        </form>
      )}
    </Dialog>
  );
}

/** "Claude Code, Codex, OpenCode and Hermes". */
const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const kbWords = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024} MB` : `${n} KB`);

/**
  The card for one from outside: the same words and fields as an agent's install card on the
  timeline, from where it came instead of who asked, for every project. A panel that reaches the
  internet is held to allow; a connection's keys go to the keychain and the engine before it's added.
*/
function SourceCard({ o, onAdded, onNo }: { o: Opened; onAdded: (a: AddonInfo) => void; onNo: () => void }) {
  const keys = useEngine((x) => x.keys);
  const [more, setMore] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const a = o.ask;
  const from = `From ${o.from}`;
  const yes = async () => {
    try {
      if (a.kind !== "panel")
        for (const k of a.secrets) {
          const v = values[k.name]?.trim();
          if (!v) continue;
          await bridge.keychainSet(`key:${addonKey(a.id, k.name)}`, v);
          await rpc("keys.set", { provider: addonKey(a.id, k.name), key: v });
        }
      const list = await rpc("addons.adopt", { token: o.token });
      const got = list.find((x) => x.id === a.id);
      if (got) onAdded(got);
    } catch (e) {
      fail(e);
      throw e;
    }
  };
  const no = async () => {
    await rpc("addons.drop", { token: o.token }).catch(() => {});
    onNo();
  };
  const aside = (label: string) => (
    <>
      <button type="button" className="lc-appr-more l-focus" aria-expanded={more} onClick={() => setMore((d) => !d)}>
        <I.chevR size={11} />
        {more ? "Less" : label}
      </button>
      <code className="lc-addon-path" title={o.from}>
        {o.from}
      </code>
    </>
  );
  if (a.kind === "panel") {
    const p = a as PanelAsk;
    const net = p.access.network;
    const Icon = net ? I.globe : appIcon(p.icon);
    const reads = [p.access.files && "Files in the project it's open in", p.access.sessions === "this" && (p.place === "tab" ? "This session: its title, changes and commands" : "The session it's beside: its title, changes and commands"), p.access.sessions === "all" && "Your sessions' titles and changes, in every project"].filter(Boolean).join(" · ") || "Nothing";
    const fields = [
      ...(net ? [{ label: "Network", value: <code className="lc-addon-mono">{net}</code> }] : []),
      { label: "Reads", value: <span className="lc-addon-wrap">{reads}</span> },
      { label: "Can do", value: p.access.composer ? "Put text in the composer, for you to send" : "Nothing but show itself" },
      ...(p.access.ai ? [{ label: "Model", value: "Asks a model you pick when it first asks, billed to that model's account. Just a model: no tools or files" }] : []),
      { label: "Keeps", value: p.access.storage ? `Its own storage, up to ${kbWords(p.access.storage)}` : "Nothing" },
      ...(net ? [] : [{ label: "Network", value: "None" }]),
      ...(p.replaces ? [{ label: "Replaces", value: `v${p.replaces}, which stays kept` }] : []),
      { label: "Where", value: p.place === "page" ? "Under Apps, in the left sidebar" : p.place === "tab" ? "A tab beside Chat, in every project" : "The right dock, in every project" },
      ...(more
        ? [
            { label: "Files", value: <span className="lc-addon-files">{p.files.map((f) => <span key={f.path}><code>{f.path}</code> <small>{f.size < 1000 ? `${f.size} B` : `${Math.round(f.size / 1000)} KB`}</small></span>)}</span> },
            { label: "Manifest", value: <pre className="lc-ask-cmd lc-addon-json">{p.manifest}</pre> },
          ]
        : []),
    ];
    return (
      <div className="lc-addon lc-ao-card" data-kind="panel" data-net={net ? true : undefined}>
        <ApprovalCard
          agent={`An add-on ${from.toLowerCase()}`}
          title={p.place === "page" ? `${p.name}, a page of its own` : p.place === "tab" ? `${p.name}, a tab beside Chat` : `${p.name}, beside your sessions`}
          ask={`${from}: ${p.place === "dock" ? "a panel" : "an app"}${net ? " that reaches the internet" : ""}`}
          icon={<Icon size={16} />}
          description={net ? `Whatever it reads could leave ${os.here} through ${net}. It can reach that one, and no other.` : `It runs in a sealed frame ${p.place === "page" ? "of its own" : "beside the session"}, never in Liner Code's engine, and gets only what it lists below.`}
          fields={fields}
          hold={Boolean(net)}
          aside={aside(`Its ${plural(p.files.length, "file")}`)}
          approveLabel={net ? "Hold to allow" : "Add it"}
          denyLabel="Not this"
          onApprove={yes}
          onDeny={no}
          explain={false}
          approvedText="Added"
          deniedText="Not added"
        />
      </div>
    );
  }
  const c = a as ConnectionAsk;
  // A key kept for the server it pointed at before isn't sent to a new one: it's typed again.
  const kept = (name: string) => !c.moved && keys.includes(addonKey(c.id, name));
  const missing = c.secrets.filter((k) => !values[k.name]?.trim() && !kept(k.name));
  const fields = [
    { label: "Server", value: <code className="lc-addon-mono">{os.tilde(c.server)}</code> },
    ...(c.moved ? [{ label: "Was", value: <code className="lc-addon-mono">{os.tilde(c.moved)}</code> }] : []),
    ...(c.replaces ? [{ label: "Replaces", value: `v${c.replaces}, which stays kept` }] : []),
    { label: "Reaches", value: c.reaches.length ? andList(c.reaches) : "Every agent tool" },
    { label: "Where", value: "Every project" },
    ...c.secrets.map((k) => ({
      label: k.label,
      value: (
        <span className="lc-addon-key">
          <input type="password" autoComplete="off" spellCheck={false} aria-label={k.label} placeholder={kept(k.name) ? "Kept from before · type to replace" : c.moved && keys.includes(addonKey(c.id, k.name)) ? "Type it again for the new server" : k.name} value={values[k.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k.name]: e.target.value }))} />
          <small>
            <I.lock size={12} />
            {isNative() ? `Sealed in ${os.keyStore(`${os.here}'s keychain`)}, and never put in a chat.` : "Kept in Liner Code's memory until it quits, and never put in a chat."}
          </small>
        </span>
      ),
    })),
    ...(more
      ? [
          ...(c.description ? [{ label: "About", value: <span className="lc-addon-wrap">{c.description}</span> }] : []),
          ...(c.env?.length ? [{ label: "Gets", value: <span className="lc-addon-wrap">{c.env.join(", ")}</span> }] : []),
          { label: "Manifest", value: <pre className="lc-ask-cmd lc-addon-json">{c.manifest}</pre> },
        ]
      : []),
  ];
  return (
    <div className="lc-addon lc-ao-card">
      <ApprovalCard
        agent={`An add-on ${from.toLowerCase()}`}
        title={`${c.name}, for every agent tool`}
        ask={`${from}: a connection`}
        icon={<I.plug size={16} />}
        description={`Settings only: nothing runs inside Liner Code. Each tool ${c.transport === "http" ? "reaches" : "starts"} ${c.name}'s server itself${c.secrets.length ? ", with the key below" : ""}.`}
        fields={fields}
        aside={aside("Details")}
        approveLabel="Add it"
        approveDisabled={missing.length > 0}
        approveHint={missing.length ? `Type the ${missing[0].label} first` : undefined}
        denyLabel="Not this"
        onApprove={yes}
        onDeny={no}
        explain={false}
        approvedText="Added"
        deniedText="Not added"
      />
    </div>
  );
}
