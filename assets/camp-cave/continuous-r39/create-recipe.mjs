// One-time r39 input record. Later additions belong in recipe.json.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = 'assets/camp-cave/continuous-r39';
const old = JSON.parse(await readFile(`${root}/previous-asset.json`, 'utf8'));
const names = ['round-and-maruimo', 'shapes-and-companions', 'meadow-people', 'river-people', 'extra-animals'];
const sources = {};
for (const name of names) {
  const file = `${root}/source/${name}-r01.png`, data = await readFile(file);
  sources[name] = { path: file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), prompt: `${root}/prompts/${name}.txt` };
}
// Reviewed, disjoint crop windows include a little transparent padding. bodyTop
// is the head crown, excluding hats/ears, measured in the generated source.
const rows = [
  ['white','roundBots',0,[59,198,407,544],'small'],
  ['blue','roundBots',0,[453,198,800,547],'small'],
  ['green','roundBots',0,[850,197,1189,540],'small'],
  ['purple','roundBots',0,[56,739,395,1081],'small'],
  ['orange','roundBots',0,[445,736,782,1079],'small'],
  ['maruimo-mascot','maruimoFrieze',0,[785,641,1243,1160],'person'],
  ['beret','shapeBots',1,[28,214,423,557],'small'],
  ['frog','shapeBots',1,[451,241,814,553],'small'],
  ['triangle','shapeBots',1,[849,232,1241,559],'small'],
  ['heart','shapeBots',1,[27,714,418,1056],'small'],
  ['524','creature524',1,[445,692,811,1017],'small'],
  ['rimo-neko','rimoFrieze',1,[786,619,1236,1119],'cat'],
  ['mae','maeKohaku',2,[58,319,368,546],'small'],
  ['kohaku','maeKohaku',2,[405,119,795,580],'person',161],
  ['saber-mascot','friendsMeadow',2,[796,106,1224,600],'person',220],
  ['fairy-mascot','friendsMeadow',2,[47,699,394,1187],'person'],
  ['nukonuko-mascot','friendsMeadow',2,[432,698,838,1187],'person',724],
  ['sagasa-mascot','friendsMeadow',2,[866,696,1218,1197],'person'],
  ['otani-mascot','friendsRiver',3,[25,165,418,587],'duck',273],
  ['urata-mascot','friendsRiver',3,[443,124,835,585],'person'],
  ['howkey-scientist','friendsRiver',3,[829,157,1242,598],'person'],
  ['rei-mascot','friendsRiver',3,[15,720,495,1187],'person'],
  ['daredaro','daredaroFrieze',3,[498,663,810,1187],'person'],
  ['ryuichi','ryuichiFrieze',3,[891,706,1202,1186],'person'],
];
const animals = [
  {id:'woollyRhino',atlas:'daredaroFrieze',source:'extra-animals',crop:[204,27,924,437],size:'woollyRhino'},
  {id:'ibex',atlas:'maruimoFrieze',source:'extra-animals',crop:[362,438,923,864],size:'ibex'},
  {id:'aurochs',atlas:'ryuichiFrieze',source:'extra-animals',crop:[220,838,1138,1232],size:'aurochs'},
];
const atlasKeys = [...new Set(rows.map((r) => r[1]))];
const atlases = Object.fromEntries(atlasKeys.map((key) => {
  const entry = key === 'creature524' ? 'characterPigment' : key === 'rimoFrieze' ? 'rimoPigment' : `mascotPigments.${key}`;
  const original = entry.split('.').reduce((a,k)=>a[k],old);
  return [key, {entry, originalSourceSize: original.uvSource ?? original.image}];
}));
const motifRects={bison:[805,40,1254,418],redHorse:[3,443,431,779],ochreHorse:[435,442,827,779],mammoth:[823,437,1254,786],deer:[15,782,430,1230],hands:[444,798,813,1205],signs:[832,821,1236,1215]};
const pigment = await sharp(`public${old.pigment.url}`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const recordedAnimalArt=[];
for(const [motif,[x0,y0,x1,y1]] of Object.entries(motifRects)) {
  const sx=pigment.info.width/1254,sy=pigment.info.height/1254;
  let left=Infinity,top=Infinity,right=-1,bottom=-1;
  for(let y=Math.ceil(y0*sy);y<Math.floor(y1*sy);y++) for(let x=Math.ceil(x0*sx);x<Math.floor(x1*sx);x++)
    if(pigment.data[(y*pigment.info.width+x)*4+3]>=24){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const l=Math.max(x0*sx,left-3),t=Math.max(y0*sy,top-3),r=Math.min(x1*sx,right+4),b=Math.min(y1*sy,bottom+4);
  recordedAnimalArt.push({id:motif,motif,size:motif,rect:[(l/sx-x0)/(x1-x0),(t/sy-y0)/(y1-y0),(r-l)/sx/(x1-x0),(b-t)/sy/(y1-y0)],aspect:(r-l)/(b-t),bodySpan:(bottom+1-top)/(b-t),foot:(bottom+1-t)/(b-t),ink:[(left-l)/(r-l),(top-t)/(b-t),(right+1-l)/(r-l),(bottom+1-t)/(b-t)]});
}
await writeFile(`${root}/recipe.json`, JSON.stringify({version:2, generator:'Built-in image_gen', sources, atlases, animals,recordedAnimalArt,
  subjects:rows.map(([id,atlas,source,crop,size,bodyTop])=>({id,atlas,source:names[source],crop,size,...(bodyTop?{bodyTop}:{}),...(id==='524'?{lift:0.22}:{})})),
}, null, 2)+'\n');
