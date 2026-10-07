"""Bake a tangent-space normal map for an already delivered static GLB from its TRELLIS dense surface, on the
delivered mesh's own UVs and normals, without changing the delivered geometry (walk atlases, collision bounds and
measured landmark data that hash the delivered mesh stay valid; scripts/remake/inject_normal_map.py then adds only
the image + normalTexture to the original GLB bytes).

blender -b --python normal_upgrade.py -- --delivered D.glb --dense S.glb --matrix fit.json --out normal.png
    [--size 2048] [--extrusion-frac .004]
fit.json: scripts/remake/fit_to_delivered.py (similarity ICP of the dense onto the delivered mesh).
Same miss fill / back-face flip as remake_process.py. Several material slots (own UV atlases) bake into
<out stem>-m<i>.png, one per slot in material order. Report: <out>.json
"""
import argparse
import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--delivered', required=True)
ap.add_argument('--dense', required=True)
ap.add_argument('--matrix', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--size', type=int, default=2048)
ap.add_argument('--extrusion-frac', type=float, default=.004)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH']


def select_only(*objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[-1]


low_objs = import_glb(args.delivered)
select_only(*low_objs, active=low_objs[0])
if len(low_objs) > 1:
    bpy.ops.object.join()
low = bpy.context.view_layer.objects.active
dense = import_glb(args.dense)
select_only(*dense, active=dense[0])
if len(dense) > 1:
    bpy.ops.object.join()
src = bpy.context.view_layer.objects.active
M = np.array(json.loads(Path(args.matrix).read_text())['matrix'], dtype=float).reshape(4, 4)
co = np.empty(len(src.data.vertices) * 3)
src.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3) @ np.asarray(src.matrix_world.to_3x3()).T + np.asarray(src.matrix_world.translation)
src.matrix_world.identity()
src.data.vertices.foreach_set('co', (co @ M[:3, :3].T + M[:3, 3]).ravel())
src.data.update()
low_co = np.empty(len(low.data.vertices) * 3)
low.data.vertices.foreach_get('co', low_co)
span = float(np.ptp(low_co.reshape(-1, 3) @ np.asarray(low.matrix_world.to_3x3()).T, axis=0).max())

size = args.size
mats = [m for m in low.data.materials if m]
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 4
bake = scene.render.bake
bake.normal_space = 'TANGENT'


def set_active_images(imgs):
    """One image per material slot: a single bake writes every slot's own UV atlas into its own image."""
    for m, img in zip(mats, imgs):
        nt = m.node_tree
        node = nt.nodes.get('UpgradeBakeTarget') or nt.nodes.new('ShaderNodeTexImage')
        node.name = 'UpgradeBakeTarget'
        node.image = img
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node


# coverage: the delivered mesh's own white emission, each material slot into its own alpha image
saved = list(low.data.materials)
covs = []
for i in range(len(saved)):
    cov = bpy.data.images.new('Coverage%d' % i, size, size, alpha=True)
    cov.generated_color = (0, 0, 0, 0)
    white = bpy.data.materials.new('CoverageWhite%d' % i)
    white.use_nodes = True
    tn = white.node_tree
    tn.nodes.remove(tn.nodes['Principled BSDF'])
    em = tn.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (1, 1, 1, 1)
    tn.links.new(em.outputs['Emission'], tn.nodes['Material Output'].inputs['Surface'])
    ti = tn.nodes.new('ShaderNodeTexImage')
    ti.image = cov
    for n in tn.nodes:
        n.select = False
    ti.select = True
    tn.nodes.active = ti
    low.data.materials[i] = white
    covs.append(cov)
bake.use_selected_to_active = False
bake.use_clear = False
bake.margin = 0
select_only(low)
bpy.ops.object.bake(type='EMIT')
for i, m in enumerate(saved):
    low.data.materials[i] = m
masks = []
for cov in covs:
    px = np.empty(size * size * 4, np.float32)
    cov.pixels.foreach_get(px)
    masks.append(px.reshape(size, size, 4)[:, :, 3] > .5)

outs, hits, firsts = [None] * len(mats), [np.zeros((size, size), bool) for _ in mats], [0] * len(mats)
for mult in (1, 4):
    imgs = []
    for i in range(len(mats)):
        img = bpy.data.images.new('BakeN%d_%d' % (mult, i), size, size, alpha=True)
        img.colorspace_settings.name = 'Non-Color'
        img.generated_color = (0, 0, 0, 0)
        imgs.append(img)
    set_active_images(imgs)
    bake.use_selected_to_active = True
    bake.cage_extrusion = span * args.extrusion_frac * mult
    bake.max_ray_distance = span * args.extrusion_frac * 3 * mult
    bake.use_clear = False
    bake.margin = 0
    select_only(src, low, active=low)
    bpy.ops.object.bake(type='NORMAL')
    for i, img in enumerate(imgs):
        p_ = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(p_)
        p_ = p_.reshape(size, size, 4)
        got = p_[:, :, 3] > .5
        if outs[i] is None:
            outs[i] = p_.copy()
            firsts[i] = int((masks[i] & ~got).sum())
        else:
            take = got & ~hits[i] & masks[i]
            outs[i][take] = p_[take]
        hits[i] |= got
    if all(not (mk & ~h).any() for mk, h in zip(masks, hits)):
        break

out_paths, slots = [], []
for i in range(len(mats)):
    mask = masks[i]
    valid = hits[i] & mask
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
    rgb[~valid] = (.5, .5, 1)
    v = rgb * 2 - 1
    v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
    back = v[:, :, 2] < 0
    flipped = int((back & mask).sum())
    v[back] *= -1
    v[v[:, :, 2] < .25, 2] = .25
    v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
    rgb = v * .5 + .5
    img_final = bpy.data.images.new('UpgradeNormal%d' % i, size, size, alpha=False)
    img_final.colorspace_settings.name = 'Non-Color'
    img_final.pixels.foreach_set(np.concatenate([rgb, np.ones(mask.shape + (1,), np.float32)], 2).ravel())
    path = args.out if len(mats) == 1 else str(Path(args.out).with_name(Path(args.out).stem + '-m%d.png' % i))
    img_final.filepath_raw = path
    img_final.file_format = 'PNG'
    img_final.save()
    out_paths.append(path)
    slots.append({'material': mats[i].name, 'png': path, 'island_texels': int(mask.sum()), 'first_pass_misses': firsts[i],
                  'neighbour_filled': remaining, 'flipped_backfacing_normals': flipped})
rep = {'delivered': args.delivered, 'dense': args.dense, 'matrix': args.matrix, 'size': size, 'pngs': out_paths, 'slots': slots,
       'island_texels': sum(x['island_texels'] for x in slots), 'first_pass_misses': sum(x['first_pass_misses'] for x in slots),
       'neighbour_filled': sum(x['neighbour_filled'] for x in slots),
       'flipped_backfacing_normals': sum(x['flipped_backfacing_normals'] for x in slots),
       'extrusion_frac': args.extrusion_frac, 'seconds': round(time.time() - t0, 1),
       'method': 'selected-to-active tangent normal bake from the ICP-placed dense onto the delivered mesh UVs and normals; geometry not modified'}
Path(args.out).with_suffix('.json').write_text(json.dumps(rep, indent=2), newline=chr(10))
print('NORMAL_UPGRADE_DONE', json.dumps(rep))
