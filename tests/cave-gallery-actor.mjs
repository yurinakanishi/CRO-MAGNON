// Gallery lifecycle tests need the delivered hands/skin now that it holds a torch.
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CharacterAssets } from '../dist/src/character-assets.js';
import { deliveredWomanRig } from './cro-magnon-woman-rig.mjs';

let source;
export async function createGalleryActor() {
  source ??= deliveredWomanRig();
  const { primary, lod, asset } = await source;
  const provider = new CharacterAssets(undefined, {
    loadModel: async () => ({
      gltf: { scene: clone(primary.scene), animations: primary.animations },
      lod: lod && { scene: clone(lod.scene) },
      asset,
    }),
  });
  const actor = await provider.create({ color: '#b5956e' });
  const dispose = actor.dispose.bind(actor);
  actor.dispose = () => {
    dispose();
    provider.dispose();
  };
  return actor;
}
