/*
  The apps on this Mac that open a folder, for "Open in" in a session's menu: editors first,
  then terminals. Spotlight finds each by its bundle id, once per run, and `open -b` opens the
  folder in it. Only apps on this list open, so a caller can't name any program.
*/
import { existsSync } from "node:fs";
import { run } from "./exec.ts";

type App = { id: string; name: string; kind: "editor" | "terminal" };

const KNOWN: App[] = [
  { id: "dev.zed.Zed", name: "Zed", kind: "editor" },
  { id: "com.microsoft.VSCode", name: "VS Code", kind: "editor" },
  { id: "com.todesktop.230313mzl4w4u92", name: "Cursor", kind: "editor" },
  { id: "com.exafunction.windsurf", name: "Windsurf", kind: "editor" },
  { id: "com.sublimetext.4", name: "Sublime Text", kind: "editor" },
  { id: "com.panic.Nova", name: "Nova", kind: "editor" },
  { id: "com.barebones.bbedit", name: "BBEdit", kind: "editor" },
  { id: "com.apple.dt.Xcode", name: "Xcode", kind: "editor" },
  { id: "com.google.android.studio", name: "Android Studio", kind: "editor" },
  { id: "com.jetbrains.intellij", name: "IntelliJ IDEA", kind: "editor" },
  { id: "com.jetbrains.WebStorm", name: "WebStorm", kind: "editor" },
  { id: "com.apple.Terminal", name: "Terminal", kind: "terminal" },
  { id: "com.googlecode.iterm2", name: "iTerm", kind: "terminal" },
  { id: "com.mitchellh.ghostty", name: "Ghostty", kind: "terminal" },
  { id: "dev.warp.Warp-Stable", name: "Warp", kind: "terminal" },
];

let found: Promise<App[]> | null = null;

export function editors(): Promise<App[]> {
  found ??= (async () => {
    if (process.platform !== "darwin") return [];
    const hits = await Promise.all(KNOWN.map(async (a) => ((await run("mdfind", [`kMDItemCFBundleIdentifier == "${a.id}"`], { timeout: 8000 })).stdout.trim() ? a : null)));
    return hits.filter((a): a is App => a !== null);
  })();
  return found;
}

export async function openWith(path: string, app: string) {
  const known = KNOWN.find((a) => a.id === app);
  if (!known) throw new Error("Liner Code doesn't open folders in that app.");
  if (!existsSync(path)) throw new Error("That folder isn't there any more.");
  const r = await run("open", ["-b", app, path], { timeout: 15000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || `${known.name} didn't open it.`);
}
