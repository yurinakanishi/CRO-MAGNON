import * as THREE from 'three';

const materials = new Map();
export function material(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .92, ...extra }));
  return materials.get(key);
}
export function mesh(geometry, color, parent, position = [0,0,0], scale = [1,1,1]) {
  const object = new THREE.Mesh(geometry, typeof color === 'string' ? material(color) : color);
  object.position.set(...position); object.scale.set(...scale); object.castShadow = true; object.receiveShadow = true;
  parent?.add(object); return object;
}
const sphere = new THREE.SphereGeometry(1, 12, 9);
const box = new THREE.BoxGeometry(1,1,1);
const cylinder = new THREE.CylinderGeometry(1,1,1,9);
const rock = new THREE.DodecahedronGeometry(1,0);
const sharedGeometry = new Set([sphere, box, cylinder, rock]);
export function disposeTemporaryGeometry(root) {
  const owned = new Set();
  root?.traverse(node => { if (node.geometry && !sharedGeometry.has(node.geometry)) owned.add(node.geometry); });
  owned.forEach(geometry => geometry.dispose());
}
function segment(parent, start, end, radius, color, endRadius = radius) {
  const a=new THREE.Vector3(...start), b=new THREE.Vector3(...end), delta=b.clone().sub(a);
  const item=mesh(new THREE.CylinderGeometry(endRadius,radius,delta.length(),8),color,parent);
  item.position.copy(a.add(b).multiplyScalar(.5));item.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return item;
}
function curveTube(parent, points, radius, color) {
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),16,radius,7,false),color,parent);
}

export function createHuman({species='cro',color='#b9a375',npc=false}={}) {
  const root=new THREE.Group(), body=new THREE.Group();root.add(body);
  const nea=species==='nea', skin=nea?'#b18a67':'#aa7856', fur=nea?'#948877':'#82654c';
  const height=nea?.95:1; body.scale.set(nea?1.1:1,height,nea?1.06:1);
  mesh(new THREE.CylinderGeometry(.29,.37,.73,10),fur,body,[0,1.23,0],[1,1,.69]);
  mesh(sphere,fur,body,[0,1.54,0],[.33,.25,.23]);
  const belt=mesh(new THREE.TorusGeometry(.322,.034,5,12),'#483c2c',body,[0,1.01,0],[1,.7,1]);belt.rotation.x=Math.PI/2;
  mesh(box,'#a7a17e',body,[.08,1.015,.239],[.12,.09,.035]);
  const strap=mesh(box,'#514434',body,[.005,1.4,.245],[.07,.67,.026]);strap.rotation.z=-.47;
  mesh(sphere,material(color),body,[-.3,1.64,-.02],[.18,.12,.25]);
  mesh(sphere,skin,body,[0,1.73,0],[.115,.16,.11]);
  const head=new THREE.Group();head.position.set(0,1.94,0);body.add(head);
  mesh(sphere,skin,head,[0,0,0],[nea?.248:.22,.275,.217]);
  mesh(sphere,'#3c3027',head,[0,.092,-.055],[.242,.245,.218]);
  mesh(sphere,skin,head,[0,-.035,.16],[.169,.17,.094]);
  mesh(sphere,skin,head,[0,-.008,.24],[.05,.075,.068]);
  for(const x of [-.083,.083]){
    mesh(sphere,'#272921',head,[x,.026,.225],[.024,.016,.014]);
    const brow=mesh(box,'#433327',head,[x,.074,.22],[.074,nea?.033:.02,.03]);brow.rotation.z=x<0?.12:-.12;
    mesh(sphere,skin,head,[Math.sign(x)*.224,-.012,0],[.04,.07,.04]);
  }
  if(nea)mesh(sphere,'#4c3a2b',head,[0,-.147,.14],[.17,.12,.1]);
  else mesh(sphere,'#392e24',head,[0,-.06,-.2],[.17,.19,.075]);
  mesh(box,'#73523f',head,[0,-.12,.243],[.078,.011,.009]);
  const limbs=[];
  for(const side of [-1,1]) {
    const hip=new THREE.Group();hip.position.set(side*.175,.91,0);body.add(hip);
    mesh(cylinder,skin,hip,[0,-.22,0],[.105,.43,.105]);
    const knee=new THREE.Group();knee.position.y=-.43;hip.add(knee);
    mesh(cylinder,skin,knee,[0,-.2,0],[.077,.4,.08]);
    mesh(cylinder,'#645039',knee,[0,-.31,0],[.09,.2,.095]);
    mesh(sphere,'#594631',knee,[0,-.405,.075],[.11,.07,.18]);
    const arm=new THREE.Group();arm.position.set(side*.345,1.56,0);body.add(arm);
    mesh(sphere,fur,arm,[side*.013,-.06,0],[.13,.185,.145]);
    mesh(cylinder,skin,arm,[side*.01,-.235,0],[.085,.33,.09]);
    const elbow=new THREE.Group();elbow.position.set(side*.01,-.37,0);arm.add(elbow);
    mesh(cylinder,skin,elbow,[0,-.155,.01],[.068,.31,.07]);
    mesh(sphere,skin,elbow,[0,-.33,.025],[.074,.085,.07]);
    limbs.push({hip,knee,arm,elbow,side});
  }
  // A primitive wooden spear is visible even before crafting the stone axe.
  const weapon=new THREE.Group();limbs[1].elbow.add(weapon);weapon.position.set(.03,-.32,.04);
  mesh(cylinder,'#8d7250',weapon,[0,.46,0],[.022,2.1,.022]);
  mesh(new THREE.ConeGeometry(.075,.25,4),'#bcc2bc',weapon,[0,1.61,0]);
  const axe=new THREE.Group();weapon.add(axe);axe.visible=false;
  mesh(rock,'#929b93',axe,[.095,.83,.0],[.19,.14,.065]);
  for(let i=0;i<3;i++)mesh(cylinder,'#493b2d',axe,[0,.75+i*.045,0],[.034,.018,.034]);
  const necklace=new THREE.Group();body.add(necklace);
  for(let i=0;i<7;i++)mesh(sphere,'#d2c4a0',necklace,[(i-3)*.05,1.64-Math.sin(i/6*Math.PI)*.12,.239],[.017,.024,.015]);
  // Irregular fur tips break the outline of the hide tunic.
  for(let i=0;i<15;i++){
    const a=i/15*Math.PI*2;
    const tuft=mesh(new THREE.ConeGeometry(.047,.15,4),i%2?'#6a543f':fur,body,[Math.sin(a)*.345,.84,Math.cos(a)*.238]);tuft.rotation.z=Math.PI;
  }
  root.userData={body,head,limbs,weapon,axe,phase:Math.random()*6,npc};
  return root;
}

export function animateHuman(root, time, moving, tool=false) {
  const {body,head,limbs,axe,phase,npc}=root.userData;
  const cycle=time*9+phase, blend=moving?1:0;
  body.position.y=moving?Math.abs(Math.sin(cycle))*.048:Math.sin(time*1.7+phase)*.014;
  limbs.forEach(({hip,knee,arm,elbow,side})=>{
    hip.rotation.x=Math.sin(cycle+side*Math.PI/2)*.62*blend;
    knee.rotation.x=Math.max(0,-Math.sin(cycle+side*Math.PI/2))*.7*blend;
    arm.rotation.x=-Math.sin(cycle+side*Math.PI/2)*.34*blend-(side===1?.14:0);
    arm.rotation.z=side*.1;elbow.rotation.x=-.12-(moving?.14:0);
  });
  head.rotation.y=npc?Math.sin(time*.4)*.18:0;axe.visible=tool;
}

export function createMammoth() {
  const root=new THREE.Group(),fur='#72513b',dark='#4b392c';
  mesh(sphere,fur,root,[0,2.05,0],[1.27,1.5,2.0]);
  mesh(sphere,'#805b40',root,[0,2.87,.57],[1.05,.9,1.2]);
  mesh(sphere,dark,root,[0,2.17,1.69],[.84,.92,.8]);
  mesh(sphere,fur,root,[0,2.77,1.72],[.74,.7,.61]);
  const legs=[];
  for(const x of [-.72,.72])for(const z of [-1.11,1.08]){
    const leg=new THREE.Group();leg.position.set(x,1.3,z);root.add(leg);
    mesh(cylinder,dark,leg,[0,-.53,0],[.33,1.22,.37]);mesh(sphere,'#4a4033',leg,[0,-1.06,.1],[.35,.2,.41]);legs.push(leg);
  }
  for(const side of [-1,1]){
    mesh(sphere,'#684633',root,[side*.75,2.48,1.46],[.25,.49,.35]);
    mesh(sphere,'#171c18',root,[side*.58,2.72,2.18],[.072,.066,.06]);
    curveTube(root,[[side*.5,1.85,2.11],[side*.8,1.33,2.65],[side*.79,1.47,3.41],[side*.58,1.94,3.62]],.12,'#d5c5a2');
  }
  const trunk=curveTube(root,[[0,2.4,2.24],[0,1.85,2.67],[0,.94,2.84],[.09,.44,3.04],[.16,.64,3.23]],.235,dark);
  curveTube(root,[[0,2,-1.85],[.05,1.45,-2.17],[.12,1.1,-2.2]],.065,dark);
  for(let i=0;i<36;i++){
    const a=i/36*Math.PI*2;const f=mesh(new THREE.ConeGeometry(.11,.5,4),i%3?fur:dark,root,[Math.sin(a)*1.15,1.27+(i%3)*.18,Math.cos(a)*1.7]);f.rotation.z=Math.PI+Math.sin(a)*.25;
  }
  root.userData={legs,trunk};return root;
}

export function createTent(scale=1) {
  const group=new THREE.Group();group.scale.setScalar(scale);
  const geometry=new THREE.BufferGeometry();
  // Two sloping hide panels with an open, triangular front.
  const vertices=[-2,0,-1.6,0,3.25,-1.6,0,3.25,1.6,-2,0,-1.6,0,3.25,1.6,-2,0,1.6,
    0,3.25,-1.6,2,0,-1.6,2,0,1.6,0,3.25,-1.6,2,0,1.6,0,3.25,1.6,
    -2,0,-1.6,2,0,-1.6,0,3.25,-1.6];
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
  mesh(geometry,material('#b49a73',{side:THREE.DoubleSide}),group);
  for(const z of [-1.7,1.7]){
    segment(group,[-2.18,-.12,z],[.25,3.7,z],.055,'#615440');
    segment(group,[2.18,-.12,z],[-.25,3.7,z],.055,'#776347');
  }
  segment(group,[0,3.3,-2],[0,3.3,2],.065,'#594c36');
  for(const z of [-1.6,0,1.6])for(const side of [-1,1]){
    segment(group,[0,3.26,z],[side*2.1,.02,z],.015,'#63503b');
    segment(group,[side*1.3,1.15,z],[side*2.85,0,z+.35],.016,'#b8aa80');
    mesh(cylinder,'#624f36',group,[side*2.85,.15,z+.35],[.045,.43,.045]);
  }
  const floor=mesh(new THREE.CircleGeometry(1.4,13),'#574c3b',group,[0,.04,.2],[1,1,1.3]);floor.rotation.x=-Math.PI/2;
  for(let i=0;i<3;i++)mesh(sphere,'#8f7b59',group,[-.7+i*.65,.2,-.75],[.34,.18,.54]);
  return group;
}

export function createResource(type) {
  const group=new THREE.Group();
  if(type==='wood') {
    for(let i=0;i<4;i++){
      const log=mesh(cylinder,i%2?'#6d553b':'#7e6141',group,[(i%2)*.42-.2,.18+Math.floor(i/2)*.28,(i%2)*.1],[.18,1.8,.18]);log.rotation.x=Math.PI/2;log.rotation.z=(i-1)*.08;
      const end=mesh(new THREE.CircleGeometry(.15,10),'#b79b6b',group,[(i%2)*.42-.2,.18+Math.floor(i/2)*.28,.91+(i%2)*.1]);end.rotation.z=i;
    }
  } else if(type==='stone') {
    for(let i=0;i<4;i++){const stone=mesh(rock,i%2?'#8f9583':'#747f75',group,[Math.sin(i*2)*.6,.25+i*.04,Math.cos(i*2)*.5],[.46+i*.07,.4+i*.07,.45]);stone.rotation.set(i,.7*i,.25);}
  } else {
    for(let i=0;i<5;i++)mesh(new THREE.IcosahedronGeometry(1,1),i%2?'#4e683f':'#687e47',group,[Math.sin(i*2)*.39,.52+i*.08,Math.cos(i*2)*.35],[.49,.55,.45]);
    for(let i=0;i<13;i++)mesh(sphere,'#a65b61',group,[Math.sin(i*2.4)*.66,.52+(i%4)*.15,Math.cos(i*2.4)*.59],[.065,.075,.065]);
  }
  return group;
}

export function disposeMaterialCache(){for(const mat of materials.values())mat.dispose();materials.clear();}
