/*
  Liner Code's desktop shell, on Electron. It does what the Swift shell in mac/ did: one window
  the app draws in (the engine serves it on 127.0.0.1), the engine as a child process, the
  material behind the sidebar, the menu bar with your keys, notifications and the Dock badge,
  keys kept encrypted, Terminal and Finder. The page asks for these over one IPC channel
  ("liner") with the same methods it sent the Swift shell; preload.ts is its side of it.
*/
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, screen, session, shell, systemPreferences, type MenuItemConstructorOptions, type Rectangle } from "electron";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Engine, loginEnvironment, logFile, previousLogFile, whoami, type Paths } from "./engine";
import { Keys } from "./keys";
import { mac, type Frame, type Rect } from "./mac";
import { bundlePath, install as installUpdate, staged } from "./update";

app.setName("Liner Code");
// A test home (LINER_HOME) keeps the shell's own data apart too, and runs beside your app.
app.setPath("userData", process.env.LINER_HOME ? join(process.env.LINER_HOME, "shell") : join(app.getPath("appData"), "Liner Code"));

const isMac = process.platform === "darwin";
// The Web Inspector and the page's reload are for building Liner Code, not for using it.
const inspect = process.env.LINER_INSPECT === "1";
// While developing: the Vite server, and an engine you run yourself (npm run dev).
const devUrl = process.env.LINER_UI_URL;

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let quitting = false;
/** A downloaded update is being put in; quitting doesn't start it again. */
let updating = false;
let loaded = false;
/** Your shell's environment, read once at launch; a report looks for the tools on its PATH. */
let shellEnv: NodeJS.ProcessEnv | undefined;
const engine = new Engine();
const keys = new Keys(app.getPath("userData"));
/** What the page reads as window.__LINER__ before its scripts run. */
const boot = { base: "", token: "", machine: "This Mac", user: "" };

// ---------- What the shell remembers: the window's place, the material and the engine's port ----------

/**
  `port` is asked for again at the next launch: the page's address includes it, and what the
  page keeps (folds, choices) is kept per address, so a new port each launch would forget it all.
*/
type Prefs = { material?: string; bounds?: Rectangle; maximized?: boolean; port?: number };
const prefsFile = () => join(app.getPath("userData"), "shell.json");
let prefs: Prefs = {};
let saveTimer: NodeJS.Timeout | undefined;
const loadPrefs = () => {
  try {
    prefs = JSON.parse(readFileSync(prefsFile(), "utf8")) as Prefs;
  } catch {
    prefs = {};
  }
};
const savePrefs = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2)), 300);
};

/** The saved frame, if it still fits on a screen you have. */
function visibleBounds(b?: Rectangle) {
  if (!b) return undefined;
  const d = screen.getDisplayMatching(b).workArea;
  const slack = 40;
  const fits = b.width >= 880 && b.height >= 580 && b.x >= d.x - slack && b.y >= d.y - slack && b.x + b.width <= d.x + d.width + slack && b.y + b.height <= d.y + d.height + slack;
  return fits ? b : undefined;
}

// ---------- The window ----------

// Where the traffic lights go: centred in the page's 52px top row, as the Swift shell's unified toolbar put them.
const LIGHTS = { x: 20, y: 19 };
const BOOT_PAGE = `<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:transparent;font:13px -apple-system,system-ui,sans-serif;color:#8a8f98"><span>Starting the engine…</span></body></html>`;

let material = "solid";
let glassRect: Frame = { x: 0, y: 0, width: 0, height: 0 };

/** The system's window colour, which shows around the page's paper while the material is Solid. */
function windowColor() {
  if (isMac) {
    const c = systemPreferences.getColor("window-background");
    if (/^#[0-9a-f]{6}/i.test(c)) return c.slice(0, 7);
  }
  return nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ececec";
}

/**
  What sits behind the transparent page: Liquid Glass (macOS 26+), classic vibrancy, or solid.
  With the addon the window stays opaque and the material covers the window's glass frame alone,
  the paper left out of it (a live material behind the whole window kept WindowServer's GPU
  busy). Without it, Electron's own vibrancy covers the whole window.
*/
function applyMaterial() {
  if (!win || !isMac) return;
  if (mac) return mac.backdrop(win.getNativeWindowHandle(), material, glassRect);
  win.setVibrancy(material === "solid" ? null : "sidebar");
  if (material === "solid") win.setBackgroundColor(windowColor());
}

/**
  --lc-lights-y is the traffic lights' centre from the top, --lc-lights-x where they end (0 in full
  screen, where they're hidden: macOS moves them into a title bar of its own, so they aren't read there).
*/
let lastLights = { x: LIGHTS.x + 54, y: LIGHTS.y + 7 };
function lights() {
  if (!isMac) return { x: 0, y: 26 };
  if (win?.isFullScreen()) return { x: 0, y: lastLights.y };
  const real = win && mac?.lights(win.getNativeWindowHandle());
  if (real) lastLights = real;
  return lastLights;
}
const syncLights = () => win && !win.isDestroyed() && win.webContents.send("liner:lights", lights());

// Electron says yes to every permission a page asks for unless told otherwise. The app's own page
// gets the two it uses (the clipboard for Copy, notifications); every other page and permission,
// the Browser surface's dev servers included, gets no.
let appOrigin = "";
const ALLOWED = new Set(["clipboard-sanitized-write", "notifications"]);
const mayAsk = (permission: string, url: string) => {
  try {
    return ALLOWED.has(permission) && new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
};
function guardPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => done(mayAsk(permission, details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => mayAsk(permission, origin));
}

const isLocal = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "data:" || u.protocol === "about:" || u.hostname === "127.0.0.1" || u.hostname === "localhost";
  } catch {
    return false;
  }
};

function createWindow() {
  const bounds = visibleBounds(prefs.bounds);
  win = new BrowserWindow({
    ...(bounds ?? { width: 1360, height: 860 }),
    minWidth: 880,
    minHeight: 580,
    show: false,
    title: "Liner Code",
    // With the addon the page is transparent (the window behind it stays opaque, in the system's
    // window colour): Vibrancy here only serves that, and the addon hides Electron's full-window view.
    backgroundColor: mac ? "#00000000" : windowColor(),
    ...(isMac ? { titleBarStyle: "hidden" as const, trafficLightPosition: LIGHTS, vibrancy: mac ? ("sidebar" as const) : undefined } : {}),
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: inspect },
  });
  if (prefs.maximized) win.maximize();
  applyMaterial();

  const wc = win.webContents;
  win.once("ready-to-show", () => {
    win?.show();
    app.focus({ steal: true });
  });
  wc.on("did-finish-load", syncLights);
  win.on("enter-full-screen", syncLights);
  // Electron puts the lights back only after the window has left full screen.
  win.on("leave-full-screen", () => setTimeout(syncLights, 300));
  const keepFrame = () => {
    if (!win || win.isFullScreen()) return;
    prefs.maximized = win.isMaximized();
    if (!prefs.maximized) prefs.bounds = win.getNormalBounds();
    savePrefs();
  };
  win.on("resize", keepFrame);
  win.on("move", keepFrame);

  // Closing the window keeps the app (and its sessions) running; the Dock icon brings it back.
  win.on("close", (e) => {
    if (quitting || !isMac || !win) return;
    e.preventDefault();
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => win?.hide());
      win.setFullScreen(false);
    } else win.hide();
  });
  win.on("closed", () => (win = null));

  // Links out of the app open in your browser; the app itself stays on the engine's origin. A link
  // that asks for a new window (target="_blank", like the PR card's View pull request) does too.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-frame-navigate", (e) => {
    if (isLocal(e.url)) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(e.url)) void shell.openExternal(e.url);
  });
  wc.on("will-attach-webview", (e) => e.preventDefault());

  // The page is an app, not a web page: a right-click keeps text actions (spelling, Copy, Paste,
  // Look Up) and nothing of a browser's. On the page's chrome the page itself shows no menu.
  wc.on("context-menu", (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    const text = p.selectionText.trim();
    if (p.isEditable && p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (items.length) items.push({ type: "separator" });
    }
    if (p.isEditable) items.push({ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste", enabled: p.editFlags.canPaste }, { type: "separator" }, { role: "selectAll" });
    else if (text) items.push({ role: "copy" });
    if (isMac && text) items.push({ type: "separator" }, { label: `Look Up “${text.length > 24 ? `${text.slice(0, 24)}…` : text}”`, click: () => wc.showDefinitionForSelection() });
    if (inspect) items.push({ type: "separator" }, { label: "Inspect Element", click: () => wc.inspectElement(p.x, p.y) });
    if (items.length && win) Menu.buildFromTemplate(items).popup({ window: win });
  });
  return win;
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Menu-bar commands reach the page as liner:command events. */
function send(command: string) {
  show();
  win?.webContents.send("liner:command", command);
}

async function fail(message: string) {
  const r = dialog.showMessageBoxSync({ type: "error", message: "Liner Code can't start", detail: message, buttons: ["Quit", "Show the log"], defaultId: 0 });
  if (r === 1) await shell.openPath(logFile);
  quitting = true;
  app.quit();
}

// ---------- The bridge ----------

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rectOf = (p: Record<string, unknown>): Rect => ({ x: num(p.x), y: num(p.y), width: num(p.width), height: num(p.height) });
const frameOf = (p: Record<string, unknown>): Frame => {
  const h = p.hole && typeof p.hole === "object" ? (p.hole as Record<string, unknown>) : null;
  return { ...rectOf(p), ...(h ? { hole: { ...rectOf(h), radius: num(h.radius) } } : {}) };
};

ipcMain.on("liner:boot", (e) => {
  e.returnValue = { ...boot, platform: process.platform, lights: lights() };
});

ipcMain.handle("liner", async (e, method: unknown, params: unknown) => {
  // Only the app's own page: never a page in the Browser surface's frame.
  if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame) return { ok: false, value: "Not the app's page." };
  try {
    return { ok: true, value: (await handle(str(method), (params ?? {}) as Record<string, unknown>)) ?? null };
  } catch (err) {
    return { ok: false, value: (err as Error).message };
  }
});

async function handle(method: string, p: Record<string, unknown>): Promise<unknown> {
  if (!win) throw new Error("No window.");
  switch (method) {
    case "pickFolder": {
      const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], buttonLabel: "Add project", message: "Pick a folder for Liner Code to work in." });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    }
    case "notify":
      return notify(str(p.title), str(p.body), str(p.threadId) || undefined);
    case "badge": {
      const n = num(p.count);
      if (isMac) app.dock?.setBadge(n > 0 ? String(n) : "");
      else app.setBadgeCount(n);
      return;
    }
    case "reveal":
      if (str(p.path)) shell.showItemInFolder(str(p.path));
      return;
    case "openIn":
      return openIn(str(p.path), str(p.app));
    case "runInTerminal":
      return runInTerminal(str(p.command));
    case "openExternal":
      if (/^(https?|mailto):/i.test(str(p.url))) await shell.openExternal(str(p.url));
      return;
    case "keychainSet":
      return keys.set(str(p.account), str(p.key) || null);
    case "setMaterial": {
      const m = str(p.material);
      material = m === "vibrancy" || m === "solid" ? m : "glass";
      prefs.material = material;
      savePrefs();
      return applyMaterial();
    }
    case "setGlassRect":
      glassRect = frameOf(p);
      return applyMaterial();
    case "setAppearance": {
      const t = str(p.theme);
      nativeTheme.themeSource = t === "dark" || t === "light" ? t : "system";
      return;
    }
    case "haptic":
      return mac?.haptic();
    case "installUpdate": {
      // Restart into the update the engine downloaded and checked.
      if (!installUpdate(engine.home, true)) throw new Error(app.isPackaged ? "There's no downloaded update to put in." : "This copy runs from source: pull and build it instead.");
      updating = true;
      quitting = true;
      setImmediate(() => app.quit());
      return;
    }
    case "dragWindow":
      // The page marks its top bars as drag regions here; WebKit asked on every press instead.
      return;
    case "zoomWindow":
      return win.isMaximized() ? win.unmaximize() : win.maximize();
    case "setMenuKeys":
      // Your shortcuts, on the menu items that run the same commands.
      menuKeys = Object.fromEntries(Object.entries((p.keys ?? {}) as Record<string, unknown>).map(([k, v]) => [k, str(v)]));
      return buildMenu();
    case "snapshot": {
      // A part of the page (the Browser's frame, for an agent), as a PNG.
      const r = rectOf(p);
      const img = await win.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) });
      if (img.isEmpty()) throw new Error("The window didn't give a snapshot.");
      return img.toPNG().toString("base64");
    }
    default:
      throw new Error(`Unknown method ${method}`);
  }
}

// Kept until clicked or closed, or a collected notification loses its click.
const notes = new Set<Notification>();
function notify(title: string, body: string, thread?: string) {
  // Only while you're in another app: in Liner Code, the sidebar already says it.
  if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
  const n = new Notification({ title, body });
  notes.add(n);
  n.on("click", () => {
    notes.delete(n);
    app.focus({ steal: true });
    if (thread) send(`open:${thread}`);
    else show();
  });
  n.on("close", () => notes.delete(n));
  n.on("failed", (_e, error) => {
    notes.delete(n);
    console.error("[shell] notification failed:", error);
  });
  n.show();
}

const EDITORS = ["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed", "com.apple.dt.Xcode"];
const opens = (args: string[]) => new Promise<boolean>((resolve) => execFile("open", args, (err) => resolve(!err)));

/** Opens the folder in an editor (the first you have), Terminal, or Finder. */
async function openIn(path: string, where: string) {
  if (!path) return;
  if (isMac && where === "terminal" && (await opens(["-a", "Terminal", path]))) return;
  if (isMac && where === "editor") for (const id of EDITORS) if (await opens(["-b", id, path])) return;
  const err = await shell.openPath(path);
  if (err) throw new Error(err);
}

/**
  Sign-in commands run in Terminal, where the tool can ask for what it needs. A .command file
  opens there without asking for Automation access.
*/
async function runInTerminal(command: string) {
  if (!command) return;
  const file = join(tmpdir(), `liner-${randomBytes(4).toString("hex")}.command`);
  const said = command.replace(/'/g, "");
  writeFileSync(file, `#!/bin/zsh -l\nclear\necho '\\033[1mLiner Code\\033[0m runs: ${said}'\necho\n${command}\necho\necho 'Done. You can close this window and go back to Liner Code.'\n`, { mode: 0o755 });
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
}

// ---------- The menu bar ----------

let menuKeys: Record<string, string> = {};
const KEY_NAMES: Record<string, string> = {
  comma: ",", backslash: "\\", slash: "/", period: ".", space: "Space", plus: "Plus", "+": "Plus",
  enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", backspace: "Backspace", delete: "Delete",
  up: "Up", down: "Down", left: "Left", right: "Right", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right",
};

/** "mod+shift+u" the way Electron writes it ("CommandOrControl+Shift+U"); "" (or a key it has no name for) is none. */
function accelerator(spec: string): string | undefined {
  const parts = spec.toLowerCase().replace(/\s+/g, "").split("+");
  if (spec.endsWith("++")) parts.splice(parts.length - 2, 2, "plus");
  const mods = new Set<string>();
  let key = "";
  for (const part of parts) {
    if (part === "mod") mods.add("CommandOrControl");
    else if (part === "cmd" || part === "meta") mods.add("Command");
    else if (part === "ctrl" || part === "control") mods.add("Control");
    else if (part === "alt" || part === "option" || part === "opt") mods.add("Alt");
    else if (part === "shift") mods.add("Shift");
    else if (part) key = KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : /^f([1-9]|1\d|2[0-4])$/.test(part) ? part.toUpperCase() : "");
  }
  return key ? [...mods, key].join("+") : undefined;
}

function buildMenu() {
  const item = (label: string, command: string, keys: string): MenuItemConstructorOptions => ({
    label,
    accelerator: accelerator(command in menuKeys ? menuKeys[command] : keys),
    click: () => send(command),
  });
  const settings = item("Settings…", "settings", "mod+,");
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: "Liner Code", submenu: [{ role: "about", label: "About Liner Code" }, { label: "Check for Updates…", click: () => send("updates") }, { type: "separator" }, settings, { type: "separator" }, { role: "hide", label: "Hide Liner Code" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit", label: "Quit Liner Code" }] } satisfies MenuItemConstructorOptions]
      : []),
    { label: "File", submenu: [item("New Session", "new", "mod+n"), item("Add a Project…", "open-project", "mod+o"), { type: "separator" }, ...(isMac ? [] : [settings, { type: "separator" } as const]), { role: isMac ? "close" : "quit", label: isMac ? "Close Window" : "Quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [
        item("Command Menu", "commands", "mod+k"),
        item("Toggle Sidebar", "sidebar", "mod+\\"),
        item("Usage and Cost", "usage", "mod+shift+u"),
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(inspect ? [{ type: "separator" } as const, { role: "reload" } as const, { role: "toggleDevTools" } as const] : []),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Report a Problem…", click: () => void reportProblem().catch((e: unknown) => dialog.showErrorBox("Liner Code couldn't make the report", e instanceof Error ? e.message : String(e))) },
        { label: "Liner Code on GitHub", enabled: Boolean(releasesRepo()), click: () => void shell.openExternal(`https://github.com/${releasesRepo()}`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Report a problem ----------

/** "owner/name": where the app's releases come from (the build writes it into the app's package.json). */
function releasesRepo(): string | undefined {
  try {
    const root = app.isPackaged ? app.getAppPath() : join(__dirname, "../..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { liner?: { releases?: string }; repository?: string | { url?: string } };
    const named = pkg.liner?.releases || (typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url) || "";
    return /^(?:[\w.-]+\/[\w.-]+)$/.exec(named)?.[0] ?? /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(named)?.[1];
  } catch {
    return undefined;
  }
}

/** The agent tools Liner Code drives, and gh, by the name each has on PATH. */
const REPORT_TOOLS = ["claude", "codex", "opencode", "hermes", "cursor-agent", "grok", "gh"];

/** Each tool's version as it says it, for the report: "codex: codex-cli 0.165.0 (~/.local/bin/codex)". */
async function toolVersions(env: NodeJS.ProcessEnv) {
  const dirs = (env.PATH ?? "").split(":").filter(Boolean);
  return Promise.all(
    REPORT_TOOLS.map(async (bin) => {
      const path = dirs.map((d) => join(d, bin)).find((p) => existsSync(p));
      if (!path) return `${bin}: not on PATH`;
      const said = await new Promise<string>((done) => execFile(path, ["--version"], { env, timeout: 10_000, encoding: "utf8" }, (_e, out, err) => done(`${out || err || ""}`.trim().split("\n")[0])));
      return `${bin}: ${said || "no answer"} (${path.replace(homedir(), "~")})`;
    }),
  );
}

/** The engine's logs and the versions, zipped into Downloads and shown in Finder; then a new issue on GitHub. Nothing is sent by itself. */
async function reportProblem() {
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: "Report a problem",
    detail: "Liner Code puts its engine log (this launch's and the one before) and the versions in a zip in your Downloads folder, shows it, and opens a new issue on GitHub. Nothing is sent until you attach it. The log can hold folder names and parts of what the agents did, so look at it first.",
    buttons: ["Make the Report", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const dir = join(tmpdir(), `Liner Code report ${stamp}`);
  mkdirSync(dir, { recursive: true });
  const versions = [`Liner Code ${app.getVersion()}`, `Electron ${process.versions.electron}`, `${isMac ? "macOS" : process.platform} ${process.getSystemVersion()} (${process.arch})`];
  const tools = await toolVersions(shellEnv ?? (await loginEnvironment()));
  writeFileSync(join(dir, "versions.txt"), `${[...versions, "", ...tools].join("\n")}\n`);
  if (existsSync(logFile)) copyFileSync(logFile, join(dir, "engine.log"));
  if (existsSync(previousLogFile)) copyFileSync(previousLogFile, join(dir, "engine.previous.log"));
  const zip = join(app.getPath("downloads"), `${basename(dir)}.zip`);
  await new Promise<void>((done, fail) => execFile("ditto", ["-c", "-k", "--keepParent", dir, zip], (e) => (e ? fail(e) : done())));
  shell.showItemInFolder(zip);
  const repo = releasesRepo();
  if (repo) void shell.openExternal(`https://github.com/${repo}/issues/new?template=bug.yml&version=${encodeURIComponent(app.getVersion())}&macos=${encodeURIComponent(process.getSystemVersion())}`);
}

// ---------- Launch ----------

/** Where the engine's code and the built app live: inside the app, or in the repo while developing. */
function resources(): Paths | null {
  const root = app.isPackaged ? app.getAppPath() : join(__dirname, "../..");
  const paths = { engine: join(root, "engine/src/main.ts"), ui: join(root, app.isPackaged ? "ui" : "ui/dist") };
  return existsSync(paths.engine) ? paths : null;
}

app.on("second-instance", show);
app.on("activate", show);
app.on("before-quit", () => {
  quitting = true;
  engine.stop();
  // A downloaded update goes in as the app quits, so the next launch is the new one.
  if (!updating && staged(engine.home)) updating = installUpdate(engine.home, false);
});
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
nativeTheme.on("updated", () => {
  if (win && !mac && material === "solid") win.setBackgroundColor(windowColor());
});

void app.whenReady().then(async () => {
  loadPrefs();
  material = prefs.material ?? "solid";
  guardPermissions();
  buildMenu();
  createWindow();
  mac?.quietWritingBadge();
  const who = await whoami();
  boot.user = who.user;
  boot.machine = who.machine;

  if (devUrl) {
    boot.token = process.env.LINER_TOKEN || "liner-dev";
    appOrigin = new URL(devUrl).origin;
    void win?.loadURL(devUrl);
    return;
  }
  void win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BOOT_PAGE)}`);
  const paths = resources();
  if (!paths) return fail("Liner Code can't find its engine. Reinstall the app.");
  const [env, own] = await Promise.all([loginEnvironment(), keys.all().catch(() => ({}))]);
  shellEnv = env;
  engine.onReady = (port) => {
    // A restarted engine keeps its port and token; the page reconnects by itself.
    if (loaded) return;
    loaded = true;
    if (prefs.port !== port) {
      prefs.port = port;
      savePrefs();
    }
    boot.token = engine.token;
    appOrigin = `http://127.0.0.1:${port}`;
    void win?.loadURL(`${appOrigin}/`);
  };
  engine.onFail = (m) => void fail(m);
  engine.port = prefs.port ?? 0;
  // A packaged app says which version it is and where it sits, so the engine can tell whether it can update in place.
  const bundle = bundlePath();
  const self = bundle ? { LINER_APP_VERSION: app.getVersion(), LINER_APP_BUNDLE: bundle } : {};
  engine.start(paths, { ...env, ...self, LINER_USER_NAME: who.user, LINER_MACHINE: who.machine }, own);
});
