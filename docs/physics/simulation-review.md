# Simulation techniques and tools review

Digital orrery, 14 November 2026. This is desk research only: nothing was installed, downloaded or run.

## How to read this

The review covers five topics: Julia and SciML, rocketry tools, astrodynamics simulators and numerical techniques, atmospheric entry, and real-time simulation in the browser. An independent checker re-read the sources after the research was done. Only claims the checker confirmed or corrected are kept here, with its corrections applied. Everything else is listed under [Unverified](#unverified).

A number in square brackets, such as [12], points to the reference list in section 7. A figure marked "derived" is our own arithmetic from sourced numbers.

- **Licences.** The repo is MIT. Code under GPL, AGPL or LGPL, and tools under NOSA or a proprietary licence, are used only as outside oracles. We run them or read them and compare numbers. We never copy, link or bundle their code. The FSF's GPL FAQ says a GPL program's output is generally not covered by the GPL unless it copies substantial parts of the program [1]. So numbers these tools compute for our own inputs can be committed as fixtures.
- **Approvals.** Every install, download or account named below needs the owner's approval first.
- **Local files.** A few sources are the author's own files (OpenRocket installed locally, earlier rocketry comparisons); they are cited as local and are not in this repo.

## 1. Summary

The actions are ranked by value to the project now. Effort is S (small), M (medium) or L (large).

1. Turn NASA's published Artemis I and II entry numbers into fixtures and tests with stated tolerances (section 3, step 9). **S**
2. Give `entry.js` Orion's trim aerodynamics and the staged CPAS parachute sequence. One aero table should feed both the kernel force and the guidance predictor. **M**
3. Find entry interface, impact and SOI crossings exactly on the step interpolant. Add hysteresis to SOI switching, and test against analytic Kepler times. **M**
4. Move bank guidance towards Orion's PredGuid in two stages. First make the bank linear in energy, as FNPEG does (S-M). Then rebuild Apollo's phases from the public-domain Apollo flight code (L). **S-M, then L**
5. Make ascent drag a function of Mach (S). Then pin `ascent()` to an OpenRocket fixture made headless with tools already on the machine (M). **S, then M**
6. Check the integrators in Node, by step-halving self-convergence and manufactured solutions, before relying on outside oracles. **S-M**
7. Add a wall-clock budget, a visible warp cap and ramped rate changes to the step client, and run `aimTo` in its own worker. **S**
8. Build oracles in Python first (SciPy, SpiceyPy, then Tudat). Leave Julia, JuliaHub and RASAero II for later. **M**

## 2. Topics

### 2.1 Julia, JuliaHub and SciML

**What the tools are**

| Tool | Licence | What it is |
|---|---|---|
| JuliaHub | commercial service | Hosted browser IDEs (Pluto, JuliaIDE), cloud compute, package and registry management, and app hosting [2]. Julia does not need it. |
| Dyad (the old JuliaSim page now shows it) | proprietary, source-available [3]; the $0 tier is for non-commercial use only [4] | AI-assisted modelling that mixes causal and acausal models, checks units and conservation, and generates embedded C. Its listed libraries are electrical, mechanical, thermal and fluid [4]. |
| Multibody.jl | proprietary JuliaHub EULA; repo archived | The LICENSE reserves all rights to JuliaHub. It allows only non-commercial academic teaching and research. It also carries BSD-3 notices for code adapted from DLR and Modelica Association libraries [5]. |
| ModelingToolkit v11 | MIT, but depends on AGPL packages | See the licence notes below [6, 7]. |
| ModelingToolkitBase.jl | MIT | Holds most of the MTK core, including a basic tearing pass [6, 7]. |
| OrdinaryDiffEq.jl 7.8.2 / DifferentialEquations.jl | MIT | Each solver sub-library is also MIT: Verner, high-order RK, Feagin, RKN, symplectic and Taylor series [8]. |
| SciMLSensitivity.jl | MIT | Adjoint sensitivities for reverse-mode automatic differentiation [9]. |
| SatelliteToolbox.jl family | MIT | 11 sub-packages covering gravity, atmosphere, celestial bodies, geomagnetism, SGP4, TLEs and frames. It is used daily at INPE [10]. |
| Ephemerides.jl, SPICE.jl | MIT | A pure-Julia SPK/PCK reader, tested against SPICE and CALCEPH, and a CSPICE wrapper [11]. |
| TaylorIntegration.jl, PlanetaryEphemeris.jl, NEOs.jl | MIT | Taylor-method integration, including a DE430-model ephemeris [12]. |
| WasmTarget.jl | Apache-2.0 | Compiles Julia to WasmGC without LLVM [13]. |
| WebAssemblyCompiler.jl | MIT | Experimental; last pushed Feb 2024 [14]. |

**Licence notes**

- **ModelingToolkit v11.** The post on v11 names three AGPL packages: StateSelection.jl, ModelingToolkitTearing.jl and SymbolicCompilerPasses.jl. It says the full package may carry AGPL obligations [6].
- **StateSelection.jl.** It is AGPL-3.0-only; code from before 1 Dec 2025 is also available under MIT. ModelingToolkit 11.47.0 depends on it; ModelingToolkitBase 1.80.0 does not [7].
- **Generated code.** The community thread did not settle whether the AGPL reaches generated code. A SciML Steering Council member said they could not give guidance on it [15].
- **Julia binaries.** They bundle GMP, MPFR and parts of SuiteSparse under LGPL or GPL [16]. This does not matter for an offline tool whose only output is JSON.

**Cost**

- JuliaHub's pricing page lists only the Dyad tiers ($0, $20, $60 and $200 a month, commercial use by quote) and gives no compute prices [17, 4].
- The last published compute terms are in a May 2023 post: 20 free thread-hours a month, then $0.15 per thread-hour for batch and $0.25 for interactive use [18]. That post gives the default machine as 16 GB in its text and 8 GB in its table [18].

**Integrators**

- The solver guide recommends Vern6 to Vern8 for tolerances of about 1e-8 to 1e-12, and Vern9 below 1e-12 or with BigFloat. It says Vern7 is often more efficient than DP8 [19].
- In the Arenstorf three-body benchmark, the Verner methods were the most efficient at strict tolerances in most tests. Adams and extrapolation methods were not competitive [20].
- That benchmark times a cheap right-hand side. With the orrery's costly force model, the number of force evaluations per step decides the cost [20].
- The Pleiades benchmark's reference solution is only good to about 1e-10 [21].
- All the symplectic methods in the suite are fixed-step [22].
- In the Kepler example, KahanLi6 keeps angular momentum exactly and its energy does not drift; DPRKN6 and Tsit5 drift [23].
- DPRKN6 is the only RKN method with a 6th-order interpolant; the others fall back to 3rd-order Hermite [22]. In the Hénon-Heiles test, DPRKN12's printed maximum energy error is 1.08e-5, against about 1e-14 for the other methods [24].
- `ContinuousCallback` (in SciMLBase, MIT) checks 10 interpolated points per step by default. It finds each root on the interpolant and supports separate actions for upward and downward crossings, plus termination [25]. A skip entry needs this, since two crossings can fall in one step.
- The native solvers accept other number types such as BigFloat; the wrapped C and Fortran solvers do not accept all of them [26, 27].
- With ForwardDiff, the solve simply runs on dual numbers; SciMLSensitivity's adjoint methods are for reverse-mode differentiation [9].
- `EnsembleProblem` runs many perturbed trajectories. `EnsembleSummary` defaults to 5 % and 95 % quantiles [28].

**Astrodynamics packages**

- SatelliteToolboxGravityModels reads ICGEM files and computes accelerations. Its downloader hard-codes EGM96, EGM2008, JGM2 and JGM3 [29].
- ICGEM lists GL0660B and newer lunar fields such as AIUB-GRL350A/B [30].
- The atmosphere package covers exponential, Harris-Priester, Jacchia 1977, Jacchia-Roberts 1971, JB2008 and NRLMSISE-00. It has no US Standard Atmosphere 1976 and no MET [31].
- Astrodynamics.jl (MPL-2.0) was archived on 26 Feb 2024 and AstroForceModels.jl (MIT) on 13 Jul 2026 [32].
- EntryGuidance.jl has no licence file and was last pushed in Sep 2022. Its CPEG paper is in the repo, and its examples need MATLAB and the commercial Mosek solver [33].

**Julia in the browser**

- WasmTarget.jl now runs ForwardDiff, StaticArrays and the fixed-step SimpleDiffEq solvers in Wasm. It does not support the adaptive solvers or OrdinaryDiffEq [13].
- Julia 1.12's `juliac --trim` builds native executables, and its release notes do not mention WebAssembly [14].

**Speed**

A 2016 ESA comparison measured Julia's runtime against Fortran: 0.71 for a Kepler solver, 1.1 for Lambert, 2.29 for Keplerian elements, and 2.97 for DOP853 called from Julia [34]. The DOP853 figure mostly measures the cost of Fortran calling back into Julia [34].

**What fits**

- **An offline oracle or fixture generator**, if Julia is installed later. Everything it would need is MIT: OrdinaryDiffEq, SatelliteToolbox, Ephemerides.jl or SPICE.jl, TaylorIntegration and AstroTime.jl [8, 10, 11, 12, 35]. Section 5 says when this is worth it.
- **Techniques to rebuild in our own code**:
  - root-finding on the interpolant at several points per step [25];
  - convergence-order tests, as DiffEqDevTools (MIT) does them [36].

**What does not fit**

- **Julia at runtime in the browser.** Neither an adaptive solver nor the existing force models compile to Wasm today [13].
- **Full ModelingToolkit, Multibody.jl and Dyad**, in any form, inside the repo [4, 5, 6].
- **Code from EntryGuidance.jl**, which has no licence. Read its paper only [33].
- **Archived packages** [32].
- **Porting Verner's tableaus, for now.** OrdinaryDiffEq's tableau file says the coefficients came from Verner's website [37]. That site now returns 404, and the redistribution terms could not be read (see Unverified). DOP853 is the lower-risk high-order choice.

### 2.2 Rocketry tools

**What the tools are**

| Tool | Licence | On this machine | Role here |
|---|---|---|---|
| OpenRocket 24.12 | GPL-3.0 [38] | jar installed [39]; headless through JPype, locally [40] | oracle, numbers only |
| RASAero II 1.0.2.0 | freeware; no licence or terms stated [41, 42] | cannot run: Windows only, and no Wine [43] | oracle; exported tables kept local |
| RocketPy 1.13.0 | MIT [44] | not installed | oracle; code may be ported with its notice |
| ThrustCurve.org API | no data licence stated [45] | web | data source at run time |
| `@thrustcurve/api1` 1.0.3 | ISC [46] | npm package | possible app dependency |
| OpenTsiolkovsky | MIT [47] | hosted web app or Rust build | orbital-launcher oracle |
| MAPLEAF | MIT [48] | not installed | 6-DOF oracle |
| NESC Atmospheric Case 17 | public domain [49, 50] | not downloaded | reference solution for a staged ascent |
| Barrowman 1967 thesis | US Government work, public use permitted [51] | NTRS | algorithm source |
| RocketSerializer | MIT [52] | not installed | `.ork` to RocketPy; one stage only; ships OpenRocket 22.02 and 23.09 jars |
| orhelper | GPL-2.0 [53] | not installed | cannot drive OpenRocket 24.12 |
| CamPyRoS | GPL-3.0 [54] | not installed | oracle only |

**The current ascent model**

- `ascent()` uses a constant Cd (default 0.5) on a fixed diameter, a constant mass flow per stage and an Isp that is linear in ambient pressure. It has no launch rail. The rocket rises vertically to `pitchAlt` and then follows a gravity turn [55].
- It already reports max-q and the drag and gravity losses. These are tested against Curtis Example 13.3: 298 m/s drag loss, 1,410 m/s gravity loss and 0.156 atm max-q [55].
- The default atmosphere is exponential and returns no temperature. `standardAtmosphere` already returns T [55].

**The existing OpenRocket vs RASAero comparison**

The comparison never ran RASAero II. Its RASAero numbers come from 18 project files and their exports [43]. It found:

- RASAero's drag is 0.849 to 0.928 times OpenRocket's at Mach 0.3 to 0.9, and 1.012 to 1.037 times at Mach 1.05 to 1.75 [43].
- RASAero's own simulations fly 5.2 to 5.3 % higher. The doc splits that gap into about +0.5 % from the drag table, +3.3 to +3.8 % from base drag under thrust, and +0.9 % from a pressure convention [43].
- A 2-D point mass using OpenRocket's Cd matched OpenRocket's apogee to 0.02 % [43].

**OpenRocket**

- 24.12 (27 Jul 2025) is still the latest release as of 14 Nov 2026 [56]. It added multi-level wind with CSV import, and Component Analysis sweeps, such as Cd against Mach, that can be exported [56].
- The jar uses the `info.openrocket.*` namespace and offers flat, spherical and WGS84 geodetic modes [39]. It has density and total-velocity data types but no dynamic-pressure type, so q has to be computed as ½ρv² [39].
- It gives no base-drag credit under thrust. The 2013 technical documentation says it subtracts the burning motor's area [57]. But `BarrowmanCalculator`, on master and in the local 24.12 jar, has no motor or thrust dependence [58].
- The documentation gives base drag as 0.12 + 0.13 M² below Mach 1 and 0.25/M above (eq. 3.94) [57].
- The documentation's flat-Earth, no-Coriolis and constant-wind statements describe OpenRocket in 2013. Version 24.12 has spherical and WGS84 modes with Coriolis and multi-level wind, so these are now settings to pin [57, 59]. The documentation's preface names no specific share-alike licence [57].
- `.ork` files are XML, optionally GZIP-compressed [57]. The local files are ZIP archives holding one `rocket.ork`. They use format version 1.9 when saved by 23.09 and 1.10 when saved by 24.12 [60].
- Simulation extensions are Java listeners whose hooks can override computed values [61]. The owner already has an extension with `ProfileAtmosphere`, `DragScaleListener`, `StopAtApogeeListener` and `FastAeroListener` [62].
- orhelper targets OpenRocket 15.03 and the old `net.sf.openrocket` package, so it cannot drive 24.12 [53].

**RASAero II**

- It predicts drag, lift, normal force and centre of pressure from Mach 0.01 to 25, and handles several stages. Its developer reports a 3.47 % average apogee error against flights [41].
- Version 1.0.1.0 (Aug 2016) extended its power-on base-drag model to the large nozzle exits of orbital-launcher stages. Version 1.0.2.0 (May 2019) extended it to satellite-launch-vehicle stages and added CSV export of flight data [42].

**RocketPy**

- `Rocket` takes `power_off_drag` and `power_on_drag` [63]. The constructor docs say these are functions of Mach only, but v1.12.0 advertises drag as a function of Mach, Reynolds number and angle of attack [63, 64].
- `Flight` takes rail length, inclination (default 80°) and heading (default 90°), and integrates with LSODA by default [65]. It offers '3 DOF' and '6 DOF' modes, and reports apogee, maximum speed, maximum Mach and maximum dynamic pressure with its time [65].
- v1.12.0 (20 Mar 2026) added 3-DOF flight, `FlightComparator`, ThrustCurve access with caching, and net thrust in 3-DOF [64]. Reviewers of the 3-DOF pull request noted that sanity tests were still missing [66].
- `FlightComparator` interpolates both datasets onto a shared 1,000-point grid and reports RMSE, MAE and maximum deviation [67].
- RocketPy treats the Earth-fixed frame as inertial [68], and its standard atmosphere covers only -2 to 80 km [69]. It is a sounding-rocket code, not an orbital one.
- Its parachute model is `cd_s` plus a trigger, sampling rate, lag and noise. Porosity sets an added mass without changing `cd_s` [70].

**ThrustCurve.org**

- Its JSON API asks clients to stay under 2 requests a second, cache responses for at least 24 hours and not hotlink motor files. It states no data licence [45].
- The ISC client has no runtime dependencies. Nothing documents CORS for browser use [46].

**Launcher-scale codes**

- OpenTsiolkovsky propagates in ECI with WGS84 J2 gravity and US76 up to 1,000 km [47]. Its axial-force tables depend on Mach and carry a separate unpowered value. It clamps thrust at max(F_vac − A_e·p, 0) and integrates with RK4 or Dormand-Prince 5(4) [47].
- Its example vehicles include Saturn V, Falcon 9 and H-IIA [47]. The Saturn V file's axial-force coefficients run from 0.35 to 0.55 against an unlabelled key that goes up to 8. The file cites no data source [71].

**NESC Atmospheric Case 17**

- It is an idealised two-stage rocket flown from sea level to a highly elliptical orbit without guidance. It uses US76, J2 and a rotating WGS-84 Earth [50].
- Its models are DAVE-ML, in a package linked from the Bodies page [72]. Its reference trajectories are in `Atmos_17_TwoStageRocketToOrbit.zip`, linked from the 2015 home page [49].
- The orrery already runs `sixdof.js` against all 26 NESC orbital cases (02 to 11), but against no atmospheric case [73].

**Other references**

- Barrowman's thesis covers slender axisymmetric bodies with 3 or 4 fins at subsonic and supersonic speeds. It does not cover the transonic range [51].
- The tudat C++ repo was archived on 14 Jan 2026; tudatpy now holds the source [74]. Its two-stage ascent example flies on Mars with a constant Cd of 0.85 [75].
- The Delta III ascent benchmark uses Cd 0.5, S = 4π m² and an exponential atmosphere (ρ0 = 1.225 kg/m³, H = 7,200 m). That is the same model class as `ascent()`. YAPSS (MIT) has a runnable notebook for it [76].
- PEGAS is an MIT implementation of Shuttle-style UPFG closed-loop guidance [77].

**What fits**

- **Our own code, with no third-party code**: Cd(Mach) tables with power-off and power-on values, an `.eng` thrust-curve reader and a sounding-rocket mode. Mirroring RocketPy's `power_off_drag`/`power_on_drag` shape lets one CSV feed both codes [63].
- **Oracles, numbers only**:
  - OpenRocket through the existing runtime;
  - RocketPy in 3-DOF mode;
  - OpenTsiolkovsky for launcher-scale ascent;
  - NESC Case 17, later.
- **Ports with attribution**: RocketPy or OpenTsiolkovsky code if ever needed (both are permissive), and Barrowman's method from the public-domain thesis.
- **A browser `.ork` importer for users' own files**, written from the documented format. It must handle ZIP and GZIP and format versions 1.9 and 1.10 [57, 60].

**What does not fit**

- OpenRocket code or its example `.ork` files in the repo (GPL-3.0) [38].
- Text and figures from OpenRocket's technical documentation, which is share-alike [57]. Cite and re-derive its equations instead.
- orhelper, for 24.12 [53].
- Committing ThrustCurve motor files or RASAero tables while their terms are unstated [45, 42].
- OpenRocket or RASAero for capsule entry. Both are tools for slender rockets.

### 2.3 Astrodynamics simulators and numerical techniques

**The orrery's baseline**

- **Steps.** Cowell steps use Yoshida 4, with a step of η times the local dynamical time and no error estimate. Encke steps use Dormand-Prince 5(4) with error control, and rectify when |δ| > 1e-4 |ρ| [78].
- **Events.** Impacts and primary changes are checked only at step ends, and the documented limit is that SOI switching has no hysteresis [78]. Encke is entered below a perturbation ratio of 1e-5 and left above 3e-5 [79].
- **Planned speed-up.** An averaged J2-secular reference orbit for Encke [78].
- **Ephemeris error.** Per `nbody.js`, the measured error of the astronomy-engine bodies is 0.01 to 0.07 km [80].
- **De Sitter term.** `environment.md` names de Sitter's geodesic term and leaves it out on purpose. It belongs to geocentric integrations, and the kernel is heliocentric [81].

**The tools**

| Tool | Licence | Use here |
|---|---|---|
| NASA GMAT | Apache-2.0 [82] | oracle for cislunar and long-arc force models |
| Orekit, with Hipparchus | Apache-2.0 [83, 84] | oracle for event times, relativity and tides; readable integrator code |
| Tudat / tudatpy | BSD-3-Clause [85] | lifting-entry oracle (section 3) |
| Basilisk | ISC [86] | second 6-DOF oracle; low value |
| poliastro, hapsira, boinor | MIT [87, 88] | quick Python checks; poliastro is archived |
| THALASSA | MIT [89] | regularised formulations |
| heyoka / heyoka.py | MPL-2.0 [90] | Taylor oracle in Python; outputs only |
| CNES PATRIUS | Apache-2.0 [91] | a second Java oracle |
| NASA 42 | NASA Open Source Agreement [92, 93] | not used |
| NASA Trick and JEOD | NOSA 1.3 [94, 95] | not used; Trick's event method is borrowed as an idea |
| JPL MONTE | Caltech proprietary [96] | not used |
| NASA POST2 | US release only [97] | not used |
| GMAT.jl | MIT; dormant since Sep 2020 [98] | not used |

**GMAT**

- The GitHub repo is Apache-2.0, has 8 commits and no Releases; the binaries are on SourceForge [82].
- Its propagators include PrinceDormand45 and 78, RungeKutta89, RKF56, a Dormand-El-Mikkawy-Prince RKN 6(8), Adams-Bashforth-Moulton and Cowell. It has no Bulirsch-Stoer or Gauss-Jackson [99].
- The RKN 6(8) header carries both Apache-2.0 and a legacy NASA usage-agreement notice (GSC-14735-1) [100]. PrinceDormand78 has a 13-stage tableau and no dense output [101].
- Its relativity force computes the Schwarzschild, de Sitter and Lense-Thirring terms [102].
- It has drag atmospheres (exponential, Jacchia-Roberts, MSISE-90) but no lift or entry model [103].
- R2025a added production multi-body harmonic gravity [104]. In 2014 its nightly regression suite ran about 13,000 test scripts [105].
- GMAT reads a user-supplied SPK. Its default ephemerides are DE421 in SPICE mode and DE405 in DE mode, so DE442 must be set explicitly [82].

**Orekit and Hipparchus**

- Orekit has analytical propagators (Kepler, Eckstein-Hechler, Brouwer-Lyddane, SGP4), a semi-analytical one (DSST) and a numerical one [83].
- Its force models include ICGEM gravity, DTM2000, JB2008, NRLMSISE-00, SRP with several occulting bodies, Lense-Thirring and de Sitter terms, and tides. Its event detectors can be combined with boolean logic [83].
- The numerical propagator runs on Hipparchus integrators. A helper turns one position tolerance into tolerance vectors [106].
- orekit-jpype 13.1.9.0 needs JDK 11 or newer [107]; this machine has a full OpenJDK 25.
- DSST matched the Fortran DSST Standalone over arcs of several thousand days [108].
- Hipparchus (Apache-2.0) has DormandPrince54 and 853, Gragg-Bulirsch-Stoer, Adams methods in Nordsieck form, and others [84].

**Tudat**

- It recommends RKF7(8) or RKDP8(7) for most problems. Its Bulirsch-Stoer has no dense output [109].
- Its Encke does not update the reference orbit. Termination on a dependent variable, such as altitude, can stop exactly on the condition with a root finder [110].
- It has a US76 atmosphere, and a custom atmosphere whose density is a function of altitude, longitude, latitude and time [111].
- Its re-entry example flies the Space Shuttle with tabulated CL and CD. Bank is chosen to hold the flight-path-angle rate at zero. The examples repo has no licence [112].
- The `aerodynamic_angle_based` rotation model takes angle of attack, sideslip and bank as functions of time [113].

**Other tools**

- Basilisk defaults to RK4 and lets users define explicit RK methods from Butcher tables [114]. Its drag de-orbit scenario has no lift [115].
- NASA 42's own slides admit loose handling of true-of-date against J2000 frames, and call its atmospheric flight provisional [92].
- Trick's dynamic events evaluate an error function after each step, then use regula falsi to step to the boundary within 1e-15 [116].
- poliastro (MIT) was archived on 14 Oct 2023. Its Cowell propagator accepts altitude, latitude, umbra and node events [87]. boinor (MIT, pushed Jun 2026) credits the poliastro team [88].
- MONTE has run all of JPL's navigation since 2012 and is licensed only on request [96].

**Integration methods**

- Atallah et al. (2019) compared six integrators on Earth orbits with 70×70 gravity [117]:
  - DP8(7) needed far fewer force calls than DP5(4) at high accuracy;
  - adaptive Picard-Chebyshev was most efficient everywhere except LEO;
  - drag made round-trip accuracy at least two orders of magnitude worse;
  - RKN methods are limited to forces that depend on position only;
  - an energy (Hamiltonian) check is often too optimistic.
- Fehlberg's NASA TR R-287 gives RKF7(8) coefficients and is a US Government work [118].
- **Gauss-Jackson and Störmer-Cowell.**
  - US space surveillance has used 8th-order Gauss-Jackson since the 1960s, and Berry and Healy derive it from first principles [119].
  - A generalised Sundman time transform takes larger steps near apogee [120].
  - A variable-step Störmer-Cowell matches Gauss-Jackson with s-integration, and does better under high drag [121].
- **Regularisation** pays mainly in high orbits. At equal accuracy it was up to 2× slower than semi-analytical methods in LEO, about equal in GTO, and up to 10× faster in HEO [122]. THALASSA implements these formulations [89].
- **Taylor methods.**
  - The heyoka Taylor integrator was competitive with or better than specialised integrators, including on Apophis's 2029 encounter [90].
  - Taylor integration with polynomial root-finding gives event detection with strong guarantees [123].

**Event detection**

- SciPy's `solve_ivp` detects an event from a sign change over a step, so two crossings in one step can be missed. RK45 has quartic dense output and DOP853 7th-order [124].
- NAIF's Geometry Finder can find distance crossings, extrema and occultations from an SPK. Its search step must be shorter than any event of interest [125].

**What fits**

1. **Exact event location (M).**
   - In Encke arcs, use the DP5(4) interpolant, added back to the reference conic at each trial time.
   - Across Yoshida steps, use a quintic Hermite on (r, v, a).
   - Root-find with Illinois regula falsi, which `entry.js` already uses for its bank solve [126]. Restart the step after an event.
   - Add hysteresis to SOI switching, as the Encke 1e-5/3e-5 thresholds already do [79].
   - Test with analytic two-body times for periapsis and radius crossings. SPICE's Geometry Finder can supply event times from the Artemis SPKs through SpiceyPy, which the repo already uses [125].
2. **Node checks before outside oracles (S-M).** Check self-convergence by step halving, with the kernel's own forces. Use the method of manufactured solutions through a forcing hook in the term list in `environment.js`. Round-trip closure tells us little for Yoshida, because it is time-symmetric and retraces its own steps. Energy checks are optimistic [117].
3. **Error-controlled Cowell with DOP853 or RKF7(8) (M).**
   - Port it from the published coefficients [118]. Hipparchus is a readable Apache-2.0 reference [84].
   - The gain is limited, because the ephemeris interpolation sets the accuracy floor [80]. Let Cowell steps end on ephemeris nodes, as Encke steps already do.
4. **GMAT as the cislunar force-model oracle (M-L).**
   - Set DE442 as the SPK and match the Earth frames.
   - Switch on one force at a time and use PrinceDormand78 at a tight tolerance.
   - Store the states as JSON fixtures, like the SPICE and NESC ones.
   - It is a large download and needs approval.
5. **Orekit through orekit-jpype (M)** for event times, relativity and tides, using the installed Java. The planned J2-secular Encke reference needs only textbook secular rates; Orekit's analytic propagators can cross-check it on Earth arcs.
6. **Tudat for lifting entry.** See section 3.

**What does not fit**

- **RKN pairs for coast arcs.** The default force model includes the Schwarzschild and Lense-Thirring terms, which depend on velocity [81], and RKN assumes forces that depend on position only [117]. The gain would be low once DOP853 exists.
- **Regularised elements (KS, EDromo) and Gauss-Jackson, for now (L, low value).** Encke already covers near-Keplerian motion [122], and the app makes many burns, each of which would restart a multistep method.
- **heyoka in the app.** It is a C++ library that compiles code with LLVM at run time [90], so it cannot run in a browser worker. heyoka.py is fine as an outputs-only oracle.
- **42, Trick and JEOD, MONTE, POST2.** Their licences or release terms rule them out (NOSA, proprietary, US-only).

### 2.4 Entry tools and sources

The eng-tools catalogue had no entry rows [127]. The primary sources are NASA papers on NTRS and NASA pages, plus the Apollo flight code, which is marked public domain [128]. Section 3 turns them into a plan.

| Resource | Licence | Role |
|---|---|---|
| NASA Orion papers: AAS 24-174, Rea & Putnam 2007, Bibb 2011, IPPW 2026, Daum 2026, Bihari 2024, Ray 2017 | NASA NTRS, public | data and algorithms (facts and equations; no copied text) |
| Apollo Comanche055 `REENTRY_CONTROL.agc` | public domain [128] | source for PredGuid's Apollo phases |
| Mendeck & Craig, MSL entry guidance | NASA NTRS [129] | readable final-phase equations |
| Tudat / tudatpy | BSD-3-Clause [85] | lifting-entry oracle |
| SciPy `solve_ivp` | BSD-3 [124] | oracle for event timing |
| RocketPy parachute | MIT [70] | descent-under-canopy oracle |
| Open-Meteo Historical Forecast API | data CC BY 4.0; free tier non-commercial; server AGPLv3+ [130] | winds up to 30 hPa |
| ERA5 pressure levels (Copernicus CDS) | CC-BY; account needed [131] | atmosphere on the day, to 1 hPa |
| NASA GRAM Suite | NASA General Public Release, by request form [132] | density and wind dispersions; low-medium value |
| AMAT | GPL-3.0 [133] | oracle only; low value |
| Dymos / JuMP shuttle-entry benchmark | Apache-2.0 [134] / MPL-2.0 [135] | checks equations of motion and bank sign; low value |

- AMAT's Apollo 4 example flies a constant 70° bank, labelled arbitrary. It has no flight-data overlay and no Earth rotation, so it checks equations of motion, not Apollo's flight [133].
- Dymos reports a final latitude of 0.5958 rad on the shuttle problem [134], and JuMP reports 34.18° [135].
- NASA's own Artemis II slides say the GEOS+GRAM density was not accurate enough for aeroheating work [136].
- NESC planned an Apollo-like lunar-return entry check case but never attempted it, so no multi-tool NESC entry reference exists [137]. The 2023 NESC set is all lunar orbital [138].

### 2.5 Real-time browser simulation

**The orrery's baseline** [139]

- **Scene.** A floating origin: positions are doubles in km on the CPU and camera-relative float32 on the GPU, drawn with a logarithmic depth buffer. The render unit is 1,000 km.
- **Clock.** The clock clamps real dt to 1 s.
- **Step requests.** One step request is in flight at a time. `advance()` ends each request exactly at its end time (the clock time, or a burn hold), within a 20,000-step budget. Lag is recorded, and the drawn state is carried forward by a two-body plus J2 RK4 propagation.
- **Interactive thrust.** It is averaged over the frames since the last request.
- **Aiming.** `aimTo` does one base run, then three Jacobian columns and one verification run for each Newton round. All of these run one after another in the stepping worker.

**Stepping and time warp**

- **Fixed timestep.** Stepping by variable frame time makes results depend on frame rate. The fix is an accumulator consumed in fixed steps, a clamp on frame time, and display by blending the previous and current states [140].
- **Orbiter**, which is MIT [141]:
  - its documented propagators are RK2 to RK8 and Yoshida symplectic methods of orders 4, 6 and 8 [141];
  - it switches to an Encke-type "orbit stabilisation" when a frame would advance more than 1e-3 of an orbit [141];
  - it picks among up to five propagators by frame length [142];
  - it sub-steps long frames up to a cap, and disables stabilisation above a perturbation ratio [143].
- **Universe Sandbox**:
  - an adaptive mode takes safe steps within a tolerance, and too coarse a step ejects bodies [144];
  - a two-body mode for extreme warp was proposed, but not scheduled [145].
- **Principia** (MIT) draws an integrated prediction whose length and tolerance the user sets. Long, tight predictions can make the game unresponsive [146].
- **OpenSpace** ramps changes to the simulation rate and pause over a set duration [147].
- **Hidden tabs.** `requestAnimationFrame` is paused in most browsers [148]. Chrome throttles timers on hidden pages to once a second, and, under some conditions, to once a minute after 5 minutes [149].

**Precision**

- **Float32 spacing.** Float32 keeps about 7 significant digits [150]. Its spacing grows with magnitude [151]: about 16 km at 1 AU and 512 km at 30 AU, expressed in km (derived from the 24-bit significand).
- **Celestia** (GPL-2.0-or-later) stores positions as 128-bit fixed point. It subtracts two coordinates in 128-bit before converting the difference to double [152], and splits the depth range into per-body partitions drawn back to front [153].
- **GPU relative-to-eye (Ohlarik, 2008).** Each double is split into high and low floats in a static buffer, and the shader subtracts the eye's two parts, giving about 1.35 cm error [150]. The split is defined in metres, so the orrery's 1,000 km render unit needs it rescaled [150].
- **Chord error.** Orbit lines use 360 samples [139]. The chord error is R(1 − cos 0.5°): about 5,700 km at 1 AU and 170,000 km at 30 AU (derived). That is far larger than float32 spacing.

**Depth**

- Reversed-Z with a float32 depth buffer distributes precision well; integer depth buffers gain nothing from reversal [154]. Log depth written in the fragment shader disables early depth testing [155]. One reported foliage-heavy three.js scene lost about 13 ms per frame to it [156].
- **three.js r187.**
  - Reversed depth needs `EXT_clip_control`. If both `reversedDepthBuffer` and `logarithmicDepthBuffer` are set and the extension is missing, three falls back to log depth [139].
  - The official example renders into a float depth texture for post-processing [157].
- **Browser support.** `EXT_clip_control` reached 92.8 % of tested browsers, but Firefox only 60.0 %, Linux 75.4 % and Android 70.3 % [158]. Firefox's implementation landed in Firefox 159 [159].

**Workers and WebAssembly**

- **Cross-origin isolation.**
  - SharedArrayBuffer and shared Wasm memory need it [160]. It takes the COOP and COEP headers, and COEP blocks cross-origin resources that lack CORP or CORS [161].
  - GitHub Pages cannot set these headers. A 2023 comment said custom headers were a scenario GitHub would support, with no date, and the thread is still open [162].
  - A user reported in Aug 2025 that the coi-serviceworker workaround no longer worked in Firefox [162].
- **Emscripten** (MIT/NCSA [163]).
  - Threaded builds need cross-origin isolation, and need a second build for when the page is not isolated [164].
  - `-msimd128` gives 128-bit SIMD, including two doubles per lane operation, from Chrome 91, Firefox 89 and Safari 16.4 [165].
- **wasm-bindgen-rayon** (Apache-2.0) needs nightly Rust and cross-origin isolation [166].
- **Speed.** Wasm ran 45 % (Firefox) and 55 % (Chrome) slower than native on SPEC on average [167]. Optimised JS and Wasm reach similar peaks; Wasm's advantages are predictable speed, SIMD and threads [168]. The geopotential recursion already uses `Float64Array` [139].
- **Reproducibility.** ECMAScript lets `Math.sin`, `Math.cos` and `Math.exp` return implementation-approximated values [169]. A fixed step grid alone therefore cannot make Firefox or Safari match the Node (V8) validation runs bit for bit; a Wasm kernel with its own libm could.
- **Plain workers.**
  - Transferring an ArrayBuffer by `postMessage` moves it without copying [170].
  - `Atomics.wait` cannot run on the main thread [171].
  - `OffscreenCanvas` lets a worker own a WebGL canvas [172].
  - `navigator.hardwareConcurrency` gives the logical core count for sizing a pool [173].

**WebGPU and the GPU**

- **Support.** As of Nov 2025, WebGPU shipped in Chrome, Edge, Firefox and Safari on most desktop platforms, but not yet by default on Linux [174]. Chrome 144 (Jan 2026) began a staged Linux rollout on Intel Gen12+ GPUs [175].
- **No f64.** WGSL has only f32 and f16 as concrete float types [176]. Myles Maxfield wrote in 2022 that Metal-based WebGPU would not offer f64 [177].
- **WebGPURenderer.** three.js's WebGPURenderer is experimental and does not support `ShaderMaterial` or `onBeforeCompile` [178]. The orrery uses these in 7 scene files [139].
- **GPU n-body.** All-pairs n-body on the GPU tiles bodies through shared memory in single precision [179]. webgpu-samples (BSD-3) has compute, reversed-Z and worker samples [180].
- **spacekit** (MIT) solves Kepler's equation per vertex in a GLSL shader, from orbital elements stored as attributes [181].

**Interpolation**

- **SPK type 13** stores states and interpolates them with Hermite polynomials using position and velocity [182].
- **spkw13_c** writes such a segment from a list of states [183].
- **WHFast** gives a fast Kepler-drift-plus-kick propagator [184].
- **REBOUND** (GPL-3.0) now also runs in a browser through Wasm [185].

**What fits, with effort**

1. **Budget, warp cap, ramps and hidden tabs (S).**
   - Replace the step budget with a wall-clock budget per request.
   - Cap warp and say so on screen, including that the planets and the mission timeline slow too.
   - Ramp rate changes as OpenSpace does [147].
   - Choose a policy for hidden tabs. Today a hidden tab already pauses sim time in effect, because rAF stops and the 1 s clamp drops the gap [148].
2. **Aim in its own worker (S).** Stepping will no longer wait on aiming. A pool that runs the Jacobian columns in parallel gives about 1.7× for the first Newton round and at most 2× for later rounds (derived from the run counts above). Each pool worker loads its own ephemeris and gravity tables.
3. **Physics on its own step grid, displayed from a Hermite node buffer (M to M-L).** This uses the SPK type 13 scheme [182]. Results stop depending on frame rate, though not on the browser engine [169]. Interactive thrust must be timestamped onto the step grid. SpiceyPy with `spkw13_c` and analytic Kepler arcs are the oracles [183].
4. **An integrated prediction line, after item 3 (M).**
   - Chunk the work so it does not delay step replies.
   - State a space-weather assumption beyond the end of the CelesTrak data.
   - Assign a primary to each segment, for drawing relative to the primary.
5. **Adaptive resampling of orbit lines (S).** Then rescale the relative-to-eye split if jitter remains [150].
6. **Depth: measure first.**
   - Profile with Spector.js (MIT) [186] or the timer-query extension, which has limited availability [187].
   - Then offer reversed-Z as an opt-in, keeping log depth as the fallback [139].
   - A float depth target loses canvas MSAA unless it is multisampled.
7. **Many small bodies on rails (M).** Use Kepler's equation in the vertex shader [181]. Pass time relative to a recent epoch, because a float32 Julian date near 2.46e6 resolves only 0.25 day (derived). Downloading element catalogues needs approval.
8. **Two-part sim time (S).** Store sim time as two parts (days plus fraction), or use compensated summation. This ties in with the open leap-second clock bug.
9. **A warp cap during atmospheric flight (S).** Key it to altitude or dynamic pressure, so that entry steps stay short.

**What does not fit now**

- **Threaded Wasm.** Hosting is undecided, GitHub Pages cannot set the headers [162], and plain workers cover the coarse parallelism.
- **Migrating to WebGPURenderer.** It means 7 shader files to port, and WGSL has no f64 for the kernel anyway [176, 178].
- **A Wasm port of the harmonics**, unless profiling shows they dominate. Even then, the main argument is reproducibility across browsers, not speed [168, 169].
- **An on-rails Wisdom-Holman mode in cislunar space.** It assumes a dominant central mass [184], which fails near the Moon. If an approximate high-warp mode is wanted, extend the existing J2 carry-forward or use Encke with frozen perturbations, as Orbiter does [141]. Label it, and keep it out of validation.

## 3. Entry modelling plan

### Where it stands

The committed code flies a ballistic fall with drag. The `feat/entry` branch has an uncommitted prototype:

- `entry.js`, 207 lines, has a constant trim L/D. Its predictor-corrector flies a constant bank, solved by Illinois regula falsi. It has deadband bank reversals, two-step parachutes and a reference to FNPEG (Lu, JGCD 37(3)) [126].
- `environment.js` imports it, `craft.js` passes an `entry` option through `envParams()`, and `kernelHost.js` is also modified [126].
- The predictor uses US76 below 86 km and the kernel's MET densities above. The kernel's truth atmosphere below 86 km is also US76 [126, 188].

### What Orion flew

**PredGuid phases on Artemis I.** Orion flew six phases [189]:

1. Initial roll.
2. Energy management, using Apollo's HUNTEST and a constant-drag subphase.
3. Up control: a numerical predictor-corrector using estimated density and L/D.
4. Ballistic.
5. Final: Apollo's final-phase controller with a stored reference, plus a g-limiter.
6. Terminal: proportional heading guidance.

Downrange and crossrange are decoupled [189].

**Control.** In the atmosphere only bank is flown; angle of attack and sideslip are held by aerodynamic stability. Two strings of six CM thrusters are run by a 40 Hz controller with gains scheduled on velocity [189].

**Estimators.** Measured acceleration scaled the onboard 1976 standard atmosphere and gave an L/D estimate [189].

**Artemis I outcome** [189]:

- the air was about 10 % thinner and L/D about 5 % lower than predicted, both within dispersions;
- guidance flew 6 bank reversals;
- the skip apogee was 287.4 kft (87.6 km), against 293.5 kft predicted;
- the range from entry interface to splashdown was about 3,200 nmi;
- the bank solution assumed no wind, which broke down in the last 90 s or so of guided flight;
- neither the g-limiter nor the skip-out protection triggered.

**Artemis II** flew a modified trajectory without the skip [190], with a shorter maximum downrange [191]. This followed the Artemis I finding that heat built up in the Avcoat between the dips and made gas that could not vent [192].

**Earlier design study.** The 2007 PredGuid study gives Orion an L/D of 0.3 to 0.35. Direct entry reached about 2,500 nmi of range; covering the continental US through the lunar month needed at least 5,500 nmi, which only a skip can give [193].

### Step 1: hand-over at entry interface (with the event finder, section 2.3)

- **Interface.** Entry interface is 400,000 ft geodetic, which is 121.92 km [193, 188].
- **Artemis I timing.**
  - The as-flown OEM ends at 2022-12-11 17:19 TDB, about 17:18 UTC (TDB − UTC ≈ 69.2 s) [188].
  - That is about two minutes before entry interface at 17:20:14 UTC, and after CM/SM separation at 17:00 UTC [194].
  - Fly that gap in the kernel, find entry interface with the event finder, then switch to the entry model.
- **Artemis II.** The repo uses the flown BET's −5.919° at 121.92 km, because NASA did not publish the entry flight-path angle [188].

### Step 2: vehicle and aerodynamics (S)

**Geometry and mass**

- Diameter 198 in (5.03 m), heat-shield radius 237.6 in, shoulder radius 9.9 in, height 130 in [136].
- Reference area π × (2.515 m)² = 19.87 m² (derived).
- Mass: the only primary figure is the 2007 design mass of 20,369.2 lbm (9,239 kg) [193]. Label it as a design value.

**Aerodynamic coefficients**

- **Hypersonic trim.**
  - Angle of attack about 161 to 164°, where 180° means heat shield forward [195].
  - L/D at trim is about 0.28 at FMV 10 and falls to about 0.245 at FMV 35. FMV is Mach below 8.8 kft/s and velocity in kft/s above 9.8 kft/s, blended in between [195].
  - The uncertainty is ±0.035 in L/D, or ±0.05 with centre-of-gravity uncertainty, applied through uniform factors [195].
- **Supersonic and subsonic** [136].
  - The EFT-1 reconstruction gives L/D of about 0.25 to 0.29 hypersonic, peaking near 0.38 around Mach 1.5.
  - CD runs from about 1.3 at Mach 1.6 to about 0.9 at Mach 0.4.
  - These curves compare the pre-EFT-1 database (v0.80) with EFT-1 flight data. They are not the Artemis database.
- **Hypersonic CD** is unverified (see Unverified). Keep it as a parameter until it is read from Bibb's figures.

**Implementation**

- One table must drive both the kernel force and the predictor, or the guidance will be biased.
- Dispersions for a later Monte Carlo: entry flight-path angle 0.1° and velocity 90 ft/s (3σ), and mass ±3.1 % (uniform) [193].

### Step 3: guidance, stage A (S-M)

Change the predictor-corrector's bank from a constant to a value linear in an energy-like variable, as FNPEG does [196]. Lu et al. (JGCD 40(2), 2017) compared FNPEG with PredGuid for Orion [197]. FNPEG uses the same equations for skip and direct entry without phase logic [196], so one algorithm covers both Artemis profiles. Re-implement the equations; do not copy the AIAA text.

### Step 4: guidance, stage B: PredGuid phases (L)

| Phase | What it does | Exit condition |
|---|---|---|
| 1 Initial roll | holds a preset bank; skip-out protection commands full lift-down [189] | altitude rate above −700 ft/s (−213 m/s) [189] |
| 2 Energy management | Apollo HUNTEST and constant drag [189] | range error under 25 nmi [193] |
| 3 Up control | predictor-corrector with estimated density and L/D [189] | drag below 6.0 ft/s² (1.83 m/s²) [193] |
| 4 Ballistic | low drag; keeps predicting, no commands below 1.6 ft/s² [193] | drag above 6.5 ft/s² (1.98 m/s²) [193] |
| 5 Final | Apollo final-phase controller, stored reference and gains, g-limiter [189] | Earth-relative speed below 1,000 ft/s (305 m/s) [193] |
| 6 Terminal | proportional heading guidance [189] | forward bay cover chute deploy [189] |

- **Status of the thresholds.** They are 2007 design values; the 2024 deck gives no flown thresholds [189, 193].
- **Apollo phases.** Build phases 2 and 5 from Apollo's own flight code. Comanche055's `REENTRY_CONTROL.agc` is marked public domain and holds the initial roll, HUNTEST, the range and up-control logic and the final phase [128]. Morth's MIT report R-532 derives the method [198].
- **Cross-check.** The MSL derivative gives the final-phase equations in readable form [129]:
  - predicted range from deviations in drag and altitude rate;
  - a commanded vertical L/D;
  - bank equal to K2·acos((L/D)vc / (L/D)), with K2 = ±1 switched at a deadband that is quadratic in velocity;
  - heading alignment capped at 30°.
- **Reference and gains.** Compute the reference trajectory and gains offline.
- **Bank limits.** No Orion bank-rate or bank-acceleration limits were found. The 15°/s and 5°/s² in the Pterodactyl study belong to a deployable entry vehicle [196], so use them only as placeholders.

### Step 5: density and L/D estimator (S-M)

**Method**

- Estimate density from sensed acceleration, using Cx = 2 m a_x / (ρ V² S_ref) [136].
- Take its ratio to the onboard model, bound it and average it.
- Estimate L/D from the lift and drag accelerations.
- In the 2007 design, the estimator ran when drag exceeded 2.0 ft/s² [193].

**Limitation and fix**

- In the app the truth atmosphere below 86 km is the same US76, so an estimator would read about 1.0 [188].
- To reproduce Artemis I's thinner air, give the kernel an atmosphere for the day: ERA5 pressure levels up to 1 hPa [131], blended into NRLMSIS 2.1 (pymsis, MIT, already in the catalogue) above. ERA5 needs a Copernicus account, which needs approval. The simpler alternative is to impose a truth perturbation such as 10 % thinner air.
- The bank callback also needs the sensed acceleration passed through `kernelHost`.

### Step 6: staged parachutes (M)

| Stage | Hardware and timing | Trigger |
|---|---|---|
| FBC parachutes | 3 × ~7 ft, mortar-deployed [199]; held 1.4 s, then the forward bay cover is jettisoned [200]; pressure recovery behind the capsule 0.86 [201] | smart deploy evaluated from 35,000 ft, floor 24,000 ft [199] |
| Drogues | 2 × 23 ft variable-porosity conical ribbon; mortar fires 2.0 s after the FBC jettison [200]; four reefing cutters each, two at 8 s and two at 16 s [199]; projected diameters 8.73, 11.59 and 16.10 ft; pressure recovery 0.94 [201] | follows the FBC jettison |
| Drogue release | | smart release evaluated from 6,800 ft, floor 5,600 ft, at least 7.4 s after drogue deploy [199] |
| Pilots | 3 × 9.85 ft [200] (10 ft in [199], 11 ft in [202]); main bags pulled out about 4.3 s later [200] | drogue release |
| Mains | 3 × 116 ft quarter-spherical ringsails with three reefing stages, sized to land with one failed [200]; projected diameters 9.87, 19.52 and 81.20 ft [201]; canopy area π/4 × 116² ≈ 10,570 ft² each (derived; "nearly 11,000 ft²" in [199]) | |
| Landing | reorientation enabled at 1,500 ft; thrusters keep roll control until touchdown [199] | |

- **Artemis I triggers.** The FBC jettison sequence, including drogue deploy, started at the altitude floor. The mains were triggered by smart drogue release at minimum body rates [200].
- **Inflation.** Model opening with a fill constant and an opening exponent for each reefing stage, as the CPAS work does [201], rather than a first-order lag.
- **Drag areas.** The figures in Ray's charts are unverified. Calibrate the full-open main drag area to NASA's splash speed of about 17 mph [202]. At 9,000 kg and sea-level density, that needs about 9,000 ft² of effective drag area per canopy; 3 × 10,900 ft² would give about 15 mph (derived).
- **Oracle.** RocketPy's parachute model (MIT) is a permissive check on terminal speed under canopy [70, 203].

### Step 7: winds (S)

- **Why.** Under parachutes the trajectory depends on winds [200]. The bank solution's no-wind assumption failed late in Artemis I's guided flight [189].
- **Source.** Open-Meteo's Historical Forecast API gives pressure-level winds, temperature and geopotential height from 1000 to 30 hPa, about 110 m to 22 km [130]. Fetch them for both splash areas and times, and apply them as air-relative velocity below 22 km.
- **Terms** [130]:
  - the data are CC BY 4.0 and need an attribution link;
  - the free tier is for non-commercial use;
  - the server code is AGPLv3, so do not bundle or self-host it.
- The fetch needs approval.

### Step 8: heating readout (S)

Integrate Sutton and Graves' stagnation-point heating [204] into a heat load. That shows why Artemis II dropped the skip [192].

### Step 9: validation targets

**Artemis I, 11 Dec 2022**

| Quantity | Value | Source |
|---|---|---|
| CM/SM separation | 17:00 UTC | E1 |
| Entry interface | 17:20:14 UTC | E1 |
| First dip | just below 200,000 ft (61 km) | E3 |
| Skip apogee | 287.4 kft (87.6 km) flown; 293.5 kft predicted | E5 |
| Bank reversals | 6 | E5 |
| Air and L/D against prediction | about 10 % thinner, about 5 % lower L/D (reproduce with an imposed perturbation) | E5 |
| 40,000 ft | 17:35:28 UTC | E1 |
| FBC chute / drogues / mains | 17:36:02 / 17:36:06 / 17:37:26 UTC | E1 |
| Main deploy conditions | 9,500 ft and about 130 mph, as narrative in the blog, not a measured value | E1 |
| Splashdown | 17:39:41 UTC, 20 mph or less | E1 |
| Entry interface to splashdown | 19 min 27 s (derived); about 3,200 nmi | E1, E5 |
| Miss distance | 2.1 nmi from target, against a 5 nmi requirement | E3 |
| Peak load | two events of about 4 g each (a 2021 pre-flight figure) | E8 |
| Landing area | west of Baja California, south of Isla Guadalupe; no coordinates published | E3, E4 |

**Artemis II, 10 to 11 Apr 2026.** The blog values are planned times, so use tolerances of about ±1 min [205].

| Quantity | Value | Source |
|---|---|---|
| Entry interface | about 23:53 UTC at about 400,000 ft; MET 9/01:33 | E12, E13 |
| Splashdown | about 00:07 UTC on 11 Apr; MET 9/01:46 | E12, E13 |
| Entry interface to splashdown | about 13 to 14 min | E13, E14 |
| Profile | single pass, no skip | E9, E15 |
| Peak load | up to 3.9 g (planned) | E12 |
| Drogues | about 22,000 ft (blog) or 25,000 ft (press kit) | E12, E13 |
| Mains | about 6,000 ft; fits the 6,800 to 5,600 ft drogue-release window | E12, E17 |
| Splash speed | about 17 mph (press kit) or 19 mph (preview) | E13, E14 |
| Entry interface accuracy | within 192 ft of target | E11 |
| Splash accuracy | 0.59 mi from the predicted site | E11 |
| Flight-path angle at 121.92 km | −5.919° (flown BET, repo notes) | E30 |

- **Conflicting values.** NASA's heat-shield page gives a peak of Mach 39 [191], while a preview article gives Mach 32 [206]. Peak temperature is stated as above 4,000 °F [191] and as about 3,000 °F in a general press-kit line [202]. Neither belongs in a test.
- **Later validation cases.**
  - EFT-1 (Dec 2014), a direct entry whose reconstructed L/D and CD are already in [136].
  - Apollo entries through NASA TN D-6725, which includes the Apollo 10 post-flight entry analysis [207].
  - The Artemis I best estimated trajectory work [208], which shows how NASA built the flown entry reference.

### Oracles for entry

- **Tudat (BSD-3; conda environment, needs approval; M).**
  - Use `us76` below 86 km and the custom density function to feed MET densities above, so that the comparison isolates lift and guidance [111].
  - Use constant CL and CD to match `entry.js`, and replay the bank history from `entry.js` through `aerodynamic_angle_based` [113]. Check the sign convention: in the orrery, +90° means left, towards r × v.
  - Stop the comparison at drogue deploy, using exact termination [110].
  - Write our own script; the examples repo has no licence [112].
- **SciPy `solve_ivp`** for event timing [124], and **RocketPy** for descent under canopy [70].
- **6-DOF entry in `sixdof.js`: L or more, not now.** Public data give the pitching moment only as plots, with no damping derivatives. The thruster force on record is a 2007 design value of 160 lbf [193].

## 4. Rocketry cross-checks, step by step

### Step 0: prepare `ascent()` (no installs)

1. **Cd(Mach) (S).**
   - Accept a number, a function, or `{off, on}` tables in RocketPy's shape [63].
   - Compute Mach from the temperature `standardAtmosphere` returns [55]. The exponential default has no temperature.
   - Keep the constant default so that the Curtis Example 13.2, 13.3 and 13.7 tests still pass [55].
   - Launcher tables must reach about Mach 8 [71].
   - Record which trajectory each table came from, since a Cd taken from one simulation also depends on Reynolds number [64].
2. **`.eng` thrust curves (M).**
   - Write our own parser; T(t) replaces the constant thrust.
   - Do not commit curve files while ThrustCurve's terms are unknown [45].
   - Fetching curves from a browser is unproven, because CORS is undocumented [46]. Users may need to supply the files.
3. **Sounding mode (S).**
   - Add a rail length and inclination, skip the pitchover, and stop at apogee.
   - Name the outputs as RocketPy does (apogee, apogee time, maximum speed, maximum Mach, maximum dynamic pressure and its time, rail-exit speed) [65].

### Step 1: OpenRocket (installed; nothing new needed)

1. Design an independent test vehicle in the 24.12 GUI. Do not use a team design.
2. Run it headless through JPype [40], with simulation listeners for an atmosphere profile, a drag scale and a stop at apogee [62].
3. Pin the conditions:
   - a flat or spherical geodetic mode;
   - no wind;
   - standard sea-level conditions, or matching pad settings;
   - a vertical rail.
4. Export:
   - Cd against Mach, from a Component Analysis sweep [56] or from the simulation's Cd and Mach columns;
   - the thrust and mass histories;
   - q = ½ρv², from the density and total-velocity columns [39].
5. Commit only numbers, for example `src/physics/fixtures/openrocket_*.json`, with the OpenRocket version and the jar's SHA-256.
6. In `rocket.test.mjs`, feed the same Cd(Mach), curve and mass to `ascent()`.
   - Start with tolerances of 0.5 % on apogee and maximum speed, and 1 % on max-q.
   - Adjust them once measured. They are extrapolated from the 0.02 % point-mass closure [43].
7. Use power-off Cd in both phases, because OpenRocket gives no power-on credit [58].

### Step 2: RocketPy (needs `pip install rocketpy` in a separate venv; approval)

1. Use version 1.12 or later in 3-DOF mode (`PointMassRocket`, `PointMassMotor`) [64, 66].
2. Set inclination to 90°, since the default is 80° [65]. Use the same `.eng` file and drag CSV.
3. Dump the orrery's ascent to CSV and score it with `FlightComparator` [67].
4. Weight agreement here below OpenRocket's, because the 3-DOF mode is young [66].
5. RocketPy takes drag as an input [63], so it cannot supply an independent, geometry-derived drag curve.

### Step 3: ThrustCurve.org (downloads need approval)

- Use the JSON endpoints within the rate and caching rules, and do not hotlink files [45]. The ISC client is fine for the app [46].
- Keep any downloaded curves local until their terms are known.

### Step 4: RASAero II (needs a Windows machine and approval to install)

1. Export the test vehicle to `.CDX1` with OpenRocket 24.12's RASAero exporter [38].
2. In RASAero, set the nozzle exit diameter. Export the power-off and power-on aero tables (Mach 0.01 to 25) and the flight-simulation CSV [42].
3. Rescale Cd to the orrery's reference diameter, as an earlier OpenRocket and RASAero comparison did [43].
4. Use the power-off table to check Cd(Mach). Use the power-on table to calibrate a base-drag-under-thrust term, starting from OpenRocket's documented formula [57].
5. Keep the tables local, since the terms are unstated [42].

The value for launchers is modest. In Curtis Example 13.3 the drag loss is 298 m/s against a gravity loss of 1,410 m/s [55], so a base-drag correction moves orbit insertion by a small fraction of the total. It matters more for high-power rockets, where it caused the largest code-to-code gap [43].

### Step 5: launcher scale

- **OpenTsiolkovsky (M-L).** Use the hosted web app or a Rust build (approval) [47].
  - Convert Isp(p) to its exit-area form: A_e = ṁ·g0·(Isp_vac − Isp_sl)/p0 (derived; both models are linear in p).
  - Turn wind off. Reconcile its time-tabulated attitude, which runs on stage-relative times, with the orrery's gravity turn.
  - Compare max-q (value and time), burnout altitude, speed and flight-path angle, and the gravity and drag losses.
  - The example vehicles' data have no documented source [71].
- **Delta III benchmark** through YAPSS (MIT, pip install) [76]. It uses the same model class as `ascent()`.
- **Dymos SSTO example** (Apache-2.0, already in the catalogue) [209], as an optimal-ascent reference.
- **PEGAS** (MIT) [77], as a reference if closed-loop insertion guidance is added.
- **NESC Case 17: L or more; the download needs approval.**
  - `sixdof.js` has constant mass and inertia, drag from a ballistic coefficient only, and no staging or aero tables. These must be added first.
  - Convert the DAVE-ML models once. NASA DAVEtools (NOSA 1.3) can be used as an outside converter only [210].

### Skip

- orhelper [53].
- RocketSerializer, unless a single-stage `.ork` to RocketPy route is needed [52].
- Porting RocketPy's parachute model, which is a few lines [70].
- A Barrowman build-up from geometry (L), unless amateur-rocket design comes into scope [51].

## 5. Julia and JuliaHub

**Verdict: not now. Nothing to merge into the app.**

- **No runtime role.** Julia cannot run the kernel in the browser: no adaptive solver or route for the force models compiles to Wasm [13].
- **JuliaHub is optional.** Julia and the open packages run locally [2]. No current compute price is published [17]. Using JuliaHub would mean an account, which is the owner's action. At most it is a place to run offline scripts.
- **Dyad, Multibody.jl and full ModelingToolkit stay out of the repo** [4, 5, 6]. If acausal modelling is ever wanted for an oracle, use ModelingToolkitBase (MIT) only [7].
- **Python covers the next work with less setup.** SciPy events and DOP853, SpiceyPy (already in `python/`), Orekit through the installed Java, and Tudat for entry. These avoid a third toolchain next to C and Python.

**When Julia would pay**

- **Derivatives through the solver.** ForwardDiff would give exact state-transition matrices and burn Jacobians [9]. Today Newton convergence can be watched directly in JS, so the value is low.
- **Very large Monte Carlo runs.** `EnsembleProblem` would handle them [28]. The JS worker can already run thousands of 3-DOF entries, and footprints drawn in the app should come from the app's own model.
- **Taylor-method or time-scale checks.** TaylorIntegration.jl [12] or AstroTime.jl [35] could check the leap-second clock bug.
- **Not for extended precision.** Float64 at a tolerance of 1e-14 is far below the kernel's 1e-7 km per step, and the DE442 data are Float64 anyway.

**If Julia is adopted later**

- Add a `julia/` folder beside `c/` and `python/`, with MIT dependencies only.
- Commit `Manifest.toml` and write the package versions into each fixture.
- A propagation oracle that really separates integrator error from force-model error must copy the JS force model exactly: the GM set, EGM2008 normalisation and tide system, SRP shadows, relativity, and MET drag (which Julia lacks [31]). That makes it L, not M.
- Use DiffEqDevTools (MIT) to prove the order of any ported tableau [36].
- Installs need approval: juliaup, the packages, and ICGEM gravity files.

## 6. Catalogue rows

### Rows to correct

- **ModelingToolkit.jl / SciML.** The "MIT" licence is incomplete. Full MTK v11 depends on AGPL-3.0 packages, and only ModelingToolkitBase is MIT throughout [6, 7].
- **Tudat / tudatpy.** The tudat C++ repo was archived on 14 Jan 2026; the source is now in tudatpy [74].
- **OpenRocket.** 24.12 (27 Jul 2025) is still the latest release as of 14 Nov 2026 [56].
- **RASAero II.** The row says "Wine on Linux", but this machine has no Wine [43].
- **Orbiter.** Add the Technical Reference `dynamics.tex` link [141] and the digital-orrery tag.
- **The practice-guides index is stale.** Run `eng catalog --reindex` [127].

### Rows to add

| Resource | URL | Kind | Licence | Purpose |
|---|---|---|---|---|
| OrdinaryDiffEq.jl / DifferentialEquations.jl | https://github.com/SciML/OrdinaryDiffEq.jl | library (Julia) | MIT | Verner, DP8, RKN and symplectic solvers with event callbacks; offline oracle |
| DiffEqDevTools | https://github.com/SciML/OrdinaryDiffEq.jl/tree/master/lib/DiffEqDevTools | library | MIT | convergence-order and work-precision tests |
| SciMLBenchmarks | https://docs.sciml.ai/SciMLBenchmarksOutput/stable/NonStiffODE/ThreeBody_wpd/ | benchmark docs | MIT | published integrator comparisons (cheap right-hand side) |
| IRKGaussLegendre.jl | https://github.com/SciML/IRKGaussLegendre.jl | library | MIT | 16th-order implicit Gauss-Legendre reference |
| GeometricIntegrators.jl | https://github.com/JuliaGNI/GeometricIntegrators.jl | library | MIT | geometric integrators; reference for `sixdof.js` |
| ModelingToolkitBase.jl | https://sciml.ai/news/2026/07/27/ModelingToolkitv11/index.html | library | MIT | the MIT-only part of MTK v11 |
| SatelliteToolbox.jl family | https://github.com/JuliaSpace/SatelliteToolbox.jl | library | MIT | independent gravity, atmosphere, SGP4 and frames |
| SpaceIndices.jl | https://github.com/JuliaSpace/SpaceIndices.jl | library | MIT | CelesTrak and JB2008 index fetcher |
| Ephemerides.jl | https://github.com/JuliaSpaceMissionDesign/Ephemerides.jl | library | MIT | pure-Julia SPK/PCK reader |
| SPICE.jl | https://github.com/JuliaAstro/SPICE.jl | library | MIT (CSPICE under NAIF terms) | CSPICE wrapper |
| TaylorIntegration.jl (with PlanetaryEphemeris.jl, NEOs.jl) | https://github.com/PerezHz/TaylorIntegration.jl | library | MIT | high-precision Taylor oracle |
| AstroTime.jl | https://github.com/JuliaAstro/AstroTime.jl | library | MIT | time-scale oracle (TT, TDB, UTC, leap seconds) |
| WasmTarget.jl | https://github.com/GroupTherapyOrg/WasmTarget.jl | compiler | Apache-2.0 | Julia to Wasm; watch only |
| JuliaHub | https://help.juliahub.com/juliahub/stable/ | service | commercial | hosted Julia compute; not needed |
| Dyad (formerly JuliaSim) | https://juliahub.com/pricing/dyad | app | proprietary, source-available; free tier non-commercial | ruled out for the repo |
| Multibody.jl | https://github.com/JuliaComputing/Multibody.jl | library | proprietary JuliaHub EULA; archived | ruled out |
| EntryGuidance.jl (CPEG paper) | https://github.com/RoboticExplorationLab/EntryGuidance.jl | paper and code | code has no licence | read the paper only |
| Modelica Standard Library | https://github.com/modelica/ModelicaStandardLibrary | library | BSD-3-Clause | MIT-compatible multibody reference |
| heyoka / heyoka.py | https://github.com/bluescarni/heyoka | library | MPL-2.0 | Taylor oracle in Python; outputs only |
| OpenTsiolkovsky | https://github.com/istellartech/OpenTsiolkovsky | app (Rust) | MIT | orbital-launcher ascent oracle, example vehicles |
| MAPLEAF | https://github.com/henrystoldt/MAPLEAF | library (Python) | MIT | 6-DOF rocket oracle |
| RocketSerializer | https://github.com/RocketPy-Team/RocketSerializer | tool | MIT | `.ork` to RocketPy, one stage |
| orhelper | https://github.com/SilentSys/orhelper | tool | GPL-2.0 | not usable with OpenRocket 24.12 |
| CamPyRoS | https://github.com/cuspaceflight/CamPyRoS | library | GPL-3.0 | oracle only; has an aero-heating model |
| @thrustcurve/api1 | https://unpkg.com/@thrustcurve/api1@1.0.3/package.json | library (TS) | ISC | ThrustCurve API client |
| Barrowman 1967 thesis | https://ntrs.nasa.gov/citations/20010047838 | paper | US Government work | fin and body aerodynamics method |
| OpenRocket technical documentation v13.05 | https://dept.aem.umn.edu/~./faculty/flaten/Rocketry_Remote_Lessons_Fall_2021/OpenRocketTechnicalDocumentationVersion13_05.pdf | docs | share-alike (unnamed) | model equations; Earth and wind sections are outdated |
| NESC Atmospheric Case 17 | https://nescacademy.nasa.gov/flightsim/2015/atmospheric/acc17 | data | public domain | staged-ascent reference |
| YAPSS (Delta III ascent) | https://github.com/stevenrhall/yapss | library | MIT | multi-stage ascent benchmark |
| PEGAS | https://github.com/Noiredd/PEGAS | code | MIT | UPFG closed-loop guidance reference |
| NASA DAVEtools | https://github.com/nasa/DAVEtools | tool (Java) | NOSA 1.3 | DAVE-ML reader; outside converter only |
| Hipparchus | https://github.com/Hipparchus-Math/hipparchus | library (Java) | Apache-2.0 | DOP853 and Bulirsch-Stoer reference code |
| orekit-jpype | https://pypi.org/project/orekit-jpype/ | library | Apache-2.0 | Orekit from Python |
| THALASSA | https://gitlab.com/souvlaki/thalassa | app (Fortran) | MIT | regularised propagation |
| CNES PATRIUS | https://patrius.cnes.fr | library (Java) | Apache-2.0 | second Java flight-dynamics oracle |
| JPL MONTE | https://montepy.jpl.nasa.gov | app | Caltech proprietary | ruled out |
| NASA JEOD | https://github.com/nasa/jeod | library | NOSA 1.3 | ruled out (needs Trick) |
| NASA POST2 | https://software.nasa.gov/software/LAR-20550-1 | app | US release only | ruled out |
| GMAT.jl | https://docs.juliahub.com/General/GMAT/stable/autodocs/ | wrapper | MIT; dormant since 2020 | ruled out |
| NAIF SPICE Geometry Finder | https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/gf.html | docs | NAIF | event-time fixtures from SPKs |
| Berry & Healy 2004 (Gauss-Jackson) | https://drum.lib.umd.edu/handle/1903/2202 | paper | posted with AAS permission | GJ8 implementation |
| Atallah et al. 2019 | https://mae.ucf.edu/ASRL/wp-content/uploads/2020/07/Atallah2019_Article_AccuracyAndEfficiencyCompariso.pdf | paper | AAS copyright; cite only | integrator comparison and precision tests |
| Amato et al. 2019 | https://export.arxiv.org/abs/1810.11418 | paper | arXiv licence | regularised against semi-analytical methods |
| Biscani & Izzo 2021 and 2022 | https://arxiv.org/abs/2105.00800 | papers | CC BY 4.0 | Taylor integration; guaranteed event detection |
| Fehlberg, NASA TR R-287 | https://ntrs.nasa.gov/citations/19680027281 | report | US Government work | RKF7(8) coefficients |
| NASA GRAM Suite (Earth-GRAM) | https://software.nasa.gov/software/MFS-33888-1 | app (C++) | NASA General Public Release | density and wind dispersions |
| AMAT | https://github.com/athulpg007/AMAT | library | GPL-3.0 | oracle only; 3-DOF entry |
| Open-Meteo Historical Forecast API | https://open-meteo.com/en/docs/historical-forecast-api | data API | data CC BY 4.0; free tier non-commercial; server AGPLv3+ | splashdown winds up to 30 hPa |
| ERA5 pressure levels | https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels | data | CC-BY; account needed | atmosphere on the day, to 1 hPa |
| Apollo Comanche055 REENTRY_CONTROL | https://ibiblio.org/apollo/listings/Comanche055/REENTRY_CONTROL.agc.html | code | public domain | Apollo entry guidance source |
| Morth, Reentry Guidance for Apollo (R-532) | https://www.ibiblio.org/apollo/Documents/R-532_Vol1_Reentry_Guidance_for_Apollo.pdf | report | not checked | derivation of Apollo entry guidance |
| Graves & Harpold, NASA TN D-6725 | https://ntrs.nasa.gov/archive/nasa/casi.ntrs.nasa.gov/19720013191.pdf | report | US Government work | Apollo entry planning and validation |
| Orion entry papers (AAS 24-174, Rea & Putnam 2007, Bibb 2011, IPPW 2026, Daum 2026, Bihari 2024, Ray 2017, AAS 24-171, AAS 23-330) | https://ntrs.nasa.gov/api/citations/20240001314/downloads/AAS_24_174_Orion_Artemis_I_Entry_Performance.pptx | papers | NASA NTRS, public | Orion aero, guidance, parachutes, flown data |
| Mendeck & Craig, MSL entry guidance | https://ntrs.nasa.gov/api/citations/20110013204/downloads/20110013204.pdf | paper | NASA NTRS | final-phase equations |
| Lu et al. 2017, FNPEG for Orion (cited in AAS 26-602) | https://ntrs.nasa.gov/api/citations/20260006141/downloads/AAS%2026-602%20Apollo%20vs%20FNPEG%20Comparison%20Poster%20LARGE.pdf | paper | AIAA copyright; cite only | FNPEG against PredGuid |
| Sutton & Graves, NASA TR R-376 | https://ntrs.nasa.gov/citations/19720003329 | report | US Government work | stagnation-point heating |
| JuMP shuttle-reentry tutorial | https://jump.dev/JuMP.jl/stable/tutorials/nonlinear/space_shuttle_reentry_trajectory/ | tutorial | MPL-2.0 | Betts benchmark |
| tudatpy re-entry example | https://github.com/tudat-team/tudatpy-examples/blob/master/propagation/reentry_trajectory.py | example | no licence | learn from it; do not copy |
| Fiedler, Fix Your Timestep | https://gafferongames.com/post/fix_your_timestep/ | article | read only | fixed-step decoupling |
| Ohlarik, Precisions, Precisions | https://help.agi.com/STKComponents/html/BlogPrecisionsPrecisions.htm | article | read only | GPU relative-to-eye |
| Godot large world coordinates | https://docs.godotengine.org/en/stable/tutorials/physics/large_world_coordinates.html | docs | CC BY 3.0 | float precision at scale |
| Reed, Visualizing Depth Precision | https://developer.nvidia.com/blog/visualizing-depth-precision/ | article | read only | reversed-Z |
| three.js reversed-depth example | https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_reversed_depth_buffer.html | example | MIT | reversed-Z set-up |
| WebGL EXT_clip_control | https://registry.khronos.org/webgl/extensions/EXT_clip_control | spec | Khronos | reversed-Z in WebGL |
| WGSL specification | https://www.w3.org/TR/WGSL/ | spec | W3C | GPU float types (no f64) |
| webgpu-samples | https://github.com/webgpu/webgpu-samples | code | BSD-3-Clause | compute, reversed-Z and worker samples |
| Emscripten | https://emscripten.org/docs/porting/pthreads.html | toolchain | MIT/NCSA | Wasm with SIMD and threads |
| wasm-bindgen-rayon | https://docs.rs/crate/wasm-bindgen-rayon/latest | library | Apache-2.0 | Rust threads in the browser |
| AssemblyScript | https://github.com/AssemblyScript/assemblyscript | compiler | Apache-2.0 | TypeScript-like route to Wasm |
| Spector.js | https://github.com/BabylonJS/Spector.js | tool | MIT | WebGL frame capture for profiling |
| NAIF SPK Required Reading | https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html | docs | NAIF | Hermite (type 13) node scheme |
| GPU Gems 3, ch. 31 | https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda | book chapter | read only | GPU n-body |
| Jangda et al. 2019 | https://usenix.org/conference/atc19/presentation/jangda | paper | cite only | Wasm against native speed |
| MDN SharedArrayBuffer (cross-origin isolation) | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer | docs | CC BY-SA 2.5+ | COOP/COEP requirements |
| OpenSpace time API | https://docs.openspaceproject.com/latest/reference/scripting-api/openspace.time.html | docs | MIT | ramped warp changes |
| Universe Sandbox physics posts | https://universesandbox.com/blog/?p=1068 | article | proprietary game | warp and accuracy precedent |

## Unverified

These claims were not confirmed by the checker. They are not used as facts above.

**Entry data**

- The Artemis I entry state in AAS 24-174 Table 1. Only the 400,000 ft altitude and a latitude near −25.83° are supported; the velocity, flight-path angle, azimuth and longitude are not. The PDF is over the fetch limit [211].
- Bibb 2011's hypersonic CD of about 1.33 to 1.40 and CL of about 0.40 to 0.35 near trim [195].
- Ray 2017's drogue drag areas (about 112, 158 and 250 ft² per canopy) and main reefing ratios (about 3.5 % and 16 %), which would be read from figures [201].
- The AIAA paper number "2007-6424" for Rea & Putnam [193].
- The in-plane open-loop reference run detail in Mendeck & Craig [129].
- Splashdown coordinates for either mission (none found); the Artemis I and II CM entry masses; Artemis I's flown peak g and heating.
- Whether an Artemis I CM raise burn falls after the end of the OEM.
- The full-open main drag area per canopy (back-calculated only).

**Rocketry**

- Whether OpenRocket 24.12's RASAero exporter writes multi-stage stacks.
- Whether RocketPy interpolates drag linearly by default.
- MAPLEAF's University of Calgary affiliation.
- The provenance of OpenTsiolkovsky's example tables.
- ThrustCurve's data terms and its CORS behaviour.
- RASAero's terms for publishing exported tables.
- The contents of the Saturn V AS-506 flight evaluation report (over 10 MB, not read).
- A tudatpy-examples issue reporting that the two-stage example fails (found by search, not read).
- The data rights of webcast-derived Falcon telemetry (shahar603/Telemetry-Data).

**Julia and astrodynamics**

- Whether Verner's website restricted redistribution of the coefficient files. Indexed text suggested it did, but the site returns 404 [37].
- JuliaHub's current compute terms [18, 17].
- Whether SatelliteToolboxGravityModels handles lunar ICGEM files (GM, radius, normalisation).
- Whether SatelliteToolboxGravityModels and Ephemerides.jl accept BigFloat, and whether Vern9 runs with Double64.
- Whether GMAT R2026a has been released. The checker saw signs of an April 2026 announcement but recorded no URL.
- Whether DE442 is published as a JPL binary file that Orekit's loader can read.
- Whether boinor keeps poliastro's event classes.
- The details of Orekit's propagate-ahead ephemeris generation (its pages were blocked).

**Real-time**

- The full text of Axelsson et al. 2017 (float depth buffers, interval arithmetic). Only its listing on OpenSpace's academic page is confirmed [212].
- web.dev's CC BY 4.0 licence.
- Whether WebGPU is on by default on this machine's GPU.

## 7. References

Local files are given as repo-relative paths or as `~/` paths on the author's machine. Entries are numbered in order of first citation; where a source is a software repository, documentation page or web page, it is given as a URL with no authors.

[1] GPL FAQ. [Online]. Available: https://www.gnu.org/licenses/gpl-faq.html#GPLOutput ; https://www.gnu.org/licenses/gpl-faq.html#WhatCaseIsOutputGPL

[2] JuliaHub help. [Online]. Available: https://help.juliahub.com/juliahub/stable/

[3] Dyad launch post. [Online]. Available: https://juliahub.com/blog/juliahub-launches-dyad

[4] Dyad pricing. [Online]. Available: https://juliahub.com/pricing/dyad ; product page: https://juliahub.com/products/juliasim

[5] Multibody.jl licence. [Online]. Available: https://raw.githubusercontent.com/JuliaComputing/Multibody.jl/main/LICENSE ; repo: https://github.com/JuliaComputing/Multibody.jl

[6] ModelingToolkit v11 post. [Online]. Available: https://sciml.ai/news/2026/07/27/ModelingToolkitv11/index.html

[7] StateSelection.jl. [Online]. Available: https://github.com/JuliaComputing/StateSelection.jl

[8] OrdinaryDiffEq.jl. [Online]. Available: https://github.com/SciML/OrdinaryDiffEq.jl

[9] SciMLSensitivity. [Online]. Available: https://docs.sciml.ai/SciMLSensitivity/stable/

[10] SatelliteToolbox.jl. [Online]. Available: https://github.com/JuliaSpace/SatelliteToolbox.jl

[11] Ephemerides.jl. [Online]. Available: https://github.com/JuliaSpaceMissionDesign/Ephemerides.jl ; SPICE.jl: https://github.com/JuliaAstro/SPICE.jl

[12] TaylorIntegration.jl. [Online]. Available: https://github.com/PerezHz/TaylorIntegration.jl ; https://perezhz.github.io/TaylorIntegration.jl/stable/kepler/ ; https://github.com/PerezHz/PlanetaryEphemeris.jl ; https://github.com/PerezHz/NEOs.jl

[13] WasmTarget.jl. [Online]. Available: https://github.com/GroupTherapyOrg/WasmTarget.jl

[14] WebAssemblyCompiler.jl. [Online]. Available: https://tshort.github.io/WebAssemblyCompiler.jl/stable ; Julia 1.12 highlights: https://julialang.org/blog/2025/10/julia-1.12-highlights/

[15] MTK v11 licensing thread. [Online]. Available: https://discourse.julialang.org/t/modelingtoolkit-v11-library-split-and-licensing-community-feedback-requested/134396

[16] Julia THIRDPARTY.md. [Online]. Available: https://github.com/JuliaLang/julia/blob/master/THIRDPARTY.md

[17] JuliaHub pricing. [Online]. Available: https://juliahub.com/pricing

[18] JuliaHub standard tier post (May 2023). [Online]. Available: https://juliahub.com/blog/standard-tier-free-to-start

[19] ODE solver guide. [Online]. Available: https://docs.sciml.ai/DiffEqDocs/stable/solvers/ode_solve/

[20] Three-body benchmark. [Online]. Available: https://docs.sciml.ai/SciMLBenchmarksOutput/stable/NonStiffODE/ThreeBody_wpd/

[21] Pleiades benchmark. [Online]. Available: https://docs.sciml.ai/SciMLBenchmarksOutput/stable/NonStiffODE/Pleiades_wpd/

[22] Dynamical ODE solvers. [Online]. Available: https://docs.sciml.ai/DiffEqDocs/stable/solvers/dynamical_solve/

[23] Kepler example. [Online]. Available: https://docs.sciml.ai/DiffEqDocs/dev/examples/kepler_problem/

[24] Hénon-Heiles benchmark. [Online]. Available: https://docs.sciml.ai/SciMLBenchmarksOutput/stable/DynamicalODE/Henon-Heiles_energy_conservation_benchmark/

[25] SciMLBase callbacks. [Online]. Available: https://github.com/SciML/SciMLBase.jl/blob/master/src/callbacks.jl

[26] Number types showcase. [Online]. Available: https://docs.sciml.ai/Overview/dev/showcase/ode_types/

[27] Rackauckas & Nie 2017, JORS. [Online]. Available: https://openresearchsoftware.metajnl.com/articles/10.5334/jors.151

[28] Ensembles. [Online]. Available: https://docs.sciml.ai/DiffEqDocs/stable/features/ensemble/

[29] SatelliteToolboxGravityModels. [Online]. Available: https://juliaspace.github.io/SatelliteToolboxGravityModels.jl/stable/ ; https://github.com/JuliaSpace/SatelliteToolboxGravityModels.jl

[30] ICGEM celestial models. [Online]. Available: https://icgem.gfz.de/tom_celestial

[31] SatelliteToolboxAtmosphericModels. [Online]. Available: https://juliaspace.github.io/SatelliteToolboxAtmosphericModels.jl/stable/ ; SpaceIndices.jl: https://github.com/JuliaSpace/SpaceIndices.jl

[32] Astrodynamics.jl. [Online]. Available: https://github.com/helgee/Astrodynamics.jl ; AstroForceModels.jl: https://github.com/HAMMERHEAD-Space/AstroForceModels.jl

[33] EntryGuidance.jl. [Online]. Available: https://github.com/RoboticExplorationLab/EntryGuidance.jl

[34] Eichhorn et al. 2016, ESA. [Online]. Available: https://indico.esa.int/event/111/contributions/266/attachments/348/389/paper.pdf

[35] AstroTime.jl. [Online]. Available: https://github.com/JuliaAstro/AstroTime.jl

[36] DiffEqDevTools. [Online]. Available: https://github.com/SciML/OrdinaryDiffEq.jl/tree/master/lib/DiffEqDevTools

[37] verner_tableaus.jl. [Online]. Available: https://github.com/SciML/OrdinaryDiffEq.jl/blob/master/lib/OrdinaryDiffEqVerner/src/verner_tableaus.jl

[38] OpenRocket repo. [Online]. Available: https://github.com/openrocket/openrocket

[39] OpenRocket 24.12, installed locally.

[40] the author's local JPype runner (not public).

[41] RASAero home. [Online]. Available: https://www.rasaero.com/home.htm

[42] RASAero II download. [Online]. Available: https://www.rasaero.com/dl_software_ii.htm

[43] OpenRocket vs RASAero comparison: the author's earlier comparison notes (local, not public).

[44] RocketPy on PyPI. [Online]. Available: https://pypi.org/project/rocketpy/

[45] ThrustCurve llms.txt. [Online]. Available: https://www.thrustcurve.org/llms.txt

[46] @thrustcurve/api1. [Online]. Available: https://unpkg.com/@thrustcurve/api1@1.0.3/package.json ; https://unpkg.com/@thrustcurve/api1@1.0.3/README.md

[47] OpenTsiolkovsky physics. [Online]. Available: https://raw.githubusercontent.com/istellartech/OpenTsiolkovsky/master/docs/physics.md ; app: https://open-tsiolkovsky.vercel.app/

[48] MAPLEAF. [Online]. Available: https://github.com/henrystoldt/MAPLEAF

[49] NESC flight-sim 2015. [Online]. Available: https://nescacademy.nasa.gov/flightsim/2015

[50] NESC Atmospheric Case 17. [Online]. Available: https://nescacademy.nasa.gov/flightsim/2015/atmospheric/acc17

[51] Barrowman 1967. [Online]. Available: https://ntrs.nasa.gov/citations/20010047838

[52] RocketSerializer. [Online]. Available: https://github.com/RocketPy-Team/RocketSerializer

[53] orhelper. [Online]. Available: https://github.com/SilentSys/orhelper ; https://raw.githubusercontent.com/SilentSys/orhelper/master/orhelper/_orhelper.py

[54] CamPyRoS. [Online]. Available: https://github.com/cuspaceflight/CamPyRoS

[55] `src/physics/rocket.js`, `src/physics/rocket.test.mjs`, `src/physics/atmosphere.js` (repo).

[56] OpenRocket releases. [Online]. Available: https://github.com/openrocket/openrocket/releases ; https://api.github.com/repos/openrocket/openrocket/releases?per_page=4

[57] OpenRocket technical documentation v13.05 (UMN mirror). [Online]. Available: https://dept.aem.umn.edu/~./faculty/flaten/Rocketry_Remote_Lessons_Fall_2021/OpenRocketTechnicalDocumentationVersion13_05.pdf

[58] BarrowmanCalculator.java. [Online]. Available: https://raw.githubusercontent.com/openrocket/openrocket/master/core/src/main/java/info/openrocket/core/aerodynamics/BarrowmanCalculator.java

[59] OpenRocket features. [Online]. Available: https://openrocket.readthedocs.io/en/latest/introduction/features.html

[60] the author's local `.ork` design files (not public).

[61] Simulation extensions. [Online]. Available: https://wiki.openrocket.info/Simulation_Extensions

[62] the author's local JPype runner (not public).

[63] RocketPy Rocket. [Online]. Available: https://docs.rocketpy.org/en/latest/reference/classes/Rocket.html

[64] RocketPy releases. [Online]. Available: https://github.com/RocketPy-Team/RocketPy/releases

[65] RocketPy Flight. [Online]. Available: https://docs.rocketpy.org/en/latest/reference/classes/Flight.html

[66] RocketPy PR 745. [Online]. Available: https://github.com/RocketPy-Team/RocketPy/pull/745

[67] RocketPy PR 888. [Online]. Available: https://github.com/RocketPy-Team/RocketPy/pull/888

[68] RocketPy equations of motion. [Online]. Available: https://docs.rocketpy.org/en/latest/technical/equations_of_motion.html

[69] RocketPy Environment. [Online]. Available: https://docs.rocketpy.org/en/latest/reference/classes/Environment.html

[70] RocketPy Parachute. [Online]. Available: https://docs.rocketpy.org/en/latest/reference/classes/Parachute.html

[71] OpenTsiolkovsky Saturn V example. [Online]. Available: https://raw.githubusercontent.com/istellartech/OpenTsiolkovsky/master/examples/saturn-v.json

[72] NESC Bodies. [Online]. Available: https://nescacademy.nasa.gov/flightsim/2015/bodies

[73] `pipelines/nesc.fetch.mjs`, `src/physics/nesc.test.mjs` (repo).

[74] tudat (archived). [Online]. Available: https://github.com/tudat-team/tudat

[75] tudatpy two-stage ascent example. [Online]. Available: https://github.com/tudat-team/tudatpy-examples/blob/master/propagation/two_stage_rocket_ascent.py

[76] YAPSS Delta III. [Online]. Available: https://yapss.readthedocs.io/en/stable/notebooks/delta_iii_ascent.html ; https://github.com/stevenrhall/yapss

[77] PEGAS. [Online]. Available: https://github.com/Noiredd/PEGAS

[78] `docs/physics/nbody-kernel.md` (repo).

[79] `src/physics/encke.js` (repo).

[80] `src/physics/nbody.js` (repo).

[81] `docs/physics/environment.md` (repo).

[82] GMAT. [Online]. Available: https://github.com/nasa/GMAT

[83] Orekit overview. [Online]. Available: https://raw.githubusercontent.com/CS-SI/Orekit/develop/src/site/markdown/index.md

[84] Hipparchus non-stiff. [Online]. Available: https://github.com/Hipparchus-Math/hipparchus/tree/master/hipparchus-ode/src/main/java/org/hipparchus/ode/nonstiff

[85] tudatpy. [Online]. Available: https://github.com/tudat-team/tudatpy

[86] Basilisk. [Online]. Available: https://hanspeterschaub.info/basilisk/

[87] poliastro events. [Online]. Available: https://docs.poliastro.space/en/stable/examples/Detecting%20Events.html ; https://docs.poliastro.space/en/stable/autoapi/poliastro/twobody/propagation/index.html ; https://github.com/poliastro/poliastro

[88] boinor. [Online]. Available: https://github.com/boinor/boinor ; hapsira: https://github.com/pleiszenburg/hapsira

[89] THALASSA. [Online]. Available: https://gitlab.com/souvlaki/thalassa ; https://ascl.net/1905.018

[90] Biscani & Izzo 2021. [Online]. Available: https://arxiv.org/abs/2105.00800 ; heyoka: https://github.com/bluescarni/heyoka

[91] CNES PATRIUS. [Online]. Available: https://patrius.cnes.fr

[92] NASA 42 slides. [Online]. Available: https://ntrs.nasa.gov/api/citations/20180000954/downloads/20180000954.pdf

[93] NASA 42 licence. [Online]. Available: https://github.com/ericstoneking/42/tree/master/License ; https://software.nasa.gov/software/GSC-16720-1

[94] Trick integrators. [Online]. Available: https://nasa.github.io/trick/documentation/simulation_capabilities/Integrator

[95] NASA JEOD. [Online]. Available: https://github.com/nasa/jeod

[96] JPL MONTE. [Online]. Available: https://montepy.jpl.nasa.gov/static/document/brochure.pdf ; https://montepy.jpl.nasa.gov

[97] NASA POST2. [Online]. Available: https://software.nasa.gov/software/LAR-20550-1

[98] GMAT.jl. [Online]. Available: https://docs.juliahub.com/General/GMAT/stable/autodocs/ ; https://github.com/JuliaSpace/GMAT.jl

[99] GMAT propagators. [Online]. Available: https://github.com/nasa/GMAT/tree/main/src/base/propagator

[100] DormandElMikkawyPrince68.hpp. [Online]. Available: https://raw.githubusercontent.com/nasa/GMAT/main/src/base/propagator/DormandElMikkawyPrince68.hpp

[101] PrinceDormand78.cpp. [Online]. Available: https://raw.githubusercontent.com/nasa/GMAT/main/src/base/propagator/PrinceDormand78.cpp

[102] RelativisticCorrection.cpp. [Online]. Available: https://raw.githubusercontent.com/nasa/GMAT/main/src/base/forcemodel/RelativisticCorrection.cpp

[103] GMAT solarsys. [Online]. Available: https://github.com/nasa/GMAT/tree/main/src/base/solarsys

[104] GMAT R2025a announcement. [Online]. Available: https://gmat.atlassian.net/wiki/spaces/GW/blog/2025/05/16/2962227204/Announcing+GMAT+R2025a+Release

[105] Hughes et al. 2014. [Online]. Available: https://ntrs.nasa.gov/citations/20140017798

[106] Orekit propagation. [Online]. Available: https://raw.githubusercontent.com/CS-SI/Orekit/develop/src/site/markdown/architecture/propagation.md

[107] orekit-jpype. [Online]. Available: https://pypi.org/project/orekit-jpype/

[108] DSST validation abstract. [Online]. Available: https://indico.esa.int/event/111/contributions/248

[109] Tudat integrator set-up. [Online]. Available: https://docs.tudat.space/en/latest/_src_user_guide/state_propagation/propagation_setup/integration_setup.html

[110] Tudat propagators. [Online]. Available: https://py.api.tudat.space/en/latest/propagator.html

[111] Tudat atmospheres. [Online]. Available: https://py.api.tudat.space/en/latest/atmosphere.html

[112] tudatpy re-entry example. [Online]. Available: https://raw.githubusercontent.com/tudat-team/tudatpy-examples/master/propagation/reentry_trajectory.py

[113] Tudat rotation models. [Online]. Available: https://py.api.tudat.space/en/latest/rotation_model.html

[114] Basilisk integrators. [Online]. Available: https://hanspeterschaub.info/basilisk/examples/scenarioIntegrators.html

[115] Basilisk drag de-orbit. [Online]. Available: https://hanspeterschaub.info/basilisk/examples/scenarioDragDeorbit.html

[116] Trick dynamic events. [Online]. Available: https://nasa.github.io/trick/tutorial/ATutDynamicEvents

[117] Atallah et al. 2019. [Online]. Available: https://mae.ucf.edu/ASRL/wp-content/uploads/2020/07/Atallah2019_Article_AccuracyAndEfficiencyCompariso.pdf

[118] Fehlberg, NASA TR R-287. [Online]. Available: https://ntrs.nasa.gov/citations/19680027281

[119] Berry & Healy 2004. [Online]. Available: https://drum.lib.umd.edu/handle/1903/2202

[120] Berry & Healy 2002. [Online]. Available: https://drum.lib.umd.edu/items/390b0d98-cb92-4bc6-87ce-2dff7904808c/full

[121] Berry & Healy 2005. [Online]. Available: https://drum.lib.umd.edu/items/4e0db7ea-63b5-43d7-b969-9ec8655bec14/full

[122] Amato et al. 2019. [Online]. Available: https://export.arxiv.org/abs/1810.11418

[123] Biscani & Izzo 2022. [Online]. Available: https://arxiv.org/abs/2204.09948

[124] SciPy solve_ivp. [Online]. Available: https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html

[125] NAIF Geometry Finder. [Online]. Available: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/gf.html

[126] `src/physics/entry.js`, `src/physics/environment.js`, `src/physics/craft.js` (repo, uncommitted).

[127] Engineering resource catalogue, through eng-tools `catalog_search`: the author's engineering resource catalogue (local).

[128] Comanche055 REENTRY_CONTROL.agc. [Online]. Available: https://ibiblio.org/apollo/listings/Comanche055/REENTRY_CONTROL.agc.html

[129] Mendeck & Craig, MSL entry guidance. [Online]. Available: https://ntrs.nasa.gov/api/citations/20110013204/downloads/20110013204.pdf

[130] Open-Meteo Historical Forecast API. [Online]. Available: https://open-meteo.com/en/docs/historical-forecast-api ; licence: https://open-meteo.com/en/licence

[131] ERA5 pressure levels. [Online]. Available: https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels

[132] NASA GRAM Suite. [Online]. Available: https://software.nasa.gov/software/MFS-33888-1

[133] AMAT. [Online]. Available: https://github.com/athulpg007/AMAT ; https://amat.readthedocs.io/en/master/examples/example-17-apollo-4-earth.html

[134] Dymos shuttle re-entry. [Online]. Available: https://openmdao.org/dymos/docs/latest/examples/reentry/reentry.html

[135] JuMP shuttle re-entry. [Online]. Available: https://jump.dev/JuMP.jl/stable/tutorials/nonlinear/space_shuttle_reentry_trajectory/ ; licence: https://github.com/jump-dev/JuMP.jl/blob/master/LICENSE.md

[136] Mazaheri, Bibb & Lessard, IPPW 2026. [Online]. Available: https://ntrs.nasa.gov/api/citations/20260004998/downloads/IPPW-2026-V5.pdf

[137] NESC flight-sim Vol I. [Online]. Available: https://ntrs.nasa.gov/citations/20150001263

[138] NESC flight-sim 2023. [Online]. Available: https://nescacademy.nasa.gov/flightsim/2023

[139] Repo and installed code: `src/physics/kernelClient.js`, `src/physics/kernelHost.js`, `src/physics/craft.js`, `src/physics/geopotential.js`, `src/app/clock.ts`, `src/scene/OrreryScene.ts`, `node_modules/three/src/renderers/webgl/WebGLCapabilities.js`, `node_modules/three/src/renderers/webgl-fallback/WebGLBackend.js`.

[140] Fiedler, Fix Your Timestep. [Online]. Available: https://gafferongames.com/post/fix_your_timestep/

[141] Orbiter Technical Reference, dynamics. [Online]. Available: https://raw.githubusercontent.com/orbitersim/orbiter/main/Doc/Orbiter%20Technical%20Reference/dynamics.tex

[142] Orbiter linear propagation. [Online]. Available: https://raw.githubusercontent.com/orbitersim/orbiter/main/Html/Main/extra_linprop.htm

[143] Orbiter orbit stabilisation. [Online]. Available: https://raw.githubusercontent.com/orbitersim/orbiter/main/Html/Main/extra_orbitstab.htm

[144] Universe Sandbox, Alpha 13. [Online]. Available: https://universesandbox.com/blog/?p=1068

[145] Universe Sandbox, n-body post. [Online]. Available: https://universesandbox.com/blog/?p=1704

[146] Principia concepts. [Online]. Available: https://github.com/mockingbirdnest/Principia/wiki/Concepts

[147] OpenSpace time API. [Online]. Available: https://docs.openspaceproject.com/latest/reference/scripting-api/openspace.time.html

[148] MDN requestAnimationFrame. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

[149] Chrome 88 timer throttling. [Online]. Available: https://developer.chrome.com/blog/timer-throttling-in-chrome-88

[150] Ohlarik, Precisions, Precisions. [Online]. Available: https://help.agi.com/STKComponents/html/BlogPrecisionsPrecisions.htm

[151] Godot large world coordinates. [Online]. Available: https://docs.godotengine.org/en/stable/tutorials/physics/large_world_coordinates.html

[152] Celestia univcoord.h. [Online]. Available: https://raw.githubusercontent.com/CelestiaProject/Celestia/master/src/celengine/univcoord.h

[153] Celestia render.cpp. [Online]. Available: https://raw.githubusercontent.com/CelestiaProject/Celestia/master/src/celengine/render.cpp

[154] Reed, Visualizing Depth Precision. [Online]. Available: https://developer.nvidia.com/blog/visualizing-depth-precision/

[155] Outerra, log depth. [Online]. Available: https://outerra.blogspot.com/2013/07/logarithmic-depth-buffer-optimizations.html

[156] three.js forum, log depth cost. [Online]. Available: https://discourse.threejs.org/t/beware-of-logarithmic-depth-buffer-it-can-degrade-scene-performance/88495

[157] three.js reversed-depth example. [Online]. Available: https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_reversed_depth_buffer.html

[158] EXT_clip_control support. [Online]. Available: https://web3dsurvey.com/webgl/extensions/EXT_clip_control ; https://registry.khronos.org/webgl/extensions/EXT_clip_control

[159] Firefox bug 1885031. [Online]. Available: https://bugzilla.mozilla.org/show_bug.cgi?id=1885031

[160] MDN SharedArrayBuffer. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

[161] web.dev COOP and COEP. [Online]. Available: https://web.dev/articles/coop-coep

[162] GitHub Pages headers discussion. [Online]. Available: https://github.com/orgs/community/discussions/13309

[163] Emscripten licence. [Online]. Available: https://emscripten.org/docs/introducing_emscripten/emscripten_license.html

[164] Emscripten pthreads. [Online]. Available: https://emscripten.org/docs/porting/pthreads.html

[165] Emscripten SIMD. [Online]. Available: https://emscripten.org/docs/porting/simd.html

[166] wasm-bindgen-rayon. [Online]. Available: https://docs.rs/crate/wasm-bindgen-rayon/latest

[167] Jangda et al. 2019. [Online]. Available: https://usenix.org/conference/atc19/presentation/jangda

[168] Surma 2021. [Online]. Available: https://surma.dev/things/js-to-asc/

[169] ECMAScript Math object. [Online]. Available: https://read262.netlify.app/numbers-and-dates/math-object

[170] MDN transferable objects. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

[171] MDN Atomics.wait. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/wait

[172] MDN OffscreenCanvas. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

[173] MDN hardwareConcurrency. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency

[174] web.dev, WebGPU in major browsers. [Online]. Available: https://web.dev/blog/webgpu-supported-major-browsers

[175] Chrome, new in WebGPU 144. [Online]. Available: https://developer.chrome.com/blog/new-in-webgpu-144

[176] WGSL specification. [Online]. Available: https://www.w3.org/TR/WGSL/

[177] public-gpu list, Apr 2022. [Online]. Available: https://lists.w3.org/Archives/Public/public-gpu/2022Apr/0006.html

[178] three.js WebGPURenderer manual. [Online]. Available: https://raw.githubusercontent.com/mrdoob/three.js/dev/manual/pages/webgpurenderer.html

[179] GPU Gems 3, ch. 31. [Online]. Available: https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda

[180] webgpu-samples. [Online]. Available: https://github.com/webgpu/webgpu-samples

[181] spacekit. [Online]. Available: https://github.com/typpo/spacekit ; https://raw.githubusercontent.com/typpo/spacekit/master/src/shaders.ts

[182] NAIF SPK Required Reading. [Online]. Available: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html

[183] CSPICE spkw13_c. [Online]. Available: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkw13_c.html

[184] Rein & Tamayo 2015, WHFast. [Online]. Available: https://arxiv.org/abs/1506.01084

[185] Rein 2026, REBOUND in the browser. [Online]. Available: https://arxiv.org/abs/2602.06735

[186] Spector.js. [Online]. Available: https://github.com/BabylonJS/Spector.js

[187] MDN EXT_disjoint_timer_query. [Online]. Available: https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query

[188] `pipelines/artemis1.fetch.mjs`, the Artemis II design notes and `src/physics/environment.js` (repo).

[189] Rea, McNamara & Kane, AAS 24-174 (slides). [Online]. Available: https://ntrs.nasa.gov/api/citations/20240001314/downloads/AAS_24_174_Orion_Artemis_I_Entry_Performance.pptx

[190] Ferguson et al. 2026, Ablation Workshop. [Online]. Available: https://ntrs.nasa.gov/api/citations/20260006849/downloads/AWS_2026_Abstract_AR2_Ferguson.pdf

[191] NASA, Artemis II heat-shield analysis (Oct 2026). [Online]. Available: https://www.nasa.gov/news/artemis/rigorous-analysis-confirms-nasas-artemis-ii-heat-shield-performance/

[192] NASA, Artemis I heat-shield cause (Dec 2024). [Online]. Available: https://www.nasa.gov/missions/artemis/nasa-identifies-cause-of-artemis-i-orion-heat-shield-char-loss

[193] Rea & Putnam 2007, A Comparison of Two Skip Entry Guidance Algorithms. [Online]. Available: https://ntrs.nasa.gov/citations/20070023643 ; https://ntrs.nasa.gov/api/citations/20070023643/downloads/20070023643.pdf

[194] NASA, Artemis I flight day 26, CM separation. [Online]. Available: https://www.nasa.gov/blogs/missions/2022/12/11/artemis-i-flight-day-26-orion-crew-module-separation-from-service-module-complete/

[195] Bibb et al. 2011, AIAA 2011-3506. [Online]. Available: https://ntrs.nasa.gov/api/citations/20110013644/downloads/20110013644.pdf

[196] Pterodactyl / FNPEG, SciTech 2020. [Online]. Available: https://ntrs.nasa.gov/api/citations/20200000239/downloads/20200000239.pdf

[197] AAS 26-602 poster, citing Lu et al. 2017. [Online]. Available: https://ntrs.nasa.gov/api/citations/20260006141/downloads/AAS%2026-602%20Apollo%20vs%20FNPEG%20Comparison%20Poster%20LARGE.pdf

[198] Morth, R-532. [Online]. Available: https://www.ibiblio.org/apollo/Documents/R-532_Vol1_Reentry_Guidance_for_Apollo.pdf

[199] Daum 2026, Artemis II CPAS. [Online]. Available: https://ntrs.nasa.gov/api/citations/20260003320/downloads/aiaa_paper_2026_final.pdf

[200] Bihari, Kane & Moen 2024, Artemis I descent. [Online]. Available: https://ntrs.nasa.gov/api/citations/20240001180/downloads/AAS_24_Orion_Artemis_I_Descent_Performance_FINAL.pptx

[201] Ray 2017, CPAS forebody wake. [Online]. Available: https://ntrs.nasa.gov/api/citations/20170004357/downloads/20170004357.pdf

[202] Artemis II press kit. [Online]. Available: https://www.nasa.gov/artemis-ii-press-kit

[203] RocketPy rocket usage. [Online]. Available: https://docs.rocketpy.org/en/latest/user/rocket/rocket_usage.html

[204] Sutton & Graves, NASA TR R-376. [Online]. Available: https://ntrs.nasa.gov/citations/19720003329

[205] NASA, Artemis II flight day 9. [Online]. Available: https://www.nasa.gov/blogs/missions/2026/04/09/artemis-ii-flight-day-9-crew-prepares-to-come-home/

[206] SpacePolicyOnline, Artemis II preview. [Online]. Available: https://spacepolicyonline.com/news/artemis-ii-getting-ready-for-splashdown-tomorrow/

[207] Graves & Harpold, TN D-6725. [Online]. Available: https://ntrs.nasa.gov/archive/nasa/casi.ntrs.nasa.gov/19720013191.pdf

[208] Gualdoni et al., AAS 23-330. [Online]. Available: https://d1io3yog0oux5.cloudfront.net/_bf005d45e926a3f2e3440d749ee935bb/draper/db/2545/24039/document/AAS_23-330_rev1.pdf

[209] Dymos SSTO. [Online]. Available: https://openmdao.org/dymos/docs/latest/examples/ssto_earth/ssto_earth.html

[210] NASA DAVEtools. [Online]. Available: https://github.com/nasa/DAVEtools

[211] AAS 24-174 paper (PDF). [Online]. Available: https://ntrs.nasa.gov/api/citations/20240000024/downloads/AAS_24_174_Orion_Artemis_I_Entry_Performance.pdf

[212] OpenSpace academics. [Online]. Available: https://docs.openspaceproject.com/latest/about/academics.html

[213] IRKGaussLegendre.jl. [Online]. Available: https://github.com/SciML/IRKGaussLegendre.jl

[214] GeometricIntegrators.jl. [Online]. Available: https://github.com/JuliaGNI/GeometricIntegrators.jl

[215] Modelica Standard Library. [Online]. Available: https://github.com/modelica/ModelicaStandardLibrary

[216] Tracy et al., robust entry guidance. [Online]. Available: https://rexlab.ri.cmu.edu/papers/robust_edl_ktracy.pdf

[217] ScriptingExtension.java. [Online]. Available: https://raw.githubusercontent.com/openrocket/openrocket/master/core/src/main/java/info/openrocket/core/simulation/extension/impl/ScriptingExtension.java

[218] RocketPy SolidMotor. [Online]. Available: https://docs.rocketpy.org/en/latest/reference/classes/motors/SolidMotor.html

[219] RocketPy SciPy 2022 paper. [Online]. Available: https://proceedings.scipy.org/articles/majora-212e5952-020

[220] GMAT NASA usage. [Online]. Available: https://gmat.atlassian.net/wiki/spaces/GW/pages/380273244/NASA+Usage

[221] bsk on PyPI. [Online]. Available: https://pypi.org/project/bsk/

[222] Baù et al. 2016. [Online]. Available: https://indico.esa.int/event/111/contributions/288/

[223] NASA, Artemis I splashdown. [Online]. Available: https://www.nasa.gov/blogs/missions/2022/12/11/artemis-i-flight-day-26-orion-splashes-down-concluding-historic-artemis-i-mission/

[224] Spaceflight Now, Artemis I return. [Online]. Available: https://spaceflightnow.com/2022/12/11/artemis-1-back-on-earth-after-near-flawless-25-day-moon-mission/

[225] SpacePolicyOnline, Artemis I splashdown. [Online]. Available: https://spacepolicyonline.com/news/splashdown-orion-home-from-the-moon/

[226] Gay et al., AAS 24-171. [Online]. Available: https://ntrs.nasa.gov/api/citations/20240001457/downloads/AAS_24_171%20Retrospective%20on%20Orion%20GNC%20Design%20v1.pdf

[227] NASA 2021, skip entry on Artemis I. [Online]. Available: https://www.nasa.gov/feature/orion-spacecraft-to-test-new-entry-technique-on-artemis-i-mission ; now at https://www.nasa.gov/missions/orion-spacecraft-to-test-new-entry-technique-on-artemis-i-mission/

[228] Open-Meteo Historical Weather API. [Online]. Available: https://open-meteo.com/en/docs/historical-weather-api

[229] AssemblyScript. [Online]. Available: https://github.com/AssemblyScript/assemblyscript
