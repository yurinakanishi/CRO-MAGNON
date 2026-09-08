import { isMesh } from './three-types.js';
import * as THREE from 'three';
import { ADVENTURE_REGIONS, RIFTS, adventureProgress } from '../shared/adventure-regions.mjs';
import { terrainHeight } from '../shared/terrain.mjs';

// Beacons, rift motes and rippling water are runtime effects around actual
// TRELLIS stones and water. No substitute scenery meshes are constructed.
export class AdventureEffects {
  declare world: any;
  declare markers: {
    label: { active?: boolean; element: HTMLElement };
    point: { id: string; name: string; x: number; z: number };
    region?: (typeof ADVENTURE_REGIONS)[number];
    rift?: boolean;
  }[];
  declare uniforms: {
    time: {
      value: number;
    };
    pixelScale: {
      value: number;
    };
  };
  declare motes: THREE.Points<
    THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>,
    THREE.ShaderMaterial,
    THREE.Object3DEventMap
  >;
  declare spring: {
    root: any;
    material: THREE.MeshStandardMaterial;
  } | null;

  constructor(world) {
    this.world = world;
    this.markers = [];
    this.uniforms = { time: { value: 0 }, pixelScale: { value: 1 } };
    const positions = [],
      seeds = [];
    for (const r of ADVENTURE_REGIONS)
      for (const point of r.checkpoints) {
        for (let i = 0; i < 12; i++) {
          positions.push(point.x, terrainHeight(point.x, point.z) + 0.3, point.z);
          seeds.push(i / 12, 0, r.realm ? 1 : 0);
        }
        const label = world.createLabel(
          point.name,
          'adventure-marker',
          new THREE.Vector3(point.x, terrainHeight(point.x, point.z) + 1.9, point.z),
          '道標',
        );
        this.markers.push({ label, point, region: r });
      }
    for (const rift of RIFTS) {
      for (let i = 0; i < 90; i++) {
        positions.push(rift.x, terrainHeight(rift.x, rift.z), rift.z);
        seeds.push(i / 90, 1, 1);
      }
      const label = world.createLabel(
        rift.name,
        'adventure-marker rift-marker',
        new THREE.Vector3(rift.x, terrainHeight(rift.x, rift.z) + 3.8, rift.z),
        '近づいて E',
      );
      this.markers.push({ label, point: rift });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 seed;uniform float time,pixelScale;varying vec3 glowColor;varying float glow;
        void main(){vec3 p=position;float a=seed.x*6.283+time*.45;
        if(seed.y>.5){p.x+=cos(a)*1.3;p.y+=2.0+sin(a)*1.8;p.z+=sin(seed.x*28.0+time)*.13;}
        else{p.x+=cos(a)*.25;p.z+=sin(a)*.25;p.y+=mod(seed.x*2.5+time*.35,2.5);}
        glowColor=mix(vec3(1.0,.69,.27),vec3(.48,.65,1.0),seed.z);vec4 eye=modelViewMatrix*vec4(p,1.0);
        gl_Position=projectionMatrix*eye;gl_PointSize=clamp(90.0*pixelScale/max(1.0,-eye.z),1.0,22.0);glow=1.0-smoothstep(65.0,100.0,length(eye.xyz));}`,
      fragmentShader:
        'varying vec3 glowColor;varying float glow;void main(){float d=length(gl_PointCoord-.5)*2.0;gl_FragColor=vec4(glowColor,pow(max(0.0,1.0-d),2.0)*glow*.8);}',
    });
    this.motes = new THREE.Points(geometry, material);
    this.motes.frustumCulled = false;
    world.scene.add(this.motes);
    this.spring = null;
  }
  makeSpring() {
    const world = this.world,
      root = world.worldAssets.create('river-water');
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root),
      size = box.getSize(new THREE.Vector3()),
      centre = box.getCenter(new THREE.Vector3());
    const material = new THREE.MeshStandardMaterial({
      color: '#477b74',
      roughness: 0.38,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.springTime = this.uniforms.time;
      shader.vertexShader = 'varying vec3 springWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nspringWorld=(modelMatrix*vec4(transformed,1.0)).xyz;',
      );
      shader.fragmentShader =
        'uniform float springTime;varying vec3 springWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 shore=(springWorld.xz-vec2(-153.0,416.0))/vec2(4.8,3.3);
        float edge=length(shore)+sin(shore.x*9.0+shore.y*4.0)*.025+cos(shore.y*11.0)*.018;
        if(edge>1.0)discard;
        float wave=sin(springWorld.x*3.0+springWorld.z*1.4-springTime*.8)*sin(springWorld.z*2.3+springTime*.6);
        diffuseColor.rgb+=wave*.006;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.40,.32,.16),smoothstep(.78,1.0,edge)*.75);
      `,
      );
    };
    material.customProgramCacheKey = () => 'adventure-spring-2';
    root.traverse((node) => {
      if (isMesh(node)) node.material = material;
    });
    root.scale.set(10 / size.x, 0.008, 7 / size.z);
    root.position.set(
      -153 - centre.x * root.scale.x,
      terrainHeight(-153, 416) + 0.05 - box.max.y * 0.008,
      416 - centre.z * root.scale.z,
    );
    world.scene.add(root);
    this.spring = { root, material };
  }
  update(time) {
    const world = this.world,
      me = world.state.players.find((p) => p.id === world.selfId);
    this.uniforms.time.value = time;
    this.uniforms.pixelScale.value = world.renderer.getPixelRatio();
    for (const { label, point, region } of this.markers) {
      const near = Math.hypot(world.focus.x - point.x, world.focus.z - point.z) < 65;
      label.active = near;
      label.element.classList.toggle(
        'visited',
        !!region && adventureProgress(me, region.id).visited.includes(point.id),
      );
    }
    const springNear = Math.hypot(world.focus.x + 153, world.focus.z - 416) < 100;
    if (springNear && !this.spring) this.makeSpring();
    if (this.spring) {
      this.spring.root.visible = springNear;
      if (!springNear) {
        world.scene.remove(this.spring.root);
        this.spring.material.dispose();
        this.spring = null;
      }
    }
  }
  dispose() {
    this.world.scene.remove(this.motes);
    this.motes.geometry.dispose();
    this.motes.material.dispose();
    for (const { label } of this.markers) {
      label.active = false;
      label.element.remove();
    }
    if (this.spring) {
      this.world.scene.remove(this.spring.root);
      this.spring.material.dispose();
    }
  }
}
