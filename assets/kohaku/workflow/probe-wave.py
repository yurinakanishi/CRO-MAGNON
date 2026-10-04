import sys,numpy as np,bpy
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
revision=sys.argv[-1] if '--' in sys.argv else '01'
M=ROOT/f'output/model-generation/models/kohaku/work/rig/revision-{revision}'
bpy.ops.wm.open_mainfile(filepath=str(M/'source.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
rig.animation_data_create();action=bpy.data.actions.get('Wave');rig.animation_data.action=action
if hasattr(action,'slots') and action.slots:rig.animation_data.action_slot=action.slots[0]
bpy.context.scene.frame_set(54);bpy.context.view_layer.update()
data=np.load(M/'rig-surface.npz');P=data['positions'];F=data['faces'];W=data['weights'];names=data['bones']
eval=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=eval.to_mesh();Q=np.array([v.co[:] for v in mesh.vertices]);eval.to_mesh_clear()
edges=np.concatenate([F[:,[0,1]],F[:,[1,2]],F[:,[2,0]]]);length=np.linalg.norm(P[edges[:,0]]-P[edges[:,1]],axis=1)
ratio=np.linalg.norm(Q[edges[:,0]]-Q[edges[:,1]],axis=1)/np.maximum(length,1e-9)
for k in np.argsort(-ratio)[:24]:
 a,b=edges[k];print('EDGE',int(a),int(b),'RATIO',round(float(ratio[k]),2),'ORIGINAL',(P[[a,b]]/.519978684).round(4).tolist(),flush=True)
 for v in [a,b]:print('WEIGHTS',[(str(names[j]),round(float(W[v,j]),3)) for j in np.argsort(-W[v])[:4]],flush=True)
