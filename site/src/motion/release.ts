// Between builds, GitHub still reaches the page. The latest release and the repository's stars
// are asked for at most once an hour per visitor (kept in localStorage). If the release is newer
// than the one the page was built with (<html data-version>), the version, the date, the file
// names and the download links follow it; the star count always shows GitHub's latest. If GitHub
// doesn't answer, the built ones stand. The words around them stay as built.
import { fromGitHub, LATEST, longDate, newer, REPO, shortCount, type Release } from '../lib/release';

const KEY = 'lc:github';
const HOUR = 60 * 60 * 1000;
type Fresh = { release: Release | null; stars: number | null };
let asking: Promise<Fresh> | null = null;

const get = (url: string) =>
  fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then((res) => (res.ok ? res.json() : null)).catch(() => null);

function ask(): Promise<Fresh> {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (kept && Date.now() - kept.at < HOUR) return Promise.resolve(kept.fresh);
  } catch {}
  return (asking ??= Promise.all([get(LATEST), get(REPO)])
    .then(([latest, repo]) => {
      const fresh: Fresh = {
        release: latest ? fromGitHub(latest) : null,
        stars: typeof repo?.stargazers_count === 'number' ? repo.stargazers_count : null,
      };
      // Only a full answer is kept, so a refused request is asked again on the next page.
      if (fresh.release && fresh.stars !== null) try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), fresh })); } catch {}
      return fresh;
    })
    .finally(() => { asking = null; }));
}

const each = (rel: string, fn: (el: HTMLElement) => void) => document.querySelectorAll<HTMLElement>(`[data-rel="${rel}"]`).forEach(fn);

function showRelease(r: Release) {
  each('version', (el) => { el.textContent = r.version; });
  each('date', (el) => { el.textContent = longDate(r.date) || el.textContent; });
  each('mac', (el) => { (el as HTMLAnchorElement).href = r.mac.url; });
  each('win', (el) => { (el as HTMLAnchorElement).href = r.win.url; });
  each('mac-file', (el) => { el.textContent = r.mac.file; });
  each('win-file', (el) => { el.textContent = r.win.file; });
  if (r.win.zip) each('win-zip', (el) => { (el as HTMLAnchorElement).href = r.win.zip!.url; });
  const main = document.querySelector<HTMLAnchorElement>('[data-dl-main]');
  if (main) {
    main.dataset.mac = r.mac.url;
    main.dataset.win = r.win.url;
    const os = document.querySelector<HTMLElement>('[data-dl] [data-os][aria-checked="true"]')?.dataset.os;
    main.href = os === 'win' ? r.win.url : r.mac.url;
  }
}

function showStars(n: number) {
  each('stars-n', (el) => { el.textContent = shortCount(n); });
  document.querySelectorAll<HTMLElement>('[data-stars-link]').forEach((a) => {
    a.setAttribute('aria-label', `Star Liner Code on GitHub, ${n} ${n === 1 ? 'star' : 'stars'} so far`);
  });
}

/** Brings the page up to GitHub: a newer release if there is one, and the latest star count. */
export function release() {
  const built = document.documentElement.dataset.version;
  let live = true;
  ask().then(({ release: r, stars }) => {
    if (!live) return;
    if (r && built && newer(r.version, built)) showRelease(r);
    if (stars !== null) showStars(stars);
  });
  return () => { live = false; };
}
