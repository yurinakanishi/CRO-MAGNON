// Render the retained audio and archived, removed cues for the user's local audition.
// The review folder is never collected by the game or either distribution builder.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = path.resolve(process.argv[2] || 'output/nature-audio-review-20261006');
await mkdir(path.join(out, 'audio'), { recursive: true });
const files = new Map([
  ['/current.js', 'assets/nature-audio/before-quality-20261006/nature-synthesis.js'],
  ['/legacy.js', 'assets/nature-audio/removed-20261006/nature-synthesis.js'],
]);
for (const name of ['wind', 'river', 'fire', 'birds-0', 'birds-1', 'birds-2'])
  files.set(`/${name}.wav`, `assets/nature-audio/before-quality-20261006/audio/${name}.wav`);
for (const name of ['sand-0', 'sand-1', 'sand-2', 'stone-0', 'stone-1', 'stone-2'])
  files.set(`/${name}.wav`, `assets/nature-audio/removed-20261006/${name}.wav`);
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Local audio render</title>');
    return;
  }
  const file = files.get(req.url);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'audio/wav');
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const items = [];
const cue = (key, at = 0, volume = 1, rate = 1, lowpass = 15000) => ({
  key,
  at,
  volume,
  rate,
  lowpass,
});
const add = (id, title, status, description, seconds, cues, wet = 0) =>
  items.push({ id, title, status, description, seconds, cues, wet });
for (const [id, title, desc] of [
  ['wind', '風', '屋外の風。強弱は草の揺れと連動。'],
  ['river', '川の流れ', '川の方向と距離に合わせて聞こえる水音。'],
  ['shore', '岸辺の水音', '川と同じ録音を、岸辺では小さく再生。'],
  ['fire', '焚き火', '近くの焚き火の音。'],
  ['torch', '松明の燃焼音', '焚き火と同じ録音を、松明ではごく小さく再生。'],
  ['rain', '雨', '海辺の雨天に連動する雨音。'],
]) {
  const key = id === 'shore' ? 'river' : id === 'torch' ? 'fire' : id;
  add(id, title, 'kept', desc, 8, [{ ...cue(key), loop: true, offset: id === 'shore' ? 7 : 0 }]);
}
add(
  'cave-drop',
  '洞窟の水滴',
  'kept',
  '洞窟内だけの間欠的な水滴。残響を含む。',
  5,
  [cue('drop', 0.4), cue('drop', 2.8, 0.9, 0.9)],
  0.2,
);
for (let i = 0; i < 3; i++)
  add(
    `birds-${i}`,
    `鳥の声 ${i + 1}`,
    'kept',
    '草原の屋外で間をあけて鳴く、3種類の録音断片。',
    5.3,
    [cue(`birds-${i}`)],
  );
for (const [id, title] of [
  ['explore', '探索'],
  ['camp', 'キャンプ'],
  ['cave', '洞窟'],
])
  items.push({
    id: `bgm-${id}`,
    title: `BGM：${title}`,
    status: 'kept',
    description: '笛と木の打音による1フレーズ。ゲームではフレーズ後に22〜36秒の休止。',
    seconds: 27,
    music: id,
    wet: id === 'cave' ? 0.2 : 0,
  });
for (const [id, title, key, rate, lowpass] of [
  ['grass', '草・土', 'sand', 1, 4500],
  ['sand', '砂', 'sand', 1, 11000],
  ['stone', '石', 'stone', 1, 11000],
  ['snow', '雪', 'sand', 0.72, 1900],
  ['water', '浅瀬', 'splash', 1, 11000],
])
  add(
    `step-${id}`,
    `足音：${title}`,
    'removed',
    '歩行・走行時の足音。ゲームでは再生しません。',
    3.2,
    [0, 1, 2].map((i) =>
      cue(key === 'splash' ? key : `${key}-${i}`, i * 0.85 + 0.1, 1, rate, lowpass),
    ),
  );
for (const [id, title, key, volume, rate] of [
  ['attack', '攻撃の風切り音', 'swish', 0.6, 1],
  ['jump', 'ジャンプ音', 'swish', 0.24, 1],
  ['hurt', '被弾音', 'stone-0', 0.26, 1],
  ['gather', '採集音', 'sand-1', 0.35, 1],
  ['torch-switch', '松明の点灯・消灯操作音', 'swish', 0.2, 0.65],
  ['mount', '乗る・降りる音', 'sand-0', 0.25, 1],
  ['recall', '仲間を呼ぶ笛', 'flute', 0.5, 2],
  ['throw', '仲間を投げる音', 'swish', 0.34, 1.2],
  ['pet', '撫でる音', 'wood', 0.2, 1.5],
  ['hiss', '猫の威嚇音', 'hiss', 0.3, 1],
  ['confirm', '成功通知・確認音', 'wood', 0.13, 1.5],
])
  add(id, title, 'removed', '変更前の音源・再生速度を使った確認用。ゲームでは再生しません。', 4, [
    cue(key, 0.1, volume, rate),
    cue(key, 2.1, volume, rate),
  ]);
add(
  'discovery',
  '発見時の短い合図（ME）',
  'removed',
  '木の打音と笛の同時再生。ゲームでは再生しません。',
  4,
  [cue('wood', 0.1, 0.3), cue('flute', 0.1, 0.12, 1.5)],
);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const item of items) {
    const rendered = await page.evaluate(async (item) => {
      const { natureSynthesis, NATURE_PHRASES } = await import('/current.js');
      const { natureSynthesis: legacySynthesis } = await import('/legacy.js');
      const context = new OfflineAudioContext(1, Math.ceil(item.seconds * 22050), 22050);
      const buffers = item.status === 'kept' ? natureSynthesis(context) : legacySynthesis(context);
      const cues = item.music
        ? NATURE_PHRASES[item.music].map(([at, pitch, volume, key]) => ({
            at,
            volume,
            key,
            rate: 2 ** ((pitch - 62) / 12),
            lowpass: 15000,
          }))
        : item.cues;
      const master = context.createGain();
      master.connect(context.destination);
      if (item.wet) {
        const send = context.createGain(),
          verb = context.createConvolver();
        send.gain.value = item.wet;
        verb.buffer = buffers.impulse;
        master.connect(send).connect(verb).connect(context.destination);
      }
      for (const c of cues) {
        if (!buffers[c.key])
          buffers[c.key] = await context.decodeAudioData(
            await (await fetch(`/${c.key}.wav`)).arrayBuffer(),
          );
        const source = context.createBufferSource(),
          gain = context.createGain(),
          filter = context.createBiquadFilter();
        source.buffer = buffers[c.key];
        source.loop = !!c.loop;
        source.playbackRate.value = c.rate;
        gain.gain.value = c.volume;
        filter.type = 'lowpass';
        filter.frequency.value = c.lowpass;
        source.connect(filter).connect(gain).connect(master);
        source.start(c.at, c.offset || 0);
      }
      const data = (await context.startRendering()).getChannelData(0);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      const level = 0.35 / Math.max(0.00001, peak),
        pcm = new Int16Array(data.length);
      let power = 0;
      for (let i = 0; i < data.length; i++) {
        const fade = Math.min(1, i / 220, (data.length - 1 - i) / 440);
        const v = data[i] * level * fade;
        power += v * v;
        pcm[i] = Math.round(v * 32767);
      }
      const bytes = new Uint8Array(pcm.buffer);
      let text = '';
      for (let i = 0; i < bytes.length; i += 8192)
        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {
        pcm: btoa(text),
        sourcePeak: peak,
        auditionGain: level,
        rms: Math.sqrt(power / data.length),
      };
    }, item);
    assert.ok(rendered.sourcePeak > 0 && rendered.rms > 0);
    const pcm = Buffer.from(rendered.pcm, 'base64'),
      header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(22050, 24);
    header.writeUInt32LE(44100, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    item.file = `audio/${item.id}.wav`;
    item.rms = rendered.rms;
    item.auditionGain = rendered.auditionGain;
    await writeFile(path.join(out, item.file), Buffer.concat([header, pcm]));
  }
  const card = (item) =>
    `<article class="card" data-status="${item.status}"><small>${item.status === 'kept' ? '残した音' : 'ゲームから削除'}</small><h3>${item.title}</h3><p>${item.description}</p><audio controls preload="metadata" src="${item.file}" aria-label="${item.title}"></audio><a href="${item.file}" download>WAVを保存</a></article>`;
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRO-MAGNON｜音の確認</title><style>
    *{box-sizing:border-box}body{margin:0;background:#101912;color:#e6ece4;font-family:system-ui,sans-serif;line-height:1.65}main{max-width:1160px;margin:auto;padding:40px 24px 80px}header{border-bottom:1px solid #40523e;padding-bottom:24px}header>small{letter-spacing:.17em;color:#b2c4a0}h1{font-size:clamp(26px,4vw,42px);margin:12px 0}p{color:#b7c4b3}nav{position:sticky;top:0;background:#101912ed;backdrop-filter:blur(8px);padding:16px 0;z-index:2;display:flex;flex-wrap:wrap;gap:10px}button{padding:10px 16px;border:1px solid #718266;border-radius:24px;background:transparent;color:#e6ece4;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#d4e4c4;color:#182115}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card{padding:22px;background:#1d2a1e;border:1px solid #344831;border-radius:14px}.card[data-status=removed]{background:#2c251c;border-color:#594932}.card small{color:#bdd5a2}.card[data-status=removed] small{color:#e4be85}h3{font-size:19px;margin:8px 0}.card p{font-size:14px;min-height:4.9em}audio{width:100%;margin:10px 0}a{color:#c6dab5;font-size:13px}a:focus,button:focus-visible{outline:3px solid #dbcb96;outline-offset:3px}[hidden]{display:none!important}footer{margin-top:30px;font-size:13px;color:#a8b4a3}
    </style><main><header><small>CRO-MAGNON / AUDIO REVIEW</small><h1>残した音、消した音。</h1><p>環境音・鳥の声・場所別BGMを残しました。草の揺れ・煙・波紋・洞窟の塵は、そのままです。</p><p>それぞれの再生ボタンで試聴できます。試聴用にピーク音量を揃えています。ゲーム内の音量・距離感とは異なり、短いSEは2〜3回繰り返しています。自動再生はしません。</p></header><nav aria-label="音の分類"><button data-filter="kept" aria-pressed="true">残した音 ${items.filter((i) => i.status === 'kept').length}</button><button data-filter="removed" aria-pressed="false">削除した音 ${items.filter((i) => i.status === 'removed').length}</button><button data-filter="all" aria-pressed="false">すべて</button><button id="stop">再生を止める</button></nav><section class="grid" aria-label="試聴一覧">${items.map(card).join('')}</section><footer>削除した音は確認用としてここだけに保存しています。ゲームでは読み込み・再生しません。<br>素材の作者・ライセンス・加工はプロジェクト内の public/audio/nature と assets/nature-audio/removed-20261006 に記録。</footer></main><script>
    const players=[...document.querySelectorAll('audio')];players.forEach(a=>a.addEventListener('play',()=>players.forEach(b=>{if(a!==b)b.pause()})));
    function filter(value){document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===value));document.querySelectorAll('.card').forEach(c=>{c.hidden=value!=='all'&&c.dataset.status!==value;if(c.hidden)c.querySelector('audio').pause()})}
    document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>filter(b.dataset.filter));document.querySelector('#stop').onclick=()=>players.forEach(a=>a.pause());filter('kept');
    </script></html>`;
  await writeFile(path.join(out, 'index.html'), html);
  await writeFile(path.join(out, 'catalog.json'), JSON.stringify(items, null, 2) + '\n');
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('audio')].every((a) => a.readyState >= 1 && !a.error),
  );
  assert.equal(await page.locator('.card:visible').count(), 13);
  // Actual play/decode of every local WAV; stop each before moving to the next.
  for (const item of items)
    await page.evaluate(async (id) => {
      const a = document.querySelector(`audio[src="audio/${id}.wav"]`);
      await a.play();
      a.pause();
    }, item.id);
  await page.getByRole('button', { name: '削除した音 17', exact: true }).click();
  assert.equal(await page.locator('.card:visible').count(), 17);
  await page.screenshot({ path: path.join(out, 'review-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '残した音 13', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(out, 'review-mobile.png') });
  console.log(JSON.stringify({ out, kept: 13, removed: 17, decoded: items.length }));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
