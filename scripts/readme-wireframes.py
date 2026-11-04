#!/usr/bin/env python3
# Draws the README's feature wireframes (.github/readme/*.svg): python3 scripts/readme-wireframes.py .github/readme
import sys, os
from html import escape as e

OUT = sys.argv[1]
W, H = 480, 300
C = dict(ground="#f4f5f7", paper="#ffffff", well="#f1f2f4", plate="#e8e9ec", ink="#1b1d22", ink2="#4a4f59",
         ink3="#8a8f99", ink4="#c3c6cc", hair="#e4e6ea", accent="#2f6fe4", act="#e2412f", ok="#1f9d55",
         warn="#de8a12", danger="#d64242", add="#e8f6ee", dele="#fbecec", violet="#7c5ce0")
FONT = "Instrument Sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"


def t(x, y, s, size=11, fill="ink", w=400, anchor="start", mono=False):
    return (f'<text x="{x}" y="{y}" font-family="{MONO if mono else FONT}" font-size="{size}" font-weight="{w}" '
            f'fill="{C.get(fill, fill)}" text-anchor="{anchor}" xml:space="preserve">{e(s)}</text>')


def r(x, y, w, h, fill="well", rx=8, stroke=None):
    s = f' stroke="{C.get(stroke, stroke)}" stroke-width="1"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{C.get(fill, fill)}"{s}/>'


def bar(x, y, w, fill="plate", h=6):
    return r(x, y, w, h, fill, h / 2)


def pill(x, y, label, kind="act", size=10.5, h=22):
    w = len(label) * size * 0.56 + 20
    fill, ink = {"act": ("act", "#fff"), "second": ("well", "ink"), "quiet": ("paper", "ink2"),
                 "accent": ("accent", "#fff"), "ok": ("add", "ok")}[kind]
    stroke = "hair" if kind == "quiet" else None
    return r(x, y, w, h, fill, h / 2, stroke) + t(x + w / 2, y + h / 2 + size * 0.36, label, size, ink, 500, "middle"), w


def pw(label, size=10.5):
    return len(label) * size * 0.56 + 20


def pr(xr, y, label, kind="act", size=10.5, h=22):
    return pill(xr - pw(label, size), y, label, kind, size, h)[0]


def dot(x, y, fill, rad=3.5):
    return f'<circle cx="{x}" cy="{y}" r="{rad}" fill="{C.get(fill, fill)}"/>'


def tick(x, y, fill="ok"):
    return (f'<circle cx="{x}" cy="{y}" r="7" fill="{C["add"] if fill == "ok" else C["well"]}"/>'
            f'<path d="M{x-3} {y} l2.2 2.2 l4-4.4" fill="none" stroke="{C[fill]}" stroke-width="1.6" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


def window(title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'<defs><clipPath id="c"><rect width="{W}" height="{H}" rx="14"/></clipPath></defs>'
            f'<g clip-path="url(#c)">{r(0, 0, W, H, "ground", 14)}'
            f'{dot(18, 17, "#ff5f57", 4.5)}{dot(33, 17, "#febc2e", 4.5)}{dot(48, 17, "#28c840", 4.5)}'
            f'{t(66, 21, title, 11, "ink3", 500)}'
            f'{r(10, 34, W - 20, H - 44, "paper", 10, "hair")}{body}</g>'
            f'{r(0.5, 0.5, W - 1, H - 1, "none", 13.5, "hair")}</svg>')


def bubble(text, y=50):
    w = len(text) * 6.3 + 24
    return r(W - 26 - w, y, w, 26, "well", 13) + t(W - 26 - w / 2, y + 17, text, 11.5, "ink", 400, "middle")


def head(x, y, name, note, glyph="accent"):
    return (f'<circle cx="{x + 8}" cy="{y}" r="8" fill="{C["ink"]}"/>'
            f'<circle cx="{x + 8}" cy="{y}" r="2.6" fill="{C[glyph] if glyph in C else glyph}"/>'
            + t(x + 22, y + 4, name, 11.5, "ink", 600) + t(x + 22 + len(name) * 6.6 + 6, y + 4, note, 10.5, "ink3"))


def save(name, svg):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(svg)


# 1. Plan, then build
b = bubble("Keep the last tide tables for offline use")
b += head(26, 98, "Planner", "Opus 5.5 · reads only")
b += r(26, 114, 428, 110, "well", 12)
b += t(42, 136, "Plan", 11, "ink3", 500) + t(438, 136, "3 steps · ~4 files", 10.5, "ink3", 400, "end")
for i, (s, w) in enumerate([("Cache the last table in storage", 0), ("Read it when the fetch fails", 0), ("Mark the card “offline”", 0)]):
    y = 158 + i * 24
    b += f'<circle cx="50" cy="{y - 4}" r="8" fill="{C["paper"]}" stroke="{C["hair"]}"/>' + t(50, y, str(i + 1), 9.5, "ink2", 600, "middle")
    b += t(66, y, s, 11.5, "ink")
b += head(26, 256, "Builder", "DeepSeek V4.1 Flash", "ok")
b += pr(454, 245, "Approve and build")
save("plan.svg", window("Plan, then build", b))

# 2. Every turn is a diff
b = t(26, 58, "src/tides.ts", 11, "ink", 500, mono=True) + t(140, 58, "+5 −1", 11, "ok", 600, mono=True)
b += t(454, 58, "Turn 3", 10.5, "ink3", 400, "end")
rows = [(" ", "export function nextHigh(t, now) {"), ("-", "  return t.find(h => h.at > now)"),
        ("+", "  const next = t.find(h => h.at > now)"), ("+", "  if (next) return next"),
        ("+", "  // past midnight: tomorrow's first"), ("+", "  return { ...t[0], tomorrow: true }"),
        (" ", "}")]
for i, (k, code) in enumerate(rows):
    y = 70 + i * 21
    if k != " ":
        b += r(26, y, 428, 20, "add" if k == "+" else "dele", 4)
    b += t(34, y + 14, str(12 + i), 10, "ink4", 400, mono=True)
    b += t(58, y + 14, k, 10.5, "ok" if k == "+" else "danger" if k == "-" else "ink4", 600, mono=True)
    b += t(72, y + 14, code, 10.5, "ink2" if k == " " else "ink", 400, mono=True)
b += f'<line x1="26" y1="232" x2="454" y2="232" stroke="{C["hair"]}"/>'
x = 26
for lab, k in [("Undo turn", "quiet"), ("Ask about a line", "quiet")]:
    p, w = pill(x, 246, lab, k); b += p; x += w + 8
b += pr(454, 246, "Commit")
save("diff.svg", window("Every turn is a diff", b))

# 3. Checked by another maker
b = head(26, 56, "Reviewer", "GPT Astra · checks Claude’s change", "violet")
b += pr(454, 45, "Round 1 of 2", "second", 10)
crit = ["Does what was asked, and nothing that wasn’t", "No bugs: edge cases, errors, races", "Tests cover the change",
        "No secrets or unsafe calls", "Reads like the code around it"]
for i, c in enumerate(crit):
    y = 88 + i * 30
    b += r(26, y - 13, 428, 26, "well" if i != 2 else "#fdf4e6", 8)
    if i == 2:
        b += f'<circle cx="42" cy="{y}" r="7" fill="#fbe3c0"/>' + t(42, y + 3.5, "!", 10, "warn", 700, "middle")
        b += t(56, y + 4, c, 11.5, "ink") + t(446, y + 4, "back to the writer", 10.5, "warn", 500, "end")
    else:
        b += tick(42, y) + t(56, y + 4, c, 11.5, "ink")
b += t(26, 260, "One finding goes back; the fix is checked again.", 10.5, "ink3")
save("check.svg", window("Checked by another maker", b))

# 4. Auto routing
b = bubble("Why does the cache miss after a restart?")
b += t(26, 104, "Weighed on this Mac, no model call", 10.5, "ink3", 500)
for i, (lab, v) in enumerate([("Reasoning", .8), ("Code", .55), ("Debugging", .9), ("Tools", .4), ("Reach", .6)]):
    y = 124 + i * 20
    b += t(26, y + 4, lab, 10.5, "ink2") + bar(96, y - 2, 150) + bar(96, y - 2, 150 * v, "accent")
b += r(270, 114, 184, 96, "well", 12)
b += t(286, 136, "Heavy", 13, "ink", 600) + t(438, 136, "Max", 10.5, "ink3", 500, "end")
b += t(286, 156, "critique", 10.5, "ink3", 500)
b += r(286, 166, 46, 22, "ink", 6) + t(309, 181, "strong", 9.5, "#fff", 500, "middle")
b += f'<path d="M336 177 h10" stroke="{C["ink4"]}" stroke-width="1.5"/>'
b += r(350, 166, 44, 22, "paper", 6, "hair") + t(372, 181, "critic", 9.5, "ink2", 500, "middle")
b += r(398, 166, 44, 22, "paper", 6, "hair") + t(420, 181, "critic", 9.5, "ink2", 500, "middle")
b += t(286, 202, "strong revises once", 10, "ink3")
b += t(26, 250, "light → everyday model", 10.5, "ink3") + t(178, 250, "medium → cascade", 10.5, "ink3") + t(310, 250, "heavy → critique", 10.5, "ink", 500)
save("auto.svg", window("Auto: the least work it needs", b))

# 5. Design surface
b = r(26, 46, 150, 24, "well", 12)
b += r(29, 49, 52, 18, "paper", 9, "hair") + t(55, 62, "Desktop", 10, "ink", 500, "middle")
b += t(104, 62, "Tablet", 10, "ink3", 400, "middle") + t(150, 62, "Phone", 10, "ink3", 400, "middle")
b += pill(186, 47, "v3", "second", 10)[0]
b += pr(454, 47, "Build it")
b += r(26, 80, 428, 166, "ground", 10)
b += r(70, 92, 340, 144, "paper", 8, "hair")
b += bar(86, 106, 60, "ink") + bar(330, 106, 64, "plate")
b += t(86, 132, "High tide", 10, "ink3") + t(86, 152, "4:12 pm", 18, "ink", 600)
path = "M86 212 C 140 156, 190 162, 236 196 S 340 228, 392 174"
b += f'<rect x="80" y="160" width="320" height="64" rx="6" fill="none" stroke="{C["accent"]}" stroke-width="1.5" stroke-dasharray="4 3"/>'
b += f'<path d="{path}" fill="none" stroke="{C["accent"]}" stroke-width="2.5" stroke-linecap="round"/>'
b += f'<circle cx="400" cy="160" r="9" fill="{C["accent"]}"/>' + t(400, 164, "1", 10, "#fff", 600, "middle")
b += r(282, 118, 150, 34, "paper", 9, "hair") + t(292, 132, "What should change here?", 9.5, "ink3") + t(292, 145, "Make the curve the hero", 10.5, "ink", 500)
b += t(26, 266, "Works with Claude Code, Codex, OpenCode, Hermes and API endpoints", 10.5, "ink3")
save("design.svg", window("Design, beside the session", b))

# 6. Surfaces
tabs = ["Terminal", "Browser", "Design", "Files", "Pull request", "Device", "Routines"]
x = 26
for i, tb in enumerate(tabs):
    w = len(tb) * 5.1 + 16
    b2 = r(x, 46, w, 22, "plate" if i == 0 else "paper", 11, None if i == 0 else None)
    b = (b if i else "") + b2 + t(x + w / 2, 61, tb, 10, "ink" if i == 0 else "ink3", 500 if i == 0 else 400, "middle")
    x += w + 4
b += r(26, 80, 428, 170, "#17181c", 10)
lines = [("$ ", "npm test", "#e8e9ec"), ("", "> tidewater@0.5.0 test", "#8a8f99"), ("", "✓ tides › next high after midnight", "#5fd08a"),
         ("", "✓ tides › offline table", "#5fd08a"), ("", "✓ forecast › weekly chart", "#5fd08a"), ("", "42 passed  ·  1.8 s", "#e8e9ec"), ("$ ", "", "#e8e9ec")]
for i, (pre, l, col) in enumerate(lines):
    y = 104 + i * 20
    b += t(40, y, pre + l, 11, col, 400, mono=True)
b += r(55, 213, 7, 14, "#e8e9ec", 1)
b += t(26, 268, "Each one opens beside the session, and agents can use them too", 10.5, "ink3")
save("surfaces.svg", window("Surfaces beside the session", b))

# 7. Desk: sessions sorted by what they need
b = t(26, 58, "Desk", 13, "ink", 600) + t(62, 58, "Wednesday 4 November", 10.5, "ink3")
b += dot(30, 80, "warn") + t(38, 84, "3 back with you", 10.5, "ink2") + dot(136, 80, "accent") + t(144, 84, "1 out with agents", 10.5, "ink2") + dot(250, 80, "ink") + t(258, 84, "4 done", 10.5, "ink2")
items = [("warn", "Fix the tide time after midnight", "2 files changed, not committed", "Review 2 files"),
         ("accent", "Add a weekly tide chart", "Editing chart.js · 1 of 3", None),
         ("warn", "Support offline tide tables", "Planned, waiting for your OK", "Read the plan"),
         ("warn", "Polish the forecast page", "4 files changed", "Review 4 files")]
for i, (st, tl, note, act) in enumerate(items):
    y = 104 + i * 40
    b += r(26, y, 428, 34, "well" if i == 0 else "paper", 9)
    if st == "accent":
        b += f'<circle cx="42" cy="{y + 17}" r="6" fill="none" stroke="{C["accent"]}" stroke-width="1.6" stroke-dasharray="20 8"/>'
    else:
        b += f'<circle cx="42" cy="{y + 17}" r="6" fill="none" stroke="{C[st]}" stroke-width="1.6"/>' + dot(42, y + 17, st, 2.5)
    b += t(58, y + 15, tl, 11.5, "ink", 500) + t(58, y + 28, note, 10, "ink3")
    if act:
        b += pr(446, y + 6, act, "quiet", 10)
save("desk.svg", window("Sessions sorted by what they need", b))

# 8. Compare models
b = t(26, 58, "Compare", 13, "ink", 600) + t(90, 58, "“Explain the cache layer”", 10.5, "ink3")
for i, (m, maker, cost, fill) in enumerate([("Opus 5.5", "Anthropic", "$0.21", "accent"), ("GPT Astra", "OpenAI", "$0.18", "violet")]):
    x = 26 + i * 218
    b += r(x, 72, 210, 168, "well", 12)
    b += dot(x + 16, 90, fill, 4) + t(x + 26, 94, m, 11.5, "ink", 600) + t(x + 26 + len(m) * 6.6 + 4, 94, maker, 10, "ink3")
    for j, ww in enumerate([170, 150, 178, 120, 0, 160, 140, 90]):
        if ww:
            b += bar(x + 14, 110 + j * 13, ww * (0.92 if i else 1))
    b += t(x + 14, 228, cost + " · 9.4 s", 10.5, "ink3", 500)
    b += pr(x + 196, 214, "Keep this", "quiet" if i else "act", 10)
b += t(26, 262, "Same prompt, any models you have, side by side", 10.5, "ink3")
save("compare.svg", window("Models side by side", b))

# 9. Workshop
b = r(26, 46, 428, 34, "well", 17)
b += f'<rect x="34" y="53" width="20" height="20" rx="6" fill="#efeafc"/>' + "".join(r(38 + gx * 5, 57 + gy * 5, 3.6, 3.6, "violet" if (gx + gy) % 2 == 0 else "#d9cff7", 1) for gx in range(3) for gy in range(3))
b += t(62, 67, "Turn my commits into a beat machine", 11.5, "ink")
b += f'<circle cx="438" cy="63" r="10" fill="{C["act"]}"/><path d="M438 68 v-9 m-4 4 l4 -4 l4 4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
for i, s in enumerate(["Read the add-on guide", "Wrote the panel", "Checked it in a sealed frame"]):
    y = 102 + i * 20
    b += tick(34, y) + t(48, y + 4, s, 10.5, "ink2")
b += r(26, 164, 428, 84, "paper", 12, "hair")
b += r(40, 178, 34, 34, "#efeafc", 9)
for gx in range(3):
    for gy in range(3):
        on = (gx + gy) % 2 == 0
        b += r(46 + gx * 8, 184 + gy * 8, 6, 6, "violet" if on else "#d9cff7", 1.5)
b += t(84, 192, "Commit beats", 12.5, "ink", 600) + t(84, 207, "A panel in the dock · your files, to read", 10.5, "ink3")
b += t(84, 234, "Asks a model: DeepSeek V4.1 Flash", 10.5, "ink3")
b += pr(440, 220, "Add")
b += t(26, 270, "Workshop: ask for what Liner Code doesn’t have", 10.5, "ink3")
save("workshop.svg", window("Workshop add-ons", b))
print("ok")
