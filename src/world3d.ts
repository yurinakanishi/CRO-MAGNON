import type { ViewState } from './view-state.js';
import type { LoadingCave } from './loading-cave.js';
import { NatureAudio } from './nature-audio.js';
import { NatureEffects } from './nature-effects.js';
import { LocalPrediction } from './local-prediction.js';
import { wrapHeading } from './assisted-controls.js';
import { TouchCameraFollow, touchFieldOfView } from './touch-input.js';
import { mammothNavigation } from '../shared/mammoth-navigation.mjs';
import { enemyIsSolid } from '../shared/combat.mjs';
import { activateMiddenObstacle } from '../shared/coastal-sites.mjs';
import { CoastalRenderer } from './coastal-renderer.js';
import { VillageRenderer } from './village-renderer.js';
import { RimoNekoRenderer } from './rimo-neko-renderer.js';
import { rimoNekoOnGround } from '../shared/rimo-neko.mjs';
import { MaeRenderer } from './mae-renderer.js';
import { MAE } from '../shared/mae.mjs';
import { KohakuRenderer } from './kohaku-renderer.js';
import { FriendMascotRenderer } from './friend-mascot-renderer.js';
import { flaskVisible, orientFlask } from './flask-pose.js';
import { FRIEND_MASCOTS, FRIEND_TIMING, pettingFriend } from '../shared/friend-mascots.mjs';
import { MaruimoRenderer } from './maruimo-mascot-renderer.js';
import { KOHAKU } from '../shared/kohaku.mjs';
import { MARUIMO } from '../shared/maruimo-mascot.mjs';
import { OrbBotRenderer } from './orb-bot-renderer.js';
import { ORB_BOTS, pettingOrbBot, posingOrbBot } from '../shared/orb-bots.mjs';
import { GroundPettingPose, groundPettingProgress } from './ground-petting-pose.js';
import { CaveTorch } from './cave-torch.js';
import { caveInteriorWeight, caveTorchAvailable, caveTorchLit } from '../shared/cave-light.mjs';
import { Companion524Renderer } from './companion-524-renderer.js';
import { COMPANION_524, companion524OnGround } from '../shared/companion-524.mjs';
import { chooseCompanionView, companionViewDistances } from './companion-view.js';
import { pettingProgress } from './petting-pose.js';
import { isMesh } from './three-types.js';
import { setText } from './dom-updates.js';
import { VisibleActorGroup } from './visible-actor-group.js';
import type { RegionalScenery } from './regional-scenery.js';
import type { OpenWorldTerrain } from './open-world.js';
import * as THREE from 'three';
import {
  terrainHeight,
  walkHeight,
  cameraFloorHeight,
  riverX,
  riverHalfWidth,
  WATER_LEVEL,
  clamp,
  movementFromCamera,
} from '../shared/terrain.mjs';
import { WORLD, CAMP, NPC, INITIAL_RESOURCES } from '../shared/world.mjs';
import { mountainWaterHeight } from '../shared/mountain-river.mjs';
import { WorldAssets } from './world-assets.js';
import { buildWoodPile } from './wood-pile.js';
import { buildStonePile } from './stone-pile.js';
import { LANDMARK_PLACEMENTS, StartupMountainFit, WorldLandmarks } from './world-landmarks.js';
import { StartupTerrain } from './startup-terrain.js';
import {
  buildTerrainAssets,
  buildForestAssets,
  buildCampAssets,
  buildAnimalAssets,
  buildMotes,
  sceneryTemplateKeys,
} from './world-scenery.js';
import { biomeById, nearbyChunks } from '../shared/biomes.mjs';
import { SCENERY } from '../shared/scenery-layout.mjs';
import { CAMP_MOUNTAIN, campMountainVisualLod } from '../shared/camp-cave-layout.mjs';
import { RIMO_NEKO } from '../shared/rimo-neko.mjs';
import { STARTUP, criticalStartup, type CriticalStartup } from './startup-plan.js';
import { startupMarks } from './startup-marks.js';
import {
  GraphicsContextState,
  compileScene,
  recordEngineResources,
  releaseLostContext,
  type ContextEvent,
  type EngineResource,
} from './context-recovery.js';
import { resourceAppearance } from '../shared/biome-scenery.mjs';
import { CharacterAssets } from './character-assets.js';
import { confirmedAction } from './character-animation.js';
import { jumpHeight, jumpProgress } from '../shared/jumping.mjs';
import { orientSpear } from './spear-pose.js';
import { orientKatana } from './katana-pose.js';
import { SpellEffects } from './spell-effects.js';
import {
  createPrayerSeal,
  crowPropKeys,
  decorateCrowFaction,
  disposePrayerSeal,
  pulsePrayerSeal,
  resizePrayerSeal,
} from './crow-faction-visuals.js';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { equippedItem } from '../shared/equipment.mjs';
import { CollisionWorld } from '../shared/collision.mjs';
import { CHARACTER_MODELS, characterModel } from '../shared/characters.mjs';
import { enemyAnimationState, playerRecovered } from './enemy-state.js';
import { isLand } from '../shared/paleo-geography.mjs';
import { FrameClock } from './frame-clock.js';
import { GraphicsBudget, graphicsPixelRatio } from './graphics-quality.js';
import { ActorUpdateBudget } from './actor-update-budget.js';
import { ContactShadows } from './contact-shadows.js';
import { WorldAtmosphere } from './world-atmosphere.js';
import { AdventureEffects } from './adventure-effects.js';
import { GulfRenderer } from './gulf-renderer.js';
import { COUNTRIES } from '../shared/gulf-region.mjs';
import { mammothSeat } from './riding-pose.js';
import { BoatRenderer } from './boat-renderer.js';
import { BOATING, SeaCollision } from '../shared/boats.mjs';
import { RIDING } from '../shared/riding.mjs';
import { seaBoatSpeed } from '../shared/maritime-weather.mjs';
import {
  berryAnchors,
  fruitCount,
  meatPieceVisibility,
  seedFromId,
  obsidianScale,
} from './resource-visuals.js';
import { updateActorPerformance } from './performance-lod.js';
import {
  LOAD_TIER,
  LoadCancelled,
  LoadDemand,
  LoadTicket,
  isLoadCancelled,
  loadPriority,
} from './asset-load-queue.js';
import {
  ActorResidency,
  RESIDENCY,
  essentialActorIds,
  releaseResidency,
  residencyAttached,
  residencyPriority,
  stepResidency,
} from './actor-residency.js';

const DEFAULT_DISTANCE = 5.5;
// Decorative ground cover is drawn at half density in the one graphics profile.
const GROUNDCOVER_DENSITY = 0.5;
const tempPoint = new THREE.Vector3();
const drawingSize = new THREE.Vector2();
const focusHeight = (profile) =>
  profile.species === 'bear' ? 0.64 : profile.species === 'ape' ? 1.55 : 1.4;

function mesh(geometry, material, parent, position: [number, number, number] = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  parent.add(object);
  return object;
}

export class WorldRenderer {
  readonly audio = new NatureAudio();
  readonly natureEffects = new NatureEffects();
  readonly graphics = new GraphicsBudget();
  readonly actorBudget = new ActorUpdateBudget();
  private contactShadows: ContactShadows;
  prediction = new LocalPrediction();
  predictionObstacles = [];
  predictionSeaCollision: SeaCollision | undefined;
  predictedMotion: any = null;
  /** True while an opaque screen covers the canvas: the simulation runs on, the GPU draw is skipped. */
  occluded: () => boolean = () => false;
  declare campLabel: ReturnType<WorldRenderer['createLabel']>;
  declare regionalScenery: RegionalScenery;
  declare openWorld: OpenWorldTerrain;
  declare riderOffset: THREE.Vector3;
  declare terrain: THREE.Object3D;
  declare bridge: THREE.Object3D;
  declare waterMaterial: THREE.ShaderMaterial;
  declare mountainRiver: THREE.Group;
  declare motes: THREE.Object3D;
  declare marsh: { mist: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> } | undefined;
  declare releaseTerrainSampler: () => void;
  declare releaseBridgeSampler: () => void;

  declare canvas: any;
  declare onAnimal: (id: string) => void;
  private onInspect: () => void;
  private companionView: {
    id: string;
    yaw: number;
    pitch: number;
    distance: number;
    playerX: number;
    playerZ: number;
    warp: number;
    hurt: number;
    character: string;
  } | null = null;
  declare onError: (text: string) => void;
  declare state: ViewState;
  declare selfId: any;
  declare yaw: number;
  manualInputAllowed = () => true;
  manualCameraAllowed = () => true;
  onFrameTiming: ((ms: number) => void) | null = null;
  private automaticHeading: number | null = null;
  private automaticCameraActive = false;
  private touchCamera = new TouchCameraFollow();
  private automaticDistance: number | null = null;
  private manualCamera: { pitch: number; distance: number } | null = null;
  private assistMarkers = new Map<
    string,
    { element: HTMLElement; point: { x: number; z: number; height?: number } }
  >();
  private motionLastFrame: number | null = null;
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
  /** Resident render actors released by distance (diagnostics). */
  declare actorEvictions: number;
  /** The arrival's critical startup set (preparation and diagnostics). */
  declare startupPlan: CriticalStartup | undefined;
  /** Distance-owned templates of the herd, boats and companions. */
  readonly streamDemand = new LoadDemand();
  /** The camp NPC is one actor: it loads and releases by distance like a player. */
  readonly npcResidency = new ActorResidency();
  /** Set once the post-arrival burst of streamed loads has drained. */
  private streamingSettled = false;
  /** Optional streamed actors must not consume the entry handshake's bandwidth. */
  private arrivalLoadRelease: (() => void) | null = null;
  declare landscapes: any[];
  declare disposables: any[];
  declare disposed: boolean;
  declare fpsFrames: number;
  declare lastFpsTime: number;
  declare renderer: THREE.WebGLRenderer;
  declare scene: THREE.Scene<THREE.Object3DEventMap>;
  declare spells: SpellEffects;
  declare camera: THREE.PerspectiveCamera;
  declare raycaster: THREE.Raycaster;
  declare labelLayer: HTMLDivElement;
  declare atmosphere: WorldAtmosphere;
  declare resizeObserver: ResizeObserver;
  declare contextLost: (e: any) => void;
  declare contextRestored: () => void;
  /** WebGL context loss and restoration (context-recovery.ts). */
  readonly graphicsContext = new GraphicsContextState();
  /** The module-level geometry crow-faction-visuals.ts shares among every crow's
   * focus orbs and prayer seals. No crow owns it, so the world keeps it reachable:
   * a lost context releases it even while no crow is near (context-recovery.ts). */
  private readonly crowGeometry = new Set<THREE.BufferGeometry>();
  /** Three's own singletons this renderer uploads (context-recovery.ts
   * recordEngineResources): released at every loss and let go at shutdown. */
  private readonly engineResources = new Map<string, EngineResource>();
  /** Told when the context is lost, restored, or not restored within the visible wait. */
  declare onGraphicsContext: (event: ContextEvent) => void;
  declare frameClock: FrameClock;
  declare animate: (now: any) => void;
  declare frame: number;
  declare loadingLabel: HTMLDivElement;
  /** Initial world download, read by the title's loading screen. */
  declare loadProgress: {
    loaded: number;
    total: number;
    phase: 'download' | 'build' | 'ready' | 'error';
  };
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
  /** The arrival's mountain fit started while the startup set downloads; stopped at
   * shutdown or when the startup fails. */
  declare startupFit: StartupMountainFit | undefined;
  declare startupTerrain: StartupTerrain | undefined;
  declare assetsReady: boolean | undefined;
  declare boatRenderer: BoatRenderer | undefined;
  declare adventureEffects: AdventureEffects | undefined;
  declare gulfRenderer: GulfRenderer | undefined;
  declare coastalRenderer: CoastalRenderer | undefined;
  declare villageRenderer: VillageRenderer | undefined;
  declare companion524Renderer: Companion524Renderer | undefined;
  declare rimoNekoRenderer: RimoNekoRenderer | undefined;
  declare maeRenderer: MaeRenderer | undefined;
  declare kohakuRenderer: KohakuRenderer | undefined;
  readonly friendRenderers = new Map<string, FriendMascotRenderer>();
  declare maruimoRenderer: MaruimoRenderer | undefined;
  declare orbBotRenderer: OrbBotRenderer | undefined;
  declare npcActor: any;
  declare npc: any;
  declare npcLabel: ReturnType<WorldRenderer['createLabel']> | undefined;
  /** Active companion models in the catalog (dormant mascots are not listed). */
  declare companionKeys: Set<string> | undefined;
  declare failed: boolean | undefined;
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
  loadingCave: LoadingCave | null = null;

  constructor(
    canvas,
    {
      onAnimal = (_id: string) => {},
      onError = (_text: string) => {},
      onInspect = () => {},
      onGraphicsContext = (_event: ContextEvent) => {},
      deferWorld = false,
    } = {},
  ) {
    this.canvas = canvas;
    this.onAnimal = onAnimal;
    this.onInspect = onInspect;
    this.onError = onError;
    this.onGraphicsContext = onGraphicsContext;
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
        o.middenId
          ? activateMiddenObstacle(o, this.state.gulf)
          : !o.resourceId ||
            this.state.resources.some((r) => r.id === o.resourceId && r.amount > 0),
    });
    this.players = new Map();
    this.resources = new Map();
    this.labels = [];
    this.fires = [];
    this.mammoths = [];
    this.enemies = new Map();
    this.staticScenery = [];
    this.nextStaticCull = 0;
    this.worldAssets = new WorldAssets();
    // Character templates share the world's bounded, prioritized load queue.
    this.humanAssets = new Map(
      CHARACTER_MODELS.map((model) => [
        model.key,
        new CharacterAssets(`/models/${model.key}/asset.json`, {
          queue: this.worldAssets.loadQueue,
        }),
      ]),
    );
    this.npcAssets = this.humanAssets.get(characterModel(NPC).key);
    this.actorEvictions = 0;
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
    // Firewood piles are clipped from the top by a per-pile plane as they are gathered.
    this.renderer.localClippingEnabled = true;
    // The one graphics profile has no sun shadow map; ContactShadows grounds actors.
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.scene = new THREE.Scene();
    // The world root never moves. Recomputing it forces every static descendant's
    // world matrix to multiply again, including hidden LODs, on every frame.
    this.scene.matrixAutoUpdate = false;
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
    this.contactShadows = new ContactShadows(this);
    this.atmosphere = new WorldAtmosphere(this);
    this.setupInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    // A lost context is temporary: drawing pauses and resumes once the browser
    // restores it (Three's own listeners, registered first, rebuild its state).
    // A genuine asset failure still stops the world through failWorld().
    this.contextLost = (e) => {
      e.preventDefault();
      this.loseGraphicsContext();
    };
    this.contextRestored = () => this.restoreGraphicsContext();
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.frameClock = new FrameClock(performance.now());
    this.animate = (now) => {
      if (this.disposed || this.failed) return;
      this.tick(now);
      this.frame = requestAnimationFrame(this.animate);
    };
    this.frame = requestAnimationFrame(this.animate);
    canvas.dataset.renderer = 'three-webgl-tps';
    canvas.dataset.fpsLimit = String(this.graphics.fps);
    this.loadingLabel = document.createElement('div');
    this.loadingLabel.className = 'world-loading';
    this.loadingLabel.textContent = '渓谷を準備しています…';
    canvas.parentElement.append(this.loadingLabel);
    this.loadProgress = { loaded: 0, total: 0, phase: 'download' };
    this.loadingLabel.hidden = deferWorld;
    if (!deferWorld) this.startWorld();
  }

  startWorld() {
    this.assetsPromise ??= this.initializeWorld();
    this.assetsPromise.catch(() => {});
    return this.assetsPromise;
  }

  /** The browser took the GPU context away (a driver reset, GPU memory pressure,
   * a long-backgrounded tab). Drawing pauses in the one animation loop; the
   * session, the loaded models and their CPU-side geometry, material and texture
   * sources stay for Three to upload again once the context is restored. Their
   * bookkeeping in the lost context is released now, a failed world's included,
   * so no later dispose deletes an obsolete handle. A failed world stays failed;
   * a disposed one no longer listens. */
  loseGraphicsContext() {
    if (this.disposed || !this.graphicsContext.lose()) return;
    if (!this.failed) {
      this.cancel?.();
      this.motionLastFrame = null;
      this.canvas.dataset.webglContext = 'lost';
      this.canvas.dataset.webglLosses = String(this.graphicsContext.losses);
      this.onGraphicsContext('lost');
    }
    this.releaseLostResources();
  }

  /** Three has rebuilt its GL state. Frame timing, the drawing buffer and the
   * safety-scale warmup start over, and the far-view renders that existed only
   * on the GPU are drawn again; everything else is uploaded from its retained
   * source on first use. Never revives a failed or disposed world. */
  restoreGraphicsContext() {
    // A failed world still counts the restore, so its next loss is released too.
    if (this.disposed || !this.graphicsContext.restore() || this.failed) return;
    const now = performance.now();
    this.frameClock = new FrameClock(now);
    this.motionLastFrame = null;
    this.resize(true);
    if (this.assetsReady) this.graphics.ready(now);
    for (const landscape of this.landscapes) landscape.impostor?.draw();
    this.canvas.dataset.webglContext = 'restored';
    this.canvas.dataset.webglRestores = String(this.graphicsContext.restores);
    this.onGraphicsContext('restored');
  }

  /** Release what the lost context uploaded for everything the world holds: its
   * scene, templates and character providers, far views, effects, pools, the
   * crow geometry, the gallery while it is open, what their programs bound and
   * Three's own singletons (context-recovery.ts). Three's own count of the lost
   * context's textures and geometries left afterwards is reported in
   * data-webgl-released; zero means none was missed. */
  private releaseLostResources() {
    const released = releaseLostContext(this.renderer, [this], this.engineResources);
    if (released) this.canvas.dataset.webglReleased = JSON.stringify(released);
  }

  /** At shutdown Three's own singletons let go of this renderer: their GPU copies
   * and its listeners on them, which would otherwise keep its texture and
   * geometry managers alive for the page. Found while the drawn materials still
   * know their programs; Three uploads them again for any later renderer. */
  private releaseEngineResources() {
    const materials = new Set<THREE.Material>();
    for (const scene of [this.scene, this.loadingCave?.scene])
      scene?.traverse((node: any) => {
        for (const material of [node.material ?? []].flat()) materials.add(material);
      });
    recordEngineResources(this.renderer, materials, this.engineResources);
    for (const resource of this.engineResources.values()) resource.dispose();
  }

  setupLighting() {
    this.hemisphere = new THREE.HemisphereLight('#dce7d7', '#546047', 2.0);
    this.scene.add(this.hemisphere);
    // Light only: the sun casts no shadow map in the one graphics profile.
    this.sun = new THREE.DirectionalLight('#ffe4b5', 2.65);
    this.sun.position.set(5, 47, 18);
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

  /** Where the next arrival is expected before its snapshot (a title start).
   * Startup is planned around it; a ready world streams toward it at once. */
  anticipateArrival(point: { x: number; z: number }) {
    if (this.selfId || this.disposed) return;
    this.focus.set(point.x, walkHeight(point.x, point.z) + 1.4, point.z);
  }

  /** The local character's verified template and the props its actor holds (the
   * weapon, the other spear, Howkey's flask), loaded ahead of its snapshot so the
   * body is complete the moment the world names it. A failure is fatal to entry;
   * another character is never substituted. */
  async prepareSelf(profile) {
    const ticket = LoadTicket.of(LOAD_TIER.essential),
      model = characterModel(profile),
      attack = attackProfile(profile),
      provider = this.humanAssets.get(model.key);
    if (!provider) throw new Error(`Missing verified character ${model.key}`);
    await this.worldAssets.loadCatalog();
    const props = new Set<string>();
    if (attack.modelKey) props.add(attack.modelKey);
    // A spear bearer carries both spears; the snapshot picks the head.
    if (attack.key === 'spear')
      for (const key of ['wooden-spear', 'obsidian-spear']) props.add(key);
    if (model.species === 'howkey') props.add('howkey-flask');
    await Promise.all([
      provider.load(ticket),
      ...[...props].map((key) => this.worldAssets.ensureEquipment(key, ticket)),
    ]);
  }

  prioritizeArrivalLoads() {
    this.arrivalLoadRelease ??= this.worldAssets.loadQueue.deferFrom(loadPriority(LOAD_TIER.near));
  }

  releaseArrivalLoads() {
    const release = this.arrivalLoadRelease;
    this.arrivalLoadRelease = null;
    release?.();
  }

  /** The local player's actor is attached in a ready world. */
  selfRenderReady() {
    return !!this.assetsReady && !!this.selfId && !!this.players.get(this.selfId)?.actor;
  }

  /** Resolves once the local player can be shown: its snapshot has arrived, the
   * floor around it exists and its actor (with held props) is attached. Other
   * actors and farther scenery never delay it. Rejects with LoadCancelled when
   * `current()` turns false (the visitor left), with the cause if the world fails. */
  async arrival(current: () => boolean = () => true) {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
    const check = () => {
      if (this.failed) throw new Error('The world failed before arrival');
      if (this.disposed || !current()) throw new LoadCancelled('arrival', 'the visitor left');
    };
    let self = null;
    while (!this.assetsReady || !(self = this.players.get(this.selfId))) {
      check();
      await pause();
    }
    try {
      // The prepared arrival usually covers this; another spawn makes its floor urgent.
      await this.openWorld?.arrive(self.state, performance.now() / 1000);
    } catch (error) {
      // A genuine floor failure has already stopped the world.
      if (this.failed) throw error;
    }
    while (!this.selfRenderReady()) {
      check();
      await pause();
    }
  }

  /** The bounded set an arrival at the current focus needs (startup-plan.ts):
   * its floor, the camp's scenery and props, the landmarks framing its view and
   * the mountain level it sees. Farther ground and landmarks, the NPC, herd,
   * boats and companions stream nearest first afterwards; the local character
   * loads through its own provider (the loading cave shows it first). */
  planStartup(): CriticalStartup {
    const focus = { x: this.focus.x, z: this.focus.z };
    return criticalStartup({
      focus,
      chunks: nearbyChunks(focus.x, focus.z, STARTUP.floorRadius).map((chunk) => ({
        ...chunk,
        ground: biomeById(chunk.biome).ground,
      })),
      placements: LANDMARK_PLACEMENTS,
      sceneryKeys: sceneryTemplateKeys(),
      mountainKey: CAMP_MOUNTAIN.key,
      mountainLevel: campMountainVisualLod(focus.x, focus.z),
    });
  }

  async initializeWorld() {
    const started = performance.now();
    const background = !!this.loadingCave;
    // One world load per page: its boundaries are page marks (startup-marks.ts).
    startupMarks.page('world-start');
    try {
      const catalog = await this.worldAssets.loadCatalog();
      if (this.disposed) return;
      this.companionKeys = new Set(
        catalog.assets.filter((a) => a.kind === 'companion').map((a) => a.modelKey),
      );
      const plan = (this.startupPlan = this.planStartup());
      this.canvas.dataset.worldStartup = JSON.stringify({
        focus: plan.focus,
        floorRadius: STARTUP.floorRadius,
        viewRadius: STARTUP.viewRadius,
        keys: plan.keys,
        floor: plan.floorKeys,
        landmarks: plan.landmarkIds,
        mountainLevels: plan.mountainLevels,
      });
      // Progress covers exactly this set; streamed work never extends it. The mountain
      // level the arrival sees is fitted off the UI thread as soon as its verified template
      // is installed, while the rest downloads.
      const fit = (this.startupFit = new StartupMountainFit(this.worldAssets, plan.mountainLevels));
      const terrain = (this.startupTerrain ??= new StartupTerrain(
        this,
        plan.floorKeys,
        async (cancelled) => {
          startupMarks.page('world-terrain-start');
          await buildTerrainAssets(this, cancelled);
          if (!cancelled()) startupMarks.page('world-terrain-end');
        },
      ));
      const startup = this.worldAssets
        .loadStartup(plan.keys, {
          onProgress: (loaded, total) => {
            Object.assign(this.loadProgress, { loaded, total });
            fit.poll();
            terrain.poll();
          },
        })
        .then(() => {
          fit.poll(true);
          terrain.poll(true);
          if (!this.disposed) startupMarks.page('world-critical-loaded');
        });
      // A failed fit ends the startup at once; one still running is awaited below.
      const prepared = Promise.all([startup, terrain.done]);
      await Promise.race([prepared, fit.done.then(() => prepared)]);
      if (this.disposed) return;
      this.loadProgress.phase = 'build';
      startupMarks.page('world-build-start');
      buildForestAssets(this);
      buildCampAssets(this);
      buildMotes(this);
      this.landmarks = new WorldLandmarks(this);
      startupMarks.page('world-build-end');
      // Only the mountain level the arrival sees is fitted first: the startup's fit, whose
      // failure stops here; prepareMountain then finds it fitted and never fits it again.
      await fit.done;
      await this.landmarks.prepareMountain(plan.mountainLevels);
      if (this.disposed) return;
      startupMarks.page('world-fit');
      this.assetsReady = true;
      this.syncResources();
      this.syncEnemies();
      this.updateActorResidency();
      this.campLabel.element.classList.toggle('complete', this.state.camp.level > 0);
      this.adventureEffects = new AdventureEffects(this);
      if (COUNTRIES.length) {
        this.gulfRenderer = new GulfRenderer(this);
        this.coastalRenderer = new CoastalRenderer(this);
        this.villageRenderer = new VillageRenderer(this);
      }
      this.orbBotRenderer = new OrbBotRenderer(this);
      startupMarks.page('world-prepare-start');
      if (background) await this.prepareEntry(plan);
      if (this.disposed || this.failed) return;
      this.updateAssetDiagnostics();
      this.canvas.dataset.worldAsset = 'ready';
      this.canvas.dataset.worldLoadMs = (this.worldAssets.loadMilliseconds ?? 0).toFixed(0);
      this.canvas.dataset.worldSceneReadyMs = (performance.now() - started).toFixed(0);
      this.loadProgress.phase = 'ready';
      startupMarks.page('world-ready');
      this.loadingLabel.remove();
      this.graphics.ready(performance.now());
      this.updateStreamedTemplates(performance.now() / 1000);
      // The mountain's other detail level is fitted in the background.
      this.landmarks.prepareMountain([0, 1]).catch((error) => {
        if (!this.disposed)
          this.failWorld('山の地形を準備できませんでした。再読み込みしてください。', error);
      });
    } catch (error) {
      if (this.disposed) return;
      // A fit still running when another part of the startup failed is not left behind.
      this.startupFit?.dispose();
      this.startupTerrain?.dispose();
      this.failWorld('検証済みの3D素材を読み込めませんでした。再読み込みしてください。', error);
      throw error;
    }
  }

  /** Prepare the arrival's first frames before a connection's timeout clock
   * starts: the critical landmarks and floor, their programs and one offscreen
   * draw. Nothing beyond the critical set is awaited; the rest keeps streaming
   * behind the gallery. */
  private async prepareEntry(plan: CriticalStartup) {
    const started = performance.now();
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const target = new THREE.WebGLRenderTarget(8, 8);
    try {
      // Each landmark update instances at most four; their templates are loaded.
      const passes = 1 + Math.ceil(plan.landmarkIds.length / 4);
      for (let pass = 0; pass < passes; pass++) {
        if (this.disposed || this.failed) return;
        await nextFrame();
        if (this.disposed || this.failed) return;
        if (this.landmarks) this.landmarks.next = 0;
        this.renderWorld(performance.now() / 1000, 0, true);
        if (this.landmarks.hasInstances(plan.landmarkIds)) break;
      }
      if (this.disposed || this.failed) return;
      // Ends early if the context is lost: a restored context compiles on first use.
      await compileScene(this.renderer, this.scene, this.camera);
      await nextFrame();
      if (this.disposed || this.failed) return;
      // Texture upload also needs a first draw. Keep it offscreen so the visitor
      // sees their cave throughout preparation (a lost context uploads after restore).
      if (!this.graphicsContext.lost) {
        const previous = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(target);
        try {
          this.renderer.render(this.scene, this.camera);
        } finally {
          this.renderer.setRenderTarget(previous);
        }
      }
      this.canvas.dataset.worldPreparedMs = (performance.now() - started).toFixed(0);
    } finally {
      target.dispose();
    }
  }

  /** Actor templates owned by distance (RESIDENCY bands): the herd, boats and
   * active companions load nearest first once within actor range, the local
   * player's mount, boat and squad first of all, and are kept once loaded.
   * Renderers are built when their verified template arrives. */
  private updateStreamedTemplates(time: number) {
    if (this.disposed || this.failed || !this.assetsReady) return;
    const self = this.state.players.find((p) => p.id === this.selfId);
    const wanted = new Map<string, number>();
    const want = (key: string, point, essential = false) => {
      if (!point || this.worldAssets.templates.has(key)) return;
      const priority = residencyPriority(
        this.residencyDistance(point),
        essential,
        this.streamDemand.has(key),
      );
      if (priority !== null) wanted.set(key, Math.min(wanted.get(key) ?? Infinity, priority));
    };
    if (!this.mammoths.length)
      for (const animal of this.state.animals ?? SCENERY.animals) {
        const mounted = self?.mountId === animal.id;
        want('woolly-mammoth', animal, mounted);
        want('mammoth-meat', animal, mounted);
      }
    if (!this.boatRenderer)
      for (const boat of this.state.boats ?? [])
        want('dugout-canoe', boat, self?.boatId === boat.id);
    const companion = (key: string, point, own = false) => {
      if (this.companionKeys?.has(key)) want(key, point, own);
    };
    const { companion524, rimoNeko } = this.state;
    companion(COMPANION_524.modelKey, companion524, companion524?.squadPlayerId === this.selfId);
    companion(RIMO_NEKO.modelKey, rimoNeko, rimoNeko?.squadPlayerId === this.selfId);
    companion(MAE.modelKey, this.state.mae);
    companion(KOHAKU.modelKey, this.state.kohaku);
    companion(MARUIMO.modelKey, this.state.maruimo);
    for (const friend of this.state.friends ?? []) companion(friend.key, friend);
    for (const bot of this.state.orbBots ?? [])
      companion(
        bot.kind === '524'
          ? COMPANION_524.modelKey
          : bot.kind === 'rimo-neko'
            ? RIMO_NEKO.modelKey
            : `orb-bot-${bot.kind}`,
        bot,
        bot.ownerId === this.selfId,
      );
    this.streamDemand.update(wanted, (key, ticket) => this.requestStreamed(key, ticket));
    // Ready once every companion wanted within actor range has its renderer.
    const companions = [...this.streamDemand.keys()].some((key) => this.companionKeys?.has(key))
      ? 'loading'
      : 'ready';
    if (this.canvas.dataset.companionAssets !== companions)
      this.canvas.dataset.companionAssets = companions;
    this.updateNpc(time);
  }

  private requestStreamed(key: string, ticket: LoadTicket) {
    const companion = !!this.companionKeys?.has(key);
    (companion
      ? this.worldAssets.ensureCompanion(key, ticket)
      : this.worldAssets.ensureInitial(key, ticket)
    )
      .then(() => {
        if (!this.disposed) this.installStreamed(key);
      })
      .catch((error) => {
        // A request withdrawn by distance is not an asset failure.
        if (this.disposed || isLoadCancelled(error)) return;
        this.failWorld(
          companion
            ? '仲間の3D素材を読み込めませんでした。再読み込みしてください。'
            : '検証済みの3D素材を読み込めませんでした。再読み込みしてください。',
          error,
        );
      })
      .finally(() => this.streamDemand.settle(key, ticket));
  }

  private installStreamed(key: string) {
    const loaded = (name: string) => this.worldAssets.templates.has(name);
    if (!this.mammoths.length && loaded('woolly-mammoth') && loaded('mammoth-meat'))
      buildAnimalAssets(this);
    if (key === 'dugout-canoe' && !this.boatRenderer) this.boatRenderer = new BoatRenderer(this);
    if (key === COMPANION_524.modelKey)
      this.companion524Renderer ??= new Companion524Renderer(this);
    if (key === RIMO_NEKO.modelKey) this.rimoNekoRenderer ??= new RimoNekoRenderer(this);
    if (key === MAE.modelKey) this.maeRenderer ??= new MaeRenderer(this);
    if (key === KOHAKU.modelKey) this.kohakuRenderer ??= new KohakuRenderer(this);
    if (key === MARUIMO.modelKey) this.maruimoRenderer ??= new MaruimoRenderer(this);
    const friend = FRIEND_MASCOTS.findIndex((f) => f.key === key);
    if (friend >= 0) void this.installFriend(friend);
    this.updateAssetDiagnostics();
  }

  private async installFriend(index: number) {
    const def = FRIEND_MASCOTS[index];
    try {
      const equipment = def.equipment
        ? await this.worldAssets.createEquipment(def.equipment.key)
        : undefined;
      if (this.disposed || this.friendRenderers.has(def.key)) return;
      this.friendRenderers.set(
        def.key,
        new FriendMascotRenderer(this, def, index, equipment ?? undefined),
      );
    } catch (error) {
      if (!this.disposed && !isLoadCancelled(error))
        this.failWorld('仲間の3D素材を読み込めませんでした。再読み込みしてください。', error);
    }
  }

  /** The camp's trading NPC loads within actor range and is released after the
   * grace period beyond it, as a remote player is. */
  private updateNpc(time: number) {
    const residency = this.npcResidency;
    const action = stepResidency(
      residency,
      residencyPriority(this.residencyDistance(NPC), false, residency.state !== 'absent'),
      time,
    );
    if (action === 'load') void this.loadNpc();
    else if (action) {
      if (action === 'evict') this.actorEvictions++;
      this.releaseNpc();
    }
  }

  private async loadNpc() {
    const residency = this.npcResidency,
      token = residency.token,
      ticket = residency.ticket;
    if (!token || !ticket) return;
    const current = () => !this.disposed && residency.token === token;
    let actor = null,
      attached = false;
    try {
      actor = await this.npcAssets.create({ color: '#ad9d79', ticket });
      if (!actor || !current()) return;
      this.npcActor = actor;
      this.npc = actor.root;
      this.npc.position.set(NPC.x, walkHeight(NPC.x, NPC.z), NPC.z);
      this.npc.rotation.y = -1.9;
      this.scene.add(this.npc);
      if (this.npcLabel) this.npcLabel.active = true;
      attached = true;
      residencyAttached(residency, token);
      this.updateAssetDiagnostics();
    } catch (error) {
      if (!current() || isLoadCancelled(error)) return;
      this.failWorld('人物の3D素材を読み込めませんでした。再読み込みしてください。', error);
    } finally {
      if (!attached) {
        actor?.dispose();
        if (residency.token === token) releaseResidency(residency);
      }
    }
  }

  private releaseNpc() {
    releaseResidency(this.npcResidency);
    if (this.npc) this.scene.remove(this.npc);
    this.npcActor?.dispose();
    this.npc = this.npcActor = null;
    // No label without its body.
    if (this.npcLabel) this.npcLabel.active = false;
  }

  /** Whether the shared queue, terrain and landmarks have nothing in flight. */
  private streamingIdle() {
    const queue = this.worldAssets.loadQueue;
    return (
      !queue.active &&
      !queue.queued.length &&
      !this.openWorld?.pending.size &&
      !this.landmarks?.pending.size &&
      !this.streamDemand.size
    );
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
    if (this.loadProgress) this.loadProgress.phase = 'error';
    cancelAnimationFrame(this.frame);
    this.canvas.dataset.worldAsset = 'error';
    this.canvas.style.visibility = 'hidden';
    this.loadingLabel?.remove();
    this.onError(message);
    console.error(message, error);
  }

  createLabel(text, kind, position, subtitle = '') {
    const element = document.createElement('div');
    element.className = `world-label ${kind}`;
    element.hidden = true;
    const title = document.createElement('strong');
    title.textContent = text;
    if (text) element.append(title);
    if (subtitle) {
      const sub = document.createElement('small');
      sub.textContent = subtitle;
      element.append(sub);
    }
    this.labelLayer.append(element);
    const label = { element, title, position, kind, active: true };
    this.labels.push(label);
    return label;
  }

  /** Whether the resource's model is loaded and currently drawn (amount > 0). */
  resourceVisible(id: string): boolean {
    return !!this.resources.get(id)?.model.visible;
  }

  syncResources() {
    if (!this.assetsReady) return;
    for (const resource of this.state.resources) {
      let item = this.resources.get(resource.id);
      if (!item) {
        const { key, surface, scale, yaw } = resourceAppearance(resource);
        if (surface && !this.regionalScenery?.wants(key, surface)) continue;
        const wood =
          resource.type === 'wood'
            ? buildWoodPile(this.worldAssets, resource.maxAmount, surface)
            : null;
        const stone =
          resource.type === 'stone'
            ? buildStonePile(this.worldAssets, resource.maxAmount, surface)
            : null;
        const model = wood?.root ?? stone?.root ?? this.worldAssets.createResource(key, surface);
        model.scale.setScalar(scale);
        model.position.set(resource.x, walkHeight(resource.x, resource.z), resource.z);
        model.rotation.y = yaw;
        this.scene.add(model);
        item = { model, key, surface, baseScale: scale, wood, stone };
        this.decorateResource(item, resource);
        this.resources.set(resource.id, item);
      }
      item.resource = resource;
      item.model.visible = resource.amount > 0;
      this.applyResourceAmount(item, resource);
    }
  }

  /** Berry fruit is attached once to the verified bush. */
  decorateResource(item, resource) {
    if (resource.type === 'berry') {
      const seed = seedFromId(String(resource.id));
      const anchors = berryAnchors(
        this.worldAssets.modelPoints(item.key, item.surface),
        fruitCount(resource.maxAmount, resource.maxAmount),
        seed,
      );
      const fruit = new THREE.Group();
      fruit.name = 'berry-fruit';
      // A direct child of the LOD root stays visible at every level.
      item.model.add(fruit);
      item.fruit = fruit;
      // The bush owns its interest in the shared cluster load: replacing or
      // evicting the bush withdraws it, so a late cluster never attaches.
      item.fruitTicket?.release();
      item.fruitTicket = LoadTicket.of(LOAD_TIER.scene);
      this.attachBerryClusters(item, fruit, anchors, seed, item.fruitTicket);
    }
  }

  /** One TRELLIS berry-cluster prop per fruit anchor; the count still shows the remaining amount. */
  async attachBerryClusters(item, fruit, anchors, seed, ticket = LoadTicket.of(LOAD_TIER.scene)) {
    try {
      const template = await this.worldAssets.createEquipment('berry-cluster', ticket);
      if (!template || this.disposed || item.fruit !== fruit) return;
      template.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(template);
      template.traverse((node) => {
        if (!isMesh(node)) return;
        node.castShadow = false;
        // The fruit marks a harvestable bush from afar, as the earlier glowing spheres did: the
        // shared material emits its own albedo a little.
        const material = node.material as THREE.MeshStandardMaterial;
        if (!material.userData.berryGlow) {
          material.emissive.set('#ffffff');
          material.emissiveMap = material.map;
          material.emissiveIntensity = 0.35;
          material.userData.berryGlow = true;
          material.needsUpdate = true;
        }
      });
      anchors.forEach(([x, y, z], index) => {
        const cluster = index ? template.clone() : template;
        // Anchors are fruit centres; the prop's pivot is its bottom centre.
        cluster.position.set(x, y - (box.max.y - box.min.y) / 2, z);
        cluster.rotation.y = (seed + index * 2.399963) % (Math.PI * 2);
        fruit.add(cluster);
      });
      if (item.resource) this.applyResourceAmount(item, item.resource);
    } catch (error) {
      // A withdrawn, replaced or evicted bush is not an asset failure.
      if (this.disposed || item.fruit !== fruit || isLoadCancelled(error)) return;
      this.failWorld('検証済みの3D素材を読み込めませんでした。再読み込みしてください。', error);
    }
  }

  /** Makes the remaining amount visible: fruit, whole logs, whole stones, obsidian size. */
  applyResourceAmount(item, resource) {
    if (item.fruit) {
      const shown = fruitCount(resource.amount, resource.maxAmount);
      item.fruit.children.forEach((berry, index) => (berry.visible = index < shown));
    } else if (item.wood) {
      item.wood.setAmount(resource.amount);
    } else if (item.stone) {
      item.stone.setAmount(resource.amount);
    } else if (resource.type === 'obsidian') {
      item.model.scale.setScalar(
        obsidianScale(item.baseScale, resource.amount, resource.maxAmount),
      );
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
        const model = new VisibleActorGroup();
        model.visible = false;
        model.userData.animalId = state.id;
        this.scene.add(model);
        const label = this.createLabel('', 'enemy', new THREE.Vector3());
        label.active = false;
        const health = document.createElement('progress');
        health.setAttribute('aria-label', `${state.name}の体力`);
        label.element.append(health);
        // The holder keeps state, label and target; residency loads its actor nearby.
        entity = {
          model,
          label,
          health,
          state,
          actor: null,
          seal: null,
          sealSize: '',
          residency: new ActorResidency(),
        };
        this.enemies.set(state.id, entity);
      }
      entity.state = state;
    }
    for (const id of this.enemies.keys()) if (!present.has(id)) this.removeEnemy(id);
  }

  removeEnemy(id) {
    const entity = this.enemies.get(id);
    if (!entity) return;
    this.releaseEnemyActor(entity);
    this.scene.remove(entity.model);
    entity.label.element.remove();
    this.labels.splice(this.labels.indexOf(entity.label), 1);
    this.enemies.delete(id);
  }

  /** Free an enemy's render actor and seal; its holder, label and target stay. */
  private releaseEnemyActor(entity) {
    if (entity.residency) releaseResidency(entity.residency);
    if (entity.seal) {
      this.scene.remove(entity.seal);
      disposePrayerSeal(entity.seal);
      entity.seal = null;
      entity.sealSize = '';
    }
    if (entity.actor) {
      entity.actor.root.removeFromParent();
      entity.actor.dispose();
      entity.actor = null;
    }
    // A later actor starts from the current server state, not this one's pose.
    entity.model.visible = false;
    entity.label.active = false;
    entity.initialized = false;
    entity.phase = entity.phaseStartedAt = undefined;
  }

  async loadEnemy(entity, id) {
    const residency = entity.residency,
      token = residency?.token,
      ticket = residency?.ticket ?? LoadTicket.of(LOAD_TIER.visible);
    // Only the load that residency started for this holder may attach.
    if (residency && !token) return;
    const current = () =>
      !this.disposed &&
      this.enemies.get(id) === entity &&
      (!residency || residency.token === token);
    let actor = null,
      attached = false;
    try {
      actor = await this.worldAssets.createEnemy(entity.state.modelKey, ticket);
      if (!actor || !current()) return;
      // Crow rank regalia are prop assets loaded with the actor, so a rank never shows bare.
      const crow = entity.state.modelKey === 'crow-shaman';
      const propKeys = crow ? crowPropKeys(entity.state.crowRole) : [];
      const props = await Promise.all(
        propKeys.map((key) => this.worldAssets.createEquipment(key, ticket)),
      );
      if (!current() || props.some((prop) => !prop)) return;
      if (crow) {
        const parts = decorateCrowFaction(
          actor.root,
          entity.state.crowRole,
          Object.fromEntries(propKeys.map((key, index) => [key, props[index]])),
        );
        // A part's own meshes are its focus orbs (props are model roots).
        for (const part of parts)
          for (const child of part.children)
            if (isMesh(child)) this.crowGeometry.add(child.geometry);
      }
      entity.model.add(actor.root);
      entity.model.scale.setScalar(entity.state.scale ?? 1);
      entity.actor = actor;
      attached = true;
      if (residency) residencyAttached(residency, token);
      this.updateAssetDiagnostics();
    } catch (error) {
      // A load nobody wants any more is not an asset failure.
      if (!current() || isLoadCancelled(error)) return;
      this.failWorld('敵の検証済み3D素材を読み込めませんでした。再読み込みしてください。', error);
    } finally {
      if (!attached) {
        actor?.dispose();
        if (residency && residency.token === token) releaseResidency(residency);
      }
    }
  }

  setupInput() {
    this.down = (e) => {
      if (!this.manualInputAllowed()) return;
      if (e.button !== 0 && e.button !== 2) return;
      if (this.pointer) return;
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
      if (!this.manualInputAllowed()) {
        this.cancel();
        return;
      }
      if (!this.pointer || this.pointer.id !== e.pointerId) return;
      const p = this.pointer,
        dx = e.clientX - p.lastX,
        dy = e.clientY - p.lastY;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) p.dragged = true;
      if (p.dragged && this.manualCameraAllowed()) {
        this.rotateCamera(dx * 0.006, dy * 0.0045);
        this.canvas.style.cursor = 'grabbing';
      }
      p.lastX = e.clientX;
      p.lastY = e.clientY;
    };
    this.up = (e) => {
      if (!this.manualInputAllowed()) {
        this.cancel();
        return;
      }
      if (!this.pointer || this.pointer.id !== e.pointerId) return;
      const click = !this.pointer.dragged && this.pointer.button === 0;
      this.pointer = null;
      this.canvas.style.cursor = 'crosshair';
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      if (click && !this.companionView) {
        const rect = this.canvas.getBoundingClientRect();
        this.raycaster.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          this.camera,
        );
        const animalRoots = [
          ...(this.companion524Renderer ? [this.companion524Renderer.root] : []),
          ...(this.rimoNekoRenderer ? [this.rimoNekoRenderer.root] : []),
          ...(this.maeRenderer ? [this.maeRenderer.root] : []),
          ...(this.kohakuRenderer ? [this.kohakuRenderer.root] : []),
          ...(this.maruimoRenderer ? [this.maruimoRenderer.root] : []),
          ...[...this.friendRenderers.values()].map((friend) => friend.root),
          ...[...(this.orbBotRenderer?.bots.values() ?? [])].map(({ actor }) => actor.root),
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
      }
    };
    this.cancel = () => {
      this.pointer = null;
      this.canvas.style.cursor = 'crosshair';
    };
    this.wheel = (e) => {
      if (!this.manualInputAllowed() || !this.manualCameraAllowed()) return;
      e.preventDefault();
      if (!this.companionView && e.deltaY < 0) {
        const rect = this.canvas.getBoundingClientRect();
        this.raycaster.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          this.camera,
        );
        const targets = this.companionViewTargets();
        const hit = this.raycaster.intersectObjects(
          targets.map((t) => t.root),
          true,
        )[0];
        if (hit) {
          let node = hit.object;
          while (node && !node.userData.animalId) node = node.parent;
          if (node && this.viewCompanion(node.userData.animalId)) return;
        }
      }
      const target = this.companionViewTargets().find((t) => t.id === this.companionView?.id);
      const limits = target
        ? companionViewDistances(target.radius, this.camera.fov, this.camera.aspect)
        : null;
      this.targetDistance = limits
        ? clamp(
            this.targetDistance * Math.exp(clamp(e.deltaY, -400, 400) * 0.0015),
            limits.near,
            limits.far,
          )
        : clamp(this.targetDistance + e.deltaY * 0.009, 3.2, 19);
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
    if (this.selfId !== selfId) this.endCompanionView();
    const local = state.players.find((p) => p.id === selfId);
    const controlled = local?.boatId
      ? state.boats?.find((b) => b.id === local.boatId)
      : local?.mountId
        ? state.animals?.find((a) => a.id === local.mountId)
        : null;
    this.prediction.receive(
      controlled
        ? { ...local, x: controlled.x, z: controlled.z, radius: controlled.radius }
        : local,
      performance.now(),
    );
    if (this.prediction.enabled)
      this.predictionObstacles = (
        local?.boatId
          ? (state.boats ?? []).filter((b) => b.id !== local.boatId)
          : [
              ...state.players.filter(
                (p) => p.id !== selfId && !p.mountId && !p.boatId && !p.carrierId,
              ),
              ...(state.animals ?? []).filter(
                (p) => p.id !== local?.mountId && ['alive', 'dying'].includes(p.phase),
              ),
              ...(state.enemies ?? []).filter(enemyIsSolid),
              ...(state.residents ?? []),
            ]
      ).map((p) => ({ type: 'circle', x: p.x, z: p.z, radius: p.radius ?? WORLD.playerRadius }));
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
      const changedCharacter = entity && characterModel(entity.state).key !== characterModel(p).key;
      if (changedCharacter) {
        this.releasePlayerActor(entity);
        this.scene.remove(entity.model);
        entity.label.element.remove();
        this.labels.splice(this.labels.indexOf(entity.label), 1);
        this.players.delete(p.id);
        entity = null;
        if (p.id === selfId) {
          this.focus.set(p.x, walkHeight(p.x, p.z) + focusHeight(p), p.z);
          this.targetDistance = p.species === 'bear' ? 4.5 : DEFAULT_DISTANCE;
          this.zoom = DEFAULT_DISTANCE / this.targetDistance;
        }
      }
      if (!entity) {
        const model = new VisibleActorGroup();
        model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        model.rotation.y = p.facing ?? 0;
        this.scene.add(model);
        const label = this.createLabel(
          p.name,
          p.id === selfId ? 'self' : 'player',
          new THREE.Vector3(p.x, 0, p.z),
        );
        const countryLabel = document.createElement('small');
        label.element.append(countryLabel);
        // The holder keeps state for gameplay; residency loads its actor nearby.
        entity = { model, label, countryLabel, state: p, residency: new ActorResidency() };
        this.players.set(p.id, entity);
      }
      if (
        playerRecovered(entity.state, p) ||
        (entity.state.warpSequence ?? 0) !== (p.warpSequence ?? 0)
      ) {
        entity.model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        entity.model.rotation.y = p.facing ?? 0;
        if (p.id === selfId) this.focus.set(p.x, walkHeight(p.x, p.z) + focusHeight(p), p.z);
      }
      const action = confirmedAction(entity.state, p);
      if (jumpProgress(p, this.serverNow()) === null)
        entity.actor?.jumpPose.leave(entity.actor.animation);
      if (action === 'Attack' && !p.carrierId && caveInteriorWeight(p) === 0)
        entity.actor?.animation.playAttack(
          Math.max(0, (this.serverNow() - (p.attackAt ?? 0)) / 1000),
        );
      else if (action && action !== 'Attack' && !p.moving) entity.actor?.animation.play(action);
      entity.state = p;
      if (entity.countryLabel) {
        const country = COUNTRIES.find((c) => c.id === p.gulf?.countryId);
        setText(entity.countryLabel, country?.name ?? '');
        entity.countryLabel.hidden = !country;
        if (country) entity.countryLabel.style.color = country.color;
      }
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
        this.releasePlayerActor(entity);
        this.scene.remove(entity.model);
        entity.label.element.remove();
        this.labels.splice(this.labels.indexOf(entity.label), 1);
        this.players.delete(id);
      }
    this.campLabel?.element.classList.toggle('complete', state.camp.level > 0);
    this.updateActorResidency();
  }

  /** Free a player's render actor, torch and held props; the state holder and
   * label stay, so gameplay, the map and targets are unchanged. */
  private releasePlayerActor(entity) {
    if (entity.residency) releaseResidency(entity.residency);
    entity.torch?.dispose();
    entity.torch = null;
    if (entity.actor) {
      entity.actor.root.removeFromParent();
      entity.actor.dispose();
      entity.actor = null;
    }
    entity.weapon = entity.axe = entity.flask = entity.spears = null;
    entity.gripRight = entity.gripLeft = null;
    entity.wasMounted = false;
  }

  async loadHuman(entity, id) {
    const residency = entity.residency,
      token = residency?.token,
      ticket = residency?.ticket ?? LoadTicket.of(LOAD_TIER.essential);
    // Only the load that residency started for this holder may attach.
    if (residency && !token) return;
    const current = () =>
      !this.disposed &&
      this.players.get(id) === entity &&
      (!residency || residency.token === token);
    // Readiness describes the local player only, never optional remote actors.
    const self = id === this.selfId;
    if (self) this.canvas.dataset.characterAsset = 'loading';
    let actor = null,
      attached = false;
    try {
      await this.assetsPromise;
      if (!current() || !this.assetsReady) return;
      const provider = this.humanAssets.get(characterModel(entity.state).key);
      actor = await provider.create({ color: entity.state.color, ticket });
      if (!actor || !current()) return;
      actor.root.position.set(0, 0, 0);
      const grip = actor.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.R'));
      const gripLeft = actor.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.L'));
      let weapon = null,
        spears = null,
        axe = null,
        flask = null;
      if (grip) {
        const profile = attackProfile(entity.state);
        weapon = profile.modelKey
          ? await this.worldAssets.createEquipment(profile.modelKey, ticket)
          : null;
        if (profile.key === 'spear') {
          const otherKey = profile.modelKey === 'wooden-spear' ? 'obsidian-spear' : 'wooden-spear';
          const other = await this.worldAssets.createEquipment(otherKey, ticket);
          spears = new Map([
            [profile.modelKey, weapon],
            [otherKey, other],
          ]);
          if (other) {
            grip.add(other);
            other.quaternion.copy(actor.gripUp);
            other.visible = false;
          }
        }
        if (!current()) return;
        axe = this.worldAssets.create('stone-axe');
        for (const tool of [weapon, axe].filter(Boolean)) {
          grip.add(tool);
          tool.position.set(0, 0, 0);
          tool.quaternion.copy(actor.gripUp);
        }
        if (entity.state.species === 'bear') axe.scale.setScalar(0.55);
        axe.visible = false;
        // Howkey's right hand carries her Erlenmeyer flask by the neck.
        flask =
          entity.state.species === 'howkey'
            ? await this.worldAssets.createEquipment('howkey-flask', ticket)
            : null;
        if (!current()) return;
        if (flask) grip.add(flask);
      }
      const torch = new CaveTorch(
        this.scene,
        this.worldAssets,
        actor.root,
        actor.asset.heightMetres,
      );
      entity.model.add(actor.root);
      Object.assign(entity, { gripRight: grip, gripLeft, weapon, spears, axe, flask, torch });
      entity.actor = actor;
      attached = true;
      if (residency) residencyAttached(residency, token);
      this.updateAssetDiagnostics();
      // The actor starts from the current server state, including an attack in progress.
      if (
        entity.state.attackAt &&
        !entity.state.carrierId &&
        caveInteriorWeight(entity.state) === 0
      )
        actor.animation.playAttack(Math.max(0, (this.serverNow() - entity.state.attackAt) / 1000));
      if (self) {
        this.canvas.dataset.characterAsset = 'ready';
        this.canvas.dataset.characterHash = actor.asset.sha256;
        this.canvas.dataset.modelLoadMs = provider.loadMilliseconds.toFixed(0);
      }
    } catch (error) {
      // A load nobody wants any more is not an asset failure.
      if (!current() || isLoadCancelled(error)) return;
      if (self) this.canvas.dataset.characterAsset = 'error';
      this.failWorld('人物の3D素材を読み込めませんでした。再読み込みしてください。', error);
    } finally {
      if (!attached) {
        actor?.dispose();
        if (residency && residency.token === token) releaseResidency(residency);
      }
    }
  }

  /** Admit, prioritize and release render actors around the local focus (see
   * RESIDENCY). State holders always stay; only their actors come and go. */
  updateActorResidency(time = performance.now() / 1000) {
    // A failed world has already reported its error: start nothing new. Before
    // the world is ready, holders wait; initializeWorld() admits them.
    if (this.disposed || this.failed || !this.assetsReady) return;
    const essentials = essentialActorIds(this.state.players ?? [], this.selfId),
      wanted = new Map<string, number>();
    for (const [id, entity] of this.players) {
      const priority = residencyPriority(
        this.residencyDistance(entity.state),
        essentials.has(id),
        entity.residency.state !== 'absent',
      );
      if (priority !== null) wanted.set(id, priority);
    }
    // A passenger is drawn on its carrier's shoulder: the carrier is wanted at least as much.
    for (const [id, priority] of [...wanted]) {
      const carrier = this.players.get(id)?.state.carrierId;
      if (carrier && this.players.has(carrier))
        wanted.set(carrier, Math.min(wanted.get(carrier) ?? Infinity, priority));
    }
    for (const [id, entity] of this.players) {
      const action = stepResidency(entity.residency, wanted.get(id) ?? null, time);
      if (action === 'load') void this.loadHuman(entity, id);
      else if (action) {
        if (action === 'evict') this.actorEvictions++;
        this.releasePlayerActor(entity);
      }
    }
    for (const [id, enemy] of this.enemies) {
      const priority = residencyPriority(
        this.residencyDistance(enemy.state),
        false,
        enemy.residency.state !== 'absent',
      );
      const action = stepResidency(enemy.residency, priority, time);
      if (action === 'load') void this.loadEnemy(enemy, id);
      else if (action) {
        if (action === 'evict') this.actorEvictions++;
        this.releaseEnemyActor(enemy);
      }
    }
    // Reassigned priorities reorder queued work: a warp puts the new scene first.
    this.worldAssets.loadQueue.pump();
    // Templates are evicted only while a local player is in the world: the title
    // and the loading cave keep a character preloaded for the coming join.
    if (this.selfId) {
      // A loading holder may still be waiting to call create(): keep its model.
      const needed = new Set<string>();
      for (const entity of this.players.values())
        if (entity.residency.state === 'loading') needed.add(characterModel(entity.state).key);
      for (const [key, provider] of this.humanAssets)
        provider.collect(time, RESIDENCY.graceSeconds, needed.has(key));
      this.worldAssets.collectActors(time, RESIDENCY.graceSeconds);
    }
  }

  private residencyDistance(state) {
    return Math.hypot(state.x - this.focus.x, state.z - this.focus.z);
  }

  /** Resident, loading and absent render actors, their templates and the queue. */
  residencyDiagnostics() {
    const count = (holders) => {
      const counts = { resident: 0, loading: 0, absent: 0 };
      for (const holder of holders) {
        const state = holder.actor
          ? 'resident'
          : holder.residency?.state === 'loading'
            ? 'loading'
            : 'absent';
        counts[state]++;
      }
      return counts;
    };
    const characters = { loaded: [], loading: [], evicted: 0 };
    for (const [key, provider] of this.humanAssets) {
      if (provider.template) characters.loaded.push(key);
      else if (provider.pending) characters.loading.push(key);
      characters.evicted += provider.evictions ?? 0;
    }
    return {
      players: count(this.players.values()),
      enemies: count(this.enemies.values()),
      evictedActors: this.actorEvictions,
      characterTemplates: characters,
      enemyTemplates: this.worldAssets.actorTemplateDiagnostics(),
    };
  }

  setEmote(id, emote) {
    const entity = this.players.get(id);
    if (emote === 'wave' && !entity?.state.moving) entity?.actor?.animation.play('Wave');
  }

  getMovementDirection(sx, sy) {
    return movementFromCamera(sx, sy, this.yaw);
  }
  setTouchCamera(enabled: boolean) {
    if (this.touchCamera.enabled === enabled) return;
    this.touchCamera.enabled = enabled;
    this.touchCamera.reset();
    this.resize();
  }
  setTouchMovement(dx: number, dz: number) {
    this.touchCamera.movement(dx, dz);
  }
  setAutomaticCamera(heading: number | null, active = true) {
    if (heading !== null && this.automaticHeading === null) {
      this.endCompanionView();
      this.cancel?.();
      this.manualCamera = { pitch: this.pitch, distance: this.targetDistance };
      this.targetDistance = 6.5;
      this.automaticDistance = null;
    } else if (heading === null && this.automaticHeading !== null) {
      if (this.manualCamera) {
        this.pitch = this.manualCamera.pitch;
        this.targetDistance = this.manualCamera.distance;
      }
      this.manualCamera = null;
      this.automaticDistance = null;
    }
    this.automaticHeading = heading;
    this.automaticCameraActive = active;
    this.zoom = DEFAULT_DISTANCE / this.targetDistance;
  }
  assistScreenPoint(point: { x: number; z: number; height?: number }) {
    const target = new THREE.Vector3(
      point.x,
      walkHeight(point.x, point.z) + (point.height ?? 0.65),
      point.z,
    );
    const screen = target.clone().project(this.camera);
    if (screen.z <= -1 || screen.z >= 1 || Math.abs(screen.x) > 0.92 || Math.abs(screen.y) > 0.9)
      return null;
    const ray = this.camera.position.clone().sub(target);
    const distance = ray.length();
    ray.normalize();
    if (
      this.landmarks?.castleCamera &&
      this.landmarks.castleCamera.distance(target, ray, distance) < distance - 0.3
    )
      return null;
    if (
      this.landmarks?.caveCamera &&
      this.landmarks.caveCamera.distance(target, ray, distance) < distance - 0.3
    )
      return null;
    return { x: screen.x, y: screen.y };
  }
  setAssistMarker(
    kind: 'attack' | 'interact',
    point: { x: number; z: number; height?: number } | null,
    label = '',
  ) {
    let marker = this.assistMarkers.get(kind);
    if (!point) {
      if (marker) marker.element.hidden = true;
      this.assistMarkers.delete(kind);
      marker?.element.remove();
      return;
    }
    if (!marker) {
      const element = document.createElement('span');
      element.className = `assist-target assist-target-${kind}`;
      this.labelLayer.append(element);
      marker = { element, point };
      this.assistMarkers.set(kind, marker);
    }
    marker.point = point;
    marker.element.textContent = label;
  }
  rotateCamera(horizontal: number, vertical: number) {
    if (!this.manualCameraAllowed() || this.automaticHeading !== null) return;
    this.yaw -= horizontal;
    this.touchCamera?.hold(performance.now());
    // Orbit below the look target; ground and water clearance keep the camera above the surface.
    this.pitch = clamp(this.pitch + vertical, -0.5, 1.05);
  }
  serverNow() {
    return this.serverTime === undefined
      ? Date.now()
      : this.serverTime + performance.now() - this.stateReceivedAt;
  }
  setZoom(value) {
    if (!this.manualCameraAllowed() || this.automaticHeading !== null) return;
    const target = this.companionViewTargets().find((t) => t.id === this.companionView?.id);
    const limits = target
      ? companionViewDistances(target.radius, this.camera.fov, this.camera.aspect)
      : { near: 3.2, far: 19 };
    this.targetDistance = clamp(DEFAULT_DISTANCE / (Number(value) || 1), limits.near, limits.far);
    this.zoom = DEFAULT_DISTANCE / this.targetDistance;
  }
  adjustZoom(delta) {
    this.setZoom(this.companionView ? this.zoom * (delta > 0 ? 1.2 : 1 / 1.2) : this.zoom + delta);
  }
  focusPlayer(yaw?: number) {
    this.endCompanionView();
    const me = this.players.get(this.selfId);
    if (this.automaticHeading !== null) this.yaw = this.automaticHeading + Math.PI;
    else if (yaw !== undefined) this.yaw = yaw;
    else if (me?.state.moving) this.yaw = me.state.facing + Math.PI;
    else this.yaw = -0.28;
    this.pitch = 0.19;
    this.touchCamera?.hold(performance.now());
    this.targetDistance = me?.state.mountId
      ? 9
      : me?.state.boatId
        ? 7
        : this.automaticHeading !== null
          ? 6.5
          : me?.state.species === 'bear'
            ? 4.5
            : DEFAULT_DISTANCE;
    this.zoom = DEFAULT_DISTANCE / this.targetDistance;
  }

  private companionViewTargets() {
    const targets: {
      id: string;
      label: string;
      root: THREE.Object3D;
      point: THREE.Vector3;
      radius: number;
    }[] = [];
    const add = (id, label, root, asset, scale = 1, centered = false) => {
      if (!root?.visible || !asset) return;
      const height = asset.heightMetres * scale;
      const point = root.position.clone();
      if (!centered) point.y += height * 0.5;
      targets.push({
        id,
        label,
        root,
        point,
        radius:
          Math.hypot(
            height,
            (asset.widthMetres ?? asset.heightMetres) * scale,
            (asset.lengthMetres ?? asset.heightMetres) * scale,
          ) * 0.5,
      });
    };
    if (this.state.rimoNeko && rimoNekoOnGround(this.state.rimoNeko) && this.rimoNekoRenderer)
      add(
        this.state.rimoNeko.id,
        'りもねこ',
        this.rimoNekoRenderer.root,
        this.rimoNekoRenderer.actor.asset,
      );
    if (this.state.kohaku && this.kohakuRenderer)
      add(
        this.state.kohaku.id,
        'こはくちゃん',
        this.kohakuRenderer.root,
        this.kohakuRenderer.actor.asset,
      );
    if (this.state.maruimo && this.maruimoRenderer)
      add(
        this.state.maruimo.id,
        'まるぃも',
        this.maruimoRenderer.root,
        this.maruimoRenderer.actor.asset,
      );
    if (this.state.mae && this.maeRenderer)
      add(this.state.mae.id, 'mae', this.maeRenderer.root, this.maeRenderer.actor.asset);
    for (const friend of this.state.friends ?? []) {
      const renderer = this.friendRenderers.get(friend.key);
      if (renderer) add(friend.id, renderer.def.name, renderer.root, renderer.actor.asset);
    }
    if (
      this.state.companion524 &&
      companion524OnGround(this.state.companion524) &&
      this.companion524Renderer
    )
      add(
        this.state.companion524.id,
        '524',
        this.companion524Renderer.root,
        this.companion524Renderer.actor.asset,
        COMPANION_524.scale,
        true,
      );
    for (const [id, entry] of this.orbBotRenderer?.bots ?? [])
      if (!['windup', 'airborne', 'landing', 'stowed'].includes(entry.state.mode))
        add(id, entry.actor.asset.name, entry.actor.root, entry.actor.asset);
    return targets;
  }

  companionViewChoice(id?: string) {
    const me = this.players.get(this.selfId)?.state;
    if (!me || me.downedUntil || me.boatId || me.mountId || me.carrierId) return;
    return chooseCompanionView(
      this.companionViewTargets()
        .filter((t) => !id || t.id === id)
        .map((t) => {
          const screen = t.point.clone().project(this.camera);
          return {
            ...t,
            x: t.point.x,
            z: t.point.z,
            screenX: screen.x,
            screenY: screen.y,
            screenZ: screen.z,
          };
        }),
      me,
      // Traced now, only for a companion in range and on screen.
      (t) => this.collision.segmentFree(me, t.point, 0.05),
    );
  }

  get viewingCompanion() {
    return this.companionView !== null;
  }

  viewCompanion(id?: string) {
    if (this.companionView || !this.manualInputAllowed() || !this.manualCameraAllowed())
      return false;
    const target = this.companionViewChoice(id);
    const me = this.players.get(this.selfId)?.state;
    if (!target || !me) return false;
    this.onInspect();
    this.companionView = {
      id: target.id,
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.targetDistance,
      playerX: me.x,
      playerZ: me.z,
      warp: me.warpSequence ?? 0,
      hurt: me.hurtSequence ?? 0,
      character: characterModel(me).key,
    };
    this.yaw = target.root.rotation.y;
    this.pitch = 0.2;
    this.targetDistance = companionViewDistances(
      target.radius,
      this.camera.fov,
      this.camera.aspect,
    ).fit;
    this.zoom = DEFAULT_DISTANCE / this.targetDistance;
    this.canvas.dataset.companionView = target.id;
    return true;
  }

  endCompanionView() {
    const previous = this.companionView;
    if (!previous) return false;
    this.companionView = null;
    this.yaw = previous.yaw;
    this.pitch = previous.pitch;
    this.targetDistance = previous.distance;
    this.zoom = DEFAULT_DISTANCE / this.targetDistance;
    this.canvas.dataset.companionView = '';
    return true;
  }
  /** `force` reapplies the drawing buffer even at an unchanged size (a restored context). */
  resize(force = false) {
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    const ratio = graphicsPixelRatio(
      this.width,
      this.height,
      devicePixelRatio,
      this.graphics.scale,
    );
    const size = this.renderer.getSize(drawingSize);
    const ratioChanged = this.renderer.getPixelRatio() !== ratio;
    // Reallocating the drawing buffer clears it: resize it in one step, and only
    // when the canvas size or the effective pixel ratio actually changed.
    if (force || ratioChanged || size.x !== this.width || size.y !== this.height)
      this.renderer.setDrawingBufferSize(this.width, this.height, ratio);
    if (ratioChanged) {
      // Point sprites sized at creation keep their on-screen size at the new ratio.
      for (const fire of this.fires) fire.sparks.material.uniforms.scale.value = ratio;
      if (this.marsh) this.marsh.mist.material.uniforms.pixelScale.value = ratio;
    }
    const data = this.canvas.dataset;
    data.safetyScale = String(this.graphics.scale);
    data.pixelRatio = ratio.toFixed(3);
    data.drawingBuffer = `${this.canvas.width}x${this.canvas.height}`;
    this.camera.aspect = this.width / this.height;
    this.camera.fov = touchFieldOfView(this.camera.aspect, this.touchCamera.enabled);
    this.camera.updateProjectionMatrix();
  }

  showCombatHealth(target) {
    const me = this.predictedMotion ?? this.players.get(this.selfId)?.state;
    return (
      !!me &&
      target?.phase === 'alive' &&
      !target.riderId &&
      target.health > 0 &&
      target.health < target.maxHealth &&
      Math.hypot(target.x - me.x, target.z - me.z) <= 20
    );
  }

  /** One display refresh. The loading cave and the world both draw here, at the
   * fixed frame cap; only active world frames inform the buffer safety scale. */
  tick(now: number) {
    if (this.graphicsContext?.lost) {
      // Nothing can be drawn. Only visible waiting counts toward offering a reload.
      if (this.graphicsContext.frame(now, document.hidden)) {
        this.canvas.dataset.webglContext = 'stalled';
        this.onGraphicsContext('stalled');
      }
      return;
    }
    const dt = this.frameClock.advance(now, document.hidden);
    if (dt === null) {
      if (document.hidden) this.motionLastFrame = null;
      return;
    }
    // The first frame after a hidden tab has no interval: a discontinuity.
    const frameMs = this.motionLastFrame === null ? NaN : now - this.motionLastFrame;
    const active = !!this.selfId && !!this.assetsReady && !this.loadingCave && !this.occluded();
    if (this.graphics.observe(now, frameMs, active)) this.resize();
    if (this.motionLastFrame !== null) this.onFrameTiming?.(frameMs);
    this.motionLastFrame = now;
    this.render(now / 1000, dt);
    // The first normal frame and the local body are now presented. The held
    // distance-priority requests may resume without delaying status/socket/input.
    if (active && this.arrivalLoadRelease && this.selfRenderReady()) this.releaseArrivalLoads();
  }

  render(time, dt) {
    if (this.loadingCave) {
      this.loadingCave.render(dt);
      return;
    }
    this.renderWorld(time, dt);
  }

  private renderWorld(time, dt, preparing = false) {
    const frameStarted = performance.now();
    this.updateActorResidency(time);
    this.updateStreamedTemplates(time);
    // The burst of loads after arrival is loading, not sustained overload:
    // the safety-scale measurement restarts once it has drained.
    if (!this.streamingSettled && this.selfId && this.assetsReady && this.streamingIdle()) {
      this.streamingSettled = true;
      this.graphics.ready(performance.now());
    }
    this.actorBudget.begin(this.camera);
    let predicted = null;
    if (this.prediction.enabled && this.prediction.actor) {
      const p = this.prediction.actor,
        running = this.prediction.input.running;
      let collision = this.collision,
        speed;
      if (p.boatId) {
        collision = this.predictionSeaCollision ??= new SeaCollision(this.collision);
        const weather = this.state.maritime;
        const boat = { ...p, ...this.prediction.input, runningRequested: running };
        speed = weather
          ? seaBoatSpeed(boat, running ? BOATING.fastSpeed : BOATING.speed, weather)
          : running
            ? BOATING.fastSpeed
            : BOATING.speed;
      } else if (p.mountId) {
        collision = mammothNavigation(this.collision);
        const scale = this.state.animals?.find((a) => a.id === p.mountId)?.scale ?? 1;
        speed = (running ? RIDING.runSpeed : RIDING.walkSpeed) * scale;
      }
      predicted = this.prediction.step(
        dt,
        performance.now(),
        this.serverNow(),
        collision,
        this.predictionObstacles,
        speed,
      );
    }
    this.predictedMotion = predicted;
    for (const animal of this.mammoths) {
      const raw = this.state.animals?.find((item) => item.id === animal.id);
      const state =
        raw && predicted?.mountId === raw.id
          ? {
              ...raw,
              ...predicted,
              id: raw.id,
              clip: predicted.moving ? (predicted.running ? 'Run_Loop' : 'Walk_Loop') : 'Idle_Loop',
            }
          : raw;
      animal.seat ??= mammothSeat(animal.actor.root, animal.actor.asset);
      const phase = state?.phase ?? 'alive';
      animal.model.visible = !!state && (phase === 'alive' || phase === 'dying');
      animal.meat.visible = !!state && phase === 'meat';
      if (animal.meat.visible) {
        const shown = meatPieceVisibility(state.meatRemaining, animal.meat.children.length);
        animal.meat.children.forEach((piece, index) => (piece.visible = shown[index]));
      }
      animal.label.active = this.showCombatHealth(state);
      if (!state) continue;
      if (Math.hypot(state.x - this.camera.position.x, state.z - this.camera.position.z) > 90) {
        animal.model.visible = false;
        animal.meat.visible = false;
        animal.label.active = false;
        animal.initialized = false;
        continue;
      }
      updateActorPerformance(
        animal.actor.root,
        animal.model.position.distanceTo(this.camera.position),
      );
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
      const factor = predicted?.mountId === state.id ? 1 : 1 - Math.exp(-dt * 15),
        next = (phase === 'alive' ? mammothNavigation(this.collision) : this.collision).move(
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
      if (animal.health.max !== (state.maxHealth ?? 100))
        animal.health.max = state.maxHealth ?? 100;
      if (animal.health.value !== (state.health ?? 100)) animal.health.value = state.health ?? 100;
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
    if (!this.companion524Renderer?.inHand) this.companion524Renderer?.update(dt);
    if (!this.rimoNekoRenderer?.inHand) this.rimoNekoRenderer?.update(dt);
    this.maeRenderer?.update(dt);
    this.kohakuRenderer?.update(dt);
    for (const friend of this.friendRenderers.values()) friend.update(dt);
    this.maruimoRenderer?.update(dt);
    // Update the carrier's animated shoulder before its passenger, regardless of join order.
    for (const entity of [...this.players.values()].sort(
      (a, b) => Number(!!a.state.carrierId) - Number(!!b.state.carrierId),
    )) {
      const { model } = entity,
        p = entity.state.id === this.selfId && predicted ? predicted : entity.state,
        factor = 1 - Math.exp(-dt * 20);
      entity.torch?.pose.restore();
      if (entity.torch) entity.torch.root.visible = entity.torch.light.visible = false;
      entity.actor?.groundPettingPose.restore();
      entity.actor?.orbBotPose.restore();
      entity.actor?.pettingPose.restore();
      entity.actor?.leanPose?.restore();
      entity.actor?.carrySupportPose?.restore();
      if (p.mountId || p.boatId || p.carrierId || p.downedUntil) {
        entity.actor?.carrySupportPose?.reset();
        entity.actor?.leanPose?.reset();
      }
      // An unloaded actor shows nothing: no label or ground contact without its body.
      model.visible =
        !!entity.actor &&
        (p.id === this.selfId || Math.hypot(p.x - this.focus.x, p.z - this.focus.z) < 95);
      if (!model.visible) {
        model.position.set(p.x, walkHeight(p.x, p.z), p.z);
        model.rotation.y = p.facing;
        entity.label.active = false;
        continue;
      }
      if (entity.actor)
        updateActorPerformance(entity.actor.root, model.position.distanceTo(this.camera.position));
      entity.label.active = true;
      const airborne = jumpProgress(p, this.serverNow());
      if (airborne === null) entity.actor?.jumpPose.leave(entity.actor.animation);
      if (!p.downedUntil) entity.actor?.animation.leaveDowned();
      if (entity.spears) {
        for (const spear of entity.spears.values()) spear.visible = false;
        entity.weapon = entity.spears.get(attackProfile(p).modelKey);
      }
      if (p.carrierId) {
        const carrier = this.players.get(p.carrierId);
        model.visible = !!carrier?.model.visible && !!carrier.actor?.shoulderSeat && !!entity.actor;
        entity.label.active = model.visible;
        if (!model.visible) continue;
        const pose = entity.actor.ridingPose;
        const profile = attackProfile(p);
        const castAge = this.serverNow() - (p.attackAt ?? 0);
        const casting =
          profile.key === 'magic' &&
          p.attackSequence > 0 &&
          castAge >= 0 &&
          castAge < profile.durationMs;
        model.rotation.y = casting ? p.facing : carrier.model.rotation.y;
        pose.updateShoulder(
          entity.actor.animation,
          time,
          carrier.state.speed || 0,
          casting ? castAge / profile.durationMs : null,
        );
        carrier.model.updateMatrixWorld(true);
        carrier.actor.shoulderSeat.position(tempPoint);
        const offset = pose
          .pelvisOffset((this.riderOffset ??= new THREE.Vector3()))
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, model.rotation.y);
        model.position.copy(tempPoint).sub(offset);
        if (entity.weapon) entity.weapon.visible = false;
        if (entity.axe) entity.axe.visible = false;
        if (entity.flask) entity.flask.visible = false;
        entity.wasMounted = true;
        entity.label.position.copy(model.position);
        entity.label.position.y += entity.actor.asset.heightMetres + 0.3;
        continue;
      }
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
        if (entity.flask) entity.flask.visible = false;
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
        if (entity.flask) entity.flask.visible = false;
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
        (p.x - model.position.x) * (p === predicted || remaining < 0.012 ? 1 : factor),
        (p.z - model.position.z) * (p === predicted || remaining < 0.012 ? 1 : factor),
        p.radius ?? WORLD.playerRadius,
        this.villageRenderer?.obstacles() ?? [],
      );
      model.position.set(
        next.x,
        walkHeight(next.x, next.z) + jumpHeight(p, this.serverNow()),
        next.z,
      );
      if (p.moving) entity.running = p.running;
      // Position reconciliation can move a model backwards by a few centimetres.
      // It is not a turn or a step: use the collision-checked simulation motion.
      const motionSpeed = p.moving ? p.speed : 0;
      const petDot = pettingOrbBot(this.state.orbBots, p.id);
      const petMae = this.state.mae?.petPlayerId === p.id ? this.state.mae : undefined;
      const petKohaku = this.state.kohaku?.petPlayerId === p.id ? this.state.kohaku : undefined;
      const petMaruimo = this.state.maruimo?.petPlayerId === p.id ? this.state.maruimo : undefined;
      const petFriend = pettingFriend(this.state.friends, p.id);
      const groundCompanion =
        petDot ?? petFriend ?? petMaruimo ?? petKohaku ?? petMae ?? this.state.rimoNeko;
      const groundPetting = petDot
        ? pettingProgress(petDot, p, this.serverNow(), {
            ...ORB_BOTS,
            petApproachMs: petDot.petGroupLeaderId
              ? ORB_BOTS.petGroupApproachMs
              : ORB_BOTS.petApproachMs,
          })
        : petFriend
          ? pettingProgress(petFriend, p, this.serverNow(), FRIEND_TIMING)
          : petMaruimo
            ? pettingProgress(petMaruimo, p, this.serverNow(), MARUIMO)
            : petKohaku
              ? pettingProgress(petKohaku, p, this.serverNow(), KOHAKU)
              : petMae
                ? pettingProgress(petMae, p, this.serverNow(), MAE)
                : groundPettingProgress(this.state.rimoNeko, p, this.serverNow());
      if (entity.actor) {
        if (p.downedUntil || airborne !== null || p.mountId || p.boatId || p.carrierId) {
          entity.actor.groundPettingPose.weight = 0;
          groundPetting.weight = 0;
        } else {
          groundPetting.weight = entity.actor.groundPettingPose.blendWeight(
            groundPetting.weight,
            dt,
          );
        }
      }
      const petting524 = pettingProgress(this.state.companion524, p, this.serverNow());
      const petting = groundPetting.weight > 0 ? groundPetting : petting524;
      const petCompanion = groundPetting.weight > 0 ? groundCompanion : this.state.companion524;
      const facing =
        petting.weight > 0 && petCompanion?.petPlayerId === p.id
          ? (petCompanion.petFacing ?? p.facing)
          : p.facing;
      const diff = Math.atan2(
        Math.sin(facing - model.rotation.y),
        Math.cos(facing - model.rotation.y),
      );
      model.rotation.y += diff * (1 - Math.exp(-dt * 24));
      if (entity.actor) {
        if (caveInteriorWeight(p) > 0 && entity.actor.animation.name === 'Attack')
          entity.actor.animation.change('Idle_Loop', 0.05);
        if (
          (p.cookingEndsAt > this.serverNow() || p.fishing || p.coastalActivity) &&
          !p.moving &&
          !entity.actor.animation.oneShot
        )
          entity.actor.animation.play(p.coastalActivity?.kind === 'shells' ? 'Gather' : 'Craft');
        if (p.downedUntil) {
          entity.actor.jumpPose.leave(entity.actor.animation);
          entity.actor.animation.updateDowned(
            dt,
            p.hurtAt > 0 ? Math.max(0, (this.serverNow() - p.hurtAt) / 1000) : Infinity,
          );
        } else if (airborne !== null)
          entity.actor.jumpPose.update(entity.actor.animation, airborne);
        else entity.actor.animation.update(dt, motionSpeed, entity.running);
        entity.actor.carrySupportPose?.update(dt, !!p.passengerId);
        entity.actor.leanPose?.update(
          dt,
          airborne === null && !p.downedUntil ? motionSpeed : null,
          entity.running,
        );
        if (groundPetting.weight > 0) {
          if (petDot) {
            if (this.orbBotRenderer) this.orbBotRenderer.petTarget(petDot, tempPoint);
            else tempPoint.set(petDot.x, petDot.y + ORB_BOTS.diameter * 0.9, petDot.z);
          } else if (petFriend && this.friendRenderers.has(petFriend.key))
            this.friendRenderers.get(petFriend.key)!.petTarget(tempPoint);
          else if (petKohaku && this.kohakuRenderer) this.kohakuRenderer.petTarget(tempPoint);
          else if (petMaruimo && this.maruimoRenderer) this.maruimoRenderer.petTarget(tempPoint);
          else if (petMae && this.maeRenderer) this.maeRenderer.petTarget(tempPoint);
          else if (this.state.rimoNeko?.petPlayerId === p.id && this.rimoNekoRenderer)
            this.rimoNekoRenderer.petTarget(tempPoint);
          else tempPoint.copy(entity.actor.groundPettingPose.requested);
          const pose = entity.actor.groundPettingPose;
          if (pose instanceof GroundPettingPose)
            pose.update(
              tempPoint,
              groundPetting.weight,
              groundPetting.stroke,
              !!petDot || !!petMae || !!petKohaku || !!petMaruimo || !!petFriend,
            );
          else pose.update(tempPoint, groundPetting.weight, groundPetting.stroke);
        } else if (petting524.weight > 0 && this.companion524Renderer) {
          tempPoint.copy(this.companion524Renderer.root.position);
          const petNear = p.species === 'bear' ? 0.13 : 0.08;
          tempPoint.x -= Math.sin(facing) * petNear;
          tempPoint.z -= Math.cos(facing) * petNear;
          tempPoint.y += p.species === 'bear' ? 0.07 : 0.11;
          entity.actor.pettingPose.update(tempPoint, petting.weight, petting.stroke);
        }
        const bot = posingOrbBot(this.state.orbBots, p.id, this.serverNow());
        entity.actor.orbBotPose.update(
          petting.weight > 0 ? undefined : bot,
          p,
          this.serverNow(),
          model,
        );
        entity.torch?.update(
          caveTorchAvailable(p),
          time,
          dt,
          this.renderer.getPixelRatio(),
          caveTorchLit(p),
        );
        if (entity.axe) {
          const attack = entity.actor.animation.name === 'Attack';
          const profile = attackProfile(p);
          entity.axe.visible =
            caveInteriorWeight(p) === 0 &&
            entity.actor.orbBotPose.weight === 0 &&
            petting.weight === 0 &&
            !p.fishing &&
            !p.coastalActivity &&
            equippedItem(p) === 'axe' &&
            (!entity.actor.animation.oneShot || entity.actor.animation.name === 'Gather');
          if (entity.weapon) {
            entity.weapon.visible =
              caveInteriorWeight(p) === 0 &&
              entity.actor.orbBotPose.weight === 0 &&
              petting.weight === 0 &&
              !p.fishing &&
              !p.coastalActivity &&
              equippedItem(p) !== 'axe' &&
              (attack || !entity.actor.animation.oneShot);
            if (profile.key === 'katana')
              orientKatana(
                entity.weapon,
                entity.model,
                attack,
                entity.actor.animation.current?.time ?? 0,
                entity.actor.gripUp,
              );
            else
              orientSpear(
                entity.weapon,
                entity.model,
                attack,
                entity.actor.gripUp,
                entity.actor.asset.spearThrust?.attachment === 'authored-grip',
                entity.actor.animation.current?.time ?? 0,
              );
          }
        }
        if (entity.flask) {
          entity.flask.visible = flaskVisible(
            p,
            entity.actor.animation.name,
            !!entity.actor.animation.oneShot,
            !!entity.axe?.visible || entity.actor.orbBotPose.weight > 0 || petting.weight > 0,
          );
          if (entity.flask.visible) orientFlask(entity.flask, entity.model);
        }
      }
      entity.label.position.set(
        model.position.x,
        model.position.y + (entity.actor ? entity.actor.asset.heightMetres + 0.45 : 2.7),
        model.position.z,
      );
    }
    if (this.companion524Renderer?.inHand) this.companion524Renderer.update(dt);
    if (this.rimoNekoRenderer?.inHand) this.rimoNekoRenderer.update(dt);
    this.orbBotRenderer?.update(dt);
    const self = this.players.get(this.selfId);
    const viewing = this.companionView;
    let viewed = viewing && this.companionViewTargets().find((t) => t.id === viewing.id);
    if (
      viewing &&
      (!self ||
        !viewed ||
        self.state.downedUntil ||
        self.state.boatId ||
        self.state.mountId ||
        self.state.carrierId ||
        (self.state.warpSequence ?? 0) !== viewing.warp ||
        (self.state.hurtSequence ?? 0) !== viewing.hurt ||
        characterModel(self.state).key !== viewing.character ||
        Math.hypot(self.state.x - viewing.playerX, self.state.z - viewing.playerZ) > 0.8 ||
        Math.hypot(viewed.point.x - self.state.x, viewed.point.z - self.state.z) > 12)
    ) {
      this.endCompanionView();
      viewed = null;
    }
    if (self) {
      if (viewed) {
        tempPoint.copy(viewed.point);
        self.model.visible = false;
        const limits = companionViewDistances(viewed.radius, this.camera.fov, this.camera.aspect);
        this.targetDistance = clamp(this.targetDistance, limits.near, limits.far);
      } else {
        tempPoint.copy(self.model.position);
        if (
          this.automaticHeading !== null &&
          !self.state.mountId &&
          !self.state.boatId &&
          !self.state.carrierId
        )
          tempPoint.y = walkHeight(tempPoint.x, tempPoint.z);
        tempPoint.y += focusHeight(self.state);
      }
      const focusY = this.focus.y;
      this.focus.lerp(tempPoint, 1 - Math.exp(-dt * 11));
      if (this.automaticHeading !== null && !viewed)
        this.focus.y = focusY + (tempPoint.y - focusY) * (1 - Math.exp(-dt * 4));
    }
    if (this.automaticHeading !== null && this.automaticCameraActive && !viewed) {
      const delta = wrapHeading(this.automaticHeading + Math.PI - this.yaw);
      this.yaw = wrapHeading(
        this.yaw + (Math.abs(delta) < 0.001 ? delta : delta * (1 - Math.exp(-dt * 3.2))),
      );
      this.pitch += (0.32 - this.pitch) * (1 - Math.exp(-dt * 2.5));
    }
    if (this.automaticHeading === null && !viewed) {
      this.yaw = this.touchCamera.step(this.yaw, performance.now(), dt, !!this.pointer?.dragged);
    }
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-dt * 10));
    const aim = this.focus.clone();
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    let cameraDistance = this.distance;
    cameraDistance = this.collision.cameraDistance(aim, offset, this.distance);
    this.camera.position.copy(aim).addScaledVector(offset, cameraDistance);
    if (this.landmarks?.castleCamera) {
      cameraDistance = this.landmarks.castleCamera.distance(aim, offset, cameraDistance);
      this.camera.position.copy(aim).addScaledVector(offset, cameraDistance);
    }
    if (this.landmarks?.caveCamera) {
      cameraDistance = this.landmarks.caveCamera.distance(aim, offset, cameraDistance);
      this.camera.position.copy(aim).addScaledVector(offset, cameraDistance);
    }
    if ((this.automaticHeading !== null || this.touchCamera.enabled) && !viewed) {
      // Obstructions pull in immediately; clearance releases the distance slowly.
      this.automaticDistance =
        this.automaticDistance === null || cameraDistance < this.automaticDistance
          ? cameraDistance
          : this.automaticDistance +
            (cameraDistance - this.automaticDistance) * (1 - Math.exp(-dt * 2.4));
      cameraDistance = this.automaticDistance;
      this.camera.position.copy(aim).addScaledVector(offset, cameraDistance);
    } else this.automaticDistance = null;
    const aboveWater =
      !isLand(this.camera.position.x, this.camera.position.z) ||
      (riverHalfWidth(this.camera.position.z) > 0.7 &&
        Math.abs(this.camera.position.x - riverX(this.camera.position.z)) <
          riverHalfWidth(this.camera.position.z));
    const mountainWater = mountainWaterHeight(this.camera.position.x, this.camera.position.z);
    this.camera.position.y = Math.max(
      this.camera.position.y,
      cameraFloorHeight(this.camera.position.x, this.camera.position.z) + 0.25,
      aboveWater ? WATER_LEVEL + 0.3 : -Infinity,
      mountainWater + 0.3,
    );
    this.camera.lookAt(aim);
    this.camera.updateMatrixWorld();
    for (const marker of this.assistMarkers.values()) {
      const screen = this.assistScreenPoint(marker.point);
      marker.element.hidden = !screen || this.occluded() || !!viewed;
      if (screen) {
        marker.element.style.left = `${(screen.x + 1) * 50}%`;
        marker.element.style.top = `${(1 - screen.y) * 50}%`;
      }
    }
    this.sun.position.set(this.focus.x - 32, this.focus.y + 48, this.focus.z - 25);
    this.sun.target.position.set(this.focus.x, this.focus.y, this.focus.z);
    this.openWorld?.update(this.camera, time);
    this.landmarks?.update(this.camera, time);
    this.regionalScenery?.update(this.camera, time);
    this.atmosphere.update(this.focus, time, dt);
    this.adventureEffects?.update(time);
    this.gulfRenderer?.update(time);
    this.coastalRenderer?.update(time);
    this.villageRenderer?.update(dt, time);
    if (time >= this.nextStaticCull) {
      this.nextStaticCull = time + 0.2;
      for (const { root, radius } of this.staticScenery) {
        root.visible =
          Math.hypot(
            root.position.x - this.camera.position.x,
            root.position.z - this.camera.position.z,
          ) <
          (this.scene.fog as THREE.Fog).far + radius;
      }
    }
    for (const item of this.resources.values()) {
      item.model.visible =
        item.resource.amount > 0 &&
        item.model.position.distanceTo(this.camera.position) <
          (this.scene.fog as THREE.Fog).far + 5;
    }
    if (this.waterMaterial) this.waterMaterial.userData.time.value = time;
    if (this.npc) {
      this.npc.visible = this.npc.position.distanceTo(this.camera.position) < 75;
      if (this.npc.visible) {
        if (this.npcActor)
          updateActorPerformance(
            this.npcActor.root,
            this.npc.position.distanceTo(this.camera.position),
          );
        this.npcActor?.animation.update(dt, 0);
      }
    }
    for (const landscape of this.landscapes)
      landscape.update(this.camera, time, self ? this.focus : null, GROUNDCOVER_DENSITY);
    for (const fire of this.fires) {
      const visible =
        fire.root.position.distanceTo(this.camera.position) < 65 &&
        (!fire.cave || this.state.camp.caveFireLit);
      fire.light.visible = visible;
      fire.sparks.visible = visible;
      if (!visible) continue;
      fire.light.intensity =
        (fire.cave ? 8 : 4.1) + Math.sin(time * 9 + fire.seed) * (fire.cave ? 0.55 : 0.5);
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
        model.position.set(
          state.x,
          walkHeight(state.x, state.z) + (state.airborneHeight ?? 0),
          state.z,
        );
        model.rotation.y = state.facing;
        enemy.initialized = true;
      }
      const visible =
        state.phase !== 'respawning' && model.position.distanceTo(this.camera.position) < 75;
      model.visible = visible;
      enemy.label.active = visible && this.showCombatHealth(state);
      if (!visible) {
        model.position.set(
          state.x,
          walkHeight(state.x, state.z) + (state.airborneHeight ?? 0),
          state.z,
        );
        continue;
      }
      updateActorPerformance(actor.root, model.position.distanceTo(this.camera.position));
      const factor = 1 - Math.exp(-dt * 20),
        next = this.collision.move(
          model.position,
          (state.x - model.position.x) * factor,
          (state.z - model.position.z) * factor,
          state.radius,
        );
      const airborne = state.airborneHeight ?? 0,
        flightBob = airborne > 0 ? Math.sin(this.serverNow() * 0.003 + state.id.length) * 0.08 : 0;
      model.position.set(next.x, walkHeight(next.x, next.z) + airborne + flightBob, next.z);
      const diff = Math.atan2(
        Math.sin(state.facing - model.rotation.y),
        Math.cos(state.facing - model.rotation.y),
      );
      model.rotation.y += diff * (1 - Math.exp(-dt * 24));
      model.rotation.z =
        airborne > 0 ? Math.sin(this.serverNow() * 0.0024 + state.id.length * 0.7) * 0.055 : 0;
      enemy.label.position.set(
        model.position.x,
        model.position.y + (actor.asset.heightMetres ?? 1.85) * (state.scale ?? 1) + 0.3,
        model.position.z,
      );
      if (enemy.health.max !== state.maxHealth) enemy.health.max = state.maxHealth;
      if (enemy.health.value !== state.health) enemy.health.value = state.health;
      // A castle rank praying behind the seal is enclosed in a translucent red
      // veil: a capsule from the floor to above the head, plus a faint floor ring.
      if (state.sealed) {
        const sealRadius = state.radius * (state.scale ?? 1) + 0.45,
          sealHeight = (actor.asset.heightMetres ?? 1.85) * (state.scale ?? 1) + 0.4;
        if (!enemy.seal) {
          enemy.seal = createPrayerSeal(sealRadius, sealHeight);
          enemy.seal.traverse((node) => {
            if (isMesh(node)) this.crowGeometry.add(node.geometry);
          });
          enemy.sealSize = `${sealRadius}:${sealHeight}`;
          this.scene.add(enemy.seal);
        } else if (enemy.sealSize !== `${sealRadius}:${sealHeight}`) {
          resizePrayerSeal(enemy.seal, sealRadius, sealHeight);
          enemy.sealSize = `${sealRadius}:${sealHeight}`;
        }
        enemy.seal.visible = true;
        enemy.seal.position.set(model.position.x, model.position.y, model.position.z);
        pulsePrayerSeal(enemy.seal, time + state.id.length);
      } else if (enemy.seal) enemy.seal.visible = false;
      enemy.health.classList.toggle('sealed', state.sealed === true);
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
    this.spells.update(
      this.state,
      this.players,
      this.serverNow(),
      dt,
      this.height * this.renderer.getPixelRatio(),
    );
    this.updateLabels();
    this.contactShadows.update();
    this.natureEffects.update(this, time);
    this.audio.update(this, time);
    const simulationEnded = performance.now();
    if (!preparing && !this.occluded()) this.renderer.render(this.scene, this.camera);
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
      data.animationSamples = String(this.actorBudget.samples);
      data.animationSkipped = String(this.actorBudget.skipped);
      data.actorResidency = JSON.stringify(this.residencyDiagnostics());
      data.assetQueue = JSON.stringify(this.worldAssets.loadQueue.diagnostics());
      data.worldStreaming = JSON.stringify({
        idle: this.streamingIdle(),
        settled: this.streamingSettled,
        terrain: [...(this.openWorld?.pending.keys() ?? [])],
        landmarks: [...(this.landmarks?.pending.keys() ?? [])],
        actors: [...this.streamDemand.keys()],
      });
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
      data.companion524 = JSON.stringify(this.companion524Renderer?.diagnostics() ?? null);
      data.rimoNeko = JSON.stringify(this.rimoNekoRenderer?.diagnostics() ?? null);
      data.kohaku = JSON.stringify(this.kohakuRenderer?.diagnostics() ?? null);
      data.friends = JSON.stringify(
        [...this.friendRenderers.values()].map((friend) => friend.diagnostics()),
      );
      data.maruimo = JSON.stringify(this.maruimoRenderer?.diagnostics() ?? null);
      data.mae = JSON.stringify(this.maeRenderer?.diagnostics() ?? null);
      data.orbBots = JSON.stringify(this.orbBotRenderer?.diagnostics() ?? []);
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
            y: Number(entity.model.position.y.toFixed(3)),
            jumpHeight: Number(jumpHeight(entity.state, this.serverNow()).toFixed(3)),
            jumpSequence: entity.state.jumpSequence ?? 0,
            animation: entity.actor.animation.name,
          })),
      );
      data.actorSpecies = [...this.players.values()]
        .filter((entity) => entity.actor)
        .map((entity) => entity.state.species)
        .sort()
        .join(',');
      data.cameraYaw = this.yaw.toFixed(3);
      data.touchCamera = String(this.touchCamera.enabled);
      data.cameraFov = this.camera.fov.toFixed(2);
      data.cameraPitch = this.pitch.toFixed(3);
      data.cameraDistance = cameraDistance.toFixed(2);
      data.cameraFocus = [this.focus.x, this.focus.y, this.focus.z]
        .map((n) => n.toFixed(3))
        .join(',');
      data.drawCalls = String(info.render.calls);
      data.renderTriangles = String(info.render.triangles);
      data.activeFireLights = String(this.fires.filter((fire) => fire.light.visible).length);
      data.staticSceneryVisible = String(
        this.staticScenery.filter((item) => item.root.visible).length,
      );
      data.vegetationExamined = String(
        this.landscapes.reduce((sum, item) => sum + (item.examined ?? 0), 0),
      );
      data.vegetationUpdates = String(this.landscapes.reduce((sum, item) => sum + item.updates, 0));
      data.vegetationUploadBytes = String(
        this.landscapes.reduce((sum, item) => sum + item.matrixUploadBytes, 0),
      );
      data.geometries = String(info.memory.geometries);
      data.textures = String(info.memory.textures);
      data.glbPlayers = String([...this.players.values()].filter((entity) => entity.actor).length);
      data.actorLowLods = String(
        [
          ...[...this.players.values()].map((entity) => entity.actor),
          this.npcActor,
          ...this.mammoths.map((animal) => animal.actor),
          ...[...this.enemies.values()].map((enemy) => enemy.actor),
        ].filter((actor) => actor?.root.userData.actorDetail?.level === 1).length,
      );
      data.projectileCount = String(this.state.projectiles?.length ?? 0);
      data.spellParticles = String(this.spells.count);
      data.attackStyle = self ? attackProfile(self.state).key : '';
      data.weaponModel = self?.weapon?.userData.assetKey ?? '';
      if (self) {
        data.caveTorchHeld = String(!!self.torch?.root.visible);
        data.caveTorchLit = String(!!self.torch?.light.visible);
        data.weaponVisible = String(!!self.weapon?.visible);
        data.toolVisible = String(!!self.axe?.visible);
        data.playerModel = self.actor?.asset.modelKey || 'loading';
        data.playerGender = self.state.gender;
        data.playerY = self.model.position.y.toFixed(3);
        data.playerJumpHeight = jumpHeight(self.state, this.serverNow()).toFixed(3);
        data.playerJumpSequence = String(self.state.jumpSequence ?? 0);
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
      if (this.companionView && label.kind === 'companion') visible = false;
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
      if (label.element.hidden !== !visible) label.element.hidden = !visible;
    }
  }

  destroy() {
    // First: providers below dispose the materials whose programs name them.
    this.releaseEngineResources();
    this.audio.dispose();
    this.natureEffects.dispose();
    this.boatRenderer?.dispose();
    this.disposed = true;
    // Queued streamed templates nobody else wants are cancelled.
    this.streamDemand?.clear();
    this.gulfRenderer?.dispose();
    this.coastalRenderer?.dispose();
    this.villageRenderer?.dispose();
    this.companion524Renderer?.dispose();
    this.rimoNekoRenderer?.dispose();
    this.maeRenderer?.dispose();
    this.kohakuRenderer?.dispose();
    for (const friend of this.friendRenderers.values()) friend.dispose();
    this.friendRenderers.clear();
    this.maruimoRenderer?.dispose();
    this.orbBotRenderer?.dispose();
    this.contactShadows.dispose();
    this.regionalScenery?.dispose();
    this.startupFit?.dispose();
    this.startupTerrain?.dispose();
    this.landmarks?.dispose();
    this.openWorld?.dispose();
    this.releaseTerrainSampler?.();
    this.releaseBridgeSampler?.();
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.labelLayer.remove();
    this.loadingLabel?.remove();
    for (const entity of this.players.values()) {
      entity.torch?.dispose();
      if (entity.actor) this.scene.remove(entity.model);
    }
    for (const landscape of this.landscapes) landscape.dispose();
    for (const provider of this.humanAssets.values()) provider.dispose();
    this.worldAssets.dispose();
    this.releaseArrivalLoads();
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
      ['webglcontextrestored', this.contextRestored],
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
