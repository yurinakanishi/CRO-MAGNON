"""Repair C2's non-manifold, shingled fur using only its reconstructed surface.

Voxel union + bounded fairing closes the thin overlapping sheets. Face and ears
are protected, and the original TRELLIS colour is rebaked without lighting.
This is a separate surface revision; source, UV atlas and failed shapes remain.
"""
import json,hashlib,sys
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import blender_rig as base,blender_reduce as reduce
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2'
source=M/'work/low-poly/revision-01/candidate.glb'
out=M/'work/low-poly/revision-02';out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists(),'Keep every completed repair revision'
obj=base.import_mesh(source);obj.name='RimoNekoSurface'
P=base.positions(obj.data);F=base.mesh_triangles(obj.data)
tree=reduce.bvh_from_arrays(P,F)
obj.data.remesh_voxel_size=.0022
obj.data.use_remesh_preserve_volume=True
bpy.ops.object.voxel_remesh()
Q=base.positions(obj.data)
sm=lambda v:np.clip(v,0,1)**2*(3-2*np.clip(v,0,1))
face=sm((-.13-Q[:,1])/.04)*sm((Q[:,2]-.29)/.04)
ears=sm((Q[:,2]-.42)/.045)*sm((.06-Q[:,1])/.09)
protection=np.maximum(face,ears)
group=obj.vertex_groups.new(name='Fur repair strength')
for i,w in enumerate(1-.94*protection):group.add([i],float(w),'REPLACE')
mod=obj.modifiers.new('Fair reconstructed fur surface','SMOOTH')
mod.factor=.72;mod.iterations=22;mod.vertex_group=group.name
bpy.ops.object.modifier_apply(modifier=mod.name)
Q=base.positions(obj.data);maximum=0;clamped=0
for i,p in enumerate(Q):
    at,normal,index,d=tree.find_nearest(Vector(p))
    limit=.008*(1-protection[i])+.0012*protection[i]
    if d>limit:
        Q[i]=np.asarray(at)+(p-np.asarray(at))*limit/d;clamped+=1
    maximum=max(maximum,min(d,limit))
obj.data.vertices.foreach_set('co',Q.astype(np.float32).ravel());obj.data.update()
reduce.triangulate(obj)
faces=len(obj.data.polygons)
if faces>150000:
    mod=obj.modifiers.new('Measured retained surface','DECIMATE');mod.ratio=150000/faces;mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
reduce.triangulate(obj)
topology=base.weld_and_shade(obj,angle_degrees=180)
obj.data.use_auto_smooth=False
for polygon in obj.data.polygons:polygon.use_smooth=True
Q=base.positions(obj.data);G=base.mesh_triangles(obj.data)
H=.52
forward=reduce.deviation(reduce.sample_surface(P,F,24000,42),reduce.bvh_from_arrays(Q,G),H)
reverse=reduce.deviation(reduce.sample_surface(Q,G,24000,43),tree,H)
print('REPAIR_DISTANCE',json.dumps(dict(sourceToRepair=forward,repairToSource=reverse)),flush=True)
base.unwrap(obj,angle_degrees=66,margin=.003)
material,image,bake=base.bake_dense_albedo(obj,source,out/'albedo.png',2048)
material.name='RimoNeko source-colour fur';image.name='RimoNeko retained source albedo'
material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.82
obj.name=obj.data.name='RimoNekoSurface'
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_apply=False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
np.savez_compressed(out/'surface.npz',positions=Q,faces=G)
record=dict(candidate=2,revision=2,source=str(source),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),
    method='Source-derived voxel union and bounded fur fairing, face/ear protection, original colour-only rebake',
    voxelMetres=.0022,smoothIterations=22,smoothFactor=.72,clampedVertices=clamped,maxNearestSourceBeforeReduction=maximum,
    sourceToRepair=forward,repairToSource=reverse,topology=topology,bake=bake,triangles=len(G),bounds=dict(min=Q.min(0).tolist(),max=Q.max(0).tolist()),visualReviewRequired=True)
(out/'process.json').write_text(json.dumps(record,indent=2)+'\n')
print('REPAIR_DONE',record['sha256'],flush=True)
