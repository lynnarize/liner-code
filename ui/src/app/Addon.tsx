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
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { rpc, useEngine, useItemsWhere } from "./engine";
import { toComposer } from "./Find";
import { I } from "./icons";
import { theme } from "./Page";
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
  const ask = preview ? asks.find((x) => x.id === preview && x.state === "asking")?.addon : undefined;
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
        </div>
      </div>
    );
  }
  if (!info?.panel) return <PanelNote icon={<I.blocks size={20} />} title="This add-on is gone" body="It was removed, or this window doesn't have it yet." />;
  const strip = (
    <div className="lc-addon-strip">
      <I.shield size={13} />
      <span>{info.enabled && !info.removed ? stripOf({ by: info.by.agent, version: info.version, reaches: info.reaches, place: info.panel.place }) : `${info.panel.place === "dock" ? "Add-on" : "App"} by ${info.by.agent} · off`}</span>
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
    const onMsg = async (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { liner?: number; kind?: string; id?: number; method?: string; args?: unknown; message?: string; stack?: string; host?: string; directive?: string } | null;
      if (!d || d.liner !== 1) return;
      if (d.kind === "error") return setCrash({ message: String(d.message ?? "An error"), stack: d.stack ? String(d.stack) : undefined });
      if (d.kind === "blocked") return setBlocked(String(d.host || d.directive || "an address"));
      if (d.kind || typeof d.id !== "number" || typeof d.method !== "string") return;
      try {
        const value = await rpc("panel.call", { addon, threadId: thread?.id, preview, method: d.method, args: d.args, apiVersion: PANEL_API });
        // What it puts in the composer lands there for you to send, or not.
        if (d.method === "composer.put" && thread) toComposer(thread.id, (value as { text: string }).text);
        post({ id: d.id, ok: true, value });
      } catch (err) {
        post({ id: d.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };
    window.addEventListener("message", onMsg);
    // Light and dark, and the accent, follow the app without reloading the panel.
    const mo = new MutationObserver(() => post({ event: "theme", data: theme() }));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent", "style"] });
    return () => {
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
  const [sure, setSure] = useState(false);
  const set = (p: { enabled?: boolean; version?: number; removed?: boolean; project?: string | null }) => void rpc("addons.update", { id: a.id, ...p }).catch(fail);
  const here = thread ? projects.find((p) => p.id === thread.projectId) : undefined;
  const page = a.panel?.place === "page";
  return (
    <Pop label={`More for ${a.name}`} align="end" side="top" width={290} triggerClass={triggerClass} trigger={<I.more size={14} />}>
      {(close) => (
        <div className="lc-addon-menu" onKeyDown={(e) => e.key === "Escape" && setSure(false)}>
          <PanelHead>Versions</PanelHead>
          {[...a.versions].reverse().map((v) => (
            <Row key={v} title={`v${v}`} note={`${v === a.version ? "In use · " : ""}${a.dates?.[v] ? dayOf(a.dates[v]) : ""}`} on={v === a.version} onPick={() => (set({ version: v }), close())} />
          ))}
          <Sep />
          {thread && <Row title={`Change it with ${agentName}`} icon={<I.edit size={13} />} onPick={() => (close(), toComposer(thread.id, `Change the ${a.name} ${page ? "app" : "panel"} so `))} />}
          <Row title="Show its files" icon={<I.folder size={13} />} onPick={() => (close(), void rpc("addons.read", { id: a.id }).then((r) => bridge.reveal(`${r.dir}/v${a.version}`)).catch(fail))} />
          {onOpenElsewhere && <Row title={page ? "Open it in the dock" : "Open it on its own"} icon={<I.dock size={13} />} onPick={() => (close(), onOpenElsewhere())} />}
          {!page && (a.project ? <Row title="Show it in every project" icon={<I.globe size={13} />} onPick={() => (close(), set({ project: null }))} /> : here && <Row title={`Show it only in ${here.name}`} icon={<I.folder size={13} />} onPick={() => (close(), set({ project: here.id }))} />)}
          <Sep />
          <Row title={a.enabled ? "Turn it off" : "Turn it on"} icon={<I.shieldOff size={13} />} onPick={() => (close(), set({ enabled: !a.enabled }))} />
          {sure ? (
            <Row title={`Remove ${a.name}`} note="Its files, versions and storage are kept" icon={<I.trash size={13} />} onPick={() => (close(), setSure(false), set({ removed: true }))} />
          ) : (
            <Row title="Remove…" icon={<I.trash size={13} />} onPick={() => setSure(true)} />
          )}
        </div>
      )}
    </Pop>
  );
}
