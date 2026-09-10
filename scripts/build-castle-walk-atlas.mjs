import {readFile,writeFile} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);
if(!output)throw new Error('Usage: build-castle-walk-atlas.mjs columns.json output.json');
const source=JSON.parse(await readFile(input,'utf8'));
const {step,minX,minZ,nx,nz,columns}=source;
const rise=Number(process.env.CASTLE_STEP_RISE)||.55;
const entranceLandingZ=Number(process.argv[4]??19.1);
if(!Number.isFinite(entranceLandingZ))throw new Error('Invalid entrance landing');
let riserInterpolations=0;
const choices=columns.map((col,index)=>{
  const x=minX+(index%nx+.5)*step,z=minZ+(Math.floor(index/nx)+.5)*step;
  // Only the exposed terraces are playable; hidden reconstruction slabs are not rooms.
  if(Math.abs(x)<1.105&&z>=entranceLandingZ&&z<=33){
    const expected=(33-z)*.53;
    let floor=col.filter((h,i)=>(i===col.length-1||col[i+1]-h>1.8)&&Math.abs(h-expected)<1.0).sort((a,b)=>Math.abs(a-expected)-Math.abs(b-expected))[0];
    if(floor===undefined){
      const neighbours=[-nx,nx].map(offset=>(columns[index+offset]??[]).filter(h=>Math.abs(h-expected)<1).sort((a,b)=>Math.abs(a-expected)-Math.abs(b-expected))[0]);
      if(neighbours.every(Number.isFinite)&&Math.abs(neighbours[0]-neighbours[1])<1){floor=(neighbours[0]+neighbours[1])/2;riserInterpolations++;}
    }
    return floor===undefined?[]:[floor];
  }
  if(Math.abs(x)<1.45&&z>=-2.3&&z<=3.5){const floor=col.find(h=>Math.abs(h-17.6)<.3);return floor===undefined?[]:[floor];}
  return col.length?[col.at(-1)]:[0];
});
const visited=choices.map(col=>col.map(()=>false)),queue=[];
const seed=(i,j)=>{if(!visited[i][j]){visited[i][j]=true;queue.push([i,j]);}};
for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)if(x===0||x===nx-1||z===0||z===nz-1){const i=z*nx+x;choices[i].forEach((h,j)=>{if(h<.6)seed(i,j);});}
for(let cursor=0;cursor<queue.length;cursor++){
  const [i,j]=queue[cursor],x=i%nx,z=Math.floor(i/nx),h=choices[i][j];
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const xx=x+dx,zz=z+dz;if(xx<0||xx>=nx||zz<0||zz>=nz)continue;
    const ni=zz*nx+xx;
    for(let k=0;k<choices[ni].length;k++)if(!visited[ni][k]&&Math.abs(choices[ni][k]-h)<=rise)seed(ni,k);
  }
}
const heights=choices.map((col,i)=>col.find((h,j)=>visited[i][j])??null);
const buckets={};for(const h of heights)if(h!==null){const bucket=Math.round(h);buckets[bucket]=(buckets[bucket]??0)+1;}
const result={schemaVersion:1,sourceSha256:source.sha256,step,minX,minZ,nx,nz,heights,measurement:{method:'Exposed terraces rasterized from exact GLB; two measured door passages; head clearance and connected step graph from outer ground. Single-cell vertical risers in the reused entrance stair interpolate the measured treads immediately before and after.',maxStepRise:rise,bodyHeadroom:1.8,riserInterpolations,reachable:heights.filter(h=>h!==null).length,blocked:heights.filter(h=>h===null).length,heightBuckets:buckets}};
result.measurement.entranceLandingZ=entranceLandingZ;
await writeFile(output,JSON.stringify(result));console.log(JSON.stringify(result.measurement));
