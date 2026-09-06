import { WORLD, worldClamp } from '/shared/world.mjs';
import { BIOMES, biomeAt, biomeWeights, JOURNEY_ROADS } from '/shared/biomes.mjs';
import { riverX, riverFade } from '/shared/terrain.mjs';
import { LANDMARKS } from '/shared/landmarks.mjs';

let background;
function baseMap() {
  if(background)return background;
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=320;
  const context=canvas.getContext('2d'),pixels=context.createImageData(320,320);
  const colors=BIOMES.map(b=>b.color.slice(1).match(/../g).map(n=>parseInt(n,16)));
  for(let z=0;z<320;z++)for(let x=0;x<320;x++) {
    const weights=biomeWeights(WORLD.minX+(x+.5)*2,WORLD.minZ+(z+.5)*2),index=(z*320+x)*4;
    for(let channel=0;channel<3;channel++)pixels.data[index+channel]=weights.reduce((sum,weight,i)=>sum+weight*colors[i][channel],0)*.64;
    pixels.data[index+3]=255;
  }
  context.putImageData(pixels,0,0);background=canvas;return canvas;
}
export function mapProjection(canvas,big,self={x:50,z:50}) {
  const scale=big?Math.min(canvas.width,canvas.height)/WORLD.size:canvas.width/180;
  const cx=big?(WORLD.minX+WORLD.maxX)/2:self.x,cz=big?(WORLD.minZ+WORLD.maxZ)/2:self.z;
  return { scale,point:(x,z)=>[canvas.width/2+(x-cx)*scale,canvas.height/2+(z-cz)*scale],
    world:(x,y)=>({x:worldClamp(cx+(x-canvas.width/2)/scale,'x'),z:worldClamp(cz+(y-canvas.height/2)/scale,'z')}) };
}
export function drawWorldMap(canvas,state,selfId,big=false) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,self=state.players.find(p=>p.id===selfId)??{x:50,z:50};
  const {point,scale}=mapProjection(canvas,big,self);
  ctx.fillStyle='#26352f';ctx.fillRect(0,0,w,h);
  const [left,top]=point(WORLD.minX,WORLD.minZ);
  ctx.drawImage(baseMap(),left,top,WORLD.size*scale,WORLD.size*scale);
  ctx.lineWidth=big?2:1;ctx.strokeStyle='#e9ddbe65';ctx.setLineDash([3,4]);
  for(const [a,b]of JOURNEY_ROADS){ctx.beginPath();ctx.moveTo(...point(a.x,a.z));ctx.lineTo(...point(b.x,b.z));ctx.stroke();}ctx.setLineDash([]);
  ctx.strokeStyle='#94d4d5';
  for(let z=-64;z<184;z+=3){ctx.lineWidth=Math.max(.4,6*riverFade(z)*scale);ctx.beginPath();ctx.moveTo(...point(riverX(z),z));ctx.lineTo(...point(riverX(z+3),z+3));ctx.stroke();}
  ctx.fillStyle='#e3c799';const bridge=point(riverX(43.5),43.5);ctx.fillRect(bridge[0]-5*scale,bridge[1]-1,10*scale,2);
  const dot=(x,z,color,r=3)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(...point(x,z),r,0,Math.PI*2);ctx.fill();};
  if(big)for(const b of BIOMES){const [x,y]=point(b.x,b.z);ctx.font='600 13px sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff2d9';ctx.fillText(b.name,x,y-20);ctx.textAlign='start';}
  for(const item of LANDMARKS){const[x,y]=point(item.x,item.z),r=big?4:3;ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x-r,y+r);ctx.lineTo(x+r,y+r);ctx.closePath();ctx.fillStyle=item.key==='volcanic-cone'?'#dd9278':'#b8e4ee';ctx.fill();}
  for(const fire of state.cookingFires??[])dot(fire.x,fire.z,'#efb573',big?3:2);
  dot(50,50,'#efb573',big?5:3);dot(70,41,'#dad3a9',big?4:2);
  for(const animal of state.animals??[])if(animal.phase!=='respawning')dot(animal.x,animal.z,animal.phase==='meat'?'#e5b6a9':'#d9c089',big?3:2);
  for(const enemy of state.enemies??[])if(enemy.hostile&&enemy.phase!=='respawning')dot(enemy.x,enemy.z,enemy.phase==='alive'?'#ff9183':'#926d6a',big?3:2);
  for(const player of state.players) {
    dot(player.x,player.z,player.id===selfId?'#fff8da':player.color,big?4:3);
    if(player.id===selfId){const [x,y]=point(player.x,player.z);ctx.save();ctx.translate(x,y);ctx.rotate(-player.facing);ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(-3,2);ctx.lineTo(3,2);ctx.fillStyle='#fff8da';ctx.fill();ctx.restore();ctx.strokeStyle='#fff8daaa';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();}
  }
  ctx.fillStyle='#f0e6d2';ctx.font='10px sans-serif';ctx.fillText(big?'クリックした場所へ移動 · 全域がつながっています':biomeAt(self.x,self.z).short,8,h-9);
  const metres=big?100:25,pixels=metres*scale;ctx.fillRect(w-pixels-10,h-12,pixels,1);ctx.textAlign='right';ctx.fillText(`${metres} m`,w-10,h-17);ctx.textAlign='start';
}
