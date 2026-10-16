// Local optimized-build acceptance. Every diagnostic is mocked, never forwarded.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { comparisonFixture } from '../tests/fixtures/health-comparison.ts';
import { decodeHealthComparison, serializeHealthComparison } from '../lib/health-comparison-response.ts';
import { FakeClock, ControlledTransport, comparisonRequest, wallNow } from '../tests/fixtures/health-coordinator.ts';
import { startHealthComparison } from '../lib/health-coordinator.ts';

const base=process.env.MONAD_DOCTOR_URL??'http://127.0.0.1:3143';
if(new URL(base).hostname!=='127.0.0.1')throw Error('Local acceptance only');
const output=process.env.MONAD_DOCTOR_QA_DIR??'evidence/verification/provider-comparison-m41d';await mkdir(output,{recursive:true});
const cases={};for(const name of ['healthy','wrong-network','contradiction','difference','alignment','inconsistent','null','incomplete','cancelled'])cases[name]=(await comparisonFixture(name)).text;
const clock=new FakeClock(),rpc=new ControlledTransport();const pending=startHealthComparison(comparisonRequest(true),{clock,wallNow,runId:'cleanup-pending',admission:{release(){}},fetcher:rpc.fetcher});await clock.flush();await clock.advance(2250);cases.pending=serializeHealthComparison(await pending.result);rpc.reply(0,'0x8f');await pending.drained;
const browser=await chromium.launch({executablePath:process.env.MONAD_DOCTOR_CHROMIUM,headless:true});
const checks=[],errors=[];const record=name=>{checks.push({name,passed:true});console.log('PASS: '+name);};
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1100},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  const requests=[];let variant='healthy',code=200,body=null,retry=null,hold=null;
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(u.pathname!=='/api/diagnose')return route.continue();
   requests.push({input:route.request().postDataJSON(),header:route.request().headers()['x-monad-doctor-operation']});
   const payload=body??cases[variant],status=code,retryValue=retry;
   if(hold){const gate=hold;await gate.promise;}
   try{await route.fulfill({status,contentType:'application/json',headers:retryValue?{'Retry-After':retryValue}:{},body:payload});}catch{/* An explicitly aborted browser request may no longer accept fulfillment. */}
  });
  await page.goto(base,{waitUntil:'networkidle'});assert.equal(requests.length,0);
  await page.getByLabel('RPC provider').selectOption('secondary');
  const compare=page.getByRole('radio',{name:'Compare both approved providers'}),single=page.getByRole('radio',{name:'Inspect one provider'});
  await compare.focus();await page.keyboard.press('Space');assert.equal(await compare.isChecked(),true);
  await single.check();assert.equal(await page.getByLabel('RPC provider').inputValue(),'secondary');await compare.check();assert.equal(requests.length,0);record(width+' scope navigation is accessible and request-free');
  const result=page.getByRole('region',{name:'Diagnostic results'});
  async function run(expectError=false){
   const count=requests.length;const req=page.waitForRequest(r=>r.url()===base+'/api/diagnose'&&r.method()==='POST'),res=page.waitForResponse(r=>r.url()===base+'/api/diagnose');
   await page.getByRole('button',{name:'Run comparison',exact:true}).click();await req;await(await res).finished();
   if(expectError)await page.getByRole('alert').filter({hasText:/\S/}).waitFor();else await page.getByRole('heading',{name:'What the comparison supports'}).waitFor();
   await page.waitForFunction(()=>document.querySelector('[aria-label="Diagnostic results"]').getAttribute('aria-busy')==='false');
   assert.equal(requests.length,count+1);assert.deepEqual(requests.at(-1).input,comparisonRequest(true));assert.equal(requests.at(-1).header,'health-comparison-v1');
  }
  for(variant of Object.keys(cases)){
   await run();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(variant==='wrong-network')await result.getByText('The observations do not establish a Monad Mainnet comparison.',{exact:true}).waitFor();
   if(variant==='contradiction')await result.getByText('Incompatible provider claims were observed.',{exact:true}).waitFor();
   if(variant==='cancelled')await result.getByText('cancelled',{exact:true}).waitFor();
   if(variant==='pending')await result.getByText(/Pending — local cleanup was not confirmed/).waitFor();
   if(['healthy','contradiction','incomplete'].includes(variant))await page.screenshot({path:output+'/'+width+'-'+variant+'.png',fullPage:true});
   record(width+' '+variant+' validated report without horizontal overflow');
  }
  variant='healthy';await run();const count=requests.length;
  await result.getByText('Fields and evidence dependencies',{exact:true}).first().click();
  await result.locator('a[href^="#comparison-evidence-"]').first().click();
  assert.equal(await result.getByText('Inspect provider-qualified RPC evidence',{exact:true}).evaluate(e=>e.parentElement.open),true);
  assert.match(await page.evaluate(()=>document.activeElement.id),/^comparison-evidence-/);
  await page.keyboard.press('Tab');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();const file=await download;const path=output+'/'+width+'-comparison.json';await file.saveAs(path);const text=await readFile(path,'utf8');assert.equal(decodeHealthComparison(text).text,cases.healthy);assert.ok(Buffer.byteLength(text)<=65536);assert.equal(requests.length,count);
  await single.check();await result.getByText('Previous snapshot — inputs have changed.',{exact:true}).waitFor();assert.equal(await page.getByLabel('RPC provider').inputValue(),'secondary');await compare.check();assert.equal(requests.length,count);record(width+' evidence focus, export and stale scope preserve snapshot without requests');
  let release;hold={promise:new Promise(resolve=>{release=resolve;})};const requested=page.waitForRequest(r=>r.url()===base+'/api/diagnose');await page.getByRole('button',{name:'Run comparison',exact:true}).click();await requested;
  assert.equal(await page.locator('button[type="submit"]').isDisabled(),true);
  const during=requests.length;await page.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(requests.length,during);
  await page.getByRole('button',{name:'Cancel comparison'}).click();await page.getByRole('alert').filter({hasText:'Stopped waiting; server cleanup is not confirmed'}).waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('type')==='submit');release();hold=null;
  // A subsequent explicit request acts as a barrier; stale completion must not win.
  variant='contradiction';await run();await result.getByText('Incompatible provider claims were observed.',{exact:true}).waitFor();record(width+' cancellation and late response suppression');
  body=JSON.stringify({comparisonResponseVersion:2,result:{}});await run(true);await result.getByText('Incompatible provider claims were observed.',{exact:true}).waitFor();record(width+' malformed response retains previous snapshot');
  body='{}';code=403;await run(true);await page.getByRole('alert').filter({hasText:'Access denied'}).waitFor();record(width+' protected access denial');
  code=429;retry='60';await run(true);assert.equal(await page.getByRole('button',{name:'Run comparison',exact:true}).isDisabled(),true);await page.getByText(/respect the server’s Retry-After/).waitFor();record(width+' Retry-After without automatic retry');
  await context.close();
 }
 assert.deepEqual(errors,[]);record('No browser JavaScript errors');
 await writeFile(output+'/checks.json',JSON.stringify({checks,errors,mocked:true},null,2)+'\n');
}finally{await browser.close();}
