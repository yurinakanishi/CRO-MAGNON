"""Measure a delivered landmark's silhouette and column heights for collision (glacier spires, volcanic cone).
Same algorithm and method text as the C1 tool kept in output/model-generation/models/<key>/workflow/current/
measure-world-landmark.py; only the input GLB and output path are explicit so the 2026-10 remake can re-measure its
own delivery. Only exports invisible collision data; does not construct any visible model.

blender -b --python measure_landmark_footprint.py -- --glb <delivered.glb> --out <footprint.json> [--source <label>]
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

p = argparse.ArgumentParser()
p.add_argument('--glb', required=True)
p.add_argument('--out', required=True)
p.add_argument('--source', default='')
args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
source = Path(args.glb)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
objects = [o for o in bpy.context.selected_objects if o.type == 'MESH']
bpy.context.view_layer.objects.active = objects[0]
if len(objects) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
obj.data.calc_loop_triangles()
positions = np.array([v.co[:] for v in obj.data.vertices])
faces = [t.vertices[:] for t in obj.data.loop_triangles]
tree = BVHTree.FromPolygons(positions.tolist(), faces, all_triangles=True)
upper = float(positions[:, 2].max() + 2)
lower = float(positions[:, 2].min() - 2)
step = 1.0


def height(x, z):
    hit = tree.ray_cast(Vector((x, -z, upper)), Vector((0, 0, -1)), upper - lower)[0]
    return hit.z if hit is not None else None


cells = []
xs = np.arange(math.floor(positions[:, 0].min()), math.ceil(positions[:, 0].max()), step)
zs = np.arange(math.floor(-positions[:, 1].max()), math.ceil(-positions[:, 1].min()), step)
occupied = 0
for z in zs:
    start = None
    end = None
    maximum = 0
    bucket = None
    for x in [*xs, float(xs[-1] + step)]:
        samples = [] if x > xs[-1] else [height(float(x + dx), float(z + dz)) for dx, dz in [(.15, .15), (.85, .15), (.5, .5), (.15, .85), (.85, .85)]]
        valid = [h for h in samples if h is not None and h > .1]
        next_bucket = math.ceil(max(valid) * 2) if valid else None
        if start is not None and next_bucket != bucket:
            cells.append({'minX': start, 'maxX': end, 'minZ': float(z), 'maxZ': float(z + step), 'height': round(maximum, 4)})
            start = None
            maximum = 0
        if valid:
            occupied += 1
            if start is None:
                start = float(x)
            end = float(x + step)
            maximum = max(maximum, max(valid))
            bucket = next_bucket
result = {'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'source': args.source or source.as_posix(),
          'min': [float(positions[:, 0].min()), float(positions[:, 2].min()), float(-positions[:, 1].max())],
          'max': [float(positions[:, 0].max()), float(positions[:, 2].max()), float(-positions[:, 1].min())],
          'method': 'Exact GLB top-down BVH silhouette, five probes per 1-m cell, exclude columns lower than 0.10 m; merge contiguous row cells only within the same 0.5-m height band. Conservative footprint boundary error is at most one cell diagonal. No rectangular bounding-box obstacle.',
          'cellSize': step, 'occupiedCells': occupied, 'boxes': cells}
Path(args.out).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print('FOOTPRINT', json.dumps({k: v for k, v in result.items() if k != 'boxes'}))
