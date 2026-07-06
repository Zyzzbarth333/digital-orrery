import numpy as np
import spiceypy as spice

spice.tkvrsn('TOOLKIT')
spice.furnsh("data/metakernel.tm")

# =======================================================================================================
#                                           Simulation parameters
# =======================================================================================================

t_start = spice.str2et('1900 Jan 04 00:00:00.0000')  # start time of the simulation

t_end = spice.str2et('2100 Jan 04 00:00:00.0000')  # end time of simulation

dt = 3 * 24 * 3600  # timestep (seconds)

G = 6.67430e-11  # Newton's gravitational constant, m^3 kg^-1 s^-2

num_ts = int(np.ceil(t_end / dt))  # number of timesteps

# =======================================================================================================
