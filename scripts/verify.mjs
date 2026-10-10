import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const npmCli=process.env.npm_execpath;
if(!npmCli) throw new Error('Run this script through npm run verify.');
mkdirSync('evidence/verification',{recursive:true});
const results=[];
for(const task of ['test','typecheck','lint','build']) {
 console.log('Running '+task);
 const r=spawnSync(process.execPath,[npmCli,'run',task],{encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024,windowsHide:true});
 const log=(r.stdout??'')+(r.stderr??'');
 writeFileSync('evidence/verification/'+task+'.log',log);
 console.log(log);
 results.push({task,exitCode:r.status,error:r.error?.code??null,completedAt:new Date().toISOString()});
}
writeFileSync('evidence/verification/checks.json',JSON.stringify({node:process.version,results},null,2)+'\n');
if(results.some(r=>r.exitCode!==0)) process.exitCode=1;
