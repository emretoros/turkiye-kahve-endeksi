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
import { hostOf, pathOf, parseGrams, optionSignature } from './identity.mjs';
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

export async function collectWoo(origin, { maxPages = 20 } = {}) {
  const host = hostOf(origin);
  const records = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await request(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(payload) || !payload.length) break;

    for (const product of payload) {
      const minor = Number(product.prices?.currency_minor_unit ?? 2);
      const toPrice = (value) => value === undefined || value === null || value === ''
        ? null
        : Number(value) / (10 ** minor);
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
        price: toPrice(product.prices?.price),
        listPrice: toPrice(product.prices?.regular_price),
        inStock: product.is_in_stock !== false,
        currency: product.prices?.currency_code || 'TRY',
        productType: (product.categories || []).map((c) => c.name).join(' / ') || null,
        descriptionText: clean(product.short_description || product.description).slice(0, 400),
        variationIds: (product.variations || []).map((v) => String(v.id ?? v))
      });
    }
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
  let urls = [];

  for (const sitemapPath of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    try {
      const xml = await request(`${origin}${sitemapPath}`, { type: 'html' });
      const locs = [...xml.matchAll(/<loc>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/loc>/gi)]
        .map((match) => match[1].replace(/&amp;/g, '&'));
      if (/<sitemapindex/i.test(xml)) {
        const children = locs.filter((url) => /product|urun|post/i.test(url)).slice(0, 4);
        for (const child of children) {
          try {
            const childXml = await request(child, { type: 'html' });
            urls.push(...[...childXml.matchAll(/<loc>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/loc>/gi)]
              .map((match) => match[1].replace(/&amp;/g, '&')));
          } catch { /* alt sitemap atlandı */ }
        }
      } else {
        urls.push(...locs);
      }
      if (urls.length) break;
    } catch { /* bu sitemap yolu yok, sıradakini dene */ }
  }

  urls = [...new Set(urls)]
    .filter((url) => !NON_PRODUCT_PATH.test(url) && !NON_PAGE_EXT.test(url))
    .slice(0, maxPages);

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
        for (const product of products) {
          const name = clean(product.name);
          if (!name) continue;
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

/* ------------------------------------------------------------- otomatik seçim */

/** Siteyi yoklar, hangi platformda olduğunu tespit eder ve uygun toplayıcıyı çalıştırır. */
export async function collectSite(origin) {
  const attempts = [
    ['shopify', () => collectShopify(origin)],
    ['woocommerce', () => collectWoo(origin)],
    ['ikas', () => collectIkas(origin)],
    ['jsonld', () => collectJsonLdSite(origin)]
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
