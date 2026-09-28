"""Exact delivery review: seven material/clay views and motion contact frames."""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
ap=argparse.ArgumentParser();ap.add_argument('source');ap.add_argument('out');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=120;bpy.ops.import_scene.gltf(filepath=args.source)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.fps=120
scene.render.resolution_x=640;scene.render.resolution_y=760;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data_create()
for t in rig.animation_data.nla_tracks:t.mute=True
meshes=[o for o in scene.objects if o.type=='MESH'];saved=[list(o.data.materials) for o in meshes]
clay=bpy.data.materials.new('QA Clay');clay.diffuse_color=(.55,.58,.6,1);clay.use_nodes=True
clay.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.55,.58,.6,1)
clay.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8
def materials(isClay):
    for o,original in zip(meshes,saved):
        o.data.materials.clear()
        for m in original:o.data.materials.append(clay if isClay else m)
world=bpy.data.worlds.new('Neutral');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.74,.77,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.65
centre=Vector((0,.04,.79));size=1.55
for name,loc,power,scale in [('Key',(-2,-3,4),400,4),('Fill',(3,-1,2),190,3),('Rim',(0,3,4),250,3)]:
    o=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));scene.collection.objects.link(o)
    o.location=centre+Vector(loc)*size;o.data.energy=power*size*size;o.data.shape='DISK';o.data.size=scale*size
    o.rotation_euler=(centre-o.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera'));scene.collection.objects.link(cam);scene.camera=cam
cam.data.type='ORTHO';cam.data.ortho_scale=1.91;cam.data.clip_start=.001
directions={'front':(0,-1,.04),'back':(0,1,.04),'left':(-1,0,.04),'right':(1,0,.04),'threequarter':(-.8,-1,.2),'top':(0,-.01,1),'bottom':(0,-.01,-1)}
def view(name,target=centre):
    cam.location=target+Vector(directions[name]).normalized()*4.65
    cam.rotation_euler=(cam.location-target).to_track_quat('Z','Y').to_euler()
def pose(name,time):
    a=next(a for a in bpy.data.actions if a.name==name or a.name.endswith('|'+name))
    rig.animation_data.action=a
    if a.slots:rig.animation_data.action_slot=a.slots[0]
    frame=time*120+1;scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
def render(path):
    path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
pose('Idle_Loop',0)
for isClay in [False,True]:
    materials(isClay)
    for name in directions:view(name);render(out/('clay' if isClay else 'normal')/(name+'.png'))
materials(False)
plan={'Walk_Loop':[0,.279,.558,.838],'Run_Loop':[0,.183,.367,.55],
      'Attack':[.2,.4,.67],'Gather':[.67,.86],'Craft':[.6,1.3],
      'Give':[.4,.6],'Eat':[.6,1.0],'Wave':[.6,1.2],'Downed':[.2,.65,1.35,1.8]}
for clip,times in plan.items():
    for time in times:
        pose(clip,time)
        for name in ['threequarter','left']:
            view(name);render(out/'motion'/clip/f'{time:.3f}-{name}.png')
# Actual model portrait, rendered directly; no pasted illustration/edited photo.
pose('Idle_Loop',.2);view('front',Vector((0,.035,1.18)))
scene.render.resolution_x=420;scene.render.resolution_y=480;cam.data.ortho_scale=.91
scene.render.film_transparent=True;render(out/'portrait.png')
(out/'render-manifest.json').write_text(json.dumps(dict(source=args.source,staticViews=14,
    motionFrames=sum(len(t) for t in plan.values())*2,motionTimes=plan,portrait='portrait.png'),indent=2)+'\n')
print('SUITE_DONE',flush=True)
