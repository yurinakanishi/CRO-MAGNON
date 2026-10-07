"""Remove a near-white bust plinth (background-coloured base TRELLIS adds under a head-only reference)
from the dense head, using the crisp source albedo per face, then keep the largest connected head part.

blender -b --python clean_plinth.py -- <dense.glb> <out.glb> [--below-frac .35] [--lum .72] [--sat .16]
Only deletes faces; surviving TRELLIS vertices, UVs and texture are untouched. Report: <out>.json
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
opt = {'--below-frac': .35, '--lum': .72, '--sat': .16}
for i in range(2, len(argv), 2):
    opt[argv[i]] = float(argv[i + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
img = next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE' and n.image.colorspace_settings.name == 'sRGB')
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)[:, :, :3]
bm = bmesh.new()
bm.from_mesh(obj.data)
uvl = bm.loops.layers.uv.active
zs = [v.co.z for v in bm.verts]
zmin, zmax = min(zs), max(zs)
zcut = zmin + (zmax - zmin) * opt['--below-frac']
doomed = []
for f in bm.faces:
    if f.calc_center_median().z > zcut:
        continue
    c = np.mean([px[min(h - 1, int(l[uvl].uv[1] * (h - 1))), min(w - 1, int(l[uvl].uv[0] * (w - 1)))] for l in f.loops], 0)
    if c.mean() > opt['--lum'] and c.max() - c.min() < opt['--sat']:
        doomed.append(f)
bmesh.ops.delete(bm, geom=doomed, context='FACES')
# keep the largest connected component (drops isolated plinth crumbs)
bm.faces.ensure_lookup_table()
seen, best = set(), []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, comp = [f], []
    seen.add(f.index)
    while stack:
        x = stack.pop()
        comp.append(x)
        for e in x.edges:
            for y in e.link_faces:
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
    if len(comp) > len(best):
        best = comp
keep = set(f.index for f in best)
small = [f for f in bm.faces if f.index not in keep and len(f.verts) and f.calc_center_median().z < zcut]
bmesh.ops.delete(bm, geom=small, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(obj.data)
bm.free()
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_image_format='AUTO')
rep = {'source': src, 'z_cut_local': zcut, 'white_faces_removed': len(doomed), 'small_components_removed_below_cut': len(small)}
Path(dst).with_suffix('.json').write_text(json.dumps(rep, indent=2))
print('CLEAN_DONE', json.dumps(rep))
