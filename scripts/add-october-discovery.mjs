import fs from 'node:fs/promises';
import {openStore} from './lib/store.mjs';
import {exclusionReason} from './lib/catalog.mjs';
import {applyPriceRules} from './lib/price-rules.mjs';
import {buildBusinessList} from './lib/roster.mjs';
import {hostOf,normalize} from './lib/identity.mjs';

const dir='source/discovery-2026-10-03';
const seeds=JSON.parse(await fs.readFile(`${dir}/seeds.json`,'utf8'));
const selected=new Set(['Wemond Coffee','Brew Gorillas Coffee Roastery','Crow Coffee Roastery','Fahrenheit Coffee Roastery','Manguu Coffee Roastery','Beanofme Specialty Coffee Roasting','Varona Coffee','Doz Roastery','Hermod Coffee',"Looffy's Coffee",'Dr. Roaster','Dunno Coffee','Petrus Coffee Roastery']);
const filenames=(await fs.readdir(dir)).filter(x=>x!=='seeds.json');
const probes=await Promise.all(filenames.map(async f=>JSON.parse(await fs.readFile(`${dir}/${f}`,'utf8'))));
const byName=new Map(probes.map(d=>[d.business,d]));
const beforeRoasters=JSON.parse(await fs.readFile('data/roasters.json','utf8'));
const source=JSON.parse(await fs.readFile('source/broad_products.json','utf8'));
const manual=JSON.parse(await fs.readFile('data/manual_roasters.json','utf8'));
const baseline=buildBusinessList(source,manual);
const candidates=JSON.parse(await fs.readFile('data/candidate_roasters.json','utf8'));
const manifest=[];
const reasons={
 'COFFEEDEAN':'HTTP 406; katalog erişimi başarısız.',
 'Single Origin Coffee Roasting':'Alan adı park sayfası; etkin resmî mağaza doğrulanamadı.',
 'Rahiya Coffee':'Resmî site pazar yeri/WhatsApp satışına yönlendiriyor; doğrudan mağaza kataloğu yok.',
 'Bakku Coffee':'7 ürün kaydı; gramaj bilgisi alınamadı.',
 'Nors Coffee Roastery':'100 ürün/varyant kaydı; gramaj eşleşmesi alınamadı.',
 'Profusion Coffee Roasters':'HTTP 429; erişim sınırlaması nedeniyle katalog alınamadı.',
 'Pueblo Coffee Roastery':'Resmî siteden bağlı pueblocoffeeroastery.com mağazası da denendi; veri alınamadı.',
 'Hacı Caferoğlu':'Resmî siteden bağlı mağaza alt alan adı da denendi; katalog/scope doğrulaması tamamlanamadı.',
 'Kahve Tiryakisi':'Resmî siteden bağlı evdekitiryakiler.com.tr mağazasında 125 kayıt alındı; ilk 13 bağımsız kavurucu grubundan sonra incelenecek.',
 'Flavor Drink':'3 JSON-LD kaydı alındı; örnek sayfa ve tüketici satış/stok doğrulaması sonraki gruba bırakıldı.',
 'Antares Coffee Roastery':'HTTP 500; canlı katalog erişimi başarısız.',
 'On On':'HTTP 500; tüketiciye paketli kahve satışı ve katalog doğrulanamadı.',
 'Beige Roastery & Coffee Co.':'Çanakkale faaliyet/kavurmahane doğrulandı; karşılaştırılabilir doğrudan perakende kataloğu alınamadı.',
 'Grond Coffee':'Kavurmahane doğrulandı; doğrudan paketli kahve mağazası/kataloğu alınamadı.',
 'Giza Coffee & Roastery':'Resmî kafe sitesi doğrulandı; paketli kahve mağazası/kataloğu alınamadı.',
 'Cincinnati Roastery':'Gaziantep faaliyet doğrulandı; paketli kahve mağazası/kataloğu alınamadı.',
 'Ade Miel Coffee Shop & Roastery':'Katalog verisi alınamadı; şehir ve kapsam doğrulaması gerekiyor.',
 'Coffee Esto Roastery':'Özel mağaza arayüzü mevcut; desteklenen toplayıcılar veri alamadı.',
 'Despado Coffee & Roastery':'Ürün sayfaları mevcut; WooCommerce ucu JSON yerine HTML döndü, veri alınamadı.',
 'Laos Coffee Roastery':'Kurumsal/şube sitesi; karşılaştırılabilir paketli perakende kataloğu alınamadı.',
 'Mun Coffee & Roasters':'Paketli çekirdek seçkisi mevcut; mevcut toplayıcı doğrudan katalog alamadı.'
};
const norm=s=>normalize(s).replace(/[^a-z0-9]/g,'');
for(const seed of seeds){
 const d=byName.get(seed.business);
 if(!d)throw new Error('Missing probe: '+seed.business);
 const coffee=d.records.filter(r=>r.grams>0&&r.price>0&&typeof r.inStock==='boolean'&&r.currency==='TRY'&&!exclusionReason(r.productName+' '+r.urlPath));
 // Probe-time roster matching includes historical aliases. Also check the authoritative daily roster.
 const matched=baseline.find(r=>norm(r.business)===norm(d.business)||hostOf(r.website)===hostOf(d.website));
 const isExisting=d.existing||matched?.business||null;
 const add=selected.has(d.business);
 if(add&&isExisting)throw new Error('Selected duplicate: '+d.business);
 if(add&&(!d.verification||d.verification.productEvidence.status!==200||!coffee.length))throw new Error('Incomplete verification: '+d.business);
 const social=d.evidence.flatMap(x=>x.links||[]).find(u=>/^https?:\/\/(www\.)?instagram\.com\/[^/?]+\/?$/.test(u)&&!u.endsWith('instagram.com/')&&!u.includes('farazibilisim'))||null;
 const sample=add?d.verification.sample:coffee[0]||null;
 const decision=isExisting?'Mevcut — tekrar eklenmedi':add?'İlk grup — eklendi':'Aday listesinde';
 manifest.push({business:d.business,city:d.city,cityNote:d.cityNote||null,website:d.website,instagram:social,existing:isExisting,status:isExisting?'mevcut':'yeni',platform:d.platform,rawRows:d.records.length,comparableVariants:coffee.length,sample:sample?{product:sample.productName,url:sample.url,grams:sample.grams,price:sample.price,inStock:sample.inStock}:null,catalogResult:add?`${coffee.length} kahve varyantı; örnek ürün doğrulandı`:isExisting?`${coffee.length} karşılaştırılabilir varyant`:reasons[d.business]||d.error,decision,checkedAt:d.checkedAt,scopeSources:add?[...d.evidence.filter(x=>x.text).map(x=>x.url),...d.verification.scopeEvidence.filter(x=>x.status===200).map(x=>x.url)]:[],error:d.error,otherCatalogAttempts:(d.catalogAttempts||[]).map(a=>({website:a.website,rows:a.records.length,error:a.error}))});
 if(add){
  manual.push({business:d.business,city:d.city,website:d.website,...(social?{instagram:social}:{}),businessStatus:'Doğrulandı',note:`2026-10-03 keşif turu: resmî mağaza, Türkiye faaliyeti ve paketli B2C kahve doğrulandı; ${d.platform} ile ${coffee.length} gramaj/fiyat/stok bilgili kahve varyantı alındı. Kanıt: source/discovery_2026-10-03.json.`});
 }else if(!isExisting&&!candidates.some(c=>norm(c.business)===norm(d.business)||hostOf(c.website)===hostOf(d.website))){
  candidates.push({business:d.business,city:d.city,website:d.website,...(social?{instagram:social}:{}),status:'Doğrulama bekliyor',reason:reasons[d.business]||d.error,checkedAt:'2026-10-03',evidence:`source/discovery_2026-10-03.json`,catalogRows:d.records.length,platform:d.platform});
 }
}
const runId='discovery-2026-10-03-batch-01';
const store=openStore('data');
if(store.scrapeRuns.some(r=>r.runId===runId))throw new Error('This batch was already ingested');
let totalRows=0,totalChanged=0,quarantined=0;
for(const d of probes.filter(d=>selected.has(d.business))){
 const roaster=store.upsertRoaster({business:d.business,city:d.city,businessStatus:'Doğrulandı',website:d.website,instagram:manifest.find(x=>x.business===d.business).instagram,platform:d.platform});
 const {rows:audited}=applyPriceRules(d.records.map(r=>({business:d.business,product:r.productName,grams:r.grams,price:r.price,previousPrice:null,sourceMethod:d.platform})));
 let changed=0;
 for(const [i,record] of d.records.entries()){
  const product=store.upsertProduct(roaster,record);
  const variant=store.upsertVariant(product,record);
  if(audited[i]?.quarantined)quarantined++;
  if(store.recordObservation(variant,audited[i]?.quarantined?{...record,price:null}:record,runId,d.platform))changed++;
 }
 roaster.dataStatus='active';roaster.dataStatusNote=null;
 store.roasterHealth.push({runId,roasterSlug:d.business,rows:d.records.length,deltaPct:null,flagged:false,error:null});
 totalRows+=d.records.length;totalChanged+=changed;
}
store.scrapeRuns.push({runId,startedAt:probes.filter(d=>selected.has(d.business)).map(d=>d.checkedAt).sort()[0],finishedAt:new Date().toISOString(),businesses:selected.size,totalRows,totalChanged,errors:0,scope:'verified discovery batch'});
store.save();
await fs.writeFile('data/manual_roasters.json',JSON.stringify(manual,null,2)+'\n');
await fs.writeFile('data/candidate_roasters.json',JSON.stringify(candidates,null,2)+'\n');
const summary={checkedAt:'2026-10-03',discovered:manifest.length,existing:manifest.filter(d=>d.existing).length,added:selected.size,pending:candidates.length,beforeRoasters:beforeRoasters.length,afterRoasters:store.roasters.length,totalRows,totalChanged,quarantined,runId};
const discoverySources=[{channel:'forum',url:'https://www.kahveler.net/kahve/15622-wemond-coffeeden-selamlar.html/'},{channel:'forum',url:'https://kahvekulubu.net/sosyal/threads/nitelikli-kahve-erisim-noktalar.10664/'},{channel:'web-directory-discovery-only',url:'https://kahverehberim.com/kavurucu'},{channel:'instagram',note:'Doğrudan Instagram sayfaları erişim sınırlaması nedeniyle okunamadı. Hesap bağlantıları resmî mağazalardan alındı; Instagram tek başına doğrulama kanıtı sayılmadı.'}];
await fs.writeFile('source/discovery_2026-10-03.json',JSON.stringify({summary,discoverySources,businesses:manifest},null,2)+'\n');
await fs.mkdir('reports/discovery-2026-10-03',{recursive:true});
const lines=manifest.map(d=>`| ${d.business} | ${d.city||'Doğrulanmadı'} | [site](${d.website}) | ${d.status} | ${d.catalogResult.replace(/\|/g,'/')} | ${d.decision} |`);
const md=`# 3 Ekim 2026 keşif turu\n\n40 işletme incelendi: ${summary.added} eklendi, ${summary.existing} mevcut kayıtla eşleşti, ${summary.pending} aday listesine alındı. İlk grup bağımsız kavuruculara öncelik verir. Varyant sayıları farklı gramaj ve öğütme seçeneklerini içerir; ürün sayısı değildir. Bilinmeyen şehirler tahmin edilmedi.\n\n| İşletme | Şehir | Resmî site / aday adresi | Mevcut/yeni | Katalog sonucu | Ekleme kararı |\n|---|---|---|---|---|---|\n${lines.join('\n')}\n\n## Eklenenlerin örnek ürünleri\n\n| İşletme | Ürün | Gramaj | Fiyat (TL) | Stok | Bağlantı |\n|---|---|---:|---:|---|---|\n${manifest.filter(d=>selected.has(d.business)).map(d=>`| ${d.business} | ${d.sample.product} | ${d.sample.grams} g | ${d.sample.price} | ${d.sample.inStock?'Var':'Yok'} | [ürün](${d.sample.url}) |`).join('\n')}\n\nHer örnek ürün URL'si canlı olarak HTTP 200 döndü. Fiyatlar 3 Ekim denemesi anındaki fiyatlardır. Instagram erişimi sınırlı kaldı; hesap bağlantıları resmî mağazalardan doğrulandı. Dunno'nun Türkiye içi gönderimi resmî iade politikasından doğrulandı; Ankara bilgisini resmî kaynakta teyit edemediğimiz için şehir alanı boş bırakıldı.\n\nHam katalog ve sayfa kanıtları source/discovery-2026-10-03/ altında; kararlar source/discovery_2026-10-03.json içinde.\n`;
await fs.writeFile('reports/discovery-2026-10-03/first-round.md',md);
const csvEscape=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
await fs.writeFile('reports/discovery-2026-10-03/first-round.csv','\uFEFF'+[['işletme','şehir','resmî site','mevcut/yeni','katalog sonucu','ekleme kararı'],...manifest.map(d=>[d.business,d.city||'Doğrulanmadı',d.website,d.status,d.catalogResult,d.decision])].map(row=>row.map(csvEscape).join(',')).join('\r\n')+'\r\n');
console.log(JSON.stringify(summary,null,2));
