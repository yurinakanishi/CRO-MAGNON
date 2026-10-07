// Compare every remade animated delivery's clips with its previous delivery: names, durations, loop closure.
// node scripts/remake/check_clip_parity.mjs [key ...]   (exit 1 on any mismatch)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const world = JSON.parse(readFileSync(path.join(root, 'public/models/world-assets.json'), 'utf8')).assets;
const players = readdirSync(path.join(root, 'public/models'))
  .map((d) => path.join(root, 'public/models', d, 'asset.json'))
  .filter(existsSync)
  .map((f) => JSON.parse(readFileSync(f, 'utf8')))
  .filter((a) => !world.some((w) => w.modelKey === a.modelKey));
const want = process.argv.slice(2);
function clips(file) {
  const b = readFileSync(file),
    jl = b.readUInt32LE(12),
    doc = JSON.parse(b.subarray(20, 20 + jl)),
    bin = b.subarray(28 + jl);
  const acc = (i) => {
    const a = doc.accessors[i],
      v = doc.bufferViews[a.bufferView],
      n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    return new Float32Array(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * n).slice();
  };
  const out = {};
  for (const an of doc.animations ?? []) {
    let seconds = 0,
      closure = 0;
    for (const ch of an.channels) {
      const s = an.samplers[ch.sampler],
        t = acc(s.input),
        v = acc(s.output),
        n = v.length / t.length;
      seconds = Math.max(seconds, t[t.length - 1]);
      let d = 0,
        e = 0;
      for (let k = 0; k < n; k++) {
        d = Math.max(d, Math.abs(v[k] - v[v.length - n + k]));
        e = Math.max(e, Math.abs(v[k] + v[v.length - n + k]));
      }
      closure = Math.max(closure, ch.target.path === 'rotation' ? Math.min(d, e) : d);
    }
    out[an.name] = { seconds, closure };
  }
  return out;
}
let bad = 0;
for (const a of [...world, ...players]) {
  if (!a.status?.startsWith('remake-') || !(a.clips ?? []).length) continue;
  if (want.length && !want.includes(a.modelKey)) continue;
  const prev = a.provenance?.previousDelivery?.url;
  if (!prev) continue;
  const now = clips(path.join(root, 'public', a.url)),
    old = clips(path.join(root, 'public', prev));
  const issues = [];
  for (const [name, o] of Object.entries(old)) {
    const n = now[name];
    if (!n) issues.push(`${name} missing`);
    else {
      if (Math.abs(n.seconds - o.seconds) > 1e-4) issues.push(`${name} ${o.seconds.toFixed(4)}->${n.seconds.toFixed(4)}s`);
      if (name.endsWith('_Loop') && o.closure <= 1e-4 && n.closure > 1e-4) issues.push(`${name} loop open ${n.closure.toFixed(4)}`);
    }
  }
  for (const c of a.clips) if (now[c.name] && Math.abs(now[c.name].seconds - c.seconds) > 1e-4) issues.push(`manifest ${c.name} ${c.seconds} vs ${now[c.name].seconds.toFixed(4)}`);
  if (issues.length) bad++;
  console.log(`${issues.length ? 'FAIL' : 'ok  '} ${a.modelKey} ${issues.join('; ')}`);
}
process.exit(bad ? 1 : 0);
