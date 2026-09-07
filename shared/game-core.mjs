import { normalizeCharacter, characterModel } from './characters.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { WORLD, worldClamp, CAMP, NPC, INITIAL_RESOURCES } from './world.mjs';
import { movePlayer } from './movement.mjs';
import { planNavigation, updateNavigation } from './navigation.mjs';
import { CollisionWorld, overlap } from './collision.mjs';
import { createAnimals, updateAnimals, actorObstacle } from './animals.mjs';
import { animalIsSolid, handleHuntingAction, updateHunting } from './hunting.mjs';
import { enemyIsSolid, stopActor } from './combat.mjs';
import { createEnemies, updateEnemies } from './enemies.mjs';
import { SCENERY } from './scenery-layout.mjs';
import { RIDING, mountedAnimal, handleRidingAction, releaseRider, ridingObstacles } from './riding.mjs';
import { interactionVisible } from './interactions.mjs';
import { BOATING, initializeBoats, boardedBoat, handleBoatAction, releaseBoat, updateBoats, boatObstacles } from './boats.mjs';
import { takeExpedition } from './expeditions.mjs';
import { isLand, EARTH } from './paleo-geography.mjs';
const randomUUID = () => crypto.randomUUID();
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const COLORS = ['#e4ac65', '#87b899', '#b49cd2', '#76a7c3', '#ce8c8b'];
const cleanText = (value, max) => typeof value === 'string'
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, max).join('') : '';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const send = (socket, payload) => {
  if (socket.readyState === 1 && socket.bufferedAmount < 512 * 1024) {
    socket.send(JSON.stringify(payload));
  }
};


export function createGameCore({ resumeGraceMs = 120000, keepEmptyRooms = false, maxSavedSessions = Infinity } = {}) {
  const rooms = new Map();
  let closing = false;
  function broadcast(room, payload) {
    const encoded = JSON.stringify(payload);
    let full;
    for (const player of room.players.values()) {
      if (player.socket.readyState !== 1) continue;
      if (player.socket.bufferedAmount >= 512 * 1024) {
        if (payload.type === 'state') player.needsWorld = true;
        continue;
      }
      if (payload.type === 'state' && player.needsWorld) {
        full ??= JSON.stringify(snapshot(room, true));
        player.socket.send(full); player.needsWorld = false;
      } else player.socket.send(encoded);
    }
  }

  function snapshot(room, includeWorld = false) {
    const now = Date.now();
    return {
      boatingVersion: BOATING.version,
      boats: room.boats.map(({id,x,z,facing,radius,riderId,speed,moving,running})=>({id,x,z,facing,radius,riderId,speed,moving,running})),
      type: 'state', ridingVersion: RIDING.version, combatVersion: 3, characterVersion: 2, enemyVersion: 1, worldVersion: WORLD.version, worldWidth: WORLD.width, worldDepth: WORLD.depth, epochYearsBP: EARTH.epochYearsBP, room: room.name, serverTime: now,
      projectiles: (room.projectiles || []).map(({id,ownerId,x,z,dx,dz,createdAt,updatedAt,travelled,kind})=>({id,ownerId,x,z,dx,dz,createdAt,updatedAt,travelled,kind})),
      projectileImpacts: (room.projectileImpacts || []).map(effect=>({...effect})),
      animals: room.animals.map(({id,x,z,facing,speed,scale,radius,clip,phase,health,maxHealth,meatRemaining,phaseStartedAt,riderId})=>({id,x,z,facing,speed,scale,radius,clip,phase,health,maxHealth,meatRemaining,phaseStartedAt,riderId})),
      enemies: (room.enemies || []).map(({id,modelKey,name,hostile,x,z,scale,facing,speed,radius,clip,phase,health,maxHealth,phaseStartedAt,behavior,targetId,attackSequence,attackAt,hitSequence,hitAt})=>({id,modelKey,name,hostile,x,z,scale,facing,speed,radius,clip,phase,health,maxHealth,phaseStartedAt,behavior,targetId,attackSequence,attackAt,hitSequence,hitAt})),
      players: [...room.players.values()].map(({ id, name, species, gender, x, z, radius, color, inventory, gathered, tool, ready, energy, facing, moving, running, speed, attackSequence, attackAt, cookingEndsAt, hurtSequence, hurtAt, defeatSequence, downedUntil, invulnerableUntil, mountId, boatId }) =>
        ({ id, name, species, gender, x, z, radius, color, inventory: { ...inventory }, gathered: gathered ?? 0, tool, ready, energy, facing, moving, running, speed, attackSequence, attackAt, cookingEndsAt, hurtSequence, hurtAt, defeatSequence, downedUntil, invulnerableUntil, mountId, boatId })),
      ...(includeWorld ? {resources: room.resources.map(({ regeneratedAt, ...resource }) => ({ ...resource })), camp: { ...room.camp }, cookingFires:room.cookingFires, npc: { ...NPC }} : {}),
      day: 1 + Math.floor((now - room.createdAt) / 240000),
      dayProgress: ((now - room.createdAt) % 240000) / 240000,
      completed: room.camp.level >= 1,
    };
  }

  function systemChat(room, text) {
    broadcast(room, { type: 'chat', id: randomUUID(), name: '谷の声', text, system: true, at: Date.now() });
  }

  function notice(player, text, tone = 'info') {
    send(player.socket, { type: 'notice', text, tone });
  }

  function act(room, player, message, now) {
    const action = message.action;
    const boating=handleBoatAction(room,player,message,now);
    if(boating){notice(player,boating.text,boating.tone);if(boating.changed)broadcast(room,snapshot(room,true));return;}
    if(player.boatId)return notice(player,'乗船中です。岸で B を押して降りてから行おう。');
    const riding = handleRidingAction(room, player, message, now);
    if (riding) {
      notice(player, riding.text, riding.tone);
      if (riding.changed) broadcast(room, snapshot(room));
      return;
    }
    if (player.mountId) return notice(player, '騎乗中です。攻撃・採集・食事は R で降りてから。');
    const hunting = handleHuntingAction(room, player, message, now);
    if (hunting) {
      notice(player, hunting.text, hunting.tone);
      if (hunting.changed) broadcast(room, snapshot(room));
      return;
    }
    if (player.cookingEndsAt) return notice(player, '肉を焼いています。先に調理を終えるか中止しよう。');
    if (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs) return notice(player, '攻撃が終わってから行おう。');
    if (action === 'gather') {
      const candidates = room.resources.filter((resource) => resource.amount > 0 && distance(resource, player) <= 8 && interactionVisible(room.collision, player, resource));
      const nearest = candidates.filter(resource => player.inventory[resource.type] < 99)
        .sort((a, b) => distance(a, player) - distance(b, player))[0];
      if (!nearest) return notice(player, candidates.length ? '持ち物がいっぱいです。焚き火に届けよう。' : '資源に近づいてから採集しよう。遮られている場合は回り込もう。', 'error');
      const amount = Math.min(nearest.amount, player.tool && nearest.type !== 'berry' ? 2 : 1);
      if (player.inventory[nearest.type] >= 99) return notice(player, '持ち物がいっぱいです。焚き火に届けよう。', 'error');
      const collected = Math.min(amount, 99 - player.inventory[nearest.type]);
      nearest.amount -= collected;
      nearest.regeneratedAt = Date.now();
      player.inventory[nearest.type] += collected;
      player.gathered = (player.gathered ?? 0) + collected;
      player.energy = Math.max(0, player.energy - 3);
      const label = { wood: '木材', stone: '石', berry: 'ベリー' }[nearest.type];
      notice(player, `${label} +${collected}`, 'success');
    } else if (action === 'contribute') {
      if (distance(player, room.camp) > 10) return notice(player, '焚き火に近づいてから届けよう。', 'error');
      if (!interactionVisible(room.collision, player, room.camp)) return notice(player, '焚き火までの間がふさがれています。回り込もう。', 'error');
      const { wood, stone } = player.inventory;
      if (!wood && !stone) return notice(player, '木材や石を集めて持ってこよう。', 'error');
      room.camp.wood += wood;
      room.camp.stone += stone;
      player.inventory.wood = 0;
      player.inventory.stone = 0;
      notice(player, `焚き火に木材 ${wood}・石 ${stone} を届けた。`, 'success');
      systemChat(room, `${player.name} が木材 ${wood}・石 ${stone} を届けた。`);
      if (!room.camp.level && room.camp.wood >= room.camp.goalWood && room.camp.stone >= room.camp.goalStone) {
        room.camp.level = 1;
        for (const member of room.players.values()) member.ready = true;
        systemChat(room, '焚き火が完成！ みんなの力で、最初の夜を迎える準備ができた。');
      }
    } else if (action === 'craft') {
      if (player.tool) return notice(player, 'すでに石斧を持っています。');
      if (player.inventory.wood < 3 || player.inventory.stone < 2) return notice(player, '石斧には木材 3・石 2 が必要です。', 'error');
      player.inventory.wood -= 3;
      player.inventory.stone -= 2;
      player.tool = true;
      notice(player, '石斧ができた！ 木材と石を一度に2つ採集できます。', 'success');
    } else if (action === 'trade') {
      if (distance(player, NPC) > 10) return notice(player, 'オルに近づいて話しかけよう。', 'error');
      if (!interactionVisible(room.collision, player, NPC)) return notice(player, 'オルまでの間がふさがれています。回り込もう。', 'error');
      const material = player.inventory.wood >= 2 ? 'wood' : player.inventory.stone >= 2 ? 'stone' : null;
      if (!material) return notice(player, 'オル「木か石を2つ、ベリー3つと交換しよう」');
      if (player.inventory.berry > 96) return notice(player, 'ベリーを食べてから交換しよう。', 'error');
      player.inventory[material] -= 2;
      player.inventory.berry += 3;
      notice(player, `オルと${material === 'wood' ? '木材' : '石'}2つを交換した。ベリー +3`, 'success');
    } else if (action === 'eat') {
      if (!player.inventory.berry) return notice(player, 'ベリーを持っていません。', 'error');
      if (player.energy >= 100) return notice(player, '元気いっぱいです。');
      player.inventory.berry -= 1;
      player.energy = Math.min(100, player.energy + 25);
      notice(player, 'ベリーを食べた。元気 +25', 'success');
    } else if (action === 'wave') {
      broadcast(room, { type: 'emote', id: player.id, emote: 'wave', at: Date.now() });
      systemChat(room, `${player.name} が手を振った。`);
    } else return;
    broadcast(room, snapshot(room, true));
  }


  function ensureRoom(roomName) {
    let room = rooms.get(roomName);
    if (!room) {
      room = { name: roomName, createdAt: Date.now(), players: new Map(), sessions: new Map(), enemies: [], resources: INITIAL_RESOURCES.map((resource) => ({ ...resource, regeneratedAt: Date.now() })), camp: { ...CAMP }, lastBroadcast: 0 };
      room.cookingFires=SCENERY.fires.map(({id,x,z})=>({id:id??`fire-${x}-${z}`,x,z}));
      room.resourceById=new Map(room.resources.map(r=>[r.id,r]));
      room.collision=new CollisionWorld(undefined,{active:o=>!o.resourceId||room.resourceById.get(o.resourceId).amount>0});
      initializeBoats(room);
      room.resourceObstacles=new Map(room.collision.obstacles.filter(o=>o.resourceId).map(o=>[o.resourceId,o]));
      room.animals=createAnimals(room.collision);
      room.enemies=createEnemies(room.collision,room.animals);
      rooms.set(roomName, room);
    }
    return room;
  }

  function connect(socket, params) {
    const roomName = cleanText(params.get('room'), 20).toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'EMBER';
    const room = ensureRoom(roomName);
    const now=Date.now(),token=params.get('session'),resumable=params.get('resume')==='1';
    for(const [key,entry] of room.sessions)if(now>=entry.expiresAt)room.sessions.delete(key);
    const active=resumable&&token?[...room.players.values()].find(p=>p.sessionToken===token):null;
    const saved=resumable&&token?room.sessions.get(token):null;
    if (room.players.size >= WORLD.maxPlayers && !active) {
      send(socket, { type: 'error', code: 'ROOM_FULL', text: 'この谷は5人でいっぱいです。別の部屋の名前で参加してください。' });
      socket.close(4001, 'Room full');
      return;
    }
    const usedColors = new Set([...room.players.values()].map((player) => player.color));
    const resumed=!!(active||saved);
    const player = active || saved?.player || {
      id: randomUUID(), name: cleanText(params.get('name'), 16) || '旅人',
      ...normalizeCharacter({ species: params.get('species'), gender: params.get('gender') }),
      x: 48 + room.players.size * 1.1, z: 57 + (room.players.size % 2),
      color: COLORS.find((color) => !usedColors.has(color)) || COLORS[0],
      inventory: { wood: 0, stone: 0, berry: 0, rawMeat: 0, cookedMeat: 0 }, gathered: 0, tool: false,
      mountId: null, boatId: null, attackSequence: 0, attackAt: 0, pendingStrike: null, cookingEndsAt: 0,
      hurtSequence: 0, hurtAt: 0, defeatSequence: 0, downedUntil: 0, invulnerableUntil: 0,
      ready: room.camp.level > 0, energy: 100, facing: 0, moving: false, running: false, runningRequested: false, speed: 0,
      radius: WORLD.playerRadius, path: [], lastTarget: 0, dx: 0, dz: 0, target: null, lastInput: 0, lastAction: 0, lastChat: 0,
      tokens: 70, refillAt: Date.now(), alive: true, socket,
      sessionToken: resumable ? randomToken() : null,
    };
    player.radius=characterModel(player).radius ?? WORLD.playerRadius;
    if(active?.boatId)releaseBoat(room,player);
    const dynamic=[...room.players.values()].filter(p=>p!==player&&!p.mountId).concat(room.animals.filter(animalIsSolid),room.enemies.filter(enemyIsSolid)).map(actorObstacle);
    const spawn=room.collision.nearestFree(player,player.radius,dynamic)
      || (resumed&&room.collision.nearestFree({x:room.camp.x-1,z:room.camp.z+3},player.radius,dynamic));
    if(!spawn){send(socket,{type:'error',code:'NO_SPAWN',text:'安全な参加地点がありません。'});socket.close();return;}
    if(active){
      const oldSocket=player.socket;
      releaseRider(room,player);player.pendingStrike=null;player.cookingEndsAt=0;
      room.projectiles=(room.projectiles||[]).filter(projectile=>projectile.ownerId!==player.id);
      player.socket=socket;
      send(oldSocket,{type:'error',code:'SESSION_REPLACED',text:'同じプレイヤーが別の画面で再接続しました。この画面からは参加し直せます。'});
      oldSocket.close(4004,'Session replaced');
    }
    if(saved)room.sessions.delete(token);
    Object.assign(player,{socket,alive:true,tokens:70,refillAt:now,lastInput:0,lastTarget:0,lastAction:0,lastChat:0,runningRequested:false,needsWorld:false,ready:room.camp.level>0});
    stopActor(player);
    Object.assign(player,spawn);room.players.set(player.id, player);
    send(socket, { type: 'welcome', ridingVersion: RIDING.version, combatVersion: 3, characterVersion: 2, worldVersion: WORLD.version, id: player.id, room: roomName,
      resumed, session:player.sessionToken, profile:{name:player.name,species:player.species,gender:player.gender} });
    broadcast(room, snapshot(room, true));
    systemChat(room, `${player.name} が谷に${resumed?'戻ってきた':'やってきた'}。`);
    socket.on('pong', () => { if(player.socket===socket)player.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (data, isBinary) => {
      if (isBinary || player.socket!==socket) return;
      const now = Date.now();
      player.tokens = Math.min(70, player.tokens + (now - player.refillAt) * 0.035);
      player.refillAt = now;
      if (player.tokens < 1) return;
      player.tokens -= 1;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if(message.type==='leave'){player.sessionToken=null;socket.close(1000,'Explicit leave');return;}
      const controlled = boardedBoat(room,player) || mountedAnimal(room, player) || player;
      if (player.downedUntil && ['move','gait','target','action'].includes(message.type)) {
        if (message.type === 'action') notice(player, '回復を待っています。間もなく焚き火へ戻ります。', 'info');
        return;
      }
      if (message.type === 'move' && Number.isFinite(message.dx) && Number.isFinite(message.dz)) {
        const dx = clamp(message.dx, -1, 1);
        const dz = clamp(message.dz, -1, 1);
        const length = Math.max(1, Math.hypot(dx, dz));
        controlled.dx = dx / length;
        controlled.dz = dz / length;
        controlled.lastInput = now;
        controlled.runningRequested = message.running === true;
        controlled.target = null;controlled.path=[];controlled.navigationGoal=null;controlled.navigationEnd=null;
      } else if (message.type === 'gait' && typeof message.running === 'boolean') {
        controlled.runningRequested = message.running;
      } else if (message.type === 'target' && Number.isFinite(message.x) && Number.isFinite(message.z) && now-player.lastTarget>=180) {
        player.lastTarget=now;
        controlled.runningRequested = message.running === true;
        const goal={ x: worldClamp(message.x,'x'), z: worldClamp(message.z,'z') };
        if(!player.boatId&&!isLand(goal.x,goal.z)){stopActor(controlled);notice(player,'そこは海です。海岸で木材12個から船を作り、Bで乗って渡ろう。');return;}
        const dynamic=player.boatId?boatObstacles(room,controlled):ridingObstacles(room,controlled===player?null:controlled,player);
        if(!planNavigation(controlled,goal,player.boatId?room.seaCollision:room.collision,dynamic,now)){
          if(player.boatId){stopActor(controlled);notice(player,'船が通れる航路が見つかりません。近くの海面を選ぶか、WASDで操船しよう。');}
          else if(player.mountId){stopActor(controlled);notice(player,'マンモスが通れる道が見つかりません。広い道を選ぶか、Rで降りて進もう。');}
          else {stopActor(controlled);notice(player,'歩ける経路が見つかりません。近くの陸地を選ぶか、世界地図から遠征しよう。');}
        }
        controlled.dx = 0;
        controlled.dz = 0;
      } else if (message.type === 'expedition' && typeof message.destination === 'string') {
        const result=takeExpedition(room,player,message.destination,now);notice(player,result.text,result.ok?'success':'info');
        if(result.ok)broadcast(room,snapshot(room,true));
      } else if (message.type === 'action' && typeof message.action === 'string' && (message.action === 'attack' || message.action === 'cancelCook' || now - player.lastAction >= 450)) {
        player.lastAction = now;
        act(room, player, message, now);
      } else if (message.type === 'chat' && now - player.lastChat >= 600) {
        const chatText = cleanText(message.text, 180);
        if (!chatText) return;
        player.lastChat = now;
        broadcast(room, { type: 'chat', id: randomUUID(), name: player.name, text: chatText, at: now });
      } else if (message.type === 'ping' && (typeof message.at === 'number' || typeof message.at === 'string')) {
        send(socket, { type: 'pong', at: typeof message.at === 'string' ? message.at.slice(0, 40) : message.at });
      }
    });
    socket.on('close', () => {
      if(player.socket!==socket)return;
      releaseBoat(room,player);
      releaseRider(room, player);
      player.pendingStrike = null;player.cookingEndsAt=0;
      room.projectiles=(room.projectiles || []).filter(projectile=>projectile.ownerId!==player.id);
      room.players.delete(player.id);
      if(!closing&&player.sessionToken&&resumeGraceMs>0)room.sessions.set(player.sessionToken,{player,expiresAt:Date.now()+resumeGraceMs});
      while (room.sessions.size > maxSavedSessions) room.sessions.delete(room.sessions.keys().next().value);
      if (!keepEmptyRooms && room.players.size === 0 && !room.sessions.size) rooms.delete(roomName);
      else {
        systemChat(room, `${player.name} が谷をあとにした。`);
        broadcast(room, snapshot(room, true));
      }
    });
  }

  let previousTick = Date.now();
  let lastHeartbeat = Date.now();
  function tick() {
    const now = Date.now();
    const dt = Math.min((now - previousTick) / 1000, 0.15);
    previousTick = now;
    const heartbeat = now - lastHeartbeat > 15000;
    if (heartbeat) lastHeartbeat = now;
    for (const room of rooms.values()) {
      for(const [token,entry] of room.sessions)if(now>=entry.expiresAt)room.sessions.delete(token);
      if(!room.players.size){if(!keepEmptyRooms&&!room.sessions.size)rooms.delete(room.name);continue;}
      for (const player of room.players.values()) {
        if(!player.target)player.target=player.path.shift()||null;
        const dynamic=[...room.players.values()].filter(p=>p!==player).concat(room.animals.filter(animalIsSolid),room.enemies.filter(enemyIsSolid)).map(actorObstacle);
        if (player.downedUntil || (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)) {
          player.speed=0;player.moving=false;player.running=false;
        } else if (!player.mountId && !player.boatId) {
          updateNavigation(player,room.collision,dynamic,now);
          movePlayer(player,dt,now,(p,dx,dz)=>room.collision.move(p,dx,dz,player.radius,dynamic));
        }
        if (heartbeat) {
          if (!player.alive) { player.socket.terminate(); continue; }
          player.alive = false;
          player.socket.ping();
        }
      }
      updateBoats(room,dt,now);
      const huntingChanged=updateHunting(room,now,notice);
      updateAnimals(room,dt,now);
      const enemiesChanged=updateEnemies(room,dt,now,notice);
      let resourcesChanged=false;
      for (const resource of room.resources) {
        if (resource.amount < resource.maxAmount && now - resource.regeneratedAt >= 20000) {
          const obstacle=room.resourceObstacles.get(resource.id);
          if(resource.amount===0&&obstacle&&[...room.players.values(),...room.animals.filter(animalIsSolid),...room.enemies.filter(enemyIsSolid)].some(actor=>overlap(actor,actor.radius,obstacle)))continue;
          resourcesChanged=true;resource.amount += 1;
          resource.regeneratedAt = now;
        }
      }
      if (now - room.lastBroadcast >= 90 || resourcesChanged || huntingChanged || enemiesChanged) {
        broadcast(room, snapshot(room, resourcesChanged));
        room.lastBroadcast = now;
      }
    }
  }

  function exportState() {
    const now = Date.now();
    return { version: 1, worldVersion: WORLD.version, savedAt: now, rooms: [...rooms.values()].map(room => {
      const sessions = [...room.sessions.entries()].filter(([, entry]) => entry.expiresAt > now)
        .map(([token, entry]) => ({ token, expiresAt: entry.expiresAt, player: entry.player }));
      for (const player of room.players.values()) if (player.sessionToken) {
        sessions.push({ token: player.sessionToken, expiresAt: now + resumeGraceMs, player });
      }
      return JSON.parse(JSON.stringify({ name: room.name, createdAt: room.createdAt,
        camp: room.camp, resources: room.resources, animals: room.animals, enemies: room.enemies, boats:room.boats,
        sessions: sessions.slice(-100) }, (key, value) => key === 'socket' ? undefined : value));
    }) };
  }

  function importState(saved) {
    if (!saved || saved.version !== 1 || saved.worldVersion !== WORLD.version || !Array.isArray(saved.rooms)) {
      throw new Error('Unsupported saved world; refusing to overwrite it');
    }
    if (rooms.size) throw new Error('Restore requires an empty game');
    for (const record of saved.rooms) {
      const room = ensureRoom(record.name);
      room.createdAt = record.createdAt;
      Object.assign(room.camp, record.camp);
      room.boats=(record.boats||[]).slice(0,BOATING.maxBoats).map(b=>{const boat={...b};stopActor(boat);boat.riderId=null;Object.assign(boat,boat.mooring);return boat;});
      for (const resource of record.resources) Object.assign(room.resourceById.get(resource.id), resource);
      for (const name of ['animals', 'enemies']) for (const actor of room[name]) {
        const previous = record[name].find(item => item.id === actor.id);
        if (previous) Object.assign(actor, previous);
        stopActor(actor); actor.riderId = null; actor.pendingAttack = null;
      }
      for (const entry of record.sessions) if (entry.expiresAt > Date.now()) {
        const player = entry.player;
        if(player.boatId){const boat=room.boats.find(b=>b.id===player.boatId);if(boat)Object.assign(player,boat.shore);}
        player.boatId=null;
        stopActor(player); player.mountId = null; player.pendingStrike = null; player.cookingEndsAt = 0;
        room.sessions.set(entry.token, { expiresAt: entry.expiresAt, player });
      }
    }
  }

  return { rooms, snapshot, connect, tick, exportState, importState, close() { closing = true; rooms.clear(); } };
}
