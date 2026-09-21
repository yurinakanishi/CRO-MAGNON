// Graft source-derived TRELLIS heads onto the retained character surface.
// The original binary, node hierarchy, inverse binds and every clip are kept.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { pack } from './motion-glb.mjs';
import {
  readSurface,
  keepBody,
  splitAtPlane,
  boundary,
  components,
  positionKey,
  mixVertex,
} from './female-face-geometry.mjs';
const revision = process.argv[2] || '08';
const keys = process.argv[3] ? [process.argv[3]] : ['cro-magnon-woman', 'neanderthal-woman'];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const spec = {
  'cro-magnon-woman': {
    cutY: 1.4,
    height: 0.32,
    width: 0.21,
    top: 1.67,
    front: 0.003,
    yaw: 0,
    neckZ: -0.12,
    matchExistingBraid: true,
  },
  'neanderthal-woman': {
    cutY: 1.315,
    height: 0.33,
    width: 0.2,
    top: 1.6,
    front: 0.094,
    yaw: 0,
    neckZ: -0.052,
  },
};
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
function rings(surface, y) {
  const e = boundary(surface.vertices, surface.triangles).filter((e) =>
    [e.i, e.j].every((i) => Math.abs(surface.vertices[i].p[1] - y) < 1e-6),
  );
  return components(
    surface.vertices,
    e.map((e) => ({ ids: [e.i, e.j, e.i] })),
  ).map((c) => {
    const unique = new Map();
    for (const t of c.triangles)
      for (const i of t.ids) unique.set(positionKey(surface.vertices[i].p), i);
    const ids = [...unique.values()],
      centre = [0, y, 0];
    for (const i of ids) {
      centre[0] += surface.vertices[i].p[0] / ids.length;
      centre[2] += surface.vertices[i].p[2] / ids.length;
    }
    return { ids, centre, min: c.min, max: c.max };
  });
}
function angular(vertices, ring, centre) {
  return ring
    .map((id) => ({
      id,
      a: Math.atan2(vertices[id].p[2] - centre[2], vertices[id].p[0] - centre[0]),
    }))
    .sort((a, b) => a.a - b.a);
}
function sampleRing(vertices, list, angle) {
  let k = list.findIndex((v) => v.a > angle);
  if (k < 0) k = 0;
  const b = list[k],
    a = list[(k + list.length - 1) % list.length];
  let aa = a.a,
    bb = b.a;
  if (bb <= aa) bb += Math.PI * 2;
  if (angle < aa) angle += Math.PI * 2;
  return mixVertex(vertices[a.id], vertices[b.id], (angle - aa) / (bb - aa));
}
for (const key of keys) {
  const cfg = spec[key],
    base = `assets/female-face-repair/${key}`,
    out = `${base}/work/revision-${revision}`;
  await mkdir(out, { recursive: true });
  const file = `${out}/model.glb`;
  try {
    await access(file);
    throw Error('Refusing to overwrite ' + file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const sourceFile = `public/models/${key}/model-human-r10.glb`,
    headFile = `${base}/work/${process.argv[4] || 'head-reduced-r04.glb'}`;
  const source = await readSurface(sourceFile),
    head = await readSurface(headFile),
    body = keepBody(source, cfg.cutY);
  const textureBytes = (s) => {
    const imageId =
        s.doc.textures[s.doc.materials[0].pbrMetallicRoughness.baseColorTexture.index].source,
      im = s.doc.images[imageId],
      v = s.doc.bufferViews[im.bufferView];
    return {
      imageId,
      bytes: s.binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength),
    };
  };
  const bodyImage = await sharp(textureBytes(source).bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const texel = (img, uv) => {
    const x = Math.max(0, Math.min(img.info.width - 1, Math.round(uv[0] * (img.info.width - 1)))),
      y = Math.max(0, Math.min(img.info.height - 1, Math.round(uv[1] * (img.info.height - 1))));
    return [...img.data.subarray((y * img.info.width + x) * 4, (y * img.info.width + x) * 4 + 3)];
  };
  let tintedBodyImage;
  if (cfg.matchExistingBraid) {
    const tintMask = new Uint8Array(bodyImage.info.width * bodyImage.info.height),
      occupied = new Uint8Array(tintMask.length),
      original = Buffer.from(bodyImage.data);
    let pixels = 0;
    for (const t of body.triangles) {
      const vs = t.ids.map((i) => body.vertices[i]),
        p = [0, 1, 2].map((k) => vs.reduce((s, v) => s + v.p[k], 0) / 3),
        braid = p[1] > 1.09 && p[0] > -0.025 && p[0] < 0.07 && p[2] < -0.178;
      const W = bodyImage.info.width,
        H = bodyImage.info.height,
        [[ax, ay], [bx, by], [cx, cy]] = vs.map((v) => [v.uv[0] * W, v.uv[1] * H]),
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-8) continue;
      for (
        let y = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        y <= Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
          x <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
          x++
        ) {
          const a = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / den,
            b = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / den;
          if (Math.min(a, b, 1 - a - b) < -1e-6) continue;
          const id = y * W + x,
            k = id * 4;
          occupied[id] = 1;
          if (!braid || tintMask[id]) continue;
          tintMask[id] = 1;
          pixels++;
          for (let c = 0; c < 3; c++)
            bodyImage.data[k + c] = Math.round(original[k + c] * [0.6, 0.42, 0.32][c]);
        }
    }
    const W = bodyImage.info.width,
      H = bodyImage.info.height;
    for (let pass = 0; pass < 3; pass++) {
      const previous = Buffer.from(bodyImage.data),
        mask = tintMask.slice();
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const id = y * W + x;
          if (mask[id] || occupied[id]) continue;
          const ns = [id - 1, id + 1, id - W, id + W].filter((i) => mask[i]);
          if (!ns.length) continue;
          for (let k = 0; k < 3; k++)
            bodyImage.data[id * 4 + k] = Math.round(
              ns.reduce((s, i) => s + previous[i * 4 + k], 0) / ns.length,
            );
          tintMask[id] = 1;
        }
    }
    tintedBodyImage = await sharp(bodyImage.data, {
      raw: { width: bodyImage.info.width, height: bodyImage.info.height, channels: 4 },
    })
      .png()
      .toBuffer();
    body.report.braidTintPixels = pixels;
  }
  if (cfg.retainBackHairZ !== undefined) {
    const upper = splitAtPlane(source, cfg.cutY),
      hair = splitAtPlane(
        { vertices: upper.vertices, triangles: upper.high },
        cfg.retainBackHairZ,
        2,
      ),
      mapping = new Map();
    const limited = splitAtPlane(
      { vertices: hair.vertices, triangles: hair.low },
      cfg.retainBackHairTop,
    );
    for (const tri of limited.low) {
      const ids = tri.ids.map((i) => {
        if (!mapping.has(i)) {
          mapping.set(i, body.vertices.length);
          body.vertices.push(limited.vertices[i]);
        }
        return mapping.get(i);
      });
      body.triangles.push({ ...tri, ids, retainedBackHair: true });
    }
    body.report.retainedBackHairTriangles = limited.low.length;
  }
  const { doc, binary } = source,
    headJoint = doc.skins[0].joints.findIndex((i) => doc.nodes[i].name === 'Head');
  assert.ok(headJoint >= 0);
  const oldRings = rings(body, cfg.cutY).filter(
    (r) => Math.abs(r.centre[0]) < 0.025 && Math.abs(r.centre[2] - cfg.neckZ) < 0.04,
  );
  oldRings.sort(
    (a, b) =>
      (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) - (a.max[0] - a.min[0]) * (a.max[2] - a.min[2]),
  );
  const oldRing = oldRings[0];
  assert.ok(oldRing && oldRing.ids.length >= 12, 'neck perimeter');
  const oldAngular = angular(body.vertices, oldRing.ids, oldRing.centre);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const v of head.vertices) {
    if (cfg.yaw) {
      v.p[0] *= -1;
      v.p[2] *= -1;
      v.n[0] *= -1;
      v.n[2] *= -1;
    }
    v.p.forEach((p, k) => {
      min[k] = Math.min(min[k], p);
      max[k] = Math.max(max[k], p);
    });
  }
  const scale = [
    cfg.width / (max[0] - min[0]),
    cfg.height / (max[1] - min[1]),
    cfg.width / (max[0] - min[0]),
  ];
  for (const v of head.vertices) {
    v.p = [
      (v.p[0] - (min[0] + max[0]) / 2) * scale[0],
      cfg.top + (v.p[1] - max[1]) * scale[1],
      cfg.front + (v.p[2] - max[2]) * scale[2],
    ];
    const n = v.n.map((x, k) => x / scale[k]),
      l = Math.hypot(...n);
    v.n = n.map((x) => x / l);
  }
  const headCut = cfg.cutY,
    cut = splitAtPlane(head, headCut),
    upper = { vertices: cut.vertices, triangles: cut.high };
  if (cfg.matchExistingBraid)
    upper.triangles.push(
      ...cut.low.filter((t) => t.ids.every((i) => cut.vertices[i].p[2] < -0.19)),
    );
  if (cfg.trimPonytailY) {
    const back = splitAtPlane(upper, cfg.trimPonytailZ, 2),
      top = splitAtPlane({ vertices: back.vertices, triangles: back.low }, cfg.trimPonytailY);
    upper.vertices = top.vertices;
    upper.triangles = [...back.high, ...top.high];
  }
  const newRings = rings(upper, headCut).filter(
    (r) => Math.abs(r.centre[0]) < 0.04 && r.centre[2] > cfg.neckZ - 0.045,
  );
  newRings.sort(
    (a, b) =>
      (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) - (a.max[0] - a.min[0]) * (a.max[2] - a.min[2]),
  );
  const newRing = newRings[0];
  assert.ok(newRing, 'new neck perimeter');
  // Lower 45 mm conform to the measured old neck; facial vertices stay untouched.
  const rawAngular = angular(upper.vertices, newRing.ids, newRing.centre);
  const rawVertices = upper.vertices.map((v) => ({
    ...v,
    p: [...v.p],
    n: [...v.n],
    uv: [...v.uv],
  }));
  for (const v of upper.vertices) {
    if (v.p[2] < newRing.min[2] - 0.025) {
      v.j = [headJoint, 0, 0, 0];
      v.w = [1, 0, 0, 0];
      continue;
    }
    const t = smooth((v.p[1] - headCut) / 0.045),
      a = Math.atan2(v.p[2] - newRing.centre[2], v.p[0] - newRing.centre[0]);
    const old = sampleRing(body.vertices, oldAngular, a),
      raw = sampleRing(rawVertices, rawAngular, a);
    v.p[0] += (old.p[0] - raw.p[0]) * (1 - t);
    v.p[2] += (old.p[2] - raw.p[2]) * (1 - t);
    const normal = v.n.map((n, k) => n * t + old.n[k] * (1 - t)),
      nl = Math.hypot(...normal);
    v.n = normal.map((n) => n / nl);
    const skin = smooth((v.p[1] - cfg.cutY) / 0.065),
      weighted = mixVertex(old, { ...old, j: [headJoint, 0, 0, 0], w: [1, 0, 0, 0] }, skin);
    v.j = weighted.j;
    v.w = weighted.w;
  }
  // Match the actual body atlas at the neck boundary, fading to the generated
  // head albedo over 6 cm. This prevents a painted collar around the graft.
  const headImageInfo = textureBytes(head),
    headImage = await sharp(headImageInfo.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  const targets = oldAngular.map(({ id, a }) => ({
    a,
    rgb: texel(bodyImage, body.vertices[id].uv),
  }));
  const nearestColour = (a) =>
    targets.reduce(
      (best, v) => {
        const d = Math.abs(Math.atan2(Math.sin(v.a - a), Math.cos(v.a - a)));
        return d < best.d ? { d, rgb: v.rgb } : best;
      },
      { d: Infinity },
    ).rgb;
  const W = headImage.info.width,
    H = headImage.info.height,
    occupied = new Uint8Array(W * H),
    changed = new Uint8Array(W * H);
  for (const tri of upper.triangles) {
    const vs = tri.ids.map((i) => upper.vertices[i]),
      neck = !(
        vs.every((v) => v.p[1] > cfg.cutY + 0.065) ||
        vs.every((v) => v.p[2] < newRing.min[2] - 0.02)
      );
    const [[ax, ay], [bx, by], [cx, cy]] = vs.map((v) => [v.uv[0] * W, v.uv[1] * H]),
      den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-8) continue;
    for (
      let y = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      y <= Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        x <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
        x++
      ) {
        const a = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / den,
          b = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / den,
          c = 1 - a - b;
        if (Math.min(a, b, c) < -1e-6) continue;
        occupied[y * W + x] = 1;
        if (!neck) continue;
        const p = [0, 1, 2].map((k) => vs[0].p[k] * a + vs[1].p[k] * b + vs[2].p[k] * c),
          alpha = 1 - smooth((p[1] - headCut) / 0.055);
        if (alpha <= 0 || p[2] < newRing.min[2] - 0.02) continue;
        const colour = nearestColour(
            Math.atan2(p[2] - oldRing.centre[2], p[0] - oldRing.centre[0]),
          ),
          offset = (y * W + x) * 4;
        for (let k = 0; k < 3; k++)
          headImage.data[offset + k] = Math.round(
            headImage.data[offset + k] * (1 - alpha) + colour[k] * alpha,
          );
        changed[y * W + x] = 1;
      }
  }
  for (let pass = 0; pass < 3; pass++) {
    const previous = Buffer.from(headImage.data),
      mask = changed.slice();
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const id = y * W + x;
        if (mask[id] || occupied[id]) continue;
        const ns = [id - 1, id + 1, id - W, id + W].filter((i) => mask[i]);
        if (!ns.length) continue;
        for (let k = 0; k < 3; k++)
          headImage.data[id * 4 + k] = Math.round(
            ns.reduce((s, i) => s + previous[i * 4 + k], 0) / ns.length,
          );
        changed[id] = 1;
      }
  }
  const neckImage = await sharp(headImage.data, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
  await writeFile(`${out}/neck-albedo.png`, neckImage);
  // Bridge both measured perimeters; lower vertices retain exact original skin.
  const headVertices = upper.vertices.map((v) => ({ ...v })),
    headTris = upper.triangles.map((t) => ({ ...t, ids: [...t.ids] }));
  const newAngular = angular(headVertices, newRing.ids, oldRing.centre),
    lower = [];
  const skinPoint = upper.vertices
    .filter((v) => v.p[1] >= headCut && v.p[1] < headCut + 0.02 && Math.abs(v.p[0]) < 0.01)
    .sort((a, b) => b.p[2] - a.p[2])[0];
  assert.ok(skinPoint);
  // A bridge crosses UV islands. Use one measured skin texel rather than
  // interpolating through unrelated hair texels between separate UV charts.
  const bridgeUpper = newAngular.map(({ id, a }) => {
    const index = headVertices.length;
    headVertices.push({ ...headVertices[id], uv: [...skinPoint.uv] });
    return { id: index, a };
  });
  for (const { id, a } of oldAngular) {
    const v = body.vertices[id],
      index = headVertices.length;
    headVertices.push({ ...v, uv: [...skinPoint.uv] });
    lower.push({ id: index, a });
  }
  // Clockwise viewed from above gives outward strip normals with this ordering.
  let i = 0,
    j = 0;
  const lo = lower,
    hi = bridgeUpper;
  const add = (a, b, c) => {
    const p = headVertices[a].p,
      q = headVertices[b].p,
      r = headVertices[c].p;
    const n = [
      (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
      (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]),
    ];
    const outward =
      n[0] * ((p[0] + q[0] + r[0]) / 3 - oldRing.centre[0]) +
      n[2] * ((p[2] + q[2] + r[2]) / 3 - oldRing.centre[2]);
    headTris.push({ ids: outward < 0 ? [a, c, b] : [a, b, c], bridge: true });
  };
  while (i < lo.length || j < hi.length) {
    const ni = i < lo.length ? (i + 1 < lo.length ? lo[i + 1].a : lo[0].a + Math.PI * 2) : Infinity,
      nj = j < hi.length ? (j + 1 < hi.length ? hi[j + 1].a : hi[0].a + Math.PI * 2) : Infinity;
    if (ni <= nj) {
      add(lo[i % lo.length].id, lo[(i + 1) % lo.length].id, hi[j % hi.length].id);
      i++;
    } else {
      add(lo[i % lo.length].id, hi[(j + 1) % hi.length].id, hi[j % hi.length].id);
      j++;
    }
  }
  const parts = [binary];
  let offset = binary.length;
  function view(bytes, target) {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      offset += pad;
    }
    const id = doc.bufferViews.length;
    doc.bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      ...(target ? { target } : {}),
    });
    parts.push(bytes);
    offset += bytes.length;
    return id;
  }
  function accessor(values, width, type, component = 5126) {
    const array =
      component === 5123
        ? new Uint16Array(values)
        : component === 5125
          ? new Uint32Array(values)
          : new Float32Array(values);
    const a = {
      bufferView: view(Buffer.from(array.buffer), width === 1 ? 34963 : 34962),
      componentType: component,
      count: values.length / width,
      type,
    };
    if (type === 'VEC3') {
      a.min = Array.from({ length: 3 }, (_, k) => Infinity);
      a.max = a.min.map(() => -Infinity);
      for (let i = 0; i < values.length; i++) {
        a.min[i % 3] = Math.min(a.min[i % 3], values[i]);
        a.max[i % 3] = Math.max(a.max[i % 3], values[i]);
      }
    }
    doc.accessors.push(a);
    return doc.accessors.length - 1;
  }
  function primitive(vertices, tris, material) {
    const ids = [],
      seen = new Map(),
      p = [],
      n = [],
      uv = [],
      j = [],
      w = [];
    for (const t of tris)
      for (const id of t.ids) {
        let idx = seen.get(id);
        if (idx === undefined) {
          idx = seen.size;
          seen.set(id, idx);
          const v = vertices[id];
          p.push(...v.p);
          n.push(...v.n);
          uv.push(...v.uv);
          j.push(...v.j);
          w.push(...v.w);
        }
        ids.push(idx);
      }
    return {
      attributes: {
        POSITION: accessor(p, 3, 'VEC3'),
        NORMAL: accessor(n, 3, 'VEC3'),
        TEXCOORD_0: accessor(uv, 2, 'VEC2'),
        JOINTS_0: accessor(j, 4, 'VEC4', 5123),
        WEIGHTS_0: accessor(w, 4, 'VEC4'),
      },
      indices: accessor(ids, 1, 'SCALAR', 5125),
      material,
    };
  }
  const imageOffset = doc.images.length,
    textureOffset = doc.textures.length,
    samplerOffset = doc.samplers?.length || 0;
  doc.samplers ??= [];
  doc.samplers.push(...(head.doc.samplers || []));
  for (const [imageIndex, im] of head.doc.images.entries()) {
    const v = head.doc.bufferViews[im.bufferView],
      bytes =
        imageIndex === headImageInfo.imageId
          ? neckImage
          : head.binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    doc.images.push({
      ...im,
      mimeType: imageIndex === headImageInfo.imageId ? 'image/png' : im.mimeType,
      bufferView: view(bytes),
    });
  }
  for (const tex of head.doc.textures)
    doc.textures.push({
      ...tex,
      source: tex.source + imageOffset,
      ...(tex.sampler === undefined ? {} : { sampler: tex.sampler + samplerOffset }),
    });
  const mat = structuredClone(head.doc.materials[0]);
  mat.name = 'TRELLIS reconstructed head';
  mat.pbrMetallicRoughness.metallicFactor = 0;
  const remap = (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.endsWith('Texture') && v && typeof v.index === 'number') v.index += textureOffset;
      else if (v && typeof v === 'object') remap(v);
    }
  };
  remap(mat);
  const material = doc.materials.length;
  doc.materials.push(mat);
  for (const field of ['extensionsUsed', 'extensionsRequired'])
    if (head.doc[field]) doc[field] = [...new Set([...(doc[field] || []), ...head.doc[field]])];
  let bodyMaterial = 0;
  if (tintedBodyImage) {
    const original = doc.materials[0],
      texture = doc.textures[original.pbrMetallicRoughness.baseColorTexture.index],
      image = doc.images.length;
    doc.images.push({ bufferView: view(tintedBodyImage), mimeType: 'image/png' });
    const index = doc.textures.length;
    doc.textures.push({ ...texture, source: image });
    const clone = structuredClone(original);
    clone.name = 'Original body with matched braid colour';
    clone.pbrMetallicRoughness.baseColorTexture.index = index;
    bodyMaterial = doc.materials.length;
    doc.materials.push(clone);
  }
  doc.meshes[0].primitives = [
    primitive(body.vertices, body.triangles, bodyMaterial),
    primitive(headVertices, headTris, material),
  ];
  doc.buffers[0].byteLength = offset;
  const bytes = pack(doc, Buffer.concat(parts));
  await writeFile(file, bytes);
  const record = {
    key,
    revision,
    sha256: sha(bytes),
    bytes: bytes.length,
    triangles: body.triangles.length + headTris.length,
    source: sourceFile,
    sourceSha256: sha(source.bytes),
    headSource: headFile,
    headSha256: sha(head.bytes),
    config: cfg,
    headSourceBounds: { min, max },
    scale,
    originalBinaryPrefix: binary.length,
    unchanged: [
      'nodes',
      'skins',
      'animations',
      'original material and texture bytes',
      'retained body vertex attributes',
    ],
    body: body.report,
    neck: { old: oldRing, new: newRing },
    headTriangles: headTris.length,
  };
  await writeFile(`${out}/build.json`, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ key, file, sha256: record.sha256, triangles: record.triangles }));
}
