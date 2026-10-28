/** Hex, RGB and HSV conversions for the color picker. */
export type Hsv = { h: number; s: number; v: number; a: number };

export function hexToHsv(hex: string): Hsv | null {
  let x = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3,4}$/i.test(x)) x = [...x].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(x)) return null;
  const n = parseInt(x.slice(0, 6), 16);
  const a = x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1;
  return { ...rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255), a };
}

export function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1)] as const;
}

export function hsvToHex(c: Hsv, alpha = false) {
  const hex = hsvToRgb(c)
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}${alpha && c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, "0") : ""}`.toUpperCase();
}

/** Ink that reads on top of a color. */
export const readableOn = (c: Hsv) => {
  const [r, g, b] = hsvToRgb(c).map((n) => {
    const x = n / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#000" : "#fff";
};
