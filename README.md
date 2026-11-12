# digital-orrery

A web-based, real-time 3D solar-system simulator with interactive interplanetary mission planning. It is built in vanilla JavaScript on Three.js and uses the astronomy-engine library for JPL-grade planetary ephemerides. The simulator renders the Sun and nine planets at ephemeris-accurate positions, launches spacecraft with a chosen delta-V, propagates them under Newtonian gravity, and provides transfer planning (Hohmann and Lambert), manoeuvre nodes, launch-window analysis, and a full spacecraft-subsystems model covering power, thermal, comms, attitude and propulsion.

The name nods to the orrery, a mechanical model of the solar system, and in particular to the Digital Orrery, the special-purpose computer built in the 1980s to integrate the long-term dynamics of the outer planets.

## Physics and accuracy

The simulator is honest about where it sits on the fidelity scale. The goal is to move toward and beyond KSP-grade patched-conic-plus-n-body fidelity, and the codebase is being built out to get there rather than claiming to be there already.

What is high-fidelity today:

- **Gravitational parameters** are SPICE-precision GM constants for the Sun and all planets, held in `src/utils/constants.js`.
- **Planetary positions** come from astronomy-engine, which provides JPL-grade ephemerides, so the Sun and planets sit where they actually are for a given date.
- **Spacecraft propagation** runs in a physics kernel (`src/physics/nbody.js`) with no three.js in it. Each craft feels the Sun, the eight planets and the Moon at their ephemeris positions throughout every frame, with the heliocentric frame's indirect term. Yoshida's 4th-order composition of leapfrog steps advances it (symplectic at a fixed step). Each step is 1% of the shortest local dynamical time, so it sub-steps finely near a planet and coarsely in cruise; there is no error control yet. If a frame needs more steps than its budget, the craft falls behind the clock and catches up, with an on-screen warning, rather than taking steps long enough to pass through a planet. Launches start on the escape hyperbola, 100 planet radii out or at the edge of the sphere of influence if that is closer, with the preset delta-V as the hyperbolic excess speed.
- **Orbital-mechanics core.** `src/physics/orbital.js` provides universal-variable two-body propagation (one code path for ellipses, parabolas and hyperbolas) and a universal-variable Lambert solver with a bracketed root solve. Both are checked against worked examples from Curtis, *Orbital Mechanics for Engineering Students* (4th ed.). Propagation and the state-to-elements conversion are also checked against NAIF CSPICE (`prop2b_c`, `oscltx_c`). SPICE has no Lambert solver, so the Lambert solver is checked on the real MSL launch and arrival geometry from the DE440 ephemeris and on transfer grids flown by an independent numerical integrator. Run the checks with:

  ```bash
  node src/physics/orbital.test.mjs
  ```

What is still approximate:

- The planner's launch-window (porkchop) grid now runs on the verified Lambert solver with astronomy-engine ephemerides, but its Hohmann, "direct" and gravity-assist estimates are still simplified scalings.
- Gravity assists are modelled coarsely and should not be treated as mission-grade.

In short, the constants, ephemerides, n-body integration and the Kepler/Lambert core are solid; the planning UI on top of them is where the remaining approximations live.

## Accuracy roadmap

The following changes would push fidelity further, roughly in order of impact:

- [x] Wire the Lambert core in `src/physics/orbital.js` into the porkchop delta-V grid so the planner reads directly from the verified solver.
- [ ] Add patched-conic sphere-of-influence transitions so trajectories hand off correctly between central bodies.
- [x] Replace the fixed-step integrator with a higher-order integrator whose step follows the local dynamical time.
- [ ] Add error-controlled adaptive stepping (an embedded Runge-Kutta-Nystrom pair or DOP853) and a two-body fast path for weakly perturbed orbits at high warp.
- [ ] Validate propagated trajectories against SPICE ephemerides using the reference under `python/`.

## Quick start

### Prerequisites

- Node.js 20.19+ (or 22.12+) and npm; Vite 8 needs one of these
- A modern browser with WebGL support

### Install and run

```bash
git clone https://github.com/Zyzzbarth333/digital-orrery.git
cd digital-orrery
npm install
npm run dev
```

`npm run dev` starts the Vite development server. To produce a production build:

```bash
npm run build
```

## Controls

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Pause and resume |
| `+` / `-` | Speed time up and down |
| `1` to `9` | Launch preset missions |
| `H` | Show help |
| `O` | Toggle orbit lines |
| `L` | Toggle labels |
| `M` | Mission control panel |
| `N` | Add manoeuvre node (with a spacecraft selected) |
| `B` | Trajectory planner |
| `T` | Cycle time display format |
| `F` | Toggle fullscreen |
| `P` | Take a screenshot |

### Mouse

- Left-drag: rotate the view
- Right-drag: pan
- Scroll: zoom in and out
- Click: select a planet or spacecraft

## Project structure

```
digital-orrery/
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ simulation/
â”‚   â”‚   â”œâ”€â”€ SolarSystem.js          # Main simulation controller
â”‚   â”‚   â”œâ”€â”€ CelestialBody.js        # Planet and body representation
â”‚   â”‚   â”œâ”€â”€ TimeController.js       # Time management
â”‚   â”‚   â”œâ”€â”€ OrbitalMechanics.js     # In-sim orbital calculations
â”‚   â”‚   â”œâ”€â”€ PhysicsTest.js          # In-browser energy and Kepler checks
â”‚   â”‚   â”œâ”€â”€ spacecraft/
â”‚   â”‚   â”‚   â”œâ”€â”€ BaseSpacecraft.js    # Spacecraft model
â”‚   â”‚   â”‚   â”œâ”€â”€ SpacecraftFactory.js # Spacecraft construction
â”‚   â”‚   â”‚   â”œâ”€â”€ SpacecraftSystems.js # Power, thermal, comms, attitude, propulsion
â”‚   â”‚   â”‚   â””â”€â”€ ManoeuvreNode.js     # Manoeuvre planning
â”‚   â”‚   â””â”€â”€ trajectory/
â”‚   â”‚       â””â”€â”€ TrajectoryPlanner.js # Transfer and launch-window tools
â”‚   â”œâ”€â”€ physics/
â”‚   â”‚   â”œâ”€â”€ orbital.js               # Kepler propagation and Lambert solver
â”‚   â”‚   â””â”€â”€ orbital.test.mjs         # Node verification against Curtis/Vallado
â”‚   â”œâ”€â”€ ui/
â”‚   â”‚   â””â”€â”€ SpacecraftControlPanel.js
â”‚   â”œâ”€â”€ utils/
â”‚   â”‚   â””â”€â”€ constants.js             # SPICE-precision constants
â”‚   â”œâ”€â”€ main.js                      # Application entry point
â”‚   â””â”€â”€ style.css
â”œâ”€â”€ python/                          # Offline NASA SPICE reference
â”œâ”€â”€ .devcontainer/                   # Dev container configuration
â”œâ”€â”€ index.html
â”œâ”€â”€ vite.config.js
â””â”€â”€ package.json
```

The `python/` subtree holds an offline NASA SPICE reference used to check the JavaScript propagation against SPICE ephemerides.

## Testing

- **Physics core.** Run the Kepler and Lambert verification outside the browser:

  ```bash
  node src/physics/orbital.test.mjs
  ```

  This checks two-body propagation and the elements conversion against Curtis's worked examples and NAIF CSPICE (`src/physics/fixtures/spice_reference.json`, generated by `c/`), and the Lambert solver against the real MSL geometry from DE440 and an independent integrator. After `npm install`, `npm test` also runs `src/physics/porkchop.test.mjs` (astronomy-engine against DE440, and the porkchop grid on the 2011 Mars window) and `src/physics/nbody.test.mjs` (the spacecraft kernel: convergence order, time reversal, energy, the indirect term, events, low Earth orbit with the real Sun, Moon and planets, and escape from Earth).

- **In-browser checks.** `PhysicsTest` runs energy-conservation and Kepler checks against the live simulation. Its expectations predate the kernel (they assume a launch that ignores the planet's gravity) and need updating.

## Licence

MIT. See [LICENSE](LICENSE).
