"""Render a rigged GLB with ground-centred prop GLBs placed at glTF-space (Y-up) positions, to check
attachment layouts such as src/crow-faction-visuals.ts CROW_RANK_PARTS before adopting the props.

blender -b --python compose_props.py -- <rig.glb> <outdir> <layout.json> [--clip Idle_Loop:0] [--size 640]
    [--views front,left,threequarter] [--focus x,y,z,span]
layout.json: {"props": [{"glb": "...", "position": [x, y, z], "rotation": [rx, ry, rz]?}]} (glTF axes, metres)
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
rig_path, out, layout_path = argv[0], Path(argv[1]), argv[2]
opt = {'--clip': '', '--size': '640', '--views': 'front,left,threequarter', '--focus': ''}
i = 3
while i < len(argv):
    opt[argv[i]] = argv[i + 1]
    i += 2
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=rig_path)
rig = next((o for o in scene.objects if o.type == 'ARMATURE'), None)
if rig and opt['--clip']:
    name, frac = opt['--clip'].split(':')
    act = bpy.data.actions.get(name) or next((a for a in bpy.data.actions if a.name.startswith(name)), None)
    if act:
        rig.animation_data_create()
        rig.animation_data.action = act
        lo, hi = act.frame_range
        scene.frame_set(int(round(lo + (hi - lo) * float(frac))))
# glTF (x, y, z) -> Blender (x, -z, y)
G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
for prop in json.loads(Path(layout_path).read_text())['props']:
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=prop['glb'])
    new = [o for o in scene.objects if o not in before and o.parent is None]
    rx, ry, rz = prop.get('rotation', [0, 0, 0])
    local = Matrix.Translation(Vector(prop['position'])) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()
    place = G2B @ local @ G2B.inverted()
    for o in new:
        o.matrix_world = place @ o.matrix_world
bpy.context.view_layer.update()
meshes = [o for o in scene.objects if o.type == 'MESH']
deps = bpy.context.evaluated_depsgraph_get()
pts = []
for o in meshes:
    ev = o.evaluated_get(deps)
    me = ev.to_mesh()
    pts += [ev.matrix_world @ v.co for i, v in enumerate(me.vertices) if i % 7 == 0]
    ev.to_mesh_clear()
lo = Vector([min(p[k] for p in pts) for k in range(3)])
hi = Vector([max(p[k] for p in pts) for k in range(3)])
centre, span = (lo + hi) / 2, max(hi - lo)
if opt['--focus']:
    fx, fy, fz, fs = map(float, opt['--focus'].split(','))
    centre, span = Vector((fx, fy, fz)), fs
world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.62, .63, .65, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
scene.world = world
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 3.2
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, lo.z))
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = span * 1.15
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
size = int(opt['--size'])
scene.render.resolution_x = scene.render.resolution_y = size
views = {'front': 0, 'left': 90, 'threequarter': 35, 'back': 180, 'right': -90}
for v in opt['--views'].split(','):
    a = math.radians(views[v])
    d = span * 3
    cam.location = centre + Vector((math.sin(a) * d, -math.cos(a) * d, span * .25))
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / f'compose-{v}.png')
    bpy.ops.render.render(write_still=True)
print('COMPOSE_DONE', out)
