import * as THREE from 'three';
import type { WorldRenderer } from './world3d.js';
import { isMesh } from './three-types.js';
import { CAMP_CAVE } from '../shared/camp-cave-layout.mjs';
import { type CaveExtraPigment } from './cave-gallery-layout.js';
import {
  loadCaveTextures,
  releaseVerifiedTexture,
  type CaveTextureKey,
  type VerifiedTextureBatch,
  type VerifiedTextureOptions,
} from './verified-texture.js';
import { prepareCaveMaterials } from './cave-materials.js';
import { createCavePreviewLabel } from './cave-preview-label.js';
import { MeshRayGrid } from './mesh-ray-grid.js';
import { LoadingCaveMovement } from './loading-cave-movement.js';
import { CHARACTER_MODELS } from '../shared/characters.mjs';
import { LOAD_TIER, LoadTicket } from './asset-load-queue.js';
import { compileScene } from './context-recovery.js';
import { startupMarks } from './startup-marks.js';

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
  private actor: Awaited<ReturnType<WorldRenderer['npcAssets']['create']>> | null = null;
  private walls: MeshRayGrid | null = null;
  private ready = false;
  private disposed = false;
  private worldReady = false;
  private entering = false;
  private yaw = Math.PI + 0.65;
  private pitch = 0.1;
  private stick = { x: 0, y: 0 };
  private padConfirm = true;
  private lastPercent = -1;
  private pointers = new Map<number, { x: number; y: number; stick: boolean }>();
  private status: HTMLElement;
  private progress: HTMLProgressElement;
  private proceed: HTMLButtonElement;
  /** The visitor's interest in their character's load; leaving withdraws it. */
  private readonly ticket = LoadTicket.of(LOAD_TIER.essential);
  private readonly character: string;
  private readonly color: string;
  private readonly eyeHeight: number;
  /** The start attempt this gallery belongs to (startup timing only). */
  private readonly marks = startupMarks.current;

  constructor(
    private world: WorldRenderer,
    private onContinue: () => void,
    private onBack: () => void,
    {
      character = 'cro-magnon-hunter',
      color = '#b7a27a',
      images = {},
    }: { character?: string; color?: string; images?: VerifiedTextureOptions } = {},
  ) {
    this.character = character;
    this.color = color;
    this.imageOptions = images;
    // The world's camera focus heights: the small fennec mage, the tall ape.
    const species = CHARACTER_MODELS.find((model) => model.key === character)?.species;
    this.eyeHeight = species === 'bear' ? 0.64 : species === 'ape' ? 1.55 : 1.45;
    this.scene.background = new THREE.Color('#292923');
    // Constant gallery illumination, independent of the world's day and torches.
    this.scene.add(new THREE.HemisphereLight('#fff3dc', '#b6a995', 2.1));
    const light = new THREE.DirectionalLight('#fff3d9', 1.5);
    light.position.set(20, 40, 70);
    this.scene.add(light);
    const fill = new THREE.DirectionalLight('#ddeaff', 0.8);
    fill.position.set(70, 20, 170);
    this.scene.add(fill);
    this.overlay.id = 'loading-cave';
    this.overlay.setAttribute('aria-label', 'アプデの洞窟');
    this.overlay.innerHTML = `<header class="loading-cave-heading"><div><small>世界への旅支度</small><h2>アプデの洞窟</h2></div><button class="button button-outline" data-cave-back>タイトルへ戻る</button></header>
      <div class="loading-cave-wait" role="status">洞窟を準備しています…</div>
      <div class="loading-cave-stick" aria-label="ドラッグして移動"><i></i><span>移動</span></div>
      <footer class="loading-cave-footer"><p class="loading-cave-help">WASDで移動 · ドラッグで見回す · Shiftで走る</p><div class="loading-cave-load"><span data-cave-status role="status">洞窟を準備しています</span><progress max="1" value="0" aria-label="世界の読み込み"></progress><button class="button button-accent" data-cave-proceed disabled>世界へ進む</button></div></footer>`;
    this.status = this.overlay.querySelector('[data-cave-status]')!;
    this.progress = this.overlay.querySelector('progress')!;
    this.proceed = this.overlay.querySelector('[data-cave-proceed]')!;
    this.world.canvas.parentElement!.append(this.overlay);
    document.body.classList.add('loading-cave-active');
    this.proceed.onclick = () => this.continue();
    this.overlay.querySelector<HTMLButtonElement>('[data-cave-back]')!.onclick = onBack;
    const signal = this.events.signal;
    document.addEventListener('keydown', this.keydown, { signal, capture: true });
    document.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), { signal });
    window.addEventListener('blur', () => this.stop(), { signal });
    document.addEventListener('visibilitychange', () => this.stop(), { signal });
    this.overlay.addEventListener('pointerdown', this.pointerDown, { signal });
    this.overlay.addEventListener('pointermove', this.pointerMove, { signal });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
      this.overlay.addEventListener(
        name,
        (e: PointerEvent) => {
          if (this.pointers.get(e.pointerId)?.stick) this.stick = { x: 0, y: 0 };
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
      provider.create({ color: this.color, ticket: this.ticket }).then((actor) => {
        if (this.disposed) actor?.dispose();
        else this.actor = actor;
        return actor;
      }),
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
    const comingSoon = createCavePreviewLabel();
    this.textures.add(comingSoon);
    const extraPigments = { ...extras, comingSoon } as Record<CaveExtraPigment, THREE.Texture>;
    prepareCaveMaterials(
      cave,
      pigment,
      rockSurface,
      characterPigment,
      rimoPigment,
      extraPigments,
      true,
    );
    cave.position.set(CAMP_CAVE.x, CAMP_CAVE.elevation + CAMP_CAVE.groundOffset, CAMP_CAVE.z);
    cave.rotation.y = CAMP_CAVE.yaw;
    cave.scale.setScalar(CAMP_CAVE.scale);
    this.scene.add(cave, actor.root);
    this.walls = new MeshRayGrid(cave);
    this.updateCamera();
    // Ends early if the WebGL context is lost; a restored context compiles on first draw.
    await compileScene(this.world.renderer, this.scene, this.camera);
    if (this.disposed) return;
    this.ready = true;
    this.overlay.querySelector<HTMLElement>('.loading-cave-wait')!.hidden = true;
    this.overlay.dataset.ready = 'true';
    this.world.canvas.dataset.loadingCave = 'exploring';
    this.status.textContent = '世界を読み込んでいます — 壁画を見て回れます';
    // Present the small scene before starting the world's download and decoding.
    this.render(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!this.disposed) startupMarks.mark('cave-playable', this.marks);
  }

  markWorldReady() {
    if (this.disposed) return;
    this.worldReady = true;
    this.progress.value = 1;
    this.proceed.disabled = false;
    this.status.textContent = '世界の準備ができました';
    this.overlay.dataset.worldReady = 'true';
  }

  /** The visitor chose to proceed: the gallery stays on screen until their
   * character stands in the world, then the game replaces it. */
  enterWorld() {
    if (this.disposed) return;
    this.entering = true;
    this.proceed.disabled = true;
    this.status.textContent = '世界に入っています';
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
    this.stick = { x: 0, y: 0 };
    this.pointers.clear();
    this.showStick();
  }

  private keydown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (
      ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
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
    if ((e.target as Element).closest('button')) return;
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
      const length = Math.max(42, Math.hypot(x, y));
      this.stick = { x: x / length, y: y / length };
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
    const distance = Math.max(0.15, (this.walls?.distance(focus, direction, 3.4) ?? 3.4) - 0.18);
    this.camera.position.copy(focus).addScaledVector(direction, distance);
    this.camera.lookAt(focus);
    this.camera.aspect = this.world.camera.aspect;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.05);
    if (this.ready && !document.hidden && document.hasFocus()) {
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
      const axis = (index: number) =>
        Math.abs(pad?.axes[index] ?? 0) > 0.18 ? pad!.axes[index] : 0;
      const x =
        Number(this.keys.has('d') || this.keys.has('arrowright')) -
        Number(this.keys.has('a') || this.keys.has('arrowleft')) +
        this.stick.x +
        axis(0);
      const y =
        Number(this.keys.has('s') || this.keys.has('arrowdown')) -
        Number(this.keys.has('w') || this.keys.has('arrowup')) +
        this.stick.y +
        axis(1);
      this.yaw -= axis(2) * dt * 2.2;
      this.pitch = THREE.MathUtils.clamp(this.pitch + axis(3) * dt * 1.4, -0.45, 0.7);
      const confirm = !!pad?.buttons[0]?.pressed;
      if (confirm && !this.padConfirm) this.continue();
      this.padConfirm = confirm;
      const running = this.keys.has('shift') || !!pad?.buttons[10]?.pressed;
      this.movement.step(this.world.collision, x, y, this.yaw, dt, running);
      this.actor?.animation.update(dt, this.movement.speed, running);
    } else this.actor?.animation.update(dt, 0, false);
    if (this.disposed) return;
    this.updateCamera();
    if (!this.worldReady && this.ready) {
      const { phase, loaded, total } = this.world.loadProgress;
      const fraction = phase === 'build' ? 0.96 : total ? (0.92 * loaded) / total : 0;
      const percent = Math.floor(fraction * 100);
      if (percent !== this.lastPercent) {
        this.lastPercent = percent;
        this.progress.value = fraction;
        this.status.textContent =
          phase === 'build' ? '世界を組み立てています' : `世界を読み込んでいます ${percent}%`;
      }
    }
    if (this.ready) this.world.renderer.render(this.scene, this.camera);
    Object.assign(this.world.canvas.dataset, {
      cavePosition: `${this.movement.position.x.toFixed(3)},${this.movement.position.z.toFixed(3)}`,
      caveAnimation: this.actor?.animation.name ?? 'loading',
      caveCameraYaw: this.yaw.toFixed(3),
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
