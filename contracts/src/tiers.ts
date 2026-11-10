/*
  The model lists casting reads (cast.ts), as data: who made a model, by its name, and the tier
  list a pair is filled from. Edit these when a new model comes out; the logic stays in cast.ts.
*/
import type { BuiltinProvider } from "./index.ts";

/**
  Who made a model, from its name first ("deepseek-v4-pro" through Claude Code's endpoint is
  DeepSeek's, "nous:openai/gpt-6-astra" through Hermes is OpenAI's), else from the tool it runs
  in. The Reviewer reads best from another maker than the writer's, so the two don't share blind spots.
*/
export type Maker = "anthropic" | "openai" | "google" | "xai" | "deepseek" | "zhipu" | "moonshot" | "qwen" | "minimax" | "xiaomi" | "other";
export const MAKERS: [Maker, RegExp][] = [
  ["deepseek", /deepseek/i],
  ["zhipu", /glm|z-ai|zhipu/i],
  ["moonshot", /kimi|moonshot/i],
  ["qwen", /qwen|qwq/i],
  ["minimax", /minimax/i],
  ["xiaomi", /mimo/i],
  ["google", /gemini|gemma/i],
  ["xai", /grok/i],
  ["anthropic", /claude|opus|sonnet|haiku|fable/i],
  ["openai", /gpt|openai|astra|\bsol\b|luna|terra|\bo[1-9]\b|codex/i],
];

/**
  The tier list, from Artificial Analysis (November 2026: Terminal-Bench 4.0, FrontierCode v1.1,
  and cost per Intelligence Index task). FRONTIER ranks who leads, best first; QUICKER ranks the
  quicker models a sidekick is, the cheapest that does the work well first. Each row is a maker
  and its models by name, so a pair fills from whatever you have: Claude Code or Codex, or only
  OpenCode, Hermes, Gemini or an API endpoint. A model can sit in both (Sol): it works beside a
  stronger model, and leads when it's the best you have.
*/
export type Tier = [Maker, RegExp[]];
export const FRONTIER: Tier[] = [
  // S, Claude Code's and Codex's own: Opus 5.5 (Terminal-Bench 63, FrontierCode 56), GPT-6 Astra (56, 49).
  ["anthropic", [/opus/i]],
  ["openai", [/astra(?!.*(pro|fast|flex))/i, /astra(?!.*pro)/i]],
  // A: Fable 5.1 (58, 49, the dearest at $12.99 a task), Gemini 4 Carbon (64, 51) and Argon (56, 49), GPT-6.1 Sol (53, 49).
  ["anthropic", [/fable/i]],
  ["google", [/gemini.*ultra/i, /gemini.*carbon/i, /gemini.*argon/i, /gemini.*pro/i]],
  ["openai", [/sol(?!.*pro)/i, /sol/i, /gpt-[\d.]+$/i]],
  // B, behind the frontier: GLM-5.3 (40, 48) the best of the Chinese models, then DeepSeek V4 Pro.
  // DeepSeek V4.1 Flash (31, 47) sits here too, but it's a quicker model (QUICKER): with nothing above it, it does it all.
  ["zhipu", [/glm-[\d.]+(?!.*(flash|air|lite))/i]],
  ["deepseek", [/deepseek.*pro/i, /deepseek-[vr][\d.]+(?!.*(flash|lite|mini))/i]],
  ["moonshot", [/kimi.*pro/i, /kimi-k[\d.]+(?!.*(flash|turbo|code|mini))/i]],
  ["qwen", [/qwen.*max/i]],
  ["minimax", [/minimax-m[\d.]+(?!.*(flash|lite|mini))/i]],
  // Last: Grok 4.7 (33, 44) costs as much as Gemini ($7.77 a task) for less.
  ["xai", [/grok-[\d.]+(?!.*(fast|mini|code))/i]],
];
export const QUICKER: Tier[] = [
  // DeepSeek V4.1 Flash: just behind the frontier (FrontierCode 47) at $0.60 a task, cheaper than Sol and Sonnet, and it takes on anything.
  ["deepseek", [/deepseek.*flash/i]],
  // The workers in Codex and Claude Code: GPT-6.1 Sol (53, 49) at $1.27 a task, then Sonnet 5.5 (66, 48) at $10.02.
  ["openai", [/sol(?!.*pro)/i]],
  ["anthropic", [/sonnet/i]],
  // Quicker still: GPT-6.1 Terra (46, 45) at $0.96, GPT-6 Luna at $0.15.
  ["openai", [/terra/i, /luna(?!.*pro)/i, /luna/i]],
  ["google", [/gemini.*flash(?!.*lite)/i]],
  ["zhipu", [/glm.*(flash|air)/i]],
  ["qwen", [/qwen.*(plus|flash)/i]],
  ["moonshot", [/kimi.*(turbo|flash|code)/i]],
  ["minimax", [/minimax.*(flash|lite)/i]],
  ["xai", [/grok.*(fast|mini)/i]],
];

/**
  OpenCode Go's models, through OpenCode or Hermes, by their model id. Each counts against the
  plan's allowance at its own monthly limit: DeepSeek V4.1 Flash $100, the Flash models $60, every
  frontier-class model $15 to $30 at many times the price. So none of them leads (the heaviest
  part, on every turn); the cheapest quicker model does it all. The Reviewer reads every change, so
  it takes one of these only when no other model of another maker is ready (reviewerOf).
*/
export const CAPPED = /^opencode-go[/:]/i;

/** The tool a maker's models run best in: Claude Code for Claude, Codex for GPT. Others that list them come after. */
export const HOME: Partial<Record<Maker, BuiltinProvider>> = { anthropic: "claude", openai: "codex" };
