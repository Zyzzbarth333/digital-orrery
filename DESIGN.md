---
name: digital-orrery
description: 70s flight hardware around the true-scale sky, where every number shows its source.
colors:
  bezel: "#1b1a17"
  panel: "#ddd6c6"
  panel-low: "#d3cbb9"
  panel-raised: "#e9e3d6"
  panel-sunk: "#cbc2ae"
  seam: "#a39a86"
  seam-strong: "#7d7564"
  ink: "#1d1b16"
  ink-muted: "#5a5446"
  engrave: "#9a3216"
  window: "#121110"
  phosphor: "#ffb22e"
  phosphor-dim: "#ecd9b0"
  key: "#d9531f"
  key-lit: "#ff7a3d"
  key-low: "#c9c0ad"
  key-edge: "#8f3512"
  key-sheen: "#ffb48d"
  key-ink: "#fff7ea"
  lamp-on: "#7fe06a"
  lamp-off: "#6d685c"
  sheen: "#f5f0e4"
  caution: "#f2c230"
  warn: "#c62f1c"
  black: "#000000"
  white: "#ffffff"
typography:
  wordmark:
    fontFamily: "Michroma, B612, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  heading:
    fontFamily: "Michroma, B612, sans-serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0.08em"
  engraved:
    fontFamily: "Michroma, B612, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  engraved-small:
    fontFamily: "Michroma, B612, sans-serif"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  clock:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.02em"
  body:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  body-small:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  rail:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.06em"
  code:
    fontFamily: "B612 Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  panel-code:
    fontFamily: "B612 Mono, ui-monospace, monospace"
    fontSize: "8px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  none: "0px"
  window: "2px"
  key: "3px"
  screw: "50%"
spacing:
  unit: "8px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  key:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.engraved}"
    rounded: "{rounded.key}"
    padding: "0 14px"
    height: "34px"
  key-run-on:
    backgroundColor: "{colors.key}"
    textColor: "{colors.key-ink}"
    rounded: "{rounded.key}"
  readout-window:
    backgroundColor: "{colors.window}"
    textColor: "{colors.phosphor}"
    typography: "{typography.clock}"
    rounded: "{rounded.window}"
    padding: "6px 12px"
  nomenclature-strip:
    backgroundColor: "{colors.window}"
    textColor: "{colors.panel-raised}"
    typography: "{typography.engraved-small}"
    padding: "5px 18px"
  body-row:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.rail}"
    height: "32px"
  body-row-current:
    backgroundColor: "{colors.window}"
    textColor: "{colors.phosphor}"
  source-tag:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.none}"
    padding: "0 5px"
---

# Design System: digital-orrery

## Overview

70s flight hardware around the true-scale sky, in the NASA-punk lineage of
Space Shuttle cockpit panels and Apollo instruments. The console is three
beige sheet-metal panels with screw-head corners, framing the sky in a dark
bezel:
- a header band with the clock and rate in recessed black readout windows,
  a RUN key, a NOW key and indicator lamps;
- a body rail;
- a data plate.

Labels are engraved in orange-red wide capitals. Each panel carries a small
designation code, as Shuttle panels do (PNL F1, L1, R1), and section titles
sit on black nomenclature strips. The signature is the provenance column:
every value in the data plate has a tag naming its source. Original: the
lineage is real NASA hardware, not any game's or film's interface.

Product truth is in [PRODUCT.md](PRODUCT.md).

## Colors

### Primary

- **phosphor** `#ffb22e`: amber numerals in readout windows and the current
  body. 10.5:1 on the window.
- **key** `#d9531f` (lit gradient to `#ff7a3d`): the RUN key while time
  runs, the only orange surface.

### Secondary

- **engrave** `#9a3216`: engraved labels on the panel. 5.1:1 on the panel.
- **lamp-on** `#7fe06a`: a lit indicator lamp.

### Neutral

- **Panel:** **panel** `#ddd6c6` sheening to **panel-low** `#d3cbb9`, with
  **panel-raised** `#e9e3d6` for keys and tags and **panel-sunk** `#cbc2ae`
  for hover.
- **Seams:** **seam** `#a39a86` and **seam-strong** `#7d7564`, for rules and
  seams.
- **Ink:** **ink** `#1d1b16` (11.9:1) and **ink-muted** `#5a5446` (5.2:1).
- **Window and bezel:** **window** `#121110` for readout windows and strips,
  **bezel** `#1b1a17` around the sky.
- **Highlights:** **sheen** `#f5f0e4`, plus **key-low**, **key-edge** and
  **key-sheen** for the RUN key's bevel.

### Named Rules

- **caution** `#f2c230` hatched with ink, and **warn** `#c62f1c`, are for
  warning states only: no WebGL, and later the kernel falling behind.
- A lamp is lit only when it means something (RUN: time is running; LIVE:
  the sim clock is within a minute of now).
- Body swatches keep each body's own colour.

## Typography

- **Michroma**, wide extended capitals: the wordmark, headings and every
  engraved label.
- **B612**, the Airbus cockpit face: body text and every number. Its digits
  share one width, so values align and the clock never jitters.
- **B612 Mono**: codes only (source tags, panel designations, key caps).

All three are SIL OFL and self-hosted.

### Hierarchy

| Role | Face and size |
| --- | --- |
| Plate heading | 26 px Michroma |
| Clock | 17 px B612 |
| Wordmark | 15 px Michroma |
| Body and values | 13 px B612 |
| Rail | 12 px B612, uppercase |
| Engraved labels | 10 px or 9 px Michroma, tracked 0.14em |
| Tags | 9 px B612 Mono |
| Panel codes | 8 px B612 Mono |

## Layout

- Desktop grid: a 64 px header band across the top; a 200 px rail, the sky
  in the middle cell (centred on the focused body) and a 380 px plate.
- The sky's bezel is a 7 px frame drawn over the canvas edge, with a 1 px lip
  and an inner shadow.
- 8 px spacing unit.
- Under 1100 px the lamps fold away.
- Under 720 px the band wraps, the rail becomes a horizontal strip under the
  sky, the plate folds behind "Show data", and the screws and codes go.

## Elevation & Depth

This is physical, not material-design. Keys stand proud on a 2 px edge and
press down 1 px. Readout windows are recessed, with an inner shadow and a
1 px sheen on the lower lip. The sky sits behind the bezel. Panels
themselves are flat sheets separated by seams.

## Shapes

- Square corners for panels, rows, strips and tags.
- 2 px for readout windows, 3 px for keys.
- Round screw heads.
- Square lamps and swatches.

## Components

### Buttons

Keys are 34 px high, engraved Michroma, with a raised bevel. The RUN key
lights orange while time runs (`aria-pressed`). NOW jumps to the present.

### Chips

The source tag: 9 px mono in a 1 px ink box, solid for data, dashed for
values worked out in the app. Hover a tag for its source detail.

### Inputs / Fields

The clock and rate sit in recessed black readout windows. Rate is a native
select dressed as a window, with a drawn caret.

### Navigation

The body rail: list buttons with `aria-current`. The current body inverts to
amber on the window black, its swatch glowing.

## Do's and Don'ts

- Do show a value's source beside it.
- Do engrave labels; do not invent emblems, insignia or stripes.
- Do keep lamps and caution colours for states that mean something.
- Don't use glass, blur, gradients for colour, or rounded cards.
- Don't take any game's or film's interface, logo or stripe: the lineage is
  real NASA hardware.
