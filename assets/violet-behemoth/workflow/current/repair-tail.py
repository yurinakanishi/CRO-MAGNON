"""Straighten the asymmetric reconstructed tail using its retained cross sections."""
import sys,json,hashlib
from pathlib import Path
import bpy,numpy as np
R=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=R/'output/model-generation/models/violet-behemoth';sys.path.insert(0,str(M/'workflow/candidate-01'))
import blender_rig as base
source=M/'work/low-poly/revision-01/candidate.glb';out=M/'work/low-poly/revision-02';out.mkdir(parents=True,exist_ok=True);assert not (out/'candidate.glb').exists()
obj=base.import_mesh(source);P=base.positions(obj.data);Q=P.copy();rows=[]
ys=np.linspace(.32,2,70)
for y in ys:
    v=P[abs(P[:,1]-y)<.045]
    if len(v)<3:rows.append(rows[-1] if rows else [0,.7]);continue
    lo,hi=np.quantile(v[:,0],[.01,.99]);rows.append([(lo+hi)/2,max(.015,(hi-lo)/2)])
rows=np.array(rows)
for col in range(2):rows[:,col]=np.convolve(np.pad(rows[:,col],(3,3),mode='edge'),np.ones(7)/7,mode='valid')
centre=np.interp(P[:,1],ys,rows[:,0]);radius=np.interp(P[:,1],ys,rows[:,1])
t=np.clip((P[:,1]-.4)/1.6,0,1);targetRadius=.65*(1-t)**.85+.018
amount=np.clip((P[:,1]-.35)/.55,0,1);amount=amount*amount*(3-2*amount)
desired=(P[:,0]-centre)*np.minimum(1,targetRadius/radius)
Q[:,0]=P[:,0]*(1-amount)+desired*amount
obj.data.vertices.foreach_set('co',Q.astype(np.float32).ravel());obj.data.update();base.weld_and_shade(obj,angle_degrees=50)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
report={'source':str(source.relative_to(M)),'revision':'02','method':'Smooth measured cross-section recentering and taper of the single reconstructed tail; no faces or visible objects added, UV and materials retained. Body/head/forearms below y=.35 unchanged.','tailStartBlenderY':.35,'maximumDisplacementMetres':float(np.linalg.norm(Q-P,axis=1).max()),'unchangedVertices':int((np.linalg.norm(Q-P,axis=1)<1e-7).sum()),'totalVertices':len(P),'lengthMetres':float(np.ptp(Q[:,1])),'sha256':hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),'visualReviewRequired':True}
(out/'process.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
