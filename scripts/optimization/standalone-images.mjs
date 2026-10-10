// Standalone runtime textures: images the game loads by URL rather than from a GLB. Today these
// are the ten camp-cave mural, limestone and frieze PNGs. The plan is derived without executing
// project code. The camp-cave manifest and its world-catalog copy give every image's audited
// SHA-256, length and size. The TypeScript syntax trees of the runtime files say which images
// the game loads, and how the mural shader maps them (CAVE_MOTIFS and its normalisation sizes).
// The loaded images come from either the verified loader (loadCaveTextures → caveImageRecords →
// caveMuralImages) or the earlier direct reads (template.asset.<key>.url, CAVE_EXTRA_PIGMENTS).
// Only literals are read; anything else is an error.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { sha256 } from './glb.mjs';
import { MIME_BY_FORMAT, sniffImage, targetDimensions } from './images.mjs';
import { CATALOG } from './inventory.mjs';
import { resolveSourceImage } from './paths.mjs';
import { ALLOWED_EDGES, encodingOf, resizeJob, sourceSummary } from './textures.mjs';

export const CAVE_OWNER = 'camp-cave';
export const CAVE_MANIFEST = 'public/models/camp-cave/asset.json';
export const CAVE_LAYOUT = 'src/cave-gallery-layout.ts';
// Both runtime paths that load the cave textures; they must name the same images.
export const CAVE_LOADERS = Object.freeze(['src/loading-cave.ts', 'src/world-landmarks.ts']);
// Since the verified cave loader, both paths call loadCaveTextures(template.asset, …). Its records
// come from this module's caveImageRecords (asset.rockSurface plus the layout's caveMuralImages).
// caveMuralImages reads asset.pigment, characterPigment, rimoPigment and
// mascotPigments[key] for every CAVE_EXTRA_PIGMENTS key.
export const CAVE_IMAGE_MODULE = 'src/verified-texture.ts';
// Both loaders set RepeatWrapping on the limestone (sampled triplanar at p/2.8); every other
// cave texture keeps three's ClampToEdgeWrapping and the shader's clamp(.001, .999) inset.
const REPEAT_WRAPPED = Object.freeze(['rockSurface']);
const EXTENSION_FORMAT = Object.freeze({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' });
const HASH = /^[0-9a-f]{64}$/;

async function syntaxTree(root, relative) {
  const bytes = await readFile(path.join(root, ...relative.split('/')));
  return {
    relative,
    input: { path: relative, sha256: sha256(bytes) },
    tree: ts.createSourceFile(
      relative,
      bytes.toString('utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
  };
}

const unwrap = (node) => {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node))
  )
    node = node.expression;
  return node;
};

/** A literal from the syntax tree. Computed values are refused, nothing is evaluated. */
export function literalOf(node, where) {
  node = unwrap(node);
  if (!node) throw new Error(`${where} has no value`);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((element, index) => literalOf(element, `${where}[${index}]`));
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      )
        throw new Error(`${where}: only plain literal properties can be read`);
      const name = property.name.text;
      if (name === '__proto__' || Object.hasOwn(value, name))
        throw new Error(`${where}: unusable property ${name}`);
      value[name] = literalOf(property.initializer, `${where}.${name}`);
    }
    return value;
  }
  throw new Error(`${where} is not a literal (${ts.SyntaxKind[node.kind]})`);
}

function exportedConstant(file, name) {
  for (const statement of file.tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
      constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        if (!exported || !constant)
          throw new Error(`${file.relative} ${name} must be an exported const`);
        return literalOf(declaration.initializer, `${file.relative} ${name}`);
      }
  }
  throw new Error(`${file.relative} does not declare ${name}`);
}

const isName = (node, text) => !!node && ts.isIdentifier(node) && node.text === text;

/** Calls of the function `name` inside `node`. */
function callsOf(node, name) {
  const found = [];
  const visit = (child) => {
    if (ts.isCallExpression(child) && isName(unwrap(child.expression), name)) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** Whether `node` iterates CAVE_EXTRA_PIGMENTS through Object.<one of methods>(…). */
function iteratesExtras(node, methods) {
  let found = false;
  const visit = (child) => {
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      isName(child.expression.expression, 'Object') &&
      methods.includes(child.expression.name.text) &&
      child.arguments.length === 1 &&
      isName(unwrap(child.arguments[0]), 'CAVE_EXTRA_PIGMENTS')
    )
      found = true;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** `<object>.<key>` and `<object>?.<key>` reads inside `node`. */
function propertyReads(node, object) {
  const keys = new Set();
  const visit = (child) => {
    if (ts.isPropertyAccessExpression(child) && isName(unwrap(child.expression), object))
      keys.add(child.name.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return keys;
}

function declaredFunction(file, name) {
  for (const statement of file.tree.statements)
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
  throw new Error(`${file.relative} does not declare the function ${name}`);
}

function nodesOf(node, test) {
  const found = [];
  const visit = (child) => {
    if (test(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

// The settings a verified texture may carry; anything else could change its pixels or sampling.
const TEXTURE_SETTINGS = Object.freeze(['colorSpace', 'anisotropy', 'repeat']);

/**
 * The texture settings loadCaveTextures gives each record: its colour space and the record keys
 * it repeat-wraps. The settings must be one object literal inside the single
 * `Object.keys(records).map((key) => …)` callback, where `records = caveImageRecords(asset)`:
 * `colorSpace: THREE.SRGBColorSpace`, `anisotropy` and `repeat`. `repeat` is either inline or a
 * single `const repeat` in the callback, and is a literal test of the key (`key === '<name>'`,
 * possibly joined with `||`). Anything computed, spread, reassigned or unknown is an error.
 */
function verifiedTextureSettings(textures) {
  const fail = (what) => {
    throw new Error(
      `${CAVE_IMAGE_MODULE} loadCaveTextures: ${what}; review the standalone image plan`,
    );
  };
  const recordNames = nodesOf(
    textures,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      !!node.initializer &&
      ts.isCallExpression(unwrap(node.initializer)) &&
      isName(unwrap(unwrap(node.initializer).expression), 'caveImageRecords'),
  ).map((node) => node.name.text);
  if (recordNames.length !== 1)
    fail('its records do not come from exactly one caveImageRecords(asset)');
  const maps = nodesOf(textures, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'map'
    )
      return false;
    const receiver = unwrap(node.expression.expression);
    return (
      ts.isCallExpression(receiver) &&
      ts.isPropertyAccessExpression(receiver.expression) &&
      isName(receiver.expression.expression, 'Object') &&
      receiver.expression.name.text === 'keys' &&
      receiver.arguments.length === 1 &&
      isName(unwrap(receiver.arguments[0]), recordNames[0])
    );
  });
  if (maps.length !== 1)
    fail(`its textures are not made by exactly one map over Object.keys(${recordNames[0]})`);
  const callback = unwrap(maps[0].arguments[0]);
  if (
    !callback ||
    !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ||
    !callback.parameters[0] ||
    !ts.isIdentifier(callback.parameters[0].name)
  )
    fail('its texture callback does not take the record key as its first parameter');
  const key = callback.parameters[0].name.text,
    settings = nodesOf(
      callback,
      (node) =>
        ts.isObjectLiteralExpression(node) &&
        node.properties.some((property) => property.name?.getText() === 'colorSpace'),
    );
  if (settings.length !== 1)
    fail('the texture settings are not one object literal with a colorSpace');
  const named = new Map();
  for (const property of settings[0].properties) {
    const name =
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      ts.isIdentifier(property.name)
        ? property.name.text
        : null;
    if (!name || !TEXTURE_SETTINGS.includes(name) || named.has(name))
      fail(`the texture settings hold ${property.getText()}, which the plan cannot read`);
    named.set(name, property);
  }
  const colorSpace = named.get('colorSpace'),
    space = ts.isPropertyAssignment(colorSpace) ? unwrap(colorSpace.initializer) : null;
  if (
    !space ||
    !ts.isPropertyAccessExpression(space) ||
    !isName(space.expression, 'THREE') ||
    space.name.text !== 'SRGBColorSpace'
  )
    fail(`colorSpace is ${(space ?? colorSpace).getText()}, not THREE.SRGBColorSpace`);
  let repeat = null;
  const property = named.get('repeat');
  if (property && ts.isPropertyAssignment(property)) repeat = property.initializer;
  else if (property) {
    // Shorthand: the one `const repeat = …` in the callback, never reassigned.
    const declarations = nodesOf(
      callback,
      (node) => ts.isVariableDeclaration(node) && isName(node.name, 'repeat'),
    );
    const assigned = nodesOf(
      callback,
      (node) =>
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        isName(unwrap(node.left), 'repeat'),
    );
    if (
      declarations.length !== 1 ||
      !declarations[0].initializer ||
      !(declarations[0].parent.flags & ts.NodeFlags.Const) ||
      assigned.length
    )
      fail('repeat is not one const of the callback');
    repeat = declarations[0].initializer;
  }
  const literalKeys = (expression) => {
    const node = unwrap(expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      return [...literalKeys(node.left), ...literalKeys(node.right)];
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      const [left, right] = [unwrap(node.left), unwrap(node.right)];
      if (isName(left, key) && ts.isStringLiteral(right)) return [right.text];
      if (isName(right, key) && ts.isStringLiteral(left)) return [left.text];
    }
    return fail(`repeat is not a literal test of the record key (${node.getText()})`);
  };
  return { colorSpace: 'srgb', repeated: repeat ? [...new Set(literalKeys(repeat))].sort() : [] };
}

/**
 * Fails unless the cave asset is used in `fn` only as `asset.<name>`, or as the argument of one
 * of `callees`. Any other use (`asset[key]`, a spread, another function) would select images the
 * syntax does not show. In `mascotPigments[key]` the key must be a plain name.
 */
function checkAssetUses(file, fn, callees) {
  for (const node of nodesOf(fn.body, (child) => isName(child, 'asset'))) {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) continue;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const access = parent.parent;
      if (
        parent.name.text === 'mascotPigments' &&
        ts.isElementAccessExpression(access) &&
        access.expression === parent &&
        !ts.isIdentifier(access.argumentExpression)
      )
        throw new Error(
          `${file.relative} ${fn.name.text}: mascotPigments is read with a computed key; review the standalone image plan`,
        );
      continue;
    }
    if (
      ts.isCallExpression(parent) &&
      parent.arguments.includes(node) &&
      callees.some((name) => isName(unwrap(parent.expression), name))
    )
      continue;
    throw new Error(
      `${file.relative} ${fn.name.text}: the cave asset is used indirectly (${node.parent.getText()}); the images it selects cannot be read literally`,
    );
  }
}

/** `template.asset.<key>.url` reads, whether every CAVE_EXTRA_PIGMENTS entry is iterated, and
 * whether the file loads the cave through loadCaveTextures(template.asset, …). */
function runtimeReads(file) {
  const keys = new Set();
  let extras = false;
  const verified = callsOf(file.tree, 'loadCaveTextures').some((call) => {
    const argument = unwrap(call.arguments[0]);
    return (
      !!argument &&
      ts.isPropertyAccessExpression(argument) &&
      argument.name.text === 'asset' &&
      isName(unwrap(argument.expression), 'template')
    );
  });
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'url') {
      const entry = node.expression;
      if (
        ts.isPropertyAccessExpression(entry) &&
        ts.isPropertyAccessExpression(entry.expression) &&
        entry.expression.name.text === 'asset' &&
        ts.isIdentifier(entry.expression.expression) &&
        entry.expression.expression.text === 'template'
      )
        keys.add(entry.name.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Object' &&
      ['values', 'entries'].includes(node.expression.name.text) &&
      node.arguments.length === 1 &&
      ts.isIdentifier(node.arguments[0]) &&
      node.arguments[0].text === 'CAVE_EXTRA_PIGMENTS'
    )
      extras = true;
    ts.forEachChild(node, visit);
  };
  visit(file.tree);
  return { keys: [...keys].sort(), extras, verified };
}

/** The images the verified loader loads, read from the syntax of loadCaveTextures,
 * caveImageRecords and caveMuralImages. Anything it cannot read literally is an error. */
function verifiedEntries(module, layout, extraKeys) {
  const records = declaredFunction(module, 'caveImageRecords'),
    textures = declaredFunction(module, 'loadCaveTextures'),
    murals = declaredFunction(layout, 'caveMuralImages');
  if (!callsOf(textures, 'caveImageRecords').length)
    throw new Error(
      `${CAVE_IMAGE_MODULE} loadCaveTextures does not load caveImageRecords; review the standalone image plan`,
    );
  if (!callsOf(records, 'caveMuralImages').length)
    throw new Error(
      `${CAVE_IMAGE_MODULE} caveImageRecords does not take the murals from caveMuralImages; review the standalone image plan`,
    );
  checkAssetUses(module, textures, ['caveImageRecords']);
  checkAssetUses(module, records, ['caveMuralImages']);
  checkAssetUses(layout, murals, []);
  const own = propertyReads(records, 'asset'),
    mural = propertyReads(murals, 'asset');
  if (!mural.has('mascotPigments') || !iteratesExtras(murals, ['keys', 'values', 'entries']))
    throw new Error(`${CAVE_LAYOUT} caveMuralImages does not load every CAVE_EXTRA_PIGMENTS entry`);
  mural.delete('mascotPigments');
  const { colorSpace, repeated } = verifiedTextureSettings(textures);
  if (colorSpace !== 'srgb')
    throw new Error(`${CAVE_IMAGE_MODULE} loads the cave textures as ${colorSpace}, not sRGB`);
  if (repeated.join() !== [...REPEAT_WRAPPED].sort().join())
    throw new Error(
      `${CAVE_IMAGE_MODULE} repeats ${repeated.join(', ') || 'no texture'}, the plan repeats ${REPEAT_WRAPPED.join(', ')}`,
    );
  const loaders = CAVE_LOADERS.map((file) => `${file} loadCaveTextures(template.asset)`);
  return [
    ...[...new Set([...own, ...mural])].sort().map((key) => ({
      key,
      manifestEntry: key,
      runtimeEntry: `caveImageRecords(template.asset).${key}`,
      configuredBy: [
        ...loaders,
        own.has(key)
          ? `${CAVE_IMAGE_MODULE} caveImageRecords asset.${key}`
          : `${CAVE_LAYOUT} caveMuralImages asset.${key}`,
      ],
      extra: false,
    })),
    ...extraKeys.map((key) => ({
      key,
      manifestEntry: `mascotPigments.${key}`,
      runtimeEntry: `caveImageRecords(template.asset).${key}`,
      configuredBy: [
        ...loaders,
        `${CAVE_LAYOUT} caveMuralImages asset.mascotPigments[key of CAVE_EXTRA_PIGMENTS]`,
      ],
      extra: true,
    })),
  ];
}

/** caveMuralShader's normalisation sizes:
 * `const [imageWidth, imageHeight] = extra || creature524 ? [x1, y1] : rimoFrieze ? [w, h] : [w, h]`. */
function shaderSizes(layout) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements
        .map((element) => (ts.isBindingElement(element) ? element.name.getText() : ''))
        .join() === 'imageWidth,imageHeight'
    )
      found.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(layout.tree);
  const changed = () => {
      throw new Error(
        `${layout.relative}: the mural shader's image-size rule changed; review the standalone image plan`,
      );
    },
    outer = found.length === 1 ? unwrap(found[0]) : changed();
  if (!ts.isConditionalExpression(outer)) changed();
  const own = unwrap(outer.whenTrue),
    inner = unwrap(outer.whenFalse);
  if (
    !ts.isArrayLiteralExpression(own) ||
    own.elements.map((element) => element.getText()).join() !== 'x1,y1'
  )
    changed();
  if (
    !/\bextra\b/.test(outer.condition.getText()) ||
    !/['"]creature524['"]/.test(outer.condition.getText())
  )
    changed();
  if (!ts.isConditionalExpression(inner) || !/['"]rimoFrieze['"]/.test(inner.condition.getText()))
    changed();
  return {
    rimoFrieze: literalOf(inner.whenTrue, `${layout.relative} rimoFrieze size`),
    atlas: literalOf(inner.whenFalse, `${layout.relative} atlas size`),
  };
}

// caveMuralPigment: extra pigments by name, the 524 frieze, the Rimo frieze, else the atlas;
// comingSoon is a generated label, not an image file.
const imageOfMotif = (motif, extras) =>
  motif === 'comingSoon'
    ? null
    : Object.hasOwn(extras, motif)
      ? motif
      : motif === 'creature524'
        ? 'characterPigment'
        : motif === 'rimoFrieze'
          ? 'rimoPigment'
          : 'pigment';

function sizeOfMotif(motif, rect, extras, sizes) {
  if (Object.hasOwn(extras, motif) || motif === 'creature524') return [rect[2], rect[3]];
  return motif === 'rimoFrieze' ? sizes.rimoFrieze : sizes.atlas;
}

function imageRecord(record, where) {
  if (
    typeof record?.url !== 'string' ||
    !HASH.test(record.sha256 ?? '') ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1 ||
    !Number.isSafeInteger(record.image?.width) ||
    !Number.isSafeInteger(record.image?.height)
  )
    throw new Error(`${where}: needs url, sha256, bytes and image.width/height`);
  return {
    url: record.url,
    sha256: record.sha256,
    bytes: record.bytes,
    width: record.image.width,
    height: record.image.height,
  };
}

const at = (object, entryPath) =>
  entryPath.split('.').reduce((value, key) => (value ? value[key] : undefined), object);

/** Every nested url record (as the public build publishes them), to report what is not planned. */
function declaredImages(asset) {
  const found = [];
  const visit = (value, where) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.url === 'string' && /\.(?:png|jpe?g|webp)$/.test(value.url))
      found.push({ entry: where, url: value.url });
    for (const [key, child] of Object.entries(value))
      if (key !== 'provenance') visit(child, where ? `${where}.${key}` : key);
  };
  visit(asset, '');
  return found;
}

/** Read a standalone texture exactly as the manifest records it; any drift is an error. */
export async function readVerifiedImage(root, record) {
  const bytes = await readFile(resolveSourceImage(root, record.url));
  if (bytes.length !== record.bytes)
    throw new Error(
      `${record.url}: ${bytes.length} bytes on disk, the manifest records ${record.bytes} bytes`,
    );
  const digest = sha256(bytes);
  if (digest !== record.sha256)
    throw new Error(
      `${record.url}: SHA-256 ${digest} does not match the manifest ${record.sha256}`,
    );
  return bytes;
}

function gap(a, b) {
  const dx = Math.max(0, b[0] - a[2], a[0] - b[2]),
    dy = Math.max(0, b[1] - a[3], a[1] - b[3]);
  return Math.hypot(dx, dy);
}

function risksOf(item) {
  const { source, target, uv } = item.plan,
    risks = [
      `Downsized from ${source.width}x${source.height} to ${target.width}x${target.height} (whole image, aspect kept). Compare the cave close up and at grazing angles in Chrome and WebKit; faces and small markings in the paintings must stay recognisable at the closest walkable distance.`,
    ];
  const packed = uv.motifs.filter((motif) => motif.nearestOtherMotifSourcePixels !== null);
  if (packed.length) {
    const overlapping = packed
        .filter((motif) => motif.nearestOtherMotifSourcePixels === 0)
        .map((motif) => motif.motif),
      apart = packed.filter((motif) => motif.nearestOtherMotifSourcePixels > 0),
      tightest = apart.length
        ? apart.reduce((a, b) =>
            b.nearestOtherMotifSourcePixels < a.nearestOtherMotifSourcePixels ? b : a,
          )
        : null,
      parts = [
        ...(overlapping.length
          ? [`the rectangles of ${overlapping.join(', ')} overlap a neighbour (as in the original)`]
          : []),
        ...(tightest
          ? [
              `others sit as close as ${tightest.nearestOtherMotifSourcePixels.toFixed(1)} source px (${tightest.nearestOtherMotifCandidatePixels.toFixed(1)} candidate px, "${tightest.motif}")`,
            ]
          : []),
      ];
    risks.push(
      `Atlas motifs: ${parts.join('; ')}. Mipmapped sampling pulls neighbouring artwork across motif edges slightly sooner than with the original; inspect every motif edge close up and from the far end of the gallery.`,
    );
  }
  if (source.alpha)
    risks.push(
      'Transparent painting edges were resized with premultiplied alpha; check outlines against the limestone for dark or light fringes.',
    );
  if (uv.wrap === 'repeat')
    risks.push(
      'Tiled limestone was filtered across its own opposite edges; check for tile seams and for slightly softer pores and bedding (the shader derives relief from screen-space derivatives of this texture).',
    );
  return risks;
}

/**
 * The standalone texture plan for the selected owners. `edges` maps an owner model key to its
 * maximum edge; owners missing from it (not selected) contribute nothing. `readManifest`
 * supplies the two manifests' bytes by repository path. By default they come from disk; an
 * adoption audit passes its saved pre-apply bytes instead. Images and runtime files always
 * come from disk.
 */
export async function planStandaloneImages(
  root,
  {
    inventory,
    rules,
    edges,
    colorFilter = 'lanczos',
    webpQuality = 90,
    readManifest = (relative) => readFile(path.join(root, ...relative.split('/'))),
  },
) {
  const owner = inventory.models.find((model) => model.modelKey === CAVE_OWNER);
  if (!owner) throw new Error(`${CAVE_OWNER} is not in the current manifests`);
  const excludedKeys = new Set(
    rules.characterModels
      .filter((profile) => rules.excludedSpecies.includes(profile.species))
      .map((profile) => profile.key),
  );
  if (excludedKeys.has(CAVE_OWNER))
    throw new Error(`${CAVE_OWNER} belongs to an excluded character`);
  const ownerSummary = { modelKey: CAVE_OWNER, eligible: owner.eligible, reason: owner.reason };
  if (!owner.eligible || !edges.has(CAVE_OWNER))
    return { owner: ownerSummary, inputs: [], images: [], skipped: [] };
  const edge = edges.get(CAVE_OWNER);
  if (!ALLOWED_EDGES.includes(edge))
    throw new Error(`${CAVE_OWNER}: texture edge ${edge} must be 1024 or 512`);
  const manifestBytes = await readManifest(CAVE_MANIFEST),
    asset = JSON.parse(manifestBytes),
    catalogBytes = await readManifest(CATALOG),
    catalogAsset = JSON.parse(catalogBytes).assets?.find((entry) => entry.modelKey === CAVE_OWNER);
  if (asset.modelKey !== CAVE_OWNER)
    throw new Error(`${CAVE_MANIFEST} does not describe ${CAVE_OWNER}`);
  if (!catalogAsset) throw new Error(`${CATALOG} has no ${CAVE_OWNER} entry`);
  const layout = await syntaxTree(root, CAVE_LAYOUT),
    loaders = await Promise.all(CAVE_LOADERS.map((relative) => syntaxTree(root, relative))),
    extras = exportedConstant(layout, 'CAVE_EXTRA_PIGMENTS'),
    motifs = exportedConstant(layout, 'CAVE_MOTIFS'),
    sizes = shaderSizes(layout),
    reads = loaders.map(runtimeReads),
    // Every loader goes through loadCaveTextures, with no direct URL read left.
    verified = reads.every((read) => read.verified && !read.keys.length && !read.extras);
  if (!verified)
    reads.forEach((read, index) => {
      if (!read.keys.length || read.keys.join() !== reads[0].keys.join())
        throw new Error(
          `${CAVE_LOADERS[index]} loads cave textures ${read.keys.join(', ') || '(none)'}, ${CAVE_LOADERS[0]} ${reads[0].keys.join(', ')}`,
        );
      if (!read.extras)
        throw new Error(`${CAVE_LOADERS[index]} does not load every CAVE_EXTRA_PIGMENTS entry`);
    });
  const extraKeys = Object.keys(extras).sort(),
    mascotKeys = Object.keys(asset.mascotPigments ?? {}).sort();
  if (extraKeys.join() !== mascotKeys.join())
    throw new Error(
      `CAVE_EXTRA_PIGMENTS (${extraKeys.join(', ')}) and ${CAVE_MANIFEST} mascotPigments (${mascotKeys.join(', ')}) differ`,
    );
  const imageModule = verified ? await syntaxTree(root, CAVE_IMAGE_MODULE) : null,
    entries = verified
      ? verifiedEntries(imageModule, layout, extraKeys)
      : [
          ...reads[0].keys.map((key) => ({
            key,
            manifestEntry: key,
            runtimeEntry: `template.asset.${key}.url`,
            configuredBy: CAVE_LOADERS.map((file) => `${file} template.asset.${key}.url`),
            extra: false,
          })),
          ...extraKeys.map((key) => ({
            key,
            manifestEntry: `mascotPigments.${key}`,
            runtimeEntry: `CAVE_EXTRA_PIGMENTS.${key}.url`,
            configuredBy: [
              `${CAVE_LAYOUT} CAVE_EXTRA_PIGMENTS.${key}`,
              ...CAVE_LOADERS.map((file) => `${file} Object.*(CAVE_EXTRA_PIGMENTS)`),
            ],
            extra: true,
          })),
        ];
  const images = [],
    seen = new Set();
  for (const entry of entries) {
    const where = `${CAVE_MANIFEST} ${entry.manifestEntry}`,
      record = imageRecord(at(asset, entry.manifestEntry), where),
      catalogRecord = imageRecord(
        at(catalogAsset, entry.manifestEntry),
        `${CATALOG} ${CAVE_OWNER} ${entry.manifestEntry}`,
      );
    if (JSON.stringify(record) !== JSON.stringify(catalogRecord))
      throw new Error(`${where} and ${CATALOG} disagree on ${entry.manifestEntry}`);
    // The constant names each frieze's original image (the legacy loaders also loaded it).
    if (entry.extra && extras[entry.key]?.url !== record.url)
      throw new Error(
        `CAVE_EXTRA_PIGMENTS.${entry.key} ${verified ? 'names' : 'loads'} ${extras[entry.key]?.url}, the manifest audits ${record.url}`,
      );
    const directory = record.url.split('/')[2];
    if (directory !== CAVE_OWNER)
      throw new Error(`${where}: ${record.url} is outside /models/${CAVE_OWNER}/`);
    if (excludedKeys.has(directory))
      throw new Error(`${where}: ${record.url} belongs to an excluded character`);
    if (seen.has(record.url)) throw new Error(`${record.url} is configured twice`);
    seen.add(record.url);
    const data = await readVerifiedImage(root, record),
      info = sniffImage(data),
      extension = record.url.slice(record.url.lastIndexOf('.') + 1).toLowerCase();
    if (info.format !== EXTENSION_FORMAT[extension])
      throw new Error(`${record.url} holds ${info.format} data`);
    if (info.width !== record.width || info.height !== record.height)
      throw new Error(
        `${record.url} is ${info.width}x${info.height}, the manifest records ${record.width}x${record.height}`,
      );
    images.push({ entry, record, data, info });
  }
  // UV mapping: every motif rectangle is normalised by a fixed source size, never by the loaded
  // texture, so it must be exactly the image's source size and lie inside it.
  const motifsByImage = new Map(images.map(({ entry }) => [entry.key, []]));
  for (const [motif, rect] of Object.entries(motifs)) {
    const key = imageOfMotif(motif, extras);
    if (key === null) continue;
    const image = images.find(({ entry }) => entry.key === key);
    if (!image)
      throw new Error(`CAVE_MOTIFS.${motif} samples ${key}, which the runtime does not load`);
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite))
      throw new Error(`CAVE_MOTIFS.${motif} must be [x0, y0, x1, y1]`);
    const [width, height] = sizeOfMotif(motif, rect, extras, sizes);
    if (width !== image.info.width || height !== image.info.height)
      throw new Error(
        `CAVE_MOTIFS.${motif} is normalised by ${width}x${height} but ${image.record.url} is ${image.info.width}x${image.info.height}`,
      );
    if (!(
      rect[0] >= 0 &&
      rect[1] >= 0 &&
      rect[0] < rect[2] &&
      rect[1] < rect[3] &&
      rect[2] <= width &&
      rect[3] <= height
    ))
      throw new Error(`CAVE_MOTIFS.${motif} [${rect}] lies outside ${width}x${height}`);
    motifsByImage.get(key).push({ motif, rect });
  }
  const planned = images.map(({ entry, record, data, info }) => {
    const target = targetDimensions(info.width, info.height, edge),
      wrap = REPEAT_WRAPPED.includes(entry.key) ? 'repeat' : 'clamp',
      treatment = info.alpha ? 'color-alpha' : 'color-opaque',
      summary = sourceSummary(info, data),
      source = {
        url: record.url,
        mimeType: MIME_BY_FORMAT[info.format],
        format: info.format,
        ...summary,
      },
      scale = [target.width / info.width, target.height / info.height],
      list = motifsByImage.get(entry.key),
      motifRecords = list.map(({ motif, rect }) => {
        const others = list.filter((other) => other.motif !== motif),
          nearest = others.length
            ? Math.min(...others.map((other) => gap(rect, other.rect)))
            : null,
          nearestCandidate = others.length
            ? Math.min(
                ...others.map((other) =>
                  gap(
                    rect.map((value, i) => value * scale[i % 2]),
                    other.rect.map((value, i) => value * scale[i % 2]),
                  ),
                ),
              )
            : null;
        return {
          motif,
          rect,
          normalized: rect.map((value, i) => value / (i % 2 ? info.height : info.width)),
          candidatePixels: rect.map((value, i) => value * scale[i % 2]),
          nearestOtherMotifSourcePixels: nearest,
          nearestOtherMotifCandidatePixels: nearestCandidate,
        };
      }),
      plan = {
        owner: CAVE_OWNER,
        manifestEntry: entry.manifestEntry,
        runtimeEntry: entry.runtimeEntry,
        configuredBy: entry.configuredBy,
        source,
        uv: {
          normalizedBy: { width: info.width, height: info.height },
          rule: 'rectangles are normalised by the source size; a whole-image resize keeps every normalised coordinate',
          wrap: wrap === 'repeat' ? 'repeat' : 'clamp-to-edge',
          motifs: motifRecords,
        },
        colorSpace: 'srgb',
        treatment,
        filter: target.resized ? colorFilter : 'none',
        wrap,
        edge,
        resized: target.resized,
        target: { width: target.width, height: target.height },
        encoding: target.resized ? encodingOf(info, webpQuality) : 'unchanged-original',
      },
      item = {
        id: `image:${record.url}`,
        plan,
        data,
        job: target.resized
          ? resizeJob(info, summary, target, { treatment, colorFilter, webpQuality, wrap })
          : null,
      };
    item.risks = risksOf(item);
    return item;
  });
  const skipped = declaredImages(asset)
    .filter(({ url }) => !seen.has(url))
    .map(({ entry, url }) => ({
      entry,
      url,
      reason: 'declared in the manifest but not loaded by the runtime',
    }));
  return {
    owner: ownerSummary,
    inputs: [
      { path: CAVE_MANIFEST, sha256: sha256(manifestBytes) },
      { path: CATALOG, sha256: sha256(catalogBytes) },
      layout.input,
      ...loaders.map((file) => file.input),
      ...(imageModule ? [imageModule.input] : []),
    ],
    images: planned,
    skipped,
  };
}
