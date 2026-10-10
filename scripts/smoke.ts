import { mkdir, writeFile } from 'node:fs/promises';
import { diagnose } from '../lib/engine.ts';
import { exportReport } from '../lib/export.ts';
const dir=new URL('../evidence/live/m3-smoke-'+new Date().toISOString().replace(/[:.]/g,'-')+'/',import.meta.url);
await mkdir(dir,{recursive:true});
for(const provider of ['primary','secondary'] as const){const report=await diagnose({mode:'health',provider});await writeFile(new URL(provider+'.json',dir),JSON.stringify(exportReport(report),null,2));const passed=['network.mainnet','rpc.latest','rpc.heads'].every(id=>report.findings.some(f=>f.id===id&&f.severity==='pass'));console.log(JSON.stringify({provider,passed,findings:report.findings.map(f=>f.id),directory:dir.pathname}));if(!passed)process.exitCode=1;}
