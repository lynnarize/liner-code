/*
  A tool's models as a list to read: by maker, the newest of each family first in the tool's own
  order, and the older versions of a family that has a newer one apart at the end ("Opus 5" under
  "Opus 5.5"). A version never ranks one family against another. A family
  is the name with its version taken out: "Kimi K3.1 Pro" and "Kimi K3" are two families (Pro is
  another line), "GLM 5.3" and "GLM 5.3 Flash" too. A name with no version it can read is a family of
  its own and never older. Pure, so the app and its tests read names the same way.
*/

/** A word that is a version: "5.5", "5", "K3.1", "V4", and one glued to its name ("Qwen3.8"). Never a size ("70B") or a variant ("4o"). */
const VERSION = /^([A-Za-z]*?)(\d+(?:\.\d+)*)$/;

/**
  A model's family and version from its name: the first word that carries a version gives it, and
  the rest of the name (that word's letters kept, so Kimi's K line and DeepSeek's V line stay apart)
  is the family, lower case. Undefined when no word carries one.
    "Opus 5.5"            → opus, [5, 5]
    "Kimi K3.1 Pro"       → kimi k pro, [3, 1]
    "Qwen3.8 Max"         → qwen max, [3, 8]
    "GPT-6.1 Sol"         → gpt sol, [6, 1]
*/
export function versionOf(name: string): { family: string; version: number[] } | undefined {
  // A hyphen between a name and a version reads as a space, as makers write them ("GLM-4.5-Air" is GLM 4.5 Air, "DeepSeek-V3.1" DeepSeek V3.1).
  const spaced = name.replace(/(?<=[A-Za-z])-(?=[A-Za-z]?\d)|(?<=\d)-(?=[A-Za-z])/g, " ");
  const words = spaced.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const m = VERSION.exec(words[i]);
    if (!m) continue;
    const family = [...words.slice(0, i), ...(m[1] ? [m[1]] : []), ...words.slice(i + 1)].join(" ").toLowerCase();
    if (!family) return undefined;
    return { family, version: m[2].split(".").map(Number) };
  }
  return undefined;
}

/** Which of two versions is newer: above 0 when `a` is. "5.5" is newer than "5", "5.10" than "5.9". */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export type Lineup<T> = { maker: string; newest: T[]; older: T[] };

/**
  Models in groups by maker (`makerOf`), the makers in the order the tool first names them and an
  empty maker last. A version only compares models of one family, so across families the tool's
  own order stands (it lists its best first): each group holds the newest of every family first, in
  the order the tool first names the families, then the older versions, their families in that same
  order and each family's newest first. A name with no version is a family of its own. `old` puts a
  model with the older ones whatever its version (a tool's own "legacy" mark).
*/
export function lineupOf<T>(items: T[], nameOf: (t: T) => string, makerOf: (t: T) => string, old: (t: T) => boolean = () => false): Lineup<T>[] {
  const read = items.map((item, at) => {
    const v = versionOf(nameOf(item));
    const maker = makerOf(item);
    // A family's name is only a family within its maker; a name with no version stands alone.
    return { item, at, v, maker, family: v ? `${maker}\u0000${v.family}` : `\u0001${at}` };
  });
  const firstAt = new Map<string, number>();
  const top = new Map<string, number[]>();
  for (const r of read) {
    if (!firstAt.has(r.family)) firstAt.set(r.family, r.at);
    const had = top.get(r.family);
    if (r.v && (!had || compareVersions(r.v.version, had) > 0)) top.set(r.family, r.v.version);
  }
  const isOlder = (r: (typeof read)[number]) => old(r.item) || Boolean(r.v && compareVersions(r.v.version, top.get(r.family)!) < 0);
  // By the family's first place in the tool's list, then newest first inside a family, then the tool's order.
  const order = (a: (typeof read)[number], b: (typeof read)[number]) => firstAt.get(a.family)! - firstAt.get(b.family)! || (a.v && b.v ? compareVersions(b.v.version, a.v.version) : 0) || a.at - b.at;
  const makers = [...new Set(read.map((r) => r.maker))].sort((a, b) => Number(!a) - Number(!b));
  return makers.map((maker) => {
    const mine = read.filter((r) => r.maker === maker).sort(order);
    return { maker, newest: mine.filter((r) => !isOlder(r)).map((r) => r.item), older: mine.filter(isOlder).map((r) => r.item) };
  });
}
