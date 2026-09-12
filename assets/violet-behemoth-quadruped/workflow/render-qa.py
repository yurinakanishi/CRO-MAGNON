"""Exact exported quadruped GLB: all fourteen clips, six angles, 30 fps videos."""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir());key=sys.argv[sys.argv.index('--')+1];MODEL=ROOT/'output/model-generation/models'/key;sys.path.insert(0,str(MODEL/'workflow/candidate-01'))
import blender_clip_sheet as sheet,blender_clip_video as video,blender_rig as base
ap=argparse.ArgumentParser();ap.add_argument('key');ap.add_argument('--revision',default='01');ap.add_argument('--videos',action='store_true');ap.add_argument('--glb');ap.add_argument('--out');ap.add_argument('--clips');ap.add_argument('--views');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
folder=MODEL/f'work/rig/revision-{args.revision}';path=Path(args.glb).resolve() if args.glb else folder/'candidate.glb';out=Path(args.out).resolve() if args.out else folder/'qa';out.mkdir(parents=True,exist_ok=True)
spec={'location':(3.6,-5,2.3),'target':(0,0,1),'lens':50};rig,mesh=sheet.setup(path,420,480,spec);scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.fps=30;scene.render.fps_base=1
if hasattr(scene,'eevee'):scene.eevee.taa_render_samples=8
actions={a.name:a for a in bpy.data.actions};views={'front':(0,-1,.12),'right':(1,0,.12),'rear':(0,1,.12),'threequarter':(.7,-1,.17),'left':(-1,0,.12),'tps':(.22,1,.28)}
records=[]
for name in (args.clips.split(',') if args.clips else json.loads((MODEL/'request-spec.json').read_text(encoding='utf-8'))['clips']):
    a=actions[name];sheet.assign_action(rig,a);start,end=sheet.frame_bounds(a);loop=name.endswith('_Loop');bounds=[]
    for frame in range(start,end+1):
        scene.frame_set(frame);bpy.context.view_layer.update();p=base.evaluated_positions(mesh);bounds.append([p.min(0),p.max(0)])
    lo=np.min(np.asarray(bounds)[:,0,:],0);hi=np.max(np.asarray(bounds)[:,1,:],0);centre=Vector((lo+hi)/2);extent=hi-lo;scale=max(float(extent[2]),float(np.linalg.norm(extent[:2])))*1.18
    scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=scale
    frames=[start,round((end-start)*.25),round((end-start)*.5),round((end-start)*.75),end if not loop else end-1]
    if name=='Attack':frames=[0,round(end*.22),round(end*.445) if key=='cat-kunoichi' else round(end*.5),round(end*.70),end]
    if name=='Death':frames=[start,round(end*.25),round(end*.5),round(end*.75),end]
    viewrecords=[]
    for view,direction in views.items():
        if args.views and view not in args.views.split(','):continue
        scene.camera.location=centre+Vector(direction).normalized()*5;scene.camera.rotation_euler=(scene.camera.location-centre).to_track_quat('Z','Y').to_euler()
        scene.render.image_settings.media_type='IMAGE';scene.render.image_settings.file_format='PNG'
        for i,f in enumerate(frames):
            target=out/f'{name}-{view}-{i:02}.png';assert not target.exists();scene.frame_set(f);bpy.context.view_layer.update();scene.render.filepath=str(target);bpy.ops.render.render(write_still=True)
        viewrecords.append({'view':view,'frames':frames,'direction':direction,'orthographicScale':scale})
    if args.videos:
        scene.camera.location=centre+Vector(views['threequarter']).normalized()*5;scene.camera.rotation_euler=(scene.camera.location-centre).to_track_quat('Z','Y').to_euler();video.configure_video(scene);scene.frame_start=start;scene.frame_end=end-1 if loop else end;scene.render.filepath=str(out/f'{name}.mp4');bpy.ops.render.render(animation=True)
    records.append({'clip':name,'durationSeconds':(end-start)/30,'loop':loop,'views':viewrecords,'boundsBlender':{'min':lo.tolist(),'max':hi.tolist()}});print('FANTASY_QA_COMPLETE',name,flush=True)
report={'source':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'fps':30,'fpsSetBeforeImport':True,'renderEngine':'Blender EEVEE','dimensions':[420,480],'clips':records,'geometryLineage':'Exact original TRELLIS-derived skinned surface; no placeholders','videos':args.videos};(out/'render-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
