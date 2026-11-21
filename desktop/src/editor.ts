/*
  Opening things from the page, kept apart from Electron so it can be tested.
  "Open in your editor" (Changes, a Security finding): the page names a session, or a project when
  there's no session, and a path relative to its folder, and the shell opens that file only when it
  sits inside the folder: the session's worktree or else its project, or the project's. The folder
  comes from the engine, never from the page, so a page that was talked into it still can't open a
  file anywhere else.
  "Open in" (a folder in Finder, a terminal or an editor): a file that reaches it is never opened as
  itself, which would run a script or a program an agent wrote; it opens as text or is shown in its folder.
  It judges what a path really is (links followed), as the system would open that, not the name it has.
*/
import { isAbsolute, relative, resolve, sep } from "node:path";

type State = { threads?: { id: string; projectId: string; worktree?: { path: string } }[]; projects?: { id: string; path: string }[] };

/** The folder a file is opened from, as the engine has it: a session's worktree, or else its project's; or a project's, when the page names no session. */
export function folderOf(state: State, at: { threadId?: string; projectId?: string }): string | undefined {
  if (at.threadId) {
    const t = state.threads?.find((x) => x.id === at.threadId);
    if (!t) return undefined;
    return t.worktree?.path || state.projects?.find((p) => p.id === t.projectId)?.path || undefined;
  }
  return (at.projectId && state.projects?.find((p) => p.id === at.projectId)?.path) || undefined;
}

/** Whether `file` is `root` itself or under it, by their resolved paths: `..` and an absolute path can't leave it. */
export function isInside(root: string, file: string) {
  const r = relative(resolve(root), resolve(file));
  return r !== "" && r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
}

/**
  The file to open, or why not: `outside` the folder, or `gone` (inside it, but not there now: deleted
  since the turn, a path from all the turns, a worktree that was removed). A path outside the folder is
  never looked for, so the answer doesn't say whether it exists. `real` follows links (realpath), so a
  link inside the folder that points out of it is outside too.
*/
export function fileIn(root: string, path: string, real: (p: string) => string): { file: string } | { why: "outside" | "gone" } {
  if (!root || !path || path.includes("\0")) return { why: "outside" };
  const file = resolve(root, path);
  if (!isInside(root, file)) return { why: "outside" };
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = real(root);
    realFile = real(file);
  } catch {
    return { why: "gone" };
  }
  return isInside(realRoot, realFile) ? { file: realFile } : { why: "outside" };
}

/** What `openIn` and `openFile` reach the system through: Electron and the platform, or a test's fakes. */
export type Opener = {
  isMac: boolean;
  isWin: boolean;
  /** The editors to try on a Mac, by bundle id, first found first. */
  editors: readonly string[];
  isFile: (path: string) => boolean;
  /** The path with every link followed (realpath); throws when it can't be (a dangling link, nothing there). */
  real: (path: string) => string;
  /** `open` on a Mac with these arguments; false when it couldn't. */
  opens: (args: string[]) => Promise<boolean>;
  /** Starts a program that carries on by itself, its arguments as they are (no shell); false when it couldn't. */
  started: (cmd: string, args: string[], hide?: boolean, cwd?: string) => Promise<boolean>;
  /** shell.openPath: "" when it opened, else its error. Only ever for a folder. */
  openPath: (path: string) => Promise<string>;
  showInFolder: (path: string) => void;
};

/**
  A file in an editor: the first of the list on a Mac, else as text (TextEdit); on Windows in Notepad,
  the file its one argument (no shell); elsewhere, or with none of those, shown in its folder (xdg-open
  on Linux would run a script). Never opened as itself.
*/
export async function openAsText(o: Opener, file: string) {
  if (o.isMac) {
    for (const id of o.editors) if (await o.opens(["-b", id, file])) return;
    if (await o.opens(["-t", file])) return;
  }
  if (o.isWin && (await o.started("notepad.exe", [file]))) return;
  o.showInFolder(file);
}

/** A folder with an extension to its name (Foo.app, X.workflow, Y.prefPane): on a Mac, Launch Services opens it as a thing, an app it would launch, not as a folder. */
const bundle = (path: string) => /[^./\\]\.[^./\\]+$/.test(path.replace(/[\\/]+$/, ""));

/**
  Opens a folder in an editor (the first you have), Terminal, or Finder. A file goes to `openAsText`
  for an editor and is shown in its folder otherwise; on a Mac a folder whose name has an extension
  (a bundle such as an app) is shown in Finder whatever was asked. Neither is ever opened as itself.
  Each rule reads the real path: a link named `tools/run` that an agent pointed at an app is the app, and
  Launch Services would follow it. A path that doesn't resolve is refused rather than handed on.
*/
export async function openIn(o: Opener, given: string, where: string, comSpec = "cmd.exe") {
  if (!given) return;
  let path: string;
  try {
    path = o.real(given);
  } catch {
    throw new Error(`${given} isn't there, or it's a link to nothing.`);
  }
  if (o.isFile(path)) return where === "editor" ? openAsText(o, path) : o.showInFolder(path);
  if (o.isMac && bundle(path)) return o.showInFolder(path);
  if (o.isMac && where === "terminal" && (await o.opens(["-a", "Terminal", path]))) return;
  if (o.isMac && where === "editor") for (const id of o.editors) if (await o.opens(["-b", id, path])) return;
  // On Windows: Windows Terminal in the folder, else a Command Prompt there (Explorer would only show it).
  // The folder goes as the working directory, not through cmd.exe, which would run what follows an & in its name.
  if (o.isWin && where === "terminal" && ((await o.started("wt.exe", ["-d", path])) || (await o.started(comSpec, ["/c", "start", "", "cmd.exe"], true, path)))) return;
  const err = await o.openPath(path);
  if (err) throw new Error(err);
}
