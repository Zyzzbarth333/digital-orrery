// src/simulation/spacecraft/BaseSpacecraft.js
import * as THREE from 'three';
import { 
  AU_TO_KM, SECONDS_PER_DAY,
  SPACECRAFT_DEFAULTS, GRAVITATIONAL_PARAMETERS, VISUAL_SETTINGS
} from '../../utils/constants.js';
import { OrbitalMechanics } from '../OrbitalMechanics.js';
import { solarSystemBodies } from '../../physics/bodies.js';
import { KERNEL_EPOCH_MS, kernelSeconds, stepCraft } from '../../physics/kernelHost.js';

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
    
    // Enhanced systems update
    if (this.systems) {
      this.systems.update(this, { bodies }, dt);
      this.checkManoeuvreExecution(dt);
    }
    
    // Thrust over this frame (m/s^2, scene axes); fuel is drawn for the whole
    // frame as before.
    const thrust = new THREE.Vector3();
    if (this.engineOn && this.fuelMass > 0) thrust.add(this.calculateThrustAcceleration(dt));
    if (this.executingManoeuvre && this.systems) thrust.add(this.calculateManoeuvreThrust(dt));
    
    // Gravity and motion: the n-body kernel. Record this frame for it, and
    // without a KernelClient step right away on this thread.
    this.recordKernelFrame(dt, thrust, currentDate);
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
    this.kState = {
      r: sceneToEqj(this.position, AU_TO_KM), v: sceneToEqj(this.velocity),
      t: tNow - dt, primary: null, accel: [0, 0, 0],
    };
    this.stateVersion = 0;
    this.pendingImpulse = [0, 0, 0];      // km/s of thrust not yet sent
    this.lastClockT = tNow - dt;
    this.physicsLagSeconds = 0;
  }
  
  // Called every frame. A clock jump (reset, a date set directly) is not
  // integrated: the craft keeps its state, re-anchored at the new time, and
  // any result still in flight is dropped through the version number.
  recordKernelFrame(dt, thrust, currentDate) {
    const tNow = currentDate ? kernelSeconds(currentDate) : (this.lastClockT ?? 0) + dt;
    this.ensureKernelState(tNow, dt);
    this.lastDt = dt;
    const expected = this.lastClockT + dt;
    if (Math.abs(tNow - expected) > Math.max(1.0, 1e-6 * Math.abs(dt))) {
      this.kState.t = tNow;
      this.pendingImpulse = [0, 0, 0];
      this.physicsLagSeconds = 0;
      this.stateVersion++;
      this.clockJumped = true;
      console.warn(`${this.name}: sim clock jumped by ${((tNow - expected) / 86400).toFixed(2)} d; ` +
        'the craft keeps its state at the new time rather than being integrated across the jump');
    } else if (thrust.lengthSq() > 0) {
      const th = sceneToEqj(thrust, 1e-3);                  // m/s^2 -> km/s^2
      for (let i = 0; i < 3; i++) this.pendingImpulse[i] += th[i] * dt;
    }
    this.lastClockT = tNow;
  }
  
  // A request to advance from kState to the sim clock. Thrust is the impulse
  // gathered since the last request spread over the span, so a request that
  // covers several frames (the Worker was busy) delivers the same delta-v.
  buildKernelRequest() {
    if (this.crashed || !this.kState) return null;
    const tEnd = this.lastClockT;
    const span = tEnd - this.kState.t;
    if (!(span > 0)) return null;
    const thrust = this.pendingImpulse.map((x) => x / span);
    this.pendingImpulse = [0, 0, 0];
    this.lastRequestThrust = thrust;
    return {
      id: this.kernelId, version: this.stateVersion,
      r: [...this.kState.r], v: [...this.kState.v], t: this.kState.t, tEnd,
      primary: this.kState.primary, thrust,
    };
  }
  
  applyKernelResult(res) {
    // Computed from a state this craft has since changed (a burn, a jump).
    if (res.version !== this.stateVersion || this.crashed) return;
    this.kState = { r: res.r, v: res.v, t: res.t, primary: res.primary, accel: res.accel };
    this.primaryBody = res.primary;
    const impact = res.events.find((ev) => ev.type === 'impact');
    // Budget ran out: the craft is behind the clock and catches up next time.
    // Thrust meant for the part not reached goes back into the next request.
    this.physicsLagSeconds = (!res.complete && !impact) ? Math.max(0, res.tEnd - res.t) : 0;
    if (this.physicsLagSeconds > 0 && this.lastRequestThrust) {
      for (let i = 0; i < 3; i++) this.pendingImpulse[i] += this.lastRequestThrust[i] * this.physicsLagSeconds;
    }
    for (const ev of res.events) {
      if (ev.type === 'impact') {
        this.crashed = true;
        this.impactBody = ev.body;
        this.engineOn = false;
        console.warn(`${this.name}: impact on ${ev.body}`);
      } else if (ev.type === 'primary') {
        console.info(`${this.name}: now in the sphere of influence of ${ev.to}`);
      }
    }
  }
  
  // Draw at the sim clock: kState carried forward by r + v dt + a dt^2 / 2 for
  // at most two frames (results arrive about a frame late from the Worker).
  // Not carried forward while physics is lagging, or after an impact.
  updateDisplayState() {
    if (!this.kState) return;
    let dtx = this.lastClockT - this.kState.t;
    if (!(dtx > 0) || this.physicsLagSeconds > 0 || this.crashed) dtx = 0;
    dtx = Math.min(dtx, 2 * (this.lastDt || 0));
    const { r, v, accel: a } = this.kState;
    const rd = [0, 1, 2].map((i) => r[i] + v[i] * dtx + 0.5 * a[i] * dtx * dtx);
    const vd = [0, 1, 2].map((i) => v[i] + a[i] * dtx);
    eqjToScene(rd, this.position, 1 / AU_TO_KM);
    eqjToScene(vd, this.velocity);
    eqjToScene(a, this.acceleration, 1e3);
  }

  calculateThrustAcceleration(dt) {
    if (this.fuelMass <= 0) {
      this.engineOn = false;
      this.thrustIndicator.visible = false;
      return new THREE.Vector3();
    }
    
    const fuelBurnRate = this.thrustPower / (this.exhaustVelocity * 9.81);
    const fuelUsed = Math.min(fuelBurnRate * dt, this.fuelMass);
    this.fuelMass -= fuelUsed;
    
    const currentMass = this.mass + this.fuelMass;
    const acceleration = this.thrustVector.clone()
      .normalize()
      .multiplyScalar(this.thrustPower / currentMass);
    
    this.thrustIndicator.visible = true;
    return acceleration;
  }
  
  calculateManoeuvreThrust(dt) {
    if (!this.executingManoeuvre || !this.systems || 
        this.systems.propulsion.main.throttle === 0) {
      return new THREE.Vector3();
    }
    
    const thrust = this.systems.propulsion.main.thrust;
    const totalMass = this.mass + this.systems.propulsion.main.fuel;
    const accelMag = thrust / totalMass;
    
    return this.executingManoeuvre.thrustDirection.clone()
      .multiplyScalar(accelMag);
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
        this.startManoeuvre(nextNode);
      }
    }
    
    if (this.executingManoeuvre) {
      this.executingManoeuvre.timeRemaining -= dt;
      
      if (this.executingManoeuvre.timeRemaining <= 0) {
        this.completeManoeuvre();
      }
    }
  }
  
  startManoeuvre(node) {
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
    
    const frame = OrbitalMechanics.getOrbitalReferenceFrame(
      this.position,
      this.velocity
    );
    
    const thrustDirection = new THREE.Vector3()
      .addScaledVector(frame.radial, node.deltaV.x)
      .addScaledVector(frame.prograde, node.deltaV.y)
      .addScaledVector(frame.normal, node.deltaV.z)
      .normalize();
    
    this.executingManoeuvre = {
      node,
      thrustDirection,
      timeRemaining: node.burnDuration,
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
  
  setThrust(direction, on = true) {
    this.engineOn = on;
    
    if (on && direction) {
      this.thrustVector = direction.normalize();
    }
    
    this.thrustIndicator.visible = on;
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