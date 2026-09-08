"""Check reduced forehead UV samples against the dense surface; repair only proven dark atlas spills."""
import bpy,sys,json,hashlib,copy
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/'output/model-generation/models/floppy-ear-mage/work/candidate-02'
sys.path.insert(0,str(MODEL/'workflow/candidate-01'))
import blender_reduce as base
before=MODEL/'work/low-poly/revision-01';out=MODEL/'work/low-poly/revision-02';out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists()
process=json.loads((before/'process.json').read_text())
dense=base.import_dense(MODEL/process['source']['path'])
P=base.positions_of(dense.data);H=.78;P*=H/np.ptp(P[:,2]);P[:,2]-=P[:,2].min();P-=np.array(process['alignment']['initialFootCentre'])
a=np.deg2rad(process['alignment']['yawDegrees']);x=P[:,0].copy();y=P[:,1].copy();P[:,0]=x*np.cos(a)-y*np.sin(a)-process['alignment']['offsetMetres'];P[:,1]=x*np.sin(a)+y*np.cos(a)
F=base.face_array(dense.data);tree=BVHTree.FromPolygons(P.tolist(),F.tolist(),all_triangles=True)
def uv_faces(mesh):
    return np.array([[mesh.uv_layers.active.data[i].uv[:] for i in f.loop_indices] for f in mesh.polygons])
source_uv=uv_faces(dense.data)
def texture(obj):
    bsdf=next(n for n in obj.data.materials[0].node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    image=bsdf.inputs['Base Color'].links[0].from_node.image
    w,h=image.size;return np.array(image.pixels[:],dtype=np.float32).reshape(h,w,4)[:,:,:3]
source_tex=texture(dense)
def sample(tex,uv):
    h,w=tex.shape[:2];ij=np.clip(np.array(uv)*[w-1,h-1],[0,0],[w-1,h-1]).astype(int);return tex[ij[...,1],ij[...,0]]
def barycentric(p,tri):
    u,v=tri[1]-tri[0],tri[2]-tri[0];q=p-tri[0];aa=u@u;ab=u@v;bb=v@v;den=aa*bb-ab*ab
    if abs(den)<1e-18:return np.array([1.,0,0])
    b=(bb*(q@u)-ab*(q@v))/den;c=(aa*(q@v)-ab*(q@u))/den;return np.array([1-b-c,b,c])
bpy.ops.import_scene.gltf(filepath=str(before/'candidate.glb'))
obj=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o is not dense)
bpy.context.view_layer.objects.active=obj;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
Q=base.positions_of(obj.data);G=base.face_array(obj.data);UV=uv_faces(obj.data);tex=texture(obj)
probes=np.array([[1/3]*3,[.8,.1,.1],[.1,.8,.1],[.1,.1,.8]])
repairs=[];checked=0
for i,face in enumerate(G):
    centre=Q[face].mean(0)
    if centre[2]<.80*H or centre[1]>.10*H or abs(centre[0])>.22*H:continue
    checked+=1;bad=False;expected=[];hits=[]
    for weight in probes:
        point=weight@Q[face];near,normal,fi,distance=tree.find_nearest(Vector(point))
        if fi is None or distance>.003:continue
        uv=barycentric(np.array(near),P[F[fi]])@source_uv[fi];color=sample(source_tex,uv);actual=sample(tex,weight@UV[i]);expected.append(color);hits.append(uv)
        if color.min()>.45 and np.max(color-actual)>.25:bad=True
    if bad and len(hits)==len(probes) and np.min(expected)>.45:
        # A tiny erroneous forehead triangle may cross atlas islands after QEM.
        # Use its measured dense surface color/roughness location, leaving every
        # original position, face and image byte intact.
        replacement=hits[0]
        for loop in obj.data.polygons[i].loop_indices:obj.data.uv_layers.active.data[loop].uv=replacement
        repairs.append({'face':i,'centre':centre.tolist(),'previousUV':UV[i].tolist(),'denseUV':replacement.tolist()})
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
assert np.array_equal(Q,base.positions_of(obj.data));assert np.array_equal(G,base.face_array(obj.data))
report={'checkedForeheadFaces':checked,'repairedFaces':len(repairs),'repairs':repairs,'method':'Dense closest-surface UV color comparison; only dark atlas spills in otherwise cream forehead. No raster painting or geometry replacement.','positionsAndFacesUnchanged':True}
(out/'uv-repair.json').write_text(json.dumps(report,indent=2)+'\n')
process.update(revision='02',previousRevision='01',uvRepair='uv-repair.json',sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest())
(out/'process.json').write_text(json.dumps(process,indent=2)+'\n');print(json.dumps({'checked':checked,'repaired':len(repairs)}),flush=True)
