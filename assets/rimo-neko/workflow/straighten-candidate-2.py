"""Rebase C2's existing neck and tail to a forward, centred rest shape.

The face moves rigidly. A smooth neck transition and centreline-based lateral
tail correction retain the source triangles, UVs, texture and skin weights.
"""
import argparse, copy, hashlib, json, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, Quaternion
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import blender_rig as base
ap=argparse.ArgumentParser();ap.add_argument('--revision',default='01')
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2'
prior=M/'work/rig/revision-02';out=M/f'work/straightening/revision-{args.revision}'
out.mkdir(parents=True,exist_ok=True);assert not (out/'source.blend').exists()
bpy.ops.wm.open_mainfile(filepath=str(prior/'source.blend'))
obj=bpy.data.objects['RimoNekoSurface'];rig=obj.find_armature();rig.animation_data_clear()
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
base.rest_pose(rig)
cached=np.load(prior/'binding.npz');P=base.positions(obj.data);W=cached['weights'];names=cached['names'].tolist()
assert np.max(np.abs(P-cached['positions']))<1e-8
old=json.loads((prior/'process.json').read_text());marks=json.loads((M/'qa/face-landmarks.json').read_text())
measured=json.loads((M/'qa/straightening-20261003/measurements.json').read_text())
angle=math.radians(measured['headYawCorrectionDegrees']);pivot=np.asarray(marks['headCentre']['at'])
rot=Quaternion((0,0,1),angle);R=np.array([[math.cos(angle),-math.sin(angle),0],[math.sin(angle),math.cos(angle),0],[0,0,1.]])
eye=np.asarray(measured['eyeMidpoint']);shift=np.array([-(pivot+R@(eye-pivot))[0],0,0])
smooth=lambda x:np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))

def head_field(points):
    g=smooth((points[:,2]-.200)/.115)*(1-smooth((points[:,1]-.065)/.110))
    face=smooth((-.115-points[:,1])/.040)*smooth((points[:,2]-.230)/.055)
    g=1-(1-g)*(1-face)
    v=points-pivot;c=np.cos(angle*g);s=np.sin(angle*g)
    result=v.copy();result[:,0]=c*v[:,0]-s*v[:,1];result[:,1]=s*v[:,0]+c*v[:,1]
    return result+pivot+g[:,None]*shift,g

Q,headWeight=head_field(P)
tail=np.asarray([marks[f'tail{i}']['at'] for i in range(6)])
target=tail.copy();target[:,0]=0
tailRot=[]
for i in range(5):
    q=Vector(tail[i+1]-tail[i]).rotation_difference(Vector(target[i+1]-target[i]))
    if q.w<0:q.negate()
    tailRot.append(q)
# A continuous field avoids amplifying small differences in existing skin
# weights between neighbouring fur tips. Y/Z and each cross section are retained.
baseOffset=tail[0,0]+np.clip((P[:,1]-tail[0,1])/(tail[1,1]-tail[0,1]),0,1)*(tail[1,0]-tail[0,0])
upperOffset=np.interp(P[:,2],tail[1:,2],tail[1:,0])
rise=smooth((P[:,2]-tail[1,2])/(tail[2,2]-tail[1,2]))
offset=(1-rise)*baseOffset+rise*upperOffset
tailAmount=smooth((P[:,1]-.130)/.085)*smooth((P[:,2]-.10)/.080)
tw=tailAmount[:,None]
Q[:,0]-=tailAmount*offset
assert np.isfinite(Q).all()
obj.data.vertices.foreach_set('co',Q.astype(np.float32).ravel());obj.data.update()
# Correct only the relevant rest bones; torso and the four legs keep their anchors.
plan=copy.deepcopy(old['bonePlan']);before={b.name:b.matrix_local.copy() for b in rig.data.bones}
headBones={'Head','PetContact','Jaw','Ear.L','Ear.R'}
newMarks=copy.deepcopy(marks)
for key,value in newMarks.items():
    if key.startswith('tail'):value['at']=target[int(key[4:])].tolist()
    elif key in ['spineCentre','hipCentre','chestCentre']:continue
    else:
        value['at']=(pivot+R@(np.asarray(value['at'])-pivot)+shift).tolist()
        if 'normal' in value:value['normal']=(R@np.asarray(value['normal'])).tolist()
for item in plan:
    name=item[0]
    if name in headBones:
        item[1]=(pivot+R@(np.asarray(item[1])-pivot)+shift).tolist()
        item[2]=(pivot+R@(np.asarray(item[2])-pivot)+shift).tolist()
    elif name=='Neck':item[1]=newMarks['neckCentre']['at'];item[2]=newMarks['headCentre']['at']
    elif name=='Chest':item[2]=newMarks['neckCentre']['at']
    elif name.startswith('Tail'):
        i=int(name[4:])-1;item[1]=target[i].tolist();item[2]=target[i+1].tolist()
bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
for name,a,b,parent,connected in plan:
    eb=rig.data.edit_bones[name];eb.head=a;eb.tail=b
    q=rot if name in headBones else tailRot[int(name[4:])-1] if name.startswith('Tail') else Quaternion((1,0,0,0))
    eb.align_roll(q@before[name].to_3x3().col[2])
bpy.ops.object.mode_set(mode='OBJECT');base.rest_pose(rig);bpy.context.view_layer.update()
F=base.mesh_triangles(obj.data)
edges=np.asarray([e.vertices[:] for e in obj.data.edges]);length=np.linalg.norm(P[edges[:,1]]-P[edges[:,0]],axis=1)
ratios=np.linalg.norm(Q[edges[:,1]]-Q[edges[:,0]],axis=1)/np.maximum(length,1e-12)
face=(headWeight==1)&(tw.sum(1)==0)
expected=(P-pivot)@R.T+pivot+shift
stats=dict(request='Face forward and tail centred, retaining the selected C2 surface',
    sourceSha256=hashlib.sha256((prior/'candidate.glb').read_bytes()).hexdigest(),
    headYawCorrectionDegrees=measured['headYawCorrectionDegrees'],headTranslationMetres=shift.tolist(),
    oldTailCentres=tail.tolist(),newTailCentres=target.tolist(),
    rigidFaceVertices=int(face.sum()),maximumRigidFaceError=float(np.max(np.linalg.norm(Q[face]-expected[face],axis=1))),
    vertexCount=len(P),triangles=len(F),movedVertices=int(np.sum(np.linalg.norm(Q-P,axis=1)>1e-7)),
    fixedSoleVertices=int(np.sum(P[:,2]<.10)),maximumSoleChange=float(np.max(np.linalg.norm(Q[P[:,2]<.10]-P[P[:,2]<.10],axis=1))),
    edgeLengthRatioQuantiles=np.quantile(ratios,[0,.01,.5,.99,1]).tolist(),
    method='Rigid face yaw and centring with broad smooth neck transition; continuous lateral centreline correction retaining tail Y/Z and cross sections',
    topologyUvImageAndWeightsRetained=True)
print('CORRECTION_MEASURED',json.dumps(stats),flush=True)
assert stats['maximumRigidFaceError']<1e-10 and stats['maximumSoleChange']<1e-10
np.savez_compressed(out/'binding.npz',positions=base.positions(obj.data),weights=W,names=np.asarray(names),bonePlan=json.dumps(plan))
np.savez_compressed(out/'correction.npz',before=P,after=base.positions(obj.data),headWeight=headWeight,tailWeight=tw)
record=copy.deepcopy(old);record.update(revision='straightening-'+args.revision,bonePlan=plan,straightening=stats,
    heightMetres=float(np.ptp(Q[:,2])),widthMetres=float(np.ptp(Q[:,0])),lengthMetres=float(np.ptp(Q[:,1])))
record['mouthRepair'].update(sourceLipCentre=newMarks['mouth']['at'],side=(R@np.asarray(old['mouthRepair']['side'])).tolist(),
    forward=(R@np.asarray(old['mouthRepair']['forward'])).tolist(),up=(R@np.asarray(old['mouthRepair']['up'])).tolist())
(out/'landmarks.json').write_text(json.dumps(newMarks,indent=2)+'\n')
(out/'process.json').write_text(json.dumps(record,indent=2)+'\n')
base.export(out/'candidate.glb',[]);bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
(out/'correction.json').write_text(json.dumps(stats,indent=2)+'\n')
print('STRAIGHTENED',json.dumps(stats),flush=True)
