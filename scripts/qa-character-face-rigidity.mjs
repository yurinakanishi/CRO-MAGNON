// The game's CharacterAssets and CharacterAnimation in real Chrome, comparing exact
// source GLBs and repaired candidates. No saved game or normal dev server is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CHIBI_FACE_KEYS } from './face-remake/stabilize-chibi-heads.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const stage = process.argv[2] ?? 'assets/face-rigidity/20261015-r02';
const out = process.argv[3] ?? 'output/playwright/face-rigidity-20261015/visual';
await mkdir(out, { recursive: true });
const root = process.cwd();
const html = `<!doctype html><link rel="icon" href="data:,"><style>body{margin:0;background:#bec3c7}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><script type="module">
import * as T from 'three';
import {CharacterAssets} from '/dist/src/character-assets.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(360,360);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#bec3c7');scene.add(new T.HemisphereLight(0xffffff,0x817268,2));
for(const [p,power] of [[[2,3,4],2.5],[[-3,1,2],1.4],[[0,2,-3],1]]){const l=new T.DirectionalLight(0xffffff,power);l.position.set(...p);scene.add(l);}
const cam=new T.OrthographicCamera(-.38,.38,.38,-.38,.001,20);
let provider,actor,head,rest;
window.load=async(key,version)=>{
 if(actor){scene.remove(actor.root);actor.dispose();provider.dispose();}
 provider=new CharacterAssets('/qa-manifest/'+key+'/'+version);actor=await provider.create({color:'#b7a27a',dye:null});scene.add(actor.root);
 actor.animation.change('Idle_Loop',0);actor.animation.current.time=0;actor.animation.mixer.update(0);scene.updateMatrixWorld(true);
 head=actor.root.getObjectByName('Head');rest=head.getWorldPosition(new T.Vector3());
 return {key:actor.asset.modelKey,sha256:actor.asset.sha256};
};
window.shot=(clip,phase,view,whole=false)=>{
 actor.animation.change(clip,0);actor.animation.current.time=actor.animation.current.getClip().duration*phase;actor.animation.mixer.update(0);scene.updateMatrixWorld(true);
 actor.root.traverse(m=>{if(m.isSkinnedMesh)m.skeleton.update();});
 const centre=whole?new T.Vector3(0,.73,0):head.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,(1.45-rest.y)*.48,0));
 const span=whole?1.75:.76;cam.left=cam.bottom=-span/2;cam.right=cam.top=span/2;cam.updateProjectionMatrix();
 const direction={front:[0,0,1],angle:[.55,0,.84],side:[1,0,0],rear:[0,0,-1]}[view];cam.position.copy(centre).add(new T.Vector3(...direction).multiplyScalar(3));cam.lookAt(centre);renderer.render(scene,cam);
 return renderer.domElement.toDataURL('image/png');
};
window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
      return;
    }
    if (pathname.startsWith('/qa-manifest/')) {
      const [, , key, version] = pathname.split('/');
      assert.ok(CHIBI_FACE_KEYS.includes(key));
      const asset = JSON.parse(await readFile(`${stage}/${key}/previous-manifest.json`));
      if (version === 'after') {
        const repair = JSON.parse(await readFile(`${stage}/${key}/repair.json`));
        Object.assign(asset, {
          url: `/${stage}/${key}/model.glb`,
          sha256: repair.sha256,
          bytes: repair.bytes,
        });
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(asset));
      return;
    }
    const file = path.resolve(
      root,
      pathname.startsWith('/models/') ? 'public' + pathname : '.' + pathname,
    );
    assert.ok(file.startsWith(root + path.sep));
    res.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.glb': 'model/gltf-binary',
        '.png': 'image/png',
        '.webp': 'image/webp',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch (e) {
    console.error(e.message);
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 360 } }),
  errors = [],
  records = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready);
  for (const key of CHIBI_FACE_KEYS) {
    const dir = `${out}/${key}`;
    await mkdir(dir, { recursive: true });
    const tiles = [];
    for (const [row, version] of ['before', 'after'].entries()) {
      records.push(
        await page.evaluate(({ key, version }) => window.load(key, version), { key, version }),
      );
      const poses = [
        ['Idle_Loop', 0],
        ['Walk_Loop', 0.125],
        ['Run_Loop', 0.1875],
        ['Run_Loop', 0.5],
      ];
      for (const [column, [clip, phase]] of poses.entries()) {
        const encoded = await page.evaluate(
          ({ clip, phase }) => window.shot(clip, phase, 'front'),
          { clip, phase },
        );
        const bytes = Buffer.from(encoded.split(',')[1], 'base64');
        await writeFile(`${dir}/${version}-${clip}-${phase}.png`, bytes);
        tiles.push({ input: bytes, left: column * 360, top: row * 390 + 30 });
      }
      for (const view of ['angle', 'side', 'rear'])
        for (const whole of [false, true]) {
          const encoded = await page.evaluate(
            ({ view, whole }) => window.shot('Run_Loop', 0.1875, view, whole),
            { view, whole },
          );
          await writeFile(
            `${dir}/${version}-run-${view}-${whole ? 'whole' : 'face'}.png`,
            Buffer.from(encoded.split(',')[1], 'base64'),
          );
        }
    }
    const label = Buffer.from(
      `<svg width="1440" height="780"><style>text{font:16px sans-serif;fill:#222}</style><text x="8" y="21">${key}: BEFORE | idle / walk / run 0.1875 / run 0.5</text><text x="8" y="411">AFTER | same geometry, skeleton and clips; repaired weights only</text></svg>`,
    );
    await sharp({ create: { width: 1440, height: 780, channels: 3, background: '#bec3c7' } })
      .composite([...tiles, { input: label, left: 0, top: 0 }])
      .png()
      .toFile(`${dir}/comparison.png`);
    console.log('REVIEW', key);
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        ok: true,
        errors,
        records,
        images: 200,
        environment:
          'Real headless Chrome; CharacterAssets and CharacterAnimation; 360px renders, unchanged before/after cameras and phases',
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
