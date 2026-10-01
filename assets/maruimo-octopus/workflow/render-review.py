"""Render the exact reimported GLB; review objects are never exported as assets."""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

p=argparse.ArgumentParser()
p.add_argument('--input',required=True)
p.add_argument('--output',required=True)
p.add_argument('--views',default='front,back,left,right,top,bottom,threequarter')
p.add_argument('--clay',action='store_true')
p.add_argument('--clip')
p.add_argument('--time',type=float,default=0)
p.add_argument('--portrait',action='store_true')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(args.output).resolve()
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(args.input).resolve()))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in bpy.context.scene.objects:
    if o.animation_data: o.animation_data.action=None
if args.clip:
    action=next((a for a in bpy.data.actions if a.name==args.clip or a.name.endswith('|'+args.clip) or a.name.startswith(args.clip+'_')),None)
    assert action is not None, (args.clip,[a.name for a in bpy.data.actions])
    for o in bpy.context.scene.objects:
        if o.type=='ARMATURE':
            o.animation_data_create()
            o.animation_data.action=action
    frame=args.time*bpy.context.scene.render.fps
    bpy.context.scene.frame_set(math.floor(frame),subframe=frame%1)
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get()
points=[o.matrix_world@v.co for o in meshes for v in o.evaluated_get(deps).data.vertices]
lo=Vector([min(q[i] for q in points) for i in range(3)])
hi=Vector([max(q[i] for q in points) for i in range(3)])
center=(lo+hi)/2
span=hi-lo
if args.clay:
    mat=bpy.data.materials.new('Review clay')
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(.38,.48,.55,1)
    bsdf.inputs['Roughness'].default_value=.8
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mat)
        for f in o.data.polygons: f.material_index=0
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.eevee.use_gtao=True
scene.eevee.gtao_distance=.18*span.z
scene.eevee.gtao_factor=1.15
scene.eevee.taa_render_samples=48
scene.render.resolution_x=1000
scene.render.resolution_y=1000
if args.portrait:
    scene.render.resolution_x=420
    scene.render.resolution_y=480
scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Review world')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.83,.86,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
scene.view_settings.view_transform='Standard'
scene.view_settings.look='Medium High Contrast'
scene.view_settings.exposure=0
scene.view_settings.gamma=1
for name,offset,power,size in [('Key',(-3,-4,5),550,4),('Fill',(4,-2,3),320,3),('Rim',(1,4,4),500,3)]:
    light=bpy.data.lights.new(name,'AREA')
    light.energy=power
    light.size=size
    obj=bpy.data.objects.new(name,light)
    scene.collection.objects.link(obj)
    obj.location=center+Vector(offset)*span.z
    obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler()
camera=bpy.data.objects.new('ReviewCamera',bpy.data.cameras.new('ReviewCamera'))
scene.collection.objects.link(camera)
scene.camera=camera
camera.data.type='ORTHO'
camera.data.clip_end=200
camera.data.ortho_scale=max(span.z,span.x*scene.render.resolution_y/scene.render.resolution_x)*1.12
views={'front':(0,-1,0),'back':(0,1,0),'left':(1,0,0),'right':(-1,0,0),'top':(0,0,1),'bottom':(0,0,-1),'threequarter':(1,-1,.35)}
for name in args.views.split(','):
    direction=Vector(views[name]).normalized()
    rotation=(-direction).to_track_quat('-Z','Y')
    right=rotation@Vector((1,0,0));up=rotation@Vector((0,1,0))
    xr=[q.dot(right) for q in points];yr=[q.dot(up) for q in points]
    target=center+right*((min(xr)+max(xr))/2-center.dot(right))+up*((min(yr)+max(yr))/2-center.dot(up))
    camera.data.ortho_scale=max(max(yr)-min(yr),(max(xr)-min(xr))*scene.render.resolution_y/scene.render.resolution_x)*1.12
    camera.location=target+direction*max(span)*4
    camera.rotation_euler=rotation.to_euler()
    scene.render.filepath=str(out/(name+('-clay' if args.clay else '')+'.png'))
    bpy.ops.render.render(write_still=True)
(out/('bounds-clay.json' if args.clay else 'bounds.json')).write_text(json.dumps(dict(min=list(lo),max=list(hi)),indent=2))
