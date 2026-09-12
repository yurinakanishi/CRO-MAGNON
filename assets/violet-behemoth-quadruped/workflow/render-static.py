"""Four-view EEVEE review sheet of a static GLB (orientation and surface check)."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector

glb, out = sys.argv[sys.argv.index('--')+1:][:2]
ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
glb = str((ROOT/glb).resolve()); out = (ROOT/out).resolve(); out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
lo = Vector((min(min((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in meshes) for i in range(3)))
hi = Vector((max(max((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in meshes) for i in range(3)))
centre = (lo + hi) / 2; size = max(hi - lo)
scene = bpy.context.scene; scene.render.engine = 'BLENDER_EEVEE'; scene.render.resolution_x = 960; scene.render.resolution_y = 720
world = bpy.data.worlds.new('W'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.8, .82, .85, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 1.2
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); scene.collection.objects.link(sun); sun.rotation_euler = (.7, .2, .6); sun.data.energy = 3
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size * 1.65
for name, d in {'left': (-1, 0, .08), 'right': (1, 0, .08), 'front': (0, -1, .08), 'rear': (0, 1, .08), 'threequarter': (-.8, -1, .35), 'opposite': (.8, -1, .25), 'top': (0, -.01, 1), 'bottom': (0, -.01, -1)}.items():
    cam.location = centre + Vector(d).normalized() * size * 3
    cam.rotation_euler = (cam.location - centre).to_track_quat('Z', 'Y').to_euler()
    scene.render.filepath = str(Path(out) / f'{name}.png'); bpy.ops.render.render(write_still=True)
print('STATIC_RENDER_DONE', lo, hi)
