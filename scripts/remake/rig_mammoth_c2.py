"""Woolly mammoth Candidate 2 rig and clips (2026-10 remake), on the processed TRELLIS surface.

blender -b --python rig_mammoth_c2.py -- --source <candidate.glb> --out <dir> [--landmarks-only]

No visible geometry is added. Bones come from measured landmarks of the aligned surface
(gap-split foot clusters, traced leg columns, back midline, skull, trunk centreline and tail).
Planted feet use two-bone IK so stance feet do not slide; clips are in-place (the server moves
the body). Forward is Blender -Y (glTF +Z). The bone named 'Spine' carries the riding seat
(src/riding-pose.ts). Tusk vertices (ivory colour in the source albedo) ride the Head rigidly.
Game contract: Idle_Loop 4.0 s, Walk_Loop 2.4 s (0.354 m/s), Run_Loop 1.2 s (1.125 m/s),
Graze_Loop 5.0 s, Death 1.2 s held.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent / 'riglib'))
import blender_rig as base  # noqa: E402
import graph_tools as gt  # noqa: E402
import skin_weights as sw  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--source', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--landmarks-only', action='store_true')
ap.add_argument('--fps', type=int, default=30)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
FPS = args.fps

obj = base.import_mesh(args.source)
obj.name = 'WoollyMammoth'
obj.data.name = 'WoollyMammothMesh'
topology = base.weld_and_shade(obj, angle_degrees=48)
P = base.positions(obj.data)
F = base.mesh_triangles(obj.data)
H = float(np.ptp(P[:, 2]))
L = float(np.ptp(P[:, 1]))
Wd = float(np.ptp(P[:, 0]))
ymin, ymax = float(P[:, 1].min()), float(P[:, 1].max())

# ------------------------------------------------------------- albedo per vertex (tusk detection)
def vertex_albedo():
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    image = None
    for mat in mesh.materials:
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB':
                image = n.image
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    loops = np.empty(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get('vertex_index', loops)
    uvs = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    uv.foreach_get('uv', uvs)
    uvs = uvs.reshape(-1, 2)
    col = px[np.clip((uvs[:, 1] * (h - 1)).astype(int), 0, h - 1), np.clip((uvs[:, 0] * (w - 1)).astype(int), 0, w - 1), :3]
    acc = np.zeros((len(mesh.vertices), 3))
    cnt = np.zeros(len(mesh.vertices))
    np.add.at(acc, loops, col)
    np.add.at(cnt, loops, 1)
    return acc / np.maximum(cnt, 1)[:, None]

albedo = vertex_albedo()
lum = albedo @ np.array([.2126, .7152, .0722])
sat = albedo.max(1) - albedo.min(1)

# ------------------------------------------------------------- landmarks
def slice_top(y, half=.08):
    band = P[(np.abs(P[:, 1] - y) < half) & (np.abs(P[:, 0]) < .45)]
    if len(band) < 10:
        return 0.0, H
    top = band[band[:, 2] >= np.percentile(band[:, 2], 95)]
    return float(np.median(top[:, 0])), float(top[:, 2].max())
def midline(y, zmin=.55):
    return slice_top(y)[0]

low = P[P[:, 2] < .09]
feet = {}
for side, s in [('L', 1), ('R', -1)]:
    q = low[np.sign(low[:, 0]) == s]
    ys = np.sort(q[:, 1])
    cut = ys[int(np.argmax(np.diff(ys)))]
    for end, sel in [('F', q[:, 1] <= cut), ('B', q[:, 1] > cut)]:
        c = q[sel]
        feet[end + side] = dict(x=float(np.median(c[:, 0])), y=float(np.median(c[:, 1])),
                                toe=float(c[:, 1].min()), heel=float(c[:, 1].max()), n=int(len(c)))

def column(key, z):
    s = 1 if key[1] == 'L' else -1
    cur = np.array([feet[key]['x'], feet[key]['y']])
    for zz in np.linspace(.1, z, max(2, int(z / .05))):
        band = P[(np.abs(P[:, 2] - zz) < .04) & (np.sign(P[:, 0]) == s)]
        near = band[np.hypot(band[:, 0] - cur[0], band[:, 1] - cur[1]) < .38]
        if len(near) > 10:
            cur = .5 * cur + .5 * near[:, :2].mean(0)
    return [float(cur[0]), float(cur[1]), float(z)]

shoulderY = (feet['FL']['y'] + feet['FR']['y']) / 2
hipY = (feet['BL']['y'] + feet['BR']['y']) / 2
# Top profile: highest surface along the back.
def top_z(y):
    return slice_top(y)[1]
ivory = (lum > .46) & (sat < .38) & (P[:, 1] < shoulderY - .4) & (P[:, 2] > .2 * H)
# Erode isolated bright fur highlights: keep ivory vertices whose edge neighbours are mostly ivory.
_e = gt.unique_edges(F)
_n = np.zeros(len(P)); _i = np.zeros(len(P))
np.add.at(_n, _e[:, 0], 1); np.add.at(_n, _e[:, 1], 1)
np.add.at(_i, _e[:, 0], ivory[_e[:, 1]]); np.add.at(_i, _e[:, 1], ivory[_e[:, 0]])
ivory &= _i >= .6 * np.maximum(_n, 1)
front = P[(P[:, 1] < shoulderY - .3) & ~ivory]
skull_band = front[front[:, 2] > .78 * H]
skull_front = float(skull_band[:, 1].min()) if len(skull_band) else shoulderY - 1.2
# Trunk centreline: slices of the non-ivory front region near the midline, from the
# face down toward the tip; the curl at the tip turns forward.
trunk_pts = []
for z in np.linspace(.68 * H, .06 * H, 12):
    band = front[(np.abs(front[:, 2] - z) < .06) & (np.abs(front[:, 0]) < .35) & (front[:, 1] < skull_front + .5)]
    if len(band) > 15:
        tip = band[band[:, 1] < np.percentile(band[:, 1], 40)]
        trunk_pts.append([float(np.median(tip[:, 0])), float(np.median(tip[:, 1])), float(z)])
trunk_pts = np.array(trunk_pts)
tail_region = P[(P[:, 1] > ymax - .35) & (P[:, 2] > .25 * H)]
tail_tip = tail_region[np.argmax(tail_region[:, 1] - tail_region[:, 2] * .3)]
marks = dict(H=H, L=L, W=Wd, feet=feet, shoulderY=shoulderY, hipY=hipY, skullFront=skull_front,
             trunk=trunk_pts.tolist(), tailTip=tail_tip.tolist(), ivoryVertices=int(ivory.sum()),
             topProfile={f'{y:.2f}': top_z(y) for y in np.linspace(ymin + .3, ymax - .3, 11)})
(out / 'landmarks.json').write_text(json.dumps(marks, indent=2) + '\n')
print('LANDMARKS', json.dumps({k: marks[k] for k in ('H', 'L', 'W', 'shoulderY', 'hipY', 'skullFront', 'ivoryVertices')}), flush=True)
if args.landmarks_only:
    sys.exit(0)

# ------------------------------------------------------------- skeleton
mx = midline
withersZ = top_z(shoulderY) - .55
rumpZ = top_z(hipY) - .6
hipC = [mx(hipY + .1), hipY + .1, rumpZ]
midC = [mx((hipY + shoulderY) / 2), (hipY + shoulderY) / 2, (rumpZ + withersZ) / 2 + .05]
withersC = [mx(shoulderY), shoulderY, withersZ]
neckC = [mx(shoulderY - .55), shoulderY - .55, withersZ - .1]
headC = [0.0, skull_front + .55, .8 * H]
headTip = [0.0, skull_front + .05, .86 * H]
plan = [('Root', [0, 0, 0], [0, 0, .3], None, False),
        ('Hips', hipC, midC, 'Root', False),
        ('Spine', midC, withersC, 'Hips', False),
        ('Chest', withersC, neckC, 'Spine', False),
        ('Neck', neckC, headC, 'Chest', False),
        ('Head', headC, headTip, 'Neck', False)]
# Trunk chain: resample the measured centreline into four segments from its root.
tp = trunk_pts
seg = np.cumsum(np.r_[0, np.linalg.norm(np.diff(tp, axis=0), axis=1)])
knots = [np.array([np.interp(seg[-1] * f, seg, tp[:, k]) for k in range(3)]) for f in (0, .3, .55, .78, 1.0)]
for i in range(4):
    plan.append((f'Trunk{i + 1}', list(map(float, knots[i])), list(map(float, knots[i + 1])), 'Head' if i == 0 else f'Trunk{i}', False))
tailBase = [mx(ymax - .5), ymax - .55, rumpZ + .2]
tailMid = [(tailBase[0] + tail_tip[0]) / 2, (tailBase[1] + tail_tip[1]) / 2, (tailBase[2] + tail_tip[2]) / 2]
plan += [('Tail1', tailBase, tailMid, 'Hips', False), ('Tail2', tailMid, tail_tip.tolist(), 'Tail1', False)]
for side in 'LR':
    f, b = feet['F' + side], feet['B' + side]
    fx, fy, bx, by = f['x'], f['y'], b['x'], b['y']
    # Elephant limbs are near-vertical columns: joints sit above the measured foot pads.
    shoulder = [fx * .88, fy + .06, .56 * H]; elbow = [fx * .98, fy + .14, .36 * H]; wrist = [fx, fy + .02, .15 * H]
    scap = [fx * .5, fy + .3, .74 * H]
    plan += [('Shoulder.' + side, scap, shoulder, 'Chest', False),
             ('UpperArm.' + side, shoulder, elbow, 'Shoulder.' + side, False),
             ('LowerArm.' + side, elbow, wrist, 'UpperArm.' + side, False),
             ('Hand.' + side, wrist, [fx, f['toe'] + .08, .05], 'LowerArm.' + side, False)]
    hip = [bx * .86, by - .08, .56 * H]; knee = [bx * .98, by - .16, .34 * H]; hock = [bx, by + .06, .14 * H]
    plan += [('UpperLeg.' + side, hip, knee, 'Hips', False),
             ('LowerLeg.' + side, knee, hock, 'UpperLeg.' + side, False),
             ('Foot.' + side, hock, [bx, b['toe'] + .08, .05], 'LowerLeg.' + side, False)]
rig = base.build_armature(plan)
rig.name = 'MammothRig'
rig.data.name = 'MammothSkeleton'
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')
for g in list(obj.vertex_groups):
    obj.vertex_groups.remove(g)

# ------------------------------------------------------------- skin (solved in a tiger-sized frame)
K = 1.65 / H  # the solver's radii/thresholds were tuned on a 1.65 m quadruped
lut = {round(y, 2): mx(y) for y in np.arange(round(ymin, 2) - .01, ymax + .02, .01)}
Pm = P.copy()
Pm[:, 0] = P[:, 0] - np.array([lut.get(round(y, 2), 0.0) for y in P[:, 1]])
def straight(v):
    return [v[0] - lut.get(round(v[1], 2), 0.0), v[1], v[2]]
segments = [(bn.name, np.asarray(straight(bn.head_local)) * K, np.asarray(straight(bn.tail_local)) * K)
            for bn in rig.data.bones if bn.name != 'Root']
names = [s[0] for s in segments]
weights, report = sw.solve(Pm * K, F, segments, radius=.1, power=1.6, smooth_iterations=40, bridge_radius=.004,
                           side_keep_full=.03, side_fade_to=.09)
col = {n: i for i, n in enumerate(names)}
def move(mask, frm, to, amount=1.0):
    for i in frm:
        m = weights[:, col[i]] * mask * amount
        weights[:, col[i]] -= m
        weights[:, col[to]] += m
# Scapulae glide; the dorsal ridge between them belongs to the chest.
for side in 'LR':
    move(np.clip((P[:, 2] - .7 * H) / (.08 * H), 0, 1), ['Shoulder.' + side], 'Chest')
# Belly skirt and chest underside along the midline stay with the torso when legs stride.
limbs = [n for n in names if n.startswith(sw.LIMB_STEMS)]
mid_fade = (1 - np.clip((np.abs(Pm[:, 0]) - .12) / .2, 0, 1)) * np.clip((P[:, 2] - .25 * H) / (.06 * H), 0, 1)
torso = np.where(P[:, 1] < (shoulderY + hipY) / 2, col['Spine'], col['Hips'])
for n in limbs:
    m = weights[:, col[n]] * mid_fade
    weights[:, col[n]] -= m
    np.add.at(weights, (np.arange(len(P)), torso), m)
# Upper limb fur above the body line belongs to the torso (the fur mass is a shell, not a muscle).
body_line = np.clip((P[:, 2] - .6 * H) / (.08 * H), 0, 1)
for side in 'LR':
    move(body_line, ['UpperArm.' + side], 'Chest')
    move(body_line, ['UpperLeg.' + side], 'Hips')
# Tusks: rigid on the head (ivory colour in the source albedo, in front of the shoulders).
tusk = ivory.astype(float)
for n in names:
    if n != 'Head':
        m = weights[:, col[n]] * tusk
        weights[:, col[n]] -= m
        weights[:, col['Head']] += m
edges = gt.unique_edges(F)
near = gt.proximity_pairs(Pm * K, .012)
links = np.unique(np.sort(np.vstack([edges, near]), 1), axis=0)
starts, neighbours = gt.adjacency(len(P), links)
weights = sw.laplacian_smooth(weights, starts, neighbours, 24, .5)
# Re-impose rigid tusks after smoothing.
weights[ivory] = 0
weights[ivory, col['Head']] = 1
cutoff = np.sort(weights, axis=1)[:, -5]
weights = np.maximum(weights - cutoff[:, None], 0)
weights /= weights.sum(1)[:, None]
for c, n in enumerate(names):
    g = obj.vertex_groups.new(name=n)
    for i in np.nonzero(weights[:, c] > 1e-8)[0]:
        g.add([int(i)], float(weights[i, c]), 'REPLACE')
report.update(base.normalise_weights(obj, rig))
report['solveScale'] = K
report['tuskVertices'] = int(ivory.sum())

trunk_mask = weights[:, [col[f'Trunk{i}'] for i in range(1, 5)]].sum(1) > .5
# ------------------------------------------------------------- posing helpers
PB = rig.pose.bones
DB = rig.data.bones
for bpo in PB:
    bpo.rotation_mode = 'QUATERNION'
rest = {bn.name: bn.matrix_local.copy() for bn in DB}
def upd():
    bpy.context.view_layer.update()
def set_dir(bone, a, b):
    rb = DB[bone]
    qq = (rb.tail_local - rb.head_local).rotation_difference(b - a) @ rb.matrix_local.to_quaternion()
    PB[bone].matrix = Matrix.Translation(a) @ qq.to_matrix().to_4x4()
    upd()
def keep_rest_orientation(bone, at):
    PB[bone].matrix = Matrix.Translation(at) @ rest[bone].to_quaternion().to_matrix().to_4x4()
    upd()
LEGS = {'FL': ('UpperArm.L', 'LowerArm.L', 'Hand.L', Vector((0, 1, 0))),
        'FR': ('UpperArm.R', 'LowerArm.R', 'Hand.R', Vector((0, 1, 0))),
        'BL': ('UpperLeg.L', 'LowerLeg.L', 'Foot.L', Vector((0, -1, 0))),
        'BR': ('UpperLeg.R', 'LowerLeg.R', 'Foot.R', Vector((0, -1, 0)))}
neutral = {k: Vector((0, 0, 0)) for k in LEGS}
def solve_leg(k, disp, ik_report=None):
    up, lo, end, pole = LEGS[k]
    if k[0] == 'F':
        sh = 'Shoulder.' + k[1]
        PB[sh].rotation_quaternion = base.world_axis_rotation(PB[sh], pitch=max(-14, min(12, disp.y * 18)))
        upd()
    start = PB[up].head.copy()
    goal = rest[end].to_translation() + disp
    l1, l2 = DB[up].length, DB[lo].length
    axis = goal - start
    d = axis.length
    axis.normalize()
    reach = l1 + l2 - .004
    if d > reach:
        if ik_report is not None:
            ik_report[k]['maxShortfall'] = max(ik_report[k]['maxShortfall'], d - reach)
        goal = start + axis * reach
        d = reach
    d = max(abs(l1 - l2) + .004, d)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0, l1 * l1 - a * a))
    pv = pole - axis * pole.dot(axis)
    pv.normalize()
    joint = start + axis * a + pv * h
    set_dir(up, start, joint)
    set_dir(lo, joint, goal)
    keep_rest_orientation(end, goal)
def end_head(k):
    return PB[LEGS[k][2]].head.copy()
smooth = lambda t: (lambda u: u * u * (3 - 2 * u))(min(1, max(0, t)))
bell = lambda t: math.sin(math.pi * min(1, max(0, t)))
def gait(phase, duty, stride, lift):
    if phase < duty:
        return Vector((0, stride * (phase / duty - .5), 0))
    u = (phase - duty) / (1 - duty)
    return Vector((0, stride * (.5 - smooth(u)), lift * math.sin(math.pi * u)))
CLIPS = {}
def clip(name, seconds, loop=False):
    def wrap(fn):
        CLIPS[name] = (seconds, loop, fn)
        return fn
    return wrap
PLANT = lambda: {k: (neutral[k], 1.0) for k in LEGS}
def trunk(curl=0.0, swing=0.0, lift=0.0, phase=0.0):
    """Trunk chain: curl bends the tip forward/up, swing sways it sideways along the chain."""
    out_ = {}
    for i in range(4):
        lag = phase - i * .55
        out_[f'Trunk{i + 1}'] = {'pitch': -(curl * (i + 1) / 4 + lift * (1 if i == 0 else .3)), 'yaw': swing * math.sin(lag) * (.5 + i * .25)}
    return out_

@clip('Idle_Loop', 4.0, True)
def idle(t):
    u = t / 4.0 * 2 * math.pi
    pose = {'Hips': {'loc': (0, 0, .01 * math.sin(u)), 'roll': .6 * math.sin(u)}, 'Chest': {'pitch': .7 * math.sin(u)},
            'Neck': {'pitch': 1.2 * math.sin(u + .8), 'yaw': 2.5 * math.sin(u)}, 'Head': {'yaw': 2 * math.sin(u + .5)},
            'Tail1': {'yaw': 12 * math.sin(2 * u), 'pitch': -3}, 'Tail2': {'yaw': 16 * math.sin(2 * u - .9)}}
    pose.update(trunk(curl=6 + 6 * math.sin(u), swing=7, phase=u))
    return pose, PLANT()
WALK = dict(speed=.3541667, cycle=2.4, duty=.72, lift=.12)
@clip('Walk_Loop', WALK['cycle'], True)
def walk(t):
    c = WALK
    u = t / c['cycle']
    stride = c['speed'] * c['cycle'] * c['duty']
    offsets = {'BL': 0, 'FL': .22, 'BR': .5, 'FR': .72}  # lateral-sequence walk
    legs = {k: (neutral[k] + gait((u + o) % 1, c['duty'], stride, c['lift']), 1.0) for k, o in offsets.items()}
    w = 2 * math.pi * u
    pose = {'Hips': {'loc': (0, 0, -.03 + .015 * math.cos(2 * w)), 'roll': 1.2 * math.sin(w), 'yaw': 1.0 * math.sin(w)},
            'Chest': {'roll': -1.0 * math.sin(w + .4), 'yaw': -1.0 * math.sin(w)},
            'Neck': {'pitch': 1.5 * math.cos(2 * w + .5)}, 'Head': {'yaw': 2.5 * math.sin(w + .6)},
            'Tail1': {'yaw': 9 * math.sin(w), 'pitch': -4}, 'Tail2': {'yaw': 12 * math.sin(w - .8)}}
    pose.update(trunk(curl=8, swing=9, phase=w + .9))
    return pose, legs
RUN = dict(speed=1.125, cycle=1.2, duty=.58, lift=.2)
@clip('Run_Loop', RUN['cycle'], True)
def run(t):
    c = RUN
    u = t / c['cycle']
    stride = c['speed'] * c['cycle'] * c['duty']
    offsets = {'BL': 0, 'FL': .24, 'BR': .5, 'FR': .74}  # elephant amble: lateral sequence, no suspension
    legs = {k: (neutral[k] + gait((u + o) % 1, c['duty'], stride, c['lift']), 1.0) for k, o in offsets.items()}
    w = 2 * math.pi * u
    # Lateral roll stays small: the rider's seat rides on Spine (src/riding-pose.ts) and must not swing sideways.
    pose = {'Hips': {'loc': (0, 0, -.05 + .035 * math.cos(2 * w)), 'roll': 1.2 * math.sin(w), 'pitch': 1.5 * math.sin(2 * w)},
            'Spine': {'pitch': -1.5 * math.sin(2 * w + .5)}, 'Chest': {'roll': -1.0 * math.sin(w + .4), 'pitch': 1.2 * math.sin(2 * w + 1)},
            'Neck': {'pitch': 2.5 * math.cos(2 * w + .6)}, 'Head': {'pitch': -2, 'yaw': 3 * math.sin(w + .6)},
            'Tail1': {'yaw': 12 * math.sin(w), 'pitch': -10}, 'Tail2': {'yaw': 16 * math.sin(w - .8)}}
    pose.update(trunk(curl=14 + 4 * math.cos(2 * w), swing=12, phase=w + .9))
    return pose, legs
@clip('Graze_Loop', 5.0, True)
def graze(t):
    # Head lowers, the trunk reaches down, gathers grass in a curl and lifts it to the mouth twice.
    u = t / 5.0
    w = 2 * math.pi * u
    reach = .5 - .5 * math.cos(2 * w)  # two reaches per loop
    pose = {'Hips': {'loc': (0, 0, .005 * math.sin(w))}, 'Chest': {'pitch': 2},
            'Neck': {'pitch': 5 + 4 * reach}, 'Head': {'pitch': 4 + 4 * reach, 'yaw': 3 * math.sin(w)},
            'Tail1': {'yaw': 10 * math.sin(3 * w), 'pitch': -3}, 'Tail2': {'yaw': 14 * math.sin(3 * w - .8)}}
    curl = 10 + 70 * (1 - reach) ** 2  # straight to the ground, then curled up to the mouth
    pose.update(trunk(curl=curl, swing=4, lift=-8 * reach, phase=w))
    return pose, PLANT()
@clip('Death', 1.2)
def death(t):
    # Legs buckle (forelegs first) and fold under the body; it sinks onto its belly (sternal) with a slight lean,
    # head and trunk sag to the ground. Held at the end; the server then swaps in the meat.
    f = smooth(t / .55)            # forelegs fold
    h = smooth((t - .15) / .55)    # hind legs fold
    k = smooth(t / .9)             # body slump
    j = smooth((t - .4) / .7)      # head and trunk sag
    pose = {'Hips': {'pitch': -3 * f + 3 * h, 'loc': (0, 0, -1.6 * k), 'roll': 20 * j},
            'Chest': {'pitch': 5 * f, 'roll': 4 * j}, 'Neck': {'pitch': -4 * f + 8 * j, 'yaw': 8 * j}, 'Head': {'pitch': -6 * f + 6 * j, 'roll': 10 * j},
            'Tail1': {'pitch': 25 * j, 'yaw': 10 * j}, 'Tail2': {'pitch': 10 * j},
            'UpperArm.L': {'pitch': 35 * f}, 'UpperArm.R': {'pitch': 35 * f},
            'LowerArm.L': {'pitch': -105 * f}, 'LowerArm.R': {'pitch': -105 * f},
            'Hand.L': {'pitch': 40 * f}, 'Hand.R': {'pitch': 40 * f},
            'UpperLeg.L': {'pitch': -48 * h}, 'UpperLeg.R': {'pitch': -48 * h},
            'LowerLeg.L': {'pitch': 100 * h}, 'LowerLeg.R': {'pitch': 100 * h},
            'Foot.L': {'pitch': -35 * h}, 'Foot.R': {'pitch': -35 * h}}
    pose.update(trunk(curl=25 * j, swing=0, lift=-10 * j))
    return pose, {k2: (neutral[k2], 1 - min(1, 2 * (f if k2[0] == 'F' else h))) for k2 in LEGS}

# ------------------------------------------------------------- bake
actions, floor, clip_ik = [], [], {}
for name, (seconds, loop, fn) in CLIPS.items():
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, 'action_slot'):
        rig.animation_data.action_slot = action.slots.new(id_type='OBJECT', name=name)
    n = round(seconds * FPS)
    mins = []
    ik_report = {k: {'maxShortfall': 0.0} for k in LEGS}
    clip_ik[name] = ik_report
    for frame in range(n + 1):
        t = (frame % n if loop else frame) / FPS
        pose, legs = fn(t)
        for bone, spec in pose.items():
            if 'loc' in spec:
                spec['loc'] = tuple(rest[bone].to_3x3().inverted() @ Vector(spec['loc']))
        base.apply_pose(rig, pose)
        upd()
        for k, (disp, wgt) in legs.items():
            if wgt <= 1e-4:
                continue
            if wgt < 1:
                fk = end_head(k) - rest[LEGS[k][2]].to_translation()
                disp = fk.lerp(disp, wgt)
            solve_leg(k, disp, ik_report if wgt >= .999 else None)
        q = base.evaluated_positions(obj)
        # Trunk contact: curl the tip up until it rests on (not in) the ground.
        for _ in range(8):
            tlow = float(q[trunk_mask, 2].min())
            if tlow >= -.005:
                break
            for tb in ('Trunk3', 'Trunk4'):
                PB[tb].rotation_quaternion = base.world_axis_rotation(PB[tb], pitch=-5) @ PB[tb].rotation_quaternion
            upd()
            q = base.evaluated_positions(obj)
        low_ = float(q[~trunk_mask, 2].min())
        mins.append(low_)
        settle = name == 'Death'  # a falling body rests on the ground (two-way), others only never sink
        if low_ < -.003 or (settle and low_ > .004):
            inv = rest['Hips'].to_3x3().inverted()
            PB['Hips'].location += inv @ Vector((0, 0, -low_ + .002))
            upd()
        for bpo in PB:
            bpo.keyframe_insert(data_path='rotation_quaternion', frame=frame)
            bpo.keyframe_insert(data_path='location', frame=frame)
    base.set_interpolation(action, 'LINEAR')
    if hasattr(action, 'use_frame_range'):
        action.use_frame_range = True
        action.frame_start = 0
        action.frame_end = n
    floor.append({'clip': name, 'minimumBeforeLock': min(mins), 'maximumMinimum': max(mins)})
    actions.append(action)
    rig.animation_data.action = None
    base.rest_pose(rig)
    upd()
    print('CLIP_READY', name, json.dumps(floor[-1]), flush=True)
base.rest_pose(rig)
upd()
bpy.context.scene.render.fps = FPS
bpy.ops.object.select_all(action='SELECT')
glb = out / 'candidate.glb'
bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                          export_bake_animation=False, export_optimize_animation_size=False, export_anim_slide_to_zero=False,
                          export_def_bones=False, export_rest_position_armature=True, export_influence_nb=4,
                          export_tangents=True, export_image_format='WEBP', export_image_quality=92)
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'source.blend'), compress=True)
result = {'author': 'Claude Code (Opus 5.5)', 'claude_used': True, 'script': 'scripts/remake/rig_mammoth_c2.py',
          'source': str(args.source), 'sha256': hashlib.sha256(glb.read_bytes()).hexdigest(), 'bytes': glb.stat().st_size,
          'heightMetres': H, 'lengthMetres': L, 'widthMetres': Wd, 'triangles': int(len(F)), 'fps': FPS,
          'topology': topology, 'weights': report, 'bones': [p_[0] for p_ in plan], 'bonePlan': [[p_[0], list(p_[1]), list(p_[2]), p_[3]] for p_ in plan],
          'landmarks': marks, 'ikPlantedShortfall': clip_ik, 'groundCheck': floor,
          'clips': [{'name': n_, 'loop': c_[1], 'seconds': c_[0], 'rootMotion': 'in-place'} for n_, c_ in CLIPS.items()],
          'locomotion': {'Walk_Loop': {'metresPerSecond': WALK['speed'], 'cycleSeconds': WALK['cycle'], 'dutyFactor': WALK['duty'], 'strideMetres': WALK['speed'] * WALK['cycle']},
                         'Run_Loop': {'metresPerSecond': RUN['speed'], 'cycleSeconds': RUN['cycle'], 'dutyFactor': RUN['duty'], 'strideMetres': RUN['speed'] * RUN['cycle']}}}
(out / 'rig-report.json').write_text(json.dumps(result, indent=2) + '\n')
print('RIG_DONE', result['sha256'], json.dumps({c_: max(v['maxShortfall'] for v in r_.values()) for c_, r_ in clip_ik.items()}), flush=True)
