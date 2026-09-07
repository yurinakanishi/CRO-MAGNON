import { WORLD, worldClamp, CAMP, NPC } from '/shared/world.mjs';
import { BIOMES, biomeAt, biomeWeights } from '/shared/biomes.mjs';
import { EARTH, coastDistance, CONTINENT_LABELS, EXPEDITION_STOPS, geoToWorld } from '/shared/paleo-geography.mjs';
import { LANDMARKS } from '/shared/landmarks.mjs';

let background,overview=true,selection=null;
export function setWorldMapSelection(point){selection=point;}
export function setWorldMapMode(mode){overview=mode!=='local';}
function baseMap(){
  if(background)return background;
  const width=1024,height=512,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height),colors=BIOMES.map(b=>b.color.slice(1).match(/../g).map(n=>parseInt(n,16)));
  for(let z=0;z<height;z++)for(let x=0;x<width;x++){
    const wx=EARTH.minX+(x+.5)/width*EARTH.width,wz=EARTH.minZ+(z+.5)/height*EARTH.height,d=coastDistance(wx,wz),i=(z*width+x)*4;
    if(d>0){const weights=biomeWeights(wx,wz);for(let c=0;c<3;c++)pixels.data[i+c]=weights.reduce((sum,w,j)=>sum+w*colors[j][c],0)*(.78+Math.min(d,6)/60);}
    else{const coast=Math.max(0,1+d/16);pixels.data[i]=25+coast*24;pixels.data[i+1]=57+coast*31;pixels.data[i+2]=72+coast*30;}
    pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);background=canvas;return canvas;
}
export function mapProjection(canvas,big,self={x:50,z:50}){
  const full=big&&overview;
  const scale=full?Math.min((canvas.width-24)/WORLD.width,(canvas.height-28)/WORLD.depth):canvas.width/(big?600:180);
  const cx=full?(WORLD.minX+WORLD.maxX)/2:self.x,cz=full?(WORLD.minZ+WORLD.maxZ)/2:self.z;
  const point=(x,z)=>[canvas.width/2+(x-cx)*scale,canvas.height/2+(z-cz)*scale];
  return {scale,full,point,world:(x,y)=>({x:worldClamp(cx+(x-canvas.width/2)/scale,'x'),z:worldClamp(cz+(y-canvas.height/2)/scale,'z')})};
}
export function drawWorldMap(canvas,state,selfId,big=false){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,self=state.players.find(p=>p.id===selfId)??{x:50,z:50};
  const {point,scale,full}=mapProjection(canvas,big,self);
  ctx.fillStyle='#193948';ctx.fillRect(0,0,w,h);
  const [left,top]=point(WORLD.minX,WORLD.minZ);ctx.drawImage(baseMap(),left,top,WORLD.width*scale,WORLD.depth*scale);
  if(full){
    ctx.strokeStyle='#c2d0c51a';ctx.lineWidth=1;
    for(let lon=-150;lon<=150;lon+=30){const a=geoToWorld(lon,90),b=geoToWorld(lon,-90);ctx.beginPath();ctx.moveTo(...point(a.x,a.z));ctx.lineTo(...point(b.x,b.z));ctx.stroke();}
    for(let lat=-60;lat<=60;lat+=30){const a=geoToWorld(-180,lat),b=geoToWorld(180,lat);ctx.beginPath();ctx.moveTo(...point(a.x,a.z));ctx.lineTo(...point(b.x,b.z));ctx.stroke();}
    ctx.font='500 15px sans-serif';ctx.textAlign='center';ctx.shadowColor='#10212a';ctx.shadowBlur=4;
    for(const label of CONTINENT_LABELS){const [x,y]=point(label.x,label.z);ctx.fillStyle='#fff4d7';ctx.fillText(label.name,x,y);}
    ctx.shadowBlur=0;ctx.textAlign='start';
    for(const [name,lon,lat] of [['太平洋',-147,0],['大西洋',-30,1],['インド洋',80,-22]]){const p=geoToWorld(lon,lat);ctx.fillStyle='#b0cbd2a0';ctx.font='13px sans-serif';ctx.fillText(name,...point(p.x,p.z));}
  }
  const dot=(x,z,color,r=3)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(...point(x,z),r,0,Math.PI*2);ctx.fill();};
  if(big&&selection){const [x,y]=point(selection.x,selection.z);ctx.strokeStyle='#ffda88';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.stroke();}
  for(const item of LANDMARKS){const [x,y]=point(item.x,item.z),r=full?3:4;ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x-r,y+r);ctx.lineTo(x+r,y+r);ctx.closePath();ctx.fillStyle=item.key==='volcanic-cone'?'#f19c73':'#caf1f2';ctx.fill();}
  if(big)for(const stop of EXPEDITION_STOPS){const [x,y]=point(stop.x,stop.z);ctx.strokeStyle='#ffe2a4';ctx.lineWidth=1.4;ctx.strokeRect(x-3,y-3,6,6);}
  if(!full){for(const fire of state.cookingFires??[])dot(fire.x,fire.z,'#efb573',big?3:2);dot(CAMP.x,CAMP.z,'#efb573',4);dot(NPC.x,NPC.z,'#dad3a9',3);}
  for(const animal of state.animals??[])if(animal.phase!=='respawning')dot(animal.x,animal.z,animal.phase==='meat'?'#e5b6a9':'#d9c089',full?2:3);
  for(const boat of state.boats??[]){const[x,y]=point(boat.x,boat.z);ctx.save();ctx.translate(x,y);ctx.rotate(-boat.facing);ctx.fillStyle=boat.riderId?'#ffde96':'#bcdddc';ctx.fillRect(-2,-5,4,10);ctx.restore();}
  for(const enemy of state.enemies??[])if(enemy.hostile&&enemy.phase!=='respawning')dot(enemy.x,enemy.z,enemy.phase==='alive'?'#ff9183':'#926d6a',full?2:3);
  for(const player of state.players){
    dot(player.x,player.z,player.id===selfId?'#fff8da':player.color,big?4:3);
    if(player.id===selfId){const [x,y]=point(player.x,player.z);ctx.save();ctx.translate(x,y);ctx.rotate(-player.facing);ctx.beginPath();ctx.moveTo(0,10);ctx.lineTo(-3,3);ctx.lineTo(3,3);ctx.fillStyle='#fff8da';ctx.fill();ctx.restore();ctx.strokeStyle='#fff8daaa';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();}
  }
  ctx.fillStyle='#fff0d3';ctx.font=big?'12px sans-serif':'10px sans-serif';ctx.fillText(full?'50,000年前 · □ 野営地':biomeAt(self.x,self.z).short,10,18);
  const metres=full?500:big?100:25,pixels=metres*scale;ctx.fillRect(w-pixels-12,h-12,pixels,1);ctx.textAlign='right';ctx.fillText(`${metres} m`,w-12,h-18);ctx.textAlign='start';
  canvas.dataset.mapMode=full?'earth':'local';canvas.dataset.worldWidth=String(WORLD.width);canvas.dataset.worldDepth=String(WORLD.depth);
}
