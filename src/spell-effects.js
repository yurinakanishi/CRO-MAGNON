import * as THREE from 'three';
import { walkHeight } from '/shared/terrain.mjs';
import { attackProfile } from '/shared/combat-profiles.mjs';

const CAPACITY=768,point=new THREE.Vector3();

// Light is a runtime particle effect, with a single reusable GPU buffer and draw
// call. Damage, flight positions and impacts all come from server snapshots.
export class SpellEffects {
  constructor(scene) {
    this.positions=new Map();this.geometry=new THREE.BufferGeometry();
    this.xyz=new Float32Array(CAPACITY*3);this.size=new Float32Array(CAPACITY);this.alpha=new Float32Array(CAPACITY);
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.xyz,3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('size',new THREE.BufferAttribute(this.size,1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('opacity',new THREE.BufferAttribute(this.alpha,1).setUsage(THREE.DynamicDrawUsage));
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      uniforms:{pixelHeight:{value:720}},
      vertexShader:'attribute float size;attribute float opacity;uniform float pixelHeight;varying float alpha;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*pixelHeight*projectionMatrix[1][1]/max(0.2,-p.z),1.0,180.0);alpha=opacity*exp(-0.007*length(p.xyz));}',
      fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-0.5)*2.0;if(r>1.0)discard;float core=exp(-r*r*22.0);float halo=pow(1.0-r,2.0);vec3 color=mix(vec3(0.26,0.75,0.85),vec3(1.0,0.90,0.55),core);gl_FragColor=vec4(color,alpha*(halo*0.7+core));}'});
    this.points=new THREE.Points(this.geometry,this.material);this.points.frustumCulled=false;this.points.renderOrder=4;scene.add(this.points);this.count=0;
  }
  add(x,y,z,size,alpha) {
    if(this.count>=CAPACITY)return;
    const i=this.count++;this.xyz[i*3]=x;this.xyz[i*3+1]=y;this.xyz[i*3+2]=z;this.size[i]=size;this.alpha[i]=alpha;
  }
  update(state,players,now,dt,pixelHeight) {
    this.count=0;this.material.uniforms.pixelHeight.value=pixelHeight;
    const active=new Set();
    for(const orb of state.projectiles || []) {
      active.add(orb.id);let p=this.positions.get(orb.id);
      if(!p){p={x:orb.x,z:orb.z};this.positions.set(orb.id,p);}
      const factor=1-Math.exp(-dt*28);p.x+=(orb.x-p.x)*factor;p.z+=(orb.z-p.z)*factor;
      const y=walkHeight(p.x,p.z)+.40;
      this.add(p.x,y,p.z,.48,1);
      for(let i=1;i<=9;i++) {
        const d=i*.052,phase=now*.012+i*2.4;
        this.add(p.x-orb.dx*d+Math.cos(phase)*.025,y+Math.sin(phase)*.032,p.z-orb.dz*d,.18*(1-i/12),.7*(1-i/11));
      }
    }
    for(const id of this.positions.keys())if(!active.has(id))this.positions.delete(id);
    for(const impact of state.projectileImpacts || []) {
      const age=Math.max(0,(now-impact.at)/1000);if(age>.6)continue;
      const y=walkHeight(impact.x,impact.z)+.40,fade=1-age/.6;
      this.add(impact.x,y,impact.z,.65+age*.7,fade*.6);
      for(let i=0;i<18;i++){
        const a=i*2.39996323,s=Math.sqrt((i+.5)/18),d=age*(.55+s);
        this.add(impact.x+Math.cos(a)*d,y+Math.sin(i*3.7)*d,impact.z+Math.sin(a)*d,.065,fade);
      }
    }
    for(const entity of players.values()) {
      const p=entity.state,profile=attackProfile(p);if(profile.key!=='magic'||!p.attackSequence||p.downedUntil)continue;
      const age=(now-p.attackAt)/1000;if(age<0||age>=profile.impactMs/1000)continue;
      entity.model.updateMatrixWorld(true);
      for(const grip of [entity.gripLeft,entity.gripRight]) {
        if(!grip)continue;grip.getWorldPosition(point);const growth=age/(profile.impactMs/1000);
        this.add(point.x,point.y,point.z,.16+growth*.16,.55+growth*.35);
        for(let i=0;i<6;i++){
          const a=now*.014+i*Math.PI/3,r=.09*(1-growth*.45);
          this.add(point.x+Math.cos(a)*r,point.y+Math.sin(a)*r,point.z,.04,.6);
        }
      }
    }
    this.points.visible=this.count>0;this.geometry.setDrawRange(0,this.count);
    for(const attribute of Object.values(this.geometry.attributes)){attribute.clearUpdateRanges();attribute.addUpdateRange(0,this.count*attribute.itemSize);attribute.needsUpdate=true;}
  }
  dispose(){this.points.removeFromParent();this.geometry.dispose();this.material.dispose();this.positions.clear();}
}
