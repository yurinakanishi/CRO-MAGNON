"""Neutral multi-view render of an exact GLB (Cycles CPU, keeps the GPU free for TRELLIS).

blender -b --python render_views.py -- <glb> <outdir> [--clay] [--size 560] [--views front,left,...]
          [--front +Y|-Y|+X|-X] [--samples 24]
Writes <view>.png per view and sheet.jpg. Front convention: glTF +Z == Blender -Y.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
glb, out = Path(argv[0]), Path(argv[1])
opts = {'--size': '560', '--views': 'front,threequarter,left,back,right,top', '--front': '-Y', '--samples': '24'}
flags = set()
i = 2
while i < len(argv):
    if argv[i] in opts:
        opts[argv[i]] = argv[i + 1]
        i += 2
    else:
        flags.add(argv[i])
        i += 1
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb))
scene = bpy.context.scene
for ob in list(scene.objects):
    if ob.type == 'ARMATURE':
        ob.data.pose_position = 'REST'
meshes = [o for o in scene.objects if o.type == 'MESH']
deps = bpy.context.evaluated_depsgraph_get()
pts = []
for o in meshes:
    ev = o.evaluated_get(deps)
    for c in ev.bound_box:
        pts.append(o.matrix_world @ Vector(c))
lo = Vector([min(p[k] for p in pts) for k in range(3)])
hi = Vector([max(p[k] for p in pts) for k in range(3)])
centre = (lo + hi) / 2
size = max(hi - lo)
if '--clay' in flags:
    clay = bpy.data.materials.new('Clay')
    clay.use_nodes = True
    clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .57, 1)
    clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .7
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(clay)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = int(opts['--samples'])
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = int(opts['--size'])
scene.view_settings.view_transform = 'AgX' if 'AgX' in [x.identifier for x in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
world = bpy.data.worlds.new('W')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.55, .57, .6, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .9
key = bpy.data.objects.new('Key', bpy.data.lights.new('Key', 'SUN'))
key.data.energy = 3.2
key.data.angle = math.radians(8)
key.rotation_euler = (math.radians(50), 0, math.radians(-35))
fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'SUN'))
fill.data.energy = 1.0
fill.rotation_euler = (math.radians(65), 0, math.radians(150))
for l in (key, fill):
    scene.collection.objects.link(l)
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = size * 1.12
f = {'-Y': Vector((0, -1, 0)), '+Y': Vector((0, 1, 0)), '+X': Vector((1, 0, 0)), '-X': Vector((-1, 0, 0))}[opts['--front']]
side = Vector((f.y, -f.x, 0))  # model's left when looking at its front
dirs = {
    'front': f + Vector((0, 0, .12)), 'back': -f + Vector((0, 0, .12)), 'left': side + Vector((0, 0, .12)),
    'right': -side + Vector((0, 0, .12)), 'threequarter': f * .8 + side * .75 + Vector((0, 0, .35)),
    'backquarter': -f * .8 - side * .75 + Vector((0, 0, .35)), 'top': Vector((0, -.01, 1)), 'bottom': Vector((0, .01, -1)),
}
files = []
for name in opts['--views'].split(','):
    d = dirs[name].normalized()
    cam.location = centre + d * size * 3
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    path = out / f'{name}.png'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    files.append(path)
try:
    from PIL import Image
    ims = [Image.open(p).convert('RGB') for p in files]
    w = ims[0].width
    cols = min(len(ims), 3)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (w * cols, w * rows), (40, 40, 40))
    for k, im in enumerate(ims):
        sheet.paste(im, ((k % cols) * w, (k // cols) * w))
    sheet.save(out / 'sheet.jpg', quality=88)
except Exception as error:  # PIL may be absent in Blender's Python
    print('SHEET_SKIPPED', error)
print('RENDER_VIEWS_DONE', tuple(lo), tuple(hi))
