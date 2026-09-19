"""Paint the existing TRELLIS interior triangles; do not add a decal plane or new geometry."""
import bpy, os, json, math, bmesh
root=os.path.abspath('assets/camp-cave')
out=os.path.join(root,'work/revision-04')
os.makedirs(out,exist_ok=True)
target=os.path.join(out,'model.glb')
if os.path.exists(target): raise RuntimeError('Completed revision already exists')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'work/revision-02/model.glb'))
obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bpy.context.view_layer.objects.active=obj;obj.select_set(True)
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
# glTF stores separate vertices at UV seams. Join coincident positions while
# preserving the per-corner source UVs and original triangle winding.
bm=bmesh.new();bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
bm.to_mesh(obj.data);bm.free();obj.data.update()
material=obj.data.materials[0];nodes=material.node_tree.nodes;links=material.node_tree.links
bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
original=bsdf.inputs['Base Color'].links[0].from_socket
old_uv=obj.data.uv_layers.active.name
uv=nodes.new('ShaderNodeUVMap');uv.uv_map=old_uv
for n in list(nodes):
    if n.type=='TEX_IMAGE': links.new(uv.outputs['UV'],n.inputs['Vector'])
geo=nodes.new('ShaderNodeNewGeometry')
pos=nodes.new('ShaderNodeSeparateXYZ');links.new(geo.outputs['Position'],pos.inputs[0])
normal=nodes.new('ShaderNodeSeparateXYZ');links.new(geo.outputs['Normal'],normal.inputs[0])
def op(kind,a,b):
    n=nodes.new('ShaderNodeMath');n.operation=kind
    for i,v in enumerate([a,b]):
        if isinstance(v,(int,float)):n.inputs[i].default_value=v
        else:links.new(v,n.inputs[i])
    return n.outputs[0]
# glTF's +Z front is Blender's -Y after import. The mural runs front-to-back.
u=op('DIVIDE',op('ADD',pos.outputs['Y'],5.5),8)
v=op('DIVIDE',op('SUBTRACT',pos.outputs['Z'],1.4),4.3)
coord=nodes.new('ShaderNodeCombineXYZ');links.new(u,coord.inputs[0]);links.new(v,coord.inputs[1])
paint=nodes.new('ShaderNodeTexImage');paint.image=bpy.data.images.load(os.path.join(root,'source/mural-v1.png'));paint.extension='CLIP'
links.new(coord.outputs[0],paint.inputs['Vector'])
interior=op('MULTIPLY',op('LESS_THAN',pos.outputs['X'],-1.5),op('GREATER_THAN',normal.outputs['X'],.25))
ground=nodes.new('ShaderNodeMixRGB');links.new(op('MULTIPLY',interior,.62),ground.inputs[0]);links.new(original,ground.inputs[1]);ground.inputs[2].default_value=(.48,.40,.30,1)
mix=nodes.new('ShaderNodeMixRGB');links.new(op('MULTIPLY',interior,paint.outputs['Alpha']),mix.inputs[0]);links.new(ground.outputs[0],mix.inputs[1]);links.new(paint.outputs['Color'],mix.inputs[2])
emission=nodes.new('ShaderNodeEmission');links.new(mix.outputs[0],emission.inputs['Color'])
output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL');links.new(emission.outputs[0],output.inputs['Surface'])
obj.data.uv_layers.new(name='MuralBake')
obj.data.uv_layers.active_index=len(obj.data.uv_layers)-1
obj.data.uv_layers.active.active_render=True
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(68),island_margin=.006,area_weight=.2)
bpy.ops.object.mode_set(mode='OBJECT')
baked=bpy.data.images.new('Cave painted limestone',width=2048,height=2048,alpha=False)
dest=nodes.new('ShaderNodeTexImage');dest.image=baked;nodes.active=dest
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
scene.render.bake.margin=8
print('Baking pigment onto existing interior wall triangles',flush=True)
bpy.ops.object.bake(type='EMIT')
baked.filepath_raw=os.path.join(out,'painted-albedo.png');baked.file_format='PNG';baked.save()
nodes.clear();bsdf=nodes.new('ShaderNodeBsdfPrincipled');output=nodes.new('ShaderNodeOutputMaterial');tex=nodes.new('ShaderNodeTexImage');tex.image=baked
links.new(tex.outputs['Color'],bsdf.inputs['Base Color']);links.new(bsdf.outputs[0],output.inputs['Surface'])
bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Roughness'].default_value=.95
material.use_backface_culling=True
obj.data.uv_layers.remove(obj.data.uv_layers[old_uv])
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',use_selection=True,export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'painted-cave.blend'))
json.dump(dict(source='revision-02',triangles=len(obj.data.polygons),geometryAdded=False,paint='source/mural-v1.png',method='Existing interior-wall projection, emission bake to unique UV atlas'),open(os.path.join(out,'paint-report.json'),'w'),indent=2)
