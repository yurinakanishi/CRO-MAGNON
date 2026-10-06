import path from 'node:path';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { environmentProfile } from '../dist/shared/environment-profile.mjs';
import { BOT_DESIGNS } from '../dist/shared/orb-bots.mjs';

export function browserBuildProfile(environment, builtAt = null) {
  const { id, cameraControls } = environmentProfile(environment);
  return { environment: id, cameraControls, builtAt };
}

/** Menu portraits are declared by the common bot catalog, outside model metadata. */
export function runtimeBotPortraitUrls(assets) {
  const modelKeys = new Set(assets.map((asset) => asset.modelKey));
  return Object.values(BOT_DESIGNS).flatMap((design) => {
    if (!design.image) return [];
    const match = /^\/models\/(orb-bot-[a-z0-9-]+)\/portrait\.png$/.exec(design.image);
    if (!match) throw new Error(`Unexpected bot portrait: ${design.image}`);
    return modelKeys.has(match[1]) ? [design.image] : [];
  });
}

/** Current declared texture records can be nested (for example cave mural groups). */
export function runtimeTextureRecords(asset) {
  const records = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (
      typeof value.url === 'string' &&
      /^\/models\/[^/]+\/[^/]+\.(?:png|jpe?g)$/.test(value.url)
    ) {
      if (!/^[a-f0-9]{64}$/.test(value.sha256))
        throw new Error(`Missing texture integrity: ${value.url}`);
      const previous = records.get(value.url);
      if (
        previous &&
        (previous.sha256 !== value.sha256 ||
          (previous.bytes !== undefined &&
            value.bytes !== undefined &&
            previous.bytes !== value.bytes))
      )
        throw new Error(`Conflicting texture records: ${value.url}`);
      records.set(value.url, value);
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'provenance') visit(child);
  }
  visit(asset);
  return [...records.values()];
}

export function cameraAsset(name) {
  return /^(?:src\/motion-[^/]*|vendor\/mediapipe(?:\/|$)|motion(?:\/|$))/i.test(name);
}

export function environmentAsset(name, bytes, profile) {
  // This Node compatibility facade is not a browser/domain release dependency.
  if (profile.environment === 'mmo' && name === 'shared/game-core.mjs') return undefined;
  if (!profile.cameraControls && cameraAsset(name)) return undefined;
  if (name === 'src/build-profile.js')
    return Buffer.from(`export const BUILD_PROFILE = Object.freeze(${JSON.stringify(profile)});\n`);
  if (!profile.cameraControls && name === 'src/hand-controls.js')
    return Buffer.from('export function createHandControls() { return undefined; }\n');
  if (!profile.cameraControls && name === 'index.html')
    return Buffer.from(
      bytes
        .toString('utf8')
        .replace(/^.*<link[^>]+href="\/src\/motion-controls\.css"[^>]*>.*\r?\n/gm, ''),
    );
  return bytes;
}

/** Validate emitted dependencies, including dynamic imports and module worker URLs. */
export async function auditEnvironmentAssets(names, read, profile) {
  const files = new Set(names);
  for (const name of files) {
    if (name === 'src/adventure-ui.js')
      throw new Error(`Removed journal asset in ${profile.environment}: ${name}`);
    if (!profile.cameraControls && cameraAsset(name))
      throw new Error(`Camera asset in MMO: ${name}`);
    if (!/\.(?:m?js|html|css)$/.test(name)) continue;
    const code = (await read(name)).toString('utf8');
    if (
      /\bopenJournal\b|\binstallAdventureUI\b|adventure-browser|journal-entry|['"]journal['"]|手帳/.test(
        code,
      )
    )
      throw new Error(`Removed journal UI in ${profile.environment}: ${name}`);
    if (
      !profile.cameraControls &&
      /getUserMedia|HandLandmarker|\/vendor\/mediapipe\/|\/src\/motion-|\/motion\//.test(code)
    )
      throw new Error(`Camera implementation in MMO: ${name}`);
    if (!/\.m?js$/.test(name)) continue;
    const tree = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const references = [];
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        references.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        references.push(node.arguments[0].text);
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL' &&
        node.arguments?.[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        /\.m?js$/.test(node.arguments[0].text)
      )
        references.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    for (const specifier of references) {
      // The pinned Emscripten loader imports this only in its Node branch.
      // Browsers use the WASM path; MMO never ships this loader.
      if (
        profile.cameraControls &&
        name === 'vendor/mediapipe/wasm/vision_wasm_module_internal.js' &&
        specifier === 'node:module'
      )
        continue;
      const target =
        specifier === 'three'
          ? 'vendor/three.module.js'
          : specifier.startsWith('three/addons/')
            ? specifier.replace('three/addons/', 'vendor/addons/')
            : specifier.startsWith('/')
              ? specifier.slice(1)
              : specifier.startsWith('.')
                ? path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier))
                : null;
      if (target === null || !files.has(target))
        throw new Error(`Missing release dependency: ${name} → ${specifier}`);
    }
  }
  const actual = JSON.parse((await read('build-profile.json')).toString('utf8'));
  if (JSON.stringify(actual) !== JSON.stringify(profile)) throw new Error('Build profile mismatch');
  return {
    environment: profile.environment,
    cameraControls: profile.cameraControls,
    files: files.size,
  };
}

export function auditEnvironmentDirectory(root, names, profile) {
  return auditEnvironmentAssets(names, (name) => readFile(path.join(root, name)), profile);
}
