/*
  Pictures for behind the session. The landscapes macOS keeps in its Desktop Pictures (their
  small local copies; the full ones download on demand, and a blurred background needs little
  detail), and one image of your own. Chromium can't show HEIC, so each is made a JPEG once with
  `sips` and kept under <home>/backgrounds. A dynamic wallpaper's small copy shows day and night
  split down a diagonal, so its Light or Dark copy is used instead, matching the app's theme.
*/
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { run } from "./exec.ts";

const APPLE = "/System/Library/Desktop Pictures";
// Photographs only: the graphic, colour and gradient ones would fight the work on top.
const PHOTOS = /^(Big Sur|Catalina|Sonoma|Peak|The Beach|The Cliffs|The Desert|The Lake|Tree|Valley)\b(?!.*\b(Graphic|Light|Dark)\b)/;

export type Picture = { id: string; name: string };

export class Backgrounds {
  private dir: string;
  constructor(home: string) {
    this.dir = join(home, "backgrounds");
  }

  list(): { pictures: Picture[]; own: boolean } {
    let names: string[] = [];
    try {
      names = readdirSync(join(APPLE, ".thumbnails"))
        .filter((f) => f.endsWith(".heic"))
        .map((f) => f.slice(0, -5))
        .filter((n) => PHOTOS.test(n))
        .sort();
    } catch {
      // not macOS, or the folder moved: your own image still works
    }
    return { pictures: names.map((name) => ({ id: `apple:${name}`, name })), own: existsSync(this.file("own")) };
  }

  /** The picture as a JPEG, or null when there isn't one; `dark` picks a dynamic one's night side. */
  async image(id: string, dark = false): Promise<{ data: string; type: string } | null> {
    if (id === "own") return existsSync(this.file("own")) ? { data: readFileSync(this.file("own")).toString("base64"), type: "image/jpeg" } : null;
    const name = id.startsWith("apple:") ? id.slice(6) : "";
    if (!this.list().pictures.some((p) => p.name === name)) return null;
    // The full picture when macOS keeps it here; otherwise the small copy of the side that fits the theme.
    const full = join(APPLE, `${name}.heic`);
    const side = join(APPLE, ".thumbnails", `${name} ${dark ? "Dark" : "Light"}.heic`);
    const from = existsSync(full) ? full : existsSync(side) ? side : join(APPLE, ".thumbnails", `${name}.heic`);
    const out = this.file(`apple-${name.replace(/[^\w-]+/g, "-")}${from === side ? (dark ? "-dark" : "-light") : ""}`);
    if (!existsSync(out)) await this.convert(from, out, 2400);
    return { data: readFileSync(out).toString("base64"), type: "image/jpeg" };
  }

  /** Your own image, from base64; anything `sips` reads (JPEG, PNG, HEIC, TIFF, GIF). */
  async save(data: string, name: string) {
    mkdirSync(this.dir, { recursive: true });
    const tmp = join(this.dir, `incoming${extname(name).toLowerCase().replace(/[^.\w]/g, "") || ".img"}`);
    writeFileSync(tmp, Buffer.from(data, "base64"));
    try {
      await this.convert(tmp, this.file("own"), 2600);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  remove() {
    rmSync(this.file("own"), { force: true });
  }

  private file(id: string) {
    return join(this.dir, `${id}.jpg`);
  }

  /** To a JPEG, made smaller when it's bigger than `max` on its long side (never larger). */
  private async convert(from: string, to: string, max: number) {
    mkdirSync(this.dir, { recursive: true });
    // Windows has no sips: PowerShell's System.Drawing does the same (no HEIC), the paths passed in its environment.
    if (process.platform === "win32") {
      const ps = `Add-Type -AssemblyName System.Drawing; $s = [Drawing.Image]::FromFile($env:LINER_FROM); $k = [Math]::Min(1, ${max} / [Math]::Max($s.Width, $s.Height)); $b = New-Object Drawing.Bitmap ([int]($s.Width * $k)), ([int]($s.Height * $k)); $g = [Drawing.Graphics]::FromImage($b); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($s, 0, 0, $b.Width, $b.Height); $c = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }; $p = New-Object Drawing.Imaging.EncoderParameters 1; $p.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 84L; $b.Save($env:LINER_TO, $c, $p); $s.Dispose()`;
      const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, LINER_FROM: from, LINER_TO: to }, timeout: 30000 });
      if (r.code !== 0 || !existsSync(to)) throw new Error("Liner Code couldn't read that picture. Try a JPEG or PNG.");
      return;
    }
    const size = await run("sips",["-g", "pixelWidth", "-g", "pixelHeight", from], { timeout: 15000 });
    const long = Math.max(...[...size.stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1])), 0);
    const r = await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "84", ...(long > max ? ["-Z", String(max)] : []), from, "--out", to], { timeout: 30000 });
    if (r.code !== 0 || !existsSync(to)) throw new Error("Liner Code couldn't read that picture. Try a JPEG, PNG or HEIC.");
  }
}
