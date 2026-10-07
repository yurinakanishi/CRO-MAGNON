"""Measure a footbridge GLB's walkable deck: downward rays on a 2 cm grid over the footprint; the deck is the
connected central band whose top height is within 6 cm of the median plank height at the span centre (rails and
posts stand higher). Reports deckHeightMetres and walkBounds in glTF axes (X along the span, Z across, Y up).
blender -b --python measure_bridge.py -- <bridge.glb> <out.json>
"""
import json
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
dg = bpy.context.evaluated_depsgraph_get()
verts, polys = [], []
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    me = o.evaluated_get(dg).to_mesh()
    base = len(verts)
    verts += [tuple(o.matrix_world @ v.co) for v in me.vertices]
    polys += [[base + i for i in p.vertices] for p in me.polygons]
tree = BVHTree.FromPolygons(verts, polys)
V = np.array(verts)
lo, hi = V.min(0), V.max(0)
step = .02
xs = np.arange(lo[0], hi[0], step)
ys = np.arange(lo[1], hi[1], step)  # Blender Y == -glTF Z
H = np.full((len(xs), len(ys)), np.nan)
for i, x in enumerate(xs):
    for j, y in enumerate(ys):
        hit = tree.ray_cast(Vector((x, y, hi[2] + 1)), Vector((0, 0, -1)))
        if hit[0] is not None:
            H[i, j] = hit[0].z
centre = H[np.abs(xs) < .5][:, np.abs(ys) < .4]
deck = float(np.nanmedian(centre))
mask = np.abs(H - deck) < .06
# keep the connected component containing the centre
from collections import deque
seen = np.zeros_like(mask)
ci, cj = int(np.argmin(np.abs(xs))), int(np.argmin(np.abs(ys)))
q = deque([(ci, cj)])
seen[ci, cj] = True
while q:
    i, j = q.popleft()
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, b = i + di, j + dj
        if 0 <= a < len(xs) and 0 <= b < len(ys) and mask[a, b] and not seen[a, b]:
            seen[a, b] = True
            q.append((a, b))
# walk bounds: rows/columns where the deck covers most of the band (ignore ragged plank ends)
cover_x = seen.sum(1) / max(1, seen.sum(1).max())
cover_y = seen.sum(0) / max(1, seen.sum(0).max())
xi = np.where(cover_x > .5)[0]
yi = np.where(cover_y > .5)[0]
minX, maxX = float(xs[xi[0]]), float(xs[xi[-1]] + step)
minYb, maxYb = float(ys[yi[0]]), float(ys[yi[-1]] + step)
out = {'deckHeightMetres': deck, 'walkBounds': {'minX': minX, 'maxX': maxX, 'minZ': -maxYb, 'maxZ': -minYb},
       'footprint': {'minX': float(lo[0]), 'maxX': float(hi[0]), 'minZ': float(-hi[1]), 'maxZ': float(-lo[1]), 'height': float(hi[2] - lo[2])},
       'gridMetres': step, 'deckCells': int(seen.sum()),
       'method': 'downward rays on a 2 cm grid; deck = centre-connected cells within 6 cm of the median centre plank height; bounds where coverage > 50%'}
open(argv[1], 'w', newline='\n').write(json.dumps(out, indent=2))
print('BRIDGE', json.dumps(out))
