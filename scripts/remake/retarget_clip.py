"""Retarget authored clips from a delivered humanoid onto a re-rigged humanoid with the same bone names.

blender -b --python retarget_clip.py -- <source.glb> <target.glb> <out.glb> --clips Attack[,Other] [--report r.json]
For every source key: per bone, the world-space rotation change from the source rest pose is applied to the
target bone's own rest orientation (so different bone rolls and proportions keep the motion's direction), and the
Hips/Root translation change is scaled by the target/source hip-height ratio. Parents are solved before
children; the clip keeps the source key times. Existing target clips with the same name are replaced, all other
target clips, the skin and the mesh are exported unchanged (ACTIONS mode, same settings as rig_human_c2.py).
"""
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
src_path, tgt_path, out_path = argv[0], argv[1], argv[2]
clips = argv[argv.index('--clips') + 1].split(',')
report_path = argv[argv.index('--report') + 1] if '--report' in argv else str(Path(out_path).with_suffix('.json'))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def import_rig(path):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in scene.objects if o not in before]
    return next(o for o in new if o.type == 'ARMATURE'), new




def key_rate(*paths):
    """Densest keyframe rate of the clips (Hz, <= 240): the importer converts seconds to frames at the scene rate
    and the exporter samples whole frames, so this rate keeps every authored 120/240 Hz key of the target."""
    import struct
    import numpy as np
    best = 60.0
    for path in paths:
        data = Path(path).read_bytes()
        jlen = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20 + jlen])
        base = 20 + jlen + 8
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


def clip_key_frames(path, clip, rate):
    """Source key times of one clip, read from the GLB (layered Blender actions hide their F-curves), as frames."""
    import struct
    import numpy as np
    data = Path(path).read_bytes()
    jlen = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    base = 20 + jlen + 8
    an = next(a for a in doc['animations'] if a['name'] == clip)
    times = set()
    for smp in an['samplers']:
        a = doc['accessors'][smp['input']]
        v = doc['bufferViews'][a['bufferView']]
        t = np.frombuffer(data, np.float32, a['count'], base + v.get('byteOffset', 0) + a.get('byteOffset', 0))
        times |= {round(float(x) * rate, 4) for x in t}
    return sorted(times)


fps = key_rate(src_path, tgt_path)
scene.render.fps = fps
tgt, tgt_objs = import_rig(tgt_path)
tgt_actions = set(bpy.data.actions)
src, src_objs = import_rig(src_path)
src_actions = [a for a in bpy.data.actions if a not in tgt_actions]


def chain(arm):
    order, todo = [], [b for b in arm.data.bones if b.parent is None]
    while todo:
        b = todo.pop(0)
        order.append(b.name)
        todo += list(b.children)
    return order


names = [n for n in chain(tgt) if n in src.data.bones]
hips_src = (src.matrix_world @ src.data.bones['Hips'].head_local).z
hips_tgt = (tgt.matrix_world @ tgt.data.bones['Hips'].head_local).z
scale = hips_tgt / hips_src
done = []
renamed = []
for clip in clips:
    # The source imports second, so its clips arrive as 'Attack.001' when the target already has 'Attack'.
    act = next(a for a in src_actions if re.sub(r'\.\d{3}$', '', a.name.split('|')[-1]) == clip)
    src.animation_data_create()
    src.animation_data.action = act
    lo, hi = act.frame_range
    keys = clip_key_frames(src_path, clip, fps)
    old = next((a for a in bpy.data.actions if a in tgt_actions and a.name == clip), None)
    new = bpy.data.actions.new(clip)
    tgt.animation_data_create()
    tgt.animation_data.action = new
    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    src_rest = {n: (src.matrix_world @ src.data.bones[n].matrix_local).to_quaternion() for n in names}
    tgt_rest = {n: (tgt.matrix_world @ tgt.data.bones[n].matrix_local).to_quaternion() for n in names}
    tgt_world_q = tgt.matrix_world.to_quaternion()
    for f in keys:
        scene.frame_set(int(f), subframe=f - int(f))
        src_pose = {n: (src.matrix_world @ src.pose.bones[n].matrix) for n in names}
        for pb in tgt.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = Quaternion()
            pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        for n in names:
            pb = tgt.pose.bones[n]
            delta = src_pose[n].to_quaternion() @ src_rest[n].inverted()
            arm_q = tgt_world_q.inverted() @ (delta @ tgt_rest[n])
            pos = pb.matrix.translation.copy()
            if n in ('Root', 'Hips'):
                move = (src_pose[n].translation - (src.matrix_world @ src.data.bones[n].head_local)) * scale
                pos = (tgt.matrix_world.inverted() @ ((tgt.matrix_world @ tgt.data.bones[n].head_local) + move))
            pb.matrix = Matrix.LocRotScale(pos, arm_q, None)
            bpy.context.view_layer.update()
        for n in names:
            pb = tgt.pose.bones[n]
            pb.keyframe_insert('rotation_quaternion', frame=f, group=n)
            pb.keyframe_insert('location', frame=f, group=n)
    if old is not None:
        bpy.data.actions.remove(old)
    new.use_fake_user = True
    renamed.append((new, clip))
    done.append({'clip': clip, 'source_action': act.name, 'keys': len(keys), 'frames': [lo, hi]})
# Leave the target with no forced pose and drop the source rig before export.
tgt.animation_data.action = None
for pb in tgt.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = Quaternion()
    pb.scale = (1, 1, 1)
for o in src_objs:
    bpy.data.objects.remove(o, do_unlink=True)
for a in src_actions:
    bpy.data.actions.remove(a)
# Only now are the source clip names free: name the retargeted clips exactly (the game looks them up by name).
for action, clip in renamed:
    action.name = clip
    assert action.name == clip, action.name
for a in bpy.data.actions:
    a.use_fake_user = True
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False,
                          export_force_sampling=True, export_bake_animation=False, export_optimize_animation_size=False,
                          export_anim_slide_to_zero=False, export_def_bones=False, export_rest_position_armature=True,
                          export_influence_nb=4, export_tangents=True, export_image_format='WEBP', export_image_quality=92)
rep = {'source': src_path, 'target': tgt_path, 'output': out_path, 'hip_scale': scale, 'keyRateHz': fps, 'clips': done,
       'actions': sorted(a.name for a in bpy.data.actions),
       'method': 'per-bone world-space rotation delta from the source rest pose applied to the target rest orientation; Root/Hips translation scaled by hip height'}
Path(report_path).write_text(json.dumps(rep, indent=2), newline='\n')
print('RETARGET_DONE', json.dumps(rep))
