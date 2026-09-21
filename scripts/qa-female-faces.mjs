// Exact GLB face inspection. This local-only server never loads a saved game.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const stage = process.argv[2] || 'before';
const root = resolve('.');
const out = resolve('output/playwright/female-faces', stage);
const portrait = process.env.FACE_QA_PORTRAIT === '1',
  width = portrait ? 420 : 640,
  height = portrait ? 480 : 640;
await mkdir(out, { recursive: true });
const html = `<!doctype html><style>body{margin:0;background:#bec3c7}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(${width},${height});renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#bec3c7');scene.add(new T.HemisphereLight(0xffffff,0x817268,2));
for(const [p,power] of [[[2,3,4],2.5],[[-3,1,2],1.4],[[0,2,-3],1]]){const l=new T.DirectionalLight(0xffffff,power);l.position.set(...p);scene.add(l);}
const cam=new T.OrthographicCamera(-.21,.21,.21,-.21,.001,20);let model,mixer,gltf;
window.inspectFace=async function(url,view='front',clay=false,clip='',phase=0,whole=false){
if(model){scene.remove(model);const textures=new Set();model.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const mat of [o.material].flat()){for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);mat.dispose();}}});for(const tex of textures){tex.dispose();tex.image?.close?.();}}gltf=await new GLTFLoader().loadAsync(url);model=gltf.scene;scene.add(model);
if(clay)model.traverse(o=>{if(o.isMesh)o.material=clay==='albedo'?new T.MeshBasicMaterial({map:o.material.map}):new T.MeshStandardMaterial({color:0xaaaaaa,roughness:.7});});
if(clip){mixer=new T.AnimationMixer(model);const c=gltf.animations.find(c=>c.name===clip);const a=mixer.clipAction(c);a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();mixer.setTime(c.duration*phase);}
scene.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
const box=new T.Box3().setFromObject(model);const h=box.max.y-box.min.y;
const centre=new T.Vector3((box.min.x+box.max.x)/2,box.max.y-h*.082,0);
const head=model.getObjectByName('Head');if(head&&clip){const hp=head.getWorldPosition(new T.Vector3());centre.x=hp.x;centre.z=hp.z;centre.y=hp.y+h*.04;}
const span=whole?h*1.12:h*.265;if(whole)centre.copy(box.getCenter(new T.Vector3()));
cam.left=cam.bottom=-span/2;cam.right=cam.top=span/2;cam.updateProjectionMatrix();
cam.left=-span/2*${width / height};cam.right=span/2*${width / height};cam.updateProjectionMatrix();
const d={front:[0,0,2],angle:[1,0,1.7],left:[-1,0,1.7],side:[2,0,0],rear:[0,0,-2]}[view];cam.position.copy(centre).add(new T.Vector3(...d));cam.lookAt(centre);renderer.render(scene,cam);
return {bounds:{min:box.min.toArray(),max:box.max.toArray()},clips:gltf.animations.map(c=>({name:c.name,seconds:c.duration})),head:head?.position.toArray(),triangles:renderer.info.render.triangles};};
window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
      return;
    }
    const file = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.glb': 'model/gltf-binary',
        '.png': 'image/png',
      }[extname(file)] || 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width, height } });
const errors = [],
  records = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready);
  for (const key of process.env.FACE_QA_KEY
    ? [process.env.FACE_QA_KEY]
    : ['cro-magnon-woman', 'neanderthal-woman']) {
    const file = process.argv[3]
      ? process.argv[3].includes('{key}')
        ? process.argv[3].replace('{key}', key)
        : `${process.argv[3]}/${key}/model.glb`
      : `public/models/${key}/model-human-r10.glb`;
    const bytes = await readFile(file);
    const poses = portrait
      ? [{ clip: 'Idle_Loop', phase: 0.2 }]
      : process.env.FACE_QA_POSES
        ? [
            'Craft',
            'Eat',
            'Gather',
            'Give',
            'Idle_Loop',
            'Run_Loop',
            'Walk_Loop',
            'Wave',
            'Attack',
            'Downed',
          ].flatMap((clip) => [0.15, 0.55, 0.9].map((phase) => ({ clip, phase })))
        : [{ clip: '', phase: 0 }];
    for (const clay of process.env.FACE_QA_POSES || portrait
      ? [false]
      : process.env.FACE_QA_ALBEDO
        ? ['albedo']
        : [false, true])
      for (const view of (portrait
        ? 'front'
        : process.env.FACE_QA_VIEWS || 'front,angle,side'
      ).split(','))
        for (const { clip, phase } of poses) {
          const state = await page.evaluate(
            ({ url, view, clay, whole, clip, phase }) =>
              window.inspectFace(url, view, clay, clip, phase, whole),
            {
              url: '/' + file,
              view,
              clay,
              whole: portrait || process.env.FACE_QA_WHOLE === '1',
              clip,
              phase,
            },
          );
          const name = `${key}-${clay ? 'clay' : 'colour'}-${view}${clip ? '-' + clip + '-' + phase : ''}.png`;
          await page.screenshot({ path: resolve(out, name) });
          records.push({
            key,
            file,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            view,
            clay,
            image: name,
            ...state,
          });
        }
  }
  await writeFile(
    resolve(out, 'report.json'),
    JSON.stringify({ stage, errors, records }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ out, images: records.length, errors }));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
