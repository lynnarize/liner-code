/*
  The native side. In the Electron shell (desktop/), calls go through window.linerShell, which
  its preload puts on the page; in the older Swift shell (mac/), through a WebKit message handler,
  coming back through window.__linerReply. In a plain browser (dev, or before a shell) each call
  falls back to what the web can do, or does nothing.
*/
type Handler = { postMessage(m: unknown): void };
type Shell = { platform: string; call(method: string, params?: Record<string, unknown>): Promise<unknown>; onCommand(fn: (name: string) => void): void };
declare global {
  interface Window {
    linerShell?: Shell;
    webkit?: { messageHandlers?: { liner?: Handler } };
    __linerReply?: (id: number, ok: boolean, value: unknown) => void;
  }
}

const shell = () => window.linerShell;
const webkit = () => window.webkit?.messageHandlers?.liner;
export const isNative = () => Boolean(shell() || webkit());

let seq = 1;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
window.__linerReply = (id, ok, value) => {
  const w = waiting.get(id);
  if (!w) return;
  waiting.delete(id);
  if (ok) w.resolve(value);
  else w.reject(new Error(String(value)));
};

function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const s = shell();
  if (s) return s.call(method, params) as Promise<T>;
  const h = webkit();
  if (!h) return Promise.reject(new Error("not native"));
  const id = seq++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    h.postMessage({ id, method, params });
  });
}

export const bridge = {
  /** A folder picked in the system's open panel. */
  async pickFolder(): Promise<string | null> {
    if (isNative()) return call<string | null>("pickFolder");
    const p = window.prompt("The folder's full path");
    return p?.trim() || null;
  },
  notify(title: string, body: string, threadId?: string) {
    if (isNative()) return void call("notify", { title, body, threadId }).catch(() => {});
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(title, { body });
  },
  badge(count: number) {
    if (isNative()) void call("badge", { count }).catch(() => {});
  },
  /** The menu bar item: the sessions that work and the ones that need you. */
  status(s: { show: boolean; working: { id: string; title: string }[]; needs: { id: string; title: string; waiting: boolean }[] }) {
    if (isNative()) void call("status", s).catch(() => {});
  },
  reveal(path: string) {
    if (isNative()) void call("reveal", { path }).catch(() => {});
  },
  /** Opens the folder in an editor, a terminal or Finder. */
  openIn(path: string, app: "finder" | "terminal" | "editor") {
    if (isNative()) void call("openIn", { path, app }).catch(() => {});
  },
  /** Runs a sign-in command in Terminal, where the tool can ask for what it needs. */
  runInTerminal(command: string) {
    if (isNative()) return void call("runInTerminal", { command }).catch(() => {});
    void navigator.clipboard?.writeText(command);
  },
  /** The menu bar's shortcuts, by command ("" takes one away), so they match yours. */
  setMenuKeys(keys: Record<string, string>) {
    if (isNative()) void call("setMenuKeys", { keys }).catch(() => {});
  },
  /** A part of the window, as a PNG in base64 (the rect in page pixels). */
  snapshot(rect: { x: number; y: number; width: number; height: number }): Promise<string> {
    return call<string>("snapshot", rect);
  },
  openExternal(url: string) {
    if (isNative()) return void call("openExternal", { url }).catch(() => {});
    window.open(url, "_blank", "noopener");
  },
  /** Keeps a key in the keychain; the engine gets it in memory only. */
  async keychainSet(account: string, key: string | null) {
    if (isNative()) await call("keychainSet", { account, key });
  },
  /** The window's material behind the sidebar: Liquid Glass, vibrancy, or solid. */
  setMaterial(material: "glass" | "vibrancy" | "solid") {
    if (isNative()) void call("setMaterial", { material }).catch(() => {});
  },
  /** Where the sidebar column is, so a live material shows the desktop there and nowhere else. */
  setGlassRect(rect: { x: number; y: number; width: number; height: number; hole?: { x: number; y: number; width: number; height: number; radius: number } }) {
    if (isNative()) void call("setGlassRect", rect).catch(() => {});
  },
  setAppearance(theme: "light" | "dark" | "system") {
    if (isNative()) void call("setAppearance", { theme }).catch(() => {});
  },
  haptic() {
    if (isNative()) void call("haptic").catch(() => {});
  },
  /** Quits and opens the downloaded update in this app's place. */
  installUpdate(): Promise<void> {
    return call<void>("installUpdate");
  },
};

// Electron's preload hands menu commands over; they go out as the same events the Swift shell sent.
window.linerShell?.onCommand((name) => window.dispatchEvent(new CustomEvent("liner:command", { detail: name })));

/** Menu-bar commands from the shell, like ⌘N or ⌘K, arrive as liner:command events. */
export function onCommand(fn: (name: string) => void) {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener("liner:command", h);
  return () => window.removeEventListener("liner:command", h);
}

/**
  The window moves by its top bar. WebKit has no drag regions, so a press on an empty part of
  an element marked data-drag asks the shell to drag the window; a double press zooms it.
  Electron has drag regions: app.css marks the same elements, and macOS does the rest.
*/
export function enableWindowDrag() {
  if (!webkit()) return;
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (!t?.hasAttribute("data-drag")) return;
    if (e.detail === 2) void call("zoomWindow").catch(() => {});
    else void call("dragWindow").catch(() => {});
  };
  window.addEventListener("mousedown", onDown);
}

/**
  Fields here talk to agents, so the system's writing suggestions stay out of them: every text
  field gets writingsuggestions="false" the moment it takes focus (the shell turns Writing Tools off).
*/
export function quietFields() {
  window.addEventListener(
    "focusin",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT") && !t.hasAttribute("writingsuggestions")) t.setAttribute("writingsuggestions", "false");
    },
    true,
  );
}

/**
  In the app, a right-click on the page's chrome opens nothing: no browser menu over buttons,
  cards or the routine canvas. Text you selected and fields you type in keep Copy and Paste,
  and anything with a menu of its own (a session row) has already handled the click.
*/
/**
  The window is one glass frame: the sidebar and the gaps around the paper. The shell keeps
  Vibrancy or Liquid Glass behind the frame alone, with the paper (the session, or Settings' own)
  cut out of it, so nothing is blurred where the paper covers it. It follows the paper as the
  sidebar opens, closes and changes: watched by size, and by which paper is there, never by every change.
*/
export function trackFrameGlass() {
  if (!isNative()) return;
  let last = "";
  let raf = 0;
  let seen: Element | null = null;
  const send = () => {
    const app = document.querySelector(".lc-app");
    const paper = app?.querySelector<HTMLElement>(":scope > .lc-paper") ?? null;
    if (paper !== seen) {
      if (seen) ro.unobserve(seen);
      if (paper) ro.observe(paper);
      seen = paper;
    }
    const r = paper?.getBoundingClientRect();
    const hole = r && paper ? { x: r.left, y: r.top, width: r.width, height: r.height, radius: parseFloat(getComputedStyle(paper).borderTopLeftRadius) || 0 } : undefined;
    const rect = app ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, hole } : { x: 0, y: 0, width: 0, height: 0 };
    const key = JSON.stringify(rect);
    if (key === last) return;
    last = key;
    bridge.setGlassRect(rect);
  };
  const soon = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(send);
  };
  const ro = new ResizeObserver(soon);
  // The app mounts after this runs, and Settings swaps the paper: watch the root's children only.
  const mo = new MutationObserver(soon);
  const watch = () => {
    const app = document.querySelector(".lc-app");
    if (!app) return void requestAnimationFrame(watch);
    mo.observe(app, { childList: true });
    soon();
  };
  watch();
  window.addEventListener("resize", soon);
}

export function quietMenus() {
  if (!isNative()) return;
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    const editable = t?.closest("input, textarea, [contenteditable=''], [contenteditable='true']");
    const selected = (window.getSelection()?.toString() ?? "").trim().length > 0;
    if (!editable && !selected) e.preventDefault();
  });
}
