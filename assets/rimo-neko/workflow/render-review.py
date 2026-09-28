"""Re-import the exact GLB and review seven neutral/clay views, or a selected clip.

The world, camera and lights are QA only. No model geometry is added.
"""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector
ap=argparse.ArgumentParser(); ap.add_argument('glb'); ap.add_argument('out'); ap.add_argument('--clip'); ap.add_argument('--time',type=float,default=0); ap.add_argument('--clay',action='store_true'); ap.add_argument('--views',default='front,back,left,right,threequarter,top,bottom'); ap.add_argument('--size',type=int,default=640); ap.add_argument('--head',action='store_true')
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]); out=Path(args.out).resolve(); out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps=60; bpy.ops.import_scene.gltf(filepath=args.glb)
scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE'; scene.render.resolution_x=args.size; scene.render.resolution_y=args.size
scene.render.resolution_percentage=100; scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'; scene.view_settings.exposure=0
if args.clip:
    rig=next(o for o in scene.objects if o.type=='ARMATURE'); rig.animation_data_create()
    for tr in rig.animation_data.nla_tracks: tr.mute=True
    action=next(a for a in bpy.data.actions if a.name==args.clip or a.name.endswith('|'+args.clip)); rig.animation_data.action=action
    if hasattr(action,'slots') and action.slots: rig.animation_data.action_slot=action.slots[0]
    scene.render.fps=60; scene.frame_set(int(args.time*60)+1)
bpy.context.view_layer.update(); deps=bpy.context.evaluated_depsgraph_get()
has_rig=any(o.type=='ARMATURE' for o in scene.objects)
meshes=[o.evaluated_get(deps) for o in scene.objects if o.type=='MESH' and not o.hide_render and (not has_rig or o.find_armature())]
verts=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
lo=Vector([min(v[i] for v in verts) for i in range(3)]); hi=Vector([max(v[i] for v in verts) for i in range(3)])
centre=(lo+hi)/2; size=max(hi-lo)
if args.head: centre=Vector((.036,-.22,.386)); size=.24
if args.clay:
    material=bpy.data.materials.new('QA clay'); material.diffuse_color=(.52,.55,.58,1); material.use_nodes=True
    bsdf=material.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Base Color'].default_value=(.52,.55,.58,1); bsdf.inputs['Roughness'].default_value=.82
    scene.view_layers[0].material_override=material
world=bpy.data.worlds.new('Neutral'); scene.world=world; world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.74,.77,1); world.node_tree.nodes['Background'].inputs[1].default_value=.65
for name,location,power,scale in [('Key',(-2,-3,4),400,4),('Fill',(3,-1,2),190,3),('Rim',(0,3,4),250,3)]:
    light=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA')); scene.collection.objects.link(light)
    light.location=centre+Vector(location)*size; light.data.energy=power*size*size; light.data.shape='DISK'; light.data.size=scale*size
    light.rotation_euler=(centre-light.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera')); scene.collection.objects.link(cam); scene.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=size*1.24; cam.data.clip_start=.001
directions={'left':(-1,0,.04),'right':(1,0,.04),'front':(0,-1,.04),'face':(.74,-.67,.04),'back':(0,1,.04),'threequarter':(-.8,-1,.30),'top':(0,-.01,1),'bottom':(0,-.01,-1)}
for name in args.views.split(','):
    cam.location=centre+Vector(directions[name]).normalized()*size*3; cam.rotation_euler=(cam.location-centre).to_track_quat('Z','Y').to_euler()
    scene.render.filepath=str(out/f'{name}.png'); bpy.ops.render.render(write_still=True)
(out/'bounds.json').write_text(json.dumps(dict(min=list(lo),max=list(hi),clip=args.clip,time=args.time,clay=args.clay),indent=2)+'\n')
print('REVIEW_DONE',lo,hi,flush=True)
