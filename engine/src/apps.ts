/*
  The apps on this Mac that open a folder, for "Open in" in a session's menu: editors first,
  then terminals. Spotlight finds each by its bundle id, once per run, and `open -b` opens the
  folder in it. Only apps on this list open, so a caller can't name any program.
*/
import { existsSync } from "node:fs";
import { run, spawn, which } from "./exec.ts";

type App = { id: string; name: string; kind: "editor" | "terminal" };
type KnownApp = App & { bins?: string[]; args?: (path: string) => string[] };

const KNOWN: KnownApp[] = [
  { id: "dev.zed.Zed", name: "Zed", kind: "editor", bins: ["zed"] },
  { id: "com.microsoft.VSCode", name: "VS Code", kind: "editor", bins: ["code"] },
  { id: "com.todesktop.230313mzl4w4u92", name: "Cursor", kind: "editor", bins: ["cursor"] },
  { id: "com.exafunction.windsurf", name: "Windsurf", kind: "editor", bins: ["windsurf"] },
  { id: "com.sublimetext.4", name: "Sublime Text", kind: "editor", bins: ["subl"] },
  { id: "com.panic.Nova", name: "Nova", kind: "editor" },
  { id: "com.barebones.bbedit", name: "BBEdit", kind: "editor" },
  { id: "com.apple.dt.Xcode", name: "Xcode", kind: "editor" },
  { id: "com.google.android.studio", name: "Android Studio", kind: "editor", bins: ["studio", "android-studio"] },
  { id: "com.jetbrains.intellij", name: "IntelliJ IDEA", kind: "editor", bins: ["idea"] },
  { id: "com.jetbrains.WebStorm", name: "WebStorm", kind: "editor", bins: ["webstorm"] },
  { id: "com.apple.Terminal", name: "Terminal", kind: "terminal" },
  { id: "com.googlecode.iterm2", name: "iTerm", kind: "terminal" },
  { id: "com.mitchellh.ghostty", name: "Ghostty", kind: "terminal", bins: ["ghostty"], args: (p) => [`--working-directory=${p}`] },
  { id: "dev.warp.Warp-Stable", name: "Warp", kind: "terminal", bins: ["warp-terminal"] },
  { id: "cli.wt", name: "Windows Terminal", kind: "terminal", bins: ["wt"], args: (p) => ["-d", p] },
  { id: "cli.alacritty", name: "Alacritty", kind: "terminal", bins: ["alacritty"], args: (p) => ["--working-directory", p] },
  { id: "cli.kitty", name: "Kitty", kind: "terminal", bins: ["kitty"], args: (p) => ["--directory", p] },
  { id: "cli.wezterm", name: "WezTerm", kind: "terminal", bins: ["wezterm"], args: (p) => ["start", "--cwd", p] },
  { id: "cli.gnome-terminal", name: "GNOME Terminal", kind: "terminal", bins: ["gnome-terminal"], args: (p) => [`--working-directory=${p}`] },
  { id: "cli.konsole", name: "Konsole", kind: "terminal", bins: ["konsole"], args: (p) => ["--workdir", p] },
];

let found: Promise<App[]> | null = null;

/** Probes installed editors and terminals on macOS (Spotlight) or Windows/Linux (PATH binaries). */
export function editors(env: NodeJS.ProcessEnv = process.env): Promise<App[]> {
  found ??= (async () => {
    if (process.platform === "darwin") {
      const macApps = KNOWN.filter((a) => !a.id.startsWith("cli."));
      const hits = await Promise.all(macApps.map(async (a) => ((await run("mdfind", [`kMDItemCFBundleIdentifier == "${a.id}"`], { timeout: 8000 })).stdout.trim() ? { id: a.id, name: a.name, kind: a.kind } : null)));
      return hits.filter((a): a is App => a !== null);
    }
    return KNOWN.filter((a) => a.bins?.some((b) => Boolean(which(b, env)))).map(({ id, name, kind }) => ({ id, name, kind }));
  })();
  return found;
}

export async function openWith(path: string, app: string, env: NodeJS.ProcessEnv = process.env) {
  const known = KNOWN.find((a) => a.id === app);
  if (!known) throw new Error("Liner Code doesn't open folders in that app.");
  if (!existsSync(path)) throw new Error("That folder isn't there any more.");
  if (process.platform === "darwin" && !known.id.startsWith("cli.")) {
    const r = await run("open", ["-b", app, path], { timeout: 15000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `${known.name} didn't open it.`);
    return;
  }
  const bin = known.bins?.map((b) => which(b, env)).find((p): p is string => Boolean(p));
  if (!bin) throw new Error(`${known.name} isn't installed on this machine.`);
  const args = known.args ? known.args(path) : [path];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { env, detached: true, stdio: "ignore" });
    child.once("error", (e) => reject(new Error(`${known.name} didn't open it: ${e.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
