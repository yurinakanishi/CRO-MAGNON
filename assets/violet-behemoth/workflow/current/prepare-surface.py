"""Measured source-preserving reduction and rigid alignment of new playable assets."""
import argparse, hashlib, json, sys
from pathlib import Path
import bpy, numpy as np

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
p=argparse.ArgumentParser();p.add_argument('key');p.add_argument('--revision',default='01');args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
model=ROOT/'output/model-generation/models'/args.key;spec=json.loads((model/'request-spec.json').read_text(encoding='utf-8'));H=1.6
sys.path.insert(0,str(model/'workflow/candidate-01'))
import blender_reduce as base
import blender_rig as rig
selected=json.loads((model/'work/trellis/selected-dense.json').read_text(encoding='utf-8'));dense=model/selected['path']
out=model/f'work/low-poly/revision-{args.revision}';out.mkdir(parents=True,exist_ok=True);assert not (out/'candidate.glb').exists()
source=base.import_dense(dense);weld=base.weld(source);base.triangulate(source)
P=base.positions_of(source.data);F=base.face_array(source.data);denseVertexCount=len(P);height=float(np.ptp(P[:,2]));H=float(height/np.ptp(P[:,1])*spec['bodyDraftLengthMetres']);metres=H/height
tree=base.bvh_from_arrays(P,F);samples=base.sample_surface(P,F,18000,17);centres=P[F].mean(1)
detailMask=(centres[:,2]>P[:,2].min()+.76*height)|(abs(centres[:,0])>.25*height)
detail=base.sample_surface(P,F[detailMask],10000,18)
feet=base.sample_surface(P,F[centres[:,2]<P[:,2].min()+.12*height],4000,19)
denoise=base.feature_weighted_taubin(source,4,.55,-.56,.16,.0007,height)
trials=[];chosen=None
def metric(points,tree):
    data=base.deviation(points,tree,height)
    return {n:data[n+'_units']*metres for n in ['p95','rms','max']}
for ratio in [.08,.14,.23,.36,.55,.8,1.0]:
    trial=source.copy();trial.data=source.data.copy();bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT');trial.select_set(True);bpy.context.view_layer.objects.active=trial
    if ratio<1:
        mod=trial.modifiers.new('SourceSurfaceQEM','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    base.triangulate(trial);trial.data.validate(clean_customdata=False);trial.data.update();Q=base.positions_of(trial.data);G=base.face_array(trial.data);qtree=base.bvh_from_arrays(Q,G)
    forward=metric(samples,qtree);reverse=metric(base.sample_surface(Q,G,18000,20),tree);head=metric(detail,qtree);foot=metric(feet,qtree)
    passed=max(forward['p95'],reverse['p95'])<=H*.00085 and head['p95']<=H*.00065 and foot['p95']<=H*.00085 and max(forward['max'],reverse['max'])<=H*.0045
    trials.append(dict(ratio=ratio,triangles=len(G),denseToReduced=forward,reducedToDense=reverse,head=head,feet=foot,passed=passed));print(json.dumps(trials[-1]),flush=True)
    if passed:chosen=trial;break
    mesh=trial.data;bpy.data.objects.remove(trial,do_unlink=True);bpy.data.meshes.remove(mesh)
assert chosen is not None
mesh=source.data;bpy.data.objects.remove(source,do_unlink=True);bpy.data.meshes.remove(mesh)
topology=rig.weld_and_shade(chosen,angle_degrees=50)
P=base.positions_of(chosen.data)*H/np.ptp(base.positions_of(chosen.data)[:,2]);P[:,2]-=P[:,2].min()
origin=np.array([(P[:,0].min()+P[:,0].max())/2,(P[:,1].min()+P[:,1].max())/2,0]);P-=origin
cloud=P[(P[:,2]>.22*H)&(P[:,2]<(.53 if args.key=='desert-fennec-mage' else .76)*H)]
rng=np.random.default_rng(901);cloud=cloud[rng.choice(len(cloud),min(len(cloud),10000),replace=False)]
def rotate(q,angle,offset):
    c,s=np.cos(angle),np.sin(angle);r=q.copy();r[:,0]=q[:,0]*c-q[:,1]*s-offset;r[:,1]=q[:,0]*s+q[:,1]*c;return r
def score(angle,offset):
    q=rotate(cloud,np.deg2rad(angle),offset);v=.012*H;k=np.floor(q/v).astype(np.int64);o=k.copy();o[:,0]=np.floor(-q[:,0]/v).astype(np.int64)
    pack=lambda x:np.unique((x[:,0]+400)*1000000+(x[:,1]+400)*1000+x[:,2]+400)
    a,b=pack(k),pack(o);return len(np.intersect1d(a,b))/len(np.union1d(a,b))
best=max((score(a,o),a,o) for a in np.arange(-30,30.1,3) for o in np.arange(-.025,.026,.01)*H)
best=max((score(a,o),a,o) for a in np.arange(best[1]-3,best[1]+3.01,.5) for o in np.arange(best[2]-.005*H,best[2]+.0051*H,.0025*H))
P=rotate(P,np.deg2rad(best[1]),best[2]);P*=spec['bodyDraftLengthMetres']/np.ptp(P[:,1]);P[:,1]-=(P[:,1].min()+P[:,1].max())/2;H=float(np.ptp(P[:,2]));chosen.data.vertices.foreach_set('co',P.astype(np.float32).ravel());chosen.data.update();chosen.name=spec['key'];chosen.data.name=spec['key']+'Surface'
for material in chosen.data.materials:
    if not material or not material.use_nodes:continue
    bsdf=next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if bsdf:
        for link in list(material.node_tree.links):
            if link.to_socket in [bsdf.inputs['Metallic'],bsdf.inputs['Roughness']]:material.node_tree.links.remove(link)
        bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Roughness'].default_value=.48
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_apply=False)
report=dict(candidate=1,revision=args.revision,source=selected,sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),
    heightMetres=H,denseTriangles=len(F),denseWeldedVertices=denseVertexCount,triangles=len(base.face_array(chosen.data)),weld=weld,topology=topology,
    denoise=denoise,denoiseMaxMetres=denoise['max_displacement_units']*metres,denoiseRmsMetres=denoise['rms_displacement_units']*metres,
    tolerances={'surfaceP95':H*.00085,'headP95':H*.00065,'surfaceMax':H*.0045},trials=trials,
    alignment={'uniformHeightMetres':H,'yawDegrees':float(best[1]),'offsetMetres':float(best[2]),'symmetryScore':float(best[0]),'initialFootCentre':origin.tolist()},
    boundsBlender={'min':P.min(0).tolist(),'max':P.max(0).tolist()},sourceUvAndAlbedoPreserved=True,metallic=0,roughness=.7,visualReviewRequired=True)
(out/'process.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
