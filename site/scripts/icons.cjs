// The PNG icons (favicon-32.png, apple-touch-icon.png) drawn from the mark, in its light look.
// Run from site-zero: node scripts/icons.cjs. The mark itself lives in src/components/Mark.astro.
const path = require('node:path');
const sharp = require('sharp');
const pub = path.join(__dirname, '..', 'public');
const tile = (size, rx) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="${rx}" fill="#F5F6F8"/><g transform="translate(4 4)" fill="none" stroke-width="3.4" stroke-linecap="round"><path stroke="#0D0F12" d="M5.2 19.6 10.6 4.4"/><path stroke="#2A6FE8" d="M13.4 19.6 18.8 4.4"/></g></svg>`;
(async () => {
  await sharp(Buffer.from(tile(32, 7.5))).png().toFile(path.join(pub, 'favicon-32.png'));
  // Apple rounds the touch icon itself, so it is a full square.
  await sharp(Buffer.from(tile(180, 0))).flatten({ background: '#F5F6F8' }).png().toFile(path.join(pub, 'apple-touch-icon.png'));
  console.log('icons written');
})();
