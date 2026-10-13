// Deterministic optimized-build layout/export acceptance; no live RPC.
import {chromium} from 'playwright-core';
import {diagnose} from '../lib/engine.ts';
import {fixtures,mockRpc,NOW,HEALTH} from '../tests/fixtures/adversarial.ts';
import assert from 'node:assert/strict';
import {exportReport} from '../lib/export.ts';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const base=process.env.MONAD_DOCTOR_URL??'http://127.0.0.1:3152',version='refined';
if(new URL(base).hostname!=='127.0.0.1')throw new Error('Local mocked acceptance only.');
const out=process.env.MONAD_DOCTOR_QA_DIR??'.qa/mobile-layout';await mkdir(out,{recursive:true});
const reports={healthy:await diagnose(HEALTH,{rpc:mockRpc({provider:'primary',expected:[],forbidden:[]}),now:()=>NOW})};
for(const id of ['gas-padding','gas-estimation-error','receipt-present-versus-absent','unknown-on-all-providers','receipt-timeout','transaction-receipt-block-conflict']) {
 const f=fixtures.find(f=>f.id===id);reports[id]=await diagnose(f.input,{rpc:mockRpc(f.samples[0]),now:()=>NOW});
}
const browser=await chromium.launch({executablePath:process.env.MONAD_DOCTOR_CHROMIUM});
const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(15000);
let report,requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/diagnose',async r=>{requests++;await r.fulfill({contentType:'application/json',body:JSON.stringify(report)});});
const measurements=[];
try {
 for(const width of [320,390,1440]) {
  await page.setViewportSize({width,height:width===390?844:1100});
  for(const [id,r] of Object.entries(reports)) {
   const count=requests;report=r;await page.goto(base,{waitUntil:'networkidle',timeout:90000});
   assert.equal(await page.getByText('Technical modes',{exact:true}).locator('..').getAttribute('open'),null);
   await page.getByRole('button',{name:{health:'My RPC results look unexpected.',gas:'My gas limit or fee looks wrong.',transaction:"My transaction isn't showing up."}[r.mode],exact:true}).click();
   await page.getByLabel('RPC provider').selectOption(r.provider);
   if(r.mode==='transaction')await page.getByLabel(/^Transaction hash/).fill(r.input.hash);
   if(r.mode==='gas')for(const [label,v] of [['Sender address',r.input.call.from],['Recipient address',r.input.call.to],['Value in wei',r.input.call.value],['Calldata',r.input.call.data],['Proposed gas limit',r.input.gasLimit]])await page.getByLabel(new RegExp('^'+label)).fill(v);
   assert.equal(requests,count);
   const done=page.waitForResponse(x=>x.url()===base+'/api/diagnose');await page.getByRole('button',{name:'Run diagnostic'}).click();await (await done).finished();
   const result=page.getByRole('region',{name:'Diagnostic results'});
   await result.getByRole('heading',{name:r.findings[0].title,exact:true}).first().waitFor();
   await page.waitForFunction(()=>document.querySelector('[aria-label="Diagnostic results"]').getAttribute('aria-busy')==='false');
   assert.equal(requests,count+1);
   assert.equal(await result.getByText('RPC REQUESTS',{exact:true}).count(),1);
   const metrics=result.locator('[aria-label="Report metrics"]');
   assert.equal(await metrics.locator('strong').first().textContent(),String(r.evidence.length).padStart(2,'0'));
   assert.equal(await metrics.locator('strong').nth(1).textContent(),String(r.findings.filter(f=>['warning','error'].includes(f.severity)).length).padStart(2,'0'));
   assert.equal(await metrics.locator('time').getAttribute('dateTime'),r.startedAt);
   assert.ok((await metrics.boundingBox()).y < (await result.locator('#guided-title').boundingBox()).y);
   assert.equal(await result.locator('article').count(),r.findings.length);
   for(const f of r.findings){
    const article=result.locator('article').filter({has:page.locator('code').filter({hasText:new RegExp('^'+f.id.replaceAll('.','\\.')+'$')})});
    const original=await article.textContent();assert.ok(original.includes(f.detail));assert.ok(original.includes(f.nextStep));
    for(const source of f.sources)assert.ok((await article.locator('a').evaluateAll(links=>links.map(a=>a.href))).includes(source));
   }
   assert.equal(await result.locator('article details[open]').count(),0);
   if(r.mode!=='health')assert.equal(await result.locator('h4').filter({hasText:r.mode==='gas'?'Proposed limit (gas units)':'Inclusion'}).first().locator('..').locator('..').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width<=760?1:3);
   for(const f of r.findings.filter(f=>['warning','error'].includes(f.severity)))await result.getByRole('heading',{name:f.title,exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.ok((await page.getByRole('button',{name:'Export JSON'}).boundingBox()).height>=44);
   for(const b of await page.locator('section[aria-labelledby="symptom-title"] button').all())assert.ok((await b.boundingBox()).height>=44);
   await page.screenshot({path:`${out}/${id}-${width}-full.png`,fullPage:true});
   await result.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:`${out}/${id}-${width}-report.png`});
   measurements.push({id,width,reportHeight:await result.evaluate(e=>e.offsetHeight),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
   const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();
   const download=await downloadEvent;const file=`${out}/${id}-${width}.json`;await download.saveAs(file);
   assert.deepEqual(JSON.parse(await readFile(file,'utf8')),exportReport(r));
   const finding=result.locator('article > details').first();await finding.locator('summary').first().focus();await page.keyboard.press('Enter');
   assert.equal(await finding.getAttribute('open'),'');
   const code=await finding.locator('code').textContent();assert.ok((await finding.innerText()).includes(r.findings.find(f=>f.id===code).detail));
   const link=finding.getByRole('link',{name:/Evidence #/}).first();if(await link.count()){await link.click();assert.match(await page.evaluate(()=>document.activeElement.id),/^evidence-/);}
   assert.equal(requests,count+1);

  }
 }
 assert.equal(requests,21);assert.deepEqual(errors,[]);
 await writeFile(out+'/measurements.json',JSON.stringify({version,requests,errors,measurements},null,2));console.log(JSON.stringify({version,requests,errors,measurements}));
}finally{await browser.close();}
