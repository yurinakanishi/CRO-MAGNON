"""Evaluate every delivered vertex, including the shared-rig LOD, at 120 Hz."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
sys.path.insert(0, str(ROOT.parent / 'threed-model-creation/trellis.cpp/tools'))
sys.path.insert(0, str(ROOT / 'assets/rimo-neko/workflow/lib'))
from glb_skin import Rigged
from glb_metrics import parse_glb

parser = argparse.ArgumentParser()
parser.add_argument('--colour',default='mae')
parser.add_argument('--revision', default='01')
args = parser.parse_args()
path = ROOT / f'output/model-generation/models/mae/work/rig/revision-{args.revision}/candidate.glb'
high, low = Rigged(path), Rigged(path.with_name('lod.glb'))
rig_record=json.loads(path.with_name('rig.json').read_text())
dense_gltf,dense_bin=parse_glb(str(ROOT/rig_record['source']))
def images(gltf,binary):
    used={gltf['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
          for m in gltf.get('materials',[]) if 'baseColorTexture' in m.get('pbrMetallicRoughness',{})}
    return [hashlib.sha256(binary[gltf['bufferViews'][im['bufferView']].get('byteOffset',0):
            gltf['bufferViews'][im['bufferView']].get('byteOffset',0)+gltf['bufferViews'][im['bufferView']]['byteLength']]).hexdigest()
            for i,im in enumerate(gltf.get('images',[])) if i in used]
dense_images=images(dense_gltf,dense_bin)
assert dense_images==images(high.gltf,high.bin), 'Embedded source albedo must remain byte-identical'
required = {'Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Pet', 'Happy', 'Hit'}
assert {c['name'] for c in high.animations()} == required
assert not low.animations(), 'LOD borrows the adopted clips, rather than making an independent rig'
names = lambda model: {node.get('name'): i for i, node in enumerate(model.gltf['nodes'])}
high_names, low_names = names(high), names(low)
assert [high.node_name(j) for j in high.joints] == [low.node_name(j) for j in low.joints]
assert len(high.joints) == len(low.joints) == 4
assert np.array_equal(high.ibm, low.ibm), 'The game binds reduced vertices to the original skeleton'
for name in ['Root', 'Body', 'Top', 'PetContact']:
    assert np.array_equal(high.global_transforms({}, 0)[high_names[name]],
                          low.global_transforms({}, 0)[low_names[name]])

errors = []
def inspect(model, level):
    positions = model.skinned({}, 0)
    node_names = names(model)
    root = model.global_transforms({}, 0)[node_names['Root']]
    weights = np.concatenate([p['W'] for p in model.prims])
    assert np.abs(weights.sum(1) - 1).max() < 1e-6
    assert np.isfinite(positions).all()
    faces=model.merged_faces()
    base_tri=positions[faces]
    base_cross=np.cross(base_tri[:,1]-base_tri[:,0],base_tri[:,2]-base_tri[:,0])
    base_area=np.linalg.norm(base_cross,axis=1)
    usable=base_area>1e-12
    # UV splits on the same source position must stay joined through deformation.
    _,first,inverse=np.unique(np.round(positions,7),axis=0,return_index=True,return_inverse=True)
    seam_pairs=np.array([(i,int(first[g])) for i,g in enumerate(inverse) if i!=first[g]],dtype=np.int32).reshape(-1,2)
    for primitive in model.prims:
        assert primitive['UV'] is not None and np.isfinite(primitive['UV']).all()
    records = []
    for clip in high.animations():
        name = clip['name']
        tracks = {node_names[high.node_name(index)]: channels
                  for index, channels in high.tracks(clip).items()}
        duration = high.clip_bounds(clip)[1]
        steps = round(duration * 120)
        first = model.skinned(tracks, 0)
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        drift, max_lowest = 0, -np.inf
        min_area_ratio,max_area_ratio,max_seam_gap=1.,1.,0.
        for i in range(steps + 1):
            time = duration * i / steps
            points = model.skinned(tracks, time)
            assert np.isfinite(points).all()
            lo, hi = np.minimum(lo, points.min(0)), np.maximum(hi, points.max(0))
            max_lowest = max(max_lowest, float(points[:, 1].min()))
            tri=points[faces]
            area=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)
            ratio=area[usable]/base_area[usable]
            min_area_ratio=min(min_area_ratio,float(ratio.min()))
            max_area_ratio=max(max_area_ratio,float(ratio.max()))
            if len(seam_pairs):max_seam_gap=max(max_seam_gap,float(np.linalg.norm(points[seam_pairs[:,0]]-points[seam_pairs[:,1]],axis=1).max()))
            drift = max(drift, float(np.abs(model.global_transforms(tracks, time)[node_names['Root']] - root).max()))
        closure = float(np.linalg.norm(first - points, axis=1).max())
        if lo[1] < -.001:
            errors.append(f'{level}/{name}: ground penetration')
        if drift > 1e-6:
            errors.append(f'{level}/{name}: root drift')
        if name.endswith('_Loop') and closure > 1e-5:
            errors.append(f'{level}/{name}: loop seam')
        if min_area_ratio<.05 or max_area_ratio>8:
            errors.append(f'{level}/{name}: collapsed or exploded deformation')
        if max_seam_gap>1e-5:
            errors.append(f'{level}/{name}: UV seam separation')
        records.append(dict(clip=name, seconds=duration, samples=steps + 1,
                            minimumY=float(lo[1]), maximumLowestY=float(max_lowest),
                            bounds=dict(min=lo.tolist(), max=hi.tolist()),
                            rootDrift=drift, loopClosure=closure,
                            minimumTriangleAreaRatio=min_area_ratio,maximumTriangleAreaRatio=max_area_ratio,
                            maximumUvSeamGap=max_seam_gap))
    return dict(sha256=hashlib.sha256(model.raw).hexdigest(), vertices=len(positions),
                triangles=len(faces), bones=len(model.joints),restDegenerateTriangles=int((~usable).sum()),uvSeamPairs=len(seam_pairs),clips=records)

report = inspect(high, 'main')
report['lod'] = inspect(low, 'LOD')
report.update(sampleHz=120, sharedInverseBindMatricesExact=True, sharedRestTransformsExact=True,
              embeddedSourceAlbedoExact=True,embeddedSourceAlbedoSha256=dense_images,
              errors=errors, numericPass=not errors)
out = path.parent / 'qa/numeric.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
sys.exit(bool(errors))
