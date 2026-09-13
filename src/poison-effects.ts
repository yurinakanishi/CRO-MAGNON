import * as THREE from 'three';
import { poisonPoint } from '../shared/behemoth-poison.mjs';
import { BEHEMOTH as R } from '../shared/behemoth-rules.mjs';
import { behemothWindupMouth } from '../shared/behemoth-mouth.mjs';
import { projectileHeight } from '../shared/terrain.mjs';

const CAPACITY = 512;
// Opaque-looking, shaded liquid beads instead of additive magic sparks. The
// elongated head, contiguous stream and smaller ballistic drops share one draw.
export class PoisonEffects {
  geometry = new THREE.BufferGeometry();
  xyz = new Float32Array(CAPACITY * 3);
  sizes = new Float32Array(CAPACITY);
  alpha = new Float32Array(CAPACITY);
  velocity = new Float32Array(CAPACITY * 3);
  count = 0;
  material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { pixelHeight: { value: 720 } },
    vertexShader: `
      attribute float size; attribute float opacity; attribute vec3 velocity;
      uniform float pixelHeight; varying float alpha; varying vec2 direction;
      void main(){
        vec4 p=modelViewMatrix*vec4(position,1.0);
        gl_Position=projectionMatrix*p;
        gl_PointSize=clamp(size*pixelHeight*projectionMatrix[1][1]/max(.2,-p.z),1.,180.);
        vec2 v=(modelViewMatrix*vec4(velocity,0.)).xy;
        direction=length(v)>.01?normalize(v):vec2(0.,1.);
        alpha=opacity*exp(-.004*length(p.xyz));
      }`,
    fragmentShader: `
      varying float alpha; varying vec2 direction;
      void main(){
        vec2 uv=(gl_PointCoord-.5)*2.; uv.y=-uv.y;
        vec2 q=vec2(dot(uv,vec2(-direction.y,direction.x)),dot(uv,direction));
        q.x*=1.65;
        float r=dot(q,q); if(r>1.)discard;
        float roundness=sqrt(max(0.,1.-r));
        float shine=pow(max(0.,1.-length(q-vec2(-.22,.23))*2.7),5.);
        vec3 color=mix(vec3(.06,.14,.015),vec3(.39,.68,.035),roundness);
        color+=vec3(.68,.79,.38)*shine;
        gl_FragColor=vec4(color,alpha*smoothstep(1.,.78,r));
      }`,
  });
  points = new THREE.Points(this.geometry, this.material);
  constructor(scene) {
    for (const [key, array, size] of [
      ['position', this.xyz, 3],
      ['size', this.sizes, 1],
      ['opacity', this.alpha, 1],
      ['velocity', this.velocity, 3],
    ] as const)
      this.geometry.setAttribute(
        key,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  add(x, y, z, size, opacity, vx = 0, vy = 1, vz = 0) {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    this.xyz.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.sizes[i] = size;
    this.alpha[i] = opacity;
  }
  update(state, now, pixelHeight) {
    this.count = 0;
    this.material.uniforms.pixelHeight.value = pixelHeight;
    for (const shot of state.poisonShots ?? []) {
      if (now >= shot.expiresAt) continue;
      // Analytic sampling preserves gravity and also handles late joins.
      const age = Math.max(0, (Math.min(now, shot.updatedAt + 100) - shot.createdAt) / 1000);
      for (let i = 0; i < 25; i++) {
        const lag = i * 0.008,
          t = age - lag;
        if (t < 0) break;
        const p = poisonPoint(shot, t),
          scatter = i < 10 ? 0 : (Math.min(0.32, age * 0.25) * (i - 9)) / 16,
          a = i * 2.399963;
        this.add(
          p.x + Math.cos(a) * scatter,
          p.y + Math.sin(a * 1.7) * scatter,
          p.z + Math.sin(a) * scatter,
          i === 0
            ? R.spitRadius * 2
            : i < 10
              ? R.spitRadius * (1.4 - i * 0.06)
              : 0.13 + (i % 3) * 0.035,
          i < 10 ? 0.94 : 0.82,
          shot.vx,
          shot.vy - R.spitGravity * t,
          shot.vz,
        );
      }
    }
    for (const splash of state.poisonSplashes ?? []) {
      const t = Math.max(0, (now - splash.at) / 1000);
      if (t > 0.85) continue;
      const radius = splash.radius ?? R.spitSplashRadius,
        spread = Math.min(1, t / 0.23) * radius;
      for (let i = 0; i < 36; i++) {
        const angle = i * 2.399963,
          r = spread * Math.sqrt((i + 0.5) / 36);
        this.add(
          splash.x + Math.cos(angle) * r,
          (splash.floorY ?? splash.y) + 0.035,
          splash.z + Math.sin(angle) * r,
          0.28 + (i % 3) * 0.1,
          (1 - t / 0.85) * 0.85,
        );
      }
      for (let i = 0; i < 30; i++) {
        const a = i * 2.399963,
          speed = 1.5 + (i % 7) * 0.55,
          vy = 1.1 + (i % 5) * 0.35,
          y = splash.y + vy * t - 0.5 * R.spitGravity * t * t;
        if (y < splash.y - 0.08) continue;
        this.add(
          splash.x + Math.cos(a) * speed * t,
          y,
          splash.z + Math.sin(a) * speed * t,
          0.085 + (i % 4) * 0.033,
          1 - t / 0.85,
          Math.cos(a) * speed,
          vy - R.spitGravity * t,
          Math.sin(a) * speed,
        );
      }
      this.add(splash.x, splash.y + 0.025, splash.z, 0.6 + t * 1.4, (1 - t / 0.85) * 0.8);
    }
    for (const e of state.enemies ?? []) {
      if (e.modelKey !== R.modelKey || e.phase !== 'alive' || e.behavior !== 'spit-windup')
        continue;
      const age = Math.max(0, (now - e.attackAt) / 1000),
        strength = Math.min(1, age / (R.spitWindupMs / 1000));
      // Heavy drips build up at the mouth while the neck draws back.
      const mouth = behemothWindupMouth(strength),
        forward = mouth.forward * e.scale,
        y = projectileHeight(e.x, e.z, e.elevation ?? 0) + mouth.height * e.scale,
        x = e.x + Math.sin(e.facing) * forward,
        z = e.z + Math.cos(e.facing) * forward;
      for (let i = 0; i < 4; i++) {
        const fall = (age * 1.7 + i * 0.23) % 1;
        this.add(
          x + Math.cos(i * 4) * 0.08,
          y - fall * fall * 0.55,
          z + Math.sin(i * 4) * 0.08,
          0.055 + strength * 0.08,
          (1 - fall) * strength,
          0,
          -1,
          0,
        );
      }
    }
    this.points.visible = this.count > 0;
    this.geometry.setDrawRange(0, this.count);
    for (const a of Object.values(this.geometry.attributes)) {
      if (!(a instanceof THREE.BufferAttribute)) continue;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }
  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
