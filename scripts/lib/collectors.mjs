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
  const unitGrams = parseGrams(`${name} ${description} ${weightOptions}`);
  const bundle = name.match(/\b(\d+)\s*\+\s*(\d+)\b/);
  const bundledGrams = bundle && unitGrams
    ? (Number(bundle[1]) + Number(bundle[2])) * unitGrams : unitGrams;
  return {
    platform: 'html-meta', host: hostOf(pageUrl),
    platformProductId: metaContent(html, 'product:retailer_item_id') || null,
    platformVariantId: null, urlPath: pathOf(pageUrl), url: pageUrl,
    productName: name, variantTitle: '',
    grams: bundledGrams && bundledGrams <= 6000 ? bundledGrams : unitGrams,
    optionSignature: optionSignature(`${name} ${weightOptions}`),
    price, listPrice: null,
    inStock: availabilityToBool(metaContent(html, 'product:availability')),
    currency: metaContent(html, 'product:price:currency') || 'TRY',
    productType: null, descriptionText: description.slice(0, 400)
  };
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
        records.push({
          platform: 'shopify',
          host,
          platformProductId: String(product.id),
          platformVariantId: variant ? String(variant.id) : null,
          urlPath,
          url,
          productName: clean(product.title),
          variantTitle: clean(variantTitle),
          grams: parseGrams(`${variantTitle} ${product.title}`),
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
              grams: parseGrams(`${name} ${description}`),
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

/* ------------------------------------------------------------- otomatik seçim */

/** Siteyi yoklar, hangi platformda olduğunu tespit eder ve uygun toplayıcıyı çalıştırır. */
export async function collectSite(origin) {
  const attempts = [
    ['shopify', () => collectShopify(origin)],
    ['woocommerce', () => collectWoo(origin)],
    ['ikas', () => collectIkas(origin)],
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
