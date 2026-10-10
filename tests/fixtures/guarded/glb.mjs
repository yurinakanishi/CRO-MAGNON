// Tiny real GLBs for the guarded-surface@1 tests: a connected, coherently wound grid facing +Z with
// normals, UVs and a material whose base colour is an embedded PNG. None is a game asset.
import { packGlb, padding4 } from '../../../scripts/optimization/glb.mjs';
import { pngFile } from '../../exact-repack-fixtures.mjs';

const bytesOf = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

/**
 * A cols x rows grid in the unit square (2 x cols x rows triangles). `generator` varies the bytes.
 * `clip` (a name) adds one linear translation clip on the mesh node: one applicable channel.
 */
export function gridGlb({
  name,
  cols,
  rows,
  generator = 'guarded fixture',
  image = pngFile({ width: 4, height: 4 }),
  clip = null,
}) {
  const count = (cols + 1) * (rows + 1),
    positions = new Float32Array(3 * count),
    normals = new Float32Array(3 * count),
    uvs = new Float32Array(2 * count),
    indices = [];
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const v = r * (cols + 1) + c;
      positions.set([c / cols, r / rows, 0], 3 * v);
      normals.set([0, 0, 1], 3 * v);
      uvs.set([c / cols, r / rows], 2 * v);
    }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c,
        b = a + 1,
        d = a + cols + 1,
        e = d + 1;
      indices.push(a, b, e, a, e, d);
    }
  const parts = [
      [
        bytesOf(positions),
        { componentType: 5126, count, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        34962,
      ],
      [bytesOf(normals), { componentType: 5126, count, type: 'VEC3' }, 34962],
      [bytesOf(uvs), { componentType: 5126, count, type: 'VEC2' }, 34962],
      [
        bytesOf(Uint16Array.from(indices)),
        { componentType: 5123, count: indices.length, type: 'SCALAR' },
        34963,
      ],
      [image, null],
      ...(clip
        ? [
            [
              bytesOf(Float32Array.from([0, 1])),
              { componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
            ],
            [
              bytesOf(Float32Array.from([0, 0, 0, 0, 0.5, 0])),
              { componentType: 5126, count: 2, type: 'VEC3' },
            ],
          ]
        : []),
    ],
    json = {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name, mesh: 0 }],
      meshes: [
        {
          name,
          primitives: [
            { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
          ],
        },
      ],
      materials: [
        {
          name: `${name} surface`,
          pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 },
        },
      ],
      textures: [{ source: 0 }],
      images: [{ bufferView: 4, mimeType: 'image/png' }],
      ...(clip
        ? {
            animations: [
              {
                name: clip,
                samplers: [{ input: 4, output: 5, interpolation: 'LINEAR' }],
                channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
              },
            ],
          }
        : {}),
      bufferViews: [],
      accessors: [],
    },
    chunks = [];
  let length = 0;
  for (const [bytes, accessor, target] of parts) {
    const pad = padding4(length);
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      length += pad;
    }
    json.bufferViews.push({
      buffer: 0,
      byteOffset: length,
      byteLength: bytes.length,
      ...(target ? { target } : {}),
    });
    chunks.push(bytes);
    length += bytes.length;
    if (accessor) json.accessors.push({ bufferView: json.bufferViews.length - 1, ...accessor });
  }
  json.buffers = [{ byteLength: length }];
  return packGlb(json, Buffer.concat(chunks, length));
}

/** Triangles of a gridGlb. */
export const gridTriangles = (cols, rows) => 2 * cols * rows;
