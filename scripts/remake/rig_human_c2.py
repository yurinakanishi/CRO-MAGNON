"""Humanoid Candidate 2 rig (2026-10 remake) on a processed (and optionally head-grafted) surface.

blender -b --python rig_human_c2.py -- --source <mesh.glb> --out DIR [--landmarks-only]
    [--accent auto|none] [--skin-radius .085] [--skin-smooth 22] [--proportions fractions.json] [--arm-fractions .43,.77,.87]

Reuses the project's humanoid library (scripts/remake/riglib/blender_rig.py, clips_data.py,
skin_weights.py): measured landmarks -> 22-bone plan (Root, Hips, Spine, Chest, Neck, Head,
Shoulder/UpperArm/LowerArm/Hand, UpperLeg/LowerLeg/Foot/Toe), Grip.L/Grip.R sockets, geodesic
surface skinning, IK base clips (Idle_Loop, Walk_Loop, Run_Loop, Gather, Craft, Give, Eat, Wave)
and per-clip ground lock. Baked albedo/normal/roughness materials of the source are kept.
Attack, Downed and the CMU Walk/Run are authored afterwards by the existing Node builders.
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

sys.path.insert(0, str(Path(__file__).resolve().parent / 'riglib'))
import blender_rig as base  # noqa: E402
from clips_data import EAT_HAND, LegSolver, build_clips  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--source', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--landmarks-only', action='store_true')
ap.add_argument('--accent', default='auto')
ap.add_argument('--skin-radius', type=float, default=.085)
ap.add_argument('--skin-smooth', type=int, default=22)
ap.add_argument('--name', default='Character')
ap.add_argument('--height', type=float, default=None, help='uniformly rescale the merged surface about the feet to this height (delivered character height)')
ap.add_argument('--arm-band', type=float, default=.05, help='radius (fraction of height) around the shoulder-fingertip axis '
                'whose surface points give the elbow and wrist; a slim arm needs less, or the torso and hip pouch pull them inward')
ap.add_argument('--arm-gate', type=float, default=0.0, help='height fraction below the armpit: there the arms are separate '
                'surfaces, and any vertex not connected to a hand within that height loses its arm weights (A-pose elbows next '
                'to the waist otherwise pull the dress); 0 = off')
ap.add_argument('--measure-subdiv', type=int, default=0, help='measure the landmarks on a copy split by this many simple '
                '(shape-preserving) subdivision levels: a low-poly surface has too few vertices for the band statistics')
ap.add_argument('--rigid-feet', default='', help='LOW,HIGH metres about the ankle joint height: vertices of each leg below '
                'LOW move with the foot only, blending into the surface weights up to HIGH (a chunky boot, whose short foot bone '
                'otherwise leaves the sole to the shin and no vertex for the sole contact of the locomotion builder), e.g. -.015,.02')
ap.add_argument('--rigid-hands', default='', help='T0,T1 fractions of the shoulder-to-fingertip span: vertices of an arm beyond T1 '
                'move with the hand only, blending into the surface weights from T0 (a short chibi hand bone otherwise leaves its '
                'mitten hand shared with the forearm, and the torch grasp finds no hand vertex), e.g. .60,.68')
ap.add_argument('--arm-fractions', default='.43,.77,.87', help='elbow,wrist,hand as fractions of the shoulder-to-fingertip span '
                '(adult proportions by default; a chibi hand is longer: its wrist leaves the sleeve cuff earlier)')
ap.add_argument('--hips-over-knees', action='store_true', help='put the pelvis and hip joints above the mean knee depth '
                '(a chibi body in a full skirt with a pouch or a cape: its measured pelvis depth leaves the legs slanted)')
ap.add_argument('--shoulder-x', type=float, default=0.0, help='metres: the shoulder joints this far from the body axis '
                'instead of the measured outer limb mass at the shoulder height (a cape over the shoulders widens it: the '
                'arm then starts at the cape edge and falls short of the spear held in front)')
ap.add_argument('--arm-axis-depth', action='store_true', help='the elbow, wrist and hand at the depth of the straight '
                'shoulder-to-fingertip line instead of the mean of the arm surface there (a wide sleeve or a fur cuff that '
                'bulges forward bends the rest forearm backward; the axe, held across the forearm as in the idle pose, then '
                'tilts toward the ground in the gathering crouch)')
ap.add_argument('--body-over-knees', action='store_true', help='as --hips-over-knees, and the spine, chest, neck and '
                'shoulder joints too (a cape or hood behind a chibi pulls their measured depth back: the arms then start '
                'behind the body and fall short of what the hands reach for)')
ap.add_argument('--depth-trim', type=float, default=0.0, help='fraction of the torso points cut off at the front and at the back '
                'before the midpoint of a torso depth (pelvis, spine, chest, neck, head): a tail or a cape hem behind the hips '
                'otherwise pulls the hips back from the knees (0 = the full depth range)')
ap.add_argument('--proportions', default='', help='JSON of landmark height fractions overriding blender_rig.FRACTIONS (a stylized character with a larger head)')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)

obj = base.import_mesh(args.source)
obj.name = args.name
obj.data.name = args.name + 'Mesh'
topology = base.weld_and_shade(obj, angle_degrees=48)  # same crease as the normal bake (remake_process.py)
P = base.positions(obj.data)
height_scale = None
if args.height:
    # The head graft changes the crown height; keep the delivered character height (uniform, about the feet).
    height_scale = args.height / float(P[:, 2].max() - P[:, 2].min())
    P = P * height_scale
    obj.data.vertices.foreach_set('co', P.ravel())
    obj.data.update()
H = float(P[:, 2].max() - P[:, 2].min())
base.H = H  # landmark fractions are relative to this character's own height
proportions = json.loads(Path(args.proportions).read_text(encoding='utf-8'))['fractions'] if args.proportions else {}
unknown = set(proportions) - set(base.FRACTIONS) - {'mouth'}
assert not unknown, f'unknown landmark fractions: {sorted(unknown)}'
base.FRACTIONS.update(proportions)
if args.depth_trim > 0:
    def trimmed_torso_depth(P, z, half=0.026, limit=0.115):
        selection = base.band_mask(P, z, half) & (np.abs(P[:, 0]) < limit)
        if selection.sum() < 8:
            selection = base.band_mask(P, z, half * 2.0) & (np.abs(P[:, 0]) < limit * 1.4)
        lo, hi = np.percentile(P[selection][:, 1], [100 * args.depth_trim, 100 * (1 - args.depth_trim)])
        return float(0.5 * (lo + hi))
    base.torso_depth = trimmed_torso_depth

measure_obj = obj
if args.measure_subdiv:
    # same surface, more (coplanar) vertices: the landmark band statistics count vertices, not area
    measure_obj = obj.copy()
    measure_obj.data = obj.data.copy()
    bpy.context.collection.objects.link(measure_obj)
    mod = measure_obj.modifiers.new('Measure', 'SUBSURF')
    mod.subdivision_type = 'SIMPLE'
    mod.levels = mod.render_levels = args.measure_subdiv
    bpy.ops.object.select_all(action='DESELECT')
    measure_obj.select_set(True)
    bpy.context.view_layer.objects.active = measure_obj
    bpy.ops.object.modifier_apply(modifier='Measure')
    P = base.positions(measure_obj.data)

# ---- arms measured along the actual limb (the A-pose angle differs between references)
def arm_chain(sign):
    """Fingertip = most lateral surface point in the hand-height band of the A-pose."""
    band = P[(P[:, 2] > .3 * H) & (P[:, 2] < .62 * H) & (sign * P[:, 0] > 0)]
    lateral = float((sign * band[:, 0]).max())
    hand = band[sign * band[:, 0] > lateral - .07 * H]  # the hanging hand, clear of skirt and thigh
    return hand[np.argmin(hand[:, 2])]

marks, detail = base.build_landmarks(measure_obj)
if args.hips_over_knees or args.body_over_knees:
    # the pelvis depth of a body whose hips hide in a full skirt, a hanging pouch or a cape hem is not the leg line:
    # the hips go straight above the mean knee depth (the spine above them keeps its own measured depth)
    knee_depth = 0.5 * (marks['knee_L'][1] + marks['knee_R'][1])
    detail['hipsOverKnees'] = dict(measuredPelvisDepth=marks['pelvis'][1], kneeDepth=knee_depth)
    marks['pelvis'] = (marks['pelvis'][0], knee_depth, marks['pelvis'][2])
    for side in ('L', 'R'):
        marks['hip_' + side] = (marks['hip_' + side][0], knee_depth, marks['hip_' + side][2])
    if args.body_over_knees:
        detail['bodyOverKnees'] = {name: marks[name][1] for name in ('spine', 'chest', 'neck', 'shoulder_L', 'shoulder_R')}
        for name in ('spine', 'chest', 'neck', 'shoulder_in_L', 'shoulder_in_R', 'shoulder_L', 'shoulder_R'):
            marks[name] = (marks[name][0], knee_depth, marks[name][2])
detail['measured_on'] = {'subdivision_levels': args.measure_subdiv, 'vertices': len(measure_obj.data.vertices)}
arm_fix = {}
# Symmetric shoulder joints (one-sided cloth or fur on a shoulder must not shift the joint).
sx = (abs(marks['shoulder_L'][0]) + abs(marks['shoulder_R'][0])) / 2
if args.shoulder_x:
    detail['shoulderX'] = dict(measured=sx, given=args.shoulder_x)
    sx = args.shoulder_x
sy = (marks['shoulder_L'][1] + marks['shoulder_R'][1]) / 2
for side, sign in (('L', 1.0), ('R', -1.0)):
    marks['shoulder_' + side] = (sign * sx, sy, marks['shoulder_' + side][2])
    tip = arm_chain(sign)
    s = np.array(marks['shoulder_' + side])
    axis = tip - s
    length = np.linalg.norm(axis)
    axis /= length
    def along(f):
        c = s + axis * length * f
        rel = P - c
        t = rel @ axis
        radial = np.linalg.norm(rel - np.outer(t, axis), axis=1)
        band = P[(radial < args.arm_band * H) & (np.abs(t) < .012 * H)]
        return tuple(band.mean(0)) if len(band) > 8 else tuple(c)
    # arm proportions along the shoulder-to-fingertip span (adult by default)
    f_elbow, f_wrist, f_hand = map(float, args.arm_fractions.split(','))
    marks['elbow_' + side] = along(f_elbow)
    marks['wrist_' + side] = along(f_wrist)
    marks['hand_' + side] = along(f_hand)
    if args.arm_axis_depth:
        for name, f in (('elbow_', f_elbow), ('wrist_', f_wrist), ('hand_', f_hand)):
            x, _, z = marks[name + side]
            marks[name + side] = (x, float(s[1] + axis[1] * length * f), z)
    arm_fix[side] = dict(tip=tip.tolist(), length=float(length), axis=axis.tolist())
detail['arm_chain'] = arm_fix
if measure_obj is not obj:
    bpy.data.objects.remove(measure_obj, do_unlink=True)
    bpy.context.view_layer.objects.active = obj
(out / 'landmarks.json').write_text(json.dumps({'H': H, 'marks': {k: list(map(float, v)) for k, v in marks.items()}, 'detail': detail}, indent=2, default=float) + '\n')
print('LANDMARKS', json.dumps({k: [round(float(c), 3) for c in v] for k, v in marks.items()}), flush=True)
if args.landmarks_only:
    sys.exit(0)

# ---- tribe accent: the largest pale low-saturation cloth island on the character-left shoulder
accent_report = {'result': 'skipped'}
if args.accent == 'auto':
    body_mat = obj.data.materials[0]
    albedo = next(n.image for n in body_mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image.colorspace_settings.name == 'sRGB')
    colours = base.face_uv_colours(obj, albedo)
    lum = colours @ np.array([.2126, .7152, .0722])
    sat = colours.max(1) - colours.min(1)
    centres = np.array([list(p.center) for p in obj.data.polygons])
    mats = np.array([p.material_index for p in obj.data.polygons])
    region = (centres[:, 2] > .70 * H) & (centres[:, 2] < .89 * H) & (centres[:, 0] > -.01 * H) & (centres[:, 0] < .21 * H) & (centres[:, 1] < .05 * H) & (mats == 0)
    pale = (lum > .55) & (sat < .16)
    selected = base.largest_face_island(obj, region & pale)
    accent_report = {'candidate_faces': int((region & pale).sum()), 'selected_faces': int(selected.sum())}
    if selected.sum() >= 40:
        accent = body_mat.copy()
        accent.name = 'TribeAccent'
        obj.data.materials.append(accent)
        slot = len(obj.data.materials) - 1
        for i in np.nonzero(selected)[0]:
            obj.data.polygons[int(i)].material_index = slot
        obj.data.update()
        accent_report.update(result='isolated', slot=slot, mean_srgb=colours[selected].mean(0).round(4).tolist())
    else:
        accent_report['result'] = 'not isolated (fewer than 40 pale faces)'

plan = base.bone_plan(marks)
rig = base.build_armature(plan)
sockets = base.add_grip_sockets(rig, marks)
geodesic = base.geodesic_bind(obj, rig, args.skin_radius, args.skin_smooth)
arm_gate = None
if args.arm_gate:
    # Below the armpit the arms hang free of the body: the vertices connected to a hand through vertices under
    # the gate height are the arms; every other vertex there (dress, waist, legs) keeps no arm weight.
    import bmesh
    Pm = base.positions(obj.data)
    gate_z = args.arm_gate * H
    bm_gate = bmesh.new()
    bm_gate.from_mesh(obj.data)
    bm_gate.verts.ensure_lookup_table()
    below = Pm[:, 2] < gate_z
    # reconstruction cracks can split a forearm lengthwise into sheets joined only above the elbow: vertices within
    # 15 mm of each other count as connected (a low-poly crack has unaligned vertices on its two sides; a hand
    # hangs about 10 cm clear of the dress)
    from mathutils.kdtree import KDTree
    index_below = np.nonzero(below)[0]
    tree = KDTree(len(index_below))
    for i in index_below:
        tree.insert(Vector(Pm[i]), int(i))
    tree.balance()
    arm_vertex = np.zeros(len(Pm), bool)
    for side in ('L', 'R'):
        hand = np.array(marks['hand_' + side])
        start = int(np.argmin(np.where(below, np.linalg.norm(Pm - hand, axis=1), np.inf)))
        stack = [start]
        arm_vertex[start] = True
        while stack:
            current = stack.pop()
            vert = bm_gate.verts[current]
            near = [other for other in (e.other_vert(vert).index for e in vert.link_edges) if below[other]]
            near += [int(found[1]) for found in tree.find_range(Vector(Pm[current]), 0.015)]
            for other in near:
                if not arm_vertex[other]:
                    arm_vertex[other] = True
                    stack.append(other)
    bm_gate.free()
    arm_bones = [g.index for g in obj.vertex_groups if g.name.split('.')[0] in ('Shoulder', 'UpperArm', 'LowerArm', 'Hand')]
    body_segments = {name: seg for name, seg in base.bone_segments(rig).items()
                     if name.split('.')[0] not in ('Shoulder', 'UpperArm', 'LowerArm', 'Hand')}
    cleared = reassigned = 0
    for vert in obj.data.vertices:
        if not below[vert.index] or arm_vertex[vert.index]:
            continue
        removed = [g.group for g in vert.groups if g.group in arm_bones and g.weight > 0]
        if removed:
            cleared += 1
            for group in removed:
                obj.vertex_groups[group].remove([vert.index])
            if not any(g.weight > 1e-5 for g in vert.groups):
                point = Vector(vert.co)
                name = min(body_segments, key=lambda n: base.distance_to_segment(point, *body_segments[n]))
                obj.vertex_groups[name].add([vert.index], 1.0, 'REPLACE')
                reassigned += 1
    arm_gate = {'height_fraction': args.arm_gate, 'gate_metres': round(gate_z, 4), 'crack_bridge_metres': 0.015, 'arm_vertices_below_gate': int(arm_vertex.sum()),
                'body_vertices_cleared_of_arm_weights': cleared, 'reassigned_to_nearest_body_bone': reassigned}
    print('ARM_GATE', json.dumps(arm_gate), flush=True)
rigid_hands = None
if args.rigid_hands:
    t0, t1 = map(float, args.rigid_hands.split(','))
    group_by_name = dict((g.name, g) for g in obj.vertex_groups)
    Pv = base.positions(obj.data)
    rigid_hands = dict(span_fractions=[t0, t1], radius_metres=0.1)
    for side in ('L', 'R'):
        chain = arm_fix[side]
        s0 = np.array(marks['shoulder_' + side])
        axis = np.array(chain['axis'])
        rel = Pv - s0
        t = rel @ axis / chain['length']
        radial = np.linalg.norm(rel - np.outer(rel @ axis, axis), axis=1)
        hand_group = group_by_name['Hand.' + side]
        rigid = blended = 0
        for index in np.nonzero((t > t0) & (radial < 0.1))[0]:
            vert = obj.data.vertices[int(index)]
            w = float(np.clip((t[index] - t0) / (t1 - t0), 0, 1))
            old_hand = 0.0
            for element in vert.groups:
                if element.group == hand_group.index:
                    old_hand = element.weight
                element.weight *= 1.0 - w
            hand_group.add([vert.index], w + (1.0 - w) * old_hand, 'REPLACE')
            if w >= 1.0:
                rigid += 1
            else:
                blended += 1
        rigid_hands[side] = dict(rigidVertices=rigid, blendedVertices=blended)
    print('RIGID_HANDS', json.dumps(rigid_hands), flush=True)
rigid_feet = None
if args.rigid_feet:
    band_lo, band_hi = map(float, args.rigid_feet.split(','))
    group_by_name = dict((g.name, g) for g in obj.vertex_groups)
    rigid_feet = dict(band_metres=[band_lo, band_hi], radius_metres=0.15)
    for side, sign in (('L', 1.0), ('R', -1.0)):
        ankle = marks['ankle_' + side]
        foot_group = group_by_name['Foot.' + side]
        foot_index = foot_group.index
        rigid = blended = 0
        for vert in obj.data.vertices:
            x, y, z = vert.co
            if sign * x <= 0.0 or math.hypot(x - ankle[0], y - ankle[1]) > 0.15:
                continue
            t = (z - (ankle[2] + band_lo)) / (band_hi - band_lo)
            if t >= 1.0:
                continue
            t = max(0.0, t)
            old_foot = 0.0
            for element in vert.groups:
                if element.group == foot_index:
                    old_foot = element.weight
                element.weight *= t
            foot_group.add([vert.index], (1.0 - t) + t * old_foot, 'REPLACE')
            if t == 0.0:
                rigid += 1
            else:
                blended += 1
        rigid_feet[side] = dict(ankleHeightMetres=round(ankle[2], 4), rigidVertices=rigid, blendedVertices=blended)
    print('RIGID_FEET', json.dumps(rigid_feet), flush=True)
coverage = base.weight_coverage(obj, rig)
weights = base.normalise_weights(obj, rig)
weights.update(deform_coverage=round(coverage, 5), geodesic=geodesic, arm_gate=arm_gate, rigid_feet=rigid_feet,
               rigid_hands=rigid_hands)

bpy.context.scene.render.fps = base.FPS
solvers = {s: LegSolver(marks['hip_' + s], marks['knee_' + s], marks['ankle_' + s]) for s in ('L', 'R')}
arm_ik = base.ArmIK(rig, obj, marks, hand_pose=EAT_HAND)
clips = build_clips(solvers, arm_ik, marks['mouth'])
base.rest_pose(rig)
bpy.context.view_layer.update()
feet = base.foot_mask_from_rest(obj, limit=.14 * H)
inverse = base.hips_world_to_local(rig)
actions, locks = [], []
for clip in clips:
    action, animated = base.make_action(rig, clip)
    lock = base.ground_lock(rig, obj, action, clip, feet, inverse)
    lock['clip'] = clip['name']
    locks.append(lock)
    actions.append((action, animated))
probe = base.deformation_probe(rig, obj, actions)
base.rest_pose(rig)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT')
glb = out / 'candidate.glb'
bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                          export_bake_animation=False, export_optimize_animation_size=False, export_anim_slide_to_zero=False,
                          export_def_bones=False, export_rest_position_armature=True, export_influence_nb=4,
                          export_tangents=True, export_image_format='WEBP', export_image_quality=92)
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'source.blend'), compress=True)
report = {'author': 'Claude Code (Opus 5.5)', 'claude_used': True, 'script': 'scripts/remake/rig_human_c2.py',
          'source': args.source, 'sha256': hashlib.sha256(glb.read_bytes()).hexdigest(), 'bytes': glb.stat().st_size,
          'heightMetres': H, 'heightScale': height_scale, 'proportions': {'file': args.proportions or None, 'fractions': dict(base.FRACTIONS), 'arm': args.arm_fractions, 'depthTrim': args.depth_trim, 'hipsOverKnees': args.hips_over_knees, 'bodyOverKnees': args.body_over_knees, 'armAxisDepth': args.arm_axis_depth, 'shoulderX': args.shoulder_x or None}, 'triangles': int(sum(len(p.vertices) - 2 for p in obj.data.polygons)), 'topology': topology,
          'materials': [m.name for m in obj.data.materials], 'tribeAccent': accent_report,
          'bones': [p[0] for p in plan], 'sockets': sockets, 'weights': weights, 'groundLock': locks, 'deformationProbe': probe,
          'clips': [{'name': c['name'], 'loop': c['loop'], 'seconds': round((c['poses'][-1][0] - c['poses'][0][0]) / base.FPS, 4)} for c in clips]}
(out / 'rig-report.json').write_text(json.dumps(report, indent=2, default=float) + '\n')
print('RIG_DONE', report['sha256'], json.dumps(report['clips']), flush=True)
