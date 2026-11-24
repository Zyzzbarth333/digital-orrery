"""The colour of Mars's dust, from the Viking map the scene draws.

The bright regions of Mars (Tharsis, Arabia, Elysium) are bright because
dust covers them, so their colour is the dust's. This takes the map
(public/textures/mars/day.webp), decodes sRGB to linear, leaves out the
polar caps (|lat| > 60 deg), and averages the brightest quarter of what is
left by luminance, each pixel weighted by its area (cos lat). It prints
the colour scaled to unit luminance, for DUST_COLOUR in
src/scene/marsDust.ts (docs/frontend/mars-dust.md).

    python3 python/textures/mars_dust_colour.py [path/to/day.webp]
"""
import sys

import numpy as np
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else 'public/textures/mars/day.webp'
img = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 255.0
h, w, _ = img.shape
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
lat = (0.5 - (np.arange(h) + 0.5) / h) * 180.0          # row 0 is the north
keep = np.abs(lat) <= 60.0
lin = lin[keep]
weight = np.repeat(np.cos(np.radians(lat[keep]))[:, None], w, axis=1)
lum = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
order = np.argsort(lum, axis=None)
cum = np.cumsum(weight.ravel()[order])
bright = order[cum >= 0.75 * cum[-1]]
rgb = (lin.reshape(-1, 3)[bright] * weight.ravel()[bright, None]).sum(0) / weight.ravel()[bright].sum()
mean = (lin.reshape(-1, 3) * weight.ravel()[:, None]).sum(0) / weight.ravel().sum()
y = lambda c: float(c @ np.array([0.2126, 0.7152, 0.0722]))
print(f'brightest quarter: linear {rgb.round(4).tolist()}, luminance {y(rgb):.4f}')
print(f'whole map (|lat| <= 60): linear {mean.round(4).tolist()}, luminance {y(mean):.4f}; bright / mean {y(rgb) / y(mean):.3f}')
print(f'unit luminance: {(rgb / y(rgb)).round(4).tolist()}')
