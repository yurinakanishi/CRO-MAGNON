// Shared placements of image-to-3D landmarks. Radii reserve a clear approach;
// collision uses the separately measured footprints of the delivered GLBs.
import { geoToWorld } from './paleo-geography.mjs';
export const LANDMARKS=Object.freeze([
  ['volcano-main','volcanic-cone',45,40.5,.32,.38,28],
  ['volcano-rift','volcanic-cone',36,-3,2.4,.70,50],
  ['volcano-andes','volcanic-cone',-68.5,-18,1.2,.35,25],
  ['volcano-cascades','volcanic-cone',-121,43,.6,.28,20],
  ['volcano-japan','volcanic-cone',137.8,36.2,2.1,.13,10],
  ['glacier-gate','glacier-spires',19.7,68.5,.8,.8,12],
  ['glacier-north','glacier-spires',18.6,65.5,1.4,.9,14],
  ['glacier-greenland','glacier-spires',-39,74,3.1,1.5,22],
  ['glacier-canada','glacier-spires',-99,63,4.1,1.5,22],
  ['glacier-canada-west','glacier-spires',-117,65,5.2,1.1,16],
  ['glacier-antarctica','glacier-spires',23,-76,2.7,1.8,27],
  ['glacier-antarctica-east','glacier-spires',87,-77,.3,1.4,21],
].map(([id,key,lon,lat,yaw,scale,clearance])=>Object.freeze({id,key,...geoToWorld(lon,lat),yaw,scale,clearance})));
export const nearLandmark=(x,z,margin=0)=>LANDMARKS.some(item=>Math.hypot(x-item.x,z-item.z)<item.clearance+margin);
