// src/simulation/trajectory/TrajectoryPlanner.js
import * as THREE from 'three';
import { 
  AU_TO_KM, 
  GRAVITATIONAL_PARAMETERS,
  SECONDS_PER_DAY,
  PLANETS
} from '../../utils/constants.js';
import { porkchopGrid, transferBetween, range } from '../../physics/porkchop.js';
import { helioStateEcl, eclToEqj } from '../../physics/ephemeris.js';
import { hohmann, propagate } from '../../physics/orbital.js';

// Sequential blue ramp (light = low cost). On the planner's dark surface the
// cheapest transfers read brightest; costly cells recede into the panel.
const PORKCHOP_RAMP = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
];

/**
 * Advanced trajectory planning system
 * Inspired by NASA's Trajectory Browser and KSP
 */
export class TrajectoryPlanner {
  constructor(simulation) {
    this.simulation = simulation;
    this.plannerPanel = null;
    
    // Current plan
    this.currentPlan = {
      departure: null,
      arrival: null,
      departureDate: null,
      arrivalDate: null,
      trajectory: null,
      deltaV: null,
      flybys: []
    };
    
    // Trajectory types
    this.trajectoryTypes = {
      HOHMANN: 'Hohmann Transfer',
      BIELLIPTIC: 'Bi-elliptic Transfer',
      GRAVITY_ASSIST: 'Gravity Assist',
      DIRECT: 'Direct Injection',
      BALLISTIC: 'Ballistic Capture'
    };
    
    this.createUI();
  }
  
  createUI() {
    this.plannerPanel = document.createElement('div');
    this.plannerPanel.className = 'trajectory-planner';
    this.plannerPanel.innerHTML = `
      <div class="planner-header">
        <h3>🚀 Trajectory Planner</h3>
        <button class="close-btn" id="close-planner">×</button>
      </div>
      
      <!-- Origin Selection -->
      <div class="planner-section">
        <h4>Departure</h4>
        <div class="orbit-selector">
          <select id="departure-body">
            <option value="earth">Earth</option>
            <option value="mars">Mars</option>
            <option value="venus">Venus</option>
            <option value="jupiter">Jupiter</option>
          </select>
          <div class="orbit-params">
            <label>Parking Orbit:</label>
            <input type="number" id="departure-altitude" value="200" min="0"> km
            <input type="number" id="departure-inclination" value="28.5" min="0" max="180"> deg
          </div>
        </div>
        <div class="date-selector">
          <label>Departure Date:</label>
          <input type="date" id="departure-date">
          <button id="find-window">Find Launch Window</button>
        </div>
      </div>
      
      <!-- Target Selection -->
      <div class="planner-section">
        <h4>Arrival</h4>
        <div class="orbit-selector">
          <select id="arrival-body">
            <option value="mars">Mars</option>
            <option value="venus">Venus</option>
            <option value="jupiter">Jupiter</option>
            <option value="saturn">Saturn</option>
            <option value="pluto">Pluto</option>
          </select>
          <div class="orbit-params">
            <label>Target Orbit:</label>
            <input type="number" id="arrival-altitude" value="400" min="0"> km
            <input type="number" id="arrival-inclination" value="0" min="0" max="180"> deg
          </div>
        </div>
      </div>
      
      <!-- Trajectory Type -->
      <div class="planner-section">
        <h4>Trajectory Type</h4>
        <select id="trajectory-type">
          <option value="HOHMANN">Hohmann Transfer (Minimum Energy)</option>
          <option value="DIRECT">Direct Transfer (Fast)</option>
          <option value="GRAVITY_ASSIST">Gravity Assist Route</option>
          <option value="BIELLIPTIC">Bi-elliptic (For High Orbits)</option>
        </select>
        
        <div id="gravity-assist-options" class="hidden">
          <label>Flyby Bodies:</label>
          <div class="flyby-list">
            <label><input type="checkbox" value="venus"> Venus</label>
            <label><input type="checkbox" value="earth"> Earth</label>
            <label><input type="checkbox" value="jupiter"> Jupiter</label>
          </div>
        </div>
      </div>
      
      <!-- Spacecraft Selection -->
      <div class="planner-section">
        <h4>Spacecraft</h4>
        <select id="spacecraft-type">
          <option value="chemical">Chemical Rocket (Isp: 450s)</option>
          <option value="ion">Ion Drive (Isp: 3000s)</option>
          <option value="nuclear">Nuclear Thermal (Isp: 900s)</option>
          <option value="solar-sail">Solar Sail</option>
          <option value="custom">Custom</option>
        </select>
        
        <div id="custom-spacecraft" class="hidden">
          <label>Dry Mass: <input type="number" id="dry-mass" value="1000"> kg</label>
          <label>Fuel Mass: <input type="number" id="fuel-mass" value="2000"> kg</label>
          <label>Isp: <input type="number" id="isp" value="450"> s</label>
        </div>
      </div>
      
      <!-- Calculate Button -->
      <div class="planner-controls">
        <button id="calculate-trajectory" class="primary-btn">Calculate Trajectory</button>
        <button id="optimize-trajectory" class="secondary-btn">Optimize</button>
      </div>
      
      <!-- Results -->
      <div id="trajectory-results" class="results-section hidden">
        <h4>Trajectory Analysis</h4>
        <div class="result-grid">
          <div class="result-item">
            <span class="label">Total ΔV:</span>
            <span id="total-deltav" class="value">-- km/s</span>
          </div>
          <div class="result-item">
            <span class="label">Flight Time:</span>
            <span id="flight-time" class="value">-- days</span>
          </div>
          <div class="result-item">
            <span class="label">Fuel Required:</span>
            <span id="fuel-required" class="value">-- kg</span>
          </div>
          <div class="result-item">
            <span class="label">Arrival Velocity:</span>
            <span id="arrival-velocity" class="value">-- km/s</span>
          </div>
        </div>
        
        <div class="maneuver-list">
          <h5>Maneuver Sequence</h5>
          <div id="maneuver-sequence"></div>
        </div>
        
        <div class="trajectory-actions">
          <button id="execute-trajectory" class="execute-btn">Execute Plan</button>
          <button id="save-trajectory" class="save-btn">Save</button>
          <button id="visualize-trajectory" class="viz-btn">3D Preview</button>
        </div>
      </div>
      
      <!-- Porkchop Plot -->
      <div id="porkchop-plot" class="plot-section hidden">
        <div class="porkchop-head">
          <h4>Launch window</h4>
          <select id="porkchop-metric">
            <option value="dvTotal">Total ΔV</option>
            <option value="c3">Departure C3</option>
          </select>
        </div>
        <canvas id="porkchop-canvas" width="410" height="300"></canvas>
        <div id="porkchop-legend" class="porkchop-legend"></div>
        <div id="porkchop-readout" class="porkchop-readout">Hover a cell for its transfer; click to select it.</div>
        <div id="porkchop-tooltip" class="porkchop-tooltip hidden"></div>
      </div>
    `;
    
    document.body.appendChild(this.plannerPanel);
    // The panel has transform and backdrop-filter, which make it the
    // containing block for position: fixed descendants. Keep the tooltip on
    // <body> so clientX/clientY place it in viewport coordinates.
    document.body.appendChild(document.getElementById('porkchop-tooltip'));
    this.addStyles();
    this.setupEventListeners();
    this.hide();
  }
  
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .trajectory-planner {
        position: fixed;
        left: 20px;
        top: 50%;
        transform: translateY(-50%);
        width: 450px;
        max-height: 90vh;
        background: rgba(0, 0, 0, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 10px;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        overflow-y: auto;
        backdrop-filter: blur(10px);
        z-index: 1000;
      }
      
      .planner-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 100, 255, 0.1);
      }
      
      .planner-section {
        padding: 15px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .planner-section h4 {
        margin: 0 0 10px 0;
        font-size: 14px;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.7);
      }
      
      .orbit-selector select {
        width: 100%;
        padding: 8px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 4px;
        margin-bottom: 10px;
      }
      
      .orbit-params {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: center;
        font-size: 13px;
      }
      
      .orbit-params input {
        width: 80px;
        padding: 5px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 3px;
      }
      
      .date-selector {
        margin-top: 10px;
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: center;
      }
      
      .date-selector input[type="date"] {
        padding: 5px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 3px;
      }
      
      #find-window {
        padding: 5px 10px;
        background: rgba(0, 255, 0, 0.2);
        border: 1px solid rgba(0, 255, 0, 0.5);
        color: white;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
      }
      
      .flyby-list {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 5px;
        margin-top: 10px;
      }
      
      .flyby-list label {
        display: flex;
        align-items: center;
        font-size: 13px;
      }
      
      .planner-controls {
        padding: 20px;
        display: flex;
        gap: 10px;
      }
      
      .primary-btn {
        flex: 1;
        padding: 10px;
        background: rgba(0, 100, 255, 0.3);
        border: 1px solid rgba(0, 100, 255, 0.5);
        color: white;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
      }
      
      .secondary-btn {
        padding: 10px 20px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        border-radius: 5px;
        cursor: pointer;
      }
      
      .results-section {
        padding: 20px;
        background: rgba(0, 255, 0, 0.05);
      }
      
      .result-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-bottom: 20px;
      }
      
      .result-item {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
      }
      
      .result-item .label {
        color: rgba(255, 255, 255, 0.7);
      }
      
      .result-item .value {
        font-family: 'Consolas', monospace;
        color: #00ff00;
        font-weight: bold;
      }
      
      .maneuver-list {
        background: rgba(0, 0, 0, 0.3);
        padding: 15px;
        border-radius: 5px;
        margin-bottom: 15px;
      }
      
      .maneuver-list h5 {
        margin: 0 0 10px 0;
        font-size: 13px;
      }
      
      .maneuver-item {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        padding: 8px;
        margin: 5px 0;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 3px;
        font-size: 12px;
      }
      
      .trajectory-actions {
        display: flex;
        gap: 10px;
      }
      
      .execute-btn {
        flex: 1;
        padding: 10px;
        background: rgba(0, 255, 0, 0.3);
        border: 1px solid rgba(0, 255, 0, 0.5);
        color: white;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
      }
      
      .save-btn, .viz-btn {
        padding: 10px 20px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        border-radius: 5px;
        cursor: pointer;
      }
      
      .plot-section {
        padding: 20px;
      }
      
      .porkchop-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .porkchop-head h4 { margin: 0; }

      #porkchop-metric {
        padding: 4px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 3px;
        font-size: 12px;
      }

      #porkchop-canvas {
        width: 100%;
        display: block;
        cursor: crosshair;
      }

      .porkchop-legend {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
      }

      .porkchop-legend .ramp {
        display: flex;
        flex: 1;
        height: 8px;
        gap: 1px;
      }

      .porkchop-legend .ramp span { flex: 1; border-radius: 1px; }

      .porkchop-readout {
        margin-top: 8px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        font-family: 'Consolas', monospace;
        min-height: 2.6em;
      }

      .porkchop-tooltip {
        position: fixed;
        pointer-events: none;
        background: rgba(20, 20, 20, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 4px;
        padding: 6px 8px;
        font-size: 12px;
        line-height: 1.4;
        font-family: 'Consolas', monospace;
        color: #fff;
        z-index: 1001;
        white-space: nowrap;
      }

      .hidden {
        display: none;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  setupEventListeners() {
    // Close button
    document.getElementById('close-planner').addEventListener('click', () => {
      this.hide();
    });
    
    // Trajectory type change
    document.getElementById('trajectory-type').addEventListener('change', (e) => {
      const gravityAssistOptions = document.getElementById('gravity-assist-options');
      gravityAssistOptions.classList.toggle('hidden', e.target.value !== 'GRAVITY_ASSIST');
    });
    
    // Spacecraft type change
    document.getElementById('spacecraft-type').addEventListener('change', (e) => {
      const customOptions = document.getElementById('custom-spacecraft');
      customOptions.classList.toggle('hidden', e.target.value !== 'custom');
    });
    
    // Calculate button
    document.getElementById('calculate-trajectory').addEventListener('click', () => {
      this.calculateTrajectory();
    });
    
    // Find launch window
    document.getElementById('find-window').addEventListener('click', () => {
      this.findLaunchWindow();
    });
    
    // Execute trajectory
    document.getElementById('execute-trajectory').addEventListener('click', () => {
      this.executeTrajectory();
    });
    
    // Visualize trajectory
    document.getElementById('visualize-trajectory').addEventListener('click', () => {
      this.visualizeTrajectory();
    });
    
    // Porkchop: metric toggle, hover readout, click to select
    document.getElementById('porkchop-metric').addEventListener('change', () => {
      if (this.porkchop) this.drawPorkchop();
    });
    const canvas = document.getElementById('porkchop-canvas');
    canvas.addEventListener('mousemove', (e) => this.onPorkchopHover(e));
    canvas.addEventListener('mouseleave', () => {
      document.getElementById('porkchop-tooltip').classList.add('hidden');
    });
    canvas.addEventListener('click', (e) => this.onPorkchopClick(e));
    // Hit-testing reads the current layout, so redraw whenever it changes.
    window.addEventListener('resize', () => {
      if (this.porkchop && this.plannerPanel.style.display !== 'none') this.drawPorkchop();
    });

    // Set default departure date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('departure-date').value = today;
  }
  
  show() {
    this.plannerPanel.style.display = 'block';
  }
  
  hide() {
    this.plannerPanel.style.display = 'none';
  }
  
  /**
   * Calculate trajectory based on selected parameters
   */
  async calculateTrajectory() {
    const departure = document.getElementById('departure-body').value;
    const arrival = document.getElementById('arrival-body').value;
    const trajectoryType = document.getElementById('trajectory-type').value;
    const departureDate = new Date(document.getElementById('departure-date').value);
    
    // Get orbit parameters
    const depAltitude = parseFloat(document.getElementById('departure-altitude').value);
    const arrAltitude = parseFloat(document.getElementById('arrival-altitude').value);
    
    // Calculate based on trajectory type
    let result;
    switch (trajectoryType) {
      case 'HOHMANN':
        result = this.calculateHohmannTransfer(departure, arrival, depAltitude, arrAltitude);
        break;
      case 'DIRECT':
        result = this.calculateDirectTransfer(departure, arrival, depAltitude, arrAltitude);
        break;
      case 'GRAVITY_ASSIST':
        result = await this.calculateGravityAssist(departure, arrival, depAltitude, arrAltitude);
        break;
      default:
        result = this.calculateHohmannTransfer(departure, arrival, depAltitude, arrAltitude);
    }
    
    // Store result
    this.currentPlan = {
      ...result,
      departure,
      arrival,
      departureDate,
      trajectoryType
    };
    
    // Display results
    this.displayResults(result);
  }
  
  /**
   * Calculate Hohmann transfer orbit
   */
  calculateHohmannTransfer(dep, arr, depAlt, arrAlt) {
    const depBody = this.simulation.bodies.get(dep);
    const arrBody = this.simulation.bodies.get(arr);
    
    if (!depBody || !arrBody) {
      console.error('Invalid bodies');
      return null;
    }
    
    // Get orbital radii
    const r1 = (depBody.data.semiMajorAxis || 1) * AU_TO_KM;
    const r2 = (arrBody.data.semiMajorAxis || 1.5) * AU_TO_KM;
    
    // Account for parking orbits
    const depRadius = (depBody.data.radius || 6371) + depAlt;
    const arrRadius = (arrBody.data.radius || 3390) + arrAlt;
    
    // Solar gravitational parameter
    const muSun = GRAVITATIONAL_PARAMETERS.sun / 1e9; // km³/s²
    
    // Hohmann calculations
    const a_transfer = (r1 + r2) / 2;
    const v1 = Math.sqrt(muSun / r1);
    const v_transfer_1 = Math.sqrt(muSun * (2/r1 - 1/a_transfer));
    const v_transfer_2 = Math.sqrt(muSun * (2/r2 - 1/a_transfer));
    const v2 = Math.sqrt(muSun / r2);
    
    // Delta-V requirements
    const dv_departure = Math.abs(v_transfer_1 - v1);
    const dv_arrival = Math.abs(v2 - v_transfer_2);
    
    // Add escape/capture velocities
    const muDep = GRAVITATIONAL_PARAMETERS[dep] / 1e9;
    const muArr = GRAVITATIONAL_PARAMETERS[arr] / 1e9;
    
    const v_escape = Math.sqrt(2 * muDep / depRadius);
    const v_capture = Math.sqrt(2 * muArr / arrRadius);
    
    const v_infinity_dep = dv_departure;
    const v_infinity_arr = dv_arrival;
    
    const dv_launch = Math.sqrt(v_escape * v_escape + v_infinity_dep * v_infinity_dep) - Math.sqrt(muDep / depRadius);
    const dv_capture_burn = Math.sqrt(v_capture * v_capture + v_infinity_arr * v_infinity_arr) - Math.sqrt(muArr / arrRadius);
    
    // Transfer time
    const transferTime = Math.PI * Math.sqrt(Math.pow(a_transfer, 3) / muSun) / SECONDS_PER_DAY;
    
    return {
      deltaV: {
        launch: dv_launch,
        arrival: dv_capture_burn,
        total: dv_launch + dv_capture_burn
      },
      // Signed along-track v_inf: negative (retrograde) for an inward
      // transfer, so Earth -> Venus lowers the orbit instead of raising it.
      vInfDeparture: v_transfer_1 - v1,
      transferTime: transferTime,
      maneuvers: [
        {
          time: 0,
          location: dep + ' orbit',
          deltaV: dv_launch,
          direction: 'Prograde'
        },
        {
          time: transferTime,
          location: arr + ' orbit',
          deltaV: dv_capture_burn,
          direction: 'Retrograde'
        }
      ]
    };
  }
  
  /**
   * Calculate direct high-energy transfer
   */
  calculateDirectTransfer(dep, arr, depAlt, arrAlt) {
    // Simplified - adds 30% more delta-v but 40% less time
    const hohmann = this.calculateHohmannTransfer(dep, arr, depAlt, arrAlt);
    
    return {
      deltaV: {
        launch: hohmann.deltaV.launch * 1.3,
        arrival: hohmann.deltaV.arrival * 1.3,
        total: hohmann.deltaV.total * 1.3
      },
      transferTime: hohmann.transferTime * 0.6,
      vInfDeparture: hohmann.vInfDeparture * 1.3,
      maneuvers: hohmann.maneuvers.map(m => ({
        ...m,
        deltaV: m.deltaV * 1.3
      }))
    };
  }
  
  /**
   * Calculate gravity assist trajectory
   */
  async calculateGravityAssist(dep, arr, depAlt, arrAlt) {
    // Get selected flyby bodies
    const flybyInputs = document.querySelectorAll('#gravity-assist-options input:checked');
    const flybys = Array.from(flybyInputs).map(input => input.value);
    
    if (flybys.length === 0) {
      // No flybys selected, use direct transfer
      return this.calculateHohmannTransfer(dep, arr, depAlt, arrAlt);
    }
    
    // Simplified gravity assist calculation
    // In reality, this would use Lambert solvers and patched conics
    const directTransfer = this.calculateHohmannTransfer(dep, arr, depAlt, arrAlt);
    
    // Each flyby reduces delta-v by ~20% but adds time
    const flybyReduction = Math.pow(0.8, flybys.length);
    const timeMultiplier = 1 + (flybys.length * 0.5);
    
    const maneuvers = [{
      time: 0,
      location: dep + ' orbit',
      deltaV: directTransfer.deltaV.launch * flybyReduction,
      direction: 'Prograde'
    }];
    
    // Add flyby maneuvers
    flybys.forEach((body, index) => {
      maneuvers.push({
        time: directTransfer.transferTime * 0.3 * (index + 1),
        location: body + ' flyby',
        deltaV: 0.5, // Small course correction
        direction: 'Variable'
      });
    });
    
    maneuvers.push({
      time: directTransfer.transferTime * timeMultiplier,
      location: arr + ' orbit',
      deltaV: directTransfer.deltaV.arrival * flybyReduction,
      direction: 'Retrograde'
    });
    
    return {
      deltaV: {
        launch: directTransfer.deltaV.launch * flybyReduction,
        arrival: directTransfer.deltaV.arrival * flybyReduction,
        total: directTransfer.deltaV.total * flybyReduction + (0.5 * flybys.length)
      },
      transferTime: directTransfer.transferTime * timeMultiplier,
      vInfDeparture: directTransfer.vInfDeparture * flybyReduction,
      maneuvers: maneuvers,
      flybys: flybys
    };
  }
  
  /**
   * Display calculation results
   */
  displayResults(result) {
    if (!result) return;
    
    // Show results section
    document.getElementById('trajectory-results').classList.remove('hidden');
    
    // Update values
    document.getElementById('total-deltav').textContent = result.deltaV.total.toFixed(2) + ' km/s';
    document.getElementById('flight-time').textContent = result.transferTime.toFixed(0) + ' days';
    
    // Calculate fuel required
    const spacecraft = document.getElementById('spacecraft-type').value;
    const fuel = this.calculateFuelRequired(result.deltaV.total, spacecraft);
    document.getElementById('fuel-required').textContent = 
    isFinite(fuel) && fuel > 0 ? fuel.toFixed(0) + ' kg' : 'N/A';
    
    // Arrival velocity
    const vArr = Number.isFinite(result.arrivalVinf) ? result.arrivalVinf : result.deltaV.arrival;
    document.getElementById('arrival-velocity').textContent = vArr.toFixed(2) + ' km/s';
    
    // Maneuver sequence
    const sequenceDiv = document.getElementById('maneuver-sequence');
    sequenceDiv.innerHTML = result.maneuvers.map((m, i) => `
      <div class="maneuver-item">
        <span>${i + 1}</span>
        <span>${m.location} - ${m.direction}</span>
        <span>${m.deltaV.toFixed(2)} km/s</span>
      </div>
    `).join('');
  }
  
  /**
   * Calculate fuel required using Tsiolkovsky equation
   */
  calculateFuelRequired(deltaV, spacecraftType) {
    let isp, dryMass;
    
    switch (spacecraftType) {
      case 'chemical':
        isp = 450;
        dryMass = 1000;
        break;
      case 'ion':
        isp = 3000;
        dryMass = 800;
        break;
      case 'nuclear':
        isp = 900;
        dryMass = 2000;
        break;
      case 'custom':
        isp = parseFloat(document.getElementById('isp').value);
        dryMass = parseFloat(document.getElementById('dry-mass').value);
        break;
      default:
        isp = 450;
        dryMass = 1000;
    }
    
    const exhaustVelocity = isp * 9.81 / 1000; // km/s
    const massRatio = Math.exp(deltaV / exhaustVelocity);
    
    // Add this check to prevent infinity
    if (!isFinite(massRatio) || massRatio <= 1) {
        return 0;
    }
    
    const fuelMass = dryMass * (massRatio - 1);
    return fuelMass;
    }
  
  /**
   * Launch-window (porkchop) grid from the verified Lambert solver.
   * Departure axis: one synodic period from the selected departure date.
   * Time-of-flight axis: 0.4x to 1.6x the Hohmann time between the two orbits.
   */
  findLaunchWindow() {
    const depKey = document.getElementById('departure-body').value;
    const arrKey = document.getElementById('arrival-body').value;
    const readout = document.getElementById('porkchop-readout');
    document.getElementById('porkchop-plot').classList.remove('hidden');

    const depData = PLANETS[depKey], arrData = PLANETS[arrKey];
    if (depKey === arrKey || !depData || !arrData) {
      readout.textContent = 'Pick two different planets.';
      return;
    }

    const muSun = GRAVITATIONAL_PARAMETERS.sun / 1e9;          // km^3/s^2
    const muDep = GRAVITATIONAL_PARAMETERS[depKey] / 1e9;
    const muArr = GRAVITATIONAL_PARAMETERS[arrKey] / 1e9;
    const depAlt = parseFloat(document.getElementById('departure-altitude').value) || 0;
    const arrAlt = parseFloat(document.getElementById('arrival-altitude').value) || 0;
    const capture = Number.isFinite(muArr);                     // no GM => flyby only

    const dateStr = document.getElementById('departure-date').value;
    const depStart = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date();

    // Axes. Integer-day steps let arrival states repeat across the grid (cached).
    const T1 = depData.orbitalPeriod, T2 = arrData.orbitalPeriod;
    const synodic = 1.0 / Math.abs(1.0 / T1 - 1.0 / T2);
    const depSpan = Math.min(Math.max(synodic, 365), 1100);
    const h = hohmann(depData.semiMajorAxis * AU_TO_KM, arrData.semiMajorAxis * AU_TO_KM, muSun);
    const tH = h.tof / SECONDS_PER_DAY;
    const depStep = Math.max(1, Math.round(depSpan / 120));
    const tofMin = Math.max(20, Math.round(0.4 * tH));
    const tofMax = Math.round(1.6 * tH);
    const tofStep = Math.max(1, Math.round((tofMax - tofMin) / 90));

    readout.textContent = 'Computing…';
    // Let the panel paint before the (synchronous) grid runs.
    setTimeout(() => {
      const t0 = performance.now();
      this.porkchop = porkchopGrid({
        stateOf: helioStateEcl,
        departure: { key: depKey, mu: muDep, rPark: depData.radius + depAlt },
        arrival: { key: arrKey, mu: capture ? muArr : 1, rPark: arrData.radius + arrAlt, capture },
        muSun,
        depStart,
        depDays: range(0, depSpan, depStep),
        tofDays: range(tofMin, tofMax, tofStep),
      });
      this.porkchop.depKey = depKey;
      this.porkchop.arrKey = arrKey;
      this.porkchop.capture = capture;
      this.porkchop.elapsedMs = performance.now() - t0;
      this.porkchopSelected = null;
      this.drawPorkchop();
      const m = this.porkchop.minTotal;
      const g = this.porkchop;
      const onEdge = m && (m.iDep === 0 || m.iDep === g.nDep - 1 || m.iTof === 0 || m.iTof === g.nTof - 1);
      readout.textContent = m
        ? `Minimum ΔV ${m.dvTotal.toFixed(2)} km/s: depart ${this.fmtDate(m.departure)}, ` +
          `${m.tofDays} d (${g.nDep}×${g.nTof} Lambert solves, ${g.elapsedMs.toFixed(0)} ms)` +
          (onEdge ? '. This is on the edge of the grid, so a lower minimum may lie ' +
            'outside it: try an earlier departure date.' : '')
        : 'No transfers found in this window.';
    }, 0);
  }

  fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  // Plot geometry in CSS pixels (the canvas is scaled for devicePixelRatio).
  porkchopLayout() {
    const canvas = document.getElementById('porkchop-canvas');
    const w = canvas.clientWidth || 410;
    const hgt = Math.round(w * 0.72);
    return { canvas, w, h: hgt, left: 46, right: 10, top: 10, bottom: 34 };
  }

  drawPorkchop() {
    const g = this.porkchop;
    if (!g) return;
    const L = this.porkchopLayout();
    const dpr = window.devicePixelRatio || 1;
    L.canvas.width = Math.round(L.w * dpr);
    L.canvas.height = Math.round(L.h * dpr);
    L.canvas.style.height = L.h + 'px';
    const ctx = L.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);

    const metric = document.getElementById('porkchop-metric').value;
    const values = g[metric];
    const best = metric === 'c3' ? g.minC3 : g.minTotal;
    const unit = metric === 'c3' ? 'km²/s²' : 'km/s';
    if (!best) return;

    // Bands: 13 ramp steps from the minimum up to roughly the 30th percentile,
    // so the basins get the resolution and costly cells fall off the ramp.
    const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
    const lo = best[metric === 'c3' ? 'c3' : 'dvTotal'];
    const p30 = finite[Math.floor(0.3 * (finite.length - 1))];
    const band = this.niceStep((p30 - lo) / PORKCHOP_RAMP.length);
    this.porkchopScale = { lo, band, unit, metric };

    const pw = L.w - L.left - L.right, ph = L.h - L.top - L.bottom;
    const cw = pw / g.nDep, chh = ph / g.nTof;
    for (let j = 0; j < g.nTof; j++) {
      for (let i = 0; i < g.nDep; i++) {
        const v = values[j * g.nDep + i];
        if (!Number.isFinite(v)) continue;
        const k = Math.floor((v - lo) / band);
        if (k >= PORKCHOP_RAMP.length) continue;              // costly: leave the surface
        ctx.fillStyle = PORKCHOP_RAMP[Math.max(0, k)];
        // TOF increases upward; overlap by 0.5 px to avoid seams.
        ctx.fillRect(L.left + i * cw, L.top + ph - (j + 1) * chh, cw + 0.5, chh + 0.5);
      }
    }

    // Axes (recessive) and ticks.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L.left, L.top); ctx.lineTo(L.left, L.top + ph); ctx.lineTo(L.left + pw, L.top + ph);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    // x: month ticks, at most ~5 labels.
    const dayMs = SECONDS_PER_DAY * 1000;
    const t0 = g.depStart.getTime();
    const spanDays = g.depDays[g.depDays.length - 1];
    const monthsStep = Math.max(1, Math.ceil(spanDays / 30.44 / 5));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(Date.UTC(g.depStart.getUTCFullYear(), g.depStart.getUTCMonth() + 1, 1));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Cell i covers [i, i+1) * cw with its centre at departure depDays[i], so
    // a tick for day t sits at (t / step + 0.5) * cw.
    const depStep = g.nDep > 1 ? g.depDays[1] - g.depDays[0] : 1;
    for (; (d.getTime() - t0) / dayMs <= spanDays; d.setUTCMonth(d.getUTCMonth() + monthsStep)) {
      const x = L.left + (((d.getTime() - t0) / dayMs) / depStep + 0.5) * cw;
      ctx.fillRect(x, L.top + ph, 1, 4);
      ctx.fillText(`${months[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`, x, L.top + ph + 6);
    }
    ctx.fillText('Departure', L.left + pw / 2, L.top + ph + 20);

    // y: time-of-flight ticks.
    const tofLo = g.tofDays[0], tofHi = g.tofDays[g.tofDays.length - 1];
    const yStep = this.niceStep((tofHi - tofLo) / 5);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let t = Math.ceil(tofLo / yStep) * yStep; t <= tofHi; t += yStep) {
      const tofStep = g.nTof > 1 ? g.tofDays[1] - g.tofDays[0] : 1;
      const y = L.top + ph - ((t - tofLo) / tofStep + 0.5) * chh;
      ctx.fillRect(L.left - 4, y, 4, 1);
      ctx.fillText(`${t} d`, L.left - 6, y);
    }

    // Minimum marker: white ring with a dark surface ring, direct label.
    const mx = L.left + (best.iDep + 0.5) * cw;
    const my = L.top + ph - (best.iTof + 0.5) * chh;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.beginPath(); ctx.arc(mx, my, 5, 0, 2 * Math.PI); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(mx, my, 5, 0, 2 * Math.PI); ctx.stroke();
    const label = `min ${lo.toFixed(2)} ${unit}`;
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const tw = ctx.measureText(label).width;
    const lx = mx + 10 + tw > L.left + pw ? mx - 10 - tw : mx + 10;
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';                     // halo keeps it legible on light cells
    ctx.strokeText(label, lx, my);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, lx, my);

    // Selected cell.
    if (this.porkchopSelected) {
      const s = this.porkchopSelected;
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(L.left + s.iDep * cw - 2, L.top + ph - (s.iTof + 1) * chh - 2, cw + 4, chh + 4);
    }

    // Legend: the ramp with its end values.
    const hi = lo + band * PORKCHOP_RAMP.length;
    const name = metric === 'c3' ? 'C3' : 'ΔV';
    document.getElementById('porkchop-legend').innerHTML =
      `<span>${name} ${lo.toFixed(1)}</span><span class="ramp">` +
      PORKCHOP_RAMP.map((c) => `<span style="background:${c}"></span>`).join('') +
      `</span><span>${hi.toFixed(1)} ${unit}</span>`;
  }

  // 1, 2, 2.5 or 5 times a power of ten, at least x.
  niceStep(x) {
    if (!(x > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p;
    return 10 * p;
  }

  porkchopCellAt(e) {
    const g = this.porkchop;
    if (!g) return null;
    const L = this.porkchopLayout();
    const rect = L.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const pw = L.w - L.left - L.right, ph = L.h - L.top - L.bottom;
    const i = Math.floor((x - L.left) / pw * g.nDep);
    const j = Math.floor((L.top + ph - y) / ph * g.nTof);
    if (i < 0 || i >= g.nDep || j < 0 || j >= g.nTof) return null;
    const idx = j * g.nDep + i;
    const dayMs = SECONDS_PER_DAY * 1000;
    const departure = new Date(g.depStart.getTime() + g.depDays[i] * dayMs);
    return {
      iDep: i, iTof: j, idx, departure,
      arrival: new Date(departure.getTime() + g.tofDays[j] * dayMs),
      tofDays: g.tofDays[j],
      c3: g.c3[idx], vinfArr: g.vinfArr[idx], dvDep: g.dvDep[idx],
      dvArr: g.dvArr[idx], dvTotal: g.dvTotal[idx], type: g.type[idx],
    };
  }

  onPorkchopHover(e) {
    const tip = document.getElementById('porkchop-tooltip');
    const c = this.porkchopCellAt(e);
    if (!c) { tip.classList.add('hidden'); return; }
    tip.innerHTML = Number.isFinite(c.dvTotal)
      ? `Depart ${this.fmtDate(c.departure)}<br>Arrive ${this.fmtDate(c.arrival)} (${c.tofDays} d)<br>` +
        `C3 ${c.c3.toFixed(2)} km²/s²  v∞ arr ${c.vinfArr.toFixed(2)} km/s<br>` +
        `ΔV ${c.dvDep.toFixed(2)} + ${c.dvArr.toFixed(2)} = <b>${c.dvTotal.toFixed(2)}</b> km/s<br>` +
        `Type ${c.type === 1 ? 'I' : 'II'}`
      : `Depart ${this.fmtDate(c.departure)}, ${c.tofDays} d<br>No transfer (degenerate geometry)`;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
    tip.classList.remove('hidden');
  }

  onPorkchopClick(e) {
    const c = this.porkchopCellAt(e);
    if (!c || !Number.isFinite(c.dvTotal)) return;
    const g = this.porkchop;
    this.porkchopSelected = c;
    this.drawPorkchop();

    // Full Lambert solution for the 3D preview.
    const depState = helioStateEcl(g.depKey, c.departure);
    const arrState = helioStateEcl(g.arrKey, c.arrival);
    const depData = PLANETS[g.depKey], arrData = PLANETS[g.arrKey];
    const depAlt = parseFloat(document.getElementById('departure-altitude').value) || 0;
    const arrAlt = parseFloat(document.getElementById('arrival-altitude').value) || 0;
    const t = transferBetween(depState, arrState, c.tofDays * SECONDS_PER_DAY,
      GRAVITATIONAL_PARAMETERS.sun / 1e9,
      { mu: GRAVITATIONAL_PARAMETERS[g.depKey] / 1e9, rPark: depData.radius + depAlt },
      { mu: g.capture ? GRAVITATIONAL_PARAMETERS[g.arrKey] / 1e9 : 1, rPark: arrData.radius + arrAlt, capture: g.capture });
    if (!t) return;

    const result = {
      deltaV: { launch: t.dvDep, arrival: t.dvArr, total: t.dvTotal },
      arrivalVinf: t.vinfArr,
      transferTime: c.tofDays,
      maneuvers: [
        { time: 0, location: g.depKey + ' orbit', deltaV: t.dvDep, direction: 'Prograde' },
        ...(g.capture ? [{ time: c.tofDays, location: g.arrKey + ' orbit', deltaV: t.dvArr, direction: 'Retrograde' }] : []),
      ],
      lambert: { r1: depState.r, v1: t.v1, tofSec: c.tofDays * SECONDS_PER_DAY, arrivalDate: c.arrival },
    };
    this.currentPlan = {
      ...result,
      departure: g.depKey,
      arrival: g.arrKey,
      departureDate: c.departure,
      trajectoryType: 'LAMBERT',
    };
    this.displayResults(result);
    document.getElementById('porkchop-readout').textContent =
      `Selected: depart ${this.fmtDate(c.departure)}, ${c.tofDays} d, C3 ${c.c3.toFixed(2)} km²/s², ` +
      `ΔV ${t.dvTotal.toFixed(2)} km/s (Type ${t.type === 1 ? 'I' : 'II'})`;
  }

  /**
   * Execute the planned trajectory
   */
  executeTrajectory() {
    if (!this.currentPlan || !this.currentPlan.maneuvers) {
      alert('No trajectory calculated');
      return;
    }
    
    const depBody = this.currentPlan.departure;
    const spacecraftName = `Mission-${this.currentPlan.arrival.toUpperCase()}`;
    const L = this.currentPlan.lambert;
    let spacecraft;
    
    if (L) {
      // A Lambert plan from the porkchop: launch at its departure date with
      // its exact v_inf (the arc's departure velocity minus the planet's).
      const dep = this.currentPlan.departureDate;
      const planet = helioStateEcl(depBody, dep);
      const vInfEqj = eclToEqj([0, 1, 2].map((i) => L.v1[i] - planet.v[i]));
      const tc = this.simulation.timeController;
      if (Math.abs(tc.currentDate.getTime() - dep.getTime()) > 1000) {
        tc.setDate(dep);
        this.simulation.updateBodyPositions();
      }
      const parkingAltitude = parseFloat(document.getElementById('departure-altitude').value) || 200;
      spacecraft = this.simulation.launchSpacecraft(spacecraftName, depBody, null, { vInfEqj, parkingAltitude });
    } else {
      // Hohmann estimate: v_inf along the prograde (along-track, y) axis of
      // the RSW frame launchSpacecraft takes. It used to go on x (radial) and
      // to use the parking-orbit burn instead of v_inf.
      const vInf = this.currentPlan.vInfDeparture;
      if (!Number.isFinite(vInf)) {
        alert('This plan has no departure v_inf. Pick a transfer in the launch window instead.');
        return;
      }
      spacecraft = this.simulation.launchSpacecraft(spacecraftName, depBody, new THREE.Vector3(0, vInf, 0));
    }
    
    if (!spacecraft) {
      alert('Failed to launch spacecraft');
      return;
    }
    
    // No arrival burn is scheduled for any plan: a burn timed for arrival and
    // pointed relative to the Sun is not a capture, and patched-conic capture
    // at the target is not modelled yet.
    [].forEach(maneuver => {
    if (spacecraft.addManoeuvreNode) {
        const node = spacecraft.addManoeuvreNode(maneuver.time * SECONDS_PER_DAY);
        
        // Fix: Make sure deltaV is a Vector3
        let dvVector = new THREE.Vector3();
        switch (maneuver.direction) {
        case 'Retrograde':
            dvVector.set(0, -maneuver.deltaV, 0);
            break;
        case 'Prograde':
            dvVector.set(0, maneuver.deltaV, 0);
            break;
        default:
            dvVector.set(maneuver.deltaV, 0, 0);
        }
        
        node.setDeltaV(dvVector.x, dvVector.y, dvVector.z);
    }
    });
    
    // Close planner
    this.hide();
    
    // Focus on spacecraft
    this.simulation.focusOnSpacecraft(spacecraft);
    
    // Show notification
    this.simulation.showNotification(L
      ? `${spacecraftName} launched on the Lambert arc to ${this.currentPlan.arrival}, ` +
        `arriving ${this.fmtDate(L.arrivalDate)} (no capture burn: not modelled yet)`
      : `${spacecraftName} launched toward ${this.currentPlan.arrival} (estimate; no capture burn: not modelled yet)`
    );
  }
  
  /**
   * Visualize trajectory in 3D
   */
visualizeTrajectory() {
  if (!this.currentPlan) return;
  if (this.currentPlan.lambert) {
    this.visualizeLambertArc();
    return;
  }
  
  // Get bodies
  const depBody = this.simulation.bodies.get(this.currentPlan.departure);
  const arrBody = this.simulation.bodies.get(this.currentPlan.arrival);
  
  if (!depBody || !arrBody) return;
  
  // Calculate actual transfer orbit
  const points = [];
  const segments = 100;
  
  // Starting position (Earth now)
  const r1 = depBody.position.length(); // AU from Sun
  const startAngle = Math.atan2(depBody.position.z, depBody.position.x);
  
  // For Hohmann transfer, semi-major axis
  const r2 = arrBody.data.semiMajorAxis || 1.524; // Mars orbit radius
  const a = (r1 + r2) / 2; // Semi-major axis of transfer orbit
  
  // Transfer orbit parameters
  const e = Math.abs(r2 - r1) / (r2 + r1); // Eccentricity
  const p = a * (1 - e * e); // Semi-latus rectum
  
  // Generate transfer ellipse
  for (let i = 0; i <= segments; i++) {
    const transferAngle = (i / segments) * Math.PI; // 0 to 180 degrees
    const angle = startAngle + transferAngle;
    
    // Ellipse equation in polar coordinates
    const r = p / (1 + e * Math.cos(transferAngle));
    
    const point = new THREE.Vector3(
      r * Math.cos(angle),
      0, // Keep in ecliptic plane
      r * Math.sin(angle)
    );
    
    points.push(point);
  }
  
  // Create the trajectory line
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    opacity: 0.8,
    transparent: true,
    linewidth: 3
  });
  
  const trajectoryLine = new THREE.Line(geometry, material);
  trajectoryLine.name = 'TrajectoryPreview';
  
  // Also show where Mars WILL BE
  const transferTime = this.currentPlan.transferTime; // days
  const marsAngle = 2 * Math.PI * (transferTime / arrBody.data.orbitalPeriod);
  const futureAngle = Math.atan2(arrBody.position.z, arrBody.position.x) + marsAngle;
  
  // Mars future position indicator
  const markerGeometry = new THREE.SphereGeometry(0.05, 16, 16);
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.5
  });
  const futureMarker = new THREE.Mesh(markerGeometry, markerMaterial);
  futureMarker.position.set(
    r2 * Math.cos(futureAngle),
    0,
    r2 * Math.sin(futureAngle)
  );
  
  // Remove old preview
  const oldPreview = this.simulation.scene.getObjectByName('TrajectoryPreview');
  if (oldPreview) this.simulation.scene.remove(oldPreview);
  
  const oldMarker = this.simulation.scene.getObjectByName('FutureMarsPosition');
  if (oldMarker) this.simulation.scene.remove(oldMarker);
  
  // Add new preview
  this.simulation.scene.add(trajectoryLine);
  futureMarker.name = 'FutureMarsPosition';
  this.simulation.scene.add(futureMarker);
  
  // Animate camera to show full trajectory
  const center = new THREE.Vector3(0, 0, 0); // Sun
  this.simulation.camera.position.set(0, 3, 3);
  this.simulation.controls.target.copy(center);
  this.simulation.controls.update();
}

  /**
   * 3D preview of the selected Lambert arc: the solver's departure state
   * propagated with the two-body core, drawn in the scene's frame (EQJ AU,
   * mapped to three.js as (x, z, -y)), with the target at its real arrival
   * position from the ephemeris.
   */
  visualizeLambertArc() {
    const L = this.currentPlan.lambert;
    const mu = GRAVITATIONAL_PARAMETERS.sun / 1e9;
    const toScene = (rEcl) => {
      const q = eclToEqj(rEcl);
      return new THREE.Vector3(q[0] / AU_TO_KM, q[2] / AU_TO_KM, -q[1] / AU_TO_KM);
    };
    const points = [];
    const segments = 200;
    for (let k = 0; k <= segments; k++) {
      const s = propagate(L.r1, L.v1, (k / segments) * L.tofSec, mu);
      if (s) points.push(toScene(s.r));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x00ffff, opacity: 0.8, transparent: true })
    );
    line.name = 'TrajectoryPreview';

    const arr = helioStateEcl(this.currentPlan.arrival, L.arrivalDate);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 })
    );
    marker.position.copy(toScene(arr.r));
    marker.name = 'FutureMarsPosition';

    for (const name of ['TrajectoryPreview', 'FutureMarsPosition']) {
      const old = this.simulation.scene.getObjectByName(name);
      if (old) this.simulation.scene.remove(old);
    }
    this.simulation.scene.add(line);
    this.simulation.scene.add(marker);
    this.simulation.camera.position.set(0, 3, 3);
    this.simulation.controls.target.set(0, 0, 0);
    this.simulation.controls.update();
  }
}
