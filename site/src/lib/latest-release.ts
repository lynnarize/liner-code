// One look at GitHub while the site builds, shared by every page. The browser asks again
// (download-buttons.ts) so a release published after this build still reaches the buttons.
// If GitHub doesn't answer here, the buttons go to the releases page until the browser's ask works.
import pkg from '../../../package.json';
import { RELEASE_API, downloadsFromRelease, type LatestDownloads } from './downloads.ts';

async function load(): Promise<LatestDownloads> {
  try {
    const r = await fetch(RELEASE_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'liner-code-site' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.warn(`Liner Code site: GitHub releases returned ${r.status}, so the download buttons go to the releases page until the page can ask again.`);
      return {};
    }
    const got = downloadsFromRelease(await r.json());
    if (!got.mac || !got.win) {
      console.warn('Liner Code site: the latest GitHub release has no Apple silicon dmg or no Windows x64 setup. Those buttons go to the releases page.');
    } else if (got.version && got.version !== pkg.version) {
      console.warn(`Liner Code site: the page says ${pkg.version} but the latest GitHub release is ${got.version}. The download buttons use the GitHub release.`);
    }
    return got;
  } catch (e) {
    console.warn(`Liner Code site: could not read the latest GitHub release (${e instanceof Error ? e.message : e}). The download buttons go to the releases page until the page can ask again.`);
    return {};
  }
}

let pending: Promise<LatestDownloads> | undefined;

export function latestDownloads(): Promise<LatestDownloads> {
  pending ??= load();
  return pending;
}
