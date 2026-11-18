# Contributing

Thanks for looking. digital-orrery is a true-scale solar-system and
mission simulator whose physics is checked against NASA, JPL and textbook
references. These notes keep it that way.

## Setup

Follow the [quick start](README.md#quick-start): Node.js 20.19+ or 22.12+,
then `npm install` and `npm run dev`. The checks:

```bash
npm test            # every physics and app check, four files at a time (about two minutes)
npm run typecheck   # the TypeScript
npm run build       # the production build
```

CI runs all three on every pull request.

## Ground rules

A change can't break any of these.

- **Every physics claim is checked.** A new model or a changed constant
  comes with a test in `npm test` against a cited reference:
  - a textbook worked example, cited by its number;
  - NASA, JPL or NAIF data, held as a fixture in `src/physics/fixtures/`;
  - or an independent oracle.
  
  Each check prints its tolerance and the value it got. A new check file
  goes in the list in [scripts/test.mjs](scripts/test.mjs), which runs
  them side by side ([the test suite](docs/performance.md#the-test-suite)).
- **Every model has its page.** The equations, sources, constants and
  validation go in `docs/`, in the same pull request, and its checks go in
  [docs/validation.md](docs/validation.md) (see the
  [docs conventions](docs/README.md#conventions)).
- **The front pages stay current.** A change users will notice updates
  the README's description and [CHANGELOG.md](CHANGELOG.md) in the same
  pull request, not later. A change to how accurate something is updates
  [docs/accuracy.md](docs/accuracy.md) too, and the README's summary of it
  if that no longer holds.
- **Sources are cited, not copied.** Write equations in this project's
  notation and cite textbooks by section and example. Don't commit a
  textbook or paper's PDF, its figures or long quotations.
- **Citations are IEEE style.** In the text, a source is a number in
  brackets, `[1]`, with the place in it where that helps: `[1, Alg. 3.3]`,
  `[2, Ex. 4.7]`, `[3, eq. (12)]`. Each docs page ends with a
  `## References` list, numbered in the order the sources are first cited:
  - paper: `[1] A. B. Author and C. Author, "Title," *J. Abbrev.*, vol. 5,
    no. 2, pp. 10–20, 2021, doi: 10.xxxx/xxxx.`
  - book: `[2] H. D. Curtis, *Orbital Mechanics for Engineering Students*,
    4th ed. Oxford, U.K.: Butterworth-Heinemann, 2020.`
  - report: `[3] Org., "Title," Rep. NASA/TM-2015-218675, 2015.`
  - data, software or web page: `[4] NASA NAIF, "Generic kernels," 2024.
    [Online]. Available: https://naif.jpl.nasa.gov/naif/data.html`

  Give a DOI or a link wherever one exists, and only fields you have
  checked. The [IEEE reference guide](https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf)
  has the rest.
- **Copyleft stays outside.** GPL and AGPL tools (OpenRocket, for one) are
  used only as separate-process oracles. Their source and their example
  files are never committed or imported. The project is MIT.
- **Data has a source and a licence.** A new map, catalogue, kernel,
  library or font is credited in [docs/credits.md](docs/credits.md), with a
  link to where it comes from and its licence, and in the page that uses
  it (maps in [docs/frontend/textures.md](docs/frontend/textures.md)).
  - Large raw downloads stay out of git, under `python/data/` (ignored) or
    `~/.cache/digital-orrery/`.
  - What the app ships is built from them by an `npm run fetch:…` or
    `build:…` script, so it can be rebuilt.
- **No private material.** No personal details, local paths, credentials,
  or files from other teams or people.
- **Rendering changes are measured.** Time a frame on an integrated GPU
  as well as a discrete one, before and after, and give the numbers in
  the pull request. `npm run bench:frames` does this and prints the table
  to paste ([docs/performance.md](docs/performance.md#measuring) has the
  method and how to build main to compare against).
- **The interface follows [DESIGN.md](DESIGN.md).** The console is 70s
  flight hardware, in its own look: don't borrow another app's or game's
  interface.

## Data and oracles

Most checks run from fixtures in the repository. A few rebuild data or
run outside tools, and need a network or an installed tool:

| Script | What it does |
| --- | --- |
| `npm run fetch:smallbodies`, `build:smallbodies` | JPL SBDB asteroids and comets, packed for the app |
| `npm run fetch:moons`, `build:moon-tables` | the moons' elements; their Chebyshev tables from NAIF's satellite kernels (needs CMake and CSPICE) |
| `npm run fetch:artemis1`, `crosscheck:artemis1` | Artemis I from JPL Horizons, and its force-by-force check |
| `npm run fetch:flyby` | the moon and planet flybys from JPL Horizons; Voyager 2 at Neptune from NAIF's SPK (needs CMake and CSPICE: `c/flyby_ref`) |
| `npm run oracle:openrocket` | the ROCKET tab's ascent against OpenRocket (needs Java and OpenRocket) |
| `npm run build:textures` | the maps, as WebP and GPU-compressed KTX2, from their sources (needs KTX-Software's `ktx`) |
| `wolframscript -file src/physics/planetFields.oracle.wls` | Mercury's and Venus's gravity fields summed directly from the PDS files, for `environment.test.mjs` (needs the Wolfram Engine, and `npm run fetch:environment` first) |
| `npm run bench` | the kernel's speed |

A check that needs local data it can't find skips itself and says so.
`npm test` never needs a network.

## Commits and pull requests

- Branch from `main` as `feat/…`, `fix/…`, `perf/…`, `docs/…`, `test/…`
  or `chore/…`, and open a pull request.
- Commit messages follow
  [Conventional Commits](https://www.conventionalcommits.org/), with the
  area as the scope. The header says what is now true, and the body
  explains why in prose. For example:
  `fix(orientation): moons without an IAU model get their axes again`.
- Note what users will notice in [CHANGELOG.md](CHANGELOG.md) under
  Unreleased.
- Pull requests merge with a merge commit, once the checks pass. When two
  pull requests touch the same module, merge `main` into the second and
  run `npm test` again before merging it. Two branches that each pass can
  still break `main` together.
