import bpy,bmesh,json
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[1];out=root/'work/revision-01';out.mkdir(parents=True,exist_ok=True)
if (out/'candidate.glb').exists():raise RuntimeError('Preserve completed revision')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root/'work/trellis/dense-1024.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
points=[v.co for o in meshes for v in o.data.vertices]
lo=Vector(tuple(min(v[i] for v in points) for i in range(3)));hi=Vector(tuple(max(v[i] for v in points) for i in range(3)));centre=(lo+hi)/2
scale=1.5/max(hi.x-lo.x,hi.y-lo.y)
for o in meshes:
    for v in o.data.vertices:v.co=(v.co-Vector((centre.x,centre.y,lo.z)))*scale
    for slot in o.material_slots:
        if slot.material and slot.material.use_nodes:
            for n in slot.material.node_tree.nodes:
                if n.type=='BSDF_PRINCIPLED':n.inputs['Metallic'].default_value=0;n.inputs['Roughness'].default_value=.82
bpy.ops.export_scene.gltf(filepath=str(out/'dense-normalized.glb'),export_format='GLB',export_animations=False)
reports=[]
for o in meshes:
    bpy.context.view_layer.objects.active=o
    bm=bmesh.new();bm.from_mesh(o.data);before=len(bm.verts);facesBefore=len(bm.faces)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));after=len(bm.verts);bm.to_mesh(o.data);bm.free();o.data.update()
    if o.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
    mod=o.modifiers.new('Welded source QEM','DECIMATE');mod.ratio=.32;bpy.ops.object.modifier_apply(modifier=mod.name)
    for f in o.data.polygons:f.use_smooth=True
    o.data.use_auto_smooth=True;o.data.auto_smooth_angle=1.0472
    reports.append(dict(verticesBeforeWeld=before,verticesAfterWeld=after,denseFaces=facesBefore,faces=len(o.data.polygons)))
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=False)
points=[v.co for o in meshes for v in o.data.vertices]
(out/'process.json').write_text(json.dumps(dict(candidate=1,revision=1,scale=scale,maxHorizontalRadius=max((v.x*v.x+v.y*v.y)**.5 for v in points),height=max(v.z for v in points),method='Uniform normalization, coincident-position weld within 1 micrometre, source-derived QEM preserving UVs, 60 degree crease normals. Shells and substrate come entirely from TRELLIS.',meshes=reports),indent=2))
