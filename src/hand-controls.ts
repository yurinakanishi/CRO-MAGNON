import { BUILD_PROFILE } from './build-profile.js';
import { MotionControls } from './motion-controls.js';
import { MotionPetHold } from './motion-interaction.js';

/** MMO packaging replaces this entry with an import-free disabled implementation. */
export function createHandControls(...args: ConstructorParameters<typeof MotionControls>) {
  if (!BUILD_PROFILE.cameraControls) return undefined;
  return { controls: new MotionControls(...args), petHold: new MotionPetHold() };
}
