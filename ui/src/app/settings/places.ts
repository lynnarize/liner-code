/*
  Settings' places: their ids, names and groups, the words a search finds each by, and where every old place went.
  Kept apart from Settings.tsx (no React here) so a test can read it. The groups are T3 Code's shape: a first and a
  last with no heading (the last at the foot of the column), and three named ones between.
*/

export type SettingsPage = "general" | "appearance" | "keyboard" | "tools" | "agents" | "fusion" | "permissions" | "projects" | "source" | "worktrees" | "mcp" | "addons" | "archive" | "about";
/** "" is the first group, "foot" the last; neither shows a heading. */
export type PlaceGroup = "" | "Agents" | "Code" | "Connections" | "foot";

export type Place = { id: SettingsPage; label: string; group: PlaceGroup; words: string; fresh?: boolean };

/** Each place: its name, where it sits, and the words a search finds it by (every setting on its page has some here). */
export const PLACES: Place[] = [
  { id: "general", label: "General", group: "", words: "opens open start starts launch design security canvas front end work style lead coder team model worktree checkout enter queue steer awake sleep setup first run done settle settled merge budget spend spending limit usage carry on reset restart send check precheck prompt draft split tasks unrelated subject quick haiku edits changed files share between turns anonymous usage counts analytics telemetry tokens install id opencode go key sign-in limits hermes demo notifications notify alert dock badge sound sounds feedback taskbar tray menu bar notification area" },
  { id: "appearance", label: "Appearance", group: "", words: "sea whale ascii ocean fish home behind dots dot dither dithered halftone mosaic pixel pixels wallpaper moon dusk aurora words shows in dark only light only theme themes vs code dark light mode system accent color colour glass tint clear solid composer message box background wallpaper picture image photo blur desktop see-through main button buttons action send primary red design designs page pages html panel inline chat motion animation animations animate move moves movement slide fade quick full reduce" },
  { id: "keyboard", label: "Keyboard", group: "", words: "keyboard shortcut shortcuts keys hotkey command keybindings json record" },
  { id: "tools", label: "Agent tools", group: "Agents", words: "models model tools provider claude codex opencode hermes cursor grok antigravity agy gemini install sign in key keys api billing bills plan anthropic openai voucher promo code redeem check checks doctor test health broken read only manual obey accounts account work personal router agents you added acp registry goose amp endpoints endpoint deepseek kimi glm minimax openrouter lm studio ollama pictures ai pictures image takes pictures models you added model id preview fine-tune" },
  { id: "agents", label: "Agents and modes", group: "Agents", words: "agent agents team helm forge lead coder soul effort new agent run helpers escalate opus mode modes preset presets standard workshop creator cordis custom default new task build make add-on addons plugin panel app" },
  { id: "fusion", label: "Fusion and review", group: "Agents", words: "agentic features fusion pair lead sidekick best fast start model frontier cheaper astra opus sonnet sol luna deepseek glm kimi qwen chinese opencode go hermes reviewer review check rounds small changes subagent subagents parallel concurrency workers teamwork swarm team" },
  { id: "permissions", label: "Permissions", group: "Agents", words: "safety permission permissions access auto manual full read only reviewer decides destructive guard rm force push sudo publish commit merge always asks rules rule glob globs deny allow ask command path" },
  { id: "projects", label: "Projects", group: "Code", words: "project projects folder repository add remove forget finder explorer starts with setup install worktree hook trust scripts run rules agents.md claude.md memory facts" },
  { id: "source", label: "Source control & issues", group: "Code", fresh: true, words: "source control git github gitlab bitbucket azure devops forgejo gitea tea fj cursor origin gh glab az cli sign in signed token app password linear issues issue tracker pull request pull requests pr prs merge method squash rebase last commit commits message messages style conventional template templates branch names branch prefix default branch keep pulled pull fast-forward refresh scan new pull requests security" },
  { id: "worktrees", label: "Worktrees", group: "Code", words: "git worktree worktrees start in a worktree layout inside the repo liner's folder where they live drive folder clean up in use snapshot snapshots checkpoint undo refs repositories git init" },
  { id: "mcp", label: "Liner MCP", group: "Connections", fresh: true, words: "liner mcp server outside agents outside liner code terminal claude code codex let them in apps app grok bot muse claude chatgpt connector connectors this mac internet tunnel tailscale funnel cloudflare address key keys revoke level levels read only asks first trusted webhook oauth sign-in reach" },
  { id: "addons", label: "Add-ons", group: "Connections", words: "addon addons add-on add-ons connection connections panel panels app apps mcp server servers plugin extension linear sentry version versions restore remove safe mode start without by hand manifest" },
  { id: "archive", label: "Archive", group: "foot", words: "archive archived sessions restore bring back delete for good" },
  { id: "about", label: "About and updates", group: "foot", words: "about updates update upgrade version release releases new download install restart github cli claude codex opencode hermes grok auto automatic data storage folder log engine log keychain keys version setup first run" },
];

export const PAGE_IDS = PLACES.map((p) => p.id);

/**
  Where every old place went (the fifteen places Settings had before it became a pop-up), and a few other names a place may be asked for by: an
  `lc:open-settings` event or a link from anywhere in the app still lands on the right page, and on the group the old
  place became when it is one of several on its new page (`at`, a Section's anchor).
*/
export const MOVED: Record<string, { page: SettingsPage; at?: string }> = {
  notifications: { page: "general", at: "notifications" },
  models: { page: "tools" },
  team: { page: "agents", at: "agents" },
  modes: { page: "agents", at: "modes" },
  agentic: { page: "fusion" },
  safety: { page: "permissions" },
  git: { page: "worktrees" },
  updates: { page: "about", at: "updates" },
  data: { page: "about", at: "data" },
  outside: { page: "mcp" },
  "liner-mcp": { page: "mcp" },
  sourcecontrol: { page: "source" },
  "source-control": { page: "source" },
};

/** The place, and the group on it, that a name asks for: a place's own id, an old one, or General for anything else. */
export function placeOf(name: unknown): { page: SettingsPage; at?: string } {
  const id = typeof name === "string" ? name.trim() : "";
  if ((PAGE_IDS as string[]).includes(id)) return { page: id as SettingsPage };
  return MOVED[id] ?? { page: "general" };
}

/** The places a search finds, in their order: those whose name or words hold what was typed. */
export function findPlaces(query: string): Place[] {
  const q = query.trim().toLowerCase();
  return PLACES.filter((p) => !q || `${p.label} ${p.words}`.toLowerCase().includes(q));
}
