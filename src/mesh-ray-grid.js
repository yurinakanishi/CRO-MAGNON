import * as THREE from 'three';
// Invisible spatial index of the exact source triangles, shared by camera rays.
export class MeshRayGrid {
  constructor(root,cellSize=2){
    this.cellSize=cellSize;this.cells=new Map();const vertices=[];
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();root.updateMatrixWorld(true);
    root.traverse(node=>{if(!node.isMesh)return;const p=node.geometry.attributes.position,index=node.geometry.index;
      for(let i=0;i<(index?.count??p.count);i+=3){
        for(const [v,j]of [[a,0],[b,1],[c,2]])v.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(node.matrixWorld);
        const id=vertices.length/9;vertices.push(...a,...b,...c);
        for(let x=Math.floor(Math.min(a.x,b.x,c.x)/cellSize);x<=Math.floor(Math.max(a.x,b.x,c.x)/cellSize);x++)for(let z=Math.floor(Math.min(a.z,b.z,c.z)/cellSize);z<=Math.floor(Math.max(a.z,b.z,c.z)/cellSize);z++){
          const key=`${x},${z}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(id);
        }
      }
    });this.vertices=new Float32Array(vertices);
    this.a=a;this.b=b;this.c=c;this.hit=new THREE.Vector3();this.ray=new THREE.Ray();
  }
  distance(origin,direction,maximum){
    this.ray.set(origin,direction);const ids=new Set(),n=Math.ceil(maximum/(this.cellSize/3));
    for(let i=0;i<=n;i++){const t=maximum*i/n,x=Math.floor((origin.x+direction.x*t)/this.cellSize),z=Math.floor((origin.z+direction.z*t)/this.cellSize);
      for(const id of this.cells.get(`${x},${z}`)??[])ids.add(id);
    }
    let result=maximum;
    for(const id of ids){this.a.fromArray(this.vertices,id*9);this.b.fromArray(this.vertices,id*9+3);this.c.fromArray(this.vertices,id*9+6);
      if(this.ray.intersectTriangle(this.a,this.b,this.c,false,this.hit)){const d=this.hit.distanceTo(origin);if(d>.08)result=Math.min(result,Math.max(.35,d-.2));}
    }
    return result;
  }
}
