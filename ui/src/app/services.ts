/*
  API services you can add as an endpoint in one pick: where each answers, and the protocol it
  speaks there (so which tool runs it: Claude Code, Codex or OpenCode). Each address was checked
  against the service (its API answers there, asking for a key) when it went in; a service that
  speaks Anthropic's Messages is listed that way, since Claude Code then runs it with every tool
  it has. Models aren't listed: they change too often, and Find its models asks the service.
  Addresses as Kun's provider catalog (github.com/KunAgent/Kun) and each service's docs give them.
*/
import type { EndpointProtocol } from "@contracts";
import * as os from "./os";

export type Service = { id: string; label: string; protocol: EndpointProtocol; url: string; keys?: string; local?: boolean };

export const SERVICES: Service[] = [
  // Anthropic's Messages: through Claude Code.
  { id: "anthropic", label: "Anthropic API", protocol: "anthropic", url: "https://api.anthropic.com", keys: "https://console.anthropic.com/settings/keys" },
  { id: "deepseek", label: "DeepSeek", protocol: "anthropic", url: "https://api.deepseek.com/anthropic", keys: "https://platform.deepseek.com/api_keys" },
  { id: "kimi", label: "Kimi (Moonshot)", protocol: "anthropic", url: "https://api.moonshot.ai/anthropic", keys: "https://platform.moonshot.ai/console/api-keys" },
  { id: "zai", label: "GLM (Z.ai)", protocol: "anthropic", url: "https://api.z.ai/api/anthropic", keys: "https://z.ai/manage-apikey/apikey-list" },
  { id: "zhipu", label: "GLM (Zhipu, China)", protocol: "anthropic", url: "https://open.bigmodel.cn/api/anthropic", keys: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys" },
  { id: "minimax", label: "MiniMax", protocol: "anthropic", url: "https://api.minimax.io/anthropic", keys: "https://platform.minimax.io" },
  { id: "minimax-cn", label: "MiniMax (China)", protocol: "anthropic", url: "https://api.minimaxi.com/anthropic", keys: "https://platform.minimaxi.com" },
  // OpenAI's Responses: through Codex.
  { id: "openai", label: "OpenAI API", protocol: "responses", url: "https://api.openai.com/v1", keys: "https://platform.openai.com/api-keys" },
  { id: "xai", label: "xAI (Grok)", protocol: "responses", url: "https://api.x.ai/v1", keys: "https://console.x.ai/" },
  // Chat Completions: through OpenCode.
  { id: "openrouter", label: "OpenRouter", protocol: "chat", url: "https://openrouter.ai/api/v1", keys: "https://openrouter.ai/settings/keys" },
  { id: "gemini", label: "Google Gemini", protocol: "chat", url: "https://generativelanguage.googleapis.com/v1beta/openai", keys: "https://aistudio.google.com/apikey" },
  { id: "qwen", label: "Qwen (Alibaba Cloud)", protocol: "chat", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keys: "https://modelstudio.console.alibabacloud.com/" },
  { id: "qwen-cn", label: "Qwen (Alibaba Cloud, China)", protocol: "chat", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", keys: "https://bailian.console.aliyun.com/" },
  { id: "groq", label: "Groq", protocol: "chat", url: "https://api.groq.com/openai/v1", keys: "https://console.groq.com/keys" },
  { id: "mistral", label: "Mistral", protocol: "chat", url: "https://api.mistral.ai/v1", keys: "https://console.mistral.ai/api-keys" },
  { id: "together", label: "Together AI", protocol: "chat", url: "https://api.together.xyz/v1", keys: "https://api.together.ai/settings/api-keys" },
  { id: "fireworks", label: "Fireworks", protocol: "chat", url: "https://api.fireworks.ai/inference/v1", keys: "https://fireworks.ai/account/api-keys" },
  { id: "siliconflow", label: "SiliconFlow", protocol: "chat", url: "https://api.siliconflow.cn/v1", keys: "https://cloud.siliconflow.cn/account/ak" },
  { id: "nvidia", label: "NVIDIA NIM", protocol: "chat", url: "https://integrate.api.nvidia.com/v1", keys: "https://build.nvidia.com/settings/api-keys" },
  { id: "ollama-cloud", label: "Ollama Cloud", protocol: "chat", url: "https://ollama.com/v1", keys: "https://ollama.com/settings/keys" },
  // On this Mac: no key.
  { id: "lmstudio", label: "LM Studio", protocol: "chat", url: "http://localhost:1234/v1", local: true },
  { id: "ollama", label: "Ollama", protocol: "chat", url: "http://localhost:11434/v1", local: true },
  { id: "litellm", label: "LiteLLM proxy", protocol: "chat", url: "http://localhost:4000/v1", local: true },
  { id: "vllm", label: "vLLM, llama.cpp or another server", protocol: "chat", url: "http://localhost:8000/v1", local: true },
];

/** Where each kind sits in the picker. */
export const groupOf = (s: Service) => (s.local ? `On ${os.here}` : s.protocol === "anthropic" ? "Anthropic-compatible · through Claude Code" : s.protocol === "responses" ? "OpenAI Responses · through Codex" : "OpenAI-compatible · through OpenCode");
