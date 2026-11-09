// The latest release as GitHub describes it, cut down to what the site shows: the version, the
// day it came out, and the files to download. The build (src/data/release.ts) and the browser
// (src/motion/release.ts) both read GitHub through this, so they always agree.
export const LATEST = 'https://api.github.com/repos/lynnarize/liner-code/releases/latest';
// The repository itself, for its stars.
export const REPO = 'https://api.github.com/repos/lynnarize/liner-code';

type File = { file: string; url: string };
export type Release = {
  version: string; // 0.2.2
  date: string; // the day it was published, 2026-11-05
  mac: File; // the DMG
  win: File & { kind: 'setup' | 'zip'; zip?: File }; // the setup when there is one, else the zip
};

type GitHub = { tag_name?: string; published_at?: string; draft?: boolean; assets?: { name: string; browser_download_url: string }[] };

export function fromGitHub(gh: GitHub): Release | null {
  const version = gh.tag_name?.replace(/^v/, '');
  if (!version || gh.draft) return null;
  const find = (end: string) => {
    const a = gh.assets?.find((x) => x.name.endsWith(end));
    return a ? { file: a.name, url: a.browser_download_url } : undefined;
  };
  const dmg = find('-mac-arm64.dmg'), setup = find('-win-x64-setup.exe'), zip = find('-win-x64.zip');
  if (!dmg || !(setup || zip)) return null;
  return {
    version,
    date: (gh.published_at ?? '').slice(0, 10),
    mac: dmg,
    win: setup ? { ...setup, kind: 'setup', zip } : { ...zip!, kind: 'zip' },
  };
}

/** Whether version a comes after version b (both like 0.2.2; a word after the numbers, as in 0.2.4-beta, is left out). */
export function newer(a: string, b: string) {
  const pa = a.split('.').map((x) => parseInt(x, 10)), pb = b.split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** A star count as GitHub shows it: 2, 950, 1.2k, 12k. */
export function shortCount(n: number) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
}

/** 2026-11-05 as 5 November 2026. */
export function longDate(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return isNaN(+d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
