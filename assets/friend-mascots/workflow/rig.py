"""Rig one friend mascot's reduced TRELLIS surface and author its eight in-place clips.

blender -b --python rig.py -- --key saber-mascot --surface 01 --revision 01
Landmarks and optional chains come from assets/friend-mascots/<key>/rig.json, all as
fractions of the standing height H (x: +left of the character, z: up, y: +back).
Adapted from the Kohaku rig (assets/kohaku/workflow/rig.py): the same bone plan,
skin solver, leg IK gait and clip set, so every friend shares one renderer.
No surface is authored: only weights, bones and actions are added.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
sys.path.insert(0, str(ROOT / 'assets/rimo-neko/workflow/lib'))
import blender_reduce as reduce  # noqa: E402
import blender_rig as base  # noqa: E402
import skin_weights as sw  # noqa: E402
import graph_tools as gt  # noqa: E402
import clips_data as cd  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--key', required=True)
ap.add_argument('--surface', default='01')
ap.add_argument('--revision', default='01')
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
M = ROOT / 'output/model-generation/models' / a.key
surface = M / f'work/surface/revision-{a.surface}'
config = json.loads((ROOT / 'assets/friend-mascots' / a.key / 'rig.json').read_text(encoding='utf-8'))
record = json.loads((surface / 'surface.json').read_text())
H = record['heightMetres']
base.H = H
out = M / f'work/rig/revision-{a.revision}'
out.mkdir(parents=True, exist_ok=True)
assert not (out / 'candidate.glb').exists(), 'Keep every revision'
obj = base.import_mesh(surface / 'surface.glb')
reduce.weld(obj)
reduce.triangulate(obj)
obj.name = a.key
P = reduce.positions_of(obj.data)
F = reduce.face_array(obj.data)
L = config['landmarks']


def smooth(v):
    v = np.clip(v, 0, 1)
    return v * v * (3 - 2 * v)


def centre(z, xlimit=.115):
    q = P[(abs(P[:, 2] / H - z) < .012) & (abs(P[:, 0] / H) < xlimit)]
    return float((np.quantile(q[:, 1], .08) + np.quantile(q[:, 1], .92)) * .5) if len(q) else 0.


def pos(x, y, z):
    return [x * H, y * H, z * H]


marks = {name: [0, centre(L[name]), L[name] * H] for name in ['pelvis', 'spine', 'chest', 'neck', 'head', 'head_tip']}
for side, sign in [('L', 1), ('R', -1)]:
    for name in ['hip', 'knee', 'ankle', 'foot', 'toe']:
        x, z = L[name]
        q = P[(sign * P[:, 0] > .012 * H) & (abs(P[:, 0]) < (x + .07) * H) & (abs(P[:, 2] / H - z) < .012)]
        y = float((np.quantile(q[:, 1], .12) + np.quantile(q[:, 1], .88)) * .5) if len(q) else centre(L['pelvis'])
        if name == 'knee':
            y -= .012 * H
        if name == 'foot':
            y -= config.get('footForward', .032) * H
        if name == 'toe':
            y -= config.get('toeForward', .052) * H
        marks[name + '_' + side] = [sign * x * H, y, z * H]
    marks['shoulder_in_' + side] = [sign * L['shoulder_in'] * H, centre(L['chest']), L['shoulder'][1] * H]
    for name in ['shoulder', 'elbow', 'wrist', 'hand']:
        x, z = L[name]
        q = P[(abs(P[:, 0] / H - sign * x) < .04) & (abs(P[:, 2] / H - z) < .016) & (P[:, 1] < centre(L['chest']) + .06 * H)]
        y = float((np.quantile(q[:, 1], .1) + np.quantile(q[:, 1], .9)) * .5) if len(q) else centre(L['chest'])
        marks[name + '_' + side] = [sign * x * H, y, z * H]
plan = base.bone_plan(marks)
# Petting reaches the crown in front of the head's centre (a hat brim counts as the crown).
q = P[(abs(P[:, 0]) < .03 * H) & (P[:, 1] < centre(L['head']) + config.get('crownBack', 0.) * H)]
contact = q[np.argmax(q[:, 2])].copy()
plan.append(('PetContact', contact, contact + np.array([0, 0, .02 * H]), 'Head', False))
chains = []  # (bone names, region weight fn)
for side, sign in [('L', 1), ('R', -1)]:
    for ear in config.get('ears', []):
        bx, bz = ear['base']
        tx, tz = ear['tip']
        plan.append(('Ear.' + side, [sign * bx * H, centre(bz), bz * H], [sign * tx * H, centre(min(tz, .95)), tz * H], 'Head', False))
    if config.get('skirt'):
        sk = config['skirt']
        for region, depth in [('Front', -sk.get('depth', .075)), ('Back', sk.get('depth', .07))]:
            plan.append(('Skirt' + region + '.' + side, pos(sign * sk.get('x', .065), depth, sk['top']),
                         pos(sign * sk.get('hemX', .15), depth, sk['hem']), 'Hips', False))
tail_points = None
if config.get('tail'):
    t = config['tail']
    tail_points = [pos(*p) for p in t['points']]
    for i in range(len(tail_points) - 1):
        plan.append((f'Tail{i + 1}', tail_points[i], tail_points[i + 1], 'Hips' if i == 0 else f'Tail{i}', False))
if config.get('hairBack'):
    hb = config['hairBack']
    pts = [pos(*p) for p in hb['points']]
    for i in range(len(pts) - 1):
        plan.append((f'HairBack{i + 1}', pts[i], pts[i + 1], 'Head' if i == 0 else f'HairBack{i}', False))
rig = base.build_armature(plan)
rig.name = a.key + 'Rig'
rig.data.name = a.key + 'Skeleton'
segments = [(b.name, np.array(b.head_local), np.array(b.tail_local)) for b in rig.data.bones if b.name not in ['Root', 'PetContact']]
names = [s[0] for s in segments]
W, weight_report = sw.solve(P, F, segments, radius=.032, smooth_iterations=18, core_floor=.003,
                            bridge_radius=.0012, side_keep_full=.008, side_fade_to=.02)


def target(name):
    result = np.zeros_like(W)
    result[:, names.index(name)] = 1
    return result


def blend(field, factor):
    global W
    W = W * (1 - factor[:, None]) + field * factor[:, None]


z = P[:, 2] / H
x = P[:, 0] / H
# Head, face, hat and the upper hair stay rigid above the neck.
blend(target('Head'), smooth((z - config['headRigidZ']) / .025))
arm_distance = np.full(len(P), np.inf)
for side in ['L', 'R']:
    for first, last in [('shoulder', 'elbow'), ('elbow', 'wrist'), ('wrist', 'hand')]:
        start = np.array(marks[first + '_' + side])
        axis = np.array(marks[last + '_' + side]) - start
        t = np.clip(((P - start) @ axis) / (axis @ axis), 0, 1)
        arm_distance = np.minimum(arm_distance, np.linalg.norm(P - (start + t[:, None] * axis), axis=1))
AG = config['armGate']


def arm_field(side, sign):
    along = sign * x
    elbow = smooth((along - L['elbow'][0] + .02) / .04)
    wrist = smooth((along - L['wrist'][0] + .016) / .032)
    return (target('UpperArm.' + side) * (1 - elbow)[:, None] + target('LowerArm.' + side) * (elbow * (1 - wrist))[:, None]
            + target('Hand.' + side) * (elbow * wrist)[:, None])


def arm_gate(sign):
    return (smooth((sign * x - AG['x']) / .055) * smooth((z - AG['zLow']) / .03) * (1 - smooth((z - AG['zHigh']) / .032))
            * (1 - smooth((arm_distance / H - AG.get('radius', .05)) / .025)))


for side, sign in [('L', 1), ('R', -1)]:
    for ear in config.get('ears', []):
        e = smooth((z - ear['base'][1]) / .06) * smooth((sign * x - ear['base'][0] + .03) / .06)
        blend(target('Ear.' + side), e * .8)
    blend(arm_field(side, sign), arm_gate(sign))
tail_weight = np.zeros(len(P))
if tail_points:
    cols = [names.index(f'Tail{i + 1}') for i in range(len(tail_points) - 1)]
    tail_weight = W[:, cols].sum(1)
for zone in config.get('rigidZones', []):
    x0, x1, y0, y1, z0, z1 = zone['box']
    inside = ((x >= x0) & (x <= x1) & (P[:, 1] / H >= y0) & (P[:, 1] / H <= y1) & (z >= z0) & (z <= z1)).astype(float)
    blend(target(zone['bone']), inside * zone.get('strength', 1.))
if config.get('skirt'):
    sk = config['skirt']
    skirt = smooth((z - sk['hem'] + .03) / .035) * (1 - smooth((z - sk['top']) / .035)) * smooth((arm_distance / H - .045) / .035) * (1 - tail_weight)
    left = smooth(.5 + P[:, 0] / (.055 * H))
    front = smooth(.5 - (P[:, 1] - centre((sk['top'] + sk['hem']) / 2)) / (.10 * H))
    field = np.zeros_like(W)
    for side, factor in [('L', left), ('R', 1 - left)]:
        for region, depth in [('Front', front), ('Back', 1 - front)]:
            field[:, names.index('Skirt' + region + '.' + side)] = factor * depth
    lower = smooth((sk['top'] + .01 - z) / .14)
    blend(field * lower[:, None] + target('Hips') * (1 - lower[:, None]), skirt)
LG = config['legGate']
for side, sign in [('L', 1), ('R', -1)]:
    knee = smooth((z - L['knee'][1] + .035) / .075)
    ankle = 1 - smooth((z - L['ankle'][1] + .017) / .047)
    field = (target('UpperLeg.' + side) * knee[:, None] + target('LowerLeg.' + side) * ((1 - knee) * (1 - ankle))[:, None]
             + target('Foot.' + side) * ((1 - knee) * ankle)[:, None])
    gate = (sign * P[:, 0] > 0) * (1 - smooth((z - LG['zTop']) / .035)) * (1 - smooth((abs(x) - LG['xMax']) / .035)) * (1 - tail_weight)
    blend(field, gate)
edges = gt.unique_edges(F)
starts, neighbours = gt.adjacency(len(P), edges)
W = sw.laplacian_smooth(W, starts, neighbours, 10, .3)
for side, sign in [('L', 1), ('R', -1)]:
    blend(arm_field(side, sign), arm_gate(sign))
for zone in config.get('rigidZones', []):
    if zone.get('afterSmooth'):
        x0, x1, y0, y1, z0, z1 = zone['box']
        inside = ((x >= x0) & (x <= x1) & (P[:, 1] / H >= y0) & (P[:, 1] / H <= y1) & (z >= z0) & (z <= z1)).astype(float)
        blend(target(zone['bone']), inside * zone.get('strength', 1.))
if config.get('armless'):
    # No free arms in this reconstruction (e.g. wings folded into the body): the shared
    # clips still key the arm bones, but no skin follows them.
    chest = names.index('Chest')
    for col, name in enumerate(names):
        if name.split('.')[0] in ('Shoulder', 'UpperArm', 'LowerArm', 'Hand'):
            W[:, chest] += W[:, col]
            W[:, col] = 0
keep = np.argsort(-W, axis=1)[:, :4]
clipped = np.zeros_like(W)
rows = np.arange(len(P))[:, None]
clipped[rows, keep] = W[rows, keep]
W = clipped
W[W < 1e-5] = 0
W /= W.sum(1)[:, None]
for col, name in enumerate(names):
    group = obj.vertex_groups.new(name=name)
    for index in np.flatnonzero(W[:, col] > 0):
        group.add([int(index)], float(W[index, col]), 'REPLACE')
modifier = obj.modifiers.new(a.key + 'Skin', 'ARMATURE')
modifier.object = rig
obj.parent = rig
np.savez_compressed(out / 'rig-surface.npz', positions=P, faces=F, weights=W, bones=np.array(names))
solvers = {side: cd.LegSolver(marks['hip_' + side], marks['knee_' + side], marks['ankle_' + side]) for side in ['L', 'R']}
reach = min(s.rest_reach for s in solvers.values())
walk = cd.walk_gait(reach)
run = cd.run_gait(reach)
FPS = 60
ARM_REST = config.get('armRest', 36)
bpy.context.scene.render.fps = FPS
rig.animation_data_create()
clips = [('Idle_Loop', 3., True), ('Walk_Loop', .72, True), ('Run_Loop', .40, True), ('Pet', 1.4, False),
         ('Happy', 1.4, False), ('Hit', .65, False), ('Wave', 1.8, False), ('Bow', 1.6, False)]
clip_records = []
sole = (P[:, 2] < .08 * H) & (abs(P[:, 0]) < LG['xMax'] * H)
n_tail = len(tail_points) - 1 if tail_points else 0
n_hair = len(config['hairBack']['points']) - 1 if config.get('hairBack') else 0
lowest = []
for name, duration, loop in clips:
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    count = round(duration * FPS)
    for frame in range(count + 1):
        u = 0 if loop and frame == count else frame / count
        p = u * math.tau
        e = math.sin(math.pi * u) ** 2
        pose = {'Spine': {'pitch': 0}, 'Head': {'roll': 1.1 * math.sin(p)}, 'Hips': {}}
        for side, sign in [('L', 1), ('R', -1)]:
            pose['UpperArm.' + side] = {'roll': sign * ARM_REST}
            pose['LowerArm.' + side] = {'pitch': -4}
            if config.get('ears'):
                pose['Ear.' + side] = {'roll': sign * 2 * math.sin(p - .5)}
            if config.get('skirt'):
                for region in ['Front', 'Back']:
                    pose['Skirt' + region + '.' + side] = {'roll': sign * 1.2 * math.sin(p - .4)}
        for i in range(n_tail):
            pose[f'Tail{i + 1}'] = {'yaw': 2.5 * math.sin(p - i * .42), 'pitch': 1.4 * math.sin(p - i * .35)}
        for i in range(n_hair):
            pose[f'HairBack{i + 1}'] = {'pitch': .8 * math.sin(p - i * .5)}
        hop = 0.
        if name in ['Walk_Loop', 'Run_Loop']:
            gait = walk if name == 'Walk_Loop' else run
            for side, offset in [('L', 0), ('R', .5)]:
                phase = (u + offset) % 1
                forward, drop = gait.target(phase)
                angles = solvers[side].solve(forward, drop)
                foot = gait.foot_pitch(phase, angles['upper'], angles['lower'])
                for stem, value in [('UpperLeg', angles['upper']), ('LowerLeg', angles['lower']), ('Foot', foot),
                                    ('Toe', gait.toe_pitch(phase, angles['upper'], angles['lower'], foot))]:
                    pose[stem + '.' + side] = {'pitch': value}
                pose['UpperArm.' + side] = {'pitch': (17 if name == 'Walk_Loop' else 29) * math.sin(phase * math.tau),
                                            'roll': (1 if side == 'L' else -1) * ARM_REST}
                pose['LowerArm.' + side] = {'pitch': -14 if name == 'Walk_Loop' else -35}
                if config.get('skirt'):
                    for region in ['Front', 'Back']:
                        pose['Skirt' + region + '.' + side] = {'pitch': angles['upper'] * .20}
            pose['Chest'] = {'yaw': 2.5 * math.sin(p), 'pitch': 4 if name == 'Run_Loop' else 1}
            pose['Head'] = {'yaw': -1.5 * math.sin(p), 'pitch': -2 if name == 'Run_Loop' else 0}
            for i in range(n_hair):
                pose[f'HairBack{i + 1}'] = {'pitch': (3 if name == 'Run_Loop' else 1.5) * (1 + math.sin(p * 2 - i * .6))}
            if name == 'Run_Loop':
                hop = .009 * math.sin(p) ** 2
        elif name == 'Pet':
            pose['Head'] = {'roll': -8 * e, 'pitch': 3 * e}
            pose['Chest'] = {'pitch': 4 * e}
            for side, sign in [('L', 1), ('R', -1)]:
                pose['UpperArm.' + side] = {'roll': sign * (ARM_REST + 3 * e), 'pitch': -12 * e}
        elif name == 'Happy':
            hop = .025 * math.sin(p) ** 2 * math.sin(math.pi * u)
            pose['Head'] = {'roll': 7 * math.sin(p) * e}
            for side, sign in [('L', 1), ('R', -1)]:
                pose['UpperArm.' + side] = {'roll': sign * (ARM_REST - 42 * e), 'pitch': -15 * e}
                pose['LowerArm.' + side] = {'pitch': -35 * e}
                if config.get('ears'):
                    pose['Ear.' + side] = {'roll': -sign * 7 * e}
        elif name == 'Hit':
            pose['Chest'] = {'pitch': -8 * e}
            pose['Head'] = {'pitch': -7 * e}
            hop = .008 * e
            for side, sign in [('L', 1), ('R', -1)]:
                pose['UpperArm.' + side] = {'pitch': -28 * e, 'roll': sign * (ARM_REST - 12 * e)}
        elif name == 'Wave':
            pose['UpperArm.R'] = {'roll': -ARM_REST + (ARM_REST + 15) * e, 'pitch': -18 * e}
            pose['LowerArm.R'] = {'pitch': -55 * e, 'roll': 12 * math.sin(p * 3) * e}
            pose['Hand.R'] = {'roll': 15 * math.sin(p * 3) * e}
            pose['Head'] = {'roll': 4 * e}
        elif name == 'Bow':
            pose['Chest'] = {'pitch': 19 * e}
            pose['Head'] = {'pitch': 10 * e}
            for side, sign in [('L', 1), ('R', -1)]:
                pose['UpperArm.' + side] = {'roll': sign * (ARM_REST + 5 * e), 'pitch': -17 * e}
                pose['LowerArm.' + side] = {'pitch': -24 * e}
        base.apply_pose(rig, pose)
        bpy.context.view_layer.update()
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        q = reduce.positions_of(mesh)
        evaluated.to_mesh_clear()
        lift = hop + .001 - float(q[sole, 2].min())
        rig.pose.bones['Hips'].location = rig.pose.bones['Hips'].bone.matrix_local.to_3x3().inverted() @ Vector((0, 0, lift))
        lowest.append(float(q[:, 2].min() + lift))
        for bone in rig.pose.bones:
            bone.keyframe_insert('location', frame=frame)
            bone.keyframe_insert('rotation_quaternion', frame=frame)
    base.set_interpolation(action, 'LINEAR')
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = count
    rig.animation_data.action = None
    clip_records.append(dict(name=name, seconds=count / FPS, loop=loop, fps=FPS, rootMotion='in-place'))
    print('AUTHORED', name, flush=True)
base.apply_pose(rig, {})
bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
obj.select_set(True)
bpy.context.view_layer.objects.active = rig
options = dict(filepath=str(out / 'candidate.glb'), export_format='GLB', use_selection=True, export_animations=True,
               export_yup=True, export_animation_mode='ACTIONS', export_nla_strips=True, export_frame_range=False,
               export_force_sampling=True, export_anim_single_armature=True, export_skins=True, export_def_bones=False,
               export_optimize_animation_size=False)
supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
bpy.ops.export_scene.gltf(**{k: v for k, v in options.items() if k in supported})
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'source.blend'))
near_tree = reduce.bvh_from_arrays(P, F)
near_samples = reduce.sample_surface(P, F, 14000, 77)
trials = []
lod = None
for ratio in [.2, .3, .45, .6, .8, 1.0]:
    trial = obj.copy()
    trial.data = obj.data.copy()
    bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT')
    trial.select_set(True)
    bpy.context.view_layer.objects.active = trial
    mod = trial.modifiers.new('SourceLOD', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    while trial.modifiers.find(mod.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    trial.data.validate(clean_customdata=False)
    reduce.triangulate(trial)
    Lp = reduce.positions_of(trial.data)
    T = reduce.face_array(trial.data)
    forward = reduce.deviation(near_samples, reduce.bvh_from_arrays(Lp, T), H)
    reverse = reduce.deviation(reduce.sample_surface(Lp, T, 14000, 78), near_tree, H)
    # Shown only beyond 8 m on a 0.52 m figure: allow spiky hair tips a 2 cm worst case.
    passed = max(forward['p95_units'], reverse['p95_units']) < H * .006 and max(forward['max_units'], reverse['max_units']) < H * .04
    trials.append(dict(ratio=ratio, triangles=len(T), forward=forward, reverse=reverse, passed=passed))
    if passed:
        lod = trial
        break
    mesh = trial.data
    bpy.data.objects.remove(trial, do_unlink=True)
    bpy.data.meshes.remove(mesh)
assert lod is not None
bpy.data.objects.remove(obj, do_unlink=True)
lod.name = a.key
for index, material in enumerate(lod.data.materials):
    lod.data.materials[index] = bpy.data.materials.new('LODGeometrySlot_' + material.name)
bpy.ops.object.select_all(action='DESELECT')
lod.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out / 'lod.glb'), export_format='GLB', use_selection=True,
                          export_animations=False, export_yup=True, export_skins=True, export_def_bones=False)
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
record.update(revision=a.revision, surfaceRevision=a.surface, modelKey=a.key, sha256=sha(out / 'candidate.glb'),
              bytes=(out / 'candidate.glb').stat().st_size, bones=[b[0] for b in plan], landmarks=marks,
              config=config, petContactBlender=contact.tolist(), petContactHeight=float(contact[2]),
              weights=weight_report, clips=clip_records,
              lowestAuthoredVertexMetres=min(lowest),
              lod=dict(sha256=sha(out / 'lod.glb'), triangles=len(lod.data.polygons), trials=trials, distanceMetres=8,
                       originalRig=True),
              locomotion={'Walk_Loop': dict(metresPerSecond=walk.stride() / .72, cycleSeconds=.72),
                          'Run_Loop': dict(metresPerSecond=run.stride() / .40, cycleSeconds=.40)},
              blender=bpy.app.version_string)
(out / 'rig.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(dict(path=str(out), triangles=len(F), bones=len(plan), clips=len(clips), lowest=min(lowest))), flush=True)
