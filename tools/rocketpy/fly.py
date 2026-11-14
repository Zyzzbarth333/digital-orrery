"""Fly the ROCKET tab's cross-check vehicles in RocketPy (MIT), 3-DOF.

Reads src/physics/fixtures/rocket_xcheck.json (the vehicles as OpenRocket
flew them: stages, thrust curves, masses, drag against Mach; written by
src/physics/rocket.openrocket.mjs) and writes
src/physics/fixtures/rocketpy_xcheck.json: each vehicle's apogee, time to
apogee and top speed in RocketPy's point-mass ("3 DOF") mode, flown calm and
straight up from sea level on the equator in the standard atmosphere.

A second stage flies as a second flight that starts from the first
stage's state at its burnout, with the spent stage gone. RocketPy needs
its own environment, kept apart from the repo:

    python3 -m venv ~/.cache/digital-orrery/rocketpy-venv
    ~/.cache/digital-orrery/rocketpy-venv/bin/pip install -r tools/rocketpy/requirements.txt
    ~/.cache/digital-orrery/rocketpy-venv/bin/python tools/rocketpy/fly.py
"""

import json
import math
from importlib.metadata import version
from pathlib import Path

import numpy as np
from rocketpy import Environment, Flight, Function, PointMassMotor, PointMassRocket

HERE = Path(__file__).resolve().parents[2] / "src" / "physics" / "fixtures"
data = json.loads((HERE / "rocket_xcheck.json").read_text())

env = Environment(latitude=0, longitude=0, elevation=0)
env.set_atmospheric_model(type="standard_atmosphere")

out = {"source": f"RocketPy {version('rocketpy')} (MIT), point-mass 3-DOF flights of the vehicles in rocket_xcheck.json", "vehicles": {}}
for key, v in data["vehicles"].items():
    radius = math.sqrt(v["refArea"] / math.pi)
    # Drag against Mach, linear between points and held beyond the ends.
    table = lambda pts: Function(np.array(pts, dtype=float), inputs="Mach", outputs="Cd", interpolation="linear", extrapolation="constant")
    drag_on = table(v["drag"]["powerOn"] or v["drag"]["powerOff"])
    drag_off = table(v["drag"]["powerOff"] or v["drag"]["powerOn"])
    stages = v["stages"]
    start, t0 = None, 0.0           # the state a stage starts from, and its time in the whole flight
    for i, s in enumerate(stages):
        # Everything above this stage, and this stage's own dry mass, is the
        # rocket; the motor is this stage's propellant and its thrust.
        above = v["payload"] + sum(st["prop"] + st["dry"] for st in stages[i + 1:])
        motor = PointMassMotor(thrust_source=np.array(s["thrustCurve"], dtype=float), dry_mass=0, propellant_initial_mass=s["prop"],
                               burn_time=s["thrustCurve"][-1][0])
        rocket = PointMassRocket(radius=radius, mass=above + s["dry"], center_of_mass_without_motor=0,
                                 power_off_drag=drag_off, power_on_drag=drag_on)
        rocket.add_motor(motor, position=0)
        kw = dict(rail_length=1.0 if start is None else 0.01, inclination=90, heading=0, simulation_mode="3 DOF", terminate_on_apogee=True, rtol=1e-8)
        if start is not None:
            kw["initial_solution"] = start
        flight = Flight(rocket, env, **kw)
        if i < len(stages) - 1:
            # RocketPy's 3-DOF flight does not run when given a max_time, so
            # the stage flies on to its own apogee and its state at burnout
            # is interpolated; the next stage starts from it at its own time
            # zero (its thrust curve runs from its own ignition).
            sol = np.array(flight.solution, dtype=float)
            tb = s["thrustCurve"][-1][0]
            start = [0.0] + [float(np.interp(tb, sol[:, 0], sol[:, j])) for j in range(1, sol.shape[1])]
            t0 += tb
    out["vehicles"][key] = {"apogee": float(flight.apogee - env.elevation), "timeToApogee": float(t0 + flight.apogee_time), "maxSpeed": float(flight.max_speed)}
    print(key, out["vehicles"][key])

(HERE / "rocketpy_xcheck.json").write_text(json.dumps(out, indent=1))
