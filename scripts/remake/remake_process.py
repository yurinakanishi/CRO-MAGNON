"""2026-10 asset remake: dense TRELLIS GLB -> budgeted, baked game mesh (Blender 5.2, headless).

Lineage: TRELLIS-2 dense surface (unchanged positions apart from rigid placement/uniform scale)
 -> weld/triangulate, drop tiny floaters -> quadric collapse to a per-asset budget (source UVs kept)
 -> tangent-space normal map baked from the dense surface onto the reduced mesh (Cycles CPU)
 -> source albedo kept (resized only), roughness from the TRELLIS PBR volume (clamped), metallic 0
 -> GLB with MikkTSpace tangents and WebP textures; optional LOD chain from the same reduced mesh.
No primitive or procedural geometry is created.

blender -b --python remake_process.py -- --dense D.glb --out DIR --height 3.6 --budget 40000
    [--yaw DEG] [--pca] [--flip] [--measure z|x|y] [--pivot ground|centre|grip --grip-frac 0.22]
    [--albedo 2048] [--normal 2048] [--rough 1024] [--rough-min .5] [--rough-max 1]
    [--lods 0.25,0.07] [--floater-frac .004] [--keep-all] [--no-bake] [--extrusion-frac .006]
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

t0 = time.time()
ap = argparse.ArgumentParser()
ap.add_argument('--dense', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--height', type=float, required=True, help='target size along --measure (metres)')
ap.add_argument('--measure', default='z')
ap.add_argument('--budget', type=int, required=True)
ap.add_argument('--yaw', type=float, default=0.0)
ap.add_argument('--pca', action='store_true', help='align longest horizontal axis to Y (front/back)')
ap.add_argument('--flip', action='store_true', help='rotate 180 degrees after alignment')
ap.add_argument('--pivot', default='ground')
ap.add_argument('--grip-frac', type=float, default=.22)
ap.add_argument('--albedo', type=int, default=2048)
ap.add_argument('--normal', type=int, default=2048)
ap.add_argument('--rough', type=int, default=1024)
ap.add_argument('--rough-min', type=float, default=.5)
ap.add_argument('--rough-max', type=float, default=1.0)
ap.add_argument('--rough-const', type=float, default=None, help='constant roughness when the TRELLIS map has no variation')
ap.add_argument('--lods', default='')
ap.add_argument('--floater-frac', type=float, default=.004)
ap.add_argument('--keep-all', action='store_true')
ap.add_argument('--no-bake', action='store_true')
ap.add_argument('--extrusion-frac', type=float, default=.006)
ap.add_argument('--name', default='Model')
ap.add_argument('--keep-low-uv', action='store_true', help='with --low --rebake: bake onto the UVs already in the --low GLB (xatlas_unwrap.py)')
ap.add_argument('--matrix', default='', help='JSON file with a 4x4 row-major placement matrix (replaces yaw/scale/pivot)')
ap.add_argument('--cut-above', type=float, default=None, help='drop reduced-mesh faces whose vertices are all above this z')
ap.add_argument('--cut-below', type=float, default=None, help='drop reduced-mesh faces whose vertices are all below this z')
ap.add_argument('--low', default='', help='pre-reduced GLB (same source frame as --dense, e.g. meshopt_reduce.mjs) used instead of Blender decimation')
ap.add_argument('--drop-white-below', type=float, default=None, help='after baking, delete near-white (plinth/background) faces whose centre is below this z')
ap.add_argument('--neck-keep', default='', help='ztop,margin: below ztop keep only faces within the measured neck radius (+margin) of the neck axis')
ap.add_argument('--drop-dark-above', type=float, default=None, help='after baking, delete very dark (old hair/beard) faces whose centre is above this z')
ap.add_argument('--rebake', action='store_true', help='decimate without UV seams, Smart-UV unwrap, bake albedo+normal from the dense surface')
ap.add_argument('--crease-deg', type=float, default=48.0, help='edges sharper than this stay hard; 180 = fully smooth (thin foliage sheets)')
ap.add_argument('--normal-strength', type=float, default=1.0, help='blend the baked tangent normals toward flat (1 = as baked)')
ap.add_argument('--fill-holes', type=int, default=0, help='fill boundary loops with at most N edges (bounded pin-hole repair)')
ap.add_argument('--export-transform-only', default='', help='write the placement used to this JSON and exit')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def select_only(*objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def positions(mesh):
    p = np.empty((len(mesh.vertices), 3))
    mesh.vertices.foreach_get('co', p.ravel())
    return p


def tris(mesh):
    mesh.calc_loop_triangles()
    f = np.empty((len(mesh.loop_triangles), 3), dtype=np.int32)
    mesh.loop_triangles.foreach_get('vertices', f.ravel())
    return f


def surface_samples(p, f, n=8000, seed=7):
    rng = np.random.default_rng(seed)
    t = p[f]
    area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
    take = rng.choice(len(f), n, p=area / area.sum())
    uv = rng.random((n, 2))
    flip = uv.sum(1) > 1
    uv[flip] = 1 - uv[flip]
    tri = t[take]
    return tri[:, 0] + uv[:, :1] * (tri[:, 1] - tri[:, 0]) + uv[:, 1:] * (tri[:, 2] - tri[:, 0])


def distance_stats(points, p, f):
    bvh = BVHTree.FromPolygons(p.tolist(), f.tolist(), all_triangles=True)
    d = np.array([bvh.find_nearest(Vector(x))[3] for x in points])
    return {'rms_m': float(np.sqrt((d ** 2).mean())), 'p95_m': float(np.percentile(d, 95)), 'max_m': float(d.max())}


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.dense)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
select_only(*objs)
if len(objs) > 1:
    bpy.ops.object.join()
src = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
src.name = 'Dense'

# --- clean: weld, triangulate, remove tiny disconnected floaters
bm = bmesh.new()
bm.from_mesh(src.data)
verts_before = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bm.verts.ensure_lookup_table()
removed = {'components': 0, 'faces': 0}
if not args.keep_all:
    span_all = max((max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts)) for i in range(3))
    seen, comps = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
        comps.append(comp)
    total_faces = len(bm.faces)
    doomed = []
    for comp in comps:
        fs = {f for v in comp for f in v.link_faces}
        co = np.array([v.co[:] for v in comp])
        diag = float(np.linalg.norm(co.max(0) - co.min(0)))
        if len(fs) < total_faces * args.floater_frac and diag < span_all * .05:
            doomed.extend(comp)
            removed['components'] += 1
            removed['faces'] += len(fs)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context='VERTS')
bm.to_mesh(src.data)
bm.free()
src.data.validate(clean_customdata=False)

# --- rigid placement + uniform scale (Blender Z-up; glTF +Z forward == Blender -Y)
p = positions(src.data)
P_orig = p.copy()
yaw = args.yaw
grip = None
scale = 1.0
if args.matrix:
    Mx = np.array(json.loads(Path(args.matrix).read_text())['matrix'], dtype=float).reshape(4, 4)
    p = p @ Mx[:3, :3].T + Mx[:3, 3]
    scale = float(np.cbrt(abs(np.linalg.det(Mx[:3, :3]))))
else:
    if args.pca:
        xy = p[:, :2] - p[:, :2].mean(0)
        w, v = np.linalg.eigh(np.cov(xy.T))
        axis = v[:, -1]
        yaw += math.degrees(math.atan2(axis[0], axis[1]))  # rotate longest axis onto +Y
    if args.flip:
        yaw += 180
    R = Matrix.Rotation(math.radians(yaw), 3, 'Z')
    p = p @ np.asarray(R).T
    lo, hi = p.min(0), p.max(0)
    axis_index = 'xyz'.index(args.measure)
    scale = args.height / (hi[axis_index] - lo[axis_index])
    if args.pivot in ('ground', 'feet'):
        origin = np.array([(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, lo[2]])
    else:
        origin = (hi + lo) / 2
    p = (p - origin) * scale
    if args.pivot == 'feet':
        # Human pivot: ground level, midway between the two sole centres.
        sole = p[p[:, 2] < .045 * args.height]
        lft, rgt = sole[sole[:, 0] > 0], sole[sole[:, 0] < 0]
        mid = (np.r_[lft[:, :2].min(0) + lft[:, :2].max(0)] / 2 + np.r_[rgt[:, :2].min(0) + rgt[:, :2].max(0)] / 2) / 2
        p[:, :2] -= mid
    if args.pivot == 'grip':
        h = p[:, 2].max() - p[:, 2].min()
        gz = p[:, 2].min() + h * args.grip_frac
        band = p[np.abs(p[:, 2] - gz) < h * .035]
        grip = np.array([np.median(band[:, 0]), np.median(band[:, 1]), gz])
        p = p - grip
src.data.vertices.foreach_set('co', p.ravel())
src.data.update()
if args.export_transform_only:
    Path(args.export_transform_only).write_text(json.dumps({'note': 'positions after placement', 'min': p.min(0).tolist(), 'max': p.max(0).tolist()}))
dense_f = tris(src.data)
dense_samples = surface_samples(p, dense_f)

# --- capture TRELLIS textures
mat = src.data.materials[0]
nodes = mat.node_tree.nodes
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
def upstream_image(socket):
    stack = [l.from_node for l in socket.links]
    while stack:
        n = stack.pop()
        if n.type == 'TEX_IMAGE':
            return n.image
        for inp in n.inputs:
            stack.extend(l.from_node for l in inp.links)
    return None
albedo_src = upstream_image(bsdf.inputs['Base Color'])
rough_src = upstream_image(bsdf.inputs['Roughness'])

# --- reduced mesh
low = src.copy()
low.data = src.data.copy()
low.name = args.name
bpy.context.collection.objects.link(low)
ratio = min(1.0, args.budget / len(dense_f))
if args.low:
    # Same affine placement as the dense surface: p = P @ A.T + b.
    A = (np.array(json.loads(Path(args.matrix).read_text())['matrix'], dtype=float).reshape(4, 4)[:3, :3] if args.matrix
         else np.asarray(Matrix.Rotation(math.radians(yaw), 3, 'Z')) * scale)
    bvec = p[0] - A @ P_orig[0]
    bpy.data.objects.remove(low, do_unlink=True)
    before_import = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=args.low)
    low = [o for o in bpy.context.scene.objects if o not in before_import and o.type == 'MESH'][0]
    select_only(low)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    low.name = args.name
    # xatlas splits vertices along chart seams; re-weld exact duplicates so shading stays continuous across
    # seams (UVs are per corner in Blender, so the charts survive the weld).
    bmw = bmesh.new()
    bmw.from_mesh(low.data)
    bmesh.ops.remove_doubles(bmw, verts=list(bmw.verts), dist=1e-7)
    bmw.to_mesh(low.data)
    bmw.free()
    Lp = positions(low.data) @ A.T + bvec
    low.data.vertices.foreach_set('co', Lp.ravel())
    low.data.update()
    ratio = 1.0
if args.rebake and not args.keep_low_uv:
    while low.data.uv_layers:
        low.data.uv_layers.remove(low.data.uv_layers[0])
if ratio < 1:
    select_only(low)
    mod = low.modifiers.new('QEM', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
low.data.validate(clean_customdata=False)
hole_report = None
if args.fill_holes:
    bm = bmesh.new()
    bm.from_mesh(low.data)
    boundary = [e for e in bm.edges if e.is_boundary]
    # group boundary edges into loops
    loops, seen = [], set()
    for e in boundary:
        if e.index in seen:
            continue
        stack, loop = [e], []
        seen.add(e.index)
        while stack:
            x = stack.pop()
            loop.append(x)
            for v in x.verts:
                for y in v.link_edges:
                    if y.is_boundary and y.index not in seen:
                        seen.add(y.index)
                        stack.append(y)
        loops.append(loop)
    small = [l for l in loops if len(l) <= args.fill_holes]
    filled = bmesh.ops.holes_fill(bm, edges=[e for l in small for e in l], sides=args.fill_holes)['faces'] if small else []
    uvl = bm.loops.layers.uv.active
    if uvl:
        for f in filled:
            nb = [l[uvl].uv.copy() for v in f.verts for g in v.link_faces if g not in filled for l in g.loops if l.vert == v]
            if nb:
                avg = sum(nb, Vector((0, 0))) / len(nb)
                for l in f.loops:
                    l[uvl].uv = avg
    bmesh.ops.triangulate(bm, faces=list(filled))
    hole_report = {'max_edges': args.fill_holes, 'boundary_loops': len(loops), 'filled_loops': len(small), 'new_faces': len(filled)}
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
cut_report = None
if args.cut_above is not None or args.cut_below is not None:
    bm = bmesh.new()
    bm.from_mesh(low.data)
    # Face centre against the plane: removes straddling faces too, so no isolated shards remain at the cut.
    doomed = [f for f in bm.faces if (args.cut_above is not None and f.calc_center_median().z > args.cut_above)
              or (args.cut_below is not None and f.calc_center_median().z < args.cut_below)]
    cut_report = {'above': args.cut_above, 'below': args.cut_below, 'faces_removed': len(doomed)}
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
lp = positions(low.data)
lf = tris(low.data)
err = {'dense_to_low': distance_stats(dense_samples, lp, lf),
       'low_to_dense': distance_stats(surface_samples(lp, lf), p, dense_f)}
# crease-aware smooth shading (--crease-deg, default 48), consistent outward winding
bm = bmesh.new()
bm.from_mesh(low.data)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
for f in bm.faces:
    f.smooth = True
for e in bm.edges:
    e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < math.radians(args.crease_deg)
bm.to_mesh(low.data)
bm.free()
low.data.update()


if args.rebake and not args.keep_low_uv:
    low.data.uv_layers.new(name='UVMap')
    select_only(low)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def resized_copy(image, size, name, colorspace):
    """Exact block-average downsample to size x size (power-of-two factors) into a new packed image."""
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    while px.shape[0] > size and px.shape[0] % 2 == 0:
        px = px.reshape(px.shape[0] // 2, 2, px.shape[1] // 2, 2, 4).mean(axis=(1, 3))
    img = bpy.data.images.new(name, px.shape[1], px.shape[0], alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()
    return img


# --- textures: albedo (source), roughness (source PBR G, clamped, metallic 0), normal (baked)
if args.rebake:
    albedo = bpy.data.images.new(f'{args.name}_Albedo', args.albedo, args.albedo, alpha=False)
    albedo.colorspace_settings.name = 'sRGB'
else:
    albedo = resized_copy(albedo_src, args.albedo, f'{args.name}_Albedo', 'sRGB')
rough_img = None
rough_stats = None
if rough_src is not None and args.rough and not args.rebake:
    rough_img = resized_copy(rough_src, args.rough, f'{args.name}_ORM', 'Non-Color')
    px = np.empty(len(rough_img.pixels), dtype=np.float32)
    rough_img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    g = np.clip(px[:, 1], args.rough_min, args.rough_max)
    rough_stats = {'source_mean': float(px[:, 1].mean()), 'source_std': float(px[:, 1].std()), 'clamped_mean': float(g.mean()),
                   'min': args.rough_min, 'max': args.rough_max}
    if float(g.std()) < .03:
        # The TRELLIS PBR volume carries no usable variation; a uniform map would only cost memory.
        bpy.data.images.remove(rough_img)
        rough_img = None
        rough_stats['dropped'] = 'std < 0.03; constant roughness factor used'
    else:
        px[:, 0] = 1.0
        px[:, 1] = g
        px[:, 2] = 0.0
        rough_img.pixels.foreach_set(px.ravel())
        rough_img.update()
        rough_img.pack()
rough_const = args.rough_const if args.rough_const is not None else (
    float(np.clip(rough_stats['source_mean'], args.rough_min, args.rough_max)) if rough_stats else .85)

lmat = bpy.data.materials.new(f'{args.name}Surface')
lmat.use_nodes = True
lt = lmat.node_tree
lb = lt.nodes['Principled BSDF']
lb.inputs['Metallic'].default_value = 0.0
lb.inputs['Roughness'].default_value = rough_const
na = lt.nodes.new('ShaderNodeTexImage')
na.image = albedo
lt.links.new(na.outputs['Color'], lb.inputs['Base Color'])
if rough_img is not None:
    nr = lt.nodes.new('ShaderNodeTexImage')
    nr.image = rough_img
    sep = lt.nodes.new('ShaderNodeSeparateColor')
    lt.links.new(nr.outputs['Color'], sep.inputs['Color'])
    lt.links.new(sep.outputs['Green'], lb.inputs['Roughness'])
    lt.links.new(sep.outputs['Blue'], lb.inputs['Metallic'])
normal_img = None
bake_seconds = 0
bake_fill = {}
if not args.no_bake:
    normal_img = bpy.data.images.new(f'{args.name}_Normal', args.normal, args.normal, alpha=False, float_buffer=False)
    normal_img.colorspace_settings.name = 'Non-Color'
    normal_img.generated_color = (.5, .5, 1, 1)
    nn = lt.nodes.new('ShaderNodeTexImage')
    nn.image = normal_img
    nm = lt.nodes.new('ShaderNodeNormalMap')
    lt.links.new(nn.outputs['Color'], nm.inputs['Color'])
    lt.links.new(nm.outputs['Normal'], lb.inputs['Normal'])
low.data.materials.clear()
low.data.materials.append(lmat)
if normal_img is not None:
    for n in lt.nodes:
        n.select = False
    nn.select = True
    lt.nodes.active = nn
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    bake = scene.render.bake
    span = float(max(p.max(0) - p.min(0)))
    bake.use_selected_to_active = True
    bake.cage_extrusion = span * args.extrusion_frac
    bake.max_ray_distance = span * args.extrusion_frac * 3
    bake.normal_space = 'TANGENT'
    bake.margin = 6
    bake.margin_type = 'EXTEND'
    tb = time.time()
    bake_fill = {}

    def coverage_mask(size):
        """UV-island texels of the low mesh: bake its own white emission (no rays to the dense surface)."""
        img = bpy.data.images.new('CoverageMask', size, size, alpha=True)
        img.generated_color = (0, 0, 0, 0)
        tmp = bpy.data.materials.new('CoverageWhite')
        tmp.use_nodes = True
        tn = tmp.node_tree
        tn.nodes.remove(tn.nodes['Principled BSDF'])
        em_ = tn.nodes.new('ShaderNodeEmission')
        em_.inputs['Color'].default_value = (1, 1, 1, 1)
        tn.links.new(em_.outputs['Emission'], tn.nodes['Material Output'].inputs['Surface'])
        ti = tn.nodes.new('ShaderNodeTexImage')
        ti.image = img
        for n in tn.nodes:
            n.select = False
        ti.select = True
        tn.nodes.active = ti
        low.data.materials[0] = tmp
        bake.use_selected_to_active = False
        bake.use_clear = False
        bake.margin = 0
        select_only(low)
        bpy.ops.object.bake(type='EMIT')
        low.data.materials[0] = lmat
        bake.use_selected_to_active = True
        px_ = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(px_)
        bpy.data.images.remove(img)
        bpy.data.materials.remove(tmp)
        return px_.reshape(size, size, 4)[:, :, 3] > .5

    def bake_into(kind, target, node, flat=None):
        """Selected-to-active bake with exact miss detection (alpha 0 inside UV islands), a wider-ray second pass for
        the misses, in-island neighbour fill for any remainder and an 8-texel outward margin."""
        size = target.size[0]
        mask = coverage_mask(size)
        out_px = None
        hit = np.zeros(mask.shape, bool)
        for mult in (1, 4):
            img = bpy.data.images.new(f'Bake{kind}{mult}', size, size, alpha=True)
            img.colorspace_settings.name = target.colorspace_settings.name
            img.generated_color = (0, 0, 0, 0)
            node.image = img
            for n in lt.nodes:
                n.select = False
            node.select = True
            lt.nodes.active = node
            bake.cage_extrusion = span * args.extrusion_frac * mult
            bake.max_ray_distance = span * args.extrusion_frac * 3 * mult
            bake.use_clear = False
            bake.margin = 0
            select_only(src, low, active=low)
            bpy.ops.object.bake(type=kind)
            px_ = np.empty(size * size * 4, np.float32)
            img.pixels.foreach_get(px_)
            px_ = px_.reshape(size, size, 4)
            bpy.data.images.remove(img)
            got = px_[:, :, 3] > .5
            if out_px is None:
                out_px = px_.copy()
                first_misses = int((mask & ~got).sum())
            else:
                take = got & ~hit & mask
                out_px[take] = px_[take]
            hit |= got
            if not (mask & ~hit).any():
                break
        valid = hit & mask
        remaining = mask & ~valid
        filled_neighbour = int(remaining.sum())
        rgb = out_px[:, :, :3]
        # in-island neighbour fill, then 8-texel outward margin (mip/bilinear safety)
        for limit, region in ((256, mask), (8, None)):
            for _ in range(limit):
                todo = (region & ~valid) if region is not None else ~valid
                if not todo.any():
                    break
                acc = np.zeros_like(rgb)
                cnt = np.zeros(valid.shape, np.float32)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    sv = np.roll(valid, (dy, dx), (0, 1))
                    acc += np.roll(rgb, (dy, dx), (0, 1)) * sv[:, :, None]
                    cnt += sv
                grow = todo & (cnt > 0)
                if not grow.any():
                    break
                rgb[grow] = acc[grow] / cnt[grow][:, None]
                valid = valid | grow
        inverted = 0
        if flat is not None:
            rgb[~valid] = flat
            if kind == 'NORMAL':
                v = rgb * 2 - 1
                v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
                # A ray that hit the underside of an overlapping fur/foliage layer returns that layer's normal, which
                # points away from the low surface (tangent z < 0) and shades black: flip it, then keep z >= .25.
                back = v[:, :, 2] < 0
                inverted = int((back & mask).sum())
                v[back] *= -1
                low_z = v[:, :, 2] < .25
                v[low_z, 2] = .25
                v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
                if args.normal_strength != 1.0:
                    v[:, :, :2] *= args.normal_strength
                    v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
                rgb[:] = v * .5 + .5
        final = np.concatenate([rgb, np.ones(mask.shape + (1,), np.float32)], 2)
        target.pixels.foreach_set(final.ravel())
        target.update()
        target.pack()
        node.image = target
        bake_fill[kind] = {'island_texels': int(mask.sum()), 'first_pass_misses': first_misses,
                           'neighbour_filled_after_wide_pass': filled_neighbour, 'flipped_backfacing_normals': inverted}

    if args.rebake:
        # Emission bake of the dense base-colour texture: pure albedo, independent of the (metallic) TRELLIS BSDF.
        dt = src.data.materials[0].node_tree
        src_img_node = next(n for n in dt.nodes if n.type == 'TEX_IMAGE' and n.image == albedo_src)
        out_node = next(n for n in dt.nodes if n.type == 'OUTPUT_MATERIAL')
        emis = dt.nodes.new('ShaderNodeEmission')
        dt.links.new(src_img_node.outputs['Color'], emis.inputs['Color'])
        dt.links.new(emis.outputs['Emission'], out_node.inputs['Surface'])
        bake_into('EMIT', albedo, na, flat=(.5, .5, .5))
    bake_into('NORMAL', normal_img, nn, flat=(.5, .5, 1))
    bake_seconds = round(time.time() - tb, 1)
    # restore normal-map link after bake (bake leaves the graph unchanged)


neck_report = None
if args.neck_keep:
    ztop, margin = map(float, args.neck_keep.split(','))
    lp_ = positions(low.data)
    band = lp_[(lp_[:, 2] > ztop - .03) & (lp_[:, 2] < ztop)]
    cxy = np.median(band[:, :2], 0)
    radius = float(np.percentile(np.linalg.norm(band[:, :2] - cxy, axis=1), 90)) + margin
    bm = bmesh.new()
    bm.from_mesh(low.data)
    doomed = [f for f in bm.faces if f.calc_center_median().z < ztop and np.linalg.norm(np.array(f.calc_center_median()[:2]) - cxy) > radius]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
    neck_report = {'ztop': ztop, 'axis_xy': cxy.tolist(), 'radius': radius, 'faces_removed': len(doomed)}
dark_report = None
if args.drop_dark_above is not None:
    w_, h_ = albedo.size
    pxd = np.empty(w_ * h_ * 4, dtype=np.float32)
    albedo.pixels.foreach_get(pxd)
    pxd = pxd.reshape(h_, w_, 4)
    bm = bmesh.new()
    bm.from_mesh(low.data)
    uvl = bm.loops.layers.uv.active
    doomed = []
    for f in bm.faces:
        if f.calc_center_median().z <= args.drop_dark_above:
            continue
        c = np.mean([pxd[min(h_ - 1, int(l[uvl].uv[1] * (h_ - 1))), min(w_ - 1, int(l[uvl].uv[0] * (w_ - 1))), :3] for l in f.loops], 0)
        if float(c @ np.array([.2126, .7152, .0722])) < .2:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
    dark_report = {'above_z': args.drop_dark_above, 'faces_removed': len(doomed)}
white_report = None
if args.drop_white_below is not None:
    w_, h_ = albedo.size
    px = np.empty(w_ * h_ * 4, dtype=np.float32)
    albedo.pixels.foreach_get(px)
    px = px.reshape(h_, w_, 4)
    uvd = low.data.uv_layers.active.data
    bm = bmesh.new()
    bm.from_mesh(low.data)
    uvl = bm.loops.layers.uv.active
    doomed = []
    for f in bm.faces:
        if f.calc_center_median().z >= args.drop_white_below:
            continue
        cols = [px[min(h_ - 1, int(l[uvl].uv[1] * (h_ - 1))), min(w_ - 1, int(l[uvl].uv[0] * (w_ - 1))), :3] for l in f.loops]
        c = np.mean(cols, 0)
        if c.mean() > .78 and c.max() - c.min() < .14:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
    white_report = {'below_z': args.drop_white_below, 'faces_removed': len(doomed)}


def export(obj, path):
    select_only(obj)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_tangents=normal_img is not None,
                              export_image_format='WEBP', export_image_quality=92)
    return {'path': path.name, 'sha256': sha(path), 'bytes': path.stat().st_size, 'triangles': len(tris(obj.data))}


outputs = [export(low, out / 'candidate.glb')]
lod_reports = []
lod_mat = None
for k, frac in enumerate([float(x) for x in args.lods.split(',') if x]):
    # LODs descend from the same dense surface (seam-constrained collapse of the reduced mesh stalls),
    # share the identical albedo image (hash-deduplicated at runtime) and omit the normal map.
    # With a meshopt-reduced low (clean, welded), decimate that low and keep its baked UVs/albedo;
    # otherwise descend from the dense surface (whose seam-bound collapse can stall).
    lod_src = low if args.low else src
    lod = lod_src.copy()
    lod.data = lod_src.data.copy()
    bpy.context.collection.objects.link(lod)
    select_only(lod)
    mod = lod.modifiers.new('QEM', 'DECIMATE')
    mod.ratio = min(1.0, args.budget * frac / len(tris(lod_src.data)))
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if args.cut_above is not None or args.cut_below is not None:
        bm = bmesh.new()
        bm.from_mesh(lod.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (args.cut_above is not None and min(v.co.z for v in f.verts) > args.cut_above)
                                   or (args.cut_below is not None and max(v.co.z for v in f.verts) < args.cut_below)], context='FACES')
        bm.to_mesh(lod.data)
        bm.free()
    bm = bmesh.new()
    bm.from_mesh(lod.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < math.radians(args.crease_deg)
    bm.to_mesh(lod.data)
    bm.free()
    if lod_mat is None:
        lod_mat = bpy.data.materials.new(f'{args.name}SurfaceLOD')
        lod_mat.use_nodes = True
        lb2 = lod_mat.node_tree.nodes['Principled BSDF']
        lb2.inputs['Metallic'].default_value = 0.0
        lb2.inputs['Roughness'].default_value = rough_const if rough_img is None else float(rough_stats['clamped_mean'])
        ta = lod_mat.node_tree.nodes.new('ShaderNodeTexImage')
        ta.image = albedo
        lod_mat.node_tree.links.new(ta.outputs['Color'], lb2.inputs['Base Color'])
    lod.data.materials.clear()
    lod.data.materials.append(lod_mat)
    q = positions(lod.data)
    g = tris(lod.data)
    lod_reports.append({'lod': k + 1, 'fraction_of_budget': frac, 'triangles': int(len(g)), 'dense_to_lod': distance_stats(dense_samples, q, g)})
    select_only(lod)
    path = out / f'lod{k + 1}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_animations=False, export_tangents=False, export_image_format='WEBP', export_image_quality=92)
    outputs.append({'path': path.name, 'sha256': sha(path), 'bytes': path.stat().st_size, 'triangles': int(len(g))})
report = {
    'author': 'Claude Code (Opus 5.5)', 'claude_used': True, 'script': 'scripts/remake/remake_process.py',
    'dense': {'path': args.dense, 'sha256': sha(args.dense), 'triangles': int(len(dense_f)), 'vertices_before_weld': verts_before},
    'removed_floaters': removed, 'alignment': {'yaw_degrees': yaw, 'pca': args.pca, 'uniform_scale': float(scale),
    'pivot': args.pivot, 'grip_metres': grip.tolist() if grip is not None else None,
    'bounds_blender_z_up': {'min': p.min(0).tolist(), 'max': p.max(0).tolist()}},
    'reduction': {'budget': args.budget, 'ratio': ratio, 'triangles': int(len(lf)), 'error': err, 'cut': cut_report, 'holes': hole_report, 'white': white_report, 'neck': neck_report, 'dark': dark_report},
    'textures': {'albedo': list(albedo.size), 'albedo_source': list(albedo_src.size), 'roughness': list(rough_img.size) if rough_img else None,
                 'roughness_stats': rough_stats, 'roughness_constant': rough_const if rough_img is None else None, 'normal': [args.normal] * 2 if normal_img else None, 'normal_bake_seconds': bake_seconds, 'bake_fill': bake_fill,
                 'format': 'WebP q92 (EXT_texture_webp), MikkTSpace tangents', 'rebake': args.rebake,
                 'uv_source': ('low GLB UVs (xatlas_unwrap.py)' if args.keep_low_uv else 'smart_project') if args.rebake else 'dense UVs'},
    'shading': f'welded positions, smooth with {args.crease_deg:g}-degree crease edges', 'normal_strength': args.normal_strength, 'lods': lod_reports, 'outputs': outputs,
    'seconds': round(time.time() - t0, 1),
}
(out / 'process-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'process.blend'), compress=True)
print('REMAKE_PROCESS_DONE', json.dumps({k: report[k] for k in ('reduction', 'seconds')}))
