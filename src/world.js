const W = 14;
const H = 7;
const TAU = Math.PI * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const project = (x, z) => ({ x: (x - z) * W, y: (x + z) * H });

function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poly(ctx, points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fill();
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function sprite(width, height, painter, anchorX = width / 2, anchorY = height - 4) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  painter(ctx);
  return { canvas, anchorX, anchorY, width, height };
}

function shadow(ctx, x, y, rx, ry, alpha = 0.16) {
  ctx.fillStyle = `rgba(29,52,35,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.16, 0, TAU);
  ctx.fill();
}

function treeSprite(kind, variant) {
  const rng = random(variant * 345 + 88);
  const pine = kind === 'pine';
  return sprite(110, pine ? 126 : 108, ctx => {
    const bottom = pine ? 119 : 101;
    shadow(ctx, 63, bottom - 1, 39, 10, 0.15);
    rect(ctx, 51, bottom - 29, 8, 27, '#66543b');
    rect(ctx, 56, bottom - 27, 4, 24, '#8a7048');
    rect(ctx, 48, bottom - 3, 17, 4, '#635b3c');
    if (pine) {
      const palettes = [
        ['#345948', '#477459', '#659060', '#81a069'],
        ['#365e52', '#4f7b61', '#6c9270', '#88a777'],
        ['#4c6346', '#627c50', '#819358', '#9dab6c'],
      ][variant % 3];
      for (let layer = 0; layer < 4; layer++) {
        const y = 13 + layer * 20;
        const spread = 20 + layer * 8;
        poly(ctx, [[54,y],[54-spread,y+35],[54-spread+9,y+35],[54-spread+9,y+41],[54+spread-3,y+41],[54+spread-3,y+35],[54+spread,y+35]], palettes[0]);
        poly(ctx, [[54,y],[54-spread,y+35],[48,y+33],[48,y+39],[60,y+34]], palettes[1]);
        poly(ctx, [[54,y],[54-spread+4,y+30],[45,y+25],[45,y+30],[54,y+24]], palettes[2]);
        rect(ctx, 44 - layer * 4, y + 25, 7, 3, palettes[3]);
        rect(ctx, 59 + layer * 4, y + 33, 8, 3, palettes[1]);
      }
    } else {
      const colors = variant % 3 === 0 ? ['#526743','#78854c','#a1a466','#bdba7a'] : ['#47684b','#6d8756','#91a56b','#adbb7c'];
      [[38,47,28],[62,39,28],[77,55,24],[33,66,25],[60,68,31]].forEach(([cx,cy,r],i) => {
        poly(ctx, [[cx-r+5,cy-r/2],[cx-r/2,cy-r],[cx+r/2-3,cy-r],[cx+r,cy-8],[cx+r,cy+r/2],[cx+7,cy+r],[cx-r+5,cy+r-5]], colors[0]);
        poly(ctx, [[cx-r+5,cy-r/2],[cx-r/2,cy-r],[cx+r/2-3,cy-r],[cx+r-3,cy-8],[cx+8,cy+r-5],[cx-r+5,cy+r-8]], colors[1]);
        rect(ctx, cx-r+8, cy-r/2, r-1, 7, colors[2]);
        rect(ctx, cx-r+13, cy-r/2-5, r-8, 7, colors[2]);
        if (i % 2 === 0) rect(ctx, cx-r+15, cy-r/2, 8, 3, colors[3]);
      });
      for (let i = 0; i < 8; i++) rect(ctx, 25 + rng()*56, 31 + rng()*42, 4, 3, colors[2]);
    }
  }, 55, pine ? 119 : 101);
}

function tentSprite(small = false) {
  return sprite(150, 109, ctx => {
    shadow(ctx, 82, 94, 62, 13, .19);
    const c = small ? ['#95866b','#b5a082','#d2bb96','#746248'] : ['#aa8360','#c29e75','#ddbc8a','#80634a'];
    poly(ctx, [[18,85],[53,32],[100,15],[139,76],[109,99],[62,95]], c[0]);
    poly(ctx, [[53,32],[100,15],[110,97],[62,94]], c[1]);
    poly(ctx, [[18,85],[53,32],[62,95]], c[2]);
    poly(ctx, [[100,15],[139,76],[110,97]], c[0]);
    poly(ctx, [[33,89],[53,42],[56,93]], '#504a37');
    poly(ctx, [[33,89],[52,45],[45,86]], '#3c4231');
    poly(ctx, [[53,32],[60,74],[63,94],[70,96],[59,35]], '#e3cda2');
    poly(ctx, [[93,20],[102,67],[109,97],[115,93],[101,21]], c[2]);
    rect(ctx, 98, 5, 4, 24, '#695139');
    rect(ctx, 102, 8, 3, 18, '#8b6946');
    rect(ctx, 50, 26, 4, 21, '#856a46');
    rect(ctx, 18, 81, 4, 13, '#65533b');
    rect(ctx, 135, 73, 4, 14, '#65533b');
    for (let i = 0; i < 6; i++) {
      rect(ctx, 77+i*4, 38+i*7, 3, 2, '#9f7c58');
      rect(ctx, 76+i*4, 40+i*7, 2, 3, '#ead0a4');
    }
    poly(ctx, [[79,72],[88,64],[91,70],[89,77],[84,78]], '#987754');
    rect(ctx, 119, 56, 6, 3, '#bc9972');
    poly(ctx, [[7,94],[22,85],[40,92],[26,102]], '#968f59');
    rect(ctx, 26, 97, 17, 3, '#d4c895');
  }, 75, 97);
}

function rockSprite(variant) {
  return sprite(65, 45, ctx => {
    shadow(ctx, 35, 38, 25, 7);
    poly(ctx, [[9,31],[15,16],[29,8],[48,12],[57,30],[43,39],[20,38]], '#7e877b');
    poly(ctx, [[15,16],[29,8],[48,12],[37,23],[9,31]], '#b2b3a0');
    poly(ctx, [[37,23],[48,12],[57,30],[43,39]], '#8d9588');
    poly(ctx, [[16,19],[28,13],[33,14],[25,22]], '#c6c5aa');
    rect(ctx, 18, 34, 10, 3, '#6f7c67');
    if (variant % 2) {
      rect(ctx, 36, 12, 10, 4, '#8f9d68');
      rect(ctx, 42, 16, 9, 3, '#8b9b61');
    }
    poly(ctx, [[1,38],[7,31],[16,34],[18,41],[8,44]], '#a1aa96');
  }, 32, 38);
}

function bushSprite(berry = false, variant = 0) {
  return sprite(49, 36, ctx => {
    shadow(ctx, 26, 29, 21, 6, .13);
    poly(ctx, [[4,24],[7,14],[16,14],[18,7],[29,7],[33,12],[41,14],[45,26],[36,31],[12,30]], '#566d3f');
    poly(ctx, [[7,14],[16,14],[18,7],[29,7],[33,12],[40,14],[36,23],[17,27],[5,24]], '#7b9251');
    rect(ctx, 18, 10, 9, 4, '#9faa62');
    rect(ctx, 9, 16, 8, 4, '#9fac63');
    if (berry) [[13,19],[23,15],[32,22],[19,25],[34,15]].forEach(([x,y]) => {
      rect(ctx,x,y,5,5,'#7a4b55');
      rect(ctx,x,y,3,2,'#c38486');
    });
    else if (variant % 3 === 0) [[11,17],[25,11],[36,21]].forEach(([x,y]) => rect(ctx,x,y,3,3,'#e0ce8b'));
  }, 25, 29);
}

function mammothSprite(flip = false, frame = 0) {
  return sprite(117, 84, ctx => {
    if (flip) { ctx.translate(117,0); ctx.scale(-1,1); }
    shadow(ctx,57,72,47,10,.2);
    rect(ctx,23,49,13,25+(frame%2)*2,'#665346');
    rect(ctx,69,50,13,26-(frame%2)*2,'#645043');
    rect(ctx,20,71,18,6,'#574d40');
    rect(ctx,68,71,17,6,'#574d40');
    poly(ctx,[[13,49],[14,34],[24,21],[43,15],[67,19],[82,31],[85,58],[75,65],[24,64]],'#806449');
    poly(ctx,[[15,34],[24,21],[43,15],[67,19],[75,30],[74,46],[52,52],[19,47]],'#9e7d55');
    poly(ctx,[[20,30],[30,22],[49,19],[67,24],[63,30],[37,27]],'#b19363');
    for(let i=0;i<10;i++) rect(ctx,21+i*6,48+(i%3)*3,4,14-(i%2)*4,'#806449');
    poly(ctx,[[70,31],[80,20],[95,22],[105,35],[101,48],[90,54],[73,46]],'#94704c');
    poly(ctx,[[79,24],[88,21],[100,29],[101,34],[84,33]],'#b08b5d');
    poly(ctx,[[95,38],[105,36],[108,59],[103,69],[95,69],[92,62],[99,62],[99,54]],'#94704c');
    poly(ctx,[[76,35],[84,35],[89,43],[85,55],[77,51]],'#745642');
    rect(ctx,96,34,3,3,'#363d31');
    rect(ctx,96,33,2,1,'#d5b17a');
    poly(ctx,[[99,46],[97,51],[101,57],[109,57],[113,53],[116,47],[113,51],[108,53],[104,52],[103,45]],'#eee0b8');
    poly(ctx,[[91,48],[88,53],[92,61],[101,63],[109,59],[113,52],[108,56],[101,58],[96,56],[95,49]],'#e9d7aa');
    rect(ctx,8,41,7,3,'#7d634a');
    rect(ctx,7,44,4,11,'#685440');
  }, 59, 76);
}

function humanSprite(color = '#bd795b', species = 'cro', frame = 0, facing = 1) {
  return sprite(42, 59, ctx => {
    if (facing < 0) { ctx.translate(42,0);ctx.scale(-1,1); }
    shadow(ctx,20,52,13,4,.23);
    const skin = species === 'nea' ? '#cda27b' : '#d4a37c';
    const hair = species === 'nea' ? '#685441' : '#544638';
    const move = frame % 2 ? 3 : 0;
    rect(ctx,14,40,5,10-move,'#80604a');
    rect(ctx,22,40,5,8+move,'#a57b57');
    rect(ctx,12,48-move,8,5,'#67513d');
    rect(ctx,22,48+move,8,4,'#67513d');
    poly(ctx,[[12,27],[19,24],[27,27],[29,42],[22,45],[10,41]],color);
    poly(ctx,[[12,27],[17,25],[20,34],[17,42],[10,41]],'#967855');
    rect(ctx,17,26,5,7,'#d1bc8d');
    rect(ctx,11,37,18,3,'#655d45');
    rect(ctx,23,38,4,4,'#b6ad8a');
    rect(ctx,7,29,6,13,'#bc9067');
    rect(ctx,27,29,5,13,skin);
    rect(ctx,8,38,5,7,skin);
    rect(ctx,29,40,6,5,skin);
    rect(ctx,13,12,14,16,hair);
    rect(ctx,16,14,13,12,skin);
    rect(ctx,14,10,13,6,hair);
    rect(ctx,12,15,5,10,hair);
    rect(ctx,26,19,5,4,skin);
    rect(ctx,25,17,3,2,'#454135');
    rect(ctx,19,24,8,5,hair);
    rect(ctx,22,23,6,2,'#bc8a64');
    if(species === 'nea') {
      rect(ctx,11,12,5,16,hair);
      rect(ctx,15,25,10,4,hair);
      rect(ctx,22,16,7,2,hair);
      rect(ctx,9,27,6,5,'#cab994');
      rect(ctx,24,26,5,6,'#cab994');
    }
    rect(ctx,34,16,2,39,'#836744');
    poly(ctx,[[35,6],[31,19],[38,17]],'#c8cbc0');
    poly(ctx,[[35,6],[35,18],[38,17]],'#89968a');
    rect(ctx,33,19,4,4,'#b7a27b');
  }, 21, 52);
}

const previewResources = [
  {id:'preview-w1',type:'wood',x:40,z:48,amount:8},
  {id:'preview-w2',type:'wood',x:55,z:63,amount:8},
  {id:'preview-w3',type:'wood',x:38,z:61,amount:8},
  {id:'preview-s1',type:'stone',x:58,z:44,amount:8},
  {id:'preview-s2',type:'stone',x:40,z:56,amount:8},
  {id:'preview-b1',type:'berry',x:61,z:53,amount:8},
  {id:'preview-b2',type:'berry',x:47,z:36,amount:8},
];

export class WorldRenderer {
  constructor(canvas, { onMoveTarget = () => {}, onHover = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.onMoveTarget = onMoveTarget;
    this.onHover = onHover;
    this.state = { players: [], resources: previewResources, camp: {x:50,z:50,wood:0,stone:0,level:1}, npc:{x:70,z:41,name:'オル'} };
    this.selfId = null;
    this.zoom = .94;
    this.camera = { ...project(50,50) };
    this.cameraTarget = { ...this.camera };
    this.follow = true;
    this.playerPositions = new Map();
    this.sprites = new Map();
    this.staticObjects = [];
    this.lastFrame = performance.now();
    this.time = 0;
    this.target = null;
    this.hovered = null;
    this.destroyed = false;
    this.makeScene();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.pointerDown = event => { this.pointerStart = {x:event.clientX,y:event.clientY,cameraX:this.camera.x,cameraY:this.camera.y};this.dragged = false; };
    this.pointerMove = event => {
      const bounds = this.canvas.getBoundingClientRect();
      const sx = event.clientX-bounds.left, sy = event.clientY-bounds.top;
      if(this.pointerStart && event.buttons) {
        const dx = event.clientX-this.pointerStart.x, dy = event.clientY-this.pointerStart.y;
        if(Math.hypot(dx,dy)>6) {
          this.dragged = true;this.follow = false;
          this.cameraTarget = {x:this.pointerStart.cameraX-dx/this.zoom,y:this.pointerStart.cameraY-dy/this.zoom};
          this.camera = {...this.cameraTarget};
        }
      }
      const world = this.screenToWorld(sx,sy);
      this.hovered = this.findNearby(world.x,world.z,3.2);
      this.canvas.style.cursor = this.dragged ? 'grabbing' : this.hovered ? 'pointer' : 'crosshair';
      this.onHover(this.hovered ? {...this.hovered,screenX:sx,screenY:sy} : null);
    };
    this.pointerUp = event => {
      if(this.pointerStart && !this.dragged && event.button === 0) {
        const bounds = this.canvas.getBoundingClientRect();
        const point = this.screenToWorld(event.clientX-bounds.left,event.clientY-bounds.top);
        point.x=clamp(point.x,2,98);point.z=clamp(point.z,2,98);
        this.target = {...point,at:this.time};
        this.onMoveTarget(Math.round(point.x*100)/100,Math.round(point.z*100)/100);
      }
      this.pointerStart=null;this.dragged=false;
    };
    this.pointerLeave = () => {this.pointerStart=null;this.hovered=null;this.onHover(null);};
    this.wheel = event => {event.preventDefault();this.setZoom(this.zoom+(event.deltaY>0?-.055:.055));};
    canvas.addEventListener('pointerdown',this.pointerDown);
    canvas.addEventListener('pointermove',this.pointerMove);
    window.addEventListener('pointerup',this.pointerUp);
    canvas.addEventListener('pointerleave',this.pointerLeave);
    canvas.addEventListener('wheel',this.wheel,{passive:false});
    this.animate = now => {
      if(this.destroyed)return;
      const dt=Math.min((now-this.lastFrame)/1000,.06);this.lastFrame=now;this.time=now/1000;
      this.update(dt);this.render();this.frame=requestAnimationFrame(this.animate);
    };
    this.frame=requestAnimationFrame(this.animate);
  }

  cached(key, factory) {
    if(!this.sprites.has(key))this.sprites.set(key,factory());
    return this.sprites.get(key);
  }

  makeScene() {
    this.terrain = document.createElement('canvas');
    this.terrain.width=3160;this.terrain.height=1800;
    this.terrainOrigin={x:1580,y:180};
    const ctx=this.terrain.getContext('2d');
    ctx.translate(this.terrainOrigin.x,this.terrainOrigin.y);
    const rng=random(98274);
    const greens=['#86935f','#909c66','#8c9863','#97a16c','#839261','#919c69','#9aa56f'];
    poly(ctx,[[-1400,700],[0,0],[1400,700],[0,1400]],'#919e69');
    for(let x=0;x<100;x+=2)for(let z=0;z<100;z+=2) {
      const p=project(x,z);
      poly(ctx,[[p.x,p.y],[p.x+28,p.y+14],[p.x,p.y+28],[p.x-28,p.y+14]],greens[Math.floor(rng()*greens.length)]);
    }
    for(let i=0;i<1800;i++) {
      const x=rng()*100,z=rng()*100,p=project(x,z),size=6+rng()*30;
      poly(ctx,[[p.x-size,p.y],[p.x-size*.3,p.y-size*.27],[p.x+size*.7,p.y-size*.2],[p.x+size,p.y+size*.13],[p.x-size*.3,p.y+size*.3]],['#a4ac74','#7e915c','#9eaa73','#869964'][i%4]);
    }
    // The clearing is built from small, irregular soil patches.
    for(let i=0;i<450;i++) {
      const a=rng()*TAU,r=Math.sqrt(rng())*13;
      const x=50+Math.cos(a)*r,z=50+Math.sin(a)*r*.82;
      const p=project(x,z),size=8+rng()*26;
      const distance=r/13;
      if(rng()<distance*.35)continue;
      poly(ctx,[[p.x-size,p.y],[p.x-size*.2,p.y-size*.35],[p.x+size,p.y],[p.x+size*.2,p.y+size*.4]],['#b1ae7b','#b8b080','#c0b58a','#b2ad78','#c4b98c'][i%5]);
    }
    const path=(points,width,color)=>{
      ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
      points.forEach(([x,z],i)=>{const p=project(x,z);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.stroke();
    };
    path([[17,58],[29,52],[38,50],[50,50],[59,46],[69,42],[77,42]],30,'#a3a474');
    path([[17,58],[29,52],[38,50],[50,50],[59,46],[69,42],[77,42]],16,'#b9b184');
    path([[49,50],[49,59],[44,70],[48,89]],25,'#a8a778');
    path([[49,50],[49,59],[44,70],[48,89]],12,'#bab386');
    // A glacial stream travels along the east side of the valley.
    const river=[];
    for(let z=-8;z<=110;z+=2)river.push([82+Math.sin(z*.087)*4+Math.sin(z*.21)*1.6,z]);
    path(river,105,'#849574');
    path(river,86,'#c0ba94');
    path(river,71,'#739c99');
    path(river,57,'#79aaa6');
    path(river.map(([x,z])=>[x-.8,z]),23,'#91bcb6');
    for(let i=0;i<135;i++) {
      const z=rng()*100,x=82+Math.sin(z*.087)*4+Math.sin(z*.21)*1.6+(rng()-.5)*2.2,p=project(x,z);
      rect(ctx,p.x,p.y,8+rng()*14,2,i%3===0?'#b9d7c8':'#a0c9be');
    }
    for(let i=0;i<5400;i++) {
      const x=rng()*100,z=rng()*100;
      if(this.inRiver(x,z)||Math.hypot(x-50,(z-50)*1.2)<11)continue;
      const p=project(x,z),color=['#aeb680','#758950','#b9be86','#82935b','#a2ad72'][i%5];
      rect(ctx,p.x,p.y,2,2+rng()*3,color);
      if(i%3===0)rect(ctx,p.x+4,p.y+2,2,3,color);
    }
    for(let i=0;i<1100;i++) {
      const x=rng()*100,z=rng()*100;if(this.inRiver(x,z))continue;
      const p=project(x,z);
      rect(ctx,p.x,p.y,2+rng()*3,2,i%4===0?'#d2ca9d':'#899264');
    }
    for(let i=0;i<325;i++) {
      const x=3+rng()*94,z=3+rng()*94;
      if(this.inRiver(x,z,5)||Math.hypot(x-50,(z-50)*1.15)<14||Math.hypot(x-69,z-41)<8)continue;
      // Keep the paths visible through the canopy.
      if(x>25&&x<78&&Math.abs(z-(58-(x-17)*.3))<2)continue;
      this.staticObjects.push({type:rng()>.25?'pine':'tree',x,z,variant:i%6,scale:.67+rng()*.48});
    }
    for(let i=0;i<88;i++) {
      const x=4+rng()*92,z=4+rng()*92;
      if(this.inRiver(x,z,3)||Math.hypot(x-50,z-50)<9)continue;
      this.staticObjects.push({type:i%4===0?'rock':'bush',x,z,variant:i,scale:.65+rng()*.5});
    }
    // Foreground silhouettes frame the camp without hiding its usable center.
    [[32,54],[35,67],[50,73],[63,65],[62,31],[46,29],[31,37],[70,50]].forEach(([x,z],i)=>{
      this.staticObjects.push({type:'pine',x,z,variant:i%6,scale:1.15});
    });
    this.staticObjects.push({type:'tent',x:46,z:46,variant:0,scale:1.06});
    this.staticObjects.push({type:'tent',x:53,z:42,variant:1,scale:.88});
    this.staticObjects.push({type:'tent',x:69,z:38,variant:2,scale:.75});
    this.staticObjects.push({type:'rack',x:55,z:47,scale:1});
    this.staticObjects.push({type:'woodpile',x:46,z:53,scale:1});
    this.staticObjects.push({type:'bones',x:67,z:43,scale:1});
  }

  inRiver(x,z,padding=0) {return Math.abs(x-(82+Math.sin(z*.087)*4+Math.sin(z*.21)*1.6))<2.1+padding;}

  getSprite(object) {
    switch(object.type) {
      case 'pine':case 'tree':return this.cached(`${object.type}-${object.variant%6}`,()=>treeSprite(object.type,object.variant%6));
      case 'tent':return this.cached(`tent-${object.variant===2}`,()=>tentSprite(object.variant===2));
      case 'rock':case 'stone':return this.cached(`rock-${object.variant%2||0}`,()=>rockSprite(object.variant||0));
      case 'berry':return this.cached('berry',()=>bushSprite(true));
      case 'bush':return this.cached(`bush-${object.variant%3}`,()=>bushSprite(false,object.variant));
      case 'wood':return this.cached('resource-wood',()=>sprite(63,48,ctx=>{
        shadow(ctx,32,40,26,7,.17);
        poly(ctx,[[8,32],[15,20],[50,27],[53,38],[43,43],[11,38]],'#795d3d');
        poly(ctx,[[15,20],[50,27],[44,33],[8,27]],'#b3935b');
        poly(ctx,[[9,27],[15,31],[16,39],[8,35]],'#d0b47b');
        rect(ctx,21,28,19,3,'#795d3d');rect(ctx,32,36,17,3,'#9d7949');
        rect(ctx,16,16,6,11,'#795d3d');rect(ctx,14,14,9,4,'#b3935b');
        rect(ctx,39,24,6,3,'#78905c');
      },31,40));
      case 'woodpile':return this.cached('woodpile',()=>sprite(68,41,ctx=>{
        shadow(ctx,35,34,30,7,.19);
        [[9,19],[24,15],[11,27],[27,24],[37,18]].forEach(([x,y],i)=>{
          poly(ctx,[[x,y],[x+24,y-6],[x+32,y],[x+8,y+8]],i%2?'#947047':'#836443');
          poly(ctx,[[x,y],[x+8,y+2],[x+8,y+8],[x,y+6]],'#d0b483');
          rect(ctx,x+2,y+2,3,3,'#a98c62');
        });
      },34,35));
      case 'rack':return this.cached('rack',()=>sprite(75,75,ctx=>{
        shadow(ctx,39,68,34,8,.15);
        rect(ctx,10,15,4,52,'#795f3d');rect(ctx,61,8,4,58,'#795f3d');
        poly(ctx,[[8,14],[63,7],[65,12],[8,19]],'#a98c5c');
        poly(ctx,[[21,20],[28,25],[42,20],[49,18],[56,27],[47,46],[43,56],[29,53],[19,39]],'#ad8661');
        poly(ctx,[[26,24],[36,26],[49,20],[47,42],[39,50],[27,45]],'#d4b288');
        rect(ctx,25,16,2,10,'#ddd0a4');rect(ctx,48,12,2,10,'#ddd0a4');
        poly(ctx,[[7,69],[14,50],[17,51],[11,70]],'#8d744b');
      },37,68));
      case 'bones':return this.cached('bones',()=>sprite(69,31,ctx=>{
        shadow(ctx,33,24,27,6,.12);
        poly(ctx,[[9,19],[14,14],[38,17],[43,20],[36,24],[13,22]],'#d5cfad');
        poly(ctx,[[22,16],[27,8],[35,6],[45,10],[51,20],[40,23]],'#dfd7b4');
        rect(ctx,36,13,5,4,'#77775d');rect(ctx,45,17,4,3,'#8f8b6a');
        poly(ctx,[[29,9],[24,4],[18,5],[22,3],[28,4],[33,8]],'#ede1ba');
        poly(ctx,[[32,9],[29,2],[34,0],[37,5],[37,8]],'#ede1ba');
      },34,24));
      default:return null;
    }
  }

  setState(state, selfId) {
    this.state={...this.state,...state};
    if(selfId!==undefined)this.selfId=selfId;
    const players = Array.isArray(this.state.players) ? this.state.players : Object.values(this.state.players||{});
    this.state.players=players;
    for(const p of players)if(!this.playerPositions.has(p.id))this.playerPositions.set(p.id,{x:p.x,z:p.z,lastX:p.x,lastZ:p.z,facing:1,moving:false});
    for(const id of this.playerPositions.keys())if(!players.some(p=>p.id===id))this.playerPositions.delete(id);
  }

  setZoom(value) {this.zoom=clamp(Number(value)||.94,.6,1.6);}
  focusPlayer() {this.follow=true;}
  setMapMode() {this.setZoom(this.zoom<.8?.94:.62);}

  resize() {
    const bounds=this.canvas.getBoundingClientRect();
    this.width=Math.max(1,bounds.width);this.height=Math.max(1,bounds.height);
    this.dpr=Math.min(window.devicePixelRatio||1,2);
    this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);
    this.ctx.imageSmoothingEnabled=false;
  }

  worldToScreen(x,z) {
    const p=project(x,z);
    return {x:(p.x-this.camera.x)*this.zoom+this.width/2,y:(p.y-this.camera.y)*this.zoom+this.height*.54};
  }

  screenToWorld(x,y) {
    const px=(x-this.width/2)/this.zoom+this.camera.x;
    const py=(y-this.height*.54)/this.zoom+this.camera.y;
    return {x:(px/W+py/H)/2,z:(py/H-px/W)/2};
  }

  findNearby(x,z,radius) {
    const possible=[...(this.state.resources||[]).filter(r=>r.amount>0),...(this.state.npc?[{...this.state.npc,type:'npc'}]:[]),{...this.state.camp,type:'camp'}];
    let nearest=null,dist=radius;
    for(const object of possible){const d=Math.hypot(x-object.x,z-object.z);if(d<dist){dist=d;nearest=object;}}
    return nearest;
  }

  update(dt) {
    for(const p of this.state.players) {
      const pos=this.playerPositions.get(p.id);if(!pos)continue;
      const dx=p.x-pos.x,dz=p.z-pos.z;
      pos.moving=Math.hypot(dx,dz)>.055;
      if(Math.abs(dx-dz)>.025)pos.facing=dx-dz>=0?1:-1;
      const factor=1-Math.exp(-dt*(p.id===this.selfId?16:10));
      pos.x+=dx*factor;pos.z+=dz*factor;
    }
    if(this.follow) {
      const p=this.playerPositions.get(this.selfId);
      this.cameraTarget=p?project(p.x,p.z):project(this.state.camp?.x??50,this.state.camp?.z??50);
    }
    this.cameraTarget.x=clamp(this.cameraTarget.x,-1300,1300);
    this.cameraTarget.y=clamp(this.cameraTarget.y,120,1280);
    const factor=1-Math.exp(-dt*3.5);
    this.camera.x+=(this.cameraTarget.x-this.camera.x)*factor;
    this.camera.y+=(this.cameraTarget.y-this.camera.y)*factor;
  }

  drawSprite(object, overrideSprite) {
    const sp=overrideSprite||this.getSprite(object);if(!sp)return;
    const p=project(object.x,object.z),scale=object.scale||1;
    if(Math.abs((p.x-this.camera.x)*this.zoom)>this.width/2+170||Math.abs((p.y-this.camera.y)*this.zoom)>this.height/2+180)return;
    const ctx=this.ctx;
    const self=this.playerPositions.get(this.selfId);
    if(self&&(object.type==='pine'||object.type==='tree')) {
      const pp=project(self.x,self.z),dx=p.x-pp.x,dy=p.y-pp.y;
      if(Math.abs(dx)<40*scale&&dy>0&&dy<95*scale)ctx.globalAlpha=.42;
    }
    ctx.drawImage(sp.canvas,Math.round(p.x-sp.anchorX*scale),Math.round(p.y-sp.anchorY*scale),sp.width*scale,sp.height*scale);
    ctx.globalAlpha=1;
  }

  drawFire(x,z,small=false) {
    const ctx=this.ctx,p=project(x,z),s=small?.7:1;
    ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);
    const glow=ctx.createRadialGradient(0,-10,3,0,-10,60);
    glow.addColorStop(0,'rgba(246,191,90,.18)');glow.addColorStop(1,'rgba(246,191,90,0)');
    ctx.fillStyle=glow;ctx.fillRect(-60,-70,120,120);
    shadow(ctx,0,4,27,10,.16);
    for(let i=0;i<9;i++) {
      const a=i/9*TAU,xx=Math.cos(a)*23,yy=Math.sin(a)*9;
      poly(ctx,[[xx-6,yy-4],[xx+3,yy-6],[xx+7,yy],[xx+2,yy+5],[xx-6,yy+3]],i<5?'#949181':'#b9b5a0');
      rect(ctx,xx-3,yy-4,6,2,'#cecab0');
    }
    poly(ctx,[[-18,0],[17,-6],[19,0],[-15,7]],'#6c5438');
    poly(ctx,[[-12,-7],[17,4],[13,9],[-17,-2]],'#86603a');
    const flick=Math.sin(this.time*9)*3;
    poly(ctx,[[-13,1],[-16,-12],[-8,-21],[-8,-32-flick],[0,-24],[7,-40+flick],[11,-22],[17,-12],[12,1],[0,7]],'#d87d46');
    poly(ctx,[[-10,0],[-10,-13],[-3,-22],[0,-15],[6,-31-flick],[8,-15],[12,-7],[7,3],[-2,5]],'#f0b15b');
    poly(ctx,[[-5,2],[-5,-9],[1,-18+flick],[5,-7],[7,0],[2,5]],'#ffe0a0');
    for(let i=0;i<8;i++) {
      const age=(this.time*.28+i*.137)%1;
      const xx=Math.sin(i*17+this.time*.9)*8+age*13;
      ctx.globalAlpha=(1-age)*.65;
      rect(ctx,xx,-35-age*46,2,3,'#f3ce86');
    }
    ctx.globalAlpha=1;
    for(let i=0;i<5;i++) {
      const age=(this.time*.12+i*.2)%1;
      ctx.globalAlpha=(1-age)*.055;
      rect(ctx,Math.sin(age*6+i)*9+age*22,-41-age*89,9+age*19,5+age*9,'#f6eed9');
    }
    ctx.restore();
  }

  drawRing(x,z,color,scale=1) {
    const p=project(x,z),ctx=this.ctx;
    ctx.strokeStyle=color;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.ellipse(p.x,p.y,17*scale,8*scale,0,0,TAU);ctx.stroke();
  }

  render() {
    const ctx=this.ctx,t=this.time;
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    rect(ctx,0,0,this.width,this.height,'#87996c');
    ctx.save();ctx.translate(this.width/2,this.height*.54);ctx.scale(this.zoom,this.zoom);ctx.translate(-this.camera.x,-this.camera.y);
    ctx.drawImage(this.terrain,-this.terrainOrigin.x,-this.terrainOrigin.y);
    // Subtle shimmering strokes keep the river alive.
    for(let i=0;i<35;i++) {
      const z=(i*3.3+t*.55)%103;
      const x=82+Math.sin(z*.087)*4+Math.sin(z*.21)*1.6+Math.sin(i*7)*1.5;
      const p=project(x,z);ctx.globalAlpha=.25+.15*Math.sin(t*1.7+i);
      rect(ctx,p.x,p.y,9+(i%4)*3,2,'#d8e7cd');
    }
    ctx.globalAlpha=1;
    if(this.target&&t-this.target.at<2.6) {
      const age=t-this.target.at;ctx.globalAlpha=clamp(1-age/2.6,0,1);
      this.drawRing(this.target.x,this.target.z,'#f5e8bd',.6+Math.min(age,.8)*.4);
      const p=project(this.target.x,this.target.z);
      rect(ctx,p.x-3,p.y-1,6,2,'#fff1c2');rect(ctx,p.x-1,p.y-3,2,6,'#fff1c2');ctx.globalAlpha=1;
    }
    if(this.hovered)this.drawRing(this.hovered.x,this.hovered.z,'rgba(249,233,178,.8)',1.25);
    const objects=[...this.staticObjects];
    for(const resource of this.state.resources||[])if(resource.amount>0)objects.push({...resource,scale:resource.type==='stone'?.9:1,variant:0});
    objects.push({type:'fire',x:this.state.camp?.x??50,z:this.state.camp?.z??50});
    objects.push({type:'fire',x:70,z:40,small:true});
    const animals=[{x:34+Math.sin(t*.04)*2.8,z:39+Math.cos(t*.036)*2,scale:1.15,flip:false},{x:31+Math.sin(t*.036+.7)*2,z:44+Math.cos(t*.033)*1.5,scale:.73,flip:false},{x:73+Math.sin(t*.029)*2,z:61+Math.cos(t*.033)*2,scale:.95,flip:true}];
    for(const animal of animals)objects.push({...animal,type:'mammoth'});
    if(this.state.npc)objects.push({...this.state.npc,type:'npc'});
    for(const player of this.state.players) {
      const pos=this.playerPositions.get(player.id);if(pos)objects.push({...player,...pos,type:'player'});
    }
    objects.sort((a,b)=>(a.x+a.z)-(b.x+b.z));
    for(const object of objects) {
      if(object.type==='fire') {this.drawFire(object.x,object.z,object.small);continue;}
      if(object.type==='mammoth') {
        const frame=Math.floor(t*1.4)%2;
        this.drawSprite(object,this.cached(`mammoth-${object.flip}-${frame}`,()=>mammothSprite(object.flip,frame)));continue;
      }
      if(object.type==='player'||object.type==='npc') {
        const npc=object.type==='npc',color=npc?'#95916a':object.color||'#bf8060';
        const species=npc?'nea':object.species||'cro';
        const frame=object.moving?Math.floor(t*7)%2:0,facing=object.facing||1;
        if(object.id===this.selfId)this.drawRing(object.x,object.z,'rgba(243,218,155,.85)',.82);
        this.drawSprite({...object,scale:npc?1.12:1},this.cached(`human-${color}-${species}-${frame}-${facing}`,()=>humanSprite(color,species,frame,facing)));
        continue;
      }
      this.drawSprite(object);
    }
    // Passing cloud shadows and airborne motes soften the pixel landscape.
    ctx.globalAlpha=.035;
    const cloudX=(t*3)%1700-850;
    poly(ctx,[[cloudX-210,470],[cloudX+65,330],[cloudX+290,430],[cloudX+420,570],[cloudX+150,640]],'#263f39');
    ctx.globalAlpha=1;
    ctx.restore();
    this.drawLabels();
    for(let i=0;i<13;i++) {
      const x=((i*173.37+t*(3+i%3))%(this.width+40))-20;
      const y=((i*83.71+Math.sin(t*.3+i)*22)%(this.height+40))-20;
      ctx.globalAlpha=.15+.13*Math.sin(t+i);
      rect(ctx,x,y,2,2,'#f7e7af');
    }
    ctx.globalAlpha=1;
    const shade=ctx.createLinearGradient(0,0,0,this.height);
    shade.addColorStop(0,'rgba(47,66,45,.10)');shade.addColorStop(.24,'rgba(255,244,197,.015)');shade.addColorStop(.73,'rgba(255,244,197,0)');shade.addColorStop(1,'rgba(34,51,36,.14)');
    ctx.fillStyle=shade;ctx.fillRect(0,0,this.width,this.height);
  }

  pill(text,x,y,{color='#f2e8c8',background='rgba(43,56,39,.78)',small=false,diamond=false}={}) {
    const ctx=this.ctx;
    ctx.font=`${small?'500 10':'600 11'}px "Noto Sans JP", "Yu Gothic", sans-serif`;
    const width=ctx.measureText(text).width+(diamond?28:18),height=small?22:25;
    if(x+width/2<0||x-width/2>this.width||y<-35||y>this.height+30)return;
    ctx.fillStyle=background;
    ctx.beginPath();ctx.roundRect(Math.round(x-width/2),Math.round(y-height/2),Math.round(width),height,5);ctx.fill();
    ctx.strokeStyle='rgba(236,228,186,.15)';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,Math.round(x+(diamond?5:0)),Math.round(y));
    if(diamond)poly(ctx,[[x-width/2+11,y-4],[x-width/2+15,y],[x-width/2+11,y+4],[x-width/2+7,y]],'#d9c18a');
  }

  drawLabels() {
    const camp=this.worldToScreen(48,44);
    this.pill('はじまりの野営地',camp.x,camp.y-103*this.zoom,{small:true,diamond:true,color:'#f0e3bb',background:'rgba(64,70,44,.7)'});
    const npc=this.state.npc;
    if(npc) {
      const p=this.worldToScreen(npc.x,npc.z);
      this.pill(`${npc.name||'オル'} · ネアンデルタール`,p.x,p.y-69*this.zoom,{small:true,color:'#ecddb3',background:'rgba(67,67,45,.86)'});
      const ctx=this.ctx;ctx.fillStyle='#e6d5a1';ctx.font='600 13px sans-serif';ctx.textAlign='center';ctx.fillText('⋯',p.x,p.y-85*this.zoom+Math.sin(this.time*2)*2);
    }
    for(const player of this.state.players) {
      const pos=this.playerPositions.get(player.id);if(!pos)continue;
      const p=this.worldToScreen(pos.x,pos.z);
      this.pill(player.name||'旅人',p.x,p.y-65*this.zoom,{color:player.id===this.selfId?'#f5e2a6':'#f0eee0',background:player.id===this.selfId?'rgba(67,65,39,.9)':'rgba(43,56,45,.86)'});
    }
    if(this.hovered&&this.hovered.type!=='npc'&&this.hovered.type!=='camp') {
      const names={wood:'木材',stone:'石',berry:'ベリー'};
      const p=this.worldToScreen(this.hovered.x,this.hovered.z);
      this.pill(`${names[this.hovered.type]||''} · E で採集`,p.x,p.y-45*this.zoom,{small:true,color:'#f4e8c3'});
    }
  }

  destroy() {
    this.destroyed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown',this.pointerDown);
    this.canvas.removeEventListener('pointermove',this.pointerMove);
    window.removeEventListener('pointerup',this.pointerUp);
    this.canvas.removeEventListener('pointerleave',this.pointerLeave);
    this.canvas.removeEventListener('wheel',this.wheel);
    this.sprites.clear();
  }
}
