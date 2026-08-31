/**
 * Kalıcı kimlik deposu — JSON/NDJSON tabanlı.
 *
 * SQLite yerine düz dosya seçildi: Node'un yerleşik `node:sqlite` modülü
 * hâlâ sürüme göre deneysel/bayraklı olabiliyor ve bu Windows makinesinde
 * derleme aracı gerektiren native modül (better-sqlite3 vb.) riske girmeye
 * değmez. Bu depo aynı şemayı JSON dosyalarında tutar; ölçek (192 işletme,
 * yılda ~1M gözlem) düz dosya için sorun değil. İleride tek satırlık bir
 * betikle SQLite'a taşınabilir — şema (id alanları, foreign key mantığı)
 * bilerek SQL'e birebir eşlenecek şekilde tasarlandı.
 *
 * Dosyalar:
 *   data/roasters.json           — işletmeler
 *   data/products.json           — ürünler (roasterId'ye bağlı)
 *   data/variants.json           — varyantlar (productId'ye bağlı)
 *   data/price_observations.ndjson — yalnızca DEĞİŞİMDE satır eklenir
 *   data/scrape_runs.json        — her koşunun özeti
 *   data/roaster_health.json     — koşu başına işletme sağlık durumu
 */
import fs from 'node:fs';
import path from 'node:path';
import { variantKey, productKey } from './identity.mjs';

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });

  const jsonPath = (name) => path.join(dataDir, `${name}.json`);
  const load = (name, fallback) => {
    const file = jsonPath(name);
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };

  const roasters = load('roasters', []);
  const products = load('products', []);
  const variants = load('variants', []);
  const scrapeRuns = load('scrape_runs', []);
  const roasterHealth = load('roaster_health', []);

  // Hızlı erişim için indeksler.
  const roasterBySlug = new Map(roasters.map((r) => [r.slug, r]));
  const productByKey = new Map(products.map((p) => [p.identityKey, p]));
  const variantByKey = new Map(variants.map((v) => [v.identityKey, v]));

  let nextRoasterId = 1 + Math.max(0, ...roasters.map((r) => r.id));
  let nextProductId = 1 + Math.max(0, ...products.map((p) => p.id));
  let nextVariantId = 1 + Math.max(0, ...variants.map((v) => v.id));

  const slugify = (value) => String(value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `isletme-${nextRoasterId}`;

  function upsertRoaster({ business, city, businessStatus, website, instagram, platform }) {
    let slug = slugify(business);
    let roaster = roasterBySlug.get(slug);
    if (!roaster) {
      roaster = {
        id: nextRoasterId++, slug, name: business, city: city || null,
        status: businessStatus || null, website: website || null, instagram: instagram || null,
        platform: platform || null, firstSeen: today(), lastSeen: today()
      };
      roasters.push(roaster);
      roasterBySlug.set(slug, roaster);
    } else {
      roaster.lastSeen = today();
      if (website && !roaster.website) roaster.website = website;
      if (platform && !roaster.platform) roaster.platform = platform;
    }
    return roaster;
  }

  function upsertProduct(roaster, record) {
    const { key } = productKey({ ...record, host: record.host || roaster.website });
    let product = productByKey.get(key);
    if (!product) {
      product = {
        id: nextProductId++, roasterId: roaster.id, identityKey: key,
        platform: record.platform || null, platformProductId: record.platformProductId || null,
        urlPath: record.urlPath || null, name: record.productName, firstSeen: today(), lastSeen: today(),
        status: 'active'
      };
      products.push(product);
      productByKey.set(key, product);
    } else {
      product.lastSeen = today();
      product.status = 'active';
      if (record.productName) product.name = record.productName; // ad değişse de kimlik sabit kalır
    }
    return product;
  }

  function upsertVariant(product, record) {
    const { key } = variantKey({ ...record, host: record.host });
    let variant = variantByKey.get(key);
    if (!variant) {
      variant = {
        id: nextVariantId++, productId: product.id, identityKey: key,
        platformVariantId: record.platformVariantId || null, url: record.url || null,
        grams: record.grams ?? null,
        optionSignature: record.optionSignature || '', label: record.variantTitle || '',
        firstSeen: today(), lastSeen: today(), isActive: true,
        lastPrice: null, lastListPrice: null, lastInStock: null
      };
      variants.push(variant);
      variantByKey.set(key, variant);
    } else {
      variant.lastSeen = today();
      variant.isActive = true;
      // Ayrıştırıcı sonradan iyileştirildiğinde önceden boş kalmış sabit
      // kimlikli varyant alanlarını zenginleştir. Kimlik ve fiyat geçmişi
      // korunur; yalnızca eksik metadata, yeni taramadaki doğrulanmış değerle
      // doldurulur (gerçek vaka: Zümrüt Karaca Shopify variant.grams).
      if (variant.grams == null && Number.isFinite(record.grams) && record.grams > 0) {
        variant.grams = record.grams;
      }
      // Platformlar varyantı seçili açan bağlantılar döndürebilir (ör. ikas
      // `?vid=...`, Shopify `?variant=...`). Ürün ana sayfasına düşüp yanlış
      // fiyatı göstermemek için en son doğrulanan varyant URL'sini koru.
      if (record.url) variant.url = record.url;
      if (!variant.optionSignature && record.optionSignature) variant.optionSignature = record.optionSignature;
      if (!variant.label && record.variantTitle) variant.label = record.variantTitle;
    }
    return variant;
  }

  /** Fiyat/stok bir öncekinden farklıysa true döner ve observation yazılmalıdır. */
  function hasChanged(variant, record) {
    if (variant.lastPrice === null && variant.lastInStock === null) return true; // ilk gözlem
    return variant.lastPrice !== (record.price ?? null)
      || variant.lastInStock !== (record.inStock ?? null)
      || variant.lastListPrice !== (record.listPrice ?? null);
  }

  const observationLines = [];
  function recordObservation(variant, record, runId, sourceMethod) {
    const changed = hasChanged(variant, record);
    if (changed) {
      observationLines.push(JSON.stringify({
        variantId: variant.id, runId, observedAt: today(),
        price: record.price ?? null, listPrice: record.listPrice ?? null,
        inStock: record.inStock ?? null, sourceMethod, quarantined: false
      }));
      variant.lastPrice = record.price ?? null;
      variant.lastListPrice = record.listPrice ?? null;
      variant.lastInStock = record.inStock ?? null;
    }
    return changed;
  }

  function today() { return new Date(process.env.RUN_DATE_ISO || Date.now()).toISOString().slice(0, 10); }

  function save() {
    fs.writeFileSync(jsonPath('roasters'), JSON.stringify(roasters, null, 2));
    fs.writeFileSync(jsonPath('products'), JSON.stringify(products, null, 2));
    fs.writeFileSync(jsonPath('variants'), JSON.stringify(variants, null, 2));
    fs.writeFileSync(jsonPath('scrape_runs'), JSON.stringify(scrapeRuns, null, 2));
    fs.writeFileSync(jsonPath('roaster_health'), JSON.stringify(roasterHealth, null, 2));
    if (observationLines.length) {
      fs.appendFileSync(path.join(dataDir, 'price_observations.ndjson'), observationLines.join('\n') + '\n');
      observationLines.length = 0;
    }
  }

  return {
    roasters, products, variants, scrapeRuns, roasterHealth,
    upsertRoaster, upsertProduct, upsertVariant, recordObservation, save,
    stats: () => ({ roasters: roasters.length, products: products.length, variants: variants.length })
  };
}
