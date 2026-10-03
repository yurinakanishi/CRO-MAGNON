"""Ray-project visually reviewed pixel landmarks onto the exact C2 surface.

Input: candidate-2/qa/landmark-pixels.json, containing the render metadata path,
named {view, pixel:[x,y]} surface points, and reviewed internal joint positions.
Pixels refer to the complete square render, with its top-left as (0,0).
"""
import json,sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import blender_rig as base
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2'
obj=base.import_mesh(M/'work/low-poly/revision-01/candidate.glb')
spec=json.loads((M/'qa/landmark-pixels.json').read_text())
camera=json.loads((ROOT/spec['renderMetadata']).read_text())
centre=Vector(camera['centre']); span=camera['span']; size=camera['pixels']
tree=BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
result={}
for name,point in spec['surface'].items():
    direction=Vector(camera['directions'][point['view']]).normalized()
    origin=centre+direction*span*3
    rotation=direction.to_track_quat('Z','Y')
    x,y=point['pixel']
    origin+=rotation@Vector(((x/size-.5)*camera['orthographicWidth'],(.5-y/size)*camera['orthographicWidth'],0))
    at,normal,idx,distance=tree.ray_cast(origin,-direction)
    assert at is not None,('Landmark misses surface',name,point)
    result[name]=dict(at=list(at),normal=list(normal),pixel=point['pixel'],view=point['view'],triangle=idx)
for name,at in spec['internal'].items(): result[name]=dict(at=at,method='Internal joint inferred from reviewed surface views')
(M/'qa/face-landmarks.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
