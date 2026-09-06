// Shared placements of image-to-3D landmarks. Radii reserve a clear approach;
// collision uses the separately measured footprints of the delivered GLBs.
export const LANDMARKS=Object.freeze([
  {id:'volcano-main',key:'volcanic-cone',x:263,z:262,yaw:.32,scale:1,clearance:70},
  {id:'volcano-east',key:'volcanic-cone',x:338,z:196,yaw:2.4,scale:.55,clearance:40},
  {id:'glacier-gate',key:'glacier-spires',x:224,z:-130,yaw:.8,scale:1,clearance:14},
  {id:'glacier-west',key:'glacier-spires',x:166,z:-119,yaw:2.4,scale:.8,clearance:12},
  {id:'glacier-north',key:'glacier-spires',x:242,z:-189,yaw:1.4,scale:1.5,clearance:21},
  {id:'glacier-east',key:'glacier-spires',x:297,z:-139,yaw:3.1,scale:1.25,clearance:18},
  {id:'glacier-ridge',key:'glacier-spires',x:196,z:-213,yaw:4.1,scale:1.1,clearance:16},
  {id:'glacier-south',key:'glacier-spires',x:272,z:-62,yaw:5.2,scale:.75,clearance:12},
  {id:'glacier-snow',key:'glacier-spires',x:-166,z:-167,yaw:2.7,scale:.65,clearance:11},
  {id:'glacier-snow-north',key:'glacier-spires',x:-115,z:-209,yaw:.3,scale:.8,clearance:13},
].map(Object.freeze));
export const nearLandmark=(x,z,margin=0)=>LANDMARKS.some(item=>Math.hypot(x-item.x,z-item.z)<item.clearance+margin);
