// Visible normal/slow motion in the unchanged, self-contained delivered viewer.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const revision = process.argv[2] || '08';
const root = `output/model-generation/models/rimo-neko/qa/rig-${revision}`;
const out = `${root}/motion-browser`;
await mkdir(out,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1200,height:900}});
const errors = [],checks = [];
page.on('pageerror',e=>errors.push(String(e)));
try {
  await page.goto(pathToFileURL(resolve(root,'viewer.html')).href);
  await page.waitForFunction(()=>window.modelReady,{}, {timeout:60000});
  await page.bringToFront();
  const record=JSON.parse(await readFile(`${root}/viewer.json`,'utf8'));
  assert.equal(await page.evaluate(()=>window.candidateSha256),record.sourceSha256);
  const program=[['Run_Loop','1',2000],['Run_Loop','0.25',4200],['Hiss','1',2300],['Hiss','0.25',8700]];
  for (const [clip,duration] of [['Idle_Loop',3],['Walk_Loop',41/60],['Pet',1.6],['Happy',.9],['Hit',.5]])
    for (const speed of ['1','0.5']) program.push([clip,speed,duration*1000/Number(speed)+120]);
  for(const [view,theta] of [['front',0],['right',90],['left',-90],['back',180],['threequarter',30]]) {
    await page.evaluate(theta=>{const m=document.querySelector('#mv');m.cameraOrbit=`${theta}deg 78deg 165%`;m.jumpCameraToGoal();},theta);
    for(const [clip,speed,ms] of program) {
      await page.locator('#clip').selectOption(clip);
      await page.locator('#speed').selectOption(speed);
      assert.equal(await page.evaluate(()=>document.querySelector('#mv').timeScale),Number(speed));
      await page.waitForTimeout(250);
      await page.evaluate(()=>{
        const m=document.querySelector('#mv');m.currentTime=0;
        const canvas=[...m.shadowRoot.querySelectorAll('canvas')].find(c=>c.getBoundingClientRect().width>0);
        if(!canvas)throw Error('Missing rendered model canvas');
        const stream=canvas.captureStream(30), chunks=[];
        window.qaCapture={stream,chunks,recorder:new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:3500000})};
        qaCapture.recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        qaCapture.recorder.start();
      });
      await page.waitForTimeout(ms);
      const bytes=await page.evaluate(()=>new Promise(resolve=>{
        qaCapture.recorder.onstop=async()=>{const data=await new Blob(qaCapture.chunks,{type:'video/webm'}).arrayBuffer();qaCapture.stream.getTracks().forEach(t=>t.stop());resolve(Array.from(new Uint8Array(data)));};
        qaCapture.recorder.stop();
      }));
      assert.ok(bytes.length>10000);
      const name=`${clip}-${view}-${speed}`;
      await writeFile(`${out}/${name}.webm`,Buffer.from(bytes));
      await page.screenshot({path:`${out}/${name}.png`});
      checks.push({clip,view,speed:Number(speed),captureFps:30,bytes:bytes.length});
      console.log('RECORDED',name,bytes.length);
    }
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/result.json`,JSON.stringify({sha256:record.sourceSha256,checks,errors},null,2)+'\n');
} finally {await browser.close();}
