// URL imports bypass the page-only import map. The build publishes the same
// source fitter and upstream mergeVertices utility with worker-resolvable URLs.
const modules = Promise.all([
  import(new URL('../vendor/three.module.js', import.meta.url).href),
  import(new URL('./river-bank-worker-fit.js', import.meta.url).href),
]);
// Install the listener synchronously: a posted job may arrive during imports.
self.onmessage = async ({ data }) => {
  const { id, attributes, index } = data;
  let source, geometry;
  try {
    const [core, { fitSourceRiverBank }] = await modules;
    source = new core.BufferGeometry();
    for (const [name, value] of Object.entries(attributes) as [string, any][])
      source.setAttribute(
        name,
        new core.BufferAttribute(value.array, value.itemSize, value.normalized),
      );
    if (index) source.setIndex(new core.BufferAttribute(index, 1));
    geometry = fitSourceRiverBank(source);
    const result = Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, a]: [string, any]) => [
        name,
        { array: a.array, itemSize: a.itemSize, normalized: a.normalized },
      ]),
    );
    const resultIndex = geometry.index?.array;
    const transfers = Object.values(result).map((a: any) => a.array.buffer);
    if (resultIndex) transfers.push(resultIndex.buffer);
    // WorkerGlobalScope's transfer overload is not in the browser DOM lib.
    (self as any).postMessage({ id, attributes: result, index: resultIndex }, transfers);
  } catch (error) {
    (self as any).postMessage({ id, error: String(error) });
  } finally {
    if (geometry !== source) geometry?.dispose();
    source?.dispose();
  }
};
export {};
