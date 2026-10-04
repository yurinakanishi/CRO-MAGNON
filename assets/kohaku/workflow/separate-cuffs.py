"""Open the reconstruction's tiny cuff/hem bridges, keeping original surfaces."""
import hashlib,json,sys
from pathlib import Path
import bpy,bmesh,numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as base
M=ROOT/'output/model-generation/models/kohaku/work/surface';source=M/'revision-02';out=M/'revision-04';out.mkdir(parents=True,exist_ok=True)
if (out/'surface.glb').exists():raise RuntimeError('Keep earlier surface revision')
record=json.loads((source/'surface.json').read_text());H=record['heightMetres']
obj=base.import_dense(source/'surface.glb');base.weld(obj);mesh=obj.data
bm=bmesh.new();bm.from_mesh(mesh);uv=bm.loops.layers.uv.active
remove=[]
for face in bm.faces:
    p=np.array([v.co[:] for v in face.verts])/H
    d=p[:,2]+1.2*abs(p[:,0])-.56
    if d.min()<.03 and d.max()>0 and abs(p[:,0]).min()>.13 and p[:,2].max()<.415 and p[:,2].min()>.28 and p[:,1].max()<.14:
        remove.append(face)
if len(remove)>2400:raise RuntimeError('Cuff repair exceeded its local area')
boundary_before={edge for edge in bm.edges if edge.is_boundary}
bmesh.ops.delete(bm,geom=remove,context='FACES')
boundary=[edge for edge in bm.edges if edge.is_boundary and edge not in boundary_before]
new=bmesh.ops.holes_fill(bm,edges=boundary,sides=0).get('faces',[])
for face in new:
    face.smooth=True
    if uv:
        for loop in face.loops:
            other=next((l for l in loop.vert.link_loops if l.face not in new),None)
            if other:loop[uv].uv=other[uv].uv
bmesh.ops.recalc_face_normals(bm,faces=list(new));bm.to_mesh(mesh);bm.free();mesh.validate(clean_customdata=False);mesh.update();base.triangulate(obj)
obj.name='KohakuSurface';obj.data.name='KohakuSurface'
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'surface.glb'),export_format='GLB',use_selection=True,export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'surface.blend'))
P=base.positions_of(obj.data);F=base.face_array(obj.data)
record.update(sha256=hashlib.sha256((out/'surface.glb').read_bytes()).hexdigest(),triangles=len(F),cuffRepair=dict(removedBridgeFaces=len(remove),closedBoundaryLoops=len(new),source='revision-02/surface.glb',method='Separate reconstructed cuff-to-hem contact at both wrists; cap local boundaries using adjacent original UV coordinates. Rest positions are unchanged.'))
(out/'surface.json').write_text(json.dumps(record,indent=2)+'\n');np.savez_compressed(out/'surface.npz',positions=P,faces=F)
print(json.dumps(record['cuffRepair']),flush=True)
