"""Repaint a mis-textured region of a prepared surface's baked albedo (geometry and UVs unchanged).

blender -b --python texture_fix.py -- --key saber-mascot --surface 01 --revision 02
Reads assets/friend-mascots/<key>/texture-fix.json:
  {"regions": [{"name": "tail", "box": [x0,x1,y0,y1,z0,z1], "skipBrighterThan": 0.8,
                "colourFrom": [x0,x1,y0,y1,z0,z1], "shading": 0.35}]}
Boxes are fractions of H in the surface frame (x: character left, y: back, z: up). Faces whose
centre lies in `box` (and whose texels are not near-white cloth when skipBrighterThan is set) are
repainted with the mean colour of the faces in `colourFrom`, keeping `shading` of the original
luminance variation. The repainted texels are dilated 3 px into the chart margin.
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
ap = argparse.ArgumentParser()
ap.add_argument('--key', required=True)
ap.add_argument('--surface', required=True)
ap.add_argument('--revision', required=True)
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
M = ROOT / 'output/model-generation/models' / a.key
src = M / f'work/surface/revision-{a.surface}'
out = M / f'work/surface/revision-{a.revision}'
assert not (out / 'surface.glb').exists(), 'Keep every revision'
out.mkdir(parents=True, exist_ok=True)
config = json.loads((ROOT / 'assets/friend-mascots' / a.key / 'texture-fix.json').read_text(encoding='utf-8'))
record = json.loads((src / 'surface.json').read_text())
H = record['heightMetres']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src / 'surface.glb'))
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh = obj.data
image = next(n.image for m in mesh.materials for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
W, Hpx = image.size
pixels = np.empty(W * Hpx * 4, dtype=np.float32)
image.pixels.foreach_get(pixels)
pixels = pixels.reshape(Hpx, W, 4)
P = np.empty((len(mesh.vertices), 3))
mesh.vertices.foreach_get('co', P.ravel())
uv = np.empty((len(mesh.loops), 2))
mesh.uv_layers.active.data.foreach_get('uv', uv.ravel())
loops = np.empty(len(mesh.loops), dtype=np.int64)
mesh.loops.foreach_get('vertex_index', loops)
F = loops.reshape(-1, 3)
FU = uv.reshape(-1, 3, 2)
centre = P[F].mean(1) / H


def inside(box):
    x0, x1, y0, y1, z0, z1 = box
    c = centre
    return (c[:, 0] >= x0) & (c[:, 0] <= x1) & (c[:, 1] >= y0) & (c[:, 1] <= y1) & (c[:, 2] >= z0) & (c[:, 2] <= z1)


def raster(face_ids):
    mask = np.zeros((Hpx, W), dtype=bool)
    for t in FU[face_ids]:
        px = t * [W, Hpx] - .5
        x0, y0 = np.floor(px.min(0)).astype(int)
        x1, y1 = np.ceil(px.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, Hpx - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, ay), (bx, by), (cx, cy) = px
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
        l3 = 1 - l1 - l2
        hit = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        mask[gy[hit], gx[hit]] = True
    return mask


lum = lambda rgb: rgb @ np.array([.2126, .7152, .0722])
report = []
for region in config['regions']:
    faces = np.flatnonzero(inside(region['box']))
    if region.get('skipBrighterThan') is not None:
        keep = []
        for f in faces:
            m = raster([f])
            if m.any() and lum(pixels[m][:, :3].mean(0)) < region['skipBrighterThan']:
                keep.append(f)
        faces = np.array(keep, dtype=np.int64)
    source = raster(np.flatnonzero(inside(region['colourFrom'])))
    colour = pixels[source][:, :3].mean(0)
    mask = raster(faces)
    for _ in range(3):  # dilate into the bake margin so filtering never shows the old colour
        grown = mask.copy()
        grown[1:] |= mask[:-1]
        grown[:-1] |= mask[1:]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        mask = grown
    old = pixels[mask][:, :3]
    l = lum(old)
    variation = np.clip((l - l.mean()) / (l.std() + 1e-6), -2, 2) * region.get('shading', .35) * .12
    new = np.clip(colour[None, :] * (1 + variation[:, None]), 0, 1)
    pixels[mask, :3] = new
    report.append(dict(name=region.get('name'), faces=int(len(faces)), texels=int(mask.sum()),
                       colourLinear=colour.round(4).tolist(), box=region['box'], colourFrom=region['colourFrom']))
    print(json.dumps(report[-1]), flush=True)
image.pixels.foreach_set(pixels.ravel())
image.update()
image.filepath_raw = str(out / 'albedo.png')
image.file_format = 'PNG'
image.save()
image.pack()
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=str(out / 'surface.glb'), export_format='GLB', use_selection=True,
                          export_animations=False)
for name in ['surface.npz', 'front.png', 'side.png', 'back.png']:
    shutil.copyfile(src / name, out / name)
sha = lambda f: hashlib.sha256(Path(f).read_bytes()).hexdigest()
record.update(revision=a.revision, textureFix=dict(fromRevision=a.surface, regions=report),
              sha256=sha(out / 'surface.glb'), albedoSha256=sha(out / 'albedo.png'))
(out / 'surface.json').write_text(json.dumps(record, indent=2) + '\n')
# Fresh renders of the repaired surface.
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.film_transparent = True
from mathutils import Vector  # noqa: E402
span = record['render']['spanMetres']
camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
scene.collection.objects.link(camera)
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span
scene.camera = camera
centre_v = Vector((0, 0, H / 2))
for name, offset in {'front': Vector((0, -3, 0)), 'side': Vector((3, 0, 0)), 'back': Vector((0, 3, 0))}.items():
    camera.location = centre_v + offset
    camera.rotation_euler = (centre_v - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / f'{name}.png')
    bpy.ops.render.render(write_still=True)
print(json.dumps(dict(out=str(out), sha256=record['sha256'])))
