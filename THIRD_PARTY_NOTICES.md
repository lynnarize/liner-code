# Third-party notices

Liner Code is MIT-licensed (see `LICENSE`), including its copy of Liner UI in `ui/src/liner`.
The app as built also contains the software below, each under its own terms.

| What | Version | Licence | Where it comes in |
| --- | --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 44.9.3 | MIT | The app's shell. It bundles Chromium and Node.js, whose licences ship inside the app as `Contents/Resources/LICENSES.chromium.html` (Electron's own as `LICENSE.electron`) |
| [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) | 0.3.x | © Anthropic PBC, all rights reserved; use is governed by [Anthropic's Commercial Terms](https://www.anthropic.com/legal/commercial-terms) | The engine drives Claude Code through it. **Not** covered by Liner Code's MIT licence. Its own Claude Code binary is left out: the engine runs the `claude` you installed |
| [React](https://github.com/facebook/react), React DOM | 19.x | MIT, © Meta Platforms, Inc. and affiliates | The app's pages |
| [xterm.js](https://github.com/xtermjs/xterm.js), @xterm/addon-fit | 6.x, 0.11.x | MIT, © The xterm.js authors | The Terminal surface |
| [Instrument Sans](https://github.com/Instrument/instrument-sans) (via Fontsource) | 5.x | SIL Open Font License 1.1 | The app's text face |
| [Geist Mono](https://github.com/vercel/geist-font) (via Fontsource) | 5.x | SIL Open Font License 1.1, © Vercel | Code and numbers |
| [Lobe Icons](https://github.com/lobehub/lobe-icons) (@lobehub/icons-static-svg) | 1.101.0 | MIT, © LobeHub | The drawings of the makers' and tools' logos, one colour, in `ui/src/app/brands.ts` |

DeepSeek Harness plugins run under a loader, a set of design tokens and a host shaped after
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT, © 2026 DeepSeek): the
token names and DSH's radius and type values in `contracts/src/dsh.ts` come from its
`packages/client/ui-theme/src/styles/design-platform.css`, and the module loader, slots and host
services follow its `packages/client/modules`, `packages/host/webserver` and `packages/llm` contracts.
The tools service, `defineTool` and its schema rules in `engine/src/dsh-host.ts` and
`engine/src/dsh-shims.ts`, with some of their error messages, and the web_search and web_fetch
descriptions, follow its `packages/core/tools` and `packages/web` packages.
Its licence is below.

Ideas came from [T3 Code](https://github.com/pingdotgg/t3code) (MIT) and
[Hermes Agent](https://github.com/nousresearch/hermes-agent) (MIT); no code was copied from either.

## Names of other products

Claude, Claude Code, Codex, OpenAI, Gemini, Grok, DeepSeek, Qwen, Kimi, GLM, MiniMax, Cursor,
OpenCode, Hermes and the other tool and model names and logos in the app are trademarks of their
owners. Liner Code shows them only to say which tool or model does the work, and it isn't made,
endorsed or supported by any of them.

## DeepSeek Harness's licence

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
