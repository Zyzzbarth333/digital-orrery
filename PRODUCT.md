# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, weighted equally:

- **The engineer** (the author, a UQ avionics and electronics engineer, and
  people like them): uses the orrery as a working tool to validate orbital
  physics against NASA data and to plan and fly missions. Wants dense,
  exact numbers, sources and controls, including keyboard control.
- **Portfolio visitors** (recruiters, peers, students), arriving from the
  author's GitHub Pages portfolio, often on a phone: need to understand what
  they are looking at within seconds, then be able to open the full
  engineering console.

## Product Purpose

A real-time solar-system and mission simulator in the browser where
everything is exact and checkable: true-scale bodies at their real positions
for any date, real gravity (n-body, not patched-conic shortcuts), real
surfaces, sky and lighting, and spacecraft launched from real pads and flown
with finite burns. Success: an engineer trusts its numbers enough to use them,
and a visitor leaves knowing it is real.

## Positioning

Exactness first: every number comes from NASA ephemerides and kernels (DE442,
SPICE) and is validated against CSPICE, with its source and error stated.
Mission planning and flight are what you do with that exactness. Neighbours
(Orbiter, NASA Eyes on the Solar System, Universe Sandbox) are inspiration
only; the stated aim is to be more exact than Orbiter.

## Operating Context

- Runs in a desktop or mobile browser (GitHub Pages); WebGL required, with a
  readable fallback when it is missing.
- A 3D scene fills the screen; panels overlay it: time control, body list,
  body data, and (milestone 2) spacecraft, launch and transfer planning.
- Links can set the starting view (`?focus=`, `?t=`, `?view=sun`, `?phase=`).
- Validation numbers and sources live in `docs/` (physics, frontend,
  validation, performance).

## Capabilities and Constraints

- TypeScript + React 19 panels over a three.js scene; physics in plain
  JavaScript in a Web Worker.
- Must work on a phone: panels collapse sensibly at narrow widths.
- Keyboard shortcuts for time and focus.
- Australian English in all copy.
- Undecided: the full milestone 2 mission workflow.

## Brand Commitments

- Name: digital-orrery (lower case).
- An original retro-futurist mission-console feel ("DIY Nostromo or
  similar"); never film logos, names or assets.
- Share look-and-feel tokens with the author's ground station
  (`~/cosmos_gcs/frontend`) where it fits.
- No AI attribution anywhere.

## Evidence on Hand

- Validation tables: `docs/validation.md`, `docs/performance.md`.
- Real data: NASA/USGS/NOAA maps and imagery, SPICE kernels, Cassini ring
  profile; credits in `docs/frontend/textures.md` and the README.
- No testimonials, users or press exist; none may be invented.

## Product Principles

1. Exact and checkable: show a number's source and error next to it, and
   never round away what the physics gives.
2. True scale and true time: nothing is enlarged or moved for effect;
   readability aids (markers, labels, orbit lines) are visibly aids.
3. Readable in seconds, deep on demand: a visitor gets the picture at once;
   the engineer reaches every number and control.
4. Honest about limits: what is not modelled is said plainly.
