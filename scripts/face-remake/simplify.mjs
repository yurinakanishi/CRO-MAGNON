// Attribute-aware meshoptimizer reduction used by graft-head.py (vertices stay a subset with exact attribute values).
// node scripts/face-remake/simplify.mjs <in.bin> <out.bin> <targetTriangles> <error> [flags,comma]
// in.bin: u32 nv, u32 nt, f32 positions[nv*3], f32 attributes[nv*5] (normal xyz, uv), u8 lock[nv], u32 indices[nt*3]
// out.bin: u32 nt, f32 error, u32 indices[nt*3]
import { readFile, writeFile } from 'node:fs/promises';
import { MeshoptSimplifier } from 'meshoptimizer';

const [input, output, targetText, errorText, flagText = 'LockBorder'] = process.argv.slice(2);
const buf = await readFile(input);
const nv = buf.readUInt32LE(0),
  nt = buf.readUInt32LE(4);
let o = 8;
const positions = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
o += nv * 12;
const attributes = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 20));
o += nv * 20;
const lock = new Uint8Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv));
o += nv;
o += (4 - (o % 4)) % 4;
const indices = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nt * 12));
await MeshoptSimplifier.ready;
const flags = flagText.split(',').filter(Boolean);
// UVs weigh heavily so atlas seams are kept; normals moderately so creases (lips, eyelids, ears) survive.
const target = Math.min(Math.floor(Number(targetText)), nt) * 3;
// 'Sloppy' (far LOD only): topology-free clustering; the result still references original vertices.
const [result, error] = flags.includes('Sloppy')
  ? MeshoptSimplifier.simplifySloppy(indices, positions, 3, lock, target, Number(errorText))
  : MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, 5, [0.6, 0.6, 0.6, 12, 12], lock, target,
      Number(errorText), flags);
const head = Buffer.alloc(8);
head.writeUInt32LE(result.length / 3, 0);
head.writeFloatLE(error, 4);
await writeFile(output, Buffer.concat([head, Buffer.from(result.buffer, result.byteOffset, result.byteLength)]));
console.log(JSON.stringify({ before: nt, after: result.length / 3, error, flags }));
