import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source/broad_products.json');
const auditPath = path.join(root, 'source/placeholder_product_recovery_2026-08-11.json');
const existing = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const stores = [
  ['Cup of Joy', 'İstanbul', 'shopify', 'https://cupofjoy.com.tr'],
  ['CoffeeNutz', null, 'shopify', 'https://www.coffeenutz.net'],
  ['Benesso Coffee', 'İstanbul', 'shopify', 'https://benessocoffee.com'],
  ['Homestead Coffee', 'İstanbul', 'shopify', 'https://homestead.coffee'],
  ['Mocaco Coffee', null, 'shopify', 'https://mocacocoffee.com'],
  ['Rumo Coffee', null, 'shopify', 'https://rumo.com.tr'],
  ['Selamlique İstanbul', 'İstanbul', 'shopify', 'https://selamlique.com'],
  ['Shazel', null, 'shopify', 'https://shazel.com.tr'],
  ['Taft Coffee', null, 'shopify', 'https://taftcoffee.com'],
  ['Clean Cup Coffee', 'İstanbul', 'woo', 'https://cleancup.coffee'],
  ['Daphne Coffee Co.', null, 'woo', 'https://daphnecoffee.co'],
  ['Fam Coffee', null, 'woo', 'https://fam.coffee'],
  ['Grano Coffee', null, 'woo', 'https://grano.com.tr'],
  ['Kilin Coffee', null, 'woo', 'https://kilincoffee.com']
];

const coffeeSignal = /kahve|coffee|espresso|filtre|çekirdek|cekirdek|bean|türk kahvesi|turk kahvesi|decaf|blend|ethiopia|etiyopya|colombia|kolombiya|brazil|brezilya|guatemala|kenya|peru|honduras|costa rica|el salvador|rwanda|ruanda|burundi|sumatra|vietnam/i;
const excluded = /ekipman|equipment|dripper|server|kupa|mug|fincan|cezve|termos|tumbler|değirmen|grinder|filtre kağıdı|filter paper|aeropress|chemex|hario|kettle|tamper|bardak altlığı|pour-over seti|french press seti|moka pot seti|başlangıç seti|çikolata|chocolate|lokum|draje|şurup|syrup|çay|tea|salep|frappe|kurabiye|cookie|sabun|kolonya|mum|candle|t-shirt|hoodie|çanta|canta|aksesuar|sandviç|sandvic|pasta|kruvasan|croissant/i;

async function json(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
function clean(value = '') { return String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function grams(text) { const kg = text.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s*kg\b/i); if (kg) return Math.round(Number(kg[1].replace(',', '.')) * 1000); const gr = text.match(/(?:^|\D)(\d{2,4})\s*(?:g|gr|gram)\b/i); return gr ? Number(gr[1]) : null; }
function origin(text) {
  const values = [['Etiyopya',/ethiopia|etiyopya/i],['Kolombiya',/colombia|kolombiya/i],['Brezilya',/brazil|brezilya/i],['Guatemala',/guatemala/i],['Kenya',/kenya/i],['Peru',/peru/i],['Honduras',/honduras/i],['Kosta Rika',/costa rica|kosta rika/i],['El Salvador',/el salvador/i],['Ruanda',/rwanda|ruanda/i],['Burundi',/burundi/i],['Endonezya',/indonesia|endonezya|sumatra/i],['Vietnam',/vietnam/i]];
  return values.find(([, pattern]) => pattern.test(text))?.[0] || 'Menşe belirtilmemiş';
}
function type(text) { return /türk kahvesi|turk kahvesi/i.test(text) ? 'Türk kahvesi' : /blend|harman/i.test(text) ? 'Harman' : 'Kahve ürünü'; }
function valid(identity, details = '') { return coffeeSignal.test(`${identity} ${details}`) && !excluded.test(identity); }

function shopifyRows(business, city, base, data) {
  const rows = [];
  for (const product of data.products || []) {
    const identity = `${product.title} ${product.product_type || ''} ${(product.tags || []).join?.(' ') || product.tags || ''}`;
    const all = `${identity} ${clean(product.body_html)}`;
    if (!valid(identity, clean(product.body_html))) continue;
    const variants = (product.variants || []).filter((variant) => variant.available !== false);
    const seen = new Set();
    for (const variant of variants.length ? variants : [{}]) {
      const g = grams(`${variant.title || ''} ${product.title} ${clean(product.body_html).slice(0, 1000)}`);
      const price = Number(variant.price) > 0 ? Number(variant.price) : null;
      const key = `${g}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ business, city, businessStatus: 'Doğrulandı', product: clean(product.title), origin: origin(all), grams: g, price, stock: variants.length ? 'Stokta' : 'Belirsiz', productType: type(all), url: `${base}/products/${product.handle}`, sourceMethod: 'Shopify ürün akışı — takip kaydı kurtarma', confidence: g && price ? 'Yüksek' : 'Orta', note: 'Resmî mağazanın canlı Shopify ürün akışından çıkarıldı.', catalogStatus: 'Ürün kaydı' });
    }
  }
  return rows;
}

function wooRows(business, city, data) {
  const rows = [];
  for (const product of Array.isArray(data) ? data : []) {
    const categories = (product.categories || []).map((item) => item.name).join(' ');
    const identity = `${product.name} ${categories}`;
    const all = `${identity} ${clean(product.short_description)} ${clean(product.description)}`;
    if (!valid(identity, all) || product.is_in_stock === false) continue;
    const minor = Number(product.prices?.currency_minor_unit ?? 2);
    const price = product.prices?.price != null ? Number(product.prices.price) / (10 ** minor) : null;
    const g = grams(all);
    rows.push({ business, city, businessStatus: 'Doğrulandı', product: clean(product.name), origin: origin(all), grams: g, price: price > 0 ? price : null, stock: 'Stokta', productType: type(all), url: product.permalink, sourceMethod: 'WooCommerce ürün akışı — takip kaydı kurtarma', confidence: g && price ? 'Yüksek' : 'Orta', note: 'Resmî mağazanın canlı WooCommerce ürün akışından çıkarıldı.', catalogStatus: 'Ürün kaydı' });
  }
  return rows;
}

const recovered = [], audit = [];
for (const [business, city, platform, base] of stores) {
  try {
    const endpoint = platform === 'shopify' ? `${base}/products.json?limit=250` : `${base}/wp-json/wc/store/v1/products?per_page=100`;
    const data = await json(endpoint);
    const rows = platform === 'shopify' ? shopifyRows(business, city, base, data) : wooRows(business, city, data);
    recovered.push(...rows);
    audit.push({ business, base, platform, productsRecovered: rows.length, status: rows.length ? 'Ürün eklendi' : 'Kahve ürünü doğrulanamadı' });
  } catch (error) { audit.push({ business, base, platform, productsRecovered: 0, status: `Erişim hatası: ${error.message}` }); }
}

const unique = [...new Map(recovered.map((row) => [`${row.business}|${row.url}|${row.grams}|${row.price}`, row])).values()];
const recoveredBusinesses = new Set(unique.map((row) => row.business));
const preserved = existing.filter((row) => !(recoveredBusinesses.has(row.business) && row.catalogStatus === 'Katalog takip kaydı'));
const existingKeys = new Set(preserved.map((row) => `${row.business}|${row.url}|${row.grams}|${row.price}`));
const added = unique.filter((row) => !existingKeys.has(`${row.business}|${row.url}|${row.grams}|${row.price}`));
await fs.writeFile(sourcePath, JSON.stringify([...preserved, ...added], null, 2), 'utf8');
await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ stores: stores.length, recovered: unique.length, added: added.length, businessesRecovered: recoveredBusinesses.size, audit }, null, 2));
