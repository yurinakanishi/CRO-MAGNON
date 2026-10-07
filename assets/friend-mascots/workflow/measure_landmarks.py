"""Print limb measurements of a prepared surface to choose rig.json landmarks (fractions of H).

python measure_landmarks.py <surface revision dir>
Arms: centre height of thin vertical slices outward from the torso; the torso edge is
where a slice grows much taller than the arm. Legs: gap between the two legs per band.
"""
import json
import sys
from pathlib import Path

import numpy as np

d = Path(sys.argv[1])
r = json.loads((d / 'surface.json').read_text())
H = r['heightMetres']
P = np.load(d / 'surface.npz')['positions'] / H
x, y, z = P[:, 0], P[:, 1], P[:, 2]
print('extent x', x.min().round(3), x.max().round(3), 'y', y.min().round(3), y.max().round(3))
for side, sign in [('L', 1), ('R', -1)]:
    s = sign * x
    tip = s.max()
    print(f'arm {side}: tip x {sign * tip:.3f} at z {z[np.argmax(s)]:.3f}')
    rows = []
    for c in np.arange(0.06, tip, 0.02):
        q = (abs(s - c) < 0.008) & (z > 0.25) & (z < 0.8) & (y < np.median(y) + 0.06)
        if q.sum() < 3:
            continue
        zz = z[q]
        rows.append((round(c, 2), round(float(zz.min()), 3), round(float(zz.max()), 3), round(float(np.median(y[q])), 3)))
    print('  slice x, zmin, zmax, y:', rows)
for f in np.arange(0.02, 0.4, 0.02):
    q = abs(z - f) < 0.006
    if q.sum() < 2:
        continue
    xs = np.sort(x[q])
    gaps = np.diff(xs)
    i = np.argmax(gaps)
    print(f'band z {f:.2f}: x {xs[0]:.3f}..{xs[-1]:.3f}, largest gap {gaps[i]:.3f} between {xs[i]:.3f} and {xs[i + 1]:.3f}')
