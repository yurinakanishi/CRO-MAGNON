import bpy,bmesh,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1];repo=root.parents[3];source=repo/'public/models/flint-spear/model.glb'
out=root/'work/revision-02';out.mkdir(parents=True,exist_ok=True)
if (out/'candidate.glb').exists():raise RuntimeError('Preserve completed revision')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source));reports=[]
for o in [o for o in bpy.context.scene.objects if o.type=='MESH']:
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bm=bmesh.new();bm.from_mesh(o.data);before=len(bm.verts)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);after=len(bm.verts)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(0,0,.90),plane_no=(0,0,1),clear_outer=True,clear_inner=False)
    boundary=[e for e in bm.edges if e.is_boundary and all(abs(v.co.z-.90)<.00002 for v in e.verts)]
    fill=bmesh.ops.holes_fill(bm,edges=boundary,sides=0) if boundary else {'faces':[]}
    for f in fill['faces']:f.material_index=0
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
    if o.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for f in o.data.polygons:f.use_smooth=True
    o.data.use_auto_smooth=True;o.data.auto_smooth_angle=1.0472
    reports.append(dict(verticesBefore=before,verticesAfterWeld=after,faces=len(o.data.polygons),capFaces=len(fill['faces'])))
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=False)
(out/'process.json').write_text(json.dumps(dict(candidate=1,revision=2,source=str(source.relative_to(repo)),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),fix='Revision 01 recalculated normals on disconnected UV islands and produced backface gaps. Weld coincident source positions first. Retain shaft below Y .90m, remove head/binding, close only measured cut boundary and recalculate connected 60-degree normals.',meshes=reports),indent=2))
