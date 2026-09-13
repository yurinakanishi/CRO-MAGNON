"""Render pose evidence for every clip from the exact exported candidate GLB.

The scene is set to 30 fps before the glTF import so Blender maps the exported
action seconds onto the intended frames. Looping clips are sampled over the
half-open range, so the duplicate terminal frame is omitted.
"""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

LOOPING = ('Idle_Loop', 'Walk_Loop', 'Run_Loop')


def argv_after_dashes():
    if '--' not in sys.argv:
        return []
    return sys.argv[sys.argv.index('--') + 1:]


def parse_args(items):
    out = dict()
    key = None
    for item in items:
        if item.startswith('--'):
            key = item[2:]
            out[key] = True
        elif key is not None:
            out[key] = item
            key = None
    return out


def clay_material():
    """Neutral grey dielectric so a pose is judged on geometry, not on albedo."""
    material = bpy.data.materials.new('NeutralClay')
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.55, 0.54, 0.52, 1.0)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.42
    return material


def setup(path, width, height, camera_spec, clay=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(path))
    # Restrict to the objects this import created: the glTF importer also leaves a
    # hidden unit "Icosphere" placeholder in the blend data.
    imported = list(bpy.context.selected_objects)
    rig = next(o for o in imported if o.type == 'ARMATURE')
    mesh = next(o for o in imported if o.type == 'MESH')
    if clay:
        material = clay_material()
        mesh.data.materials.clear()
        mesh.data.materials.append(material)

    camera_data = bpy.data.cameras.new('QACamera')
    camera_data.lens = float(camera_spec.get('lens', 55.0))
    camera = bpy.data.objects.new('QACamera', camera_data)
    scene.collection.objects.link(camera)
    target = Vector(camera_spec['target'])
    camera.location = Vector(camera_spec['location'])
    camera.rotation_euler = (camera.location - target).to_track_quat('Z', 'Y').to_euler()
    scene.camera = camera

    engines = scene.render.bl_rna.properties['engine'].enum_items.keys()
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 8
    scene.cycles.use_denoising = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 6
    if hasattr(scene, 'eevee'):
        scene.eevee.taa_render_samples = 48
    scene.render.film_transparent = False
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = 'PNG'

    world = bpy.data.worlds.new('QAWorld')
    world.use_nodes = True
    background = world.node_tree.nodes['Background']
    background.inputs['Color'].default_value = (0.60, 0.60, 0.61, 1.0)
    background.inputs['Strength'].default_value = 0.75
    scene.world = world

    for name, location, energy in (('Key', (2.6, -3.2, 3.6), 520.0),
                                   ('Fill', (-3.2, -2.0, 2.0), 170.0),
                                   ('Rim', (-1.2, 3.2, 2.8), 220.0)):
        data = bpy.data.lights.new(name, type='AREA')
        data.energy = energy
        data.size = 3.0
        light = bpy.data.objects.new(name, data)
        light.location = Vector(location)
        light.rotation_euler = (light.location - Vector((0.0, 0.0, 1.0))
                                ).to_track_quat('Z', 'Y').to_euler()
        scene.collection.objects.link(light)

    ground = bpy.data.meshes.new('Ground')
    ground.from_pydata([(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)], [],
                       [(0, 1, 2, 3)])
    ground.update()
    material = bpy.data.materials.new('GroundGrey')
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.34, 0.34, 0.35, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.85
    ground.materials.append(material)
    plane = bpy.data.objects.new('Ground', ground)
    scene.collection.objects.link(plane)
    return rig, mesh


def assign_action(rig, action):
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, 'action_slot') and len(action.slots):
        rig.animation_data.action_slot = action.slots[0]


def frame_bounds(action):
    if hasattr(action, 'frame_start') and action.frame_end > action.frame_start:
        return int(action.frame_start), int(action.frame_end)
    start, end = action.frame_range
    return int(start), int(end)


CAMERAS = dict(
    threequarter=dict(location=(2.1, -3.1, 1.55), target=(0.0, 0.0, 0.95), lens=55.0),
    front=dict(location=(0.0, -3.7, 1.35), target=(0.0, 0.0, 0.95), lens=55.0),
    right=dict(location=(3.7, 0.0, 1.35), target=(0.0, 0.0, 0.95), lens=55.0),
    rear=dict(location=(0.0, 3.7, 1.35), target=(0.0, 0.0, 0.95), lens=55.0),
)


def main():
    args = parse_args(argv_after_dashes())
    view = args.get('view', 'threequarter')
    width = int(args.get('width', 420))
    height = int(args.get('height', 560))
    columns = int(args.get('columns', 8))
    rig, mesh = setup(Path(args['glb']), width, height, CAMERAS[view],
                      clay=bool(args.get('clay')))
    outdir = Path(args['outdir']).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    only = args.get('clips')
    names = only.split(',') if only else None

    manifest = []
    for action in list(bpy.data.actions):
        if names and action.name not in names:
            continue
        assign_action(rig, action)
        start, end = frame_bounds(action)
        loop = action.name in LOOPING
        span = (end - start) if loop else (end - start)
        steps = columns
        entries = []
        for column in range(steps):
            if loop:
                frame = start + int(round(span * column / float(steps)))
            else:
                frame = start + int(round(span * column / float(steps - 1)))
            bpy.context.scene.frame_set(int(frame))
            bpy.context.view_layer.update()
            name = '%s-%s%s-%02d.png' % (action.name, view,
                                         '-clay' if args.get('clay') else '', column)
            bpy.context.scene.render.filepath = str((outdir / name).resolve())
            bpy.ops.render.render(write_still=True)
            entries.append(dict(frame=int(frame), seconds=round(frame / 30.0, 4),
                                file=name))
        manifest.append(dict(clip=action.name, view=view, loop=loop,
                             clay=bool(args.get('clay')),
                             frame_range=[start, end],
                             sampled_frames=[e['frame'] for e in entries],
                             terminal_frame_omitted=loop, frames=entries))
        rig.animation_data.action = None

    suffix = '-clay' if args.get('clay') else ''
    target = outdir / ('clip-frames-%s%s.json' % (view, suffix))
    target.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('WROTE', target)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
