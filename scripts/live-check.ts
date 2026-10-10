import { mkdir, writeFile } from 'node:fs/promises';
import { diagnose } from '../lib/engine.ts';
import { createRpc } from '../lib/rpc.ts';
import { parseBlock, parseReceipt, quantity } from '../lib/validation.ts';
import type { Provider, Report } from '../lib/model.ts';
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const dir = new URL('../evidence/live/' + stamp + '/', import.meta.url);
await mkdir(dir,{recursive:true});
const save = async (name:string,value:unknown) => writeFile(new URL(name+'.json',dir),JSON.stringify(value,null,2)+'\n');
const summary: Record<string,unknown> = { origin:'actual-live-rpc', collectedAt:new Date().toISOString(), noTransactionsSubmitted:true, reports:[], revertedSearchLimitPerProvider:8 };
for (const provider of ['primary','secondary'] as Provider[]) {
 const health=await diagnose({mode:'health',provider});
 await save(provider+'-health',health);
 console.log(provider+' health: '+health.findings.map(f=>f.id).join(', '));
 (summary.reports as unknown[]).push({provider,health:health.findings.map(f=>f.id),chainConfirmed:health.findings.some(f=>f.id==='network.mainnet')});
 if (!health.findings.some(f=>f.id==='network.mainnet')) continue;
 const rpc=createRpc(provider);
 const chain=await rpc.call('eth_chainId',[],quantity);
 if(!chain.ok || BigInt(chain.value)!==143n) continue;
 const finalized=await rpc.call('eth_getBlockByNumber',['finalized',false],parseBlock);
 const latest=await rpc.call('eth_getBlockByNumber',['latest',false],parseBlock);
 await save(provider+'-head-discovery',{origin:'actual-live-rpc',evidence:rpc.evidence});
 const hash=finalized.ok ? finalized.value?.transactions[0] : undefined;
 if(hash) {
  const report=await diagnose({mode:'transaction',provider,hash});
  await save(provider+'-finalized-transaction',report);
  console.log(provider+' transaction: '+hash+' '+report.findings.map(f=>f.id).join(', '));
 }
 // Capture a recent transaction then recheck, without asserting an unobserved transition.
 const latestHash=latest.ok ? latest.value?.transactions[0] : undefined;
 if(latestHash) {
  const samples:Report[]=[];
  for(let i=0;i<3;i++) samples.push(await diagnose({mode:'transaction',provider,hash:latestHash}));
  await save(provider+'-lifecycle-samples',{origin:'actual-live-rpc',hash:latestHash,samples});
  summary[provider+'FinalityObservation']=samples.map(r=>r.findings.filter(f=>f.id.startsWith('tx.')).map(f=>f.id));
 }
 const call={from:'0x0000000000000000000000000000000000000001',to:'0x000000000000000000000000000000000000dead',data:'0x',value:'0'};
 const before=await diagnose({mode:'gas',provider,call,gasLimit:'1000000'});
 await save(provider+'-gas-before',before);
 const estimate=before.evidence.find(e=>e.method==='eth_estimateGas' && typeof e.result==='string')?.result;
 if(typeof estimate==='string') {
  const after=await diagnose({mode:'gas',provider,call,gasLimit:BigInt(estimate).toString()});
  await save(provider+'-gas-after',after);
  console.log(provider+' gas before/after: 1000000 -> '+BigInt(estimate));
 }
 const unknown=await diagnose({mode:'transaction',provider,hash:'0x'+'0'.repeat(64)});
 await save(provider+'-unknown-hash',unknown);
 const scan=createRpc(provider,{budgetMs:18000});
 const candidates=finalized.ok ? (finalized.value?.transactions ?? []).slice(0,8) : [];
 let failedHash:string|undefined;
 for(const candidate of candidates){
  const result=await scan.call('eth_getTransactionReceipt',[candidate],parseReceipt);
  if(result.ok && result.value?.transactionHash===candidate && result.value.status==='0x0'){failedHash=candidate;break;}
 }
 await save(provider+'-failed-search',{origin:'actual-live-rpc',limit:8,evidence:scan.evidence,found:failedHash??null});
 if(failedHash){
  const failed=await diagnose({mode:'transaction',provider,hash:failedHash});
  await save(provider+'-failed-transaction',failed);
  console.log(provider+' failed execution: '+failedHash+' '+failed.findings.map(f=>f.id).join(', '));
 }
 summary[provider+'FailedSearch']=failedHash??'No trustworthy failed example found within eight receipt lookups / 18 seconds. No root failure cause inferred.';
}
summary.completedAt=new Date().toISOString();
await save('summary',summary);
if (!(summary.reports as {chainConfirmed:boolean}[]).every(r=>r.chainConfirmed) || (summary.reports as unknown[]).length!==2) process.exitCode=1;
console.log('Live evidence saved to '+dir.pathname);
