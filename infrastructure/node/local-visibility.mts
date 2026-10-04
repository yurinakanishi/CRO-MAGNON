import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CHARACTER_MODELS } from '../../shared/characters.mjs';
import {
  ALL_CONTENT,
  visibleCharacters,
  type ContentVisibility,
} from '../../shared/content-visibility.mjs';

/** This file is local to the Node host; Cloudflare and exhibition builds do not read it. */
export async function readLocalVisibility(filename: string): Promise<ContentVisibility> {
  let text: string;
  try {
    text = await readFile(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ALL_CONTENT;
    throw error;
  }
  const config: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    Object.keys(config).some((key) => !['mae', 'maruimo', 'howkey'].includes(key)) ||
    !('mae' in config) ||
    typeof config.mae !== 'boolean' ||
    !('maruimo' in config) ||
    typeof config.maruimo !== 'boolean' ||
    ('howkey' in config && typeof config.howkey !== 'boolean')
  )
    throw new Error(
      'local-visibility.json: mae, maruimo and optional howkey must be true or false',
    );
  return Object.freeze({
    hiddenCharacters: Object.freeze([
      ...(config.maruimo ? [] : ['maruimo']),
      ...('howkey' in config && !config.howkey ? ['howkey'] : []),
    ]),
    hideMae: !config.mae,
  });
}

/** Called with a validated, normalized served path so encoded/case variants cannot bypass it. */
export async function localContentOverride(
  servedPath: string,
  root: string,
  visibility: ContentVisibility,
): Promise<string | null | undefined> {
  if (!visibility.hiddenCharacters.length && !visibility.hideMae) return undefined;
  const hiddenModels = CHARACTER_MODELS.filter((model) =>
    visibility.hiddenCharacters.includes(model.species),
  ).map((model) => model.key);
  if (visibility.hideMae) hiddenModels.push('mae');
  const normalized = servedPath.toLowerCase();
  if (hiddenModels.some((key) => normalized.startsWith(`models/${key}/`))) return null;
  if (normalized === 'shared/character-profiles.mjs')
    return `export const CHARACTER_MODELS = Object.freeze(${JSON.stringify(visibleCharacters(visibility))}.map(Object.freeze));\n`;
  if (normalized === 'models/world-assets.json') {
    const catalog = JSON.parse(
      await readFile(path.join(root, 'public/models/world-assets.json'), 'utf8'),
    );
    catalog.assets = catalog.assets.filter(
      (asset: { modelKey: string; species?: string }) =>
        !hiddenModels.includes(asset.modelKey) &&
        !visibility.hiddenCharacters.includes(asset.species ?? ''),
    );
    return JSON.stringify(catalog);
  }
  return undefined;
}
