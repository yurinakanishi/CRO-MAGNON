import {readFile,writeFile} from 'node:fs/promises';
import {createModelSync} from './crow-canonical-sync.mjs';
const mode=process.argv[2];if(!['plan','copy','verify'].includes(mode))throw new Error('Use plan, copy or verify');
const sync=createModelSync('valley-castle'),file='assets/valley-castle-canonical-plan.json';
const plan=mode==='plan'?await sync.plan():JSON.parse(await readFile(file,'utf8'));
if(mode==='plan')await writeFile(file,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
const result=mode==='plan'?{status:plan.status,files:plan.fileCount,bytes:plan.totalBytes}:await sync[mode](plan);
if(mode==='copy')await writeFile('assets/valley-castle-canonical-qa.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
