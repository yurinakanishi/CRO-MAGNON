import * as THREE from 'three';
import { terrainHeight, walkHeight, riverX, WATER_LEVEL, clamp, movementFromCamera } from '/shared/terrain.mjs';
import { WORLD, CAMP, NPC, INITIAL_RESOURCES } from '/shared/world.mjs';
import { WorldAssets } from './world-assets.js';
import { buildTerrainAssets, buildForestAssets, buildCampAssets, buildAnimalAssets, resourceAssets } from './world-scenery.js';
import { CharacterAssets } from './character-assets.js';
import { confirmedAction } from './character-animation.js';

const DEFAULT_DISTANCE=5.5;
const tempPoint=new THREE.Vector3();

function mesh(geometry, material, parent, position=[0,0,0]) {const object=new THREE.Mesh(geometry,material);object.position.set(...position);parent.add(object);return object;}

export class WorldRenderer {
  constructor(canvas,{onMoveTarget=()=>{},onError=()=>{}}={}) {
    this.canvas=canvas;this.onMoveTarget=onMoveTarget;this.onError=onError;
    this.state={players:[],resources:INITIAL_RESOURCES,camp:CAMP,npc:NPC};this.selfId=null;
    this.yaw=-.28;this.pitch=.19;this.distance=DEFAULT_DISTANCE;this.targetDistance=DEFAULT_DISTANCE;this.zoom=1;
    this.focus=new THREE.Vector3(48,walkHeight(48,57)+1.4,57);this.firstState=true;
    this.players=new Map();this.resources=new Map();this.labels=[];this.fires=[];this.mammoths=[];
    this.characterAssets=new CharacterAssets();this.neanderthalAssets=new CharacterAssets('/models/neanderthal-hunter/asset.json');this.worldAssets=new WorldAssets();this.landscapes=[];this.canvas.dataset.characterAsset='not-loaded';this.canvas.dataset.worldAsset='loading';
    this.disposables=[];this.disposed=false;this.fpsFrames=0;this.lastFpsTime=0;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.18;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#c0cec1');this.scene.fog=new THREE.FogExp2('#b5c4b2',.0105);
    this.camera=new THREE.PerspectiveCamera(57,1,.15,360);
    this.raycaster=new THREE.Raycaster();this.cameraRay=new THREE.Raycaster();this.cameraBlockers=[];
    this.labelLayer=document.createElement('div');this.labelLayer.className='world-labels';this.labelLayer.setAttribute('aria-hidden','true');canvas.parentElement.append(this.labelLayer);
    this.setupLighting();
    this.createNavigation();this.setupInput();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
    this.contextLost=e=>{e.preventDefault();this.onError('3D描画が一時停止しました。ページを再読み込みしてください。');};
    canvas.addEventListener('webglcontextlost',this.contextLost);
    this.lastTime=performance.now();
    this.animate=(now)=>{if(this.disposed)return;const dt=Math.min((now-this.lastTime)/1000,.06);this.lastTime=now;this.render(now/1000,dt);this.frame=requestAnimationFrame(this.animate);};
    this.frame=requestAnimationFrame(this.animate);canvas.dataset.renderer='three-webgl-tps';
    this.loadingLabel=document.createElement('div');this.loadingLabel.className='world-loading';this.loadingLabel.textContent='渓谷を準備しています…';canvas.parentElement.append(this.loadingLabel);
    this.assetsPromise=this.initializeWorld();this.assetsPromise.catch(()=>{});
  }

  setupLighting() {
    this.scene.add(new THREE.HemisphereLight('#dce7d7','#546047',2.0));
    this.sun=new THREE.DirectionalLight('#ffe4b5',2.65);this.sun.position.set(5,47,18);this.sun.castShadow=true;
    this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-46;this.sun.shadow.camera.right=46;
    this.sun.shadow.camera.top=46;this.sun.shadow.camera.bottom=-46;this.sun.shadow.camera.near=.5;this.sun.shadow.camera.far=135;
    this.sun.shadow.bias=-.00025;this.sun.shadow.normalBias=.055;
    this.sun.target.position.set(50,0,50);this.scene.add(this.sun,this.sun.target);
    // Full-screen atmospheric shader: sky, sun and clouds are runtime effects.
    this.skyUniforms={cameraWorld:{value:this.camera.matrixWorld},inverseProjection:{value:this.camera.projectionMatrixInverse}};
    const skyMaterial=new THREE.ShaderMaterial({depthWrite:false,depthTest:false,uniforms:this.skyUniforms,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}',
      fragmentShader:'varying vec2 vUv;uniform mat4 cameraWorld;uniform mat4 inverseProjection;void main(){vec4 eye=inverseProjection*vec4(vUv*2.0-1.0,1.0,1.0);vec3 d=normalize(mat3(cameraWorld)*eye.xyz);float h=clamp(d.y*1.7,0.0,1.0);vec3 color=mix(vec3(.72,.75,.65),vec3(.29,.49,.58),pow(h,.7));float sun=pow(max(0.0,dot(d,normalize(vec3(-.65,.55,-.85)))),850.0);color+=vec3(.9,.72,.42)*sun;vec2 p=d.xz/max(.12,d.y)*3.0;float noise=sin(p.x*.7+sin(p.y))*.25+sin(p.y*.5-p.x*.3)*.2+sin(p.x*1.3+p.y*.8)*.1;float cloud=smoothstep(.15,.43,noise)*smoothstep(.03,.23,d.y);color=mix(color,vec3(.83,.84,.75),cloud*.65);gl_FragColor=vec4(color,1.0);}'});
    const sky=new THREE.Mesh(new THREE.PlaneGeometry(2,2),skyMaterial);sky.frustumCulled=false;sky.renderOrder=-1000;this.scene.add(sky);
  }

  async initializeWorld() {
    const started=performance.now();
    try {
      await Promise.all([this.worldAssets.load(),this.characterAssets.load(),this.neanderthalAssets.load()]);
      if(this.disposed)return;
      buildTerrainAssets(this);buildForestAssets(this);buildCampAssets(this);buildAnimalAssets(this);
      this.assetsReady=true;this.syncResources();this.campLabel.element.classList.toggle('complete',this.state.camp.level>0);
      this.npcActor=await this.neanderthalAssets.create({color:'#ad9d79',speed:WORLD.speed});
      if(this.disposed){this.npcActor?.dispose();return;}
      this.npc=this.npcActor.root;this.npc.position.set(NPC.x,walkHeight(NPC.x,NPC.z),NPC.z);this.npc.rotation.y=-1.9;this.scene.add(this.npc);
      this.canvas.dataset.worldHashes=JSON.stringify(Object.fromEntries([...this.worldAssets.templates].map(([key,template])=>[key,template.asset.sha256]).concat([['cro-magnon-hunter',this.characterAssets.template.asset.sha256],['neanderthal-hunter',this.neanderthalAssets.template.asset.sha256]])));
      this.canvas.dataset.worldAsset='ready';this.canvas.dataset.worldModels=String(this.worldAssets.templates.size+2);this.canvas.dataset.worldLoadMs=this.worldAssets.loadMilliseconds.toFixed(0);this.canvas.dataset.worldSceneReadyMs=(performance.now()-started).toFixed(0);this.loadingLabel.remove();
    } catch(error) {
      if(this.disposed)return;
      this.canvas.dataset.worldAsset='error';this.loadingLabel.textContent='渓谷を読み込めませんでした。再読み込みしてください。';console.error('World GLB loading failed',error);throw error;
    }
  }

  createNavigation() {
    this.marker=new THREE.Group();
    const ring=mesh(new THREE.RingGeometry(.43,.5,36),new THREE.MeshBasicMaterial({color:'#d7ca8d',transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false}),this.marker);ring.rotation.x=-Math.PI/2;
    const dot=mesh(new THREE.CircleGeometry(.09,12),ring.material,this.marker,[0,.008,0]);dot.rotation.x=-Math.PI/2;this.marker.visible=false;this.scene.add(this.marker);
  }

  createLabel(text,kind,position,subtitle='') {
    const element=document.createElement('div');element.className=`world-label ${kind}`;
    const title=document.createElement('strong');title.textContent=text;element.append(title);
    if(subtitle){const sub=document.createElement('small');sub.textContent=subtitle;element.append(sub);}
    this.labelLayer.append(element);const label={element,position,kind};this.labels.push(label);return label;
  }

  syncResources() {
    if(!this.assetsReady)return;
    for(const resource of this.state.resources){
      let item=this.resources.get(resource.id);
      if(!item){
        const model=this.worldAssets.createResource(resourceAssets[resource.type]);if(resource.type==='stone')model.scale.setScalar(.55);model.position.set(resource.x,walkHeight(resource.x,resource.z),resource.z);model.rotation.y=resource.x*.2;this.scene.add(model);
        const label=this.createLabel({wood:'木材',stone:'石',berry:'ベリー'}[resource.type],'resource',new THREE.Vector3(resource.x,walkHeight(resource.x,resource.z)+1.7,resource.z));item={model,label};this.resources.set(resource.id,item);
      }
      item.resource=resource;item.model.visible=resource.amount>0;item.label.active=resource.amount>0;
    }
  }

  setupInput() {
    this.down=e=>{if(e.button!==0&&e.button!==2)return;e.preventDefault();this.canvas.focus({preventScroll:true});this.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,button:e.button,dragged:false};this.canvas.setPointerCapture(e.pointerId);};
    this.move=e=>{
      if(!this.pointer||this.pointer.id!==e.pointerId)return;const p=this.pointer,dx=e.clientX-p.lastX,dy=e.clientY-p.lastY;
      if(Math.hypot(e.clientX-p.x,e.clientY-p.y)>4)p.dragged=true;
      if(p.dragged){this.yaw-=dx*.006;this.pitch=clamp(this.pitch+dy*.0045,.06,1.05);this.canvas.style.cursor='grabbing';}p.lastX=e.clientX;p.lastY=e.clientY;
    };
    this.up=e=>{
      if(!this.pointer||this.pointer.id!==e.pointerId)return;const click=!this.pointer.dragged&&this.pointer.button===0;this.pointer=null;this.canvas.style.cursor='crosshair';
      if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
      if(click){const rect=this.canvas.getBoundingClientRect();this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),this.camera);
        const hits=this.raycaster.intersectObjects([this.terrain,this.bridge].filter(Boolean),true);if(hits.length){const hit=hits[0].point,x=clamp(hit.x,2,98),z=clamp(hit.z,2,98);this.onMoveTarget(x,z);this.marker.position.set(x,walkHeight(x,z)+.065,z);this.marker.visible=true;this.markerUntil=performance.now()+6500;}}
    };
    this.cancel=()=>{this.pointer=null;this.canvas.style.cursor='crosshair';};
    this.wheel=e=>{e.preventDefault();this.targetDistance=clamp(this.targetDistance+e.deltaY*.009,3.2,19);this.zoom=DEFAULT_DISTANCE/this.targetDistance;};this.context=e=>e.preventDefault();
    this.canvas.addEventListener('pointerdown',this.down);this.canvas.addEventListener('pointermove',this.move);this.canvas.addEventListener('pointerup',this.up);this.canvas.addEventListener('pointercancel',this.cancel);this.canvas.addEventListener('lostpointercapture',this.cancel);this.canvas.addEventListener('wheel',this.wheel,{passive:false});this.canvas.addEventListener('contextmenu',this.context);
  }

  setState(state,selfId) {
    this.state=state;this.selfId=selfId;this.syncResources();const present=new Set();
    for(const p of state.players){
      present.add(p.id);let entity=this.players.get(p.id);
      if(!entity){const model=new THREE.Group();model.position.set(p.x,walkHeight(p.x,p.z),p.z);model.rotation.y=p.facing||Math.PI-.28;this.scene.add(model);
        const label=this.createLabel(p.name,p.id===selfId?'self':'player',new THREE.Vector3(p.x,0,p.z));entity={model,label,state:p};this.players.set(p.id,entity);
        this.loadHuman(entity,p.id);
      }
      const action=confirmedAction(entity.state,p);
      if(action&&!p.moving)entity.actor?.animation.play(action);
      entity.state=p;if(p.id===selfId&&this.firstState){this.focus.set(p.x,walkHeight(p.x,p.z)+1.4,p.z);this.firstState=false;}
    }
    for(const[id,entity]of this.players)if(!present.has(id)){this.scene.remove(entity.model);entity.actor?.dispose();entity.label.element.remove();this.labels.splice(this.labels.indexOf(entity.label),1);this.players.delete(id);}
    this.campLabel?.element.classList.toggle('complete',state.camp.level>0);
  }

  async loadHuman(entity,id) {
    this.canvas.dataset.characterAsset='loading';
    try {
      await this.assetsPromise;
      if(this.disposed||this.players.get(id)!==entity||!this.assetsReady)return;
      const provider=entity.state.species==='nea'?this.neanderthalAssets:this.characterAssets;
      const actor=await provider.create({color:entity.state.color,speed:WORLD.speed});
      if(!actor)return;
      if(this.disposed||this.players.get(id)!==entity){actor.dispose();return;}
      const previous=entity.model;actor.root.position.copy(previous.position);actor.root.quaternion.copy(previous.quaternion);
      const grip=actor.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.R'));
      if(grip){
        entity.weapon=this.worldAssets.create('flint-spear');entity.axe=this.worldAssets.create('stone-axe');
        for(const tool of [entity.weapon,entity.axe]){grip.add(tool);tool.position.set(0,0,0);tool.quaternion.copy(actor.gripUp);}
        entity.axe.visible=false;
      }
      this.scene.remove(previous);this.scene.add(actor.root);entity.model=actor.root;entity.actor=actor;
      this.canvas.dataset.characterAsset='ready';this.canvas.dataset.characterHash=actor.asset.sha256;this.canvas.dataset.modelLoadMs=provider.loadMilliseconds.toFixed(0);
    } catch(error) {
      if(this.disposed)return;
      this.canvas.dataset.characterAsset='error';console.error('Character GLB loading failed',error);
    }
  }

  setEmote(id,emote){const entity=this.players.get(id);if(emote==='wave'&&!entity?.state.moving)entity?.actor?.animation.play('Wave');}

  getMovementDirection(sx,sy){return movementFromCamera(sx,sy,this.yaw);}
  setZoom(value){this.zoom=clamp(Number(value)||1,DEFAULT_DISTANCE/19,DEFAULT_DISTANCE/3.2);this.targetDistance=clamp(DEFAULT_DISTANCE/this.zoom,3.2,19);}
  adjustZoom(delta){this.setZoom(this.zoom+delta);}
  focusPlayer(){const me=this.players.get(this.selfId);if(me?.state.moving)this.yaw=me.state.facing+Math.PI;else this.yaw=-.28;this.pitch=.19;this.targetDistance=DEFAULT_DISTANCE;this.zoom=1;}
  resize(){const r=this.canvas.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();}

  render(time,dt) {
    for(const entity of this.players.values()){
      const{model,state:p}=entity,factor=1-Math.exp(-dt*15);model.position.x+=(p.x-model.position.x)*factor;model.position.z+=(p.z-model.position.z)*factor;model.position.y=walkHeight(model.position.x,model.position.z);
      if(p.moving){const diff=Math.atan2(Math.sin(p.facing-model.rotation.y),Math.cos(p.facing-model.rotation.y));model.rotation.y+=diff*(1-Math.exp(-dt*12));}
      if(entity.actor){
        entity.actor.animation.update(dt,p.moving);
        if(entity.weapon){entity.weapon.visible=!entity.actor.animation.oneShot&&!p.tool;entity.axe.visible=!entity.actor.animation.oneShot&&p.tool;}
      }
      entity.label.position.set(model.position.x,model.position.y+(entity.actor?entity.actor.asset.heightMetres+.45:2.7),model.position.z);
    }
    const self=this.players.get(this.selfId);if(self){tempPoint.copy(self.model.position);tempPoint.y+=1.4;this.focus.lerp(tempPoint,1-Math.exp(-dt*11));}
    this.distance+=(this.targetDistance-this.distance)*(1-Math.exp(-dt*10));
    const shoulder=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw)).multiplyScalar(.75),aim=this.focus.clone().add(shoulder);
    const offset=new THREE.Vector3(Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch));let cameraDistance=this.distance;
    this.cameraRay.set(aim,offset);this.cameraRay.far=this.distance;const obstacles=this.cameraRay.intersectObjects(this.cameraBlockers,true);if(obstacles.length)cameraDistance=Math.max(1.6,obstacles[0].distance-.3);
    this.camera.position.copy(aim).addScaledVector(offset,cameraDistance);this.camera.position.y=Math.max(this.camera.position.y,terrainHeight(this.camera.position.x,this.camera.position.z)+.55,WATER_LEVEL+.65);
    this.camera.lookAt(aim);this.camera.updateMatrixWorld();this.sun.position.set(this.focus.x-32,48,this.focus.z-25);this.sun.target.position.set(this.focus.x,0,this.focus.z);
    if(this.waterMaterial)this.waterMaterial.userData.time.value=time;this.npcActor?.animation.update(dt,false);for(const landscape of this.landscapes)landscape.update(this.camera,time);
    for(const fire of this.fires){
      fire.light.intensity=4.1+Math.sin(time*9+fire.seed)*.5;
      const pos=fire.sparks.geometry.attributes.position;for(let i=0;i<pos.count;i++){const life=(time*.32+i/pos.count)%1;pos.setXYZ(i,Math.sin(i*51+time)*life*.45,.35+life*2.4,Math.cos(i*23+time*.5)*life*.45);}pos.needsUpdate=true;
    }
    for(const animal of this.mammoths){
      animal.age+=dt;const grazing=animal.age%38>27;
      if(!grazing)animal.angle+=dt*.08;
      const t=animal.angle,x=animal.x+Math.sin(t)*4,z=animal.z+Math.cos(t)*3;
      animal.model.position.set(x,walkHeight(x,z),z);
      if(!grazing)animal.model.rotation.y=Math.atan2(Math.cos(t)*4,-Math.sin(t)*3);
      const speed=.08*Math.hypot(Math.cos(t)*4,Math.sin(t)*3);
      animal.actor.play(grazing?'Graze_Loop':'Walk_Loop',grazing?1:speed/(animal.scale*animal.actor.asset.locomotion.Walk_Loop.metresPerSecond));animal.actor.update(dt);
    }
    if(this.motes)this.motes.rotation.y=Math.sin(time*.02)*.03;if(this.marker.visible){this.marker.rotation.y=time*.25;this.marker.visible=performance.now()<this.markerUntil;}
    this.updateLabels();this.renderer.render(this.scene,this.camera);
    this.fpsFrames++;
    if(time-this.lastFpsTime>1){
      const data=this.canvas.dataset,info=this.renderer.info;
      data.fps=String(Math.round(this.fpsFrames/(time-this.lastFpsTime)));
      data.cameraPosition=[this.camera.position.x,this.camera.position.y,this.camera.position.z].map(n=>n.toFixed(2)).join(',');
      data.resourceLods=JSON.stringify([...this.resources.entries()].filter(([,item])=>item.model.isLOD&&item.model.visible).map(([id,item])=>({id,level:item.model.getCurrentLevel(),distance:Number(item.model.position.distanceTo(this.camera.position).toFixed(2))})));
      data.vegetationInstances=JSON.stringify(this.landscapes.map(landscape=>landscape.levels.map(meshes=>meshes[0]?.mesh.count??0)));
      data.glbNpcs=String(this.npcActor?1:0);data.glbAnimals=String(this.mammoths.length);
      if(performance.memory)data.jsHeapMiB=(performance.memory.usedJSHeapSize/1048576).toFixed(1);
      data.actorSpecies=[...this.players.values()].filter(entity=>entity.actor).map(entity=>entity.state.species).sort().join(',');
      data.cameraYaw=this.yaw.toFixed(3);data.cameraDistance=cameraDistance.toFixed(2);
      data.drawCalls=String(info.render.calls);data.renderTriangles=String(info.render.triangles);
      data.geometries=String(info.memory.geometries);data.textures=String(info.memory.textures);
      data.glbPlayers=String([...this.players.values()].filter(entity=>entity.actor).length);
      if(self){data.playerY=self.model.position.y.toFixed(3);data.playerX=self.model.position.x.toFixed(2);data.playerZ=self.model.position.z.toFixed(2);data.playerAnimation=self.actor?.animation.name||'loading';}
      this.fpsFrames=0;this.lastFpsTime=time;
    }
  }

  updateLabels() {
    const viewDirection=new THREE.Vector3();this.camera.getWorldDirection(viewDirection);
    for(const label of this.labels){
      const distance=label.position.distanceTo(this.camera.position);let visible=label.active!==false&&distance<(label.kind==='resource'?16:label.kind==='camp'?35:60);
      if(label.kind==='self')visible=false;const toPoint=tempPoint.copy(label.position).sub(this.camera.position);if(toPoint.dot(viewDirection)<0)visible=false;
      if(visible){tempPoint.copy(label.position).project(this.camera);visible=tempPoint.z>-1&&tempPoint.z<1&&Math.abs(tempPoint.x)<1.1&&Math.abs(tempPoint.y)<1.1;
        label.element.style.transform=`translate(${(tempPoint.x*.5+.5)*this.width}px,${(-tempPoint.y*.5+.5)*this.height}px) translate(-50%,-100%)`;label.element.style.opacity=String(clamp((label.kind==='resource'?18:65)-distance,0,10)/10);}
      label.element.hidden=!visible;
    }
  }

  destroy(){
    this.disposed=true;this.releaseTerrainSampler?.();this.releaseBridgeSampler?.();cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.labelLayer.remove();this.loadingLabel?.remove();
    for(const entity of this.players.values())if(entity.actor)this.scene.remove(entity.model);
    for(const landscape of this.landscapes)landscape.dispose();
    this.characterAssets.dispose();this.neanderthalAssets.dispose();this.worldAssets.dispose();
    for(const[event,handler]of[['pointerdown',this.down],['pointermove',this.move],['pointerup',this.up],['pointercancel',this.cancel],['lostpointercapture',this.cancel],['wheel',this.wheel],['contextmenu',this.context],['webglcontextlost',this.contextLost]])this.canvas.removeEventListener(event,handler);
    const geometries=new Set(),mats=new Set();this.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);}if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());this.disposables.forEach(d=>d.dispose());this.renderer.dispose();
  }
}
