import {chromium} from 'playwright-core';
import {readFile,writeFile} from 'node:fs/promises';
const svg=await readFile('public/icon.svg','utf8');const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({deviceScaleFactor:1});
try{
 const images=[];
 for(const size of [16,32,48,180,192]){
  await page.setViewportSize({width:size,height:size});await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>'+svg);
  const png=await page.screenshot({omitBackground:true});if(size<100)images.push({size,png});else await writeFile(size===180?'public/apple-touch-icon.png':'public/icon-192.png',png);
 }
 const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
 images.forEach(({size,png},i)=>{const at=6+i*16;header[at]=size;header[at+1]=size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;});await writeFile('public/favicon.ico',Buffer.concat([header,...images.map(x=>x.png)]));
 await page.setViewportSize({width:1200,height:630});await page.setContent('<style>*{box-sizing:border-box}body{margin:0;background:#f7f7fc;color:#171425;font-family:Arial,sans-serif;padding:58px 64px}.brand{display:flex;align-items:center;gap:16px;font-size:30px;letter-spacing:-1px;font-weight:700}.brand svg{width:58px;height:58px}.tag{position:absolute;right:64px;top:75px;color:#7445ee;font-size:16px;font-weight:700;letter-spacing:2px}h1{font-size:68px;line-height:1.06;letter-spacing:-3px;margin:48px 0 24px;max-width:1050px}h1 span{color:#7445ee}p{font-size:23px;color:#606173;margin:0;line-height:1.5}.bottom{display:flex;justify-content:space-between;border-top:1px solid #dcd8ed;margin-top:38px;padding-top:24px;font-size:18px}.flow{color:#7445ee;font-weight:700}</style><div class="brand">'+svg+'<span>monad<span style="font-weight:400">doctor</span></span></div><div class="tag">READ-ONLY DIAGNOSTICS</div><h1>Find and fix <span>Monad</span><br>integration problems.</h1><p>Before they reach production.<br>RPC health &nbsp; / &nbsp; Gas limits &nbsp; / &nbsp; Transaction lifecycle</p><div class="bottom"><span class="flow">Evidence &nbsp; &#8594; &nbsp; Fix &nbsp; &#8594; &nbsp; Verify</span><span>monad-doctor.vercel.app</span></div>');await page.screenshot({path:'public/social-preview.png'});
}finally{await browser.close();}
