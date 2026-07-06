"""
Interactive Solar System reference viewer using SPICE
-----------------------------------------------------
This script renders planetary orbits using NASA's SPICE toolkit and provides:
  - A time slider to scrub through the simulation.
  - A Play/Pause button to automatically advance time.
  - Dynamic annotations (tooltips) that display a body's name and current
    position when the mouse hovers near its projected location.

It serves as a runnable, offline reference for the ephemerides that ground the
JavaScript simulator in this project.

Requirements:
- SpiceyPy
- NumPy
- Matplotlib
"""

import matplotlib
matplotlib.use('TkAgg')
import numpy as np
import spiceypy as spice
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from matplotlib.widgets import Slider, Button
from mpl_toolkits.mplot3d import proj3d
import datetime
from typing import List, Dict
from pathlib import Path
import logging

# Logger configuration.
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Physical constants.
G = 6.67430e-11
AU = 149597870700
SECONDS_PER_DAY = 86400
STANDARD_EPOCH = "2000-01-01T12:00:00"

# Body properties.
BODY_PROPERTIES = {
    'SUN': {'color': '#FFD700', 'size': 200, 'zorder': 10},
    'MERCURY': {'color': '#A0522D', 'size': 50, 'zorder': 11},
    'VENUS': {'color': '#DEB887', 'size': 95, 'zorder': 12},
    'EARTH': {'color': '#4169E1', 'size': 100, 'zorder': 13},
    'MARS': {'color': '#CD5C5C', 'size': 75, 'zorder': 14},
    'JUPITER': {'color': '#DAA520', 'size': 150, 'zorder': 15},
    'SATURN': {'color': '#B8860B', 'size': 140, 'zorder': 16},
    'URANUS': {'color': '#87CEEB', 'size': 120, 'zorder': 17},
    'NEPTUNE': {'color': '#1E90FF', 'size': 120, 'zorder': 18}
}

class CelestialBody:
    """Represents a celestial body using SPICE data."""
    def __init__(self, naif_id: int, name: str, system: 'SolarSystem'):
        self.naif_id = naif_id
        self.name = name.upper()
        self.system = system
        try:
            if naif_id != 10:
                radii_data = spice.bodvcd(naif_id, "RADII", 3)
                self.radii = np.mean(radii_data[1]) * 1000
            else:
                self.radii = 696340000
            if naif_id == 10:
                self.GM = G * 1.98847e30
            else:
                self.GM = spice.bodvcd(naif_id, "GM", 1)[1][0] * 1e9
            props = BODY_PROPERTIES.get(self.name,
                                        {'color': '#FFFFFF', 'size': 50, 'zorder': 10})
            self.color = props['color']
            self.vis_size = props['size']
            self.zorder = props['zorder']
        except spice.support_types.SpiceyError as e:
            logger.error(f"SPICE error for {self.name}: {str(e)}")
            raise

class SolarSystem:
    """Manages the solar system view with interactive time controls and dynamic annotations."""
    def __init__(self,
                 start_date: str = STANDARD_EPOCH,
                 duration_days: int = 365,
                 step_days: int = 1,
                 animation_skip: int = 1,
                 chunk_size: int = 5000):
        self.bodies: List[CelestialBody] = []
        self.start_et = spice.str2et(start_date)
        self.start_date = datetime.datetime.strptime(start_date, "%Y-%m-%dT%H:%M:%S")
        self.duration = duration_days * SECONDS_PER_DAY
        self.step = step_days * SECONDS_PER_DAY
        self.t = np.arange(0, self.duration, self.step)
        self.et_array = self.start_et + self.t
        self.num_frames = len(self.t)
        self.trail_length = 50
        self.animation_skip = animation_skip
        self.animation_interval = 50  # milliseconds
        self.chunk_size = chunk_size

        plt.style.use('dark_background')
        self.fig = plt.figure(figsize=(10, 8))
        self.ax_anim = self.fig.add_subplot(111, projection='3d')
        self.ax_anim.set_title("Interactive 3D Solar System Motion")
        self.ax_anim.set_xlabel("X [AU]")
        self.ax_anim.set_ylabel("Y [AU]")
        self.ax_anim.set_zlabel("Z [AU]")
        self.vis_elements: Dict[str, tuple] = {}

        # Create a dynamic annotation (tooltip) and set it invisible.
        self.annot = self.ax_anim.annotate(
            "", xy=(0, 0), xytext=(10, 10),
            textcoords="offset points",
            bbox=dict(boxstyle="round", fc="white", ec="black"),
            arrowprops=dict(arrowstyle="->", color="black")
        )
        # Set the text colour to black.
        self.annot.set_color("black")
        self.annot.set_visible(False)

        # Create a slider for time control.
        self.slider_ax = self.fig.add_axes([0.15, 0.03, 0.70, 0.03])
        self.time_slider = Slider(self.slider_ax, 'Time', 0, self.num_frames - 1,
                                  valinit=0, valfmt='%d')
        self.time_slider.on_changed(self.slider_update)

        # Create a Play/Pause button (with black text on white background).
        self.button_ax = self.fig.add_axes([0.87, 0.03, 0.10, 0.04])
        self.play_button = Button(self.button_ax, "Play")
        # Set button facecolour and text colour to black on white.
        self.play_button.ax.set_facecolor('white')
        self.play_button.label.set_color('black')
        self.playing = False
        self.play_button.on_clicked(self.toggle_play)

        # Create a timer for auto-advancing the slider.
        self.timer = self.fig.canvas.new_timer(interval=self.animation_interval)
        self.timer.add_callback(self.timer_update)

        # Connect mouse motion for dynamic annotations.
        self.fig.canvas.mpl_connect("motion_notify_event", self.on_mouse_move)

    def add_body(self, naif_id: int, name: str) -> None:
        body = CelestialBody(naif_id, name, self)
        self.bodies.append(body)
        logger.info(f"Added {name} to simulation")

    def simulate(self) -> Dict:
        results = {}
        num_chunks = (self.num_frames + self.chunk_size - 1) // self.chunk_size
        logger.info(f"Simulating {self.num_frames} frames in {num_chunks} chunks (chunk size = {self.chunk_size}).")
        for body in self.bodies:
            states_list = []
            for chunk in range(num_chunks):
                start_idx = chunk * self.chunk_size
                end_idx = min(start_idx + self.chunk_size, self.num_frames)
                chunk_et = self.et_array[start_idx:end_idx]
                logger.info(f"Processing chunk {chunk+1}/{num_chunks} for {body.name}")
                positions, lt = spice.spkpos(
                    targ=str(body.naif_id),
                    et=chunk_et,
                    ref="ECLIPJ2000",
                    abcorr="NONE",
                    obs="0"  # SSB
                )
                states_chunk = (np.array(positions).T * 1000) / AU
                states_list.append(states_chunk)
            states = np.concatenate(states_list, axis=1)
            results[body.name] = states
            # Plot static orbit path.
            self.ax_anim.plot(states[0], states[1], states[2],
                              color=body.color, alpha=0.3)
            # Initialise interactive elements.
            line, = self.ax_anim.plot([], [], [], '-', color=body.color,
                                        alpha=0.8, zorder=body.zorder)
            point, = self.ax_anim.plot([], [], [], 'o', color=body.color,
                                         markersize=body.vis_size / 10, zorder=body.zorder)
            text = self.ax_anim.text(0, 0, 0, body.name, color='white')
            self.vis_elements[body.name] = (line, point, text)
        # Add SSB marker.
        self.ax_anim.plot([0], [0], [0], marker='+', color='white',
                          markersize=10, label='SSB', zorder=1000)
        self.ax_anim.legend(loc='upper right')
        max_pos = max(np.max(np.abs(states)) for states in results.values())
        limit = max_pos * 1.2
        self.ax_anim.set_xlim3d(-limit, limit)
        self.ax_anim.set_ylim3d(-limit, limit)
        self.ax_anim.set_zlim3d(-limit, limit)
        self.results = results
        self.update_frame(0)  # Initialise display at time index 0.
        return results

    def update_frame(self, frame: int):
        for body in self.bodies:
            states = self.results[body.name]
            actual_frame = frame * self.animation_skip
            if actual_frame >= states.shape[1]:
                actual_frame = states.shape[1] - 1
            x_data = states[0, :actual_frame + 1]
            y_data = states[1, :actual_frame + 1]
            z_data = states[2, :actual_frame + 1]
            line, point, text = self.vis_elements[body.name]
            line.set_data(x_data, y_data)
            line.set_3d_properties(z_data)
            current_x = states[0, actual_frame]
            current_y = states[1, actual_frame]
            current_z = states[2, actual_frame]
            point.set_data([current_x], [current_y])
            point.set_3d_properties([current_z])
            text.set_position((current_x, current_y))
            text.set_3d_properties(current_z, zdir="z")
        self.fig.canvas.draw_idle()

    def slider_update(self, val):
        frame = int(self.time_slider.val)
        self.update_frame(frame)

    def toggle_play(self, event):
        if self.playing:
            self.playing = False
            self.play_button.label.set_text("Play")
            self.timer.stop()
        else:
            self.playing = True
            self.play_button.label.set_text("Pause")
            self.timer.start()

    def timer_update(self):
        current_val = self.time_slider.val
        if current_val < self.num_frames - 1:
            self.time_slider.set_val(current_val + 1)
        else:
            self.playing = False
            self.play_button.label.set_text("Play")
            self.timer.stop()

    def on_mouse_move(self, event):
        if event.inaxes == self.ax_anim:
            found = False
            for body in self.bodies:
                states = self.results[body.name]
                frame = int(self.time_slider.val) * self.animation_skip
                if frame >= states.shape[1]:
                    frame = states.shape[1] - 1
                current_x = states[0, frame]
                current_y = states[1, frame]
                current_z = states[2, frame]
                # Project the 3D point into 2D display coordinates.
                x2, y2, _ = proj3d.proj_transform(current_x, current_y, current_z, self.ax_anim.get_proj())
                x_disp, y_disp = self.ax_anim.transData.transform((x2, y2))
                d = np.hypot(event.x - x_disp, event.y - y_disp)
                if d < 30:  # threshold in pixels
                    # Move the annotation near the mouse location (x2,y2).
                    self.annot.xy = (x2, y2)
                    self.annot.set_text(
                        f"{body.name}\nPos: ({current_x:.2f}, {current_y:.2f}, {current_z:.2f})"
                    )
                    self.annot.set_visible(True)
                    found = True
                    break
            if not found:
                self.annot.set_visible(False)
            self.fig.canvas.draw_idle()
        else:
            if self.annot.get_visible():
                self.annot.set_visible(False)
                self.fig.canvas.draw_idle()

def main():
    try:
        kernel_path = Path("data/metakernel.tm")
        if not kernel_path.exists():
            raise FileNotFoundError(f"SPICE kernel not found at {kernel_path}")
        spice.furnsh(str(kernel_path))
        logger.info("SPICE kernels loaded successfully")
        solar_system = SolarSystem(
            start_date="2000-01-01T00:00:00",
            duration_days=730,
            step_days=1,
            chunk_size=5000
        )
        bodies = [
            (10, "Sun"),
            (199, "Mercury"),
            (299, "Venus"),
            (399, "Earth"),
            (499, "Mars"),
        ]
        for naif_id, name in bodies:
            solar_system.add_body(naif_id, name)
        solar_system.simulate()
        plt.show()
    except Exception as e:
        logger.error(f"Reference viewer failed: {str(e)}")
        raise
    finally:
        spice.kclear()

if __name__ == "__main__":
    main()
