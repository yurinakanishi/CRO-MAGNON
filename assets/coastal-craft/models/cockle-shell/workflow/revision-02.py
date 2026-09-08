import bpy,bmesh,json
from pathlib import Path
root=Path(__file__).resolve().parents[1];out=root/'work/revision-02';out.mkdir(parents=True,exist_ok=True)
if (out/'candidate.glb').exists():raise RuntimeError('Preserve completed revision')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root/'work/revision-01/dense-normalized.glb'))
reports=[]
for o in [o for o in bpy.context.scene.objects if o.type=='MESH']:
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bm=bmesh.new();bm.from_mesh(o.data);before=len(bm.verts)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));after=len(bm.verts)
    bm.to_mesh(o.data);bm.free();o.data.update()
    if o.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
    mod=o.modifiers.new('Welded source QEM','DECIMATE');mod.ratio=.12;bpy.ops.object.modifier_apply(modifier=mod.name)
    for f in o.data.polygons:f.use_smooth=True
    o.data.use_auto_smooth=True;o.data.auto_smooth_angle=1.0472
    reports.append(dict(verticesBeforeWeld=before,verticesAfterWeld=after,faces=len(o.data.polygons)))
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=False)
(out/'process.json').write_text(json.dumps(dict(candidate=1,revision=2,fix='Revision 01 cracked at unwelded UV seams under decimation and is rejected. Weld only positions within 0.1 micrometre before source-derived QEM; preserve loop UVs; recalculate normals with 60 degree crease threshold.',meshes=reports),indent=2))
