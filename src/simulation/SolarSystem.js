// src/simulation/SolarSystem.js
import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { CelestialBody } from './CelestialBody.js';
import { TimeController } from './TimeController.js';
import { OrbitalMechanics } from './OrbitalMechanics.js';
import { SpacecraftFactory } from './spacecraft/SpacecraftFactory.js';
import { SpacecraftControlPanel } from '../ui/SpacecraftControlPanel.js';
import { ManoeuvreManager } from './spacecraft/ManoeuvreNode.js';
import { KernelClient } from './spacecraft/KernelClient.js';
import { 
  PLANETS,
  VISUAL_SETTINGS,
  AU_TO_KM,
  SECONDS_PER_MINUTE,
  DELTA_V,
  GRAVITATIONAL_PARAMETERS
} from '../utils/constants.js';

/* ===================================
   SOLAR SYSTEM CLASS
   Main simulation controller managing all celestial bodies,
   spacecraft, rendering, and user interaction
   =================================== */

export class SolarSystem {
  constructor(container) {
    // Core components
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    
    // Simulation objects
    this.bodies = new Map();
    this.spacecraft = [];
    // Spacecraft physics (src/physics/kernelHost.js), in a Web Worker when one
    // is available, on this thread otherwise.
    this.kernel = new KernelClient();
    this.timeController = new TimeController();

    this.spacecraftControlPanel = null;
    this.manoeuvreManager = null;
    
    // Selection state
    this.selectedBody = null;
    this.selectedSpacecraft = null;
    this.highlightedObject = null;

    this.trajectoryPlanner = null;
    
    // Interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Visual settings
    this.visualSettings = {
      showOrbits: true,
      showLabels: false,
      showStats: true,
      antialiasing: true,
      shadows: false,
      starfieldDensity: VISUAL_SETTINGS.starCount
    };
    
    // Performance monitoring
    this.stats = {
      fps: 0,
      frameTime: 0,
      lastTime: performance.now()
    };
    
    // Initialize everything
    this.init();
  }

  /* ===================================
     INITIALIZATION
     =================================== */
  
  init() {
    this.initRenderer();
    this.initScene();
    this.initCamera();
    this.initControls();
    this.initLighting();
    this.initPostProcessing();
    
    this.createBodies();
    this.createStarfield();
    this.createUI();
    
    this.setupEventListeners();
    this.setupKeyboardControls();

    this.spacecraftControlPanel = new SpacecraftControlPanel(this);
    this.manoeuvreManager = new ManoeuvreManager(this.scene);
    
    // Subscribe to time controller events
    this.timeController.addCallback('pause', () => this.onTimePause());
    this.timeController.addCallback('play', () => this.onTimePlay());
    
    // Start animation loop
    this.animate();
  }
  
  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: this.visualSettings.antialiasing,
      logarithmicDepthBuffer: true,
      powerPreference: "high-performance"
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = this.visualSettings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    
    this.container.appendChild(this.renderer.domElement);
  }
  
  initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.00001);
  }
  
  initCamera() {
    const fov = VISUAL_SETTINGS.defaultFOV || 60;
    const aspect = window.innerWidth / window.innerHeight;
    const near = 0.001;
    const far = 10000;
    
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera.position.set(5, 3, 5);
    
    // Add camera layers for selective rendering
    this.camera.layers.enableAll();
  }
  
  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 1000;
    this.controls.panSpeed = 0.5;
    this.controls.rotateSpeed = 0.5;
    
    // Enable keyboard controls
    this.controls.enableKeys = true;
    this.controls.keys = {
      LEFT: 37, // left arrow
      UP: 38,   // up arrow
      RIGHT: 39, // right arrow
      BOTTOM: 40 // down arrow
    };
  }
  
  initLighting() {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0x111111, 0.3);
    this.scene.add(ambientLight);
    
    // Main sun light
    this.sunLight = new THREE.PointLight(0xffffff, 2);
    this.sunLight.position.set(0, 0, 0);
    this.sunLight.castShadow = this.visualSettings.shadows;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.1;
    this.sunLight.shadow.camera.far = 50;
    this.scene.add(this.sunLight);
    
    // Add light decay for realism
    this.sunLight.decay = 2;
    this.sunLight.distance = 100;
  }
  
  initPostProcessing() {
    // Prepare for future post-processing effects
    // Bloom, FXAA, etc. would be initialized here
  }

  /* ===================================
     CELESTIAL BODIES
     =================================== */
  
  createBodies() {
    // Create Sun
    const sun = new CelestialBody(PLANETS.sun, Astronomy.Body.Sun);
    this.scene.add(sun.mesh);
    this.bodies.set('sun', sun);
    
    // Map planet names to Astronomy.js bodies
    const astronomyBodies = {
      mercury: Astronomy.Body.Mercury,
      venus: Astronomy.Body.Venus,
      earth: Astronomy.Body.Earth,
      mars: Astronomy.Body.Mars,
      jupiter: Astronomy.Body.Jupiter,
      saturn: Astronomy.Body.Saturn,
      uranus: Astronomy.Body.Uranus,
      neptune: Astronomy.Body.Neptune,
      pluto: Astronomy.Body.Pluto
    };
    
    // Create all planets
    Object.entries(astronomyBodies).forEach(([key, astronomyBody]) => {
      const body = new CelestialBody(PLANETS[key], astronomyBody);
      
      // Add group to scene instead of mesh
      this.scene.add(body.group);
      
      // Add orbit line
      if (body.orbitLine && this.visualSettings.showOrbits) {
        this.scene.add(body.orbitLine);
      }
      
      // Store in bodies map
      this.bodies.set(key, body);
    });
    
    // Initial position update
    this.updateBodyPositions();
  }
  
  createStarfield() {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    
    // Generate stars with varying brightness
    for (let i = 0; i < this.visualSettings.starfieldDensity; i++) {
      // Random position on sphere
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 800 + Math.random() * 200; // Vary distance
      
      vertices.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      
      // Vary star color slightly
      const intensity = 0.5 + Math.random() * 0.5;
      colors.push(intensity, intensity, intensity * 0.9); // Slightly blue
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      sizeAttenuation: false,
      blending: THREE.AdditiveBlending
    });
    
    this.starfield = new THREE.Points(geometry, material);
    this.scene.add(this.starfield);
  }

  /* ===================================
     USER INTERFACE
     =================================== */
  
  createUI() {
    // Main control panel
    this.createMainPanel();
    
    // Keyboard shortcuts help
    this.createHelpPanel();
    
    // Performance stats
    if (this.visualSettings.showStats) {
      this.createStatsPanel();
    }
    
    // Selected object details
    this.createDetailsPanel();
  }
  
  createMainPanel() {
    const panel = document.createElement('div');
    panel.className = 'info-panel fade-in';
    panel.innerHTML = `
      <h2>🌌 Solar System Simulation</h2>
      <div class="info-row">
        <span>Date:</span>
        <span id="current-date">-</span>
      </div>
      <div class="info-row">
        <span>Speed:</span>
        <span id="time-scale">-</span>
      </div>
      <div class="info-row">
        <span>Mission Time:</span>
        <span id="mission-time">-</span>
      </div>
      <div class="controls">
        <button id="reset-time" title="R">📅 Today</button>
        <button id="speed-down" title="-">⏪ Slower</button>
        <button id="play-pause" title="Space">⏸️ Pause</button>
        <button id="speed-up" title="+">⏩ Faster</button>
      </div>
      <div class="controls">
        <button id="toggle-orbits" title="O">🔄 Orbits</button>
        <button id="toggle-labels" title="L">🏷️ Labels</button>
        <button id="focus-sun" title="S">☀️ Sun</button>
        <button id="focus-earth" title="E">🌍 Earth</button>
        <button id="trajectory-planner" title="B">🧭 Trajectory Planner</button>
      </div>
    `;
    
    document.body.appendChild(panel);
    this.setupUIControls();
  }
  
  createHelpPanel() {
    const help = document.createElement('div');
    help.className = 'help-panel hidden';
    help.innerHTML = `
      <h3>Keyboard Controls</h3>
      <div class="help-row"><kbd>Space</kbd> Pause/Resume</div>
      <div class="help-row"><kbd>+/-</kbd> Speed up/down</div>
      <div class="help-row"><kbd>R</kbd> Reset to today</div>
      <div class="help-row"><kbd>O</kbd> Toggle orbits</div>
      <div class="help-row"><kbd>L</kbd> Toggle labels</div>
      <div class="help-row"><kbd>S</kbd> Focus Sun</div>
      <div class="help-row"><kbd>E</kbd> Focus Earth</div>
      <div class="help-row"><kbd>1-5</kbd> Launch spacecraft</div>
      <div class="help-row"><kbd>H</kbd> Toggle this help</div>
      <div class="help-row"><kbd>F</kbd> Fullscreen</div>
    `;
    
    document.body.appendChild(help);
    this.helpPanel = help;
  }
  
  createStatsPanel() {
    const stats = document.createElement('div');
    stats.className = 'stats-panel';
    stats.innerHTML = `
      <div>FPS: <span id="fps">0</span></div>
      <div>Objects: <span id="object-count">0</span></div>
      <div>Spacecraft: <span id="craft-count">0</span></div>
    `;
    
    document.body.appendChild(stats);
    this.statsPanel = stats;
  }
  
  createDetailsPanel() {
    const details = document.createElement('div');
    details.className = 'details-panel hidden';
    details.id = 'details-panel';
    document.body.appendChild(details);
    this.detailsPanel = details;
  }
  
  setupUIControls() {
    // Time controls
    document.getElementById('play-pause').addEventListener('click', () => {
      const isPaused = this.timeController.togglePause();
      document.getElementById('play-pause').innerHTML = 
        isPaused ? '▶️ Play' : '⏸️ Pause';
    });
    
    document.getElementById('speed-up').addEventListener('click', () => {
      this.timeController.increaseSpeed();
    });
    
    document.getElementById('speed-down').addEventListener('click', () => {
      this.timeController.decreaseSpeed();
    });
    
    document.getElementById('reset-time').addEventListener('click', () => {
      this.timeController.reset();
    });
    
    // Visual controls
    document.getElementById('toggle-orbits').addEventListener('click', () => {
      this.toggleOrbits();
    });
    
    document.getElementById('toggle-labels').addEventListener('click', () => {
      this.toggleLabels();
    });
    
    // Focus controls
    document.getElementById('focus-sun').addEventListener('click', () => {
      this.focusOnBody(this.bodies.get('sun'));
    });
    
    document.getElementById('focus-earth').addEventListener('click', () => {
      this.focusOnBody(this.bodies.get('earth'));
    });

    // Trajectory planner
    document.getElementById('trajectory-planner').addEventListener('click', async () => {
      if (!this.trajectoryPlanner) {
        const { TrajectoryPlanner } = await import('./trajectory/TrajectoryPlanner.js');
        this.trajectoryPlanner = new TrajectoryPlanner(this);
      }
      this.trajectoryPlanner.show();
    });
  }

  /* ===================================
     UPDATE METHODS
     =================================== */
  
  updateUI() {
    // Update time displays
    const timeInfo = this.timeController.getTimeInfo();
    document.getElementById('current-date').textContent = timeInfo.formattedDate;
    document.getElementById('time-scale').textContent = timeInfo.timeScaleDesc;
    document.getElementById('mission-time').textContent = timeInfo.missionTime;
    
    // Update stats
    if (this.visualSettings.showStats) {
      this.updateStats();
    }
    
    // Update spacecraft info
    this.updateSpacecraftInfo();
    
    // Update selected object details
    this.updateDetailsPanel();
  }
  
  updateStats() {
    // Calculate FPS
    const now = performance.now();
    const delta = now - this.stats.lastTime;
    this.stats.fps = Math.round(1000 / delta);
    this.stats.lastTime = now;
    
    // Update display
    document.getElementById('fps').textContent = this.stats.fps;
    document.getElementById('object-count').textContent = this.bodies.size;
    document.getElementById('craft-count').textContent = this.spacecraft.length;
  }
  
  updateSpacecraftInfo() {
    // Show first spacecraft info (or selected)
    const craft = this.selectedSpacecraft || this.spacecraft[0];
    if (!craft) return;
    
    let spacecraftDiv = document.getElementById('spacecraft-info');
    if (!spacecraftDiv) {
      spacecraftDiv = document.createElement('div');
      spacecraftDiv.id = 'spacecraft-info';
      spacecraftDiv.className = 'spacecraft-info fade-in';
      document.body.appendChild(spacecraftDiv);
    }
    
    const info = craft.getInfo();
    spacecraftDiv.innerHTML = `
      <strong>${info.name}</strong>
      <div>Mission: ${info.missionTime} days</div>
      <div>Speed: ${info.speed} km/s</div>
      <div>Distance: ${info.position} AU</div>
      <div>Fuel: ${info.fuelPercent}%</div>
      <div>Orbit: ${info.periapsis} × ${info.apoapsis} AU</div>
      <div>Engine: ${info.engineStatus}</div>
    `;
  }
  
  updateDetailsPanel() {
    if (!this.selectedBody && !this.selectedSpacecraft) {
      this.detailsPanel.classList.add('hidden');
      return;
    }
    
    this.detailsPanel.classList.remove('hidden');
    
    if (this.selectedBody) {
      const info = this.selectedBody.getInfo(this.timeController.currentDate);
      this.detailsPanel.innerHTML = `
        <h3>${info.name}</h3>
        <div class="detail-row">
          <span>Type:</span>
          <span>${info.type}</span>
        </div>
        <div class="detail-row">
          <span>Distance:</span>
          <span>${info.distance} AU</span>
        </div>
        <div class="detail-row">
          <span>Velocity:</span>
          <span>${info.velocity} km/s</span>
        </div>
        <div class="detail-row">
          <span>Radius:</span>
          <span>${(info.radius / 1000).toFixed(0)} × Earth</span>
        </div>
        ${info.orbitalPeriod ? `
        <div class="detail-row">
          <span>Year:</span>
          <span>${info.orbitalPeriod.toFixed(1)} days</span>
        </div>
        ` : ''}
        ${info.atmosphere ? `
        <div class="detail-row">
          <span>Atmosphere:</span>
          <span>Yes</span>
        </div>
        ` : ''}
      `;
    }
  }
  
  updateBodyPositions() {
    const currentDate = this.timeController.currentDate;
    
    this.bodies.forEach(body => {
      // Update position
      body.updatePosition(currentDate);
      
      // Update rotation
      if (body.updateRotation) {
        body.updateRotation(this.timeController.timeScale / 60);
      }
      
      // Update visual elements based on camera distance
      const distance = this.camera.position.distanceTo(body.group.position); // Changed from body.mesh.position
      
      if (body.updateOrbitVisibility) {
        body.updateOrbitVisibility(distance);
      }
      
      if (body.updateLabelVisibility && this.visualSettings.showLabels) {
        body.updateLabelVisibility(distance);
      }
    });
  }

  /* ===================================
     INTERACTION HANDLERS
     =================================== */
  
  setupEventListeners() {
    // Window resize
    window.addEventListener('resize', () => this.onResize());
    
    // Mouse events
    window.addEventListener('click', (e) => this.onMouseClick(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    
    // Touch events for mobile
    window.addEventListener('touchstart', (e) => this.onTouchStart(e));
  }
  
  setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
      // Prevent default for our keys
      if (['Space', 'KeyH', 'KeyO', 'KeyL', 'KeyR', 'KeyS', 'KeyE', 'KeyF', 'KeyN', 'KeyA', 'KeyT', 'KeyB'].includes(e.code)) {
        e.preventDefault();
      }
      
      switch(e.code) {
        case 'Space':
          document.getElementById('play-pause').click();
          break;
          
        case 'Equal':
        case 'NumpadAdd':
          this.timeController.increaseSpeed();
          break;
          
        case 'Minus':
        case 'NumpadSubtract':
          this.timeController.decreaseSpeed();
          break;
          
        case 'KeyR':
          this.timeController.reset();
          break;
          
        case 'KeyO':
          this.toggleOrbits();
          break;
          
        case 'KeyL':
          this.toggleLabels();
          break;
          
        case 'KeyS':
          this.focusOnBody(this.bodies.get('sun'));
          break;
          
        case 'KeyE':
          this.focusOnBody(this.bodies.get('earth'));
          break;
          
        case 'KeyH':
          this.helpPanel.classList.toggle('hidden');
          break;
          
        case 'KeyF':
          this.toggleFullscreen();
          break;
          
        case 'Escape':
          this.clearSelection();
          break;

        case 'KeyN':
        // Add manoeuvre node
        if (this.selectedSpacecraft && this.selectedSpacecraft.addManoeuvreNode) {
          const node = this.selectedSpacecraft.addManoeuvreNode(86400); // 1 day
          node.setDeltaV(0, 0.5, 0); // 0.5 km/s prograde
          
          // Add visual to scene
          if (node.nodeMarker) {
            this.scene.add(node.nodeMarker);
          }
          if (node.trajectoryPreview) {
            this.scene.add(node.trajectoryPreview);
          }
          
          this.showNotification('Manoeuvre node added: 0.5 km/s prograde');
        }
        break;

      case 'KeyA':
        // Cycle attitude mode
        if (this.selectedSpacecraft && this.selectedSpacecraft.systems) {
          const modes = ['INERTIAL', 'PROGRADE', 'RETROGRADE', 'RADIAL', 'SUN_POINTING'];
          const current = this.selectedSpacecraft.systems.attitude.mode;
          const index = modes.indexOf(current);
          const newMode = modes[(index + 1) % modes.length];
          this.selectedSpacecraft.systems.attitude.mode = newMode;
          this.showNotification(`Attitude mode: ${newMode}`);
        }
        break;

        case 'KeyT':
          // Toggle time display format
          e.preventDefault();
          this.cycleTimeFormat();
          break;

        case 'KeyB':
          // Build trajectory planner
          e.preventDefault();
          document.getElementById('trajectory-planner').click();
          break;
      }
    });
  }
  
  onMouseClick(event) {
    // Update mouse coordinates
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Raycast for object selection
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Check planets - need to check meshes within groups
    const planetMeshes = [];
    this.bodies.forEach(body => {
      // The mesh is now inside the group
      body.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.userData.body = body;
          planetMeshes.push(child);
        }
      });
    });
    
    // Check spacecraft
    const spacecraftMeshes = this.spacecraft.map(s => {
      s.mesh.userData.spacecraft = s;
      return s.mesh;
    });
    
    const allObjects = [...planetMeshes, ...spacecraftMeshes];
    const intersects = this.raycaster.intersectObjects(allObjects, true);
    
    if (intersects.length > 0) {
      const object = intersects[0].object;
      
      if (object.userData.body) {
        this.selectBody(object.userData.body);
      } else if (object.userData.spacecraft) {
        this.selectSpacecraft(object.userData.spacecraft);
      }
    } else {
      this.clearSelection();
    }
  }
  
  onMouseMove(event) {
    // Update mouse position for hover effects
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Could add hover highlighting here
  }
  
  onTouchStart(event) {
    // Convert touch to mouse event
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      const mouseEvent = new MouseEvent('click', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.onMouseClick(mouseEvent);
    }
  }
  
  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  /* ===================================
     SELECTION SYSTEM
     =================================== */
  
  selectBody(body) {
    // Clear previous selection
    this.clearSelection();
    
    // Set new selection
    this.selectedBody = body;
    this.selectedSpacecraft = null;
    
    // Highlight
    if (body.setHighlight) {
      body.setHighlight(true);
    }
    
    // Focus camera
    this.focusOnBody(body);
  }
  
  selectSpacecraft(spacecraft) {
    // Clear previous selection
    this.clearSelection();
    
    // Set new selection
    this.selectedSpacecraft = spacecraft;
    this.selectedBody = null;
    
    // Show control panel for enhanced spacecraft
    if (this.spacecraftControlPanel && spacecraft.systems) {
      this.spacecraftControlPanel.show(spacecraft);
    }
    
    // Focus camera
    this.focusOnSpacecraft(spacecraft);
  }
  
  clearSelection() {
    // Remove highlights
    if (this.selectedBody && this.selectedBody.setHighlight) {
      this.selectedBody.setHighlight(false);
    }

    // Hide spacecraft control panel (always, not only when a body was highlighted)
    if (this.spacecraftControlPanel) {
      this.spacecraftControlPanel.hide();
    }

    // Clear selection
    this.selectedBody = null;
    this.selectedSpacecraft = null;

    // Hide details panel
    this.detailsPanel.classList.add('hidden');
  }
  
  focusOnBody(body) {
    if (!body || !body.group) return;  // Changed from body.mesh to body.group
    
    const position = body.group.position;  // Changed from body.mesh.position
    
    // Smoothly move camera target
    this.controls.target.copy(position);
    
    // Calculate appropriate viewing distance based on body size
    const radius = body.calculateVisualRadius ? body.calculateVisualRadius() : 1;
    const distance = Math.max(radius * 5, 2);
    
    // Position camera at a nice angle
    const offset = new THREE.Vector3(distance, distance * 0.5, distance);
    const newPosition = position.clone().add(offset);
    
    // Animate camera movement
    this.animateCameraToPosition(newPosition);
  }
  
  focusOnSpacecraft(spacecraft) {
    if (!spacecraft || !spacecraft.mesh) return;
    
    const position = spacecraft.mesh.position;
    this.controls.target.copy(position);
    
    // Closer view for spacecraft
    const offset = new THREE.Vector3(0.5, 0.2, 0.5);
    const newPosition = position.clone().add(offset);
    
    this.animateCameraToPosition(newPosition);
  }
  
  animateCameraToPosition(targetPosition, duration = 1000) {
    const startPosition = this.camera.position.clone();
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function
      const eased = 1 - Math.pow(1 - progress, 3);
      
      // Interpolate position
      this.camera.position.lerpVectors(startPosition, targetPosition, eased);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }

  /* ===================================
     VISUAL TOGGLES
     =================================== */
  
  toggleOrbits() {
    this.visualSettings.showOrbits = !this.visualSettings.showOrbits;
    
    this.bodies.forEach(body => {
      if (body.orbitLine) {
        body.orbitLine.visible = this.visualSettings.showOrbits;
      }
    });
    
    // Update button state
    const btn = document.getElementById('toggle-orbits');
    btn.classList.toggle('active', this.visualSettings.showOrbits);
  }
  
  toggleLabels() {
    this.visualSettings.showLabels = !this.visualSettings.showLabels;
    
    this.bodies.forEach(body => {
      if (body.label) {
        body.label.visible = this.visualSettings.showLabels;
      }
    });
    
    // Update button state
    const btn = document.getElementById('toggle-labels');
    btn.classList.toggle('active', this.visualSettings.showLabels);
  }
  
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  /* ===================================
     SPACECRAFT MANAGEMENT
     =================================== */
  
  launchSpacecraft(name, fromBody, deltaV) {
    const launchBody = this.bodies.get(fromBody);
    if (!launchBody) {
      console.error(`Launch body not found: ${fromBody}`);
      return null;
    }
    
    // Get launch position
    const position = launchBody.group ? 
      launchBody.group.position.clone() : 
      launchBody.mesh.position.clone();
    
    // Calculate the planet's orbital velocity
    const planetVelocity = this.calculateOrbitalVelocity(launchBody);
    
    // The delta-v (radial, along-track, cross-track) is the hyperbolic excess
    // velocity v_inf the craft should leave the planet with. The kernel applies
    // the planet's gravity, so the craft starts on that escape hyperbola, on
    // the outbound asymptote at R = min(100 planet radii, sphere of influence),
    // with the speed energy conservation gives there: sqrt(v_inf^2 + 2 mu / R).
    // The planet then slows it to v_inf as it climbs out. Measured against the
    // patched-conic energy: 0.3 % for Earth, 0.1 % for Mars, 3 % for Jupiter,
    // where the Sun's pull during the long climb is real physics the patched
    // conic leaves out.
    const vInf = OrbitalMechanics.convertDeltaV(
      deltaV || new THREE.Vector3(0, 0, 0),
      position,
      planetVelocity
    );
    const muPlanet = (GRAVITATIONAL_PARAMETERS[fromBody] || 0) / 1e9;   // km^3/s^2
    const muSun = GRAVITATIONAL_PARAMETERS.sun / 1e9;
    const soiKm = Math.min(
      position.length() * AU_TO_KM * Math.pow(muPlanet / muSun, 0.4),
      100 * (PLANETS[fromBody]?.radius || 0)
    );
    const outward = vInf.lengthSq() > 0
      ? vInf.clone().normalize()
      : planetVelocity.clone().normalize();
    const speed = Math.sqrt(vInf.lengthSq() + (soiKm > 0 ? 2 * muPlanet / soiKm : 0));
    position.add(outward.clone().multiplyScalar(soiKm / AU_TO_KM));
    const velocity = planetVelocity.clone().add(outward.multiplyScalar(speed));
    
    // *** CREATE ENHANCED SPACECRAFT ***
    const systemConfig = {
      fuel: 300,
      oxidizer: 500,
      solarPanelArea: 30,
      batteryCapacity: 100,
      rcsFuel: 50,
      dishDiameter: 2
    };
    
    const spacecraft = SpacecraftFactory.createEnhanced(
      name,
      {
        position: position.toArray(),
        velocity: velocity.toArray()
      },
      systemConfig
    );
    
    // Add to scene and tracking
    spacecraft.kernelManaged = true;
    this.spacecraft.push(spacecraft);
    this.scene.add(spacecraft.mesh);
    this.scene.add(spacecraft.trajectoryLine);
    
    // Auto-select new spacecraft
    this.selectSpacecraft(spacecraft);
    
    // Show launch notification
    this.showNotification(`${name} launched with enhanced systems!`);
    
    return spacecraft;
  }
  
  calculateOrbitalVelocity(body) {
    if (!body.astronomyBody || body.data.name === 'Sun') {
      return new THREE.Vector3();
    }
    
    // Use pre-calculated velocity if available
    if (body.currentVelocity) {
      return body.currentVelocity.clone();
    }
    
    // Calculate from positions
    const currentDate = this.timeController.currentDate;
    const futureDate = new Date(currentDate.getTime() + SECONDS_PER_MINUTE * 1000);
    
    const currentPos = Astronomy.HelioVector(body.astronomyBody, currentDate);
    const futurePos = Astronomy.HelioVector(body.astronomyBody, futureDate);
    
    // Calculate velocity in AU/minute
    const velocity = new THREE.Vector3(
      futurePos.x - currentPos.x,
      futurePos.z - currentPos.z,  // Y and Z swapped for Three.js
      -(futurePos.y - currentPos.y)
    );
    
    // Convert to km/s
    velocity.multiplyScalar(AU_TO_KM / SECONDS_PER_MINUTE);
    
    return velocity;
  }
  
  removeSpacecraft(spacecraft) {
    const index = this.spacecraft.indexOf(spacecraft);
    if (index > -1) {
      // Remove from arrays
      this.spacecraft.splice(index, 1);
      
      // Remove from scene
      this.scene.remove(spacecraft.mesh);
      this.scene.remove(spacecraft.trajectoryLine);
      
      // Clear selection if this was selected
      if (this.selectedSpacecraft === spacecraft) {
        this.clearSelection();
      }
      
      // Dispose resources
      if (spacecraft.dispose) {
        spacecraft.dispose();
      }
    }
  }

  /* ===================================
     ANIMATION LOOP
     =================================== */
  
  animate() {
    requestAnimationFrame(() => this.animate());
    
    // Update time
    const deltaTime = this.timeController.update();
    
    // Update celestial bodies
    this.updateBodyPositions();
    
    // Update spacecraft
    if (!this.timeController.isPaused && deltaTime) {
      const now = this.timeController.currentDate;
      this.spacecraft.forEach(craft => {
        craft.update(deltaTime, this.bodies, now);
        if (craft.crashed && !craft.crashNotified) {
          craft.crashNotified = true;
          this.showNotification(`${craft.name} impacted ${craft.impactBody ?? 'a body'}`);
        }
        // Physics behind the clock: say so once per episode.
        const lagging = craft.physicsLagSeconds > 3600;
        if (lagging && !craft.lagNotified) {
          craft.lagNotified = true;
          this.showNotification(`${craft.name}: physics is behind the clock at this warp; slow down for full accuracy`);
        } else if (!lagging) {
          craft.lagNotified = false;
        }
        if (craft.kernelError && !craft.kernelErrorNotified) {
          craft.kernelErrorNotified = true;
          this.showNotification(`${craft.name}: physics stopped (${craft.kernelError})`);
        }
        if (craft.clockJumped) {
          craft.clockJumped = false;
          this.showNotification(`${craft.name} kept its state across the time jump`);
        }
      });
      // Send this frame's physics requests (skipped while the last batch is
      // still being computed; the next request then covers the longer span).
      this.kernel.tick(this.spacecraft.filter((c) => c.kernelManaged && !c.crashed && !c.kernelError));
    }
    
    // Update UI
    this.updateUI();
    
    // Update controls
    this.controls.update();
    
    // Render scene
    this.renderer.render(this.scene, this.camera);
  }

  /* ===================================
     UTILITY METHODS
     =================================== */
  
  showNotification(message, duration = 3000) {
    const notification = document.createElement('div');
    notification.className = 'notification fade-in';
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }
  
  takeScreenshot() {
    // Render one frame
    this.renderer.render(this.scene, this.camera);
    
    // Get data URL
    const dataURL = this.renderer.domElement.toDataURL('image/png');
    
    // Download
    const link = document.createElement('a');
    link.download = `solar-system-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
    
    this.showNotification('Screenshot saved!');
  }
  
  onTimePause() {
    // Handle pause event
    console.log('Simulation paused');
  }
  
  onTimePlay() {
    // Handle play event
    console.log('Simulation resumed');
  }
  
  dispose() {
    // Clean up all resources
    this.bodies.forEach(body => {
      if (body.dispose) body.dispose();
    });
    
    this.spacecraft.forEach(craft => {
      if (craft.dispose) craft.dispose();
    });
    
    // Remove event listeners
    window.removeEventListener('resize', this.onResize);
    
    // Dispose Three.js resources
    this.renderer.dispose();
    this.controls.dispose();
    
    // Clear DOM
    this.container.innerHTML = '';
  }
}