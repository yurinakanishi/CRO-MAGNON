"""Render poses of an exact exported GLB at given clip fractions (Cycles CPU).

blender -b --python render_clips.py -- <glb> <outdir> --clips Walk_Loop:0,.25,.5,.75;Death:1
    [--views left,front] [--size 480] [--clay] [--zoom 1.0] [--focus x,y,z,span]
Files: <clip>-<view>-<pct>.png. Scene fps is set to 30 before import (glTF seconds -> frames).
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
glb, out = argv[0], Path(argv[1])
opt = {'--clips': '', '--views': 'left,front', '--size': '480', '--zoom': '1.0', '--focus': ''}
flags = set()
i = 2
while i < len(argv):
    if argv[i] in opt:
        opt[argv[i]] = argv[i + 1]
        i += 2
    else:
        flags.add(argv[i])
        i += 1
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=glb)
rig = next((o for o in scene.objects if o.type == 'ARMATURE'), None)
meshes = [o for o in scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector([min(p[k] for p in pts) for k in range(3)])
hi = Vector([max(p[k] for p in pts) for k in range(3)])
centre = (lo + hi) / 2
span = max(hi - lo) / float(opt['--zoom'])
if opt['--focus']:
    fx, fy, fz, fs = map(float, opt['--focus'].split(','))
    centre, span = Vector((fx, fy, fz)), fs
if '--no-normal' in flags:
    for o in meshes:
        for m in o.data.materials:
            if m and m.use_nodes:
                for n in list(m.node_tree.nodes):
                    if n.type == 'NORMAL_MAP':
                        m.node_tree.nodes.remove(n)
if '--clay' in flags:
    clay = bpy.data.materials.new('Clay')
    clay.use_nodes = True
    clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.62, .6, .57, 1)
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(clay)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 12
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = int(opt['--size'])
world = bpy.data.worlds.new('W')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.55, .57, .6, 1)
for e, r in [(3.2, (50, 0, -35)), (1.0, (65, 0, 150))]:
    light = bpy.data.objects.new('L', bpy.data.lights.new('L', 'SUN'))
    light.data.energy = e
    light.rotation_euler = [math.radians(x) for x in r]
    scene.collection.objects.link(light)
# Ground plane at z=0 makes contact and penetration visible.
bpy.ops.mesh.primitive_plane_add(size=span * 4, location=(centre.x, centre.y, 0))
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = span * 1.1
dirs = {'front': (0, -1, .15), 'back': (0, 1, .15), 'left': (1, 0, .12), 'right': (-1, 0, .12),
        'threequarter': (.75, -.8, .3), 'top': (0, -.01, 1)}
actions = {a.name: a for a in bpy.data.actions}
for spec in [c for c in opt['--clips'].split(';') if c]:
    name, fracs = spec.split(':')
    action = actions.get(name) or next((a for n, a in actions.items() if n.startswith(name)), None)
    if action is None:
        print('MISSING_CLIP', name, list(actions))
        continue
    rig.animation_data.action = action
    if hasattr(rig.animation_data, 'action_slot') and action.slots:
        rig.animation_data.action_slot = action.slots[0]
    f0, f1 = action.frame_range
    for frac in [float(x) for x in fracs.split(',')]:
        scene.frame_set(int(round(f0 + (f1 - f0) * frac)))
        for view in opt['--views'].split(','):
            d = Vector(dirs[view]).normalized()
            cam.location = centre + d * span * 3
            cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(out / f'{name}-{view}-{int(frac * 100):03d}.png')
            bpy.ops.render.render(write_still=True)
if not [c for c in opt['--clips'].split(';') if c]:
    # Static GLB (or rest pose): one still per view.
    for view in opt['--views'].split(','):
        d = Vector(dirs[view]).normalized()
        cam.location = centre + d * span * 3
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(out / f'rest-{view}.png')
        bpy.ops.render.render(write_still=True)
print('RENDER_CLIPS_DONE')
