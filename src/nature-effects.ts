import * as THREE from 'three';
import { jumpProgress } from '../shared/jumping.mjs';
import { caveInteriorWeight, caveTorchLit } from '../shared/cave-light.mjs';
import { FootstepClock, natureWind, waterAt, type SoundPoint } from './nature-environment.js';

function particles(count: number, smoke = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('life', new THREE.BufferAttribute(new Float32Array(count), 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { scale: { value: 600 }, alpha: { value: 1 } },
    vertexShader: `attribute float life; varying float fade; uniform float scale;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;
        gl_PointSize=min(${smoke ? '100.' : '4.'}, scale*${smoke ? '(.25+life*.9)' : '.012'}/max(1.,-p.z));
        fade=sin(clamp(life,0.,1.)*3.14159);}`,
    fragmentShader: `varying float fade;uniform float alpha;void main(){
      float d=length(gl_PointCoord-vec2(.5))*2.;if(d>1.)discard;
      gl_FragColor=vec4(${smoke ? 'vec3(.34,.36,.34)' : 'vec3(.9,.72,.44)'},
        pow(1.-d,2.)*fade*alpha*${smoke ? '.22' : '.42'});}`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/** Small fixed pools; no per-frame allocation of geometry or audio dependency. */
export class NatureEffects {
  readonly stats = { smoke: 0, dust: 0, ripples: 0, footfalls: 0 };
  private smoke = new Map<any, ReturnType<typeof particles>>();
  private dust = particles(40);
  private ripples: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; at: number }[] =
    [];
  private steps = new FootstepClock();
  private cursor = 0;
  private attached = false;
  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 8; i++) {
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { opacity: { value: 0 } },
        vertexShader:
          'varying vec2 uvRing;void main(){uvRing=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `varying vec2 uvRing;uniform float opacity;void main(){
          float r=length(uvRing-vec2(.5))*2.;float ring=1.-smoothstep(.018,.075,abs(r-.82));
          if(ring<.01)discard;gl_FragColor=vec4(.66,.8,.81,ring*opacity);}`,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.ripples.push({ mesh, at: -Infinity });
    }
  }
  private footfall(p: SoundPoint, time: number) {
    this.stats.footfalls++;
    const water = waterAt(p);
    if (water === null) return;
    const ripple = this.ripples[this.cursor++ % this.ripples.length];
    ripple.at = time;
    ripple.mesh.position.set(p.x, water + 0.025, p.z);
  }
  update(world: any, time: number) {
    if (!this.attached) {
      world.scene.add(this.dust, ...this.ripples.map((r) => r.mesh));
      this.attached = true;
    }
    const low = world.graphics.tier === 'low',
      scale = world.height * world.renderer.getPixelRatio();
    this.stats.smoke = 0;
    const activeFires = new Set(world.fires);
    for (const [fire, smoke] of this.smoke)
      if (!activeFires.has(fire)) {
        this.release(smoke);
        this.smoke.delete(fire);
      }
    for (const fire of world.fires) {
      if (fire.cave) continue;
      let smoke = this.smoke.get(fire);
      if (!smoke) {
        smoke = particles(12, true);
        fire.root.add(smoke);
        this.smoke.set(fire, smoke);
      }
      smoke.visible = fire.light.visible && !world.occluded();
      if (!smoke.visible) continue;
      const count = low ? 6 : 12;
      smoke.geometry.setDrawRange(0, count);
      smoke.material.uniforms.scale.value = scale;
      const pos = smoke.geometry.getAttribute('position'),
        life = smoke.geometry.getAttribute('life');
      const wind = natureWind(time, fire.root.position.x, fire.root.position.z);
      for (let i = 0; i < count; i++) {
        const age = (time * 0.16 + i / count) % 1;
        pos.setXYZ(
          i,
          Math.sin(i * 17 + time * 0.25) * age * 0.22 + wind.x * age * age * 3,
          0.7 + age * 3.2,
          Math.cos(i * 31 + time * 0.2) * age * 0.18 + wind.z * age * age * 3,
        );
        life.setX(i, age);
      }
      pos.needsUpdate = life.needsUpdate = true;
      this.stats.smoke += count;
    }
    const entity = world.players.get(world.selfId),
      p = entity?.state;
    const visible = p && entity.actor && entity.model.visible && !world.occluded();
    const position = entity?.model.position;
    const cave = visible ? caveInteriorWeight(position) : 0;
    const lit =
      visible &&
      (caveTorchLit(p) ||
        world.fires.some(
          (f) => f.cave && f.light.visible && f.root.position.distanceTo(position) < 7,
        ));
    this.dust.visible = cave > 0.1 && !!lit;
    this.stats.dust = this.dust.visible ? (low ? 16 : 40) : 0;
    if (this.dust.visible) {
      const count = this.stats.dust,
        pos = this.dust.geometry.getAttribute('position'),
        life = this.dust.geometry.getAttribute('life');
      this.dust.geometry.setDrawRange(0, count);
      this.dust.position.copy(position);
      this.dust.material.uniforms.scale.value = scale;
      this.dust.material.uniforms.alpha.value = cave;
      for (let i = 0; i < count; i++) {
        const age = (time * 0.04 + i / count) % 1;
        pos.setXYZ(
          i,
          Math.sin(i * 17.7 + time * 0.055) * 2.3,
          0.2 + age * 2.1,
          Math.cos(i * 9.3 + time * 0.06) * 2.3,
        );
        life.setX(i, age);
      }
      pos.needsUpdate = life.needsUpdate = true;
    }
    if (visible) {
      const animation = entity.actor.animation,
        motion = p.id === world.predictedMotion?.id ? world.predictedMotion : p;
      const phase = /^(Walk|Run)_Loop$/.test(animation.name)
        ? (animation.current.time / animation.current.getClip().duration) % 1
        : null;
      if (
        this.steps.update(
          {
            x: position.x,
            y: position.y,
            z: position.z,
            id: p.id,
            warp: p.warpSequence ?? 0,
            moving: !!motion.moving && motion.speed > 0.03,
            grounded:
              !p.downedUntil &&
              !p.mountId &&
              !p.boatId &&
              !p.carrierId &&
              !p.passengerId &&
              jumpProgress(p, world.serverNow()) === null,
            clip: animation.name,
            phase,
          },
          time,
        )
      )
        this.footfall(position, time);
    } else this.steps.reset();
    this.stats.ripples = 0;
    for (const ripple of this.ripples) {
      const age = time - ripple.at;
      ripple.mesh.visible = visible && age >= 0 && age < 1.15;
      if (!ripple.mesh.visible) continue;
      ripple.mesh.scale.setScalar(0.2 + age * 1.1);
      ripple.mesh.material.uniforms.opacity.value = 0.32 * (1 - age / 1.15);
      this.stats.ripples++;
    }
  }
  private release(points: ReturnType<typeof particles>) {
    points.removeFromParent();
    points.geometry.dispose();
    points.material.dispose();
  }
  dispose() {
    for (const smoke of this.smoke.values()) this.release(smoke);
    this.smoke.clear();
    this.release(this.dust);
    for (const r of this.ripples) {
      r.mesh.removeFromParent();
      r.mesh.material.dispose();
    }
    this.ripples[0].mesh.geometry.dispose();
  }
}
