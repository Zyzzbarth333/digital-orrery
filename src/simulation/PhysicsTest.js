// src/simulation/PhysicsTest.js
//
// In-browser checks against the live simulation: launch a craft from Earth,
// let the n-body kernel fly it, then read its heliocentric elements. Run from
// the console with `new PhysicsTest(app.simulation).runAllTests()`.
//
// Launches start on the escape hyperbola (spacecraft/launch.js) with the
// given delta-v as the hyperbolic excess speed, and Earth's gravity acts, so
// each test lets the craft climb out of Earth's sphere of influence (30 days)
// before measuring: heliocentric elements read while the craft is still deep
// in Earth's well include Earth's potential and are not the transfer orbit.
// The node test src/simulation/spacecraft/craftKernel.test.mjs checks the
// same cases headless.

import * as THREE from 'three';
import { OrbitalMechanics } from './OrbitalMechanics.js';
import { AU_TO_KM } from '../utils/constants.js';

export class PhysicsTest {
  constructor(simulation) {
    this.sim = simulation;
    this.results = [];
  }

  async runAllTests() {
    console.log('Running physics validation tests...\n');
    this.sim.spacecraft.forEach(s => this.sim.removeSpacecraft(s));

    await this.testZeroExcessSpeed();
    await this.testProgradeBoost();
    await this.testRetrogradeBoost();
    await this.testHohmannTransfer();
    await this.testEscapeVelocity();

    this.displayResults();
  }

  // Fly the sim for `days` at `days` per second, then pause.
  async flyFor(days) {
    const tc = this.sim.timeController;
    tc.setTimeScale(days);
    tc.play();
    await this.delay(1000);
    tc.pause();
  }

  earthDistanceAU() {
    const earth = this.sim.bodies.get('earth');
    const p = earth && (earth.group ? earth.group.position : earth.mesh.position);
    return p ? p.length() : 1.0;
  }

  async launchAndClimb(name, rsw, days = 30) {
    const craft = this.sim.launchSpacecraft(name, 'earth', new THREE.Vector3(...rsw));
    const earthAU = this.earthDistanceAU();
    await this.flyFor(days);
    return { craft, earthAU, el: craft.getOrbitalElements() };
  }

  record(test, expected, actual, pass, craft) {
    this.results.push({ test, expected, actual, pass });
    console.log(`${test}: ${actual} -> ${pass ? 'PASS' : 'FAIL'}`);
    this.sim.removeSpacecraft(craft);
  }

  async testZeroExcessSpeed() {
    // v_inf = 0 is a parabolic escape: the craft drifts onto a solar orbit
    // just outside Earth's (about a = 1.03 AU, e = 0.04 after a year).
    const { craft, el } = await this.launchAndClimb('Zero-vinf', [0, 0, 0], 365);
    this.record('Zero excess speed', 'Near Earth\'s orbit after a year: |a - 1| < 0.06 AU, e < 0.07',
      `a=${el.semiMajorAxis.toFixed(3)} AU, e=${el.eccentricity.toFixed(3)}`,
      Math.abs(el.semiMajorAxis - 1) < 0.06 && el.eccentricity < 0.07, craft);
  }

  async testProgradeBoost() {
    const { craft, earthAU, el } = await this.launchAndClimb('Prograde-Test', [0, 5, 0]);
    this.record('Prograde 5 km/s', 'Ap > 1.5 AU, Pe at Earth\'s distance, e > 0.2',
      `Ap=${el.apoapsis.toFixed(2)} AU, Pe=${el.periapsis.toFixed(3)} AU (Earth ${earthAU.toFixed(3)}), e=${el.eccentricity.toFixed(3)}`,
      el.apoapsis > 1.5 && Math.abs(el.periapsis - earthAU) < 0.03 && el.eccentricity > 0.2, craft);
  }

  async testRetrogradeBoost() {
    const { craft, earthAU, el } = await this.launchAndClimb('Retrograde-Test', [0, -5, 0]);
    this.record('Retrograde 5 km/s', 'Pe < 0.8 AU, Ap at Earth\'s distance, e > 0.2',
      `Pe=${el.periapsis.toFixed(2)} AU, Ap=${el.apoapsis.toFixed(3)} AU (Earth ${earthAU.toFixed(3)}), e=${el.eccentricity.toFixed(3)}`,
      el.periapsis < 0.8 && Math.abs(el.apoapsis - earthAU) < 0.03 && el.eccentricity > 0.2, craft);
  }

  async testHohmannTransfer() {
    // v_inf for a 1.0 -> 1.524 AU Hohmann transfer. Earth's real orbit is
    // eccentric (0.983-1.017 AU), so the apoapsis lands near, not on, 1.524.
    const transfer = OrbitalMechanics.calculateHohmannTransfer(1.0 * AU_TO_KM, 1.524 * AU_TO_KM);
    const { craft, earthAU, el } = await this.launchAndClimb('Mars-Transfer', [0, transfer.departure, 0]);
    this.record('Hohmann to Mars', 'Ap = 1.524 +/- 0.06 AU, Pe at Earth\'s distance',
      `Ap=${el.apoapsis.toFixed(3)} AU, Pe=${el.periapsis.toFixed(3)} AU (Earth ${earthAU.toFixed(3)})`,
      Math.abs(el.apoapsis - 1.524) < 0.06 && Math.abs(el.periapsis - earthAU) < 0.03, craft);
  }

  async testEscapeVelocity() {
    // Earth moves at ~30 km/s and solar escape at 1 AU is ~42 km/s.
    const { craft, el } = await this.launchAndClimb('Escape-Test', [0, 12.3, 0]);
    this.record('Solar escape 12.3 km/s', 'e >= 1 (escape from the Sun)',
      `e=${el.eccentricity.toFixed(3)}`, el.eccentricity >= 1, craft);
  }

  displayResults() {
    console.log('\nTEST RESULTS SUMMARY:');
    console.table(this.results);
    const passed = this.results.filter(r => r.pass).length;
    console.log(`\nTotal: ${passed}/${this.results.length} tests passed`);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
