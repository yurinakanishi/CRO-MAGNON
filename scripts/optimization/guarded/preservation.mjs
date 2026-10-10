// Compare the parts of a guarded candidate that simplification must preserve. Accessor and
// buffer-view numbers may change during packing; their interpretation and logical bytes may not.
import { accessorElements, jsonDifference } from '../glb.mjs';

const omit = (value, keys) =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));

export function preservationProblems(source, candidate, reduced) {
  const problems = [];
  const same = (a, b, at) => {
    const difference = jsonDifference(a, b, at);
    if (difference) problems.push(difference);
  };
  const accessor = (a, b, at) => {
    if (a === undefined && b === undefined) return;
    const before = source.json.accessors?.[a],
      after = candidate.json.accessors?.[b];
    if (!before || !after) {
      problems.push(`${at}: missing accessor`);
      return;
    }
    same(
      omit(before, ['bufferView', 'byteOffset', 'sparse']),
      omit(after, ['bufferView', 'byteOffset', 'sparse']),
      at,
    );
    try {
      if (
        !accessorElements(source.json, source.views, a).equals(
          accessorElements(candidate.json, candidate.views, b),
        )
      )
        problems.push(`${at}: data changed`);
    } catch (error) {
      problems.push(`${at}: invalid accessor (${error.message})`);
    }
  };
  const attributes = (a, b, at) => {
    same(Object.keys(a ?? {}).sort(), Object.keys(b ?? {}).sort(), `${at}.keys`);
    for (const [key, index] of Object.entries(a ?? {})) accessor(index, b?.[key], `${at}.${key}`);
  };
  const records = (a, b, at, compare) => {
    same(a?.length ?? 0, b?.length ?? 0, `${at}.length`);
    (a ?? []).forEach((record, i) => {
      if (!b?.[i]) problems.push(`${at}[${i}]: missing record`);
      else compare(record, b[i], `${at}[${i}]`, i);
    });
  };

  const packed = [
    'buffers',
    'bufferViews',
    'accessors',
    'meshes',
    'skins',
    'animations',
    'images',
    'extensionsUsed',
    'extensionsRequired',
  ];
  same(omit(source.json, packed), omit(candidate.json, packed), '$');
  for (const key of ['extensionsUsed', 'extensionsRequired'])
    same([...(source.json[key] ?? [])].sort(), [...(candidate.json[key] ?? [])].sort(), `$.${key}`);

  records(source.json.meshes, candidate.json.meshes, '$.meshes', (mesh, other, at, m) => {
    same(omit(mesh, ['primitives']), omit(other, ['primitives']), at);
    records(mesh.primitives, other.primitives, `${at}.primitives`, (primitive, next, where, p) => {
      same(
        omit(primitive, ['attributes', 'indices', 'targets']),
        omit(next, ['attributes', 'indices', 'targets']),
        where,
      );
      // correspondenceProblems separately compares the surviving elements of reduced primitives.
      if (!reduced.has(`${m}/${p}`)) {
        attributes(primitive.attributes, next.attributes, `${where}.attributes`);
        accessor(primitive.indices, next.indices, `${where}.indices`);
      }
      records(
        primitive.targets,
        next.targets,
        `${where}.targets`,
        (target, candidateTarget, targetAt) => attributes(target, candidateTarget, targetAt),
      );
    });
  });
  records(source.json.skins, candidate.json.skins, '$.skins', (skin, other, at) => {
    same(omit(skin, ['inverseBindMatrices']), omit(other, ['inverseBindMatrices']), at);
    accessor(skin.inverseBindMatrices, other.inverseBindMatrices, `${at}.inverseBindMatrices`);
  });
  records(
    source.json.animations,
    candidate.json.animations,
    '$.animations',
    (animation, other, at) => {
      same(omit(animation, ['samplers']), omit(other, ['samplers']), at);
      records(animation.samplers, other.samplers, `${at}.samplers`, (sampler, next, where) => {
        same(omit(sampler, ['input', 'output']), omit(next, ['input', 'output']), where);
        accessor(sampler.input, next.input, `${where}.input`);
        accessor(sampler.output, next.output, `${where}.output`);
      });
    },
  );
  records(source.json.images, candidate.json.images, '$.images', (image, other, at) => {
    same(omit(image, ['bufferView']), omit(other, ['bufferView']), at);
    if (image.bufferView === undefined && other.bufferView === undefined) return;
    const before = source.views[image.bufferView],
      after = candidate.views[other.bufferView];
    if (!before || !after || !Buffer.from(before).equals(after))
      problems.push(`${at}: bytes changed or missing`);
  });
  return problems;
}
