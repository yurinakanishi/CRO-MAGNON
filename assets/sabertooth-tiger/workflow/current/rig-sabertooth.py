"""Body-specific quadruped rig and clips for the retained TRELLIS sabertooth surface.

No visible geometry is added. Bones are placed from measured landmarks of the
aligned surface (gap-split paw clusters, traced leg columns, a measured back
midline, head and tail extremes). Planted paws are solved with two-bone IK so
stance feet do not slide; the paw (front) and metatarsus (hind) keep their rest
orientation. Forward is Blender -Y (glTF +Z). Root never moves (in-place clips);
the pounce and step heights are baked as Hips translation, the server moves the
body horizontally.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, Matrix, Quaternion

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
M = ROOT/'output/model-generation/models/sabertooth-tiger'
sys.path.insert(0, str(M/'workflow/candidate-01'))
import blender_rig as base, skin_weights as sw, graph_tools as gt
ap = argparse.ArgumentParser(); ap.add_argument('--revision', default='01'); ap.add_argument('--source', default='02')
ap.add_argument('--landmarks-only', action='store_true')
args = ap.parse_args(sys.argv[sys.argv.index('--')+1:])
out = M/f'work/rig/revision-{args.revision}'; out.mkdir(parents=True, exist_ok=True)
source = M/f'work/low-poly/revision-{args.source}/candidate.glb'
obj = base.import_mesh(source); topology = base.weld_and_shade(obj, angle_degrees=50)
obj.name = 'SabertoothSurface'; P = base.positions(obj.data); F = base.mesh_triangles(obj.data)
H = float(np.ptp(P[:, 2])); L = float(np.ptp(P[:, 1])); W = float(np.ptp(P[:, 0])); base.H = H
ymin, ymax = float(P[:, 1].min()), float(P[:, 1].max())
# 60 fps keys: fast IK legs interpolate poorly at 30 fps (mid-frame paw dips).
FPS = 60

# ---------------------------------------------------------------- landmarks
def midline(y):
    band = P[(np.abs(P[:, 1]-y) < .05) & (P[:, 2] > .55*H)]
    return float((band[:, 0].min()+band[:, 0].max())/2) if len(band) > 20 else 0.0
low = P[P[:, 2] < .075]
paws = {}
for side, s in [('L', 1), ('R', -1)]:
    q = low[np.sign(low[:, 0]) == s]; ys = np.sort(q[:, 1]); cut = ys[int(np.argmax(np.diff(ys)))]
    for end, sel in [('F', q[:, 1] <= cut), ('B', q[:, 1] > cut)]:
        c = q[sel]; paws[end+side] = dict(x=float(c[:, 0].mean()), y=float(c[:, 1].mean()), toe=float(c[:, 1].min()), heel=float(c[:, 1].max()))
def column(key, z):
    """Leg centre at height z, traced upward from the paw through thin bands."""
    s = 1 if key[1] == 'L' else -1; cur = np.array([paws[key]['x'], paws[key]['y']])
    for zz in np.linspace(.08, z, max(2, int(z/.03))):
        band = P[(np.abs(P[:, 2]-zz) < .025) & (np.sign(P[:, 0]-midline(cur[1])*.5) == s)]
        near = band[np.hypot(band[:, 0]-cur[0], band[:, 1]-cur[1]) < .2]
        if len(near) > 8: cur = .4*cur + .6*near[:, :2].mean(0)
    return [float(cur[0]), float(cur[1]), float(z)]
front = P[P[:, 1] < ymin + .12*L]; nose = front[np.argmin(front[:, 1])]
tailRegion = P[P[:, 1] > ymax - .12*L]; tailTip = tailRegion[np.argmax(tailRegion[:, 1])]
shoulderY = (paws['FL']['y']+paws['FR']['y'])/2; hipY = (paws['BL']['y']+paws['BR']['y'])/2
marks = dict(H=H, L=L, W=W, paws=paws, nose=nose.tolist(), tailTip=tailTip.tolist(), shoulderY=shoulderY, hipY=hipY,
             midline={f'{y:.2f}': midline(y) for y in np.linspace(ymin+.2, ymax-.2, 9)})
(out/'landmarks.json').write_text(json.dumps(marks, indent=2)+'\n')
print('LANDMARKS', json.dumps(marks), flush=True)
if args.landmarks_only: sys.exit(0)

# ---------------------------------------------------------------- skeleton
mx = lambda y: midline(y)
S = (0, 0, 0)
hipC = [mx(hipY), hipY-.05, .88]; midC = [mx(.1), .1, .9]; chestC = [mx(shoulderY+.1), shoulderY+.1, .95]
neckC = [mx(shoulderY-.12), shoulderY-.12, 1.1]; headC = [float(nose[0])*.5+mx(-1)*.5, nose[1]+.33, 1.26]
plan = [('Root', [0, 0, 0], [0, 0, .12], None, False),
        ('Hips', hipC, midC, 'Root', False),
        ('Spine', midC, chestC, 'Hips', False),
        ('Chest', chestC, neckC, 'Spine', False),
        ('Neck', neckC, headC, 'Chest', False),
        # No jaw: the reconstructed mouth is closed and the sabers hang in front of
        # the chin, so a jaw bone would only stretch skin and bend the sabers.
        ('Head', headC, [float(nose[0]), float(nose[1])+.02, float(nose[2])], 'Neck', False)]
tailBase = [mx(ymax-.32), ymax-.32, float(tailTip[2])-.02]
tailMid = [(tailBase[0]+tailTip[0])/2, (tailBase[1]+tailTip[1])/2, (tailBase[2]+tailTip[2])/2]
plan += [('Tail1', tailBase, tailMid, 'Hips', False), ('Tail2', tailMid, tailTip.tolist(), 'Tail1', False)]
for side in 'LR':
    f, b = paws['F'+side], paws['B'+side]
    wrist = column('F'+side, .16); elbow = column('F'+side, .5); elbow[1] += .07
    shoulder = column('F'+side, .8); shoulder[0] = shoulder[0]*.85
    scap = [shoulder[0]*.55, shoulder[1]+.12, 1.15]
    plan += [('Shoulder.'+side, scap, shoulder, 'Chest', False), ('UpperArm.'+side, shoulder, elbow, 'Shoulder.'+side, False),
             ('LowerArm.'+side, elbow, wrist, 'UpperArm.'+side, False), ('Hand.'+side, wrist, [f['x'], f['toe']+.05, .035], 'LowerArm.'+side, False)]
    hock = column('B'+side, .3); hock[1] += .06; knee = column('B'+side, .56); knee[1] -= .1
    hip = column('B'+side, .86); hip[0] *= .8
    ball = [b['x'], b['y']-.02, .05]
    plan += [('UpperLeg.'+side, hip, knee, 'Hips', False), ('LowerLeg.'+side, knee, hock, 'UpperLeg.'+side, False),
             ('Foot.'+side, hock, ball, 'LowerLeg.'+side, False), ('Toe.'+side, ball, [b['x'], b['toe']+.04, .03], 'Foot.'+side, False)]
rig = base.build_armature(plan); rig.data.name = 'SabertoothQuadrupedRig'
bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')
for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
# Skin in a midline-straightened frame so the side gate splits the curved body correctly.
Pm = P.copy()
lut = {round(y, 2): mx(y) for y in np.arange(round(ymin, 2)-.01, ymax+.02, .01)}
Pm[:, 0] = P[:, 0] - np.array([lut.get(round(y, 2), 0.0) for y in P[:, 1]])
def straight(v): return [v[0]-lut.get(round(v[1], 2), 0.0), v[1], v[2]]
segments = [(b.name, np.asarray(straight(b.head_local)), np.asarray(straight(b.tail_local))) for b in rig.data.bones if b.name != 'Root']
names = [s[0] for s in segments]
weights, report = sw.solve(Pm, F, segments, radius=.1, power=1.6, smooth_iterations=40, bridge_radius=.004, side_keep_full=.03, side_fade_to=.09)
# The scapulae glide under the skin; the dorsal ridge between them belongs to the chest.
ci = names.index('Chest')
for side in 'LR':
    si = names.index('Shoulder.'+side); moved = weights[:, si]*np.clip((P[:, 2]-.98)/.12, 0, 1)
    weights[:, si] -= moved; weights[:, ci] += moved
# Legs stride far under IK; the belly and chest underside along the midline stay
# with the torso so they do not tear between opposite legs.
limbs = [i for i, n in enumerate(names) if n.startswith(sw.LIMB_STEMS)]
midlineFade = 1-np.clip((np.abs(Pm[:, 0])-.07)/.1, 0, 1)*1.0
midlineFade *= np.clip((P[:, 2]-.3)/.1, 0, 1)
torso = np.where(P[:, 1] < .3, names.index('Spine'), names.index('Hips'))
for i in limbs:
    moved = weights[:, i]*midlineFade; weights[:, i] -= moved
    np.add.at(weights, (np.arange(len(P)), torso), moved)
# Fur strands and mane tufts are separate shells; smooth across spatially adjacent
# vertices too, so touching strands never take opposite bones.
edges = gt.unique_edges(F); near = gt.proximity_pairs(P, .012)
links = np.unique(np.sort(np.vstack([edges, near]), 1), axis=0)
starts, neighbours = gt.adjacency(len(P), links)
weights = sw.laplacian_smooth(weights, starts, neighbours, 36, .5)
report['proximitySmoothing'] = {'radiusMetres': .012, 'extraPairs': int(len(near)), 'iterations': 36}
cutoff = np.sort(weights, axis=1)[:, -5]; weights = np.maximum(weights-cutoff[:, None], 0); weights /= weights.sum(1)[:, None]
for col, name in enumerate(names):
    group = obj.vertex_groups.new(name=name)
    idx = np.nonzero(weights[:, col] > 1e-8)[0]
    for i in idx: group.add([int(i)], float(weights[i, col]), 'REPLACE')
report.update(base.normalise_weights(obj, rig))

# ---------------------------------------------------------------- posing helpers
PB = rig.pose.bones; DB = rig.data.bones
for b in PB: b.rotation_mode = 'QUATERNION'
rest = {b.name: b.matrix_local.copy() for b in DB}
def upd(): bpy.context.view_layer.update()
def set_dir(bone, a, b):
    rb = DB[bone]; q = (rb.tail_local-rb.head_local).rotation_difference(b-a) @ rb.matrix_local.to_quaternion()
    PB[bone].matrix = Matrix.Translation(a) @ q.to_matrix().to_4x4(); upd()
def keep_rest_orientation(bone, at):
    PB[bone].matrix = Matrix.Translation(at) @ rest[bone].to_quaternion().to_matrix().to_4x4(); upd()
LEGS = {'FL': ('UpperArm.L', 'LowerArm.L', 'Hand.L', Vector((0, 1, 0))), 'FR': ('UpperArm.R', 'LowerArm.R', 'Hand.R', Vector((0, 1, 0))),
        'BL': ('UpperLeg.L', 'LowerLeg.L', 'Foot.L', Vector((0, -1, 0))), 'BR': ('UpperLeg.R', 'LowerLeg.R', 'Foot.R', Vector((0, -1, 0)))}
neutral = {}
for k in LEGS:
    pair = [paws[k[0]+'L']['y'], paws[k[0]+'R']['y']]
    # Rest paw -> symmetric stance; fore paws sit a little under the chest because
    # the reconstructed forelegs are fully extended, reaching forward.
    neutral[k] = Vector((0, sum(pair)/2+(.1 if k[0] == 'F' else 0)-paws[k]['y'], 0))
def solve_leg(k, disp, ikReport=None):
    """Place the leg so its end bone head sits at rest + disp, end bone in rest orientation."""
    up, lo, end, pole = LEGS[k]
    if k[0] == 'F':
        # The scapula glides with the stride, adding reach at both stride extremes.
        sh = 'Shoulder.'+k[1]; stride = disp.y-neutral[k].y
        PB[sh].rotation_quaternion = base.world_axis_rotation(PB[sh], pitch=max(-36, min(30, stride*110))); upd()
    start = PB[up].head.copy(); goal = rest[end].to_translation() + disp
    l1, l2 = DB[up].length, DB[lo].length
    axis = goal-start; d = axis.length; axis.normalize(); reach = l1+l2-.003
    if d > reach and ikReport is not None: ikReport[k]['maxShortfall'] = max(ikReport[k]['maxShortfall'], d-reach); goal = start+axis*reach; d = reach
    d = max(abs(l1-l2)+.003, d)
    a = (l1*l1-l2*l2+d*d)/(2*d); h = math.sqrt(max(0, l1*l1-a*a))
    pv = pole-axis*pole.dot(axis); pv.normalize(); joint = start+axis*a+pv*h
    set_dir(up, start, joint); set_dir(lo, joint, goal); keep_rest_orientation(end, goal)
def end_head(k): return PB[LEGS[k][2]].head.copy()
smooth = lambda t: (lambda u: u*u*(3-2*u))(min(1, max(0, t)))
bell = lambda t: math.sin(math.pi*min(1, max(0, t)))

def gait(phase, duty, stride, lift):
    """Paw offset along +Y (backward) and height for one leg at a gait phase."""
    if phase < duty: return Vector((0, stride*(phase/duty-.5), 0))
    u = (phase-duty)/(1-duty); return Vector((0, stride*(.5-smooth(u)), lift*math.sin(math.pi*u)))

# Each clip: body(t) -> FK pose dict; legs(t) -> {leg: (disp Vector or None for FK, blend weight)}
CLIPS = {}
def clip(name, seconds, loop=False):
    def wrap(fn): CLIPS[name] = (seconds, loop, fn); return fn
    return wrap
PLANT = lambda extra=None: {k: (neutral[k]+(extra or {}).get(k, Vector()), 1.0) for k in LEGS}

@clip('Idle_Loop', 3.0, True)
def idle(t):
    u = t/3.0*2*math.pi
    pose = {'Chest': {'pitch': .8*math.sin(u)}, 'Neck': {'yaw': 6*math.sin(u), 'pitch': -1.5*math.sin(2*u)},
            'Head': {'yaw': 4*math.sin(u+.6)}, 'Hips': {'loc': (0, 0, -.01+.006*math.sin(u))},
            'Tail1': {'yaw': 14*math.sin(u*2), 'pitch': -4}, 'Tail2': {'yaw': 18*math.sin(u*2-.8)}}
    return pose, PLANT()
WALK = dict(speed=1.3, cycle=.8, duty=.6, lift=.11)
@clip('Walk_Loop', WALK['cycle'], True)
def walk(t):
    c = WALK; u = t/c['cycle']; stride = c['speed']*c['cycle']*c['duty']
    offsets = {'BL': 0, 'FL': .25, 'BR': .5, 'FR': .75}  # lateral-sequence walk
    legs = {k: (neutral[k]+gait((u+o) % 1, c['duty'], stride, c['lift']), 1.0) for k, o in offsets.items()}
    w = 2*math.pi*u
    pose = {'Hips': {'loc': (0, 0, -.07+.012*math.cos(2*w)), 'roll': 2*math.sin(w)}, 'Chest': {'roll': -2*math.sin(w), 'yaw': 2*math.sin(w)},
            'Neck': {'pitch': 3+1.5*math.cos(2*w)}, 'Head': {'pitch': -2}, 'Tail1': {'yaw': 8*math.sin(w), 'pitch': -6}, 'Tail2': {'yaw': 10*math.sin(w-.7)}}
    return pose, legs
RUN = dict(speed=6.2, cycle=.4, duty=.27, lift=.24)
@clip('Run_Loop', RUN['cycle'], True)
def run(t):
    c = RUN; u = t/c['cycle']; stride = c['speed']*c['cycle']*c['duty']
    offsets = {'BL': 0, 'BR': .1, 'FR': .45, 'FL': .57}  # rotary gallop
    legs = {k: (neutral[k]+gait((u+o) % 1, c['duty'], stride, c['lift']), 1.0) for k, o in offsets.items()}
    w = 2*math.pi*u
    # Spine flexes as the hind legs reach under and extends in the front reach.
    pose = {'Hips': {'loc': (0, 0, -.07+.05*math.sin(w+.6)), 'pitch': 6*math.sin(w)}, 'Spine': {'pitch': -9*math.sin(w)},
            'Chest': {'pitch': 4*math.sin(w+.8)}, 'Neck': {'pitch': 8-4*math.sin(w+.8)}, 'Head': {'pitch': -6},
            'Tail1': {'pitch': -10+8*math.sin(w), 'yaw': 4*math.sin(w)}, 'Tail2': {'pitch': 10*math.sin(w-.8)}}
    return pose, legs
@clip('Alert', .6)
def alert(t):
    k = bell(t/.6); r = smooth(t/.18)*(1-smooth((t-.45)/.15))
    pose = {'Hips': {'loc': (0, 0, -.06*k)}, 'Chest': {'pitch': -4*k}, 'Neck': {'pitch': -14*r}, 'Head': {'pitch': -12*r},
            'Tail1': {'yaw': 22*math.sin(t*24)*k}, 'Tail2': {'yaw': 28*math.sin(t*24-.8)*k}}
    return pose, PLANT()
# Revision 12 (2026-09-12): the pounce is announced by a separate Crouch clip
# (0.8 s, body sunk, hindquarters gathering, tail lashing) and the claw combo by
# a Snarl clip (0.7 s, rocked back, head shaking, one forepaw raised and
# scraping). Both end in the pose their strike clip starts from. The Pounce clip
# itself keeps only a 0.2 s final dip at full crouch depth before the leap.
@clip('Crouch', .8)
def crouch(t):
    # Revision 13: deeper and busier than 12 so the telegraph reads from every angle.
    k = smooth(t/.3); w = 2*math.pi*t
    pose = {'Hips': {'loc': (0, .04*k, -.3*k), 'yaw': 7*math.sin(w*3.5)*k, 'roll': 3*math.sin(w*3.5+.8)*k}, 'Spine': {'pitch': 7*k}, 'Chest': {'pitch': 11*k},
            'Neck': {'pitch': -17*k}, 'Head': {'pitch': -8*k, 'yaw': 5*math.sin(w*2)*k},
            'Shoulder.L': {'pitch': -8*k}, 'Shoulder.R': {'pitch': -8*k},
            'UpperLeg.L': {'pitch': 30*k}, 'UpperLeg.R': {'pitch': 30*k},
            'Tail1': {'pitch': -18*k, 'yaw': 30*math.sin(w*2.8)*k}, 'Tail2': {'pitch': -8*k, 'yaw': 36*math.sin(w*2.8-.7)*k}}
    return pose, PLANT()
@clip('Snarl', .7)
def snarl(t):
    r = smooth(t/.22)*(1-smooth((t-.5)/.2)); w = 2*math.pi*t
    pose = {'Hips': {'loc': (0, .05*r, .02*r)}, 'Chest': {'pitch': -10*r}, 'Neck': {'pitch': -9*r},
            'Head': {'yaw': 9*math.sin(w*4.6)*r, 'pitch': -6*r},
            'Tail1': {'pitch': -16*r, 'yaw': 8*math.sin(w*3)*r}, 'Tail2': {'pitch': -10*r},
            'UpperArm.R': {'pitch': -42*r, 'yaw': -6*r}, 'LowerArm.R': {'pitch': 26*r}, 'Hand.R': {'pitch': -14*r}}
    legs = PLANT(); legs['FR'] = (neutral['FR'], 1-min(1, r*1.15))
    return pose, legs
CROUCH, LEAP, LAND = .2, .6, .5
@clip('Pounce', CROUCH+LEAP+LAND)
def pounce(t):
    pose = {}; legs = PLANT()
    if t < CROUCH:
        # Already at the Crouch clip's depth: the final dip before take-off.
        k = 1.0
        pose = {'Hips': {'loc': (0, .04*k, -.3*k), 'yaw': 5*math.sin(t*28)*k}, 'Spine': {'pitch': 4*k}, 'Chest': {'pitch': 6*k},
                'Neck': {'pitch': -10*k}, 'Head': {'pitch': -6*k}, 'Tail1': {'pitch': -6, 'yaw': 12*math.sin(t*20)}, 'Tail2': {'yaw': 18*math.sin(t*20-.6)}}
    elif t < CROUCH+LEAP:
        u = (t-CROUCH)/LEAP
        height = 1.0*4*u*(1-u) - .3*(1-smooth(u/.25))
        tilt = -16+34*smooth(u)  # nose up at take-off, nose down to land
        reach = bell(u*1.1)
        pose = {'Hips': {'loc': (0, 0, height), 'pitch': tilt}, 'Spine': {'pitch': -8*reach}, 'Neck': {'pitch': -6}, 'Head': {'pitch': -10},
                'Tail1': {'pitch': -18*reach}, 'Tail2': {'pitch': 10},
                # Forelegs reach out ahead of the face, claws spread toward the prey.
                'UpperArm.L': {'pitch': -70*reach}, 'UpperArm.R': {'pitch': -75*reach}, 'LowerArm.L': {'pitch': 10*reach}, 'LowerArm.R': {'pitch': 10*reach},
                'Hand.L': {'pitch': -20*reach}, 'Hand.R': {'pitch': -20*reach},
                'UpperLeg.L': {'pitch': 45*(1-smooth(u/.6))-20*smooth(u)}, 'UpperLeg.R': {'pitch': 45*(1-smooth(u/.6))-20*smooth(u)},
                'Foot.L': {'pitch': 30*(1-smooth(u))}, 'Foot.R': {'pitch': 30*(1-smooth(u))}}
        takeoff, landing = 1-smooth(u/.15), smooth((u-.85)/.15)
        legs = {k: (neutral[k], max(takeoff, landing)) for k in LEGS}
    else:
        u = (t-CROUCH-LEAP)/LAND; k = bell(min(1, u*1.4))
        pose = {'Hips': {'loc': (0, 0, -.22*k), 'pitch': 18*(1-smooth(u/.5))}, 'Chest': {'pitch': 8*k}, 'Neck': {'pitch': 6*k},
                'Tail1': {'pitch': -8, 'yaw': 10*math.sin(u*9)}}
    return pose, legs
@clip('Step', .35)
def step(t):
    u = t/.35; air = smooth((u-.2)/.1)*(1-smooth((u-.72)/.1))
    height = .2*bell((u-.2)/.55) - .1*bell(u/.25) - .08*bell((u-.72)/.28)
    pose = {'Hips': {'loc': (0, 0, height)}, 'Chest': {'pitch': -4*air}, 'Neck': {'pitch': -6*air}, 'Tail1': {'pitch': -14*air},
            'UpperArm.L': {'pitch': -15*air}, 'UpperArm.R': {'pitch': -15*air}, 'LowerArm.L': {'pitch': 30*air}, 'LowerArm.R': {'pitch': 30*air},
            'UpperLeg.L': {'pitch': -18*air}, 'UpperLeg.R': {'pitch': -18*air}, 'LowerLeg.L': {'pitch': 25*air}, 'LowerLeg.R': {'pitch': 25*air}}
    return pose, {k: (neutral[k], 1-air) for k in LEGS}
def swipe(t, at):
    """-1..1 profile: raise 0.22 s before the impact, strike through it, recover."""
    wind = smooth((t-(at-.22))/.14); strike = smooth((t-(at-.06))/.1); back = smooth((t-(at+.12))/.18)
    return wind, strike, back
@clip('Attack', 1.0)
def attack(t):
    pose = {'Hips': {'loc': (0, 0, .03*bell(t))}, 'Chest': {'pitch': -8*bell(t)}, 'Head': {'pitch': 6*bell(t)}}
    legs = {k: (neutral[k], 1.0) for k in ('BL', 'BR')}
    for side, at, sign in [('R', .32, -1), ('L', .62, 1)]:
        wind, strike, back = swipe(t, at)
        raise_ = wind*(1-strike); sweep = strike*(1-back)
        pose['UpperArm.'+side] = {'pitch': -50*raise_-30*sweep, 'yaw': sign*20*sweep, 'roll': -sign*5*raise_}
        pose['LowerArm.'+side] = {'pitch': -24*raise_+16*sweep}
        pose['Hand.'+side] = {'pitch': 30*raise_}
        legs['F'+side] = (neutral['F'+side], 1-min(1, wind*(1-back)*1.2))
        pose['Chest']['yaw'] = pose['Chest'].get('yaw', 0) + sign*6*(raise_+sweep)
    return pose, legs
@clip('Hit', .3)
def hit(t):
    k = bell(t/.3)
    return {'Chest': {'pitch': -6*k, 'roll': 5*k}, 'Neck': {'pitch': -10*k}, 'Head': {'pitch': -6*k}, 'Hips': {'loc': (0, .04*k, -.03*k)}}, PLANT()
@clip('Death', 1.5)
def death(t):
    k = smooth(t/.9); j = smooth((t-.5)/.6)
    pose = {'Hips': {'roll': 82*k, 'loc': (0, 0, -.1*k)}, 'Neck': {'pitch': 12*j, 'roll': 4*j}, 'Head': {'pitch': 10*j}, 
            'Tail1': {'pitch': 10*j},
            # Limp: limbs fold at elbow, wrist, knee and hock instead of staying braced.
            'UpperArm.L': {'pitch': -20*j, 'roll': -12*j}, 'UpperArm.R': {'pitch': -10*j, 'roll': 10*j},
            'LowerArm.L': {'pitch': 45*j}, 'LowerArm.R': {'pitch': 35*j}, 'Hand.L': {'pitch': 30*j}, 'Hand.R': {'pitch': 25*j},
            'UpperLeg.L': {'pitch': 30*j, 'roll': -10*j}, 'UpperLeg.R': {'pitch': 15*j, 'roll': 8*j},
            'LowerLeg.L': {'pitch': -35*j}, 'LowerLeg.R': {'pitch': -25*j}, 'Foot.L': {'pitch': 30*j}, 'Foot.R': {'pitch': 25*j}}
    return pose, {k2: (neutral[k2], 1-k) for k2 in LEGS}

# ---------------------------------------------------------------- bake
actions = []; floor = []; clipIk = {}
DEATH_LOCK = {'Death'}
for name, (seconds, loop, fn) in CLIPS.items():
    action = bpy.data.actions.new(name); action.use_fake_user = True
    if rig.animation_data is None: rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, 'action_slot'): rig.animation_data.action_slot = action.slots.new(id_type='OBJECT', name=name)
    n = round(seconds*FPS); mins = []; ikReport = {k: {'maxShortfall': 0.0} for k in LEGS}; clipIk[name] = ikReport
    for frame in range(n+1):
        t = (frame % n if loop else frame)/FPS  # loop end == start exactly
        pose, legs = fn(t)
        for bone, spec in pose.items():  # clips author translations in world metres
            if 'loc' in spec: spec['loc'] = tuple(rest[bone].to_3x3().inverted() @ Vector(spec['loc']))
        base.apply_pose(rig, pose); upd()
        for k, (disp, w) in legs.items():
            if w <= 1e-4: continue
            if w < 1:
                fk = end_head(k) - rest[LEGS[k][2]].to_translation()
                disp = fk.lerp(disp, w)
            solve_leg(k, disp, ikReport if w >= .999 else None)
        q = base.evaluated_positions(obj); low_ = float(q[:, 2].min()); mins.append(low_)
        # Ground lock: the lowest deformed vertex never sinks below the floor.
        if low_ < -.002:
            inv = rest['Hips'].to_3x3().inverted()
            PB['Hips'].location += inv @ Vector((0, 0, -low_-.001)); upd()
        for b in PB:
            b.keyframe_insert(data_path='rotation_quaternion', frame=frame); b.keyframe_insert(data_path='location', frame=frame)
    base.set_interpolation(action, 'LINEAR')
    if hasattr(action, 'use_frame_range'): action.use_frame_range = True; action.frame_start = 0; action.frame_end = n
    floor.append({'clip': name, 'minimumBeforeLock': min(mins), 'maximumMinimum': max(mins)})
    actions.append(action); rig.animation_data.action = None; base.rest_pose(rig); upd()
    print('CLIP_READY', name, json.dumps(floor[-1]), flush=True)
base.rest_pose(rig); upd(); base.FPS = FPS; base.export(out/'candidate.glb', actions)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
result = {'candidate': 1, 'revision': args.revision, 'source': str(source.relative_to(M)), 'sha256': hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),
          'bytes': (out/'candidate.glb').stat().st_size, 'heightMetres': H, 'lengthMetres': L, 'widthMetres': W,
          'boundsBlender': {'min': P.min(0).tolist(), 'max': P.max(0).tolist()}, 'upAxis': 'Y', 'forwardAxis': '+Z', 'triangles': len(F),
          'topology': topology, 'weights': report, 'bones': [b[0] for b in plan], 'bonePlan': plan, 'landmarks': marks, 'ikPlantedShortfall': clipIk, 'groundCheck': floor,
          'clips': [{'name': n_, 'loop': c[1], 'seconds': c[0], 'rootMotion': 'in-place'} for n_, c in CLIPS.items()],
          'locomotion': {'Walk_Loop': {'metresPerSecond': WALK['speed'], 'cycleSeconds': WALK['cycle'], 'dutyFactor': WALK['duty']},
                         'Run_Loop': {'metresPerSecond': RUN['speed'], 'cycleSeconds': RUN['cycle'], 'dutyFactor': RUN['duty']}},
          'geometryOrigin': 'Original TRELLIS surface only; no visible geometry added.', 'visualReviewRequired': True}
(out/'process.json').write_text(json.dumps(result, indent=2)+'\n'); print('RIG_DONE', result['sha256'], json.dumps({c: max(v['maxShortfall'] for v in r.values()) for c, r in clipIk.items()}), flush=True)
