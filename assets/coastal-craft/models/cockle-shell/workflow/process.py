import bpy, json, math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[1]
out=root/'work/revision-01'
out.mkdir(parents=True,exist_ok=True)
if (out/'candidate.glb').exists(): raise RuntimeError('Preserve completed revision')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root/'work/trellis/dense-1024.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
points=[v.co for o in meshes for v in o.data.vertices]
lo=Vector(tuple(min(v[i] for v in points) for i in range(3)));hi=Vector(tuple(max(v[i] for v in points) for i in range(3)))
scale=.16/max(hi.x-lo.x,hi.y-lo.y);centre=(lo+hi)/2
for o in meshes:
    for v in o.data.vertices:v.co=(v.co-Vector((centre.x,centre.y,lo.z)))*scale
    for p in o.data.polygons:p.use_smooth=True
    for slot in o.material_slots:
        if slot.material and slot.material.use_nodes:
            for n in slot.material.node_tree.nodes:
                if n.type=='BSDF_PRINCIPLED':n.inputs['Metallic'].default_value=0;n.inputs['Roughness'].default_value=.72
bpy.ops.export_scene.gltf(filepath=str(out/'dense-normalized.glb'),export_format='GLB',export_animations=False)
before=sum(len(o.data.polygons) for o in meshes)
for o in meshes:
    bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Source-derived QEM','DECIMATE');mod.ratio=.06
    bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=False)
(out/'process.json').write_text(json.dumps(dict(candidate=1,revision=1,denseFaces=before,faces=sum(len(o.data.polygons) for o in meshes),scale=scale,method='Uniform normalization; source-preserving QEM with original UV/PBR. No new source geometry. Reduction pending matched-view QA.',rig='Static shell; no rig'),indent=2))
