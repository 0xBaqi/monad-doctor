import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});const checks=[];
try {
 await page.goto('http://127.0.0.1:3143',{waitUntil:'networkidle',timeout:60000});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/diagnose')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Run diagnostic'}).click();assert.equal((await response).status(),503);
 await page.getByRole('alert').filter({hasText:'Diagnostic protection is unavailable'}).waitFor();checks.push('Production without Redis returns safe 503 and visible accessible error');
 assert.equal(await page.getByRole('button',{name:'Export JSON'}).count(),0);checks.push('Denied request does not fabricate report or export');
 const base='http://127.0.0.1:3143/api/diagnose';
 for(const input of [{mode:'transaction',provider:'primary',hash:'0x'+'0'.repeat(64)},{mode:'gas',provider:'primary',gasLimit:'1000000',call:{from:'0x'+'1'.repeat(40),to:'0x'+'2'.repeat(40),data:'0x',value:'0'}}])assert.equal((await page.request.post(base,{data:input})).status(),503);
 checks.push('All three workflows fail closed in production');
 assert.equal((await page.request.post(base,{data:{mode:'health',provider:'https://evil.invalid'}})).status(),400);
 assert.equal((await page.request.get(base)).status(),405);checks.push('Invalid provider and unsupported method remain rejected');
 await page.screenshot({path:'evidence/verification/m45-production-closed.png',fullPage:true});
 await writeFile('evidence/verification/m45-production-closed.json',JSON.stringify({checkedAt:new Date().toISOString(),localProduction:true,checks},null,2)+'\n');console.log(checks);
}finally{await browser.close();}
