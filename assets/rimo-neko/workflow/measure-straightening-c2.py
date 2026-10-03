"""Read-only surface measurements for the user's head/tail alignment request."""
import json, sys, math
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M = ROOT/'output/model-generation/models/rimo-neko/candidate-2'
bpy.ops.wm.open_mainfile(filepath=str(M/'work/rig/revision-02/source.blend'))
obj = bpy.data.objects['RimoNekoSurface']; rig = obj.find_armature()
rig.animation_data_clear()
for b in rig.pose.bones:
    b.matrix_basis.identity()
bpy.context.view_layer.update()
camera = json.loads((M/'qa/face-01/bounds.json').read_text())
tree = BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
direction=Vector(camera['directions']['front']).normalized()
rotation=direction.to_track_quat('Z','Y'); centre=Vector(camera['centre'])
result={}
for name,pixel in [('eyeImageLeft',(168,488)),('eyeImageRight',(320,480))]:
    x,y=pixel
    origin=centre+direction*camera['span']*3+rotation@Vector(((x/camera['pixels']-.5)*camera['orthographicWidth'],(.5-y/camera['pixels'])*camera['orthographicWidth'],0))
    at,normal,idx,distance=tree.ray_cast(origin,-direction)
    assert at is not None
    result[name]=dict(pixel=pixel,at=list(at),normal=list(normal),triangle=idx)
a=Vector(result['eyeImageLeft']['at']); b=Vector(result['eyeImageRight']['at']); side=b-a
result['eyeMidpoint']=list((a+b)/2)
result['headYawCorrectionDegrees']=-math.degrees(math.atan2(side.y,side.x))
out=M/'qa/straightening-20261003';out.mkdir(parents=True,exist_ok=True)
(out/'measurements.json').write_text(json.dumps(result,indent=2)+'\n')
print('STRAIGHTENING_MEASUREMENTS',json.dumps(result),flush=True)
