"""A separate, UV-preserving fairing experiment on C2's original surface."""
import hashlib,json,sys
from pathlib import Path
import bpy,numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import blender_rig as base
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2';out=M/'work/low-poly/revision-05';out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists()
obj=base.import_mesh(M/'work/low-poly/revision-01/candidate.glb');base.weld_and_shade(obj,angle_degrees=180)
P=base.positions(obj.data);sm=lambda x:np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))
face=sm((-.14-P[:,1])/.035)*sm((P[:,2]-.31)/.028)*(1-sm((P[:,2]-.43)/.025))
ears=sm((P[:,2]-.445)/.033)*sm((.03-P[:,1])/.06);feet=1-sm((P[:,2]-.023)/.045)
protection=np.maximum(np.maximum(face,ears),feet)
g=obj.vertex_groups.new(name='Keep face ears soles')
for i,w in enumerate(1-.985*protection):g.add([i],float(w),'REPLACE')
mod=obj.modifiers.new('Round source fur clumps','SMOOTH');mod.factor=.8;mod.iterations=45;mod.vertex_group=g.name
bpy.ops.object.modifier_apply(modifier=mod.name)
obj.data.use_auto_smooth=False
for p in obj.data.polygons:p.use_smooth=True
Q=base.positions(obj.data);F=base.mesh_triangles(obj.data)
obj.name=obj.data.name='RimoNekoSurface'
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
np.savez_compressed(out/'surface.npz',positions=Q,faces=F)
(out/'process.json').write_text(json.dumps(dict(candidate=2,revision=5,sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),triangles=len(F),iterations=45,method='Round source fur geometry; retain original UV and texture; protected face/ears/soles',displacement=dict(p95=float(np.percentile(np.linalg.norm(Q-P,axis=1),95)),max=float(np.linalg.norm(Q-P,axis=1).max())),visualReviewRequired=True),indent=2)+'\n')
