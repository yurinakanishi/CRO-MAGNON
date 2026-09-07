export const CASTLE=Object.freeze({id:'valley-castle',key:'valley-castle',name:'白羽の大城',x:140,z:0,yaw:-1.05,scale:1,clearance:53,groundOffset:0});
export function castleWorld(x,z){const c=Math.cos(CASTLE.yaw),s=Math.sin(CASTLE.yaw);return {x:CASTLE.x+c*x+s*z,z:CASTLE.z-s*x+c*z};}
export function castleLocal(x,z){const c=Math.cos(CASTLE.yaw),s=Math.sin(CASTLE.yaw),dx=x-CASTLE.x,dz=z-CASTLE.z;return {x:c*dx-s*dz,z:s*dx+c*dz};}
export const CASTLE_GATE=Object.freeze({...castleWorld(0,35),name:'白羽の大城の城門'});
export const CASTLE_HALL=Object.freeze({...castleWorld(0,-12),name:'白羽の大城の広間'});
export const nearCastle=(x,z,margin=0)=>Math.hypot(x-CASTLE.x,z-CASTLE.z)<CASTLE.clearance+margin;
