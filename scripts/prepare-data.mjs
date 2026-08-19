/**
 * data/ deposundan (roasters.json + products.json + variants.json +
 * price_observations.ndjson) public/data/products.json ve metadata.json
 * üretir. site build zincirinin bir parçası ("npm run data").
 *
 * Eski prepare-data.mjs source/broad_products.json (tek seferlik, düz liste)
 * okuyordu. Bu sürüm kalıcı kimlik deposunu okur:
 *   - Ürün/varyant kimliği zaten collect-identity.mjs'te sabitlendi, burada
 *     TEKRAR dedupe/eşleştirme YAPILMIYOR (eski identityGroups mantığı
 *     kaldırıldı — artık gereksiz, hatta zararlı olurdu).
 *   - "Bir önceki fiyat" price_observations.ndjson geçmişinden hesaplanır
 *     (varyantın son iki gözlemi).
 *   - Web sitesi taranamayan/veri vermeyen işletmeler ("no_website",
 *     "no_structured_data", "blocked", "unreachable") SESSİZCE atılmıyor;
 *     eski davranışla aynı şekilde "Katalog takip kaydı" satırı olarak
 *     dürüstçe gösteriliyor.
 *   - Kahve dışı ürünler (ekipman, çay, çikolata vb.) ve menşe/ürün tipi
 *     tahmini scripts/lib/catalog.mjs'e taşındı.
 *
 * Çıktı şeması (public/data/products.json alanları) BİLEREK eskiyle aynı
 * tutuldu — app.js ve index.astro değişmeden çalışsın diye. Ekipman kısmı
 * (kavurucu/menşe sayfaları, fiyat geçmişi grafiği) ayrı bir adımda gelecek.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { exclusionReason, guessOrigin, guessProductType, isWeightOnlyLabel } from './lib/catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, 'data');
const publicData = path.join(root, 'public', 'data');
await fs.mkdir(publicData, { recursive: true });

async function readJson(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), 'utf8'));
  } catch {
    return fallback;
  }
}

const roasters = await readJson('roasters', []);
const products = await readJson('products', []);
const variants = await readJson('variants', []);
const scrapeRuns = await readJson('scrape_runs', []);

if (!roasters.length) {
  console.error('data/roasters.json boş ya da bulunamadı — önce scripts/collect-identity.mjs çalıştırılmalı.');
  process.exitCode = 1;
}

/* --------------------------------------------------------- gözlem geçmişi */

// Yalnızca "bir önceki fiyat" göstergesi için: varyant başına gözlem
// dizisini kronolojik sırayla tutuyoruz (dosyaya ekleme sırası = zaman
// sırası, store.mjs sadece değişimde satır eklediği için).
let observationsRaw = '';
try {
  observationsRaw = await fs.readFile(path.join(dataDir, 'price_observations.ndjson'), 'utf8');
} catch { /* henüz hiç koşu yapılmamış olabilir */ }

const historyByVariant = new Map();
for (const line of observationsRaw.split('\n')) {
  if (!line.trim()) continue;
  let obs;
  try { obs = JSON.parse(line); } catch { continue; }
  if (!historyByVariant.has(obs.variantId)) historyByVariant.set(obs.variantId, []);
  historyByVariant.get(obs.variantId).push(obs);
}

function previousPriceFor(variantId) {
  const history = historyByVariant.get(variantId);
  if (!history || history.length < 2) return null; // ilk gözlem — karşılaştıracak bir şey yok
  const prev = history[history.length - 2].price;
  return Number.isFinite(prev) && prev > 0 ? prev : null;
}

/* ------------------------------------------------------------------ tarih */

const runDate = scrapeRuns.length
  ? scrapeRuns[scrapeRuns.length - 1].finishedAt.slice(0, 10)
  : new Date().toISOString().slice(0, 10);

// Bir varyant en son koşudan çok önce görüldüyse (site değişmiş/ürün
// kaldırılmış olabilir) listede eski fiyatla "canlıymış gibi" görünmesin.
// Haftalık koşu ritmine göre bir kaçırılan koşuya tolerans + pay: 21 gün.
const STALE_DAYS = 21;
const staleCutoff = new Date(`${runDate}T00:00:00Z`);
staleCutoff.setUTCDate(staleCutoff.getUTCDate() - STALE_DAYS);
const isFresh = (dateStr) => !!dateStr && new Date(`${dateStr}T00:00:00Z`) >= staleCutoff;

/* ------------------------------------------------------------------ indeks */

const productsByRoaster = new Map();
for (const product of products) {
  if (!productsByRoaster.has(product.roasterId)) productsByRoaster.set(product.roasterId, []);
  productsByRoaster.get(product.roasterId).push(product);
}
const variantsByProduct = new Map();
for (const variant of variants) {
  if (!variantsByProduct.has(variant.productId)) variantsByProduct.set(variant.productId, []);
  variantsByProduct.get(variant.productId).push(variant);
}

const SOURCE_LABEL = {
  shopify: 'Shopify ürün akışı', woocommerce: 'WooCommerce Store API',
  ikas: 'ikas canlı ürün varyantı', jsonld: 'JSON-LD (schema.org)'
};
// jsonld sayfa-taramasıyla geldiği için Shopify/Woo/ikas API'sine göre bir
// tık daha az güvenilir sayılıyor (widget/related-ürün karışması riski
// koddan giderildi ama yapısal API kadar sağlam değil).
const CONFIDENCE_BY_PLATFORM = { shopify: 'Yüksek', woocommerce: 'Yüksek', ikas: 'Yüksek', jsonld: 'Orta' };

// Yayın anı güvenlik ağı: price-rules.mjs'teki UNGRAMMED_PRICE_MAX ile AYNI
// eşik. collect-identity.mjs bu kural eklenmeden ÖNCE de veri toplamış
// olabilir (ör. depoda halihazırda duran bir espresso makinesi fiyatı) —
// burada tekrar uygulamak bir sonraki taramayı beklemeden temizler.
const UNGRAMMED_PRICE_MAX = 15000;

const DATA_STATUS_NOTE = {
  no_website: 'Kayıtlı web sitesi yok — sadece Instagram/takip kaydı.',
  no_structured_data: 'Sitede yapılandırılmış ürün verisi bulunamadı (Shopify/WooCommerce/ikas API\'si ya da JSON-LD yok).',
  blocked: 'Site bot korumasıyla erişimi engelliyor.',
  unreachable: 'Web sitesine ulaşılamadı (domain hatalı ya da geçici olarak kapalı olabilir).'
};

/* -------------------------------------------------------------------- satırlar */

const excluded = [];
const rows = [];
const placeholderSeen = new Set();

for (const roaster of roasters) {
  const isPlaceholder = roaster.dataStatus && roaster.dataStatus !== 'active';
  if (isPlaceholder) {
    if (placeholderSeen.has(roaster.id)) continue;
    placeholderSeen.add(roaster.id);
    rows.push({
      business: roaster.name, city: roaster.city || null, businessStatus: roaster.status,
      product: 'Ürün kataloğu — ayrıntılı ürün verisine erişilemedi',
      origin: 'Erişilemedi', grams: null, price: null, previousPrice: null, pricePerKg: null,
      stock: 'Erişilemedi', productType: 'Katalog/takip kaydı',
      url: roaster.website || null,
      sourceMethod: 'Otomatik tarama — yapısal veri yok',
      confidence: 'Takip gerekli', catalogStatus: 'Katalog takip kaydı',
      note: DATA_STATUS_NOTE[roaster.dataStatus] || roaster.dataStatusNote || null,
      aliases: [], instagram: roaster.instagram || null, discoveryChannels: [], checkedAt: runDate
    });
    continue;
  }

  const roasterProducts = productsByRoaster.get(roaster.id) || [];
  for (const product of roasterProducts) {
    const url = product.url
      || (roaster.website && product.urlPath ? `${roaster.website}${product.urlPath}` : (roaster.website || null));
    const reason = exclusionReason(`${product.name} ${url || ''}`);
    if (reason) {
      excluded.push({ business: roaster.name, product: product.name, exclusionReason: reason });
      continue;
    }

    const productVariants = (variantsByProduct.get(product.id) || [])
      .filter((v) => v.isActive && isFresh(v.lastSeen));
    if (!productVariants.length) continue;

    const origin = guessOrigin(product.name);
    const productType = guessProductType(product.name, origin);

    for (const variant of productVariants) {
      const label = variant.label && !isWeightOnlyLabel(variant.label)
        ? `${product.name} — ${variant.label}` : product.name;
      const grams = Number.isFinite(variant.grams) && variant.grams > 0 ? variant.grams : null;
      const rawPrice = Number.isFinite(variant.lastPrice) && variant.lastPrice > 0 ? variant.lastPrice : null;
      const price = rawPrice !== null && grams === null && rawPrice > UNGRAMMED_PRICE_MAX ? null : rawPrice;
      const previousPrice = previousPriceFor(variant.id);

      rows.push({
        business: roaster.name, city: roaster.city || null, businessStatus: roaster.status,
        product: label, origin, grams, price, previousPrice,
        pricePerKg: grams && price ? Math.round((price / grams) * 100000) / 100 : null,
        stock: variant.lastInStock === true ? 'Stokta' : variant.lastInStock === false ? 'Tükendi' : 'Belirsiz',
        productType, url,
        sourceMethod: SOURCE_LABEL[product.platform] || product.platform || 'Bilinmiyor',
        confidence: CONFIDENCE_BY_PLATFORM[product.platform] || 'Orta',
        catalogStatus: 'Ürün kaydı', note: null,
        aliases: [], instagram: roaster.instagram || null, discoveryChannels: [], checkedAt: runDate
      });
    }
  }
}

const cleaned = rows.map((row, index) => ({ id: index + 1, ...row }));

/* ------------------------------------------------------------------ metadata */

const businesses = [...new Set(cleaned.map((row) => row.business))].sort((a, b) => a.localeCompare(b, 'tr'));
const priceCompared = cleaned.filter((row) => row.previousPrice !== null && row.price !== null);
const priceChanges = priceCompared.reduce((counts, row) => {
  const status = row.price > row.previousPrice ? 'up' : row.price < row.previousPrice ? 'down' : 'same';
  counts[status] += 1;
  return counts;
}, { up: 0, same: 0, down: 0 });

const metadata = {
  checkedAt: runDate,
  priceComparisonCheckedAt: priceCompared.length ? runDate : null,
  priceComparedRows: priceCompared.length,
  priceComparedBusinesses: new Set(priceCompared.map((row) => row.business)).size,
  priceChanges,
  // Yeni modelde kimlik toplama anında (variantKey) sabitleniyor; burada
  // ayrıca bir dedupe adımı yok, o yüzden bu her zaman 0 — alan yalnızca
  // eski metadata şemasıyla uyum için tutuluyor.
  duplicateRowsRemoved: 0,
  totalRows: cleaned.length,
  excludedRows: excluded.length,
  exclusions: excluded.reduce((counts, row) => {
    counts[row.exclusionReason] = (counts[row.exclusionReason] || 0) + 1;
    return counts;
  }, {}),
  businesses: businesses.length,
  namedProducts: cleaned.filter((row) => row.catalogStatus === 'Ürün kaydı').length,
  trackingRecords: cleaned.filter((row) => row.catalogStatus === 'Katalog takip kaydı').length,
  origins: new Set(cleaned.map((row) => row.origin)).size
};

await fs.writeFile(path.join(publicData, 'products.json'), JSON.stringify(cleaned));
await fs.writeFile(path.join(publicData, 'metadata.json'), JSON.stringify(metadata, null, 2));

console.log(JSON.stringify(metadata, null, 2));
