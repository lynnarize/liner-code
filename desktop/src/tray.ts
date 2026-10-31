/*
  The menu bar item: what works and what needs you, while the window is shut or behind others.
  A ring when all is quiet, a ring with a gap and a count while agents work, a ring with a dot and
  a count when something needs you. Its menu lists those sessions (pick one to open it) and, under
  a session that waits on a request, Allow, the same as the card in the session. The page sends
  the sessions; the requests are asked of the engine when the menu opens, so they're current.
*/
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from "electron";

type Session = { id: string; title: string };
/** `running`: every session with a turn going, routines' included, which quitting would stop. */
export type TrayStatus = { show: boolean; working: Session[]; needs: (Session & { waiting: boolean })[]; running?: number };
type Ask = { kind: string; id: string; title?: string; state?: string };
type Hooks = { open: (threadId?: string) => void; quit: () => void; rpc: (method: string, params: Record<string, unknown>) => Promise<unknown> };

/** A 16-point template image, drawn at 2x: a ring, with a gap or a dot in it. */
function glyph(kind: "quiet" | "working" | "needs"): NativeImage {
  const size = 32;
  const c = size / 2;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      let a = Math.max(0, Math.min(1, 1.6 - Math.abs(d - 10.5)));
      // Working: a gap at the top right, as if the ring turns.
      if (kind === "working" && dx > 0 && dy < 0 && Math.atan2(-dy, dx) > 0.35 && Math.atan2(-dy, dx) < 1.25) a = 0;
      if (kind === "needs") a = Math.max(a, Math.max(0, Math.min(1, 4.5 - d)));
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
  private readonly glyphs = { quiet: glyph("quiet"), working: glyph("working"), needs: glyph("needs") };

  constructor(hooks: Hooks) {
    this.hooks = hooks;
  }

  set(s: TrayStatus) {
    this.status = s;
    if (!s.show) {
      this.tray?.destroy();
      this.tray = null;
      return;
    }
    if (!this.tray) {
      this.tray = new Tray(this.glyphs.quiet);
      this.tray.setToolTip("Liner Code");
      this.tray.on("click", () => void this.pop());
      this.tray.on("right-click", () => void this.pop());
    }
    const kind = s.needs.length ? "needs" : s.working.length ? "working" : "quiet";
    this.tray.setImage(this.glyphs[kind]);
    this.tray.setTitle(kind === "needs" ? String(s.needs.length) : kind === "working" ? String(s.working.length) : "", { fontType: "monospacedDigit" });
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
    const { working, needs } = this.status;
    // The requests waiting in sessions that wait on you, as they are now.
    const asks = new Map<string, Ask[]>();
    await Promise.all(
      needs
        .filter((n) => n.waiting)
        .slice(0, 8)
        .map(async (n) => {
          const items = (await this.hooks.rpc("thread.items", { id: n.id }).catch(() => [])) as Ask[];
          asks.set(n.id, items.filter((i) => i.kind === "approval" && i.state === "asking"));
        }),
    );
    const short = (s: string) => (s.length > 48 ? `${s.slice(0, 47)}…` : s);
    const head = [working.length && `${working.length} working`, needs.length && `${needs.length} ${needs.length === 1 ? "needs" : "need"} you`].filter(Boolean).join(" · ") || "Nothing working";
    const items: MenuItemConstructorOptions[] = [{ label: head, enabled: false }];
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
    items.push({ type: "separator" }, { label: "Open Liner Code", click: () => this.hooks.open() }, { label: "Quit Liner Code", click: () => this.hooks.quit() });
    this.tray?.popUpContextMenu(Menu.buildFromTemplate(items));
  }
}
