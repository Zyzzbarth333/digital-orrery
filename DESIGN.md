# Design

The console around the sky. Recorded from the built interface
(`src/app/app.css`, `src/app/panels.tsx`); product truth is in
[PRODUCT.md](PRODUCT.md).

## World

A flight console whose every number shows where it came from: solid,
square-cornered panels on a warm graphite ground framing the true-scale sky,
with one phosphor-amber accent. Original; no film references.

## Type

- **B612** (Airbus cockpit face, OFL): labels, headings and all numbers. Its
  digits share one advance width, so columns align and the clock never
  jitters.
- **B612 Mono**: codes only (source tags, key caps).
- Scale: 22 px plate heading (700), 18 px clock, 13 px body and values, 11 px
  section titles (700, uppercase, 0.08em) and secondary lines, 10 px tags.

## Colour

| Token | Value | Use | Contrast on panel |
| --- | --- | --- | --- |
| `--ground` | #12110e | page ground | |
| `--panel` | #1a1915 | band, rail, plate | |
| `--panel-raised` | #23211c | hover, controls | |
| `--rule` / `--rule-strong` | #34312a / #4a463c | 1 px hairlines, control borders | |
| `--text` | #ece6d6 | primary text | 14.1:1 |
| `--text-muted` | #b2aa98 | labels, units | 7.6:1 |
| `--text-faint` | #8d8676 | secondary lines, notes | 4.9:1 |
| `--accent` | #ffb22e | selection, focus, active state, running clock | 9.8:1 |
| `--accent-ink` | #1a1203 | text on amber | 10.3:1 on amber |
| `--warn` | #ff6a4d | state only | |

Body swatches in the rail and scene keep each body's own colour.

## Layout

- Desktop: a 48 px time band across the top; a 184 px body rail, the sky,
  and a 360 px data plate below it (CSS grid; the sky takes the middle cell,
  so the focused body is centred in what is visible).
- 8 px spacing unit; square corners; 1 px hairlines; no shadows, no blur.
- Under 720 px: the band wraps, the rail becomes a horizontal strip under
  the sky, and the plate sits below with its data behind "Show data".

## Signature: the provenance column

Each readout in the data plate has a source tag beside its value: solid for
data (AE = astronomy-engine, DE442, the satellite kernel such as sat441,
IAU, NSSDCA), dashed for values worked out here (d/c, GM/R², rounded).
Hovering a tag gives the detail.

## Controls and states

Standard web controls restyled: buttons (`.btn`, 28 px), the rate `select`,
list buttons with `aria-current`, a pressed run button in amber. Focus is a
1 px amber outline. Keyboard: Space run or pause, ← → rate, ↑ ↓ body,
N now. Motion is none beyond the sky itself; `prefers-reduced-motion`
disables transitions.
