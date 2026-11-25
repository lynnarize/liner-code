// The release files are named with the version (Liner-Code-0.3.1-mac-arm64.dmg), so
// /releases/latest/download/<name> only works until the next release, when the name changes.
// The page asks GitHub which files the latest release actually carries, and a link it cannot
// trust goes to the releases page instead. There is no Intel Mac build and no Windows on ARM build.

export const RELEASE_API = 'https://api.github.com/repos/lynnarize/liner-code/releases/latest';

const MAC_DMG = /^Liner-Code-(\d+\.\d+\.\d+)-mac-arm64\.dmg$/;
const WIN_SETUP = /^Liner-Code-(\d+\.\d+\.\d+)-win-x64-setup\.exe$/;

export type Os = 'mac' | 'win' | 'other';
export type Arch = 'arm' | 'x64' | 'unknown';

export type ReleaseAsset = { name?: string; browser_download_url?: string };
export type ReleasePayload = { tag_name?: string; assets?: ReleaseAsset[] };

export type LatestDownloads = { version?: string; mac?: string; win?: string };

export type DownloadPlan = {
  macHref: string;
  winHref: string;
  primary: 'mac' | 'win';
  note?: string;
  macLabel?: string;
  winLabel?: string;
};

const MAC_NOTE = 'There is no Intel Mac build of this beta. The releases page has every file.';
const WIN_NOTE = 'There is no Windows on ARM build of this beta. The releases page has every file.';

/** A github.com download URL whose path is this asset and nothing else. */
function safeUrl(name: string, version: string, url: string | undefined): string | undefined {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return;
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return;
  }
  if (path !== `/lynnarize/liner-code/releases/download/v${version}/${name}`) return;
  return `https://github.com/lynnarize/liner-code/releases/download/v${version}/${name}`;
}

function pick(assets: ReleaseAsset[], pattern: RegExp): { version: string; url: string } | undefined {
  for (const asset of assets) {
    const name = asset.name ?? '';
    const version = pattern.exec(name)?.[1];
    if (!version) continue;
    const url = safeUrl(name, version, asset.browser_download_url);
    if (url) return { version, url };
  }
  return;
}

/** The Apple silicon dmg and the Windows x64 setup from a GitHub release, or nothing for a file we don't trust. */
export function downloadsFromRelease(release: ReleasePayload | null | undefined): LatestDownloads {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const mac = pick(assets, MAC_DMG);
  const win = pick(assets, WIN_SETUP);
  const out: LatestDownloads = {};
  const version = mac?.version ?? win?.version;
  if (version) out.version = version;
  if (mac) out.mac = mac.url;
  if (win) out.win = win.url;
  return out;
}

export function hrefFor(direct: string | undefined, releases: string): string {
  return direct || releases;
}

/**
 * Which button goes where. An Intel Mac and Windows on ARM have no build, so that button
 * opens the releases page and says so. An unknown Mac is treated as Apple silicon, an unknown
 * Windows as x64: those are the machines the files run on, and the page already says so.
 */
export function planDownloads(os: Os, arch: Arch, direct: { mac?: string; win?: string }, releases: string): DownloadPlan {
  const macHref = hrefFor(direct.mac, releases);
  const winHref = hrefFor(direct.win, releases);
  if (os === 'mac' && arch === 'x64') {
    return { macHref: releases, winHref, primary: 'mac', note: MAC_NOTE, macLabel: 'See Mac releases' };
  }
  if (os === 'win' && arch === 'arm') {
    return { macHref, winHref: releases, primary: 'win', note: WIN_NOTE, winLabel: 'See Windows releases' };
  }
  return { macHref, winHref, primary: os === 'win' ? 'win' : 'mac' };
}

function normalizeArch(value: string | undefined): Arch | undefined {
  const v = (value ?? '').toLowerCase();
  if (!v) return;
  if (v === 'arm' || v === 'arm64' || v.includes('aarch')) return 'arm';
  if (v === 'x86' || v === 'x64' || v === 'ia32' || v.includes('x86')) return 'x64';
  return;
}

/** Chip from the signals a browser will actually give us. userAgentData wins; it is the one Windows on ARM doesn't lie about. */
export function archFromSignals(s: { os: Os; ua?: string; uaDataArch?: string; gpu?: string }): Arch {
  const hinted = normalizeArch(s.uaDataArch);
  if (hinted) return hinted;
  const ua = s.ua ?? '';
  if (/ARM64|aarch64/i.test(ua)) return 'arm';
  if (s.os === 'win' && /Win64|WOW64|x64|x86_64|amd64/i.test(ua)) return 'x64';
  const gpu = s.gpu ?? '';
  if (s.os === 'mac' && gpu) {
    if (/intel|amd|radeon|nvidia|geforce/i.test(gpu)) return 'x64';
    if (/apple\s*m\d|apple gpu/i.test(gpu)) return 'arm';
  }
  return 'unknown';
}
