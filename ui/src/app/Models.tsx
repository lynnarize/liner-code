/*
  Picking a model and how hard it thinks. The models are the ones each tool on this Mac said it
  runs, not a list kept in the app: a rail of tools (and the models you starred, and in the
  composer your agents), a search
  across all of them, each tool's current models first with its older ones folded under them,
  and ⌘1 to ⌘9 for the first nine. A tool that runs models from several sources (Hermes's Nous
  Portal and OpenCode Go, an OpenCode with OpenRouter) shows its sources first, then a source's
  models, so a long list is two short steps instead of one long scroll. The effort menu offers the levels the chosen model takes,
  with the tool's own default marked.
*/
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { ProviderInfo } from "@contracts";
import { familyOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I, ModelMark } from "./icons";
import { allModels, effortName, effortsFor, EXTRA_EFFORTS, markOf, sourceMarkOf, type ModelChoice } from "./model";
import { ModelTag, PanelHead, Pop, Row, Sep } from "./ui";
import * as os from "./os";
import "./models.css";

const INITIALS: Record<string, string> = { claude: "C", codex: "X", opencode: "O", hermes: "H", demo: "D", cursor: "Cu", grok: "G" };

type Props = {
  /** The model picked now, as "<provider>:<model>". */
  value?: string;
  /** Others picked alongside, to compare. */
  also?: string[];
  onPick: (ref: string, how: { shiftKey: boolean }) => void;
  /** Which tools to offer; all that are ready by default. */
  only?: (p: ProviderInfo) => boolean;
  /** The tallest it grows; below that it's as tall as its rows (or its rail of tools). */
  height?: number;
  autoFocus?: boolean;
  /** A line under the list, like how to compare. */
  foot?: ReactNode;
  /** A tab of its own at the foot of the rail, its body shown in place of the models: your agents. `open` opens on it. */
  extra?: { id: string; label: string; icon: ReactNode; open?: boolean; body: ReactNode };
  /** Told which tab is open: "fav", a tool's id, or the extra tab's. */
  onTab?: (id: string) => void;
};

type Line = { kind: "row"; m: ModelChoice; sub: string } | { kind: "head"; text: string } | { kind: "fold"; provider: string; n: number; open: boolean } | { kind: "source"; name: string; n: number; refs: string[] } | { kind: "back"; tool: string; name: string };

/** A tool with two sources or more shows them first (OpenCode's Zen and Go); one with a source and models of no source does past this many. */
const SOURCES_FROM = 14;
/** A source's name from a model id's prefix ("opencode-go/kimi-k3" → "OpenCode Go"), when the tool didn't name it. */
const SOURCE_NAMES: Record<string, string> = { opencode: "OpenCode Zen", "opencode-go": "OpenCode Go", openrouter: "OpenRouter", deepseek: "DeepSeek", moonshotai: "Moonshot", zai: "Z.ai", "z-ai": "Z.ai", google: "Google", anthropic: "Anthropic", openai: "OpenAI", xai: "xAI", groq: "Groq", ollama: "Ollama", lmstudio: "LM Studio" };
/** Where a model comes from inside its tool: the source the tool reported (Nous Portal, OpenCode Go), else its id's prefix. */
function sourceOf(m: ModelChoice) {
  // OpenCode names its own catalogue after itself ("OpenCode/Big Pickle"): that's OpenCode Zen, beside OpenCode Go.
  if (m.group) return m.group === "OpenCode" ? "OpenCode Zen" : m.group;
  const id = m.ref.slice(m.ref.indexOf(":") + 1);
  const at = id.indexOf("/");
  if (at < 1) return "";
  const key = id.slice(0, at).toLowerCase();
  return SOURCE_NAMES[key] ?? key.replace(/(^|[-_])(\w)/g, (_, sep: string, c: string) => `${sep ? " " : ""}${c.toUpperCase()}`);
}

export function ModelPicker({ value, also = [], onPick, only, height = 320, autoFocus, foot, extra, onTab }: Props) {
  const providers = useEngine((s) => s.providers);
  const favs = useEngine((s) => s.settings.favoriteModels) ?? [];
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  const tools = useMemo(() => providers.filter((p) => p.available && p.adapter && p.models.length && (showDemo || p.id !== "demo") && (!only || only(p))), [providers, only, showDemo]);
  const models = useMemo(() => allModels(tools), [tools]);
  const start = value ? value.slice(0, value.indexOf(":")) : undefined;
  const [rail, setRail] = useState<string>(() => (extra?.open ? extra.id : favs.length && !value ? "fav" : (tools.find((p) => p.id === start)?.id ?? tools[0]?.id ?? "fav")));
  const onExtra = extra !== undefined && rail === extra.id;
  useEffect(() => onTab?.(rail), [rail]);
  const [query, setQuery] = useState("");
  // The source open in a tool with several: the picked model's, else none yet (the sources show).
  const [source, setSource] = useState<string | null>(() => {
    const m = value ? models.find((x) => x.ref === value) : undefined;
    return m ? sourceOf(m) : null;
  });
  const [older, setOlder] = useState<Set<string>>(() => new Set(value && models.find((m) => m.ref === value)?.legacy ? [start ?? ""] : []));
  const [hl, setHl] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, []);

  const toolOf = (id: string) => tools.find((p) => p.id === id);
  const lines = useMemo((): Line[] => {
    const q = query.trim().toLowerCase();
    if (q) {
      const hit = models.filter((m) => `${m.label} ${m.ref} ${m.group ?? ""} ${m.provider} ${m.description}`.toLowerCase().includes(q)).slice(0, 80);
      return hit.map((m) => ({ kind: "row", m, sub: [m.provider, m.group].filter(Boolean).join(" · ") }));
    }
    if (rail === "fav") return favs.flatMap((ref) => models.filter((m) => m.ref === ref)).map((m) => ({ kind: "row", m, sub: [m.provider, m.group].filter(Boolean).join(" · ") }));
    const all = models.filter((m) => m.providerId === rail);
    // The biggest sources first; models no source claims come last, as Other.
    const count = (name: string) => all.filter((m) => !m.legacy && sourceOf(m) === name).length;
    const sources = [...new Set(all.filter((m) => !m.legacy).map(sourceOf))].sort((x, y) => Number(!x) - Number(!y) || count(y) - count(x));
    const stepped = sources.length > 1 && (sources.filter(Boolean).length > 1 || all.length > SOURCES_FROM);
    if (stepped && (source === null || !sources.includes(source)))
      return sources.map((name): Line => {
        const of = all.filter((m) => sourceOf(m) === name && !m.legacy);
        return { kind: "source", name, n: of.length, refs: of.map((m) => m.ref) };
      });
    const mine = stepped ? all.filter((m) => sourceOf(m) === source) : all;
    const now = mine.filter((m) => !m.legacy);
    const old = mine.filter((m) => m.legacy);
    const out: Line[] = stepped ? [{ kind: "back", tool: toolOf(rail)?.label ?? rail, name: source || "Other" }] : [];
    // A tool that reports models from several places (Hermes's providers) gets a heading for each.
    let group: string | undefined;
    for (const m of [...now].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || 0)) {
      if (!stepped && m.group && m.group !== group) out.push({ kind: "head", text: sourceOf(m) });
      group = m.group;
      out.push({ kind: "row", m, sub: m.description });
    }
    if (old.length) {
      const open = older.has(rail);
      out.push({ kind: "fold", provider: rail, n: old.length, open });
      if (open) for (const m of old) out.push({ kind: "row", m, sub: m.description });
    }
    return out;
  }, [models, rail, query, favs.join(), older, source]);
  const rows = lines.flatMap((l) => (l.kind === "row" ? [l.m] : []));
  useEffect(() => setHl(Math.max(0, rows.findIndex((m) => m.ref === value))), [rail, query, source]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-hl]")?.scrollIntoView({ block: "nearest" });
  }, [hl]);

  const star = (ref: string) => {
    const next = favs.includes(ref) ? favs.filter((x) => x !== ref) : [...favs, ref];
    void rpc("settings.save", { favoriteModels: next }).catch((e) => toast.error(String(e?.message ?? e)));
  };
  const keys = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const m = rows[Number(e.key) - 1];
      if (m) {
        e.preventDefault();
        onPick(m.ref, { shiftKey: e.shiftKey });
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHl((h) => Math.max(0, Math.min(rows.length - 1, h + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && rows[hl]) {
      // On a button in the list (another row, a star, a fold, a source) Enter presses that one, not the lit row.
      if (e.target instanceof Element && e.target.closest(".lc-mp-list button")) return;
      e.preventDefault();
      onPick(rows[hl].ref, { shiftKey: e.shiftKey });
    }
  };

  if (!tools.length) return <p className="lc-quiet lc-mp-none">No tool is signed in yet. Settings, Models connects one.</p>;
  let n = 0;
  return (
    <div className="lc-mp" style={{ "--lc-mp-max": `${height}px` } as CSSProperties} onKeyDown={keys}>
      <div className="lc-mp-rail" role="tablist" aria-label="Tools">
        <button type="button" role="tab" className="lc-mp-tool l-focus" aria-selected={rail === "fav" && !query} title="Starred models" onClick={() => (setRail("fav"), setQuery(""))}>
          <I.star size={14} />
        </button>
        <span className="lc-mp-sep" aria-hidden />
        {tools.map((p) => (
          <button key={p.id} type="button" role="tab" className="lc-mp-tool l-focus" aria-selected={rail === p.id && !query} title={`${p.label}${p.modelsFrom === "cli" ? `, ${p.models.length} models it reported` : ""}`} onClick={() => {
              setRail(p.id);
              setQuery("");
              // Into this tool at the picked model's source, if it's this tool's; else at its sources.
              const picked = models.find((m) => m.ref === value && m.providerId === p.id);
              setSource(picked ? sourceOf(picked) : null);
            }}>
            {/* Each tool by its maker's mark; an added agent nobody's list knows keeps its initial. */}
            {markOf(`${p.id}:`) === "other" ? <span className="lc-mp-ini">{INITIALS[familyOf(p.id)] ?? p.label[0]}</span> : <ModelMark kind={markOf(`${p.id}:`)} size={15} />}
            {p.account && <span className="lc-mp-acct">{p.account[0].toUpperCase()}</span>}
          </button>
        ))}
        {extra && (
          <>
            <span className="lc-mp-sep" aria-hidden />
            <button type="button" role="tab" className="lc-mp-tool l-focus" aria-selected={onExtra} title={extra.label} onClick={() => (setRail(extra.id), setQuery(""))}>
              {extra.icon}
            </button>
          </>
        )}
      </div>
      <div className="lc-mp-main">
        {onExtra ? (
          <>
            {/* Where the search sits on a tool's tab, the tab's name, so the rows below don't jump. */}
            <div className="lc-mp-xhead">{extra.label}</div>
            <div className="lc-mp-list">{extra.body}</div>
          </>
        ) : (
          <>
            <div className="lc-mp-find">
              <I.search size={13} />
              <input ref={field} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={rail === "fav" || query ? "Find a model" : `Find a model in ${toolOf(rail)?.label ?? "all tools"}`} aria-label="Find a model" spellCheck={false} />
              {rail !== "fav" && !query && toolOf(rail)?.modelsFrom === "cli" && <span className="lc-mp-src" title="Asked of the tool itself">{toolOf(rail)?.models.length}</span>}
            </div>
            <div ref={list} className="lc-mp-list" role="listbox" aria-label="Models">
              {lines.length === 0 && <p className="lc-quiet lc-mp-none">{query ? "No model matches that." : rail === "fav" ? "Star a model and it waits here, in every picker." : "This tool reported no models."}</p>}
              {lines.map((l, i) => {
                if (l.kind === "head") return <div key={`h${i}`} className="lc-mp-head">{l.text}</div>;
                if (l.kind === "source")
                  return (
                    <button key={`s${l.name}`} type="button" className="lc-mp-source l-focus" data-on={(value && l.refs.includes(value)) || undefined} onClick={() => setSource(l.name)}>
                      {/* The source's own logo (Nous Portal, OpenCode Go), else a plain mark. */}
                      <span className="lc-mp-srcmark">
                        <ModelMark kind={sourceMarkOf(l.name)} size={15} />
                      </span>
                      <span className="lc-mp-t">
                        <b>{l.name || "Other"}</b>
                        <small>{l.n === 1 ? "1 model" : `${l.n} models`}</small>
                      </span>
                      {/* Whose models it runs, as marks. */}
                      <span className="lc-mp-marks">
                        {[...new Set(l.refs.map(markOf))].slice(0, 5).map((k) => (
                          <ModelMark key={k} kind={k} size={12} />
                        ))}
                      </span>
                      <I.chevR size={12} />
                    </button>
                  );
                if (l.kind === "back")
                  return (
                    <button key="back" type="button" className="lc-mp-back l-focus" onClick={() => setSource(null)}>
                      <I.chevL size={12} />
                      <ModelMark kind={sourceMarkOf(l.name)} size={12} />
                      <span>
                        {l.tool} <b>{l.name}</b>
                      </span>
                    </button>
                  );
                if (l.kind === "fold")
                  return (
                    <button key={`f${i}`} type="button" className="lc-mp-fold l-focus" aria-expanded={l.open} onClick={() => setOlder((o) => (o.has(l.provider) ? new Set([...o].filter((x) => x !== l.provider)) : new Set(o).add(l.provider)))}>
                      <span>
                        <b>Older models</b>
                        <small>{l.n} still run</small>
                      </span>
                      <I.chevR size={12} />
                    </button>
                  );
                const k = n++;
                const on = l.m.ref === value;
                const fav = favs.includes(l.m.ref);
                return (
                  <div key={l.m.ref} className="lc-mp-row" data-on={on || undefined} data-also={also.includes(l.m.ref) || undefined} data-hl={k === hl || undefined} onMouseEnter={() => setHl(k)}>
                    <button type="button" role="option" aria-selected={on} className="lc-mp-pick l-focus" onClick={(e) => onPick(l.m.ref, { shiftKey: e.shiftKey })} title={l.m.description || undefined}>
                      <span className="lc-mp-t">
                        <b>
                          <ModelTag kind={markOf(l.m.ref)} label={l.m.label} size={12} />
                          {l.m.isDefault && <span className="lc-mp-def">Default</span>}
                        </b>
                        {l.sub && <small>{l.sub}</small>}
                      </span>
                      {k < 9 && <kbd className="lc-kbd lc-mp-key">{os.mod}{k + 1}</kbd>}
                    </button>
                    <button type="button" className="lc-mp-star l-focus" data-on={fav || undefined} aria-label={fav ? `Unstar ${l.m.label}` : `Star ${l.m.label}`} aria-pressed={fav} onClick={() => star(l.m.ref)}>
                      <I.star size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {foot && <div className="lc-mp-foot">{foot}</div>}
      </div>
    </div>
  );
}

/**
  A model as a chip that opens the same picker as the composer's: the rail of tools, the search,
  stars and older models folded. `choices` sit above the models for picks that aren't a model
  ("Another model family", "Nobody"); `value` is then one of their ids or a model ref.
*/
export function ModelPop({ label, value, onPick, only, choices = [], width = 400, align = "end" }: { label: string; value?: string; onPick: (v: string) => void; only?: (p: ProviderInfo) => boolean; choices?: { id: string; title: string; note?: string; show?: ReactNode; icon?: ReactNode }[]; width?: number; align?: "start" | "end" }) {
  const providers = useEngine((s) => s.providers);
  const choice = choices.find((c) => c.id === value);
  const model = !choice && value ? allModels(providers).find((m) => m.ref === value) : undefined;
  return (
    <Pop
      label={label}
      width={width}
      align={align}
      triggerClass="lc-mpop"
      trigger={
        <>
          {choice ? (choice.show ?? <span>{choice.title}</span>) : value ? <ModelTag kind={markOf(value)} label={model?.label ?? value.slice(value.indexOf(":") + 1)} size={12} /> : <span className="lc-quiet">Pick a model</span>}
          <I.chevD size={11} />
        </>
      }
    >
      {(close) => (
        <>
          {choices.length > 0 && (
            <>
              {choices.map((c) => (
                <Row key={c.id} title={c.title} note={c.note} icon={c.icon} on={value === c.id} onPick={() => (onPick(c.id), close())} />
              ))}
              <Sep />
            </>
          )}
          <ModelPicker value={model?.ref} only={only} height={choices.length ? 280 : 330} autoFocus onPick={(ref) => (onPick(ref), close())} />
        </>
      )}
    </Pop>
  );
}

/** The effort levels for a model, as rows: the tool's levels, then Claude Code's extras apart. */
export function EffortRows({ modelRef, value, onPick }: { modelRef: string; value: string; onPick: (id: string) => void }) {
  const providers = useEngine((s) => s.providers);
  const { list, fallback } = effortsFor(modelRef, providers);
  if (!list.length) return <PanelHead>This model takes no effort level</PanelHead>;
  const levels = list.filter((e) => !EXTRA_EFFORTS.has(e.id));
  const extras = list.filter((e) => EXTRA_EFFORTS.has(e.id));
  const row = (e: (typeof list)[number]) => <Row key={e.id} title={e.label} note={e.description} on={value === e.id} end={e.id === fallback ? <span className="lc-mp-def">Default</span> : undefined} onPick={() => onPick(e.id)} />;
  return (
    <>
      <PanelHead>How hard it thinks</PanelHead>
      {levels.map(row)}
      {extras.length > 0 && (
        <>
          <Sep />
          {extras.map(row)}
        </>
      )}
    </>
  );
}

/** A button with the effort, opening its menu. Disabled for a model that takes no level. */
export function EffortPick({ modelRef, value, onChange, side = "bottom", keep, triggerClass = "lc-pb", icon = true, hideEmpty }: { modelRef: string; value: string; onChange: (id: string) => void; side?: "top" | "bottom"; keep?: boolean; triggerClass?: string; icon?: boolean; hideEmpty?: boolean }) {
  const providers = useEngine((s) => s.providers);
  const { list, fallback } = effortsFor(modelRef, providers);
  if (!list.length && hideEmpty) return null;
  // A level this model doesn't take shows as the model's default, which is what will run.
  const shown = list.some((e) => e.id === value) ? value : (fallback ?? value);
  // "Medium effort": the composer's bar drops the word "effort" (app.css).
  const name = list.length ? effortName(shown, modelRef, providers) : "No effort setting";
  const [level, word] = name.endsWith(" effort") ? [name.slice(0, -7), " effort"] : [name, ""];
  return (
    <Pop
      label={`Effort: ${shown}. Change it`}
      side={side}
      keep={keep}
      width={290}
      triggerClass={triggerClass}
      disabled={!list.length}
      trigger={
        <>
          {icon && <I.effort size={14} />}
          <span className="lc-ctl-label">
            {level}
            {word && <span className="lc-effort-word">{word}</span>}
          </span>
          {list.length > 0 && <I.chevD size={11} />}
        </>
      }
    >
      {(close) => <EffortRows modelRef={modelRef} value={shown} onPick={(id) => (onChange(id), close())} />}
    </Pop>
  );
}
