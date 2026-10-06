// Offline asset preparation. Chrome only decodes local, licensed sources; no game or saves.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const root = path.resolve('assets/nature-audio/source');
const destination = 'public/audio/nature';
await mkdir(destination, { recursive: true });
const server = createServer(async (req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(req.url));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const port = server.address().port;
const sources = [
  {
    file: 'wind.wav',
    author: 'Luke.RUSTLTD',
    page: 'https://opengameart.org/content/wind1',
    kind: 'Synthesized wind / PureData',
  },
  {
    file: 'birds.ogg',
    author: 'isaiah658',
    page: 'https://opengameart.org/content/ambient-bird-sounds',
    kind: 'Bird field recording',
  },
  {
    file: 'fire.wav',
    author: 'PagDev',
    page: 'https://opengameart.org/content/fireplace-sound-loop',
    kind: 'Wood-burning fireplace sound loop',
  },
  {
    file: 'river.mp3',
    author: 'RandomMind',
    page: 'https://opengameart.org/content/sea-and-river-wave-sounds',
    kind: 'Vistula river field recording',
  },
];
const jobs = [
  { file: 'wind.wav', name: 'wind', start: 4, seconds: 23, loop: true },
  { file: 'fire.wav', name: 'fire', start: 2, seconds: 23, loop: true },
  { file: 'river.mp3', name: 'river', start: 30, seconds: 27, loop: true },
  ...[0, 1, 2].map((i) => ({
    file: 'birds.ogg',
    name: `birds-${i}`,
    start: 3 + i * 7,
    seconds: 5,
    loop: false,
  })),
];
const files = [];
try {
  for (const job of jobs) {
    const result = await page.evaluate(
      async ({ base, job }) => {
        const ctx = new OfflineAudioContext(1, 1, 22050);
        const input = await ctx.decodeAudioData(
          await (await fetch(base + '/' + job.file)).arrayBuffer(),
        );
        const start = Math.floor(job.start * input.sampleRate);
        const size = Math.min(input.length - start, Math.floor(job.seconds * input.sampleRate));
        if (size < 1000) throw Error('Source too short: ' + job.file);
        const samples = new Float32Array(size);
        for (let c = 0; c < input.numberOfChannels; c++) {
          const data = input.getChannelData(c);
          for (let i = 0; i < size; i++) samples[i] += data[start + i] / input.numberOfChannels;
        }
        // Join the end over the beginning so both the value and local texture cross the loop seam.
        const overlap = job.loop ? Math.floor(input.sampleRate * 1.5) : 0;
        const output = samples.slice(overlap);
        if (overlap)
          for (let i = 0; i < overlap; i++) {
            const t = i / overlap;
            output[output.length - overlap + i] =
              samples[size - overlap + i] * (1 - t) + samples[i] * t;
          }
        let peak = 0,
          mean = 0;
        for (const v of output) mean += v;
        mean /= output.length;
        for (let i = 0; i < output.length; i++) {
          output[i] -= mean;
          peak = Math.max(peak, Math.abs(output[i]));
        }
        const gain = Math.min(4, 0.65 / Math.max(0.001, peak));
        let power = 0;
        const pcm = new Int16Array(output.length);
        const fade = Math.floor(input.sampleRate * 0.015);
        for (let i = 0; i < output.length; i++) {
          const envelope = job.loop ? 1 : Math.min(1, i / fade, (output.length - 1 - i) / fade);
          const v = output[i] * gain * envelope;
          power += v * v;
          pcm[i] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
        }
        // Bounded strings avoid argument limits on larger recordings.
        const bytes = new Uint8Array(pcm.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return {
          pcm: btoa(binary),
          rate: input.sampleRate,
          seconds: pcm.length / input.sampleRate,
          rms: Math.sqrt(power / output.length),
          peak: peak * gain,
          sourceSeconds: input.duration,
        };
      },
      { base: `http://127.0.0.1:${port}`, job },
    );
    const pcm = Buffer.from(result.pcm, 'base64'),
      header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(result.rate, 24);
    header.writeUInt32LE(result.rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const bytes = Buffer.concat([header, pcm]);
    await writeFile(`${destination}/${job.name}.wav`, bytes);
    const { pcm: ignored, ...stats } = result;
    files.push({
      url: `/audio/nature/${job.name}.wav`,
      source: job.file,
      extraction: job,
      ...stats,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    console.log(job.name, bytes.length, result.seconds.toFixed(2));
  }
  for (const source of sources) {
    const bytes = await readFile(path.join(root, source.file));
    source.sha256 = createHash('sha256').update(bytes).digest('hex');
    source.license = 'CC0-1.0';
  }
  await writeFile(
    `${destination}/manifest.json`,
    JSON.stringify(
      {
        version: 1,
        prepared: '2026-10-06',
        format:
          'Mono PCM16 WAV, 22050 Hz; cropped, DC removed, level matched, loop overlap or end fades',
        sources,
        files,
        totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    `${destination}/CREDITS.txt`,
    'CRO-MAGNON nature audio\n\n' +
      sources
        .map(
          (s) =>
            `${s.author}\n${s.kind}\n${s.page}\nCC0-1.0 https://creativecommons.org/publicdomain/zero/1.0/\n`,
        )
        .join('\n') +
      '\nSee manifest.json for source hashes and editing. Original synthesized music, droplets and rain are generated by src/nature-synthesis.ts. No third-party music or model service is used.\n',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
