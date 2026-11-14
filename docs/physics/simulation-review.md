# Simulation techniques and tools review

Digital orrery, 14 November 2026. This is desk research only: nothing was installed, downloaded or run.

## How to read this

The review covers five topics: Julia and SciML, rocketry tools, astrodynamics simulators and numerical techniques, atmospheric entry, and real-time simulation in the browser. An independent checker re-read the sources after the research was done. Only claims the checker confirmed or corrected are kept here, with its corrections applied. Everything else is listed under [Unverified](#unverified).

A label in square brackets, such as [E5], points to the source list in section 7. A figure marked "derived" is our own arithmetic from sourced numbers.

- **Licences.** The repo is MIT. Code under GPL, AGPL or LGPL, and tools under NOSA or a proprietary licence, are used only as outside oracles. We run them or read them and compare numbers. We never copy, link or bundle their code. The FSF's GPL FAQ says a GPL program's output is generally not covered by the GPL unless it copies substantial parts of the program [R41]. So numbers these tools compute for our own inputs can be committed as fixtures.
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
| JuliaHub | commercial service | Hosted browser IDEs (Pluto, JuliaIDE), cloud compute, package and registry management, and app hosting [J1]. Julia does not need it. |
| Dyad (the old JuliaSim page now shows it) | proprietary, source-available [J5]; the $0 tier is for non-commercial use only [J4] | AI-assisted modelling that mixes causal and acausal models, checks units and conservation, and generates embedded C. Its listed libraries are electrical, mechanical, thermal and fluid [J4]. |
| Multibody.jl | proprietary JuliaHub EULA; repo archived | The LICENSE reserves all rights to JuliaHub. It allows only non-commercial academic teaching and research. It also carries BSD-3 notices for code adapted from DLR and Modelica Association libraries [J6]. |
| ModelingToolkit v11 | MIT, but depends on AGPL packages | See the licence notes below [J7, J8]. |
| ModelingToolkitBase.jl | MIT | Holds most of the MTK core, including a basic tearing pass [J7, J8]. |
| OrdinaryDiffEq.jl 7.8.2 / DifferentialEquations.jl | MIT | Each solver sub-library is also MIT: Verner, high-order RK, Feagin, RKN, symplectic and Taylor series [J10]. |
| SciMLSensitivity.jl | MIT | Adjoint sensitivities for reverse-mode automatic differentiation [J21]. |
| SatelliteToolbox.jl family | MIT | 11 sub-packages covering gravity, atmosphere, celestial bodies, geomagnetism, SGP4, TLEs and frames. It is used daily at INPE [J22]. |
| Ephemerides.jl, SPICE.jl | MIT | A pure-Julia SPK/PCK reader, tested against SPICE and CALCEPH, and a CSPICE wrapper [J27]. |
| TaylorIntegration.jl, PlanetaryEphemeris.jl, NEOs.jl | MIT | Taylor-method integration, including a DE430-model ephemeris [J26]. |
| WasmTarget.jl | Apache-2.0 | Compiles Julia to WasmGC without LLVM [J31]. |
| WebAssemblyCompiler.jl | MIT | Experimental; last pushed Feb 2024 [J32]. |

**Licence notes**

- **ModelingToolkit v11.** The post on v11 names three AGPL packages: StateSelection.jl, ModelingToolkitTearing.jl and SymbolicCompilerPasses.jl. It says the full package may carry AGPL obligations [J7].
- **StateSelection.jl.** It is AGPL-3.0-only; code from before 1 Dec 2025 is also available under MIT. ModelingToolkit 11.47.0 depends on it; ModelingToolkitBase 1.80.0 does not [J8].
- **Generated code.** The community thread did not settle whether the AGPL reaches generated code. A SciML Steering Council member said they could not give guidance on it [J9].
- **Julia binaries.** They bundle GMP, MPFR and parts of SuiteSparse under LGPL or GPL [J30]. This does not matter for an offline tool whose only output is JSON.

**Cost**

- JuliaHub's pricing page lists only the Dyad tiers ($0, $20, $60 and $200 a month, commercial use by quote) and gives no compute prices [J3, J4].
- The last published compute terms are in a May 2023 post: 20 free thread-hours a month, then $0.15 per thread-hour for batch and $0.25 for interactive use [J2]. That post gives the default machine as 16 GB in its text and 8 GB in its table [J2].

**Integrators**

- The solver guide recommends Vern6 to Vern8 for tolerances of about 1e-8 to 1e-12, and Vern9 below 1e-12 or with BigFloat. It says Vern7 is often more efficient than DP8 [J11].
- In the Arenstorf three-body benchmark, the Verner methods were the most efficient at strict tolerances in most tests. Adams and extrapolation methods were not competitive [J13].
- That benchmark times a cheap right-hand side. With the orrery's costly force model, the number of force evaluations per step decides the cost [J13].
- The Pleiades benchmark's reference solution is only good to about 1e-10 [J14].
- All the symplectic methods in the suite are fixed-step [J12].
- In the Kepler example, KahanLi6 keeps angular momentum exactly and its energy does not drift; DPRKN6 and Tsit5 drift [J16].
- DPRKN6 is the only RKN method with a 6th-order interpolant; the others fall back to 3rd-order Hermite [J12]. In the Hénon-Heiles test, DPRKN12's printed maximum energy error is 1.08e-5, against about 1e-14 for the other methods [J15].
- `ContinuousCallback` (in SciMLBase, MIT) checks 10 interpolated points per step by default. It finds each root on the interpolant and supports separate actions for upward and downward crossings, plus termination [J17]. A skip entry needs this, since two crossings can fall in one step.
- The native solvers accept other number types such as BigFloat; the wrapped C and Fortran solvers do not accept all of them [J18, J19].
- With ForwardDiff, the solve simply runs on dual numbers; SciMLSensitivity's adjoint methods are for reverse-mode differentiation [J21].
- `EnsembleProblem` runs many perturbed trajectories. `EnsembleSummary` defaults to 5 % and 95 % quantiles [J20].

**Astrodynamics packages**

- SatelliteToolboxGravityModels reads ICGEM files and computes accelerations. Its downloader hard-codes EGM96, EGM2008, JGM2 and JGM3 [J23].
- ICGEM lists GL0660B and newer lunar fields such as AIUB-GRL350A/B [J24].
- The atmosphere package covers exponential, Harris-Priester, Jacchia 1977, Jacchia-Roberts 1971, JB2008 and NRLMSISE-00. It has no US Standard Atmosphere 1976 and no MET [J25].
- Astrodynamics.jl (MPL-2.0) was archived on 26 Feb 2024 and AstroForceModels.jl (MIT) on 13 Jul 2026 [J28].
- EntryGuidance.jl has no licence file and was last pushed in Sep 2022. Its CPEG paper is in the repo, and its examples need MATLAB and the commercial Mosek solver [J29].

**Julia in the browser**

- WasmTarget.jl now runs ForwardDiff, StaticArrays and the fixed-step SimpleDiffEq solvers in Wasm. It does not support the adaptive solvers or OrdinaryDiffEq [J31].
- Julia 1.12's `juliac --trim` builds native executables, and its release notes do not mention WebAssembly [J32].

**Speed**

A 2016 ESA comparison measured Julia's runtime against Fortran: 0.71 for a Kepler solver, 1.1 for Lambert, 2.29 for Keplerian elements, and 2.97 for DOP853 called from Julia [J33]. The DOP853 figure mostly measures the cost of Fortran calling back into Julia [J33].

**What fits**

- **An offline oracle or fixture generator**, if Julia is installed later. Everything it would need is MIT: OrdinaryDiffEq, SatelliteToolbox, Ephemerides.jl or SPICE.jl, TaylorIntegration and AstroTime.jl [J10, J22, J27, J26, J39]. Section 5 says when this is worth it.
- **Techniques to rebuild in our own code**:
  - root-finding on the interpolant at several points per step [J17];
  - convergence-order tests, as DiffEqDevTools (MIT) does them [J35].

**What does not fit**

- **Julia at runtime in the browser.** Neither an adaptive solver nor the existing force models compile to Wasm today [J31].
- **Full ModelingToolkit, Multibody.jl and Dyad**, in any form, inside the repo [J4, J6, J7].
- **Code from EntryGuidance.jl**, which has no licence. Read its paper only [J29].
- **Archived packages** [J28].
- **Porting Verner's tableaus, for now.** OrdinaryDiffEq's tableau file says the coefficients came from Verner's website [J34]. That site now returns 404, and the redistribution terms could not be read (see Unverified). DOP853 is the lower-risk high-order choice.

### 2.2 Rocketry tools

**What the tools are**

| Tool | Licence | On this machine | Role here |
|---|---|---|---|
| OpenRocket 24.12 | GPL-3.0 [R7] | jar installed [R3]; headless through JPype, locally [R4] | oracle, numbers only |
| RASAero II 1.0.2.0 | freeware; no licence or terms stated [R16, R17] | cannot run: Windows only, and no Wine [R1] | oracle; exported tables kept local |
| RocketPy 1.13.0 | MIT [R18] | not installed | oracle; code may be ported with its notice |
| ThrustCurve.org API | no data licence stated [R29] | web | data source at run time |
| `@thrustcurve/api1` 1.0.3 | ISC [R30] | npm package | possible app dependency |
| OpenTsiolkovsky | MIT [R31] | hosted web app or Rust build | orbital-launcher oracle |
| MAPLEAF | MIT [R33] | not installed | 6-DOF oracle |
| NESC Atmospheric Case 17 | public domain [R34, R35] | not downloaded | reference solution for a staged ascent |
| Barrowman 1967 thesis | US Government work, public use permitted [R38] | NTRS | algorithm source |
| RocketSerializer | MIT [R15] | not installed | `.ork` to RocketPy; one stage only; ships OpenRocket 22.02 and 23.09 jars |
| orhelper | GPL-2.0 [R14] | not installed | cannot drive OpenRocket 24.12 |
| CamPyRoS | GPL-3.0 [R39] | not installed | oracle only |

**The current ascent model**

- `ascent()` uses a constant Cd (default 0.5) on a fixed diameter, a constant mass flow per stage and an Isp that is linear in ambient pressure. It has no launch rail. The rocket rises vertically to `pitchAlt` and then follows a gravity turn [R2].
- It already reports max-q and the drag and gravity losses. These are tested against Curtis Example 13.3: 298 m/s drag loss, 1,410 m/s gravity loss and 0.156 atm max-q [R2].
- The default atmosphere is exponential and returns no temperature. `standardAtmosphere` already returns T [R2].

**The existing OpenRocket vs RASAero comparison**

The comparison never ran RASAero II. Its RASAero numbers come from 18 project files and their exports [R1]. It found:

- RASAero's drag is 0.849 to 0.928 times OpenRocket's at Mach 0.3 to 0.9, and 1.012 to 1.037 times at Mach 1.05 to 1.75 [R1].
- RASAero's own simulations fly 5.2 to 5.3 % higher. The doc splits that gap into about +0.5 % from the drag table, +3.3 to +3.8 % from base drag under thrust, and +0.9 % from a pressure convention [R1].
- A 2-D point mass using OpenRocket's Cd matched OpenRocket's apogee to 0.02 % [R1].

**OpenRocket**

- 24.12 (27 Jul 2025) is still the latest release as of 14 Nov 2026 [R9]. It added multi-level wind with CSV import, and Component Analysis sweeps, such as Cd against Mach, that can be exported [R9].
- The jar uses the `info.openrocket.*` namespace and offers flat, spherical and WGS84 geodetic modes [R3]. It has density and total-velocity data types but no dynamic-pressure type, so q has to be computed as ½ρv² [R3].
- It gives no base-drag credit under thrust. The 2013 technical documentation says it subtracts the burning motor's area [R10]. But `BarrowmanCalculator`, on master and in the local 24.12 jar, has no motor or thrust dependence [R11].
- The documentation gives base drag as 0.12 + 0.13 M² below Mach 1 and 0.25/M above (eq. 3.94) [R10].
- The documentation's flat-Earth, no-Coriolis and constant-wind statements describe OpenRocket in 2013. Version 24.12 has spherical and WGS84 modes with Coriolis and multi-level wind, so these are now settings to pin [R10, R8]. The documentation's preface names no specific share-alike licence [R10].
- `.ork` files are XML, optionally GZIP-compressed [R10]. The local files are ZIP archives holding one `rocket.ork`. They use format version 1.9 when saved by 23.09 and 1.10 when saved by 24.12 [R6].
- Simulation extensions are Java listeners whose hooks can override computed values [R12]. The owner already has an extension with `ProfileAtmosphere`, `DragScaleListener`, `StopAtApogeeListener` and `FastAeroListener` [R5].
- orhelper targets OpenRocket 15.03 and the old `net.sf.openrocket` package, so it cannot drive 24.12 [R14].

**RASAero II**

- It predicts drag, lift, normal force and centre of pressure from Mach 0.01 to 25, and handles several stages. Its developer reports a 3.47 % average apogee error against flights [R16].
- Version 1.0.1.0 (Aug 2016) extended its power-on base-drag model to the large nozzle exits of orbital-launcher stages. Version 1.0.2.0 (May 2019) extended it to satellite-launch-vehicle stages and added CSV export of flight data [R17].

**RocketPy**

- `Rocket` takes `power_off_drag` and `power_on_drag` [R19]. The constructor docs say these are functions of Mach only, but v1.12.0 advertises drag as a function of Mach, Reynolds number and angle of attack [R19, R21].
- `Flight` takes rail length, inclination (default 80°) and heading (default 90°), and integrates with LSODA by default [R20]. It offers '3 DOF' and '6 DOF' modes, and reports apogee, maximum speed, maximum Mach and maximum dynamic pressure with its time [R20].
- v1.12.0 (20 Mar 2026) added 3-DOF flight, `FlightComparator`, ThrustCurve access with caching, and net thrust in 3-DOF [R21]. Reviewers of the 3-DOF pull request noted that sanity tests were still missing [R22].
- `FlightComparator` interpolates both datasets onto a shared 1,000-point grid and reports RMSE, MAE and maximum deviation [R23].
- RocketPy treats the Earth-fixed frame as inertial [R24], and its standard atmosphere covers only -2 to 80 km [R25]. It is a sounding-rocket code, not an orbital one.
- Its parachute model is `cd_s` plus a trigger, sampling rate, lag and noise. Porosity sets an added mass without changing `cd_s` [R27].

**ThrustCurve.org**

- Its JSON API asks clients to stay under 2 requests a second, cache responses for at least 24 hours and not hotlink motor files. It states no data licence [R29].
- The ISC client has no runtime dependencies. Nothing documents CORS for browser use [R30].

**Launcher-scale codes**

- OpenTsiolkovsky propagates in ECI with WGS84 J2 gravity and US76 up to 1,000 km [R31]. Its axial-force tables depend on Mach and carry a separate unpowered value. It clamps thrust at max(F_vac − A_e·p, 0) and integrates with RK4 or Dormand-Prince 5(4) [R31].
- Its example vehicles include Saturn V, Falcon 9 and H-IIA [R31]. The Saturn V file's axial-force coefficients run from 0.35 to 0.55 against an unlabelled key that goes up to 8. The file cites no data source [R32].

**NESC Atmospheric Case 17**

- It is an idealised two-stage rocket flown from sea level to a highly elliptical orbit without guidance. It uses US76, J2 and a rotating WGS-84 Earth [R35].
- Its models are DAVE-ML, in a package linked from the Bodies page [R36]. Its reference trajectories are in `Atmos_17_TwoStageRocketToOrbit.zip`, linked from the 2015 home page [R34].
- The orrery already runs `sixdof.js` against all 26 NESC orbital cases (02 to 11), but against no atmospheric case [R37].

**Other references**

- Barrowman's thesis covers slender axisymmetric bodies with 3 or 4 fins at subsonic and supersonic speeds. It does not cover the transonic range [R38].
- The tudat C++ repo was archived on 14 Jan 2026; tudatpy now holds the source [J41]. Its two-stage ascent example flies on Mars with a constant Cd of 0.85 [R40].
- The Delta III ascent benchmark uses Cd 0.5, S = 4π m² and an exponential atmosphere (ρ0 = 1.225 kg/m³, H = 7,200 m). That is the same model class as `ascent()`. YAPSS (MIT) has a runnable notebook for it [R42].
- PEGAS is an MIT implementation of Shuttle-style UPFG closed-loop guidance [R43].

**What fits**

- **Our own code, with no third-party code**: Cd(Mach) tables with power-off and power-on values, an `.eng` thrust-curve reader and a sounding-rocket mode. Mirroring RocketPy's `power_off_drag`/`power_on_drag` shape lets one CSV feed both codes [R19].
- **Oracles, numbers only**:
  - OpenRocket through the existing runtime;
  - RocketPy in 3-DOF mode;
  - OpenTsiolkovsky for launcher-scale ascent;
  - NESC Case 17, later.
- **Ports with attribution**: RocketPy or OpenTsiolkovsky code if ever needed (both are permissive), and Barrowman's method from the public-domain thesis.
- **A browser `.ork` importer for users' own files**, written from the documented format. It must handle ZIP and GZIP and format versions 1.9 and 1.10 [R10, R6].

**What does not fit**

- OpenRocket code or its example `.ork` files in the repo (GPL-3.0) [R7].
- Text and figures from OpenRocket's technical documentation, which is share-alike [R10]. Cite and re-derive its equations instead.
- orhelper, for 24.12 [R14].
- Committing ThrustCurve motor files or RASAero tables while their terms are unstated [R29, R17].
- OpenRocket or RASAero for capsule entry. Both are tools for slender rockets.

### 2.3 Astrodynamics simulators and numerical techniques

**The orrery's baseline**

- **Steps.** Cowell steps use Yoshida 4, with a step of η times the local dynamical time and no error estimate. Encke steps use Dormand-Prince 5(4) with error control, and rectify when |δ| > 1e-4 |ρ| [A1].
- **Events.** Impacts and primary changes are checked only at step ends, and the documented limit is that SOI switching has no hysteresis [A1]. Encke is entered below a perturbation ratio of 1e-5 and left above 3e-5 [A3].
- **Planned speed-up.** An averaged J2-secular reference orbit for Encke [A1].
- **Ephemeris error.** Per `nbody.js`, the measured error of the astronomy-engine bodies is 0.01 to 0.07 km [A4].
- **De Sitter term.** `environment.md` names de Sitter's geodesic term and leaves it out on purpose. It belongs to geocentric integrations, and the kernel is heliocentric [A5].

**The tools**

| Tool | Licence | Use here |
|---|---|---|
| NASA GMAT | Apache-2.0 [A6] | oracle for cislunar and long-arc force models |
| Orekit, with Hipparchus | Apache-2.0 [A16, A18] | oracle for event times, relativity and tides; readable integrator code |
| Tudat / tudatpy | BSD-3-Clause [A21] | lifting-entry oracle (section 3) |
| Basilisk | ISC [A27] | second 6-DOF oracle; low value |
| poliastro, hapsira, boinor | MIT [A36, A37] | quick Python checks; poliastro is archived |
| THALASSA | MIT [A44] | regularised formulations |
| heyoka / heyoka.py | MPL-2.0 [A46] | Taylor oracle in Python; outputs only |
| CNES PATRIUS | Apache-2.0 [A51] | a second Java oracle |
| NASA 42 | NASA Open Source Agreement [A31, A32] | not used |
| NASA Trick and JEOD | NOSA 1.3 [A33, A35] | not used; Trick's event method is borrowed as an idea |
| JPL MONTE | Caltech proprietary [A38] | not used |
| NASA POST2 | US release only [A52] | not used |
| GMAT.jl | MIT; dormant since Sep 2020 [A15] | not used |

**GMAT**

- The GitHub repo is Apache-2.0, has 8 commits and no Releases; the binaries are on SourceForge [A6].
- Its propagators include PrinceDormand45 and 78, RungeKutta89, RKF56, a Dormand-El-Mikkawy-Prince RKN 6(8), Adams-Bashforth-Moulton and Cowell. It has no Bulirsch-Stoer or Gauss-Jackson [A7].
- The RKN 6(8) header carries both Apache-2.0 and a legacy NASA usage-agreement notice (GSC-14735-1) [A8]. PrinceDormand78 has a 13-stage tableau and no dense output [A9].
- Its relativity force computes the Schwarzschild, de Sitter and Lense-Thirring terms [A10].
- It has drag atmospheres (exponential, Jacchia-Roberts, MSISE-90) but no lift or entry model [A11].
- R2025a added production multi-body harmonic gravity [A12]. In 2014 its nightly regression suite ran about 13,000 test scripts [A14].
- GMAT reads a user-supplied SPK. Its default ephemerides are DE421 in SPICE mode and DE405 in DE mode, so DE442 must be set explicitly [A6].

**Orekit and Hipparchus**

- Orekit has analytical propagators (Kepler, Eckstein-Hechler, Brouwer-Lyddane, SGP4), a semi-analytical one (DSST) and a numerical one [A16].
- Its force models include ICGEM gravity, DTM2000, JB2008, NRLMSISE-00, SRP with several occulting bodies, Lense-Thirring and de Sitter terms, and tides. Its event detectors can be combined with boolean logic [A16].
- The numerical propagator runs on Hipparchus integrators. A helper turns one position tolerance into tolerance vectors [A17].
- orekit-jpype 13.1.9.0 needs JDK 11 or newer [A19]; this machine has a full OpenJDK 25.
- DSST matched the Fortran DSST Standalone over arcs of several thousand days [A20].
- Hipparchus (Apache-2.0) has DormandPrince54 and 853, Gragg-Bulirsch-Stoer, Adams methods in Nordsieck form, and others [A18].

**Tudat**

- It recommends RKF7(8) or RKDP8(7) for most problems. Its Bulirsch-Stoer has no dense output [A22].
- Its Encke does not update the reference orbit. Termination on a dependent variable, such as altitude, can stop exactly on the condition with a root finder [A23].
- It has a US76 atmosphere, and a custom atmosphere whose density is a function of altitude, longitude, latitude and time [A26].
- Its re-entry example flies the Space Shuttle with tabulated CL and CD. Bank is chosen to hold the flight-path-angle rate at zero. The examples repo has no licence [A24].
- The `aerodynamic_angle_based` rotation model takes angle of attack, sideslip and bank as functions of time [A25].

**Other tools**

- Basilisk defaults to RK4 and lets users define explicit RK methods from Butcher tables [A29]. Its drag de-orbit scenario has no lift [A30].
- NASA 42's own slides admit loose handling of true-of-date against J2000 frames, and call its atmospheric flight provisional [A31].
- Trick's dynamic events evaluate an error function after each step, then use regula falsi to step to the boundary within 1e-15 [A34].
- poliastro (MIT) was archived on 14 Oct 2023. Its Cowell propagator accepts altitude, latitude, umbra and node events [A36]. boinor (MIT, pushed Jun 2026) credits the poliastro team [A37].
- MONTE has run all of JPL's navigation since 2012 and is licensed only on request [A38].

**Integration methods**

- Atallah et al. (2019) compared six integrators on Earth orbits with 70×70 gravity [A42]:
  - DP8(7) needed far fewer force calls than DP5(4) at high accuracy;
  - adaptive Picard-Chebyshev was most efficient everywhere except LEO;
  - drag made round-trip accuracy at least two orders of magnitude worse;
  - RKN methods are limited to forces that depend on position only;
  - an energy (Hamiltonian) check is often too optimistic.
- Fehlberg's NASA TR R-287 gives RKF7(8) coefficients and is a US Government work [A48].
- **Gauss-Jackson and Störmer-Cowell.**
  - US space surveillance has used 8th-order Gauss-Jackson since the 1960s, and Berry and Healy derive it from first principles [A39].
  - A generalised Sundman time transform takes larger steps near apogee [A40].
  - A variable-step Störmer-Cowell matches Gauss-Jackson with s-integration, and does better under high drag [A41].
- **Regularisation** pays mainly in high orbits. At equal accuracy it was up to 2× slower than semi-analytical methods in LEO, about equal in GTO, and up to 10× faster in HEO [A43]. THALASSA implements these formulations [A44].
- **Taylor methods.**
  - The heyoka Taylor integrator was competitive with or better than specialised integrators, including on Apophis's 2029 encounter [A46].
  - Taylor integration with polynomial root-finding gives event detection with strong guarantees [A47].

**Event detection**

- SciPy's `solve_ivp` detects an event from a sign change over a step, so two crossings in one step can be missed. RK45 has quartic dense output and DOP853 7th-order [A49].
- NAIF's Geometry Finder can find distance crossings, extrema and occultations from an SPK. Its search step must be shorter than any event of interest [A50].

**What fits**

1. **Exact event location (M).**
   - In Encke arcs, use the DP5(4) interpolant, added back to the reference conic at each trial time.
   - Across Yoshida steps, use a quintic Hermite on (r, v, a).
   - Root-find with Illinois regula falsi, which `entry.js` already uses for its bank solve [A2]. Restart the step after an event.
   - Add hysteresis to SOI switching, as the Encke 1e-5/3e-5 thresholds already do [A3].
   - Test with analytic two-body times for periapsis and radius crossings. SPICE's Geometry Finder can supply event times from the Artemis SPKs through SpiceyPy, which the repo already uses [A50].
2. **Node checks before outside oracles (S-M).** Check self-convergence by step halving, with the kernel's own forces. Use the method of manufactured solutions through a forcing hook in the term list in `environment.js`. Round-trip closure tells us little for Yoshida, because it is time-symmetric and retraces its own steps. Energy checks are optimistic [A42].
3. **Error-controlled Cowell with DOP853 or RKF7(8) (M).**
   - Port it from the published coefficients [A48]. Hipparchus is a readable Apache-2.0 reference [A18].
   - The gain is limited, because the ephemeris interpolation sets the accuracy floor [A4]. Let Cowell steps end on ephemeris nodes, as Encke steps already do.
4. **GMAT as the cislunar force-model oracle (M-L).**
   - Set DE442 as the SPK and match the Earth frames.
   - Switch on one force at a time and use PrinceDormand78 at a tight tolerance.
   - Store the states as JSON fixtures, like the SPICE and NESC ones.
   - It is a large download and needs approval.
5. **Orekit through orekit-jpype (M)** for event times, relativity and tides, using the installed Java. The planned J2-secular Encke reference needs only textbook secular rates; Orekit's analytic propagators can cross-check it on Earth arcs.
6. **Tudat for lifting entry.** See section 3.

**What does not fit**

- **RKN pairs for coast arcs.** The default force model includes the Schwarzschild and Lense-Thirring terms, which depend on velocity [A5], and RKN assumes forces that depend on position only [A42]. The gain would be low once DOP853 exists.
- **Regularised elements (KS, EDromo) and Gauss-Jackson, for now (L, low value).** Encke already covers near-Keplerian motion [A43], and the app makes many burns, each of which would restart a multistep method.
- **heyoka in the app.** It is a C++ library that compiles code with LLVM at run time [A46], so it cannot run in a browser worker. heyoka.py is fine as an outputs-only oracle.
- **42, Trick and JEOD, MONTE, POST2.** Their licences or release terms rule them out (NOSA, proprietary, US-only).

### 2.4 Entry tools and sources

The eng-tools catalogue had no entry rows [C1]. The primary sources are NASA papers on NTRS and NASA pages, plus the Apollo flight code, which is marked public domain [E31]. Section 3 turns them into a plan.

| Resource | Licence | Role |
|---|---|---|
| NASA Orion papers: AAS 24-174, Rea & Putnam 2007, Bibb 2011, IPPW 2026, Daum 2026, Bihari 2024, Ray 2017 | NASA NTRS, public | data and algorithms (facts and equations; no copied text) |
| Apollo Comanche055 `REENTRY_CONTROL.agc` | public domain [E31] | source for PredGuid's Apollo phases |
| Mendeck & Craig, MSL entry guidance | NASA NTRS [E20] | readable final-phase equations |
| Tudat / tudatpy | BSD-3-Clause [A21] | lifting-entry oracle |
| SciPy `solve_ivp` | BSD-3 [A49] | oracle for event timing |
| RocketPy parachute | MIT [R27] | descent-under-canopy oracle |
| Open-Meteo Historical Forecast API | data CC BY 4.0; free tier non-commercial; server AGPLv3+ [E27] | winds up to 30 hPa |
| ERA5 pressure levels (Copernicus CDS) | CC-BY; account needed [E29] | atmosphere on the day, to 1 hPa |
| NASA GRAM Suite | NASA General Public Release, by request form [E26] | density and wind dispersions; low-medium value |
| AMAT | GPL-3.0 [E25] | oracle only; low value |
| Dymos / JuMP shuttle-entry benchmark | Apache-2.0 [E23] / MPL-2.0 [E24] | checks equations of motion and bank sign; low value |

- AMAT's Apollo 4 example flies a constant 70° bank, labelled arbitrary. It has no flight-data overlay and no Earth rotation, so it checks equations of motion, not Apollo's flight [E25].
- Dymos reports a final latitude of 0.5958 rad on the shuttle problem [E23], and JuMP reports 34.18° [E24].
- NASA's own Artemis II slides say the GEOS+GRAM density was not accurate enough for aeroheating work [E15].
- NESC planned an Apollo-like lunar-return entry check case but never attempted it, so no multi-tool NESC entry reference exists [E37]. The 2023 NESC set is all lunar orbital [E38].

### 2.5 Real-time browser simulation

**The orrery's baseline** [T51]

- **Scene.** A floating origin: positions are doubles in km on the CPU and camera-relative float32 on the GPU, drawn with a logarithmic depth buffer. The render unit is 1,000 km.
- **Clock.** The clock clamps real dt to 1 s.
- **Step requests.** One step request is in flight at a time. `advance()` ends each request exactly at its end time (the clock time, or a burn hold), within a 20,000-step budget. Lag is recorded, and the drawn state is carried forward by a two-body plus J2 RK4 propagation.
- **Interactive thrust.** It is averaged over the frames since the last request.
- **Aiming.** `aimTo` does one base run, then three Jacobian columns and one verification run for each Newton round. All of these run one after another in the stepping worker.

**Stepping and time warp**

- **Fixed timestep.** Stepping by variable frame time makes results depend on frame rate. The fix is an accumulator consumed in fixed steps, a clamp on frame time, and display by blending the previous and current states [T1].
- **Orbiter**, which is MIT [T2]:
  - its documented propagators are RK2 to RK8 and Yoshida symplectic methods of orders 4, 6 and 8 [T2];
  - it switches to an Encke-type "orbit stabilisation" when a frame would advance more than 1e-3 of an orbit [T2];
  - it picks among up to five propagators by frame length [T4];
  - it sub-steps long frames up to a cap, and disables stabilisation above a perturbation ratio [T3].
- **Universe Sandbox**:
  - an adaptive mode takes safe steps within a tolerance, and too coarse a step ejects bodies [T5];
  - a two-body mode for extreme warp was proposed, but not scheduled [T6].
- **Principia** (MIT) draws an integrated prediction whose length and tolerance the user sets. Long, tight predictions can make the game unresponsive [T7].
- **OpenSpace** ramps changes to the simulation rate and pause over a set duration [T8].
- **Hidden tabs.** `requestAnimationFrame` is paused in most browsers [T31]. Chrome throttles timers on hidden pages to once a second, and, under some conditions, to once a minute after 5 minutes [T32].

**Precision**

- **Float32 spacing.** Float32 keeps about 7 significant digits [T12]. Its spacing grows with magnitude [T13]: about 16 km at 1 AU and 512 km at 30 AU, expressed in km (derived from the 24-bit significand).
- **Celestia** (GPL-2.0-or-later) stores positions as 128-bit fixed point. It subtracts two coordinates in 128-bit before converting the difference to double [T10], and splits the depth range into per-body partitions drawn back to front [T11].
- **GPU relative-to-eye (Ohlarik, 2008).** Each double is split into high and low floats in a static buffer, and the shader subtracts the eye's two parts, giving about 1.35 cm error [T12]. The split is defined in metres, so the orrery's 1,000 km render unit needs it rescaled [T12].
- **Chord error.** Orbit lines use 360 samples [T51]. The chord error is R(1 − cos 0.5°): about 5,700 km at 1 AU and 170,000 km at 30 AU (derived). That is far larger than float32 spacing.

**Depth**

- Reversed-Z with a float32 depth buffer distributes precision well; integer depth buffers gain nothing from reversal [T14]. Log depth written in the fragment shader disables early depth testing [T15]. One reported foliage-heavy three.js scene lost about 13 ms per frame to it [T17].
- **three.js r187.**
  - Reversed depth needs `EXT_clip_control`. If both `reversedDepthBuffer` and `logarithmicDepthBuffer` are set and the extension is missing, three falls back to log depth [T51].
  - The official example renders into a float depth texture for post-processing [T16].
- **Browser support.** `EXT_clip_control` reached 92.8 % of tested browsers, but Firefox only 60.0 %, Linux 75.4 % and Android 70.3 % [T18]. Firefox's implementation landed in Firefox 159 [T19].

**Workers and WebAssembly**

- **Cross-origin isolation.**
  - SharedArrayBuffer and shared Wasm memory need it [T20]. It takes the COOP and COEP headers, and COEP blocks cross-origin resources that lack CORP or CORS [T21].
  - GitHub Pages cannot set these headers. A 2023 comment said custom headers were a scenario GitHub would support, with no date, and the thread is still open [T22].
  - A user reported in Aug 2025 that the coi-serviceworker workaround no longer worked in Firefox [T22].
- **Emscripten** (MIT/NCSA [T25]).
  - Threaded builds need cross-origin isolation, and need a second build for when the page is not isolated [T23].
  - `-msimd128` gives 128-bit SIMD, including two doubles per lane operation, from Chrome 91, Firefox 89 and Safari 16.4 [T24].
- **wasm-bindgen-rayon** (Apache-2.0) needs nightly Rust and cross-origin isolation [T26].
- **Speed.** Wasm ran 45 % (Firefox) and 55 % (Chrome) slower than native on SPEC on average [T27]. Optimised JS and Wasm reach similar peaks; Wasm's advantages are predictable speed, SIMD and threads [T28]. The geopotential recursion already uses `Float64Array` [T51].
- **Reproducibility.** ECMAScript lets `Math.sin`, `Math.cos` and `Math.exp` return implementation-approximated values [T46]. A fixed step grid alone therefore cannot make Firefox or Safari match the Node (V8) validation runs bit for bit; a Wasm kernel with its own libm could.
- **Plain workers.**
  - Transferring an ArrayBuffer by `postMessage` moves it without copying [T29].
  - `Atomics.wait` cannot run on the main thread [T30].
  - `OffscreenCanvas` lets a worker own a WebGL canvas [T33].
  - `navigator.hardwareConcurrency` gives the logical core count for sizing a pool [T34].

**WebGPU and the GPU**

- **Support.** As of Nov 2025, WebGPU shipped in Chrome, Edge, Firefox and Safari on most desktop platforms, but not yet by default on Linux [T35]. Chrome 144 (Jan 2026) began a staged Linux rollout on Intel Gen12+ GPUs [T36].
- **No f64.** WGSL has only f32 and f16 as concrete float types [T37]. Myles Maxfield wrote in 2022 that Metal-based WebGPU would not offer f64 [T38].
- **WebGPURenderer.** three.js's WebGPURenderer is experimental and does not support `ShaderMaterial` or `onBeforeCompile` [T39]. The orrery uses these in 7 scene files [T51].
- **GPU n-body.** All-pairs n-body on the GPU tiles bodies through shared memory in single precision [T40]. webgpu-samples (BSD-3) has compute, reversed-Z and worker samples [T41].
- **spacekit** (MIT) solves Kepler's equation per vertex in a GLSL shader, from orbital elements stored as attributes [T42].

**Interpolation**

- **SPK type 13** stores states and interpolates them with Hermite polynomials using position and velocity [T43].
- **spkw13_c** writes such a segment from a list of states [T47].
- **WHFast** gives a fast Kepler-drift-plus-kick propagator [T44].
- **REBOUND** (GPL-3.0) now also runs in a browser through Wasm [T45].

**What fits, with effort**

1. **Budget, warp cap, ramps and hidden tabs (S).**
   - Replace the step budget with a wall-clock budget per request.
   - Cap warp and say so on screen, including that the planets and the mission timeline slow too.
   - Ramp rate changes as OpenSpace does [T8].
   - Choose a policy for hidden tabs. Today a hidden tab already pauses sim time in effect, because rAF stops and the 1 s clamp drops the gap [T31].
2. **Aim in its own worker (S).** Stepping will no longer wait on aiming. A pool that runs the Jacobian columns in parallel gives about 1.7× for the first Newton round and at most 2× for later rounds (derived from the run counts above). Each pool worker loads its own ephemeris and gravity tables.
3. **Physics on its own step grid, displayed from a Hermite node buffer (M to M-L).** This uses the SPK type 13 scheme [T43]. Results stop depending on frame rate, though not on the browser engine [T46]. Interactive thrust must be timestamped onto the step grid. SpiceyPy with `spkw13_c` and analytic Kepler arcs are the oracles [T47].
4. **An integrated prediction line, after item 3 (M).**
   - Chunk the work so it does not delay step replies.
   - State a space-weather assumption beyond the end of the CelesTrak data.
   - Assign a primary to each segment, for drawing relative to the primary.
5. **Adaptive resampling of orbit lines (S).** Then rescale the relative-to-eye split if jitter remains [T12].
6. **Depth: measure first.**
   - Profile with Spector.js (MIT) [T49] or the timer-query extension, which has limited availability [T48].
   - Then offer reversed-Z as an opt-in, keeping log depth as the fallback [T51].
   - A float depth target loses canvas MSAA unless it is multisampled.
7. **Many small bodies on rails (M).** Use Kepler's equation in the vertex shader [T42]. Pass time relative to a recent epoch, because a float32 Julian date near 2.46e6 resolves only 0.25 day (derived). Downloading element catalogues needs approval.
8. **Two-part sim time (S).** Store sim time as two parts (days plus fraction), or use compensated summation. This ties in with the open leap-second clock bug.
9. **A warp cap during atmospheric flight (S).** Key it to altitude or dynamic pressure, so that entry steps stay short.

**What does not fit now**

- **Threaded Wasm.** Hosting is undecided, GitHub Pages cannot set the headers [T22], and plain workers cover the coarse parallelism.
- **Migrating to WebGPURenderer.** It means 7 shader files to port, and WGSL has no f64 for the kernel anyway [T37, T39].
- **A Wasm port of the harmonics**, unless profiling shows they dominate. Even then, the main argument is reproducibility across browsers, not speed [T28, T46].
- **An on-rails Wisdom-Holman mode in cislunar space.** It assumes a dominant central mass [T44], which fails near the Moon. If an approximate high-warp mode is wanted, extend the existing J2 carry-forward or use Encke with frozen perturbations, as Orbiter does [T2]. Label it, and keep it out of validation.

## 3. Entry modelling plan

### Where it stands

The committed code flies a ballistic fall with drag. The `feat/entry` branch has an uncommitted prototype:

- `entry.js`, 207 lines, has a constant trim L/D. Its predictor-corrector flies a constant bank, solved by Illinois regula falsi. It has deadband bank reversals, two-step parachutes and a reference to FNPEG (Lu, JGCD 37(3)) [A2].
- `environment.js` imports it, `craft.js` passes an `entry` option through `envParams()`, and `kernelHost.js` is also modified [A2].
- The predictor uses US76 below 86 km and the kernel's MET densities above. The kernel's truth atmosphere below 86 km is also US76 [A2, E30].

### What Orion flew

**PredGuid phases on Artemis I.** Orion flew six phases [E5]:

1. Initial roll.
2. Energy management, using Apollo's HUNTEST and a constant-drag subphase.
3. Up control: a numerical predictor-corrector using estimated density and L/D.
4. Ballistic.
5. Final: Apollo's final-phase controller with a stored reference, plus a g-limiter.
6. Terminal: proportional heading guidance.

Downrange and crossrange are decoupled [E5].

**Control.** In the atmosphere only bank is flown; angle of attack and sideslip are held by aerodynamic stability. Two strings of six CM thrusters are run by a 40 Hz controller with gains scheduled on velocity [E5].

**Estimators.** Measured acceleration scaled the onboard 1976 standard atmosphere and gave an L/D estimate [E5].

**Artemis I outcome** [E5]:

- the air was about 10 % thinner and L/D about 5 % lower than predicted, both within dispersions;
- guidance flew 6 bank reversals;
- the skip apogee was 287.4 kft (87.6 km), against 293.5 kft predicted;
- the range from entry interface to splashdown was about 3,200 nmi;
- the bank solution assumed no wind, which broke down in the last 90 s or so of guided flight;
- neither the g-limiter nor the skip-out protection triggered.

**Artemis II** flew a modified trajectory without the skip [E9], with a shorter maximum downrange [E11]. This followed the Artemis I finding that heat built up in the Avcoat between the dips and made gas that could not vent [E10].

**Earlier design study.** The 2007 PredGuid study gives Orion an L/D of 0.3 to 0.35. Direct entry reached about 2,500 nmi of range; covering the continental US through the lunar month needed at least 5,500 nmi, which only a skip can give [E6].

### Step 1: hand-over at entry interface (with the event finder, section 2.3)

- **Interface.** Entry interface is 400,000 ft geodetic, which is 121.92 km [E6, E30].
- **Artemis I timing.**
  - The as-flown OEM ends at 2022-12-11 17:19 TDB, about 17:18 UTC (TDB − UTC ≈ 69.2 s) [E30].
  - That is about two minutes before entry interface at 17:20:14 UTC, and after CM/SM separation at 17:00 UTC [E1].
  - Fly that gap in the kernel, find entry interface with the event finder, then switch to the entry model.
- **Artemis II.** The repo uses the flown BET's −5.919° at 121.92 km, because NASA did not publish the entry flight-path angle [E30].

### Step 2: vehicle and aerodynamics (S)

**Geometry and mass**

- Diameter 198 in (5.03 m), heat-shield radius 237.6 in, shoulder radius 9.9 in, height 130 in [E15].
- Reference area π × (2.515 m)² = 19.87 m² (derived).
- Mass: the only primary figure is the 2007 design mass of 20,369.2 lbm (9,239 kg) [E6]. Label it as a design value.

**Aerodynamic coefficients**

- **Hypersonic trim.**
  - Angle of attack about 161 to 164°, where 180° means heat shield forward [E16].
  - L/D at trim is about 0.28 at FMV 10 and falls to about 0.245 at FMV 35. FMV is Mach below 8.8 kft/s and velocity in kft/s above 9.8 kft/s, blended in between [E16].
  - The uncertainty is ±0.035 in L/D, or ±0.05 with centre-of-gravity uncertainty, applied through uniform factors [E16].
- **Supersonic and subsonic** [E15].
  - The EFT-1 reconstruction gives L/D of about 0.25 to 0.29 hypersonic, peaking near 0.38 around Mach 1.5.
  - CD runs from about 1.3 at Mach 1.6 to about 0.9 at Mach 0.4.
  - These curves compare the pre-EFT-1 database (v0.80) with EFT-1 flight data. They are not the Artemis database.
- **Hypersonic CD** is unverified (see Unverified). Keep it as a parameter until it is read from Bibb's figures.

**Implementation**

- One table must drive both the kernel force and the predictor, or the guidance will be biased.
- Dispersions for a later Monte Carlo: entry flight-path angle 0.1° and velocity 90 ft/s (3σ), and mass ±3.1 % (uniform) [E6].

### Step 3: guidance, stage A (S-M)

Change the predictor-corrector's bank from a constant to a value linear in an energy-like variable, as FNPEG does [E21]. Lu et al. (JGCD 40(2), 2017) compared FNPEG with PredGuid for Orion [E34]. FNPEG uses the same equations for skip and direct entry without phase logic [E21], so one algorithm covers both Artemis profiles. Re-implement the equations; do not copy the AIAA text.

### Step 4: guidance, stage B: PredGuid phases (L)

| Phase | What it does | Exit condition |
|---|---|---|
| 1 Initial roll | holds a preset bank; skip-out protection commands full lift-down [E5] | altitude rate above −700 ft/s (−213 m/s) [E5] |
| 2 Energy management | Apollo HUNTEST and constant drag [E5] | range error under 25 nmi [E6] |
| 3 Up control | predictor-corrector with estimated density and L/D [E5] | drag below 6.0 ft/s² (1.83 m/s²) [E6] |
| 4 Ballistic | low drag; keeps predicting, no commands below 1.6 ft/s² [E6] | drag above 6.5 ft/s² (1.98 m/s²) [E6] |
| 5 Final | Apollo final-phase controller, stored reference and gains, g-limiter [E5] | Earth-relative speed below 1,000 ft/s (305 m/s) [E6] |
| 6 Terminal | proportional heading guidance [E5] | forward bay cover chute deploy [E5] |

- **Status of the thresholds.** They are 2007 design values; the 2024 deck gives no flown thresholds [E5, E6].
- **Apollo phases.** Build phases 2 and 5 from Apollo's own flight code. Comanche055's `REENTRY_CONTROL.agc` is marked public domain and holds the initial roll, HUNTEST, the range and up-control logic and the final phase [E31]. Morth's MIT report R-532 derives the method [E32].
- **Cross-check.** The MSL derivative gives the final-phase equations in readable form [E20]:
  - predicted range from deviations in drag and altitude rate;
  - a commanded vertical L/D;
  - bank equal to K2·acos((L/D)vc / (L/D)), with K2 = ±1 switched at a deadband that is quadratic in velocity;
  - heading alignment capped at 30°.
- **Reference and gains.** Compute the reference trajectory and gains offline.
- **Bank limits.** No Orion bank-rate or bank-acceleration limits were found. The 15°/s and 5°/s² in the Pterodactyl study belong to a deployable entry vehicle [E21], so use them only as placeholders.

### Step 5: density and L/D estimator (S-M)

**Method**

- Estimate density from sensed acceleration, using Cx = 2 m a_x / (ρ V² S_ref) [E15].
- Take its ratio to the onboard model, bound it and average it.
- Estimate L/D from the lift and drag accelerations.
- In the 2007 design, the estimator ran when drag exceeded 2.0 ft/s² [E6].

**Limitation and fix**

- In the app the truth atmosphere below 86 km is the same US76, so an estimator would read about 1.0 [E30].
- To reproduce Artemis I's thinner air, give the kernel an atmosphere for the day: ERA5 pressure levels up to 1 hPa [E29], blended into NRLMSIS 2.1 (pymsis, MIT, already in the catalogue) above. ERA5 needs a Copernicus account, which needs approval. The simpler alternative is to impose a truth perturbation such as 10 % thinner air.
- The bank callback also needs the sensed acceleration passed through `kernelHost`.

### Step 6: staged parachutes (M)

| Stage | Hardware and timing | Trigger |
|---|---|---|
| FBC parachutes | 3 × ~7 ft, mortar-deployed [E17]; held 1.4 s, then the forward bay cover is jettisoned [E18]; pressure recovery behind the capsule 0.86 [E19] | smart deploy evaluated from 35,000 ft, floor 24,000 ft [E17] |
| Drogues | 2 × 23 ft variable-porosity conical ribbon; mortar fires 2.0 s after the FBC jettison [E18]; four reefing cutters each, two at 8 s and two at 16 s [E17]; projected diameters 8.73, 11.59 and 16.10 ft; pressure recovery 0.94 [E19] | follows the FBC jettison |
| Drogue release | | smart release evaluated from 6,800 ft, floor 5,600 ft, at least 7.4 s after drogue deploy [E17] |
| Pilots | 3 × 9.85 ft [E18] (10 ft in [E17], 11 ft in [E13]); main bags pulled out about 4.3 s later [E18] | drogue release |
| Mains | 3 × 116 ft quarter-spherical ringsails with three reefing stages, sized to land with one failed [E18]; projected diameters 9.87, 19.52 and 81.20 ft [E19]; canopy area π/4 × 116² ≈ 10,570 ft² each (derived; "nearly 11,000 ft²" in [E17]) | |
| Landing | reorientation enabled at 1,500 ft; thrusters keep roll control until touchdown [E17] | |

- **Artemis I triggers.** The FBC jettison sequence, including drogue deploy, started at the altitude floor. The mains were triggered by smart drogue release at minimum body rates [E18].
- **Inflation.** Model opening with a fill constant and an opening exponent for each reefing stage, as the CPAS work does [E19], rather than a first-order lag.
- **Drag areas.** The figures in Ray's charts are unverified. Calibrate the full-open main drag area to NASA's splash speed of about 17 mph [E13]. At 9,000 kg and sea-level density, that needs about 9,000 ft² of effective drag area per canopy; 3 × 10,900 ft² would give about 15 mph (derived).
- **Oracle.** RocketPy's parachute model (MIT) is a permissive check on terminal speed under canopy [R27, E39].

### Step 7: winds (S)

- **Why.** Under parachutes the trajectory depends on winds [E18]. The bank solution's no-wind assumption failed late in Artemis I's guided flight [E5].
- **Source.** Open-Meteo's Historical Forecast API gives pressure-level winds, temperature and geopotential height from 1000 to 30 hPa, about 110 m to 22 km [E27]. Fetch them for both splash areas and times, and apply them as air-relative velocity below 22 km.
- **Terms** [E27]:
  - the data are CC BY 4.0 and need an attribution link;
  - the free tier is for non-commercial use;
  - the server code is AGPLv3, so do not bundle or self-host it.
- The fetch needs approval.

### Step 8: heating readout (S)

Integrate Sutton and Graves' stagnation-point heating [E36] into a heat load. That shows why Artemis II dropped the skip [E10].

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

**Artemis II, 10 to 11 Apr 2026.** The blog values are planned times, so use tolerances of about ±1 min [E12].

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

- **Conflicting values.** NASA's heat-shield page gives a peak of Mach 39 [E11], while a preview article gives Mach 32 [E14]. Peak temperature is stated as above 4,000 °F [E11] and as about 3,000 °F in a general press-kit line [E13]. Neither belongs in a test.
- **Later validation cases.**
  - EFT-1 (Dec 2014), a direct entry whose reconstructed L/D and CD are already in [E15].
  - Apollo entries through NASA TN D-6725, which includes the Apollo 10 post-flight entry analysis [E33].
  - The Artemis I best estimated trajectory work [E35], which shows how NASA built the flown entry reference.

### Oracles for entry

- **Tudat (BSD-3; conda environment, needs approval; M).**
  - Use `us76` below 86 km and the custom density function to feed MET densities above, so that the comparison isolates lift and guidance [A26].
  - Use constant CL and CD to match `entry.js`, and replay the bank history from `entry.js` through `aerodynamic_angle_based` [A25]. Check the sign convention: in the orrery, +90° means left, towards r × v.
  - Stop the comparison at drogue deploy, using exact termination [A23].
  - Write our own script; the examples repo has no licence [A24].
- **SciPy `solve_ivp`** for event timing [A49], and **RocketPy** for descent under canopy [R27].
- **6-DOF entry in `sixdof.js`: L or more, not now.** Public data give the pitching moment only as plots, with no damping derivatives. The thruster force on record is a 2007 design value of 160 lbf [E6].

## 4. Rocketry cross-checks, step by step

### Step 0: prepare `ascent()` (no installs)

1. **Cd(Mach) (S).**
   - Accept a number, a function, or `{off, on}` tables in RocketPy's shape [R19].
   - Compute Mach from the temperature `standardAtmosphere` returns [R2]. The exponential default has no temperature.
   - Keep the constant default so that the Curtis Example 13.2, 13.3 and 13.7 tests still pass [R2].
   - Launcher tables must reach about Mach 8 [R32].
   - Record which trajectory each table came from, since a Cd taken from one simulation also depends on Reynolds number [R21].
2. **`.eng` thrust curves (M).**
   - Write our own parser; T(t) replaces the constant thrust.
   - Do not commit curve files while ThrustCurve's terms are unknown [R29].
   - Fetching curves from a browser is unproven, because CORS is undocumented [R30]. Users may need to supply the files.
3. **Sounding mode (S).**
   - Add a rail length and inclination, skip the pitchover, and stop at apogee.
   - Name the outputs as RocketPy does (apogee, apogee time, maximum speed, maximum Mach, maximum dynamic pressure and its time, rail-exit speed) [R20].

### Step 1: OpenRocket (installed; nothing new needed)

1. Design an independent test vehicle in the 24.12 GUI. Do not use a team design.
2. Run it headless through JPype [R4], with simulation listeners for an atmosphere profile, a drag scale and a stop at apogee [R5].
3. Pin the conditions:
   - a flat or spherical geodetic mode;
   - no wind;
   - standard sea-level conditions, or matching pad settings;
   - a vertical rail.
4. Export:
   - Cd against Mach, from a Component Analysis sweep [R9] or from the simulation's Cd and Mach columns;
   - the thrust and mass histories;
   - q = ½ρv², from the density and total-velocity columns [R3].
5. Commit only numbers, for example `src/physics/fixtures/openrocket_*.json`, with the OpenRocket version and the jar's SHA-256.
6. In `rocket.test.mjs`, feed the same Cd(Mach), curve and mass to `ascent()`.
   - Start with tolerances of 0.5 % on apogee and maximum speed, and 1 % on max-q.
   - Adjust them once measured. They are extrapolated from the 0.02 % point-mass closure [R1].
7. Use power-off Cd in both phases, because OpenRocket gives no power-on credit [R11].

### Step 2: RocketPy (needs `pip install rocketpy` in a separate venv; approval)

1. Use version 1.12 or later in 3-DOF mode (`PointMassRocket`, `PointMassMotor`) [R21, R22].
2. Set inclination to 90°, since the default is 80° [R20]. Use the same `.eng` file and drag CSV.
3. Dump the orrery's ascent to CSV and score it with `FlightComparator` [R23].
4. Weight agreement here below OpenRocket's, because the 3-DOF mode is young [R22].
5. RocketPy takes drag as an input [R19], so it cannot supply an independent, geometry-derived drag curve.

### Step 3: ThrustCurve.org (downloads need approval)

- Use the JSON endpoints within the rate and caching rules, and do not hotlink files [R29]. The ISC client is fine for the app [R30].
- Keep any downloaded curves local until their terms are known.

### Step 4: RASAero II (needs a Windows machine and approval to install)

1. Export the test vehicle to `.CDX1` with OpenRocket 24.12's RASAero exporter [R7].
2. In RASAero, set the nozzle exit diameter. Export the power-off and power-on aero tables (Mach 0.01 to 25) and the flight-simulation CSV [R17].
3. Rescale Cd to the orrery's reference diameter, as an earlier OpenRocket and RASAero comparison did [R1].
4. Use the power-off table to check Cd(Mach). Use the power-on table to calibrate a base-drag-under-thrust term, starting from OpenRocket's documented formula [R10].
5. Keep the tables local, since the terms are unstated [R17].

The value for launchers is modest. In Curtis Example 13.3 the drag loss is 298 m/s against a gravity loss of 1,410 m/s [R2], so a base-drag correction moves orbit insertion by a small fraction of the total. It matters more for high-power rockets, where it caused the largest code-to-code gap [R1].

### Step 5: launcher scale

- **OpenTsiolkovsky (M-L).** Use the hosted web app or a Rust build (approval) [R31].
  - Convert Isp(p) to its exit-area form: A_e = ṁ·g0·(Isp_vac − Isp_sl)/p0 (derived; both models are linear in p).
  - Turn wind off. Reconcile its time-tabulated attitude, which runs on stage-relative times, with the orrery's gravity turn.
  - Compare max-q (value and time), burnout altitude, speed and flight-path angle, and the gravity and drag losses.
  - The example vehicles' data have no documented source [R32].
- **Delta III benchmark** through YAPSS (MIT, pip install) [R42]. It uses the same model class as `ascent()`.
- **Dymos SSTO example** (Apache-2.0, already in the catalogue) [R44], as an optimal-ascent reference.
- **PEGAS** (MIT) [R43], as a reference if closed-loop insertion guidance is added.
- **NESC Case 17: L or more; the download needs approval.**
  - `sixdof.js` has constant mass and inertia, drag from a ballistic coefficient only, and no staging or aero tables. These must be added first.
  - Convert the DAVE-ML models once. NASA DAVEtools (NOSA 1.3) can be used as an outside converter only [R45].

### Skip

- orhelper [R14].
- RocketSerializer, unless a single-stage `.ork` to RocketPy route is needed [R15].
- Porting RocketPy's parachute model, which is a few lines [R27].
- A Barrowman build-up from geometry (L), unless amateur-rocket design comes into scope [R38].

## 5. Julia and JuliaHub

**Verdict: not now. Nothing to merge into the app.**

- **No runtime role.** Julia cannot run the kernel in the browser: no adaptive solver or route for the force models compiles to Wasm [J31].
- **JuliaHub is optional.** Julia and the open packages run locally [J1]. No current compute price is published [J3]. Using JuliaHub would mean an account, which is the owner's action. At most it is a place to run offline scripts.
- **Dyad, Multibody.jl and full ModelingToolkit stay out of the repo** [J4, J6, J7]. If acausal modelling is ever wanted for an oracle, use ModelingToolkitBase (MIT) only [J8].
- **Python covers the next work with less setup.** SciPy events and DOP853, SpiceyPy (already in `python/`), Orekit through the installed Java, and Tudat for entry. These avoid a third toolchain next to C and Python.

**When Julia would pay**

- **Derivatives through the solver.** ForwardDiff would give exact state-transition matrices and burn Jacobians [J21]. Today Newton convergence can be watched directly in JS, so the value is low.
- **Very large Monte Carlo runs.** `EnsembleProblem` would handle them [J20]. The JS worker can already run thousands of 3-DOF entries, and footprints drawn in the app should come from the app's own model.
- **Taylor-method or time-scale checks.** TaylorIntegration.jl [J26] or AstroTime.jl [J39] could check the leap-second clock bug.
- **Not for extended precision.** Float64 at a tolerance of 1e-14 is far below the kernel's 1e-7 km per step, and the DE442 data are Float64 anyway.

**If Julia is adopted later**

- Add a `julia/` folder beside `c/` and `python/`, with MIT dependencies only.
- Commit `Manifest.toml` and write the package versions into each fixture.
- A propagation oracle that really separates integrator error from force-model error must copy the JS force model exactly: the GM set, EGM2008 normalisation and tide system, SRP shadows, relativity, and MET drag (which Julia lacks [J25]). That makes it L, not M.
- Use DiffEqDevTools (MIT) to prove the order of any ported tableau [J35].
- Installs need approval: juliaup, the packages, and ICGEM gravity files.

## 6. Catalogue rows

### Rows to correct

- **ModelingToolkit.jl / SciML.** The "MIT" licence is incomplete. Full MTK v11 depends on AGPL-3.0 packages, and only ModelingToolkitBase is MIT throughout [J7, J8].
- **Tudat / tudatpy.** The tudat C++ repo was archived on 14 Jan 2026; the source is now in tudatpy [J41].
- **OpenRocket.** 24.12 (27 Jul 2025) is still the latest release as of 14 Nov 2026 [R9].
- **RASAero II.** The row says "Wine on Linux", but this machine has no Wine [R1].
- **Orbiter.** Add the Technical Reference `dynamics.tex` link [T2] and the digital-orrery tag.
- **The practice-guides index is stale.** Run `eng catalog --reindex` [C1].

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

- The Artemis I entry state in AAS 24-174 Table 1. Only the 400,000 ft altitude and a latitude near −25.83° are supported; the velocity, flight-path angle, azimuth and longitude are not. The PDF is over the fetch limit [E22].
- Bibb 2011's hypersonic CD of about 1.33 to 1.40 and CL of about 0.40 to 0.35 near trim [E16].
- Ray 2017's drogue drag areas (about 112, 158 and 250 ft² per canopy) and main reefing ratios (about 3.5 % and 16 %), which would be read from figures [E19].
- The AIAA paper number "2007-6424" for Rea & Putnam [E6].
- The in-plane open-loop reference run detail in Mendeck & Craig [E20].
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

- Whether Verner's website restricted redistribution of the coefficient files. Indexed text suggested it did, but the site returns 404 [J34].
- JuliaHub's current compute terms [J2, J3].
- Whether SatelliteToolboxGravityModels handles lunar ICGEM files (GM, radius, normalisation).
- Whether SatelliteToolboxGravityModels and Ephemerides.jl accept BigFloat, and whether Vern9 runs with Double64.
- Whether GMAT R2026a has been released. The checker saw signs of an April 2026 announcement but recorded no URL.
- Whether DE442 is published as a JPL binary file that Orekit's loader can read.
- Whether boinor keeps poliastro's event classes.
- The details of Orekit's propagate-ahead ephemeris generation (its pages were blocked).

**Real-time**

- The full text of Axelsson et al. 2017 (float depth buffers, interval arithmetic). Only its listing on OpenSpace's academic page is confirmed [T9].
- web.dev's CC BY 4.0 licence.
- Whether WebGPU is on by default on this machine's GPU.

## 7. Sources

Local files are given as repo-relative paths or as `~/` paths on the author's machine.

**Catalogue**

- C1. Engineering resource catalogue, through eng-tools `catalog_search`: the author's engineering resource catalogue (local)

**Julia and SciML**

- J1. JuliaHub help: https://help.juliahub.com/juliahub/stable/
- J2. JuliaHub standard tier post (May 2023): https://juliahub.com/blog/standard-tier-free-to-start
- J3. JuliaHub pricing: https://juliahub.com/pricing
- J4. Dyad pricing: https://juliahub.com/pricing/dyad ; product page: https://juliahub.com/products/juliasim
- J5. Dyad launch post: https://juliahub.com/blog/juliahub-launches-dyad
- J6. Multibody.jl licence: https://raw.githubusercontent.com/JuliaComputing/Multibody.jl/main/LICENSE ; repo: https://github.com/JuliaComputing/Multibody.jl
- J7. ModelingToolkit v11 post: https://sciml.ai/news/2026/07/27/ModelingToolkitv11/index.html
- J8. StateSelection.jl: https://github.com/JuliaComputing/StateSelection.jl
- J9. MTK v11 licensing thread: https://discourse.julialang.org/t/modelingtoolkit-v11-library-split-and-licensing-community-feedback-requested/134396
- J10. OrdinaryDiffEq.jl: https://github.com/SciML/OrdinaryDiffEq.jl
- J11. ODE solver guide: https://docs.sciml.ai/DiffEqDocs/stable/solvers/ode_solve/
- J12. Dynamical ODE solvers: https://docs.sciml.ai/DiffEqDocs/stable/solvers/dynamical_solve/
- J13. Three-body benchmark: https://docs.sciml.ai/SciMLBenchmarksOutput/stable/NonStiffODE/ThreeBody_wpd/
- J14. Pleiades benchmark: https://docs.sciml.ai/SciMLBenchmarksOutput/stable/NonStiffODE/Pleiades_wpd/
- J15. Hénon-Heiles benchmark: https://docs.sciml.ai/SciMLBenchmarksOutput/stable/DynamicalODE/Henon-Heiles_energy_conservation_benchmark/
- J16. Kepler example: https://docs.sciml.ai/DiffEqDocs/dev/examples/kepler_problem/
- J17. SciMLBase callbacks: https://github.com/SciML/SciMLBase.jl/blob/master/src/callbacks.jl
- J18. Number types showcase: https://docs.sciml.ai/Overview/dev/showcase/ode_types/
- J19. Rackauckas & Nie 2017, JORS: https://openresearchsoftware.metajnl.com/articles/10.5334/jors.151
- J20. Ensembles: https://docs.sciml.ai/DiffEqDocs/stable/features/ensemble/
- J21. SciMLSensitivity: https://docs.sciml.ai/SciMLSensitivity/stable/
- J22. SatelliteToolbox.jl: https://github.com/JuliaSpace/SatelliteToolbox.jl
- J23. SatelliteToolboxGravityModels: https://juliaspace.github.io/SatelliteToolboxGravityModels.jl/stable/ ; https://github.com/JuliaSpace/SatelliteToolboxGravityModels.jl
- J24. ICGEM celestial models: https://icgem.gfz.de/tom_celestial
- J25. SatelliteToolboxAtmosphericModels: https://juliaspace.github.io/SatelliteToolboxAtmosphericModels.jl/stable/ ; SpaceIndices.jl: https://github.com/JuliaSpace/SpaceIndices.jl
- J26. TaylorIntegration.jl: https://github.com/PerezHz/TaylorIntegration.jl ; https://perezhz.github.io/TaylorIntegration.jl/stable/kepler/ ; https://github.com/PerezHz/PlanetaryEphemeris.jl ; https://github.com/PerezHz/NEOs.jl
- J27. Ephemerides.jl: https://github.com/JuliaSpaceMissionDesign/Ephemerides.jl ; SPICE.jl: https://github.com/JuliaAstro/SPICE.jl
- J28. Astrodynamics.jl: https://github.com/helgee/Astrodynamics.jl ; AstroForceModels.jl: https://github.com/HAMMERHEAD-Space/AstroForceModels.jl
- J29. EntryGuidance.jl: https://github.com/RoboticExplorationLab/EntryGuidance.jl
- J30. Julia THIRDPARTY.md: https://github.com/JuliaLang/julia/blob/master/THIRDPARTY.md
- J31. WasmTarget.jl: https://github.com/GroupTherapyOrg/WasmTarget.jl
- J32. WebAssemblyCompiler.jl: https://tshort.github.io/WebAssemblyCompiler.jl/stable ; Julia 1.12 highlights: https://julialang.org/blog/2025/10/julia-1.12-highlights/
- J33. Eichhorn et al. 2016, ESA: https://indico.esa.int/event/111/contributions/266/attachments/348/389/paper.pdf
- J34. verner_tableaus.jl: https://github.com/SciML/OrdinaryDiffEq.jl/blob/master/lib/OrdinaryDiffEqVerner/src/verner_tableaus.jl
- J35. DiffEqDevTools: https://github.com/SciML/OrdinaryDiffEq.jl/tree/master/lib/DiffEqDevTools
- J36. IRKGaussLegendre.jl: https://github.com/SciML/IRKGaussLegendre.jl
- J37. GeometricIntegrators.jl: https://github.com/JuliaGNI/GeometricIntegrators.jl
- J38. Modelica Standard Library: https://github.com/modelica/ModelicaStandardLibrary
- J39. AstroTime.jl: https://github.com/JuliaAstro/AstroTime.jl
- J40. Tracy et al., robust entry guidance: https://rexlab.ri.cmu.edu/papers/robust_edl_ktracy.pdf
- J41. tudat (archived): https://github.com/tudat-team/tudat

**Rocketry**

- R1. OpenRocket vs RASAero comparison: the author's earlier comparison notes (local, not public)
- R2. `src/physics/rocket.js`, `src/physics/rocket.test.mjs`, `src/physics/atmosphere.js` (repo)
- R3. OpenRocket 24.12, installed locally
- R4. the author's local JPype runner (not public)
- R5. the author's local JPype runner (not public)
- R6. the author's local `.ork` design files (not public)
- R7. OpenRocket repo: https://github.com/openrocket/openrocket
- R8. OpenRocket features: https://openrocket.readthedocs.io/en/latest/introduction/features.html
- R9. OpenRocket releases: https://github.com/openrocket/openrocket/releases ; https://api.github.com/repos/openrocket/openrocket/releases?per_page=4
- R10. OpenRocket technical documentation v13.05 (UMN mirror): https://dept.aem.umn.edu/~./faculty/flaten/Rocketry_Remote_Lessons_Fall_2021/OpenRocketTechnicalDocumentationVersion13_05.pdf
- R11. BarrowmanCalculator.java: https://raw.githubusercontent.com/openrocket/openrocket/master/core/src/main/java/info/openrocket/core/aerodynamics/BarrowmanCalculator.java
- R12. Simulation extensions: https://wiki.openrocket.info/Simulation_Extensions
- R13. ScriptingExtension.java: https://raw.githubusercontent.com/openrocket/openrocket/master/core/src/main/java/info/openrocket/core/simulation/extension/impl/ScriptingExtension.java
- R14. orhelper: https://github.com/SilentSys/orhelper ; https://raw.githubusercontent.com/SilentSys/orhelper/master/orhelper/_orhelper.py
- R15. RocketSerializer: https://github.com/RocketPy-Team/RocketSerializer
- R16. RASAero home: https://www.rasaero.com/home.htm
- R17. RASAero II download: https://www.rasaero.com/dl_software_ii.htm
- R18. RocketPy on PyPI: https://pypi.org/project/rocketpy/
- R19. RocketPy Rocket: https://docs.rocketpy.org/en/latest/reference/classes/Rocket.html
- R20. RocketPy Flight: https://docs.rocketpy.org/en/latest/reference/classes/Flight.html
- R21. RocketPy releases: https://github.com/RocketPy-Team/RocketPy/releases
- R22. RocketPy PR 745: https://github.com/RocketPy-Team/RocketPy/pull/745
- R23. RocketPy PR 888: https://github.com/RocketPy-Team/RocketPy/pull/888
- R24. RocketPy equations of motion: https://docs.rocketpy.org/en/latest/technical/equations_of_motion.html
- R25. RocketPy Environment: https://docs.rocketpy.org/en/latest/reference/classes/Environment.html
- R26. RocketPy SolidMotor: https://docs.rocketpy.org/en/latest/reference/classes/motors/SolidMotor.html
- R27. RocketPy Parachute: https://docs.rocketpy.org/en/latest/reference/classes/Parachute.html
- R28. RocketPy SciPy 2022 paper: https://proceedings.scipy.org/articles/majora-212e5952-020
- R29. ThrustCurve llms.txt: https://www.thrustcurve.org/llms.txt
- R30. @thrustcurve/api1: https://unpkg.com/@thrustcurve/api1@1.0.3/package.json ; https://unpkg.com/@thrustcurve/api1@1.0.3/README.md
- R31. OpenTsiolkovsky physics: https://raw.githubusercontent.com/istellartech/OpenTsiolkovsky/master/docs/physics.md ; app: https://open-tsiolkovsky.vercel.app/
- R32. OpenTsiolkovsky Saturn V example: https://raw.githubusercontent.com/istellartech/OpenTsiolkovsky/master/examples/saturn-v.json
- R33. MAPLEAF: https://github.com/henrystoldt/MAPLEAF
- R34. NESC flight-sim 2015: https://nescacademy.nasa.gov/flightsim/2015
- R35. NESC Atmospheric Case 17: https://nescacademy.nasa.gov/flightsim/2015/atmospheric/acc17
- R36. NESC Bodies: https://nescacademy.nasa.gov/flightsim/2015/bodies
- R37. `src/physics/nesc.fetch.mjs`, `src/physics/nesc.test.mjs` (repo)
- R38. Barrowman 1967: https://ntrs.nasa.gov/citations/20010047838
- R39. CamPyRoS: https://github.com/cuspaceflight/CamPyRoS
- R40. tudatpy two-stage ascent example: https://github.com/tudat-team/tudatpy-examples/blob/master/propagation/two_stage_rocket_ascent.py
- R41. GPL FAQ: https://www.gnu.org/licenses/gpl-faq.html#GPLOutput ; https://www.gnu.org/licenses/gpl-faq.html#WhatCaseIsOutputGPL
- R42. YAPSS Delta III: https://yapss.readthedocs.io/en/stable/notebooks/delta_iii_ascent.html ; https://github.com/stevenrhall/yapss
- R43. PEGAS: https://github.com/Noiredd/PEGAS
- R44. Dymos SSTO: https://openmdao.org/dymos/docs/latest/examples/ssto_earth/ssto_earth.html
- R45. NASA DAVEtools: https://github.com/nasa/DAVEtools

**Astrodynamics**

- A1. `docs/physics/nbody-kernel.md` (repo)
- A2. `src/physics/entry.js`, `src/physics/environment.js`, `src/physics/craft.js` (repo, uncommitted)
- A3. `src/physics/encke.js` (repo)
- A4. `src/physics/nbody.js` (repo)
- A5. `docs/physics/environment.md` (repo)
- A6. GMAT: https://github.com/nasa/GMAT
- A7. GMAT propagators: https://github.com/nasa/GMAT/tree/main/src/base/propagator
- A8. DormandElMikkawyPrince68.hpp: https://raw.githubusercontent.com/nasa/GMAT/main/src/base/propagator/DormandElMikkawyPrince68.hpp
- A9. PrinceDormand78.cpp: https://raw.githubusercontent.com/nasa/GMAT/main/src/base/propagator/PrinceDormand78.cpp
- A10. RelativisticCorrection.cpp: https://raw.githubusercontent.com/nasa/GMAT/main/src/base/forcemodel/RelativisticCorrection.cpp
- A11. GMAT solarsys: https://github.com/nasa/GMAT/tree/main/src/base/solarsys
- A12. GMAT R2025a announcement: https://gmat.atlassian.net/wiki/spaces/GW/blog/2025/05/16/2962227204/Announcing+GMAT+R2025a+Release
- A13. GMAT NASA usage: https://gmat.atlassian.net/wiki/spaces/GW/pages/380273244/NASA+Usage
- A14. Hughes et al. 2014: https://ntrs.nasa.gov/citations/20140017798
- A15. GMAT.jl: https://docs.juliahub.com/General/GMAT/stable/autodocs/ ; https://github.com/JuliaSpace/GMAT.jl
- A16. Orekit overview: https://raw.githubusercontent.com/CS-SI/Orekit/develop/src/site/markdown/index.md
- A17. Orekit propagation: https://raw.githubusercontent.com/CS-SI/Orekit/develop/src/site/markdown/architecture/propagation.md
- A18. Hipparchus non-stiff: https://github.com/Hipparchus-Math/hipparchus/tree/master/hipparchus-ode/src/main/java/org/hipparchus/ode/nonstiff
- A19. orekit-jpype: https://pypi.org/project/orekit-jpype/
- A20. DSST validation abstract: https://indico.esa.int/event/111/contributions/248
- A21. tudatpy: https://github.com/tudat-team/tudatpy
- A22. Tudat integrator set-up: https://docs.tudat.space/en/latest/_src_user_guide/state_propagation/propagation_setup/integration_setup.html
- A23. Tudat propagators: https://py.api.tudat.space/en/latest/propagator.html
- A24. tudatpy re-entry example: https://raw.githubusercontent.com/tudat-team/tudatpy-examples/master/propagation/reentry_trajectory.py
- A25. Tudat rotation models: https://py.api.tudat.space/en/latest/rotation_model.html
- A26. Tudat atmospheres: https://py.api.tudat.space/en/latest/atmosphere.html
- A27. Basilisk: https://hanspeterschaub.info/basilisk/
- A28. bsk on PyPI: https://pypi.org/project/bsk/
- A29. Basilisk integrators: https://hanspeterschaub.info/basilisk/examples/scenarioIntegrators.html
- A30. Basilisk drag de-orbit: https://hanspeterschaub.info/basilisk/examples/scenarioDragDeorbit.html
- A31. NASA 42 slides: https://ntrs.nasa.gov/api/citations/20180000954/downloads/20180000954.pdf
- A32. NASA 42 licence: https://github.com/ericstoneking/42/tree/master/License ; https://software.nasa.gov/software/GSC-16720-1
- A33. Trick integrators: https://nasa.github.io/trick/documentation/simulation_capabilities/Integrator
- A34. Trick dynamic events: https://nasa.github.io/trick/tutorial/ATutDynamicEvents
- A35. NASA JEOD: https://github.com/nasa/jeod
- A36. poliastro events: https://docs.poliastro.space/en/stable/examples/Detecting%20Events.html ; https://docs.poliastro.space/en/stable/autoapi/poliastro/twobody/propagation/index.html ; https://github.com/poliastro/poliastro
- A37. boinor: https://github.com/boinor/boinor ; hapsira: https://github.com/pleiszenburg/hapsira
- A38. JPL MONTE: https://montepy.jpl.nasa.gov/static/document/brochure.pdf ; https://montepy.jpl.nasa.gov
- A39. Berry & Healy 2004: https://drum.lib.umd.edu/handle/1903/2202
- A40. Berry & Healy 2002: https://drum.lib.umd.edu/items/390b0d98-cb92-4bc6-87ce-2dff7904808c/full
- A41. Berry & Healy 2005: https://drum.lib.umd.edu/items/4e0db7ea-63b5-43d7-b969-9ec8655bec14/full
- A42. Atallah et al. 2019: https://mae.ucf.edu/ASRL/wp-content/uploads/2020/07/Atallah2019_Article_AccuracyAndEfficiencyCompariso.pdf
- A43. Amato et al. 2019: https://export.arxiv.org/abs/1810.11418
- A44. THALASSA: https://gitlab.com/souvlaki/thalassa ; https://ascl.net/1905.018
- A45. Baù et al. 2016: https://indico.esa.int/event/111/contributions/288/
- A46. Biscani & Izzo 2021: https://arxiv.org/abs/2105.00800 ; heyoka: https://github.com/bluescarni/heyoka
- A47. Biscani & Izzo 2022: https://arxiv.org/abs/2204.09948
- A48. Fehlberg, NASA TR R-287: https://ntrs.nasa.gov/citations/19680027281
- A49. SciPy solve_ivp: https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html
- A50. NAIF Geometry Finder: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/gf.html
- A51. CNES PATRIUS: https://patrius.cnes.fr
- A52. NASA POST2: https://software.nasa.gov/software/LAR-20550-1

**Entry**

- E1. NASA, Artemis I flight day 26, CM separation: https://www.nasa.gov/blogs/missions/2022/12/11/artemis-i-flight-day-26-orion-crew-module-separation-from-service-module-complete/
- E2. NASA, Artemis I splashdown: https://www.nasa.gov/blogs/missions/2022/12/11/artemis-i-flight-day-26-orion-splashes-down-concluding-historic-artemis-i-mission/
- E3. Spaceflight Now, Artemis I return: https://spaceflightnow.com/2022/12/11/artemis-1-back-on-earth-after-near-flawless-25-day-moon-mission/
- E4. SpacePolicyOnline, Artemis I splashdown: https://spacepolicyonline.com/news/splashdown-orion-home-from-the-moon/
- E5. Rea, McNamara & Kane, AAS 24-174 (slides): https://ntrs.nasa.gov/api/citations/20240001314/downloads/AAS_24_174_Orion_Artemis_I_Entry_Performance.pptx
- E6. Rea & Putnam 2007, A Comparison of Two Skip Entry Guidance Algorithms: https://ntrs.nasa.gov/citations/20070023643 ; https://ntrs.nasa.gov/api/citations/20070023643/downloads/20070023643.pdf
- E7. Gay et al., AAS 24-171: https://ntrs.nasa.gov/api/citations/20240001457/downloads/AAS_24_171%20Retrospective%20on%20Orion%20GNC%20Design%20v1.pdf
- E8. NASA 2021, skip entry on Artemis I: https://www.nasa.gov/feature/orion-spacecraft-to-test-new-entry-technique-on-artemis-i-mission ; now at https://www.nasa.gov/missions/orion-spacecraft-to-test-new-entry-technique-on-artemis-i-mission/
- E9. Ferguson et al. 2026, Ablation Workshop: https://ntrs.nasa.gov/api/citations/20260006849/downloads/AWS_2026_Abstract_AR2_Ferguson.pdf
- E10. NASA, Artemis I heat-shield cause (Dec 2024): https://www.nasa.gov/missions/artemis/nasa-identifies-cause-of-artemis-i-orion-heat-shield-char-loss
- E11. NASA, Artemis II heat-shield analysis (Oct 2026): https://www.nasa.gov/news/artemis/rigorous-analysis-confirms-nasas-artemis-ii-heat-shield-performance/
- E12. NASA, Artemis II flight day 9: https://www.nasa.gov/blogs/missions/2026/04/09/artemis-ii-flight-day-9-crew-prepares-to-come-home/
- E13. Artemis II press kit: https://www.nasa.gov/artemis-ii-press-kit
- E14. SpacePolicyOnline, Artemis II preview: https://spacepolicyonline.com/news/artemis-ii-getting-ready-for-splashdown-tomorrow/
- E15. Mazaheri, Bibb & Lessard, IPPW 2026: https://ntrs.nasa.gov/api/citations/20260004998/downloads/IPPW-2026-V5.pdf
- E16. Bibb et al. 2011, AIAA 2011-3506: https://ntrs.nasa.gov/api/citations/20110013644/downloads/20110013644.pdf
- E17. Daum 2026, Artemis II CPAS: https://ntrs.nasa.gov/api/citations/20260003320/downloads/aiaa_paper_2026_final.pdf
- E18. Bihari, Kane & Moen 2024, Artemis I descent: https://ntrs.nasa.gov/api/citations/20240001180/downloads/AAS_24_Orion_Artemis_I_Descent_Performance_FINAL.pptx
- E19. Ray 2017, CPAS forebody wake: https://ntrs.nasa.gov/api/citations/20170004357/downloads/20170004357.pdf
- E20. Mendeck & Craig, MSL entry guidance: https://ntrs.nasa.gov/api/citations/20110013204/downloads/20110013204.pdf
- E21. Pterodactyl / FNPEG, SciTech 2020: https://ntrs.nasa.gov/api/citations/20200000239/downloads/20200000239.pdf
- E22. AAS 24-174 paper (PDF): https://ntrs.nasa.gov/api/citations/20240000024/downloads/AAS_24_174_Orion_Artemis_I_Entry_Performance.pdf
- E23. Dymos shuttle re-entry: https://openmdao.org/dymos/docs/latest/examples/reentry/reentry.html
- E24. JuMP shuttle re-entry: https://jump.dev/JuMP.jl/stable/tutorials/nonlinear/space_shuttle_reentry_trajectory/ ; licence: https://github.com/jump-dev/JuMP.jl/blob/master/LICENSE.md
- E25. AMAT: https://github.com/athulpg007/AMAT ; https://amat.readthedocs.io/en/master/examples/example-17-apollo-4-earth.html
- E26. NASA GRAM Suite: https://software.nasa.gov/software/MFS-33888-1
- E27. Open-Meteo Historical Forecast API: https://open-meteo.com/en/docs/historical-forecast-api ; licence: https://open-meteo.com/en/licence
- E28. Open-Meteo Historical Weather API: https://open-meteo.com/en/docs/historical-weather-api
- E29. ERA5 pressure levels: https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels
- E30. `src/physics/artemis1.fetch.mjs`, the Artemis II design notes and `src/physics/environment.js` (repo)
- E31. Comanche055 REENTRY_CONTROL.agc: https://ibiblio.org/apollo/listings/Comanche055/REENTRY_CONTROL.agc.html
- E32. Morth, R-532: https://www.ibiblio.org/apollo/Documents/R-532_Vol1_Reentry_Guidance_for_Apollo.pdf
- E33. Graves & Harpold, TN D-6725: https://ntrs.nasa.gov/archive/nasa/casi.ntrs.nasa.gov/19720013191.pdf
- E34. AAS 26-602 poster, citing Lu et al. 2017: https://ntrs.nasa.gov/api/citations/20260006141/downloads/AAS%2026-602%20Apollo%20vs%20FNPEG%20Comparison%20Poster%20LARGE.pdf
- E35. Gualdoni et al., AAS 23-330: https://d1io3yog0oux5.cloudfront.net/_bf005d45e926a3f2e3440d749ee935bb/draper/db/2545/24039/document/AAS_23-330_rev1.pdf
- E36. Sutton & Graves, NASA TR R-376: https://ntrs.nasa.gov/citations/19720003329
- E37. NESC flight-sim Vol I: https://ntrs.nasa.gov/citations/20150001263
- E38. NESC flight-sim 2023: https://nescacademy.nasa.gov/flightsim/2023
- E39. RocketPy rocket usage: https://docs.rocketpy.org/en/latest/user/rocket/rocket_usage.html

**Real-time browser simulation**

- T1. Fiedler, Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/
- T2. Orbiter Technical Reference, dynamics: https://raw.githubusercontent.com/orbitersim/orbiter/main/Doc/Orbiter%20Technical%20Reference/dynamics.tex
- T3. Orbiter orbit stabilisation: https://raw.githubusercontent.com/orbitersim/orbiter/main/Html/Main/extra_orbitstab.htm
- T4. Orbiter linear propagation: https://raw.githubusercontent.com/orbitersim/orbiter/main/Html/Main/extra_linprop.htm
- T5. Universe Sandbox, Alpha 13: https://universesandbox.com/blog/?p=1068
- T6. Universe Sandbox, n-body post: https://universesandbox.com/blog/?p=1704
- T7. Principia concepts: https://github.com/mockingbirdnest/Principia/wiki/Concepts
- T8. OpenSpace time API: https://docs.openspaceproject.com/latest/reference/scripting-api/openspace.time.html
- T9. OpenSpace academics: https://docs.openspaceproject.com/latest/about/academics.html
- T10. Celestia univcoord.h: https://raw.githubusercontent.com/CelestiaProject/Celestia/master/src/celengine/univcoord.h
- T11. Celestia render.cpp: https://raw.githubusercontent.com/CelestiaProject/Celestia/master/src/celengine/render.cpp
- T12. Ohlarik, Precisions, Precisions: https://help.agi.com/STKComponents/html/BlogPrecisionsPrecisions.htm
- T13. Godot large world coordinates: https://docs.godotengine.org/en/stable/tutorials/physics/large_world_coordinates.html
- T14. Reed, Visualizing Depth Precision: https://developer.nvidia.com/blog/visualizing-depth-precision/
- T15. Outerra, log depth: https://outerra.blogspot.com/2013/07/logarithmic-depth-buffer-optimizations.html
- T16. three.js reversed-depth example: https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_reversed_depth_buffer.html
- T17. three.js forum, log depth cost: https://discourse.threejs.org/t/beware-of-logarithmic-depth-buffer-it-can-degrade-scene-performance/88495
- T18. EXT_clip_control support: https://web3dsurvey.com/webgl/extensions/EXT_clip_control ; https://registry.khronos.org/webgl/extensions/EXT_clip_control
- T19. Firefox bug 1885031: https://bugzilla.mozilla.org/show_bug.cgi?id=1885031
- T20. MDN SharedArrayBuffer: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- T21. web.dev COOP and COEP: https://web.dev/articles/coop-coep
- T22. GitHub Pages headers discussion: https://github.com/orgs/community/discussions/13309
- T23. Emscripten pthreads: https://emscripten.org/docs/porting/pthreads.html
- T24. Emscripten SIMD: https://emscripten.org/docs/porting/simd.html
- T25. Emscripten licence: https://emscripten.org/docs/introducing_emscripten/emscripten_license.html
- T26. wasm-bindgen-rayon: https://docs.rs/crate/wasm-bindgen-rayon/latest
- T27. Jangda et al. 2019: https://usenix.org/conference/atc19/presentation/jangda
- T28. Surma 2021: https://surma.dev/things/js-to-asc/
- T29. MDN transferable objects: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- T30. MDN Atomics.wait: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/wait
- T31. MDN requestAnimationFrame: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- T32. Chrome 88 timer throttling: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- T33. MDN OffscreenCanvas: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- T34. MDN hardwareConcurrency: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency
- T35. web.dev, WebGPU in major browsers: https://web.dev/blog/webgpu-supported-major-browsers
- T36. Chrome, new in WebGPU 144: https://developer.chrome.com/blog/new-in-webgpu-144
- T37. WGSL specification: https://www.w3.org/TR/WGSL/
- T38. public-gpu list, Apr 2022: https://lists.w3.org/Archives/Public/public-gpu/2022Apr/0006.html
- T39. three.js WebGPURenderer manual: https://raw.githubusercontent.com/mrdoob/three.js/dev/manual/pages/webgpurenderer.html
- T40. GPU Gems 3, ch. 31: https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-31-fast-n-body-simulation-cuda
- T41. webgpu-samples: https://github.com/webgpu/webgpu-samples
- T42. spacekit: https://github.com/typpo/spacekit ; https://raw.githubusercontent.com/typpo/spacekit/master/src/shaders.ts
- T43. NAIF SPK Required Reading: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html
- T44. Rein & Tamayo 2015, WHFast: https://arxiv.org/abs/1506.01084
- T45. Rein 2026, REBOUND in the browser: https://arxiv.org/abs/2602.06735
- T46. ECMAScript Math object: https://read262.netlify.app/numbers-and-dates/math-object
- T47. CSPICE spkw13_c: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkw13_c.html
- T48. MDN EXT_disjoint_timer_query: https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query
- T49. Spector.js: https://github.com/BabylonJS/Spector.js
- T50. AssemblyScript: https://github.com/AssemblyScript/assemblyscript
- T51. Repo and installed code: `src/physics/kernelClient.js`, `src/physics/kernelHost.js`, `src/physics/craft.js`, `src/physics/geopotential.js`, `src/app/clock.ts`, `src/scene/OrreryScene.ts`, `node_modules/three/src/renderers/webgl/WebGLCapabilities.js`, `node_modules/three/src/renderers/webgl-fallback/WebGLBackend.js`
