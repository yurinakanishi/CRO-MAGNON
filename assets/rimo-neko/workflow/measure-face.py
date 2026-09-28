import sys,json
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file()); sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_rig as base
M=ROOT/'output/model-generation/models/rimo-neko'; obj=base.import_mesh(M/'work/low-poly/revision-01/candidate.glb')
tree=BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
centre=Vector((.036,-.22,.386)); direction=Vector((.74,-.67,.04)).normalized(); camera=centre+direction*.72
q=direction.to_track_quat('Z','Y'); right=q@Vector((1,0,0)); up=q@Vector((0,1,0)); width=.24*1.24
pixels={'nose':(449,491),'mouth':(455,546),'lipLeft':(384,554),'lipRight':(536,529),'eyeLeft':(350,431),'eyeRight':(544,385),'earLeftBase':(220,285),'earLeftTip':(157,160),'earRightBase':(554,198),'earRightTip':(580,45),'crown':(407,237)}
result={}
for name,(x,y) in pixels.items():
    origin=camera+right*((x-400)/800*width)+up*((400-y)/800*width)
    at,normal,idx,d=tree.ray_cast(origin,-direction)
    result[name]=dict(at=list(at),normal=list(normal),pixel=[x,y]) if at else None
print(json.dumps(result,indent=2)); (M/'qa/face-landmarks.json').write_text(json.dumps(result,indent=2)+'\n')
