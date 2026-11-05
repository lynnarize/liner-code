// Declarative motion through data attributes. Text arrives the way Liner Code's does: it comes
// into focus (blur to sharp, a short rise), word by word.
//   data-split="words|lines"   focus reveal per word (or per line)
//   data-reveal="up|fade|clip" block reveal
//   data-intro                 play with the page intro instead of on scroll
//   data-delay="0.2"           extra delay (seconds)
// Skipped under reduced motion; CSS keeps content visible without JS.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { ease, prefersReducedMotion } from './env';

gsap.registerPlugin(ScrollTrigger, SplitText);

function splitTween(el: HTMLElement, isIntro: boolean) {
  const type = el.dataset.split === 'lines' ? 'lines' : 'words';
  const delay = parseFloat(el.dataset.delay || '0');
  const s = { tween: undefined as gsap.core.Tween | undefined, done: false, requested: false };
  SplitText.create(el, {
    type: type === 'lines' ? 'lines' : 'lines,words',
    autoSplit: true,
    linesClass: 'split-line',
    wordsClass: 'split-word',
    onSplit(self) {
      gsap.set(el, { visibility: 'visible' });
      if (s.done) return;
      const targets = type === 'lines' ? self.lines : self.words;
      s.tween = gsap.from(targets, {
        autoAlpha: 0,
        filter: 'blur(8px)',
        y: 18,
        duration: 1.1,
        stagger: type === 'lines' ? 0.09 : 0.04,
        ease: ease.out,
        delay,
        paused: isIntro && !s.requested,
        clearProps: 'filter',
        onComplete: () => { s.done = true; },
        scrollTrigger: isIntro ? undefined : { trigger: el, start: 'top 88%', once: true },
      });
      return s.tween;
    },
  });
  return () => { s.requested = true; s.tween?.play(); };
}

function blockTween(el: HTMLElement, paused: boolean) {
  const kind = el.dataset.reveal || 'up';
  const delay = parseFloat(el.dataset.delay || '0');
  const from: gsap.TweenVars =
    kind === 'fade' ? { autoAlpha: 0 }
    : kind === 'clip' ? { clipPath: 'inset(100% 0% 0% 0%)', autoAlpha: 1 }
    : kind === 'focus' ? { autoAlpha: 0, filter: 'blur(10px)', y: 24 }
    : { y: 32, autoAlpha: 0 };
  const to: gsap.TweenVars = kind === 'clip' ? { clipPath: 'inset(0% 0% 0% 0%)' } : kind === 'focus' ? { filter: 'blur(0px)' } : {};
  gsap.set(el, { visibility: 'visible' });
  return gsap.fromTo(el, from, {
    ...to,
    y: 0,
    autoAlpha: 1,
    duration: kind === 'fade' ? 0.9 : 1.2,
    ease: ease.out,
    delay,
    paused,
    ...(kind === 'focus' ? { clearProps: 'filter' } : {}),
    scrollTrigger: paused ? undefined : { trigger: el, start: 'top 90%', once: true },
  });
}

/** Wire every reveal inside `root`. Returns the intro timeline (paused) for the page entrance. */
export function initReveals(root: ParentNode = document) {
  const intro = gsap.timeline({ paused: true });
  if (prefersReducedMotion()) return intro;
  root.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    const isIntro = el.hasAttribute('data-intro');
    const play = splitTween(el, isIntro);
    if (isIntro) intro.add(play, 0);
  });
  root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    const isIntro = el.hasAttribute('data-intro');
    const t = blockTween(el, isIntro);
    if (isIntro) intro.add(() => t.play(), 0);
  });
  return intro;
}
