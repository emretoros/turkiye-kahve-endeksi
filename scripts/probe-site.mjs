/**
 * Tek bir siteyi yoklar ve kimlik yakalamanın çalıştığını doğrular.
 *
 *   node scripts/probe-site.mjs https://www.goodcoffee.com.tr
 *
 * Mevcut source/broad_products.json'daki aynı işletmeyle karşılaştırır ki
 * yeni toplayıcının ne kadar fazla varyant gördüğü ölçülebilsin.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectSite } from './lib/collectors.mjs';
import { variantKey, hostOf } from './lib/identity.mjs';

const origin = process.argv[2];
if (!origin) {
  console.error('kullanım: node scripts/probe-site.mjs <site-kökü>');
  process.exit(1);
}

const started = Date.now();
const { platform, records, error } = await collectSite(origin.replace(/\/+$/, ''));

if (error && !records.length) {
  console.log(JSON.stringify({ origin, platform, error }, null, 2));
  process.exit(0);
}

const keys = records.map((record) => variantKey(record));
const tier1 = keys.filter((key) => key.tier === 1).length;
const unique = new Set(keys.map((key) => key.key)).size;

// Mevcut veriyle karşılaştır.
let baseline = 0;
try {
  const root = path.resolve(import.meta.dirname, '..');
  const rows = JSON.parse(await fs.readFile(path.join(root, 'source', 'broad_products.json'), 'utf8'));
  const host = hostOf(origin);
  baseline = rows.filter((row) => hostOf(row.url || '') === host).length;
} catch { /* kaynak yoksa karşılaştırma atlanır */ }

console.log(JSON.stringify({
  origin,
  platform,
  sure_sn: Math.round((Date.now() - started) / 1000),
  toplanan_varyant: records.length,
  benzersiz_kimlik: unique,
  platform_kimligi_olan: tier1,
  kimlik_kapsama: `%${(100 * tier1 / Math.max(1, records.length)).toFixed(1)}`,
  gramaji_olan: records.filter((record) => record.grams).length,
  fiyati_olan: records.filter((record) => record.price).length,
  stokta_olmayan: records.filter((record) => record.inStock === false).length,
  mevcut_veride: baseline,
  ornek: records.slice(0, 3).map((record) => ({
    urun: record.productName,
    varyant: record.variantTitle,
    gramaj: record.grams,
    fiyat: record.price,
    stok: record.inStock,
    kimlik: variantKey(record).key
  }))
}, null, 2));
