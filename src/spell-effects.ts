import * as THREE from 'three';
import { projectileHeight } from '../shared/terrain.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { PoisonEffects } from './poison-effects.js';

const CAPACITY = 1024,
  point = new THREE.Vector3(),
  otherHand = new THREE.Vector3();
// Player light is teal with a warm core; the sorcerer's hex magic is red with a
// pale hot core, so the two are told apart at a glance.
const LIGHT = Object.freeze({ halo: [0.26, 0.75, 0.85], core: [1.0, 0.9, 0.55] }),
  HEX = Object.freeze({ halo: [0.95, 0.08, 0.12], core: [1.0, 0.72, 0.5] });
const isHex = (item) => item.kind === 'hex';

// Light is a runtime particle effect, with a single reusable GPU buffer and draw
// call. Damage, flight positions and impacts all come from server snapshots.
export class SpellEffects {
  poison: PoisonEffects;
  declare positions: Map<any, any>;
  declare geometry: THREE.BufferGeometry<
    THREE.NormalBufferAttributes,
    THREE.BufferGeometryEventMap
  >;
  declare xyz: Float32Array<ArrayBuffer>;
  declare size: Float32Array<ArrayBuffer>;
  declare alpha: Float32Array<ArrayBuffer>;
  declare halo: Float32Array<ArrayBuffer>;
  declare core: Float32Array<ArrayBuffer>;
  declare material: THREE.ShaderMaterial;
  declare points: THREE.Points<
    THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>,
    THREE.ShaderMaterial,
    THREE.Object3DEventMap
  >;
  declare count: number;

  constructor(scene) {
    this.poison = new PoisonEffects(scene);
    this.positions = new Map();
    this.geometry = new THREE.BufferGeometry();
    this.xyz = new Float32Array(CAPACITY * 3);
    this.size = new Float32Array(CAPACITY);
    this.alpha = new Float32Array(CAPACITY);
    this.halo = new Float32Array(CAPACITY * 3);
    this.core = new Float32Array(CAPACITY * 3);
    this.geometry.setAttribute(
      'halo',
      new THREE.BufferAttribute(this.halo, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'core',
      new THREE.BufferAttribute(this.core, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.xyz, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'size',
      new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'opacity',
      new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { pixelHeight: { value: 720 } },
      vertexShader:
        'attribute float size;attribute float opacity;attribute vec3 halo;attribute vec3 core;uniform float pixelHeight;varying float alpha;varying vec3 haloColor;varying vec3 coreColor;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*pixelHeight*projectionMatrix[1][1]/max(0.2,-p.z),1.0,180.0);alpha=opacity*exp(-0.007*length(p.xyz));haloColor=halo;coreColor=core;}',
      fragmentShader:
        'varying float alpha;varying vec3 haloColor;varying vec3 coreColor;void main(){float r=length(gl_PointCoord-0.5)*2.0;if(r>1.0)discard;float core=exp(-r*r*22.0);float halo=pow(1.0-r,2.0);vec3 color=mix(haloColor,coreColor,core);gl_FragColor=vec4(color,alpha*(halo*0.7+core));}',
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.count = 0;
  }
  add(x, y, z, size, alpha, palette = LIGHT) {
    if (this.count >= CAPACITY) return;
    const i = this.count++;
    this.xyz[i * 3] = x;
    this.xyz[i * 3 + 1] = y;
    this.xyz[i * 3 + 2] = z;
    this.size[i] = size;
    this.alpha[i] = alpha;
    for (let k = 0; k < 3; k++) {
      this.halo[i * 3 + k] = palette.halo[k];
      this.core[i * 3 + k] = palette.core[k];
    }
  }
  // The sorcerer's area burst: a red ring on the floor grows and pulses through
  // the windup so players know where to leave, then flashes outward on detonation.
  addBurst(burst, now) {
    const y = projectileHeight(burst.x, burst.z, burst.elevation) + 0.12;
    if (burst.detonatedAt == null && now < burst.at) {
      const progress = Math.max(
          0,
          Math.min(1, (now - burst.startedAt) / (burst.at - burst.startedAt)),
        ),
        pulse = 0.55 + 0.45 * Math.sin(now * 0.02 * (1 + progress * 2));
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        this.add(
          burst.x + Math.cos(a) * burst.radius,
          y + 0.05 + Math.sin(now * 0.01 + i) * 0.04,
          burst.z + Math.sin(a) * burst.radius,
          0.16 + progress * 0.12,
          (0.45 + progress * 0.5) * pulse,
          HEX,
        );
      }
      // Spokes fill the circle as the detonation nears.
      const spokes = 8,
        fill = progress * burst.radius;
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * Math.PI * 2 + now * 0.0015;
        for (let d = 0.6; d < fill; d += 0.6)
          this.add(
            burst.x + Math.cos(a) * d,
            y + 0.08,
            burst.z + Math.sin(a) * d,
            0.1,
            0.35 * pulse,
            HEX,
          );
      }
      this.add(burst.x, y + 0.6, burst.z, 0.3 + progress * 0.5, 0.5 + progress * 0.5, HEX);
      return;
    }
    const since = Math.max(0, (now - (burst.detonatedAt ?? burst.at)) / 1000);
    if (since > 0.6) return;
    const fade = 1 - since / 0.6,
      reach = burst.radius * Math.min(1, since / 0.35);
    this.add(burst.x, y + 0.5, burst.z, 1.2 + since * 2, fade * 0.8, HEX);
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      this.add(
        burst.x + Math.cos(a) * reach,
        y + 0.1 + since * 1.4 * ((i % 4) / 3),
        burst.z + Math.sin(a) * reach,
        0.22,
        fade,
        HEX,
      );
    }
  }
  update(state, players, now, dt, pixelHeight) {
    this.poison.update(state, now, pixelHeight);
    this.count = 0;
    this.material.uniforms.pixelHeight.value = pixelHeight;
    const active = new Set();
    for (const orb of state.projectiles || []) {
      active.add(orb.id);
      const palette = isHex(orb) ? HEX : LIGHT;
      let p = this.positions.get(orb.id);
      if (!p) {
        // The server sweeps from the body centre to prevent firing through an
        // adjacent wall. Draw from the hands while retaining that collision path.
        const originX = orb.x - orb.dx * orb.travelled,
          originZ = orb.z - orb.dz * orb.travelled,
          baseY = projectileHeight(originX, originZ, orb.elevation) + 0.4;
        point.set(originX + orb.dx * 0.16, baseY, originZ + orb.dz * 0.16);
        const owner = players.get(orb.ownerId);
        if (owner?.gripLeft && owner?.gripRight) {
          owner.model.updateMatrixWorld(true);
          owner.gripLeft.getWorldPosition(point);
          owner.gripRight.getWorldPosition(otherHand);
          point.add(otherHand).multiplyScalar(0.5);
        }
        const forward = Math.max(0, (point.x - originX) * orb.dx + (point.z - originZ) * orb.dz);
        p = {
          x: orb.x,
          z: orb.z,
          originX,
          originZ,
          forward,
          lateral: (point.x - originX) * orb.dz - (point.z - originZ) * orb.dx,
          handHeight: point.y - baseY,
          handBlendDistance: owner?.state.carrierId ? 2 : 0.35,
        };
        this.positions.set(orb.id, p);
      }
      const factor = 1 - Math.exp(-dt * 28);
      p.x += (orb.x - p.x) * factor;
      p.z += (orb.z - p.z) * factor;
      const travelled = Math.max(
        0,
        (p.x - p.originX) * orb.dx + (p.z - p.originZ) * orb.dz - p.forward,
      );
      // Rejoin the authoritative centre line smoothly after leaving the hands.
      // Until then, never move the visible head or trail behind the emitter.
      const flightPoint = (distance) => {
        const blend = Math.max(0, 1 - distance / p.handBlendDistance),
          forward = p.forward + distance,
          lateral = p.lateral * blend;
        point.set(
          p.originX + orb.dx * forward + orb.dz * lateral,
          0,
          p.originZ + orb.dz * forward - orb.dx * lateral,
        );
        point.y = projectileHeight(point.x, point.z, orb.elevation) + 0.4 + p.handHeight * blend;
      };
      flightPoint(travelled);
      this.add(point.x, point.y, point.z, isHex(orb) ? 0.56 : 0.48, 1, palette);
      for (let i = 1; i <= 9; i++) {
        const d = i * 0.052,
          phase = now * 0.012 + i * 2.4;
        if (d > travelled) break;
        flightPoint(travelled - d);
        const sideways = Math.cos(phase) * 0.025;
        this.add(
          point.x + orb.dz * sideways,
          point.y + Math.sin(phase) * 0.032,
          point.z - orb.dx * sideways,
          0.18 * (1 - i / 12),
          0.7 * (1 - i / 11),
          palette,
        );
      }
    }
    for (const burst of state.hexBursts || []) this.addBurst(burst, now);
    for (const id of this.positions.keys()) if (!active.has(id)) this.positions.delete(id);
    for (const impact of state.projectileImpacts || []) {
      const age = Math.max(0, (now - impact.at) / 1000);
      if (age > 0.6) continue;
      const y = projectileHeight(impact.x, impact.z, impact.elevation) + 0.4,
        fade = 1 - age / 0.6,
        palette = isHex(impact) ? HEX : LIGHT;
      this.add(impact.x, y, impact.z, 0.65 + age * 0.7, fade * 0.6, palette);
      for (let i = 0; i < 18; i++) {
        const a = i * 2.39996323,
          s = Math.sqrt((i + 0.5) / 18),
          d = age * (0.55 + s);
        this.add(
          impact.x + Math.cos(a) * d,
          y + Math.sin(i * 3.7) * d,
          impact.z + Math.sin(a) * d,
          0.065,
          fade,
          palette,
        );
      }
    }
    // The sorcerer's staff tip glows red through a spell's windup.
    for (const enemy of state.enemies || []) {
      if (!enemy.hostile || enemy.phase !== 'alive' || !['bolt', 'burst'].includes(enemy.behavior))
        continue;
      const age = Math.max(0, (now - enemy.attackAt) / 1000),
        growth = Math.min(1, age / 0.9),
        y = projectileHeight(enemy.x, enemy.z, enemy.elevation ?? 0) + 1.55 * (enemy.scale ?? 1),
        ahead = 0.55 * (enemy.scale ?? 1),
        x = enemy.x + Math.sin(enemy.facing) * ahead,
        z = enemy.z + Math.cos(enemy.facing) * ahead;
      this.add(x, y, z, 0.3 + growth * 0.35, 0.6 + growth * 0.4, HEX);
      for (let i = 0; i < 8; i++) {
        const a = now * 0.016 + (i * Math.PI) / 4,
          r = 0.25 * (1 - growth * 0.4);
        this.add(
          x + Math.cos(a) * r,
          y + Math.sin(a * 1.3) * r,
          z + Math.sin(a) * r,
          0.06,
          0.7,
          HEX,
        );
      }
    }
    for (const entity of players.values()) {
      const p = entity.state,
        profile = attackProfile(p);
      if (profile.key !== 'magic' || !p.attackSequence || p.downedUntil) continue;
      const age = (now - p.attackAt) / 1000;
      if (age < 0 || age >= profile.impactMs / 1000) continue;
      entity.model.updateMatrixWorld(true);
      for (const grip of [entity.gripLeft, entity.gripRight]) {
        if (!grip) continue;
        grip.getWorldPosition(point);
        const growth = age / (profile.impactMs / 1000);
        this.add(point.x, point.y, point.z, 0.16 + growth * 0.16, 0.55 + growth * 0.35);
        for (let i = 0; i < 6; i++) {
          const a = now * 0.014 + (i * Math.PI) / 3,
            r = 0.09 * (1 - growth * 0.45);
          this.add(point.x + Math.cos(a) * r, point.y + Math.sin(a) * r, point.z, 0.04, 0.6);
        }
      }
    }
    this.points.visible = this.count > 0;
    this.geometry.setDrawRange(0, this.count);
    for (const attribute of Object.values(this.geometry.attributes)) {
      if (!(attribute instanceof THREE.BufferAttribute)) continue;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
  dispose() {
    this.poison.dispose();
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.positions.clear();
  }
}
