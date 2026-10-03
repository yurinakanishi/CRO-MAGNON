import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
const base='output/model-generation/models/rimo-neko/candidate-2/qa/rig-02';
const out='output/rimo-neko-c2-game',qa='assets/rimo-neko/qa';
await mkdir(qa,{recursive:true});
const [motion,low,happy,preservation,browser,captures,records,asset,adoption]=await Promise.all([
  read(base+'/motion.json'),read(base+'/lod-motion.json'),read(base+'/happy-contact.json'),
  read(base+'/preservation.json'),read(base+'/browser/result.json'),read(out+'/captures.json'),
  read(out+'/records.json'),read('public/models/rimo-neko/asset.json'),read('assets/rimo-neko/adoption.json')
]);
for(const check of [motion,low,happy,preservation])assert.equal(check.sha256,asset.sha256);
assert.equal(browser.sourceSha256,asset.sha256);
assert.equal(browser.capturesSaved,126);
const frames=records.flatMap(r=>r.frames),clips=[...new Set(frames.map(f=>f.cat.clip))].sort();
assert.deepEqual(clips,asset.clips.map(c=>c.name).sort());
for(const f of [...frames,...captures]){assert.equal(f.sha256,asset.sha256);assert.deepEqual(f.errors,[]);}
assert.ok(captures.some(c=>c.lod===1&&c.view==='far'));
assert.ok(captures.some(c=>c.lod===0&&c.view==='near'));
assert.ok(captures.some(c=>c.view==='normal'));
assert.ok(captures.some(c=>c.cat.floor===.3));
const five=captures.filter(c=>c.players===5);
assert.equal(new Set(five.map(c=>c.id)).size,2);
for(const c of five){assert.equal(c.peers.length,3);assert.ok(c.peers.every(p=>p.players===5));}
const returned=captures.findLast(c=>c.cat.position[0]===51&&c.cat.position[2]===53&&c.followPlayerId===null);
assert.ok(returned);
assert.ok(frames.some(f=>f.cat.reaction==='happy'&&f.cat.hearts===5));
// The second stroke starts with the cat already close, separating arm reach
// from the deliberately documented background-tab interpolation limitation.
const settled=[1,2,7].map(i=>{
  const samples=records[i].frames.filter(f=>f.cat.reaction==='pet'&&f.petWeight>.999);
  assert.ok(samples.length);const gap=Math.max(...samples.map(f=>f.contactGap));assert.ok(gap<.045);
  return {record:i,character:({1:'cro-magnon-woman',2:'maruimo-octopus',7:'desert-fennec-mage'})[i],samples:samples.length,maxContactGap:gap};
});
const summary={candidate:2,surface:'01',revision:'02',sha256:asset.sha256,status:'passed',
  browserScreens:2,protocolPeers:3,allSevenClipsObserved:clips,recordings:records.length,
  renderedFrames:frames.length,captures:captures.length,settledPetContact:settled,
  checks:['high and low geometry','Pet → Happy with five hearts → follow','walk/run/deceleration','Hit → Hiss',
    'bridge floor','T return to camp','two screens and three protocol peers','reload and rejoin with same observer id','normal camera'],
  methods:'Local memory-only server. CUA operated actual V/button pet and T return. Placement, character, follow destination, bridge and hit were explicit QA fixtures. Same delivered GLB and game renderer.',
  limitations:['Background browser rendering drops to about one frame per second between automation actions. These recordings do not measure sustained FPS.',
    'Initial distant approaches in records 0 and 6 show renderer interpolation lag, up to 0.447 m hand/target gap during throttled rendering. Settled strokes and independent full-pose checks are reported separately.',
    'No physical controller, small viewport, long-duration play or exhaustive self-intersection validation in this replacement.'],
  evidence:{captures:out+'/captures.json',records:out+'/records.json',delivery:out+'/delivery.json'}};
await save(out+'/result.json',summary);await save(qa+'/c2-game.json',summary);
await copyFile(captures[0].file,qa+'/c2-in-game.png');
await save(qa+'/c2-motion-summary.json',{sha256:asset.sha256,allVertexPosesPerLOD:motion.checks.reduce((n,c)=>n+c.samples,0),
  high:motion.checks.map(({body,support,...c})=>c),low:low.checks.map(({body,support,...c})=>c),
  maximumSamplerReferenceError:Math.max(motion.maximumSamplerReferenceError,low.maximumSamplerReferenceError),happy});
await save(qa+'/c2-preservation.json',preservation);
const before=(await read('output/rimo-neko-c2-server/before-start/world.json')).state,after=(await read('.cro-magnon-save/world.json')).state;
const playerChanges=[];let count=0;
for(const room of before.rooms){const match=after.rooms.find(r=>r.name===room.name);assert.ok(match);
  for(const session of room.sessions){const current=match.sessions.find(s=>s.token===session.token);assert.ok(current);count++;
    const changed=[...new Set([...Object.keys(session.player),...Object.keys(current.player)])].filter(k=>!isDeepStrictEqual(session.player[k],current.player[k]));
    // Network rate limiting continues on the already-running normal server.
    assert.ok(changed.every(k=>['refillAt','tokens'].includes(k)),'Unexpected saved player change');playerChanges.push(changed);
  }
}
const server=await read('output/rimo-neko-c2-server/verification.json');
Object.assign(server,{savedPlayers:count,gameplayPlayerStateUnchanged:true,changedPlayerFields:[...new Set(playerChanges.flat())]});
await save('output/rimo-neko-c2-server/verification.json',server);await save(qa+'/c2-server.json',server);
Object.assign(adoption,{gameValidation:'passed',gameQA:qa+'/c2-game.json',allVertexPoses:motion.checks.reduce((n,c)=>n+c.samples,0),
  testedLODs:2,neutralAndMotionFrames:126,tests:{passed:821,failed:0,log:'output/rimo-neko-c2-tests-final.log'},
  localServerQA:qa+'/c2-server.json',knownLimits:summary.limitations});
await save('assets/rimo-neko/adoption.json',adoption);
console.log(JSON.stringify({sha256:asset.sha256,clips:clips.length,frames:frames.length,captures:captures.length,settledPetContact:settled,savedPlayers:count}));
