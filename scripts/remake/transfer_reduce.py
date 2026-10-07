"""Reduce an already delivered, rigged and animated GLB while keeping its armature, bone names, clips and the
user-approved surface: the delivered mesh (rest pose) is the bake source and the skin-weight source.

Stage 1 (export the rest surface in world space, for meshopt_reduce.mjs + xatlas_unwrap.py):
  blender -b --python transfer_reduce.py -- export-rest <delivered.glb> <rest.glb>
Stage 2 (bake + weight transfer + export with the original animations):
  blender -b --python transfer_reduce.py -- build <delivered.glb> <low-xatlas.glb> <outdir> [--albedo 1024] [--normal 1024]
      [--extrusion-frac .006] [--rough-const .85] [--name Name]
Bake: emission of the delivered base colour (per source material) and tangent normals, selected-to-active, with the
same miss fill / back-face flip as remake_process.py. Weights: Data Transfer (nearest face interpolated), normalised,
4 influences. Output <outdir>/candidate.glb + report.json. No vertex is authored; geometry = reduced delivered surface.
"""
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
mode = argv[0]


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in bpy.context.scene.objects if o not in before]


def select_only(*objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[-1]


bpy.ops.wm.read_factory_settings(use_empty=True)

if mode == 'export-rest':
    src, dst = argv[1], argv[2]
    objs = import_glb(src)
    arm = next(o for o in objs if o.type == 'ARMATURE')
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    meshes = [o for o in objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    dg = bpy.context.evaluated_depsgraph_get()
    P, F, MI, NAMES, base = [], [], [], [], 0
    for o in meshes:
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        me.calc_loop_triangles()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) @ np.asarray(o.matrix_world.to_3x3()).T + np.asarray(o.matrix_world.translation)
        tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
        me.loop_triangles.foreach_get('vertices', tri)
        mi = np.empty(len(me.loop_triangles), dtype=np.int64)
        me.loop_triangles.foreach_get('material_index', mi)
        names = [m.name if m else 'Surface' for m in o.data.materials] or ['Surface']
        MI.append(np.array([len(NAMES) + i for i in mi]))
        NAMES += names
        P.append(co)
        F.append(tri.reshape(-1, 3) + base)
        base += len(co)
        e.to_mesh_clear()
    P, F, MI = np.vstack(P), np.vstack(F), np.concatenate(MI)
    if '--split' in argv:
        # One rest surface per source material (head, body, TribeAccent ...), each reduced and unwrapped on its own.
        parts = []
        for k, name in enumerate(NAMES):
            sel = F[MI == k]
            if not len(sel):
                continue
            used = np.unique(sel)
            remap = np.full(len(P), -1)
            remap[used] = np.arange(len(used))
            me = bpy.data.meshes.new('Rest%d' % k)
            me.from_pydata(P[used].tolist(), [], remap[sel].tolist())
            ob = bpy.data.objects.new('Rest%d' % k, me)
            bpy.context.collection.objects.link(ob)
            select_only(ob)
            path = dst.replace('.glb', '-m%d.glb' % k)
            bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                                      export_animations=False, export_materials='NONE', export_normals=False, export_texcoords=False)
            parts.append({'index': k, 'name': name, 'triangles': int(len(sel)), 'rest': path})
        Path(dst.replace('.glb', '-parts.json')).write_text(json.dumps({'parts': parts}, indent=2), newline=chr(10))
        print('REST_DONE', json.dumps({'parts': parts}))
        sys.exit(0)
    me = bpy.data.meshes.new('Rest')
    me.from_pydata(P.tolist(), [], F.tolist())
    ob = bpy.data.objects.new('Rest', me)
    bpy.context.collection.objects.link(ob)
    for o in objs:
        o.select_set(False)
    select_only(ob)
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_animations=False, export_materials='NONE', export_normals=False, export_texcoords=False)
    print('REST_DONE', json.dumps({'vertices': len(P), 'triangles': len(F)}))
    sys.exit(0)

assert mode == 'build'
src, lowpath, outdir = argv[1], argv[2], Path(argv[3])
opt = {'--albedo': '1024', '--normal': '1024', '--extrusion-frac': '.006', '--rough-const': '', '--name': 'Character'}
i = 4
while i < len(argv):
    opt[argv[i]] = argv[i + 1]
    i += 2
outdir.mkdir(parents=True, exist_ok=True)
t0 = time.time()
scene = bpy.context.scene


def key_rate(path):
    """Densest keyframe rate in the source clips (Hz, <= 240), so import/export keep every authored key."""
    import struct
    data = Path(path).read_bytes()
    jlen = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    base = 20 + jlen + 8
    best = 60.0
    for an in doc.get('animations', []):
        for smp in an['samplers']:
            a = doc['accessors'][smp['input']]
            v = doc['bufferViews'][a['bufferView']]
            t = np.frombuffer(data, np.float32, a['count'], base + v.get('byteOffset', 0) + a.get('byteOffset', 0))
            d = np.diff(t)
            d = d[d > 1e-5]
            if len(d):
                best = max(best, 1 / float(np.median(d)))
    return int(min(240, round(best)))


scene.render.fps = key_rate(src)
objs = import_glb(src)
arm = next(o for o in objs if o.type == 'ARMATURE')
sources = [o for o in objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
others = [o for o in objs if o.type == 'MESH' and o not in sources]
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()
# Low parts: one reduced GLB (single material) or a JSON {"parts": [{"name", "low", "albedo", "normal", "rough"?}]}
# so a head or a gameplay slot (TribeAccent) keeps its own material name and texture atlas.
if lowpath.endswith('.json'):
    part_specs = json.loads(Path(lowpath).read_text())['parts']
else:
    part_specs = [{'name': opt['--name'] + 'Surface', 'low': lowpath, 'albedo': int(opt['--albedo']), 'normal': int(opt['--normal'])}]


def prepare_part(path, name):
    obj = [o for o in import_glb(path) if o.type == 'MESH'][0]
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = name
    # xatlas splits vertices along chart seams; re-weld exact duplicates (UVs are per corner) for continuous shading.
    bmw = bmesh.new()
    bmw.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bmw, verts=list(bmw.verts), dist=1e-7)
    # Shading before the bake: the tangent-space normal map must be baked against the same smooth (48-degree
    # crease) normals that are exported, or the low-poly facets come back.
    for f in bmw.faces:
        f.smooth = True
    for e in bmw.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < math.radians(48)
    bmw.to_mesh(obj.data)
    bmw.free()
    return obj


parts = [prepare_part(p['low'], 'Part' + str(i)) for i, p in enumerate(part_specs)]

# Bake sources: evaluated rest copies (modifier-free) so ray casts see the bind-pose surface.
dg = bpy.context.evaluated_depsgraph_get()
bake_src = []
for o in sources:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    c = bpy.data.objects.new(o.name + 'Rest', me)
    c.matrix_world = o.matrix_world.copy()
    bpy.context.collection.objects.link(c)
    bake_src.append(c)

# Roughness: mean of source roughness factors unless given.
rf = []
for o in sources:
    for m in o.data.materials:
        b = m.node_tree.nodes.get('Principled BSDF') if m and m.use_nodes else None
        if b:
            rf.append(b.inputs['Roughness'].default_value)
rough_default = float(opt['--rough-const']) if opt['--rough-const'] else (float(np.mean(rf)) if rf else .85)

# Emission on every source material: base-colour texture (or factor) straight to the output.
for o in bake_src:
    for m in o.data.materials:
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        em = nt.nodes.new('ShaderNodeEmission')
        if bsdf and bsdf.inputs['Base Color'].links:
            nt.links.new(bsdf.inputs['Base Color'].links[0].from_socket, em.inputs['Color'])
        elif bsdf:
            em.inputs['Color'].default_value = bsdf.inputs['Base Color'].default_value
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])

# Part materials (one per part, own albedo/normal images), then join the parts into one mesh and weld the shared
# borders (kept identical by meshopt LockBorder) so shading is continuous across e.g. the neck, then set shading.
mats = []
for spec, part in zip(part_specs, parts):
    lmat = bpy.data.materials.new(spec['name'])
    lmat.use_nodes = True
    lt = lmat.node_tree
    lb = lt.nodes['Principled BSDF']
    lb.inputs['Metallic'].default_value = 0.0
    lb.inputs['Roughness'].default_value = float(spec.get('rough', rough_default))
    albedo = bpy.data.images.new(spec['name'] + '_Albedo', spec['albedo'], spec['albedo'], alpha=False)
    albedo.colorspace_settings.name = 'sRGB'
    normal_img = bpy.data.images.new(spec['name'] + '_Normal', spec['normal'], spec['normal'], alpha=False)
    normal_img.colorspace_settings.name = 'Non-Color'
    na = lt.nodes.new('ShaderNodeTexImage')
    na.image = albedo
    lt.links.new(na.outputs['Color'], lb.inputs['Base Color'])
    nn = lt.nodes.new('ShaderNodeTexImage')
    nn.image = normal_img
    nm = lt.nodes.new('ShaderNodeNormalMap')
    lt.links.new(nn.outputs['Color'], nm.inputs['Color'])
    lt.links.new(nm.outputs['Normal'], lb.inputs['Normal'])
    part.data.materials.clear()
    part.data.materials.append(lmat)
    mats.append({'spec': spec, 'mat': lmat, 'albedo': albedo, 'normal': normal_img, 'na': na, 'nn': nn})
if len(parts) > 1:
    select_only(*parts, active=parts[0])
    bpy.ops.object.join()
low = parts[0]
low.name = opt['--name']
low.data.name = opt['--name'] + 'Mesh'
bmw = bmesh.new()
bmw.from_mesh(low.data)
seam = bmesh.ops.remove_doubles(bmw, verts=list(bmw.verts), dist=1e-6)
for f in bmw.faces:
    f.smooth = True
for e in bmw.edges:
    e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < math.radians(48)
bmw.to_mesh(low.data)
bmw.free()

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 4
bake = scene.render.bake
bake.use_selected_to_active = True
bake.normal_space = 'TANGENT'
frac = float(opt['--extrusion-frac'])
span = float(max(low.dimensions))
fill_report = {}


def coverage_masks():
    """UV-island texels of every material slot: one emission bake of the low mesh itself, each slot writing
    white into its own temporary image."""
    saved = list(low.data.materials)
    temps = []
    for i, m in enumerate(mats):
        size = m['albedo'].size[0]
        img = bpy.data.images.new('CoverageMask%d' % i, size, size, alpha=True)
        img.generated_color = (0, 0, 0, 0)
        tmp = bpy.data.materials.new('CoverageWhite%d' % i)
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
        low.data.materials[i] = tmp
        temps.append((img, tmp))
    bake.use_selected_to_active = False
    bake.use_clear = False
    bake.margin = 0
    select_only(low)
    bpy.ops.object.bake(type='EMIT')
    out = []
    for i, (img, tmp) in enumerate(temps):
        low.data.materials[i] = saved[i]
        size = img.size[0]
        px_ = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(px_)
        out.append(px_.reshape(size, size, 4)[:, :, 3] > .5)
        bpy.data.images.remove(img)
        bpy.data.materials.remove(tmp)
    bake.use_selected_to_active = True
    return out


def bake_all(kind, flat):
    """One selected-to-active bake per ray distance writes every material's own image; then per image: exact miss
    detection (alpha 0 inside its islands), wide second pass for the misses, neighbour fill, 8-texel margin and,
    for normals, back-face flip with z >= 0.25."""
    masks = coverage_masks()
    key = 'na' if kind == 'EMIT' else 'nn'
    tgt = 'albedo' if kind == 'EMIT' else 'normal'
    outs = [None] * len(mats)
    hits = [np.zeros(mk.shape, bool) for mk in masks]
    first = [0] * len(mats)
    for mult in (1, 4):
        temps = []
        for m in mats:
            size = m[tgt].size[0]
            img = bpy.data.images.new(f'Bake{kind}{mult}', size, size, alpha=True)
            img.colorspace_settings.name = m[tgt].colorspace_settings.name
            img.generated_color = (0, 0, 0, 0)
            node = m[key]
            node.image = img
            lt = m['mat'].node_tree
            for n in lt.nodes:
                n.select = False
            node.select = True
            lt.nodes.active = node
            temps.append(img)
        bake.cage_extrusion = span * frac * mult
        bake.max_ray_distance = span * frac * 3 * mult
        bake.use_clear = False
        bake.margin = 0
        select_only(*bake_src, low, active=low)
        bpy.ops.object.bake(type=kind)
        for i, img in enumerate(temps):
            size = img.size[0]
            px_ = np.empty(size * size * 4, np.float32)
            img.pixels.foreach_get(px_)
            px_ = px_.reshape(size, size, 4)
            bpy.data.images.remove(img)
            got = px_[:, :, 3] > .5
            if outs[i] is None:
                outs[i] = px_.copy()
                first[i] = int((masks[i] & ~got).sum())
            else:
                take = got & ~hits[i] & masks[i]
                outs[i][take] = px_[take]
            hits[i] |= got
        if all(not (mk & ~h).any() for mk, h in zip(masks, hits)):
            break
    for i, m in enumerate(mats):
        mask, valid = masks[i], hits[i] & masks[i]
        remaining = int((mask & ~valid).sum())
        rgb = outs[i][:, :, :3]
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
        rgb[~valid] = flat
        flipped = 0
        if kind == 'NORMAL':
            v = rgb * 2 - 1
            v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
            back = v[:, :, 2] < 0
            flipped = int((back & mask).sum())
            v[back] *= -1
            v[v[:, :, 2] < .25, 2] = .25
            v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
            rgb[:] = v * .5 + .5
        target = m[tgt]
        target.pixels.foreach_set(np.concatenate([rgb, np.ones(mask.shape + (1,), np.float32)], 2).ravel())
        target.update()
        target.pack()
        m[key].image = target
        fill_report[f"{m['spec']['name']}:{kind}"] = {'island_texels': int(mask.sum()), 'first_pass_misses': first[i],
                                                     'neighbour_filled': remaining, 'flipped_backfacing_normals': flipped}


tb = time.time()
bake_all('EMIT', (.5, .5, .5))
bake_all('NORMAL', (.5, .5, 1))
bake_seconds = round(time.time() - tb, 1)
size_a, size_n = part_specs[0]['albedo'], part_specs[0]['normal']
rough = rough_default

# Skin weights from the delivered mesh(es).
for o in bake_src:
    for g in sources[bake_src.index(o)].vertex_groups:
        if g.name not in o.vertex_groups:
            o.vertex_groups.new(name=g.name)
src_join = bake_src[0]
if len(bake_src) > 1:
    select_only(*bake_src, active=bake_src[0])
    bpy.ops.object.join()
    src_join = bpy.context.view_layer.objects.active
select_only(low)
dt = low.modifiers.new('WeightTransfer', 'DATA_TRANSFER')
dt.object = src_join
dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'
dt.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.datalayout_transfer(modifier=dt.name)
bpy.ops.object.modifier_apply(modifier=dt.name)
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bone_names = {b.name for b in arm.data.bones}
for g in list(low.vertex_groups):
    if g.name not in bone_names:
        low.vertex_groups.remove(g)
W = np.zeros((len(low.data.vertices), len(low.vertex_groups)))
for v in low.data.vertices:
    for ge in v.groups:
        W[v.index, ge.group] = ge.weight
unweighted = int((W.sum(1) < 1e-6).sum())

# Replace the delivered mesh(es) under the same armature; keep the delivered mesh node name.
keep_name = sources[0].name if len(sources) == 1 else opt['--name']
keep_data = sources[0].data.name if len(sources) == 1 else opt['--name'] + 'Mesh'
for o in sources + bake_src + others + ([src_join] if src_join not in bake_src else []):
    if o.name in bpy.data.objects:
        bpy.data.objects.remove(o, do_unlink=True)
low.name = keep_name
low.data.name = keep_data
# Part materials were created while the source materials still existed ('X.001'); restore the exact source names
# (the game looks some up by name, e.g. TribeAccent).
for spec, m in zip(part_specs, low.data.materials):
    old = bpy.data.materials.get(spec['name'])
    if old is not None and old is not m:
        old.name = spec['name'] + '.source'
    m.name = spec['name']
low.parent = arm
low.matrix_parent_inverse = arm.matrix_world.inverted()
mod = low.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
arm.data.pose_position = 'POSE'
glb = outdir / 'candidate.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False,
                          export_force_sampling=True, export_bake_animation=False, export_optimize_animation_size=False,
                          export_anim_slide_to_zero=False, export_def_bones=False, export_rest_position_armature=True,
                          export_influence_nb=4, export_tangents=True, export_image_format='WEBP', export_image_quality=92)
report = {'author': 'Claude Code (Opus 5.5)', 'claude_used': True, 'script': 'scripts/remake/transfer_reduce.py',
          'source': {'path': src, 'sha256': sha(src)}, 'low': {'path': lowpath, 'sha256': sha(lowpath)},
          'output': {'path': str(glb), 'sha256': sha(glb), 'bytes': glb.stat().st_size,
                     'triangles': sum(len(p.vertices) - 2 for p in low.data.polygons)},
          'textures': {'parts': part_specs, 'albedo': size_a, 'normal': size_n, 'format': 'WebP q92, MikkTSpace tangents', 'roughness': rough,
                       'bake_fill': fill_report, 'bake_seconds': bake_seconds},
          'weights': {'method': 'Data Transfer POLYINTERP_NEAREST from the delivered rest mesh, limit 4, normalised',
                      'groups': len(low.vertex_groups), 'unweighted_vertices': unweighted},
          'actions': [a.name for a in bpy.data.actions], 'keyRateHz': scene.render.fps, 'seconds': round(time.time() - t0, 1)}
(outdir / 'report.json').write_text(json.dumps(report, indent=2), newline='\n')
print('TRANSFER_DONE', json.dumps(report))
