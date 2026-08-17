import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source', 'broad_products.json');
const checkedDate = process.env.PRICE_CHECK_DATE || new Date().toISOString().slice(0, 10);
const auditPath = path.join(root, 'source', `price_comparison_audit_${checkedDate}.json`);
const maxSites = Math.min(100, Math.max(1, Number(process.env.MAX_SITES || 100)));
const apply = process.argv.includes('--apply');
const applyPartial = process.argv.includes('--apply-partial');
const targetBusinesses = new Set(String(process.env.TARGET_BUSINESSES || '').split('|').map((value) => value.trim()).filter(Boolean));
const rows = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const clean = (value) => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:nbsp|amp|quot|#39);/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const grams = (value) => {
  const text = String(value || '').replace(/,/g, '.');
  const kg = text.match(/(?:^|\D)(\d+(?:\.\d+)?)\s*kg\b/i);
  if (kg) return Math.round(Number(kg[1]) * 1000);
  const gr = text.match(/(?:^|\D)(\d{2,5})\s*(?:g|gr|gram)\b/i);
  return gr ? Number(gr[1]) : null;
};

const urlParts = (value) => {
  try {
    const url = new URL(value);
    return { origin: url.origin, path: url.pathname.replace(/\/+$/, '').toLocaleLowerCase('tr-TR') || '/' };
  } catch {
    return { origin: '', path: '' };
  }
};

const productKey = (url, weight) => `${urlParts(url).path}|${weight ?? ''}`;
const numericPrice = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const uniqueNumbers = (values) => [...new Set(values.map(numericPrice).filter((value) => value !== null))];
const normalize = (value) => String(value || '').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
const nonCoffee = /\b(server|dripper|chemex|aeropress|v60|filtre kagidi|filter paper|degirmen|ogutucu|tarti|scale|kettle|tamper|pitcher|demleme seti|kupa|termos|adacay|cay|tea|matcha|salep|sahlep|frappe|smoothie|surup|syrup|cikolata bari?|bean to bar|madlen|draje|lokum|sekerleme|cookie|kurabiye|granola|kolonya|sabun|t-shirt|tisort|canta|hindistan cevizi|pirinc|chia|corekotu|hibiskus|tuz|kakule|karabiber|karanfil|karbonat|karabugday|keten tohumu|kimyon|kinoa|nar eksisi|nohut unu|tarcin|zencefil|zerdecal)\b/;
const isCoffeeRow = (row) => !nonCoffee.test(normalize(`${row.product || ''} ${row.url || ''}`));
const reliableSource = (value) => /JSON-LD|HTML ürün kartı|manuel\/API|canlı ürün|kategori HTML|Özel katalog|Ana sayfa ürün kartı/i.test(value || '');

async function get(url, type = 'json') {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 CoffeePriceIndex/1.0 (+price comparison)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return type === 'json' ? response.json() : response.text();
}

function groupCurrent(current) {
  const grouped = new Map();
  for (const row of current) {
    const price = numericPrice(row.price);
    if (!row.url || price === null) continue;
    const key = productKey(row.url, row.grams);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...row, price });
  }
  return grouped;
}

function compare(baseline, current, method) {
  const baselineGroups = new Map();
  for (const row of baseline) {
    const price = numericPrice(row.price);
    if (!row.url || price === null) continue;
    const key = productKey(row.url, row.grams);
    if (!baselineGroups.has(key)) baselineGroups.set(key, []);
    baselineGroups.get(key).push(row);
  }

  const currentGroups = groupCurrent(current);
  const comparisons = [];
  for (const [key, oldRows] of baselineGroups) {
    const newRows = currentGroups.get(key) || [];
    const platformRows = method === 'Shopify'
      ? oldRows.filter((row) => /Shopify/i.test(row.sourceMethod || ''))
      : method === 'WooCommerce'
        ? oldRows.filter((row) => /WooCommerce/i.test(row.sourceMethod || ''))
        : oldRows.filter((row) => reliableSource(row.sourceMethod));
    const trustedRows = platformRows.length ? platformRows : oldRows;
    const oldPrices = uniqueNumbers(trustedRows.map((row) => row.price));
    const newPrices = uniqueNumbers(newRows.map((row) => row.price));
    if (oldPrices.length !== 1 || newPrices.length !== 1) continue;
    const previousPrice = oldPrices[0];
    const price = newPrices[0];
    const status = price > previousPrice ? 'up' : price < previousPrice ? 'down' : 'same';
    const sourceMethod = trustedRows[0].sourceMethod || '';
    const reliableProductPage = reliableSource(sourceMethod);
    if (status !== 'same' && method === 'Ürün sayfası' && !reliableProductPage) continue;
    const ratio = price / previousPrice;
    if (status !== 'same' && method === 'Ürün sayfası' && (ratio < 0.5 || ratio > 2)) continue;
    comparisons.push({
      key,
      business: trustedRows[0].business,
      product: trustedRows[0].product,
      grams: trustedRows[0].grams ?? null,
      url: trustedRows[0].url,
      previousPrice,
      price,
      status,
      method,
      sourceMethod
    });
  }
  return comparisons;
}

async function scrapeShopify(origin) {
  const current = [];
  for (let page = 1; page <= 3; page += 1) {
    const data = await get(`${origin}/products.json?limit=250&page=${page}`);
    const products = data.products || [];
    for (const product of products) {
      for (const variant of product.variants || []) {
        current.push({
          url: `${origin}/products/${product.handle}`,
          grams: grams(`${variant.title || ''} ${product.title || ''}`),
          price: numericPrice(variant.price)
        });
      }
    }
    if (products.length < 250) break;
  }
  return current;
}

async function scrapeWooCommerce(origin) {
  const current = [];
  for (let page = 1; page <= 3; page += 1) {
    const products = await get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    for (const product of products || []) {
      const minor = Number(product.prices?.currency_minor_unit ?? 2);
      current.push({
        url: product.permalink,
        grams: grams(`${product.name || ''} ${clean(product.short_description)} ${clean(product.description)}`),
        price: product.prices?.price === undefined ? null : Number(product.prices.price) / (10 ** minor)
      });
    }
    if (!Array.isArray(products) || products.length < 100) break;
  }
  return current;
}

function jsonLdValues(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) jsonLdValues(item, found);
    return found;
  }
  const type = Array.isArray(value['@type']) ? value['@type'].join(' ') : value['@type'];
  if (/product|offer/i.test(String(type || ''))) {
    const offers = Array.isArray(value.offers) ? value.offers : value.offers ? [value.offers] : [];
    const offerPrices = offers.flatMap((offer) => [offer?.price, offer?.lowPrice, offer?.highPrice]);
    found.push(...offerPrices, value.price, value.lowPrice);
  }
  for (const child of Object.values(value)) jsonLdValues(child, found);
  return found;
}

function priceFromHtml(html) {
  const candidates = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { candidates.push(...jsonLdValues(JSON.parse(match[1]))); } catch {}
  }
  const metaPatterns = [
    /property=["']product:price:amount["'][^>]*content=["']([\d.,]+)/i,
    /content=["']([\d.,]+)["'][^>]*property=["']product:price:amount["']/i,
    /itemprop=["']price["'][^>]*content=["']([\d.,]+)/i
  ];
  for (const pattern of metaPatterns) candidates.push(html.match(pattern)?.[1]);
  const parsed = candidates.map((value) => {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).trim().replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.').replace(/[^\d.]/g, '');
    return numericPrice(normalized);
  }).filter((value) => value !== null);
  return uniqueNumbers(parsed).length === 1 ? parsed[0] : null;
}

async function scrapeProductPages(baseline) {
  const candidates = [...new Map(
    baseline
      .filter((row) => row.url && numericPrice(row.price) !== null)
      .sort((a, b) => Number(Boolean(b.grams)) - Number(Boolean(a.grams)))
      .map((row) => [productKey(row.url, row.grams), row])
  ).values()].slice(0, 18);

  const current = [];
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (cursor < candidates.length) {
      const row = candidates[cursor++];
      try {
        const html = await get(row.url, 'text');
        const price = priceFromHtml(html);
        if (price !== null) current.push({ url: row.url, grams: row.grams, price });
      } catch {}
    }
  });
  await Promise.all(workers);
  return current;
}

function candidatePlatform(baseline) {
  const methods = baseline.map((row) => row.sourceMethod || '').join(' ');
  if (/Shopify/i.test(methods)) return 'Shopify';
  if (/WooCommerce/i.test(methods)) return 'WooCommerce';
  return 'Ürün sayfası';
}

function candidateOrigin(baseline) {
  const counts = new Map();
  for (const row of baseline) {
    const origin = urlParts(row.url).origin;
    if (origin) counts.set(origin, (counts.get(origin) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

const eligible = rows.filter((row) => row.catalogStatus === 'Ürün kaydı' && isCoffeeRow(row) && numericPrice(row.price) !== null && /^https?:/i.test(row.url || ''));
const byBusiness = new Map();
for (const row of eligible) {
  if (!byBusiness.has(row.business)) byBusiness.set(row.business, []);
  byBusiness.get(row.business).push(row);
}

const platformRank = { Shopify: 0, WooCommerce: 1, 'Ürün sayfası': 2 };
const candidates = [...byBusiness.entries()].map(([business, baseline]) => ({
  business,
  baseline,
  platform: candidatePlatform(baseline),
  origin: candidateOrigin(baseline),
  reliableProductPage: baseline.some((row) => reliableSource(row.sourceMethod))
})).filter((candidate) => !targetBusinesses.size || targetBusinesses.has(candidate.business))
  .sort((a, b) => platformRank[a.platform] - platformRank[b.platform] || Number(b.reliableProductPage) - Number(a.reliableProductPage) || b.baseline.length - a.baseline.length || a.business.localeCompare(b.business, 'tr'));

const categories = { up: new Set(), same: new Set(), down: new Set() };
const reports = [];
for (const candidate of candidates.slice(0, maxSites)) {
  let current = [];
  let error = null;
  try {
    current = candidate.platform === 'Shopify'
      ? await scrapeShopify(candidate.origin)
      : candidate.platform === 'WooCommerce'
        ? await scrapeWooCommerce(candidate.origin)
        : await scrapeProductPages(candidate.baseline);
  } catch (cause) {
    error = cause.message;
  }
  const comparisons = compare(candidate.baseline, current, candidate.platform);
  const statuses = [...new Set(comparisons.map((item) => item.status))];
  for (const status of statuses) categories[status].add(candidate.business);
  reports.push({
    business: candidate.business,
    origin: candidate.origin,
    platform: candidate.platform,
    baselineProducts: candidate.baseline.length,
    currentProducts: current.length,
    comparisons,
    error
  });
  console.log(JSON.stringify({
    inspected: reports.length,
    business: candidate.business,
    matched: comparisons.length,
    statuses,
    totals: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.size]))
  }));
  if (Object.values(categories).every((businesses) => businesses.size >= 2)) break;
}

const selectedByCategory = Object.fromEntries(Object.entries(categories).map(([status, businesses]) => [status, [...businesses].slice(0, 2)]));
const selectedBusinesses = new Set(Object.values(selectedByCategory).flat());
const selectedComparisons = reports.flatMap((report) => selectedBusinesses.has(report.business) ? report.comparisons : []);

let updatedRows = 0;
const quotaReached = Object.values(selectedByCategory).every((businesses) => businesses.length >= 2);
if (apply && (quotaReached || applyPartial)) {
  const selectedByKey = new Map(selectedComparisons.map((item) => [`${item.business}|${item.key}`, item]));
  for (const row of rows) {
    const comparison = selectedByKey.get(`${row.business}|${productKey(row.url, row.grams)}`);
    if (!comparison || numericPrice(row.price) !== comparison.previousPrice) continue;
    row.previousPrice = comparison.previousPrice;
    row.price = comparison.price;
    row.checkedAt = checkedDate;
    row.priceComparisonMethod = comparison.method;
    updatedRows += 1;
  }
  await fs.writeFile(sourcePath, JSON.stringify(rows, null, 2), 'utf8');
}

const audit = {
  checkedDate,
  maxSites,
  inspectedSites: reports.length,
  applied: apply && updatedRows > 0,
  partialResult: !quotaReached,
  updatedRows,
  selectedByCategory,
  selectedBusinesses: [...selectedBusinesses],
  categoryCounts: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.size])),
  reports
};
await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({
  checkedDate,
  inspectedSites: audit.inspectedSites,
  categoryCounts: audit.categoryCounts,
  selectedByCategory,
  selectedBusinesses: audit.selectedBusinesses,
  selectedComparisons: selectedComparisons.length,
  applied: audit.applied,
  updatedRows
}, null, 2));

if (!quotaReached && !applyPartial) process.exitCode = 2;
