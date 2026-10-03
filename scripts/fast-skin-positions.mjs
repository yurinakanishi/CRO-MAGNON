import * as THREE from 'three';

// The same affine linear blend as SkinnedMesh.applyBoneTransform, with each
// bone matrix computed once per pose rather than four times per vertex.
// Inspection callers cross-check representative vertices against Three.js.
export function fastSkinPositions(mesh) {
  if (Object.keys(mesh.geometry.morphAttributes).length) throw Error('Morph targets need the standard sampler');
  const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
  const base=new Float64Array(position.count*3),weights=new Float64Array(position.count*4),joints=new Uint16Array(position.count*4),out=new Float64Array(position.count*3);
  const v=new THREE.Vector3();
  for(let i=0;i<position.count;i++){
    v.fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix).toArray(base,i*3);
    for(let k=0;k<4;k++){weights[i*4+k]=skinWeight.getComponent(i,k);joints[i*4+k]=skinIndex.getComponent(i,k);}
  }
  const boneMatrices=mesh.skeleton.bones.map(()=>new THREE.Matrix4()),world=new THREE.Matrix4();
  return {
    sample(){
      for(let j=0;j<boneMatrices.length;j++)boneMatrices[j].multiplyMatrices(mesh.skeleton.bones[j].matrixWorld,mesh.skeleton.boneInverses[j]);
      world.multiplyMatrices(mesh.matrixWorld,mesh.bindMatrixInverse);const m=world.elements;
      for(let i=0;i<position.count;i++){
        const p=i*3,x=base[p],y=base[p+1],z=base[p+2];let sx=0,sy=0,sz=0;
        for(let k=0;k<4;k++){const w=weights[i*4+k];if(w===0)continue;const b=boneMatrices[joints[i*4+k]].elements;sx+=(b[0]*x+b[4]*y+b[8]*z+b[12])*w;sy+=(b[1]*x+b[5]*y+b[9]*z+b[13])*w;sz+=(b[2]*x+b[6]*y+b[10]*z+b[14])*w;}
        out[p]=m[0]*sx+m[4]*sy+m[8]*sz+m[12];out[p+1]=m[1]*sx+m[5]*sy+m[9]*sz+m[13];out[p+2]=m[2]*sx+m[6]*sy+m[10]*sz+m[14];
      }
      return out;
    },
    referenceError(){
      let error=0;
      for(let i=0;i<position.count;i+=Math.max(1,Math.floor(position.count/257))){mesh.getVertexPosition(i,v);mesh.localToWorld(v);error=Math.max(error,Math.hypot(v.x-out[i*3],v.y-out[i*3+1],v.z-out[i*3+2]));}
      return error;
    }
  };
}
