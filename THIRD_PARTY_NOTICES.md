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

Ideas came from [T3 Code](https://github.com/pingdotgg/t3code) (MIT) and
[Hermes Agent](https://github.com/nousresearch/hermes-agent) (MIT); no code was copied from either.

## Names of other products

Claude, Claude Code, Codex, OpenAI, Gemini, Grok, Cursor, OpenCode, Hermes and the other tool and
model names in the app are trademarks of their owners. Liner Code uses them only to say which tool
or model does the work; it draws its own neutral marks rather than their logos, and it isn't made,
endorsed or supported by any of them.
