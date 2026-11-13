/*
  A design and its session. A design opens in a tab with no session; its session is made when the
  person first asks for something (the dock, Home's composer, a fix, an AI picture) or first presses
  Code on it: a session of the design's project, marked as begun from that design (Thread.design),
  never one in Scratch. Which session a tab shows: the one the tab remembers, else the newest one
  begun from that design file in that project.
*/
import type { DesignFile, DesignSize, Project, Thread } from "@contracts";
import { startOf } from "@contracts";
import type { RunSettings } from "../Composer";
import { getState, rpc } from "../engine";
import { currentTab, getTabs, openTab, patchTab, showTab, tabKey, type DesignTab } from "../face";
import { blankHtml } from "./store";

/** The tab's session, if it has one yet. */
export function sessionOf(tab: DesignTab, threads: Thread[]): Thread | undefined {
  const live = threads.filter((t) => !t.archived && !t.sideOf && t.projectId === tab.projectId);
  return (tab.threadId ? live.find((t) => t.id === tab.threadId) : undefined) ?? live.filter((t) => t.design?.file === tab.file).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** Who a new design session starts with, as Home starts a session: the project's own agent, else Settings' start (a pair, the best or the fast one). */
export function runFor(project?: Project): RunSettings {
  const { settings, providers } = getState();
  const access = settings.defaultAccess;
  if (project?.agent === "demo") return { agent: "demo", sidekick: "demo:demo", effort: "low", access };
  if (project?.agent) return { agent: project.agent, effort: "medium", access };
  const start = startOf(settings, providers);
  if (start) return { ...start, effort: "medium", access };
  const first = providers.find((p) => p.available && p.adapter && p.id !== "demo");
  return { agent: first ? `@${first.id}:${first.models[0]?.id ?? "default"}` : "demo", effort: "medium", access };
}

const making = new Map<string, Promise<Thread>>();
/** The tab's session: the one it has, else a new one of its project, begun from its design file, in the project's own folder (where the design file is, never a worktree). One at a time per tab. */
export function makeSession(tab: DesignTab, run?: RunSettings): Promise<Thread> {
  const had = sessionOf(tab, getState().threads);
  if (had) return Promise.resolve(had);
  const k = tabKey(tab);
  const going = making.get(k);
  if (going) return going;
  const project = getState().projects.find((p) => p.id === tab.projectId);
  const r = run ?? runFor(project);
  const next = rpc("thread.create", { projectId: tab.projectId, design: { file: tab.file }, agent: r.agent, sidekick: r.sidekick, model: r.model, effort: r.effort, access: r.access, mode: "standard", worktree: false, ...(tab.title ? { title: tab.title } : {}) })
    .then((t) => (patchTab(k, { threadId: t.id }), t))
    .finally(() => making.delete(k));
  making.set(k, next);
  return next;
}

/*
  A project design.new just made may not be in the app's list yet (its event comes on the stream):
  until it is, it's known from the answer, so its tab isn't taken for a stale one.
*/
const fresh = new Map<string, { project: Project; at: number }>();
export const freshProject = (id: string) => {
  const f = fresh.get(id);
  return f && Date.now() - f.at < 10_000 ? f.project : undefined;
};
export const knowProject = (project: Project) => void fresh.set(project.id, { project, at: Date.now() });

/*
  Untouched designs don't pile up. A design New design made carries, in its tab, what it was when
  made (`fresh`). While it's still exactly that (no session, nothing drawn in a frame, no frame or
  page changed or added, no skill or lean set, never renamed), it's untouched: New design goes to
  it rather than making another, and it is discarded (design.discard), quietly, when its tab closes or
  another design is opened in its place. Anything touched, in any way, is kept.
*/
export const sigOf = (f: DesignFile) => JSON.stringify({ t: f.title, p: f.pages.map((x) => [x.id, x.name]), f: f.frames.map((x) => [x.id, x.name, x.kind, x.page, x.x, x.y, x.w, x.h]), l: f.lean, i: f.pictures ?? null });

/** Whether the tab's design is still as New design made it. */
export async function untouched(tab: DesignTab): Promise<boolean> {
  if (!tab.fresh) return false;
  const s = getState();
  const project = s.projects.find((p) => p.id === tab.projectId) ?? freshProject(tab.projectId);
  if (!project) return false;
  // A session of it (or of its own folder) means something was asked or opened in Code.
  if (sessionOf(tab, s.threads) || (project.kind === "design" && s.threads.some((t) => t.projectId === project.id))) return false;
  try {
    const { file } = await rpc("canvas.open", { cwd: project.path, file: tab.file });
    if (sigOf(file) !== tab.fresh) return false;
    for (const f of file.frames) {
      if (f.kind !== "drawn") return false;
      const { html } = await rpc("canvas.frame.read", { cwd: project.path, file: tab.file, frame: f.id });
      if (!blankHtml(html)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
  Discards the tab's design, project and folder, if it's untouched (no toast, no undo: it holds
  nothing of the person's). The engine looks for itself (design.discard) and refuses anything with
  something of the person's in it; then the design is simply kept. Once found touched, it's never asked again.
*/
export async function dropIfUntouched(tab: DesignTab) {
  if (!tab.fresh) return false;
  if (!(await untouched(tab))) {
    patchTab(tabKey(tab), { fresh: undefined });
    return false;
  }
  return rpc("design.discard", { projectId: tab.projectId }).then(() => true, () => false);
}

/**
  A new design (on its own, or in a project), opened in its tab. No session is made. An untitled
  one asked for while an untouched "Untitled design" is open goes to that one instead.
*/
export async function newDesign(o: { projectId?: string; title?: string; size?: DesignSize | "desktop+phone" } = {}): Promise<void> {
  if (!o.title && !o.projectId) {
    const here = currentTab();
    const open = [...(here ? [here] : []), ...getTabs().list.filter((t) => t !== here)].filter((t) => t.fresh && !getState().projects.some((p) => p.id === t.projectId && p.kind !== "design"));
    for (const t of open) if (await untouched(t)) return void showTab(tabKey(t));
  }
  const made = await rpc("design.new", { ...(o.projectId ? { projectId: o.projectId } : {}), ...(o.title ? { title: o.title } : {}), size: o.size ?? "desktop" });
  knowProject(made.project);
  openTab({ projectId: made.project.id, file: made.file.id, title: made.file.title, fresh: sigOf(made.file) });
}
