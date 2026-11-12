// src/simulation/OrbitalMechanics.js
import * as THREE from 'three';
import { AU_TO_KM, GRAVITATIONAL_PARAMETERS } from '../utils/constants.js';
import { rvToElements } from '../physics/orbital.js';

const OBLIQUITY_RAD = 23.4392911 * Math.PI / 180;   // J2000 mean obliquity

export class OrbitalMechanics {
  // Get velocity components in orbital reference frame
  static getOrbitalReferenceFrame(position, velocity) {
    // Position vector (from Sun)
    const r = position.clone().normalize();
    
    // Velocity direction (tangent to orbit)
    const v = velocity.clone().normalize();
    
    // Normal to orbital plane (angular momentum direction)
    const h = new THREE.Vector3().crossVectors(r, v).normalize();
    
    // Prograde direction (perpendicular to r in orbital plane)
    const prograde = new THREE.Vector3().crossVectors(h, r).normalize();
    
    return {
      radial: r,        // Away from Sun
      prograde: prograde, // Direction of motion
      normal: h         // Perpendicular to orbital plane
    };
  }
  
  // Convert delta-v from RSW (Radial-Along-Cross) to inertial coordinates
static convertDeltaV(deltaV_RSW, position, velocity) {
  const frame = this.getOrbitalReferenceFrame(position, velocity);
  
  // deltaV_RSW components: [radial, along-track, cross-track]
  const deltaV = new THREE.Vector3();
  
  // Radial component (toward/away from Sun)
  deltaV.addScaledVector(frame.radial, deltaV_RSW.x);
  
  // Along-track component (prograde/retrograde)
  deltaV.addScaledVector(frame.prograde, deltaV_RSW.y);
  
  // Cross-track component (normal to orbital plane)
  deltaV.addScaledVector(frame.normal, deltaV_RSW.z);
  
  return deltaV;
}
  
  // Calculate Hohmann transfer delta-v requirements
  static calculateHohmannTransfer(r1, r2) {
    // r1, r2 in km
    const mu = GRAVITATIONAL_PARAMETERS.sun / 1e9; // Convert to km³/s²
    
    // Current orbit velocity
    const v1 = Math.sqrt(mu / r1);
    
    // Transfer orbit velocities
    const a_transfer = (r1 + r2) / 2; // Semi-major axis of transfer orbit
    const v_transfer1 = Math.sqrt(mu * (2/r1 - 1/a_transfer));
    const v_transfer2 = Math.sqrt(mu * (2/r2 - 1/a_transfer));
    
    // Target orbit velocity
    const v2 = Math.sqrt(mu / r2);
    
    // Delta-v requirements
    const dv1 = v_transfer1 - v1; // At departure (positive = prograde)
    const dv2 = v2 - v_transfer2; // At arrival
    
    return {
      departure: dv1,
      arrival: dv2,
      total: Math.abs(dv1) + Math.abs(dv2),
      transferTime: Math.PI * Math.sqrt(Math.pow(a_transfer, 3) / mu) / 86400 // days
    };
  }
  
// Calculate orbital elements from state vectors
  // Elements of the orbit through (position, velocity) about a body of
  // parameter mu (km^3/s^2). position is in AU and velocity in km/s, both in
  // scene axes (three.js y-up, EQJ mapped as (x, z, -y)); inclination is
  // measured from the ecliptic. Returns AU, days and degrees as before:
  // { semiMajorAxis, eccentricity, inclination, periapsis, apoapsis, period,
  //   specificEnergy }. apoapsis and period are Infinity for an escape orbit.
  //
  // This used to compute h from a position in AU and a velocity in km/s, so
  // (v x h) / mu was ~1.5e8 too small and every orbit read e ~ 1; and it took
  // the inclination from scene z, which is not a pole. It now uses the
  // verified rvToElements (src/physics/orbital.js).
  static calculateOrbitalElements(position, velocity, mu) {
    const zero = {
      semiMajorAxis: 0, eccentricity: 0, inclination: 0,
      periapsis: 0, apoapsis: 0, period: 0, specificEnergy: 0,
    };
    if (!position || !velocity || !(mu > 0)) return zero;
    // scene -> EQJ -> ecliptic J2000 (obliquity 23.4392911 deg)
    const eqjR = [position.x * AU_TO_KM, -position.z * AU_TO_KM, position.y * AU_TO_KM];
    const eqjV = [velocity.x, -velocity.z, velocity.y];
    const ce = Math.cos(OBLIQUITY_RAD), se = Math.sin(OBLIQUITY_RAD);
    const ecl = (q) => [q[0], ce * q[1] + se * q[2], -se * q[1] + ce * q[2]];
    const r = ecl(eqjR), v = ecl(eqjV);
    const rn = Math.hypot(r[0], r[1], r[2]);
    if (!(rn > 0) || !r.every(Number.isFinite) || !v.every(Number.isFinite)) return zero;
    const el = rvToElements(r, v, mu);
    const vn2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const bound = el.e < 1;
    return {
      semiMajorAxis: el.a / AU_TO_KM,
      eccentricity: el.e,
      inclination: el.i * 180 / Math.PI,
      periapsis: el.a * (1 - el.e) / AU_TO_KM,
      apoapsis: bound ? el.a * (1 + el.e) / AU_TO_KM : Infinity,
      period: bound ? el.period / 86400 : Infinity,
      specificEnergy: 0.5 * vn2 - mu / rn,
    };
  }
  
  // Validate physics implementation
  static validatePhysics(spacecraft) {
    const elements = spacecraft.getOrbitalElements();
    const position = spacecraft.position.clone();
    const velocity = spacecraft.velocity.clone();
    
    // Test 1: Energy conservation
    const r = position.length() * AU_TO_KM;
    const v = velocity.length();
    const mu = GRAVITATIONAL_PARAMETERS.sun / 1e9;
    const energy = (v * v) / 2 - mu / r;
    const expectedEnergy = -mu / (2 * elements.semiMajorAxis * AU_TO_KM);
    const energyError = Math.abs(energy - expectedEnergy) / Math.abs(expectedEnergy);
    
    // Test 2: Kepler's third law
    const predictedPeriod = 2 * Math.PI * Math.sqrt(Math.pow(elements.semiMajorAxis * AU_TO_KM, 3) / mu) / 86400;
    const keplerError = Math.abs(predictedPeriod - elements.period) / elements.period;
    
    return {
      energyConserved: energyError < 0.01,
      energyError: energyError * 100,
      keplerValid: keplerError < 0.01,
      keplerError: keplerError * 100,
      overallValid: energyError < 0.01 && keplerError < 0.01
    };
  }
}