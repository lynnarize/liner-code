// Points each download at the latest release's real file, then again once we know the chip.
// An Intel Mac and Windows on ARM are sent to the releases page. If GitHub does not answer,
// the addresses baked in at build time stay, and those are the releases page when the build could not ask either.
import { archFromSignals, downloadsFromRelease, planDownloads, type Arch, type Os } from './downloads.ts';

const KEY = 'lc:release';
const MAX_AGE = 10 * 60 * 1000;

type Direct = { mac?: string; win?: string };

function os(): Os {
  const v = document.documentElement.dataset.os;
  return v === 'win' || v === 'mac' ? v : 'other';
}

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v ? v : undefined;
}

function renderer(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch {
    return '';
  }
}

async function uaArch(): Promise<string | undefined> {
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
  if (!uad?.getHighEntropyValues) return;
  try {
    return (await uad.getHighEntropyValues(['architecture'])).architecture;
  } catch {
    return;
  }
}

function readCache(): Direct | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || '') as { at?: number; mac?: string; win?: string };
    if (!saved || typeof saved.at !== 'number' || Date.now() - saved.at > MAX_AGE) return null;
    const got = downloadsFromRelease({
      assets: [
        saved.mac ? { name: saved.mac.split('/').pop(), browser_download_url: saved.mac } : {},
        saved.win ? { name: saved.win.split('/').pop(), browser_download_url: saved.win } : {},
      ],
    });
    return got.mac || got.win ? got : null;
  } catch {
    return null;
  }
}

function paint(direct: Direct | null, arch: Arch, fromAsk: boolean) {
  const fallback = (built: string | undefined, fresh: string | undefined) => (fromAsk ? fresh : fresh || built);
  document.querySelectorAll<HTMLElement>('[data-dl]').forEach((box) => {
    const releases = attr(box, 'data-releases') ?? '';
    const plan = planDownloads(os(), arch, {
      mac: fallback(attr(box, 'data-mac'), direct?.mac),
      win: fallback(attr(box, 'data-win'), direct?.win),
    }, releases);
    const mac = box.querySelector<HTMLAnchorElement>('[data-os="mac"]');
    const win = box.querySelector<HTMLAnchorElement>('[data-os="win"]');
    if (mac) {
      mac.href = plan.macHref;
      const label = mac.querySelector('.dl-label');
      if (label) label.textContent = plan.macLabel || mac.getAttribute('data-label') || label.textContent;
    }
    if (win) {
      win.href = plan.winHref;
      const label = win.querySelector('.dl-label');
      if (label) label.textContent = plan.winLabel || win.getAttribute('data-label') || label.textContent;
    }
    const note = box.querySelector<HTMLElement>('[data-dl-note]');
    if (note) {
      note.hidden = !plan.note;
      note.textContent = plan.note ?? '';
      for (const a of [mac, win]) {
        if (!a) continue;
        if (plan.note && note.id) a.setAttribute('aria-describedby', note.id);
        else a.removeAttribute('aria-describedby');
      }
    }
  });
  document.querySelectorAll<HTMLAnchorElement>('[data-dl-single]').forEach((a) => {
    const releases = attr(a, 'data-releases') ?? '';
    const plan = planDownloads(os(), arch, {
      mac: fallback(attr(a, 'data-mac'), direct?.mac),
      win: fallback(attr(a, 'data-win'), direct?.win),
    }, releases);
    a.href = plan.primary === 'win' ? plan.winHref : plan.macHref;
    if (plan.note) a.title = plan.note;
  });
}

async function fetchLatest(api: string): Promise<Direct | null> {
  try {
    const r = await fetch(api, { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const got = downloadsFromRelease(await r.json());
    if (!got.mac && !got.win) return null;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), mac: got.mac, win: got.win }));
    } catch {
      // a private window with storage off still has the addresses from this response
    }
    return got;
  } catch {
    return null;
  }
}

export function bootDownloads() {
  if (!document.querySelector('[data-dl], [data-dl-single]')) return;
  let arch = archFromSignals({ os: os(), ua: navigator.userAgent, gpu: renderer() });
  let direct = readCache();
  const draw = () => paint(direct, arch, direct != null);
  draw();
  void uaArch().then((uaDataArch) => {
    const next = archFromSignals({ os: os(), ua: navigator.userAgent, uaDataArch, gpu: renderer() });
    if (next === arch) return;
    arch = next;
    draw();
  });
  const api = document.querySelector('[data-api]')?.getAttribute('data-api');
  if (!api) return;
  void fetchLatest(api).then((fresh) => {
    if (!fresh) return;
    direct = fresh;
    draw();
  });
}
