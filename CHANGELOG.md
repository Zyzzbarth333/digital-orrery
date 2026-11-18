# Changelog

What users will notice, newest first. Numbers in brackets are pull
requests. The project follows [Semantic Versioning](https://semver.org/)
once it has releases. Until then, everything sits under Unreleased.

## Unreleased

### The project
- Clips of the app running in the README and the docs (a flight to the Earth, time warp, Jupiter's moons, the guides, a launch, the plotting table and Artemis II), and `npm run docs:clips` to film them again (this pull request).
- Screenshots in the README, a glossary, an architecture diagram, and the credits as tables (this pull request).
- CI, a contributing guide, a security policy, this changelog and a citation (#68).
- A think-aloud usability test kit: eight scenarios, a facilitator script, a recording sheet with SEQ and SUS, and a Firefox protocol (#58, `docs/ux/think-aloud/`).

### Planning and flying
- Plan a journey of any number of legs, compare each leg's transfers, fly
  it in the kernel and size the rocket for it (#41). Shape it by hand with
  burn nodes and flyby aims (#44). Plan it on a full-screen plotting table
  (#51), with STACK and GO stations (#54). Resonant returns to the same
  planet, as Galileo's Earth flybys (#59). Journeys land, stay and lift
  off, and leave a moon for another planet (#65).
- The ROCKET tab flies OpenRocket designs (#29). It starts from real
  launchers, Saturn V, Falcon 9 and Electron, greyed as published (#35).
- Artemis I and II fly in the app against NASA's trajectories (#19, #21,
  #24), with Orion's mass falling burn by burn (#30). Orion flies its
  entry to splashdown (#26).
- Craft feel the planets' major moons near them (#39), with their J2 and
  C22 (#49), the heaviest asteroids (#53), and sunlight pressure with
  Earth and Moon shadows (#22).
- The kernel integrates about the solar system barycentre, with the Sun
  on DE442's path, as DE, GMAT and Orekit do (#64).
- Impacts and touchdowns are found where the craft met the ground, not up
  to a step later and tens of kilometres below it, so a landing's speed is
  its speed at the surface (this pull request). The moons' pull is checked
  on Juno's pass over Io and Cassini's over Titan too, which measure
  those moons' J2 and C22 (this pull request).
- At a day a second the kernel stays in its worker through Artemis II's
  entry: each request has a time budget, so the entry is flown in pieces
  rather than in one 4 s request that the page took for a dead worker,
  after which every step ran on the page's thread (this pull request).

### The sky and its bodies
- Planets and Pluto come from JPL DE442 for 2000–2050 (#48). The moons
  come from JPL's satellite ephemerides to within a kilometre, 76 of them
  (#33, #56). The Earth turns on UT1 with polar motion (#50).
- Bodies are drawn as their IAU ellipsoids (#47). Fourteen moons have USGS
  surface maps (#42).
- 135,353 asteroids and comets (#27), the faint main belt as a haze from
  1.45 million orbits (#32). Any of them can be found and flown to (#52,
  #62).
- Every barycentre can be flown to, with orbits about the SSB (#38).
- Guides for spin axes, real gravity fields, spheres of influence,
  Lagrange points and the strongest pulls (#43).
- A sharp Milky Way and a Sun that keeps one size (#34). The belt's haze
  costs a fifth as much on an integrated GPU (#55).
- Stars twinkle when seen through the Earth's lower atmosphere (#61). The
  Sun's corona shows when a body covers its disc (#63). The glare and the
  sky's dimming are checked from other planets and in transits (#67).

### The console
- Source tags open each value's equation and source, set in a bundled
  math font (#31, #36, #37). The app has an icon (#31).
- The console's HDR sky and camera flights (#28).

### Fixes
- Artemis II at a day a second reads true: switched there straight from
  real time before the injection, its distance from the flown path no
  longer jumps to tens of thousands of km while the kernel catches up, and
  past separation the capsule waits at the entry interface for the kernel
  instead of being drawn flying off to 100 million km, then lies at its
  splashdown site (this pull request).
- A craft in low orbit at high time warp no longer stalls the frame on an
  integrated GPU: the drawn craft's carry is 2.3–2.7× cheaper (this pull
  request).
- The ground stays drawn near a body: the camera can't go under it, and
  the horizon has no gaps (#66).
- Moons without an IAU model have their axes again, and the scene no
  longer throws every frame (#60).
- A splashdown reads DOWN, not LOST (#45). The focused body's orbit line
  is smooth up close (#40, #46).
- Craft are drawn correctly through big burns and close passes (#25).

### Earlier, 12–13 November 2026
- The verified orbital core and porkchop planner (#2), the n-body kernel
  in a Web Worker (#3, #4), Encke's method (#12, #14), DE442 reference
  data (#6, #8), Earth's and the Moon's J2 (#20), and the true-scale front
  end with real surfaces, rings, stars and atmosphere (#10, #11, #13,
  #15–#18). The physics documentation (#9).
