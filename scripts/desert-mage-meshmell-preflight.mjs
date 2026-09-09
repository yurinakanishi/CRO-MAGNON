import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
const cli=resolve('../meshmell.com/packages/cli/dist/src/bin.js');
function call(args){try{return JSON.parse(execFileSync(process.execPath,[cli,'--json',...args],{env:{...process.env,MESHMELL_CREDENTIAL_STORE:'file'},encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}));}catch(e){let code='CLI_FAILED';try{code=JSON.parse(String(e.stdout)).error?.code??code;}catch{}return {error:{code}};}}
const auth=call(['auth','status']),doctorResponse=call(['doctor']),doctor=doctorResponse.data??doctorResponse,lookup=call(['models','list','--query','desert-fennec-mage','--limit','10']);
const report={checkedAt:new Date().toISOString(),cli,auth:{authenticated:auth.authenticated??false,principal:auth.principal?{id:auth.principal.id,email:auth.principal.email,scopes:auth.principal.scopes}:null,error:auth.error?.code},doctor:{status:doctor.status,error:doctor.error?.code,checks:doctor.checks?.map(c=>({name:c.name,status:c.status,code:c.code}))},lookup};
// Listing contains public model metadata, never credentials. Do not save raw auth/doctor output.
mkdirSync('output/desert-mage-magic',{recursive:true});writeFileSync('output/desert-mage-magic/preflight.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
