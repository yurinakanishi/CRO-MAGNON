"""Posed-surface deviation of a re-skinned reduced GLB against the delivered GLB, sampled through every clip.

blender -b --python posed_deviation.py -- <delivered.glb> <new.glb> [--samples 6] -> prints POSED_DEV json
For each clip and sample time both are evaluated with their own skin; distance from every new posed vertex to the
nearest delivered posed vertex (KD tree) gives p95/max per clip. Rest-pose (t=0 of Idle) error is the reduction error.
"""
import json
import sys

import bpy
import numpy as np
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
a_path, b_path = argv[0], argv[1]
samples = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 6
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 60


def load(path):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in scene.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    return arm, meshes, {a.name for a in bpy.data.actions} - load.seen


load.seen = set()
A = load(a_path)
load.seen |= A[2]
B = load(b_path)


def posed(arm, meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in meshes:
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        out.append(co.reshape(-1, 3) @ np.asarray(o.matrix_world.to_3x3()).T + np.asarray(o.matrix_world.translation))
        e.to_mesh_clear()
    return np.vstack(out)


def actions_of(names):
    return {n.split('.')[0]: bpy.data.actions[n] for n in sorted(names)}


acts_a, acts_b = actions_of(A[2]), actions_of(B[2])
report = {}
for name, act_a in acts_a.items():
    act_b = next((v for k, v in acts_b.items() if k == name), None)
    if act_b is None:
        report[name] = 'missing'
        continue
    for arm, act in ((A[0], act_a), (B[0], act_b)):
        arm.animation_data_create()
        arm.animation_data.action = act
        if hasattr(arm.animation_data, 'action_slot') and act.slots:
            arm.animation_data.action_slot = act.slots[0]
    f0, f1 = act_a.frame_range
    worst = []
    for k in range(samples):
        scene.frame_set(int(round(f0 + (f1 - f0) * k / max(1, samples - 1))))
        pa, pb = posed(A[0], A[1]), posed(B[0], B[1])
        tree = KDTree(len(pa))
        for i, v in enumerate(pa):
            tree.insert(v, i)
        tree.balance()
        d = np.array([tree.find(v)[2] for v in pb])
        worst.append((float(np.percentile(d, 95)), float(d.max())))
    report[name] = {'p95_m': round(max(w[0] for w in worst), 4), 'max_m': round(max(w[1] for w in worst), 4)}
print('POSED_DEV', json.dumps(report))
