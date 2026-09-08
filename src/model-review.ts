import { isTexture, isMesh, isSkinnedMesh } from './three-types.js';
import { CHARACTER_MODELS } from '../shared/characters.mjs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { handGripPlacement } from './character-assets.js';
import { loadVerifiedGLB } from './world-assets.js';
import { sha256 } from './asset-hash.js';
import { HUMAN_CLIPS } from './character-animation.js';
import { ENEMY_CLIPS } from './enemy-state.js';
import { orientSpear } from './spear-pose.js';
import { orientKatana } from './katana-pose.js';

const requiredClips = HUMAN_CLIPS;
const ui = Object.fromEntries(
  [
    'review-canvas',
    'viewport',
    'status',
    'performance',
    'model-file',
    'clip',
    'play',
    'timeline',
    'count',
    'camera',
    'skeleton',
    'ground',
    'model-info',
    'clip-report',
    'hash',
    'equipment',
    'equipment-info',
  ].map((id) => [id, document.getElementById(id)]),
) as {
  viewport: HTMLElement;
  'review-canvas': HTMLCanvasElement;
  status: HTMLElement;
  performance: HTMLElement;
  'model-file': HTMLInputElement;
  'asset-model': HTMLSelectElement;
  clip: HTMLSelectElement;
  play: HTMLButtonElement;
  timeline: HTMLInputElement;
  count: HTMLSelectElement;
  equipment: HTMLSelectElement;
  camera: HTMLSelectElement;
  skeleton: HTMLInputElement;
  ground: HTMLInputElement;
  'model-info': HTMLElement;
  'clip-report': HTMLElement;
  hash: HTMLElement;
  'equipment-info': HTMLElement;
};
const renderer = new THREE.WebGLRenderer({ canvas: ui['review-canvas'], antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#41463f');
const camera = new THREE.PerspectiveCamera(45, 1, 0.03, 200);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.minDistance = 0.25;
orbit.maxDistance = 40;
scene.add(new THREE.HemisphereLight('#fff6e8', '#a0ad9a', 2.3));
const sun = new THREE.DirectionalLight('#fff8ef', 2.5);
sun.position.set(-4, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.1, far: 30 });
sun.shadow.normalBias = 0.012;
scene.add(sun, sun.target);
// A metre grid and shadow receiver are diagnostic aids, not production assets.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: '#656960', roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.003;
floor.receiveShadow = true;
const grid = new THREE.GridHelper(30, 30, '#aaa98f', '#787e71');
scene.add(floor, grid);

const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  throw new Error(
    '外部ファイルを参照するモデルです。テクスチャを埋め込んだGLBを使用してください。',
  );
});
const loader = new GLTFLoader(manager);
let model = null,
  actors = [],
  selected = null,
  playing = true,
  height = 1.8,
  framingSpan = 1.8,
  loadId = 0,
  requestId = 0;
const framingOffset = new THREE.Vector3();
let lastTime = performance.now(),
  frameCount = 0,
  sampleStart = lastTime,
  loadDuration = 0;
const equipmentModels = new Map();

function clearActors() {
  for (const actor of actors) {
    actor.mixer.stopAllAction();
    actor.mixer.uncacheRoot(actor.animatedRoot);
    actor.helper.dispose();
    actor.root.traverse((object) => {
      if (isSkinnedMesh(object)) object.skeleton.dispose();
    });
    scene.remove(actor.root, actor.helper);
  }
  actors = [];
}

function disposeModel(gltf) {
  if (!gltf) return;
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    skeletons = new Set<THREE.Skeleton>();
  gltf.scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of [object.material].flat().filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (isTexture(value)) textures.add(value);
    }
  });
  for (const resource of [...geometries, ...materials, ...skeletons]) resource.dispose();
  for (const texture of textures) {
    texture.dispose();
    (texture.source?.data as ImageBitmap | undefined)?.close?.();
  }
}

function setCamera() {
  if (actors.length) {
    const bounds = new THREE.Box3();
    for (const actor of actors) bounds.expandByObject(actor.root);
    const size = bounds.getSize(new THREE.Vector3()),
      centre = bounds.getCenter(new THREE.Vector3()),
      radius = Math.max(2, size.length() * 0.6);
    orbit.maxDistance = Math.max(40, radius * 12);
    camera.far = Math.max(200, radius * 20);
    camera.updateProjectionMatrix();
    sun.target.position.copy(centre);
    sun.position.copy(centre).add(new THREE.Vector3(-2, 3.5, 2.5).multiplyScalar(radius));
    Object.assign(sun.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
      near: 0.1,
      far: radius * 9,
    });
    sun.shadow.camera.updateProjectionMatrix();
    // Keep shadow depth precision proportional to the inspected object. A human-
    // sized bias creates contour-like self-shadow acne on 32-metre terrain tiles.
    sun.shadow.bias = -0.0001;
    sun.shadow.normalBias = Math.max(0.012, radius * 0.001);
    floor.position.y = Math.min(-0.003, bounds.min.y - 0.01);
    grid.position.y = floor.position.y + 0.002;
    floor.scale.setScalar(Math.max(1, Math.max(size.x, size.z) / 40));
  }
  const span = framingSpan * (actors.length === 5 && ui.camera.value !== 'tps' ? 2.2 : 1);
  const views: Record<string, [number, number, number]> = {
    front: [0.9 * span, framingSpan * 0.8, 1.55 * span],
    rear: [0, framingSpan * 0.75, -2 * span],
    left: [2 * span, framingSpan * 0.75, 0],
    right: [-2 * span, framingSpan * 0.75, 0],
    tps: [-height * 0.32, height * 0.93, -height * 1.5],
    top: [0, span * 2.2, 0.001],
  };
  orbit.target.set(
    0,
    height * (ui.camera.value === 'tps' ? 0.83 : 0.5),
    actors.length === 5 && ui.camera.value !== 'tps' ? 1 : 0,
  );
  if (ui.camera.value === 'tps') orbit.target.set(-height * 0.32, height * 0.82, height * 0.45);
  camera.position.set(...views[ui.camera.value]);
  orbit.target.add(framingOffset);
  camera.position.add(framingOffset);
  if (
    actors.length &&
    (actors.length > 1 || !model?.animations.length || actors.some((actor) => actor.gear)) &&
    ui.camera.value !== 'tps'
  ) {
    // Fit every actual bounds corner. Height-only framing can crop long shelters,
    // bridges or ground tiles even when their nominal height fits the viewport.
    const bounds = new THREE.Box3();
    for (const actor of actors) bounds.expandByObject(actor.root);
    const centre = bounds.getCenter(new THREE.Vector3());
    const direction = camera.position.clone().sub(orbit.target).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    let distance = 0.3;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(centre);
          const depth = corner.dot(direction);
          distance = Math.max(
            distance,
            depth + (Math.abs(corner.dot(right)) * 1.12) / tanH,
            depth + (Math.abs(corner.dot(up)) * 1.12) / tanV,
          );
        }
    orbit.target.copy(centre);
    camera.position.copy(centre).addScaledVector(direction, distance + camera.near);
  }
  orbit.update();
}

function setClip() {
  selected = model?.animations.find((clip) => clip.name === ui.clip.value) ?? null;
  playing = true;
  ui.play.textContent = '一時停止';
  ui.play.disabled = ui.timeline.disabled = !selected;
  ui.timeline.value = '0';
  for (const [index, actor] of actors.entries()) {
    if (actor.gear)
      actor.gear.visible =
        !selected ||
        selected.name.endsWith('_Loop') ||
        (selected.name === 'Attack' &&
          ['flint-spear', 'wooden-spear', 'obsidian-spear', 'kunoichi-katana'].includes(
            ui.equipment.value,
          )) ||
        (selected.name === 'Gather' && ui.equipment.value === 'stone-axe');
    actor.mixer.stopAllAction();
    actor.root.traverse((object) => {
      if (isSkinnedMesh(object)) object.skeleton.pose();
    });
    actor.action = null;
    if (selected) {
      actor.action = actor.mixer.clipAction(selected).reset();
      actor.action.setLoop(
        selected.name.endsWith('_Loop') ? THREE.LoopRepeat : THREE.LoopOnce,
        Infinity,
      );
      actor.action.clampWhenFinished = true;
      actor.action.play();
      actor.mixer.update(selected.name.endsWith('_Loop') ? (index * selected.duration) / 7 : 0);
    }
  }
}

function populateActors() {
  clearActors();
  if (!model) return;
  const assetBounds = new THREE.Box3().setFromObject(model.scene),
    assetSize = assetBounds.getSize(new THREE.Vector3());
  const spacing = Math.max(2.5, assetSize.x * 1.08, assetSize.z * 1.08);
  const positions = [
    [0, 0],
    [-spacing, 0],
    [spacing, 0],
    [-spacing * 0.5, spacing],
    [spacing * 0.5, spacing],
  ];
  for (let i = 0; i < Number(ui.count.value); i++) {
    const root = clone(model.scene);
    // The parent offsets copies without correcting the file's origin, scale or axes.
    const placement = new THREE.Group();
    placement.position.set(positions[i][0], 0, positions[i][1]);
    placement.add(root);
    root.traverse((object) => {
      if (isMesh(object)) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
    const { grip, rotation } = handGripPlacement(root);
    const equipment = !ui.equipment.disabled && grip && equipmentModels.get(ui.equipment.value);
    let gear = null;
    if (equipment) {
      gear = equipment.gltf.scene.clone(true);
      gear.quaternion.copy(rotation);
      grip.add(gear);
      gear.traverse((object) => {
        if (isMesh(object)) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
    }
    const helper = new THREE.SkeletonHelper(root);
    helper.visible = ui.skeleton.checked;
    const mixer = new THREE.AnimationMixer(root);
    actors.push({
      root: placement,
      animatedRoot: root,
      helper,
      mixer,
      action: null,
      gear,
      gripUp: rotation,
    });
    scene.add(placement, helper);
  }
  setClip();
  setCamera();
}

async function openBuffer(buffer, name) {
  const ownLoad = ++loadId,
    started = performance.now();
  ui.status.textContent = `${name} を読み込み中…`;
  let loaded;
  try {
    if (buffer.byteLength < 20 || new DataView(buffer).getUint32(0, true) !== 0x46546c67)
      throw new Error('GLB形式のファイルを選んでください。');
    loaded = await loader.parseAsync(buffer, '');
    const digest = await sha256(buffer);
    if (ownLoad !== loadId) {
      disposeModel(loaded);
      return;
    }
    clearActors();
    disposeModel(model);
    model = loaded;
    const bounds = new THREE.Box3().setFromObject(model.scene),
      size = bounds.getSize(new THREE.Vector3());
    height = Math.max(0.2, size.y);
    framingSpan = Math.max(height, size.x * 0.8, size.z * 0.8);
    bounds.getCenter(framingOffset);
    framingOffset.y = bounds.min.y;
    let triangles = 0,
      meshes = 0;
    const bones = new Set();
    model.scene.traverse((object) => {
      if (isMesh(object)) {
        meshes++;
        triangles +=
          (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      }
      if (object.isBone) bones.add(object);
    });
    ui.clip.replaceChildren(
      new Option('静止姿勢', ''),
      ...model.animations.map(
        (clip) => new Option(`${clip.name} · ${clip.duration.toFixed(2)}秒`, clip.name),
      ),
    );
    ui.clip.value = model.animations.some((clip) => clip.name === 'Idle_Loop') ? 'Idle_Loop' : '';
    ui.clip.disabled = ui.count.disabled = false;
    const enemy = model.animations.some((clip) => clip.name === 'Hit');
    ui.equipment.disabled =
      enemy || !model.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.R'));
    ui['equipment-info'].hidden = ui.equipment.disabled && !enemy;
    if (enemy)
      ui['equipment-info'].textContent =
        '杖はこのGLBに含まれ、手の動きに合わせて動きます。外付けの槍は使用しません。';
    else
      ui['equipment-info'].textContent = ui.equipment.value
        ? '選択した装備を手に取り付けています。'
        : '装備を選択すると握り位置を確認できます。';
    const expected = !bones.size
      ? []
      : enemy
        ? ENEMY_CLIPS
        : model.animations.some((clip) => clip.name === 'Graze_Loop')
          ? ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Graze_Loop', 'Death']
          : requiredClips;
    const missing = expected.filter((name) => !model.animations.some((clip) => clip.name === name));
    ui['clip-report'].textContent = missing.length
      ? `必要な動作の不足: ${missing.join('、')}`
      : expected.length
        ? `${expected.length}クリップを検出。動き・接地・貫通・ループの継ぎ目を確認してください。`
        : '静物モデル。形状、材質、裏側、原点と寸法を確認してください。';
    ui['model-info'].textContent =
      `${name} / ${(buffer.byteLength / 1048576).toFixed(2)} MB / ${Math.round(triangles).toLocaleString()} triangles / ${meshes} meshes / ${bones.size} bones / 寸法 ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m / 最下点 Y=${bounds.min.y.toFixed(3)} m`;
    ui.hash.textContent = `SHA-256 ${digest}`;
    populateActors();
    loadDuration = performance.now() - started;
    ui.status.textContent = '候補を表示中 — 形状、リグ、全動作を確認';
  } catch (error) {
    if (loaded && loaded !== model) disposeModel(loaded);
    if (ownLoad === loadId) {
      clearActors();
      disposeModel(model);
      model = null;
      selected = null;
      ui.status.textContent = `読込失敗: ${error.message}`;
      ui.hash.textContent = '';
      ui.play.disabled = true;
      ui.timeline.disabled = true;
    }
    console.error('GLB review load failed', error);
  }
}

ui['model-file'].addEventListener('change', async () => {
  const file = ui['model-file'].files[0];
  if (!file) return;
  assetSelect.value = '';
  const request = ++requestId;
  ++loadId;
  const bytes = await file.arrayBuffer();
  if (request === requestId) await openBuffer(bytes, file.name);
});
ui.clip.addEventListener('change', setClip);
ui.count.addEventListener('change', populateActors);
ui.equipment.addEventListener('change', async () => {
  const key = ui.equipment.value;
  try {
    if (key && !equipmentModels.has(key)) {
      const response = await fetch(`/models/${key}/asset.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const asset = await response.json(),
        gltf = await loadVerifiedGLB(asset);
      if (equipmentModels.has(key)) disposeModel(gltf);
      else equipmentModels.set(key, { asset, gltf });
    }
    if (key !== ui.equipment.value) return;
    ui['equipment-info'].textContent = key
      ? `装備 SHA-256 ${equipmentModels.get(key).asset.sha256} · ゲームと同じ握り位置・攻撃中の向き。`
      : '';
    populateActors();
  } catch (error) {
    ui['equipment-info'].textContent = `装備の読込失敗: ${error.message}`;
  }
});
ui.camera.addEventListener('change', setCamera);
ui.skeleton.addEventListener('change', () =>
  actors.forEach((actor) => {
    actor.helper.visible = ui.skeleton.checked;
  }),
);
ui.ground.addEventListener('change', () => {
  floor.visible = grid.visible = ui.ground.checked;
});
ui.play.addEventListener('click', () => {
  if (selected && actors[0]?.action?.time >= selected.duration) setClip();
  else playing = !playing;
  ui.play.textContent = playing ? '一時停止' : '再生';
});
ui.timeline.addEventListener('input', () => {
  if (!selected) return;
  playing = false;
  ui.play.textContent = '再生';
  for (const actor of actors) {
    actor.action.paused = true;
    actor.action.time = Number(ui.timeline.value) * selected.duration;
    actor.mixer.update(0);
  }
});
const resize = new ResizeObserver(() => {
  renderer.setSize(ui.viewport.clientWidth, ui.viewport.clientHeight, false);
  camera.aspect = ui.viewport.clientWidth / ui.viewport.clientHeight;
  camera.updateProjectionMatrix();
});
resize.observe(ui.viewport);
setCamera();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  for (const actor of actors) {
    if (actor.action) actor.action.paused = !playing;
    if (playing) actor.mixer.update(dt);
    if (actor.gear) {
      if (ui.equipment.value === 'kunoichi-katana')
        orientKatana(
          actor.gear,
          actor.root,
          selected?.name === 'Attack',
          actor.action?.time ?? 0,
          actor.gripUp,
        );
      else
        orientSpear(
          actor.gear,
          actor.root,
          selected?.name === 'Attack' &&
            ['flint-spear', 'wooden-spear', 'obsidian-spear'].includes(ui.equipment.value),
          actor.gripUp,
        );
    }
  }
  if (selected && playing && actors[0]?.action)
    ui.timeline.value = String(actors[0].action.time / selected.duration);
  orbit.update();
  renderer.render(scene, camera);
  frameCount++;
  if (now - sampleStart >= 1000) {
    ui.performance.textContent = `${((frameCount * 1000) / (now - sampleStart)).toFixed(0)} FPS · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles\n${actors.length}体 · 読込 ${loadDuration.toFixed(0)} ms · ${renderer.info.memory.geometries} geometries · ${renderer.info.memory.textures} textures`;
    frameCount = 0;
    sampleStart = now;
  }
});

async function openServedModel(modelPath) {
  const request = ++requestId;
  ++loadId;
  const url = new URL(modelPath, location.href);
  if (
    url.origin !== location.origin ||
    !url.pathname.startsWith('/models/') ||
    !url.pathname.endsWith('.glb')
  ) {
    ui.status.textContent = 'このサーバーの /models/ 内のGLBを指定してください。';
  } else {
    ui.status.textContent = '選択したモデルを読み込み中…';
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (request === requestId)
        await openBuffer(bytes, decodeURIComponent(url.pathname.split('/').pop()));
    } catch (error) {
      if (request === requestId) ui.status.textContent = `読込失敗: ${error.message}`;
    }
  }
}
const assetSelect = document.querySelector<HTMLSelectElement>('#asset-model');
assetSelect.addEventListener('change', () => {
  if (assetSelect.value) openServedModel(assetSelect.value);
});
async function populateAssetMenu() {
  const sources = [
    ...CHARACTER_MODELS.map((model) => `/models/${model.key}/asset.json`),
    '/models/world-assets.json',
  ];
  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) continue;
      const record = await response.json();
      for (const asset of record.assets ?? [record]) {
        assetSelect.add(
          new Option(
            CHARACTER_MODELS.find((model) => model.key === asset.modelKey)?.name ??
              asset.name ??
              asset.modelKey,
            asset.url,
          ),
        );
        for (const [index, lod] of (asset.lods ?? []).entries())
          assetSelect.add(
            new Option(`${asset.name ?? asset.modelKey} · LOD ${index + 1}`, lod.url),
          );
      }
    } catch {
      /* Local file review remains available if the delivery catalog is absent. */
    }
  }
  const selectedPath = new URLSearchParams(location.search).get('model');
  if (selectedPath) assetSelect.value = selectedPath;
}
populateAssetMenu();
const modelPath = new URLSearchParams(location.search).get('model');
if (modelPath) await openServedModel(modelPath);
