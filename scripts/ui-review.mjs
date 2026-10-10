import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[]; let passed=false;
const page=await browser.newPage({viewport:{width:1440,height:1100}});
try {
 await page.goto('http://127.0.0.1:3143',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('heading',{name:'Ready when you are.'}).waitFor();
 await page.waitForLoadState('networkidle',{timeout:60000});
 await page.keyboard.press('Tab');
 // Home link is first; the explicit skip link remains reachable with native Tab navigation.
 for(let i=0;i<4 && await page.evaluate(()=>document.activeElement?.textContent)!=='Skip to diagnostic';i++) await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Skip to diagnostic');
 await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'diagnostic-title');
 checks.push('Keyboard skip link reaches diagnostic heading');
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'evidence/verification/m4-'+width+'.png',fullPage:true});
  checks.push(width+'px empty state without horizontal overflow');
 }
 await page.getByRole('button',{name:/Gas-limit analysis/}).click();
 await page.getByLabel('Sender address',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Sender address',{exact:true}).evaluate(e=>getComputedStyle(e).fontSize),'16px');
 checks.push('Mobile input text is 16px and labels resolve');
 await page.getByRole('button',{name:/RPC health/}).click();
 let release; const held=new Promise(resolve=>{release=resolve});
 await page.route('**/api/diagnose',async route=>{await held;await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Synthetic capacity response for UI testing.'})});});
 await page.getByRole('button',{name:'Run diagnostic'}).click();
 await page.getByRole('heading',{name:/Following the evidence/}).waitFor();
 assert.ok(await page.getByRole('button',{name:/Reading RPC/}).isDisabled());
 checks.push('Synthetic delayed response shows loading and prevents resubmission');
 release();
 await page.getByRole('alert').filter({hasText:'Synthetic capacity response'}).waitFor();
 checks.push('Synthetic 429 displays accessible error; no fabricated findings'); passed=true;
} finally {await browser.close();await writeFile('evidence/verification/m4-ui-review.json',JSON.stringify({checkedAt:new Date().toISOString(),kind:'Local UI checks; intercepted 429 is synthetic',passed,checks},null,2));}
console.log(checks);
