/*
  Addresses in one plain form, and whether one is this computer's own or a private network's, however it's written. Shared
  by AI pictures (a picture's link, pictures.ts) and Tell an app (the webhook, mcp-webhook.ts), so both refuse the same.
*/
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
  An address in one plain form: IPv4 dotted decimal (from decimal, octal, hex or short forms, and
  from IPv6 that maps or embeds one: ::ffff:7f00:1, ::ffff:127.0.0.1, ::127.0.0.1), IPv6 as eight
  full groups; a name as it is, lower case. Brackets come off.
*/
export function normalIp(host: string): string {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = ipv4(h);
  if (v4) return v4;
  if (!h.includes(":")) return h;
  const groups = ipv6(h);
  if (!groups) return h;
  // Mapped (::ffff:a.b.c.d) or compatible (::a.b.c.d, not :: or ::1): the IPv4 inside.
  const zero5 = groups.slice(0, 5).every((g) => g === 0);
  if (zero5 && (groups[5] === 0xffff || (groups[5] === 0 && (groups[6] !== 0 || groups[7] > 1)))) return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  return groups.map((g) => g.toString(16)).join(":");
}

/** IPv4 as a browser reads it: 1 to 4 parts, each decimal, 0x hex or 0 octal, the last filling what's left. */
function ipv4(h: string): string | null {
  const parts = h.split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => !/^(?:0x[0-9a-f]*|0[0-7]*|[1-9]\d*)$/.test(p))) return null;
  const nums = parts.map((p) => (/^0x/.test(p) ? parseInt(p.slice(2) || "0", 16) : /^0\d/.test(p) ? parseInt(p, 8) : Number(p)));
  const last = nums.pop()!;
  if (nums.some((n) => n > 255) || last >= 256 ** (4 - nums.length)) return null;
  let v = last;
  nums.forEach((n, i) => (v += n * 256 ** (3 - i)));
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
}

/** IPv6 as eight numbers, :: and a dotted IPv4 tail allowed; null when it isn't one. */
function ipv6(h: string): number[] | null {
  let tail: number[] = [];
  let s = h;
  const dotted = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const v4 = ipv4(dotted[1]);
    if (!v4) return null;
    const b = v4.split(".").map(Number);
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    s = s.slice(0, s.length - dotted[1].length);
    if (!s.endsWith("::")) s = s.replace(/:$/, "");
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (x: string) => (x ? x.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - tail.length - head.length - rest.length;
  if ([...head, ...rest].some(Number.isNaN) || (halves.length === 1 ? fill !== 0 : fill < 0)) return null;
  return [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...rest, ...tail];
}

/** This Mac: localhost, 127/8, ::1, in whatever form the address is written. */
export const LOOPBACK = (host: string) => {
  const ip = normalIp(host);
  return ip === "localhost" || /^127\./.test(ip) || ip === "0:0:0:0:0:0:0:1";
};
/** An address of a private network (or this Mac's own link), in any form: a picture's link or a webhook may not lead there. */
export function privateIp(addr: string) {
  const ip = normalIp(addr);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 0 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!ip.includes(":")) return false;
  const first = parseInt(ip.split(":")[0], 16);
  return ip === "0:0:0:0:0:0:0:1" || ip === "0:0:0:0:0:0:0:0" || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** The addresses a host leads to: itself when it's written as one, else what its name looks up to now (none when it doesn't). */
export async function addressesOf(host: string): Promise<string[]> {
  const h = normalIp(host);
  if (isIP(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return [h];
  return (await lookup(h, { all: true }).catch(() => [])).map((a) => a.address);
}
