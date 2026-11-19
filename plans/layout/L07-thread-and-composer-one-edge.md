# L07. What the agent wrote starts where what you type starts

**Commit message:** `The conversation's text and the composer's text share their left edge, and your message ends where Send does`

## Why

Two comments promise it and the numbers no longer keep it:

- `app.css:1965`: "One measure for the conversation: the text, the cards and the composer's frame share their edges."
- `surfaces.css:5771-5773`: "the conversation's text starts where the composer's text does (the card's own padding), and
  your messages end where its controls end."

Measured:

| | Thread text left | Composer text left | Your message's right | Send's right |
|---|---|---|---|---|
| Thread alone, 1440 wide | 488 | 486 | 1170 | 1174 |
| Beside the panel | 306 | **298** | 947 | **957** |

The cause is two paddings set at different times. The thread: `.lc-scroll-in` 24px a side (`app.css:1969-1974`) plus
`.lc-tl` `padding-inline: 18px 12px` (`surfaces.css:5777-5779`, 5 November) = 42 left, 36 right. The composer: `.lc-compose`
14 (`app.css:1977-1984`) + the tray's 4 (`app.css:2899`) + the card's 16 left and 8 right (`app.css:2970`, 10 November)
= 34 left, 26 right. Wide, the two columns are centred at different widths (760 and 748), which hides all but 2px of it;
beside the panel, where both fill the column, the whole 8 and 10 show.

The composer's numbers are the newer ones, so the thread moves to them.

## Current state (drift check)

```bash
sed -n 1969,1974p ui/src/app/app.css        # .lc-scroll-in: max-width calc(var(--lc-measure) + 48px); padding: 24px 24px calc(…)
sed -n 1977,1984p ui/src/app/app.css        # .lc-compose: max-width calc(var(--lc-measure) + 28px + 8px); padding: 0 14px 8px
sed -n 5777,5779p ui/src/app/surfaces.css   # .lc-scroll-in > .lc-tl { padding-inline: 18px 12px; }
grep -n "^\.lc-tray {" -A3 ui/src/app/app.css | grep padding      # padding: 4px
```

Also read `app.css:2965-2975` and confirm the composer card's padding is `13px 8px 0 16px`. If the left is not 16 or the
right not 8, stop: the numbers below are worked from them.

## Steps

1. `app.css:1970`: `max-width: calc(var(--lc-measure) + 48px);` → `max-width: calc(var(--lc-measure) + 36px);` (the same
   748 as `.lc-compose`).
2. `app.css:1973`: `padding: 24px 24px calc(var(--lc-dock-h, 132px) + 18px);` →
   `padding: 24px 18px calc(var(--lc-dock-h, 132px) + 18px);` (18 = the composer's 14 + the tray's 4).
3. `surfaces.css:5778`: `padding-inline: 18px 12px;` → `padding-inline: 16px 8px;` (the composer card's own 16 and 8).

Add one sentence to the comment at `app.css:1965` giving the sum, so it can be checked next time: the thread's 18 + 16 is
the composer's 14 + 4 + 16.

**Source test:** `.lc-scroll-in` has `max-width: calc(var(--lc-measure) + 36px)`; `.lc-scroll-in > .lc-tl` has
`padding-inline: 16px 8px`.

## Done

- Source test passes; typecheck and build pass.
- Measured, in both `threadWide` and `threadBesidePanel`: `threadTextLeft` equals `composerTextLeft` within 1px, and
  `youRight` equals `sendRight` within 1px.

## STOP conditions

- After the change the thread's first-run note or its "Opening" line (`.lc-fresh`, `.lc-tl-wait`, direct children of
  `.lc-scroll-in`) sits visibly off-centre: they are centred with their own margins and should not move; report if they do.
