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
  lamp-dark: "#3a372f"
  advisory-ink: "#c9f2bf"
  warn-lit: "#ff6a4d"
  warn-ink: "#ff8a73"
  warn-edge: "#7a1a0e"
  label-dim: "#b9ad92"
  flown-line: "#4f9a86"
  warn: "#c62f1c"
  black: "#000000"
  white: "#ffffff"
typography:
  wordmark:
    fontFamily: "Michroma, B612, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.1em"
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
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  clock:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.02em"
  clock-compact:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "15px"
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
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  panel-code:
    fontFamily: "B612 Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.08em"
  equation:
    fontFamily: "DejaVu Math TeX Gyre, STIX Two Math, Cambria Math, Latin Modern Math, math"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
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
  tag-detail:
    backgroundColor: "{colors.window}"
    textColor: "{colors.phosphor-dim}"
    typography: "{typography.body-small}"
    rounded: "{rounded.window}"
    padding: "10px 12px"
---

# Design System: digital-orrery

## Overview

70s flight hardware around the true-scale sky, in the NASA-punk lineage of
Space Shuttle cockpit panels and Apollo instruments. The console is three
beige sheet-metal panels with screw-head corners, framing the sky in a dark
bezel:
- a header band of instruments: the clock and rate in recessed black
  readout windows, the RUN, HOLD and NOW keys, the FLIGHT field (the
  selected craft and the CONSOLE key) and indicator lamps;
- a body rail, headed by the wordmark;
- a data plate for the body in view;
- and, when opened, a flight console (MISSION, PLANNER, ROCKET), the app's
  own panel rather than any body's.

Labels are engraved in orange-red wide capitals. Each panel carries a small
designation code, as Shuttle panels do (PNL F1, L1, R1), and section titles
sit on black nomenclature strips. The signature is the provenance column:
every value in the data plate has a tag naming its source. Original: the
lineage is real NASA hardware, not any game's or film's interface.

### Lineage

The look sits in the "NASA-punk" lineage that Bethesda's art team named for
Starfield (art director Istvan Pely, Hypebeast, August 2023). We take its
principles, not its interface:

- over-engineered, functional hardware that makes survival believable;
- a period piece set in the future, with a 1970s–80s, pre-CGI feel;
- physical, labelled buttons you want to press, rather than holograms;
- familiarity first, so a new world reads at once.

Starfield's own logo, colour stripe, fonts and screen layouts are not used.

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

Equations, in a tag's detail, are MathML set by the browser in the
system's math font: DejaVu Math TeX Gyre first (a sans face, nearest
B612), then STIX Two Math (macOS), Cambria Math (Windows), Latin Modern
Math, else the browser's own `math`. No web font is loaded for them: a
math font needs its OpenType MATH table to stretch brackets and radicals,
which B612 doesn't have. (Noto Sans Math is left out: Chromium doesn't
stretch with it.)

### Hierarchy

| Role | Face and size |
| --- | --- |
| Plate heading | 26 px Michroma |
| Clock | 17 px B612 (15 px on phones) |
| Body and values | 13 px B612 |
| Wordmark (rail) | 12 px Michroma |
| Rail | 12 px B612, uppercase |
| Engraved labels | 11 px or 10 px Michroma, tracked 0.14em |
| Tags | 10 px B612 Mono |
| Equations (tag detail) | 15 px math font, phosphor |
| Panel codes | 9 px B612 Mono |

Nothing is set below 10 px except the panel codes (decoration, 9 px):
Michroma's wide capitals smear at 9 px on a 1× screen. Sizes are whole
pixels, and labels in the sky sit on whole device pixels, so glyphs are
never resampled.

## Layout

- Desktop grid: a 64 px header band across the top; a 200 px rail, the sky
  in the middle cell (centred on the focused body) and a 380 px plate.
- The flight console docks over the plate up to 1680 px wide, so the sky
  keeps its width; wider, it hangs over the sky's right edge (392 px) and
  the 3D view moves its centre left so the body in view stays clear.
- The sky's bezel is a 7 px frame drawn over the canvas edge, with a 1 px lip
  and an inner shadow. The view plate sits inside it, lower left.
- 8 px spacing unit.
- Under 1300 px the header wraps onto two rows.
- Under 1100 px the rail and plate narrow and the panel codes go.
- Under 720 px the rail becomes a horizontal strip under the sky, the plate
  folds behind "Show data", the console takes the plate's place, the
  header's engraved labels hide (the controls keep their names), and the
  screws go.

## Elevation & Depth

This is physical, not material-design. Keys stand proud on a 2 px edge and
press down 1 px. Readout windows are recessed, with an inner shadow and a
1 px sheen on the lower lip. The sky sits behind the bezel. Panels
themselves are flat sheets separated by seams, one device pixel wide on 2×
screens. The flight console is the one panel that lies over another, so it
casts a shadow onto the sky.

## Shapes

- Square corners for panels, rows, strips and tags.
- 2 px for readout windows, 3 px for keys.
- Round screw heads.
- Square lamps and swatches.
- Slotted screw heads.

## Components

### Buttons

Keys are 34 px high, engraved Michroma, with a raised bevel. RUN and HOLD
are a radio pair (`role=radio`): RUN lights orange while time runs, HOLD
stays pressed while it is held. NOW jumps to the present and is disabled
when the clock is live. The primary key of a flow (Launch, Fly this) is
orange; the ACK key flashes only while a warning is unacknowledged, and not
at all with reduced motion.

### The FLIGHT field and the flight console

The header's FLIGHT field holds a readout window naming the selected craft
(a diamond, its name, and COAST, BURN in key orange, or LOST in warning
red; "+2" when more craft wait in the console) and the CONSOLE key, which
latches pressed while the console is open. Pressing the window follows the
craft. The console is a sheet-metal panel (PNL C1) with MISSION, PLANNER and
ROCKET tabs and a CLOSE key; M toggles it and Escape closes it. Choosing a
body never closes it.

### The view plate

A small window in the sky's lower left names what the camera is on, with
two cues for the mode: FOCUS and a ring for a body, FOLLOW and a diamond for
a craft, as their markers are drawn in the sky. During a flight the glyph
lights and the plate reads EN ROUTE · Esc stop.

### Annunciator

The header's lamps follow the flight-deck convention: green advisory (LIVE,
KERNEL), amber caution (LAG) and red warning (WARN). Every lamp is labelled,
so colour is never the only cue. A new warning lights WARN and flashes ACK;
acknowledging stops the flash, but the lamp stays lit while the condition
lasts, as on the Shuttle's caution and warning panel.

### Readout windows

Amber numerals carry a tight phosphor glow (a 1 px halo and a faint 10 px
one), enough to read as lit glass without blurring the digits.

### Chips

The source tag: 10 px mono in a 1 px ink box, solid for data, dashed for
values worked out in the app. It is a button: hovering it, focusing it or
tapping it opens its detail, a small readout window under the tag (above
it when there is no room). The detail says what the value is, gives the
equation in phosphor, then its source, under engraved labels. A tap or
click pins it; Escape, a press elsewhere or moving focus away closes it.
Screen readers get the same as one line of text, the button's
description.

### Inputs / Fields

The clock and rate sit in recessed black readout windows. Rate is a native
select dressed as a window, with a drawn caret.

### Tabs

The flight console's MISSION, PLANNER and ROCKET tabs are keys that stay
pressed: the selected one is window black with amber engraving.

### Number inputs

Inputs are small recessed readout windows: window black, pale-amber
numerals, an engraved label above, and the unit beside.

### Spacecraft and the porkchop

- **Craft marker:** a 9 px square turned 45° in amber; filled when
  selected, orange while burning, red and struck through after an impact.
- **Craft lines:** the osculating conic in amber (0.55); the flown trail in
  pale amber, glowing at the craft and fading with age.
- **A real mission's flown path:** pale green (`flown-line` for its legend
  swatch on the panel), so it never reads as ours (amber). Drawn relative to
  Earth, it stays put while our craft drifts off it.
- **Orbit lines:** each planet's orbit is a faint outline with a glowing
  trail behind the planet (see docs/frontend/scene.md).
- **Porkchop:** shaded on the console's own ramp, from sheen through amber,
  key orange and engraving to window black, so low C3 glows. The minimum is
  outlined in ink and the picked cell in lamp green.

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
