import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source/broad_products.json');
const auditPath = path.join(root, 'source/instagram_roaster_ingestion_2026-08-12.json');
const checkedAt = '2026-08-12';
const existing = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const businesses = [
  { business: 'ARC CO', city: 'İstanbul', aliases: ['arccoffee', 'arc coffee', 'arc co coffee', 'arccoffee.co'], instagram: 'https://www.instagram.com/arccoffee.co/', base: 'https://www.arccoffee.co/', platform: 'jsonld-sitemap', sitemap: 'https://www.arccoffee.co/sitemap.xml' },
  { business: 'Coffee Haus', city: 'Ankara', aliases: ['coffeehaus', 'coffee haus'], instagram: 'https://www.instagram.com/coffee_haus/', base: 'https://coffeehaus.com.tr/', platform: 'shopify' },
  { business: 'Atölye Kuban', city: 'İzmir', aliases: ['atolyekuban', 'atolye kuban'], instagram: 'https://www.instagram.com/atolyekuban/', base: 'https://atolyekuban.com/', platform: 'ikas', sitemap: 'https://atolyekuban.com/products.xml' },
  { business: 'The Flavour Coffee', city: 'Kayseri', aliases: ['the flavour coffee', 'theflavourcoffee'], instagram: 'https://www.instagram.com/theflavourcoffee/', base: 'https://theflavour.com.tr/', platform: 'ikas', sitemap: 'https://theflavour.com.tr/products.xml' },
  { business: 'Anisah Coffee', city: 'İstanbul', aliases: ['anisah coffee', 'anisahcoffee', 'anişah coffee'], instagram: 'https://www.instagram.com/anisahcoffee/', base: 'https://anisahcoffee.com/', platform: 'shopify' },
  { business: 'Bentz Coffee & Roastery', city: 'Ankara', aliases: ['bentz roastery', 'bentz coffee', 'bentzroastery'], instagram: 'https://www.instagram.com/bentzroastery/', base: 'https://bentz.com.tr/', platform: 'ikas', sitemap: 'https://bentz.com.tr/products.xml' },
  { business: 'Tenebrew', city: null, aliases: ['tenebrew', 'tenebrew coffee'], instagram: 'https://www.instagram.com/tenebrew/', base: 'https://tenebrew.com/', platform: 'ikas', sitemap: 'https://tenebrew.com/products.xml' },
  { business: 'Fluxus Coffee Roastery', city: 'Sakarya', aliases: ['fluxus coffee', 'fluxuscoffee'], instagram: 'https://www.instagram.com/fluxuscoffee/', base: 'https://fluxuscoffee.com/', platform: 'shopify' },
  { business: 'The Whirl Roastery', city: 'İstanbul', aliases: ['whirl coffee', 'the whirl coffee', 'thewhirl'], instagram: 'https://www.instagram.com/thewhirl/', base: 'https://shop.thewhirl.com.tr/', platform: 'whirl-sitemap', sitemap: 'https://shop.thewhirl.com.tr/sitemap.xml' },
  { business: 'Tetra N Roastery', city: 'Ankara', aliases: ['tetrancoffee', 'tetran coffee', 'tetranroastery', 'tetra n coffee'], instagram: 'https://www.instagram.com/tetranroastery/', base: 'https://tetranroastery.com/', platform: 'ikas', sitemap: 'https://tetranroastery.com/products.xml' },
  { business: 'Main Coffee', city: 'Ankara', aliases: ['maincoffee', 'main coffee', 'maincoffee.co'], instagram: 'https://www.instagram.com/maincoffee.co/', base: 'https://www.instagram.com/maincoffee.co/', platform: 'tracking', trackingStatus: 'Ankara’daki kafe doğrulandı; kendi kavurduğu paket kahvenin doğrudan B2C kataloğu henüz doğrulanamadı.', pendingScope: true }
];

const canonicalBusinessesAdded = businesses.filter(({ business }) => business !== 'Tetra N Roastery').length;
const coffeeSignal = /kahve|coffee|espresso|filtre|çekirdek|cekirdek|bean|decaf|blend|harman|ethiopia|etiyopya|colombia|kolombiya|brazil|brasil|brezilya|guatemala|kenya|peru|honduras|costa rica|kosta rika|el salvador|rwanda|ruanda|burundi|sumatra|indonesia|endonezya|nicaragua|panama|mexico|meksika|bolivia|bolivya/i;
const excluded = /ekipman|equipment|dripper|server|kupa|mug|fincan|cezve|ibrik|termos|tumbler|değirmen|ogutucu|öğütücü|grinder|filtre kağıdı|filtre kagidi|filter paper|aeropress|chemex|hario|kettle|tamper|bardak|matcha|çay|tea|çikolata|chocolate|lokum|draje|şurup|syrup|salep|frappe|milkshake|smoothie|püre|puree|sos|sauce|hibiskus|hibiscus|cool lime|kurabiye|cookie|granola|sabun|kolonya|mum|candle|t-shirt|tişört|tisort|hoodie|çanta|canta|şapka|sapka|\bpin\b|aksesuar|deri|lifestyle|sandviç|sandvic|pasta|kruvasan|croissant|eğitim|egitim|training|workshop|kahve turu|bookeasy|danışmanlık|danismanlik|yeşil çekirdek|yesil cekirdek|yeşil kahve|yesil kahve|green coffee|hindiba|chicory|promosyon kahve|kahve makinesi|coffee machine|makinesi|kağıdı|kagidi|pitcher|süt potu|sut potu|tartı|tarti|moka pot|syphon|sifon|ajanda|not defteri|kaşık|kasik|cupping|refraktometre|analizör|analizor|hardtank|difluid/i;
const headers = { 'user-agent': 'Mozilla/5.0 (compatible; CekirdekBul/1.0)' };

async function getText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

const getJson = async (url) => JSON.parse(await getText(url));

function decode(value = '') {
  return String(value)
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#039;|&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

const clean = (value = '') => decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function parsePrice(value) {
  if (typeof value === 'number') return value > 0 ? value : null;
  const normalized = String(value ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!normalized) return null;
  const parsed = normalized.includes(',')
    ? Number(normalized.replace(/\./g, '').replace(',', '.'))
    : Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function grams(value = '') {
  const raw = String(value).replace(/\+/g, ' ');
  let uriDecoded = raw;
  try { uriDecoded = decodeURIComponent(raw); } catch {}
  const normalized = uriDecoded.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g, ' ');
  const multipack = normalized.match(/(?:^|\D)(\d{1,2})\s*[x×*]\s*(\d{2,4})\s*[-_]?\s*(?:g|gr|gram)\b/i)
    || normalized.match(/(?:^|\D)(\d{2,4})\s*[-_]?\s*(?:g|gr|gram)\s*[x×*]\s*(\d{1,2})\b/i);
  if (multipack) return Number(multipack[1]) * Number(multipack[2]);
  const kg = normalized.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s*[-_]?\s*(?:kg|kilogram)\b/i);
  if (kg) return Math.round(Number(kg[1].replace(',', '.')) * 1000);
  const gram = normalized.match(/(?:^|\D)(\d{2,4})\s*[-_]?\s*(?:g|gr|gram)\b/i);
  return gram ? Number(gram[1]) : null;
}

function isBulk(value = '') {
  if (/\b(?:koli|palet|toptan)\b/i.test(value)) return true;
  const match = value.match(/(?:^|\D)(\d{1,2})\s*[x×*]\s*(\d{2,4})\s*(?:g|gr|gram)\b/i);
  return Boolean(match && Number(match[1]) >= 6 && Number(match[2]) >= 100);
}

const originPatterns = [
  ['Etiyopya', /ethiopia|etiyopya|ethopia/i], ['Kolombiya', /colombia|kolombiya/i],
  ['Brezilya', /brazil|brasil|brezilya/i], ['Guatemala', /guatemala|guetemala/i],
  ['Kenya', /kenya/i], ['Peru', /peru/i], ['Honduras', /honduras/i],
  ['Kosta Rika', /costa rica|kosta rika/i], ['El Salvador', /el salvador/i],
  ['Ruanda', /rwanda|ruanda/i], ['Burundi', /burundi/i],
  ['Endonezya', /indonesia|endonezya|sumatra/i], ['Nikaragua', /nicaragua|nikaragua/i],
  ['Panama', /panama/i], ['Meksika', /mexico|meksika/i], ['Bolivya', /bolivia|bolivya/i]
];

function origins(value = '') {
  return originPatterns
    .map(([label, pattern]) => ({ label, index: value.search(pattern) }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((match) => match.label);
}

function productOrigin(name = '', details = '') {
  const inName = origins(name);
  if (inName.length > 1) return 'Çoklu menşe';
  if (inName.length === 1) return inName[0];
  const inDetails = origins(details);
  if (/(?:blend|harman|set|tanışma|tanisma|tadım|tadim|deneme|paket)/i.test(name) && new Set(inDetails).size > 1) return 'Çoklu menşe';
  return inDetails[0] || 'Menşe belirtilmemiş';
}

function productType(value = '') {
  if (/türk kahvesi|turk kahvesi/i.test(value)) return 'Türk kahvesi';
  if (/kapsül|capsule/i.test(value)) return 'Kapsül kahve';
  if (/blend|harman/i.test(value)) return 'Harman';
  return 'Tek köken/ürün';
}

function validCoffee(identity, details = '') {
  const signal = coffeeSignal.test(identity)
    || (/(?:paket|set|abonelik)/i.test(identity) && coffeeSignal.test(details));
  return signal && !excluded.test(identity) && !isBulk(identity);
}

function row(meta, { name, details = '', gramsValue, price, stock = 'Stokta', url, method }) {
  const all = `${name} ${details}`;
  return {
    business: meta.business,
    city: meta.city,
    businessStatus: 'Doğrulandı',
    product: clean(name),
    origin: productOrigin(name, details),
    grams: gramsValue,
    price,
    stock,
    productType: productType(all),
    url,
    sourceMethod: method,
    confidence: gramsValue && price ? 'Yüksek' : price ? 'Orta' : 'Düşük',
    note: 'Resmî mağazanın canlı ürün kataloğundan çıkarıldı; kahve dışı ürünler elendi.',
    catalogStatus: 'Ürün kaydı',
    aliases: meta.aliases,
    instagram: meta.instagram || null,
    discoveryChannels: ['Instagram kullanıcı bildirimi', 'Resmî web mağazası'],
    checkedAt
  };
}

function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/loc>/gi)].map((match) => decode(match[1]).trim());
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function productNodes(html) {
  const products = [];
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some((type) => /Product/i.test(type || ''))) products.push(value);
    for (const child of Object.values(value)) walk(child);
  };
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(decode(match[1]))); } catch {}
  }
  return products;
}

function offerList(product) {
  const offers = product?.offers ?? product?.Offers;
  return Array.isArray(offers) ? offers : offers ? [offers] : [];
}

const offerAvailability = (offer) => String(offer?.availability ?? offer?.Availability ?? '');

function balancedArrays(html, marker = '"variants":') {
  const arrays = [];
  let from = 0;
  while (arrays.length < 12) {
    const markerIndex = html.indexOf(marker, from);
    if (markerIndex < 0) break;
    const start = html.indexOf('[', markerIndex + marker.length);
    if (start < 0) break;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (let index = start; index < html.length; index++) {
      const char = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '[') depth++;
      else if (char === ']' && --depth === 0) { end = index + 1; break; }
    }
    if (end <= start) break;
    try { arrays.push(JSON.parse(html.slice(start, end))); } catch {}
    from = end;
  }
  return arrays;
}

function nextPageProduct(html) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const pageProps = JSON.parse(match[1])?.props?.pageProps;
    return pageProps?.pageSpecificData || null;
  } catch { return null; }
}

function variantPrice(variant) {
  const prices = Array.isArray(variant?.prices) ? variant.prices : [];
  const item = prices.find((price) => price.priceListId == null && (price.currencyCode === 'TRY' || price.currency === 'TRY'))
    || prices.find((price) => price.priceListId == null)
    || prices.find((price) => price.currencyCode === 'TRY' || price.currency === 'TRY')
    || prices[0]
    || {};
  return parsePrice(item.discountPrice ?? item.campaignPrice ?? item.sellPrice ?? variant?.price?.sellPrice);
}

function genericJsonLdRows(meta, pageUrl, html, method) {
  const rows = [];
  for (const product of productNodes(html)) {
    const name = clean(product.name);
    const details = clean(product.description);
    const identity = `${name} ${new URL(pageUrl).pathname} ${product.category || ''}`;
    if (!name || !validCoffee(identity, details)) continue;
    const offers = offerList(product);
    const seen = new Set();
    for (const offer of offers.length ? offers : [{}]) {
      if (/OutOfStock/i.test(offerAvailability(offer))) continue;
      const price = parsePrice(offer.price ?? offer.lowPrice);
      const gramsValue = grams(`${name} ${pageUrl} ${product.sku || ''}`);
      const key = `${gramsValue}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row(meta, { name, details, gramsValue, price, url: offer.url || product.url || pageUrl, method }));
    }
  }
  return rows;
}

function whirlRows(meta, pageUrl, html) {
  if (!/\/alisveris\/urun\//i.test(new URL(pageUrl).pathname) || !/sepet\/ekle/i.test(html)) return [];
  const match = html.match(/window\.dataLayer\.push\((\{"event":"view_item"[\s\S]*?\})\);/i);
  if (!match) return [];
  let item;
  try {
    item = JSON.parse(match[1])?.ecommerce?.items?.[0];
  } catch {
    return [];
  }
  const title = clean((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const name = clean(item?.item_name || title.replace(/\s*\|[\s\S]*$/, ''));
  const details = clean(`${item?.item_category || ''} ${title}`);
  const identity = `${name} ${details} ${new URL(pageUrl).pathname}`;
  if (!name || !validCoffee(identity, details)) return [];
  const price = parsePrice(item?.price);
  const gramsValue = grams(identity);
  return [row(meta, {
    name,
    details,
    gramsValue,
    price,
    url: pageUrl,
    method: 'The Whirl canlı mağaza ürün verisi — Instagram keşfi'
  })];
}

function ikasRows(meta, pageUrl, html) {
  const jsonLdProduct = productNodes(html)[0];
  const product = nextPageProduct(html);
  if (!product && !jsonLdProduct) return [];
  const name = clean(product?.name || jsonLdProduct?.name);
  const details = clean(product?.description || jsonLdProduct?.description);
  const categories = (product?.categories || []).map((category) => `${category.name || ''} ${category.slug || ''}`).join(' ');
  const identity = `${name} ${new URL(pageUrl).pathname} ${categories}`;
  if (!name || !validCoffee(identity, details)) return [];

  const offers = offerList(jsonLdProduct);
  const offerById = new Map(offers.map((offer) => {
    try { return [new URL(offer.url).searchParams.get('vid'), offer]; } catch { return [null, offer]; }
  }).filter(([id]) => id));
  const variants = Array.isArray(product?.variants)
    ? product.variants
    : balancedArrays(html).flat().filter((variant) => variant?.id && offerById.has(variant.id));
  const grouped = new Map();

  for (const variant of variants) {
    const offer = offerById.get(variant.id);
    const stockCount = Number(variant.stock ?? (variant.stocks || []).reduce((sum, item) => sum + Number(item.stockCount || 0), 0));
    const inStock = stockCount > 0 || variant.sellIfOutOfStock === true || /InStock/i.test(offerAvailability(offer));
    if (variant.isActive === false || !inStock || /OutOfStock/i.test(offerAvailability(offer))) continue;
    const values = (variant.variantValues || []).map((value) => value.name).join(' ');
    const gramsValue = grams(values) ?? grams(`${name} ${pageUrl}`);
    const price = variantPrice(variant) ?? parsePrice(offer?.price);
    const key = `${gramsValue}|${price}`;
    const score = /(?:öğütülmemiş|çekirdek|cekirdek)/i.test(values) ? 2 : 1;
    if (!grouped.has(key) || grouped.get(key).score < score) {
      grouped.set(key, { score, item: row(meta, { name, details, gramsValue, price, url: offer?.url || `${pageUrl}?vid=${variant.id}`, method: 'ikas canlı ürün varyantı — Instagram keşfi' }) });
    }
  }

  const extracted = [...grouped.values()].map(({ item }) => item);
  return extracted.length ? extracted : genericJsonLdRows(meta, pageUrl, html, 'ikas ürün JSON-LD — Instagram keşfi');
}

async function shopifyRows(meta) {
  const data = await getJson(`${meta.base.replace(/\/$/, '')}/products.json?limit=250`);
  const rows = [];
  for (const product of data.products || []) {
    const tags = Array.isArray(product.tags) ? product.tags.join(' ') : String(product.tags || '');
    const identity = `${product.title} ${product.product_type || ''} ${tags}`;
    const details = clean(product.body_html);
    if (!validCoffee(identity, details)) continue;
    const variants = (product.variants || []).filter((variant) => variant.available !== false);
    const seen = new Set();
    for (const variant of variants) {
      const gramsValue = grams(`${variant.title || ''} ${product.title} ${details.slice(0, 1000)}`);
      const price = parsePrice(variant.price);
      const key = `${gramsValue}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row(meta, { name: product.title, details, gramsValue, price, url: `${meta.base.replace(/\/$/, '')}/products/${product.handle}`, method: 'Shopify canlı ürün akışı — Instagram keşfi' }));
    }
  }
  return rows;
}

async function sitemapStore(meta) {
  const urls = sitemapUrls(await getText(meta.sitemap))
    .filter((url) => url.replace(/\/$/, '') !== meta.base.replace(/\/$/, ''))
    .filter((url) => meta.platform !== 'whirl-sitemap' || /\/alisveris\/urun\//i.test(new URL(url).pathname));
  const errors = [];
  const groups = await mapLimit(urls, 5, async (url) => {
    try {
      const html = await getText(url);
      if (meta.platform === 'ikas') return ikasRows(meta, url, html);
      if (meta.platform === 'whirl-sitemap') return whirlRows(meta, url, html);
      return genericJsonLdRows(meta, url, html, 'Resmî site haritası + ürün JSON-LD — Instagram keşfi');
    } catch (error) {
      errors.push({ url, error: String(error?.message || error) });
      return [];
    }
  });
  return { rows: groups.flat(), candidateUrls: urls.length, errors };
}

function trackingRow(meta) {
  return {
    business: meta.business,
    city: meta.city,
    businessStatus: meta.pendingScope ? 'Kapsam doğrulaması bekliyor' : 'Site doğrulandı',
    product: meta.pendingScope ? 'Kendi paket kahve kataloğu doğrulanamadı' : 'Ayrıntılı ürün verisine erişilemedi',
    origin: 'Menşe belirtilmemiş',
    grams: null,
    price: null,
    stock: 'Belirsiz',
    productType: 'Kahve ürünü',
    url: meta.base,
    sourceMethod: 'Instagram keşfi — resmî hesap/site doğrulaması',
    confidence: meta.pendingScope ? 'Düşük' : 'Orta',
    note: meta.trackingStatus,
    catalogStatus: 'Katalog takip kaydı',
    aliases: meta.aliases,
    instagram: meta.instagram || null,
    discoveryChannels: ['Instagram kullanıcı bildirimi', 'Resmî hesap/site kontrolü'],
    checkedAt
  };
}

const collected = [];
const audit = [];
const legacyNames = {
  'ARC CO': ['ARC CO Coffee'],
  'Fluxus Coffee Roastery': ['Fluxus Coffee'],
  'Main Coffee': ['Main Coffee Co.']
};
const previousRows = (meta) => {
  const names = new Set([meta.business, ...(legacyNames[meta.business] || [])]);
  return existing
    .filter((item) => names.has(item.business))
    .map((item) => ({
      ...item,
      business: meta.business,
      aliases: [...new Set([...(item.aliases || []), ...meta.aliases])],
      instagram: meta.instagram || item.instagram || null
    }));
};
const pageIdentity = (value) => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return String(value || '').replace(/[?#][\s\S]*$/, '').replace(/\/$/, '');
  }
};

for (const meta of businesses) {
  if (meta.platform === 'tracking') {
    collected.push(trackingRow(meta));
    audit.push({ business: meta.business, platform: meta.platform, source: meta.base, status: meta.trackingStatus, products: 0, trackingRecords: 1 });
    continue;
  }
  try {
    const result = meta.platform === 'shopify'
      ? { rows: await shopifyRows(meta), candidateUrls: 1, errors: [] }
      : await sitemapStore(meta);
    let safeRows = result.rows;
    let status = result.rows.length ? 'Ürünler eklendi' : 'Uygun canlı kahve ürünü çıkarılamadı';
    const previous = previousRows(meta);

    if (result.errors.length) {
      const failedUrls = new Set(result.errors.map(({ url }) => pageIdentity(url)));
      const retained = previous.filter((item) => item.url && failedUrls.has(pageIdentity(item.url)));
      safeRows = [...safeRows, ...retained];
      if (retained.length) status += `; ${retained.length} önceki kayıt geçici erişim hatası nedeniyle korundu`;
    }
    if (!safeRows.length && previous.length) {
      safeRows = previous;
      status = `Canlı katalog boş veya erişilemez; ${previous.length} önceki kayıt korundu`;
    }

    collected.push(...safeRows);
    audit.push({ business: meta.business, platform: meta.platform, source: meta.sitemap || meta.base, status, products: safeRows.length, candidateUrls: result.candidateUrls, errors: result.errors.length, errorUrls: result.errors });
  } catch (error) {
    const previous = previousRows(meta);
    const fallback = previous.length
      ? previous
      : [trackingRow({ ...meta, trackingStatus: `Resmî mağaza doğrulandı; otomatik katalog erişimi başarısız: ${error.message}` })];
    collected.push(...fallback);
    audit.push({ business: meta.business, platform: meta.platform, source: meta.sitemap || meta.base, status: previous.length ? `Erişim hatası; ${previous.length} önceki kayıt korundu: ${error.message}` : `Erişim hatası: ${error.message}`, products: previous.filter((item) => item.catalogStatus === 'Ürün kaydı').length, trackingRecords: fallback.filter((item) => item.catalogStatus === 'Katalog takip kaydı').length });
  }
}

const unique = [...new Map(collected.map((item) => [`${item.business}|${item.url}|${item.grams}|${item.price}`, item])).values()];
const newNames = new Set(businesses.map(({ business }) => business));
const replacedBusinessNames = new Set([...newNames, 'ARC CO Coffee', 'Fluxus Coffee', 'Main Coffee Co.']);
const preserved = existing.filter((item) => !replacedBusinessNames.has(item.business));

for (const meta of businesses) {
  if (!unique.some((item) => item.business === meta.business)) throw new Error(`${meta.business} için kayıt üretilmedi.`);
}

await fs.writeFile(sourcePath, JSON.stringify([...preserved, ...unique], null, 2), 'utf8');
const auditResults = audit.map((result) => ({
  ...result,
  products: unique.filter((item) => item.business === result.business && item.catalogStatus === 'Ürün kaydı').length,
  trackingRecords: unique.filter((item) => item.business === result.business && item.catalogStatus === 'Katalog takip kaydı').length
}));

await fs.writeFile(auditPath, JSON.stringify({ checkedAt, reportedNames: 11, canonicalBusinessesAdded, existingBusinessRefreshed: 'Tetra N Roastery', results: auditResults }, null, 2), 'utf8');

console.log(JSON.stringify({
  checkedAt,
  reportedNames: 11,
  canonicalBusinessesAdded,
  existingBusinessRefreshed: 'Tetra N Roastery',
  productsAdded: unique.filter((item) => item.catalogStatus === 'Ürün kaydı').length,
  trackingRecordsAdded: unique.filter((item) => item.catalogStatus === 'Katalog takip kaydı').length,
  byBusiness: Object.fromEntries(businesses.map(({ business }) => [business, unique.filter((item) => item.business === business).length]))
}, null, 2));
