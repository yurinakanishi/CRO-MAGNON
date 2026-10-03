// Appended only by qa-cave-rimo-r30.mjs to the isolated review server.
// The game GLB, material implementation, controls and networking are unchanged.
const r30Render = WorldRenderer.prototype.render;
let r30View = 'east',
  r30World,
  r30Updated = 0;
const r30Panel = document.createElement('section');
r30Panel.style.cssText =
  'position:fixed;left:12px;top:12px;z-index:10000;background:#fffc;padding:10px;border-radius:8px;font:13px system-ui;color:#222;max-width:470px';
r30Panel.innerHTML =
  '<b>壁画r30・保存なしの確認用ゲーム</b><div id="r30-buttons"></div><div id="r30-status">洞窟を読み込み中</div><button id="r30-save">表示画像を保存</button><span id="r30-saved"></span>';
document.body.append(r30Panel);
for (const [view, label] of [
  ['east', 'りもねこ・全体'],
  ['east-close', 'りもねこ・近景'],
  ['west', '反対側の524'],
  ['both', '両側の壁'],
  ['normal', '通常カメラ'],
]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    r30View = view;
  };
  r30Panel.querySelector('#r30-buttons').append(b);
}
const r30LocalWorld = (x, y, z) => new THREE.Vector3(35 - x, 6.95 + y, 125.15 - z);
const r30Centre = (z) => {
  const t = Math.max(0, Math.min(1, -z / 72.64));
  return 38 * t * t * (3 - 2 * t);
};
function r30Camera(w) {
  if (r30View === 'normal') return w.camera;
  const c = w.camera.clone(),
    centre = r30Centre(-21.2);
  c.fov = 55;
  c.aspect = w.camera.aspect;
  let p, t;
  if (r30View === 'east') {
    p = [centre + 1, 2.9, -21.2];
    t = [centre - 5.6, 2.85, -21.2];
  }
  if (r30View === 'east-close') {
    p = [centre - 2, 2.85, -21.2];
    t = [centre - 5.6, 2.85, -21.2];
  }
  if (r30View === 'west') {
    p = [centre + 1, 2.9, -21.2];
    t = [centre + 5.6, 2.65, -21.2];
  }
  if (r30View === 'both') {
    p = [r30Centre(-14.5), 2.7, -14.5];
    t = [centre, 2.7, -24];
    c.fov = 75;
  }
  c.position.copy(r30LocalWorld(...p));
  c.lookAt(r30LocalWorld(...t));
  c.updateProjectionMatrix();
  return c;
}
function r30State(w) {
  return {
    view: r30View,
    fire: !!w.state?.camp?.caveFireLit,
    players: w.state?.players?.length ?? 0,
    viewport: [w.canvas.width, w.canvas.height],
    camera: r30Camera(w).position.toArray(),
    rimoTexture: w.landmarks?.caveRimoPigment?.image?.src ?? null,
    rimoLoaded: !!w.landmarks?.caveRimoPigment?.image?.complete,
    caveVisible: w.landmarks?.instances?.has('camp-cave') ?? false,
  };
}
WorldRenderer.prototype.render = function (...args) {
  const result = r30Render.apply(this, args);
  r30World = this;
  if (r30View !== 'normal') this.renderer.render(this.scene, r30Camera(this));
  if (performance.now() - r30Updated > 500) {
    r30Updated = performance.now();
    r30Panel.querySelector('#r30-status').textContent = JSON.stringify(r30State(this));
  }
  return result;
};
r30Panel.querySelector('#r30-save').onclick = async () => {
  const w = r30World;
  if (!w) return;
  w.renderer.render(w.scene, r30Camera(w));
  const reply = await fetch('/qa-r30/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...r30State(w), image: w.canvas.toDataURL('image/png') }),
  });
  r30Panel.querySelector('#r30-saved').textContent = reply.ok ? '保存済み' : '保存失敗';
};
