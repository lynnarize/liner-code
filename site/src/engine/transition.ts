// Page transitions: the horizon rises over the page (an ultramarine field with a curved top edge,
// the dome's limb), then sets on the next one. The leave runs while the next page loads.
import { gsap } from 'gsap';
import { ease, prefersReducedMotion } from './env';

const panel = (c: HTMLElement) => c.querySelector<HTMLElement>('.curtain__panel')!;

export const playLeave = () => {
  const c = document.getElementById('curtain')!;
  if (prefersReducedMotion()) return gsap.timeline().set(c, { autoAlpha: 1 }).fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.2 }).then();
  return gsap.timeline()
    .set(c, { autoAlpha: 1, opacity: 1 })
    .fromTo(panel(c), { yPercent: 108 }, { yPercent: 0, duration: 0.85, ease: ease.inOut })
    .then();
};

export const playEnter = () => {
  const c = document.getElementById('curtain')!;
  if (prefersReducedMotion()) return gsap.to(c, { autoAlpha: 0, duration: 0.2 }).then();
  return gsap.timeline()
    .to(panel(c), { yPercent: -108, duration: 0.95, ease: ease.inOut })
    .set(c, { autoAlpha: 0 })
    .then();
};
