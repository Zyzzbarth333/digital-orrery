// src/simulation/spacecraft/SpacecraftSystems.js
import * as THREE from 'three';

/**
 * Manages spacecraft subsystems with realistic constraints
 */
export class SpacecraftSystems {
  constructor(config = {}) {
    // Power System
    this.power = {
      solarPanelEfficiency: config.solarPanelEfficiency || 0.3,
      solarPanelArea: config.solarPanelArea || 20, // m²
      batteryCapacity: config.batteryCapacity || 100, // kWh
      batteryCharge: config.batteryCapacity || 100, // kWh
      currentGeneration: 0, // W
      currentConsumption: 0, // W
      
      // Power consumers
      consumers: {
        baseload: 500, // W - always on
        propulsion: 2000, // W - when thrusting
        communications: 800, // W - when transmitting
        instruments: 300, // W - when active
        thermalControl: 600 // W - varies with temperature
      }
    };
    
    // Thermal System
    this.thermal = {
      internalTemp: 293, // K (20°C)
      externalTemp: 0, // K - calculated from solar distance
      heatCapacity: 50000, // J/K
      radiatorArea: 10, // m²
      radiatorEmissivity: 0.9,
      
      // Temperature limits
      limits: {
        min: 253, // K (-20°C)
        max: 323, // K (50°C)
        optimal: 293 // K (20°C)
      }
    };
    
    // Communications System
    this.comms = {
      dishDiameter: config.dishDiameter || 2, // m
      transmitPower: config.transmitPower || 100, // W
      frequency: 8.4e9, // Hz (X-band)
      dataRate: 0, // bps - calculated from distance
      earthDistance: 0, // AU
      signalDelay: 0, // seconds
      inContact: false
    };
    
    // Attitude Control System
    this.attitude = {
      orientation: new THREE.Quaternion(),
      angularVelocity: new THREE.Vector3(),
      reactionWheels: {
        momentum: new THREE.Vector3(), // Nms
        maxMomentum: 50, // Nms per axis
        torque: 0.1 // Nm
      },
      rcs: {
        fuel: config.rcsFuel || 50, // kg
        thrust: 10, // N per thruster
        specificImpulse: 220 // s
      },
      mode: 'INERTIAL', // INERTIAL, PROGRADE, RETROGRADE, RADIAL, NORMAL, SUN_POINTING
      targetOrientation: new THREE.Quaternion()
    };
    
    // Propulsion variants
    this.propulsion = {
      main: {
        type: config.mainEngineType || 'CHEMICAL',
        fuel: config.fuel || 500, // kg
        oxidizer: config.oxidizer || 800, // kg  
        thrust: config.thrust || 50000, // N
        specificImpulse: config.isp || 350, // s
        throttle: 0, // 0-1
        ignitions: config.ignitions || 10,
        ignitionsUsed: 0
      },
      ion: {
        type: 'ION',
        xenon: config.xenon || 100, // kg
        thrust: 0.09, // N (realistic ion drive)
        specificImpulse: 3000, // s
        powerRequired: 2000, // W
        active: false
      }
    };
    
    // System health
    this.health = {
      overall: 100,
      degradation: {
        solarPanels: 0, // % efficiency loss
        battery: 0, // % capacity loss
        reaction_wheels: 0 // % performance loss
      }
    };
  }
  
  /**
   * Update all systems for one timestep
   */
  update(spacecraft, solarSystem, deltaTime) {
    // Update based on environment
    this.updateEnvironment(spacecraft, solarSystem);
    
    // Update each subsystem
    this.updatePowerSystem(deltaTime);
    this.updateThermalSystem(deltaTime);
    this.updateCommunications(spacecraft);
    this.updateAttitudeControl(spacecraft, deltaTime);
    this.updateSystemHealth(deltaTime);
    
    // Check for failures
    this.checkSystemConstraints();
  }
  
   updateEnvironment(spacecraft, solarSystem) {
  // Calculate solar distance and intensity
  const sun = solarSystem.bodies.get('sun');
  if (!sun || !sun.position) {
    // Sun not loaded yet, use defaults
    this.solarIntensity = 1361; // Solar constant at 1 AU
    this.thermal.externalTemp = 278; // ~5°C default
    this.comms.earthDistance = 1; // Default 1 AU
    return;
  }
  
  const sunPos = sun.position;
  const distance = spacecraft.position.distanceTo(sunPos);
  
  // Add minimum distance check to prevent infinity
  const minDistance = 0.01; // 0.01 AU minimum
  const safeDistance = Math.max(distance, minDistance);
  
  // Validate distance
  if (!isFinite(safeDistance) || safeDistance === 0) {
    console.warn('Invalid distance to sun, using default');
    this.solarIntensity = 1361;
    this.thermal.externalTemp = 278;
  } else {
    this.solarIntensity = 1361 / (safeDistance * safeDistance); // W/m² at spacecraft
    // Update external temperature (simplified)
    this.thermal.externalTemp = 2.7 + 278 * Math.pow(safeDistance, -0.5);
  }
  
  // Earth distance for communications
  const earth = solarSystem.bodies.get('earth');
  if (earth && earth.position) {
    this.comms.earthDistance = spacecraft.position.distanceTo(earth.position);
  } else {
    this.comms.earthDistance = 1; // Default 1 AU
  }
}
  
  updatePowerSystem(deltaTime) {
    const dt = deltaTime / 3600; // Convert to hours
    
    // Solar panel generation (affected by degradation)
    const panelEfficiency = this.power.solarPanelEfficiency * 
                          (1 - this.health.degradation.solarPanels / 100);
    this.power.currentGeneration = this.solarIntensity * 
                                 this.power.solarPanelArea * 
                                 panelEfficiency;
    
    // Calculate total consumption
    this.power.currentConsumption = this.power.consumers.baseload;
    
    if (this.propulsion.main.throttle > 0) {
      this.power.currentConsumption += this.power.consumers.propulsion;
    }
    
    if (this.comms.inContact) {
      this.power.currentConsumption += this.power.consumers.communications;
    }
    
    // Battery charge/discharge
    const powerBalance = this.power.currentGeneration - this.power.currentConsumption;
    this.power.batteryCharge += powerBalance * dt / 1000; // kWh
    
    // Clamp battery charge
    const maxCapacity = this.power.batteryCapacity * (1 - this.health.degradation.battery / 100);
    this.power.batteryCharge = Math.max(0, Math.min(maxCapacity, this.power.batteryCharge));
  }
  
    updateThermalSystem(deltaTime) {
    // Prevent invalid temperatures
    if (!isFinite(this.thermal.internalTemp) || this.thermal.internalTemp < 0) {
        this.thermal.internalTemp = 293; // Reset to room temp
    }
    // Simplified thermal model
    const internalHeat = this.power.currentConsumption; // Waste heat
    const solarHeating = this.solarIntensity * 2; // m² cross-section
    const radiatorCooling = this.thermal.radiatorEmissivity * 
                          this.thermal.radiatorArea * 
                          5.67e-8 * // Stefan-Boltzmann
                          Math.pow(this.thermal.internalTemp, 4);
    
    const netHeat = internalHeat + solarHeating - radiatorCooling;
    const tempChange = (netHeat * deltaTime) / this.thermal.heatCapacity;
    
    this.thermal.internalTemp += tempChange;
    
    // Active thermal control power usage
    const tempError = Math.abs(this.thermal.internalTemp - this.thermal.limits.optimal);
    this.power.consumers.thermalControl = 200 + tempError * 10;
    this.thermal.internalTemp = Math.max(100, Math.min(400, this.thermal.internalTemp));
}
  
  updateCommunications(spacecraft) {
    // Calculate data rate based on distance (simplified link budget)
    const distance = this.comms.earthDistance * 149597870.7; // km to m
    const pathLoss = Math.pow(4 * Math.PI * distance * this.comms.frequency / 3e8, 2);
    
    // Simplified - assumes 70m DSN dish, 20K receiver
    const receivedPower = this.comms.transmitPower * 
                        Math.pow(this.comms.dishDiameter, 2) * 
                        4900 / pathLoss; // 70m dish gain
    
    // Shannon limit approximation
    this.comms.dataRate = 20000 * Math.log2(1 + receivedPower / 1e-20);
    
    // Signal delay
    this.comms.signalDelay = distance / 3e8;
    
    // Check if in contact (simplified - always true for now)
    this.comms.inContact = true;
  }
  
  updateAttitudeControl(spacecraft, deltaTime) {
    // Update reaction wheel momentum based on torques
    if (this.attitude.mode !== 'INERTIAL') {
      // Calculate required orientation based on mode
      this.calculateTargetAttitude(spacecraft);
      
      // Simple proportional controller
      const quaternionError = this.attitude.targetOrientation.clone()
        .multiply(this.attitude.orientation.clone().invert());
      
      const axis = new THREE.Vector3();
      const angle = quaternionError.getAxisAngle(axis);
      
      if (angle > 0.01) { // deadband
        const torque = axis.multiplyScalar(angle * 0.1); // P-gain
        this.applyTorque(torque, deltaTime);
      }
    }
    
    // Update spacecraft mesh orientation
    spacecraft.mesh.quaternion.copy(this.attitude.orientation);
  }
  
  calculateTargetAttitude(spacecraft) {
    const velocity = spacecraft.velocity.clone().normalize();
    const position = spacecraft.position.clone().normalize();
    
    switch(this.attitude.mode) {
      case 'PROGRADE':
        this.attitude.targetOrientation.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), 
          velocity
        );
        break;
        
      case 'RETROGRADE':
        this.attitude.targetOrientation.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), 
          velocity.negate()
        );
        break;
        
      case 'RADIAL':
        this.attitude.targetOrientation.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), 
          position
        );
        break;
        
      case 'SUN_POINTING':
        // Point solar panels at sun
        const sunDir = spacecraft.position.clone().negate().normalize();
        this.attitude.targetOrientation.setFromUnitVectors(
          new THREE.Vector3(1, 0, 0), 
          sunDir
        );
        break;
    }
  }
  
  applyTorque(torque, deltaTime) {
    // Check reaction wheel saturation
    const totalMomentum = this.attitude.reactionWheels.momentum.length();
    
    if (totalMomentum < this.attitude.reactionWheels.maxMomentum * 0.8) {
      // Use reaction wheels
      this.attitude.reactionWheels.momentum.add(
        torque.clone().multiplyScalar(deltaTime)
      );
      
      // Update angular velocity
      this.attitude.angularVelocity.copy(torque.multiplyScalar(0.1));
      
      // Update orientation
      const deltaRotation = new THREE.Quaternion().setFromAxisAngle(
        this.attitude.angularVelocity.clone().normalize(),
        this.attitude.angularVelocity.length() * deltaTime
      );
      
      this.attitude.orientation.multiply(deltaRotation);
    } else {
      // Need to desaturate wheels using RCS
      this.desaturateReactionWheels(deltaTime);
    }
  }
  
  desaturateReactionWheels(deltaTime) {
    if (this.attitude.rcs.fuel <= 0) return;
    
    // Fire RCS to counteract wheel momentum
    const fuelUsed = 0.01 * deltaTime; // kg/s
    this.attitude.rcs.fuel -= fuelUsed;
    
    // Reduce wheel momentum
    this.attitude.reactionWheels.momentum.multiplyScalar(0.99);
  }
  
  updateSystemHealth(deltaTime) {
    const days = deltaTime / 86400;
    
    // Solar panel degradation (0.5% per year)
    this.health.degradation.solarPanels += 0.5 * days / 365;
    
    // Battery degradation (2% per year)
    this.health.degradation.battery += 2.0 * days / 365;
    
    // Reaction wheel wear (1% per year)
    this.health.degradation.reaction_wheels += 1.0 * days / 365;
    
    // Overall health
    this.health.overall = 100 - (
      this.health.degradation.solarPanels * 0.3 +
      this.health.degradation.battery * 0.4 +
      this.health.degradation.reaction_wheels * 0.3
    );
  }
  
  checkSystemConstraints() {
    const warnings = [];
    
    // Power warnings
    if (this.power.batteryCharge < this.power.batteryCapacity * 0.2) {
      warnings.push('LOW BATTERY: ' + this.power.batteryCharge.toFixed(1) + ' kWh');
    }
    
    if (this.power.currentConsumption > this.power.currentGeneration * 1.5) {
      warnings.push('POWER DEFICIT: ' + 
        (this.power.currentConsumption - this.power.currentGeneration).toFixed(0) + ' W');
    }
    
    // Thermal warnings
    if (this.thermal.internalTemp < this.thermal.limits.min ||
        this.thermal.internalTemp > this.thermal.limits.max) {
      warnings.push('THERMAL VIOLATION: ' + (this.thermal.internalTemp - 273).toFixed(1) + '°C');
    }
    
    // Attitude control warnings
    const wheelSaturation = this.attitude.reactionWheels.momentum.length() / 
                          this.attitude.reactionWheels.maxMomentum;
    if (wheelSaturation > 0.8) {
      warnings.push('REACTION WHEELS SATURATING: ' + (wheelSaturation * 100).toFixed(0) + '%');
    }
    
    // Fuel warnings
    if (this.propulsion.main.fuel < 50) {
      warnings.push('LOW FUEL: ' + this.propulsion.main.fuel.toFixed(1) + ' kg');
    }
    
    return warnings;
  }
  
  /**
   * Execute a burn with realistic constraints
   */
    executeBurn(deltaV, duration, spacecraft) {
    // Check if deltaV is a number or vector
    const deltaVMagnitude = typeof deltaV === 'number' ? deltaV : deltaV.length();
    
    // Check ignitions remaining
    if (this.propulsion.main.ignitionsUsed >= this.propulsion.main.ignitions) {
        return { success: false, reason: 'No ignitions remaining' };
    }
    
    // Check fuel
    const fuelRequired = this.calculateFuelRequired(deltaVMagnitude, spacecraft.mass);
    if (fuelRequired > this.propulsion.main.fuel) {
      return { success: false, reason: 'Insufficient fuel' };
    }
    
    // Check power
    if (this.power.batteryCharge < 10) {
      return { success: false, reason: 'Insufficient power' };
    }
    
    // Execute burn. The burn's own end time (BaseSpacecraft burns) sets the
    // throttle back to 0: a real-time timer here ran burns for `duration`
    // wall-clock seconds, i.e. days of sim time at warp.
    this.propulsion.main.throttle = 1.0;
    this.propulsion.main.ignitionsUsed++;
    
    return { success: true, fuelUsed: fuelRequired };
  }
  
  calculateFuelRequired(deltaV, dryMass) {
    const exhaustVelocity = this.propulsion.main.specificImpulse * 9.81;
    const massRatio = Math.exp(deltaV * 1000 / exhaustVelocity);
    const fuelMass = dryMass * (massRatio - 1);
    return fuelMass;
  }
  
  /**
   * Get system status for UI display
   */
  getSystemStatus() {
    return {
      power: {
        generation: this.power.currentGeneration.toFixed(0),
        consumption: this.power.currentConsumption.toFixed(0),
        battery: this.power.batteryCharge.toFixed(1),
        batteryPercent: (this.power.batteryCharge / this.power.batteryCapacity * 100).toFixed(0)
      },
      thermal: {
        internal: (this.thermal.internalTemp - 273).toFixed(1),
        external: (this.thermal.externalTemp - 273).toFixed(1),
        status: this.getThermalStatus()
      },
      comms: {
        dataRate: this.formatDataRate(this.comms.dataRate),
        delay: this.formatDelay(this.comms.signalDelay),
        distance: this.comms.earthDistance.toFixed(3)
      },
      attitude: {
        mode: this.attitude.mode,
        wheelMomentum: (this.attitude.reactionWheels.momentum.length() / 
                       this.attitude.reactionWheels.maxMomentum * 100).toFixed(0),
        rcsFuel: this.attitude.rcs.fuel.toFixed(1)
      },
      propulsion: {
        mainFuel: this.propulsion.main.fuel.toFixed(1),
        oxidizer: this.propulsion.main.oxidizer.toFixed(1),
        ignitions: this.propulsion.main.ignitions - this.propulsion.main.ignitionsUsed,
        ionXenon: this.propulsion.ion.xenon.toFixed(1)
      },
      health: {
        overall: this.health.overall.toFixed(0),
        solarDegradation: this.health.degradation.solarPanels.toFixed(1),
        batteryDegradation: this.health.degradation.battery.toFixed(1)
      }
    };
  }
  
  getThermalStatus() {
    const temp = this.thermal.internalTemp;
    if (temp < this.thermal.limits.min) return 'COLD';
    if (temp > this.thermal.limits.max) return 'HOT';
    if (Math.abs(temp - this.thermal.limits.optimal) < 10) return 'NOMINAL';
    return 'MANAGING';
  }
  
  formatDataRate(bps) {
    if (bps > 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
    if (bps > 1e3) return (bps / 1e3).toFixed(1) + ' kbps';
    return bps.toFixed(0) + ' bps';
  }
  
  formatDelay(seconds) {
    if (seconds < 60) return seconds.toFixed(1) + ' s';
    if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
    return (seconds / 3600).toFixed(1) + ' hr';
  }
}