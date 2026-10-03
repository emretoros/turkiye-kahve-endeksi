import fs from 'node:fs/promises';
import {exclusionReason} from './lib/catalog.mjs';
import {extractJsonLdNodes, productNodesFrom} from './lib/jsonld.mjs';
const dir='source/discovery-2026-10-03';
const selected=['wemondcoffee','brewgorillascoffeeroastery','crowcoffeeroastery','fahrenheitcoffeeroastery','manguucoffeeroastery','beanofmespecialtycoffeeroasting','varonacoffee','dozroastery','hermodcoffee','looffyscoffee','drroaster','dunnocoffee','petruscoffeeroastery'];
const additional={
 wemondcoffee:['/policies/legal-notice'],
 beanofmespecialtycoffeeroasting:['/gizlilik-politikasi/','/beanofme-kimdir/'],
 manguucoffeeroastery:['/pages/iletisim','/pages/hakkimizda'],
 hermodcoffee:['/pages/iletisim','/pages/hakkimizda'],
 looffyscoffee:['/pages/contact-us','/pages/kullanici-sozlesmesi'],
 dunnocoffee:['/pages/iletisim','/pages/iade-politikasi'],
 petruscoffeeroastery:['/pages/iletisim','/pages/vega-qr-001'],
 drroaster:['/hakkimizda/'],
 dozroastery:['/pages/iletisim'],
 varonacoffee:['/hakkimizda/']
};
async function get(url){try{const res=await fetch(url,{signal:AbortSignal.timeout(20000)});const html=await res.text();return {url:res.url,status:res.status,text:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),jsonld:productNodesFrom(extractJsonLdNodes(html))};}catch(e){return {url,error:e.message}}}
let cursor=0;
async function worker(){while(cursor<selected.length){const n=selected[cursor++];const d=JSON.parse(await fs.readFile(`${dir}/${n}.json`,'utf8'));
 const coffee=d.records.filter(r=>r.grams>0&&r.price>0&&typeof r.inStock==='boolean'&&r.currency==='TRY'&&!exclusionReason(r.productName+' '+r.urlPath));
 const sample=coffee.find(r=>r.grams===250&&r.inStock&&/cekirdek|öğütülmemiş|250/i.test(r.variantTitle))||coffee.find(r=>r.grams===250&&r.inStock)||coffee.find(r=>r.inStock);
 if(!sample)throw new Error(n+' no sample');
 const productEvidence=await get(sample.url);
 const scopeEvidence=[];
 for(const route of additional[n]||[])scopeEvidence.push(await get(d.website+route));
 d.verification={sample,productEvidence,scopeEvidence,coffeeVariants:coffee.length,verifiedAt:new Date().toISOString()};
 await fs.writeFile(`${dir}/${n}.json`,JSON.stringify(d,null,2));
 console.log(JSON.stringify({name:d.business,sample:{product:sample.productName,grams:sample.grams,price:sample.price,stock:sample.inStock,url:sample.url},status:productEvidence.status,scope:scopeEvidence.map(x=>({url:x.url,status:x.status}))}));
}}
await Promise.all(Array.from({length:3},worker));
