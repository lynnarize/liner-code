/*
  Whose model it is, for the model picker, tags and the turn margin. Liner Code draws its own
  neutral marks (a letter on a tile, in the current ink) rather than the makers' logos, which are
  their trademarks; the name beside the mark says the rest.
*/
export type Brand = "claude" | "openai" | "gemini" | "grok" | "deepseek" | "qwen" | "mistral" | "meta" | "kimi" | "glm" | "minimax" | "cursor" | "opencode" | "hermes" | "ollama";

/** Each maker's name, and the letters on its tile (one where it's clear, two where letters meet). */
export const BRANDS: Record<Brand, { name: string; letters: string }> = {
  claude: { name: "Claude", letters: "C" },
  openai: { name: "OpenAI", letters: "O" },
  gemini: { name: "Gemini", letters: "G" },
  grok: { name: "Grok", letters: "X" },
  deepseek: { name: "DeepSeek", letters: "D" },
  qwen: { name: "Qwen", letters: "Q" },
  mistral: { name: "Mistral", letters: "M" },
  meta: { name: "Llama", letters: "L" },
  kimi: { name: "Kimi", letters: "K" },
  glm: { name: "GLM", letters: "Z" },
  minimax: { name: "MiniMax", letters: "Mx" },
  cursor: { name: "Cursor", letters: "Cu" },
  opencode: { name: "OpenCode", letters: "Oc" },
  hermes: { name: "Hermes", letters: "H" },
  ollama: { name: "Ollama", letters: "Ol" },
};
