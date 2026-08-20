/**
 * Platform toplayıcıları — kalıcı kimlik yakalayan sürüm.
 *
 * Eski scraper'lardan üç farkı var:
 *   1. platformProductId / platformVariantId saklanıyor (kimliğin tek dayanağı).
 *   2. SAYFALAMA yapılıyor. Eski kod Shopify'da yalnızca ilk 250 ürünü alıyordu;
 *      17 Ağustos denetiminde Montag'ın 33 → 254 ürüne sıçramasının sebebi bu.
 *   3. Stokta olmayan varyantlar ATILMIYOR, `inStock:false` olarak kaydediliyor.
 *      Stok çıkışı fiyat geçmişinin bir parçasıdır; satırı silmek geçmişi bozar.
 */
import { hostOf, pathOf, parseGrams, optionSignature, gramsFromWeightAttribute } from './identity.mjs';
import { extractJsonLdNodes, productNodesFrom, offersOf, toNumber, availabilityToBool, NON_PRODUCT_PATH, NON_PAGE_EXT } from './jsonld.mjs';

const USER_AGENT = process.env.SCRAPER_UA
  || 'CekirdekBulBot/1.0 (+https://cekirdekbul.com/bot; fiyat endeksi)';

const clean = (value) => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:nbsp|amp|quot|#\d+);/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

async function request(url, { type = 'json', timeout = 15000 } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: type === 'json' ? 'application/json' : 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  if (type !== 'json') return response.text();

  // JSON beklenen uçtan HTML dönmesi genelde bot koruması/yönlendirme
  // sayfasıdır (Shopify/Cloudflare vb.). Ham JSON.parse hatası ("Unexpected
  // token '<'") anlaşılmaz olduğu için burada erken ve açık bir mesaj veriyoruz.
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
    throw new Error(looksLikeHtml
      ? 'JSON yerine HTML döndü (muhtemelen bot koruması/yönlendirme)'
      : `JSON ayrıştırılamadı: ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }
}

const num = (value) => {
  const parsed = Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const packageGrams = (text) => {
  const unitGrams = parseGrams(text);
  const value = String(text || '');
  const plusBundle = value.match(/\b(\d+)\s*\+\s*(\d+)\b/);
  const countBundle = value.match(/\b(\d+)\s*(?:adet|x|×)\s*\d+(?:[.,]\d+)?\s*(?:kg|kilo|g|gr|gram)\b/i);
  const multiplier = plusBundle
    ? Number(plusBundle[1]) + Number(plusBundle[2])
    : countBundle ? Number(countBundle[1]) : 1;
  const total = unitGrams ? multiplier * unitGrams : unitGrams;
  return total && total <= 6000 ? total : unitGrams;
};

const sitemapLocs = (xml) => [...String(xml || '').matchAll(/<loc>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/loc>/gi)]
  .map((match) => match[1].replace(/&amp;/g, '&').trim())
  .filter(Boolean);

const PRODUCT_SITEMAP = /product|urun|store|shop|catalog|kahve/i;
const PRODUCT_PAGE = /\/(?:products?|urun(?:ler)?|magaza|shop|kahve(?:ler)?|coffee)(?:\/|[-_])/i;
const COFFEE_PAGE = /kahve|coffee|espresso|filtre|filter|ethiopia|etiyopya|colombia|kolombiya|kenya|brazil|brezilya/i;
const EQUIPMENT_PAGE = /ekipman|equipment|bardak|kupa|mug|dripper|tarti|scale|kettle|server|aksesuar|accessor/i;

/** Ürün olma ihtimali yüksek URL'leri sitemap sırasından önce değerlendirir. */
export function rankCatalogUrls(urls) {
  const unique = [...new Set(urls)];
  const hasTurkishLocale = unique.some((url) => {
    try { return /^\/tr(?:\/|$)/i.test(new URL(url).pathname); } catch { return false; }
  });
  return unique
    .filter((url) => {
      if (!hasTurkishLocale) return true;
      try { return !/^\/en(?:\/|$)/i.test(new URL(url).pathname); } catch { return false; }
    })
    .filter((url) => !NON_PRODUCT_PATH.test(url) && !NON_PAGE_EXT.test(url))
    .map((url, index) => {
      try {
        const pathname = new URL(url).pathname;
        const score = (PRODUCT_PAGE.test(pathname) ? 2 : 0)
          + (COFFEE_PAGE.test(pathname) ? 2 : 0)
          - (EQUIPMENT_PAGE.test(pathname) ? 2 : 0);
        return { url, index, score };
      }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ url }) => url);
}

async function discoverCatalogUrls(origin, { maxSitemaps = 12 } = {}) {
  const discovered = [];
  for (const sitemapPath of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    try {
      const xml = await request(`${origin}${sitemapPath}`, { type: 'html' });
      const locs = sitemapLocs(xml);
      if (!/<sitemapindex/i.test(xml)) {
        discovered.push(...locs);
        if (locs.length) break;
        continue;
      }

      const likely = locs.filter((url) => PRODUCT_SITEMAP.test(url));
      const children = (likely.length ? likely : locs).slice(0, maxSitemaps);
      const urls = [];
      for (const child of children) {
        try {
          urls.push(...sitemapLocs(await request(child, { type: 'html' })));
        } catch { /* bozuk/engelli alt sitemap atlandı */ }
      }
      if (urls.length) {
        discovered.push(...urls);
        break;
      }
    } catch { /* bu sitemap yolu yok, sıradakini dene */ }
  }

  // Bazı özel mağazalar ürün sitemap'i yayınlamıyor ama ana sayfada ürün
  // kartlarının gerçek bağlantıları bulunuyor. Yalnızca aynı host içindeki
  // bağlantılar eklenir; dış reklam/sosyal medya URL'leri taranmaz.
  try {
    const homepage = await request(origin, { type: 'html' });
    const host = hostOf(origin);
    for (const match of homepage.matchAll(/href=["']([^"'#]+)["']/gi)) {
      try {
        const url = new URL(match[1].replace(/&amp;/g, '&'), origin).href;
        if (hostOf(url) === host) discovered.push(url);
      } catch { /* geçersiz href */ }
    }
  } catch { /* sitemap çalışıyorsa ana sayfa hatası kritik değil */ }

  return rankCatalogUrls(discovered);
}

const metaContent = (html, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i');
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, 'i');
  return clean(html.match(first)?.[1] || html.match(reversed)?.[1] || '');
};

/**
 * JSON-LD sunmayan mağazalarda schema.org mikroveri / OpenGraph ürün
 * meta alanlarını okur. Fiyat yalnızca açıkça ürün fiyatı olarak etiketli
 * alandan alınır; HTML gövdesindeki rastgele TL sayıları asla kullanılmaz.
 */
export function productFromHtmlMeta(html, pageUrl) {
  const price = toNumber(metaContent(html, 'product:price:amount') || metaContent(html, 'price'));
  if (price === null) return null;
  const name = metaContent(html, 'og:title')
    || clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if (!name) return null;
  const description = metaContent(html, 'og:description') || metaContent(html, 'description');
  const attributeWeights = [...String(html).matchAll(/(?:value|data-value|aria-label)=["']([^"']*(?:\d{2,4}\s*(?:g|gr|gram)|\d+(?:[.,]\d+)?\s*kg)[^"']*)["']/gi)]
    .map((match) => match[1]).join(' ');
  // Next/React mağazaları varyantı HTML özniteliği yerine sayfaya gömülü
  // JSON içinde tutabiliyor. Yalnızca mevcut URL slug'ına ait ürün nesnesinin
  // yakınındaki gram alanı okunur; global öneri listesindeki ağırlıklar alınmaz.
  const slug = pathOf(pageUrl).split('/').filter(Boolean).pop() || '';
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const embeddedWeight = String(html).match(new RegExp(
    `\\\\?"slug(?:Tr|En)?\\\\?":\\\\?"${escapedSlug}\\\\?"[\\s\\S]{0,8000}?\\\\?"gram\\\\?":\\\\?"([^"\\\\]+)`, 'i'
  ))?.[1] || '';
  const weightOptions = `${attributeWeights} ${embeddedWeight}`;
  return {
    platform: 'html-meta', host: hostOf(pageUrl),
    platformProductId: metaContent(html, 'product:retailer_item_id') || null,
    platformVariantId: null, urlPath: pathOf(pageUrl), url: pageUrl,
    productName: name, variantTitle: '',
    grams: packageGrams(`${name} ${description} ${weightOptions}`),
    optionSignature: optionSignature(`${name} ${weightOptions}`),
    price, listPrice: null,
    inStock: availabilityToBool(metaContent(html, 'product:availability')),
    currency: metaContent(html, 'product:price:currency') || 'TRY',
    productType: null, descriptionText: description.slice(0, 400)
  };
}

/* ------------------------------------------------------------------ Ticimax */

/** Sayfadaki `var productDetailModel = {...}` nesnesini güvenle ayırır. */
export function extractTicimaxModel(html) {
  const source = String(html || '');
  const marker = 'var productDetailModel = ';
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = jsonStart; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(jsonStart, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function ticimaxRecordsFromModel(model, pageUrl) {
  if (!model?.productId || !model?.productName || !Array.isArray(model.products)) return [];
  const attributesByVariant = new Map();
  for (const attribute of model.productVariantData || []) {
    if (!attribute?.urunID) continue;
    if (!attributesByVariant.has(attribute.urunID)) attributesByVariant.set(attribute.urunID, []);
    attributesByVariant.get(attribute.urunID).push(attribute);
  }

  const candidates = model.products
    .filter((variant) => variant?.aktif !== false)
    .map((variant) => {
      const attributes = attributesByVariant.get(variant.id) || [];
      const weight = attributes.find((item) => /gramaj|miktar|weight|a[gğ]ırlık/i.test(item.ekSecenekTipiTanim || ''));
      const grind = attributes.find((item) => /öğüt|ogut|grind/i.test(item.ekSecenekTipiTanim || ''));
      const grams = packageGrams(`${weight?.tanim || ''} ${variant.stokKodu || ''} ${model.productName}`);
      const price = num(variant.urunSepetFiyatiStr || variant.urunFiyatiOrjinalStr)
        || (num(variant.urunSepetFiyati) && Math.round(num(variant.urunSepetFiyati) * (1 + Number(variant.kdvOrani || 0) / 100) * 100) / 100);
      const listPrice = num(variant.satisFiyatiStr);
      const grindLabel = clean(grind?.tanim || '');
      return {
        platform: 'ticimax', host: hostOf(pageUrl),
        platformProductId: String(model.productId), platformVariantId: String(variant.id),
        urlPath: pathOf(pageUrl), url: pageUrl,
        productName: clean(model.productName),
        variantTitle: clean([weight?.tanim, grindLabel].filter(Boolean).join(' — ')),
        grams, optionSignature: optionSignature(grindLabel),
        price, listPrice: listPrice && price && listPrice > price ? listPrice : null,
        inStock: Number(variant.stokAdedi) > 0,
        currency: variant.paraBirimiKodu || variant.paraBirimi || 'TRY',
        productType: model.productType || null,
        descriptionText: clean(model.productShortDescription).slice(0, 400),
        representativeScore: /çekirdek|cekirdek|whole bean/i.test(grindLabel) ? 1 : 0
      };
    })
    .filter((record) => record.price !== null);

  // Öğütme fiyatı değiştirmiyorsa aynı gramaj/fiyat için onlarca eş kayıt
  // üretme. Varsa çekirdek varyantı, yoksa ilk aktif varyant temsilci olur.
  const byOffer = new Map();
  for (const record of candidates) {
    const key = `${record.grams ?? ''}|${record.price}`;
    const previous = byOffer.get(key);
    if (!previous || record.representativeScore > previous.representativeScore) byOffer.set(key, record);
  }
  return [...byOffer.values()].map(({ representativeScore, ...record }) => record);
}

export async function collectTicimax(origin, { maxPages = 250, concurrency = 6 } = {}) {
  const homepage = await request(origin, { type: 'html' });
  if (!/ticimax/i.test(homepage)) throw new Error('Ticimax imzası bulunamadı');
  const urls = (await discoverCatalogUrls(origin)).slice(0, maxPages);
  const records = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < urls.length) {
      const pageUrl = urls[cursor++];
      try {
        const model = extractTicimaxModel(await request(pageUrl, { type: 'html' }));
        records.push(...ticimaxRecordsFromModel(model, pageUrl));
      } catch { /* tek ürün sayfası kataloğu bozmamalı */ }
    }
  }));
  return records;
}

/* ------------------------------------------------------------------ Shopify */

export async function collectShopify(origin, { maxPages = 20 } = {}) {
  const host = hostOf(origin);
  const records = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await request(`${origin}/products.json?limit=250&page=${page}`);
    const products = payload?.products || [];
    if (!products.length) break;

    for (const product of products) {
      const urlPath = `/products/${product.handle}`;
      const url = `${origin}${urlPath}`;
      const context = `${product.title} ${product.product_type || ''} ${(product.tags || []).join(' ')}`;
      const variants = product.variants?.length ? product.variants : [null];

      for (const variant of variants) {
        const variantTitle = variant?.title && variant.title !== 'Default Title' ? variant.title : '';
        // Shopify `grams` alanını gram cinsinden standartlaştırır. Bazı
        // mağazalarda paket ağırlığı ürün/varyant adında hiç yazmaz (gerçek
        // vaka: Zümrüt Karaca — varyant adı yalnızca "Çekirdek", ağırlık 250
        // ise sadece variant.grams alanında). Başlıktaki açık gramaj öncelikli
        // kalır; böylece hatalı kargo ağırlığı, ör. adı "1 kg" olan ürünü
        // yanlışlıkla 250 g yapamaz.
        const titleGrams = parseGrams(`${variantTitle} ${product.title}`);
        const shopifyGrams = Number(variant?.grams);
        records.push({
          platform: 'shopify',
          host,
          platformProductId: String(product.id),
          platformVariantId: variant ? String(variant.id) : null,
          urlPath,
          url,
          productName: clean(product.title),
          variantTitle: clean(variantTitle),
          grams: titleGrams ?? (Number.isFinite(shopifyGrams) && shopifyGrams >= 50 && shopifyGrams <= 6000
            ? Math.round(shopifyGrams) : null),
          optionSignature: optionSignature(`${variantTitle} ${context}`),
          price: variant ? num(variant.price) : null,
          listPrice: variant ? num(variant.compare_at_price) : null,
          inStock: variant ? variant.available !== false : null,
          currency: 'TRY',
          productType: product.product_type || null,
          descriptionText: clean(product.body_html).slice(0, 400)
        });
      }
    }
    if (products.length < 250) break;
  }
  return records;
}

/* -------------------------------------------------------------- WooCommerce */

const wooPrice = (prices, value) => {
  const minor = Number(prices?.currency_minor_unit ?? 2);
  return value === undefined || value === null || value === '' ? null : Number(value) / (10 ** minor);
};

export async function collectWoo(origin, { maxPages = 20, variationConcurrency = 5 } = {}) {
  const host = hostOf(origin);
  const records = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await request(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(payload) || !payload.length) break;

    // Değişken (variable) ürünlerde gramaj/öğütme gibi seçenekler WooCommerce
    // "attribute" sisteminde tutulur, ürün ADINDA DEĞİL — ana listedeki kayıt
    // bu yüzden grams'ı hiç içermeyebilir. Gerçek vaka: bir kavurucunun 14
    // gerçek kahve ürününün TAMAMI "Miktar: 250 Gr / 1000 Gr" seçeneğiyle
    // satılıyordu ama parseGrams(product.name) hep null dönüyor, ürünler o
    // yüzden sitede hiç görünmüyordu (bkz. GRAMS_MIN/MAX — ana listede grams
    // yoksa varyant sessizce dışarıda kalıyordu). Değişken ürünün HER
    // varyasyonunu kendi fiyatı + gramaj etiketiyle ayrı ayrı çekiyoruz;
    // Store API varyasyonları da normal bir "product" kaynağı gibi sunuyor
    // (GET /products/{varyasyonId}), o yüzden ekstra bir uç nokta gerekmiyor.
    const variableProducts = payload.filter((p) => p.type === 'variable' && Array.isArray(p.variations) && p.variations.length);
    const otherProducts = payload.filter((p) => !variableProducts.includes(p));

    for (const product of otherProducts) {
      const context = `${product.name} ${(product.categories || []).map((c) => c.name).join(' ')}`;
      records.push({
        platform: 'woocommerce',
        host,
        platformProductId: String(product.id),
        platformVariantId: null,
        urlPath: pathOf(product.permalink),
        url: product.permalink,
        productName: clean(product.name),
        variantTitle: '',
        grams: parseGrams(product.name),
        optionSignature: optionSignature(context),
        price: wooPrice(product.prices, product.prices?.price),
        listPrice: wooPrice(product.prices, product.prices?.regular_price),
        inStock: product.is_in_stock !== false,
        currency: product.prices?.currency_code || 'TRY',
        productType: (product.categories || []).map((c) => c.name).join(' / ') || null,
        descriptionText: clean(product.short_description || product.description).slice(0, 400)
      });
    }

    // Her varyasyonun ham `attributes` dizisi (ör. [{name:'Gramaj', value:'500'}])
    // ana ürünün listesindeki `variations[]` girdisinde geliyor — tekil
    // varyasyon uç noktası (`/products/{id}`) bunu boş döndürüyor, o yüzden
    // burada, listeden, yanımıza alıyoruz.
    const variationTasks = variableProducts.flatMap((product) => product.variations.map((v) => ({ product, variationId: v.id, rawAttributes: v.attributes })));
    let cursor = 0;
    await Promise.all(Array.from({ length: variationConcurrency }, async () => {
      while (cursor < variationTasks.length) {
        const { product, variationId, rawAttributes } = variationTasks[cursor];
        cursor += 1;
        try {
          const v = await request(`${origin}/wp-json/wc/store/v1/products/${variationId}`);
          const label = v.variation || ''; // ör. "Miktar: 250 Gr" — WooCommerce'in hazır insan-okunur özeti
          const context = `${label} ${product.name} ${(product.categories || []).map((c) => c.name).join(' ')}`;
          // Bazı mağazalar gramajı birimsiz saklıyor (ör. "Gramaj: 1000") —
          // parseGrams birim arayan bir regex kullandığı için bunu kaçırır;
          // bu durumda ham özniteliğe (ör. [{name:'Gramaj', value:'1000'}])
          // düşüyoruz (bkz. gramsFromWeightAttribute).
          const grams = parseGrams(`${label} ${product.name}`) ?? gramsFromWeightAttribute(rawAttributes);
          records.push({
            platform: 'woocommerce',
            host,
            platformProductId: String(product.id),
            platformVariantId: String(variationId),
            urlPath: pathOf(product.permalink),
            url: v.permalink || product.permalink,
            productName: clean(product.name),
            variantTitle: clean(label),
            grams,
            optionSignature: optionSignature(context),
            price: wooPrice(v.prices, v.prices?.price),
            listPrice: wooPrice(v.prices, v.prices?.regular_price),
            inStock: v.is_in_stock !== false,
            currency: v.prices?.currency_code || 'TRY',
            productType: (product.categories || []).map((c) => c.name).join(' / ') || null,
            descriptionText: clean(product.short_description || product.description).slice(0, 400)
          });
        } catch { /* varyasyon çekilemedi (kaldırılmış/erişilemez olabilir) — atla */ }
      }
    }));

    if (payload.length < 100) break;
  }
  return records;
}

/* --------------------------------------------------------------------- ikas */

/** ikas Next.js gömülü verisinden ürünü çıkarır. */
function nextData(html) {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

const isProductShape = (node) => !!(node && typeof node === 'object' && node.id && node.name && Array.isArray(node.variants));

// Bir ürün sayfasının Next.js veri ağacında sayfanın kendi ürününün YANINDA
// "önerilen ürün / birlikte alınır" gibi site-geneli widget'lar da bulunabilir.
// Bu widget'lar her sayfada aynı ürünü taşıdığı için, isim tabanlı arama onları
// sayfanın kendi ürünüyle karıştırıp tüm siteyi tek kimliğe düşürebilir
// (theflavour.com.tr'de 125 sayfa → 1 kimlik olarak yaşandı). Bu yüzden:
//   1) tekil "product" alanına öncelik veriyoruz,
//   2) birden fazla "ürün gibi" öğe taşıyan dizileri (= liste widget'ı) hiç
//      taramıyoruz.
const WIDGET_KEY = /^(related|recommended|suggested|crossSell|upSell|upsell|bundle|similar|alternative)/i;

function findProduct(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return null;

  if (Array.isArray(node)) {
    if (node.filter(isProductShape).length > 1) return null; // liste widget'ı, atla
    for (const item of node) {
      const found = findProduct(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (isProductShape(node.product)) return node.product;
  if (isProductShape(node)) return node;

  for (const [key, value] of Object.entries(node)) {
    if (WIDGET_KEY.test(key)) continue;
    const found = findProduct(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function collectIkasProduct(pageUrl) {
  const html = await request(pageUrl, { type: 'html' });
  const product = findProduct(nextData(html)?.props);
  if (!product) return [];

  const host = hostOf(pageUrl);
  const urlPath = pathOf(pageUrl);
  return (product.variants || []).map((variant) => {
    const values = (variant.variantValues || []).map((value) => value.name).join(' ');
    const stockCount = Number(variant.stock ?? (variant.stocks || [])
      .reduce((sum, item) => sum + Number(item.stockCount || 0), 0));
    return {
      platform: 'ikas',
      host,
      platformProductId: String(product.id),
      platformVariantId: String(variant.id),
      urlPath,
      url: `${pageUrl}?vid=${variant.id}`,
      productName: clean(product.name),
      variantTitle: clean(values),
      grams: parseGrams(`${values} ${product.name}`),
      optionSignature: optionSignature(`${values} ${product.name}`),
      price: num(variant.prices?.[0]?.sellPrice ?? variant.price),
      listPrice: num(variant.prices?.[0]?.buyPrice ?? null),
      inStock: variant.isActive !== false && (stockCount > 0 || variant.sellIfOutOfStock === true),
      currency: 'TRY',
      productType: (product.categories || []).map((c) => c.name).join(' / ') || null,
      descriptionText: clean(product.description).slice(0, 400)
    };
  });
}

export async function collectIkas(origin, { maxProducts = 400 } = {}) {
  const xml = await request(`${origin}/products.xml`, { type: 'html' });
  const urls = [...xml.matchAll(/<loc>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, '&'))
    .slice(0, maxProducts);

  const records = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      try { records.push(...await collectIkasProduct(urls[index])); } catch { /* sayfa atlandı */ }
    }
  }));
  return records;
}

/* ------------------------------------------------------------ JSON-LD (fallback) */

/**
 * Shopify/Woo/ikas API'si olmayan siteler için son çare: sitemap'i gez,
 * her sayfadaki schema.org Product/Offer JSON-LD'sini oku.
 *
 * BİLEREK yapılmayan şey: HTML gövdesinde "₺"/"TL" geçen sayıları regex ile
 * avlamak. Bu yöntem eski scraper'da sahte fiyatların %79'unun kaynağıydı
 * (bkz. price-rules.mjs üstündeki not). Sadece yapısal Offer.price alanına
 * güveniliyor; JSON-LD yoksa o sayfadan hiç fiyat üretilmiyor — "yanlış
 * fiyat"tan "fiyat yok" her zaman daha iyidir.
 */
export async function collectJsonLdSite(origin, { maxPages = 150, concurrency = 5 } = {}) {
  const host = hostOf(origin);
  const urls = (await discoverCatalogUrls(origin)).slice(0, maxPages);

  const records = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      const pageUrl = urls[index];
      try {
        const html = await request(pageUrl, { type: 'html' });
        const products = productNodesFrom(extractJsonLdNodes(html));

        // Bir ürün sayfasında BİRDEN FAZLA JSON-LD Product bloğu bulunabilir:
        // asıl ürün + "benzer ürünler / birlikte alınır" widget'ı. İkincisini
        // de işlemek gerçek bir hataya yol açtı — savenecoffee.shop'ta bir
        // sayfadaki widget öğesi ana ürünle AYNI jenerik SKU'yu ("SKU-KAHVE-
        // MAKINESI") paylaşıyordu, ikisi tek kimliğe çöküp fiyat gözlemi
        // 19000 ↔ 2739 arasında zıplayan sahte bir seri üretti. Sayfadaki
        // İLK Product bloğunu asıl ürün kabul edip gerisini atlıyoruz — aynı
        // ikas düzeltmesindeki mantık. Widget'taki ürün gerçekse zaten
        // kendi sayfasında, sitemap taramasıyla ayrıca ziyaret edilecek.
        const product = products[0];
        const name = product ? clean(product.name) : '';
        if (product && name) {
          const offers = offersOf(product);
          const platformProductId = product.sku || product.productID || product.mpn || null;
          const description = clean(product.description);

          offers.forEach((offer, offerIndex) => {
            const price = toNumber(offer.price);
            if (price === null) return; // fiyatsız Offer'ı kaydetmenin anlamı yok
            records.push({
              platform: 'jsonld',
              host,
              platformProductId: platformProductId ? String(platformProductId) : null,
              platformVariantId: offer.sku ? String(offer.sku) : (offers.length > 1 ? `off-${offerIndex}` : null),
              urlPath: pathOf(pageUrl),
              url: pageUrl,
              productName: name,
              variantTitle: '',
              grams: packageGrams(`${name} ${description}`),
              optionSignature: optionSignature(name),
              price,
              listPrice: null,
              inStock: availabilityToBool(offer.availability),
              currency: offer.priceCurrency || 'TRY',
              productType: null,
              descriptionText: description.slice(0, 400)
            });
          });
        }
      } catch { /* sayfa atlandı — çekilemedi ya da JSON-LD yok */ }
    }
  }));

  return records;
}

export async function collectHtmlMetaSite(origin, { maxPages = 150, concurrency = 5 } = {}) {
  const urls = (await discoverCatalogUrls(origin)).slice(0, maxPages);
  const records = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < urls.length) {
      const pageUrl = urls[cursor++];
      try {
        const record = productFromHtmlMeta(await request(pageUrl, { type: 'html' }), pageUrl);
        if (record) records.push(record);
      } catch { /* tek sayfa hatası tüm kataloğu bozmamalı */ }
    }
  }));
  return records;
}

/* ------------------------------------------------------------------- Wix */

/** Wix'in SSR sırasında sayfaya koyduğu mağaza ürünlerini bulur. */
export function extractWixProducts(html) {
  const match = String(html || '').match(/<script[^>]*id=["']wix-warmup-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const root = JSON.parse(match[1]);
    const stack = [root];
    const visited = new Set();
    const products = [];
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      if (value.id && value.name && Array.isArray(value.options)
        && Array.isArray(value.productItems) && Number.isFinite(Number(value.price))) {
        products.push(value);
      }
      stack.push(...Object.values(value));
    }
    return products;
  } catch {
    return [];
  }
}

export function wixRecordsFromProducts(products, origin) {
  const host = hostOf(origin);
  const records = [];
  for (const product of products) {
    if (product.isInStock === false) continue;
    const name = clean(product.name);
    if (!name) continue;
    const weightOption = product.options.find((option) =>
      /ağırlık|agirlik|gramaj|paket|size|weight/i.test(`${option.title || ''} ${option.key || ''}`));
    const weightBySelection = new Map((weightOption?.selections || [])
      .map((selection) => [String(selection.id), packageGrams(selection.value || selection.description || selection.key || '')])
      .filter(([, grams]) => grams));
    const urlPart = clean(product.urlPart || product.slug || '');
    const url = urlPart ? new URL(`/product-page/${urlPart}`, origin).href : origin;
    const base = {
      platform: 'wix', host,
      platformProductId: String(product.id),
      urlPath: pathOf(url), url,
      productName: name,
      productType: product.productType || null,
      descriptionText: clean(product.description).slice(0, 400),
      currency: product.currency || 'TRY'
    };

    // Wix her öğütüm biçimi için ayrı varyant üretir. Aynı gramaj/fiyattan
    // yalnızca bir kayıt tutup mümkünse çekirdek seçeneğini tercih ediyoruz.
    const grouped = new Map();
    for (const item of product.productItems) {
      if (item.isVisible === false || item.inventory?.status === 'out_of_stock') continue;
      const selections = (item.optionsSelections || []).map(String);
      const weightId = selections.find((id) => weightBySelection.has(id));
      const grams = weightBySelection.get(weightId);
      const price = num(item.price);
      if (!grams || !price) continue;
      const optionValues = product.options.flatMap((option) => (option.selections || [])
        .filter((selection) => selections.includes(String(selection.id)))
        .map((selection) => clean(selection.value || selection.description || selection.key)));
      const variantTitle = optionValues.join(' / ');
      const score = /çekirdek|cekirdek|whole bean/i.test(variantTitle) ? 2 : 1;
      const key = `${grams}|${price}`;
      if (!grouped.has(key) || grouped.get(key).score < score) {
        grouped.set(key, { score, record: {
          ...base,
          platformVariantId: String(item.id),
          variantTitle,
          grams,
          optionSignature: optionSignature(variantTitle),
          price,
          listPrice: num(item.comparePrice) > price ? num(item.comparePrice) : null,
          inStock: item.inventory?.status !== 'out_of_stock'
        } });
      }
    }
    records.push(...[...grouped.values()].map(({ record }) => record));

    // Wix kategori modelinde seçili/varsayılan varyant bazen productItems'tan
    // çıkarılıp yalnızca ana product.price olarak veriliyor. Bu, MeetLab'de
    // 250 g varsayılanı listeden kaybederken 1 kg varyantını bırakıyordu.
    // Ana fiyatı yalnızca ilk gramaj seçimi henüz üretilmediyse ekliyoruz.
    const firstWeight = [...weightBySelection.entries()][0];
    const representedGrams = new Set([...grouped.values()].map(({ record }) => record.grams));
    if (firstWeight && !representedGrams.has(firstWeight[1])) {
      const [selectionId, grams] = firstWeight;
      const price = num(product.price);
      if (grams && price) records.push({
        ...base, platformVariantId: `base-${selectionId}`, variantTitle: '', grams,
        optionSignature: optionSignature(name), price,
        listPrice: num(product.comparePrice) > price ? num(product.comparePrice) : null,
        inStock: product.isInStock !== false
      });
    }
  }
  return records;
}

export async function collectWix(origin) {
  const homepage = await request(origin, { type: 'html' });
  const candidates = new Set([origin]);
  for (const match of homepage.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), origin);
      if (hostOf(url.href) === hostOf(origin)
        && /kahve|coffee|shop|store|magaza|mağaza|products?|urun|ürün/i.test(url.pathname)) candidates.add(url.href);
    } catch { /* geçersiz bağlantı */ }
  }

  const ranked = [...candidates].sort((a, b) => {
    const pathA = pathOf(a), pathB = pathOf(b);
    const score = (path) => (/product-page/i.test(path) ? -2 : 0)
      + (/kahveler|coffees?|shop|store|magaza|mağaza|products?|urunler|ürünler/i.test(path) ? 2 : 0);
    return score(pathB) - score(pathA);
  });
  const byId = new Map();
  for (const url of ranked.slice(0, 30)) {
    try {
      const found = extractWixProducts(url === origin ? homepage : await request(url, { type: 'html' }));
      for (const product of found) {
        byId.set(String(product.id), product);
      }
      // Kategori sayfasında birden fazla ürün bulunduysa bu sayfanın warmup
      // modeli mevcut kataloğun tamamını taşır; eski sitemap sayfalarını
      // dolaşmak hem yavaş hem de gereksizdir.
      if (found.length > 1) break;
    } catch { /* tek katalog sayfası hatası diğerlerini engellemez */ }
  }
  return wixRecordsFromProducts([...byId.values()], origin);
}

/* -------------------------------------------------------------- Enjekte */

/** Enjekte mağaza kategori HTML'indeki ürün/varyant kartlarını ayrıştırır. */
export function enjekteRecordsFromHtml(html, pageUrl) {
  const host = hostOf(pageUrl);
  const chunks = String(html || '').split(/<div class=["']products-lists["']>/i).slice(1);
  const records = [];

  for (const chunk of chunks) {
    const productId = chunk.match(/class=["']variantprices\s+variantprices(\d+)["']/i)?.[1];
    const href = chunk.match(/<a[^>]+class=["']image["'][^>]+href=["']([^"']+)["']/i)?.[1];
    const name = clean(chunk.match(/<div class=["']name["']>([\s\S]*?)<\/div>/i)?.[1]);
    if (!productId || !href || !name) continue;

    const url = new URL(href.replace(/&amp;/g, '&'), pageUrl).href;
    const priceByVariant = new Map();
    for (const match of chunk.matchAll(/<div class=["']variantprice(?:\s+active)?["'][^>]*id=["']variantprice(\d+)["'][^>]*>[\s\S]*?<div class=["']price["']>[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<samp>([^<]+)<\/samp>/gi)) {
      const major = num(match[2]);
      const cents = Number(clean(match[3]));
      const price = major && Number.isFinite(cents) ? major + cents / 100 : major;
      if (price > 0) priceByVariant.set(match[1], price);
    }

    const options = [...chunk.matchAll(/<option[^>]+value=["']?(\d+)["']?[^>]*>([\s\S]*?)<\/option>/gi)]
      .map((match) => ({ id: match[1], label: clean(match[2]) }));
    for (const option of options) {
      const price = priceByVariant.get(option.id);
      const grams = packageGrams(option.label);
      if (!price || !grams) continue;
      records.push({
        platform: 'enjekte', host,
        platformProductId: productId, platformVariantId: option.id,
        urlPath: pathOf(url), url, productName: name, variantTitle: option.label,
        grams, optionSignature: optionSignature(option.label), price, listPrice: null,
        inStock: true, currency: 'TRY', productType: null, descriptionText: ''
      });
    }
  }
  return records;
}

export async function collectEnjekte(origin) {
  for (const url of [`${origin}/kahve`, origin]) {
    const html = await request(url, { type: 'html' });
    if (!/products-lists|variantprices\d+/i.test(html)) continue;
    const records = enjekteRecordsFromHtml(html, url);
    if (records.length) return records;
  }
  return [];
}

/* ------------------------------------------------------------- otomatik seçim */

/** Siteyi yoklar, hangi platformda olduğunu tespit eder ve uygun toplayıcıyı çalıştırır. */
export async function collectSite(origin) {
  const attempts = [
    ['shopify', () => collectShopify(origin)],
    ['woocommerce', () => collectWoo(origin)],
    ['ikas', () => collectIkas(origin)],
    ['ticimax', () => collectTicimax(origin)],
    ['wix', () => collectWix(origin)],
    ['enjekte', () => collectEnjekte(origin)],
    ['jsonld', () => collectJsonLdSite(origin)],
    ['html-meta', () => collectHtmlMetaSite(origin)]
  ];
  const errors = [];
  for (const [platform, run] of attempts) {
    try {
      const records = await run();
      if (records.length) return { platform, records, error: null, errors };
    } catch (error) {
      errors.push(`${platform}: ${error.message}`);
    }
  }
  return { platform: null, records: [], error: errors.join(' | ') || 'desteklenen platform bulunamadı', errors };
}
