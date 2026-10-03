"""Fair only reconstructed fur; transfer source colour by barycentric projection.

No replacement body or texture painting. Every surface and colour sample derives
from C2. Keep this experiment separate from both the reconstruction and repair 02.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import blender_rig as base,blender_reduce as reduce
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2'
ap=argparse.ArgumentParser();ap.add_argument('--revision',default='04');ap.add_argument('--sample-unfaired',action='store_true');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=M/f'work/low-poly/revision-{args.revision}';out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists()
source=M/'work/low-poly/revision-01/candidate.glb'
src=base.import_mesh(source);reduce.triangulate(src)
P=base.positions(src.data);F=base.mesh_triangles(src.data)
tree=reduce.bvh_from_arrays(P,F)
uv=np.array([src.data.uv_layers.active.data[i].uv[:] for p in src.data.polygons for i in p.loop_indices]).reshape(-1,3,2)
tex=next(n.image for n in src.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
pixels=np.asarray(tex.pixels[:],np.float32).reshape(tex.size[1],tex.size[0],4)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=str(M/'work/low-poly/revision-02/candidate.glb'))
obj=next(o for o in bpy.context.scene.objects if o.type=='MESH');bpy.context.view_layer.objects.active=obj
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
base.weld_and_shade(obj,angle_degrees=180)
Q0=base.positions(obj.data)
sm=lambda x:np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))
# Protect face, ear tips and paw soles; fair the source's repeated fur ridges.
face=sm((-.12-Q0[:,1])/.035)*sm((Q0[:,2]-.30)/.035)
ears=sm((Q0[:,2]-.44)/.035)*sm((.05-Q0[:,1])/.08)
feet=1-sm((Q0[:,2]-.025)/.055)
protection=np.maximum(np.maximum(face,ears),feet)
group=obj.vertex_groups.new(name='Measured fur fairing')
for i,w in enumerate(1-.99*protection):group.add([i],float(w),'REPLACE')
mod=obj.modifiers.new('Fair the reconstructed fur masses','SMOOTH');mod.factor=1;mod.iterations=240;mod.vertex_group=group.name
bpy.ops.object.modifier_apply(modifier=mod.name)
Q=base.positions(obj.data);G=base.mesh_triangles(obj.data)
# Transfer original UV colour to the new surface. This avoids ray misses and
# source/target image dependency in selected-to-active texture baking.
idx=[];hits=[];distance=[]
for p in (Q0 if args.sample_unfaired else Q):
    at,n,i,d=tree.find_nearest(Vector(p));idx.append(i);hits.append(at[:]);distance.append(d)
T=P[F[np.array(idx)]];v0=T[:,1]-T[:,0];v1=T[:,2]-T[:,0];v2=np.asarray(hits)-T[:,0]
d00=np.einsum('ij,ij->i',v0,v0);d01=np.einsum('ij,ij->i',v0,v1);d11=np.einsum('ij,ij->i',v1,v1)
d20=np.einsum('ij,ij->i',v2,v0);d21=np.einsum('ij,ij->i',v2,v1);den=np.maximum(d00*d11-d01*d01,1e-25)
v=(d11*d20-d01*d21)/den;w=(d00*d21-d01*d20)/den
bary=np.stack([1-v-w,v,w],1);sample=np.einsum('ij,ijk->ik',bary,uv[np.asarray(idx)])
xy=sample*np.array([tex.size[0]-1,tex.size[1]-1]);xy=np.clip(xy,0,np.array([tex.size[0]-1,tex.size[1]-1]))
xy0=np.floor(xy).astype(int);xy1=np.minimum(xy0+1,[tex.size[0]-1,tex.size[1]-1]);f=xy-xy0
C=(pixels[xy0[:,1],xy0[:,0]]*(1-f[:,0,None])+pixels[xy0[:,1],xy1[:,0]]*f[:,0,None])*(1-f[:,1,None])+(pixels[xy1[:,1],xy0[:,0]]*(1-f[:,0,None])+pixels[xy1[:,1],xy1[:,0]]*f[:,0,None])*f[:,1,None]
C0=C.copy();edges=np.asarray([e.vertices[:] for e in obj.data.edges]);a,b=edges[:,0],edges[:,1]
degree=np.bincount(np.r_[a,b],minlength=len(Q));strength=(1-protection)*.65
for _ in range(32):
    mean=np.stack([np.bincount(np.r_[a,b],weights=np.r_[C[b,c],C[a,c]],minlength=len(Q))/np.maximum(degree,1) for c in range(4)],1)
    C=C*(1-strength[:,None])+mean*strength[:,None]
# Image pixels are stored in sRGB; vertex colours are scene-linear.
C[:,:3]=np.where(C[:,:3]<=.04045,C[:,:3]/12.92,((C[:,:3]+.055)/1.055)**2.4)
C[:,3]=1
layer=obj.data.color_attributes.new(name='RetainedSourceColour',type='FLOAT_COLOR',domain='POINT')
layer.data.foreach_set('color',C.astype(np.float32).ravel())
material=bpy.data.materials.new('Rimo source colour');material.use_nodes=True
nodes=material.node_tree.nodes;links=material.node_tree.links;bsdf=nodes.get('Principled BSDF')
col=nodes.new('ShaderNodeVertexColor');col.layer_name=layer.name;links.new(col.outputs['Color'],bsdf.inputs['Base Color']);bsdf.inputs['Roughness'].default_value=.84
obj.data.materials.clear();obj.data.materials.append(material)
for p in obj.data.polygons:p.material_index=0;p.use_smooth=True
obj.data.use_auto_smooth=False
obj.name=obj.data.name='RimoNekoSurface'
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
np.savez_compressed(out/'surface.npz',positions=Q,faces=G)
record=dict(candidate=2,revision=int(args.revision),sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),triangles=len(G),geometryIterations=240,colourIterations=32,sampleUnfaired=args.sample_unfaired,method='Source-derived fairing and nearest-triangle barycentric colour transfer; protected face/ear/sole',fairingDistance=dict(p95=float(np.percentile(np.linalg.norm(Q-Q0,axis=1),95)),max=float(np.linalg.norm(Q-Q0,axis=1).max())),nearestSourceDistance=dict(p95=float(np.percentile(distance,95)),max=max(distance)),bounds=dict(min=Q.min(0).tolist(),max=Q.max(0).tolist()),visualReviewRequired=True)
(out/'process.json').write_text(json.dumps(record,indent=2)+'\n')
print('FAIR_DONE',record,flush=True)
