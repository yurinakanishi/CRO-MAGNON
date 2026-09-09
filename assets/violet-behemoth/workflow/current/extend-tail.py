"""User correction: keep the body, extend the existing tail by two metres."""
import sys,json,hashlib
from pathlib import Path
import bpy,numpy as np
R=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=R/'output/model-generation/models/violet-behemoth';sys.path.insert(0,str(M/'workflow/candidate-01'))
import blender_rig as base
source=M/'work/low-poly/revision-04/candidate.glb';out=M/'work/low-poly/revision-05';out.mkdir(parents=True,exist_ok=True);assert not (out/'candidate.glb').exists()
obj=base.import_mesh(source);P=base.positions(obj.data);Q=P.copy()
t=np.clip((P[:,1]-.35)/1.65,0,1)
Q[:,1]+=2*t*t*(2-t)
obj.data.vertices.foreach_set('co',Q.astype(np.float32).ravel());obj.data.update();base.weld_and_shade(obj,angle_degrees=50)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
report={'source':str(source.relative_to(M)),'revision':'05','method':'User-requested length change: continuous longitudinal extension of the retained tail surface. Body and forearms y<=.35 unchanged. No new visible geometry; UV and materials retained.','maximumDisplacementMetres':float(np.linalg.norm(Q-P,axis=1).max()),'unchangedVertices':int((np.linalg.norm(Q-P,axis=1)<1e-7).sum()),'totalVertices':len(P),'lengthMetres':float(np.ptp(Q[:,1])),'heightMetres':float(np.ptp(Q[:,2])),'sha256':hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),'visualReviewRequired':True}
(out/'process.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
