/*
  An add-on panel in the window: the sealed frame it runs in, the window's half of its bridge, and
  everything round it. The frame is a srcdoc iframe with `sandbox="allow-scripts"` and nothing
  more, its document built by contracts/src/panel.ts (the content policy and window.liner come
  before anything the agent wrote). A message counts only from that frame's own window; each
  request goes to the engine with which panel asked and from which session, and the engine answers
  only what its access allows (engine/src/panels.ts). The app's colours reach it as CSS variables,
  as a shown page's do (Page.tsx).

  Round it: the strip that says whose it is, which version, and exactly what it touches, with its
  menu (versions, change it, its files, where it shows, off, remove); a notice when the content
  policy blocked a request; the card that takes its place when it breaks; and its off and removed
  states. A preview (a panel whose install card is up) wears a ring and says nothing is kept yet.
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AddonInfo, Item, PanelAsk, PanelIcon, PanelPlace, Thread } from "@contracts";
import { panelDocument, PANEL_API } from "@contracts";
import { HoldToConfirm } from "@liner/components/hold-to-confirm/hold-to-confirm";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { AppModelChip, appModelOf, pickAppModel } from "./AppModel";
import { getState, loadItems, onStream, rpc, useEngine, useItemsWhere } from "./engine";
import { toComposer } from "./Find";
import { I } from "./icons";
import { modelLabel } from "./model";
import { THEME_ATTRS, theme } from "./Page";
import { PanelHead, Pop, Row, Sep } from "./ui";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const ICONS: Record<PanelIcon, (p: { size?: number }) => ReactNode> = { app: I.app, blocks: I.blocks, list: I.list, notes: I.notes, chart: I.usage, check: I.settle, clock: I.clock, globe: I.globe, flask: I.flask, star: I.star, bolt: I.bolt, inbox: I.inbox };
export const appIcon = (icon?: PanelIcon) => (icon ? ICONS[icon] : I.blocks);

/** A panel's install card on the timeline (a view for useItemsWhere). */
export const isPanelAsk = (it: Item) => it.kind === "approval" && it.addon?.kind === "panel";

/** The panels a session in this project may open: on, not removed, for it or for every project. */
export const appsFor = (addons: AddonInfo[], projectId?: string) => addons.filter((a) => a.panel && a.enabled && !a.removed && (!a.project || !projectId || a.project === projectId));
export const dayOf = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** What a panel's strip says it is: "Add-on by Opus 5.5 · v2 · reads this project's files · no network". */
const stripOf = (a: { by?: string; version?: number; reaches: string; place: PanelPlace; preview?: boolean }) =>
  [`${a.preview ? "Preview" : a.place === "dock" ? "Add-on" : "App"} by ${a.by ?? "an agent"}`, a.version ? `v${a.version}` : "", a.reaches].filter(Boolean).join(" · ");

/** A panel's access in words, for a preview whose add-on isn't kept yet (the engine words a kept one). */
export function accessLine(a: PanelAsk["access"], place: PanelPlace) {
  const out: string[] = [];
  if (a.files) out.push("reads this project's files");
  if (a.sessions === "this") out.push(place === "tab" ? "reads this session" : "reads the session it's beside");
  if (a.sessions === "all") out.push("reads your sessions' titles and changes");
  if (a.composer) out.push("can put text in the composer");
  if (a.storage) out.push(`keeps its own storage, up to ${kb(a.storage)}`);
  if (a.ai) out.push("asks a model you pick");
  out.push(a.network ? `reaches ${a.network}` : "no network");
  return out.join(" · ");
}
const kb = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024} MB` : `${n} KB`);

type Loaded = { files: Record<string, string>; entry: string; access: PanelAsk["access"]; place: PanelPlace; name: string };

/**
  A panel in a tab of the dock, beside Chat, or on a page: an add-on you have (`addon`), or the draft
  on a card that's up (`preview`, its item). `thread` is the session it's beside; a page has none.
*/
export function AddonView({ addon, preview, thread, agentName, visible = true, onOpenElsewhere }: { addon: string; preview?: string; thread?: Thread; agentName: string; visible?: boolean; onOpenElsewhere?: () => void }) {
  const info = useEngine((s) => s.addons.find((a) => a.id === addon && a.panel));
  const off = useEngine((s) => s.addonsOff);
  const projects = useEngine((s) => s.projects);
  const asks = useItemsWhere(thread?.id, isPanelAsk) as Extract<Item, { kind: "approval" }>[];
  const ask = preview ? asks?.find((x) => x.id === preview && x.state === "asking")?.addon : undefined;
  const draft = ask?.kind === "panel" ? ask : undefined;

  if (preview) {
    if (!draft || !thread) return <PanelNote icon={<I.blocks size={20} />} title="This preview is over" body="Its card was answered, or the turn it was asked in ended." />;
    return (
      <div className="lc-addon-view" data-preview>
        <div className="lc-addon-banner" role="note">
          <I.eye size={13} />
          <span>A preview: try it. Nothing is kept until you add it.</span>
        </div>
        <Frame key={preview} source={{ threadId: thread.id, itemId: preview }} addon={addon} preview={preview} thread={thread} agentName={agentName} visible={visible} />
        <div className="lc-addon-strip">
          <I.shield size={13} />
          <span>{stripOf({ by: agentName, reaches: accessLine(draft.access, draft.place), place: draft.place, preview: true })}</span>
          {draft.access.ai && <AppModelChip addon={addon} name={draft.name} />}
        </div>
      </div>
    );
  }
  if (!info?.panel) return <PanelNote icon={<I.blocks size={20} />} title="This add-on is gone" body="It was removed, or this window doesn't have it yet." />;
  const strip = (
    <div className="lc-addon-strip">
      <I.shield size={13} />
      <span>{info.enabled && !info.removed ? stripOf({ by: info.by.agent, version: info.version, reaches: info.reaches, place: info.panel.place }) : `${info.panel.place === "dock" ? "Add-on" : "App"} by ${info.by.agent} · off`}</span>
      {info.panel.access.ai && info.enabled && !info.removed && <AppModelChip addon={info.id} name={info.name} />}
      <AddonMenu a={info} thread={thread} agentName={agentName} onOpenElsewhere={onOpenElsewhere} />
    </div>
  );
  if (info.removed)
    return (
      <div className="lc-addon-view">
        <PanelNote icon={<I.trash size={20} />} title={`You removed ${info.name}`} body="Its files, versions and storage are kept, so it can come back." action={<button type="button" className="lc-btn" data-kind="ghost" onClick={() => void rpc("addons.update", { id: info.id, removed: false }).catch(fail)}>Restore</button>} />
      </div>
    );
  if (!info.enabled || off)
    return (
      <div className="lc-addon-view">
        {off ? (
          <PanelNote icon={<I.shieldOff size={20} />} title="Add-ons are off for now" body="Liner Code started without them this time. They're back the next time it starts." />
        ) : (
          <PanelNote icon={<I.shieldOff size={20} />} title={`${info.name} is off`} body="Its files, versions and storage are kept. It won't open in any session until you turn it on." action={<button type="button" className="lc-btn" onClick={() => void rpc("addons.update", { id: info.id, enabled: true }).catch(fail)}>Turn it on</button>} />
        )}
        {strip}
      </div>
    );
  if (info.project && thread && info.project !== thread.projectId) {
    const where = projects.find((p) => p.id === info.project)?.name ?? "another project";
    return (
      <div className="lc-addon-view">
        <PanelNote icon={<I.folder size={20} />} title={`${info.name} is for ${where}`} body="It shows in that project's sessions only." action={<button type="button" className="lc-btn" data-kind="ghost" onClick={() => void rpc("addons.update", { id: info.id, project: null }).catch(fail)}>Show it in every project</button>} />
        {strip}
      </div>
    );
  }
  return (
    <div className="lc-addon-view">
      <Frame key={`${info.id}:${info.version}`} source={{ id: info.id, version: info.version }} addon={info.id} thread={info.panel.place === "page" ? undefined : thread} agentName={agentName} visible={visible} info={info} />
      {strip}
    </div>
  );
}

/** The frame itself, with the window's half of its bridge, and what shows instead when it breaks. */
function Frame({ source, addon, preview, thread, agentName, visible, info }: { source: { id: string; version: number } | { threadId: string; itemId: string }; addon: string; preview?: string; thread?: Thread; agentName: string; visible: boolean; info?: AddonInfo }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState<Loaded | { error: string } | null>(null);
  const [crash, setCrash] = useState<{ message: string; stack?: string } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const count = useEngine((s) => (thread ? (s.items[thread.id]?.length ?? 0) : 0));
  // A model's answers it's waiting on: stopped when the frame goes (closed, another version, run again).
  const asking = useRef(new Set<string>());
  useEffect(() => {
    const now = asking.current;
    return () => {
      for (const call of now) void rpc("panel.cancel", { call }).catch(() => {});
      now.clear();
    };
  }, [loaded, run]);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    void rpc("addons.files", source)
      .then((r) => live && setLoaded({ files: r.files, entry: r.entry, access: r.access, place: r.place, name: r.name }))
      .catch((e) => live && setLoaded({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [JSON.stringify(source)]);

  const ok = loaded && !("error" in loaded) ? loaded : null;
  const doc = useMemo(() => (ok ? panelDocument({ files: ok.files, entry: ok.entry, access: ok.access, theme: theme(), place: ok.place }) : ""), [ok, run]);

  // The bridge: only this frame's own window is heard, and every request is the engine's to answer.
  useLayoutEffect(() => {
    if (!ok) return;
    const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ liner: 1, ...m }, "*");
    // Once you dismiss the model popup, it stays shut for this frame (its strip still changes the
    // model): an app can't keep putting it back up. A pick answered after the frame went asks nothing.
    let live = true;
    let declined = false;
    const pickOnce = async () => {
      if (declined) return null;
      const ref = await pickAppModel(addon, ok.name);
      if (!ref) declined = true;
      return ref;
    };
    const onMsg = async (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { liner?: number; kind?: string; id?: number; method?: string; args?: unknown; message?: string; stack?: string; host?: string; directive?: string } | null;
      if (!d || d.liner !== 1) return;
      if (d.kind === "error") return setCrash({ message: String(d.message ?? "An error"), stack: d.stack ? String(d.stack) : undefined });
      if (d.kind === "blocked") return setBlocked(String(d.host || d.directive || "an address"));
      if (d.kind || typeof d.id !== "number" || typeof d.method !== "string") return;
      const id = d.id;
      try {
        // A model (access.ai): Liner Code's own popup picks and allows it, never the frame.
        if (ok.access.ai && d.method === "ai.pick") {
          const ref = await pickOnce();
          if (!live) return;
          return post({ id, ok: true, value: ref ? { name: modelLabel(ref, getState().providers) } : null });
        }
        if (ok.access.ai && d.method === "ai.ask") {
          const ref = appModelOf(addon) ?? (await pickOnce());
          if (!live) return;
          if (!ref) return post({ id, ok: false, error: `You didn't allow a model for ${ok.name}, so nothing was asked.` });
          const a = (d.args ?? {}) as Record<string, unknown>;
          const call = crypto.randomUUID();
          asking.current.add(call);
          // The answer's pieces as they come, for its onText.
          const off = a.stream ? onStream((e) => e.type === "panel.ai" && e.call === call && post({ event: "ai.text", data: { id, text: e.text } })) : () => {};
          try {
            const value = await rpc("panel.call", { addon, threadId: thread?.id, preview, method: d.method, args: { ...a, call }, apiVersion: PANEL_API });
            return post({ id, ok: true, value });
          } finally {
            off();
            asking.current.delete(call);
          }
        }
        const value = await rpc("panel.call", { addon, threadId: thread?.id, preview, method: d.method, args: d.args, apiVersion: PANEL_API });
        // What it puts in the composer lands there for you to send, or not.
        if (d.method === "composer.put" && thread) toComposer(thread.id, (value as { text: string }).text);
        post({ id, ok: true, value });
      } catch (err) {
        post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };
    window.addEventListener("message", onMsg);
    // Light and dark, and the accent, follow the app without reloading the panel.
    const mo = new MutationObserver(() => post({ event: "theme", data: theme() }));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
    return () => {
      live = false;
      window.removeEventListener("message", onMsg);
      mo.disconnect();
    };
  }, [ok, addon, preview, thread?.id]);

  // The session moving on reaches a panel that reads it, a moment after it settles.
  useEffect(() => {
    if (!ok?.access.sessions || !thread) return;
    const t = setTimeout(() => frame.current?.contentWindow?.postMessage({ liner: 1, event: "session" }, "*"), 400);
    return () => clearTimeout(t);
  }, [count, ok?.access.sessions]);

  if (!loaded) return <div className="lc-addon-frame" data-wait aria-busy />;
  if ("error" in loaded) return <PanelNote icon={<I.alert size={20} />} title="Its files didn't open" body={loaded.error} />;
  const name = loaded.name;
  const earlier = info ? info.versions.filter((v) => v < info.version).at(-1) : undefined;
  const reach = loaded.access.network;
  return (
    <>
      {blocked && (
        <div className="lc-addon-blocked" role="status">
          <I.shield size={13} />
          <span>
            Blocked a request to <b>{blocked}</b>. {reach ? `${name} may reach ${reach} and nothing else.` : `${name} didn't ask for the network, so it can't reach it.`}
          </span>
          <button type="button" className="lc-ib l-focus" aria-label="Dismiss" onClick={() => setBlocked(null)}>
            <I.close size={11} />
          </button>
        </div>
      )}
      {crash && (
        <div className="lc-addon-crash" role="alert">
          <span className="lc-addon-crash-i">
            <I.alert size={16} />
          </span>
          <div>
            <h2>{name} stopped</h2>
            <p>{info ? `v${info.version} hit` : "It hit"} an error while drawing. It runs on its own, so nothing else in Liner Code was touched.</p>
          </div>
          <pre>{crash.stack && crash.stack.includes(crash.message) ? crash.stack.split("\n").slice(0, 6).join("\n") : [crash.message, ...(crash.stack ?? "").split("\n").slice(0, 4)].filter(Boolean).join("\n")}</pre>
          <div className="lc-addon-crash-acts">
            {thread && (
              <button
                type="button"
                className="lc-btn"
                onClick={() => {
                  const at = /\(?([\w./-]+\.(?:js|html):\d+)(?::\d+)?\)?/.exec(crash.stack ?? "")?.[1];
                  const next = info ? Math.max(...info.versions) + 1 : undefined;
                  toComposer(
                    thread.id,
                    `The ${name} panel${info ? ` (v${info.version})` : ""} stopped: ${crash.message}${at ? ` at ${at}` : ""}.${blocked ? ` It also tried ${blocked}, which it can't reach: keep what it needs in its own files.` : ""} Fix it${next ? ` as v${next}` : ""}.`,
                  );
                }}
              >
                Ask {agentName} to fix it
              </button>
            )}
            {earlier && (
              <button type="button" className="lc-btn" data-kind="ghost" onClick={() => void rpc("addons.update", { id: addon, version: earlier }).catch(fail)}>
                Back to v{earlier}
              </button>
            )}
            {info ? (
              <button type="button" className="lc-btn" data-kind="ghost" onClick={() => void rpc("addons.update", { id: addon, enabled: false }).catch(fail)}>
                Turn it off
              </button>
            ) : (
              <button type="button" className="lc-btn" data-kind="ghost" onClick={() => (setCrash(null), setRun((n) => n + 1))}>
                Try it again
              </button>
            )}
          </div>
        </div>
      )}
      <iframe
        ref={frame}
        key={run}
        className="lc-addon-frame"
        title={name}
        sandbox="allow-scripts"
        srcDoc={doc}
        hidden={Boolean(crash)}
        // Out of sight it keeps running, but takes no keys.
        tabIndex={visible ? 0 : -1}
      />
    </>
  );
}

function PanelNote({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="lc-panel-empty lc-addon-note">
      {icon}
      <b>{title}</b>
      <p>{body}</p>
      {action}
    </div>
  );
}

/** A panel's ⋯: its versions, change it, its files, where it shows, off and remove. */
export function AddonMenu({ a, thread, agentName, onOpenElsewhere, triggerClass = "lc-ib" }: { a: AddonInfo; thread?: Thread; agentName: string; onOpenElsewhere?: () => void; triggerClass?: string }) {
  const projects = useEngine((s) => s.projects);
  const set = (p: { enabled?: boolean; version?: number; removed?: boolean; project?: string | null }) => void rpc("addons.update", { id: a.id, ...p }).catch(fail);
  const here = thread ? projects.find((p) => p.id === thread.projectId) : undefined;
  const page = a.panel?.place === "page";
  return (
    <Pop label={`More for ${a.name}`} align="end" side="top" width={290} triggerClass={triggerClass} trigger={<I.more size={14} />}>
      {(close) => (
        <div className="lc-addon-menu">
          <PanelHead>Versions</PanelHead>
          {[...a.versions].reverse().map((v) => (
            <Row key={v} title={`v${v}`} note={[v === a.version ? "In use" : "", a.dates?.[v] ? dayOf(a.dates[v]) : ""].filter(Boolean).join(" · ")} on={v === a.version} onPick={() => (set({ version: v }), close())} />
          ))}
          <Sep />
          {thread && <Row title={`Change it with ${agentName}`} icon={<I.edit size={13} />} onPick={() => (close(), toComposer(thread.id, `Change the ${a.name} ${page ? "app" : "panel"} so `))} />}
          <Row title="Show its files" icon={<I.folder size={13} />} onPick={() => (close(), void rpc("addons.read", { id: a.id }).then((r) => bridge.reveal(`${r.dir}/v${a.version}`)).catch(fail))} />
          {onOpenElsewhere && <Row title={page ? "Open it in the dock" : "Open it on its own"} icon={<I.dock size={13} />} onPick={() => (close(), onOpenElsewhere())} />}
          {!page && (a.project ? <Row title="Show it in every project" icon={<I.globe size={13} />} onPick={() => (close(), set({ project: null }))} /> : here && <Row title={`Show it only in ${here.name}`} icon={<I.folder size={13} />} onPick={() => (close(), set({ project: here.id }))} />)}
          <Sep />
          <Row title={a.enabled ? "Turn it off" : "Turn it on"} icon={<I.shieldOff size={13} />} onPick={() => (close(), set({ enabled: !a.enabled }))} />
          <RemoveRow name={a.name} onRemove={() => (close(), set({ removed: true }))} />
        </div>
      )}
    </Pop>
  );
}

/** Remove, asked twice. Its yes goes with the menu: opened again, it asks from the start. */
function RemoveRow({ name, onRemove }: { name: string; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  return sure ? <Row title={`Remove ${name}`} note="Its files, versions and storage are kept" icon={<I.trash size={13} />} onPick={onRemove} /> : <Row title="Remove…" icon={<I.trash size={13} />} onPick={() => setSure(true)} />;
}

/**
  An app's page of its own, from the left sidebar's Apps: it takes the conversation's place, with a
  way back to where you were (DeepSeek Harness's main-area page, reached from its sidebar entry).
*/
export function AppPage({ id, back, onBack, sidebar, onSidebar }: { id: string; back: string; onBack: () => void; sidebar: boolean; onSidebar: () => void }) {
  const info = useEngine((s) => s.addons.find((a) => a.id === id && a.panel));
  const Icon = appIcon(info?.panel?.icon);
  return (
    <div className="lc-apppage">
      <header className="lc-top" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <button type="button" className="lc-apppage-back l-focus" onClick={onBack}>
          <I.back size={13} />
          <span>{back}</span>
        </button>
        <span className="lc-quiet" aria-hidden>
          /
        </span>
        <span className="lc-apppage-name">
          <Icon size={14} />
          <h1 className="lc-title">{info?.name ?? "An app"}</h1>
        </span>
      </header>
      <div className="lc-apppage-body">
        <AddonView addon={id} agentName={info?.by.agent ?? "the agent"} />
      </div>
    </div>
  );
}
/* ---------- "Make it an app": the offer at the end of a turn ---------- */

/** Opens an app where it lives: in the dock or beside Chat in a session, or its page (App.tsx and Session.tsx listen). */
export const openApp = (d: { id: string; place: PanelPlace; threadId?: string }) => window.dispatchEvent(new CustomEvent("lc:open-app", { detail: d }));
export const openSession = (id: string) => window.dispatchEvent(new CustomEvent("lc:open-session", { detail: { id } }));

type Offer = Extract<Item, { kind: "offer" }>;
const PLACES: { id: PanelPlace | "custom"; label: string; hint: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "dock", label: "Right panel", hint: "View alongside this conversation", icon: I.dock },
  { id: "tab", label: "Session tab", hint: "Open beside Chat", icon: I.tab },
  { id: "page", label: "Global page", hint: "Open from the left sidebar", icon: I.page },
  { id: "custom", label: "Write your own", hint: "Describe where you want it", icon: I.edit },
];
const WHERE: Record<PanelPlace, string> = { dock: "in the right panel, beside your sessions", tab: "a tab beside Chat in this project's sessions", page: "under Apps, in the left sidebar" };

/** What it will touch, as one sentence: "It will read your sessions' titles and changes, keep its entries, and have no network." */
export function willTouch(a: PanelAsk["access"], place: PanelPlace) {
  const does = [
    a.files && "read this project's files",
    a.sessions === "this" && (place === "tab" ? "read this session" : "read the session it's beside"),
    a.sessions === "all" && "read your sessions' titles and changes",
    a.composer && "put text in the composer for you",
    a.storage ? `keep its entries (up to ${kb(a.storage)})` : "",
    a.ai && "ask a model you pick",
  ].filter(Boolean) as string[];
  const net = a.network ? `reach ${a.network} and nothing else` : "have no network";
  return `It will ${does.length ? `${does.join(", ")}, and ` : ""}${net}.`;
}

/**
  The card an agent offers at the end of its turn (DeepSeek Harness's creation card, its words):
  what it would make, Add to (the right panel, a session tab, a global page, or where you write),
  what it will touch; Create makes it in a background session, then Installing, Installed, and
  Keep or Undo; Undo keeps its files, so Restore brings it back.
*/
export function OfferCard({ threadId, it, who }: { threadId: string; it: Offer; who: string }) {
  const [place, setPlace] = useState<PanelPlace | "custom">(it.custom ? "custom" : it.place);
  const [custom, setCustom] = useState(it.custom ?? "");
  const [seed, setSeed] = useState(false);
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const child = useEngine((s) => (it.child ? s.items[it.child] : undefined));
  // The background session's timeline, fetched so its steps come in here while you keep chatting.
  useEffect(() => {
    if (it.child && (it.state === "creating" || it.state === "installing") && !getState().items[it.child]) void loadItems(it.child).catch(() => {});
  }, [it.child, it.state]);
  const act = async (a: "create" | "dismiss" | "cancel" | "keep" | "undo" | "restore") => {
    setBusy(true);
    try {
      await rpc("offer.answer", { threadId, itemId: it.id, act: a, ...(a === "create" ? (place === "custom" ? { custom: custom.trim() } : { place }) : {}) });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const working = it.state === "creating" || it.state === "installing";
  // How far the background session is, from what it's done so far.
  const tools = (child ?? []).filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool");
  const wrote = tools.filter((x) => x.toolKind === "write" || x.toolKind === "edit").length;
  const read = tools.some((x) => /add-on guide/.test(x.title));
  const checked = tools.some((x) => /^Check the panel/.test(x.title) && x.status === "done");
  const steps = [
    { text: "Read the add-on guide", done: read, now: !read && it.state === "creating" },
    { text: wrote ? `${it.state === "creating" && !checked ? "Writing" : "Wrote"} ${wrote} ${wrote === 1 ? "file" : "files"}${it.state === "creating" && !checked ? "…" : ""}` : "Write its files", done: wrote > 0 && (checked || it.state !== "creating"), now: read && it.state === "creating" && !checked },
    { text: "Checked it in a sealed frame", done: checked, now: false },
    { text: it.state === "installing" ? "Installing…" : "Install", done: false, now: it.state === "installing" },
  ];
  const where = WHERE[it.place];
  const settled: Partial<Record<Offer["state"], { title: string; note: string; good?: boolean }>> = {
    installed: { title: "Installed", note: `${it.name} is ${where}. Keep it, or undo.`, good: true },
    kept: { title: "Kept", note: `${it.name} is ${where}.`, good: true },
    removed: { title: "Removed", note: `Undo keeps its files in .liner/addons/${it.addon}, so Restore brings it back.` },
    dismissed: { title: "Not now", note: "Nothing was made. Ask again whenever you like." },
    cancelled: { title: "Cancelled", note: "Nothing was installed." },
    failed: { title: "Didn't make it", note: it.error ?? "Making it failed. Try again." },
    replaced: { title: "Replaced", note: "A newer offer took its place." },
  };
  const done = settled[it.state];
  return (
    <section className="lc-offer" aria-label="Make it an app" data-state={it.state}>
      <div className="lc-offer-head">
        <I.sparkle size={13} />
        <span>Make it an app</span>
        <span className="lc-quiet">You can remove it any time</span>
      </div>
      <div className="lc-offer-what">
        <b>{it.name}</b>
        <p>{it.brief}</p>
      </div>
      {it.state === "proposed" && (
        <div className="lc-offer-ask">
          {it.seed && it.seed.length > 0 && (
            <div className="lc-offer-seed">
              <span className="lc-quiet">Starts with</span>
              <span>{it.seed.length === 1 ? "one item you gave" : `the ${it.seed.length} items you gave`}</span>
              <button type="button" className="lc-offer-link l-focus" aria-expanded={seed} onClick={() => setSeed((s) => !s)}>
                {seed ? "Fold it" : "See all"}
              </button>
              {seed && (
                <ul>
                  {it.seed.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="lc-offer-places" role="radiogroup" aria-label="Add to">
            <span className="lc-quiet">Add to</span>
            <div>
              {PLACES.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={place === p.id} className="lc-offer-place l-focus" onClick={() => setPlace(p.id)}>
                  <span>
                    <p.icon size={13} />
                    {p.label}
                  </span>
                  <small>{p.hint}</small>
                </button>
              ))}
            </div>
            {place === "custom" && (
              <label className="lc-offer-custom">
                Where should it appear?
                <textarea rows={2} maxLength={1000} value={custom} placeholder="For example, a left sidebar entry that opens a full-page calendar" onChange={(e) => setCustom(e.target.value)} />
              </label>
            )}
          </div>
          <div className="lc-offer-touch">
            <I.shield size={13} />
            <span>{willTouch(it.access, place === "custom" ? it.place : place)}</span>
          </div>
          <div className="lc-offer-acts">
            <button type="button" className="lc-offer-link l-focus" aria-expanded={info} onClick={() => setInfo((s) => !s)}>
              {info ? <I.chevD size={11} /> : <I.chevR size={11} />}
              How making it works, and token use
            </button>
            <span className="lc-grow" />
            <button type="button" className="lc-btn" data-kind="ghost" disabled={busy} onClick={() => void act("dismiss")}>
              Not now
            </button>
            {/* Reaching the internet is held to allow, as on an install card. */}
            {it.access.network && !busy && !(place === "custom" && !custom.trim()) ? (
              <HoldToConfirm duration={900} resetAfter={1200} onConfirm={() => void act("create")} hintLabel="Keep holding" doneLabel="Starting…">
                Hold to create
              </HoldToConfirm>
            ) : (
              <button type="button" className="lc-btn" disabled={busy || (place === "custom" && !custom.trim())} onClick={() => void act("create")}>
                {busy ? "Starting…" : "Create"}
              </button>
            )}
          </div>
          {info && (
            <ul className="lc-offer-info">
              <li>{who} makes it in the background, as a new app you can remove at any time.</li>
              <li>Making it can take a while and use a lot of tokens.</li>
              <li>Press Create and keep chatting here.</li>
            </ul>
          )}
        </div>
      )}
      {working && (
        <div className="lc-offer-work">
          <div className="lc-offer-bar">
            <div style={{ width: it.state === "installing" ? "88%" : `${20 + Math.min(3, Number(read) + Number(wrote > 0) + Number(checked)) * 18}%` }} />
          </div>
          <div className="lc-offer-row">
            <b>{it.state === "installing" ? "Installing…" : "Making it in the background"}</b>
            {it.state === "creating" && (
              <button type="button" className="lc-btn" data-kind="ghost" disabled={busy} onClick={() => void act("cancel")}>
                Cancel
              </button>
            )}
          </div>
          <ul className="lc-offer-steps">
            {steps.map((s) => (
              <li key={s.text} data-done={s.done || undefined} data-now={s.now || undefined}>
                {s.done ? <I.check size={12} /> : <I.dot size={12} />}
                {s.text}
              </li>
            ))}
          </ul>
          <span className="lc-quiet lc-offer-note">
            {who} is making it in the background. You can keep chatting here.
            {it.child && (
              <button type="button" className="lc-offer-link l-focus" onClick={() => openSession(it.child!)}>
                Watch it
              </button>
            )}
          </span>
        </div>
      )}
      {done && (
        <div className="lc-offer-done" role="status" data-good={done.good || undefined}>
          <span className="lc-offer-tick">{done.good ? <I.check size={14} /> : it.state === "removed" ? <I.undo size={14} /> : <I.close size={14} />}</span>
          <span className="lc-offer-said">
            <b>{done.title}</b>
            <span>{done.note}</span>
          </span>
          {done.good && it.addon && (
            <button type="button" className="lc-offer-link l-focus" onClick={() => openApp({ id: it.addon!, place: it.place, threadId })}>
              Open it
            </button>
          )}
          {it.state === "installed" && (
            <span className="lc-offer-two">
              <button type="button" className="lc-btn" data-kind="ghost" disabled={busy} onClick={() => void act("undo")}>
                Undo
              </button>
              <button type="button" className="lc-btn" disabled={busy} onClick={() => void act("keep")}>
                Keep
              </button>
            </span>
          )}
          {it.state === "kept" && (
            <button type="button" className="lc-btn" data-kind="ghost" disabled={busy} onClick={() => void act("undo")}>
              Remove
            </button>
          )}
          {it.state === "removed" && (
            <button type="button" className="lc-btn" disabled={busy} onClick={() => void act("restore")}>
              {busy ? "Restoring…" : "Restore"}
            </button>
          )}
          {(it.state === "cancelled" || it.state === "failed") &&
            (it.access.network && !busy ? (
              <HoldToConfirm duration={900} resetAfter={1200} onConfirm={() => void act("create")} hintLabel="Keep holding" doneLabel="Starting…">
                Hold to create again
              </HoldToConfirm>
            ) : (
              <button type="button" className="lc-btn" disabled={busy} onClick={() => void act("create")}>
                Create again
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
