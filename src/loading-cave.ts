import * as THREE from 'three';
import type { WorldRenderer } from './world3d.js';
import { isMesh } from './three-types.js';
import { CAMP_CAVE } from '../shared/camp-cave-layout.mjs';
import { hiddenMuralSubjects, type CaveExtraPigment } from './cave-gallery-layout.js';
import {
  loadCaveTextures,
  releaseVerifiedTexture,
  type CaveTextureKey,
  type VerifiedTextureBatch,
  type VerifiedTextureOptions,
} from './verified-texture.js';
import { prepareCaveMaterials } from './cave-materials.js';
import { MeshRayGrid, nearPlaneReach } from './mesh-ray-grid.js';
import { LoadingCaveMovement } from './loading-cave-movement.js';
import { movementKey } from './combat-input.js';
import { combineMovement, readStick, STICK } from './gamepad-input.js';
import { touchStick } from './touch-input.js';
import { CHARACTER_MODELS } from '../shared/characters.mjs';
import { LOAD_TIER, LoadTicket } from './asset-load-queue.js';
import { compileScene } from './context-recovery.js';
import { startupMarks } from './startup-marks.js';
import { CaveTorch } from './cave-torch.js';
import { CAVE_LIGHT } from '../shared/cave-light.mjs';
import { CaveSpring } from './cave-spring.js';
import { bindShareLinks, shareLinksMarkup } from './share-links.js';

const DIRECTION_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const DOUBLE_TAP_MS = 300;

/** A small, locally controlled scene using the game's verified cave and the
 * visitor's selected character. Its verified template is the one the world
 * reuses for the local player; another character is never substituted. */
export class LoadingCave {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 90);
  readonly movement = new LoadingCaveMovement();
  readonly overlay = document.createElement('section');
  private readonly materials = new Set<THREE.Material>();
  /** The gallery's own images: verified pigments, limestone and the preview label. */
  private readonly textures = new Set<THREE.Texture>();
  /** Verified images still loading; leaving releases them, late ones included. */
  private images: VerifiedTextureBatch<CaveTextureKey> | null = null;
  private readonly imageOptions: VerifiedTextureOptions;
  private readonly events = new AbortController();
  private readonly keys = new Set<string>();
  private readonly lastTapAt = new Map<string, number>();
  private dashing = false;
  private actor: Awaited<ReturnType<WorldRenderer['npcAssets']['create']>> | null = null;
  private torch: CaveTorch | null = null;
  private spring: CaveSpring | null = null;
  private torchLit = true;
  private elapsed = 0;
  private walls: MeshRayGrid | null = null;
  private ready = false;
  private disposed = false;
  private worldReady = false;
  private entering = false;
  private yaw = Math.PI + 0.65;
  private pitch = 0.1;
  private stick = { x: 0, y: 0, running: false };
  private runMode = false;
  private padRunning = false;
  private padConfirm = true;
  private pointers = new Map<number, { x: number; y: number; stick: boolean }>();
  /** Shows a spinner, not a label, until the world can be entered (aria-busy). */
  private proceed: HTMLButtonElement;
  /** Painted subjects this cave's murals do not show (read from its manifest). */
  private muralHidden: string[] = [];
  /** The visitor's interest in their character's load; leaving withdraws it. */
  private readonly ticket = LoadTicket.of(LOAD_TIER.essential);
  private readonly character: string;
  private readonly color: string;
  /** The clothing colour the traveler wears ('' or null: the character's own). */
  private readonly dye: string | null;
  private readonly eyeHeight: number;
  /** A dialog over the gallery (the mural people) owns the keys and the controller. */
  private readonly paused: () => boolean;
  private wasPaused = false;
  /** The start attempt this gallery belongs to (startup timing only). */
  private readonly marks = startupMarks.current;

  constructor(
    private world: WorldRenderer,
    private onContinue: () => void,
    private onBack: () => void,
    {
      character = 'cro-magnon-hunter',
      color = '#b7a27a',
      dye = null,
      images = {},
      onMurals,
      share = false,
      paused = () => false,
    }: {
      character?: string;
      color?: string;
      dye?: string | null;
      images?: VerifiedTextureOptions;
      /** Opens the dialog of the people painted here, given the subjects the murals leave
       * out; without it there is no button. */
      onMurals?: (hidden: string[]) => void;
      /** The share marks beside the cave's name, while the world loads. */
      share?: boolean;
      paused?: () => boolean;
    } = {},
  ) {
    this.character = character;
    this.color = color;
    this.dye = dye;
    this.imageOptions = images;
    this.paused = paused;
    // The world's camera focus heights: the small fennec mage, the tall ape, a body unlike its
    // species' (the chibi woman) by its own focus.
    const model = CHARACTER_MODELS.find((entry) => entry.key === character);
    this.eyeHeight =
      model?.cameraFocus ??
      (model?.species === 'bear' ? 0.64 : model?.species === 'ape' ? 1.55 : 1.45);
    this.scene.background = new THREE.Color(CAVE_LIGHT.background);
    this.scene.fog = new THREE.Fog(CAVE_LIGHT.background, CAVE_LIGHT.fogNear, CAVE_LIGHT.fogFar);
    this.scene.add(
      new THREE.HemisphereLight(CAVE_LIGHT.sky, CAVE_LIGHT.ground, CAVE_LIGHT.hemisphere),
    );
    const light = new THREE.DirectionalLight(CAVE_LIGHT.sun, CAVE_LIGHT.directional);
    light.position.set(...CAVE_LIGHT.sunDirection);
    this.scene.add(light, light.target);
    this.overlay.id = 'loading-cave';
    this.overlay.setAttribute('aria-label', 'アプデの洞窟');
    this.overlay.innerHTML = `<header class="loading-cave-heading"><div class="loading-cave-title"><h2>アプデの洞窟</h2>${share ? shareLinksMarkup(true) : ''}</div><div class="loading-cave-actions">${onMurals ? '<button class="button button-outline" data-cave-murals>壁画の人々</button>' : ''}<button class="button button-outline" data-cave-back>タイトルへ戻る</button></div></header>
      <div class="loading-cave-wait" role="status">洞窟を準備しています…</div>
      <div class="loading-cave-stick" aria-label="ドラッグして移動"><i></i><span>移動</span></div>
      <button class="button button-outline loading-cave-torch" data-cave-torch aria-pressed="true">松明を消す</button>
      <footer class="loading-cave-footer"><p class="loading-cave-help">WASDで移動 · ドラッグで見回す · Shiftで走る</p><button class="button button-accent loading-cave-proceed" data-cave-proceed disabled aria-busy="true"><i class="loading-cave-spinner" aria-hidden="true"></i><span>ゲームを始める</span></button></footer>`;
    this.proceed = this.overlay.querySelector('[data-cave-proceed]')!;
    this.world.canvas.parentElement!.append(this.overlay);
    document.body.classList.add('loading-cave-active');
    this.proceed.onclick = () => this.continue();
    this.overlay.querySelector<HTMLButtonElement>('[data-cave-torch]')!.onclick = () =>
      this.toggleTorch();
    this.overlay.querySelector<HTMLButtonElement>('[data-cave-back]')!.onclick = onBack;
    const murals = this.overlay.querySelector<HTMLButtonElement>('[data-cave-murals]');
    if (murals && onMurals)
      murals.onclick = () => {
        // The visitor stops where they stand while the dialog is open.
        this.stop();
        onMurals(this.muralHidden);
      };
    const signal = this.events.signal;
    if (share) bindShareLinks(this.overlay, signal);
    document.addEventListener('keydown', this.keydown, { signal, capture: true });
    document.addEventListener(
      'keyup',
      (e) => {
        this.keys.delete(movementKey(e));
        if (!DIRECTION_KEYS.some((key) => this.keys.has(key))) this.dashing = false;
      },
      { signal },
    );
    window.addEventListener('blur', () => this.stop(), { signal });
    document.addEventListener('visibilitychange', () => this.stop(), { signal });
    this.overlay.addEventListener('pointerdown', this.pointerDown, { signal });
    this.overlay.addEventListener('pointermove', this.pointerMove, { signal });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
      this.overlay.addEventListener(
        name,
        (e: PointerEvent) => {
          if (this.pointers.get(e.pointerId)?.stick) this.stick = { x: 0, y: 0, running: false };
          this.pointers.delete(e.pointerId);
          this.showStick();
        },
        { signal },
      );
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    this.world.canvas.dataset.loadingCave = 'loading';
  }

  async load() {
    startupMarks.mark('cave-load-start', this.marks);
    await this.world.worldAssets.loadCatalog();
    if (this.disposed) return;
    startupMarks.mark('cave-catalog', this.marks);
    const provider = this.world.humanAssets.get(this.character);
    if (!provider) throw new Error(`Missing verified character ${this.character}`);
    const [template, actor] = await Promise.all([
      this.world.worldAssets.ensureInitial(CAMP_CAVE.key),
      provider.create({ color: this.color, dye: this.dye, ticket: this.ticket }).then((actor) => {
        if (this.disposed) actor?.dispose();
        else this.actor = actor;
        return actor;
      }),
      this.world.worldAssets.ensureInitial('firewood-log', this.ticket),
    ]);
    if (this.disposed) {
      actor?.dispose();
      return;
    }
    if (!actor) throw new Error('Loading cave character unavailable');
    startupMarks.mark('cave-template', this.marks);
    // The ten standalone images, each an exact verified file (murals also checked
    // against the rectangles that sample them), decoded only after verification.
    const anisotropy = Math.min(8, this.world.renderer.capabilities.getMaxAnisotropy());
    const images = (this.images = loadCaveTextures(template.asset, anisotropy, this.imageOptions));
    this.muralHidden = hiddenMuralSubjects(template.asset);
    const cave = this.world.worldAssets.create(CAMP_CAVE.key);
    // Clone only materials. The game keeps ownership of source geometry and textures.
    const copies = new Map<THREE.Material, THREE.Material>();
    cave.traverse((node) => {
      if (!isMesh(node)) return;
      const copy = (material: THREE.Material) => {
        if (!copies.has(material)) {
          const cloned = material.clone();
          copies.set(material, cloned);
          this.materials.add(cloned);
        }
        return copies.get(material)!;
      };
      node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      node.castShadow = false;
      node.receiveShadow = false;
    });
    try {
      await images.ready;
    } catch (error) {
      // Leaving cancels the images; after any other failure the batch released them.
      if (this.images === images) this.images = null;
      if (this.disposed) return;
      throw error;
    }
    // dispose() released them if the visitor left meanwhile.
    if (this.disposed) return;
    startupMarks.mark('cave-images', this.marks);
    this.images = null;
    const { pigment, rockSurface, characterPigment, rimoPigment, ...extras } = images.take();
    for (const texture of [pigment, rockSurface, characterPigment, rimoPigment])
      this.textures.add(texture);
    for (const texture of Object.values(extras)) this.textures.add(texture);
    const extraPigments = extras as Record<CaveExtraPigment, THREE.Texture>;
    prepareCaveMaterials(
      cave,
      pigment,
      rockSurface,
      characterPigment,
      rimoPigment,
      extraPigments,
      this.muralHidden,
    );
    cave.position.set(CAMP_CAVE.x, CAMP_CAVE.elevation + CAMP_CAVE.groundOffset, CAMP_CAVE.z);
    cave.rotation.y = CAMP_CAVE.yaw;
    cave.scale.setScalar(CAMP_CAVE.scale);
    this.scene.add(cave, actor.root);
    this.walls = new MeshRayGrid(cave);
    this.spring = new CaveSpring();
    cave.add(this.spring.root);
    this.torch = new CaveTorch(
      this.scene,
      this.world.worldAssets,
      actor.root,
      actor.asset.heightMetres,
    );
    this.updateCamera();
    this.torch.update(true, 0, 1, this.world.renderer.getPixelRatio(), this.torchLit);
    // Ends early if the WebGL context is lost; a restored context compiles on first draw.
    await compileScene(this.world.renderer, this.scene, this.camera);
    if (this.disposed) return;
    this.ready = true;
    this.overlay.querySelector<HTMLElement>('.loading-cave-wait')!.hidden = true;
    this.overlay.dataset.ready = 'true';
    this.world.canvas.dataset.loadingCave = 'exploring';
    // Present the small scene before starting the world's download and decoding.
    this.render(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!this.disposed) startupMarks.mark('cave-playable', this.marks);
  }

  /** The spinner gives way to the button, which can be pressed at once. */
  markWorldReady() {
    if (this.disposed) return;
    this.worldReady = true;
    this.proceed.disabled = false;
    this.proceed.setAttribute('aria-busy', 'false');
    this.overlay.dataset.worldReady = 'true';
  }

  /** The visitor chose to proceed: the gallery stays on screen, spinning again, until their
   * character stands in the world, then the game replaces it. */
  enterWorld() {
    if (this.disposed) return;
    this.entering = true;
    this.proceed.disabled = true;
    this.proceed.setAttribute('aria-busy', 'true');
    this.overlay.dataset.entering = 'true';
    this.world.canvas.dataset.loadingCave = 'entering';
  }

  private continue() {
    if (this.worldReady && !this.entering && !this.disposed) this.onContinue();
  }

  /** Forget every held key, stick and drag (the WebGL context was lost). */
  releaseInput() {
    this.stop();
  }

  private stop() {
    this.keys.clear();
    this.lastTapAt.clear();
    this.dashing = false;
    this.stick = { x: 0, y: 0, running: false };
    this.runMode = false;
    this.padRunning = false;
    this.pointers.clear();
    this.showStick();
  }

  private toggleTorch() {
    if (!this.ready) return;
    this.torchLit = !this.torchLit;
    const button = this.overlay.querySelector<HTMLButtonElement>('[data-cave-torch]')!;
    button.textContent = this.torchLit ? '松明を消す' : '松明を灯す';
    button.setAttribute('aria-pressed', String(this.torchLit));
  }

  private keydown = (e: KeyboardEvent) => {
    // The open dialog keeps its own keys: Escape closes it, arrows move its focus.
    if (this.paused()) return;
    const key = movementKey(e);
    // Match the world's walk/run toggle, including a tap and held-key repeats.
    if (key === 'shift') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) this.runMode = !this.runMode;
      return;
    }
    if (key === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) this.toggleTorch();
    }
    if (DIRECTION_KEYS.includes(key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Match the world's double-tap dash until all direction keys are released.
      if (!e.repeat) {
        const now = performance.now();
        if (now - (this.lastTapAt.get(key) ?? -Infinity) < DOUBLE_TAP_MS) this.dashing = true;
        this.lastTapAt.set(key, now);
      }
      this.keys.add(key);
    }
    if (key === 'escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.onBack();
    }
    if (key === 'enter' && e.target === document.body) this.continue();
  };

  private pointerDown = (e: PointerEvent) => {
    // Buttons and the share links take their own presses; the rest of the cave looks around.
    if ((e.target as Element).closest('button, a, .share-links')) return;
    e.preventDefault();
    const stick = !!(e.target as Element).closest('.loading-cave-stick');
    if (stick && [...this.pointers.values()].some((p) => p.stick)) return;
    this.overlay.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, stick });
  };

  private pointerMove = (e: PointerEvent) => {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    const x = e.clientX - pointer.x,
      y = e.clientY - pointer.y;
    if (pointer.stick) {
      this.stick = touchStick(x, y, 42, this.stick.running);
      this.showStick();
    } else {
      this.yaw -= x * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + y * 0.004, -0.45, 0.7);
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    }
  };

  private showStick() {
    const knob = this.overlay.querySelector<HTMLElement>('.loading-cave-stick i');
    if (knob) knob.style.transform = `translate(${this.stick.x * 35}px, ${this.stick.y * 35}px)`;
  }

  private updateCamera() {
    if (!this.actor) return;
    const point = this.movement.position;
    const height = this.world.collision.surfaceHeight(point);
    this.actor.root.position.set(point.x, height, point.z);
    this.actor.root.rotation.y = this.movement.facing;
    const focus = new THREE.Vector3(point.x, height + this.eyeHeight, point.z);
    const direction = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.camera.aspect = this.world.camera.aspect;
    this.camera.updateProjectionMatrix();
    // The near plane keeps clear of the rock: a sphere is swept, not a ray.
    const distance = this.walls?.sweep(focus, direction, 3.4, nearPlaneReach(this.camera)) ?? 3.4;
    this.camera.position.copy(focus).addScaledVector(direction, distance);
    this.camera.lookAt(focus);
  }

  render(dt: number) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    this.torch?.pose.restore();
    const paused = this.paused();
    if (paused !== this.wasPaused) {
      this.wasPaused = paused;
      // Held keys and drags end when a dialog opens (keys pressed after it closes
      // count at once); a controller button still held when it closes, the press
      // that closed it, must be released before it proceeds.
      if (paused) this.stop();
      this.padConfirm = true;
    }
    if (!paused && this.ready && !document.hidden && document.hasFocus()) {
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
      const axis = (index: number) =>
        Math.abs(pad?.axes[index] ?? 0) > 0.18 ? pad!.axes[index] : 0;
      const x =
        Number(this.keys.has('d') || this.keys.has('arrowright')) -
        Number(this.keys.has('a') || this.keys.has('arrowleft'));
      const y =
        Number(this.keys.has('s') || this.keys.has('arrowdown')) -
        Number(this.keys.has('w') || this.keys.has('arrowup'));
      this.yaw -= axis(2) * dt * 2.2;
      this.pitch = THREE.MathUtils.clamp(this.pitch + axis(3) * dt * 1.4, -0.45, 0.7);
      const confirm = !!pad?.buttons[0]?.pressed;
      if (confirm && !this.padConfirm) this.continue();
      this.padConfirm = confirm;
      const left = readStick(pad?.axes[0], pad?.axes[1]);
      this.padRunning = left.magnitude >= (this.padRunning ? STICK.runExit : STICK.runEnter);
      const analog = combineMovement(this.stick.x, this.stick.y, this.stick.running, {
        x: left.x,
        y: left.y,
        running: this.padRunning,
      });
      // Each device owns its gait; a keyboard run toggle never forces a small tilt to run.
      const motion = combineMovement(x, y, this.runMode || this.dashing, analog);
      this.movement.step(this.world.collision, motion.x, motion.y, this.yaw, dt, motion.running);
      this.actor?.animation.update(dt, this.movement.speed, motion.running);
    } else this.actor?.animation.update(dt, 0, false);
    if (this.disposed) return;
    this.updateCamera();
    this.torch?.update(true, this.elapsed, dt, this.world.renderer.getPixelRatio(), this.torchLit);
    this.spring?.update(this.elapsed);
    if (this.ready) this.world.renderer.render(this.scene, this.camera);
    Object.assign(this.world.canvas.dataset, {
      cavePosition: `${this.movement.position.x.toFixed(3)},${this.movement.position.z.toFixed(3)}`,
      caveAnimation: this.actor?.animation.name ?? 'loading',
      caveCameraYaw: this.yaw.toFixed(3),
      caveTorchHeld: String(!!this.torch?.root.visible),
      caveTorchLit: String(!!this.torch?.light.visible),
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Leaving before the character arrives withdraws its queued load.
    this.ticket.release();
    this.events.abort();
    this.stop();
    this.overlay.remove();
    this.torch?.dispose();
    this.spring?.dispose();
    this.actor?.dispose();
    this.materials.forEach((material) => material.dispose());
    // Images still loading are released by their batch, now or as they arrive.
    this.images?.cancel();
    this.images = null;
    this.textures.forEach(releaseVerifiedTexture);
    this.textures.clear();
    this.scene.clear();
    this.walls = null;
    document.body.classList.remove('loading-cave-active');
    delete this.world.canvas.dataset.loadingCave;
  }
}
