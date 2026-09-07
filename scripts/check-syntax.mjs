import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files=['server.mjs'];
for(const directory of ['src','shared','scripts','tests']){
  for(const entry of readdirSync(path.join(root,directory),{withFileTypes:true})){
    if(entry.isFile()&&/\.(mjs|js)$/.test(entry.name))files.push(`${directory}/${entry.name}`);
  }
}
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{cwd:root,stdio:'pipe',windowsHide:true});
  if(result.status!==0){
    console.error(`${file}: ${result.error?.message??result.stderr?.toString()}`);
    process.exitCode=1;
  }
}
if(!process.exitCode)console.log(`Syntax checked ${files.length} JavaScript files.`);
