import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { geometryScene } from '../scripts/measure-collision-bounds.mjs';
import { coastDistance, coastTextureData, isLand } from '../dist/shared/paleo-geography.mjs';
import { WORLD } from '../dist/shared/world.mjs';
import { BIOMES, biomeById, chunkAt, chunkDescription } from '../dist/shared/biomes.mjs';
import {
  CAMP_MOUNTAIN,
  CAMP_MOUNTAIN_TRAIL,
  CAVE_APPROACH,
  CAVE_MURAL_VIEW,
  caveWorldAt,
} from '../dist/shared/camp-cave-layout.mjs';
import { CASTLE_GATE } from '../dist/shared/castle-layout.mjs';
import { sourceMountainX, sourceMountainZ } from '../dist/shared/mountain-expansion.mjs';
import { mountainHeight } from '../dist/shared/camp-mountain.mjs';
import { installBiomeTerrain, walkHeight } from '../dist/shared/terrain.mjs';
import { BOATING, waterBodyFree } from '../dist/shared/boats.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { measureSourceRiverBankFit } from '../dist/src/source-surface-fit.js';
import {
  COAST_STAND_IN,
  COAST_TREATMENT_METRES,
  EarthOcean,
  OCEAN_SURFACE_Y,
  clipAtCoast,
  clipRiverAtCoast,
  createEarthTextures,
  earthTerrainMaterial,
} from '../dist/src/paleo-materials.js';
import { coastalChunk } from '../dist/src/open-world.js';
import { prepareMountainMaterials } from '../dist/src/mountain-materials.js';

// These checks cover the data, geometry and generated GLSL the renderer relies on. They do not
// rasterize: the pixels are verified in Chrome (touch-boat-visual-r03 and its follow-ups).

// Chrome touch QA touch-boat-visual-r03: the launch shore, the verified mooring, the settled hull
// photographed under a green surface (server coastDistance -2.3235), and where the player stood
// after landing (rendered y -0.517 under the camp mountain's flat apron at y 0).
const SHORE = { x: 138, z: 112 };
const MOORING = { x: 141.74161325536144, z: 114.50006604858821 };
const HULL = { x: 141.74161325536144, z: 119.98106604858833 };
const RECOVERED = { x: 139.39686894866827, z: 112.93335799147293 };
const HULL_ROOT_Y = -0.7919575450583465; // the canoe's root in that capture; it is 0.948 m tall

const textures = createEarthTextures();
after(() => textures.dispose());

// A material's shaders as Three hands them to onBeforeCompile (before includes are resolved).
function compile(material, template = THREE.ShaderLib.standard) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(template.uniforms),
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
}

// shoreline() of a generated fragment shader, evaluated as the GPU samples it: the earthUV and
// decode constants are read from the GLSL, the texel data from the bound DataTexture, with
// linear filtering and clamp-to-edge addressing (8-bit filter weights are not modelled).
function shaderShoreline(fragmentShader, texture) {
  const uv = fragmentShader.match(
    /vec2 earthUV\(vec2 p\)\{return \(p-vec2\(([-\d.]+),([-\d.]+)\)\)\/vec2\(([-\d.]+),([-\d.]+)\);\}/,
  );
  const decode = fragmentShader.match(
    /float shoreline\(vec2 p\)\{return \(texture2D\(earthCoast,earthUV\(p\)\)\.r\*([\d.]+)-([\d.]+)\)\/([\d.]+);\}/,
  );
  assert.ok(uv && decode, 'the shader declares the shared shoreline field');
  const [minX, minZ, width, depth] = uv.slice(1).map(Number),
    [scale, offset, divisor] = decode.slice(1).map(Number);
  assert.equal(texture.minFilter, THREE.LinearFilter);
  assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(texture.format, THREE.RedFormat);
  assert.equal(texture.type, THREE.UnsignedByteType);
  assert.equal(texture.flipY, false);
  const { data, width: w, height: h } = texture.image;
  const texel = (i, j) =>
    data[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))] / 255;
  return (x, z) => {
    const s = ((x - minX) / width) * w - 0.5,
      t = ((z - minZ) / depth) * h - 0.5,
      i = Math.floor(s),
      j = Math.floor(t),
      fx = s - i,
      fz = t - j;
    const r =
      (texel(i, j) * (1 - fx) + texel(i + 1, j) * fx) * (1 - fz) +
      (texel(i, j + 1) * (1 - fx) + texel(i + 1, j + 1) * fx) * fz;
    return (r * scale - offset) / divisor;
  };
}

// The camp-mountain fragment rule as compiled: (x, y, z) of a fragment -> discarded.
function mountainDiscard(fragmentShader, texture) {
  const shoreline = shaderShoreline(fragmentShader, texture);
  const rule = fragmentShader.match(
    /\n(float coastWorld=shoreline\(vCoastWorld\.xz\);if\(coastWorld<=0\.0\|\|\(coastWorld<([\d.]+)&&vCoastWorld\.y<=([\d.]+)\)\)discard;)/,
  );
  assert.ok(rule, 'the flat-ground coast rule is compiled');
  assert.ok(
    fragmentShader.indexOf(rule[1]) > fragmentShader.indexOf('#include <color_fragment>'),
    'after the colour, like the ground clip',
  );
  const metres = Number(rule[2]),
    flatY = Number(rule[3]);
  assert.deepEqual(
    { metres, flatY },
    { metres: COAST_STAND_IN.metres, flatY: COAST_STAND_IN.flatY },
  );
  return (x, y, z) => {
    const s = shoreline(x, z);
    return s <= 0 || (s < metres && y <= flatY);
  };
}

function compileMountain() {
  const material = new THREE.MeshStandardMaterial(),
    root = new THREE.Group().add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  const roof = prepareMountainMaterials(root, textures);
  return { material, roof, shader: compile(material) };
}

// Points every 5 cm along the given stops.
function along(stops) {
  const points = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1],
      b = stops[i],
      n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
    for (let k = i === 1 ? 0 : 1; k <= n; k++)
      points.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return points;
}
// From 8 m inland through the shore, the landing, the mooring and the hull to 10 m further out.
const transect = () =>
  along([
    { x: SHORE.x - 8, z: SHORE.z },
    SHORE,
    RECOVERED,
    MOORING,
    HULL,
    { x: HULL.x + 10, z: HULL.z },
  ]);

test('the photographed hull floats at sea and its launch shore is land, by every physics rule', () => {
  assert.ok(Math.abs(coastDistance(HULL.x, HULL.z) - -2.3235067751620235) < 1e-9);
  for (const p of [MOORING, HULL]) {
    assert.equal(isLand(p.x, p.z), false);
    assert.ok(waterBodyFree(p.x, p.z, BOATING.radius), `${p.x},${p.z} holds the whole hull`);
  }
  for (const p of [SHORE, RECOVERED]) {
    assert.ok(isLand(p.x, p.z));
    assert.ok(new CollisionWorld().free(p, 0.32));
  }
  // The camp mountain's height field carries neither point: its flattened apron is not physical
  // ground there (terrainHeight walks on the ground below hill heights of COAST_STAND_IN.flatY).
  for (const p of [HULL, RECOVERED])
    assert.ok(mountainHeight(p.x, p.z) <= COAST_STAND_IN.flatY, `${p.x},${p.z}`);
});

test('ground, river and ocean shaders read the physics shoreline: land kept, sea discarded, sea covered', () => {
  assert.equal(textures.coast.image.data, coastTextureData().data, 'one shoreline array');
  const ground = compile(
    earthTerrainMaterial(new THREE.MeshStandardMaterial(), biomeById('grassland'), textures),
  );
  assert.equal(ground.uniforms.earthCoast.value, textures.coast);
  // Every non-instanced ground mesh (fitted river banks) is clipped; instances by earthCoastal.
  assert.ok(
    ground.vertexShader.includes(
      'vCoastal=1.0;\n      #ifdef USE_INSTANCING\n      earthPoint=instanceMatrix*earthPoint;\n      vCoastal=earthCoastal;',
    ),
  );
  assert.ok(
    ground.fragmentShader.includes(
      'float coast=32.0;if(vCoastal>.5)coast=shoreline(vTerrainWorld.xz);if(coast<=0.0)discard;',
    ),
  );
  const river = compile(
    Object.assign(new THREE.MeshStandardMaterial(), {
      onBeforeCompile: (shader) => clipRiverAtCoast(shader, textures),
    }),
  );
  assert.equal(river.uniforms.earthCoast.value, textures.coast);
  assert.ok(river.fragmentShader.includes('if(shoreline(vCoastWorld.xz)<=0.0)discard;'));
  // The ocean is the accepted river-water tile; a flat stand-in is enough to compile its shader.
  const scene = new THREE.Scene(),
    tile = new THREE.Group().add(
      new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
    );
  const ocean = new EarthOcean(
    { scene, worldAssets: { get: () => ({ gltf: { scene: tile } }) } },
    textures,
    4,
  );
  try {
    const water = compile(ocean.parts[0].material);
    assert.equal(water.uniforms.earthCoast.value, textures.coast);
    assert.ok(water.fragmentShader.includes('float d=shoreline(vOceanWorld.xz);if(d>1.5)discard;'));
    const groundLine = shaderShoreline(ground.fragmentShader, textures.coast),
      riverLine = shaderShoreline(river.fragmentShader, textures.coast),
      waterLine = shaderShoreline(water.fragmentShader, textures.coast);
    let land = 0,
      sea = 0;
    for (const p of transect()) {
      const physics = coastDistance(p.x, p.z);
      for (const line of [groundLine, riverLine, waterLine])
        assert.ok(Math.abs(line(p.x, p.z) - physics) < 1e-9, `${p.x},${p.z}`);
      const discarded = groundLine(p.x, p.z) <= 0;
      assert.equal(discarded, !isLand(p.x, p.z), `ground and walking agree at ${p.x},${p.z}`);
      if (discarded) {
        // Drawn by the ocean shader, on the tile of a chunk that is given one.
        const cell = chunkAt(p.x, p.z);
        assert.ok(waterLine(p.x, p.z) <= 1.5, `the ocean covers ${p.x},${p.z}`);
        assert.ok(coastalChunk(chunkDescription(cell.x, cell.z)), `ocean tile at ${p.x},${p.z}`);
      }
      if (discarded) sea++;
      else land++;
    }
    assert.ok(land > 20 && sea > 20, `${land} land and ${sea} sea samples`);
    assert.ok(groundLine(HULL.x, HULL.z) <= 0 && groundLine(SHORE.x, SHORE.z) > 0);
    // The hull's chunk is drawn, clipped, and given an ocean tile whose 34 m footprint covers it.
    const cell = chunkAt(HULL.x, HULL.z),
      chunk = chunkDescription(cell.x, cell.z);
    assert.ok(chunk.land && coastalChunk(chunk));
    ocean.update([chunk], 0);
    const mesh = ocean.parts[0].mesh,
      placed = new THREE.Matrix4();
    assert.equal(mesh.count, 1);
    mesh.getMatrixAt(0, placed);
    const at = new THREE.Vector3().setFromMatrixPosition(placed);
    // Instance matrices are stored as 32-bit floats.
    assert.deepEqual([at.x, at.y, at.z], [chunk.x, Math.fround(OCEAN_SURFACE_Y), chunk.z]);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    assert.ok(box.containsPoint(new THREE.Vector3(HULL.x - chunk.x, box.min.y, HULL.z - chunk.z)));
  } finally {
    ocean.dispose();
  }
});

// The exact minimum of coastDistance over a chunk's 32 m tile. The field is bilinear between
// samples at min + (i + 0.5) * cell; over a rectangle its minimum lies at a sample, a corner, or
// where an edge crosses a sample line.
function tileMinimum(x, z) {
  const grid = coastTextureData(),
    half = WORLD.chunkSize / 2;
  const lines = (low, high, origin) => {
    const values = [low, high];
    for (
      let i = Math.ceil((low - origin) / grid.cell - 0.5);
      origin + (i + 0.5) * grid.cell <= high;
      i++
    )
      values.push(origin + (i + 0.5) * grid.cell);
    return values;
  };
  let minimum = Infinity;
  for (const px of lines(x - half, x + half, grid.minX))
    for (const pz of lines(z - half, z + half, grid.minZ))
      minimum = Math.min(minimum, coastDistance(px, pz));
  return minimum;
}

test('every chunk drawn without coast clipping keeps its whole tile on land', (t) => {
  const size = WORLD.chunkSize,
    centre = (ix, iz) => ({ x: WORLD.minX + (ix + 0.5) * size, z: WORLD.minZ + (iz + 0.5) * size });
  // Codex's counterexample (shore-related-tests-r03): at the western end of the measured Earth
  // grid the field drops from far inland to open water within one cell, so this tile centre lies
  // over 26 m inland while its western edge is at sea.
  const edge = centre(64, 39),
    edgeMinimum = tileMinimum(edge.x, edge.z);
  assert.ok(coastDistance(edge.x, edge.z) >= 26);
  assert.ok(edgeMinimum < 0, `its tile reaches ${edgeMinimum} m (r03 reported -0.75 m)`);
  assert.equal(coastalChunk(edge), true, 'its ground is clipped at the sea');
  let unclipped = 0,
    nearest = Infinity;
  for (let ix = 0; ix < WORLD.width / size; ix++)
    for (let iz = 0; iz < WORLD.depth / size; iz++) {
      const { x, z } = centre(ix, iz);
      if (coastalChunk({ x, z })) continue;
      unclipped++;
      // Beyond the whole coast treatment, so its plain shading equals the coastal shading
      // (up to the rounding of the bilinear weights).
      const minimum = tileMinimum(x, z);
      assert.ok(
        minimum >= COAST_TREATMENT_METRES - 1e-9,
        `chunk ${ix},${iz} is drawn without the coast treatment ${minimum} m from the sea`,
      );
      nearest = Math.min(nearest, minimum);
    }
  assert.ok(unclipped > 1000);
  t.diagnostic(`${unclipped} unclipped chunks; closest tile point to the sea ${nearest} m inland`);
});

test('coast clipping binds the shared field and ends the surface where the shoreline reaches zero', () => {
  assert.equal(clipRiverAtCoast, clipAtCoast);
  assert.throws(
    () => clipAtCoast(compile(new THREE.MeshStandardMaterial()), undefined),
    /coast field/,
  );
  assert.throws(
    () =>
      clipAtCoast({ uniforms: {}, vertexShader: 'void main(){}', fragmentShader: '' }, textures),
    /begin_vertex/,
  );
  for (const flatGround of [false, true]) {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    clipAtCoast(shader, textures, { flatGround });
    assert.equal(shader.uniforms.earthCoast.value, textures.coast);
    const vertex = shader.vertexShader,
      fragment = shader.fragmentShader;
    // The world position includes the instance matrix when there is one.
    assert.ok(
      vertex.indexOf('vCoastWorld=(modelMatrix*coastPoint).xyz;') >
        vertex.indexOf('#include <begin_vertex>'),
    );
    assert.ok(vertex.includes('#ifdef USE_INSTANCING\n    coastPoint=instanceMatrix*coastPoint;'));
    const plain = fragment.indexOf('if(shoreline(vCoastWorld.xz)<=0.0)discard;');
    if (flatGround) {
      assert.equal(plain, -1);
      const discarded = mountainDiscard(fragment, textures.coast);
      assert.ok(discarded(HULL.x, 30, HULL.z) && !discarded(SHORE.x, 0.03, SHORE.z));
    } else {
      assert.ok(plain > fragment.indexOf('#include <color_fragment>'));
      const line = shaderShoreline(fragment, textures.coast);
      assert.ok(line(HULL.x, HULL.z) <= 0 && line(SHORE.x, SHORE.z) > 0);
    }
  }
});

test('the camp-mountain material ends at the sea and its flat apron gives way to the ground ashore', () => {
  assert.throws(() => prepareMountainMaterials(new THREE.Group(), undefined), /coast field/);
  const { material, roof, shader } = compileMountain();
  try {
    assert.equal(shader.uniforms.earthCoast?.value, textures.coast, 'the shared coast field');
    assert.equal(
      material.customProgramCacheKey(),
      'camp-mountain-river-v11-measured-mouth-coast-1',
    );
    // The source surface treatments are kept: river rock, cave-mouth envelope, world-space hill.
    assert.ok(shader.vertexShader.includes('hillPosition=position;vRiverCut=riverCut;'));
    assert.ok(shader.vertexShader.includes('vCoastWorld=(modelMatrix*coastPoint).xyz;'));
    assert.ok(shader.fragmentShader.includes('roofHeight>1.3'));
    assert.ok(shader.fragmentShader.includes('diffuseColor.rgb=meadowGreen(diffuseColor.rgb,p);'));
    const discarded = mountainDiscard(shader.fragmentShader, textures.coast);
    // At sea nothing of the mountain is drawn.
    for (const p of [MOORING, HULL])
      for (const y of [-1.1, 0, 0.5, 40]) assert.ok(discarded(p.x, y, p.z));
    // Ashore within the coast band its flat apron yields to the coast-lowered ground; actual
    // mountain surfaces above flatY stay.
    const band = coastDistance(RECOVERED.x, RECOVERED.z);
    assert.ok(band > 0 && band < COAST_STAND_IN.metres, `${band} m`);
    for (const y of [-0.3, 0, COAST_STAND_IN.flatY])
      assert.ok(discarded(RECOVERED.x, y, RECOVERED.z));
    for (const y of [COAST_STAND_IN.flatY + 0.001, 1, 30])
      assert.ok(!discarded(RECOVERED.x, y, RECOVERED.z));
    // The cave interior, its roof, entrance and apron, the trail and the castle gate lie far from
    // any shore: every surface there stays exactly as before.
    const inland = [
      ...CAMP_MOUNTAIN_TRAIL,
      ...CAVE_APPROACH,
      CAVE_MURAL_VIEW,
      CASTLE_GATE,
      ...[16, 10, 0, -10, -20, -31].map((z) => caveWorldAt(z)),
    ];
    for (const p of inland) {
      assert.ok(coastDistance(p.x, p.z) >= COAST_STAND_IN.metres, `${p.x},${p.z} is inland`);
      for (const y of [-1.1, 0, COAST_STAND_IN.flatY, 12, 40]) assert.ok(!discarded(p.x, y, p.z));
    }
  } finally {
    roof.dispose();
  }
});

// The camp-mountain level geometry as the game draws it: the delivered mesh at its placement,
// fitted by the shared source-surface fit (expanded mountain x/z, cave foot, river bed). Only the
// source triangles around the given world points are fitted; the expansion is affine there
// (cave-hill width 2.6 for z 80-140), so their fitted images are exactly the drawn ones.
async function fittedMountain(url, points) {
  const { scene } = await geometryScene(`public${url}`);
  scene.updateMatrixWorld(true);
  const placement = new THREE.Matrix4()
    .makeRotationY(CAMP_MOUNTAIN.yaw)
    .setPosition(CAMP_MOUNTAIN.x, 0, CAMP_MOUNTAIN.z);
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    const z = sourceMountainZ(p.z),
      x = sourceMountainX(p.x, z);
    minX = Math.min(minX, x - 3);
    maxX = Math.max(maxX, x + 3);
    minZ = Math.min(minZ, z - 3);
    maxZ = Math.max(maxZ, z + 3);
  }
  const patch = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const source = node.geometry.clone().applyMatrix4(placement.clone().multiply(node.matrixWorld)),
      p = source.attributes.position,
      index = source.index,
      count = index ? index.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const corners = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      const xs = corners.map((v) => p.getX(v)),
        zs = corners.map((v) => p.getZ(v));
      if (Math.max(...xs) < minX || Math.min(...xs) > maxX) continue;
      if (Math.max(...zs) < minZ || Math.min(...zs) > maxZ) continue;
      for (const v of corners) patch.push(p.getX(v), p.getY(v), p.getZ(v));
    }
    source.dispose();
    node.geometry.dispose();
  });
  assert.ok(patch.length, `${url} has source triangles there`);
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute(patch, 3));
  const { geometry, stats } = measureSourceRiverBankFit(source, 0.45, true);
  source.dispose();
  assert.equal(stats.noOp, false, 'the mountain fit deforms this patch');
  const p = geometry.attributes.position,
    index = geometry.index,
    count = index ? index.count : p.count,
    triangles = [];
  for (let i = 0; i < count; i += 3)
    triangles.push(
      [0, 1, 2].map((k) => {
        const v = index ? index.getX(i + k) : i + k;
        return [p.getX(v), p.getY(v), p.getZ(v)];
      }),
    );
  geometry.dispose();
  // Every drawn surface height over (x, z).
  return (x, z) => {
    const heights = [];
    for (const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] of triangles) {
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (!d) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d,
        v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u < -1e-9 || v < -1e-9 || 1 - u - v < -1e-9) continue;
      heights.push(u * ay + v * by + (1 - u - v) * cy);
    }
    return heights;
  };
}

test('both camp-mountain levels: no apron over the sea, none above the coast-lowered ground ashore', async (t) => {
  const asset = JSON.parse(await readFile('public/models/camp-mountain/asset.json'));
  // The ground actors walk on, sampled from the delivered tiles as the open world installs it.
  const grounds = Object.fromEntries(
    await Promise.all(
      BIOMES.map(async (b) => [
        b.id,
        JSON.parse(await readFile(`public/models/${b.ground}/asset.json`)).placement.heightField,
      ]),
    ),
  );
  const release = installBiomeTerrain(grounds);
  const { roof, shader } = compileMountain();
  try {
    const discarded = mountainDiscard(shader.fragmentShader, textures.coast),
      points = transect();
    // The reported landing: the coast-lowered walk surface the player was drawn at.
    const landing = walkHeight(RECOVERED.x, RECOVERED.z);
    assert.ok(Math.abs(landing - -0.517) < 0.005, `walk surface ${landing}`);
    for (const { url } of [asset, ...asset.lods]) {
      const surface = await fittedMountain(url, points);
      let yielded = 0,
        clipped = 0,
        uncovered = 0;
      for (const p of points) {
        const heights = surface(p.x, p.z);
        if (!heights.length) {
          uncovered++;
          continue;
        }
        const kept = heights.filter((y) => !discarded(p.x, y, p.z)),
          coast = coastDistance(p.x, p.z);
        if (coast <= 0) {
          assert.equal(kept.length, 0, `${url} at sea ${p.x},${p.z}`);
          clipped++;
          continue;
        }
        // Ashore the streamed ground (clipped only at sea) is drawn at the walk surface; the
        // mountain may not stand above it by more than the layered-ground band (0.1 m).
        const ground = walkHeight(p.x, p.z);
        for (const y of kept)
          assert.ok(y <= ground + 0.1, `${url} buries ${p.x},${p.z}: ${y} > ${ground}`);
        if (kept.length < heights.length) yielded++;
      }
      // At the landing the unclipped apron stood half a metre above the player; it now yields.
      const over = surface(RECOVERED.x, RECOVERED.z);
      assert.ok(Math.max(...over) > landing + 0.4, `${url}: apron ${Math.max(...over)}`);
      assert.ok(over.every((y) => discarded(RECOVERED.x, y, RECOVERED.z)));
      // The photographed hull: the apron covered it above the water and the canoe; now clipped.
      const hull = surface(HULL.x, HULL.z);
      assert.ok(
        Math.max(...hull) > OCEAN_SURFACE_Y + 0.25 && Math.max(...hull) > HULL_ROOT_Y + 0.5,
      );
      assert.ok(hull.every((y) => discarded(HULL.x, y, HULL.z)));
      assert.ok(yielded > 10 && clipped > 20, `${url}: ${yielded} yielded, ${clipped} at sea`);
      t.diagnostic(
        `${url}: ${points.length} points (${uncovered} outside the mesh); the apron yields ashore ` +
          `at ${yielded} and is clipped at sea at ${clipped}`,
      );
    }
  } finally {
    roof.dispose();
    release();
  }
});
