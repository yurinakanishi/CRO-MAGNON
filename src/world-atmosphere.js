import * as THREE from 'three';
import { BIOMES, biomeWeights, biomeAt } from '/shared/biomes.mjs';
import { WORLD } from '/shared/world.mjs';
import { ADVENTURE_REGIONS, regionAt, regionWeight } from '/shared/adventure-regions.mjs';

export class WorldAtmosphere {
  constructor(world) {
    this.world=world;this.fogColors=BIOMES.map(b=>new THREE.Color(b.fog));this.skyColors=BIOMES.map(b=>new THREE.Color(b.sky));this.lightColors=BIOMES.map(b=>new THREE.Color(b.light));
    this.target=new THREE.Color();this.sky=new THREE.Color();this.light=new THREE.Color();
    this.regions=new Map(ADVENTURE_REGIONS.map(r=>[r.id,{fog:new THREE.Color(r.fog),sky:new THREE.Color(r.sky),light:new THREE.Color(r.light)}]));
    const seeds=new Float32Array(384*3);for(let i=0;i<seeds.length;i++)seeds[i]=((i*1619+Math.floor(i/3)*31337)%65521)/65521;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(seeds,3));
    this.uniforms={time:{value:0},centre:{value:new THREE.Vector3()},intensity:{value:0},kind:{value:0},color:{value:new THREE.Color('#e8f1f7')},pixelScale:{value:1}};
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:this.uniforms,
      vertexShader:`uniform float time,intensity,kind,pixelScale;uniform vec3 centre;varying float opacity;
        void main(){vec3 p=position;float snow=1.0-step(.5,kind);p.x=(p.x-.5)*42.0+sin(time*.21+p.z*30.0)*1.2;
        p.z=(p.z-.5)*42.0;p.y=mod(p.y*14.0-time*mix(1.1,.42,snow),14.0)-2.0;
        p.x+=sin(time*.7+p.y)*mix(2.0,.6,snow);vec4 eye=modelViewMatrix*vec4(p+centre,1.0);
        gl_Position=projectionMatrix*eye;gl_PointSize=clamp((snow>0.5?26.0:16.0)/max(2.0,-eye.z)*pixelScale,1.0,4.0);
        opacity=intensity*(1.0-smoothstep(12.0,22.0,length(p.xz)))*.65;}`,
      fragmentShader:'uniform vec3 color;varying float opacity;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(color,opacity*(1.0-smoothstep(.15,.5,d)));}'});
    this.particles=new THREE.Points(geometry,material);this.particles.frustumCulled=false;this.particles.visible=false;world.scene.add(this.particles);
  }
  update(position,time,dt) {
    const weights=biomeWeights(position.x,position.z),alpha=1-Math.exp(-dt*1.8);
    this.target.setRGB(0,0,0);this.sky.setRGB(0,0,0);this.light.setRGB(0,0,0);
    for(let i=0;i<weights.length;i++)for(const channel of ['r','g','b']) {
      this.target[channel]+=this.fogColors[i][channel]*weights[i];this.sky[channel]+=this.skyColors[i][channel]*weights[i];this.light[channel]+=this.lightColors[i][channel]*weights[i];
    }
    const world=this.world;
    const region=regionAt(position.x,position.z),weight=regionWeight(region,position.x,position.z),colors=this.regions.get(region?.id);
    if(colors){this.target.lerp(colors.fog,weight);this.sky.lerp(colors.sky,weight);this.light.lerp(colors.light,weight);}
    const shadow=region?.realm?weight:0;
    world.sun.intensity+=(2.65-shadow*1.7-world.sun.intensity)*alpha;
    world.hemisphere.intensity+=(2-shadow*1.1-world.hemisphere.intensity)*alpha;
    world.skyUniforms.shadowRealm.value+=(shadow-world.skyUniforms.shadowRealm.value)*alpha;
    world.scene.fog.color.lerp(this.target,alpha);world.sun.color.lerp(this.light,alpha);
    const edge=Math.min(position.x-WORLD.minX,WORLD.maxX-position.x,position.z-WORLD.minZ,WORLD.maxZ-position.z);
    world.scene.fog.near=Math.min(45,Math.max(5,edge*.4));world.scene.fog.far=Math.min(118,Math.max(12,edge+8));
    world.skyUniforms.biomeFog.value.copy(world.scene.fog.color);world.skyUniforms.biomeSky.value.lerp(this.sky,alpha);
    const biome=biomeAt(position.x,position.z),snow=weights[1]+weights[2],ash=weights[3],sand=weights[4];
    const intensity=(snow*.8+ash*.35+sand*.32)*(1-shadow)+shadow*.65;
    this.uniforms.intensity.value+=(intensity-this.uniforms.intensity.value)*alpha;
    this.particles.visible=this.uniforms.intensity.value>.01;this.uniforms.time.value=time;this.uniforms.centre.value.set(position.x,position.y,position.z);
    this.uniforms.kind.value=snow>.45&&shadow<.5?0:1;this.uniforms.pixelScale.value=world.renderer.getPixelRatio();
    this.uniforms.color.value.set(shadow>.5?'#b6a1ff':snow>.45?'#eaf2ff':ash>.45?'#d39b7b':'#e2c799');
    world.canvas.dataset.biome=biome.id;world.canvas.dataset.weather=biome.weather;
    world.canvas.dataset.adventureRegion=region?.id??'';
  }
  dispose(){this.world.scene.remove(this.particles);this.particles.geometry.dispose();this.particles.material.dispose();}
}
