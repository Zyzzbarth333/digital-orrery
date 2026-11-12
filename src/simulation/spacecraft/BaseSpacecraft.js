// src/simulation/spacecraft/BaseSpacecraft.js
import * as THREE from 'three';
import { 
  AU_TO_KM, SECONDS_PER_DAY,
  SPACECRAFT_DEFAULTS, GRAVITATIONAL_PARAMETERS, VISUAL_SETTINGS
} from '../../utils/constants.js';
import { OrbitalMechanics } from '../OrbitalMechanics.js';
import { solarSystemBodies, bodyConstants } from '../../physics/bodies.js';
import { KERNEL_EPOCH_MS, kernelSeconds, stepCraft } from '../../physics/kernelHost.js';
import { propagate } from '../../physics/orbital.js';
import { primaryOf, accelHeliocentric } from '../../physics/nbody.js';
import { helioStateEqj } from '../../physics/ephemeris.js';

// Body set for crafts stepped on this thread (no KernelClient: scripts and
// tests). Crafts in the app are stepped by the KernelClient, usually in a
// Web Worker, through the same stepCraft.
let syncBodies = null;
function getSyncBodies() {
  if (!syncBodies) syncBodies = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  return syncBodies;
}
let nextKernelId = 1;

// The scene is three.js y-up with astronomy-engine's EQJ axes mapped as
// (x, z, -y); the kernel works in EQJ km. These convert between the two.
function sceneToEqj(v, scale = 1) { return [v.x * scale, -v.z * scale, v.y * scale]; }
function eqjToScene(a, target, scale = 1) { return target.set(a[0] * scale, a[2] * scale, -a[1] * scale); }
import { SpacecraftSystems } from './SpacecraftSystems.js';
import { ManoeuvreNode } from './ManoeuvreNode.js';

/**
 * Unified spacecraft class combining basic and enhanced functionality
 * Supports both simple and complex spacecraft with optional systems
 */
export class BaseSpacecraft {
  constructor(name, initialState = {}, config = {}) {
    // Core properties
    this.name = name;
    this.createdAt = new Date();
    this.type = config.type || 'basic'; // 'basic' or 'enhanced'
    
    // Physics state - ensure safe initial position
    const safePosition = initialState.position || [1, 0, 0];
    // Never start at Sun's center
    if (Array.isArray(safePosition) && safePosition[0] === 0 && safePosition[1] === 0 && safePosition[2] === 0) {
      safePosition[0] = 1; // Default to 1 AU
    }
    this.position = new THREE.Vector3(...safePosition); // AU
    this.velocity = new THREE.Vector3(...(initialState.velocity || [0, 30, 0])); // km/s
    this.acceleration = new THREE.Vector3(); // m/s²
    
    // Warning flags
    this._warnedInvalidPosition = false;
    
    // Spacecraft properties
    this.mass = initialState.mass || SPACECRAFT_DEFAULTS.mass; // kg
    this.fuelMass = initialState.fuelMass || SPACECRAFT_DEFAULTS.fuelMass; // kg
    this.exhaustVelocity = initialState.exhaustVelocity || SPACECRAFT_DEFAULTS.exhaustVelocity; // m/s
    this.thrustPower = initialState.thrustPower || SPACECRAFT_DEFAULTS.thrustPower; // N
    
    // Mission state
    this.thrustVector = new THREE.Vector3();
    this.engineOn = false;
    this.missionElapsedTime = 0;
    
    // Trajectory tracking
    this.trajectory = [];
    this.maxTrajectoryPoints = VISUAL_SETTINGS.trailLength;
    
    // Enhanced features (optional)
    if (this.type === 'enhanced' || config.systems) {
      this.systems = new SpacecraftSystems(config.systemConfig || config);
      this.manoeuvreNodes = [];
      this.executingManoeuvre = null;
      this.missionPhase = 'CRUISE';
      this.targetBody = null;
      this.telemetryHistory = [];
      this.maxTelemetryPoints = 1000;
    }
    
    // Visual elements
    this.createVisuals();
  }

  /* ===================================
     VISUAL CREATION - MODULAR APPROACH
     =================================== */
  
  createVisuals() {
    // Create appropriate visuals based on type
    if (this.type === 'enhanced' && this.systems) {
      this.mesh = this.createEnhancedMesh();
    } else {
      this.mesh = this.createBasicMesh();
    }
    
    this.trajectoryLine = this.createTrajectoryLine();
    this.thrustIndicator = this.createThrustIndicator();
  }
  
  createBasicMesh() {
    const geometry = new THREE.ConeGeometry(0.005, 0.02, 8);
    geometry.rotateX(Math.PI / 2);
    
    const material = new THREE.MeshPhongMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 0.3,
      shininess: 100
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    
    // Simple solar panels
    const panelGeometry = new THREE.BoxGeometry(0.04, 0.001, 0.01);
    const panelMaterial = new THREE.MeshPhongMaterial({
      color: 0x000033,
      emissive: 0x000066,
      emissiveIntensity: 0.1
    });
    
    const leftPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    leftPanel.position.set(-0.025, 0, 0);
    mesh.add(leftPanel);
    
    const rightPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    rightPanel.position.set(0.025, 0, 0);
    mesh.add(rightPanel);
    
    return mesh;
  }
  
  createEnhancedMesh() {
    const group = new THREE.Group();
    
    // Main bus
    const busGeometry = new THREE.BoxGeometry(0.03, 0.04, 0.02);
    const busMaterial = new THREE.MeshPhongMaterial({
      color: 0xcccccc,
      emissive: 0x666666,
      emissiveIntensity: 0.3,
      shininess: 100
    });
    const bus = new THREE.Mesh(busGeometry, busMaterial);
    group.add(bus);
    
    // Enhanced components
    this.solarPanels = this.createEnhancedSolarPanels();
    group.add(this.solarPanels);
    
    this.antenna = this.createAntenna();
    group.add(this.antenna);
    
    // Engine nozzle
    const nozzleGeometry = new THREE.ConeGeometry(0.008, 0.02, 16, 1, true);
    const nozzleMaterial = new THREE.MeshPhongMaterial({
      color: 0x444444,
      shininess: 100
    });
    const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzle.position.set(0, -0.025, 0);
    nozzle.rotation.x = Math.PI;
    group.add(nozzle);
    
    // Status lights
    this.statusLights = this.createStatusLights();
    group.add(this.statusLights);
    
    // Visibility light
    const markerLight = new THREE.PointLight(0x00ff00, 1, 0.5);
    markerLight.position.set(0, 0.05, 0);
    group.add(markerLight);
    
    return group;
  }
  
  createEnhancedSolarPanels() {
    const group = new THREE.Group();
    const panelGeometry = new THREE.BoxGeometry(0.08, 0.002, 0.04);
    const panelMaterial = new THREE.MeshPhongMaterial({
      color: 0x2a2a6e,
      emissive: 0x0044ff,
      emissiveIntensity: 0.3,
      shininess: 80
    });
    
    const leftPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    leftPanel.position.set(-0.055, 0, 0);
    group.add(leftPanel);
    
    const rightPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    rightPanel.position.set(0.055, 0, 0);
    group.add(rightPanel);
    
    return group;
  }
  
  createAntenna() {
    const group = new THREE.Group();
    
    const dishGeometry = new THREE.SphereGeometry(0.012, 16, 16, 0, Math.PI);
    const dishMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      emissive: 0xaaaaaa,
      emissiveIntensity: 0.2,
      side: THREE.DoubleSide
    });
    const dish = new THREE.Mesh(dishGeometry, dishMaterial);
    dish.rotation.x = -Math.PI / 2;
    dish.position.set(0, 0.025, 0);
    group.add(dish);
    
    return group;
  }
  
  createStatusLights() {
    const group = new THREE.Group();
    const lightPositions = [
      { pos: [0.012, 0.018, 0.008], color: 0x00ff00 }, // Power
      { pos: [0, 0.018, 0.008], color: 0x0088ff },      // Comms
      { pos: [-0.012, 0.018, 0.008], color: 0xffaa00 }  // Warning
    ];
    
    lightPositions.forEach(({ pos, color }) => {
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.002),
        new THREE.MeshPhongMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1
        })
      );
      light.position.set(...pos);
      group.add(light);
    });
    
    return group;
  }
  
  createThrustIndicator() {
    const geometry = new THREE.ConeGeometry(0.003, 0.015, 8);
    geometry.rotateX(-Math.PI / 2);
    
    const material = new THREE.MeshPhongMaterial({
      color: 0xff4400,
      emissive: 0xffaa00,
      emissiveIntensity: 1,
      transparent: true,
      opacity: 0.8,
      visible: false
    });
    
    const indicator = new THREE.Mesh(geometry, material);
    indicator.position.z = -0.015;
    this.mesh.add(indicator);
    
    return indicator;
  }
  
  createTrajectoryLine() {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      opacity: 0.6,
      transparent: true,
      linewidth: 2
    });
    
    const line = new THREE.Line(geometry, material);
    const positions = new Float32Array(this.maxTrajectoryPoints * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    
    return line;
  }

  /* ===================================
     UNIFIED UPDATE METHOD
     =================================== */
  
  update(deltaTime, bodies, currentDate) {
    if (this.crashed) return;
    const dt = deltaTime * SECONDS_PER_DAY;
    this.missionElapsedTime += dt;
    
    // The sim clock for this frame (also detects clock jumps).
    this.recordKernelFrame(dt, currentDate);
    
    // Enhanced systems update; a manoeuvre node due this frame starts its burn
    // at the node's own time, not at the frame.
    if (this.systems) {
      this.systems.update(this, { bodies }, dt);
      this.checkManoeuvreExecution(dt);
    }
    
    // Burns: fuel drawn for the time each was on this frame, and burns that
    // ended (time up, tank dry, engine off) closed off.
    this.updateBurns();
    
    // Gravity and motion: the n-body kernel. Without a KernelClient, step
    // right away on this thread.
    if (!this.kernelManaged) {
      const req = this.buildKernelRequest();
      if (req) this.applyKernelResult(stepCraft(getSyncBodies(), req));
    }
    this.updateDisplayState();
    
    // Update visuals
    this.updateVisuals();
    
    // Track trajectory
    this.updateTrajectory();
    
    // Enhanced features
    if (this.systems) {
      this.recordTelemetry();
      this.updateMissionPhase();
    }
  }
  
  /* ===================================
     KERNEL STATE
     The exact physics state lives in this.kState (heliocentric J2000
     equatorial km, km/s, at kernel time kState.t). this.position,
     this.velocity and this.acceleration are what is drawn and read by the
     rest of the app: kState carried forward to the sim clock.
     =================================== */
  
  ensureKernelState(tNow, dt) {
    if (this.kState) return;
    this.kernelId = this.kernelId ?? nextKernelId++;
    const r = sceneToEqj(this.position, AU_TO_KM);
    const sys = getSyncBodies();
    // The primary and the acceleration are known from the start, so even the
    // first frames, before any kernel result, are drawn along the right orbit
    // with the right pull (a zero acceleration here reads as the Sun's pull
    // reversed to the carry-forward below).
    const bodies = sys.bodiesAt(tNow - dt);
    this.kState = {
      r, v: sceneToEqj(this.velocity), t: tNow - dt,
      primary: primaryOf(r, bodies, sys.muSun), accel: accelHeliocentric(r, bodies, sys.muSun),
    };
    this.stateVersion = 0;
    this.burns = this.burns || [];
    this.lastClockT = tNow - dt;
    this.physicsLagSeconds = 0;
  }
  
  // Called every frame. A clock jump (reset, a date set directly) is not
  // integrated: the craft keeps its state, re-anchored at the new time, any
  // result still in flight is dropped through the version number, and burns
  // in progress are cancelled.
  recordKernelFrame(dt, currentDate) {
    const tNow = currentDate ? kernelSeconds(currentDate) : (this.lastClockT ?? 0) + dt;
    this.ensureKernelState(tNow, dt);
    this.lastDt = dt;
    this.prevClockT = this.lastClockT;
    const expected = this.lastClockT + dt;
    if (Math.abs(tNow - expected) > Math.max(1.0, 1e-6 * Math.abs(dt))) {
      this.kState.t = tNow;
      this.physicsLagSeconds = 0;
      this.stateVersion++;
      this.cancelBurns(this.lastClockT);
      this.prevClockT = tNow;            // no fuel is drawn across the jump
      this.clockJumped = true;
      console.warn(`${this.name}: sim clock jumped by ${((tNow - expected) / 86400).toFixed(2)} d; ` +
        'the craft keeps its state at the new time rather than being integrated across the jump');
    }
    this.lastClockT = tNow;
  }
  
  /* ===================================
     BURNS
     A burn is a segment of absolute kernel time: { t0, t1, dir (EQJ unit),
     F (N), m0 (kg at t0), mdot (kg/s), tank, kind }. The kernel ends steps on
     t0 and t1 and applies F / m(t), so a burn starts and stops at its own
     times whatever the frame rate, and every request that overlaps it sends
     it, so nothing is lost when a request is dropped or split.
     =================================== */
  
  // Fuel left in a tank: 'main' (the propulsion system) or 'basic' (fuelMass).
  tankFuel(tank) {
    return tank === 'main' ? this.systems.propulsion.main.fuel : this.fuelMass;
  }
  
  drawFuel(tank, kg) {
    if (tank === 'main') this.systems.propulsion.main.fuel = Math.max(0, this.systems.propulsion.main.fuel - kg);
    else this.fuelMass = Math.max(0, this.fuelMass - kg);
  }
  
  // Start a burn at kernel time t0. Returns the burn, or null if there is no
  // fuel. It ends at duration (if given), or when the tank runs dry.
  startBurn({ t0, dirScene, F, ve, tank, kind, duration = Infinity }) {
    const fuel = this.tankFuel(tank);
    const mdot = F / ve;
    if (!(fuel > 0) || !(mdot > 0) || !(dirScene.lengthSq() > 0)) return null;
    // Whole craft: dry mass plus both tanks.
    const m0 = this.mass + this.fuelMass + (this.systems ? this.systems.propulsion.main.fuel : 0);
    const d = sceneToEqj(dirScene.clone().normalize());
    const burn = { t0, t1: t0 + Math.min(duration, fuel / mdot), dir: d, F, m0, mdot, tank, kind };
    this.burns.push(burn);
    return burn;
  }
  
  // End burns still on at time t (the engine switched off, a clock jump).
  cancelBurns(t, kind = null) {
    for (const b of this.burns) {
      if ((kind === null || b.kind === kind) && b.t1 > t) b.t1 = Math.max(b.t0, t);
    }
    if (kind === null || kind === 'manual') this.engineOn = false;
    if ((kind === null || kind === 'node') && this.executingManoeuvre) this.completeManoeuvre();
  }
  
  // Each frame: draw fuel for the time each burn was on since the last frame,
  // close finished burns, and keep the thrust indicator honest.
  updateBurns() {
    const a = this.prevClockT ?? this.lastClockT, b = this.lastClockT;
    let on = false;
    for (const burn of this.burns) {
      const overlap = Math.min(b, burn.t1) - Math.max(a, burn.t0);
      if (overlap > 0) this.drawFuel(burn.tank, burn.mdot * overlap);
      if (burn.t0 <= b && b < burn.t1) on = true;
    }
    if (this.engineOn && !this.burns.some((x) => x.kind === 'manual' && b < x.t1)) this.engineOn = false;
    if (this.executingManoeuvre && b >= this.executingManoeuvre.burn.t1) this.completeManoeuvre();
    if (this.thrustIndicator) this.thrustIndicator.visible = on;
    // Burns the physics has finished with and the clock has passed can go.
    const done = Math.min(this.kState ? this.kState.t : -Infinity, b);
    this.burns = this.burns.filter((x) => x.t1 > done);
  }
  
  // A request to advance from kState to the sim clock, with every burn that
  // overlaps that span.
  buildKernelRequest() {
    if (this.crashed || this.kernelError || !this.kState) return null;
    const tEnd = this.lastClockT;
    const span = tEnd - this.kState.t;
    if (Number.isNaN(span)) {
      // A corrupted time would otherwise freeze the craft without a word.
      this.kernelError = 'non-finite physics time';
      return null;
    }
    if (!(span > 0)) return null;
    const burns = this.burns
      .filter((b) => b.t1 > this.kState.t && b.t0 < tEnd)
      .map(({ t0, t1, dir, F, m0, mdot }) => ({ t0, t1, dir, F, m0, mdot }));
    return {
      id: this.kernelId, version: this.stateVersion,
      r: [...this.kState.r], v: [...this.kState.v], t: this.kState.t, tEnd,
      primary: this.kState.primary, burns,
    };
  }
  
  // A request whose result will never be used (dropped as stale, or lost when
  // the Worker failed). Nothing to undo: burns are tied to absolute times, so
  // the next request, which starts from the same kState, sends them again.
  onKernelRequestDropped() {}

  applyKernelResult(res) {
    if (this.crashed) return;
    // The kernel could not step this craft (bad state, time outside the
    // ephemeris): stop asking, and let the app say so.
    if (res.error) {
      this.kernelError = res.error;
      console.warn(`${this.name}: kernel error: ${res.error}`);
      return;
    }
    // Computed from a state this craft has since changed (a burn, a jump).
    if (res.version !== this.stateVersion) return;
    this.kState = { r: res.r, v: res.v, t: res.t, primary: res.primary, accel: res.accel };
    this.primaryBody = res.primary;
    const impact = res.events.find((ev) => ev.type === 'impact');
    // Budget ran out: the craft is behind the clock and catches up next time
    // (the burns it has not reached yet are still in the schedule).
    this.physicsLagSeconds = (!res.complete && !impact) ? Math.max(0, res.tEnd - res.t) : 0;
    for (const ev of res.events) {
      if (ev.type === 'impact') {
        this.crashed = true;
        this.impactBody = ev.body;
        this.engineOn = false;
        console.warn(`${this.name}: impact on ${ev.body}`);
        // update() returns early once crashed, so draw the impact point now.
        this.updateDisplayState();
        this.updateVisuals();
        this.updateTrajectory();
      } else if (ev.type === 'primary') {
        console.info(`${this.name}: now in the sphere of influence of ${ev.to}`);
      }
    }
  }
  
  // Draw at the sim clock. kState is usually a frame or more behind it (the
  // Worker answers a frame late, and skips frames while busy), so it is carried
  // forward along a two-body orbit about the craft's primary, with the
  // primary's own position from the ephemeris at the clock time. That is exact
  // for an unperturbed orbit; drawing kState as it is would leave a craft near
  // Earth one frame behind Earth's own motion (43,000 km at a day a second).
  // A straight-line r + v dt + a dt^2/2 is far worse in low orbit at warp.
  // Not carried forward after an impact, or more than 30 days.
  updateDisplayState() {
    if (!this.kState) return;
    let dtx = this.lastClockT - this.kState.t;
    if (!(dtx > 0) || this.crashed) dtx = 0;
    const { r: rd, v: vd } = this.carryForward(Math.min(dtx, 30 * SECONDS_PER_DAY));
    eqjToScene(rd, this.position, 1 / AU_TO_KM);
    eqjToScene(vd, this.velocity);
    eqjToScene(this.kState.accel, this.acceleration, 1e3);
  }

  // kState carried forward by dtx seconds (EQJ km, km/s): see updateDisplayState.
  carryForward(dtx) {
    let rd = this.kState.r, vd = this.kState.v;
    if (dtx > 0) {
      // Within three spheres of influence of a planet, its pull changes too
      // fast across a frame to be a correction to a solar orbit, so carry the
      // craft forward around that planet instead.
      let key = this.kState.primary;
      if (!key || key === 'sun') {
        const sys = getSyncBodies();
        for (const b of sys.bodiesAt(this.kState.t)) {
          if (b.parent) continue;
          const d = Math.hypot(rd[0] - b.r[0], rd[1] - b.r[1], rd[2] - b.r[2]);
          const soi = Math.hypot(b.r[0], b.r[1], b.r[2]) * Math.pow(b.mu / sys.muSun, 0.4);
          if (d < 3 * soi) { key = b.key; break; }
        }
      }
      if (!key || key === 'sun') {
        const muSun = GRAVITATIONAL_PARAMETERS.sun / 1e9;
        const st = propagate(rd, vd, dtx, muSun);
        if (st) {
          // The planets' pull, taken from the kernel's acceleration minus the
          // Sun's, added to second order: a craft just outside a planet's
          // sphere of influence still feels the planet.
          const r0 = this.kState.r, a = this.kState.accel;
          const k = -muSun / Math.pow(Math.hypot(r0[0], r0[1], r0[2]), 3);
          const ap = [0, 1, 2].map((i) => a[i] - k * r0[i]);
          rd = st.r.map((x, i) => x + 0.5 * ap[i] * dtx * dtx);
          vd = st.v.map((x, i) => x + ap[i] * dtx);
        }
      } else {
        const t0 = new Date(KERNEL_EPOCH_MS + this.kState.t * 1000);
        const t1 = new Date(KERNEL_EPOCH_MS + (this.kState.t + dtx) * 1000);
        const P0 = helioStateEqj(key, t0), P1 = helioStateEqj(key, t1);
        const rel = propagate(
          [0, 1, 2].map((i) => rd[i] - P0.r[i]), [0, 1, 2].map((i) => vd[i] - P0.v[i]),
          dtx, bodyConstants(key).mu
        );
        if (rel) {
          // Everything but the primary's two-body pull, relative to the
          // primary (the Moon near Earth, the Sun's tide), to second order:
          // the craft's kernel acceleration minus the primary's own
          // heliocentric acceleration minus the primary's pull on the craft.
          const sys = getSyncBodies();
          const bodies = sys.bodiesAt(this.kState.t);
          const P = bodies.find((b) => b.key === key);
          let ap = [0, 0, 0];
          if (P) {
            const r0 = this.kState.r, a = this.kState.accel;
            const aP = accelHeliocentric(P.r, bodies.filter((b) => b !== P), sys.muSun);
            const kp = -P.mu / Math.pow(Math.hypot(P.r[0], P.r[1], P.r[2]), 3);
            const d = [0, 1, 2].map((i) => r0[i] - P.r[i]);
            const k2 = -P.mu / Math.pow(Math.hypot(d[0], d[1], d[2]), 3);
            ap = [0, 1, 2].map((i) => a[i] - (aP[i] + kp * P.r[i]) - k2 * d[i]);
          }
          rd = [0, 1, 2].map((i) => rel.r[i] + P1.r[i] + 0.5 * ap[i] * dtx * dtx);
          vd = [0, 1, 2].map((i) => rel.v[i] + P1.v[i] + ap[i] * dtx);
        }
      }
    }
    return { r: rd, v: vd };
  }

  updateVisuals() {
    this.mesh.position.copy(this.position);
    
    // Orient along velocity
    if (this.velocity.length() > 0.01) {
      const direction = this.velocity.clone().normalize();
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      this.mesh.quaternion.copy(quaternion);
    }
    
    // Thrust effect
    if (this.engineOn && this.fuelMass > 0) {
      const scale = 1 + Math.sin(this.missionElapsedTime * 10) * 0.2;
      this.thrustIndicator.scale.set(scale, scale, scale);
    }
    
    // Enhanced visuals
    if (this.systems) {
      this.updateEnhancedVisuals();
    }
  }
  
  updateEnhancedVisuals() {
    // Point antenna at Earth
    if (this.antenna) {
      const earthDir = this.position.clone().negate().normalize();
      this.antenna.lookAt(earthDir);
    }
    
    // Update status lights
    if (this.statusLights) {
      const lights = this.statusLights.children;
      
      // Power light
      if (lights[0] && this.systems.power.batteryCharge > 20) {
        lights[0].material.color.setHex(0x00ff00);
        lights[0].material.emissive.setHex(0x00ff00);
      } else if (lights[0]) {
        lights[0].material.color.setHex(0xff0000);
        lights[0].material.emissive.setHex(0xff0000);
      }
      
      // Comms light
      if (lights[1]) {
        lights[1].visible = this.systems.comms.inContact;
      }
      
      // Warning light
      if (lights[2]) {
        const warnings = this.systems.checkSystemConstraints();
        lights[2].visible = warnings.length > 0;
      }
    }
  }
  
  updateTrajectory() {
    // Validate position before adding
    if (!isFinite(this.position.x) || !isFinite(this.position.y) || !isFinite(this.position.z)) {
      // Only warn once per spacecraft
      if (!this._warnedInvalidPosition) {
        console.warn(`Invalid position detected for ${this.name}, skipping trajectory update`);
        this._warnedInvalidPosition = true;
      }
      return;
    }
    
    // Reset warning flag when position becomes valid
    if (this._warnedInvalidPosition) {
      this._warnedInvalidPosition = false;
    }
    
    this.trajectory.push(this.position.clone());
    
    if (this.trajectory.length > this.maxTrajectoryPoints) {
      this.trajectory.shift();
    }
    
    const positions = this.trajectoryLine.geometry.attributes.position.array;
    
    for (let i = 0; i < this.trajectory.length; i++) {
      const point = this.trajectory[i];
      if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
        continue;
      }
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
    }
    
    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
    this.trajectoryLine.geometry.setDrawRange(0, this.trajectory.length);
    
    // Only compute bounding sphere if we have valid points
    if (this.trajectory.length > 0 && this.trajectory[0].x !== 0) {
      try {
        this.trajectoryLine.geometry.computeBoundingSphere();
      } catch (e) {
        // Ignore bounding sphere errors silently
      }
    }
  }

  /* ===================================
     MANOEUVRE MANAGEMENT
     =================================== */
  
  checkManoeuvreExecution(dt) {
    if (!this.systems || !this.manoeuvreNodes) return;
    
    if (!this.executingManoeuvre && this.manoeuvreNodes.length > 0) {
      const nextNode = this.manoeuvreNodes[0];
      nextNode.timeFromNow -= dt;
      
      if (nextNode.timeFromNow <= 0) {
        // timeFromNow has run past zero by however much of this frame came
        // after the node: the burn starts at the node's own time.
        this.startManoeuvre(nextNode, this.lastClockT + nextNode.timeFromNow);
      }
    }
    // Completion is checked in updateBurns(), against the burn's end time.
  }
  
  startManoeuvre(node, tStart = this.lastClockT) {
    const result = this.systems.executeBurn(
      node.deltaV.length(),
      node.burnDuration,
      this
    );
    
    if (!result.success) {
      console.error('Manoeuvre failed:', result.reason);
      this.removeManoeuvreNode(node);
      return;
    }
    
    // The burn's frame from the state at the node's time, not at the end of
    // the frame it fell in (a day-long frame turns the velocity ~1 degree).
    const at = this.kState
      ? this.carryForward(Math.max(0, tStart - this.kState.t))
      : { r: sceneToEqj(this.position, AU_TO_KM), v: sceneToEqj(this.velocity) };
    const frame = OrbitalMechanics.getOrbitalReferenceFrame(
      eqjToScene(at.r, new THREE.Vector3(), 1 / AU_TO_KM),
      eqjToScene(at.v, new THREE.Vector3())
    );
    
    const thrustDirection = new THREE.Vector3()
      .addScaledVector(frame.radial, node.deltaV.x)
      .addScaledVector(frame.prograde, node.deltaV.y)
      .addScaledVector(frame.normal, node.deltaV.z)
      .normalize();
    
    // Duration from the craft's mass now, so the burn delivers exactly the
    // node's delta-v: m0 (1 - exp(-dv / ve)) kg at mdot = F / ve.
    const main = this.systems.propulsion.main;
    const ve = main.specificImpulse * 9.80665;                // m/s
    const m0 = this.mass + this.fuelMass + main.fuel;
    const dvMs = node.deltaV.length() * 1000;
    const duration = m0 * (1 - Math.exp(-dvMs / ve)) / (main.thrust / ve);
    const burn = this.startBurn({
      t0: tStart, dirScene: thrustDirection, F: main.thrust, ve, tank: 'main', kind: 'node', duration,
    });
    if (!burn) {
      console.error('Manoeuvre failed: no fuel in the main tank');
      main.throttle = 0;
      this.removeManoeuvreNode(node);
      return;
    }
    this.executingManoeuvre = {
      node,
      burn,
      thrustDirection,
      timeRemaining: burn.t1 - burn.t0,
      totalDeltaV: node.deltaV.clone()
    };
    
    console.log(`Starting manoeuvre: ${node.deltaV.length().toFixed(2)} km/s`);
  }
  
  completeManoeuvre() {
    console.log('Manoeuvre complete');
    this.systems.propulsion.main.throttle = 0;
    this.removeManoeuvreNode(this.executingManoeuvre.node);
    this.executingManoeuvre = null;
  }
  
  addManoeuvreNode(timeFromNow) {
    if (!this.systems) {
      console.warn('Basic spacecraft cannot plan manoeuvres');
      return null;
    }
    
    const node = new ManoeuvreNode(this, timeFromNow);
    this.manoeuvreNodes.push(node);
    this.manoeuvreNodes.sort((a, b) => a.timeFromNow - b.timeFromNow);
    
    return node;
  }
  
  removeManoeuvreNode(node) {
    if (!this.manoeuvreNodes) return;
    
    const index = this.manoeuvreNodes.indexOf(node);
    if (index > -1) {
      this.manoeuvreNodes.splice(index, 1);
      node.dispose();
    }
  }

  /* ===================================
     MISSION MANAGEMENT
     =================================== */
  
  recordTelemetry() {
    if (!this.telemetryHistory) return;
    
    const telemetry = {
      time: this.missionElapsedTime,
      position: this.position.clone(),
      velocity: this.velocity.length(),
      fuel: this.systems ? this.systems.propulsion.main.fuel : this.fuelMass,
      power: this.systems ? this.systems.power.batteryCharge : 100,
      temperature: this.systems ? this.systems.thermal.internalTemp : 293
    };
    
    this.telemetryHistory.push(telemetry);
    
    if (this.telemetryHistory.length > this.maxTelemetryPoints) {
      this.telemetryHistory.shift();
    }
  }
  
  updateMissionPhase() {
    if (!this.targetBody) return;
    
    const targetDistance = this.position.distanceTo(this.targetBody.position);
    const targetSOI = this.calculateSOI(this.targetBody);
    
    if (targetDistance < targetSOI) {
      this.missionPhase = 'APPROACH';
    } else if (targetDistance < targetSOI * 10) {
      this.missionPhase = 'ENCOUNTER';
    }
    
    const elements = this.getOrbitalElements();
    if (elements.eccentricity >= 1) {
      this.missionPhase = 'ESCAPE';
    }
  }
  
  calculateSOI(body) {
    if (!body.data || !body.data.mass) return 0.1;
    
    const a = body.data.semiMajorAxis || 1;
    const m = body.data.mass;
    const M = 1.989e30; // Sun mass
    
    return a * Math.pow(m / M, 0.4);
  }

  /* ===================================
     DATA AND TELEMETRY
     =================================== */
  
  getOrbitalElements(centralBody = { position: new THREE.Vector3(0, 0, 0) }) {
    return OrbitalMechanics.calculateOrbitalElements(
      this.position.clone().sub(centralBody.position),
      this.velocity.clone(),
      GRAVITATIONAL_PARAMETERS.sun / 1e9
    );
  }
  
  getInfo() {
    const elements = this.getOrbitalElements();
    const totalMass = this.mass + (this.systems ? 
      this.systems.propulsion.main.fuel : this.fuelMass);
    const fuelPercent = this.systems ? 
      (this.systems.propulsion.main.fuel / SPACECRAFT_DEFAULTS.fuelMass * 100) :
      (this.fuelMass / SPACECRAFT_DEFAULTS.fuelMass * 100);
    
    // Validate values to prevent NaN display
    const safeValue = (value, fallback = 0) => {
      return isFinite(value) ? value : fallback;
    };
    
    const basicInfo = {
      name: this.name,
      missionTime: safeValue(this.missionElapsedTime / SECONDS_PER_DAY).toFixed(2),
      position: safeValue(this.position.length()).toFixed(3),
      speed: safeValue(this.velocity.length()).toFixed(1),
      mass: safeValue(totalMass).toFixed(0),
      fuelPercent: safeValue(fuelPercent).toFixed(1),
      engineStatus: this.engineOn ? 'ON' : 'OFF',
      apoapsis: safeValue(elements.apoapsis, 0).toFixed(3),
      periapsis: safeValue(elements.periapsis, 0).toFixed(3),
      eccentricity: safeValue(elements.eccentricity, 0).toFixed(3),
      inclination: safeValue(elements.inclination, 0).toFixed(1),
      period: safeValue(elements.period, 0).toFixed(1),
      specificEnergy: safeValue(elements.specificEnergy, 0).toFixed(0)
    };
    
    if (this.systems) {
      const systemStatus = this.systems.getSystemStatus();
      return {
        ...basicInfo,
        phase: this.missionPhase,
        systems: systemStatus,
        manoeuvres: this.manoeuvreNodes.length,
        nextManoeuvre: this.manoeuvreNodes.length > 0 ? 
          (this.manoeuvreNodes[0].timeFromNow / 86400).toFixed(1) + ' days' : 'None',
        executing: this.executingManoeuvre !== null
      };
    }
    
    return basicInfo;
  }
  
  setTarget(bodyName, bodies) {
    if (!this.systems) {
      console.warn('Basic spacecraft cannot set targets');
      return;
    }
    
    this.targetBody = bodies.get(bodyName);
    if (this.targetBody) {
      console.log(`${this.name} targeting ${bodyName}`);
    }
  }
  
  /* ===================================
     BASIC SPACECRAFT METHODS
     =================================== */
  
  applyManeuver(deltaV, direction) {
    const dv = direction.normalize().multiplyScalar(deltaV);
    this.velocity.add(dv);
    // Apply it to the exact state too, and drop any result computed without it.
    if (this.kState) {
      const d = sceneToEqj(dv);
      for (let i = 0; i < 3; i++) this.kState.v[i] += d[i];
      this.stateVersion++;
    }
    console.log(`Maneuver applied: ${deltaV.toFixed(2)} km/s`);
  }
  
  // Manual engine: on starts a burn at the current sim time along direction
  // (scene axes), which runs until it is switched off or the tank is dry;
  // off ends it now. Propellant flow is thrust / exhaust velocity (m/s).
  setThrust(direction, on = true) {
    if (on && direction) this.thrustVector = direction.clone().normalize();
    const t = this.lastClockT ?? 0;
    this.cancelBurns(t, 'manual');
    if (on) {
      const burn = this.kState ? this.startBurn({
        t0: t, dirScene: this.thrustVector, F: this.thrustPower, ve: this.exhaustVelocity, tank: 'basic', kind: 'manual',
      }) : null;
      this.engineOn = !!burn;
    }
    this.thrustIndicator.visible = this.engineOn;
  }
  
  clearTrajectory() {
    this.trajectory = [];
    this.trajectoryLine.geometry.setDrawRange(0, 0);
  }
  
  dispose() {
    // Clean up Three.js resources
    if (this.mesh) {
      this.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
    
    if (this.trajectoryLine) {
      this.trajectoryLine.geometry.dispose();
      this.trajectoryLine.material.dispose();
    }
  }
}