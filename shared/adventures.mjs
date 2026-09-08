import { ADVENTURE_REGIONS, regionAt, regionById, adventureProgress, regionComplete, travelSeals, RIFTS } from './adventure-regions.mjs';
import { stopActor } from './combat.mjs';
import { ridingObstacles } from './riding.mjs';

export function ensureAdventure(player){
  player.adventure??={regions:{}};
  player.adventure.regions??={};
  return player.adventure;
}
function discover(player,region,notify=()=>{}){
  const book=ensureAdventure(player);
  if(!book.regions[region.id]){
    book.regions[region.id]={visited:[],gathered:0,kills:0,defeated:[],claimed:false};
    notify(player,`発見：${region.name}。探索手帳に依頼を記録しました。`,'success');
  }
  return book.regions[region.id];
}
export function recordAdventureGather(player,resource,amount){
  const region=regionById(resource.regionId);
  if(!region||resource.type!==region.material||!Number.isInteger(amount)||amount<=0)return;
  const progress=discover(player,region);
  progress.gathered=Math.min(region.amount,progress.gathered+amount);
}
export function updateAdventures(room,now,notify=()=>{}){
  for(const player of room.players.values()){
    if(player.downedUntil||player.boatId)continue;
    const region=regionAt(player.x,player.z);if(!region)continue;
    const progress=discover(player,region,notify);
    for(const point of region.checkpoints)if(!progress.visited.includes(point.id)&&Math.hypot(point.x-player.x,point.z-player.z)<=3.4&&room.collision.segmentFree(player,point,.12)){
      progress.visited.push(point.id);notify(player,`道標：${point.name}（${progress.visited.length}/3）`,'success');
    }
  }
  for(const enemy of room.enemies??[]){
    if(!enemy.regionId)continue;
    if(enemy.phase==='alive'){enemy.adventureRewarded=false;continue;}
    if(enemy.phase!=='dead'||enemy.adventureRewarded)continue;
    enemy.adventureRewarded=true;
    const region=regionById(enemy.regionId);if(!region)continue;
    for(const player of room.players.values())if(!player.downedUntil&&!player.mountId&&!player.boatId&&Math.hypot(player.x-enemy.x,player.z-enemy.z)<=24){
      const progress=discover(player,region,notify);progress.defeated??=[];
      if(progress.defeated.includes(enemy.id))continue;
      progress.defeated.push(enemy.id);progress.kills=progress.defeated.length;
      notify(player,`${region.name}の討伐を記録（${progress.kills}/${region.kills}）。近くの仲間と共有しました。`,'success');
    }
  }
}
export function handleAdventureAction(room,player,message,now=Date.now()){
  if(!['claimAdventure','rift','rest'].includes(message.action))return null;
  if(player.downedUntil||player.mountId||player.boatId)return {ok:false,text:'回復して、船やマンモスから降りてから行おう。'};
  if(message.action==='rift'){
    const rift=RIFTS.find(r=>r.id===message.targetId);
    if(!rift||Math.hypot(player.x-rift.x,player.z-rift.z)>4||!room.collision.segmentFree(player,rift,.12))return {ok:false,text:'裂け目の光へ近づこう。'};
    if(!rift.exit&&travelSeals(player)<3)return {ok:false,text:'影の世界へは、地上の地域依頼を3つ達成して旅の証を集めよう。'};
    if(now-(player.lastExpeditionAt??-Infinity)<3000)return {ok:false,text:'次の移動まで少し待ってください。'};
    const destination=rift.exit?{x:RIFTS[0].x,z:RIFTS[0].z+2}:regionById(rift.destination).camp;
    const point=room.collision.nearestFree(destination,player.radius,ridingObstacles(room,null,player),10);
    if(!point)return {ok:false,text:'裂け目の向こうが混雑しています。少し待とう。'};
    stopActor(player);player.pendingStrike=null;player.cookingEndsAt=0;player.runningRequested=false;
    room.projectiles=(room.projectiles??[]).filter(p=>p.ownerId!==player.id);
    Object.assign(player,point,{lastExpeditionAt:now});
    return {ok:true,text:rift.exit?'地上の石の森へ戻りました。':'裂け目を抜け、影の庭に到着しました。'};
  }
  const region=regionAt(player.x,player.z);
  if(!region)return {ok:false,text:'探索地域の野営地で行おう。'};
  if(message.action==='rest'){
    const fire=room.cookingFires.find(f=>f.id===`adventure-fire-${region.id}`);
    if(!fire||Math.hypot(player.x-fire.x,player.z-fire.z)>4||!room.collision.segmentFree(player,region.camp,.12))return {ok:false,text:'この地域の焚き火へ近づこう。'};
    if(player.energy>=100)return {ok:false,text:'元気いっぱいです。'};
    if(now-(player.lastRestAt??-Infinity)<20000)return {ok:false,text:'次の休息まで20秒ほど間をあけよう。'};
    if(room.enemies.some(e=>e.phase==='alive'&&Math.hypot(e.x-player.x,e.z-player.z)<12))return {ok:false,text:'敵が近くにいます。安全な場所へ戻ろう。'};
    stopActor(player);player.lastRestAt=now;player.energy=Math.min(100,player.energy+35);
    return {ok:true,text:'焚き火でひと休み。元気 +35。'};
  }
  if(message.targetId!==region.id||Math.hypot(player.x-region.camp.x,player.z-region.camp.z)>6||!room.collision.segmentFree(player,region.camp,.12))return {ok:false,text:'依頼を終えた地域の野営地へ戻ろう。'};
  const progress=adventureProgress(player,region.id);
  if(progress.claimed)return {ok:false,text:'この依頼の報酬は受け取り済みです。'};
  if(!regionComplete(player,region))return {ok:false,text:'探索手帳の道標・採集・討伐を終えてから報告しよう。'};
  for(const[key,amount]of Object.entries(region.reward))if((player.inventory[key]??0)+amount>99)return {ok:false,text:'報酬を受け取るため、もちものに空きを作ろう。'};
  for(const[key,amount]of Object.entries(region.reward))player.inventory[key]=(player.inventory[key]??0)+amount;
  progress.claimed=true;
  return {ok:true,text:region.realm?'影の庭の探索を達成！「境界を渡る者」の称号と食料を手に入れた。':`${region.name}を達成！ 旅の証 ${travelSeals(player)}/5 と食料を手に入れた。`};
}
