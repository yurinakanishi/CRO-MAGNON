"""Bounded C1 fur polish, preserving UV, texture, skin, skeleton and motion bytes.

Modify only position/normal accessor bytes and fur roughness. Never re-export
animation through a DCC. Protect the face, jaw and paw soles from displacement.
"""
import argparse,hashlib,json,struct
from pathlib import Path
import numpy as np
ap=argparse.ArgumentParser();ap.add_argument('source');ap.add_argument('output');ap.add_argument('--millimetres',type=float,default=4);args=ap.parse_args()
src=Path(args.source);out=Path(args.output);assert not out.exists()
raw=src.read_bytes();jl=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+jl]);start=28+jl;binary=bytearray(raw[start:]);original=bytes(binary)
def access(i):
    a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];dt={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]
    assert 'byteStride' not in v and 'sparse' not in a
    return np.frombuffer(binary,dtype=dt,count=a['count']*n,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
reports=[];modified=[]
for mesh in d['meshes']:
  for prim in mesh['primitives']:
    if prim.get('material',0)!=0:continue
    p=access(prim['attributes']['POSITION']);normal=access(prim['attributes']['NORMAL']);F=access(prim['indices']).ravel().reshape(-1,3);P=p.copy().astype(float)
    # UV seams have duplicate positions. Weld only for computing the fairing;
    # retain every original render vertex, UV, weight and index in the output.
    _,first,owner=np.unique(np.round(P,6),axis=0,return_index=True,return_inverse=True);Q=P[first].copy();Q0=Q.copy();T=owner[F]
    edges=np.unique(np.sort(np.concatenate([T[:,[0,1]],T[:,[1,2]],T[:,[2,0]]]),axis=1),axis=0);a,b=edges[:,0],edges[:,1]
    degree=np.maximum(np.bincount(np.r_[a,b],minlength=len(Q)),1)
    protect=(Q[:,1]<.085)|((Q[:,2]>.14)&(Q[:,1]>.30))
    limit=args.millimetres/1000
    for _ in range(24):
        mean=np.stack([np.bincount(np.r_[a,b],weights=np.r_[Q[b,c],Q[a,c]],minlength=len(Q))/degree for c in range(3)],1)
        Q+=.48*(mean-Q)*(~protect[:,None]);delta=Q-Q0;length=np.linalg.norm(delta,axis=1);Q=Q0+delta*np.minimum(1,limit/np.maximum(length,1e-12))[:,None]
    p[:]=Q[owner]
    # Angle-weighted normals share UV seam positions, so the continuous surface
    # no longer acquires hard lighting seams from the atlas splits.
    V=Q[T];cross=np.cross(V[:,1]-V[:,0],V[:,2]-V[:,0]);face=cross/np.maximum(np.linalg.norm(cross,axis=1),1e-20)[:,None]
    accum=np.zeros_like(Q)
    for k in range(3):
        u=V[:,(k+1)%3]-V[:,k];v=V[:,(k+2)%3]-V[:,k];cos=np.einsum('ij,ij->i',u,v)/np.maximum(np.linalg.norm(u,axis=1)*np.linalg.norm(v,axis=1),1e-20);angle=np.arccos(np.clip(cos,-1,1))
        for c in range(3):accum[:,c]+=np.bincount(T[:,k],weights=face[:,c]*angle,minlength=len(Q))
    accum/=np.maximum(np.linalg.norm(accum,axis=1),1e-20)[:,None];N=accum[owner]
    # Opposite sides of a thin sheet must not share a flipped normal.
    safe=(np.einsum('ij,ij->i',N,normal)>.15)&(~protect[owner]);normal[safe]=N[safe]
    reports.append(dict(vertices=len(P),weldedForComputation=len(Q),protected=int(protect.sum()),moved=int((np.linalg.norm(Q-Q0,axis=1)>1e-7).sum()),maxDisplacementMetres=float(np.linalg.norm(Q-Q0,axis=1).max()),changedNormals=int(safe.sum())))
    for key in ['POSITION','NORMAL']:
        ix=prim['attributes'][key];modified.append(ix)
        if key=='POSITION':d['accessors'][ix]['min']=p.min(0).tolist();d['accessors'][ix]['max']=p.max(0).tolist()
d['materials'][0].setdefault('pbrMetallicRoughness',{})['roughnessFactor']=.92
# Prove every byte outside the two declared accessor buffers stayed identical.
allowed=np.zeros(len(binary),dtype=bool)
for i in modified:
    ac=d['accessors'][i];v=d['bufferViews'][ac['bufferView']];offset=v.get('byteOffset',0)+ac.get('byteOffset',0);allowed[offset:offset+ac['count']*12]=True
changed=np.frombuffer(original,np.uint8)!=np.frombuffer(binary,np.uint8);assert np.all(~changed|allowed)
j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4);body=struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(struct.pack('<III',0x46546c67,2,len(body)+12)+body)
record=dict(source=str(src),sourceSha256=hashlib.sha256(raw).hexdigest(),sha256=hashlib.sha256(out.read_bytes()).hexdigest(),method='Bounded source-surface fairing and angle-weighted seam normals',maximumDisplacementMetres=limit,protected='Face at z>0.14/y>0.30; paws below y=0.085; entire mouth lining',roughness=.92,modifiedAccessors=modified,unchangedBinaryOutsidePositionNormal=True,unchanged=['UV','texture images','indices','skin weights','joints','inverse bind matrices','node transforms','all seven animation clips'],reports=reports)
out.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
