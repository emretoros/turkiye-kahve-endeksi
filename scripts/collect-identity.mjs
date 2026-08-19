/**
 * 192 kavurucunun tamamı için kalıcı kimlik toplama koşusu.
 *
 * Kullanım:
 *   node scripts/collect-identity.mjs                 # tüm işletmeleri gez
 *   node scripts/collect-identity.mjs --only=10        # ilk 10 ile hızlı deneme
 *   node scripts/collect-identity.mjs --concurrency=4  # varsayılan 6
 *
 * Ne yapar:
 *   1. source/broad_products.json'dan işletme + temsilci URL listesi çıkarır
 *      (business_audit.json eski/eksik olduğu için ARTIK kaynak bu değil).
 *   2. Her işletmeyi collectSite ile tarar (Shopify/Woo/ikas otomatik seçim).
 *   3. Sonuçları data/ altındaki kalıcı depoya (store.mjs) yazar — kimlikler
 *      koşular arasında sabit kalır, fiyat/stok değişmeyen varyant için yeni
 *      gözlem satırı açılmaz.
 *   4. Fiyat karantina kurallarını gözlem üzerinde de uygular.
 *   5. Koşu sonunda sağlık raporu üretir: hangi işletmede satır sayısı önceki
 *      koşuya göre ciddi düştü (silent failure sinyali).
 *
 * ÖNEMLİ: Bu betik gerçek sitelere bağlanır, yalnızca ağa çıkabilen bir
 * makineden (senin bilgisayarın) çalıştırılmalı.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectSite } from './lib/collectors.mjs';
import { applyPriceRules } from './lib/price-rules.mjs';
import { openStore } from './lib/store.mjs';
import { hostOf } from './lib/identity.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, 'data');
const args = Object.fromEntries(process.argv.slice(2)
  .map((arg) => arg.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));

const concurrency = Number(args.concurrency || 6);
const onlyN = args.only ? Number(args.only) : Infinity;
const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;

/**
 * Sıfır satır dönen bir işletmenin NEDEN veri vermediğini kabaca sınıflar.
 * Amaç kesin tanı değil — siteye "fiyat takip edilemiyor" diye dürüst bir
 * etiket koyabilmek. Yanlış sınıflansa bile sonuç aynı: fiyat yayınlanmaz.
 */
function classifyOutcome(rowCount, errorText) {
  if (rowCount > 0) return 'active';
  const text = errorText || '';
  if (/403|bot koruması/i.test(text)) return 'blocked'; // erişim bilerek engelleniyor
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(text)) return 'unreachable'; // domain ölü/yanlış
  return 'no_structured_data'; // 404/503 vb. — bu platformları kullanmıyor ya da yapısal veri yok
}

/* --------------------------------------------------------- işletme listesi */

const rows = JSON.parse(await fs.readFile(path.join(root, 'source', 'broad_products.json'), 'utf8'));
const byBusiness = new Map();
for (const row of rows) {
  if (!byBusiness.has(row.business)) {
    byBusiness.set(row.business, {
      business: row.business, city: row.city, businessStatus: row.businessStatus,
      instagram: row.instagram, hostCounts: new Map()
    });
  }
  if (row.url) {
    const host = hostOf(row.url);
    if (host) {
      const entry = byBusiness.get(row.business);
      entry.hostCounts.set(host, (entry.hostCounts.get(host) || 0) + 1);
    }
  }
}

const businesses = [...byBusiness.values()].map((entry) => {
  const topHost = [...entry.hostCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { ...entry, website: topHost ? `https://${topHost}` : null };
}).slice(0, onlyN);

const withWebsite = businesses.filter((b) => b.website);
const withoutWebsite = businesses.filter((b) => !b.website);

console.log(JSON.stringify({
  runId, toplamIsletme: businesses.length, taranacak: withWebsite.length,
  urlYokSadeceTakip: withoutWebsite.length
}, null, 2));

/* -------------------------------------------------------------- toplama */

const store = openStore(dataDir);
const results = [];
let cursor = 0;

// Sonradan eklenip henüz sitesi taranamayanları da depoya kaydet (adres/takip amaçlı).
for (const business of withoutWebsite) {
  const roaster = store.upsertRoaster({
    business: business.business, city: business.city, businessStatus: business.businessStatus,
    website: null, instagram: business.instagram, platform: null
  });
  roaster.dataStatus = 'no_website';
  roaster.dataStatusNote = 'Kayıtlı web sitesi yok — sadece Instagram/takip kaydı';
}

async function worker() {
  while (cursor < withWebsite.length) {
    const index = cursor;
    cursor += 1;
    const business = withWebsite[index];
    const started = Date.now();
    try {
      const { platform, records, error } = await collectSite(business.website.replace(/\/+$/, ''));
      const roaster = store.upsertRoaster({
        business: business.business, city: business.city, businessStatus: business.businessStatus,
        website: business.website, instagram: business.instagram, platform
      });

      // Karantina kurallarını gözlem satırlarına da uygula.
      const priceLike = records.map((r) => ({
        business: business.business, product: r.productName, grams: r.grams,
        price: r.price, previousPrice: null, sourceMethod: platform || 'bilinmiyor'
      }));
      const { rows: audited } = applyPriceRules(priceLike);

      let changedCount = 0;
      records.forEach((record, i) => {
        const product = store.upsertProduct(roaster, record);
        const variant = store.upsertVariant(product, record);
        const clean = audited[i]?.quarantined ? { ...record, price: null } : record;
        if (store.recordObservation(variant, clean, runId, platform || 'bilinmiyor')) changedCount += 1;
      });

      roaster.dataStatus = classifyOutcome(records.length, error);
      roaster.dataStatusNote = records.length > 0 ? null : (error || null);

      results.push({
        business: business.business, website: business.website, platform,
        rows: records.length, changed: changedCount, quarantined: audited.filter((r) => r.quarantined).length,
        seconds: Math.round((Date.now() - started) / 1000), error
      });
    } catch (error) {
      // collectSite kendi içinde hataları yakalıyor; buraya düşmek beklenmez
      // ama düşerse işletmeyi yine de kayıtlı tutuyoruz (sessizce kaybolmasın).
      const roaster = store.upsertRoaster({
        business: business.business, city: business.city, businessStatus: business.businessStatus,
        website: business.website, instagram: business.instagram, platform: null
      });
      roaster.dataStatus = classifyOutcome(0, error.message);
      roaster.dataStatusNote = error.message;
      results.push({
        business: business.business, website: business.website, platform: null,
        rows: 0, changed: 0, quarantined: 0, seconds: Math.round((Date.now() - started) / 1000),
        error: error.message
      });
    }
    if (results.length % 10 === 0) {
      console.log(`… ${results.length}/${withWebsite.length} işletme tarandı`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

/* --------------------------------------------------------------- sağlık */

const previousRun = store.roasterHealth.filter((h) => h.runId !== runId);
const lastByRoaster = new Map();
for (const health of previousRun) lastByRoaster.set(health.roasterSlug, health);

const healthRows = results.map((result) => {
  const slug = result.business; // basit karşılaştırma; store içindeki gerçek slug'a gerek yok
  const previous = lastByRoaster.get(slug);
  const deltaPct = previous && previous.rows > 0 ? Math.round(100 * (result.rows - previous.rows) / previous.rows) : null;
  const flagged = result.error !== null || (deltaPct !== null && deltaPct <= -50) || (previous && result.rows === 0);
  return { runId, roasterSlug: slug, rows: result.rows, deltaPct, flagged, error: result.error };
});
store.roasterHealth.push(...healthRows);

store.scrapeRuns.push({
  runId, startedAt: new Date(Date.now() - results.reduce((s, r) => s + r.seconds * 1000, 0) / concurrency).toISOString(),
  finishedAt: new Date().toISOString(), businesses: withWebsite.length,
  totalRows: results.reduce((s, r) => s + r.rows, 0), totalChanged: results.reduce((s, r) => s + r.changed, 0),
  errors: results.filter((r) => r.error).length
});

store.save();

/* ----------------------------------------------------------------- rapor */

const flagged = healthRows.filter((h) => h.flagged);
const summary = {
  runId,
  taranan: withWebsite.length,
  toplamSatir: results.reduce((s, r) => s + r.rows, 0),
  toplamDegisim: results.reduce((s, r) => s + r.changed, 0),
  toplamKarantina: results.reduce((s, r) => s + r.quarantined, 0),
  hatali: results.filter((r) => r.error).length,
  bayrakli: flagged.length,
  depo: store.stats()
};
console.log(JSON.stringify(summary, null, 2));

// Sabit dosya adı: otomasyonda her koşu ayrı dosya biriktirmesin diye üzerine yazılır.
// Geçmiş koşu özetleri zaten store.scrapeRuns / store.roasterHealth içinde kalıcı olarak duruyor.
const reportPath = path.join(dataDir, 'run_report_latest.json');
await fs.writeFile(reportPath, JSON.stringify({ summary, results, flagged }, null, 2), 'utf8');
console.log(`Ayrıntılı rapor: ${path.relative(root, reportPath)}`);

if (flagged.length) {
  console.log('\n⚠ Bayraklı işletmeler (hata veya satır sayısında ciddi düşüş):');
  for (const item of flagged.slice(0, 20)) {
    console.log(`  - ${item.roasterSlug}: rows=${item.rows} delta=${item.deltaPct ?? '—'}% ${item.error || ''}`);
  }
}

/**
 * Sessiz bozulmaya karşı kaba bir sağlık kapısı.
 *
 * Amaç kesin bir eşik değil — "bilinen ~%35 bayraklı oranı" ile "her şey
 * bozuldu" arasını ayırt etmek. Otomasyonda (GitHub Actions) bu betik hata
 * koduyla çıkarsa, iş "başarısız" görünür ve depo sahibine varsayılan
 * GitHub e-posta bildirimi gider — ayrı bir izleme servisi kurmadan bedava
 * bir erken uyarı.
 */
const flaggedRatio = withWebsite.length ? flagged.length / withWebsite.length : 0;
if (withWebsite.length > 0 && (summary.toplamSatir === 0 || flaggedRatio > 0.6)) {
  console.error(`\n✗ SAĞLIK KONTROLÜ BAŞARISIZ: bayraklı oranı %${Math.round(flaggedRatio * 100)}, toplamSatir=${summary.toplamSatir}.`);
  console.error('Bu, bilinen ~%35 bayraklı oranının çok üzerinde — scraper genel olarak bozulmuş olabilir (site yapısı değişmiş, IP engellenmiş, vb.).');
  process.exitCode = 1;
}
