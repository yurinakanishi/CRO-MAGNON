import type { ViewState } from './view-state.js';
import { isMesh } from './three-types.js';
import type { RegionalScenery } from './regional-scenery.js';
import type { OpenWorldTerrain } from './open-world.js';
import * as THREE from 'three';
import {
  terrainHeight,
  walkHeight,
  riverX,
  riverHalfWidth,
  WATER_LEVEL,
  clamp,
  movementFromCamera,
} from '../shared/terrain.mjs';
import { WORLD, worldClamp, CAMP, NPC, INITIAL_RESOURCES } from '../shared/world.mjs';
import { WorldAssets } from './world-assets.js';
import { WorldLandmarks } from './world-landmarks.js';
import {
  buildTerrainAssets,
  buildForestAssets,
  buildCampAssets,
  buildAnimalAssets,
} from './world-scenery.js';
import { resourceAppearance } from '../shared/biome-scenery.mjs';
import { CharacterAssets } from './character-assets.js';
import { confirmedAction } from './character-animation.js';
import { orientSpear } from './spear-pose.js';
import { orientKatana } from './katana-pose.js';
import { SpellEffects } from './spell-effects.js';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { CollisionWorld } from '../shared/collision.mjs';
import { CHARACTER_MODELS, characterModel } from '../shared/characters.mjs';
import { enemyAnimationState, playerRecovered } from './enemy-state.js';
import { isLand } from '../shared/paleo-geography.mjs';
import { FrameClock } from './frame-clock.js';
import { WorldAtmosphere } from './world-atmosphere.js';
import { AdventureEffects } from './adventure-effects.js';
import { mammothSeat } from './riding-pose.js';
import { BoatRenderer } from './boat-renderer.js';
import { BOATING } from '../shared/boats.mjs';

const DEFAULT_DISTANCE = 5.5;
const tempPoint = new THREE.Vector3();
const focusHeight = (profile) => (profile.species === 'bear' ? 0.64 : 1.4);

function mesh(geometry, material, parent, position: [number, number, number] = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  parent.add(object);
  return object;
}

export class WorldRenderer {
  declare campLabel: ReturnType<WorldRenderer['createLabel']>;
  declare regionalScenery: RegionalScenery;
  declare openWorld: OpenWorldTerrain;
  declare riderOffset: THREE.Vector3;
  declare terrain: THREE.Object3D;
  declare bridge: THREE.Object3D;
  declare waterMaterial: THREE.ShaderMaterial;
  declare motes: THREE.Object3D;
  declare releaseTerrainSampler: () => void;
  declare releaseBridgeSampler: () => void;

  declare canvas: any;
  declare onMoveTarget: (x: number, z: number) => void;
  declare onAnimal: (id: string) => void;
  declare onError: (text: string) => void;
  declare state: ViewState;
  declare selfId: any;
  declare yaw: number;
  declare pitch: number;
  declare distance: number;
  declare targetDistance: number;
  declare zoom: number;
  declare focus: THREE.Vector3;
  declare firstState: boolean;
  declare collision: any;
  declare players: Map<any, any>;
  declare resources: Map<any, any>;
  declare labels: any[];
  declare fires: any[];
  declare mammoths: any[];
  declare enemies: Map<any, any>;
  declare staticScenery: any[];
  declare nextStaticCull: number;
  declare humanAssets: Map<any, any>;
  declare npcAssets: any;
  declare worldAssets: WorldAssets;
  declare landscapes: any[];
  declare disposables: any[];
  declare disposed: boolean;
  declare fpsFrames: number;
  declare lastFpsTime: number;
  declare renderer: THREE.WebGLRenderer;
  declare nextShadowUpdate: number;
  declare scene: THREE.Scene<THREE.Object3DEventMap>;
  declare spells: SpellEffects;
  declare camera: THREE.PerspectiveCamera;
  declare raycaster: THREE.Raycaster;
  declare labelLayer: HTMLDivElement;
  declare atmosphere: WorldAtmosphere;
  declare resizeObserver: ResizeObserver;
  declare contextLost: (e: any) => void;
  declare frameClock: FrameClock;
  declare animate: (now: any) => void;
  declare frame: number;
  declare loadingLabel: HTMLDivElement;
  declare assetsPromise: Promise<void>;
  declare hemisphere: THREE.HemisphereLight | undefined;
  declare sun: THREE.DirectionalLight | undefined;
  declare skyUniforms:
    | {
        cameraWorld: {
          value: THREE.Matrix4;
        };
        inverseProjection: {
          value: THREE.Matrix4;
        };
        biomeSky: {
          value: THREE.Color;
        };
        biomeFog: {
          value: THREE.Color;
        };
        shadowRealm: {
          value: number;
        };
      }
    | undefined;
  declare landmarks: WorldLandmarks | undefined;
  declare assetsReady: boolean | undefined;
  declare boatRenderer: BoatRenderer | undefined;
  declare adventureEffects: AdventureEffects | undefined;
  declare npcActor: any;
  declare npc: any;
  declare failed: boolean | undefined;
  declare marker: THREE.Group<THREE.Object3DEventMap> | undefined;
  declare down: ((e: any) => void) | undefined;
  declare pointer:
    | {
        id: any;
        x: any;
        y: any;
        lastX: any;
        lastY: any;
        button: any;
        dragged: boolean;
      }
    | null
    | undefined;
  declare move: ((e: any) => void) | undefined;
  declare up: ((e: any) => void) | undefined;
  declare markerUntil: number | undefined;
  declare cancel: (() => void) | undefined;
  declare wheel: ((e: any) => void) | undefined;
  declare context: ((e: any) => any) | undefined;
  declare serverTime: any;
  declare stateReceivedAt: number | undefined;
  declare cameraMount: any;
  declare width: number | undefined;
  declare height: number | undefined;
  declare simulationMs: any;
  declare submissionMs: any;

  constructor(
    canvas,
    {
      onMoveTarget = (_x: number, _z: number) => {},
      onAnimal = (_id: string) => {},
      onError = (_text: string) => {},
    } = {},
  ) {
    this.canvas = canvas;
    this.onMoveTarget = onMoveTarget;
    this.onAnimal = onAnimal;
    this.onError = onError;
    this.state = { players: [], resources: INITIAL_RESOURCES, camp: CAMP, npc: NPC };
    this.selfId = null;
    this.yaw = -0.28;
    this.pitch = 0.19;
    this.distance = DEFAULT_DISTANCE;
    this.targetDistance = DEFAULT_DISTANCE;
    this.zoom = 1;
    this.focus = new THREE.Vector3(48, walkHeight(48, 57) + 1.4, 57);
    this.firstState = true;
    this.collision = new CollisionWorld(undefined, {
      active: (o) =>
        !o.resourceId || this.state.resources.some((r) => r.id === o.resourceId && r.amount > 0),
    });
    this.players = new Map();
    this.resources = new Map();
    this.labels = [];
    this.fires = [];
    this.mammoths = [];
    this.enemies = new Map();
    this.staticScenery = [];
    this.nextStaticCull = 0;
    this.humanAssets = new Map(
      CHARACTER_MODELS.map((model) => [
        model.key,
        new CharacterAssets(`/models/${model.key}/asset.json`),
      ]),
    );
    this.npcAssets = this.humanAssets.get(characterModel(NPC).key);
    this.worldAssets = new WorldAssets();
    this.landscapes = [];
    this.canvas.dataset.characterAsset = 'not-loaded';
    this.canvas.dataset.worldAsset = 'loading';
    this.disposables = [];
    this.disposed = false;
    this.fpsFrames = 0;
    this.lastFpsTime = 0;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.nextShadowUpdate = 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c0cec1');
    this.scene.fog = new THREE.Fog('#b5c4b2', 45, 118);
    this.spells = new SpellEffects(this.scene);
    this.camera = new THREE.PerspectiveCamera(57, 1, 0.15, 360);
    this.raycaster = new THREE.Raycaster();
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'world-labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    canvas.parentElement.append(this.labelLayer);
    this.setupLighting();
    this.atmosphere = new WorldAtmosphere(this);
    this.createNavigation();
    this.setupInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.contextLost = (e) => {
      e.preventDefault();
      this.failWorld(
        '3D描画が一時停止しました。ページを再読み込みしてください。',
        new Error('WebGL context lost'),
      );
    };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.frameClock = new FrameClock(performance.now(), 60);
    this.animate = (now) => {
      if (this.disposed || this.failed) return;
      const dt = this.frameClock.advance(now, document.hidden);
      if (dt !== null) this.render(now / 1000, dt);
      this.frame = requestAnimationFrame(this.animate);
    };
    this.frame = requestAnimationFrame(this.animate);
    canvas.dataset.renderer = 'three-webgl-tps';
    canvas.dataset.fpsLimit = '60';
    this.loadingLabel = document.createElement('div');
    this.loadingLabel.className = 'world-loading';
    this.loadingLabel.textContent = '渓谷を準備しています…';
    canvas.parentElement.append(this.loadingLabel);
    this.assetsPromise = this.initializeWorld();
    this.assetsPromise.catch(() => {});
  }

  setupLighting() {
    this.hemisphere = new THREE.HemisphereLight('#dce7d7', '#546047', 2.0);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight('#ffe4b5', 2.65);
    this.sun.position.set(5, 47, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -22;
    this.sun.shadow.camera.right = 22;
    this.sun.shadow.camera.top = 22;
    this.sun.shadow.camera.bottom = -22;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 135;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.055;
    this.sun.target.position.set(50, 0, 50);
    this.scene.add(this.sun, this.sun.target);
    // Full-screen atmospheric shader: sky, sun and clouds are runtime effects.
    this.skyUniforms = {
      cameraWorld: { value: this.camera.matrixWorld },
      inverseProjection: { value: this.camera.projectionMatrixInverse },
      biomeSky: { value: new THREE.Color('#bfd3cb') },
      biomeFog: { value: new THREE.Color('#b5c4b2') },
      shadowRealm: { value: 0 },
    };
    const skyMaterial = new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: this.skyUniforms,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}',
      fragmentShader:
        /* Shared linear sky and rift colors. */ 'varying vec2 vUv;uniform mat4 cameraWorld;uniform mat4 inverseProjection;uniform vec3 biomeSky;uniform vec3 biomeFog;uniform float shadowRealm;void main(){vec4 eye=inverseProjection*vec4(vUv*2.0-1.0,1.0,1.0);vec3 d=normalize(mat3(cameraWorld)*eye.xyz);float h=clamp(d.y*1.7,0.0,1.0);vec3 color=mix(vec3(.72,.75,.65),vec3(.29,.49,.58),pow(h,.7));float sun=pow(max(0.0,dot(d,normalize(vec3(-.65,.55,-.85)))),850.0);color+=vec3(.9,.72,.42)*sun;vec2 p=d.xz/max(.12,d.y)*3.0;float noise=sin(p.x*.7+sin(p.y))*.25+sin(p.y*.5-p.x*.3)*.2+sin(p.x*1.3+p.y*.8)*.1;float cloud=smoothstep(.15,.43,noise)*smoothstep(.03,.23,d.y);color=mix(color,vec3(.83,.84,.75),cloud*.65);color=mix(color,biomeSky,mix(.65,.98,shadowRealm));color=mix(biomeFog,color,smoothstep(-.04,.18,d.y));gl_FragColor=vec4(color,1.0);\n#include <colorspace_fragment>\n}',
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    this.scene.add(sky);
  }

  async initializeWorld() {
    const started = performance.now();
    try {
      await Promise.all([this.worldAssets.load(), this.npcAssets.load()]);
      if (this.disposed) return;
      await buildTerrainAssets(this);
      if (this.disposed) return;
      buildForestAssets(this);
      buildCampAssets(this);
      buildAnimalAssets(this);
      this.landmarks = new WorldLandmarks(this);
      this.assetsReady = true;
      this.syncResources();
      this.syncEnemies();
      this.campLabel.element.classList.toggle('complete', this.state.camp.level > 0);
      this.boatRenderer = new BoatRenderer(this);
      this.adventureEffects = new AdventureEffects(this);
      this.npcActor = await this.npcAssets.create({ color: '#ad9d79' });
      if (this.disposed) {
        this.npcActor?.dispose();
        return;
      }
      this.npc = this.npcActor.root;
      this.npc.position.set(NPC.x, walkHeight(NPC.x, NPC.z), NPC.z);
      this.npc.rotation.y = -1.9;
      this.scene.add(this.npc);
      this.updateAssetDiagnostics();
      this.canvas.dataset.worldAsset = 'ready';
      this.canvas.dataset.worldLoadMs = this.worldAssets.loadMilliseconds.toFixed(0);
      this.canvas.dataset.worldSceneReadyMs = (performance.now() - started).toFixed(0);
      this.loadingLabel.remove();
    } catch (error) {
      if (this.disposed) return;
      this.failWorld('検証済みの3D素材を読み込めませんでした。再読み込みしてください。', error);
      throw error;
    }
  }

  updateAssetDiagnostics() {
    const loaded = [...this.worldAssets.templates].map(([key, template]) => [
      key,
      template.asset.sha256,
    ]);
    for (const [key, provider] of this.humanAssets)
      if (provider.template) loaded.push([key, provider.template.asset.sha256]);
    this.canvas.dataset.worldHashes = JSON.stringify(Object.fromEntries(loaded));
    this.canvas.dataset.worldModels = String(loaded.length);
  }

  failWorld(message, error) {
    this.failed = true;
    this.assetsReady = false;
    cancelAnimationFrame(this.frame);
    this.canvas.dataset.worldAsset = 'error';
    this.canvas.style.visibility = 'hidden';
    this.loadingLabel?.remove();
    this.onError(message);
    console.error(message, error);
  }

  createNavigation() {
    this.marker = new THREE.Group();
    const ring = mesh(
      new THREE.RingGeometry(0.43, 0.5, 36),
      new THREE.MeshBasicMaterial({
        color: '#d7ca8d',
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      this.marker,
    );
    ring.rotation.x = -Math.PI / 2;
    const dot = mesh(new THREE.CircleGeometry(0.09, 12), ring.material, this.marker, [0, 0.008, 0]);
    dot.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  createLabel(text, kind, position, subtitle = '') {
    const element = document.createElement('div');
    element.className = `world-label ${kind}`;
    const title = document.createElement('strong');
    title.textContent = text;
    element.append(title);
    if (subtitle) {
      const sub = document.createElement('small');
      sub.textContent = subtitle;
      element.append(sub);
    }
    this.labelLayer.append(element);
    const label = { element, position, kind, active: true };
    this.labels.push(label);
    return label;
  }

  syncResources() {
    if (!this.assetsReady) return;
    for (const resource of this.state.resources) {
      let item = this.resources.get(resource.id);
      if (!item) {
        const { key, surface, scale, yaw } = resourceAppearance(resource);
        if (surface && !this.regionalScenery?.wants(key, surface)) continue;
        const model = this.worldAssets.createResource(key, surface);
        model.scale.setScalar(scale);
        model.position.set(resource.x, walkHeight(resource.x, resource.z), resource.z);
        model.rotation.y = yaw;
        this.scene.add(model);
        const label = this.createLabel(
          { wood: '木材', stone: '石', berry: 'ベリー' }[resource.type],
          'resource',
          new THREE.Vector3(resource.x, walkHeight(resource.x, resource.z) + 1.7, resource.z),
        );
        item = { model, label, key, surface };
        this.resources.set(resource.id, item);
      }
      item.resource = resource;
      item.model.visible = resource.amount > 0;
      item.label.active = resource.amount > 0;
    }
  }

  syncEnemies() {
    if (!this.assetsReady) return;
    const present = new Set();
    for (const state of this.state.enemies || []) {
      present.add(state.id);
      let entity = this.enemies.get(state.id);
      if (entity && entity.state.modelKey !== state.modelKey) {
        this.removeEnemy(state.id);
        entity = null;
      }
      if (!entity) {
        const model = new THREE.Group();
        model.visible = false;
        model.userData.animalId = state.id;
        this.scene.add(model);
        const label = this.createLabel(state.name, 'enemy', new THREE.Vector3());
        label.active = false;
        const health = document.createElement('progress');
        health.setAttribute('aria-label', `${state.name}の体力`);
        label.element.append(health);
        entity = { model, label, health, state, actor: null };
        this.enemies.set(state.id, entity);
        this.loadEnemy(entity, state.id);
      }
      entity.state = state;
    }
    for (const id of this.enemies.keys()) if (!present.has(id)) this.removeEnemy(id);
  }

  removeEnemy(id) {
    const entity = this.enemies.get(id);
    if (!entity) return;
    this.scene.remove(entity.model);
    entity.actor?.dispose();
    entity.label.element.remove();
    this.labels.splice(this.labels.indexOf(entity.label), 1);
    this.enemies.delete(id);
  }

  async loadEnemy(entity, id) {
    try {
      const actor = await this.worldAssets.createEnemy(entity.state.modelKey);
      if (!actor) return;
      if (this.disposed || this.enemies.get(id) !== entity) {
        actor.dispose();
        return;
      }
      entity.actor = actor;
      entity.model.add(actor.root);
      entity.model.scale.setScalar(entity.state.scale ?? 1);
      this.updateAssetDiagnostics();
    } catch (error) {
      if (!this.disposed && this.enemies.get(id) === entity)
        this.failWorld('敵の検証済み3D素材を読み込めませんでした。再読み込みしてください。', error);
    }
  }

  setupInput() {
    this.down = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.pointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        button: e.button,
        dragged: false,
      };
      this.canvas.setPointerCapture(e.pointerId);
    };
    this.move = (e) => {
      if (!this.pointer || this.pointer.id !== e.pointerId) return;
      const p = this.pointer,
        dx = e.clientX - p.lastX,
        dy = e.clientY - p.lastY;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) p.dragged = true;
      if (p.dragged) {
        this.yaw -= dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.0045, 0.06, 1.05);
        this.canvas.style.cursor = 'grabbing';
      }
      p.lastX = e.clientX;
      p.lastY = e.clientY;
    };
    this.up = (e) => {
      if (!this.pointer || this.pointer.id !== e.pointerId) return;
      const click = !this.pointer.dragged && this.pointer.button === 0;
      this.pointer = null;
      this.canvas.style.cursor = 'crosshair';
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      if (click) {
        const rect = this.canvas.getBoundingClientRect();
        this.raycaster.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          this.camera,
        );
        if (this.players.get(this.selfId)?.state.boatId) {
          const sea = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOATING.waterY),
            point = new THREE.Vector3();
          if (this.raycaster.ray.intersectPlane(sea, point) && !isLand(point.x, point.z)) {
            const x = worldClamp(point.x, 'x'),
              z = worldClamp(point.z, 'z');
            this.onMoveTarget(x, z);
            this.marker.position.set(x, BOATING.waterY + 0.065, z);
            this.marker.visible = true;
            this.markerUntil = performance.now() + 6500;
          }
          return;
        }
        const animalRoots = [
          ...this.mammoths.flatMap((animal) => [animal.model, animal.meat]),
          ...[...this.enemies.values()].map((enemy) => enemy.model),
        ].filter((root) => root.visible);
        const animalHit = this.raycaster.intersectObjects(animalRoots, true)[0];
        if (animalHit) {
          let root = animalHit.object;
          while (root && !root.userData.animalId) root = root.parent;
          if (root) {
            this.onAnimal(root.userData.animalId);
            return;
          }
        }
        const hits = this.raycaster.intersectObjects(
          [this.terrain, this.bridge, this.landmarks?.instances.get('valley-castle')].filter(
            Boolean,
          ),
          true,
        );
        const hit = hits.find(
          (h) =>
            isLand(h.point.x, h.point.z) &&
            Math.abs(h.point.y - walkHeight(h.point.x, h.point.z)) < 0.8 &&
            this.collision.free(h.point, 0.05),
        )?.point;
        if (hit) {
          const x = worldClamp(hit.x, 'x'),
            z = worldClamp(hit.z, 'z');
          this.onMoveTarget(x, z);
          this.marker.position.set(x, walkHeight(x, z) + 0.065, z);
          this.marker.visible = true;
          this.markerUntil = performance.now() + 6500;
        }
      }
    };
    this.cancel = () => {
      this.pointer = null;
      this.canvas.style.cursor = 'crosshair';
    };
    this.wheel = (e) => {
      e.preventDefault();
      this.targetDistance = clamp(this.targetDistance + e.deltaY * 0.009, 3.2, 19);
      this.zoom = DEFAULT_DISTANCE / this.targetDistance;
    };
    this.context = (e) => e.preventDefault();
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.cancel);
    this.canvas.addEventListener('lostpointercapture', this.cancel);
    this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.context);
  }

  setState(state, selfId) {
    if (Number.isFinite(state.serverTime)) {
      this.serverTime = state.serverTime;
      this.stateReceivedAt = performance.now();
    }
    if (this.selfId !== selfId) this.firstState = true;
    const resourcesChanged = this.state.resources !== state.resources;
    this.state = state;
    this.selfId = selfId;
    if (resourcesChanged) this.syncResources();
    this.syncEnemies();
    const present = new Set();
    for (const p of state.players) {
      present.add(p.id);
      let entity = this.players.get(p.id);
      if (!entity) {
        const model = new THREE.Group();
        model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        model.rotation.y = p.facing ?? 0;
        this.scene.add(model);
        const label = this.createLabel(
          p.name,
          p.id === selfId ? 'self' : 'player',
          new THREE.Vector3(p.x, 0, p.z),
        );
        entity = { model, label, state: p };
        this.players.set(p.id, entity);
        this.loadHuman(entity, p.id);
      }
      if (playerRecovered(entity.state, p)) {
        entity.model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        entity.model.rotation.y = p.facing ?? 0;
        if (p.id === selfId) this.focus.set(p.x, walkHeight(p.x, p.z) + focusHeight(p), p.z);
      }
      const action = confirmedAction(entity.state, p);
      if (action === 'Attack')
        entity.actor?.animation.playAttack(
          Math.max(0, (this.serverNow() - (p.attackAt ?? 0)) / 1000),
        );
      else if (action && !p.moving) entity.actor?.animation.play(action);
      entity.state = p;
      if (p.id === selfId && this.firstState) {
        this.focus.set(p.x, walkHeight(p.x, p.z) + focusHeight(p), p.z);
        this.targetDistance = p.species === 'bear' ? 4.5 : DEFAULT_DISTANCE;
        this.distance = this.targetDistance;
        this.zoom = DEFAULT_DISTANCE / this.targetDistance;
        this.firstState = false;
      }
      if (p.id === selfId && this.cameraMount !== (p.mountId || p.boatId || null)) {
        this.cameraMount = p.mountId || p.boatId || null;
        this.targetDistance = p.mountId
          ? 9
          : p.boatId
            ? 7
            : p.species === 'bear'
              ? 4.5
              : DEFAULT_DISTANCE;
        this.zoom = DEFAULT_DISTANCE / this.targetDistance;
      }
    }
    for (const [id, entity] of this.players)
      if (!present.has(id)) {
        this.scene.remove(entity.model);
        entity.actor?.dispose();
        entity.label.element.remove();
        this.labels.splice(this.labels.indexOf(entity.label), 1);
        this.players.delete(id);
      }
    this.campLabel?.element.classList.toggle('complete', state.camp.level > 0);
  }

  async loadHuman(entity, id) {
    this.canvas.dataset.characterAsset = 'loading';
    let pendingActor;
    try {
      await this.assetsPromise;
      if (this.disposed || this.players.get(id) !== entity || !this.assetsReady) return;
      const provider = this.humanAssets.get(characterModel(entity.state).key);
      const actor = (pendingActor = await provider.create({ color: entity.state.color }));
      if (!actor) return;
      if (this.disposed || this.players.get(id) !== entity) {
        actor.dispose();
        return;
      }
      const previous = entity.model;
      actor.root.position.set(0, 0, 0);
      const grip = actor.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.R'));
      entity.gripRight = grip;
      entity.gripLeft = actor.root.getObjectByName(
        THREE.PropertyBinding.sanitizeNodeName('Grip.L'),
      );
      if (grip) {
        const profile = attackProfile(entity.state);
        entity.weapon = profile.modelKey
          ? await this.worldAssets.createEquipment(profile.modelKey)
          : null;
        if (this.disposed || this.players.get(id) !== entity) {
          actor.dispose();
          return;
        }
        entity.axe = this.worldAssets.create('stone-axe');
        for (const tool of [entity.weapon, entity.axe].filter(Boolean)) {
          grip.add(tool);
          tool.position.set(0, 0, 0);
          tool.quaternion.copy(actor.gripUp);
        }
        if (entity.state.species === 'bear') entity.axe.scale.setScalar(0.55);
        entity.axe.visible = false;
      }
      previous.add(actor.root);
      entity.actor = actor;
      pendingActor = null;
      this.updateAssetDiagnostics();
      if (entity.state.attackAt)
        actor.animation.playAttack(Math.max(0, (this.serverNow() - entity.state.attackAt) / 1000));
      this.canvas.dataset.characterAsset = 'ready';
      this.canvas.dataset.characterHash = actor.asset.sha256;
      this.canvas.dataset.modelLoadMs = provider.loadMilliseconds.toFixed(0);
    } catch (error) {
      pendingActor?.dispose();
      if (this.disposed) return;
      this.canvas.dataset.characterAsset = 'error';
      this.failWorld('人物の3D素材を読み込めませんでした。再読み込みしてください。', error);
    }
  }

  setEmote(id, emote) {
    const entity = this.players.get(id);
    if (emote === 'wave' && !entity?.state.moving) entity?.actor?.animation.play('Wave');
  }

  getMovementDirection(sx, sy) {
    return movementFromCamera(sx, sy, this.yaw);
  }
  serverNow() {
    return this.serverTime === undefined
      ? Date.now()
      : this.serverTime + performance.now() - this.stateReceivedAt;
  }
  setZoom(value) {
    this.zoom = clamp(Number(value) || 1, DEFAULT_DISTANCE / 19, DEFAULT_DISTANCE / 3.2);
    this.targetDistance = clamp(DEFAULT_DISTANCE / this.zoom, 3.2, 19);
  }
  adjustZoom(delta) {
    this.setZoom(this.zoom + delta);
  }
  focusPlayer() {
    const me = this.players.get(this.selfId);
    if (me?.state.moving) this.yaw = me.state.facing + Math.PI;
    else this.yaw = -0.28;
    this.pitch = 0.19;
    this.targetDistance = me?.state.mountId
      ? 9
      : me?.state.boatId
        ? 7
        : me?.state.species === 'bear'
          ? 4.5
          : DEFAULT_DISTANCE;
    this.zoom = DEFAULT_DISTANCE / this.targetDistance;
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  render(time, dt) {
    const frameStarted = performance.now();
    for (const animal of this.mammoths) {
      const state = this.state.animals?.find((item) => item.id === animal.id);
      animal.seat ??= mammothSeat(animal.actor.root);
      const phase = state?.phase ?? 'alive';
      animal.model.visible = !!state && (phase === 'alive' || phase === 'dying');
      animal.meat.visible = !!state && phase === 'meat';
      animal.label.active =
        !!state && state.riderId !== this.selfId && (phase === 'alive' || phase === 'meat');
      if (!state) continue;
      if (Math.hypot(state.x - this.camera.position.x, state.z - this.camera.position.z) > 90) {
        animal.model.visible = false;
        animal.meat.visible = false;
        animal.label.active = false;
        animal.initialized = false;
        continue;
      }
      if (
        phase !== animal.phase ||
        (phase === 'alive' && state.phaseStartedAt !== animal.phaseStartedAt)
      ) {
        if (phase === 'meat' || phase === 'respawning') animal.actor.stop();
        // A background tab can miss the entire death / respawn cycle while its
        // render loop is suspended. A new alive timestamp starts a new lifetime.
        if (phase === 'alive' && animal.phase) {
          animal.initialized = false;
          animal.actor.stop();
        }
        animal.phase = phase;
        animal.phaseStartedAt = state.phaseStartedAt;
      }
      if (!animal.initialized) {
        animal.model.position.set(state.x, walkHeight(state.x, state.z), state.z);
        animal.initialized = true;
      }
      const factor = 1 - Math.exp(-dt * 15),
        next = this.collision.move(
          animal.model.position,
          (state.x - animal.model.position.x) * factor,
          (state.z - animal.model.position.z) * factor,
          state.radius,
        );
      animal.model.position.set(next.x, walkHeight(next.x, next.z), next.z);
      const diff = Math.atan2(
        Math.sin(state.facing - animal.model.rotation.y),
        Math.cos(state.facing - animal.model.rotation.y),
      );
      animal.model.rotation.y += diff * (1 - Math.exp(-dt * 10));
      animal.meat.position.set(state.x, walkHeight(state.x, state.z), state.z);
      animal.meat.rotation.y = state.facing;
      animal.label.position.set(
        animal.model.position.x,
        animal.model.position.y +
          (phase === 'meat' ? 0.8 : state.scale * animal.actor.asset.heightMetres + 0.35),
        animal.model.position.z,
      );
      animal.label.element.querySelector('strong').textContent =
        phase === 'meat' ? 'マンモスの肉' : 'マンモス';
      animal.detail.textContent =
        phase === 'meat'
          ? `Eで採る · 残り${state.meatRemaining}個`
          : state.riderId
            ? '仲間が騎乗中'
            : 'Rで乗る · Fで攻撃';
      animal.health.hidden = phase !== 'alive';
      animal.health.max = state.maxHealth ?? 100;
      animal.health.value = state.health ?? 100;
      if (phase === 'dying')
        animal.actor.sampleOnce(
          'Death',
          Math.max(0, (this.serverNow() - state.phaseStartedAt) / 1000),
        );
      else if (phase === 'alive') {
        animal.actor.play(
          state.clip,
          animal.actor.asset.locomotion?.[state.clip]
            ? state.speed /
                (state.scale * animal.actor.asset.locomotion[state.clip].metresPerSecond)
            : 1,
        );
        animal.actor.update(dt);
      }
    }
    this.boatRenderer?.update(time, dt);
    for (const entity of this.players.values()) {
      const { model, state: p } = entity,
        factor = 1 - Math.exp(-dt * 20);
      model.visible =
        p.id === this.selfId || Math.hypot(p.x - this.focus.x, p.z - this.focus.z) < 95;
      if (!model.visible) {
        model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        model.rotation.y = p.facing;
        entity.label.active = false;
        continue;
      }
      entity.label.active = true;
      if (p.boatId) {
        const boat = this.boatRenderer?.boats.get(p.boatId);
        model.visible = !!boat?.model.visible && !!entity.actor;
        entity.label.active = model.visible;
        if (!model.visible) continue;
        const pose = entity.actor.ridingPose;
        model.rotation.y = boat.model.rotation.y;
        pose.update(entity.actor.animation, time, p.speed || 0, true);
        this.boatRenderer.seat(p.boatId, tempPoint);
        const offset = pose
          .pelvisOffset((this.riderOffset ??= new THREE.Vector3()))
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, model.rotation.y);
        model.position.copy(tempPoint).sub(offset);
        if (entity.weapon) entity.weapon.visible = false;
        if (entity.axe) entity.axe.visible = false;
        entity.wasMounted = true;
        entity.label.position.copy(model.position);
        entity.label.position.y += entity.actor.asset.heightMetres + 0.3;
        continue;
      }
      const mount = p.mountId && this.mammoths.find((a) => a.id === p.mountId && a.model.visible);
      if (p.mountId) {
        // Keep the rider hidden until the real mammoth and the real skin load.
        // Never display a standing character inside an unloaded mount.
        model.visible = !!mount && !!entity.actor;
        entity.label.active = model.visible;
        if (!model.visible) continue;
        const pose = entity.actor.ridingPose;
        model.rotation.y = mount.model.rotation.y;
        pose.update(entity.actor.animation, time, p.speed || 0);
        mount.model.updateMatrixWorld(true);
        mount.seat.position(tempPoint);
        const offset = pose
          .pelvisOffset((this.riderOffset ??= new THREE.Vector3()))
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, model.rotation.y);
        model.position.copy(tempPoint).sub(offset);
        if (entity.weapon) entity.weapon.visible = false;
        if (entity.axe) entity.axe.visible = false;
        entity.wasMounted = true;
        entity.label.position.copy(model.position);
        entity.label.position.y += entity.actor.asset.heightMetres + 0.3;
        continue;
      }
      if (entity.wasMounted) {
        entity.actor?.ridingPose.leave(entity.actor.animation);
        entity.wasMounted = false;
        model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        model.rotation.y = p.facing;
      }
      let remaining = Math.hypot(p.x - model.position.x, p.z - model.position.z);
      // A long suspension or server recovery can skip many movement snapshots.
      // Accept that authoritative correction instead of interpolating through a
      // building along a route the player never actually took.
      if (remaining > 6) {
        model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        remaining = 0;
        if (p.id === this.selfId) this.focus.set(p.x, walkHeight(p.x, p.z) + focusHeight(p), p.z);
      }
      const next = this.collision.move(
        model.position,
        (p.x - model.position.x) * (remaining < 0.012 ? 1 : factor),
        (p.z - model.position.z) * (remaining < 0.012 ? 1 : factor),
        p.radius ?? WORLD.playerRadius,
      );
      const mx = next.x - model.position.x,
        mz = next.z - model.position.z;
      const visualSpeed = remaining < 0.012 ? 0 : Math.hypot(mx, mz) / Math.max(dt, 0.001);
      model.position.set(next.x, walkHeight(next.x, next.z), next.z);
      if (p.moving) entity.running = p.running;
      const attacking = entity.actor?.animation.name === 'Attack';
      const facing = attacking ? p.facing : visualSpeed > 0.025 ? Math.atan2(mx, mz) : p.facing;
      const diff = Math.atan2(
        Math.sin(facing - model.rotation.y),
        Math.cos(facing - model.rotation.y),
      );
      model.rotation.y += diff * (1 - Math.exp(-dt * 24));
      if (entity.actor) {
        if (p.cookingEndsAt > this.serverNow() && !p.moving && !entity.actor.animation.oneShot)
          entity.actor.animation.play('Craft');
        entity.actor.animation.update(dt, visualSpeed, entity.running);
        if (entity.axe) {
          const attack = entity.actor.animation.name === 'Attack';
          const profile = attackProfile(p);
          entity.axe.visible =
            p.tool &&
            (profile.key === 'spear'
              ? !entity.actor.animation.oneShot
              : entity.actor.animation.name === 'Gather');
          if (entity.weapon) {
            entity.weapon.visible =
              attack || (!entity.actor.animation.oneShot && (profile.key === 'katana' || !p.tool));
            if (profile.key === 'katana')
              orientKatana(
                entity.weapon,
                entity.model,
                attack,
                entity.actor.animation.current.time,
                entity.actor.gripUp,
              );
            else orientSpear(entity.weapon, entity.model, attack, entity.actor.gripUp);
          }
        }
      }
      entity.label.position.set(
        model.position.x,
        model.position.y + (entity.actor ? entity.actor.asset.heightMetres + 0.45 : 2.7),
        model.position.z,
      );
    }
    const self = this.players.get(this.selfId);
    if (self) {
      tempPoint.copy(self.model.position);
      tempPoint.y += focusHeight(self.state);
      this.focus.lerp(tempPoint, 1 - Math.exp(-dt * 11));
    }
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-dt * 10));
    const shoulder = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(
        0.75,
      ),
      aim = this.focus.clone().add(shoulder);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    let cameraDistance = this.distance;
    cameraDistance = this.collision.cameraDistance(aim, offset, this.distance);
    if (cameraDistance < 2.8) {
      aim.copy(this.focus).addScaledVector(shoulder, clamp((cameraDistance - 0.8) / 2, 0, 1));
      cameraDistance = this.collision.cameraDistance(aim, offset, this.distance);
    }
    this.camera.position.copy(aim).addScaledVector(offset, cameraDistance);
    if (this.landmarks?.castleCamera) {
      cameraDistance = this.landmarks.castleCamera.distance(aim, offset, cameraDistance);
      this.camera.position.copy(aim).addScaledVector(offset, cameraDistance);
    }
    const aboveWater =
      !isLand(this.camera.position.x, this.camera.position.z) ||
      (riverHalfWidth(this.camera.position.z) > 0.7 &&
        Math.abs(this.camera.position.x - riverX(this.camera.position.z)) <
          riverHalfWidth(this.camera.position.z));
    this.camera.position.y = Math.max(
      this.camera.position.y,
      terrainHeight(this.camera.position.x, this.camera.position.z) + 0.55,
      aboveWater ? WATER_LEVEL + 0.65 : -Infinity,
    );
    this.camera.lookAt(aim);
    this.camera.updateMatrixWorld();
    this.sun.position.set(this.focus.x - 32, 48, this.focus.z - 25);
    this.sun.target.position.set(this.focus.x, 0, this.focus.z);
    this.openWorld?.update(this.camera, time);
    this.landmarks?.update(this.camera, time);
    this.regionalScenery?.update(this.camera, time);
    this.atmosphere.update(this.focus, time, dt);
    this.adventureEffects?.update(time);
    if (time >= this.nextStaticCull) {
      this.nextStaticCull = time + 0.2;
      for (const { root, radius } of this.staticScenery)
        root.visible =
          Math.hypot(
            root.position.x - this.camera.position.x,
            root.position.z - this.camera.position.z,
          ) <
          (this.scene.fog as THREE.Fog).far + radius;
    }
    for (const item of this.resources.values())
      item.model.visible =
        item.resource.amount > 0 &&
        item.model.position.distanceTo(this.camera.position) <
          (this.scene.fog as THREE.Fog).far + 5;
    if (this.waterMaterial) this.waterMaterial.userData.time.value = time;
    if (this.npc) {
      this.npc.visible = this.npc.position.distanceTo(this.camera.position) < 75;
      if (this.npc.visible) this.npcActor?.animation.update(dt, 0);
    }
    for (const landscape of this.landscapes)
      landscape.update(this.camera, time, self?.state.mountId ? this.focus : null);
    for (const fire of this.fires) {
      const visible = fire.root.position.distanceTo(this.camera.position) < 65;
      fire.light.visible = visible;
      fire.sparks.visible = visible;
      if (!visible) continue;
      fire.light.intensity = 4.1 + Math.sin(time * 9 + fire.seed) * 0.5;
      const pos = fire.sparks.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const life = (time * 0.32 + i / pos.count) % 1;
        pos.setXYZ(
          i,
          Math.sin(i * 51 + time) * life * 0.45,
          0.35 + life * 2.4,
          Math.cos(i * 23 + time * 0.5) * life * 0.45,
        );
      }
      pos.needsUpdate = true;
    }
    for (const enemy of this.enemies.values()) {
      const { state, model, actor } = enemy;
      if (!actor) continue;
      if (enemy.phase !== state.phase || enemy.phaseStartedAt !== state.phaseStartedAt) {
        actor.stop();
        if (state.phase === 'alive') enemy.initialized = false;
        enemy.phase = state.phase;
        enemy.phaseStartedAt = state.phaseStartedAt;
      }
      if (!enemy.initialized) {
        model.position.set(state.x, walkHeight(state.x, state.z), state.z);
        model.rotation.y = state.facing;
        enemy.initialized = true;
      }
      const visible =
        state.phase !== 'respawning' && model.position.distanceTo(this.camera.position) < 75;
      model.visible = visible;
      enemy.label.active = visible && state.phase === 'alive';
      if (!visible) {
        model.position.set(state.x, walkHeight(state.x, state.z), state.z);
        continue;
      }
      const factor = 1 - Math.exp(-dt * 20),
        next = this.collision.move(
          model.position,
          (state.x - model.position.x) * factor,
          (state.z - model.position.z) * factor,
          state.radius,
        );
      model.position.set(next.x, walkHeight(next.x, next.z), next.z);
      const diff = Math.atan2(
        Math.sin(state.facing - model.rotation.y),
        Math.cos(state.facing - model.rotation.y),
      );
      model.rotation.y += diff * (1 - Math.exp(-dt * 24));
      enemy.label.position.set(
        model.position.x,
        model.position.y + (actor.asset.heightMetres ?? 1.85) * (state.scale ?? 1) + 0.3,
        model.position.z,
      );
      enemy.label.element.querySelector('strong').textContent = state.name;
      enemy.health.max = state.maxHealth;
      enemy.health.value = state.health;
      const animation = enemyAnimationState(state, this.serverNow());
      if (animation && animation.elapsed !== null)
        actor.sampleOnce(animation.clip, animation.elapsed);
      else if (animation) {
        const clipSpeed = actor.asset.locomotion?.[animation.clip]?.metresPerSecond;
        actor.play(animation.clip, clipSpeed ? state.speed / ((state.scale ?? 1) * clipSpeed) : 1);
        actor.update(dt);
      }
    }
    if (this.motes) this.motes.rotation.y = Math.sin(time * 0.02) * 0.03;
    if (this.marker.visible) {
      this.marker.rotation.y = time * 0.25;
      this.marker.visible = performance.now() < this.markerUntil;
    }
    if (time >= this.nextShadowUpdate) {
      this.renderer.shadowMap.needsUpdate = true;
      this.nextShadowUpdate = time + 1 / 15;
    }
    this.spells.update(
      this.state,
      this.players,
      this.serverNow(),
      dt,
      this.height * this.renderer.getPixelRatio(),
    );
    this.updateLabels();
    const simulationEnded = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.simulationMs = (this.simulationMs ?? 0) * 0.8 + (simulationEnded - frameStarted) * 0.2;
    this.submissionMs =
      (this.submissionMs ?? 0) * 0.8 + (performance.now() - simulationEnded) * 0.2;
    this.fpsFrames++;
    if (time - this.lastFpsTime > 1) {
      const data = this.canvas.dataset,
        info = this.renderer.info;
      const regional = this.worldAssets.surfaceDiagnostics();
      data.regionFeatures = JSON.stringify(this.landmarks?.diagnostics() ?? null);
      data.regionalSharing = JSON.stringify(regional);
      data.regionalMaterials = String(regional.materials);
      data.regionalBaseCopies = String(regional.extraGeometries + regional.extraTextures);
      data.regionalLandscapes = JSON.stringify(
        this.landscapes
          .filter((item) => item.surface)
          .map((item) => ({
            key: item.key,
            surface: item.surface,
            instances: item.levels.map((meshes) => meshes[0]?.mesh.count ?? 0),
          })),
      );
      data.fps = String(Math.round(this.fpsFrames / (time - this.lastFpsTime)));
      data.frameSimulationMs = this.simulationMs.toFixed(2);
      data.frameSubmissionMs = this.submissionMs.toFixed(2);
      data.documentFocus = String(document.hasFocus());
      data.cameraPosition = [this.camera.position.x, this.camera.position.y, this.camera.position.z]
        .map((n) => n.toFixed(2))
        .join(',');
      data.resourceLods = JSON.stringify(
        [...this.resources.entries()]
          .filter(([, item]) => item.model.isLOD && item.model.visible)
          .map(([id, item]) => ({
            id,
            level: item.model.getCurrentLevel(),
            distance: Number(item.model.position.distanceTo(this.camera.position).toFixed(2)),
          })),
      );
      data.vegetationInstances = JSON.stringify(
        this.landscapes.map((landscape) =>
          landscape.levels.map((meshes) => meshes[0]?.mesh.count ?? 0),
        ),
      );
      data.glbNpcs = String(this.npcActor ? 1 : 0);
      data.glbAnimals = String(this.mammoths.filter((a) => a.model.visible).length);
      data.animals = JSON.stringify(this.state.animals || []);
      data.meatPiles = String(this.mammoths.filter((a) => a.meat.visible).length);
      data.animalAnimations = JSON.stringify(
        this.mammoths.map((a) => ({
          id: a.id,
          phase: a.phase,
          clip: a.actor.name,
          time: a.actor.mixer.time,
        })),
      );
      data.glbEnemies = String(
        [...this.enemies.values()].filter((enemy) => enemy.model.visible && enemy.actor).length,
      );
      data.enemyAnimations = JSON.stringify(
        [...this.enemies.values()].map((enemy) => ({
          id: enemy.state.id,
          phase: enemy.state.phase,
          clip: enemy.actor?.name ?? 'loading',
          visible: enemy.model.visible,
          x: Number(enemy.model.position.x.toFixed(2)),
          z: Number(enemy.model.position.z.toFixed(2)),
        })),
      );
      if (performance.memory)
        data.jsHeapMiB = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
      data.actorModels = JSON.stringify(
        [...this.players.values()]
          .filter((entity) => entity.actor)
          .map((entity) => ({
            id: entity.state.id,
            species: entity.state.species,
            gender: entity.state.gender,
            model: entity.actor.asset.modelKey,
            sha256: entity.actor.asset.sha256,
          })),
      );
      data.actorSpecies = [...this.players.values()]
        .filter((entity) => entity.actor)
        .map((entity) => entity.state.species)
        .sort()
        .join(',');
      data.cameraYaw = this.yaw.toFixed(3);
      data.cameraDistance = cameraDistance.toFixed(2);
      data.drawCalls = String(info.render.calls);
      data.renderTriangles = String(info.render.triangles);
      data.activeFireLights = String(this.fires.filter((fire) => fire.light.visible).length);
      data.staticSceneryVisible = String(
        this.staticScenery.filter((item) => item.root.visible).length,
      );
      data.vegetationExamined = String(
        this.landscapes.reduce((sum, item) => sum + (item.examined ?? 0), 0),
      );
      data.geometries = String(info.memory.geometries);
      data.textures = String(info.memory.textures);
      data.glbPlayers = String([...this.players.values()].filter((entity) => entity.actor).length);
      data.projectileCount = String(this.state.projectiles?.length ?? 0);
      data.spellParticles = String(this.spells.count);
      data.attackStyle = self ? attackProfile(self.state).key : '';
      data.weaponModel = self?.weapon?.userData.assetKey ?? '';
      if (self) {
        data.playerModel = self.actor?.asset.modelKey || 'loading';
        data.playerGender = self.state.gender;
        data.playerY = self.model.position.y.toFixed(3);
        data.playerX = self.model.position.x.toFixed(2);
        data.playerZ = self.model.position.z.toFixed(2);
        data.playerAnimation = self.actor?.animation.name || 'loading';
        data.playerFacing = self.model.rotation.y.toFixed(4);
        data.serverFacing = String(self.state.facing);
        data.playerSpeed = String(self.state.speed);
        data.playerRunning = String(self.state.running);
      }
      this.fpsFrames = 0;
      this.lastFpsTime = time;
    }
  }

  updateLabels() {
    const viewDirection = new THREE.Vector3();
    this.camera.getWorldDirection(viewDirection);
    for (const label of this.labels) {
      const distance = label.position.distanceTo(this.camera.position);
      let visible =
        label.active !== false &&
        distance < (label.kind === 'resource' ? 16 : label.kind === 'camp' ? 35 : 60);
      if (label.kind === 'self') visible = false;
      const toPoint = tempPoint.copy(label.position).sub(this.camera.position);
      if (toPoint.dot(viewDirection) < 0) visible = false;
      if (visible) {
        tempPoint.copy(label.position).project(this.camera);
        visible =
          tempPoint.z > -1 &&
          tempPoint.z < 1 &&
          Math.abs(tempPoint.x) < 1.1 &&
          Math.abs(tempPoint.y) < 1.1;
        label.element.style.transform = `translate(${(tempPoint.x * 0.5 + 0.5) * this.width}px,${(-tempPoint.y * 0.5 + 0.5) * this.height}px) translate(-50%,-100%)`;
        label.element.style.opacity = String(
          clamp((label.kind === 'resource' ? 18 : 65) - distance, 0, 10) / 10,
        );
      }
      label.element.hidden = !visible;
    }
  }

  destroy() {
    this.boatRenderer?.dispose();
    this.disposed = true;
    this.regionalScenery?.dispose();
    this.landmarks?.dispose();
    this.openWorld?.dispose();
    this.releaseTerrainSampler?.();
    this.releaseBridgeSampler?.();
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.labelLayer.remove();
    this.loadingLabel?.remove();
    for (const entity of this.players.values()) if (entity.actor) this.scene.remove(entity.model);
    for (const landscape of this.landscapes) landscape.dispose();
    for (const provider of this.humanAssets.values()) provider.dispose();
    this.worldAssets.dispose();
    this.spells.dispose();
    this.atmosphere.dispose();
    this.adventureEffects?.dispose();
    for (const [event, handler] of [
      ['pointerdown', this.down],
      ['pointermove', this.move],
      ['pointerup', this.up],
      ['pointercancel', this.cancel],
      ['lostpointercapture', this.cancel],
      ['wheel', this.wheel],
      ['contextmenu', this.context],
      ['webglcontextlost', this.contextLost],
    ])
      this.canvas.removeEventListener(event, handler);
    const geometries = new Set<THREE.BufferGeometry>(),
      mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (isMesh(o) || o instanceof THREE.Line || o instanceof THREE.Points) {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
      }
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    geometries.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
  }
}
