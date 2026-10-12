"""Close the deep eye sockets of a dense TRELLIS head whose eyes are painted from the reference.

blender -b --python fill_eye_sockets.py -- --dense D.glb --out OUT.glb --height 1.67 --registration SCALE,CX,CY
    --regions "U,V,RX,RY;U,V,RX,RY" [--depth 0.005]

TRELLIS-2 rebuilt the painted eyes of the 2026-10 candidate-3 reference as narrow funnels about 10 cm
deep into the head. Reduction keeps some funnel vertices, which turn into sliver triangles from the eye
across the cheek, and baking puts the funnel shading on top of the painted eyes
(scripts/remake/project_face.py). Per region (an ellipse in reference pixels, with the same
ground-centred placement as remake_process.py and the reference registration of project_face.py):
  1. a plane is fitted (robustly) to front-facing surface points in a ring around the eye, below and
     beside it (the brows and the fringe above are left out);
  2. faces inside the ellipse lying more than --depth behind that plane are deleted, with any pieces
     left disconnected from the body;
  3. the opening is closed by filling its boundary loop and triangulating it.
The rest of the surface, its UVs and texture are unchanged (new faces take the UV of the nearest rim
corner; their colour is replaced by the painted face). Writes OUT.glb and OUT.json.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--dense', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--height', type=float, required=True)
ap.add_argument('--registration', required=True)
ap.add_argument('--regions', required=True)
ap.add_argument('--depth', type=float, default=0.005)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.dense)
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh = obj.data

bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)  # weld UV-seam duplicates (UVs are per corner)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
co = np.array([v.co[:] for v in bm.verts])
# placement of remake_process.py (Blender Z-up): ground-centred, uniform scale to --height along Z
lo, hi = co.min(0), co.max(0)
scale = args.height / (hi[2] - lo[2])
origin = np.array([(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, lo[2]])
pb = (co - origin) * scale
xg, yg, zg = pb[:, 0], pb[:, 2], -pb[:, 1]  # glTF: x right, y up, z toward the front camera
a, cx, cy = map(float, args.registration.split(','))
u, v = cx + a * xg, cy - a * yg
bm.normal_update()
nz = np.array([-vert.normal[1] for vert in bm.verts])  # glTF z component of the vertex normal

report = {'regions': []}
doomed = set()
for spec in args.regions.split(';'):
    ru, rv, rx, ry = map(float, spec.split(','))
    rr = np.sqrt(((u - ru) / rx) ** 2 + ((v - rv) / ry) ** 2)
    ring = (rr > 1.1) & (rr < 1.6) & (v > rv - 0.3 * ry) & (nz > 0.5)
    # the face, not the hair behind it: within 2 cm of the front-most ring point
    ring &= zg > np.percentile(zg[ring], 95) - 0.02
    X = np.c_[np.ones(ring.sum()), xg[ring], yg[ring]]
    z = zg[ring]
    keep = np.ones(len(z), bool)
    for _ in range(5):
        coef, *_ = np.linalg.lstsq(X[keep], z[keep], rcond=None)
        res = z - X @ coef
        keep = np.abs(res) < max(0.003, 2.5 * np.std(res[keep]))
    plane = coef[0] + coef[1] * xg + coef[2] * yg
    behind = plane - zg
    inside = rr < 1.0
    # the socket only: start next to the eye opening (just behind the plane) and follow connected faces that stay
    # inside the ellipse and behind the plane. The back of the head lies behind the eye in this view too, but it
    # is not connected to the socket through such faces.
    def depth_of(f):
        return float(np.mean([behind[vv.index] for vv in f.verts]))

    def in_region(f):
        return all(inside[vv.index] for vv in f.verts)

    stack = [f for f in bm.faces if in_region(f) and args.depth < depth_of(f) < 0.03]
    picked = set(stack)
    while stack:
        f = stack.pop()
        for e in f.edges:
            for g2 in e.link_faces:
                if g2 not in picked and in_region(g2) and depth_of(g2) > args.depth:
                    picked.add(g2)
                    stack.append(g2)
    doomed.update(picked)
    report['regions'].append(dict(u=ru, v=rv, rx=rx, ry=ry, ringPoints=int(ring.sum()), planeResidualMetres=float(np.std(res[keep])),
                                  facesBehind=len(picked), deepestPickedMetres=max((depth_of(f) for f in picked), default=0.0),
                                  seedWindowMetres=[args.depth, 0.03]))
faces_before = len(bm.faces)
bmesh.ops.delete(bm, geom=list(doomed), context='FACES')
bmesh.ops.delete(bm, geom=[vv for vv in bm.verts if not vv.link_faces], context='VERTS')
# drop pieces left disconnected (the inner end of a funnel); keep the largest connected surface
bm.verts.ensure_lookup_table()
seen, parts = set(), []
for vv in bm.verts:
    if vv.index in seen:
        continue
    stack, part = [vv], []
    seen.add(vv.index)
    while stack:
        x = stack.pop()
        part.append(x)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen:
                seen.add(y.index)
                stack.append(y)
    parts.append(part)
parts.sort(key=len, reverse=True)
loose = [vv for part in parts[1:] if len(part) < 0.01 * len(bm.verts) for vv in part]
bmesh.ops.delete(bm, geom=loose, context='VERTS')
boundary = [e for e in bm.edges if e.is_boundary]
filled = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
new_faces = filled['faces']
tri = bmesh.ops.triangulate(bm, faces=new_faces, quad_method='BEAUTY', ngon_method='BEAUTY')
new_faces = tri['faces']
uv_layer = bm.loops.layers.uv.active
for f in new_faces:  # nearest rim corner's UV (the painted face replaces this colour)
    for loop in f.loops:
        for other in loop.vert.link_loops:
            if other.face not in new_faces:
                loop[uv_layer].uv = other[uv_layer].uv
                break
report.update(facesBefore=faces_before, facesDeleted=len(doomed), looseVertsDeleted=len(loose), boundaryEdgesFilled=len(boundary),
              newFaces=len(new_faces), facesAfter=len(bm.faces),
              remainingBoundaryEdges=sum(1 for e in bm.edges if e.is_boundary))
bm.to_mesh(mesh)
bm.free()
mesh.validate(clean_customdata=False)
if mesh.has_custom_normals:
    with bpy.context.temp_override(object=obj):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
for p in mesh.polygons:
    p.use_smooth = True
bpy.ops.export_scene.gltf(filepath=args.out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True,
                          export_animations=False, export_image_format='AUTO', export_normals=True)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report.update(author='Claude Code (Opus 5.5)', script='scripts/remake/fill_eye_sockets.py', source=args.dense, sourceSha256=sha(args.dense),
              output=args.out, outputSha256=sha(args.out), height=args.height, registration=[a, cx, cy], depth=args.depth, scale=float(scale))
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('FILL_DONE', json.dumps({k: report[k] for k in ('regions', 'facesDeleted', 'newFaces', 'remainingBoundaryEdges')}))
