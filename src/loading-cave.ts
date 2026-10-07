import * as THREE from 'three';
import type { WorldRenderer } from './world3d.js';
import { isMesh } from './three-types.js';
import { CAMP_CAVE } from '../shared/camp-cave-layout.mjs';
import { CAVE_EXTRA_PIGMENTS, type CaveExtraPigment } from './cave-gallery-layout.js';
import { prepareCaveMaterials } from './cave-materials.js';
import { createCavePreviewLabel } from './cave-preview-label.js';
import { MeshRayGrid } from './mesh-ray-grid.js';
import { LoadingCaveMovement } from './loading-cave-movement.js';

/** A small, locally controlled scene using the game's verified cave and Cro-Magnon. */
export class LoadingCave {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 90);
  readonly movement = new LoadingCaveMovement();
  readonly overlay = document.createElement('section');
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly events = new AbortController();
  private readonly keys = new Set<string>();
  private actor: Awaited<ReturnType<WorldRenderer['npcAssets']['create']>> | null = null;
  private walls: MeshRayGrid | null = null;
  private ready = false;
  private disposed = false;
  private worldReady = false;
  private yaw = Math.PI + 0.65;
  private pitch = 0.1;
  private stick = { x: 0, y: 0 };
  private padConfirm = true;
  private lastPercent = -1;
  private pointers = new Map<number, { x: number; y: number; stick: boolean }>();
  private status: HTMLElement;
  private progress: HTMLProgressElement;
  private proceed: HTMLButtonElement;

  constructor(
    private world: WorldRenderer,
    private onContinue: () => void,
    private onBack: () => void,
  ) {
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
    await this.world.worldAssets.loadCatalog();
    if (this.disposed) return;
    const provider = this.world.humanAssets.get('cro-magnon-hunter')!;
    const [template, actor] = await Promise.all([
      this.world.worldAssets.ensureInitial(CAMP_CAVE.key),
      provider.create({ color: '#b7a27a' }).then((actor) => {
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
    const load = async (url: string) => {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      if (this.disposed) {
        texture.dispose();
        return texture;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.world.renderer.capabilities.getMaxAnisotropy());
      this.textures.add(texture);
      return texture;
    };
    const [pigment, limestone, character524, rimo, ...extras] = await Promise.all([
      load(template.asset.pigment.url),
      load(template.asset.rockSurface.url),
      load(template.asset.characterPigment.url),
      load(template.asset.rimoPigment.url),
      ...Object.values(CAVE_EXTRA_PIGMENTS).map((p) => load(p.url)),
    ]);
    if (this.disposed) return;
    limestone.wrapS = limestone.wrapT = THREE.RepeatWrapping;
    const comingSoon = createCavePreviewLabel();
    this.textures.add(comingSoon);
    const extraPigments = Object.fromEntries([
      ...Object.keys(CAVE_EXTRA_PIGMENTS).map((key, i) => [key, extras[i]]),
      ['comingSoon', comingSoon],
    ]) as Record<CaveExtraPigment, THREE.Texture>;
    prepareCaveMaterials(cave, pigment, limestone, character524, rimo, extraPigments, true);
    cave.position.set(CAMP_CAVE.x, CAMP_CAVE.elevation + CAMP_CAVE.groundOffset, CAMP_CAVE.z);
    cave.rotation.y = CAMP_CAVE.yaw;
    cave.scale.setScalar(CAMP_CAVE.scale);
    this.scene.add(cave, actor.root);
    this.walls = new MeshRayGrid(cave);
    this.updateCamera();
    await this.world.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return;
    this.ready = true;
    this.overlay.querySelector<HTMLElement>('.loading-cave-wait')!.hidden = true;
    this.overlay.dataset.ready = 'true';
    this.world.canvas.dataset.loadingCave = 'exploring';
    this.status.textContent = '世界を読み込んでいます — 壁画を見て回れます';
    // Present the small scene before starting the world's download and decoding.
    this.render(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  markWorldReady() {
    if (this.disposed) return;
    this.worldReady = true;
    this.progress.value = 1;
    this.proceed.disabled = false;
    this.status.textContent = '世界の準備ができました';
    this.overlay.dataset.worldReady = 'true';
  }

  private continue() {
    if (this.worldReady && !this.disposed) this.onContinue();
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
    const focus = new THREE.Vector3(point.x, height + 1.45, point.z);
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
    this.events.abort();
    this.stop();
    this.overlay.remove();
    this.actor?.dispose();
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.scene.clear();
    this.walls = null;
    document.body.classList.remove('loading-cave-active');
    delete this.world.canvas.dataset.loadingCave;
  }
}
