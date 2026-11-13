/*
  The Lean page: the design's rules, in the canvas's place (the sidebar stays, the canvas and the
  inspector stay mounted underneath so the frames can still be read). On top, the design skills,
  each with a switch, saved to the design file's lean.skills. Left, DESIGN.md as text you can
  edit (lean.write, a moment after you stop typing), or ask the agent to write. Right, what Liner
  reads from it: where the rules come from, the colours, type, space and shape the inspector
  offers, and what in this design file is off the lean, each with one press to bring it back.
*/
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lean, Project, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { pairOf } from "../Crew";
import { rpc, useEngine } from "../engine";
import { I } from "../icons";
import { agentOf } from "../model";
import { NamedSwitch, Pop, Row } from "../ui";
import { cornerChoices, setLean, useLean } from "./lean";
import { bringBack, useOffLean, walkAgain, type OffFinding } from "./leanwalk";
import { addValue, closeLean, faceUp, isChanged, refreshLean, revOf, setSkill, useLeanOpen, useLoaded, useSkills, writeLeanText } from "./Skills";
import { design, getDesign, useDesign } from "./store";
import "./lean-page.css";

// The Foreshore sample's DESIGN.md, for ?ld-mock (dev only).
const MOCK_TEXT = import.meta.env.DEV ? import.meta.glob("../../../../docs/demo/foreshore/DESIGN.md", { query: "?raw", import: "default" }) : {};

const SECTIONS = "Give it a section for each: colour (each colour's name and hex value), type (the styles with their sizes, as “Body 15”), space (the steps as one list, as “4, 8, 12, 16”), shape (the corners) and “## Never” (the rules it never breaks). Keep it short and plain.";

/** The Lean page while it's open, over the canvas; it also tells Skills.tsx that a Design face is up. */
export function LeanLayer({ thread, project, sidebar, onSidebar }: { thread?: Thread; project: Project; sidebar: boolean; onSidebar: () => void }) {
  const open = useLeanOpen();
  useEffect(() => faceUp(), []);
  // Changes made outside a turn have no signal: the lean is read again when the page opens and when the window comes back.
  useEffect(() => {
    if (!open) return;
    void refreshLean();
    const back = () => void refreshLean();
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [open]);
  return open ? <LeanPage thread={thread} project={project} sidebar={sidebar} onSidebar={onSidebar} /> : null;
}

function LeanPage({ thread, project, sidebar, onSidebar }: { thread?: Thread; project: Project; sidebar: boolean; onSidebar: () => void }) {
  const cwd = useDesign((s) => s.cwd);
  const file = useDesign((s) => s.file);
  const mock = useDesign((s) => s.mock);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  // Before the design has a session: who its first ask will go to, else "the agent".
  const who = thread ? (pairOf(thread, agents, providers)?.lead ?? agentOf(thread.agent, agents, providers).name) : "the agent";
  const lean = useLean();
  const me = useRef<HTMLDivElement>(null);

  // The canvas and inspector under the page take no keys or presses; Esc goes back.
  useEffect(() => {
    const el = me.current;
    const under = el ? [...(el.parentElement?.children ?? [])].filter((c): c is HTMLElement => c !== el && c instanceof HTMLElement) : [];
    for (const u of under) u.inert = true;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open], .lc-pop-panel")) return;
      if (e.target instanceof Element && e.target.closest("textarea, input")) return;
      closeLean();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      for (const u of under) u.inert = false;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // `shown`: the one line you read of it in the chat; the agent gets the whole ask (thread.send's `shown`).
  const ask = async (text: string, said: string, shown?: string) => {
    try {
      // A design with no session yet gets it now, begun from this design.
      const id = thread?.id ?? (await design.session());
      if (!id) return;
      await rpc("thread.send", { id, text, files: [], ...(file ? { design: { file: file.id } } : {}), ...(shown ? { shown: { text: shown } } : {}) });
      toast(`Asked ${who} ${said}. The turn is in the dock.`, { duration: 3000 });
      closeLean();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div ref={me} className="ld-lp" role="region" aria-label="The lean">
      <header className="ld-bar ld-lp-bar" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <button type="button" className="ld-title ld-lp-back l-focus" onClick={closeLean}>
          <I.chevL size={14} />
          {file?.title ?? "Design"}
        </button>
        <span className="ld-crumb">Lean</span>
        <span className="lc-grow" data-drag />
        <button type="button" className="lc-pb ld-lp-q l-focus" onClick={closeLean}>
          Back to the canvas
        </button>
      </header>
      <div className="ld-lp-in">
        <SkillTiles cwd={cwd} />
        <div className="ld-lp-cols">
          <Editor cwd={cwd} lean={lean} mock={mock} where={project.kind === "design" ? "this design's folder" : project.name} who={who} onAsk={() => void ask(`Write the project's DESIGN.md: the lean every design here follows. Read the code and the design files first. ${SECTIONS}`, "to write DESIGN.md", "Write DESIGN.md, the lean every design here follows")} />
          <section className="ld-lp-read" aria-label="What Liner reads from it">
            <Sources lean={lean} who={who} onAsk={ask} />
            <Read lean={lean} title={file?.title ?? "this design"} threadId={thread?.id ?? ""} />
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------- Skills, a tile each

function SkillTiles({ cwd }: { cwd?: string }) {
  const skills = useSkills(cwd);
  const loaded = useLoaded(cwd);
  const hasFile = useDesign((s) => Boolean(s.file));
  const mine = (skills ?? []).filter((s) => s.kind !== "other");
  const others = (skills ?? []).filter((s) => s.kind === "other");
  return (
    <section className="ld-lp-skills" aria-label="Skills">
      <div className="ld-lp-h">
        <b>Skills</b>
        <span className="ld-lp-note">Know-how the agent loads with the lean. Where a skill and DESIGN.md disagree, DESIGN.md wins.</span>
        <span className="lc-grow" />
        <Pop label="Find more skills" width={360} align="end" triggerClass="lc-pb ld-lp-q" trigger={<>Find more</>} menu>
          {() => (
            <>
              {others.map((s) => (
                <Row key={s.name} title={<span className="ld-lp-mono">/{s.name}</span>} note={s.description} on={loaded.includes(s.name)} disabled={!hasFile} onPick={() => setSkill(s.name, !loaded.includes(s.name))} />
              ))}
              {!others.length && <Row title="No other skills on this Mac" note="Skills are SKILL.md files in ~/.claude/skills, ~/.codex/skills or the project's .claude/skills" disabled />}
            </>
          )}
        </Pop>
      </div>
      {skills === undefined ? (
        <div className="ld-lp-tiles" aria-busy>
          <span className="l-shimmer ld-lp-note">Looking for skills</span>
        </div>
      ) : mine.length ? (
        <div className="ld-lp-tiles">
          {mine.map((s) => {
            const on = loaded.includes(s.name);
            return (
              <div key={s.name} className="ld-lp-tile" data-on={on || undefined} title={s.path}>
                <span className="ld-lp-tile-h">
                  <span className="ld-lp-mono ld-ell">/{s.name}</span>
                  <NamedSwitch name={`Load ${s.name} for this design`} size="sm" checked={on} disabled={!hasFile} onCheckedChange={(v) => setSkill(s.name, v)} />
                </span>
                <span className="ld-lp-tile-d">{s.description}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ld-lp-tiles">
          <span className="ld-lp-note">No design skills on this Mac yet. A skill is a SKILL.md in ~/.claude/skills, ~/.codex/skills or the project's .claude/skills.</span>
        </div>
      )}
    </section>
  );
}

// ---------- DESIGN.md, as text

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
function marked(line: string): ReactNode {
  if (/^\s{0,3}#{1,6}\s/.test(line)) return <span className="ld-lp-mh">{line}</span>;
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of line.matchAll(HEX)) {
    out.push(line.slice(at, m.index), <span key={m.index} className="ld-lp-mx">{m[0]}</span>);
    at = m.index! + m[0].length;
  }
  out.push(line.slice(at));
  return out;
}

function Editor({ cwd, lean, mock, where, who, onAsk }: { cwd?: string; lean: Lean | null; mock: boolean; where: string; who: string; onAsk: () => void }) {
  const fileId = useDesign((s) => s.file?.id);
  const [text, setText] = useState("");
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const saved = useRef<string | null>(null);
  // The version of DESIGN.md the box was filled from, and its newer text when someone else changed it.
  const rev = useRef<string | undefined>(undefined);
  const [theirs, setTheirs] = useState<Lean | null>(null);
  const timer = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const builtin = lean?.off === "builtin";

  // The text follows the lean while you haven't changed it since it was last saved.
  useEffect(() => {
    let live = true;
    void (async () => {
      let t = lean?.text ?? "";
      if (mock && !t) t = String((await Object.values(MOCK_TEXT)[0]?.()) ?? "");
      if (!live) return;
      // No unsaved edits: the new text comes in quietly. Unsaved edits and the file moved on: the clash line, nothing lost.
      setText((cur) => (saved.current === null || cur === saved.current ? ((saved.current = t), (rev.current = revOf(lean)), t) : cur));
      if (lean && saved.current !== null && revOf(lean) !== undefined && rev.current !== undefined && revOf(lean) !== rev.current && box.current && box.current.value !== saved.current) setTheirs(lean);
    })();
    return () => void (live = false);
  }, [lean?.text, lean?.path, lean?.rev, mock]);

  /** `over`: "Keep mine", written on the newer version the refusal brought (still refused if it moves on again). */
  const save = async (t: string, over?: { base?: string }) => {
    if (!cwd || builtin || (theirs && !over)) return;
    setState("saving");
    try {
      if (mock) {
        const l = getDesign();
        if (lean) setLean(l.cwd, l.file?.id, { ...lean, text: t });
      } else {
        const l = await writeLeanText(cwd, t, over ? over.base : rev.current);
        saved.current = t;
        rev.current = revOf(l);
        setTheirs(null);
        await refreshLean();
      }
      saved.current = t;
      setState("saved");
    } catch (e) {
      setState("");
      // Changed since it was read (an agent, another window): your text stays in the box, nothing is overwritten.
      if (isChanged(e)) return void rpc("lean.read", { cwd, file: fileId }).then(setTheirs, () => setTheirs({ ...(lean as Lean), text: "" }));
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const loadTheirs = () => {
    if (!theirs) return;
    saved.current = theirs.text;
    rev.current = revOf(theirs);
    setText(theirs.text);
    setTheirs(null);
    void refreshLean();
  };
  const change = (t: string) => {
    setText(t);
    setState("");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(t), 800);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const lines = useMemo(() => text.split("\n"), [text]);
  const name = builtin ? (lean?.path?.split("/").slice(-2, -1)[0] === "liner-2" ? "Liner 2.0" : "Built-in") : (lean?.writes ?? lean?.path ?? "DESIGN.md");
  const place = builtin ? "built into Liner Code, read only" : lean?.off === "liner" ? `in ${where}'s .liner folder, kept out of git` : lean ? `in ${where}, kept in git with the code` : "not written yet";
  void fileId;
  return (
    <section className="ld-lp-md" aria-label="DESIGN.md">
      <div className="ld-lp-h">
        <span className="ld-lp-mono">{name}</span>
        <span className="ld-lp-note ld-ell">{place}</span>
        <span className="lc-grow" />
        {state && <span className="ld-lp-note">{state === "saving" ? "Saving" : "Saved"}</span>}
        {!builtin && (
          <button type="button" className="lc-pb ld-lp-q l-focus" onClick={onAsk}>
            Ask {who} to write it
          </button>
        )}
      </div>
      {theirs && (
        <div className="ld-lp-clash" role="alert">
          <I.info size={14} />
          <span className="ld-lp-or-t">{lean?.writes ?? lean?.path ?? "DESIGN.md"} changed since you opened it. Your text is still here, not saved.</span>
          <button type="button" className="lc-pb ld-lp-q l-focus" onClick={loadTheirs}>
            Load its new text
          </button>
          <button type="button" className="lc-pb ld-lp-q l-focus" onClick={() => void save(text, { base: revOf(theirs) })}>
            Keep mine
          </button>
        </div>
      )}
      <div className="ld-lp-code">
        <div className="ld-lp-gut" aria-hidden>
          {lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <div className="ld-lp-txt">
          <pre aria-hidden>
            {lines.map((l, i) => (
              <span key={i} className="ld-lp-ln">
                {marked(l)}
                {"\n"}
              </span>
            ))}
          </pre>
          <textarea
            ref={box}
            value={text}
            readOnly={builtin}
            spellCheck={false}
            aria-label={builtin ? "The built-in lean, read only" : "DESIGN.md"}
            placeholder={lean ? "" : "# The lean\n\n## Colour\n- Ink #11181B\n\n## Type\nBody 15 · Title 24\n\n## Space\nSteps: 4, 8, 12, 16, 24\n\n## Never\n- Shadows"}
            onChange={(e) => change(e.target.value)}
            onBlur={() => {
              if (text !== saved.current && !builtin) {
                window.clearTimeout(timer.current);
                void save(text);
              }
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                window.clearTimeout(timer.current);
                void save(text);
              }
            }}
          />
        </div>
      </div>
    </section>
  );
}

// ---------- Where the rules come from

function Sources({ lean, who, onAsk }: { lean: Lean | null; who: string; onAsk: (text: string, said: string, shown?: string) => Promise<void> }) {
  const file = useDesign((s) => s.file);
  const [site, setSite] = useState("");
  const builtin = lean?.off === "builtin";
  const ownFile = Boolean(lean) && !builtin;
  const switchTo = async (l: NonNullable<typeof file>["lean"]) => {
    await design.setLean(l);
    await refreshLean();
  };
  return (
    <div className="ld-lp-sec">
      <div className="ld-lp-k">Where the rules come from</div>
      <div className="ld-lp-src">
        <button type="button" className="ld-lp-chip l-focus" aria-pressed={ownFile} disabled={!file} onClick={() => file && builtin && void switchTo({ skills: file.lean.skills })}>
          {ownFile && <I.check size={13} />}
          DESIGN.md in the project
        </button>
        <Pop label="A built-in lean" width={280} triggerClass="ld-lp-chip" triggerAttrs={{ "aria-pressed": builtin }} trigger={<>{builtin && <I.check size={13} />}A built-in</>} menu>
          {(close) => <Row title="Liner 2.0" note="Liner Code's own look: flat surfaces, hairlines, one accent" on={builtin} disabled={!file} onPick={() => (close(), file && void switchTo({ skills: file.lean.skills, builtin: "liner-2" }))} />}
        </Pop>
        <Pop label="Rules from a site" width={340} triggerClass="ld-lp-chip" trigger={<>From a site</>}>
          {(close) => (
            <form className="ld-brand" onSubmit={(e) => (e.preventDefault(), site.trim() && (close(), void onAsk(`Read ${site.trim()} and write the project's DESIGN.md from its look: its colours, type, spacing and corners. ${SECTIONS}`, "to write DESIGN.md from the site", `Write DESIGN.md from the look of ${site.trim()}`)))}>
              <b>From a site</b>
              <span className="lc-quiet">{who} reads the site and writes DESIGN.md from its look.</span>
              <input className="ld-field" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://" aria-label="The site's address" autoFocus />
              <span className="ld-brand-f">
                <span className="lc-grow" />
                <button type="submit" className="lc-btn" data-kind="ink" disabled={!site.trim()}>
                  Ask {who}
                </button>
              </span>
            </form>
          )}
        </Pop>
        <button type="button" className="ld-lp-chip l-focus" onClick={() => void onAsk(`Read this project's code for its look (its CSS, theme, tokens and components) and write DESIGN.md from it. ${SECTIONS}`, "to write DESIGN.md from your code", "Write DESIGN.md from this project's code")}>
          From my code
        </button>
      </div>
    </div>
  );
}

// ---------- The lean's own typefaces, from the folder or the design's assets (never the network)

const EXT = ["woff2", "woff", "ttf", "otf"];
const faces = new Map<string, Promise<boolean>>();
/**
  Loads a family's font files as "LD <family>": the design's assets/ by its name, else a font file in
  the project named after it. Read through the engine (files.raw), since the files proxy is another
  origin and a font from there would need CORS.
*/
function loadFamily(family: string, slug: string, threadId: string): Promise<boolean> {
  const key = `${threadId}\n${slug}\n${family}`;
  let p = faces.get(key);
  if (p) return p;
  p = (async () => {
    const plain = family.replace(/\s+/g, "");
    const names = [...new Set([family, plain, family.toLowerCase().replace(/\s+/g, "-")])];
    const paths: { path: string; style: "normal" | "italic" }[] = [];
    for (const n of names) for (const [suffix, style] of [["", "normal"], ["-Regular", "normal"], ["-Italic", "italic"]] as const) for (const e of EXT) paths.push({ path: `.liner/designs/${slug}/assets/${n}${suffix}.${e}`, style });
    try {
      const found = await rpc("fs.files", { projectId: "", threadId, query: plain, limit: 20 });
      for (const f of found) if (new RegExp(`\\.(${EXT.join("|")})$`, "i").test(f.path) && f.path.toLowerCase().replace(/[\s_-]/g, "").includes(plain.toLowerCase())) paths.push({ path: f.path, style: /italic/i.test(f.path) ? "italic" : "normal" });
    } catch {
      // no project files to look in
    }
    const got = new Set<string>();
    for (const u of paths) {
      if (got.has(u.style)) continue;
      try {
        const raw = await rpc("files.raw", { threadId, path: u.path });
        const bytes = Uint8Array.from(atob(raw.data), (c) => c.charCodeAt(0));
        const face = new FontFace(`LD ${family}`, bytes.buffer, { style: u.style });
        await face.load();
        document.fonts.add(face);
        got.add(u.style);
      } catch {
        // not that one
      }
    }
    return got.size > 0;
  })();
  faces.set(key, p);
  return p;
}

/** Which of these families Liner could load here: true, false, or undefined while it looks. */
function useFamilies(families: string[], threadId: string) {
  const slug = useDesign((s) => (s.mock ? undefined : s.file?.id));
  const [have, setHave] = useState<Record<string, boolean>>({});
  const key = families.join("\n");
  useEffect(() => {
    if (!slug) return setHave(Object.fromEntries(families.map((f) => [f, false])));
    let live = true;
    for (const f of families) void loadFamily(f, slug, threadId).then((ok) => live && setHave((h) => ({ ...h, [f]: ok })));
    return () => void (live = false);
  }, [key, slug, threadId]);
  return have;
}

// ---------- What Liner reads from it

function Read({ lean, title, threadId }: { lean: Lean | null; title: string; threadId: string }) {
  const off = useOffLean();
  const t = lean?.tokens;
  const have = useFamilies([...new Set((t?.type ?? []).map((x) => x.family).filter((f): f is string => Boolean(f)))], threadId);
  if (!t) {
    return (
      <div className="ld-lp-sec ld-lp-empty">
        <I.info size={20} />
        <b>Nothing to read yet</b>
        <span>Write DESIGN.md on the left, or ask the agent to. Colours, type, steps and corners show here, and fill the inspector.</span>
      </div>
    );
  }
  const corners = cornerChoices(t);
  // The sized styles, largest first, then voices named with no size of their own (Newsreader italic).
  const type = [...t.type.filter((x) => x.size !== undefined).sort((a, b) => b.size! - a.size!), ...t.type.filter((x) => x.size === undefined && x.family)];
  return (
    <>
      <div className="ld-lp-sec">
        <div className="ld-lp-k">
          Colour <span className="ld-lp-note">these are the swatches in the inspector</span>
        </div>
        {t.colours.length ? (
          <div className="ld-lp-sws">
            {t.colours.map((c) => (
              <span key={c.name} className="ld-lp-sw">
                <i style={{ background: c.value }} />
                <b className="ld-ell">{c.name}</b>
                <small className="ld-lp-mono">{c.value}</small>
              </span>
            ))}
          </div>
        ) : (
          <span className="ld-lp-note">No colours in it yet.</span>
        )}
      </div>
      <div className="ld-lp-two">
        <div className="ld-lp-sec">
          <div className="ld-lp-k">Type</div>
          {type.length ? (
            <div className="ld-lp-type">
              {type.map((s) => (
                <div key={s.name} className="ld-lp-ty">
                  <span className="ld-lp-ty-n">{s.name}</span>
                  <span className="ld-lp-ty-s">
                    <span className="ld-ell" style={{ fontFamily: s.family && have[s.family] ? `"LD ${s.family}", var(--l-font-body)` : undefined, fontWeight: s.weight, fontStyle: s.italic ? "italic" : undefined, fontSize: Math.min(s.size ?? 24, 40), lineHeight: 1.15 }}>
                      {(s.size && off.samples[s.size]) || s.name}
                    </span>
                    {s.family && have[s.family] === false && <small className="ld-lp-nofont" title={`No ${s.family} font file in the project or the design's assets, so it's drawn in the app's own`}>{s.family}: font not here</small>}
                  </span>
                  <span className="ld-lp-mono ld-lp-ty-v">
                    {s.size ? `${s.size}${s.line ? ` / ${s.line}` : ""}` : s.italic ? "italic" : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="ld-lp-note">{t.type.length ? `${t.type.map((x) => x.name).join(", ")}, with no sizes yet.` : "No type styles in it yet."}</span>
          )}
        </div>
        <div className="ld-lp-sec">
          <div className="ld-lp-k">Space</div>
          {t.steps.length ? (
            <div className="ld-lp-steps">
              {t.steps.map((n) => (
                <span key={n}>
                  <i style={{ width: Math.max(3, Math.min(n, 40)), height: Math.max(3, Math.min(n, 40)) }} />
                  <small>{n}</small>
                </span>
              ))}
            </div>
          ) : (
            <span className="ld-lp-note">No steps in it yet.</span>
          )}
          <div className="ld-lp-k ld-lp-k2">Shape</div>
          <div className="ld-lp-shapes">
            {corners.map((c) => (
              <span key={c.name}>
                <i style={{ borderRadius: c.value >= 999 ? 999 : c.value }} />
                <small>{c.label}</small>
              </span>
            ))}
          </div>
          {t.rules.length > 0 && <p className="ld-lp-rules">{t.rules.slice(0, 5).map((r) => r.replace(/\.?$/, ".")).join(" ")}</p>}
        </div>
      </div>
      <OffList title={title} off={off.findings} busy={off.busy} at={off.at} builtin={lean?.off === "builtin"} />
    </>
  );
}

const ADDABLE = new Set(["colour", "space", "corner", "type"]);

function OffList({ title, off, busy, at, builtin }: { title: string; off: OffFinding[]; busy: boolean; at: number; builtin: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? off : off.slice(0, 8);
  return (
    <div className="ld-lp-sec">
      <div className="ld-lp-k">
        Off the lean in {title} {at > 0 && <span className="ld-lp-n">{off.length}</span>}
        <span className="lc-grow" />
        <button type="button" className="lc-pb ld-lp-q l-focus" disabled={busy} onClick={walkAgain}>
          {busy ? <span className="l-shimmer">Reading the frames</span> : "Check again"}
        </button>
      </div>
      {at === 0 ? (
        <span className="ld-lp-note l-shimmer">Reading the frames</span>
      ) : off.length === 0 ? (
        <span className="ld-lp-note">Nothing in {title} is off the lean.</span>
      ) : (
        <div className="ld-lp-off">
          {shown.map((f) => (
            <div key={f.key} className="ld-lp-or">
              <I.info size={14} />
              <span className="ld-lp-or-t">
                {f.text}
                {f.count >= 3 && ADDABLE.has(f.kind) && <span className="ld-lp-note"> · used {f.count} times</span>}
              </span>
              {f.count >= 3 && ADDABLE.has(f.kind) && !builtin && (
                <button type="button" className="lc-pb ld-lp-q l-focus" onClick={() => void addValue(f.kind as "colour", f.value)}>
                  Add to the lean
                </button>
              )}
              <button type="button" className="lc-pb ld-lp-q l-focus" onClick={() => void bringBack(f)}>
                {f.act}
              </button>
            </div>
          ))}
          {off.length > shown.length && (
            <button type="button" className="lc-pb ld-lp-q ld-lp-more l-focus" onClick={() => setAll(true)}>
              {off.length - shown.length} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
