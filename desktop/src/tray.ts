/*
  The menu bar item: what works and what needs you, while the window is shut or behind others.
  A ring when all is quiet, a ring with a gap and a count while agents work, a ring with a dot and
  a count when something needs you. Its menu lists those sessions (pick one to open it) and, under
  a session that waits on a request, Allow, the same as the card in the session. The page sends
  the sessions; the requests are asked of the engine when the menu opens, so they're current.
*/
import { Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions, type NativeImage } from "electron";
import { waitLine, type Left } from "./finish";

type Session = { id: string; title: string };
/** `running`: every session with a turn going, routines' included, which quitting would stop. */
export type TrayStatus = { show: boolean; working: Session[]; needs: (Session & { waiting: boolean })[]; running?: number };
type Ask = { kind: string; id: string; title?: string; state?: string };
type Hooks = { open: (threadId?: string) => void; quit: () => void; quitNow: () => void; rpc: (method: string, params: Record<string, unknown>, ms?: number) => Promise<unknown> };

/**
  A 16-point template image, drawn at 2x: a ring, with a gap or a dot in it. Windows has no
  template images, so there it's white on a dark taskbar and black on a light one.
*/
function glyph(kind: "quiet" | "working" | "needs"): NativeImage {
  const size = 32;
  const c = size / 2;
  const buf = Buffer.alloc(size * size * 4);
  const ink = process.platform === "win32" && nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? 255 : 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      let a = Math.max(0, Math.min(1, 1.6 - Math.abs(d - 10.5)));
      // Working: a gap at the top right, as if the ring turns.
      if (kind === "working" && dx > 0 && dy < 0 && Math.atan2(-dy, dx) > 0.35 && Math.atan2(-dy, dx) < 1.25) a = 0;
      if (kind === "needs") a = Math.max(a, Math.max(0, Math.min(1, 4.5 - d)));
      // Premultiplied: the colour is scaled by how much shows.
      if (ink) buf.fill(Math.round(a * ink), (y * size + x) * 4, (y * size + x) * 4 + 3);
      buf[(y * size + x) * 4 + 3] = Math.round(a * 255);
    }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

export class StatusItem {
  private tray: Tray | null = null;
  private status: TrayStatus = { show: false, working: [], needs: [] };
  private readonly hooks: Hooks;
  private themed = false;
  private glyphs: Record<"quiet" | "working" | "needs", NativeImage> | null = null;
  /**
    While the app waits to quit (Quit when they finish), what it waits for, as the engine says it.
    The item shows then even with "Show them in the menu bar" off: it's the only sign the app is
    still there. The page's own status is kept underneath, and comes back as it was after.
  */
  private held: Left | null = null;

  constructor(hooks: Hooks) {
    this.hooks = hooks;
  }

  /** The app waits to quit for these (null: it doesn't any more). */
  hold(left: Left | null) {
    this.held = left;
    this.set(this.status);
  }

  /** What the item shows: the sessions the quit waits for while it waits, the page's word otherwise. */
  private view() {
    if (!this.held) return this.status;
    return { working: this.held.working, needs: this.held.waiting.map((w) => ({ ...w, waiting: true })) };
  }

  set(s: TrayStatus) {
    this.status = s;
    if (!s.show && !this.held) {
      this.tray?.destroy();
      this.tray = null;
      return;
    }
    // Drawn once the app is up (on Windows in the taskbar's colours, again when they change).
    const draw = () => (this.glyphs = { quiet: glyph("quiet"), working: glyph("working"), needs: glyph("needs") });
    const glyphs = this.glyphs ?? draw();
    if (!this.tray) {
      this.tray = new Tray(glyphs.quiet);
      this.tray.setToolTip("Liner Code");
      if (process.platform === "win32" && !this.themed) {
        this.themed = true;
        nativeTheme.on("updated", () => {
          draw();
          if (this.tray) this.set(this.status);
        });
      }
      this.tray.on("click", () => void this.pop());
      this.tray.on("right-click", () => void this.pop());
    }
    const { working, needs } = this.view();
    const kind = needs.length ? "needs" : working.length ? "working" : "quiet";
    this.tray.setImage(glyphs[kind]);
    this.tray.setTitle(kind === "needs" ? String(needs.length) : kind === "working" ? String(working.length) : "", { fontType: "monospacedDigit" });
    // Windows shows no title beside the icon: the counts go in its tooltip.
    if (process.platform === "win32") this.tray.setToolTip(["Liner Code", this.held && waitLine(this.held), working.length && `${working.length} working`, needs.length && `${needs.length} ${needs.length === 1 ? "needs" : "need"} you`].filter(Boolean).join(" · "));
  }

  /** How many sessions have a turn going, as the page last said: quitting asks first while any do. */
  running() {
    return this.status.running ?? this.status.working.length;
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }

  private async pop() {
    const { working, needs } = this.view();
    const held = this.held;
    // The requests waiting in sessions that wait on you, as they are now: asked for under a second,
    // so a busy engine doesn't keep the menu from opening (one that didn't answer shows no Allow).
    const asks = new Map<string, Ask[]>();
    await Promise.all(
      needs
        .filter((n) => n.waiting)
        .slice(0, 8)
        .map(async (n) => {
          const items = (await this.hooks.rpc("thread.items", { id: n.id }, 800).catch(() => [])) as Ask[];
          asks.set(n.id, items.filter((i) => i.kind === "approval" && i.state === "asking"));
        }),
    );
    const short = (s: string) => (s.length > 48 ? `${s.slice(0, 47)}…` : s);
    const head = [working.length && `${working.length} working`, needs.length && `${needs.length} ${needs.length === 1 ? "needs" : "need"} you`].filter(Boolean).join(" · ") || "Nothing working";
    const items: MenuItemConstructorOptions[] = held ? [{ label: waitLine(held), enabled: false }, ...(working.length || needs.length ? [{ label: head, enabled: false }] : [])] : [{ label: head, enabled: false }];
    if (needs.length) {
      items.push({ type: "separator" }, { label: "Needs you", enabled: false });
      for (const n of needs.slice(0, 10)) {
        items.push({ label: short(n.title), click: () => this.hooks.open(n.id) });
        for (const a of asks.get(n.id) ?? [])
          items.push({
            label: `    Allow: ${short(a.title ?? "the request")}`,
            click: () => void this.hooks.rpc("approval.answer", { threadId: n.id, itemId: a.id, allow: true }).catch(() => this.hooks.open(n.id)),
          });
      }
    }
    if (working.length) {
      items.push({ type: "separator" }, { label: "Working", enabled: false });
      for (const w of working.slice(0, 10)) items.push({ label: short(w.title), click: () => this.hooks.open(w.id) });
    }
    // While it waits to quit, Open Liner Code calls that off (main.ts, show), and Quit now doesn't ask again.
    items.push({ type: "separator" }, { label: "Open Liner Code", click: () => this.hooks.open() }, held ? { label: "Quit Now", click: () => this.hooks.quitNow() } : { label: "Quit Liner Code", click: () => this.hooks.quit() });
    this.tray?.popUpContextMenu(Menu.buildFromTemplate(items));
  }
}
