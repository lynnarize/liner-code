/*
  Updates, as you meet them: a notice stack in Home's corner for a new Liner Code (downloading,
  ready to go in, or out) and for each agent tool the engine is updating, has updated or couldn't
  update. Each notice says what happened and what's next; putting one away keeps it away until a
  newer version comes out. Settings › Updates has the rest.
*/
import type { AppUpdate, BuiltinProvider, ToolUpdate, Updates } from "@contracts";
import { newerVersion, updateModes } from "@contracts";
import { NoticeStack, type Notice } from "@liner/components/notice-stack/notice-stack";
import { toast } from "@liner/components/toast/toast";
import { bridge, isNative } from "./bridge";
import { rpc, useEngine } from "./engine";
import { plural } from "./model";
import "./updates.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** Settings, on its Updates place, where the whole story is. */
const details = { label: "Details", onClick: () => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "updates" })) };

export const updates = {
  restart: () => bridge.installUpdate().catch(fail),
  download: () => void rpc("updates.download", {}).catch(fail),
  tool: (id?: BuiltinProvider) => void rpc("updates.tool", { id }).catch(fail),
  check: () => rpc("updates.check", {}).catch(fail),
  dismiss: (key: string) => void rpc("updates.dismiss", { key: key as "app" }).catch(() => {}),
};

/** "296 MB", "6 KB". */
export const sizeOf = (bytes = 0) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/** The first thing a release's notes say, without Markdown: a heading's words don't count. */
export function firstNote(md?: string) {
  const line = (md ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !/^[-*_]{3,}$/.test(l));
  const plain = line?.replace(/^[-*+]\s+|^\d+\.\s+/, "").replace(/[*_`]|\[([^\]]*)\]\([^)]*\)/g, "$1");
  return plain && plain.length > 140 ? `${plain.slice(0, 139)}…` : plain;
}

/** The new Liner Code is newer than this one, so there's something to say about it. */
export const appHasNews = (a: AppUpdate) => newerVersion(a.latest, a.current) && (a.state === "available" || a.state === "downloading" || a.state === "ready" || (a.state === "failed" && Boolean(a.error)));

/** What the app's state says on a notice: a title, a line, and the one thing to press. */
export function appNotice(a: AppUpdate, native = isNative()): Notice | null {
  if (!appHasNews(a) || !a.latest) return null;
  const v = a.latest;
  const base = { id: `app:${a.state}:${v}`, eyebrow: "Liner Code" };
  const page = a.url ? { label: "What's new", onClick: () => bridge.openExternal(a.url!) } : details;
  if (a.state === "ready")
    return { ...base, title: `${v} is ready`, body: native ? "Restart now, or it goes in when you next quit." : "Restart Liner Code to start using it.", action: native ? { label: "Restart to update", onClick: () => void updates.restart() } : page };
  if (a.state === "downloading") return { ...base, title: `Downloading ${v}`, body: `${Math.round((a.progress ?? 0) * 100)}%${a.size ? ` of ${sizeOf(a.size)}` : ""}. It goes in when you restart or quit.`, action: page };
  if (a.state === "failed" && a.stuck) return { ...base, title: `${v} couldn't go in`, body: a.error, action: a.url ? { label: "Release page", onClick: () => bridge.openExternal(a.url!) } : details };
  if (a.state === "failed") return { ...base, title: `${v} didn't download`, body: a.error, action: a.can === "install" ? { label: "Try again", onClick: updates.download } : page };
  const news = firstNote(a.notes);
  if (a.can === "source") return { ...base, title: `${v} is out`, body: `${news ? `${news} ` : ""}This copy runs from source: pull and build it to update.`, action: page };
  if (a.can === "translocated") return { ...base, title: `${v} is out`, body: "Move Liner Code to Applications first, so it can update itself.", action: page };
  if (a.can === "readonly") return { ...base, title: `${v} is out`, body: "Liner Code can't write to the folder it's in, so get this one from its release page.", action: page };
  return { ...base, title: `${v} is out`, body: news ?? `You have ${a.current}.`, action: { label: `Download${a.size ? `, ${sizeOf(a.size)}` : ""}`, onClick: updates.download } };
}

/** A tool's notice, while there's something to tell. */
export function toolNotice(t: ToolUpdate): Notice | null {
  const base = { id: `${t.id}:${t.state}:${t.latest ?? ""}`, eyebrow: t.label };
  switch (t.state) {
    case "available":
      return { ...base, title: `${t.latest} is out`, body: `You have ${t.current}. Liner Code runs ${t.command} once no session is working on it.`, action: { label: "Update now", onClick: () => updates.tool(t.id) } };
    case "waiting":
      return t.busy
        ? { ...base, title: `${t.latest} is waiting`, body: `It goes in as soon as the ${plural(t.busy, "session")} working on it ${t.busy === 1 ? "finishes" : "finish"}.`, action: details }
        : { ...base, title: `${t.latest} is next`, body: "It goes in after the update that's running now.", action: details };
    case "updating":
      return { ...base, title: `Updating to ${t.latest}${t.progress !== undefined ? `, ${Math.round(t.progress * 100)}%` : ""}`, body: t.step ?? `Running ${t.command}, which takes a moment.`, action: details };
    case "updated":
      return { ...base, title: `Updated to ${t.current}`, body: `From ${t.from}. Sessions on it pick it up on their next turn.`, action: details };
    case "failed":
      return { ...base, title: `${t.latest ? `${t.latest} didn't` : "It didn't"} go in`, body: t.error, action: { label: "Try again", onClick: () => updates.tool(t.id) } };
    default:
      return null;
  }
}

const ORDER: Record<ToolUpdate["state"], number> = { failed: 0, updating: 1, waiting: 2, available: 3, updated: 4, current: 5 };

/** "Claude Code, Codex CLI and Hermes". */
const names = (ts: ToolUpdate[]) => {
  const n = ts.map((t) => t.label);
  return n.length < 2 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};

/**
  Everything worth a notice, most pressing first, minus what you put away. Several tools with a
  version out share one notice, and so do several just updated; each carries the ids it stands
  for (after the "tools:" prefix) so putting it away puts each of them away.
*/
export function noticesOf(u: Updates, modes: { app: string; tools: string }) {
  const out: Notice[] = [];
  const app = modes.app !== "off" && u.dismissed.app !== u.app.latest ? appNotice(u.app) : null;
  if (app) out.push(app);
  if (modes.tools === "off") return out;
  const shown = u.tools.filter((t) => !(t.state === "available" && u.dismissed[t.id] === t.latest));
  const offered = shown.filter((t) => t.state === "available");
  const queued = shown.filter((t) => t.state === "waiting");
  const done = shown.filter((t) => t.state === "updated");
  const group = (ts: ToolUpdate[], n: Omit<Notice, "id">): Notice => ({ id: `tools:${ts.map((t) => `${t.id}@${t.latest}`).join(",")}:${ts[0].state}`, ...n });
  for (const t of [...shown].sort((a, b) => ORDER[a.state] - ORDER[b.state])) {
    if (t.state === "available" && offered.length > 1) {
      if (t === offered[0]) out.push(group(offered, { eyebrow: "Agent tools", title: `${offered.length} updates are out`, body: `For ${names(offered)}. Each one waits until no session is working on it.`, action: { label: `Update all ${offered.length}`, onClick: () => offered.forEach((x) => updates.tool(x.id)) } }));
      continue;
    }
    if (t.state === "waiting" && queued.length > 1) {
      if (t === queued[0]) out.push(group(queued, { eyebrow: "Agent tools", title: `${queued.length} waiting their turn`, body: `${names(queued)}, one at a time, each once no session is working on it.`, action: details }));
      continue;
    }
    if (t.state === "updated" && done.length > 1) {
      if (t === done[0]) out.push(group(done, { eyebrow: "Agent tools", title: `${done.length} updated`, body: `${names(done)} are on their new versions. Sessions pick them up on their next turn.`, action: details }));
      continue;
    }
    const n = toolNotice(t);
    if (n) out.push(n);
  }
  return out;
}

/** Putting a notice away: "app:…", "claude:…", or "tools:claude@2.1.312,codex@0.165.0:…" for a shared one. */
function dismissNotice(id: string) {
  const [key, rest] = id.split(":");
  if (key !== "tools") return updates.dismiss(key);
  for (const one of rest.split(",")) updates.dismiss(one.slice(0, one.indexOf("@")));
}

/** Home's corner: the notices, stacked. */
export function HomeUpdates() {
  const u = useEngine((s) => s.updates);
  const app = useEngine((s) => updateModes(s.settings).app);
  const tools = useEngine((s) => updateModes(s.settings).tools);
  const notices = noticesOf(u, { app, tools });
  if (!notices.length) return null;
  return <NoticeStack className="lc-up-home" label="Updates" notices={notices} onDismiss={dismissNotice} />;
}
