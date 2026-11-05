// Astro adapter (ClientRouter): the leave animation runs in parallel with fetching the next page.
import { boot, cleanup, enter, leave, syncFlags } from './index';

let navigating = false;

export function start(setup?: () => void) {
  document.addEventListener('astro:before-preparation', (e) => {
    navigating = true;
    const load = e.loader;
    e.loader = async () => { await Promise.all([leave(), load()]); };
  });
  document.addEventListener('astro:before-swap', (e) => {
    cleanup();
    // The router gives <html> the next page's attributes and drops the rest, so the classes the
    // scripts set once (gl-on and sea-drawn for the sea, is-loaded, Lenis's own) and the picked sea
    // would be lost, and the CSS would fall back to its no-WebGL layout. Carry them over first.
    const next = e.newDocument.documentElement, now = document.documentElement;
    next.classList.add(...now.classList);
    if (now.dataset.sea) next.dataset.sea = now.dataset.sea;
  });
  document.addEventListener('astro:after-swap', () => syncFlags());
  document.addEventListener('astro:page-load', () => {
    if (!navigating) return void boot(setup);
    navigating = false;
    enter();
  });
  boot(setup);
}
