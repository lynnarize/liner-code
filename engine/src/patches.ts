/*
  Declarative layered configuration patches (inspired by DeepSeek Harness's cordis.patch overlays).
  Reads optional `~/.liner/patch.json` (user layer) and `<project>/.liner/patch.json` (project layer),
  merging only allowlisted runtime fields so projects and power users can customize presets, subagent
  limits, sidekick context mode, worktree layout, spend caps, and permission rules without editing state.json.
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PermissionRule } from "../../contracts/src/index.ts";

export type LayeredPatch = {
  toolPreset?: "standard" | "lean";
  sidekickContext?: "isolated" | "fork";
  maxActiveSubagents?: number;
  worktreePlace?: "sibling" | "inside";
  spendLimit?: number;
  permissionRules?: PermissionRule[];
};

function readPatchFile(file: string): LayeredPatch {
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return {};
    const out: LayeredPatch = {};
    if (raw.toolPreset === "standard" || raw.toolPreset === "lean") out.toolPreset = raw.toolPreset;
    if (raw.sidekickContext === "isolated" || raw.sidekickContext === "fork") out.sidekickContext = raw.sidekickContext;
    if (typeof raw.maxActiveSubagents === "number" && Number.isFinite(raw.maxActiveSubagents)) {
      out.maxActiveSubagents = Math.max(1, Math.min(8, Math.round(raw.maxActiveSubagents)));
    }
    if (raw.worktreePlace === "sibling" || raw.worktreePlace === "inside") out.worktreePlace = raw.worktreePlace;
    if (typeof raw.spendLimit === "number" && Number.isFinite(raw.spendLimit) && raw.spendLimit >= 0) out.spendLimit = raw.spendLimit;
    if (Array.isArray(raw.permissionRules)) {
      out.permissionRules = raw.permissionRules.filter(
        (r): r is PermissionRule =>
          Boolean(r) &&
          typeof r === "object" &&
          ((r as PermissionRule).kind === "command" || (r as PermissionRule).kind === "path") &&
          typeof (r as PermissionRule).pattern === "string" &&
          Boolean((r as PermissionRule).pattern.trim()) &&
          ((r as PermissionRule).action === "allow" || (r as PermissionRule).action === "ask" || (r as PermissionRule).action === "deny"),
      );
    }
    return out;
  } catch {
    return {};
  }
}

/**
  Loads and merges user (`<home>/patch.json`) and project (`<projectPath>/.liner/patch.json`) patches; project wins.
  A project's file comes with the repository, so it may only tighten what agents may do: its `allow` rules are dropped,
  or any repository you clone could let its own commands run without asking you.
*/
export function loadLayeredPatch(home: string, projectPath?: string): LayeredPatch {
  const user = readPatchFile(join(home, "patch.json"));
  const proj = projectPath ? readPatchFile(join(projectPath, ".liner", "patch.json")) : {};
  const rules = [...(user.permissionRules ?? []), ...(proj.permissionRules ?? []).filter((r) => r.action !== "allow")];
  return {
    ...user,
    ...proj,
    ...(rules.length ? { permissionRules: rules } : {}),
  };
}
