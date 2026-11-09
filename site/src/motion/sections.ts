// The working fragments: each control does what the app's does, with the app's words.
import { gsap } from 'gsap';
import { decide, hintOf, scoreAsk } from '../../../engine/src/route.ts';
import { autoCast } from '../data/auto';
import { onPage, prefersReducedMotion } from '../engine';
import { release } from './release';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const pop = (el: Element) => { if (!prefersReducedMotion()) gsap.fromTo(el, { scale: 0.97 }, { scale: 1, duration: 0.45, ease: 'expo.out' }); };

/** A plate that glides under the picked choice of a few (Liner's choice control). */
function glide(plate: HTMLElement | null, on: HTMLElement, instant = false) {
  if (!plate) return;
  const x = on.offsetLeft, w = on.offsetWidth;
  if (instant || prefersReducedMotion()) gsap.set(plate, { x, width: w });
  else gsap.to(plate, { x, width: w, duration: 0.42, ease: 'expo.out' });
}

function how() {
  const options = $$<HTMLButtonElement>('[data-option]');
  const picked = $('[data-picked]');
  const offs: (() => void)[] = [];
  options.forEach((o) => {
    const fn = () => {
      options.forEach((x) => x.setAttribute('aria-checked', String(x === o)));
      if (picked) { picked.textContent = o.dataset.option!; pop(picked.parentElement!); }
    };
    o.addEventListener('click', fn);
    offs.push(() => o.removeEventListener('click', fn));
  });
  const radios = $('[data-options]');
  const key = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.getAttribute('aria-checked') === 'true');
    const n = options[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
    n.click(); n.focus();
  };
  radios?.addEventListener('keydown', key);
  offs.push(() => radios?.removeEventListener('keydown', key));

  const toggles: [string, string, string][] = [
    ['[data-answer]', 'Send answer', 'Answered'],
    ['[data-approve]', 'Approve and start', 'Approved'],
    ['[data-ask-send]', '', ''],
  ];
  for (const [sel, a, b] of toggles) {
    const btn = $<HTMLButtonElement>(sel);
    if (!btn) continue;
    const fn = () => {
      pop(btn);
      if (!a) return;
      const done = btn.classList.toggle('is-done');
      btn.textContent = done ? b : a;
    };
    btn.addEventListener('click', fn);
    offs.push(() => btn.removeEventListener('click', fn));
  }

  // Undo turn takes the change back; Commit keeps it.
  const diff = $('[data-diff]');
  const undo = $<HTMLButtonElement>('[data-undo-turn]');
  const commit = $<HTMLButtonElement>('[data-commit]');
  const state = $('[data-diff-state]');
  const onUndo = () => {
    if (!diff) return;
    const undone = diff.classList.toggle('is-undone');
    diff.classList.remove('is-committed');
    if (commit) { commit.textContent = 'Commit 1 file'; commit.disabled = undone; }
    undo!.querySelector('span')!.textContent = undone ? 'Redo turn 1' : 'Undo turn 1';
    if (state) state.textContent = undone ? 'Turn 1 undone: the file is as it was' : '1 of 1 file viewed';
  };
  const onCommit = () => {
    if (!diff) return;
    diff.classList.add('is-committed');
    commit!.textContent = 'Committed';
    if (state) state.textContent = 'Committed to main: Wrap round to tomorrow’s first high tide';
    pop(commit!);
  };
  undo?.addEventListener('click', onUndo);
  commit?.addEventListener('click', onCommit);
  offs.push(() => { undo?.removeEventListener('click', onUndo); commit?.removeEventListener('click', onCommit); });
  return () => offs.forEach((f) => f());
}

const LABELS: Record<string, string> = { reasoning: 'Reasoning', codeGen: 'Writing code', debugging: 'Debugging', toolUse: 'Tools', breadth: 'Reach' };
const WEIGHT: Record<string, string> = { light: 'Light job', medium: 'Medium job', heavy: 'Heavy job' };

function auto() {
  const input = $<HTMLInputElement>('[data-auto-input]');
  const answer = $('[data-auto-answer]');
  if (!input || !answer) return;
  let level: 'standard' | 'high' | 'max' = 'high';
  const cast = { everyday: autoCast.everyday, strong: autoCast.strong, judge: autoCast.judge, critics: autoCast.critics };
  const plate = $('[data-plate]', answer);
  const levels = $$<HTMLButtonElement>('[data-level]', answer);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const render = () => {
    const text = input.value.trim() || 'Hello';
    const d = decide(text, { level, cast, root: cast.everyday });
    const s = scoreAsk(text);
    $('[data-weight]', answer)!.textContent = WEIGHT[d.weight];
    const rule = $('[data-rule]', answer); if (rule) rule.textContent = d.rule;
    const steps: string[] = [];
    if (d.pattern === 'single') steps.push(`<li><b>${esc(d.writer)}</b> ${d.talk ? 'answers' : 'does it'}</li>`);
    if (d.pattern === 'cascade') steps.push(`<li><b>${esc(d.writer)}</b> does it</li>`, `<li><b>${esc(d.judge!)}</b> judges the change</li>`, `<li><b>${esc(d.repair!)}</b> repairs it if it fails</li>`);
    if (d.pattern === 'critique') steps.push(`<li><b>${esc(d.writer)}</b> does it</li>`, ...d.critics.map((c) => `<li><b>${esc(c)}</b> reads it</li>`), `<li><b>${esc(d.writer)}</b> revises once</li>`);
    $('[data-flow]', answer)!.innerHTML = steps.join('');
    $('[data-flow]', answer)!.dataset.pattern = d.pattern;
    const hint = $('[data-hint-line]', answer); if (hint) hint.textContent = hintOf(d, (r) => r);
    const scores = $('[data-scores]', answer); if (scores) scores.innerHTML = Object.entries(LABELS)
      .map(([k, l]) => `<div><dt>${l}</dt><dd><span style="--v:${(s as Record<string, number>)[k]}"></span>${((s as Record<string, number>)[k]).toFixed(2)}</dd></div>`).join('');
  };
  const setLevel = (b: HTMLButtonElement, instant = false) => {
    level = b.dataset.level as typeof level;
    levels.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    glide(plate, b, instant);
    render();
  };
  const offs: (() => void)[] = [];
  levels.forEach((b) => { const fn = () => setLevel(b); b.addEventListener('click', fn); offs.push(() => b.removeEventListener('click', fn)); });
  const onInput = () => render();
  input.addEventListener('input', onInput);
  offs.push(() => input.removeEventListener('input', onInput));
  $$<HTMLButtonElement>('[data-example]').forEach((b) => {
    const fn = () => {
      input.value = b.dataset.example!;
      render();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.scrollLeft = input.scrollWidth;
      pop(answer);
    };
    b.addEventListener('click', fn);
    offs.push(() => b.removeEventListener('click', fn));
  });
  requestAnimationFrame(() => setLevel(levels.find((b) => b.dataset.level === level)!, true));
  document.fonts.ready.then(() => glide(plate, levels.find((b) => b.dataset.level === level)!, true));
  return () => offs.forEach((f) => f());
}

function commands() {
  const root = $('[data-cmd]');
  if (!root) return;
  const input = $<HTMLInputElement>('[data-cmd-input]', root)!;
  const rows = $$<HTMLLIElement>('[data-row]', root);
  const empty = $('[data-cmd-empty]', root);
  const list = $('[data-cmd-list]', root)!;
  const visible = () => rows.filter((r) => !r.hidden);
  const select = (row: HTMLElement | undefined, focus = false) => {
    if (!row) return;
    rows.forEach((r) => { r.setAttribute('aria-selected', String(r === row)); r.tabIndex = r === row ? 0 : -1; });
    list.setAttribute('aria-activedescendant', row.id);
    if (focus) row.focus();
  };
  const offs: (() => void)[] = [];
  const filter = () => {
    const q = input.value.trim().toLowerCase();
    rows.forEach((r) => { r.hidden = !!q && !r.dataset.row!.includes(q); });
    const v = visible();
    if (empty) empty.hidden = v.length > 0;
    if (!v.some((r) => r.getAttribute('aria-selected') === 'true')) select(v[0]);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const v = visible();
    const i = v.findIndex((r) => r.getAttribute('aria-selected') === 'true');
    select(v[(i + (e.key === 'ArrowDown' ? 1 : v.length - 1)) % v.length], e.target !== input);
  };
  input.addEventListener('input', filter);
  root.addEventListener('keydown', keys);
  offs.push(() => { input.removeEventListener('input', filter); root.removeEventListener('keydown', keys); });
  rows.forEach((r) => {
    const fn = () => select(r);
    r.addEventListener('pointerenter', fn);
    r.addEventListener('click', fn);
    offs.push(() => { r.removeEventListener('pointerenter', fn); r.removeEventListener('click', fn); });
  });
  return () => offs.forEach((f) => f());
}

function tabs() {
  const tabs = $$<HTMLButtonElement>('[data-tab]');
  if (!tabs.length) return;
  const show = (t: HTMLButtonElement, focus = false) => {
    const v = t.dataset.tab!;
    tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    $$('[data-panel]').forEach((p) => {
      const on = p.dataset.panel === v;
      p.hidden = !on;
      if (on && !prefersReducedMotion()) gsap.from(p.querySelectorAll('.new__band'), { autoAlpha: 0, y: 14, filter: 'blur(6px)', duration: 0.8, stagger: 0.05, ease: 'expo.out', clearProps: 'filter' });
    });
    $$('[data-pic]').forEach((p) => { const on = p.dataset.pic === v; p.classList.toggle('is-on', on); if (on) p.removeAttribute('aria-hidden'); else p.setAttribute('aria-hidden', 'true'); });
    if (focus) t.focus();
  };
  const offs: (() => void)[] = [];
  tabs.forEach((t, i) => {
    const click = () => show(t);
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
      e.preventDefault();
      const n = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : (i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      show(tabs[n], true);
    };
    t.addEventListener('click', click);
    t.addEventListener('keydown', key);
    offs.push(() => { t.removeEventListener('click', click); t.removeEventListener('keydown', key); });
  });
  return () => offs.forEach((f) => f());
}

function download() {
  const root = $('[data-dl]');
  if (!root) return;
  const btns = $$<HTMLButtonElement>('[data-os]', root);
  const plate = $('[data-seg-plate]', root);
  const main = $<HTMLAnchorElement>('[data-dl-main]', root)!;
  const pick = (b: HTMLButtonElement, instant = false) => {
    const os = b.dataset.os!;
    btns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    $$('[data-os-panel]', root).forEach((p) => { p.hidden = p.dataset.osPanel !== os; });
    main.href = os === 'mac' ? main.dataset.mac! : main.dataset.win!;
    main.textContent = os === 'mac' ? 'Download the DMG' : main.dataset.winAction ?? 'Download the zip';
    glide(plate, b, instant);
  };
  // Windows visitors start on Windows.
  const isWin = /Windows/i.test(navigator.userAgent);
  const offs: (() => void)[] = [];
  btns.forEach((b) => { const fn = () => pick(b); b.addEventListener('click', fn); offs.push(() => b.removeEventListener('click', fn)); });
  const first = btns.find((b) => b.dataset.os === (isWin ? 'win' : 'mac'))!;
  requestAnimationFrame(() => pick(first, true));
  document.fonts.ready.then(() => glide(plate, btns.find((b) => b.getAttribute('aria-checked') === 'true')!, true));
  return () => offs.forEach((f) => f());
}

function copies() {
  const offs: (() => void)[] = [];
  $$<HTMLButtonElement>('[data-copy]').forEach((b) => {
    const fn = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy!); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1800);
    };
    b.addEventListener('click', fn);
    offs.push(() => b.removeEventListener('click', fn));
  });
  return () => offs.forEach((f) => f());
}

/** A group of role="radio" buttons: one picked, arrow keys move it. */
function radios(group: HTMLElement | null, onPick?: (b: HTMLButtonElement) => void) {
  if (!group) return () => {};
  const items = $$<HTMLButtonElement>('[role="radio"]', group);
  const pick = (b: HTMLButtonElement) => { items.forEach((x) => x.setAttribute('aria-checked', String(x === b))); onPick?.(b); };
  const click = (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]'); if (b && items.includes(b)) pick(b); };
  const key = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = items.findIndex((x) => x.getAttribute('aria-checked') === 'true');
    const n = items[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    pick(n); n.focus();
  };
  group.addEventListener('click', click);
  group.addEventListener('keydown', key);
  return () => { group.removeEventListener('click', click); group.removeEventListener('keydown', key); };
}

// Workshop: the offer at a turn's end, the mode picker, and the add-on card built from what it asks
// for, worded the way the app words it (ui/src/app/AddonsPage.tsx and Addon.tsx).
function workshop() {
  const card = $('[data-card]');
  const offer = $('[data-offer]');
  if (!card && !offer) return;
  const offs: (() => void)[] = [radios($('[data-modes]'))];

  if (offer) {
    let place = 'page';
    const WHERE: Record<string, string> = { dock: 'in the right panel', tab: 'a tab beside Chat', page: 'under Add-ons in the left sidebar', custom: 'where you described' };
    offs.push(radios($('[data-places]', offer), (b) => { place = b.dataset.place!; }));
    const steps = $$('[data-steps] li', offer);
    const note = $('[data-offer-note]', offer)!;
    const go = $<HTMLButtonElement>('[data-offer-go]', offer)!;
    const no = $<HTMLButtonElement>('[data-offer-no]', offer)!;
    let timers: number[] = [];
    const reset = () => { timers.forEach(clearTimeout); timers = []; steps.forEach((s) => s.classList.remove('is-done')); };
    const create = () => {
      if (go.dataset.state === 'installed') { // Keep
        go.dataset.state = 'kept'; go.textContent = 'Kept'; go.disabled = true; no.hidden = true;
        note.textContent = `Kept. It is ${WHERE[place]}.`;
        return;
      }
      reset();
      go.disabled = true; no.hidden = true;
      note.textContent = 'Making it in the background…';
      const gap = prefersReducedMotion() ? 0 : 650;
      steps.forEach((s, i) => timers.push(window.setTimeout(() => s.classList.add('is-done'), gap * (i + 1))));
      timers.push(window.setTimeout(() => {
        note.textContent = `Installed. It is ${WHERE[place]}. Keep it, or undo.`;
        go.textContent = 'Keep'; go.disabled = false; go.dataset.state = 'installed';
        no.hidden = false; no.textContent = 'Undo';
      }, gap * (steps.length + 1)));
    };
    const dismiss = () => {
      reset();
      if (go.dataset.state === 'installed') note.textContent = 'Removed. Undo keeps its files in .liner/addons, so Restore brings it back.';
      else note.textContent = 'Not now. Nothing was made. Ask again whenever you like.';
      go.dataset.state = ''; go.textContent = 'Create'; go.disabled = false; no.textContent = 'Not now';
    };
    go.addEventListener('click', create);
    no.addEventListener('click', dismiss);
    offs.push(() => { reset(); go.removeEventListener('click', create); no.removeEventListener('click', dismiss); });
  }

  if (card) {
    const asks = $('[data-asks]')!;
    const state = { where: 'page', files: true, session: false, composer: false, storage: true, ai: false, network: false };
    const NET = 'api.linear.app';
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const render = () => {
      const p = state.where;
      $('[data-card-title]', card)!.textContent = p === 'page' ? 'Notes, a page of its own' : p === 'tab' ? 'Notes, a tab beside Chat' : 'Notes, beside your sessions';
      const reads = [
        state.files && "Files in the project it's open in",
        state.session && (p === 'tab' ? 'This session: its title, changes and commands' : "The session it's beside: its title, changes and commands"),
      ].filter(Boolean) as string[];
      const fields: [string, string][] = [
        ...(state.network ? [['Network', `<code>${NET}</code>`] as [string, string]] : []),
        ['Reads', reads.length ? reads.map(esc).join('; ') : 'Nothing'],
        ['Can do', state.composer ? 'Put text in the composer, for you to send' : 'Nothing but show itself'],
        ...(state.ai ? [['Model', "Asks a model you pick when it first asks, billed to that model's account. Just a model: no tools or files"] as [string, string]] : []),
        ['Keeps', state.storage ? 'Its own storage, up to 1 MB' : 'Nothing'],
        ...(state.network ? [] : [['Network', 'None'] as [string, string]]),
        ['Where', p === 'page' ? 'Under Add-ons, in the left sidebar' : p === 'tab' ? 'A tab beside Chat, in every project' : 'The right dock, in every project'],
      ];
      $('[data-card-fields]', card)!.innerHTML = fields.map(([l, v]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join('');
      const line: string[] = [];
      if (state.files) line.push("reads this project's files");
      if (state.session) line.push(p === 'tab' ? 'reads this session' : "reads the session it's beside");
      if (state.composer) line.push('can put text in the composer');
      if (state.storage) line.push('keeps its own storage, up to 1 MB');
      if (state.ai) line.push('asks a model you pick');
      line.push(state.network ? `reaches ${NET}` : 'no network');
      $('[data-card-strip]', card)!.textContent = [`${p === 'dock' ? 'Add-on' : 'App'} by Opus 5.5`, 'v1', ...line].join(' · ');
    };
    const added = () => card.classList.contains('is-added');
    const settle = (text: string, on: boolean) => {
      card.classList.toggle('is-added', on);
      $('[data-card-state]', card)!.textContent = text;
      $<HTMLButtonElement>('[data-card-add]', card)!.textContent = on ? 'Undo' : 'Add';
      $<HTMLButtonElement>('[data-card-no]', card)!.hidden = on;
    };
    const change = () => {
      render();
      if (added()) settle('It asks for something new, so it asks again: nothing changes until you answer.', false);
      if (!prefersReducedMotion()) gsap.fromTo(card, { scale: 0.985 }, { scale: 1, duration: 0.5, ease: 'expo.out' });
    };
    offs.push(radios($('[role="radiogroup"]', asks), (b) => { state.where = b.dataset.where!; change(); }));
    $$<HTMLButtonElement>('[data-ask]', asks).forEach((b) => {
      const fn = () => {
        const k = b.dataset.ask as keyof typeof state;
        (state as Record<string, unknown>)[k] = !state[k];
        b.setAttribute('aria-pressed', String(state[k]));
        change();
      };
      b.addEventListener('click', fn);
      offs.push(() => b.removeEventListener('click', fn));
    });
    const add = $<HTMLButtonElement>('[data-card-add]', card)!;
    const no = $<HTMLButtonElement>('[data-card-no]', card)!;
    const onAdd = () => added()
      ? settle('Removed. Its files stay, so Restore brings it back.', false)
      : settle(state.where === 'page' ? 'Added. Notes is under Add-ons in the left sidebar.' : state.where === 'tab' ? 'Added. Notes is a tab beside Chat.' : 'Added. Notes is in the right dock.', true);
    const onNo = () => settle('Not now. Nothing was added.', false);
    add.addEventListener('click', onAdd);
    no.addEventListener('click', onNo);
    offs.push(() => { add.removeEventListener('click', onAdd); no.removeEventListener('click', onNo); });
    render();
  }
  return () => offs.forEach((f) => f());
}

function nav() {
  const btn = $<HTMLButtonElement>('[data-menu]');
  const sheet = $('[data-sheet]');
  const get = $<HTMLAnchorElement>('[data-get-btn]');
  const menu = $('[data-get-menu]');
  if (!btn || !sheet) return;
  const close = () => { btn.setAttribute('aria-expanded', 'false'); sheet.hidden = true; btn.textContent = 'Menu'; };
  const closeGet = () => { if (!get || !menu) return; get.setAttribute('aria-expanded', 'false'); menu.hidden = true; };
  const toggle = () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    if (open) closeGet();
    btn.setAttribute('aria-expanded', String(open));
    sheet.hidden = !open;
    btn.textContent = open ? 'Close' : 'Menu';
    if (open) { (sheet.querySelector('a') as HTMLElement | null)?.focus(); if (!prefersReducedMotion()) gsap.from(sheet.querySelectorAll('li'), { autoAlpha: 0, y: 12, filter: 'blur(6px)', stagger: 0.04, duration: 0.6, ease: 'expo.out', clearProps: 'filter' }); }
  };
  // Download: a short menu of the two files. The visitor's own computer goes first.
  if (get && menu) {
    get.setAttribute('role', 'button');
    get.setAttribute('aria-haspopup', 'true');
    get.setAttribute('aria-controls', menu.id);
    get.setAttribute('aria-expanded', 'false');
    const yours = /Windows/i.test(navigator.userAgent) ? 'win' : /Mac/i.test(navigator.userAgent) ? 'mac' : '';
    if (yours) $(`[data-get-os="${yours}"]`, menu)?.setAttribute('data-yours', '');
  }
  const toggleGet = (e: Event) => {
    if (!get || !menu) return;
    e.preventDefault();
    const open = menu.hidden;
    if (open) close();
    get.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    if (!open) return;
    ($('[data-yours]', menu) ?? $('a', menu))?.focus();
    if (!prefersReducedMotion()) {
      gsap.fromTo(menu, { autoAlpha: 0, y: -8, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'expo.out', clearProps: 'transform,opacity,visibility' });
      gsap.from($$('.get__os, .get__foot', menu), { autoAlpha: 0, y: 8, stagger: 0.04, duration: 0.5, delay: 0.04, ease: 'expo.out', clearProps: 'all' });
    }
  };
  // A click anywhere else, or a choice made, puts it away.
  const away = (e: PointerEvent) => { if (menu && !menu.hidden && !(e.target as HTMLElement).closest('[data-get]')) closeGet(); };
  const picked = (e: Event) => { if ((e.target as HTMLElement).closest('a')) closeGet(); };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!sheet.hidden) { close(); btn.focus(); }
    if (menu && !menu.hidden) { closeGet(); get?.focus(); }
  };
  btn.addEventListener('click', toggle);
  get?.addEventListener('click', toggleGet);
  menu?.addEventListener('click', picked);
  document.addEventListener('pointerdown', away);
  document.addEventListener('keydown', key);
  sheet.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) close(); });
  return () => {
    btn.removeEventListener('click', toggle);
    get?.removeEventListener('click', toggleGet);
    menu?.removeEventListener('click', picked);
    document.removeEventListener('pointerdown', away);
    document.removeEventListener('keydown', key);
  };
}

// The sea at night or blue: the pick goes on <html data-sea>, which the sea, the sky and the nav
// all read, and stays in this browser for the next visit.
function seas() {
  const btns = $$<HTMLButtonElement>('[data-seas] [data-pick]');
  if (!btns.length) return;
  const root = document.documentElement;
  const sync = () => { const v = root.dataset.sea === 'blue' ? 'blue' : 'dark'; btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === v))); };
  const pick = (e: Event) => {
    const v = (e.currentTarget as HTMLElement).dataset.pick === 'blue' ? 'blue' : 'dark';
    root.dataset.sea = v;
    try { localStorage.setItem('lc:sea', v); } catch { /* private mode: it lasts for this page */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v === 'blue' ? '#0b33b4' : '#0b0e1c');
    sync();
  };
  btns.forEach((b) => b.addEventListener('click', pick));
  sync();
  return () => btns.forEach((b) => b.removeEventListener('click', pick));
}

// The nav takes the ink of the field under it.
function tone() {
  const sections = $$('[data-tone]').filter((el) => !el.closest('[data-sea-stage]') || el.matches('[data-sea-stage]'));
  const hero = $('[data-hero]');
  const bar = $('[data-nav]');
  let lastY = scrollY;
  const update = () => {
    const y = 32;
    if (bar) {
      const dy = scrollY - lastY;
      if (Math.abs(dy) > 4) { bar.classList.toggle('is-away', dy > 0 && scrollY > innerHeight * 0.6 && !document.querySelector('[data-sheet]:not([hidden]), [data-get-menu]:not([hidden])')); lastY = scrollY; }
      const heroR = hero?.getBoundingClientRect();
      bar.classList.toggle('is-solid', !(heroR && heroR.top <= 0 && heroR.bottom > innerHeight * 0.5) && !document.querySelector('.stage--page'));
    }
    const under = sections.filter((s) => { const r = s.getBoundingClientRect(); return r.top <= y && r.bottom > y; }).pop();
    if (hero) { const r = hero.getBoundingClientRect(); if (r.top <= y && r.bottom > y) return; } // the hero's driver decides
    document.documentElement.dataset.navTone = under?.dataset.tone ?? 'paper';
  };
  gsap.ticker.add(update);
  return () => gsap.ticker.remove(update);
}

export function startSections() {
  onPage(() => {
    const offs = [how(), auto(), commands(), tabs(), download(), copies(), workshop(), nav(), seas(), tone(), release()].filter(Boolean) as (() => void)[];
    return () => offs.forEach((f) => f());
  });
}
