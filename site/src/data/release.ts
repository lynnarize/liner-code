// The release the site offers, read from GitHub's latest release when the site is built. Server
// only (it reads the repository's files); the browser checks for a newer one itself, in
// src/motion/release.ts. A GITHUB_TOKEN in the build's environment lifts GitHub's hourly limit for
// shared build machines. If GitHub can't be reached, the changelog's newest entry stands in, and
// the buttons lead to the releases page rather than to files that might not be there.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromGitHub, LATEST, type Release } from '../lib/release';

async function fromApi(): Promise<Release | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'linercode.dev build' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(LATEST, { headers, signal: AbortSignal.timeout(8000) });
    return res.ok ? fromGitHub(await res.json()) : null;
  } catch {
    return null;
  }
}

function fromChangelog(): Release {
  // Astro runs from site/, the changelog sits at the repository's root.
  const text = readFileSync(join(process.cwd(), '..', 'CHANGELOG.md'), 'utf8');
  const m = text.match(/^## (\d+\.\d+\.\d+)\b.*?(\d{4}-\d{2}-\d{2})/m);
  const version = m?.[1] ?? '0.0.0';
  const page = 'https://github.com/lynnarize/liner-code/releases/latest';
  return {
    version,
    date: m?.[2] ?? '',
    mac: { file: `Liner-Code-${version}-mac-arm64.dmg`, url: page },
    win: { file: `Liner-Code-${version}-win-x64-setup.exe`, url: page, kind: 'setup' },
  };
}

const api = await fromApi();
if (!api) console.warn('[release] GitHub could not be reached: the site uses CHANGELOG.md\'s newest version');
export const release: Release = api ?? fromChangelog();
