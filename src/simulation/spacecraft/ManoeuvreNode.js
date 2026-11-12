// src/simulation/spacecraft/ManoeuvreNode.js
import * as THREE from 'three';
import { AU_TO_KM, GRAVITATIONAL_PARAMETERS } from '../../utils/constants.js';
import { propagate } from '../../physics/orbital.js';

/**
 * Represents a planned manoeuvre at a specific point in the orbit
 */
export class ManoeuvreNode {
  constructor(spacecraft, timeFromNow) {
    this.spacecraft = spacecraft;
    this.timeFromNow = timeFromNow; // seconds
    this.deltaV = new THREE.Vector3(); // km/s in RSW frame
    
    // Predicted state at manoeuvre time
    this.predictedPosition = null;
    this.predictedVelocity = null;
    
    // Visual elements
    this.nodeMarker = this.createNodeMarker();
    this.trajectoryPreview = null;
    
    // Manoeuvre parameters
    this.burnDuration = 0; // seconds
    this.fuelRequired = 0; // kg
    
    // Update predicted state
    this.updatePrediction();
  }
  
  createNodeMarker() {
    const geometry = new THREE.SphereGeometry(0.02, 16, 16);
    const material = new THREE.MeshBasicMaterial({  // Changed from LineBasicMaterial
      color: 0x00ffff,
      opacity: 0.5,
      transparent: true
    });
    
    const marker = new THREE.Mesh(geometry, material);
    
    // Add direction indicators
    const arrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      0.1,
      0x00ffff
    );
    marker.add(arrowHelper);
    
    return marker;
  }
  
  updatePrediction() {
    // Propagate orbit to manoeuvre time
    const state = this.propagateOrbit(
      this.spacecraft.position,
      this.spacecraft.velocity,
      this.timeFromNow
    );
    
    this.predictedPosition = state.position;
    this.predictedVelocity = state.velocity;
    
    // Update marker position
    this.nodeMarker.position.copy(this.predictedPosition);
  }
  
  propagateOrbit(position, velocity, time) {
    // Real analytic Kepler propagation via the verified orbital core
    // (src/physics/orbital.js). The app stores position in AU and velocity in
    // km/s; the core works in km and km/s, so convert on the way in and out.
    const mu = GRAVITATIONAL_PARAMETERS.sun / 1e9; // km^3/s^2
    const rKm = [position.x * AU_TO_KM, position.y * AU_TO_KM, position.z * AU_TO_KM];
    const vKms = [velocity.x, velocity.y, velocity.z];

    const state = propagate(rKm, vKms, time, mu);
    if (!state) {
      // Solver could not converge (not seen in testing): keep the current state.
      return { position: position.clone(), velocity: velocity.clone() };
    }

    const position_new = new THREE.Vector3(
      state.r[0] / AU_TO_KM,
      state.r[1] / AU_TO_KM,
      state.r[2] / AU_TO_KM
    );
    const velocity_new = new THREE.Vector3(state.v[0], state.v[1], state.v[2]);

    return { position: position_new, velocity: velocity_new };
  }
  
  /**
   * Set delta-v components
   */
  setDeltaV(radial, alongTrack, crossTrack) {
    this.deltaV.set(radial, alongTrack, crossTrack);
    
    // Calculate burn parameters
    this.calculateBurnParameters();
    
    // Update trajectory preview
    this.updateTrajectoryPreview();
  }
  
  calculateBurnParameters() {
    const deltaVMag = this.deltaV.length();
    if (deltaVMag === 0) {
      this.burnDuration = 0;
      this.fuelRequired = 0;
      return;
    }
    
    // Get spacecraft systems
    const systems = this.spacecraft.systems;
    if (!systems) {
      console.warn('Basic spacecraft cannot calculate burn parameters');
      return;
    }
    
    const totalMass = this.spacecraft.mass + systems.propulsion.main.fuel;
    const thrust = systems.propulsion.main.thrust;
    const isp = systems.propulsion.main.specificImpulse;
    const exhaustVelocity = isp * 9.81 / 1000; // km/s
    
    // Tsiolkovsky rocket equation
    const massRatio = Math.exp(deltaVMag / exhaustVelocity);
    this.fuelRequired = totalMass * (1 - 1 / massRatio);
    
    // Burn duration
    const mdot = thrust / (isp * 9.81); // kg/s
    this.burnDuration = this.fuelRequired / mdot;
  }
  
  updateTrajectoryPreview() {
    // Create preview of post-manoeuvre trajectory
    if (!this.trajectoryPreview) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        opacity: 0.5,
        transparent: true,
        linewidth: 2
        // Removed deprecated dashSize and gapSize
      });
      
      this.trajectoryPreview = new THREE.Line(geometry, material);
    }
    
    // Calculate new trajectory after manoeuvre
    const points = [];
    const newVelocity = this.predictedVelocity.clone().add(this.deltaV);
    
    // Propagate forward from manoeuvre
    for (let i = 0; i < 100; i++) {
      const t = i * 86400; // 1 day steps
      const state = this.propagateOrbit(
        this.predictedPosition,
        newVelocity,
        t
      );
      points.push(state.position);
    }
    
    // Update line geometry
    this.trajectoryPreview.geometry.setFromPoints(points);
  }
  
  /**
   * Execute the planned manoeuvre
   */
  execute() {
    if (!this.spacecraft.systems) {
      console.error('Spacecraft lacks systems for manoeuvre execution');
      return false;
    }
    
    // Check constraints
    const systems = this.spacecraft.systems;
    
    if (this.fuelRequired > systems.propulsion.main.fuel) {
      return { success: false, reason: 'Insufficient fuel' };
    }
    
    if (systems.propulsion.main.ignitionsUsed >= systems.propulsion.main.ignitions) {
      return { success: false, reason: 'No ignitions remaining' };
    }
    
    // Schedule burn
    return {
      success: true,
      burnStart: this.timeFromNow,
      burnDuration: this.burnDuration,
      deltaV: this.deltaV.clone(),
      fuelRequired: this.fuelRequired
    };
  }
  
  dispose() {
    if (this.nodeMarker.parent) {
      this.nodeMarker.parent.remove(this.nodeMarker);
    }
    
    if (this.trajectoryPreview && this.trajectoryPreview.parent) {
      this.trajectoryPreview.parent.remove(this.trajectoryPreview);
    }
  }
}

/**
 * Manages multiple manoeuvre nodes for mission planning
 */
export class ManoeuvreManager {
  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
    this.activeNode = null;
    
    // UI group for all manoeuvre visuals
    this.visualGroup = new THREE.Group();
    this.visualGroup.name = 'ManoeuvreNodes';
    this.scene.add(this.visualGroup);
  }
  
  /**
   * Create a new manoeuvre node
   */
  createNode(spacecraft, timeFromNow) {
    const node = new ManoeuvreNode(spacecraft, timeFromNow);
    
    this.nodes.push(node);
    this.visualGroup.add(node.nodeMarker);
    
    if (node.trajectoryPreview) {
      this.visualGroup.add(node.trajectoryPreview);
    }
    
    this.activeNode = node;
    return node;
  }
  
  /**
   * Remove a manoeuvre node
   */
  removeNode(node) {
    const index = this.nodes.indexOf(node);
    if (index > -1) {
      this.nodes.splice(index, 1);
      node.dispose();
      
      if (this.activeNode === node) {
        this.activeNode = this.nodes.length > 0 ? this.nodes[0] : null;
      }
    }
  }
  
  /**
   * Update all nodes
   */
  update() {
    this.nodes.forEach(node => {
      node.updatePrediction();
    });
  }
  
  /**
   * Get next manoeuvre to execute
   */
  getNextManoeuvre() {
    if (this.nodes.length === 0) return null;
    
    // Sort by time
    const sorted = [...this.nodes].sort((a, b) => a.timeFromNow - b.timeFromNow);
    return sorted[0];
  }
  
  /**
   * Clear all nodes
   */
  clear() {
    this.nodes.forEach(node => node.dispose());
    this.nodes = [];
    this.activeNode = null;
  }
}