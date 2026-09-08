import { isTexture } from './three-types.js';
import * as THREE from 'three';
import { WorldAssets } from './world-assets.js';

const canvas = document.querySelector<HTMLSelectElement>('canvas'),
  stage = document.querySelector<HTMLSelectElement>('#stage'),
  panels = document.querySelector<HTMLSelectElement>('#panels');
const modelInput = document.querySelector<HTMLSelectElement>('#model'),
  viewInput = document.querySelector<HTMLSelectElement>('#view'),
  status = document.querySelector<HTMLSelectElement>('#status');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor('#50575e');
const assets = await new WorldAssets().load(),
  entries = [];
const views = {
  threequarter: [1, 0.45, 1.5],
  front: [0, 0.12, 1],
  rear: [0, 0.12, -1],
  left: [1, 0.12, 0],
  right: [-1, 0.12, 0],
  top: [0, 1, 0.001],
  bottom: [0, -1, 0.001],
};
let currentKey = null;
const collect = (root) => {
  const geometry = new Set(),
    texture = new Set();
  root.traverse((n) => {
    if (n.geometry) geometry.add(n.geometry);
    for (const m of [n.material].flat().filter(Boolean))
      for (const v of Object.values(m)) if (isTexture(v)) texture.add(v);
  });
  return { geometry, texture };
};
function populate() {
  if (currentKey)
    for (const surface of ['snow', 'ice', 'ash', 'sand'])
      assets.releaseSurface(currentKey, surface);
  currentKey = modelInput.value;
  entries.length = 0;
  panels.replaceChildren();
  for (const [surface, label] of [
    [null, '元の基本モデル'],
    ['snow', '雪'],
    ['ice', '氷・霜'],
    ['ash', '火山灰'],
    ['sand', '砂漠'],
  ]) {
    const scene = new THREE.Scene(),
      root = assets.create(currentKey, 0, surface),
      camera = new THREE.PerspectiveCamera(36, 1, 0.01, 200);
    const sun = new THREE.DirectionalLight('#ffffff', 2.7);
    sun.position.set(-4, 7, 5);
    scene.add(root, sun, new THREE.HemisphereLight('#ffffff', '#8a8a8a', 2));
    scene.background = new THREE.Color('#50575e');
    const element = document.createElement('div');
    element.className = 'panel';
    const title = document.createElement('strong');
    title.textContent = label;
    element.append(title);
    panels.append(element);
    entries.push({ surface, scene, root, camera, element });
  }
  render();
}
function render() {
  const bounds = stage.getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  renderer.setScissorTest(true);
  for (const item of entries) {
    const rect = item.element.getBoundingClientRect(),
      box = new THREE.Box3().setFromObject(item.root),
      centre = box.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(...views[viewInput.value]).normalize(),
      camera = item.camera;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize(),
      up = new THREE.Vector3().crossVectors(direction, right);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
      tanH = tanV * camera.aspect;
    let distance = 0.1;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(centre);
          distance = Math.max(
            distance,
            corner.dot(direction) + (Math.abs(corner.dot(right)) * 1.18) / tanH,
            corner.dot(direction) + (Math.abs(corner.dot(up)) * 1.18) / tanV,
          );
        }
    camera.position.copy(centre).addScaledVector(direction, distance);
    camera.lookAt(centre);
    const x = rect.left - bounds.left,
      y = bounds.bottom - rect.bottom;
    renderer.setViewport(x, y, rect.width, rect.height);
    renderer.setScissor(x, y, rect.width, rect.height);
    renderer.render(item.scene, camera);
  }
  const base = collect(entries[0].root),
    allGeometry = new Set(),
    allTextures = new Set();
  let extras = 0;
  for (const item of entries) {
    const data = collect(item.root);
    for (const g of data.geometry) {
      allGeometry.add(g);
      if (!base.geometry.has(g)) extras++;
    }
    for (const t of data.texture) {
      allTextures.add(t);
      if (!base.texture.has(t)) extras++;
    }
  }
  const report = {
    key: currentKey,
    view: viewInput.value,
    sha256: assets.get(currentKey).asset.sha256,
    variants: entries.length,
    baseGeometries: base.geometry.size,
    allGeometries: allGeometry.size,
    baseTextures: base.texture.size,
    allTextures: allTextures.size,
    extraSourceObjects: extras,
  };
  window.biomeReview = report;
  status.textContent = JSON.stringify(report);
  canvas.dataset.ready = 'true';
  canvas.dataset.extraSourceObjects = String(extras);
}
modelInput.addEventListener('change', populate);
viewInput.addEventListener('change', render);
new ResizeObserver(render).observe(stage);
populate();
