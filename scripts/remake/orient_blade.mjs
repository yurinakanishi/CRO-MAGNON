// Stand a flat-lying blade upright in the obsidian spear's grip frame, as the C1 obsidian-blade was cut from the
// spear head (base at y 1.094 m, tip at 1.385 m, centred on the shaft). The new reference shows the blade lying
// flat, so the processed mesh has its length along glTF Z and its thickness along Y.
// node scripts/remake/orient_blade.mjs <in.glb> <out.glb> [baseY=1.094]
// Finds the tip as the narrower end, then writes ONE root node transform (rotation + translation); vertex,
// UV, normal and image bytes are unchanged.
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst, baseText = '1.094'] = process.argv.slice(2);
const b = readFileSync(src),
  jl = b.readUInt32LE(12),
  doc = JSON.parse(b.subarray(20, 20 + jl)),
  bin = b.subarray(28 + jl);
const prim = doc.meshes[0].primitives[0];
const acc = doc.accessors[prim.attributes.POSITION],
  view = doc.bufferViews[acc.bufferView];
const pos = new Float32Array(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0), acc.count * 3);
let zmin = Infinity,
  zmax = -Infinity;
for (let i = 0; i < acc.count; i++) {
  zmin = Math.min(zmin, pos[i * 3 + 2]);
  zmax = Math.max(zmax, pos[i * 3 + 2]);
}
const span = zmax - zmin;
const widthNear = (lo, hi) => {
  let a = Infinity,
    c = -Infinity;
  for (let i = 0; i < acc.count; i++) {
    const z = pos[i * 3 + 2];
    if (z >= lo && z <= hi) {
      a = Math.min(a, pos[i * 3]);
      c = Math.max(c, pos[i * 3]);
    }
  }
  return c - a;
};
const lowEnd = widthNear(zmin, zmin + span * 0.12),
  highEnd = widthNear(zmax - span * 0.12, zmax);
const tipAtHighZ = highEnd < lowEnd;
// Rotate about X so the tip end points up (+Y): tip at +Z -> rotate -90 deg; tip at -Z -> rotate +90 deg.
const angle = tipAtHighZ ? -Math.PI / 2 : Math.PI / 2;
const q = [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
// After rotation the base end sits at y = (tipAtHighZ ? zmin : -zmax); lift it to baseY.
const baseY = Number(baseText);
const yAfterBase = tipAtHighZ ? zmin : -zmax;
const root = doc.scenes[doc.scene ?? 0].nodes;
const holder = { name: 'BladeGripFrame', rotation: q, translation: [0, baseY - yAfterBase, 0], children: root };
doc.nodes.push(holder);
doc.scenes[doc.scene ?? 0].nodes = [doc.nodes.length - 1];
let js = Buffer.from(JSON.stringify(doc));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const bl = b.readUInt32LE(20 + jl);
const binChunk = b.subarray(20 + jl, 28 + jl + bl);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + js.length + binChunk.length, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(js.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
writeFileSync(dst, Buffer.concat([header, jh, js, binChunk]));
console.log(JSON.stringify({ tipAtHighZ, widths: { lowEnd, highEnd }, length: span, baseY, out: dst }));
