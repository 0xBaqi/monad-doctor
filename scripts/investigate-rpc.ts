import {createRpc,readBounded} from '../lib/rpc.ts';
import {quantity} from '../lib/validation.ts';
import {mkdir,writeFile} from 'node:fs/promises';
const records=[];
for(const [provider,url]of [['primary','https://rpc.monad.xyz'],['secondary','https://rpc1.monad.xyz']] as const){
 const startedAt=new Date().toISOString(),began=performance.now();
 try {const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),redirect:'error',signal:AbortSignal.timeout(5000)});const value=JSON.parse(await readBounded(r.body,1024,Math.max(1,5000-(performance.now()-began))));records.push({provider,path:'direct-native-fetch',startedAt,durationMs:Math.round(performance.now()-began),httpStatus:r.status,validMainnet:value?.jsonrpc==='2.0'&&value?.id===1&&value?.result==='0x8f'});}catch(e){records.push({provider,path:'direct-native-fetch',startedAt,durationMs:Math.round(performance.now()-began),error:e instanceof Error&&e.name==='TimeoutError'?'TIMEOUT':'NETWORK'});}
 const rpc=createRpc(provider);await rpc.call('eth_chainId',[],quantity);records.push({provider,path:'application-collector',evidence:rpc.evidence});
}
const dir='evidence/live/m45-network-'+new Date().toISOString().replace(/[:.]/g,'-');await mkdir(dir,{recursive:true});await writeFile(dir+'/comparison.json',JSON.stringify({records,interpretation:'Four bounded read-only calls. Sequential samples cannot identify a provider-wide outage or prove an intermittent defect. Direct fetch bypasses diagnostic validation; collector retains validated evidence.'},null,2)+'\n');console.log(JSON.stringify({dir,records},null,2));
