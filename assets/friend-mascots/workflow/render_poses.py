"""Render the exported GLB in every clip for visual QA (front and three-quarter views).

blender -b --python render_poses.py -- <candidate.glb> <out dir>
Writes <clip>-<phase>-<view>.png at 512 px; compose with sheet_poses.py.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

glb, out = sys.argv[sys.argv.index('--') + 1:][:2]
out = Path(out).resolve()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.film_transparent = True
height = max(max((m.matrix_world @ Vector(c)).z for c in m.bound_box) for m in meshes)
camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
scene.collection.objects.link(camera)
camera.data.type = 'ORTHO'
camera.data.ortho_scale = height * 1.45
scene.camera = camera
centre = Vector((0, 0, height * 0.52))
views = {'front': Vector((0, -3, 0)), 'three': Vector((2.2, -2.2, 0.6))}
if rig.animation_data is None:
    rig.animation_data_create()
for action in bpy.data.actions:
    name = action.name.split('|')[-1].replace('_' + rig.name, '')
    rig.animation_data.action = action
    start, end = action.frame_range
    for phase in [0.0, 0.25, 0.5, 0.75]:
        scene.frame_set(int(round(start + (end - start) * phase)))
        for view, offset in views.items():
            camera.location = centre + offset
            camera.rotation_euler = (centre - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(out / f'{name}-{int(phase * 100):02d}-{view}.png')
            bpy.ops.render.render(write_still=True)
    print('RENDERED', name, flush=True)
