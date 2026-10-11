"""Low-poly head revision, step 2 of 3 (Blender 3.6, headless): give the simplified head a new UV
layout and bake its albedo from the adopted head.

  blender -b -t 1 --factory-startup -P scripts/face-remake/bake-head.py -- <work dir> [--size 2048]
      [--face-scale 2] [--margin 4] [--angle 66] [--layout-only]

Run it with `-t 1`: with Blender's own threads the bake differs from run to run in a few small
hair islands (where layers of the adopted hair coincide); with one thread it is bit-identical.

Reads <work>/high.obj (the adopted head with its UVs), <work>/high-albedo.png (its 2048 albedo)
and <work>/low.obj (lowpoly-head.mjs). Writes <work>/low-albedo.png (the bake, `--size` square)
and <work>/low-uv.json (every low face corner's vertex and UV, plus the vertices as imported, to
map them back). Only the albedo is baked (Cycles DIFFUSE, colour only): no lighting enters it.

The face region is unwrapped as one conformal chart and everything else Smart UV projected
(`--angle`). Where a chart folds over itself or overlaps, those faces are cut out and
re-projected, and as a last resort laid out one chart per face, until no texel of the bake is
covered by two faces. Every island gets one texel density, the face islands `--face-scale` times
that, packed with `--margin` bake texels between islands. `--layout-only` stops before the bake.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
work = Path(argv[0])
size = int(argv[argv.index('--size') + 1]) if '--size' in argv else 2048
face_scale = float(argv[argv.index('--face-scale') + 1]) if '--face-scale' in argv else 2.0
# Gap between packed islands, in texels of the bake (`--margin`), and the Smart UV angle limit.
margin = float(argv[argv.index('--margin') + 1]) if '--margin' in argv else 4.0
angle = float(argv[argv.index('--angle') + 1]) if '--angle' in argv else 66.0
layout_only = '--layout-only' in argv

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(name):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=str(work / f'{name}.obj'), forward_axis='NEGATIVE_Z', up_axis='Y')
    (obj,) = set(bpy.data.objects) - before
    obj.name = name
    return obj


high = load('high')
low = load('low')
assert len(low.data.vertices) == sum(1 for line in open(work / 'low.obj') if line.startswith('v ')), 'low vertices changed on import'

# High: the adopted albedo through its own UVs.
material = bpy.data.materials.new('adopted')
material.use_nodes = True
nodes = material.node_tree.nodes
bsdf = nodes['Principled BSDF']
source = nodes.new('ShaderNodeTexImage')
source.image = bpy.data.images.load(str(work / 'high-albedo.png'))
source.interpolation = 'Linear'
material.node_tree.links.new(source.outputs['Color'], bsdf.inputs['Base Color'])
high.data.materials.clear()
high.data.materials.append(material)

# Low: the face region (face-faces.json, from lowpoly-head.mjs) is cut out along its border and
# unwrapped as one conformal chart; everything else (hair, ears, back of the head) is Smart UV
# projected.
face_faces = set(json.loads((work / 'face-faces.json').read_text()))
bpy.context.view_layer.objects.active = low
for obj in bpy.data.objects:
    obj.select_set(obj is low)
bpy.ops.object.mode_set(mode='EDIT')
# Face selection mode: selecting a face set never pulls in a neighbour through its vertices.
bpy.context.tool_settings.mesh_select_mode = (False, False, True)
bm = bmesh.from_edit_mesh(low.data)
bm.faces.ensure_lookup_table()
for e in bm.edges:
    sides = {f.index in face_faces for f in e.link_faces}
    e.seam = len(sides) == 2
for f in bm.faces:
    f.select = f.index not in face_faces
bmesh.update_edit_mesh(low.data)
bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bm = bmesh.from_edit_mesh(low.data)
bm.faces.ensure_lookup_table()
for f in bm.faces:
    f.select = f.index in face_faces
bmesh.update_edit_mesh(low.data)
bpy.ops.uv.unwrap(method='ANGLE_BASED', fill_holes=True, correct_aspect=True, margin=0.002)
def layout():
    """One texel density for every island, the face islands `--face-scale` times that, packed."""
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bm = bmesh.from_edit_mesh(low.data)
    uv = bm.loops.layers.uv.verify()
    face_loops = [l for f in bm.faces if f.index in face_faces for l in f.loops]
    if face_loops:
        cx = sum(l[uv].uv.x for l in face_loops) / len(face_loops)
        cy = sum(l[uv].uv.y for l in face_loops) / len(face_loops)
        for l in face_loops:
            l[uv].uv.x = cx + (l[uv].uv.x - cx) * face_scale
            l[uv].uv.y = cy + (l[uv].uv.y - cy) * face_scale
    bmesh.update_edit_mesh(low.data)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=margin / size, shape_method='CONCAVE')


def uv_triangles():
    bm = bmesh.from_edit_mesh(low.data)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.verify()
    tri = np.array([[(l[uv].uv.x * size, l[uv].uv.y * size) for l in f.loops] for f in bm.faces], dtype=np.float64)
    signed = ((tri[:, 1, 0] - tri[:, 0, 0]) * (tri[:, 2, 1] - tri[:, 0, 1]) - (tri[:, 2, 0] - tri[:, 0, 0]) * (tri[:, 1, 1] - tri[:, 0, 1])) / 2
    return bm, uv, tri, signed


def separated(a, b, eps=0.01):
    """Do two UV triangles (texels) have disjoint interiors? Separating axes: the six edge normals.
    Triangles that only touch (a shared edge or corner) count as separate, within `eps` of the
    edge length (UVs are float32: about 1e-4 texel of noise at 2048)."""
    for p in (a, b):
        for k in range(3):
            nx, ny = p[k][1] - p[(k + 1) % 3][1], p[(k + 1) % 3][0] - p[k][0]
            length = math.hypot(nx, ny)
            if length == 0:
                continue
            pa = [nx * x + ny * y for x, y in a]
            pb = [nx * x + ny * y for x, y in b]
            tolerance = max(eps, 0.01) * length
            if max(pa) <= min(pb) + tolerance or max(pb) <= min(pa) + tolerance:
                return True
    return False


def problems():
    """Faces the bake cannot give texels of their own: a UV triangle whose interior meets another
    one's (where a chart folds over itself or overlaps; exact triangle test), or one with a
    surface but no UV area. A mirrored part of a chart that overlaps nothing is left as it is:
    the albedo has no tangent space."""
    bm, uv, tri, signed = uv_triangles()
    faces = list(bm.faces)
    bad = {}
    for f in faces:
        if abs(signed[f.index]) < 1e-6 and f.calc_area() > 1e-8:
            bad[f.index] = 'no UV area'
    # Overlaps: candidate pairs from an 8-texel grid, then the exact triangle test.
    cells = {}
    lo, hi = np.floor(tri.min(axis=1) / 8).astype(int), np.floor(tri.max(axis=1) / 8).astype(int)
    for i in range(len(faces)):
        if abs(signed[i]) < 1e-6:
            continue
        for gx in range(lo[i][0], hi[i][0] + 1):
            for gy in range(lo[i][1], hi[i][1] + 1):
                cells.setdefault((gx, gy), []).append(i)
    checked = set()
    for members in cells.values():
        for m in range(len(members)):
            for n in range(m + 1, len(members)):
                i, j = members[m], members[n]
                if (i, j) in checked:
                    continue
                checked.add((i, j))
                if separated(tri[i].tolist(), tri[j].tolist()):
                    continue
                bad.setdefault(i, 'overlap')
                bad.setdefault(j, 'overlap')
    for i in shared_texels()[1]:
        bad.setdefault(i, 'shared texel')
    return bad


def shared_texels():
    """Texel centres strictly inside two UV triangles at the bake size, and the faces involved."""
    bm, uv, tri, signed = uv_triangles()
    owner = np.full((size, size), -1, dtype=np.int64)
    shared, faces = 0, set()
    for i in range(len(tri)):
        t = tri[i]
        area2 = signed[i] * 2
        if abs(area2) < 1e-9:
            continue
        x0, y0 = np.floor(t.min(axis=0)).astype(int)
        x1, y1 = np.ceil(t.max(axis=0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((t[1, 0] - xs) * (t[2, 1] - ys) - (t[2, 0] - xs) * (t[1, 1] - ys)) / area2
        w1 = ((t[2, 0] - xs) * (t[0, 1] - ys) - (t[0, 0] - xs) * (t[2, 1] - ys)) / area2
        inside = (w0 > 1e-9) & (w1 > 1e-9) & (1 - w0 - w1 > 1e-9)
        block = owner[y0:y1 + 1, x0:x1 + 1]
        clash = inside & (block >= 0)
        if clash.any():
            shared += int(clash.sum())
            faces.add(i)
            faces.update(int(c) for c in np.unique(block[clash]))
        block[inside] = i
    return shared, faces


def isolate(indices):
    """Last resort: each face gets its own chart, its triangle laid flat at its true shape."""
    bm = bmesh.from_edit_mesh(low.data)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.verify()
    for n, i in enumerate(sorted(indices)):
        f = bm.faces[i]
        loops = list(f.loops)
        k = max(range(3), key=lambda k: (loops[(k + 1) % 3].vert.co - loops[k].vert.co).length)
        origin = loops[k].vert.co
        axis_u = (loops[(k + 1) % 3].vert.co - origin).normalized()
        axis_v = f.normal.cross(axis_u).normalized()
        for l in loops:
            d = l.vert.co - origin
            l[uv].uv = (10.0 * (n + 1) + d.dot(axis_u), d.dot(axis_v))
    bmesh.update_edit_mesh(low.data)


# Overlapping faces are cut out and re-projected (Smart UV, each group of similar normals flat),
# twice; whatever still overlaps gets one chart per face, repeated while repacking at a new
# scale reveals more. The layout the bake uses has no texel shared by two faces.
repair = []
layout()
for attempt in range(8):
    bad = problems()
    repair.append(len(bad))
    if not bad:
        break
    if attempt == 7:
        bm = bmesh.from_edit_mesh(low.data)
        bm.faces.ensure_lookup_table()
        uv = bm.loops.layers.uv.verify()
        detail = [(i, bad[i], f'{bm.faces[i].calc_area():.3e} m2', [tuple(round(c * size, 2) for c in l[uv].uv) for l in bm.faces[i].loops]) for i in sorted(bad)]
        raise SystemExit(f'UV layout still has {len(bad)} overlapping faces: {detail}')
    if attempt < 2:
        bm = bmesh.from_edit_mesh(low.data)
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            f.select = f.index in bad
        bm.select_flush_mode()
        bmesh.update_edit_mesh(low.data)
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    else:
        isolate(bad)
    layout()
shared = shared_texels()[0]
if shared:
    raise SystemExit(f'{shared} texels are shared by two faces')
enlarged = len(face_faces)
bpy.ops.object.mode_set(mode='OBJECT')


def write_uv():
    mesh = low.data
    uv_layer = mesh.uv_layers.active.data
    out = {
        'schema': 'cro-magnon/lowpoly-head-uv@1',
        'size': size,
        'faceScale': face_scale,
        'marginTexels': margin,
        'smartAngleDegrees': angle,
        'faceFaces': enlarged,
        # Faces cut out per pass (the last pass found none).
        'uvRepair': repair,
        # Mesh coordinates are the OBJ's (the axis change is on the object).
        'vertices': [[v.co.x, v.co.y, v.co.z] for v in mesh.vertices],
        'faces': [[[mesh.loops[i].vertex_index, uv_layer[i].uv.x, uv_layer[i].uv.y] for i in p.loop_indices] for p in mesh.polygons],
    }
    (work / 'low-uv.json').write_text(json.dumps(out))
    print(json.dumps({k: out[k] for k in ('size', 'faceScale', 'marginTexels', 'smartAngleDegrees', 'faceFaces', 'uvRepair')}), 'faces', len(out['faces']))


if layout_only:
    write_uv()
    raise SystemExit(0)

target = bpy.data.images.new('low_albedo', width=size, height=size, alpha=False)
bake_material = bpy.data.materials.new('bake')
bake_material.use_nodes = True
node = bake_material.node_tree.nodes.new('ShaderNodeTexImage')
node.image = target
bake_material.node_tree.nodes.active = node
low.data.materials.clear()
low.data.materials.append(bake_material)

# The cage: the low head pushed out along its normals by a per-region distance (face, other
# skin, hair). A ray starts on the cage, so hair strands lying just above the skin of the
# adopted head are not hit by the face's rays, while hair, simplified further, still finds its
# surface.
regions = json.loads((work / 'low-regions.json').read_text())
assert len(regions) == len(low.data.vertices), 'regions do not match the low vertices'
extrusion = (0.006, 0.0025, 0.0015)
cage = low.copy()
cage.data = low.data.copy()
cage.name = 'cage'
bpy.context.collection.objects.link(cage)
for v, region in zip(cage.data.vertices, regions):
    v.co = v.co + v.normal * extrusion[region]

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 4
scene.cycles.seed = 0
scene.render.bake.use_selected_to_active = True
scene.render.bake.use_cage = True
scene.render.bake.cage_object = cage
scene.render.bake.max_ray_distance = 0.02
scene.render.bake.margin = 24
scene.render.bake.margin_type = 'EXTEND'
for obj in bpy.data.objects:
    obj.select_set(obj in (high, low))
cage.hide_render = True
bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)
target.filepath_raw = str(work / 'low-albedo.png')
target.file_format = 'PNG'
target.save()

write_uv()
