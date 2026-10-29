/*
  Routed sessions, after GitHub Copilot's Fusion. Fusion's router scores each message on four
  things (reasoning, writing code, debugging, using tools), then rules in order turn the scores
  into a pattern and who plays each part; the first rule that fits wins. Liner Code scores from
  the message's own words, so routing costs nothing, takes no time and sends nothing anywhere.
  The runtime runs what this decides.

  A follow-up while the last turn's cache is still warm stays with the model that's working,
  unless the job changed size, the way Fusion reuses its primary model instead of routing again.
*/
import type { RouteCast, RouteLevel, RoutePattern, RouteWeight, ThreadRoute } from "../../contracts/src/index.ts";

/** How long a provider keeps a conversation's prompt cache after a turn. */
export const WARM_MS = 5 * 60_000;

export type Scores = { reasoning: number; codeGen: number; debugging: number; toolUse: number; breadth: number; parts: number; talk: boolean; small: boolean };

/** What a message gets: its pattern, who writes it, who judges or critiques it, and the rule that matched. */
export type Decision = { pattern: RoutePattern; weight: RouteWeight; writer: string; judge?: string; repair?: string; critics: string[]; rule: string; talk: boolean; reuse: boolean };

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** A message's four scores like Fusion's, how far it reaches, and whether it's talk or a small change, from its words. */
export function scoreAsk(text: string): Scores {
  const s = text.toLowerCase().trim();
  const words = s.split(/\s+/).filter(Boolean).length;
  const trace = /^\s+at .+[:(]\d+/m.test(text) || /traceback \(most recent call last\)/i.test(text) || /\b\w*(error|exception):/i.test(text) || /^\s*(error|fatal|panic)\b/im.test(text);
  const fences = Math.floor(count(text, /```/g) / 2);
  const files = new Set(text.match(/[\w./-]+\.(?:tsx?|jsx?|py|rs|go|swift|kt|java|rb|s?css|html|json|ya?ml|toml|md|sql|sh|c|cc|cpp|h|mm?)\b/gi) ?? []).size;
  const bullets = count(text, /^\s*(?:[-*•]|\d+[.)])\s+/gm);
  const change = /\b(add|implement|fix|change|update|refactor|create|build|write|remove|delete|rename|make|move|replace|migrate|convert|port|set ?up|wire|hook ?up|support|handle|improve|clean ?up|extract|split|rewrite|redesign)\b/.test(s);
  const asks = /^(what|why|how|where|when|which|who|whose|is|are|was|were|does|do|did|can you (explain|tell)|could you (explain|tell)|explain|tell me|describe|summari[sz]e|walk me through)\b/.test(s) || /\?$/.test(s);
  const greet = /^(hi|hello|hey|thanks|thank you|ok|okay|cool|nice|great|good)\b[\s!.]*$/.test(s);
  // Bugs that hide (timing, leaks, flakiness) count twice: they're where a quick model's fix looks right and isn't.
  const subtle = count(s, /\b(race\w*|deadlock\w*|intermittent\w*|flak\w*|non-?deterministic|sometimes|randomly|memory leak\w*|concurren\w*|thread-?safe\w*)\b/g);
  const reasoning = clamp(count(s, /\b(architect\w*|design\w*|refactor\w*|restructur\w*|migrat\w*|trade-?offs?|strateg\w*|algorithm\w*|optimi[sz]\w*|performance|secur\w*|auth\w*|permissions? model|sandbox\w*|plugin system|scal\w*|consisten\w*|invariant\w*|abstraction\w*|protocol\w*|state machine|schema\w*|layers?|base class|unif\w*|consolidat\w*|decoupl\w*|why)\b/g) * 0.3 + subtle * 0.45 + (words > 120 ? 0.2 : 0) + (bullets >= 4 ? 0.15 : 0));
  const debugging = clamp(count(s, /\b(fix\w*|bugs?|broken|breaks?|crash\w*|errors?|exceptions?|fail\w*|regression\w*|flak\w*|wrong|hang\w*|leak\w*|freez\w*|stuck|undefined|null|nan)\b|(does ?n['o]t|is ?n['o]t|not) work\w*/g) * 0.2 + (trace ? 0.45 : 0));
  const codeGen = clamp(count(s, /\b(add|implement\w*|creat\w*|build|write|generat\w*|scaffold\w*|features?|endpoints?|components?|pages?|screens?|apis?|functions?|class(es)?|modules?|tests?|support)\b/g) * 0.18 + fences * 0.15);
  const toolUse = clamp(count(s, /\b(run|install\w*|deploy\w*|compil\w*|docker|ci|pipelines?|scripts?|terminal|commands?|git|release\w*|benchmark\w*|browser|simulator|databases?|npm|pnpm|yarn|bun|cargo|pytest|xcodebuild|lint\w*|typecheck\w*)\b/g) * 0.18);
  const breadth = clamp((files >= 3 ? 0.35 : files * 0.1) + count(s, /\b(all|every\w*|across|whole|entire|throughout|codebase|project-wide|everywhere|end-to-end)\b/g) * 0.18 + (words > 250 ? 0.3 : words > 120 ? 0.15 : 0) + (bullets >= 4 ? 0.2 : bullets * 0.04));
  // Docs count as small only on their own: "add a function and list it in the README" is code.
  const code = new Set(text.match(/[\w./-]+\.(?:tsx?|jsx?|py|rs|go|swift|kt|java|rb|s?css|html|sql|sh|c|cc|cpp|h|mm?)\b/gi) ?? []).size > 0 || /\b(functions?|class(es)?|methods?|components?|endpoints?|tests?)\b/.test(s);
  const docs = !code && /\b(changelog|readme|docs?|documentation|release notes)\b/.test(s);
  const small = !trace && words <= 30 && !/\b(all|every\w*|across|whole|entire)\b/.test(s) && (docs || /\b(typo|rename|wording|copy|comment|bump|version|spelling|whitespace|indent\w*|format\w*|label|title|colou?r|padding|margin|text|string|log line|import)\b/.test(s));
  return { reasoning, codeGen, debugging, toolUse, breadth, parts: trace ? 0 : bullets, talk: greet || (asks && !change && !trace), small };
}

/**
  How big a job the scores say. Talk and small changes are light; any other change is at least
  medium, so something reads it; reasoning and reach make it heavy, and so does a spec in four
  parts or more. A crash with a stack trace says where to look, so debugging alone counts for little.
*/
export function weightOf(x: Scores): RouteWeight {
  if (x.talk || x.small) return "light";
  const hard = x.reasoning * 0.55 + x.breadth * 0.4 + Math.max(x.debugging, x.codeGen) * 0.1 + x.toolUse * 0.05;
  return hard >= 0.45 || x.parts >= 4 ? "heavy" : "medium";
}

type Plan = Pick<Decision, "pattern" | "writer" | "judge" | "repair" | "critics">;
const single = (writer: string): Plan => ({ pattern: "single", writer, critics: [] });
const cascade = (c: RouteCast): Plan => ({ pattern: "cascade", writer: c.everyday, judge: c.judge, repair: c.strong, critics: [] });
const critique = (c: RouteCast, n: number): Plan => ({ pattern: "critique", writer: c.strong, critics: c.critics.slice(0, n) });

/** Fusion's local policy: rules in order, the first that fits wins. Its name says why, on the timeline. */
const RULES: { name: string; when: (level: RouteLevel, weight: RouteWeight, s: Scores) => boolean; then: (c: RouteCast) => Plan }[] = [
  { name: "A hard question", when: (l, _, s) => s.talk && l !== "standard" && s.reasoning >= 0.4, then: (c) => single(c.strong) },
  { name: "A question", when: (_, __, s) => s.talk, then: (c) => single(c.everyday) },
  { name: "A hard job", when: (l, w) => l === "standard" && w === "heavy", then: (c) => single(c.strong) },
  { name: "One model a message", when: (l) => l === "standard", then: (c) => single(c.everyday) },
  { name: "A small, clear job", when: (l, w) => l === "high" && w === "light", then: (c) => single(c.everyday) },
  { name: "A medium job", when: (l, w) => l === "high" && w === "medium", then: cascade },
  { name: "A hard job", when: (l, w) => l === "high" && w === "heavy", then: (c) => critique(c, 1) },
  { name: "The hardest kind of job", when: (l, w) => l === "max" && w === "heavy", then: (c) => critique(c, 2) },
  { name: "A medium job", when: (l, w) => l === "max" && w === "medium", then: (c) => critique(c, 1) },
  { name: "A light job, checked", when: () => true, then: cascade },
];

/** What this message gets in a routed session. */
export function decide(text: string, route: ThreadRoute, now = Date.now()): Decision {
  const s = scoreAsk(text);
  const weight = weightOf(s);
  const { cast, level, last, root } = route;
  const warm = Boolean(last && now - last.at < WARM_MS);
  // Questions about the work go to whoever is doing it; more of a job the strong model just repaired stays with it.
  if (warm && s.talk) return { ...single(root), weight, rule: "A question about the work so far", talk: true, reuse: true };
  if (warm && last?.escalated && weight === last.weight && root === cast.strong) return { ...single(root), weight, rule: "More of the job it just repaired", talk: false, reuse: true };
  const rule = RULES.find((r) => r.when(level, weight, s))!;
  return { ...rule.then(cast), weight, rule: rule.name, talk: s.talk, reuse: false };
}

/** The line on the timeline that says what the route chose, and why. */
export function hintOf(d: Decision, label: (ref: string) => string) {
  const w = label(d.writer);
  const why = d.rule.charAt(0).toLowerCase() + d.rule.slice(1);
  if (d.pattern === "single") return `Routed: ${why}, so ${w} ${d.talk ? "answers" : "does it"} alone${d.talk ? "" : ", unchecked"}.`;
  if (d.pattern === "cascade") return `Routed: ${why}. ${w} does it, then ${label(d.judge!)} judges the change: it passes, or ${d.repair === d.judge ? "it" : label(d.repair!)} repairs it.`;
  const critics = [...new Set(d.critics.map(label))];
  const readers = d.critics.length > 1 && critics.length === 1 ? `${critics[0]} reads it twice` : `${critics.join(" and ")} read${critics.length === 1 ? "s" : ""} it`;
  return `Routed: ${why}. ${w} does it, ${readers}, and ${w} revises once with what ${d.critics.length > 1 ? "they" : "it"} found.`;
}
