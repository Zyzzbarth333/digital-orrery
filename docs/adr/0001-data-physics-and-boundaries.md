# ADR-0001: Data out of git, physics as its own package, and tidier boundaries

**Status:** Proposed
**Date:** 19 Nov 2026
**Deciders:** Isaac Ziebarth

## Context

The app is a static site. React and three.js run in the browser, and the physics (the n-body kernel, journeys, satellites and the rest) runs in Web Workers. There is no server and no deployment; people run it with `npm run dev`.

**The code is already well layered.** Measured on 19 Nov 2026 with the graphify code graph and the imports:
- `src/physics` (35,237 lines) imports nothing from `src/scene` or `src/app`, and depends on one package, astronomy-engine.
- The scene imports physics 51 times, and the app imports physics 85 times and the scene 48 times.
- The only back-reference is four type-only imports from `src/scene` into `src/app` (`SimClock` and the journey view types).

**The data is the problem.**
- `public/` holds 547 MB of generated data, committed to git without LFS. By folder:
  - textures 299 MB;
  - ephemeris tables 133 MB;
  - 3D models 58 MB;
  - catalogues 30 MB;
  - missions 6 MB.
- The pack is already 814 MiB, and every rebuild of a map or table adds its full size to history for good. GitHub recommends keeping a repository "ideally less than 1 GB" and blocks files over 100 MiB [1].
- Offline programs make this data and talk to the app only through these files:
  - the `c/` CSPICE Chebyshev fitters;
  - `python/` textures;
  - the `*.fetch.mjs` and `*.build.mjs` scripts.

**`src/physics` mixes three things:** the runtime library, 23 offline pipeline scripts (`*.fetch`, `*.build`, `*.export`, `*.calibrate` and others), and 43 test and validation files.

**A working clone needs the data.** Whatever replaces committing it must keep "clone, install, run" working for anyone.

**Other tools.** The user asked whether the physics should become a backend that other tools use, the way JuliaHub, OpenRocket or RASAero II stand apart. The simulation review ([simulation-review.md](../physics/simulation-review.md)) already recommends building checks in Python first and leaving Julia, JuliaHub and RASAero II for later. The ROCKET tab already reads OpenRocket `.ork` files.

## Decision

1. **The code stays one app in one repository.** There are no separate apps, repositories or services for now.
2. **Generated data leaves git.** Each data set is published as a versioned GitHub Release asset, pinned by a manifest in the repository. `npm run data` downloads and verifies it, so a fresh clone still works:
   ```
   npm install
   npm run data
   npm run dev
   ```
   The dev container runs `npm run data` after it is created, and CI caches it.
3. **The physics becomes its own package,** `packages/physics` (`@orrery/physics`) in an npm workspace. This happens only behind a verification gate (Action items, phase C), and is published only after it holds.
4. **The boundaries are tidied in the repository first:**
   - pipelines into `pipelines/`;
   - validations into `validation/`;
   - shared types into `src/types/`;
   - a manifest entry for every data file.
5. **No backend service now.** Once the physics package runs in Node unchanged, a command-line or HTTP wrapper around it is cheap. Other simulators (OpenRocket, RASAero II) connect through file formats, not shared code.

## Options considered

### Data

#### A. Keep committing to git (today)
| Dimension | Assessment |
|---|---|
| Complexity | None |
| Cost | Free, but history only grows (814 MiB now) |
| Scalability | Poor: every map rebuild adds its full size for ever |
| Clone experience | Works, but slowly |

#### B. Git LFS
| Dimension | Assessment |
|---|---|
| Complexity | Low: `.gitattributes` rules, and `git lfs migrate` for history |
| Cost | GitHub Free gives 10 GiB of storage and 10 GiB of bandwidth a month [2]. Beyond that, a $0 budget blocks LFS until the next month [2] |
| Scalability | Bandwidth-bound: about 18 fresh clones of 547 MB use up the month |
| Clone experience | Works with git-lfs installed. The airbrakes and flight-data repositories already share the LFS quota |

#### C. GitHub Release assets with a manifest (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium: a manifest, a fetch-and-verify script, and a publish script |
| Cost | Free. "No limit on the total size of a release, nor bandwidth usage"; each file under 2 GiB [3] |
| Scalability | Good: data versions are independent of code commits |
| Clone experience | `npm run data` adds one step and about 550 MB of download. Partial fetches (one data set) are possible |

#### D. A separate data repository or object bucket
| Dimension | Assessment |
|---|---|
| Complexity | Medium to high: a second repository or a cloud account |
| Cost | A repository is free but has the same size limits [1]; a bucket costs money and needs credentials |
| Scalability | Good |
| Clone experience | The same as C |

### Physics

1. **Leave it in `src/physics`.** No risk, but the library, pipelines and tests stay mixed, and nothing outside the app can reuse it.
2. **A workspace package, `packages/physics` (chosen).** The same repository and the same commits. It can be imported by the app, by Node tools, and later by other projects. It needs browser-only parts (Workers and `fetch`) moved out of its core.
3. **A separate repository or published library now.** It would have its own versions and releases to coordinate across two repositories, for one developer. That is premature until something outside this repository uses it.
4. **A backend service (a JuliaHub-style server).** It needs hosting, latency and accounts, and today's app works offline in the browser. The physics already runs in Web Workers, so a server would add little.

## Trade-off analysis

**Data.** Release assets (C) beat LFS (B) on cost and scale for a public, often-cloned repository: LFS bandwidth is the binding limit, and other repositories already share that quota. C beats a bucket (D) on cost and credentials. What C costs is one extra setup step and a small amount of tooling, which the manifest also turns into a checked contract: each file's version, source and SHA-256 hash.

Shrinking the existing 814 MiB history needs a history rewrite (`git filter-repo`). That is a separate, later decision. It needs Isaac's explicit approval for that one rewrite, a bundle backup first, and the knowledge that GitHub keeps purged objects reachable until GitHub Support removes them.

**Physics.** A workspace package gets most of a separate project's benefits (a clear public interface, reuse by Node tools, a later CLI or service) at little cost, because it stays in the same repository and commits. The risk is a silent change in results while code moves. The verification gate below exists for that.

## Consequences

**Easier:**
- Cloning, going forward: new data no longer adds to git's history. Everything tracked outside `public/` comes to 42 MB today, 27 MB of it the docs' images and clips.
- Rebuilding maps and tables, which no longer bloats git.
- Reusing the physics from Node scripts, other projects, or a later CLI or service.

**Harder:**
- One more setup step (`npm run data`).
- Data releases must be published and pinned.
- The physics package's interface becomes something to keep stable.

**To revisit:**
- The history rewrite.
- Publishing `@orrery/physics` to npm.
- A service, if something outside the browser needs the physics live.
- Julia, once Python oracles exist ([simulation-review.md](../physics/simulation-review.md)).

## Action items

**Phase A: tidy boundaries (no behaviour change)**
1. [ ] Move the offline scripts (`*.fetch.mjs`, `*.build.mjs`, `*.export.mjs`, `*.calibrate.mjs` and the like) from `src/physics` to `pipelines/`, and update `package.json` and `scripts/test.mjs`.
2. [ ] Move the `*.validate.mjs` checks and their libraries to `validation/`.
3. [ ] Move `SimClock`'s type and the journey view types into `src/types/`, so `src/scene` no longer imports `src/app`.
4. [ ] Gate: `npm run typecheck` and `npm test` pass, and the build is byte-identical.

**Phase B: data out of git (going forward)**
1. [ ] Add `public/manifest.json`, listing each file's path, data set, version, size, SHA-256 and source.
2. [ ] Add `npm run data`, which downloads each missing or changed data set from a pinned release and verifies its hashes; `npm run data:publish` packs and uploads a data set.
3. [ ] Add the data sets to `.gitignore`, and run `npm run data` in the dev container's `postCreateCommand` and in CI (cached).
4. [ ] Update the README's setup steps and `docs/architecture.md`.
5. [ ] Gate: a fresh clone in a clean container gets to a running app with `npm install && npm run data && npm run dev`.

**Phase C: `@orrery/physics` behind a verification gate**
1. [ ] Before moving anything, record a golden snapshot: every number `npm test` prints, plus fixed-seed outputs of the kernel, ephemeris, journey and satellite APIs.
2. [ ] Move `src/physics`'s core into `packages/physics` as an npm workspace. Keep browser-only parts (`kernelClient`'s Worker, `fetchData`) in an adapter layer in the app.
3. [ ] Gate:
   - the golden snapshot is reproduced bit for bit;
   - every validation (Artemis I and II, Juno, DART, LRO, MESSENGER, NESC) passes at its stated tolerance;
   - `npm run bench:frames` shows no change on either GPU.
4. [ ] Only then document its public interface and consider a version number.

**Later, separate decisions:** rewriting the existing history; publishing to npm; a CLI or service wrapper; Julia or Python oracles.

## References

[1] GitHub, "About large files on GitHub." [Online]. Available: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github. Accessed: Nov. 19, 2026.

[2] GitHub, "Git Large File Storage billing." [Online]. Available: https://docs.github.com/en/billing/concepts/product-billing/git-lfs. Accessed: Nov. 19, 2026.

[3] GitHub, "About releases." [Online]. Available: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases. Accessed: Nov. 19, 2026.
