/*
  Design skills kept in sight: the SKILL.md files the agent reads first with the lean, switched on
  per design file (its lean.skills, saved with canvas.save). They show as rows under the lean in
  the sidebar with a count of the rest, as the dock's "/ 2 skills" chip (and rows while you type a
  slash), as chips beside the lean chip on Design Home, and as the row over the box that offers a
  skill you have but didn't load when what you typed fits it. On Home there is no design file yet,
  so what you pick is held here and written to the file Home makes before its first turn.

  Also here: whether the Lean page is up (it takes the canvas's place), Home's "start with a brand",
  and "Add to the lean" in the inspector's off-lean note. Everything plugs into B's and C's slots
  (sideSlots, homeSlots, offLeanMore) when this module loads; DesignFace, DesignHome and Dock import it.
*/
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DesignSkill, Lean, Thread } from "@contracts";
import { FRAME_CHANGED } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import type { SlashRow } from "../Composer";
import { getState, rpc, subscribe as subscribeEngine } from "../engine";
import { I } from "../icons";
import { plural } from "../model";
import { Pop, Row, Sep } from "../ui";
import { offLeanMore, type OffAbout } from "./inspect/controls";
import { homeSlots } from "./DesignHome";
import { sideSlots } from "./Layers";
import { leanNow, reloadLean, setLean } from "./lean";
import { addToLean, nameFor, useOffLean, usesOf, type OffKind } from "./leanwalk";
import { design, getDesign, subscribeDesign, useDesign } from "./store";
import "./lean-page.css";

// ---------- A small store of this module's own

type Own = { lean: boolean; home: Record<string, string[]>; typed: { home: string; dock: string } };
let own: Own = { lean: false, home: {}, typed: { home: "", dock: "" } };
const fns = new Set<() => void>();
const put = (p: Partial<Own>) => ((own = { ...own, ...p }), fns.forEach((f) => f()));
const useOwn = <T,>(pick: (o: Own) => T) => useSyncExternalStore((f) => (fns.add(f), () => void fns.delete(f)), () => pick(own));

/** The Lean page, in the canvas's place. */
export const openLean = () => put({ lean: true });
export const closeLean = () => put({ lean: false });
export const isLeanOpen = () => own.lean;
export const useLeanOpen = () => useOwn((o) => o.lean);
// Composer's onText runs in an effect, so these give back nothing.
const typed = (place: "home" | "dock", text: string): void => void (own.typed[place] !== text && put({ typed: { ...own.typed, [place]: text } }));
export const onDockText = (text: string): void => typed("dock", text);

// ---------- The skills there are

const MOCK_SKILLS: DesignSkill[] = import.meta.env.DEV
  ? [
      { name: "awwwards", description: "Award-level sites: concept, art direction, motion. For portfolios, product launches and landing pages that must impress.", path: "~/.claude/skills/awwwards/SKILL.md", loaded: false, kind: "design" },
      { name: "brandkit", description: "Brand boards, logo systems, identity decks", path: "~/.claude/skills/brandkit/SKILL.md", loaded: false, kind: "design" },
      { name: "design-taste-frontend", description: "Art direction from gallery sites, nothing generic", path: "~/.claude/skills/design-taste-frontend/SKILL.md", loaded: false, kind: "design" },
      { name: "liner-ui", description: "Your Liner UI library and its look", path: "~/.claude/skills/liner-ui/SKILL.md", loaded: false, kind: "design" },
      { name: "stageshow", description: "Faux product UI for demos and heroes", path: "~/.claude/skills/stageshow/SKILL.md", loaded: false, kind: "design" },
      { name: "pdf", description: "Read, fill and make PDF files", path: "~/.claude/skills/pdf/SKILL.md", loaded: false, kind: "other" },
    ]
  : [];
const lists = new Map<string, DesignSkill[]>();
const asking = new Set<string>();
const listFns = new Set<() => void>();

function askSkills(cwd: string) {
  if (lists.has(cwd) || asking.has(cwd)) return;
  if (getDesign().mock) return void (lists.set(cwd, MOCK_SKILLS), listFns.forEach((f) => f()));
  asking.add(cwd);
  rpc("lean.skills", { cwd })
    .then((l) => lists.set(cwd, l))
    .catch(() => lists.set(cwd, []))
    .finally(() => (asking.delete(cwd), listFns.forEach((f) => f())));
}

/** Every skill the folder's tools have, design ones first (each with `kind`); undefined until the engine answers. */
export function useSkills(cwd: string | undefined): DesignSkill[] | undefined {
  const list = useSyncExternalStore((f) => (listFns.add(f), () => void listFns.delete(f)), () => (cwd ? lists.get(cwd) : undefined));
  useEffect(() => void (cwd && askSkills(cwd)), [cwd, list]);
  return list;
}
const isDesign = (s: DesignSkill) => s.kind !== "other";
const NONE: string[] = [];

/** The skills loaded where you are: the open design file's, or (on Home, before there is one) the ones picked for it. */
export function useLoaded(cwd: string | undefined, home = false) {
  const file = useDesign((s) => s.file?.lean.skills ?? NONE);
  const picked = useOwn((o) => (cwd ? (o.home[cwd] ?? NONE) : NONE));
  return home ? picked : file;
}

/** Switches a skill on or off: for the open design file, or for the one Home is about to make. */
export function setSkill(name: string, on: boolean, cwd?: string, home = false) {
  if (home) {
    if (!cwd) return;
    const was = own.home[cwd] ?? [];
    return void put({ home: { ...own.home, [cwd]: on ? [...new Set([...was, name])] : was.filter((n) => n !== name) } });
  }
  const file = getDesign().file;
  if (!file) return void toast("Open a design file to load skills for it", { duration: 2500 });
  const skills = on ? [...new Set([...file.lean.skills, name])] : file.lean.skills.filter((n) => n !== name);
  // The store holds the file; the lean is read again so everything showing it follows.
  void design.setLean({ ...file.lean, skills }).then(refreshLean);
}

// ---------- Which skill fits what you typed

const STOP = new Set("a an the and or for of to in on at by with from into onto my our your this that these those it its is are be some any one two three new make made build create want need like please can could would should will just also then than so as up out about more less very use using get let me we you i do does design".split(" "));
const stem = (w: string) => w.toLowerCase().replace(/'s$/, "").replace(/(?<=\w{3})s$/, "");
const wordsOf = (s: string) => s.toLowerCase().match(/[a-z][a-z'-]+/g)?.flatMap((w) => w.split("-")).map(stem).filter((w) => w.length > 2 && !STOP.has(w)) ?? [];

/**
  The skill you have but didn't load that fits what you typed, and the words that say why; one rule:
  each typed word (plain words, a trailing s and stop words dropped) found in a skill's name counts
  2, found in its description counts 1, and a skill needs 2 to fit. The best one wins; a loaded one
  is never offered. For example, with awwwards ("Award-level sites ... landing pages that must
  impress") and brandkit ("Brand boards, logo systems, identity decks"):
    "A landing page for the tide tables, for launch day"  → awwwards, "a landing page" (landing 1 + page 1)
    "a brand board for Foreshore"                          → brandkit, "a brand board" (brand in the name 2, board 1)
    "a logo"                                               → nothing (logo 1)
    "make the next tide larger"                            → nothing
    "A landing page" with awwwards loaded                  → nothing
*/
export function fits(text: string, skills: DesignSkill[], loaded: string[]): { skill: DesignSkill; why: string } | undefined {
  const tokens = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const typedWords = new Set(wordsOf(text));
  if (!typedWords.size) return undefined;
  let best: { skill: DesignSkill; score: number; hits: Set<string> } | undefined;
  for (const s of skills) {
    if (loaded.includes(s.name)) continue;
    const inName = new Set(wordsOf(s.name.replace(/[_-]/g, " ")));
    const inText = new Set(wordsOf(s.description));
    const hits = new Set<string>();
    let score = 0;
    for (const w of typedWords) {
      if (inName.has(w)) (score += 2), hits.add(w);
      else if (inText.has(w)) (score += 1), hits.add(w);
    }
    if (score >= 2 && (!best || score > best.score)) best = { skill: s, score, hits };
  }
  if (!best) return undefined;
  // The typed words from the first that fits to the last, when that's short, with its article.
  const at = tokens.map((t, i) => (best!.hits.has(stem(t)) ? i : -1)).filter((i) => i >= 0);
  let why = [...best.hits].join(" and ");
  if (at.length && at[at.length - 1] - at[0] < 4) {
    const from = at[0] > 0 && /^(a|an|the)$/i.test(tokens[at[0] - 1]) ? at[0] - 1 : at[0];
    why = tokens.slice(from, at[at.length - 1] + 1).join(" ");
    why = why.charAt(0).toLowerCase() + why.slice(1);
  }
  return { skill: best.skill, why };
}

/** The row over the box: a skill that fits what you typed, and Load it. */
function FitRow({ cwd, place }: { cwd: string; place: "home" | "dock" }) {
  const text = useOwn((o) => o.typed[place]);
  const skills = useSkills(cwd);
  const loaded = useLoaded(cwd, place === "home");
  const fit = skills && text.trim().length > 3 && !text.trimStart().startsWith("/") ? fits(text, skills, loaded) : undefined;
  if (!fit) return null;
  return (
    <div className={place === "home" ? "ld-fit" : "lc-trow ld-fit-row"} role="status">
      <I.sparkle size={13} />
      <span className="lc-trow-t">
        <span className="ld-lp-mono">/{fit.skill.name}</span> fits {fit.why}. You have it, and it isn't loaded.
      </span>
      <span className="lc-grow" />
      <button type="button" className="lc-trow-lk l-focus" onClick={() => setSkill(fit.skill.name, true, cwd, place === "home")}>
        Load it
      </button>
    </div>
  );
}

// ---------- The sidebar: loaded skills under the lean, and how many more

function SideSkills({ cwd }: { cwd: string }) {
  const skills = useSkills(cwd);
  const loaded = useLoaded(cwd);
  const mine = (skills ?? []).filter(isDesign);
  const rest = mine.filter((s) => !loaded.includes(s.name)).length;
  return (
    <>
      {loaded.map((n) => (
        <button key={n} type="button" className="ld-tr l-focus" title={`The ${n} skill is loaded for this design. Open the lean`} onClick={openLean}>
          <span className="ld-sl" aria-hidden>
            /
          </span>
          <span className="ld-ell">{n}</span>
        </button>
      ))}
      {skills && mine.length > 0 && (
        <button type="button" className="ld-tr l-focus" data-rest onClick={openLean}>
          {rest > 0 ? <I.plus size={14} /> : <I.check size={14} />}
          <span className="ld-ell">{rest === 0 ? `All ${plural(mine.length, "skill")} loaded` : `${plural(rest, "more skill")}`}</span>
        </button>
      )}
    </>
  );
}

// ---------- Design Home: chips beside the lean, and the row over the box

function HomeSkills({ cwd }: { cwd: string }) {
  const skills = useSkills(cwd);
  const loaded = useLoaded(cwd, true);
  const mine = (skills ?? []).filter(isDesign);
  if (!mine.length) return null;
  const shown = [...mine].sort((a, b) => Number(loaded.includes(b.name)) - Number(loaded.includes(a.name))).slice(0, 2);
  const more = mine.length - shown.length;
  return (
    <>
      {shown.map((s) => {
        const on = loaded.includes(s.name);
        return (
          <button key={s.name} type="button" className="lc-pb ld-skill-chip l-focus" aria-pressed={on} title={on ? `${s.description}. Loaded for the new design: press to leave it out` : `${s.description}. Press to load it for the new design`} onClick={() => setSkill(s.name, !on, cwd, true)}>
            /{s.name}
          </button>
        );
      })}
      {more > 0 && (
        <Pop label="Design skills to load" width={340} triggerClass="lc-pb ld-skill-chip" trigger={<>+{more}</>} menu>
          {() => (
            <>
              {mine.map((s) => (
                <Row key={s.name} title={<span className="ld-lp-mono">/{s.name}</span>} note={s.description} on={loaded.includes(s.name)} onPick={() => setSkill(s.name, !loaded.includes(s.name), cwd, true)} />
              ))}
            </>
          )}
        </Pop>
      )}
    </>
  );
}

/** Start with a brand: three words and a reference, then an ask for a brand board and a DESIGN.md. */
function BrandStart({ cwd, send }: { cwd: string; send: (text: string) => Promise<void> }) {
  const skills = useSkills(cwd);
  const [words, setWords] = useState("");
  const [ref, setRef] = useState("");
  const brand = skills?.find((s) => /brand/i.test(s.name)) ?? skills?.find((s) => /\bbrand/i.test(s.description));
  const three = words.split(/[,\s]+/).map((w) => w.trim()).filter(Boolean).slice(0, 3);
  const go = async (close: () => void) => {
    if (!three.length) return;
    if (brand) setSkill(brand.name, true, cwd, true);
    const said = three.join(", ");
    const text = [
      `Brand: ${said}`,
      "",
      `Start this design with a brand. Its three words: ${said}.${ref.trim() ? ` A reference to go by: ${ref.trim()}.` : ""}`,
      "Make a frame named “Brand / Board” (1280 × 800) that shows the mark, the colours, two voices of type and a few uses of them.",
      "Then write the project's DESIGN.md from it: the colours with their hex values, the type styles with sizes, the spacing steps, the corners, and the rules it never breaks.",
      brand ? `Read the ${brand.name} skill first (${brand.path}).` : "",
    ].filter((l, i) => l || i === 1).join("\n");
    close();
    await send(text).catch(() => {});
  };
  return (
    <>
      <span aria-hidden>·</span>
      <Pop label="Start with a brand" width={340} triggerClass="lc-under-b l-focus" trigger={<><I.sparkle size={13} />start with a brand</>}>
        {(close) => (
          <form className="ld-brand" onSubmit={(e) => (e.preventDefault(), void go(close))}>
            <b>Start with a brand</b>
            <span className="lc-quiet">Three words for how it should feel. The agent draws a brand board frame and writes DESIGN.md from it.</span>
            <input className="ld-field" value={words} onChange={(e) => setWords(e.target.value)} placeholder="Calm, exact, tidal" aria-label="Three words" autoFocus />
            <input className="ld-field" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="A reference, if you have one: a site, a name, a feeling" aria-label="A reference (optional)" />
            <span className="ld-brand-f">
              <span className="lc-quiet">{brand ? `Loads /${brand.name}` : "No brand skill on this Mac"}</span>
              <button type="submit" className="lc-btn" data-kind="ink" disabled={!three.length}>
                Ask for the brand
              </button>
            </span>
          </form>
        )}
      </Pop>
    </>
  );
}

// ---------- The dock: "/ 2 skills", and rows while you type a slash

export function DockSkills({ cwd }: { cwd: string }) {
  const skills = useSkills(cwd);
  const loaded = useLoaded(cwd);
  const mine = (skills ?? []).filter(isDesign);
  return (
    <span className="lc-seg">
      <Pop label={`Design skills: ${loaded.length ? loaded.join(", ") : "none loaded"}. Change them`} side="top" width={340} triggerClass="lc-seg-b ld-skills-b" trigger={<><span className="ld-sl" aria-hidden>/</span>{loaded.length ? plural(loaded.length, "skill") : "Skills"}<I.chevD size={11} /></>} menu>
        {(close) => (
          <>
            {mine.map((s) => (
              <Row key={s.name} title={<span className="ld-lp-mono">/{s.name}</span>} note={s.description} on={loaded.includes(s.name)} onPick={() => setSkill(s.name, !loaded.includes(s.name), cwd)} />
            ))}
            {skills && !mine.length && <Row title="No design skills on this Mac" note="Skills are SKILL.md files in ~/.claude/skills, ~/.codex/skills or the project's .claude/skills" disabled />}
            <Sep />
            <Row title="Open the lean" icon={<I.forward size={13} />} onPick={() => (close(), openLean())} />
          </>
        )}
      </Pop>
    </span>
  );
}

/** Over the dock: a skill that fits what you typed. */
export function DockRows({ cwd }: { cwd: string }) {
  return <FitRow cwd={cwd} place="dock" />;
}

/** The design skills not loaded, as rows of the composer's own `/` list: picking one loads it for this design. */
export function useSlashRows(cwd: string): SlashRow[] {
  const skills = useSkills(cwd);
  const loaded = useLoaded(cwd);
  return useMemo(() => (skills ?? []).filter(isDesign).filter((s) => !loaded.includes(s.name)).map((s) => ({ name: s.name, note: s.description, tag: "Load for this design", onPick: () => (setSkill(s.name, true, cwd), toast(`Loaded /${s.name} for this design`, { duration: 2000 })) })), [skills, loaded, cwd]);
}

// ---------- Add to the lean, from the inspector's note

/** Reads the open design file's lean again, into the inspector's cache (lean.ts) without dropping it first. */
export async function refreshLean() {
  const s = getDesign();
  if (!s.cwd || s.mock) return;
  try {
    const l = await rpc("lean.read", { cwd: s.cwd, file: s.file?.id });
    setLean(s.cwd, s.file?.id, l.off === "none" ? null : l);
  } catch {
    reloadLean();
  }
}

/** The lean file's version as last read ("" when there was none): lean.write's `base`. */
export const revOf = (l: Lean | null | undefined) => l?.rev;
/** A refusal of lean.write because DESIGN.md changed since `base` was read (contracts' FRAME_CHANGED). */
export const isChanged = (e: unknown) => e instanceof Error && e.message.startsWith(FRAME_CHANGED);
/**
  lean.write for the open design file, so the engine writes the lean that file reads (its own
  lean.path, such as docs/brand.md, else DESIGN.md); refused when that file moved on since `base`.
*/
export function writeLeanText(cwd: string, text: string, base?: string, file = getDesign().file?.id) {
  return rpc("lean.write", { cwd, text, ...(base !== undefined ? { base } : {}), ...(file ? { file } : {}) });
}

/** Writes a value into DESIGN.md, in its section, and reads the lean again. */
export async function addValue(kind: "colour" | "space" | "corner" | "type", value: string, name?: string) {
  const s = getDesign();
  const lean = leanNow();
  if (!s.cwd || !lean) return;
  if (lean.off === "builtin") return void toast("This design follows a built-in lean. Make DESIGN.md the source on the Lean page to add to it.", { duration: 4000 });
  const said = name ?? nameFor(lean.tokens, kind, value);
  const text = addToLean(lean.text, kind, value, said, lean.tokens.steps);
  const label = kind === "colour" ? `${said} ${value}` : kind === "space" ? `the step ${value}` : kind === "corner" ? `the corner ${value}` : `${said} ${value}`;
  if (s.mock) {
    const t = lean.tokens;
    const tokens = kind === "colour" ? { ...t, colours: [...t.colours, { name: said, value }] } : kind === "space" ? { ...t, steps: [...new Set([...t.steps, Number(value)])].sort((a, b) => a - b) } : kind === "corner" ? { ...t, corners: [...t.corners, { name: said, value: Number(value) }] } : { ...t, type: [...t.type, { name: said, size: Number(value) }] };
    setLean(s.cwd, s.file?.id, { ...lean, text, tokens });
  } else {
    try {
      try {
        await writeLeanText(s.cwd, text, revOf(lean));
      } catch (e) {
        if (!isChanged(e)) throw e;
        // Someone changed DESIGN.md since it was read: the line goes into its new text, written once more.
        const fresh = await rpc("lean.read", { cwd: s.cwd, file: s.file?.id });
        await writeLeanText(s.cwd, addToLean(fresh.text, kind, value, said, fresh.tokens.steps), revOf(fresh));
      }
      await refreshLean();
    } catch (e) {
      return void toast.error(isChanged(e) ? `${lean.writes ?? lean.path ?? "DESIGN.md"} is changing as we write it. Try Add to the lean again in a moment.` : e instanceof Error ? e.message : String(e));
    }
  }
  toast(`Added ${label} to ${lean.writes ?? lean.path ?? "DESIGN.md"}`, { duration: 2500 });
}

/** After the inspector's note (C passes what it is about as data): "Add to the lean" from the third use in the file. */
function AddFromNote({ about }: { about: OffAbout }) {
  useOffLean();
  const n = usesOf(about.kind as OffKind, about.value);
  if (n < 3) return null;
  return (
    <>
      {" "}
      <span className="ld-q">Used {n} times in this file.</span>{" "}
      <button type="button" className="l-focus" onClick={() => void addValue(about.kind, about.value)}>
        Add to the lean
      </button>
    </>
  );
}

// ---------- From Home, the lean chip opens the Lean page in the project's latest session

let faces = 0;
/** LeanPage.tsx: a Design face is up, so the Lean page opens in it. */
export const faceUp = () => (faces++, () => void faces--);

async function leanFromHome(cwd?: string) {
  if (faces > 0 || !cwd) return openLean();
  const s = getState();
  const project = s.projects.find((p) => p.path === cwd);
  if (!project) return openLean();
  try {
    const latest: Thread | undefined = s.threads.filter((x) => x.projectId === project.id && !x.archived && !x.sideOf).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const t = latest ?? (await rpc("thread.create", { projectId: project.id, title: "Design" }));
    openLean();
    window.dispatchEvent(new CustomEvent("lc:open-liner-design", { detail: { threadId: t.id, cwd } }));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

// ---------- Plugging in (after the module graph has run, as DesignHome imports this and this imports it)

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  sideSlots.skills = SideSkills;
  sideSlots.openLean = openLean;
  homeSlots.skills = HomeSkills;
  homeSlots.above = ({ cwd }) => <FitRow cwd={cwd} place="home" />;
  homeSlots.or = BrandStart;
  homeSlots.onText = (text) => typed("home", text);
  homeSlots.made = async (cwd, file) => {
    const picked = own.home[cwd] ?? [];
    if (!picked.length || getDesign().file?.id !== file.id) return;
    await design.setLean({ ...file.lean, skills: [...new Set([...file.lean.skills, ...picked])] });
    put({ home: { ...own.home, [cwd]: [] } });
  };
  offLeanMore.render = (about) => <AddFromNote about={about} />;
  window.addEventListener("ld:open-lean", (e) => void leanFromHome((e as CustomEvent<{ cwd?: string }>).detail?.cwd));
  followLean();
}

/**
  The lean is read again, into the one place everything reads it from, when the agent may have
  changed it: the open design file's lean setting changed (an agent set lean.path, which arrives as
  canvas.changed and the store's reload of design.json), or the session's turn ended (it may have
  written DESIGN.md). No polling.
*/
function followLean() {
  let file = "";
  let said = "";
  subscribeDesign(() => {
    const s = getDesign();
    const k = s.file ? `${s.cwd}\n${s.file.id}` : "";
    const l = s.file ? `${s.file.lean.path ?? ""}\n${s.file.lean.builtin ?? ""}` : "";
    if (k && k === file && l !== said) void refreshLean();
    file = k;
    said = l;
  });
  let running = new Set<string>();
  subscribeEngine(() => {
    const st = getState();
    const now = new Set(st.threads.filter((t) => t.status === "running").map((t) => t.id));
    const bound = getDesign().threadId;
    if (bound && running.has(bound) && !now.has(bound)) void refreshLean();
    running = now;
  });
}
queueMicrotask(install);
