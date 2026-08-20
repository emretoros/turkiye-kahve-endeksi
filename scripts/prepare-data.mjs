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
 * tutuldu, üstüne yalnızca `variantId` eklendi — app.js bu alanla fiyat
 * geçmişini `public/data/price_history.json`'dan eşleştiriyor (bkz. altta).
 * Kavurucu/menşe detay sayfaları hâlâ ayrı bir adımda gelecek.
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
  ikas: 'ikas canlı ürün varyantı', jsonld: 'JSON-LD (schema.org)',
  'html-meta': 'HTML ürün mikroverisi (schema.org/OpenGraph)'
};
// jsonld sayfa-taramasıyla geldiği için Shopify/Woo/ikas API'sine göre bir
// tık daha az güvenilir sayılıyor (widget/related-ürün karışması riski
// koddan giderildi ama yapısal API kadar sağlam değil).
const CONFIDENCE_BY_PLATFORM = {
  shopify: 'Yüksek', woocommerce: 'Yüksek', ikas: 'Yüksek',
  jsonld: 'Orta', 'html-meta': 'Orta'
};

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

function pushPlaceholder(roaster, note) {
  if (placeholderSeen.has(roaster.id)) return;
  placeholderSeen.add(roaster.id);
  rows.push({
    business: roaster.name, city: roaster.city || null, businessStatus: roaster.status,
    product: 'Ürün kataloğu — ayrıntılı ürün verisine erişilemedi',
    origin: 'Erişilemedi', grams: null, price: null, previousPrice: null, pricePerKg: null,
    stock: 'Erişilemedi', productType: 'Katalog/takip kaydı', variantId: null,
    url: roaster.website || null,
    sourceMethod: 'Otomatik tarama — yapısal veri yok',
    confidence: 'Takip gerekli', catalogStatus: 'Katalog takip kaydı',
    note, aliases: [], instagram: roaster.instagram || null, discoveryChannels: [], checkedAt: runDate
  });
}

for (const roaster of roasters) {
  const isPlaceholder = roaster.dataStatus && roaster.dataStatus !== 'active';
  if (isPlaceholder) {
    pushPlaceholder(roaster, DATA_STATUS_NOTE[roaster.dataStatus] || roaster.dataStatusNote || null);
    continue;
  }

  const rowsBefore = rows.length;
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
      const grams = Number.isFinite(variant.grams) && variant.grams > 0 ? variant.grams : null;

      // Site "sadece çekirdek/öğütülmüş kahve fiyatı" göstermeyi hedefliyor:
      // paket gramajı bilinmeyen bir varyantın fiyatı hiçbir şekilde
      // karşılaştırılabilir değildir. Pratikte bu satırların ezici
      // çoğunluğu zaten kahve değil — ekipman (değirmen, makine), ev eşyası
      // (fincan/tepsi/lokumluk), toptan koli/palet, eğitim/danışmanlık ya da
      // kafe menü kalemi. Az sayıda gerçek numune paketi (ör. "5x50 g deneme
      // seti") da bu filtreyle düşer; bilinçli bir tercih — yanlış/karşılaş-
      // tırılamaz fiyat göstermektense hiç göstermemek bu projenin baştan
      // beri izlediği ilke (bkz. price-rules.mjs).
      if (grams === null) {
        excluded.push({ business: roaster.name, product: product.name, exclusionReason: 'Gramaj bilgisi yok (paket fiyatı karşılaştırılamıyor)' });
        continue;
      }

      const label = variant.label && !isWeightOnlyLabel(variant.label)
        ? `${product.name} — ${variant.label}` : product.name;
      const price = Number.isFinite(variant.lastPrice) && variant.lastPrice > 0 ? variant.lastPrice : null;
      const previousPrice = previousPriceFor(variant.id);

      rows.push({
        business: roaster.name, city: roaster.city || null, businessStatus: roaster.status,
        product: label, origin, grams, price, previousPrice,
        pricePerKg: grams && price ? Math.round((price / grams) * 100000) / 100 : null,
        stock: variant.lastInStock === true ? 'Stokta' : variant.lastInStock === false ? 'Tükendi' : 'Belirsiz',
        productType, variantId: variant.id, url,
        sourceMethod: SOURCE_LABEL[product.platform] || product.platform || 'Bilinmiyor',
        confidence: CONFIDENCE_BY_PLATFORM[product.platform] || 'Orta',
        catalogStatus: 'Ürün kaydı', note: null,
        aliases: [], instagram: roaster.instagram || null, discoveryChannels: [], checkedAt: runDate
      });
    }
  }

  // Site aktif olarak tarandı ama gramaj/kahve filtrelerinden geçen HİÇBİR
  // ürün kalmadıysa (ör. yalnızca kafe menüsü, ekipman ya da toptan koli
  // satıyor) işletme sessizce kaybolmasın — dürüstçe takip kaydına düşsün.
  if (rows.length === rowsBefore) {
    pushPlaceholder(roaster, 'Sitede paket gramajıyla karşılaştırılabilir bir çekirdek/öğütülmüş kahve ürünü bulunamadı.');
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

/* ------------------------------------------------------------ fiyat geçmişi */

// Yalnızca yayında GÖRÜNEN varyantlar için geçmiş üretiliyor (elenen/karantina
// ürünler için geçmiş yayınlamanın anlamı yok). Kompakt [tarih, fiyat] çiftleri
// — obje anahtarları tekrar tekrar yazılmasın diye. Karantinaya alınmış/negatif
// fiyatlı gözlemler zaten price:null olarak yazıldığından burada elenir.
const priceHistory = {};
for (const row of cleaned) {
  if (row.variantId == null) continue;
  const history = historyByVariant.get(row.variantId) || [];
  const points = history
    .filter((obs) => Number.isFinite(obs.price) && obs.price > 0)
    .map((obs) => [obs.observedAt, obs.price]);
  if (points.length) priceHistory[row.variantId] = points;
}
await fs.writeFile(path.join(publicData, 'price_history.json'), JSON.stringify(priceHistory));

console.log(JSON.stringify(metadata, null, 2));
console.log(`Fiyat geçmişi: ${Object.keys(priceHistory).length} varyant için kayıt var.`);
