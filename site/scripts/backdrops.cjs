// The stages' soft out-of-focus fields, drawn rather than photographed: a few large blurred lights over
// a base, with fine grain. Five families (sky, chart, steel, sand, mist), each in a light and a dark look.
// The dark ones are the same families at night: deep and quiet, never black.
// Run from site-zero: node scripts/backdrops.cjs   (writes public/stage/<name>-<look>.webp)
const path = require('node:path');
const sharp = require('sharp');
const out = path.join(__dirname, '..', 'public', 'stage') + '/';
const W = 800, H = 500, FW = 1600, FH = 1000;
const light = {
  sky: { base: [[0, '#b7c5d6'], [0.55, '#d6dfe9'], [1, '#edf0f4']], x2: 0.15, blobs: [{ x: 0.78, y: 0.16, rx: 0.42, ry: 0.36, c: '#ffffff', o: 0.95 }, { x: 0.16, y: 0.28, rx: 0.42, ry: 0.5, c: '#8ea4be', o: 0.85 }, { x: 0.55, y: 0.98, rx: 0.6, ry: 0.3, c: '#f4e4d2', o: 0.85 }, { x: 0.02, y: 0.98, rx: 0.35, ry: 0.3, c: '#a3b5cb', o: 0.7 }] },
  chart: { base: [[0, '#f0dea6'], [0.5, '#c8ddb0'], [1, '#c4e2ec']], x2: 0.3, blobs: [{ x: 0.18, y: 0.12, rx: 0.5, ry: 0.36, c: '#f2d583', o: 0.9 }, { x: 0.78, y: 0.5, rx: 0.45, ry: 0.3, c: '#a9cf93', o: 0.9 }, { x: 0.28, y: 0.92, rx: 0.6, ry: 0.36, c: '#aed8e8', o: 0.95 }, { x: 0.92, y: 0.08, rx: 0.3, ry: 0.3, c: '#fdf6dc', o: 0.85 }] },
  steel: { base: [[0, '#c7d4d2'], [0.6, '#dbe3e1'], [1, '#edf0ee']], x2: 0.1, blobs: [{ x: 0.14, y: 0.24, rx: 0.45, ry: 0.5, c: '#8fa9a8', o: 0.8 }, { x: 0.8, y: 0.18, rx: 0.36, ry: 0.32, c: '#ffffff', o: 0.9 }, { x: 0.88, y: 0.88, rx: 0.4, ry: 0.36, c: '#f0c88f', o: 0.6 }, { x: 0.42, y: 1.02, rx: 0.5, ry: 0.3, c: '#b3c5c3', o: 0.7 }] },
  sand: { base: [[0, '#e2d9ce'], [0.6, '#ebe4db'], [1, '#f3efe9']], x2: 0.2, blobs: [{ x: 0.18, y: 0.18, rx: 0.46, ry: 0.42, c: '#ebc7b2', o: 0.8 }, { x: 0.82, y: 0.28, rx: 0.4, ry: 0.4, c: '#ffffff', o: 0.85 }, { x: 0.62, y: 0.98, rx: 0.5, ry: 0.36, c: '#c2c8d3', o: 0.75 }] },
  mist: { base: [[0, '#dbe2ea'], [1, '#f0f2f5']], x2: 0.2, blobs: [{ x: 0.72, y: 0.18, rx: 0.5, ry: 0.42, c: '#ffffff', o: 0.95 }, { x: 0.12, y: 0.82, rx: 0.46, ry: 0.42, c: '#c3cfdd', o: 0.75 }] },
};
// The same lights, lowered: the bright patch becomes a lifted slate, the colours keep their hue.
const dark = {
  sky: { base: [[0, '#151d2b'], [0.55, '#1b2433'], [1, '#222a37']], x2: 0.15, blobs: [{ x: 0.78, y: 0.16, rx: 0.42, ry: 0.36, c: '#3b4a61', o: 0.9 }, { x: 0.16, y: 0.28, rx: 0.42, ry: 0.5, c: '#1f3150', o: 0.85 }, { x: 0.55, y: 0.98, rx: 0.6, ry: 0.3, c: '#3a3027', o: 0.8 }, { x: 0.02, y: 0.98, rx: 0.35, ry: 0.3, c: '#233149', o: 0.7 }] },
  chart: { base: [[0, '#2a2716'], [0.5, '#1e2a1d'], [1, '#172a31']], x2: 0.3, blobs: [{ x: 0.18, y: 0.12, rx: 0.5, ry: 0.36, c: '#4d4120', o: 0.85 }, { x: 0.78, y: 0.5, rx: 0.45, ry: 0.3, c: '#2b4429', o: 0.85 }, { x: 0.28, y: 0.92, rx: 0.6, ry: 0.36, c: '#1d4150', o: 0.9 }, { x: 0.92, y: 0.08, rx: 0.3, ry: 0.3, c: '#4a4632', o: 0.75 }] },
  steel: { base: [[0, '#16201f'], [0.6, '#1c2524'], [1, '#222a29']], x2: 0.1, blobs: [{ x: 0.14, y: 0.24, rx: 0.45, ry: 0.5, c: '#24403f', o: 0.8 }, { x: 0.8, y: 0.18, rx: 0.36, ry: 0.32, c: '#3a4746', o: 0.85 }, { x: 0.88, y: 0.88, rx: 0.4, ry: 0.36, c: '#4a3a24', o: 0.55 }, { x: 0.42, y: 1.02, rx: 0.5, ry: 0.3, c: '#2a3837', o: 0.7 }] },
  sand: { base: [[0, '#241f1a'], [0.6, '#29241f'], [1, '#2e2a25']], x2: 0.2, blobs: [{ x: 0.18, y: 0.18, rx: 0.46, ry: 0.42, c: '#4a3428', o: 0.8 }, { x: 0.82, y: 0.28, rx: 0.4, ry: 0.4, c: '#403b35', o: 0.8 }, { x: 0.62, y: 0.98, rx: 0.5, ry: 0.36, c: '#272c37', o: 0.75 }] },
  mist: { base: [[0, '#1a1f27'], [1, '#22272f']], x2: 0.2, blobs: [{ x: 0.72, y: 0.18, rx: 0.5, ry: 0.42, c: '#363e4a', o: 0.9 }, { x: 0.12, y: 0.82, rx: 0.46, ry: 0.42, c: '#1e2838', o: 0.75 }] },
};
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${s.blobs.map((b, i) => `<radialGradient id="g${i}"><stop offset="0" stop-color="${b.c}" stop-opacity="${b.o}"/><stop offset="1" stop-color="${b.c}" stop-opacity="0"/></radialGradient>`).join('')}<linearGradient id="base" x1="0" y1="0" x2="${s.x2}" y2="1">${s.base.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient></defs><rect width="100%" height="100%" fill="url(#base)"/>${s.blobs.map((b, i) => `<ellipse cx="${b.x * W}" cy="${b.y * H}" rx="${b.rx * W}" ry="${b.ry * H}" fill="url(#g${i})"/>`).join('')}</svg>`;
(async () => {
  const grainOf = async (alpha) => {
    const n = Buffer.alloc(FW * FH * 4);
    for (let i = 0; i < FW * FH; i++) { const v = Math.max(0, Math.min(255, 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 150)); n[i * 4] = n[i * 4 + 1] = n[i * 4 + 2] = v; n[i * 4 + 3] = alpha; }
    return sharp(n, { raw: { width: FW, height: FH, channels: 4 } }).png().toBuffer();
  };
  // Grain shows more on a dark field, so it is lighter there.
  const grain = { light: await grainOf(30), dark: await grainOf(18) };
  for (const [look, sets] of Object.entries({ light, dark })) {
    for (const [name, s] of Object.entries(sets)) {
      const soft = await sharp(Buffer.from(svg(s))).blur(26).resize(FW, FH, { kernel: 'cubic' }).toBuffer();
      const file = `${out}${name}-${look}.webp`;
      const i = await sharp(soft).composite([{ input: grain[look], blend: 'overlay' }]).webp({ quality: 72 }).toFile(file);
      console.log(name, look, Math.round(i.size / 1024) + 'KB');
    }
  }
})();
