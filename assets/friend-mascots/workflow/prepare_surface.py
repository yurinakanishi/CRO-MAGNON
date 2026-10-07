"""Reduce one friend mascot's TRELLIS surface and rebake its albedo from the dense reconstruction.

node scripts/remake/meshopt_reduce.mjs <dense.glb> <low.glb> 24000 .01      (positions only)
blender -b --python prepare_surface.py -- --key saber-mascot --dense <dense.glb> --low <low.glb> --revision 01 [--height 0.52 --texture 2048]
Writes work/surface/revision-NN/{surface.glb, surface.blend, surface.json, surface.npz, albedo.png, front/side/back.png}.
Only TRELLIS-derived positions are used: meshopt reduction of the dense surface, weld,
removal of tiny floating islands, uniform scale and a translation centring the soles.
The albedo is a selected-to-active diffuse-colour projection from the exact dense mesh.
(A UV-preserving seam-locked reduction stalled near 65k triangles, and its permissive
seam collapses speckled the atlas, so the reduced surface gets fresh UVs and a bake.)
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
sys.path.insert(0, str(ROOT / 'assets/rimo-neko/workflow/lib'))
import blender_reduce as base  # noqa: E402
import blender_rig as rigtools  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--key', required=True)
ap.add_argument('--dense', required=True)
ap.add_argument('--low', required=True, help='position-only meshopt reduction of --dense')
ap.add_argument('--revision', default='01')
ap.add_argument('--height', type=float, default=0.52)
ap.add_argument('--texture', type=int, default=2048)
ap.add_argument('--keep-fraction', type=float, default=0.004)
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
M = ROOT / 'output/model-generation/models' / a.key
out = M / f'work/surface/revision-{a.revision}'
out.mkdir(parents=True, exist_ok=True)
assert not (out / 'surface.glb').exists(), 'Preserve previous output; use a new revision'
H = a.height
source = Path(a.dense)

# Reference arrays from the dense reconstruction (same TRELLIS units as the reduction).
ref = base.import_dense(source)
base.weld(ref)
base.triangulate(ref)
P = base.positions_of(ref.data)
F = base.face_array(ref.data)
height = float(np.ptp(P[:, 2]))
tree = base.bvh_from_arrays(P, F)
samples = base.sample_surface(P, F, 18000, 42)
dense_triangles = len(F)
del P, F

obj = base.import_dense(Path(a.low))
obj.name = a.key
weld = base.weld(obj)
islands = base.drop_small_components(obj, a.keep_fraction)
base.triangulate(obj)
Q = base.positions_of(obj.data)
G = base.face_array(obj.data)


def metric(points, target):
    r = base.deviation(points, target, height)
    return {k: r[k + '_units'] * H / height for k in ['rms', 'p95', 'max']}


forward = metric(samples, base.bvh_from_arrays(Q, G))
reverse = metric(base.sample_surface(Q, G, 18000, 43), tree)
print(json.dumps(dict(triangles=len(G), forward=forward, reverse=reverse)), flush=True)
for poly in obj.data.polygons:
    poly.use_smooth = True
unwrap = rigtools.unwrap(obj, 66.0, 0.003)
# Bake the dense base colour only. TRELLIS sometimes marks glossy black leather, hair or
# zips as metallic; a diffuse-colour bake returns base * (1 - metallic), which crushed those
# parts to black on the first Rei/Saga/nukonuko bakes. The game material is non-metallic,
# so the dense sources' metallic input is unlinked and set to 0 for the projection only.
_import_gltf = bpy.ops.import_scene.gltf


def _import_nonmetallic(**kwargs):
    before = set(bpy.data.materials)
    result = _import_gltf(**kwargs)
    for mat in set(bpy.data.materials) - before:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                for link in list(mat.node_tree.links):
                    if link.to_socket == node.inputs['Metallic']:
                        mat.node_tree.links.remove(link)
                node.inputs['Metallic'].default_value = 0
    return result


class _Ops:  # a stand-in for bpy.ops inside the helper, only for its glTF import
    def __getattr__(self, name):
        return getattr(bpy.ops, name)


class _ImportScene:
    gltf = staticmethod(_import_nonmetallic)


_ops = _Ops()
_ops.import_scene = _ImportScene()


class _Bpy:
    def __getattr__(self, name):
        return _ops if name == 'ops' else getattr(bpy, name)


rigtools.bpy = _Bpy()
material, image, bake = rigtools.bake_dense_albedo(obj, source, out / 'albedo.png', a.texture)
rigtools.bpy = bpy
bake['denseMetallic'] = 'unlinked and set to 0 before the diffuse-colour projection'
material.name = a.key + '_Albedo'
bsdf = material.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = .78
bsdf.inputs['Metallic'].default_value = 0

P = base.positions_of(obj.data)
scale = H / float(np.ptp(P[:, 2]))
P *= scale
P[:, 2] -= P[:, 2].min()
# Centre the soles rather than an asymmetric tail, hair or hat silhouette.
feet = P[P[:, 2] < H * 0.05]
origin = np.array([(feet[:, 0].min() + feet[:, 0].max()) * .5, (feet[:, 1].min() + feet[:, 1].max()) * .5, 0.])
P -= origin
obj.data.vertices.foreach_set('co', P.astype(np.float32).ravel())
obj.data.update()
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=str(out / 'surface.glb'), export_format='GLB', use_selection=True,
                          export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'surface.blend'))
bands = []
for f in np.arange(0.02, 1.0, 0.02):
    q = P[abs(P[:, 2] / H - f) < .008]
    if len(q):
        bands.append(dict(heightFraction=round(float(f), 3), count=int(len(q)),
                          min=(q.min(0) / H).round(4).tolist(), max=(q.max(0) / H).round(4).tolist()))

# Orthographic landmark renders: 1 px = span / 1024 m, origin at the image centre.
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'FLAT'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.film_transparent = True
span = 1.15 * max(H, float(np.ptp(P[:, 0])), float(np.ptp(P[:, 1])))
camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
scene.collection.objects.link(camera)
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span
scene.camera = camera
centre = Vector((0, 0, H / 2))
for name, offset in {'front': Vector((0, -3, 0)), 'side': Vector((3, 0, 0)), 'back': Vector((0, 3, 0))}.items():
    camera.location = centre + offset
    camera.rotation_euler = (centre - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / f'{name}.png')
    bpy.ops.render.render(write_still=True)

sha = lambda f: hashlib.sha256(Path(f).read_bytes()).hexdigest()
record = dict(key=a.key, revision=a.revision, heightMetres=H, widthMetres=float(np.ptp(P[:, 0])),
              lengthMetres=float(np.ptp(P[:, 1])), scale=scale, origin=origin.tolist(),
              sha256=sha(out / 'surface.glb'), source=str(source), sourceSha256=sha(source),
              low=str(a.low), lowSha256=sha(a.low), denseTriangles=dense_triangles,
              triangles=len(obj.data.polygons), deviationMetres=dict(denseToLow=forward, lowToDense=reverse),
              weld=weld, islands=islands, unwrap=unwrap, bake=bake, albedoSha256=sha(out / 'albedo.png'),
              render=dict(spanMetres=span, pixels=1024, centreHeightMetres=H / 2), bands=bands,
              blender=bpy.app.version_string)
(out / 'surface.json').write_text(json.dumps(record, indent=2) + '\n')
np.savez_compressed(out / 'surface.npz', positions=P, faces=base.face_array(obj.data))
print(json.dumps({k: record[k] for k in ['key', 'triangles', 'widthMetres', 'lengthMetres', 'sha256']}), flush=True)
