import fs from 'node:fs/promises';
import { collectSite } from './lib/collectors.mjs';

const seeds = [
 ['Wemond Coffee','İstanbul','https://wemondcoffee.com'],
 ['Brew Gorillas Coffee Roastery','Samsun','https://www.brewgorillas.com'],
 ['Crow Coffee Roastery','Balıkesir','https://www.crowcoffee.co'],
 ['Fahrenheit Coffee Roastery','Antalya','https://www.fahrenheitcoffeeroastery.com'],
 ['Mun Coffee & Roasters','Antalya','https://munroasting.com'],
 ['Pueblo Coffee Roastery','Antalya','https://www.pueblo.com.tr'],
 ['COFFEEDEAN','Antalya','https://www.coffeedean.com.tr'],
 ['Rahiya Coffee',null,'https://rahiyacoffee.com'],
 ['Hacı Caferoğlu',null,'https://hacicaferoglu.com'],
 ['Single Origin Coffee Roasting','Samsun','https://singleoriginco.com'],
 ['Bakku Coffee','Samsun','https://bakkucoffee.com'],
 ['Manguu Coffee Roastery','Denizli','https://manguu.com.tr'],
 ['Beige Roastery & Coffee Co.','Çanakkale','https://beigecoffee.shop'],
 ['Cincinnati Roastery','Gaziantep','https://cincinnatiroastery.com'],
 ['Grond Coffee','Mersin','https://grondcoffee.com'],
 ['Giza Coffee & Roastery','Mersin','https://gizacoffeeroastery.com'],
 ['Coffee Esto Roastery','İstanbul','https://coffeeesto.com'],
 ['Despado Coffee & Roastery','İstanbul','https://despado.com'],
 ['Ade Miel Coffee Shop & Roastery',null,'https://www.ademielcoffee.com'],
 ['Antares Coffee Roastery',null,'https://antarescoffee.com'],
 ['Laos Coffee Roastery',null,'https://www.laoscoffeeroastery.com'],
 ['On On','Balıkesir','https://ononkafe.com'],
 ['1978 Coffee Roastery','Eskişehir','https://1978coffee.com'],
 ['Kruen Roastery','Trabzon','https://kruenroastery.com'],
 ['Rio Coffee Roastery','Mersin','https://riocoffeeroastery.business'],
 ['Calibre Coffee','İstanbul','https://coffeecalibre.com'],
 ['Roast Room','İstanbul','https://theroastroom.co'],
 ['ROR Cafe & Roastery','Ankara','https://www.rorcafe.com.tr'],
 ['Flavor Drink','İzmir','https://flavordrink.co'],
 ['Kahve Tiryakisi','İstanbul','https://kahvetiryakisi.com.tr'],
 ['Beanofme Specialty Coffee Roasting','Muğla','https://beanofme.com.tr'],
 ['Varona Coffee','Muğla','https://varonacoffee.com'],
 ['Nors Coffee Roastery','Bolu','https://norscoffee.com'],
 ['Profusion Coffee Roasters','Muğla','https://www.profusioncoffee.com'],
 ['Dr. Roaster','Manisa','https://drroaster.com'],
 ["Looffy's Coffee",'İzmir','https://looffyscoffee.com'],
 ['Petrus Coffee Roastery','Isparta','https://petrusroastery.com'],
 ['Doz Roastery','İstanbul','https://doz.coffee'],
 ['Hermod Coffee','Kocaeli','https://hermodcoffee.com'],
 ['Dunno Coffee','Ankara','https://dunnocoffee.co']
].map(([business,city,website])=>({business,city,website}));

await fs.mkdir('source/discovery-2026-10-03', {recursive:true});
await fs.writeFile('source/discovery-2026-10-03/seeds.json',JSON.stringify(seeds,null,2));
const existing=JSON.parse(await fs.readFile('data/roasters.json','utf8'));
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};
const norm=s=>s.toLocaleLowerCase('tr').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]/g,'');
let cursor=process.argv.includes('--extra')?30:0;
async function worker(){
 while(cursor<seeds.length){
  const seed=seeds[cursor++];
  const matched=existing.find(r=>norm(r.name)===norm(seed.business)||host(r.website)===host(seed.website));
  const evidence=[];
  for(const route of ['','/iletisim','/contact','/pages/contact']){
   try{const res=await fetch(seed.website+route,{signal:AbortSignal.timeout(15000)});if(!res.ok)continue;
    const html=await res.text();
    const links=[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>{try{return new URL(m[1].replace(/&amp;/g,'&'),res.url).href}catch{return null}}).filter(Boolean);
    evidence.push({url:res.url,links:[...new Set(links)],text:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()});
   }catch(error){evidence.push({url:seed.website+route,error:error.message})}
  }
  console.log('Probing',seed.business, matched?'existing':'new');
  const started=Date.now();
  const result=await collectSite(seed.website);
  const full={...seed,checkedAt:new Date().toISOString(),existing:matched?.name||null,evidence,...result,seconds:Math.round((Date.now()-started)/1000)};
  const name=norm(seed.business);
  await fs.writeFile(`source/discovery-2026-10-03/${name}.json`,JSON.stringify(full,null,2));
  console.log(JSON.stringify({business:seed.business,existing:full.existing,rows:result.records.length,complete:result.records.filter(r=>r.grams>0&&r.price>0&&typeof r.inStock==='boolean').length,platform:result.platform,error:result.error}));
 }
}
await Promise.all(Array.from({length:4},worker));
