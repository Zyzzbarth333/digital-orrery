# Changelog

What users will notice, newest first. Numbers in brackets are pull
requests. The project follows [Semantic Versioning](https://semver.org/)
once it has releases. Until then, everything sits under Unreleased.

## Unreleased

### The project
- `npm run bench:frames` times the app's frames on the integrated and the discrete GPU, a build against main, and prints the table a pull request needs (this pull request).
- The README is half as long: what is accurate and what is not, with the roadmap, is now [docs/accuracy.md](docs/accuracy.md), the credits are [docs/credits.md](docs/credits.md), and the project's folders are in [How it fits together](docs/architecture.md). The accuracy page describes the kernel as it is now: error-controlled Dormand–Prince, Encke's method, impacts at the surface (this pull request).
- Clips of the app running in the README and the docs (a flight to the Earth, time warp, Jupiter's moons, the guides, a launch, the plotting table and Artemis II), and `npm run docs:clips` to film them again (this pull request).
- Screenshots in the README, a glossary, an architecture diagram, and the credits as tables (this pull request).
- CI, a contributing guide, a security policy, this changelog and a citation (#68).
- A think-aloud usability test kit: eight scenarios, a facilitator script, a recording sheet with SEQ and SUS, and a Firefox protocol (#58, `docs/ux/think-aloud/`).

### Planning and flying
- Craft launched in the app carry an attitude (6-DOF). The MISSION tab
  points them prograde, retrograde, normal, radial, along the next node
  or holds them still, and they turn in the time their thrusters' torque
  allows, under the gravity gradient and, low in the air, the drag's
  torque. Burns fire along the body axis. Within 50,000 km the scene draws
  the craft's attitude at its marker. Real missions and journeys stay
  point masses. A followed craft's marker no longer vanishes when the
  camera is under a kilometre away (this pull request).
- A 6-DOF craft's attitude thrusters burn propellant from its tank, shown
  in the ATTITUDE readout; its inertia falls as the tank empties, so it
  turns faster light; and it turns to each manoeuvre node by itself, in
  time to settle before the node fires (AUTO NODE TURN), saying in the
  log when it can't. The node mode now holds the direction it burned
  along afterwards (this pull request).
- Plan a journey of any number of legs, compare each leg's transfers, fly
  it in the kernel and size the rocket for it (#41). Shape it by hand with
  burn nodes and flyby aims (#44). Plan it on a full-screen plotting table
  (#51), with STACK and GO stations (#54). Resonant returns to the same
  planet, as Galileo's Earth flybys (#59). Journeys land, stay and lift
  off, and leave a moon for another planet (#65).
- Leaving a moon for another planet is priced by where the moon really is
  on the day, so the planner's price for leaving lunar orbit for Mars is
  within 2 % of the flight's, not 26 % short. The window strips for such
  legs show the month's ripple a day at a time, and the planner suggests
  the best day in the stay: an option, a lamp and a mark on the strip
  (#81).
- A long stay in a planet's orbit turns the orbit's plane (the planet's
  J2 regresses its node, about 9° a day 400 km over Mars), and the planner
  now prices it. The departure is priced out of the plane on the planned
  day, the leg shows how far off the plane is, and the window strip prices
  each date with it. A parking orbit lamp, an option and a mark on the strip give
  the day near the planned one when the plane holds the way out. After a
  year at Mars the plan's price for the departure is within 5 % of the
  flight's, and the flight's wait for the plane within a day. The Moon is
  not priced: J2 alone does not turn a lunar orbit (this pull request).
- Journeys are flown in the full model, with the Earth's and the Moon's
  gravity fields (mascons included), drag and sunlight, and their craft
  no longer flies bare: a Moon landing comes down on its site. The bare
  model is kept as a fallback where the full model's aims can't converge,
  and the craft's Model row says so (#81).
- A journey from another planet to the Moon is flown to the Moon, not into
  the Earth: its aims are at the Moon itself, and a landing after a long
  capture works its descent out from the orbit it is in (this pull
  request).
- A leg that runs nearly 180 degrees round the Sun is planned on a broken
  plane: in the departure's orbit plane to about halfway, then a burn that
  turns the plane onto the target. Leaving lunar orbit for Mars after 23
  days costs 4.57 km/s, not 15.69, and the price no longer leaps as the
  stay changes. The flight no longer pays hundreds of metres a second
  chasing a plane that won't hold. A plane lamp says where the plane breaks,
  and the direct arc is listed beside it for comparison (this pull request).
- The ROCKET tab offers the journey's own stack, as the plotting table's
  STACK station sizes it, beside the real launchers, and the journey as
  its job: its ascent can be flown and launched from the pad. What sizing
  leaves out (thrust, sea-level Isp, size, drag) are the real launchers'
  medians, shown as estimates (this pull request).
- The ROCKET tab flies OpenRocket designs (#29). It starts from real
  launchers, Saturn V, Falcon 9 and Electron, greyed as published (#35).
- Artemis I and II fly in the app against NASA's trajectories (#19, #21,
  #24), with Orion's mass falling burn by burn (#30). Orion flies its
  entry to splashdown (#26).
- Juno's 2012 deep-space burns and 2013 Earth flyby fly in the app against
  JPL's reconstruction (`?mission=juno2013`), and DART's last five weeks to
  Dimorphos against its navigators' (`?mission=dart`): burns along their
  measured directions about the Sun, aims flown in the craft's own
  sunlight and as they are flown; Juno shows no flyby anomaly, and the
  app's DART strikes 23 m from Dimorphos's centre (this pull request).
- Craft feel the planets' major moons near them (#39), with their J2 and
  C22 (#49), the heaviest asteroids (#53), and sunlight pressure with
  Earth and Moon shadows (#22).
- The kernel integrates about the solar system barycentre, with the Sun
  on DE442's path, as DE, GMAT and Orekit do (#64).
- Impacts and touchdowns are found where the craft met the ground, not up
  to a step later and tens of kilometres below it, so a landing's speed is
  its speed at the surface (#77). The moons' pull is checked on Juno's
  pass over Io and Cassini's over Titan too, which measure those moons'
  J2 and C22 (#77).
- At a day a second the kernel stays in its worker through Artemis II's
  entry: each request has a time budget, so the entry is flown in pieces
  rather than in one 4 s request that the page took for a dead worker,
  after which every step ran on the page's thread (#82).
- The kernel places the moons of Mars, Saturn, Uranus, Neptune and Pluto
  to 10 m instead of 100 m, so a slow pass is followed more closely:
  Cassini's over Titan to 4 m nine hours on, from 93 m (#86).
- Jupiter, Saturn, Uranus and Neptune pull with their J4 as well as their
  J2, from the same published solutions: Juno's pass over Io is followed
  to 40 m an hour on, from 51 m (#93).
- Jupiter pulls with its zonal field to J12, and the kernel places
  Jupiter and its four large moons to 10 m instead of 100 m. Juno is
  followed through its PJ57 perijove, 1.02 Jupiter radii out, to 0.28 km
  there and 0.55 km two hours on; with J2 and J4 alone it was 5 km
  (this pull request).

### The sky and its bodies
- Planets and Pluto come from JPL DE442 for 2000–2050 (#48). The moons
  come from JPL's satellite ephemerides to within a kilometre, 76 of them
  (#33, #56). The Earth turns on UT1 with polar motion (#50).
- Jupiter's, Saturn's and Neptune's 381 irregular moons, as a layer the
  rail switches on: points, labels and orbit lines, and each one to fly
  to with a plate of its orbit, sense, size, GM and discovery. From 2000
  to 2049 they come from JPL's satellite kernels for them, within 0.51 km
  (this pull request).
- Bodies are drawn as their IAU ellipsoids (#47). Fourteen moons have USGS
  surface maps (#42).
- 135,353 asteroids and comets (#27), the faint main belt as a haze from
  1.45 million orbits (#32). Any of them can be found and flown to (#52,
  #62).
- Every barycentre can be flown to, with orbits about the SSB (#38).
- Earth satellites: the 16,892 active satellites CelesTrak lists, moved by
  SGP4 from their GP element sets and turned from TEME into J2000, dimmer
  in the Earth's shadow. The ISS, Tiangong, Hubble, GPS, Galileo and the
  geostationary weather satellites have their orbits. Any satellite can be
  found by name, NORAD number or designator and flown to, with a data
  plate. A **Latest** key fetches CelesTrak's current elements (this pull
  request).
- Guides for spin axes, real gravity fields, spheres of influence,
  Lagrange points and the strongest pulls (#43).
- Magnetic fields and auroras, two new guides. Field lines traced through
  the Earth's (IGRF-14), Jupiter's (JRM33 with its current sheet),
  Saturn's (Cassini) and Uranus's and Neptune's (Voyager) measured fields,
  shaded by strength, with each dipole's tilt and offset. The Earth's
  auroral ovals for the day's Kp, green below red on the night side;
  Jupiter's and Saturn's main ovals and Io's footprint (#84).
- The Earth's aurora comes from NOAA's live OVATION Prime map when the
  clock is near now, Starkov's oval otherwise. Uranus's and Neptune's
  auroral zones and Mercury's field join the guides, and a third guide
  draws the radiation belts of the Earth, Jupiter and Saturn along their
  L-shells, the Earth's inner belt dipping over the South Atlantic (#88).
- Ganymede's own field and auroral ovals, Mars's magnetised crust and its
  aurora, and Europa's, Ganymede's and Enceladus's auroral footprints
  beside Io's, each placed ahead of its field line by the lead angle Juno
  measured. Uranus and Neptune have radiation belts too, and the belts
  cost an integrated GPU about a millisecond at Earth instead of eight
  (this pull request).
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
- A craft's orbit line and flown trail run up to and through it from any
  distance. Followed from under a kilometre they used to stop a kilometre
  short, and from 10 km the orbit line passed about 500 m beside the craft
  (this pull request).
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
