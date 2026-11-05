// Between builds, a newer release on GitHub still reaches the page. The latest release is asked
// for at most once an hour per visitor (kept in localStorage), and if it's newer than the one the
// page was built with (<html data-version>), the version, the date, the file names and the
// download links follow it. If GitHub doesn't answer, the built ones stand. The words around them
// stay as built.
import { fromGitHub, LATEST, longDate, newer, type Release } from '../lib/release';

const KEY = 'lc:release';
const HOUR = 60 * 60 * 1000;
let asking: Promise<Release | null> | null = null;

function ask(): Promise<Release | null> {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (kept && Date.now() - kept.at < HOUR) return Promise.resolve(kept.release);
  } catch {}
  return (asking ??= fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((gh) => {
      const release = gh ? fromGitHub(gh) : null;
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), release })); } catch {}
      return release;
    })
    .catch(() => null)
    .finally(() => { asking = null; }));
}

function show(r: Release) {
  const set = (rel: string, fn: (el: HTMLElement) => void) => document.querySelectorAll<HTMLElement>(`[data-rel="${rel}"]`).forEach(fn);
  set('version', (el) => { el.textContent = r.version; });
  set('date', (el) => { el.textContent = longDate(r.date) || el.textContent; });
  set('mac', (el) => { (el as HTMLAnchorElement).href = r.mac.url; });
  set('win', (el) => { (el as HTMLAnchorElement).href = r.win.url; });
  set('mac-file', (el) => { el.textContent = r.mac.file; });
  set('win-file', (el) => { el.textContent = r.win.file; });
  if (r.win.zip) set('win-zip', (el) => { (el as HTMLAnchorElement).href = r.win.zip!.url; });
  const main = document.querySelector<HTMLAnchorElement>('[data-dl-main]');
  if (main) {
    main.dataset.mac = r.mac.url;
    main.dataset.win = r.win.url;
    const os = document.querySelector<HTMLElement>('[data-dl] [data-os][aria-checked="true"]')?.dataset.os;
    main.href = os === 'win' ? r.win.url : r.mac.url;
  }
}

/** Brings the page up to the latest release, if there's a newer one than it was built with. */
export function release() {
  const built = document.documentElement.dataset.version;
  if (!built) return;
  let live = true;
  ask().then((r) => { if (live && r && newer(r.version, built)) show(r); });
  return () => { live = false; };
}
