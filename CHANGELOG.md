# Changelog

What users will notice, newest first. Numbers in brackets are pull
requests. The project follows [Semantic Versioning](https://semver.org/)
once it has releases. Until then, everything sits under Unreleased.

## Unreleased

### The project
- The 6-DOF craft's frame-cost check in `attitude.test.mjs` no longer fails by chance when `npm test` runs files side by side: it compares the CPU time of each frame with its point-mass twin's, and takes the median ratio (tolerance 1.1), instead of the wall clock's average against a 0.5 ms margin (this pull request).
- One [roadmap](docs/roadmap.md) lists what comes next: the accuracy roadmap from the Physics and accuracy page, merged with the follow-ups each piece of work left, by area (this pull request).
- `npm test` takes 146 s instead of 461 s on a shared machine. It runs the check files four at a time, with the journey and mission validations in parts, and prints each file's output whole and in order. MESSENGER's blind replay stops a day past the Earth flyby, where it is already lost. Every check prints the same tolerance and value as before ([docs/performance.md](docs/performance.md#the-test-suite), this pull request).
- A GPU benchmark or docs-clips run started inside `flock ~/.cache/digital-orrery/gpu-bench.lock …` no longer waits for ever on the lock its own wrapper holds: it sees the holder is its parent and goes on under it (this pull request).
- A git worktree builds and tests without a `node_modules` of its own: `src/physics/sgp4.js` imports satellite.js by name, and a small Vite plugin keeps its WebAssembly build out of the bundles, which come out byte for byte as before (this pull request).
- `npm run bench:frames` times the app's frames on the integrated and the discrete GPU, a build against main, and prints the table a pull request needs (this pull request).
- The README is half as long: what is accurate and what is not, with the roadmap, is now [docs/accuracy.md](docs/accuracy.md), the credits are [docs/credits.md](docs/credits.md), and the project's folders are in [How it fits together](docs/architecture.md). The accuracy page describes the kernel as it is now: error-controlled Dormand–Prince, Encke's method, impacts at the surface (this pull request).
- The clips are filmed again from the app as it is now, with three more: the Earth's satellites, its magnetic field and auroras, and Jupiter's irregular moons (this pull request).
- Clips of the app running in the README and the docs (a flight to the Earth, time warp, Jupiter's moons, the guides, a launch, the plotting table and Artemis II), and `npm run docs:clips` to film them again (#76).
- Screenshots in the README, a glossary, an architecture diagram, and the credits as tables (this pull request).
- CI, a contributing guide, a security policy, this changelog and a citation (#68).
- A think-aloud usability test kit: eight scenarios, a facilitator script, a recording sheet with SEQ and SUS, and a Firefox protocol (#58, `docs/ux/think-aloud/`).

### Planning and flying
- The plotting table's scope now shows where the planets are and will be. Each visited body has a ghost ring on every date of the journey (L for the launch, then each waypoint's number, amber where the craft meets it), and its path is drawn bright from the departure to the time cursor, so moving the cursor sweeps the planets round with the craft. For the leg under the cursor, the scope draws the phase angle at departure and says why the window opens then: "On 2028-03-25 Venus is 43° behind Earth. A Hohmann transfer (146 d, half an orbit) wants it 54° behind Earth", and how often that line-up comes round (Earth to Mars: 44° ahead, every 780 days) (this pull request).
- The delta-v ledger now says what each burn pays for and lists what costs nothing. A flyby's gravity assist is a credit line: the change it makes to the craft's heliocentric velocity, which an engine would have to burn for, less any burn at the flyby (Galileo's Earth flyby, +7.26 km/s, free). A powered flyby's burn says why it is paid: the pull turns the path but cannot change the speed about the planet. Each landing says how it is paid for: "powered descent 1.63 km/s from 100 km" on an airless body, "entry and parachutes, no propulsive Δv" through an atmosphere. The leg readouts and GO's Flybys and Landings rows show the same (this pull request).
- An orbit at the Moon (or any airless body) followed by a landing there no longer lands for free: the descent is priced at the orbit's speed, 1.63 km/s from 100 km, and the flight now flies it, and the lift-off after. From an Earth orbit, a landing is one deorbit burn and the entry, not a circularising burn; a journey that opens with an orbit change no longer loses the first half of its first burn (this pull request).
- The plan now says when a low lunar orbit falls. The Moon's lumpy field raises a low orbit's eccentricity until its periapsis reaches the ground, quickest near the equator, where journeys from the Earth arrive: 100 km up, within weeks. The planner flies the orbit's mean eccentricity through the stay, averaged over each turn, and a new low-orbit lamp warns when it falls in the stay, how short a stay holds, and how high an orbit does; the leg's panel has an Orbit row. 75 days 100 km up, the plan has it fall on day 29.6 and the kernel's flight hits the Moon on day 29.3; 200 km up it holds (this pull request).
- A flown journey's aims at a planet no longer cancel the planet's own pull. Each aim, flown without the planet, aims where the planned hyperbola would carry the craft by the arrival, not at the B-plane point, and the first measures the planet's pull up to the second with side runs. Corrections fall from 210 to 71 m/s on a year at Mars and home, from 1,131 to 460 on Galileo's route, and from 696 to 634 to Europa and home. Flybys now pass on the planned minute, where they came 40 minutes to an hour early (this pull request).
- A stay of 30 to 120 days in lunar orbit now has its plane priced: the planner flies the orbit's plane through the stay in the Moon's whole gravity field and the Earth's and the Sun's pull, averaged over each turn, prices leaving out of it on the day, and suggests the day near it the plane holds the way out. The trims on the way in put the capture in the plan's plane. Before, the leg said "not priced" and charged the burn in the plane: after 75 days 200 km up, 831 m/s against the 908 flown; now 921, within 1.5 % (this pull request).
- A journey started from a craft's own state now takes a deep-space burn (or a broken plane) on its first leg when that leg runs nearly 180° round the Sun, as legs between bodies do, with the craft's own orbit as the plane. From a craft near the Earth to Mars, leaving on 18 Nov 2026, the leg cost 12.72 km/s direct and now 5.47; flown, its corrections fall from 973 to 86 m/s. The plane lamp and the leg's options show it (this pull request).
- Leaving a moon for another planet, the planner takes the cheaper of the two ways out about the planet, a swing-by of it included, and charges a swing-by that comes within two planet radii a margin that grows to the surface. The price no longer jumps from one day to the next: leaving the Moon for Mars it fell 0.69 km/s between stays of 20 and 21 days, and now moves at most 39 m/s an hour. The flight aims a swing-by that passes close to the planet early, before the pass (this pull request).
- After a long stay in a planet's orbit, a flown journey now leaves for what the plan prices. The trims on the way in aim the parking orbit's node so it turns onto the plan's on the planned day, for under 1 m/s, and the planner prices the orbit's plane at the radius the capture flies, its mean radius. A year at Mars, the departure on the planned day was 3.5 % over the plan and is now 0.4 %; on the day the parking orbit lamp suggests, 4.3 % and now 0.2 %. The plan's estimate of the flight's wait for the plane now searches as the flight does (this pull request).
- A journey's capture now ends in a circular orbit at the planned height. The burn still starts at periapsis, steered in two halves, then a small Hohmann transfer sets the orbit's mean radius. Held retrograde, a 2 km/s capture at Mars left the orbit at e 0.046, and leaving a year later cost 3.8 % more than the plan; now it is e 0.002 and 0.8 %. A departure that waits for its orbit's plane now leaves at the cheapest moment, not the first half-day that saves 2 % (this pull request).
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
- A held attitude costs propellant as a real one does: the thrusters keep
  it within a 0.5° deadband by pulses of their minimum impulse bit, and
  the hold pays that limit cycle (about 0.34 kg a day for the app's
  craft, where it paid almost nothing), or the disturbance it holds
  against when that is larger. The ATTITUDE readout shows what holding
  costs a day (this pull request).
- A craft launched from the ROCKET tab turns as its own stage would: its
  inertia is a cylinder of the stack's diameter round a tank that holds
  its stages' propellant, and its thrusters are sized to turn it as
  briskly as the MISSION tab's craft, instead of both being the 1.5 t
  box's. The MISSION tab's own craft is unchanged (this pull request).
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
  not priced: J2 alone does not turn a lunar orbit (#94). At Jupiter and
  the other giants the node's rate takes their zonal terms beyond J2 as the
  kernel does (to J12 for Jupiter, 2.5 % faster than J2 alone 1.5 radii
  out); since #98 it had fallen back to J2 alone (this pull request).
- Journeys are flown in the full model, with the Earth's and the Moon's
  gravity fields (mascons included), drag and sunlight, and their craft
  no longer flies bare: a Moon landing comes down on its site. The bare
  model is kept as a fallback where the full model's aims can't converge,
  and the craft's Model row says so (#81).
- A journey from another planet to the Moon is flown to the Moon, not into
  the Earth: its aims are at the Moon itself, and a landing after a long
  capture works its descent out from the orbit it is in (this pull
  request).
- Journeys to and from the planets' major moons (Europa, Ganymede, Titan
  and the rest) are flown with those moons' gravity, as the kernel gives
  it. Earth orbit to Europa orbit is captured 0.1 km off its planned
  periapsis, where it came in 300 km low and hit Europa. A descent lands on
  Europa, Titan is entered at its planned height, a moon flyby is aimed at
  the moon, not its planet, and leaving Europa for Earth is flown within
  1 % of the planner's price. Captures and departures burn near
  impulsively, as the plan prices them (#105). The parking orbit at such a
  moon now holds the way out through its stay: its plane is set by the
  last aim down the planet's well, two days out, allowing for the stay's
  turn of it (ten degrees over six days at Europa), so leaving Europa for
  Earth costs 0.3 % over its price, not 0.9 % (this pull request).
- A leg that runs nearly 180 degrees round the Sun is planned on a broken
  plane: in the departure's orbit plane to about halfway, then a burn that
  turns the plane onto the target. Leaving lunar orbit for Mars after 23
  days costs 4.57 km/s, not 15.69, and the price no longer leaps as the
  stay changes. The flight no longer pays hundreds of metres a second
  chasing a plane that won't hold. A plane lamp says where the plane breaks,
  and the direct arc is listed beside it for comparison (#89).
- Burn nodes on a broken-plane or bi-elliptic leg no longer skip its burn
  at the break: the leg keeps it, priced by what the nodes left it to do,
  and aiming a node before the break aims it at the break point. In
  flight, such a leg's departure, if it waits, is re-aimed at the break
  point, not straight at the target (this pull request).
- Such a leg is now flown with a deep-space burn: the burn near halfway
  can go anywhere, so it reshapes the transfer as well as turning its
  plane. It is the optimum by Lawden's primer vector conditions, never
  dearer than the direct arc or the broken plane, and up to 76 m/s
  cheaper than the broken plane leaving Earth orbit for Mars in November
  2026. Its price still runs smoothly as the dates change. "Broken plane"
  is listed beside it and can be chosen, and the plane lamp says where the
  burn is (this pull request).
- Choosing the direct arc or the broken plane for a leg near 180 degrees
  can be undone: the planner's deep-space burn stays in the leg's options,
  where before only "Lambert, as scheduled" was left, priced as the direct
  arc but giving the deep-space burn. A stay re-timed by an option shows
  to a hundredth of a day, not as a long decimal (this pull request).
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
  app's DART strikes 23 m from Dimorphos's centre (#97).
- LRO's capture at the Moon in June 2009 flies in the app against its
  final reconstruction (`?mission=lro`), down to its 30 km commissioning
  orbit in the Moon's GRAIL field, checked degree by degree; burns the
  reconstruction can't resolve are fitted as the engine would fly them
  (#113).
- Voyager 2's Uranus encounter is checked too, past Miranda and Uranus on 24 January 1986 against NAIF's reconstruction: 2.3 km off twelve hours on, and 0.30 km with the reconstruction's thruster firings put back. Craft near Uranus and Neptune now feel the fields those reconstructions were fitted with: Uranus's J2 to J6 and its five moons' GMs from URA182 (Oberon's 214.2 km³/s², not 205.3), Neptune's J2 to J6 and pole from nep097. Neptune's new pole takes Voyager 2 at Triton from 3.2 km off to 2.6 km; the J2 two sigma larger that had brought it to 1.6 km only made up for those firings (this pull request).
- MESSENGER's cruise to Mercury, 2004 to 2011, flies in the app against
  JHU/APL's reconstruction (`?mission=messenger`): six flybys, every burn
  within 1.1 % and 1.7° of APL's record, and the sunlight it steered by
  fitted every 10 days, which brings 49 coast arcs within 5.4 km. A real
  mission's flown path is now interpolated in TT seconds, so a leap
  second no longer puts it 38 km off (this pull request).
- Craft near Mercury and Venus feel their gravity fields, MESSENGER's
  JGMESS160A and Magellan's MGNP180U, to degree 20 by default (`mercury:
  { degree }` and `venus: { degree }`, as the Moon's). MESSENGER's pass
  338 km over Venus now leaves 0.7 mm/s in the reconstruction's 10 s
  steps instead of 105, and ends 0.6 km off half a day later instead of
  4.0 (this pull request).
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
  after which every step ran on the page's thread (#82). On a slow
  connection the worker's tables can take longer to load than that
  timeout; the timeout now waits for them (this pull request).
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
  (#98).
- Saturn pulls with its zonal field to J12, Jupiter with the tide its
  moons raise on it, and Enceladus with its J2 and C22; Saturn's moons are
  placed to 16 m. Four more passes check the kernel against the craft's
  own tracks: Juno at Europa, Cassini at Enceladus and between Saturn
  and its rings, and Voyager 2 at Neptune and Triton (this pull request).

### The sky and its bodies
- Landing sites beyond the Moon: 37 more places where spacecraft landed, crashed, struck or went in, on Mars (Vikings to Perseverance and Tianwen-1, with the crashes and the Soviet estimates), Venus (the Veneras, Vegas and Pioneer Venus probes), Mercury (MESSENGER), Titan (Huygens), Jupiter (the Galileo probe), Saturn (Cassini), and Eros, Ryugu and Bennu. Each is placed on its body's reference ellipsoid, turned with its IAU rotation, with its source on its plate: NASA NSSDCA, the PDS, NASA's and ESA's mission pages and papers. The rail's Landings section and FIND reach every one ([landing sites](docs/frontend/landing-sites.md#beyond-the-moon), this pull request).
- Close to the ISS, Tiangong or Hubble, the satellite is drawn as a small model at its published size, in its orbit's local vertical frame with its arrays turned to the Sun, lit by the Sun and the Earthshine and dark in the Earth's shadow; any other satellite as a stand-in, and its plate says so ([satellites](docs/frontend/satellites.md#close-up-models), this pull request).
- The satellite plate gives the speed over the turning Earth and the ground track's speed beside the inertial speed, live as the clock runs (the ISS: 7.67, 7.34 and 6.87 km/s) (this pull request).
- Clicking a guide's tag (a pole, an SOI or Hill sphere, a Lagrange point, a pull, a field's tag) or an orbit line opens a plate: the pole's RA and Dec and the axis's tilt, the sphere's radius, the point's distances and stability, the pull, the orbit's elements, each with its source tag. They had a hover title or nothing ([what a click shows](docs/frontend/scene.md#what-a-click-shows), this pull request).
- The landing-site plate's equations show again: their TeX had lost its backslashes (this pull request).
- Pan across the solar system with a body in focus: right-drag, middle-drag or Shift-drag, or two fingers on touch, which also pinch-zoom (the touch hint promised pinch; nothing handled it). C, a double-click on the sky or the view plate's CENTRE key puts the view back on the body; a panned view rides with the body under time warp ([camera](docs/frontend/camera.md#panning), this pull request).
- A HOME key on the view plate, and H, fly back to the opening view (this pull request).
- A refresh comes back to where you were: the body, the camera and its pan, the clock's time, rate and RUN or HOLD, from this tab's session, and every layer switch in the rail, for this browser. A new tab starts at home, and a URL's `?focus=` or `?t=` still wins ([camera](docs/frontend/camera.md#across-a-refresh), this pull request).
- The Moon's landing sites, as a layer the rail's **Moon landings** section switches on: every soft landing from Luna 9 to Blue Ghost, where Lunokhod 1 and 2 and Yutu stopped, the landers that crashed and were found, and the early craft never found. Each is where the LROC team measured it in its images, to metres, and the rail flies to any one, framing it from low over the ground across the sunlight, the camera's up the site's own vertical. Its plate gives the mission, when it landed, the crew, the coordinates and their source, and the Sun's height there now. The sites are within 85 m of SPICE's MOON_ME (this pull request).
- The planets' and moons' maps load GPU-compressed where the GPU can take
  them (KTX2 with Basis Universal, transcoded to BC7, ASTC or ETC2): a
  quarter of the video memory, so an 8k map takes 45 MB, not 179. Colour
  maps that look the same are ETC1S, about the WebP's size; the rest, and
  the normal maps, are UASTC, 2.5 to 4 times larger to download (the
  Moon's map 25 MB, not 5.5). The sky stays WebP, so the start downloads
  no more than before. Other GPUs, and `?webp`, keep the WebP maps.
  `npm run build:textures` rebuilds them, `npm run bench:textures`
  measures them (this pull request).
- Jupiter, Uranus and Neptune have their rings. Uranus's ten narrow rings run on their measured orbits (French et al. 2024), eccentric, tilted and precessing, with depths and shapes from Voyager's occultations; its dust bands, ν and μ are there too. Neptune's Adams arc sits where it was last measured, with Le Verrier, Lassell and Galle. Jupiter's main ring, halo and gossamer rings are dust: faint, and brightest from Jupiter's shadow. Rings narrower than a pixel stay one steady line. They are as faint as the real ones; `?exposure=N` lengthens the exposure, as ring photographs do ([rings](docs/frontend/rings.md); #110).
- The rings are truer to the measurements: Uranus's rings carry all ten of their measured normal modes; Neptune's Adams ring has the 42 lobes Galatea forces on it, and its arcs are as bright and where they were at each date they were seen, so Liberté and Courage are gone since 2009; the ring particles are as dark as Voyager measured them (#120).
- Jupiter's main ring has its measured shape: brightest over its outer 1,000 km, at 1.7 times its mean, from 16 New Horizons LORRI images reduced to brightness against radius (this pull request).
- Planets and Pluto come from JPL DE442 for 2000–2050 (#48). The moons
  come from JPL's satellite ephemerides to within a kilometre, 76 of them
  (#33, #56). The Earth turns on UT1 with polar motion (#50).
- Jupiter's, Saturn's and Neptune's 381 irregular moons, as a layer the
  rail switches on: points, labels and orbit lines, and each one to fly
  to with a plate of its orbit, sense, size, GM and discovery. From 2000
  to 2049 they come from JPL's satellite kernels for them, within 0.51 km
  (#80). Each has a real size, measured by NEOWISE for 13 and estimated
  from its brightness for the rest, and the 23 whose shape is known are
  drawn as ellipsoids turning at their measured periods (this pull
  request).
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
  plate. A **Latest** key fetches CelesTrak's current elements (#79).
- Tracked debris and spent rocket bodies round the Earth, each on a switch
  of its own in the rail and drawn dimmer, in a colour of its own: the
  2,679 pieces of the three breakups CelesTrak keeps as groups (Fengyun-1C
  in 2007, Cosmos 2251 and Iridium 33 in 2009), 2,194 rocket bodies and 573
  analyst objects. A debris cloud can be flown to from the rail, which
  draws its pieces brighter and gives its breakup and orbits on a plate.
  Search finds any of them (this pull request).
- Spacecraft beyond Earth orbit: the orbiters of Mercury, the Moon, Mars
  and Jupiter, the observatories about the Sun-Earth L1 and L2 points (JWST,
  Roman, Euclid and others) and the probes in cruise, on JPL Horizons'
  trajectories for 2026 and 2027, with their paths, a fly-to list and a data
  plate that says whether the clock is in a reconstruction or a prediction
  (this pull request).
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
  (#100).
- The Earth's field lines are bent by its magnetosphere for the day's Kp
  (Tsyganenko's T89): squeezed on the day side, drawn into a tail on the
  night side. Saturn's lines stretch through Voyager's ring current,
  Ganymede's close inside Jupiter's field and open into it, and the Sun
  has field lines too, from the Wilcox Solar Observatory's model for the
  date's Carrington rotation: loops over the streamer belt and open lines
  from the polar holes (#118).
- The Earth's magnetopause and bow shock are drawn for the solar wind
  NOAA measured, when the clock is within the last week, and the Earth's
  field lines end at the magnetopause. Jupiter's and Saturn's
  magnetopauses and Jupiter's bow shock are drawn too. With the Sun
  focused, its current sheet and Parker spiral reach out to 6 AU, in
  amber and blue sectors (this pull request).
- The gravity field of every body at once, as field lines flowing toward
  the masses in a plane through the focus: inertial, falling with the
  focus, less its own pull (Jupiter's moons' wells), or in the rotating
  frame of the focus and its parent, with the zero-velocity curves through
  L1–L3. The spin axes show which way each body turns, with Venus, Uranus
  and Pluto marked retrograde. Orbit lines fade where they pass close to
  the camera against their size, so a body's own orbit no longer cuts
  across the view when zoomed in on it (this pull request).
- A sharp Milky Way and a Sun that keeps one size (#34). The belt's haze
  costs a fifth as much on an integrated GPU (#55).
- Stars twinkle when seen through the Earth's lower atmosphere (#61). The
  Sun's corona shows when a body covers its disc (#63). The glare and the
  sky's dimming are checked from other planets and in transits (#67).
- The Earth's sky costs less near the Earth: frames 40 % shorter on an
  integrated GPU with the Earth in view, and 23 % in low orbit at a day a
  second, with the same look (#122).
- The Earth's air now scatters sunlight more than once, from Hillaire's
  multiple-scattering table: the twilight band reaches further past the
  terminator, bluer, the lit edge of a crescent Earth is bluer, and the
  haze over the day side is a little stronger. While the clock is held and
  the camera still (or only turning), the sky's table of view rays is no
  longer marched again every frame (this pull request).
- The faint belt's file is a quarter smaller, 17.4 MB instead of 23.1 MB,
  so the haze loads sooner on a slow link (this pull request).

### The console
- The MISSION tab after a launch is a short panel, not a wall: the craft's readout stays on top, ENGINE and MANOEUVRE NODE stay open, and ATTITUDE, TRACKING and the LOG fold, each saying what it holds in its header ("Holding prograde · 0.06°/s", "fix every 24 h", the last log line), as do the engine, the node and the launch sections. The nine attitude keys sit as three opposed pairs (PROGRADE and RETROGRADE, NORMAL and ANTI-NORMAL, RADIAL OUT and RADIAL IN), then NODE, HOLD and FREE. REMOVE CRAFT acts at once again, since the notice at the top restores it (this pull request).
- The console's quick fixes from the second design critique: the GO board leaves a row with nothing to report dark (FLYBYS reads N/A, not a green GO for none) and checks the launch's parking orbit; ARMED is caution yellow with an ink legend, not the dark look of a selected key; removing a ROCKET stage asks to confirm; the focus ring is ink (orange read 2.8:1), FIND's placeholder 8.5:1, and its failure line no longer lingers after a pick; the ? sheet lists FIND's own keys; the ROCKET tab opens with Vehicle folded; "Size for this job" fits its key (this pull request).
- On a phone the header names the app ("digital-orrery: the real solar system, now, from NASA ephemerides"), and a first visit shows one line over the sky on how to touch it ("Tap a body's name to fly there · drag to turn · pinch to zoom"), gone at the first touch and remembered by the browser (this pull request).
- The ROCKET tab's sections say what they hold in their headers (the vehicle's mass and delta-v, the job and what it needs, the flight once flown), so a folded section still reads; the OpenRocket comparison stays folded until a design is open; and Launch from the pad is armed first, as the MISSION tab's launch is (this pull request).
- One FIND field at the top of the body rail reaches everything the app flies to: the planets and major moons, the irregular moons, the 135,353 asteroids and comets, the satellites, the spacecraft beyond Earth and the Moon's landing sites, each kind in a group of its first three matches with a kind tag on each. The `/` key focuses it; the arrow keys move through the matches, Enter flies to the marked one and Esc closes the list. A find whose layer is off switches that layer on first and says so under the field ("Satellites shown"). It replaces the small bodies' and the satellites' search boxes and the irregular moons' 381-entry Fly to list. The `?` key opens a sheet of every keyboard shortcut, and the rail's foot now reads "? keys · / find" (this pull request).
- The MISSION tab's launch is armed, then fired: ARM lights in caution yellow and says what will fly and when, LAUNCH fires it, and DISARM, Esc or any change to the form stands it down (this pull request).
- The console follows real flight panels' rules (now in DESIGN.md, from NASA-STD-3001 and MIL-STD-1472): every label is 6:1 or better against its panel (engraved labels darker, oxblood), a lit RUN key carries a dark legend, unlit lamps' labels read, the plotting table's DELTA-V lamp stays dark until there is a journey, and a flow's commit key (Fly it, Launch, Commit to the orrery) is a taller key outlined in ink, so RUN is the one orange key. STACK's real-launcher verdicts no longer run into their source tags (this pull request).
- The body rail keeps every planet in view at a laptop's height (1440×900, 1366×768): it scrolls as one, so no list in it is squashed to a row and its foot (keys, how it works, credits) is always reachable. On a phone the page no longer slides sideways (the guides row scrolls in its own strip, and opening the console no longer pans the app), and the sky keeps about 180 px when the data or the console is open, where it fell to about 20 px (this pull request).
- The plotting table's GO board names the rocket it checks (STACK's sized stack, the ROCKET tab's "Journey's stack"), and the ROCKET tab says when it shows another vehicle, with a key to fly the journey's stack. The irregular-moon list says "retrograde" in place of "(r)", and the journey's date control reads "When a date slides: later ones follow / later ones stay" (this pull request).
- Source tags open each value's equation and source, set in a bundled
  math font (#31, #36, #37). The app has an icon (#31).
- The console's HDR sky and camera flights (#28).

### Fixes
- Switching the irregular moons off, or flying away from their planet, no longer leaves their names on the screen: the names were hidden only while the moons' points were drawn (this pull request).
- Choosing a planet in the rail below an open moon grid no longer makes its row jump from under the pointer (by up to 362 px, leaving a switch there for the next click), on a desktop or a phone ([camera](docs/frontend/camera.md#the-rail-holds-still), this pull request).
- A gravity field asked for past degree 85 no longer comes out wrong. At
  degree 100 it was off by up to 0.07 % (Venus, 300 km up); now it is
  within 7×10⁻¹⁵ of an independent oracle, over the Moon's pole too.
  Mercury's and Venus's fields now go to degree 100, as the Moon's does,
  and each call is 6 to 10 % faster (#140).
- A craft's orbit line and flown trail run up to and through it from any
  distance. Followed from under a kilometre they used to stop a kilometre
  short, and from 10 km the orbit line passed about 500 m beside the craft
  (#96).
- Satellite passes over a place: the satellite plate lists the next
  three days' passes over a latitude, longitude and height (kept in the
  browser; **Locate** asks the browser), each with its rise, peak and set,
  their times, directions and ranges, and whether it can be seen: sunlit
  with the Sun 6° below the horizon. The ground under the satellite can
  be drawn on the Earth, its next pass brighter. The rail's **Passes** key
  shows the ISS's. Checked against Heavens-Above's predictions for the
  same element set: 90 passes over Greenwich and Sydney, within a second
  and their whole degree, each marked visible or not as they mark it
  (this pull request).
- A followed Earth satellite's orbit line runs through it from any
  distance. From closer than a tenth of its distance from the Earth (680
  km for the ISS) the line about it is drawn from SGP4 every frame; before,
  the ISS's line passed 0.5 to 1.4 km beside it (this pull request).
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
