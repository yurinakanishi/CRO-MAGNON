"""Author a grounded head tilt and tail lift on Candidate 1; replace only Happy.

This is a hand-authored affectionate gesture, not motion capture. The six other
clips (including r08 gallop/hiss), skin, materials and geometry retain their bytes.
"""
import argparse
import copy
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
import bpy

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
import blender_rig as base

ap = argparse.ArgumentParser()
ap.add_argument('--revision', default='10')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
workspace = ROOT / 'output/model-generation/models/rimo-neko'
source = workspace / 'work/rig/revision-08'
out = workspace / f'work/rig/revision-{args.revision}'
assert not (out / 'candidate.glb').exists(), 'Retain previous revisions'
out.mkdir(parents=True, exist_ok=True)
record = json.loads((source / 'process.json').read_text(encoding='utf8'))
bpy.ops.wm.open_mainfile(filepath=str(source / 'source.blend'))
rig = bpy.data.objects['RimoNekoArmature']
obj = bpy.data.objects['RimoNekoSurface']
for track in rig.animation_data.nla_tracks:
    track.mute = True
old = bpy.data.actions['Happy']
rig.animation_data.action = old
rig.animation_data.action_slot = old.slots[0]
bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()
neutral = {b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in rig.pose.bones}
idle = bpy.data.actions['Idle_Loop']
rig.animation_data.action = idle
rig.animation_data.action_slot = idle.slots[0]
bpy.context.scene.frame_set(1)
bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()
settled = {b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in rig.pose.bones}
rig.animation_data.action = None
bpy.data.actions.remove(old)
action = bpy.data.actions.new('Happy')
action.use_fake_user = True
rig.animation_data.action = action
rig.animation_data.action_slot = action.slots.new(id_type='OBJECT', name='Happy')
FPS, SECONDS = 240, 1.6
bpy.context.scene.render.fps = FPS
assert all(c.get('fps', 60) <= FPS for c in record['clips'])

def smooth(x):
    x = max(0, min(1, x))
    return x * x * (3 - 2 * x)

def envelope(t, start, peak, release, end):
    return smooth((t - start) / (peak - start)) * (1 - smooth((t - release) / (end - release)))

checks = []
for frame in range(round(SECONDS * FPS) + 1):
    t = frame / FPS
    tilt = envelope(t, .12, .56, .96, 1.6)
    lift = envelope(t, 0, .48, .90, 1.6)
    # Pause in the inquisitive pose, then ease gently back to the pet/idle seam.
    angles = {
        'Neck': dict(pitch=-6 * lift, roll=3 * tilt),
        'Head': dict(pitch=-3 * lift, roll=16 * tilt),
    }
    for i in range(5):
        delayed = envelope(t, .035 * i, .48 + .035 * i, .96, 1.6)
        angles[f'Tail{i+1}'] = dict(
            pitch=(24 if i == 0 else 3 if i < 3 else -2) * delayed,
            yaw=(2 + i * .5) * delayed * math.sin(t * 4 - i * .55),
        )
    for bone in rig.pose.bones:
        location, rotation = neutral[bone.name]
        end_location, end_rotation = settled[bone.name]
        settle = smooth((t - 1.15) / .45)
        bone.location = location.lerp(end_location, settle)
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = rotation.slerp(end_rotation, settle) @ base.world_axis_rotation(bone, **angles.get(bone.name, {}))
    bpy.context.view_layer.update()
    positions = base.evaluated_positions(obj)
    checks.append(dict(time=t, minimum=float(positions[:, 2].min()),
                       head=list(rig.pose.bones['Head'].head),
                       tailTip=list(rig.pose.bones['Tail5'].tail)))
    for bone in rig.pose.bones:
        bone.keyframe_insert(data_path='rotation_quaternion', frame=frame)
        bone.keyframe_insert(data_path='location', frame=frame)
base.set_interpolation(action, 'LINEAR')
action.use_frame_range = True
action.frame_start, action.frame_end = 0, round(SECONDS * FPS)
rig.animation_data.action = None
base.rest_pose(rig)
bpy.context.view_layer.update()
base.FPS = FPS
base.export(out / 'motion-export.glb', list(bpy.data.actions))
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'source.blend'))

def unpack(path):
    data = path.read_bytes()
    end = 20 + struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:end]), data[end + 8:]

original, oldbin = unpack(source / 'candidate.glb')
revised, newbin = unpack(out / 'motion-export.glb')
assert original['nodes'] == revised['nodes'], 'No rest-rig changes are permitted'
binary = bytearray(oldbin)
views, accessors = {}, {}

def copy_accessor(index):
    if index in accessors:
        return accessors[index]
    accessor = copy.deepcopy(revised['accessors'][index])
    view = accessor['bufferView']
    if view not in views:
        b = copy.deepcopy(revised['bufferViews'][view])
        offset = b.get('byteOffset', 0)
        while len(binary) % 4:
            binary.append(0)
        b['byteOffset'], b['buffer'] = len(binary), 0
        binary.extend(newbin[offset:offset + b['byteLength']])
        views[view] = len(original['bufferViews'])
        original['bufferViews'].append(b)
    accessor['bufferView'] = views[view]
    accessors[index] = len(original['accessors'])
    original['accessors'].append(accessor)
    return accessors[index]

new = copy.deepcopy(next(c for c in revised['animations'] if c['name'] == 'Happy'))
for sampler in new['samplers']:
    sampler['input'] = copy_accessor(sampler['input'])
    sampler['output'] = copy_accessor(sampler['output'])
original['animations'][next(i for i, c in enumerate(original['animations']) if c['name'] == 'Happy')] = new
original['buffers'][0]['byteLength'] = len(binary)
j = json.dumps(original, separators=(',', ':')).encode('utf8')
j += b' ' * (-len(j) % 4)
binary.extend(b'\0' * (-len(binary) % 4))
data = (struct.pack('<III', 0x46546c67, 2, 28 + len(j) + len(binary)) +
        struct.pack('<II', len(j), 0x4e4f534a) + j +
        struct.pack('<II', len(binary), 0x004e4942) + binary)
(out / 'candidate.glb').write_bytes(data)
record.update(revision=args.revision, parentRevision='08', parentSha256=record['sha256'],
              sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
              animationSource=str(source / 'source.blend'), changedClips=['Happy'],
              preserved='Same mesh, normals, UVs, materials, rest rig, skin weights and six other actions',
              happyGesture=dict(seconds=SECONDS, fps=FPS, headTiltDegrees=19,
                                tailBaseLiftDegrees=24, plantedPaws=True,
                                timingBasis='Hand-authored affectionate gesture; no motion capture'),
              checks=[dict(clip='Happy', minimum=min(c['minimum'] for c in checks), samples=checks)])
record['clips'] = [dict(c, seconds=SECONDS, fps=FPS) if c['name'] == 'Happy' else c for c in record['clips']]
(out / 'process.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
(out / 'rig-source.py').write_bytes(Path(__file__).read_bytes())
print('HAPPY_READY', record['sha256'], min(c['minimum'] for c in checks), flush=True)
