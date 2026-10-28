/** Squarified treemap layout: rows of tiles kept as close to square as the values allow. */
export type Box = { x: number; y: number; w: number; h: number };

export function squarify<T extends { value: number }>(items: T[], box: Box): (T & Box)[] {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total || box.w <= 0 || box.h <= 0) return [];
  const k = (box.w * box.h) / total;
  let rest = [...items].sort((a, b) => b.value - a.value).map((it) => ({ it, a: it.value * k }));
  let { x, y, w, h } = box;
  const out: (T & Box)[] = [];
  const worst = (row: { a: number }[], side: number) => {
    const s = row.reduce((t, r) => t + r.a, 0);
    const mx = Math.max(...row.map((r) => r.a));
    const mn = Math.min(...row.map((r) => r.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    const thick = row.reduce((t, r) => t + r.a, 0) / side;
    let off = 0;
    for (const r of row) {
      const len = r.a / thick;
      out.push(w >= h ? { ...r.it, x, y: y + off, w: thick, h: len } : { ...r.it, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
    rest = rest.slice(i);
  }
  return out;
}
