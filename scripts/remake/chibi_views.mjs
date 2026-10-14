// Exact-GLB views of a chibi (large-head) character in Chrome with the game's three.js: whole-body and
// face close-ups in colour, clay or unlit albedo, optionally posed by a clip. The face framing of
// scripts/qa-female-faces.mjs assumes adult proportions (a head about 1/8 of the height); a chibi's
// head is about 2/5 of it, so the close-up here is placed from fractions of the height.
//
//   node scripts/remake/chibi_views.mjs <model.glb> <outFolder> [--views front,angle,side,rear]
//     [--modes colour,clay] [--frames whole,face] [--clips Idle_Loop:0.2,Wave:0.5] [--size 640]
//     [--face-centre .21] [--face-span .44] [--name sheet]
//     [--align SCALE,CX,CY --reference ref.png --place-height 1.45]
//
// Writes one PNG per render, <name>.png (all renders in a labelled grid, one row per frame/mode) and
// report.json (SHA-256 of the GLB, bounds, clips, page errors).
// --align renders the front view on the reference's own pixel grid instead (the registration of
// scripts/remake/project_face.py: u = CX + SCALE * x, v = CY - SCALE * y, after the ground-centred
// placement to --place-height; 0 = the GLB is already placed): aligned-<mode>.png per mode and
// aligned-overlay.png (the reference blended over the albedo), for measuring where the reconstruction
// put the painted features. The aligned albedo is the raw base colour (no tone mapping), comparable to the
// reference's pixels.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    views: { type: 'string', default: 'front,angle,side,rear' },
    modes: { type: 'string', default: 'colour,clay' },
    frames: { type: 'string', default: 'whole,face' },
    clips: { type: 'string', default: '' },
    size: { type: 'string', default: '640' },
    'face-centre': { type: 'string', default: '.21' },
    'face-span': { type: 'string', default: '.44' },
    name: { type: 'string', default: 'sheet' },
    align: { type: 'string', default: '' },
    reference: { type: 'string', default: '' },
    'place-height': { type: 'string', default: '0' },
  },
});
const [glbPath, outFolder] = positionals;
if (!outFolder) throw new Error('usage: chibi_views.mjs <model.glb> <outFolder> [options]');
const root = resolve('.');
const glb = resolve(glbPath);
if (!glb.startsWith(root + sep)) throw new Error('the GLB must be inside the repository');
const out = resolve(outFolder);
await mkdir(out, { recursive: true });
const size = Number(opt.size);
const html = `<!doctype html><style>body{margin:0;background:#bec3c7}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(${size},${size});renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#bec3c7');scene.add(new T.HemisphereLight(0xffffff,0x817268,2));
for(const [p,power] of [[[2,3,4],2.5],[[-3,1,2],1.4],[[0,2,-3],1]]){const l=new T.DirectionalLight(0xffffff,power);l.position.set(...p);scene.add(l);}
const cam=new T.OrthographicCamera(-1,1,1,-1,.001,50);
let gltf,model,originals=new Map(),mixer;
window.load=async function(url){gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);model=gltf.scene;scene.add(model);
 model.traverse(o=>{if(o.isMesh)originals.set(o,o.material);});
 let tris=0;model.traverse(o=>{if(o.isMesh)tris+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});
 const box=new T.Box3().setFromObject(model);return {clips:gltf.animations.map(c=>({name:c.name,seconds:c.duration})),triangles:tris,min:box.min.toArray(),max:box.max.toArray()};};
// Both sides, as the delivered materials (TRELLIS surfaces are double-walled and partly inverted).
const clay=new T.MeshStandardMaterial({color:0xb4b4b4,roughness:.75,side:T.DoubleSide});
window.shot=function({view,mode,frame,clip,phase,faceCentre,faceSpan}){
 model.traverse(o=>{if(!o.isMesh)return;const m=originals.get(o);o.material=mode==='clay'?clay:mode==='albedo'?[m].flat().map(x=>new T.MeshBasicMaterial({map:x.map,side:x.side})):m;if(Array.isArray(o.material)&&o.material.length===1)o.material=o.material[0];});
 if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model);mixer=null;}
 if(clip){mixer=new T.AnimationMixer(model);const c=gltf.animations.find(c=>c.name===clip);if(!c)throw new Error('no clip '+clip);const a=mixer.clipAction(c);a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();mixer.setTime(c.duration*phase);}
 scene.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
 const box=new T.Box3().setFromObject(model,true);const h=box.max.y-box.min.y;const rest=new T.Box3().setFromObject(model);const H=rest.max.y-rest.min.y;
 let centre,span;
 if(frame==='face'){const head=model.getObjectByName('Head');centre=new T.Vector3((rest.min.x+rest.max.x)/2,rest.max.y-faceCentre*H,(rest.min.z+rest.max.z)/2);
  if(head&&clip){const hp=head.getWorldPosition(new T.Vector3());const restHead=window.restHead||hp;centre.add(hp.clone().sub(restHead));}
  span=faceSpan*H;}
 else{centre=box.getCenter(new T.Vector3());span=Math.max(h,box.max.x-box.min.x,box.max.z-box.min.z)*1.08;}
 cam.left=cam.bottom=-span/2;cam.right=cam.top=span/2;cam.updateProjectionMatrix();
 const d={front:[0,0,1],angle:[.51,0,.86],left:[-.51,0,.86],side:[1,0,0],rear:[0,0,-1],top:[0,1,.001]}[view];
 cam.position.copy(centre).add(new T.Vector3(...d).multiplyScalar(10));cam.lookAt(centre);renderer.render(scene,cam);
 return renderer.domElement.toDataURL('image/png');};
window.aligned=function({a,cx,cy,width,height,placeHeight,mode}){
 renderer.setSize(width,height);
 model.traverse(o=>{if(!o.isMesh)return;const m=originals.get(o);o.material=mode==='clay'?clay:[m].flat().map(x=>new T.MeshBasicMaterial({map:x.map,toneMapped:false,side:x.side}));if(o.material.length===1)o.material=o.material[0];});
 model.position.set(0,0,0);model.scale.setScalar(1);model.updateMatrixWorld(true);
 const box=new T.Box3().setFromObject(model);
 if(placeHeight>0){const s=placeHeight/(box.max.y-box.min.y);model.scale.setScalar(s);model.position.set(-s*(box.min.x+box.max.x)/2,-s*box.min.y,-s*(box.min.z+box.max.z)/2);model.updateMatrixWorld(true);}
 // u = cx + a x, v = cy - a y over a width x height image
 const c=new T.OrthographicCamera(-cx/a,(width-cx)/a,cy/a,(cy-height)/a,.001,50);c.position.set(0,0,10);c.lookAt(0,0,0);
 renderer.render(scene,c);const url=renderer.domElement.toDataURL('image/png');
 model.position.set(0,0,0);model.scale.setScalar(1);model.updateMatrixWorld(true);renderer.setSize(${size},${size});return url;};
window.overlay=async function(a,b,alpha){const ia=new Image();ia.src=a;await ia.decode();const ib=new Image();ib.src=b;await ib.decode();const c=document.createElement('canvas');c.width=ia.width;c.height=ia.height;const g=c.getContext('2d');g.drawImage(ia,0,0);g.globalAlpha=alpha;g.drawImage(ib,0,0,ia.width,ia.height);return c.toDataURL('image/png');};
window.noteRestHead=function(){const head=model.getObjectByName('Head');if(head){scene.updateMatrixWorld(true);window.restHead=head.getWorldPosition(new T.Vector3());}};
window.compose=async function(cells,columns,cell,labels){const rows=Math.ceil(cells.length/columns);const c=document.createElement('canvas');c.width=columns*cell;c.height=rows*(cell+22);const g=c.getContext('2d');g.fillStyle='#2a2a2a';g.fillRect(0,0,c.width,c.height);
 for(let i=0;i<cells.length;i++){const im=new Image();im.src=cells[i];await im.decode();const x=(i%columns)*cell,y=Math.floor(i/columns)*(cell+22);g.drawImage(im,x,y+22,cell,cell);g.fillStyle='#eee';g.font='14px sans-serif';g.fillText(labels[i],x+6,y+16);}
 return c.toDataURL('image/png');};
window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(html);
    }
    const file = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + sep)) return res.writeHead(403).end();
    res.setHeader(
      'Content-Type',
      { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' }[
        extname(file)
      ] || 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: size, height: size } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const png = (dataURL) => Buffer.from(dataURL.split(',')[1], 'base64');
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready);
  const url = '/' + relative(root, glb).split(sep).join('/');
  const info = await page.evaluate((u) => window.load(u), url);
  await page.evaluate(() => window.noteRestHead());
  if (opt.align) {
    const [a, cx, cy] = opt.align.split(',').map(Number);
    const ref = await readFile(resolve(opt.reference));
    // PNG IHDR: width and height at bytes 16..23
    const width = ref.readUInt32BE(16),
      height = ref.readUInt32BE(20);
    await page.setViewportSize({ width, height });
    const renders = {};
    for (const mode of ['albedo', 'clay']) {
      renders[mode] = await page.evaluate((args) => window.aligned(args), {
        a,
        cx,
        cy,
        width,
        height,
        placeHeight: Number(opt['place-height']),
        mode,
      });
      await writeFile(resolve(out, `aligned-${mode}.png`), png(renders[mode]));
    }
    const refURL = `data:image/png;base64,${ref.toString('base64')}`;
    await writeFile(
      resolve(out, 'aligned-overlay.png'),
      png(await page.evaluate(([x, y]) => window.overlay(x, y, 0.5), [renders.albedo, refURL])),
    );
    console.log(JSON.stringify({ out, aligned: [width, height], errors }));
  } else {
    const views = opt.views.split(','),
      poses = opt.clips
        ? opt.clips.split(',').map((s) => {
            const [clip, phase = '0.5'] = s.split(':');
            return { clip, phase: Number(phase) };
          })
        : [{ clip: '', phase: 0 }];
    const cells = [],
      labels = [];
    for (const frame of opt.frames.split(','))
      for (const mode of opt.modes.split(','))
        for (const { clip, phase } of poses)
          for (const view of views) {
            const data = await page.evaluate((a) => window.shot(a), {
              view,
              mode,
              frame,
              clip,
              phase,
              faceCentre: Number(opt['face-centre']),
              faceSpan: Number(opt['face-span']),
            });
            const label = `${frame} ${mode} ${view}${clip ? ` ${clip} ${phase}` : ''}`;
            await writeFile(resolve(out, `${label.replaceAll(' ', '-')}.png`), png(data));
            cells.push(data);
            labels.push(label);
          }
    const columns = views.length * (opt.clips && poses.length > 1 ? Math.min(poses.length, 3) : 1);
    const sheet = await page.evaluate(
      ({ cells, columns, cell, labels }) => window.compose(cells, columns, cell, labels),
      { cells, columns: Math.min(columns, 8), cell: Math.min(size, 480), labels },
    );
    await writeFile(resolve(out, `${opt.name}.png`), png(sheet));
    const bytes = await readFile(glb);
    await writeFile(
      resolve(out, 'report.json'),
      JSON.stringify(
        {
          glb: relative(root, glb),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
          ...info,
          renders: labels,
          errors,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(JSON.stringify({ out, renders: labels.length, triangles: info.triangles, errors }));
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
