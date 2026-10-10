import { isMesh, isSkinnedMesh } from './three-types.js';
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CharacterAnimation } from './character-animation.js';
import { scienceAttackClip } from './science-cast.js';
import { RidingPose, apeShoulderSeat } from './riding-pose.js';
import { JumpPose } from './jump-pose.js';
import { CarrySupportPose } from './carry-support-pose.js';
import { LeanPose } from './lean-pose.js';
import { GroundPettingPose } from './ground-petting-pose.js';
import { PettingPose } from './petting-pose.js';
import { OrbBotPose } from './orb-bot-pose.js';
import { installSkinnedBounds } from './skinned-bounds.js';
import {
  coalesceTextures,
  disposeModels,
  loadVerifiedGLB,
  type RuntimeGLTF,
} from './embedded-glb.js';
import { configureActorPerformance, disposeActorPerformance } from './performance-lod.js';
import { AssetLoadQueue, LOAD_TIER, LoadTicket } from './asset-load-queue.js';

export function handGripPlacement(root) {
  root.updateMatrixWorld(true);
  const grip = root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.R'));
  const rotation = new THREE.Quaternion();
  if (grip) {
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
      grip.getWorldQuaternion(new THREE.Quaternion()).invert(),
    );
    rotation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localUp);
  }
  return { grip, rotation };
}

/** A verified character: its models as parseEmbeddedGLB() keeps them (scenes and
 * clips, no parser) and its manifest. */
export type CharacterTemplate = {
  gltf: RuntimeGLTF;
  lod: RuntimeGLTF | null;
  asset: any;
};
export type CharacterLoader = (manifestURL: string) => Promise<CharacterTemplate>;

/** Release a template's GPU resources. Its scenes may share geometry, materials
 * and textures, and textures may share an ImageBitmap: each is released once. */
export function disposeCharacterTemplate(template) {
  disposeModels([template.gltf, template.lod]);
}

/** The verified character GLB and its geometry-only LOD, parsed like every world
 * model (embedded-glb.ts): one cohort whose LOD shares the full model's textures
 * where image and state agree. */
export async function loadCharacterTemplate(manifestURL: string): Promise<CharacterTemplate> {
  const response = await fetch(manifestURL);
  if (!response.ok) throw new Error(`Character manifest: HTTP ${response.status}`);
  const asset = await response.json();
  const gltf = await loadVerifiedGLB(asset);
  let lod = null;
  try {
    if (asset.modelKey === 'howkey-scientist')
      gltf.animations = gltf.animations.map((clip) =>
        clip.name === 'Attack' ? scienceAttackClip(gltf.scene, clip) : clip,
      );
    lod = asset.lods?.[0] ? await loadVerifiedGLB(asset.lods[0]) : null;
    coalesceTextures([gltf, lod]);
  } catch (error) {
    // Nothing parsed so far outlives a failed load.
    disposeCharacterTemplate({ gltf, lod, asset });
    throw error;
  }
  return { gltf, lod, asset };
}

let providerSerial = 0;

// One template per world while anything uses it; geometry/textures are shared,
// bones/mixers are not. An unused template is evicted and loads again on demand.
export class CharacterAssets {
  readonly manifestURL: string;
  /** Queue keys are per provider: a template is never installed in another provider. */
  private readonly serial = ++providerSerial;
  readonly instances = new Set<any>();
  disposed = false;
  loadMilliseconds: number | undefined;
  template: CharacterTemplate | null = null;
  pending: Promise<CharacterTemplate | null> | null = null;
  evictions = 0;
  /** Bumped by eviction and disposal: loads begun earlier discard their result. */
  private generation = 0;
  private creating = 0;
  private idleSince: number | null = null;
  private touched = false;
  private readonly queue: AssetLoadQueue | null;
  private readonly loadModel: CharacterLoader;

  constructor(
    manifestURL = '/models/cro-magnon-woman/asset.json',
    {
      queue = null,
      loadModel = loadCharacterTemplate,
    }: { queue?: AssetLoadQueue | null; loadModel?: CharacterLoader } = {},
  ) {
    this.manifestURL = manifestURL;
    this.queue = queue;
    this.loadModel = loadModel;
  }

  /** Live instances plus creations still waiting for the template. */
  get users() {
    return this.instances.size + this.creating;
  }

  /** The verified template, loaded once for all callers. Each caller's `ticket`
   * carries its priority; a load every caller withdrew from before it started
   * settles with LoadCancelled. */
  load(ticket = LoadTicket.of(LOAD_TIER.essential)): Promise<CharacterTemplate | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.template) return Promise.resolve(this.template);
    const key = `character:${this.serial}:${this.manifestURL}#${this.generation}`;
    if (this.pending) {
      this.queue?.join(key, ticket);
      return this.pending;
    }
    const generation = this.generation;
    const start = async () => {
      if (this.disposed || generation !== this.generation) return null;
      const started = performance.now();
      const template = await this.loadModel(this.manifestURL);
      if (this.disposed || generation !== this.generation) {
        disposeCharacterTemplate(template);
        return null;
      }
      this.loadMilliseconds = performance.now() - started;
      this.template = template;
      this.idleSince = null;
      this.touched = true;
      return template;
    };
    const pending = this.queue ? this.queue.request(key, start, ticket) : start();
    this.pending = pending;
    const settled = () => {
      if (this.pending === pending) this.pending = null;
    };
    pending.then(settled, settled);
    return pending;
  }

  async create({ color, ticket = LoadTicket.of(LOAD_TIER.essential) }) {
    if (this.disposed) return null;
    this.creating++;
    this.touched = true;
    try {
      const template = await this.load(ticket);
      if (!template || this.disposed || template !== this.template || ticket.released) return null;
      const { gltf, lod, asset } = template;
      const octopus = asset.bodyPlan === 'octopus' ? await import('./octopus-pose.js') : null;
      if (this.disposed || template !== this.template || ticket.released) return null;
      const root = clone(gltf.scene),
        personalMaterials = new Map();
      root.traverse((node) => {
        if (!isMesh(node)) return;
        node.castShadow = true;
        node.receiveShadow = true;
        const tint = (original) => {
          if (original.name !== 'TribeAccent') return original;
          if (!personalMaterials.has(original)) {
            const material = original.clone();
            material.color.set(color);
            personalMaterials.set(original, material);
          }
          return personalMaterials.get(original);
        };
        node.material = Array.isArray(node.material)
          ? node.material.map(tint)
          : tint(node.material);
      });
      configureActorPerformance(root, lod?.scene, asset);
      const { rotation: gripUp } = handGripPlacement(root);
      installSkinnedBounds(root);
      const ridingPose = octopus
        ? new octopus.OctopusRidingPose(root, gltf.animations)
        : new RidingPose(root);
      const jumpPose = octopus
        ? new octopus.OctopusJumpPose(root, gltf.animations)
        : new JumpPose(root);
      const pettingPose = octopus ? new octopus.OctopusPettingPose(root) : new PettingPose(root);
      const groundPettingPose = octopus
        ? new octopus.OctopusPettingPose(root)
        : new GroundPettingPose(root);
      const shoulderSeat = asset.modelKey === 'giant-ape' ? apeShoulderSeat(root) : null;
      const carrySupportPose = shoulderSeat ? new CarrySupportPose(root) : null;
      const leanPose =
        asset.modelKey === 'cat-kunoichi' && !asset.humanLocomotion ? new LeanPose(root) : null;
      const animation = new CharacterAnimation(root, gltf.animations, {
        walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
        runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
        groundLocomotion: !!asset.humanLocomotion,
      });
      const orbBotPose = new OrbBotPose(root);
      animation.mixer.update(Math.random() * animation.current.getClip().duration);
      const instance = {
        root,
        animation,
        asset,
        gripUp,
        ridingPose,
        shoulderSeat,
        carrySupportPose,
        leanPose,
        jumpPose,
        pettingPose,
        groundPettingPose,
        orbBotPose,
        dispose: () => {
          if (!this.instances.delete(instance)) return;
          animation.dispose();
          disposeActorPerformance(root);
          root.traverse((node) => {
            if (isSkinnedMesh(node)) node.skeleton.dispose();
          });
          personalMaterials.forEach((material) => material.dispose());
          this.touched = true;
        },
      };
      this.instances.add(instance);
      return instance;
    } finally {
      this.creating--;
    }
  }

  /** Evict the template once nothing has used it for `grace` seconds. `needed`
   * marks a holder that is loading this model but has not called create() yet. */
  collect(now: number, grace: number, needed = false) {
    if (this.disposed || !this.template || this.pending) return false;
    if (needed || this.users > 0) {
      this.idleSince = null;
      this.touched = false;
      return false;
    }
    if (this.idleSince === null || this.touched) {
      this.idleSince = now;
      this.touched = false;
      return false;
    }
    return now - this.idleSince >= grace && this.evict();
  }

  /** Free the template while no instance or pending creation needs it. Unlike
   * dispose(), the provider stays usable and the next create() loads it again. */
  evict() {
    if (this.disposed || !this.template || this.pending || this.users > 0) return false;
    this.generation++;
    disposeCharacterTemplate(this.template);
    this.template = null;
    this.idleSince = null;
    this.evictions++;
    return true;
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    for (const instance of [...this.instances]) instance.dispose();
    if (this.template) disposeCharacterTemplate(this.template);
    this.template = null;
  }
}
