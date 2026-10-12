import fs from 'node:fs/promises';
import {collectKahhveBrand} from './lib/kahhve.mjs';
import {openStore} from './lib/store.mjs';
import {applyPriceRules} from './lib/price-rules.mjs';
import {exclusionReason} from './lib/catalog.mjs';
import {normalize} from './lib/identity.mjs';

const date = '2026-10-12';
const dir = `source/discovery-${date}`;
const runId = `kahhve-listed-brands-${date}`;
const seeds = [
  ['Addis Ababa', 'addis-ababa'], ['Caffe Fresco', 'caffe-fresco'],
  ['Caffe Vergnano', 'caffe-vergnano'], ['Cool Beans', 'cool-beans'],
  ['Illy', 'illy'], ['Julius Meinl', 'julius-meinl'],
  ['Mandabatmaz', 'mandabatmaz'], ['Morn Coffee', 'morn-coffee'],
  ['Segafredo Zanetti', 'segafredo-zanetti'], ['Toom', 'toom'], ['Urban Grind', 'urban-grind']
].map(([business, slug]) => ({business, slug, website: `https://kahhve.com/${slug}`}));
const store = openStore('data');
const manual = JSON.parse(await fs.readFile('data/manual_roasters.json', 'utf8'));
if (store.scrapeRuns.some(run => run.runId === runId)) throw new Error('Bu ekleme zaten uygulandı');
for (const seed of seeds) {
  if (store.roasters.some(roaster => normalize(roaster.name) === normalize(seed.business))) {
    throw new Error(`Mevcut işletme tekrar eklenemez: ${seed.business}`);
  }
}
await fs.mkdir(dir, {recursive: true});
const checkedAt = new Date().toISOString();
const collected = [];

// Finish verification before touching the database, so network failures cannot
// leave half of the requested batch in the permanent store.
for (const seed of seeds) {
  const payloads = [];
  const records = (await collectKahhveBrand(seed.website, {
    onPayload: (payload, url) => payloads.push({url, payload})
  })).filter(record => !exclusionReason(`${record.productName} ${record.url}`));
  if (!records.length) throw new Error(`Karşılaştırılabilir kahve ürünü bulunamadı: ${seed.business}`);
  const sample = records.find(record => record.inStock === true) || records[0];
  const response = await fetch(sample.url, {signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Örnek ürün erişilemiyor: ${seed.business}, HTTP ${response.status}`);
  const html = await response.text();
  const htmlPrice = Number(html.match(/itemprop="price"\s+content="([^"]+)"/)?.[1]);
  const brand = html.match(/itemprop="brand">\s*<a[^>]*>([^<]+)/)?.[1];
  const weight = html.match(/Ağırlık:\s*<br>\s*(\d+(?:[.,]\d+)?)\s*(g|gr|gram)\b/i)?.[1];
  if (Math.abs(htmlPrice - sample.price) > 0.01 || !Number.isFinite(htmlPrice)) {
    throw new Error(`API ve örnek sayfa fiyatı uyuşmuyor: ${seed.business}: ${sample.price}/${htmlPrice}`);
  }
  if (normalize(brand) !== normalize(seed.business)) throw new Error(`Örnek marka uyuşmuyor: ${seed.business}/${brand}`);
  if (weight && Math.abs(Number(weight.replace(',', '.')) - sample.grams) > 0.01) {
    throw new Error(`Örnek gramaj uyuşmuyor: ${seed.business}: ${sample.grams}/${weight}`);
  }
  const evidence = {business: seed.business, catalogUrl: seed.website, checkedAt,
    records, sampleVerification: {url: sample.url, status: response.status, price: htmlPrice,
      brand, grams: weight ? Number(weight.replace(',', '.')) : null}, payloads};
  await fs.writeFile(`${dir}/${seed.slug}.json`, JSON.stringify(evidence, null, 2) + '\n');
  collected.push({seed, records, sampleVerification: evidence.sampleVerification});
  console.log(`${seed.business}: ${records.length} ürün/paket; örnek sayfa doğrulandı`);
}

const before = store.stats();
let quarantined = 0;
for (const {seed, records} of collected) {
  const roaster = store.upsertRoaster({business: seed.business, city: null,
    businessStatus: 'Doğrulandı', website: seed.website, platform: 'kahhve'});
  roaster.catalogUrl = seed.website;
  roaster.dataStatus = 'active';
  roaster.dataStatusNote = null;
  roaster.verificationSource = 'KahhveCom marka kataloğunda Türkiye perakende satışı';
  manual.push({business: seed.business, city: null, website: seed.website,
    catalogUrl: seed.website, businessStatus: 'Doğrulandı',
    note: `${date}: kullanıcı listesinden eklendi. Türkiye perakende satışı, ürün fiyatı/gramajı/stoku marka bazında doğrulandı. Satış kaynağı KahhveCom; bu satıcı ayrı işletme olarak eklenmedi. Kanıt: ${dir}/${seed.slug}.json.`});
  const audited = applyPriceRules(records.map(record => ({business: seed.business,
    product: record.productName, grams: record.grams, price: record.price, sourceMethod: 'KahhveCom marka kataloğu API'}))).rows;
  for (const [index, record] of records.entries()) {
    const product = store.upsertProduct(roaster, record);
    // Keep the retailer URL explicitly: it is different from a future official
    // brand site, and the price belongs to this sale channel.
    product.url = record.url;
    const variant = store.upsertVariant(product, record);
    if (audited[index].quarantined) quarantined++;
    store.recordObservation(variant, audited[index].quarantined ? {...record, price: null} : record,
      runId, 'KahhveCom marka kataloğu API');
  }
  store.roasterHealth.push({runId, roasterSlug: seed.business, rows: records.length,
    deltaPct: null, flagged: false, error: null});
}
if (quarantined) throw new Error(`${quarantined} fiyat inceleme gerektiriyor; veri kaydedilmedi`);
const totalRows = collected.reduce((sum, entry) => sum + entry.records.length, 0);
store.scrapeRuns.push({runId, startedAt: checkedAt, finishedAt: new Date().toISOString(),
  businesses: seeds.length, totalRows, totalChanged: totalRows, errors: 0,
  scope: '11 kullanıcı onaylı kahve markası; satıcı ayrı işletme olarak eklenmedi'});
store.save();
await fs.writeFile('data/manual_roasters.json', JSON.stringify(manual, null, 2) + '\n');
const summary = {checkedAt, added: seeds.length, totalRows, quarantined, before, after: store.stats(),
  excludedBusiness: 'KahhveCom', businesses: collected.map(({seed, records, sampleVerification}) => ({
    business: seed.business, catalogUrl: seed.website, products: records.length,
    inStock: records.filter(record => record.inStock === true).length,
    outOfStock: records.filter(record => record.inStock === false).length, sampleVerification
  }))};
await fs.writeFile(`${dir}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
await fs.mkdir(`reports/discovery-${date}`, {recursive: true});
const md = `# 12 Ekim 2026: 11 kahve markası eklendi\n\n${seeds.length} marka ve ${totalRows} ürün/paket kaydı eklendi. KahhveCom işletme listesine eklenmedi; marka katalogları satış/fiyat kaynağı olarak kullanıldı. Kaynaklar resmî marka mağazası olarak etiketlenmedi. Şehirler tahmin edilmedi. Kapsül, ekipman ve gramajı belirsiz ürünler alınmadı. Tükenen ürünler stok durumu ile korundu. Her markadan bir örnek ürünün sayfa fiyatı ve markası canlı doğrulandı. Günlük tarama aynı marka bağlantısını kullanır.\n\n| Marka | Ürün/paket | Stokta | Tükendi | Katalog |\n|---|---:|---:|---:|---|\n${summary.businesses.map(entry => `| ${entry.business} | ${entry.products} | ${entry.inStock} | ${entry.outOfStock} | [kaynak](${entry.catalogUrl}) |`).join('\n')}\n\nHam API verisi ve örnek sayfa doğrulamaları: source/discovery-${date}/.\n`;
await fs.writeFile(`reports/discovery-${date}/added-brands.md`, md);
console.log(JSON.stringify({added: summary.added, totalRows, before, after: summary.after}, null, 2));
