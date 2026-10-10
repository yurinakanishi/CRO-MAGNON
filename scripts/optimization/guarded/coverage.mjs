// Scene and instance coverage of a document. PROMOTED unchanged in algorithm from the pure part of
// the reviewed output-only proof (output/optimization-audit-20261009/lowpoly-high-tools-r04/
// pose.mjs: sceneInstances, meshCoverage, clipsOfScenes). The guarded-surface@1 verifier uses it
// to recompute, from the source file itself, which instances and clips a proof had to cover.

/** Every instance of every mesh, scene by scene (depth first); `repeated` nodes are reached more than once. */
export function sceneInstances(json) {
  const counts = new Map(),
    scenes = (json.scenes ?? []).map((scene, s) => {
      const instances = [],
        reached = new Set(),
        visit = (n, path) => {
          if (path.includes(n)) throw new Error(`node ${n} is its own ancestor`);
          const node = json.nodes?.[n];
          if (!node) throw new Error(`scene ${s} names a missing node ${n}`);
          counts.set(n, (counts.get(n) ?? 0) + 1);
          reached.add(n);
          if (node.mesh !== undefined)
            instances.push({
              scene: s,
              node: n,
              mesh: node.mesh,
              skin: node.skin ?? null,
              path: [...path, n],
            });
          for (const child of node.children ?? []) visit(child, [...path, n]);
        };
      for (const n of scene.nodes ?? []) visit(n, []);
      return { scene: s, instances, reached };
    });
  return {
    scenes,
    repeated: new Set([...counts].filter(([, count]) => count > 1).map(([n]) => n)),
  };
}

/** Per mesh: its instances in every scene and whether each can be verified (see the proof). */
export function meshCoverage(json) {
  const { scenes, repeated } = sceneInstances(json),
    coverage = (json.meshes ?? []).map((_, m) => ({
      mesh: m,
      instances: [],
      skins: new Set(),
      reasons: [],
    }));
  for (const scene of scenes)
    for (const instance of scene.instances) {
      const entry = coverage[instance.mesh];
      if (!entry) throw new Error(`node ${instance.node} names a missing mesh ${instance.mesh}`);
      entry.instances.push(instance);
      entry.skins.add(instance.skin);
      if (instance.path.some((n) => repeated.has(n)))
        entry.reasons.push(
          `node ${instance.node} in scene ${instance.scene} sits under a node reached more than once`,
        );
      if (instance.skin !== null) {
        const outside = (json.skins[instance.skin]?.joints ?? []).filter(
          (joint) => !scene.reached.has(joint),
        );
        if (outside.length)
          entry.reasons.push(
            `skin ${instance.skin} of node ${instance.node} has joint(s) ${outside.slice(0, 5).join(', ')} outside scene ${instance.scene}`,
          );
      }
    }
  return coverage.map((entry) => {
    const reasons = [...entry.reasons];
    if (!entry.instances.length)
      reasons.push('unreachable: no node in any scene instances this mesh');
    if (entry.skins.size > 1)
      reasons.push(
        `its instances use different skins (${[...entry.skins].map((skin) => (skin === null ? 'none' : skin)).join(', ')}); locks from one rig would not protect another`,
      );
    return {
      mesh: entry.mesh,
      instances: entry.instances.map(({ scene, node, skin, path }) => ({
        scene,
        node,
        skin,
        path,
      })),
      skin: entry.skins.size === 1 ? [...entry.skins][0] : null,
      verifiable: reasons.length === 0,
      reasons,
    };
  });
}

/** Clips that animate at least one node reached in each scene. */
export function clipsOfScenes(json, scenes) {
  return scenes.map((scene) =>
    (json.animations ?? []).flatMap((animation, c) =>
      (animation.channels ?? []).some((channel) => scene.reached.has(channel.target?.node))
        ? [c]
        : [],
    ),
  );
}
