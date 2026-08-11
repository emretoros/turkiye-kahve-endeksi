import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source/broad_products.json');
const auditPath = path.join(root, 'source/forum_roaster_ingestion_2026-08-11.json');
const existing = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const candidates = [
  'Savène Coffee Co.',
  'Must Coffee & Roastery',
  'Troika Roasting Co.',
  'Olwen Coffee Company',
  'Flores Roastery',
  'C.R.E.A.M. Coffee Roastery',
  'FUA Coffee',
  'Pacamara Coffee'
];

const expectedCounts = {
  'Savène Coffee Co.': 6,
  'Must Coffee & Roastery': 16,
  'Troika Roasting Co.': 19,
  'Olwen Coffee Company': 29,
  'Flores Roastery': 33,
  'C.R.E.A.M. Coffee Roastery': 12,
  'FUA Coffee': 4,
  'Pacamara Coffee': 18
};

const coffeeSignal = /kahve|coffee|espresso|filtre|çekirdek|cekirdek|bean|decaf|blend|harman|ethiopia|etiyopya|colombia|kolombiya|brazil|brasil|brezilya|guatemala|kenya|peru|honduras|costa rica|kosta rika|el salvador|rwanda|ruanda|burundi|sumatra|indonesia|endonezya|nicaragua|panama|mexico|meksika/i;
const excluded = /ekipman|equipment|dripper|server|kupa|mug|fincan|cezve|termos|tumbler|değirmen|ogutucu|öğütücü|grinder|filtre kağıdı|filtre kagidi|filter paper|aeropress|chemex|hario|kettle|tamper|bardak|matcha|çay|tea|çikolata|chocolate|lokum|draje|şurup|syrup|salep|frappe|kurabiye|cookie|granola|sabun|kolonya|mum|candle|t-shirt|tişört|tisort|hoodie|çanta|canta|aksesuar|deri|lifestyle|sandviç|sandvic|pasta|kruvasan|croissant|eğitim|egitim|training|workshop|danışmanlık|danismanlik|b2b|toptan özel|toptan ozel|yeşil çekirdek|yesil cekirdek|kahve makinesi|coffee machine|makinesi|kağıdı|kagidi|potlu|pitcher|süt potu|sut potu|tartı|tarti|moka pot|syphon|sifon|ajanda|not defteri|kaşık|kasik|cupping/i;
const headers = { 'user-agent': 'Mozilla/5.0 (compatible; CekirdekBul/1.0)' };

async function getText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function getJson(url) {
  return JSON.parse(await getText(url));
}

async function postFormJson(url, form) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
        body: form
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

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

function clean(value = '') {
  return decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePrice(value) {
  if (typeof value === 'number') return value > 0 ? value : null;
  const normalized = String(value ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!normalized) return null;
  const number = normalized.includes(',')
    ? Number(normalized.replace(/\./g, '').replace(',', '.'))
    : Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function grams(value = '') {
  const raw = String(value).replace(/\+/g, ' ');
  let uriDecoded = raw;
  try { uriDecoded = decodeURIComponent(raw); } catch {}
  const decoded = uriDecoded
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ' ');
  const multipack = decoded.match(/(?:^|\D)(\d{1,2})\s*[x×]\s*(\d{2,4})\s*[-_]?\s*(?:g|gr|gram)\b/i)
    || decoded.match(/(?:^|\D)(\d{2,4})\s*[-_]?\s*(?:g|gr|gram)\s*[x×]\s*(\d{1,2})\b/i);
  if (multipack) return Number(multipack[1]) * Number(multipack[2]);
  const kg = decoded.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s*[-_]?\s*(?:kg|kilogram)\b/i);
  if (kg) return Math.round(Number(kg[1].replace(',', '.')) * 1000);
  const gr = decoded.match(/(?:^|\D)(\d{2,4})\s*[-_]?\s*(?:g|gr|gram)\b/i);
  return gr ? Number(gr[1]) : null;
}

const originPatterns = [
  ['Etiyopya', /ethiopia|etiyopya/i], ['Kolombiya', /colombia|kolombiya/i],
  ['Brezilya', /brazil|brasil|brezilya/i], ['Guatemala', /guatemala/i],
  ['Kenya', /kenya/i], ['Peru', /peru/i], ['Honduras', /honduras/i],
  ['Kosta Rika', /costa rica|kosta rika/i], ['El Salvador', /el salvador/i],
  ['Ruanda', /rwanda|ruanda/i], ['Burundi', /burundi/i],
  ['Endonezya', /indonesia|endonezya|sumatra/i], ['Nikaragua', /nicaragua|nikaragua/i],
  ['Panama', /panama/i], ['Meksika', /mexico|meksika/i]
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

  const explicitTail = details.match(/\b(?:menşe(?:i)?|origin|ülke|country)\b(?:\s*\([^)]*\))?\s*[:\-]\s*([\s\S]{1,180})/i)?.[1] || '';
  const explicitSegment = explicitTail.split(/\b(?:ağırlık|agirlik|kavurma|tadım|tadim|işleme|isleme|varyete|rakım|rakim|bölge|bolge|çiftlik|ciftlik|hasat)\b/i)[0];
  const explicitOrigins = origins(explicitSegment);
  if (explicitOrigins.length > 1) return 'Çoklu menşe';
  if (explicitOrigins.length === 1) return explicitOrigins[0];

  const inDetails = origins(details);
  if (/(?:blend|harman|set|tanışma|tanisma|tadım|tadim|deneme)/i.test(name) && new Set(inDetails).size > 1) return 'Çoklu menşe';
  return inDetails[0] || 'Menşe belirtilmemiş';
}

function productType(value = '') {
  if (/türk kahvesi|turk kahvesi/i.test(value)) return 'Türk kahvesi';
  if (/blend|harman/i.test(value)) return 'Harman';
  return 'Tek köken/ürün';
}

function validCoffee(identity, details = '') {
  return coffeeSignal.test(`${identity} ${details}`) && !excluded.test(identity);
}

function row({ business, city, name, details = '', gramsValue, price, stock = 'Stokta', url, method, note }) {
  const all = `${name} ${details}`;
  return {
    business,
    city,
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
    note: note || 'Resmî mağazanın canlı ürün kataloğundan çıkarıldı; kahve dışı ürünler elendi.',
    catalogStatus: 'Ürün kaydı'
  };
}

function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/loc>/gi)]
    .map((match) => decode(match[1]).trim());
}

function pageLinks(html, base, pattern) {
  return [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((match) => {
    try { return new URL(decode(match[1]), base).href; } catch { return null; }
  }).filter((url) => url && pattern.test(url)))];
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
    if (end > start) {
      try { arrays.push(JSON.parse(html.slice(start, end))); } catch {}
      from = end;
    } else break;
  }
  return arrays;
}

function balancedObjectAfter(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
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

function offerList(product) {
  const offers = product?.offers ?? product?.Offers;
  return Array.isArray(offers) ? offers : offers ? [offers] : [];
}

function offerAvailability(offer) {
  return String(offer?.availability ?? offer?.Availability ?? '');
}

function genericProductRows(business, city, pageUrl, html, method) {
  const rows = [];
  for (const product of productNodes(html)) {
    const name = clean(product.name);
    const details = clean(product.description);
    const images = JSON.stringify(product.image || '');
    const pagePath = new URL(pageUrl).pathname;
    const identity = `${name} ${pagePath} ${product.category || ''}`;
    if (!name || !validCoffee(identity, details)) continue;
    const offers = offerList(product);
    const seen = new Set();
    for (const offer of offers.length ? offers : [{}]) {
      if (/OutOfStock/i.test(offerAvailability(offer))) continue;
      const price = parsePrice(offer.price ?? offer.lowPrice);
      const gramsValue = grams(`${name} ${pagePath} ${product.sku || ''} ${images}`);
      const key = `${gramsValue}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row({ business, city, name, details, gramsValue, price, url: offer.url || offer.URL || product.url || pageUrl, method }));
    }
  }
  return rows;
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

function nextPageProduct(html) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const pageProps = JSON.parse(match[1])?.props?.pageProps;
    return { product: pageProps?.pageSpecificData, canonicals: pageProps?.canonicals };
  } catch {
    return null;
  }
}

function ikasProductRows(business, city, pageUrl, html) {
  const jsonLdProduct = productNodes(html)[0];
  const pageData = nextPageProduct(html);
  const product = pageData?.product;
  if (!product && !jsonLdProduct) return [];
  const name = clean(product?.name || jsonLdProduct?.name);
  const details = clean(product?.description || jsonLdProduct?.description);
  const pagePath = new URL(pageUrl).pathname;
  const categories = (product?.categories || []).map((category) => `${category.name || ''} ${category.slug || ''}`).join(' ');
  if (!name || !validCoffee(`${name} ${pagePath} ${categories}`, details)) return [];

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
    const gramsValue = grams(values) ?? grams(`${name} ${pagePath}`);
    const price = variantPrice(variant) ?? parsePrice(offer?.price);
    const key = `${gramsValue}|${price}`;
    const score = /(?:öğütülmemiş|çekirdek|cekirdek)/i.test(values) ? 2 : 1;
    if (!grouped.has(key) || grouped.get(key).score < score) {
      grouped.set(key, {
        score,
        item: row({
          business,
          city,
          name,
          details,
          gramsValue,
          price,
          url: offer?.url || `${pageUrl}?vid=${variant.id}`,
          method: 'ikas ürün varyantı — forum keşfi'
        })
      });
    }
  }

  const rows = [...grouped.values()].map(({ item }) => item);
  if (!rows.length) return genericProductRows(business, city, pageUrl, html, 'ikas ürün JSON-LD — forum keşfi');
  return rows;
}

function findWixProduct(html) {
  const match = html.match(/<script[^>]*id=["']wix-warmup-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const rootObject = JSON.parse(match[1]);
    const visited = new Set();
    const visit = (value) => {
      if (!value || typeof value !== 'object' || visited.has(value)) return null;
      visited.add(value);
      if (value.name && Array.isArray(value.productItems) && Array.isArray(value.options)) return value;
      for (const child of Object.values(value)) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(rootObject);
  } catch {
    return null;
  }
}

function wixProductRows(business, city, pageUrl, html) {
  const product = findWixProduct(html);
  if (!product || product.isInStock === false) return [];
  const name = clean(product.name);
  const details = clean(product.description);
  const categories = (product.categories || []).map((category) => category.name || category).join(' ');
  const pagePath = new URL(pageUrl).pathname;
  if (!name || excluded.test(`${name} ${pagePath} ${categories}`)) return [];

  const weightOption = (product.options || []).find((option) => /ağırlık|agirlik|gramaj|paket/i.test(`${option.title || ''} ${option.key || ''}`));
  const weightBySelection = new Map((weightOption?.selections || [])
    .map((selection) => [String(selection.id), grams(selection.value || selection.description || selection.key || '')])
    .filter(([, value]) => value));
  let fallbackGrams = grams(`${name} ${pagePath}`) ?? grams(details);
  if (/3\s*['’-]?\s*l[üu]|üçlü/i.test(name) && fallbackGrams) fallbackGrams *= 3;

  if (weightBySelection.size <= 1) {
    const gramsValue = [...weightBySelection.values()][0] ?? fallbackGrams;
    const price = parsePrice(product.discountedPrice ?? product.price);
    return [row({ business, city, name, details, gramsValue, price, url: pageUrl, method: 'Wix canlı ürün verisi — forum keşfi' })];
  }

  const grouped = new Map();
  for (const item of product.productItems || []) {
    if (item.isVisible === false || item.inventory?.status === 'out_of_stock') continue;
    const weightId = (item.optionsSelections || []).map(String).find((id) => weightBySelection.has(id));
    const gramsValue = weightBySelection.get(weightId);
    const price = parsePrice(item.price);
    if (!gramsValue || !price || grouped.has(gramsValue)) continue;
    grouped.set(gramsValue, row({ business, city, name, details, gramsValue, price, url: pageUrl, method: 'Wix canlı varyant verisi — forum keşfi' }));
  }
  return [...grouped.values()];
}

async function sitemapStore({ business, city, sitemap, include, platform = 'generic', concurrency = 5 }) {
  const urls = sitemapUrls(await getText(sitemap)).filter((url) => include.test(url));
  const errorUrls = [];
  const groups = await mapLimit(urls, concurrency, async (url) => {
    try {
      const html = await getText(url);
      if (platform === 'ikas') return ikasProductRows(business, city, url, html);
      if (platform === 'wix') return wixProductRows(business, city, url, html);
      return genericProductRows(business, city, url, html, `${platform} ürün JSON-LD — forum keşfi`);
    } catch (error) { errorUrls.push({ url, error: String(error?.message || error) }); return []; }
  });
  return { rows: groups.flat(), audit: { business, source: sitemap, candidateUrls: urls.length, errors: errorUrls.length, errorUrls } };
}

async function fuaRows() {
  const business = 'FUA Coffee', city = 'İzmir';
  const storefront = 'https://www.shopier.com/ShowProductNew/storefront.php?shop=fuacoffee';
  const links = pageLinks(await getText(storefront), storefront, /shopier\.com\/(?:fuacoffee\/)?\d+(?:\?|$)/i);
  let errors = 0;
  const groups = await mapLimit(links, 4, async (url) => {
    try {
      const html = await getText(url);
      const pageData = balancedObjectAfter(html, '} = ');
      const product = pageData?.page === 'product' ? pageData.product : null;
      if (!product) return [];
      const name = clean(product?.name);
      const details = clean(product?.description
        || html.match(/<meta\s+[^>]*property=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]);
      if (!name || !validCoffee(name, details) || product?.labels?.out_of_stock?.enabled || Number(product?.stock) <= 0) return [];
      const masterpass = Number(product.price?.masterpass_amount);
      const price = Number.isFinite(masterpass) && masterpass > 0
        ? masterpass / 100
        : parsePrice(product.price?.price_legacy_formatted || product.price?.price_formatted);
      return [row({ business, city, name, details, gramsValue: grams(name) ?? grams(details), price, url: product.absolute_link || url, method: 'Shopier canlı ürün verisi — forum keşfi' })];
    } catch { errors++; return []; }
  });
  return { rows: groups.flat(), audit: { business, source: storefront, candidateUrls: links.length, errors } };
}

async function pacamaraRows() {
  const business = 'Pacamara Coffee', city = 'Eskişehir';
  const category = 'https://online.erishelva.com.tr/kategori/turk-kahvesi?marka=pacamara';
  const categoryHtml = await getText(category);
  const links = [...new Set([...categoryHtml.matchAll(/<a\s+[^>]*href=["']([^"']*\/urun\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((match) => /^Pacamara Coffee\b/i.test(clean(match[2])))
    .map((match) => new URL(decode(match[1]), category).href))];
  const errorUrls = [];
  const groups = await mapLimit(links, 1, async (url) => {
    try {
      const html = await getText(url);
      const pageParams = [...html.matchAll(/pageParams\s*=\s*\{product:\s*\{([\s\S]*?)\}\};/g)].at(-1)?.[1] || '';
      const parentId = pageParams.match(/\bid:\s*["'](\d+)["']/)?.[1];
      const name = clean(pageParams.match(/\bfullName:\s*["']([^"']+)["']/)?.[1]
        || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
      if (!parentId || !/^Pacamara Coffee\b/i.test(name) || !validCoffee(name)) return [];

      const variantGroups = [...html.matchAll(/<div class=["']variant-list["'][^>]*>([\s\S]*?)<\/select>\s*<\/div>/gi)].map((match) => {
        const block = match[1];
        const title = clean(block.match(/variant-group-title[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
        const groupId = block.match(/data-group-id=["'](\d+)["']/i)?.[1];
        const options = [...block.matchAll(/<option\s+[^>]*value=["'](\d+)["'][^>]*>([\s\S]*?)<\/option>/gi)]
          .map((option) => ({ id: option[1], title: clean(option[2]) }))
          .filter((option) => option.id !== '0');
        return { title, groupId, options };
      });
      const weightGroup = variantGroups.find((group) => /gramaj|ağırlık|agirlik/i.test(group.title));
      const nextGroup = variantGroups.find((group) => group !== weightGroup);
      if (!weightGroup?.groupId || !weightGroup.options.length) return [];

      const rows = [];
      for (const weight of weightGroup.options) {
        const form = new URLSearchParams();
        form.set('selected_option_group_id', weightGroup.groupId);
        if (nextGroup?.groupId) form.set('next_option_group_id', nextGroup.groupId);
        form.append('selected_options[]', weight.id);
        form.set('parent_product_id', parentId);
        const related = await postFormJson('https://online.erishelva.com.tr/product/related-options', form);
        const available = (related?.data?.options || []).filter((option) => Number(option.product_stock_amount) > 0);
        const representative = nextGroup
          ? available.find((option) => Number(option.option_id) === 2) || available[0]
          : available.find((option) => String(option.option_id) === weight.id) || available[0];
        if (!representative?.product_url) continue;
        const variantUrl = new URL(representative.product_url, category).href;
        const variantHtml = await getText(variantUrl);
        const variantProduct = productNodes(variantHtml)[0];
        const offer = offerList(variantProduct)[0];
        const variantParams = [...variantHtml.matchAll(/pageParams\s*=\s*\{product:\s*\{([\s\S]*?)\}\};/g)].at(-1)?.[1] || '';
        const price = parsePrice(offer?.price)
          ?? parsePrice(variantHtml.match(/itemprop=["']price["'][^>]*content=["']([^"']+)/i)?.[1])
          ?? parsePrice(variantParams.match(/\bsalePrice:\s*([\d.]+)/)?.[1]);
        const gramsValue = grams(weight.title) ?? grams(representative.variant_name);
        if (!gramsValue || !price) continue;
        rows.push(row({
          business,
          city,
          name,
          gramsValue,
          price,
          url: variantUrl,
          method: 'Eris Helva canlı Pacamara varyantı — forum keşfi',
          note: 'Pacamara markalı kahvenin Eris Helva canlı satış kanalından çıkarıldı; öğütme seçenekleri gramaj bazında tekilleştirildi.'
        }));
      }
      return rows;
    } catch (error) { errorUrls.push({ url, error: String(error?.message || error) }); return []; }
  });
  return { rows: groups.flat(), audit: { business, source: category, candidateUrls: links.length, errors: errorUrls.length, errorUrls } };
}

async function floresRows() {
  const business = 'Flores Roastery', city = 'Eskişehir';
  const endpoint = 'https://floresroastery.com/wp-json/wc/store/v1/products?per_page=100';
  const products = await getJson(endpoint);
  let errors = 0;
  const groups = await mapLimit(products, 4, async (product) => {
    const categories = (product.categories || []).map((item) => item.name).join(' ');
    const identity = `${clean(product.name)} ${categories} ${product.permalink}`;
    const details = `${clean(product.short_description)} ${clean(product.description)}`;
    if (!validCoffee(identity, details) || product.is_in_stock === false) return [];
    try {
      const html = await getText(product.permalink);
      const encoded = html.match(/data-product_variations="([\s\S]*?)"/i)?.[1];
      const variations = encoded ? JSON.parse(decode(encoded)) : [];
      const rows = [], seen = new Set();
      for (const variant of variations) {
        if (!variant.is_in_stock || variant.is_purchasable === false || variant.variation_is_active === false) continue;
        const values = Object.values(variant.attributes || {}).join(' ');
        const gramsValue = grams(`${values} ${product.name}`);
        const price = parsePrice(variant.display_price);
        const key = `${gramsValue}|${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row({ business, city, name: clean(product.name), details, gramsValue, price, url: `${product.permalink}?variation_id=${variant.variation_id}`, method: 'WooCommerce canlı varyant verisi — forum keşfi' }));
      }
      if (rows.length) return rows;
      const minor = Number(product.prices?.currency_minor_unit ?? 2);
      const price = product.prices?.price != null ? Number(product.prices.price) / (10 ** minor) : null;
      return [row({ business, city, name: clean(product.name), details, gramsValue: grams(`${product.name} ${details}`), price, url: product.permalink, method: 'WooCommerce ürün akışı — forum keşfi' })];
    } catch { errors++; return []; }
  });
  return { rows: groups.flat(), audit: { business, source: endpoint, candidateUrls: products.length, errors } };
}

const results = await Promise.all([
  sitemapStore({ business: 'Troika Roasting Co.', city: 'İstanbul', sitemap: 'https://troikaroasting.co/products.xml', include: /^https:\/\/troikaroasting\.co\/(?!$)/i, platform: 'ikas' }),
  sitemapStore({ business: 'Olwen Coffee Company', city: 'İzmir', sitemap: 'https://olwen.com.tr/products.xml', include: /^https:\/\/olwen\.com\.tr\/(?!$)/i, platform: 'ikas' }),
  sitemapStore({ business: 'C.R.E.A.M. Coffee Roastery', city: 'Muğla', sitemap: 'https://creamcoff.com/products.xml', include: /^https:\/\/creamcoff\.com\/(?!$)/i, platform: 'ikas' }),
  sitemapStore({ business: 'Savène Coffee Co.', city: 'İstanbul', sitemap: 'https://savenecoffee.shop/sitemap.xml', include: /savenecoffee\.shop\/urun-detay\//i, platform: 'Next.js', concurrency: 3 }),
  sitemapStore({ business: 'Must Coffee & Roastery', city: 'İzmir', sitemap: 'https://www.mustco.com.tr/store-products-sitemap.xml', include: /mustco\.com\.tr\/urunlerimiz\//i, platform: 'wix', concurrency: 2 }),
  fuaRows(),
  pacamaraRows(),
  floresRows()
]);

const collected = results.flatMap((result) => result.rows);
const unique = [...new Map(collected.map((item) => [`${item.business}|${item.product}|${item.grams}|${item.price}`, item])).values()];
const counts = Object.fromEntries(candidates.map((business) => [business, unique.filter((item) => item.business === business).length]));
const mismatched = candidates.filter((business) => counts[business] !== expectedCounts[business]);
const audit = results.map((result) => ({ ...result.audit, recovered: counts[result.audit.business] || 0 }));

if (mismatched.length) {
  const products = Object.fromEntries(mismatched.map((business) => [business, unique
    .filter((item) => item.business === business)
    .map(({ product, grams, price, url }) => ({ product, grams, price, url }))]));
  console.error(JSON.stringify({ status: 'Yazma işlemi iptal edildi', mismatched, expectedCounts, counts, products, audit }, null, 2));
  process.exit(1);
}

const candidateSet = new Set(candidates);
const preserved = existing.filter((item) => !candidateSet.has(item.business));
await fs.writeFile(sourcePath, JSON.stringify([...preserved, ...unique], null, 2), 'utf8');
await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ candidates: candidates.length, products: unique.length, counts, audit }, null, 2));
