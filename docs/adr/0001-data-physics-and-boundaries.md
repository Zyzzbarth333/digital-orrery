# ADR-0001: A hosted site, data out of git, and tidier boundaries

**Status:** Accepted (19 Nov 2026)
**Date:** 19 Nov 2026
**Deciders:** Isaac Ziebarth
**Reviewed:** an independent design review, and a fact check of every hosting and packaging limit against the vendors' own documentation (19 Nov 2026)

## Context

**What the app is.** A static site: React and three.js in the browser, with the physics (n-body kernel, journeys, satellites) in Web Workers. It has no server and no deployment. It runs only through `npm run dev`, and `vite.config.js` sets no `base`, so it can't yet be served from a sub-path such as `/digital-orrery/`.

**Who it is for** ([PRODUCT.md](../../PRODUCT.md)):
- the engineer who reads exact values;
- portfolio visitors "arriving from the author's GitHub Pages portfolio, often on a phone";
- a developer who clones it;
- someone who might reuse the physics.

Today only the developer can run it.

**The code is well layered.** Measured with the graphify code graph and the imports:
- `src/physics` (35,237 lines) imports nothing from `src/scene` or `src/app`.
- The scene imports the physics 51 times; the app imports the physics 85 times and the scene 48 times.
- The only back-reference is four type-only imports from the scene into the app.

**The data is the problem.**
- `public/` holds 547 MB of generated data in 841 files, committed to git without LFS:
  - textures 299 MB;
  - ephemeris tables 133 MB;
  - 3D models 58 MB;
  - catalogues 30 MB.
- The largest file is 30.3 MB.
- The git pack is 814 MiB. GitHub recommends a repository "ideally less than 1 GB" [1].
- Offline programs make this data (the `c/` CSPICE fitters, `python/` textures, and the `*.fetch`/`*.build` scripts), and the app reads it only as files.

**`src/physics` mixes three things:** the runtime library, 23 offline pipeline scripts, and 43 test and validation files.

**The runtime isn't pinned.** The dev container runs Node 20 and CI runs Node 22, and there is no `.nvmrc` or `engines` field.

## Decision

1. **Host the app on GitHub Pages, built and deployed by GitHub Actions.** This is the main way anyone uses it, a phone visitor included. Nothing is downloaded or installed.
   - It is a *project site* at `https://zyzzbarth333.github.io/digital-orrery/`, published from this repository.
   - It sits beside the portfolio, which is the *user site* from the `Zyzzbarth333.github.io` repository. Each published site has its own 1 GB limit [2], so the orrery's data never touches the portfolio's repository or limits.
   - The portfolio's project page (`projects/digital-orrery.html`) links to the live site; that change belongs to the portfolio's own repository.
2. **Generated data leaves git.** It is published as versioned GitHub Release assets and pinned by a manifest in the repository. Each release is immutable and is never deleted, because older commits point at it.
   - The deploy workflow pulls the pinned data into the site.
   - Developers run `npm run data`, which fetches and verifies it, so a fresh clone still runs:
     ```
     npm install
     npm run data
     npm run dev
     ```
3. **The dev container and Codespaces run the same `npm run data` after creation.** The dev container is the developer's environment, not the way data is shipped.
4. **Pin the runtime:** `.nvmrc` and `engines`, with the dev container and CI on the same Node version.
5. **Tidy the boundaries in the repository first:**
   - pipelines into `pipelines/`;
   - validations into `validation/`;
   - shared types into `src/types/`;
   - a manifest entry for every data file.
6. **The code stays one app in one repository.** The physics moves into a workspace package only behind the verification gate below. It is not published, and its interface is not frozen, until something outside this repository uses it.
7. **No backend service.** Other simulators (OpenRocket, RASAero II, NVIDIA Isaac Sim) are separate programs, and connect, if ever, through file formats or streams. None shares code with the orrery.

## Options considered

### Distribution, by audience

| Option | Phone visitor | Developer | Physics user | Verdict |
|---|---|---|---|---|
| **A. Hosted site, GitHub Pages** | Best: a link, nothing to install | Can try before cloning | Can try it | **Chosen.** Under the 1 GB site limit, with 100 GB a month of soft bandwidth [2] |
| **B. Release assets + `npm run data`** | n/a | **Chosen** for clones | **Chosen** with the package | Free, with no limit on total size or bandwidth; files under 2 GiB [3] |
| **C. Git LFS** | Not served by Pages | Works with git-lfs | Works | **Rejected.** 10 GiB a month of bandwidth on GitHub Free (about 18 full clones), shared with the airbrakes repositories [4] |
| **D. Dev container image with the data baked in** (GHCR) | n/a | Fast start | n/a | **Not now.** GHCR is free [5], but it means a new ~1 GB image for every data version. The plain dev container plus B does the same |
| **E. Docker image to run** (nginx serving the build and data) | n/a | n/a | One command | **Only if asked for:** A already gives a link |
| **F. Desktop app** (Tauri or Electron) | n/a | n/a | An installer | **Rejected.** About 550 MB installers. macOS needs notarisation and Windows warns without signing [6]. The Windows installer builders fail above 2 GB [7] |
| **G. PWA offline cache** | Faster repeat visits | n/a | n/a | **Later, shell only.** Browsers allow up to 60 % of disk per origin [8], [9], but caching 547 MB on a phone is rude |
| **H. Cloudflare Pages** | As A | n/a | n/a | **Rejected.** 25 MiB per-file cap [10]; two files are larger |

**Why not "just a dev container"?** A dev container gives a developer the right tools in one step, but it still needs the data from somewhere. It doesn't help the phone visitor at all, and they're the audience PRODUCT.md names first. **Why not a self-contained app?** A desktop app bundles the data, which means 550 MB downloads, signing, and an update channel. The hosted site gives the same result, the app working without setup, through a link.

### The physics

1. **Leave it in `src/physics`, tidied** (phase A). This gets most of the benefit at no risk.
2. **A workspace package, `packages/physics`.** It can be imported by Node tools, and it is the first step to a CLI or service. **Chosen as phase C**, behind the gate, with no publishing.
3. **A separate repository or published library.** Premature: there is no outside consumer, and it adds release coordination between two repositories for one developer.
4. **A backend service** (a JuliaHub-style server). It needs hosting and accounts, and the browser already runs the physics in workers. Not now.

### Other simulators
- **OpenRocket** already connects through `.ork` files (the ROCKET tab).
- **RASAero II** is a Windows desktop tool; it would connect the same way.
- **NVIDIA Isaac Sim** is a robotics simulator [11]:
  - open source under Apache 2.0;
  - PhysX rigid bodies, robots and sensors;
  - Python, ROS 2 and OpenUSD interfaces.

  Its documentation doesn't describe orbital mechanics, and it needs an RTX GPU, with a minimum of an RTX 4080 with 16 GB of video memory [12]. This machine's RTX 5070 Ti Laptop has 12 GB. It could replay the orrery's craft (attitude and trajectory, exported as OpenUSD), or simulate a lander's touchdown. It isn't a backend for the orrery's physics.

The [simulation review](../physics/simulation-review.md) already recommends leaving Julia, JuliaHub and RASAero II until Python oracles exist.

## Trade-off analysis

A hosted site serves the audience the product exists for at no cost and with no setup. It also forces the data question: the deploy needs the data, and git can't carry it much longer.

Release assets beat LFS because LFS bandwidth is the binding limit, and Pages doesn't serve LFS files. A manifest with SHA-256 hashes turns the offline tools' output into a checked contract between code and data.

The 1 GB Pages limit leaves about 450 MB of room [2]. If the data outgrows it, the next step is serving the data sets from Release assets or a bucket, with the site fetching them. The code wouldn't change, because the loaders already take a base URL.

The physics package is worth its risk only with a gate that catches silent changes. "Bit for bit" holds for a pure move on one pinned Node version. Across Node versions and browser engines, `Math.sin`, `pow` and `exp` aren't required to round identically, so comparisons there need stated tolerances.

## Long term: where it lives

GitHub Pages is the right place to start, but not to stay.
- **Size:** each site has a 1 GB limit [2], and the data grows. The irregular moons past 2049 add about 0.5 MB of tables a year, and every new model or map adds tens of MB.
- **Bandwidth:** the soft limit is 100 GB a month [2]. A first visit loads tens of MB, so a few thousand visits a month fit, but one widely shared post would not.
- **Address:** a `github.io` address ties every saved link to GitHub.

**The long-term shape:**
- **The app** (a few MB of HTML and JavaScript) on GitHub Pages, deployed by Actions.
- **The data** on Cloudflare R2. It has free egress and 10 GB-month of storage on the free tier [13], with no site-size cap, and is served through Cloudflare's CDN.
- **The address:** a domain of the user's own, so links survive any change of host. R2 needs a custom domain for production traffic; its `r2.dev` address is for development [14].

The cost is a domain (roughly A$15–30 a year), plus R2 storage beyond 10 GB.

**Release assets don't replace R2.** They remain the pinned source of each data version for CI and `npm run data`, but a browser on another site can't fetch them: on 19 Nov 2026, neither GitHub's release download link (a 302 redirect) nor the file host it redirects to sent an `Access-Control-Allow-Origin` header.

**Netlify and Vercel** have similar caps of about 100 GB a month on their free plans [15], so they are no better than Pages for this.

**Phase B already prepares the move.** The manifest's SHA-256 hashes give each file a versioned name that a CDN can cache for ever, and the loaders already take a base URL. Moving the data to R2 is then a change of that base URL, plus an upload step in the deploy workflow.

**Move the data when the first of these happens:**
- the data passes about 800 MB;
- Pages bandwidth nears 100 GB a month;
- the user wants their own domain.

The domain can come first: it is cheap and protects every link.

## Consequences

**Easier:**
- Anyone can use it from a link, on a phone too.
- A clone no longer grows by every map rebuild.
- Data versions are explicit and checked.
- The physics can later be used from Node.

**Harder:**
- One more setup step for developers.
- Data releases to publish and keep.
- A deploy workflow to keep green.

**Must handle:**
- **Missing data:** Vite's fallback returns `index.html` for a missing file, which shows up as a confusing JSON parse error. The app must say "run `npm run data`".
- **The existing 814 MiB history:** the README should suggest `git clone --filter=blob:none` until the history is rewritten.

**To revisit:**
- Rewriting the history: a separate decision, needing Isaac's explicit approval for that one rewrite, and a bundle backup first.
- Data outgrowing 1 GB.
- Publishing the physics.
- A service.
- Julia or Python oracles.

## Action items

**Phase B already prepares the move.** The manifest's SHA-256 hashes give each file a versioned name that a CDN can cache for ever, and the loaders already take a base URL. Moving the data to R2 is then a change of that base URL, plus an upload step in the deploy workflow.

**Move the data when the first of these happens:**
- the data passes about 800 MB;
- Pages bandwidth nears 100 GB a month;
- the user wants their own domain.

The domain can come first: it is cheap and protects every link.

## Consequences

**Easier:**
- Anyone can use it from a link, on a phone too.
- A clone no longer grows by every map rebuild.
- Data versions are explicit and checked.
- The physics can later be used from Node.

**Harder:**
- One more setup step for developers.
- Data releases to publish and keep.
- A deploy workflow to keep green.

**Must handle:**
- **Missing data:** Vite's fallback returns `index.html` for a missing file, which shows up as a confusing JSON parse error. The app must say "run `npm run data`".
- **The existing 814 MiB history:** the README should suggest `git clone --filter=blob:none` until the history is rewritten.

**To revisit:**
- Rewriting the history: a separate decision, needing Isaac's explicit approval for that one rewrite, and a bundle backup first.
- Data outgrowing 1 GB.
- Publishing the physics.
- A service.
- Julia or Python oracles.

## Action items

**Phase A: tidy and pin (no behaviour change)**: done
1. [x] Pin Node: `.nvmrc`, `engines`, and the dev container and CI on the same version.
2. [x] Move the offline scripts from `src/physics` into `pipelines/`, and the `*.validate.mjs` checks and their libraries into `validation/`. Update `package.json` and `scripts/test.mjs`.
3. [x] Move the `SimClock` type and the journey view types into `src/types/`.
4. [x] Gate: `npm run typecheck` and `npm test` pass, and the build output is byte-identical.

**Phase B: data out of git, and the hosted site**
1. [x] Add `public/manifest.json`, listing each file's path, data set, version, size, SHA-256 and source.
2. [x] Add `npm run data`, which fetches the missing or changed data sets from pinned, immutable releases and verifies their hashes. Add `npm run data:publish` to make a release.
3. [x] Add a clear "data missing: run `npm run data`" error in the app.
4. [x] Add the data sets to `.gitignore`. Run `npm run data` in the dev container, Codespaces and CI (cached).
5. [x] Set `base` in `vite.config.js`, and add a Pages workflow: build, pull the pinned data, upload the artifact, deploy.
6. [x] Update the README with the site link, the partial-clone tip and the setup steps.
7. [x] Ask the portfolio's maintainers to add an "Open the orrery" link to `projects/digital-orrery.html`. Done in Zyzzbarth333.github.io#41, 19 Nov 2026: the Code row links the live site, in a new tab, after the repository.
8. [ ] Gate:
   - a fresh clone in a clean container runs with `npm install && npm run data && npm run dev`;
   - the deployed site loads on a phone.

**Phase C: the physics package, behind a two-tier gate**
1. [x] Give the physics core an injectable data loader (`fetch` in the browser, `fs` in Node), so it runs outside the app.
2. [x] Before moving anything, record a golden snapshot: every number `npm test` prints, plus fixed-seed outputs of the kernel, ephemeris, journey and satellite APIs.
3. [x] Move the core into `packages/physics` as an npm workspace. Keep the Worker and `fetch` adapters in the app.
4. [x] Gate:
   - **Tier 1:** the snapshot reproduced bit for bit on the pinned Node version.
   - **Tier 2:** every validation (Artemis I and II, Juno, DART, LRO, MESSENGER, NESC) passes at its stated tolerance on the pinned and current Node versions, and in Chromium, Firefox and WebKit through Playwright.
   - **Speed:** `npm run bench` within a stated noise threshold.
5. [x] Don't publish or freeze the interface until a consumer exists.

**Later, separate decisions:** a domain and moving the data to R2 (see Long term); rewriting the history; a shell-only PWA; publishing the physics; a CLI or service wrapper; exporting craft to OpenUSD for Isaac Sim.

## References

[1] GitHub, "About large files on GitHub." [Online]. Available: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github. Accessed: Nov. 19, 2026.

[2] GitHub, "GitHub Pages limits." [Online]. Available: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits. Accessed: Nov. 19, 2026.

[3] GitHub, "About releases." [Online]. Available: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases. Accessed: Nov. 19, 2026.

[4] GitHub, "Git Large File Storage billing." [Online]. Available: https://docs.github.com/en/billing/concepts/product-billing/git-lfs. Accessed: Nov. 19, 2026.

[5] GitHub, "GitHub Packages billing." [Online]. Available: https://docs.github.com/en/billing/concepts/product-billing/github-packages. Accessed: Nov. 19, 2026.

[6] Tauri, "macOS code signing" and "Windows code signing." [Online]. Available: https://v2.tauri.app/distribute/sign/macos/ and https://v2.tauri.app/distribute/sign/windows/. Accessed: Nov. 19, 2026.

[7] tauri-apps, "tauri," GitHub issue 7372. [Online]. Available: https://github.com/tauri-apps/tauri/issues/7372. Accessed: Nov. 19, 2026.

[8] web.dev, "Storage for the web." [Online]. Available: https://web.dev/articles/storage-for-the-web. Accessed: Nov. 19, 2026.

[9] WebKit, "Updates to storage policy." [Online]. Available: https://webkit.org/blog/14403/updates-to-storage-policy/. Accessed: Nov. 19, 2026.

[10] Cloudflare, "Pages limits." [Online]. Available: https://developers.cloudflare.com/pages/platform/limits/. Accessed: Nov. 19, 2026.

[11] NVIDIA, "Isaac Sim," GitHub repository. Licence: Apache-2.0. [Online]. Available: https://github.com/isaac-sim/IsaacSim. Accessed: Nov. 19, 2026.

[12] NVIDIA, "Isaac Sim requirements." [Online]. Available: https://docs.isaacsim.omniverse.nvidia.com/latest/installation/requirements.html. Accessed: Nov. 19, 2026.

[13] Cloudflare, "R2 pricing." [Online]. Available: https://developers.cloudflare.com/r2/pricing/. Accessed: Nov. 19, 2026.

[14] Cloudflare, "R2 public buckets." [Online]. Available: https://developers.cloudflare.com/r2/buckets/public-buckets/. Accessed: Nov. 19, 2026.

[15] Netlify, "Legacy pricing plans." [Online]. Available: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/. Accessed: Nov. 19, 2026.
