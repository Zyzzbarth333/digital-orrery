# Glossary

The terms the app and these docs use, in plain words, with the formula
where it helps. Each entry links to the page that covers it in depth.

**Jump to:** [Time and frames](#time-and-frames) ·
[Ephemerides and data](#ephemerides-and-data) ·
[Orbits](#orbits) · [Transfers and journeys](#transfers-and-journeys) ·
[Forces and integration](#forces-and-integration) ·
[Rockets and missions](#rockets-and-missions) ·
[Magnetic fields and auroras](#magnetic-fields-and-auroras) ·
[The sky and drawing](#the-sky-and-drawing)

## Time and frames

**UTC.** Civil time, which the app's clock shows. It is kept within a
second of the Earth's turning by leap seconds.

**TT, TDB.** The smooth time scales the physics runs on. TT (Terrestrial
Time) is UTC plus 32.184 s plus the leap seconds so far. TDB
(Barycentric Dynamical Time) differs from TT by under 2 ms, periodically.
The kernel counts TT seconds, so nothing jumps at a leap second.
[Frames, units and time](physics/frames-and-time.md)

**UT1.** Time by the Earth's actual rotation, which wanders from UTC by
up to 0.9 s. The app turns the Earth by UT1, with polar motion.
[Body orientation](physics/orientation.md)

**J2000, ICRF, EQJ.** The reference frame almost everything here uses:
axes fixed to distant quasars, aligned with the Earth's equator and
equinox of 1 January 2000, 12:00 TT. "EQJ" is the same frame by its
astronomy-engine name. [Frames, units and time](physics/frames-and-time.md)

**TEME.** True equator, mean equinox: the frame SGP4 works in. Its z axis
is the Earth's pole of date, and its x axis the mean equinox moved along the
equator of date by the equation of the equinoxes. The app turns it into
J2000 with the IAU 1976 precession and 1980 nutation.
[Earth satellites](frontend/satellites.md#from-teme-to-j2000)

**Ecliptic.** The plane of the Earth's orbit. The scene draws in ecliptic
axes, so the planets lie roughly flat.

**Body-fixed frame.** Axes that turn with a body, so a crater keeps its
longitude and latitude. Each body's comes from its IAU rotation model.
[Body orientation](physics/orientation.md)

**Barycentre.** The centre of mass of two or more bodies, about which they
all orbit. The Earth and Moon orbit their barycentre, 4,670 km from the
Earth's centre. [Barycentres](frontend/barycentres.md)

**SSB (solar system barycentre).** The centre of mass of the whole solar
system. It is up to about two solar radii from the Sun's centre, mostly
because of Jupiter. The kernel integrates spacecraft about it.
[The n-body kernel](physics/nbody-kernel.md)

**Heliocentric.** Measured from the Sun's centre. The app's readouts give
distances from the Sun, even though the kernel works about the SSB.

## Ephemerides and data

**Ephemeris.** A table or formula that gives where a body is at any time.

**DE442.** JPL's current planetary ephemeris (2024). It fits centuries of
radar, spacecraft and telescope data. The app carries it as Chebyshev
series, within a metre, for 2000–2050.
[Ephemerides, barycentres and GM](physics/ephemerides-and-gm.md)

**Chebyshev series.** A sum of Chebyshev polynomials that approximates a
smooth function over an interval. JPL's ephemerides are stored this way,
and so are the app's tables.

**SPICE, NAIF.** NASA's toolkit for space geometry (SPICE), and the team at
JPL that maintains it and publishes its data files (NAIF). The kinds of
data file:
- **SPK:** positions.
- **PCK:** shapes and rotations.
- **LSK:** leap seconds.

The app's tests are checked against SPICE's own results.

**JPL Horizons.** JPL's online ephemeris service. The app's moons,
asteroids and Artemis I fixtures are checked against it.

**SBDB.** JPL's Small-Body Database, the source of the app's 135,353
asteroids and comets. [Asteroids and comets](frontend/small-bodies.md)

**Reconstructed and predicted trajectories.** A spacecraft's path as its
navigation team fits it to tracking after the fact (reconstructed), or
works it out ahead (predicted, which leaves out manoeuvres planned later).
JPL Horizons joins the two. [Spacecraft beyond Earth orbit](frontend/spacecraft.md)

**TLE, GP elements, OMM.** The orbits the US Space Force publishes for every
object it tracks: "general perturbations" (GP) mean elements, fitted for
SGP4. The two-line element set (TLE) is their old fixed-column form; the
Orbit Mean-Elements Message (OMM) carries the same keywords as XML, JSON or
CSV, and allows catalogue numbers past 99,999. CelesTrak serves them. The
app's Earth satellites come from them.
[Earth satellites](frontend/satellites.md#the-data)

**GM.** A body's mass times the gravitational constant, in km³/s². GM is
known far more precisely than either factor alone, so the physics uses it
directly.

**Retrograde rotation.** A body turning against its own orbit: its spin
axis more than 90° from its orbit's pole. Venus, Uranus and Pluto do; seen
from above the ecliptic, Venus turns clockwise.
[Gravity guides](physics/gravity-guides.md#spin-axes-and-direction)

**IAU rotation model.** The International Astronomical Union's formulas for
each body's pole direction and prime meridian over time. The app uses
NAIF's `pck00011` edition.

## Orbits

**Orbital elements.** Six numbers that fix an orbit and a place on it:
- **a:** the semi-major axis, its size.
- **e:** the eccentricity, its shape.
- **i:** the inclination, its tilt.
- **Ω:** the longitude of the ascending node, where it crosses the
  reference plane going up.
- **ω:** the argument of periapsis, where its closest point lies.
- **M:** the mean anomaly, where the body is along it.

[Two-body propagation](physics/two-body.md)

**Osculating elements.** The orbit a body would follow if every force but
its primary's point-mass pull switched off at that instant. The readouts
tagged "2-body" are osculating.

**Mean elements.** Orbit elements averaged over the perturbations, so they
change slowly and smoothly. They are used for moons outside their
tables' years.

**Periapsis, apoapsis.** An orbit's closest and furthest points from its
primary: perigee and apogee about the Earth, perihelion and aphelion
about the Sun.

**Kepler's equation.** The equation that turns time into position along an
ellipse: $M = E - e \sin E$, solved for the eccentric anomaly $E$.

**Two-body problem.** One body orbiting another under their mutual
gravity alone. It has exact conic-section solutions.

**Universal variables.** A form of the two-body solution that covers
ellipses, parabolas and hyperbolas with one formula, using Stumpff
functions. [Two-body propagation](physics/two-body.md)

**Sphere of influence (SOI).** The region where a planet's pull, not the
Sun's, best describes a craft's motion. Its radius is
$r \approx a\,(m/M)^{2/5}$; the Earth's is about 925,000 km.
[Gravity guides](physics/gravity-guides.md)

**Hill sphere.** The region where a body can hold a satellite against the
Sun's tide. Its radius is $r \approx a\,(m/3M)^{1/3}$.
[Gravity guides](physics/gravity-guides.md)

**Lagrange points (L1–L5).** The five places where a small body can keep
station with two larger ones, turning with them. L4 and L5 lie 60° ahead
of and behind the smaller body. Jupiter's trojans gather there.
[Gravity guides](physics/gravity-guides.md)

**Gravitational field.** The pull per unit mass at each point in space,
the sum of every body's $GM/d^2$ toward it. Field lines run along it, as
an electric field's do. Seen falling freely with a body, the Sun's
near-uniform pull drops out and what is left is the body's own pull and
the others' tides. [Gravity guides](physics/gravity-guides.md#the-field-of-every-body)

**Effective potential, Jacobi constant.** In the frame turning with two
bodies, gravity plus the centrifugal pull has a potential $\Phi$. The
Lagrange points are where it is flat: L1–L3 are its saddles, L4 and L5
its peaks. The Jacobi constant $C = -2\Phi$ (in the pair's units, less
the speed squared) is conserved; the curves of equal $C$ through L1–L3,
the zero-velocity curves, mark where a body of that energy can go.
[Gravity guides](physics/gravity-guides.md#the-field-of-every-body)

**Line-integral convolution (LIC).** Drawing a vector field by smearing
noise along each point's field line, so the grain lines up with the
field. Shifting the smearing's phase makes the grain flow.
[Gravity guides](physics/gravity-guides.md#the-field-of-every-body)

**SGP4, SDP4.** The analytical theory the US Space Force fits its element
sets with (Simplified General Perturbations 4): the Earth's J2 and J4,
drag through a term B\*, and, for periods over 225 minutes (SDP4), the
Moon's and the Sun's pull and the 12- and 24-hour resonances. An element
set gives the right positions only through it, to about a kilometre at its
epoch. [Earth satellites](frontend/satellites.md#moving-them-sgp4)

**Epoch.** The instant a set of orbital elements describes. A satellite's
element set grows less accurate the further the clock is from its epoch.

## Transfers and journeys

**Delta-v (Δv).** A change in velocity, km/s. It is the currency of
spaceflight: every manoeuvre costs some, and a rocket can supply only so
much.

**Lambert's problem.** Finding the orbit that joins two positions in a
given time. It is the core of every transfer the planner works out.
[Lambert's problem](physics/lambert.md)

**Porkchop plot.** A grid of transfer costs by departure and arrival date,
named for its shape. Its low points are the launch windows.
[Burns, launches and the porkchop](physics/burns-and-launch.md)

**C3.** A departure's energy, $v_\infty^2$, in km²/s². Launch vehicles
quote what payload they can send at a given C3.

**v∞ (hyperbolic excess speed).** The speed a craft still has once it is
far from a planet it has escaped, or arrives at one with.

**Hohmann transfer.** The cheapest two-burn transfer between circular,
coplanar orbits: half an ellipse touching both.

**Bi-elliptic transfer.** A three-burn transfer out beyond the target and
back in. It is cheaper than Hohmann when the orbits' radii differ by more
than about 11.94 times.

**Phasing.** Waiting in an orbit, or changing its period, so a craft
arrives where its target will be.

**Patched conics.** Joining two-body arcs at the spheres of influence: an
orbit about the Sun between planets, a hyperbola about each. The planner
plans this way, and the kernel then flies the plan in full.
[Journeys](physics/journey.md)

**Gravity assist (flyby).** Passing close to a planet to bend the craft's
path, gaining or losing speed relative to the Sun at no fuel cost.

**B-plane.** The plane through a planet's centre, square to the arriving
craft's v∞. Where the craft crosses it sets the flyby's height and the
turn it gives.

**Resonant return.** Coming back to the same planet after a whole number
of its years, on an orbit whose period is in a ratio with the planet's.
Galileo's 2:1 Earth return is one. [Journeys](physics/journey.md)

## Forces and integration

**n-body.** Every body pulling on the craft at once, as opposed to only its
primary. [The n-body kernel](physics/nbody-kernel.md)

**Indirect term.** In a frame centred on a body that is itself pulled by
others (such as the Sun), the extra acceleration that accounts for that
frame accelerating. It is not needed about the SSB.

**J2, zonal harmonics.** A planet's flattening as seen by its gravity. J2,
the strongest term, makes orbits turn slowly, so low Earth orbits precess
by several degrees a day. **C22** describes how a body's equator is
stretched into an ellipse, which matters for moons that always face their
planet.

**Gravity field (EGM2008, GRAIL, JGMESS160A, MGNP180U).** A body's full
gravity as a sum of spherical harmonics:
- **EGM2008:** the Earth's.
- **GRAIL:** the Moon's, from NASA's twin probes.
- **JGMESS160A:** Mercury's, from MESSENGER's tracking in orbit.
- **MGNP180U:** Venus's, from Magellan's.

[The space environment](physics/environment.md),
[Gravity guides](physics/gravity-guides.md)

**Mascon.** A "mass concentration" under the Moon's surface that tugs
low orbits off course.

**Solar radiation pressure.** Sunlight's push on a craft, small but steady.
It matters over weeks, as Orion's flight showed.
[The space environment](physics/environment.md)

**Drag.** Air resistance, $\tfrac12 \rho v^2 C_D A$. In orbit it depends on
the upper atmosphere's density, which the solar cycle swings by ten
times.

**Cowell's method.** Integrating a craft's full motion directly. It is
simple and general.

**Encke's method.** Integrating only how a craft drifts from a reference
two-body orbit. It is far cheaper and more accurate near a planet.
[The n-body kernel](physics/nbody-kernel.md)

**Symplectic integrator (leapfrog, Yoshida).** A stepping method that keeps
an orbit's energy from drifting over long runs. The kernel uses
Yoshida's fourth-order form.

**RK4.** The classic fourth-order Runge–Kutta method. It is used here as a
cross-check and for short stretches.

## Rockets and missions

**Rocket equation.** Tsiolkovsky's law: $\Delta v = I_{sp}\, g_0 \ln(m_0/m_f)$.
The Δv a stage gives depends on its exhaust speed and how much of its
mass is propellant. [Rockets](physics/rocket.md)

**Isp (specific impulse).** An engine's efficiency, in seconds: thrust per
weight of propellant burned each second. Vacuum Isp is higher than
sea-level Isp.

**Thrust-to-weight (T/W).** Thrust over weight. A rocket needs over about
1.2 at liftoff to climb efficiently.

**Staging.** Dropping empty tanks and engines on the way up so the rest
needn't carry them. The best split of Δv between stages comes from a
Lagrange-multiplier solution. [Rockets](physics/rocket.md)

**Gravity turn.** An ascent that pitches over slightly after liftoff and
then lets gravity bend the path towards horizontal.

**Gravity and drag losses.** The Δv an ascent spends holding itself up
against gravity and pushing through air, on top of orbital speed.

**Max q.** The point of highest dynamic pressure, $\tfrac12 \rho v^2$,
during an ascent.

**BET (best estimated trajectory).** A flight team's reconstruction of
where a spacecraft actually went, from tracking. Artemis I's and II's are
what the app is checked against.
[Validation](validation.md)

**Skip entry.** A returning capsule dipping into the atmosphere, lifting
out, then coming down for good, to reach its splashdown point. Artemis I
flew one. [Atmospheric entry](physics/entry.md)

## Magnetic fields and auroras

**Magnetosphere.** The region around a planet where its own magnetic field,
not the Sun's, controls the charged particles. The solar wind squeezes it
on the day side and draws it out into a long tail on the night side. The
app draws the planets' internal fields only, with no magnetopause.
[Magnetic fields and auroras](physics/magnetic-fields.md)

**Dipole tilt.** The angle between a planet's magnetic dipole and its spin
axis: 9° for the Earth, 10° for Jupiter, under 0.01° for Saturn, and 60°
and 47° for Uranus and Neptune, whose dipoles also sit far off their
centres (0.31 and 0.55 of a radius).
[Magnetic fields and auroras](physics/magnetic-fields.md#the-dipole-its-tilt-and-its-centre)

**L-shell.** The set of dipole field lines that cross the magnetic equator
$L$ planet radii out. A line from magnetic latitude $\lambda$ on the surface
has $L = 1/\cos^2\lambda$, so the Earth's auroral zone, near 67°, sits on
about $L = 6.5$. [Magnetic fields and auroras](physics/magnetic-fields.md)

**Aurora.** Light from the upper atmosphere where charged particles from
the magnetosphere rain in along field lines, in an oval round each
magnetic pole. On the Earth the oxygen glows green (557.7 nm) near 110 km
and red (630.0 nm) higher up; the oval swells toward the equator as the
Kp index rises. Jupiter's and Saturn's shine mostly in the ultraviolet, and
Io leaves its own spot where its field line meets Jupiter.
[Magnetic fields and auroras](physics/magnetic-fields.md#auroras)

**Radiation belt.** A band of L-shells where a planet's field traps energetic
particles, which bounce between the hemispheres and drift round the
planet. The Earth has an inner belt below $L \approx 2$ and an outer one
above $L \approx 3$ (the Van Allen belts); the inner belt dips nearest the
ground over the South Atlantic, where the field is weakest.
[Magnetic fields and auroras](physics/magnetic-fields.md#radiation-belts)

**Lead angle.** How far a moon's auroral spot sits ahead of its moon's
instantaneous field-line footprint, because the Alfvén wave the moon
launches takes minutes to reach the planet: about 4° for Io, 12–13° for
Ganymede.
[Magnetic fields and auroras](physics/magnetic-fields.md#jupiter-and-saturn)

**Crustal field.** Magnetism frozen into a planet's rocks when they
cooled in an old field. Mars has no global field now, but its southern
crust holds fields up to about 11,000 nT at the surface.
[Magnetic fields and auroras](physics/magnetic-fields.md#marss-crust)

**Kp.** A planetary index of geomagnetic disturbance every three hours,
from 0 (quiet) to 9 (an extreme storm), in thirds (3−, 3o, 3+).

**Corrected geomagnetic coordinates (CGM).** Latitude and longitude
measured along the real field's lines rather than about the spin axis, the
coordinates the auroral ovals are given in.

## The sky and drawing

**Absolute magnitude (H).** An asteroid's brightness at 1 au from both the
Sun and the observer, fully lit. Smaller is brighter. With the **H-G**
system's slope, it gives the brightness from anywhere.
[Asteroids and comets](frontend/small-bodies.md)

**Albedo.** The fraction of light a surface reflects. The app uses
geometric albedo from NASA's fact sheets and Horizons.
[Lighting](frontend/lighting.md)

**HDR, exposure, tone mapping.** The sky is computed in real brightness,
from the Sun to faint stars. An exposure, set like a camera's, and a
tone-mapping curve fit it to the screen. [Lighting](frontend/lighting.md)

**Adaptation.** The eye's sensitivity falling near a bright source: the
reason stars fade beside the Sun. [Lighting](frontend/lighting.md)

**Scintillation (twinkling).** Stars flickering as turbulent air bends
their light. It happens only through an atmosphere, and grows towards the
horizon. [Lighting](frontend/lighting.md)

**Airmass.** How much air a line of sight passes through, relative to
straight up: about $\sec z$ for a zenith angle $z$.

**Corona.** The Sun's faint outer atmosphere, a million times dimmer than
its disc. It shows only when the disc is covered, as in a total eclipse.

**Floating origin.** Keeping the camera at the render origin and moving the
universe around it, so 32-bit graphics keep metre precision at solar
system scale. [The 3D scene](frontend/scene.md)
