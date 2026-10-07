"""Humanoid Candidate 2 rig (2026-10 remake) on a processed (and optionally head-grafted) surface.

blender -b --python rig_human_c2.py -- --source <mesh.glb> --out DIR [--landmarks-only]
    [--accent auto|none] [--skin-radius .085] [--skin-smooth 22]

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

# ---- arms measured along the actual limb (the A-pose angle differs between references)
def arm_chain(sign):
    """Fingertip = most lateral surface point in the hand-height band of the A-pose."""
    band = P[(P[:, 2] > .3 * H) & (P[:, 2] < .62 * H) & (sign * P[:, 0] > 0)]
    lateral = float((sign * band[:, 0]).max())
    hand = band[sign * band[:, 0] > lateral - .07 * H]  # the hanging hand, clear of skirt and thigh
    return hand[np.argmin(hand[:, 2])]

marks, detail = base.build_landmarks(obj)
arm_fix = {}
# Symmetric shoulder joints (one-sided cloth or fur on a shoulder must not shift the joint).
sx = (abs(marks['shoulder_L'][0]) + abs(marks['shoulder_R'][0])) / 2
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
        band = P[(radial < .05 * H) & (np.abs(t) < .012 * H)]
        return tuple(band.mean(0)) if len(band) > 8 else tuple(c)
    # adult arm proportions along the shoulder-to-fingertip span
    marks['elbow_' + side] = along(.43)
    marks['wrist_' + side] = along(.77)
    marks['hand_' + side] = along(.87)
    arm_fix[side] = dict(tip=tip.tolist(), length=float(length), axis=axis.tolist())
detail['arm_chain'] = arm_fix
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
coverage = base.weight_coverage(obj, rig)
weights = base.normalise_weights(obj, rig)
weights.update(deform_coverage=round(coverage, 5), geodesic=geodesic)

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
          'heightMetres': H, 'heightScale': height_scale, 'triangles': int(sum(len(p.vertices) - 2 for p in obj.data.polygons)), 'topology': topology,
          'materials': [m.name for m in obj.data.materials], 'tribeAccent': accent_report,
          'bones': [p[0] for p in plan], 'sockets': sockets, 'weights': weights, 'groundLock': locks, 'deformationProbe': probe,
          'clips': [{'name': c['name'], 'loop': c['loop'], 'seconds': round((c['poses'][-1][0] - c['poses'][0][0]) / base.FPS, 4)} for c in clips]}
(out / 'rig-report.json').write_text(json.dumps(report, indent=2, default=float) + '\n')
print('RIG_DONE', report['sha256'], json.dumps(report['clips']), flush=True)
