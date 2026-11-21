/*
  Liner Code's desktop shell, on Electron. It does what the Swift shell in mac/ did: one window
  the app draws in (the engine serves it on 127.0.0.1), the engine as a child process, the
  see-through window, the menu bar with your keys, notifications and the Dock badge,
  keys kept encrypted, Terminal and Finder. The page asks for these over one IPC channel
  ("liner") with the same methods it sent the Swift shell; preload.ts is its side of it.
*/
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, session, shell, systemPreferences, type MenuItemConstructorOptions, type NativeImage, type Rectangle } from "electron";
import { exec, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import { basename, delimiter, join, normalize } from "node:path";
import { sealedFrame } from "../../contracts/src/panel.ts";
import { heldOnYou, openAsk, quitQuestion, QuitWhenDone, type Live } from "./finish";
import { fileIn, folderOf, openAsText, openIn as openInWith, type Opener } from "./editor";
import { Engine, loginEnvironment, logFile, previousLogFile, whoami, type Paths } from "./engine";
import { Keys } from "./keys";
import { mac, type Rect } from "./mac";
import { materialOf, seeThrough, type Material } from "./material";
import { oldScripts } from "./temp";
import { StatusItem, type TrayStatus } from "./tray";
import { bundlePath, install as installUpdate } from "./update";

app.setName("Liner Code");
// A test home (LINER_HOME) keeps the shell's own data apart too, and runs beside your app.
app.setPath("userData", process.env.LINER_HOME ? join(process.env.LINER_HOME, "shell") : join(app.getPath("appData"), "Liner Code"));

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
// Windows shows notifications, and groups the taskbar button, by this id; a Start menu shortcut
// has to carry the same one for a notification to show at all (startMenu puts it there).
if (isWin) app.setAppUserModelId("app.liner.code");

/**
  The Start menu shortcut, with the app's id, pointed at wherever this copy now is (a moved folder
  moves it). The setup (scripts/windows/liner-code.nsi) puts in this same one, by name and folder,
  but stock NSIS can't give it the id, so the app writes it again at every launch; a copy from the
  zip has no setup, so this is its only shortcut.
*/
function startMenu() {
  if (!isWin || !app.isPackaged) return;
  const lnk = join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Liner Code.lnk");
  try {
    shell.writeShortcutLink(lnk, existsSync(lnk) ? "replace" : "create", { target: process.execPath, appUserModelId: "app.liner.code", description: "Liner Code" });
  } catch {
    // no shortcut: everything but notifications still works
  }
}
// The Web Inspector and the page's reload are for building Liner Code, not for using it.
const inspect = process.env.LINER_INSPECT === "1";
// While developing: the Vite server, and an engine you run yourself (npm run dev).
const devUrl = process.env.LINER_UI_URL;

// A second copy hands over to the first (second-instance shows its window) and starts nothing of its own:
// quit() isn't at once, and on Windows, where nothing else stops a second launch, it could still open
// a window and a second engine.
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) app.quit();
/**
  Started now, before Electron is ready, since neither needs it: your login shell's environment (its
  rc files can take a second or two, and the engine waits on it) and your name and the computer's.
  The window and its boot screen don't wait on either.
*/
const envAtLaunch = firstCopy ? loginEnvironment() : undefined;
const whoAtLaunch = firstCopy ? whoami() : undefined;

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
type Prefs = { material?: string; ground?: string; bounds?: Rectangle; maximized?: boolean; port?: number };
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
  saveTimer = setTimeout(() => {
    // Whole or not at all: a crash mid-write would forget the port, and with it all the page keeps per address.
    try {
      writeFileSync(`${prefsFile()}.tmp`, JSON.stringify(prefs, null, 2));
      renameSync(`${prefsFile()}.tmp`, prefsFile());
    } catch (e) {
      console.error("[shell] couldn't save the window's place:", e);
    }
  }, 300);
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

// Where the traffic lights go: centred on the page's 44px top row, which starts at the window's 6px
// gap, so their centre is 28px from the top (y is their top edge; they're 14px high). The Swift shell
// puts them there too (AppDelegate.swift, placeLights).
const LIGHTS = { x: 20, y: 21 };
// The line sits where the page's own boot screen keeps it, under the name, so it doesn't jump when that loads.
// Over the desktop (a see-through window) it's on a tint of the window's colour, as the page will be, not on nothing.
const bootPage = (ground: string) => `<html><body style="margin:0;height:100vh;background:${ground};font:13px -apple-system,system-ui,sans-serif;color:#8a8f98"><span style="position:fixed;top:calc(50% + 30px);left:50%;translate:-50% 0;white-space:nowrap">Starting the engine</span></body></html>`;

let material: Material = "solid";

/** The system's window colour, which shows around the page's paper while the material is Solid. */
function windowColor() {
  if (isMac) {
    const c = systemPreferences.getColor("window-background");
    if (/^#[0-9a-f]{6}/i.test(c)) return c.slice(0, 7);
  }
  return nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ececec";
}

/**
  What sits behind the transparent page: solid, or the desktop itself, crisp (clear) or blurred
  (frost). With the addon the window stays opaque for solid; for clear and frost it lets the window
  go transparent, the page tinting itself, with nothing behind it or a blur behind it all. Clear
  and frost need the addon: Electron alone left the window black behind the page, so there
  they're solid, and the page doesn't offer Desktop (boot's `clear`).
*/
function applyMaterial() {
  if (!win || !isMac) return;
  // Full screen puts the window in a space of its own, with nothing of the desktop behind it (a
  // clear window shows the space's black there), so see-through is solid until it leaves.
  if (mac) return mac.backdrop(win.getNativeWindowHandle(), seeThrough(material) && win.isFullScreen() ? "solid" : material);
  win.setBackgroundColor(windowColor());
}

/**
  --lc-lights-y is the traffic lights' centre from the top, --lc-lights-x where they end (0 in full
  screen, where they're hidden: macOS moves them into a title bar of its own, so they aren't read there).
*/
let lastLights = { x: LIGHTS.x + 54, y: LIGHTS.y + 7 };
function lights() {
  if (!isMac) return { x: 0, y: 28 };
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
/** A srcdoc frame, or a panel's, sending itself anywhere but where it is. */
const sealed = (e: { url: string; frame?: { url: string } | null }) => sealedFrame(e.frame?.url, e.url, appOrigin);
/** The app's own page: the engine's origin, or the dev server's (LINER_UI_URL). */
const ours = (url: string) => {
  try {
    return !!appOrigin && new URL(url).origin === appOrigin;
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
    // Elsewhere the system's own frame and title bar (the page leaves no room for window buttons
    // over its top right), its menu bar shown while Alt is held; the keys work either way.
    ...(isMac ? { titleBarStyle: "hidden" as const, trafficLightPosition: LIGHTS, vibrancy: mac ? ("sidebar" as const) : undefined } : { autoHideMenuBar: true }),
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: inspect },
  });
  applyMaterial();

  const wc = win.webContents;
  // Showing the window makes it opaque again, so the material goes back on each time it's shown
  // (on launch, from the Dock, from a second launch); without this, Desktop never showed through.
  win.on("show", () => applyMaterial());
  win.once("ready-to-show", () => {
    // Maximized only now: maximize() shows a hidden window, which would show it before its first paint.
    // It was made at its normal frame, so leaving maximized goes back there.
    if (prefs.maximized) win?.maximize();
    win?.show();
    app.focus({ steal: true });
  });
  wc.on("did-finish-load", syncLights);
  // The material again on the way in and out of full screen: a see-through window is solid while
  // it's full screen (applyMaterial).
  win.on("enter-full-screen", () => (syncLights(), applyMaterial()));
  // Electron puts the lights back only after the window has left full screen.
  win.on("leave-full-screen", () => (setTimeout(syncLights, 300), applyMaterial()));
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
    if (quitting || !win) return;
    // Elsewhere closing the window quits, so it asks first while sessions work, as quitting does:
    // asked after the window has gone, Cancel would leave the app running with no window.
    if (!isMac) {
      if (holdQuit()) e.preventDefault();
      return;
    }
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
  // The window itself never leaves the app's origin (a localhost link dropped on it would get the
  // token and the bridge); the frames it shows pages in stay on this machine. loadURL isn't asked.
  wc.on("will-frame-navigate", (e) => {
    // A sealed frame (an add-on's panel, an agent's page, a design's version) never leaves its
    // document: not in place, and not out to your browser, where what it read would leave with it.
    // Its links come to the window as a message instead (Page.tsx).
    if (!e.isMainFrame && sealed(e)) return e.preventDefault();
    if (e.isMainFrame ? ours(e.url) : isLocal(e.url)) return;
    // A page's own embeds (a dev app's Stripe or YouTube frame, a design's map) load where they
    // are; only the app's page and the frames it shows pages in stay here, their links opening outside.
    const parent = e.frame?.parent;
    if (!e.isMainFrame && parent && parent.frameTreeNodeId !== wc.mainFrame.frameTreeNodeId) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(e.url)) void shell.openExternal(e.url);
  });
  wc.on("will-attach-webview", (e) => e.preventDefault());

  // A page that dies (out of memory, a crash) leaves a blank window while the engine works on, and
  // there's no reload to reach for: it's loaded again, three times a minute at most (T3 Code:
  // window/DesktopWindow.ts).
  let gone: number[] = [];
  wc.on("render-process-gone", (_e, d) => {
    console.error("[shell] the page went:", d.reason, d.exitCode);
    const now = Date.now();
    gone = gone.filter((t) => now - t < 60_000);
    if (quitting || d.reason === "clean-exit" || d.reason === "launch-failed" || gone.length >= 3) return;
    gone.push(now);
    setTimeout(() => {
      if (win && !win.isDestroyed()) wc.reload();
    }, 500);
  });

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
  // Coming back to the app (the Dock, a second launch, the menu bar item, a notice) calls off a quit that waits.
  stopWaiting();
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

/**
  The engine's RPC, for the menu bar item's menu and a quit that waits, with the same token the
  page uses (under npm run app:dev, the dev engine's port and token). Held to `ms`: an engine that's
  stuck but still holds its connection open would otherwise keep the caller waiting for ever.
*/
async function engineRpc(method: string, params: Record<string, unknown>, ms = 5000) {
  // npm run dev's engine is on 7317 (scripts/dev.ts), with the dev token the page has too.
  const port = devUrl ? 7317 : engine.port;
  const token = devUrl ? boot.token : engine.token;
  const r = await fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", headers: { "content-type": "application/json", "x-liner-token": token }, body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(ms) });
  // From here the engine has answered: what goes wrong now is its word, not its silence (`answered`, for a quit that waits).
  const body = (await r.json().catch((e) => {
    if (e instanceof SyntaxError) return { ok: false, error: `The engine answered ${r.status}, not in JSON.` };
    throw e;
  })) as { ok: boolean; result?: unknown; error?: string };
  if (!body.ok) throw Object.assign(new Error(body.error ?? "The engine said no."), { answered: true });
  return body.result;
}

const statusItem = new StatusItem({
  open: (id) => (id ? send(`open:${id}`) : show()),
  quit: () => app.quit(),
  quitNow: () => {
    quitting = true;
    app.quit();
  },
  rpc: engineRpc,
});

async function fail(message: string) {
  const r = dialog.showMessageBoxSync({ type: "error", message: "Liner Code can't start", detail: message, buttons: ["Quit", "Show the log"], defaultId: 0 });
  if (r === 1) await shell.openPath(logFile);
  quitting = true;
  app.quit();
}

// ---------- The bridge ----------

const str = (v: unknown) => (typeof v === "string" ? v : "");
// The page joins paths with / (C:\proj/src/a.ts on Windows), which Explorer doesn't always take.
const local = (p: string) => (isWin && p ? normalize(p) : p);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rectOf = (p: Record<string, unknown>): Rect => ({ x: num(p.x), y: num(p.y), width: num(p.width), height: num(p.height) });

ipcMain.on("liner:boot", (e) => {
  // clear: the window can turn see-through (the Mac addon is there), so the page offers Desktop.
  e.returnValue = { ...boot, platform: process.platform, lights: lights(), clear: Boolean(mac) };
});

ipcMain.handle("liner", async (e, method: unknown, params: unknown) => {
  // Only the app's own page: never a page in the Browser surface's frame.
  if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame || !ours(e.senderFrame?.url ?? "")) return { ok: false, value: "Not the app's page." };
  try {
    return { ok: true, value: (await handle(str(method), (params ?? {}) as Record<string, unknown>)) ?? null };
  } catch (err) {
    return { ok: false, value: (err as Error).message };
  }
});

/**
  A local page drawn in a window nobody sees, then captured: no Node, no new windows, nowhere but
  this Mac; gone once captured. `before` sees the window before it loads, `after` captures it once
  it has; one deadline is over all of it.
*/
async function offscreen<T>(url: string, width: number, height: number, after: (w: BrowserWindow) => Promise<T>, before?: (w: BrowserWindow) => void) {
  const w = new BrowserWindow({ show: false, width, height, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, disableDialogs: true } });
  before?.(w);
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The page stays on this Mac, and a sealed frame in it (an add-on being checked, with real files) stays put.
  w.webContents.on("will-frame-navigate", (e) => {
    if (e.isMainFrame ? !isLocal(e.url) : sealed(e)) e.preventDefault();
  });
  try {
    // One deadline over all of it: a page that loops after it loads never answers, and the window would stay.
    return await Promise.race([
      (async () => {
        await Promise.race([w.loadURL(url), new Promise((_, no) => setTimeout(() => no(new Error("The page took too long to load.")), 15000))]);
        return after(w);
      })(),
      stuck(w),
    ]);
  } finally {
    w.destroy();
  }
}

/** What an agent's screenshot shows when its session isn't on screen. */
const shoot = (url: string, width: number, height: number) =>
  offscreen(url, width, height, async (w) => {
    // Its first frames, fonts and images.
    await new Promise((r) => setTimeout(r, 800));
    const img = await w.webContents.capturePage();
    if (img.isEmpty()) throw new Error("The page didn't draw.");
    return img.toPNG().toString("base64");
  });

/** Rejects after 25 s (under the engine's 30), crashing a renderer stuck in a loop on the way. */
const stuck = (w: BrowserWindow) =>
  new Promise<never>((_, no) =>
    setTimeout(() => {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.forcefullyCrashRenderer();
      no(new Error("The page stopped answering."));
    }, 25000),
  );

/**
  A design drawn out of sight, for its agent to look at: the page at its width, as tall as it is
  (up to 2400 px), with the errors it logged while it loaded (T3 Code's html_preview does the same
  in a headless Chrome).
*/
function look(url: string, width: number, height: number) {
  const errors: string[] = [];
  return offscreen(
    url,
    width,
    height,
    async (w) => {
      await new Promise((r) => setTimeout(r, 600));
      const tall = Number(await w.webContents.executeJavaScript("Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))").catch(() => 0)) || height;
      if (tall > height) {
        w.setContentSize(width, Math.min(2400, tall));
        await new Promise((r) => setTimeout(r, 400));
      }
      const img = await w.webContents.capturePage();
      if (img.isEmpty()) throw new Error("The page didn't draw.");
      // At the design's own pixels: a Retina capture is twice as wide, and costs the model four times as much to look at.
      const shot = img.getSize().width > width ? img.resize({ width, quality: "good" }) : img;
      return { png: shot.toPNG().toString("base64"), errors, height: tall };
    },
    (w) =>
      w.webContents.on("console-message", (e) => {
        if (e.level === "error" && errors.length < 20) errors.push(`${e.message}${e.lineNumber ? ` (line ${e.lineNumber})` : ""}`);
      }),
  );
}

async function handle(method: string, p: Record<string, unknown>): Promise<unknown> {
  if (!win) throw new Error("No window.");
  switch (method) {
    case "pickFolder": {
      const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], buttonLabel: "Add project", message: "Pick a folder for Liner Code to work in." });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    }
    case "notify":
      // While the app waits to quit, the page's notice and the shell's own "needs you" would say the same thing twice.
      if (waiting && str(p.threadId)) {
        if (waiting.toldLately(str(p.threadId), Date.now())) return;
        waiting.heard(str(p.threadId), Date.now());
      }
      return notify(str(p.title), str(p.body), str(p.threadId) || undefined);
    case "badge": {
      const n = num(p.count);
      if (isMac) app.dock?.setBadge(n > 0 ? String(n) : "");
      // Windows has no count on a taskbar button: a dot over its icon, and the count in its tooltip.
      else if (isWin) win.setOverlayIcon(n > 0 ? redDot() : null, n > 0 ? `${n} need${n === 1 ? "s" : ""} you` : "");
      else app.setBadgeCount(n);
      return;
    }
    case "status":
      // The page saw something change: a quit that waits looks again now rather than at its next turn.
      if (waiting) setTimeout(() => void checkWaiting(), 300);
      return statusItem.set(p as unknown as TrayStatus);
    case "reveal":
      if (str(p.path)) shell.showItemInFolder(local(str(p.path)));
      return;
    case "openIn":
      return openIn(local(str(p.path)), str(p.app));
    case "openFile":
      return openFile({ threadId: str(p.threadId) || undefined, projectId: str(p.projectId) || undefined }, str(p.path));
    case "runInTerminal":
      return runInTerminal(str(p.command));
    case "openExternal":
      if (/^(https?|mailto):/i.test(str(p.url))) await shell.openExternal(str(p.url));
      return;
    case "keychainSet": {
      const account = str(p.account);
      const value = str(p.key) || null;
      keys.set(account, value);
      // So an engine that comes back after a crash has the keys as they are now, not as at launch.
      engine.setKey(account.replace(/^key:/, ""), value);
      return;
    }
    case "relaunch":
      // Start without add-ons: the engine left its mark for the next start, and this is that start.
      quitting = true;
      // An update waiting goes in now, and its swap opens the app: relaunching as well would start
      // this copy just as it's replaced.
      // One that doesn't check out is dropped instead, and the engine that starts next says so.
      updating = installUpdate(engine.home, true) === "started";
      if (!updating) app.relaunch();
      setImmediate(() => app.quit());
      return;
    case "setMaterial": {
      material = materialOf(p.material);
      prefs.material = material;
      // The see-through page's ground, for the next launch's boot screen: a CSS colour, kept to
      // the characters one needs, since it goes into that page as it is.
      const g = str(p.ground);
      prefs.ground = seeThrough(material) && g.length <= 160 && /^[\w\s.,%()#-]+$/.test(g) ? g : undefined;
      savePrefs();
      return applyMaterial();
    }
    case "setAppearance": {
      const t = str(p.theme);
      nativeTheme.themeSource = t === "dark" || t === "light" ? t : "system";
      return;
    }
    case "haptic":
      return mac?.haptic();
    case "installUpdate": {
      // Restart into the update the engine downloaded and checked.
      const put = installUpdate(engine.home, true);
      if (put === "refused") {
        // It was dropped (signed.ts waiting): the engine takes back its "ready" and says why on the update's notice, once. An
        // engine that doesn't answer reads refused.json at its next launch, and this says it meanwhile.
        await engineRpc("updates.refused", {}).catch(() => {
          throw new Error("The downloaded update didn't check out, so it was removed. Download it again from Settings › Updates.");
        });
        return;
      }
      if (put !== "started") throw new Error(app.isPackaged ? "There's no downloaded update to put in." : "This copy runs from source: pull and build it instead.");
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
    case "setMenuFace": {
      // ⌘N is New Design while the window shows Liner Design, New Scan in Liner Security, New Session in Liner Code: the item's name follows.
      const next = p.face === "design" || p.face === "security" ? p.face : "code";
      if (next === menuFace) return;
      menuFace = next;
      return buildMenu();
    }
    case "snapshot": {
      // A part of the page (the Browser's frame, for an agent), as a PNG.
      const r = rectOf(p);
      const img = await win.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) });
      if (img.isEmpty()) throw new Error("The window didn't give a snapshot.");
      // At the size asked (a page drawn zoomed out, at its own pixels, so a point on it is a point to click).
      const ow = Math.round(num(p.outWidth));
      const oh = Math.round(num(p.outHeight));
      if (ow > 0 && oh > 0) return img.resize({ width: Math.min(2400, ow), height: Math.min(2400, oh), quality: "best" }).toPNG().toString("base64");
      return img.toPNG().toString("base64");
    }
    case "shotUrl": {
      // The Browser's page while it's out of sight: only pages on this Mac.
      const url = str(p.url);
      if (!/^http:/i.test(url) || !isLocal(url)) throw new Error("Only pages on this Mac.");
      return shoot(url, Math.min(2400, Math.max(320, num(p.width) || 1280)), Math.min(2400, Math.max(240, num(p.height) || 800)));
    }
    case "shotPage": {
      // A design, for its agent: only pages on this Mac.
      const url = str(p.url);
      if (!/^http:/i.test(url) || !isLocal(url)) throw new Error("Only pages on this Mac.");
      return look(url, Math.min(2400, Math.max(320, num(p.width) || 1280)), Math.min(2400, Math.max(240, num(p.height) || 800)));
    }
    default:
      throw new Error(`Unknown method ${method}`);
  }
}

/** The taskbar button's badge on Windows: a 16 px red dot (premultiplied BGRA), drawn once. */
let dot: NativeImage | undefined;
function redDot() {
  if (dot) return dot;
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = Math.max(0, Math.min(1, 7.5 - Math.hypot(x + 0.5 - 8, y + 0.5 - 8)));
      buf.set([Math.round(0x3b * a), Math.round(0x30 * a), Math.round(0xff * a), Math.round(255 * a)], (y * size + x) * 4);
    }
  return (dot = nativeImage.createFromBitmap(buf, { width: size, height: size }));
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

/** How the shell opens things for the page (editor.ts decides; this is the system it decides with). */
const opener: Opener = {
  isMac,
  isWin,
  editors: EDITORS,
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  real: (p) => realpathSync.native(p),
  opens,
  started: (cmd, args, hide, cwd) => started(cmd, args, hide, cwd),
  openPath: (p) => shell.openPath(p),
  showInFolder: (p) => shell.showItemInFolder(p),
};

/** Opens the folder in an editor (the first you have), Terminal, or Finder; a file is never opened as itself (editor.ts). */
const openIn = (path: string, where: string) => openInWith(opener, path, where, process.env.ComSpec || "cmd.exe");

/**
  A file of a session, or of a project when there's no session, in your editor (Changes' and a
  Security finding's "Open in your editor"). The folder is the engine's word for it, and the file must
  sit inside it (editor.ts). With no editor of the list it opens as text (TextEdit) on a Mac and is
  shown in its folder elsewhere: opening it as itself would run a script or a program an agent wrote.
*/
async function openFile(at: { threadId?: string; projectId?: string }, path: string) {
  const s = (await engineRpc("state.get", {})) as Parameters<typeof folderOf>[0];
  const folder = folderOf(s, at);
  const r = folder ? fileIn(local(folder), local(path), realpathSync.native) : ({ why: "outside" } as const);
  if ("why" in r) throw new Error(r.why === "gone" ? `${basename(path)} isn't there any more: it was deleted or moved since.` : at.threadId ? "Only a file in this session's folder opens from here." : "Only a file in this project's folder opens from here.");
  return openAsText(opener, r.file);
}

/** Starts a program that carries on by itself; false when it couldn't. */
const started = (cmd: string, args: string[], hide = false, cwd?: string) =>
  new Promise<boolean>((resolve) => {
    const c = spawn(cmd, args, { cwd, detached: true, stdio: "ignore", windowsHide: hide });
    c.on("error", () => resolve(false));
    c.on("spawn", () => (c.unref(), resolve(true)));
  });

/**
  Sign-in commands run in Terminal, where the tool can ask for what it needs. A .command file
  opens there without asking for Automation access. It can't remove itself before Terminal has read
  it, so the ones a day old go at the next launch (oldScripts).
*/
async function runInTerminal(command: string) {
  if (!command) return;
  // On Windows a .cmd file opens in a console window the same way, and waits for a key at the end.
  if (isWin) {
    const file = join(tmpdir(), `liner-${randomBytes(4).toString("hex")}.cmd`);
    const said = command.replace(/"/g, "").replace(/%/g, "%%").replace(/[\^&|<>()]/g, "^$&");
    // In a cmd of its own: an npm shim (npm.cmd, codex.cmd) run bare from a batch file never hands
    // control back, and the window would close before Done and the pause.
    writeFileSync(file, `@echo off\r\ntitle Liner Code\r\necho Liner Code runs: ${said}\r\necho.\r\ncmd /d /s /c "${command}"\r\necho.\r\necho Done. You can close this window and go back to Liner Code.\r\npause >nul\r\n`);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return;
  }
  const file = join(tmpdir(), `liner-${randomBytes(4).toString("hex")}.command`);
  const said = command.replace(/'/g, "");
  writeFileSync(file, `#!/bin/zsh -l\nclear\necho '\\033[1mLiner Code\\033[0m runs: ${said}'\necho\n${command}\necho\necho 'Done. You can close this window and go back to Liner Code.'\n`, { mode: 0o755 });
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
}

// ---------- The menu bar ----------

let menuKeys: Record<string, string> = {};
/** The face the window shows (setMenuFace): File's first item is named for it. */
let menuFace: "code" | "design" | "security" = "code";
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
    { label: "File", submenu: [item(menuFace === "design" ? "New Design" : menuFace === "security" ? "New Scan" : "New Session", "new", "mod+n"), item("Add a Project…", "open-project", "mod+o"), { type: "separator" }, ...(isMac ? [] : [settings, { type: "separator" } as const]), { role: isMac ? "close" : "quit", label: isMac ? "Close Window" : isWin ? "Exit" : "Quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [
        item("Command Menu", "commands", "mod+k"),
        item("Toggle Sidebar", "sidebar", "mod+\\"),
        item("Usage and Cost", "usage", "mod+shift+u"),
        item("The Wall", "wall", "mod+shift+o"),
        { type: "separator" },
        item("Next Session That Needs You", "next-needs", "mod+alt+down"),
        item("Move to Next Area", "focus.next", "f6"),
        item("Move to Previous Area", "focus.prev", "shift+f6"),
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
const REPORT_TOOLS = ["claude", "codex", "opencode", "hermes", "cursor-agent", "grok", "agy", "gh"];

/** Each tool's version as it says it, for the report: "codex: codex-cli 0.165.0 (~/.local/bin/codex)". */
async function toolVersions(env: NodeJS.ProcessEnv) {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  // On Windows a tool is a .exe, or an npm .cmd shim, which Node only starts through a shell.
  const names = (bin: string) => (isWin ? [".exe", ".cmd", ".bat"].map((x) => bin + x) : [bin]);
  return Promise.all(
    REPORT_TOOLS.map(async (bin) => {
      const path = dirs.flatMap((d) => names(bin).map((n) => join(d, n))).find((p) => existsSync(p));
      if (!path) return `${bin}: not on PATH`;
      const said = await new Promise<string>((done) => {
        const answer = (_e: Error | null, out: string, err: string) => done(`${out || err || ""}`.trim().split("\n")[0]);
        if (isWin && /\.(cmd|bat)$/i.test(path)) exec(`"${path}" --version`, { env, timeout: 10_000, encoding: "utf8", windowsHide: true }, answer);
        else execFile(path, ["--version"], { env, timeout: 10_000, encoding: "utf8", windowsHide: true }, answer);
      });
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
  // Windows 10 and later have bsdtar in System32, which writes a zip for a .zip name (-a).
  const [zipper, zipArgs] = isWin ? [join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", tmpdir(), basename(dir)]] : ["ditto", ["-c", "-k", "--keepParent", dir, zip]];
  try {
    await new Promise<void>((done, fail) => execFile(zipper, zipArgs, { windowsHide: true }, (e) => (e ? fail(e) : done())));
  } finally {
    // The logs' unzipped copy goes, zipped or not: it holds folder names and what the agents did.
    rmSync(dir, { recursive: true, force: true });
  }
  shell.showItemInFolder(zip);
  const repo = releasesRepo();
  if (repo) void shell.openExternal(`https://github.com/${repo}/issues/new?template=bug.yml&version=${encodeURIComponent(app.getVersion())}${isMac ? `&macos=${encodeURIComponent(process.getSystemVersion())}` : ""}`);
}

// ---------- Launch ----------

/** Where the engine's code and the built app live: inside the app, where the engine is engine/build.ts's bundle, or in the repo while developing, where it runs from source. */
function resources(): Paths | null {
  const root = app.isPackaged ? app.getAppPath() : join(__dirname, "../..");
  const paths = { engine: join(root, app.isPackaged ? "engine/src/main.js" : "engine/src/main.ts"), ui: join(root, app.isPackaged ? "ui" : "ui/dist") };
  return existsSync(paths.engine) ? paths : null;
}

app.on("second-instance", show);
app.on("activate", show);
/**
  ⌘Q while sessions work asks first, in a native alert, since quitting stops their turns (T3 Code
  holds to quit instead: web components/QuitHoldOverlay.tsx). The page says how many work, with
  the menu bar item's status. An update going in, a launch that failed, or your yes has decided.
*/
let asking = false;
/**
  Whether the app can wait out of sight for the work to end: on the Mac and on Windows, where the
  menu bar item (the tray) stays to say so and to bring the window back. Linux is left as it was:
  many desktops there show no tray at all, and the app would be running with nothing to see.
*/
const canWait = isMac || isWin;
/**
  Whether a quit (or, off the Mac, closing the window) waits for an answer: sessions work, or wait on you with a request still
  open, whose turns quitting would stop as surely. Those are read from their timelines first (lookThenAsk), and a quit with
  none goes ahead.
*/
function holdQuit() {
  const n = statusItem.running();
  if (n > 0) {
    if (!asking) void askToQuit(n);
    return true;
  }
  if (!statusItem.asking().length) return false;
  if (!asking) void lookThenAsk();
  return true;
}
/** The sessions waiting on you, asked of the engine: any with a live request asks first; none, and the quit goes on. */
async function lookThenAsk() {
  asking = true;
  let held = 0;
  try {
    // A timeline that doesn't come in time counts (heldOnYou): asking once too often beats ending a turn unasked.
    held = await heldOnYou(statusItem.asking(), (id) => engineRpc("thread.items", { id }, 1500));
  } finally {
    asking = false;
  }
  if (held > 0) return askToQuit(statusItem.running(), held);
  quitting = true;
  app.quit();
}
async function askToQuit(working: number, held = 0) {
  asking = true;
  const n = working + held;
  const one = n === 1;
  const opts = {
    type: "warning" as const,
    message: quitQuestion(working, held),
    detail: canWait
      ? `Liner Code can go out of sight and quit by itself once ${one ? "it's" : "they're"} done, or quit now and stop ${one ? "its turn" : "their turns"} where ${one ? "it is" : "they are"}.`
      : "Quitting stops their turns where they are. Their timelines and the changes so far are kept.",
    buttons: canWait ? [one ? "Quit When It Finishes" : "Quit When They Finish", "Quit", "Cancel"] : ["Quit", "Cancel"],
    defaultId: 0,
    cancelId: canWait ? 2 : 1,
  };
  try {
    // A sheet on the window when it's on screen; on its own when the window is shut.
    const { response } = await (win?.isVisible() && !win.isMinimized() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
    if (canWait && response === 0) return waitThenQuit();
    if (response !== (canWait ? 1 : 0)) return;
    quitting = true;
    app.quit();
  } finally {
    asking = false;
  }
}

// ---------- Quit when they finish ----------

/** Set while the app waits, out of sight, for its sessions to finish before it quits (finish.ts decides). */
let waiting: QuitWhenDone | null = null;
let waitTimer: NodeJS.Timeout | undefined;
let checking = false;
/** How often the engine is asked: the page is hidden too, and a hidden page's timers can lag by a minute, so the shell asks itself. */
const WAIT_EVERY_MS = 3000;

/** Every window out of sight and, on the Mac, the Dock icon too; the menu bar item stays, and the engine is asked until nothing works. */
function waitThenQuit() {
  if (waiting) return;
  waiting = new QuitWhenDone();
  // Shown at once, on the page's last word, until the engine's first answer.
  statusItem.hold({ working: [], waiting: [] });
  if (win && !win.isDestroyed()) {
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => waiting && win?.hide());
      win.setFullScreen(false);
    } else win.hide();
  }
  if (isMac) app.dock?.hide();
  waitTimer = setInterval(() => void checkWaiting(), WAIT_EVERY_MS);
  void checkWaiting();
}

/** Calls off a quit that waits: the Dock icon and the menu bar item go back to how they were. */
function stopWaiting() {
  if (!waiting) return;
  waiting = null;
  clearInterval(waitTimer);
  statusItem.hold(null);
  if (isMac) void app.dock?.show().then(setDockIcon);
}

/** One look at the engine's sessions: quits through the normal path (the engine saves, a staged update goes in) once none works. */
async function checkWaiting() {
  const w = waiting;
  if (!w || checking) return;
  checking = true;
  // Whether the engine answered this look: anything going wrong after that is no silence of its.
  let heard = false;
  try {
    const s = (await engineRpc("state.get", {})) as { threads?: Live[]; settings?: { notify?: boolean } };
    heard = true;
    const threads = s.threads ?? [];
    // A session already waiting on you when you quit holds the app only if its request is still open (a live turn).
    // One whose timeline doesn't come (a busy engine, a timeout) is held as if it waits on you, and looked at again next time.
    for (const id of w.toCheck(threads)) w.mark(id, await engineRpc("thread.items", { id }).then(openAsk, () => undefined));
    if (waiting !== w) return;
    const r = w.read(threads, Date.now());
    statusItem.hold(r.left);
    // It can't finish by itself: say so once, as the page would, since nothing else will make it go.
    if (s.settings?.notify) for (const t of r.tell) notify("Waiting on you", `“${t.title}” needs you before Liner Code can quit.`, t.id);
    if (!r.quit) return;
    clearInterval(waitTimer);
    quitting = true;
    app.quit();
  } catch (e) {
    // The engine is restarting or busy: the next look tries again. An answer that says no is the engine there, so work may
    // still run: never silence. Unanswered look after look for a minute awake, it can't be waited on safely any more
    // (finish.ts, SILENT_MS), and the app quits.
    console.error("[shell] couldn't ask the engine what still works:", e);
    if (waiting !== w) return;
    if (heard || (e as { answered?: boolean }).answered) w.answered();
    else if (w.unanswered(Date.now())) {
      clearInterval(waitTimer);
      quitting = true;
      app.quit();
    }
  } finally {
    checking = false;
  }
}

/** On Windows: the engine has saved and stopped, so quitting can go on. */
let engineGone = false;
app.on("before-quit", (e) => {
  // While it waits to quit, a quit from elsewhere (logging out, shutting down) goes ahead: you already said yes, and there's no window to ask on.
  if (!quitting && !waiting && holdQuit()) {
    e.preventDefault();
    return;
  }
  quitting = true;
  // Windows takes the engine down with the app, mid-save: the app waits for it to finish first.
  if (isWin && !engineGone) {
    e.preventDefault();
    void engine.stop().then(() => {
      engineGone = true;
      app.quit();
    });
    return;
  }
  void engine.stop();
  // A downloaded update goes in as the app quits, so the next launch is the new one.
  // One that doesn't check out is dropped instead, for the engine to say so when the app next opens.
  if (!updating) updating = installUpdate(engine.home, false) === "started";
});
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
/**
  The Dock icon, light or dark as the system is. macOS 26 and later (Darwin 25) do that themselves
  with the icon in Assets.car, so the Dock is left alone there; before that it only knows the .icns,
  which is light, so the app puts the build's own PNG in (the brand PNGs when run from source).
*/
const ownDockIcon = isMac && Number(release().split(".")[0]) < 25;
function setDockIcon() {
  if (!ownDockIcon) return;
  const look = systemPreferences.getUserDefault("AppleInterfaceStyle", "string") === "Dark" ? "dark" : "light";
  const file = app.isPackaged ? join(app.getAppPath(), "icons", `${look}.png`) : join(__dirname, "../..", "docs/brand/icon-2026", `liner-code-icon-${look}.png`);
  if (existsSync(file)) app.dock?.setIcon(nativeImage.createFromPath(file));
}

nativeTheme.on("updated", () => {
  if (win && !mac) win.setBackgroundColor(windowColor());
  setDockIcon();
});

void app.whenReady().then(async () => {
  if (!firstCopy) return;
  loadPrefs();
  // A shell.json from before Glass and Vibrancy went may still name one of them: those are solid now.
  material = materialOf(prefs.material);
  setDockIcon();
  // It follows the system, not the page: a theme picked in the app doesn't move the system's, so its own notice does.
  if (ownDockIcon) systemPreferences.subscribeNotification("AppleInterfaceThemeChangedNotification", setDockIcon);
  guardPermissions();
  buildMenu();
  startMenu();
  createWindow();
  setTimeout(() => oldScripts(tmpdir()), 5000);
  mac?.quietWritingBadge();
  // The page reads your name (liner:boot) as it loads: the dev server's page at once, the engine's
  // only once the engine is up, which waits on it below anyway.
  const whoP = (whoAtLaunch ?? whoami()).then((who) => ((boot.user = who.user), (boot.machine = who.machine), who));

  if (devUrl) {
    boot.token = process.env.LINER_TOKEN || "liner-dev";
    appOrigin = new URL(devUrl).origin;
    await whoP;
    void win?.loadURL(devUrl);
    return;
  }
  // Over the desktop, the ground the page last painted (its tint and blur), so the page takes over without a jump.
  void win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bootPage(mac && seeThrough(material) ? (prefs.ground ?? `${windowColor()}99`) : "transparent"))}`);
  const paths = resources();
  if (!paths) return fail("Liner Code can't find its engine. Reinstall the app.");
  // The keys need Electron (safeStorage), so they're read only now; the shell and whoami have been going since launch.
  const [env, own, who] = await Promise.all([envAtLaunch ?? loginEnvironment(), keys.all().catch(() => ({})), whoP]);
  shellEnv = env;
  engine.onReady = (port) => {
    // A restarted engine keeps its port and token, and the page reconnects by itself; one that
    // couldn't have its port back (something took it) is somewhere else, where the page must go too.
    const origin = `http://127.0.0.1:${port}`;
    if (loaded && origin === appOrigin) return;
    loaded = true;
    if (prefs.port !== port) {
      prefs.port = port;
      savePrefs();
    }
    boot.token = engine.token;
    appOrigin = origin;
    void win?.loadURL(`${appOrigin}/`);
  };
  engine.onFail = (m) => void fail(m);
  engine.port = prefs.port ?? 0;
  // A packaged app says which version it is and where it sits, so the engine can tell whether it can update in place.
  const bundle = bundlePath();
  // A packaged app with no .app to swap (Windows) still says it isn't a copy run from source.
  const self = bundle ? { LINER_APP_VERSION: app.getVersion(), LINER_APP_BUNDLE: bundle } : app.isPackaged ? { LINER_APP_VERSION: app.getVersion(), LINER_APP_PACKAGED: "1" } : {};
  engine.start(paths, { ...env, ...self, LINER_USER_NAME: who.user, LINER_MACHINE: who.machine }, own);
});
