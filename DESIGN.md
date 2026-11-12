---
name: digital-orrery
description: A flight console whose every number shows where it came from.
colors:
  ground: "#12110e"
  panel: "#1a1915"
  panel-raised: "#23211c"
  rule: "#34312a"
  rule-strong: "#4a463c"
  text: "#ece6d6"
  text-muted: "#b2aa98"
  text-faint: "#8d8676"
  accent: "#ffb22e"
  accent-ink: "#1a1203"
  warn: "#ff6a4d"
typography:
  heading:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.01em"
  clock:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.01em"
  body:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  section-title:
    fontFamily: "B612, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.08em"
  code:
    fontFamily: "B612 Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
rounded:
  none: "0px"
spacing:
  unit: "8px"
  sm: "8px"
  md: "16px"
components:
  button:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "28px"
  button-pressed:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.none}"
  body-row:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-muted}"
    height: "32px"
    padding: "0 16px"
  body-row-current:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.accent}"
  source-tag:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-muted}"
    typography: "{typography.code}"
    rounded: "{rounded.none}"
    padding: "0 5px"
---

# Design System: digital-orrery

## Overview

A flight console framing the true-scale sky: a full-width time band, a
full-height body rail and a ruled data plate, solid and square-cornered on a
warm graphite ground, with one phosphor-amber accent. Its signature is the
provenance column: each value in the data plate carries a tag naming its
source. This records the console as built in `src/app/app.css` and
`src/app/panels.tsx`; a stronger retro-futurist world is being chosen and
will replace it. Product truth is in [PRODUCT.md](PRODUCT.md).

## Colors

### Primary

- **accent** `#ffb22e`, phosphor amber: selection, keyboard focus, the
  current body, the pressed run button. 9.8:1 on the panel.

### Neutral

- **ground** `#12110e`, **panel** `#1a1915`, **panel-raised** `#23211c`:
  warm graphite, never neutral grey.
- **text** `#ece6d6` (14.1:1), **text-muted** `#b2aa98` (7.6:1),
  **text-faint** `#8d8676` (4.9:1), all on the panel.
- **rule** `#34312a`, **rule-strong** `#4a463c`: 1 px hairlines and control
  borders.

### Named Rules

- **warn** `#ff6a4d` is a state colour only, never decoration.
- Body swatches keep each body's own colour.

## Typography

B612, the Airbus cockpit face (SIL OFL, self-hosted), sets labels and every
number: its digits share one advance width, so values align and the clock
never jitters. B612 Mono sets codes only (source tags, key caps).

### Hierarchy

- Plate heading 22 px, 700. Clock 18 px. Body and values 13 px. Section
  titles 11 px, 700, uppercase, tracked 0.08em. Tags and keys 10 px mono.

## Layout

- Desktop grid: a 48 px band across the top; a 184 px rail, the sky in the
  middle cell (so the focused body is centred in what is visible) and a
  360 px plate.
- 8 px spacing unit.
- Under 720 px the band wraps, the rail becomes a horizontal strip under the
  sky, and the plate sits below with its data behind "Show data".

## Elevation & Depth

Flat. Panels are separated by 1 px hairlines, never by shadows or blur.

## Shapes

Square corners everywhere (0 px radius). Body swatches and markers are
squares.

## Components

### Buttons

28 px high, raised panel fill, 1 px strong rule. The run button is pressed
(amber fill, dark ink) while time runs.

### Chips

The source tag: 10 px mono in a 1 px box, solid for data, dashed for values
worked out in the app; hover for detail.

### Inputs / Fields

The rate select: a native select restyled to the button's box, with a drawn
caret.

### Navigation

The body rail: list buttons with `aria-current`; the current body is amber
on an amber wash.

## Do's and Don'ts

- Do show a value's source beside it.
- Do keep true scale; markers and lines are aids and look like it.
- Don't use glass, blur, gradients or rounded cards.
- Don't use colour for decoration; amber means "selected or active".
