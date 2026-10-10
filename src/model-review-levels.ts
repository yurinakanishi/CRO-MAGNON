import type { RuntimeGLTF } from './embedded-glb.js';
import {
  packedLevels,
  templateLevels,
  type LevelRecord,
  type TemplateRecord,
} from './world-asset-levels.js';

/** One entry of the review page's model menu. */
export interface ReviewChoice {
  label: string;
  /** The menu value: the level's file URL, with `#scene=<i>` for a level of a packed file;
   * empty for a record the review refuses. */
  value: string;
  /** A level of a packed template: its record (as the game checks it) and level. */
  packed: { record: TemplateRecord; level: number; levels: number } | null;
  disabled: boolean;
}

/** The menu entries of one catalog record, in level order. An ordinary record lists its
 * model and each LOD file as before. A packed one (world-asset-levels.ts) lists each level
 * as its scene of the one file. A record the game would refuse is one disabled entry
 * naming the refusal, never a fallback to scene 0 or to another file. */
export function reviewChoices(
  asset: TemplateRecord & { name?: string },
  title: string,
): ReviewChoice[] {
  const base = asset.name ?? asset.modelKey;
  let plan: ReturnType<typeof templateLevels>;
  try {
    plan = templateLevels(asset);
  } catch (error) {
    return [
      {
        label: `${title} · 確認不可: ${(error as Error).message}`,
        value: '',
        packed: null,
        disabled: true,
      },
    ];
  }
  if ('files' in plan)
    return plan.files.map((file, index): ReviewChoice => ({
      label: index ? `${base} · LOD ${index}` : title,
      value: file.url,
      packed: null,
      disabled: false,
    }));
  const { file, levels } = plan;
  return Array.from({ length: levels }, (_, level): ReviewChoice => ({
    label: `${level ? `${base} · LOD ${level}` : title} · scene ${level}`,
    value: `${file.url}#scene=${level}`,
    packed: { record: asset, level, levels },
    disabled: false,
  }));
}

/** The record of a packed choice's level: the template record or one of its LODs. */
export function choiceLevel(choice: ReviewChoice): (LevelRecord & { triangles?: number }) | null {
  if (!choice.packed) return null;
  const { record, level } = choice.packed;
  return level ? (record.lods?.[level - 1] ?? null) : record;
}

/** What the review shows of `model`, the whole parse of the chosen file: the model itself,
 * or for a packed choice exactly its level's scene, after the game's checks of the parse
 * (packedLevels). The caller keeps `model` as the owner of every scene and releases it
 * whole, also when this throws. */
export function reviewedModel(model: RuntimeGLTF, choice: ReviewChoice | null) {
  if (!choice?.packed) return model;
  const { record, level, levels } = choice.packed;
  return packedLevels(model, levels, record.modelKey)[level];
}
