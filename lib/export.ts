import { SOURCES, type Report, type Evidence } from './model.ts';
import { decimal, hex, object, parseBlock, parseInput, parseReceipt, parseTransaction, quantity, ValidationError } from './validation.ts';
import { guidance } from './guidance.ts';
const methods = ['eth_chainId','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt','eth_estimateGas','eth_gasPrice'];
const codes = ['BUDGET','RATE_LIMIT','HTTP','RPC','TIMEOUT','TOO_LARGE','MALFORMED','NETWORK'];
function timestamp(value: string) { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ValidationError('Invalid report timestamp.'); return value; }
function blockTag(value: unknown) { return value === 'latest' || value === 'finalized' ? value : quantity(value); }
function evidence(e: Evidence) {
 if (!Number.isSafeInteger(e.id) || e.id < 1 || !methods.includes(e.method) || !Number.isFinite(e.durationMs) || e.durationMs < 0) throw new ValidationError('Invalid export evidence.');
 let params: unknown[] = [];
 switch(e.method) {
  case 'eth_getBlockByNumber': if(e.params.length!==2 || e.params[1]!==false) throw new ValidationError('Invalid block parameters.'); params=[blockTag(e.params[0]),false]; break;
  case 'eth_getTransactionByHash': case 'eth_getTransactionReceipt': if(e.params.length!==1) throw new ValidationError('Invalid transaction parameters.'); params=[hex(e.params[0],32,'Hash')]; break;
  case 'eth_estimateGas': { if(e.params.length!==2) throw new ValidationError('Invalid estimate parameters.'); const c=object(e.params[0]);params=[{from:hex(c.from,20,'Sender'),to:hex(c.to,20,'Recipient'),value:quantity(c.value),data:'[redacted]'},blockTag(e.params[1])]; break; }
  default: if(e.params.length!==0) throw new ValidationError('Unexpected RPC parameters.');
 }
 const base={id:e.id,method:e.method,params,observedAt:timestamp(e.observedAt),durationMs:e.durationMs};
 if (Object.hasOwn(e,'result') === Boolean(e.error)) throw new ValidationError('Evidence must have exactly one result or error.');
 if(e.error) {
  if(!codes.includes(e.error.code)) throw new ValidationError('Unknown RPC error code.');
  return {...base,error:{code:e.error.code,message:'Evidence unavailable; consult the diagnostic finding and retry.',...(Number.isSafeInteger(e.error.rpcCode)?{rpcCode:e.error.rpcCode}:{}),...(Number.isInteger(e.error.httpStatus)&&e.error.httpStatus!>=400&&e.error.httpStatus!<=599?{httpStatus:e.error.httpStatus}:{})}};
 }
 const result=e.method==='eth_getBlockByNumber'?parseBlock(e.result):e.method==='eth_getTransactionByHash'?parseTransaction(e.result):e.method==='eth_getTransactionReceipt'?parseReceipt(e.result):quantity(e.result);
 return {...base,result};
}
// Only explicit, validated fields cross the sharing boundary. Never spread a report.
export function exportReport(report: Report) {
 if(report.schemaVersion!==1 || !['m1.1','m2.0','m3.0','m3.1'].includes(report.ruleVersion) || report.evidence.length>10 || report.findings.length>40) throw new ValidationError('Unsupported report format.');
 const normalized=parseInput(report.input);
 if(normalized.mode!==report.mode||normalized.provider!==report.provider) throw new ValidationError('Report metadata disagrees with input.');
 const input={mode:normalized.mode,provider:normalized.provider,...(normalized.hash?{hash:normalized.hash}:{}),...(normalized.call?{gasLimit:decimal(normalized.gasLimit,'Gas limit',true),call:{from:normalized.call.from,to:normalized.call.to,value:normalized.call.value,data:'[redacted]'}}:{})};
 const projected=report.evidence.map(evidence), ids=new Set(projected.map(e=>e.id));
 if(ids.size!==projected.length) throw new ValidationError('Duplicate evidence IDs.');
 const findings=report.findings.map(f=>{
  if(!/^[a-z0-9.-]{1,100}$/.test(f.id)||!['pass','info','warning','error'].includes(f.severity)||!['observed','inferred','unknown'].includes(f.basis)||f.evidence.some(id=>!ids.has(id))||f.sources.some(s=>!Object.values(SOURCES).includes(s as typeof SOURCES[keyof typeof SOURCES]))) throw new ValidationError('Invalid finding references.');
  for(const text of [f.title,f.detail,f.nextStep]) if(typeof text!=='string'||text.length>4096) throw new ValidationError('Invalid finding text.');
  return {id:f.id,severity:f.severity,basis:f.basis,title:f.title,detail:f.detail,nextStep:f.nextStep,evidence:[...f.evidence],sources:[...f.sources],explanation:guidance(f.id)};
 });
 const startedAt=timestamp(report.startedAt),completedAt=timestamp(report.completedAt);
 if(completedAt<startedAt) throw new ValidationError('Report timestamps are reversed.');
 return {exportVersion:1,schemaVersion:report.schemaVersion,ruleVersion:report.ruleVersion,provenance:'Actual RPC observations when collected by the app; deterministic fixtures must be labeled separately. Calldata omitted for sharing.',provider:report.provider,mode:report.mode,startedAt,completedAt,input,findings,evidence:projected,reproduction:{steps:['Select the recorded mode and provider.','Re-enter the sanitized inputs; supply calldata locally for gas analysis.','Run again and compare rule IDs, evidence and timestamps. Changed state can change results.'],calldataIncluded:false,containsPublicAddresses:true}};
}
