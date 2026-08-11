import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source/broad_products.json');
const auditPath = path.join(root, 'source/new_roaster_ingestion_2026-08-11.json');
const existing = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const candidates = [
  ['Wayta Coffee', null, 'woo', 'https://waytacoffee.com/'],
  ['Niji Coffee Co.', null, null, 'https://nijicoffeeco.net/'],
  ['Shady Coffee Roastery', null, 'woo', 'https://shady.com.tr/'],
  ['Tone Coffee Roastery Co.', null, 'shopify', 'https://tonecoffeeroastery.co/'],
  ['Rawtown Coffee Roastery', null, 'shopify', 'https://rawtowncoffee.com/'],
  ['Kruen Roastery', null, 'shopify', 'https://kruenroastery.com/'],
  ['Récolte Coffee Roastery', null, null, 'https://recoltecoffee.com/'],
  ['Gordion Coffee Roastery', null, null, 'https://gordioncoffee.com/'],
  ['Buegros Coffee Roastery', null, 'woo', 'https://buegros.com/'],
  ['Ultra Coffee Roastery', null, null, 'http://ultracoffeeroastery.com/'],
  ['Grizzly Coffee Roasters', null, null, 'https://espressoperfetto.com/'],
  ['Con Tu Coffee Roastery', null, 'woo', 'https://contucoffee.com/'],
  ['Trophy Coffee Roastery', null, 'woo', 'https://trophycoffee.com.tr/'],
  ['Lot Coffee Roastery', null, null, 'https://lotcoffeeroastery.com/'],
  ['Zümrüt Karaca Coffee Roastery', null, 'shopify', 'https://zumrutkaraca.com/'],
  ['Vitus Coffee & Roastery', null, null, 'https://vituscoffee.com/'],
  ['3 Cores Coffee & Roastery', null, null, 'https://3coresroastery.com/'],
  ['Terazi Coffee & Roastery', null, 'woo', 'https://terazicoffee.com.tr/'],
  ['Kungpow Coffee', null, null, 'https://kungpowcoffee.com/'],
  ['Strong Coffee Beans', null, null, 'https://strongcoffeebeans.com/'],
  ['Caffé Di Toeé', null, null, 'https://caffeditoee.com/'],
  ['Logra Coffee Roastery', null, null, 'https://logra.com.tr/'],
  ['Fabriek Coffee', null, 'shopify', 'https://fabriekcoffee.com/'],
  ['Fil Coffee Roaster', null, 'woo', 'https://filcoffee.com/'],
  ['Specific Coffee', null, 'woo', 'https://specific.coffee/']
];

const coffeeSignal = /kahve|coffee|espresso|filtre|çekirdek|cekirdek|bean|türk kahvesi|turk kahvesi|decaf|blend|ethiopia|etiyopya|colombia|kolombiya|brazil|brezilya|guatemala|kenya|peru|honduras|costa rica|el salvador|rwanda|ruanda|burundi|sumatra|vietnam/i;
const excluded = /ekipman|equipment|dripper|server|kupa|mug|fincan|cezve|termos|tumbler|değirmen|grinder|filtre kağıdı|filter paper|aeropress|chemex|hario|kettle|tamper|bardak|başlangıç seti|çikolata|chocolate|lokum|draje|şurup|syrup|çay|tea|salep|frappe|kurabiye|cookie|sabun|kolonya|mum|candle|t-shirt|hoodie|çanta|canta|aksesuar|sandviç|pasta|kruvasan|croissant|eğitim|training|workshop/i;

async function getJson(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const clean = (value = '') => String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
function grams(text) { const kg = text.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s*kg\b/i); if (kg) return Math.round(Number(kg[1].replace(',', '.')) * 1000); const gr = text.match(/(?:^|\D)(\d{2,4})\s*(?:g|gr|gram)\b/i); return gr ? Number(gr[1]) : null; }
function origin(text) { const countries = [['Etiyopya',/ethiopia|etiyopya/i],['Kolombiya',/colombia|kolombiya/i],['Brezilya',/brazil|brezilya/i],['Guatemala',/guatemala/i],['Kenya',/kenya/i],['Peru',/peru/i],['Honduras',/honduras/i],['Kosta Rika',/costa rica|kosta rika/i],['El Salvador',/el salvador/i],['Ruanda',/rwanda|ruanda/i],['Burundi',/burundi/i],['Endonezya',/indonesia|endonezya|sumatra/i],['Vietnam',/vietnam/i]]; return countries.find(([, re]) => re.test(text))?.[0] || 'Menşe belirtilmemiş'; }
const productType = (text) => /türk kahvesi|turk kahvesi/i.test(text) ? 'Türk kahvesi' : /blend|harman/i.test(text) ? 'Harman' : 'Kahve ürünü';
const valid = (identity, detail = '') => coffeeSignal.test(`${identity} ${detail}`) && !excluded.test(identity);
const common = (business, city, product, all, g, price, url, method, stock = 'Stokta') => ({ business, city, businessStatus: 'Doğrulandı', product: clean(product), origin: origin(all), grams: g, price, stock, productType: productType(all), url, sourceMethod: method, confidence: g && price ? 'Yüksek' : 'Orta', note: 'Resmî mağazanın canlı ürün akışından çıkarıldı.', catalogStatus: 'Ürün kaydı' });

function shopifyRows(business, city, base, data) {
  const rows = [];
  for (const product of data.products || []) {
    const identity = `${product.title} ${product.product_type || ''} ${(product.tags || []).join?.(' ') || product.tags || ''}`;
    const detail = clean(product.body_html);
    if (!valid(identity, detail)) continue;
    const variants = (product.variants || []).filter((v) => v.available !== false);
    const seen = new Set();
    for (const variant of variants.length ? variants : [{}]) {
      const g = grams(`${variant.title || ''} ${product.title} ${detail.slice(0, 1200)}`);
      const price = Number(variant.price) > 0 ? Number(variant.price) : null;
      const key = `${g}|${price}`; if (seen.has(key)) continue; seen.add(key);
      rows.push(common(business, city, product.title, `${identity} ${detail}`, g, price, `${base.replace(/\/$/, '')}/products/${product.handle}`, 'Shopify ürün akışı — yeni firma keşfi', variants.length ? 'Stokta' : 'Belirsiz'));
    }
  }
  return rows;
}

function wooRows(business, city, data) {
  const rows = [];
  for (const product of Array.isArray(data) ? data : []) {
    const categories = (product.categories || []).map((x) => x.name).join(' ');
    const identity = `${product.name} ${categories}`;
    const detail = `${clean(product.short_description)} ${clean(product.description)}`;
    if (!valid(identity, detail) || product.is_in_stock === false) continue;
    const minor = Number(product.prices?.currency_minor_unit ?? 2);
    const price = product.prices?.price != null ? Number(product.prices.price) / (10 ** minor) : null;
    rows.push(common(business, city, product.name, `${identity} ${detail}`, grams(`${identity} ${detail}`), price > 0 ? price : null, product.permalink, 'WooCommerce ürün akışı — yeni firma keşfi'));
  }
  return rows;
}

const names = new Set(candidates.map(([name]) => name));
const collected = [], audit = [];
for (const [business, city, platform, base] of candidates) {
  if (!platform) { audit.push({ business, base, status: 'Resmî site doğrulandı; otomatik ürün akışı bulunamadı', products: 0 }); continue; }
  try {
    const endpoint = platform === 'shopify' ? `${base.replace(/\/$/, '')}/products.json?limit=250` : `${base.replace(/\/$/, '')}/wp-json/wc/store/v1/products?per_page=100`;
    const data = await getJson(endpoint);
    const rows = platform === 'shopify' ? shopifyRows(business, city, base, data) : wooRows(business, city, data);
    collected.push(...rows); audit.push({ business, base, platform, status: rows.length ? 'Ürünler eklendi' : 'Akışta uygun kahve ürünü bulunamadı', products: rows.length });
  } catch (error) { audit.push({ business, base, platform, status: `Erişim hatası: ${error.message}`, products: 0 }); }
}

const unique = [...new Map(collected.map((row) => [`${row.business}|${row.url}|${row.grams}|${row.price}`, row])).values()];
const withProducts = new Set(unique.map((row) => row.business));
const placeholders = candidates.filter(([business]) => !withProducts.has(business)).map(([business, city, , base]) => ({ business, city, businessStatus: 'Site doğrulandı', product: 'Ayrıntılı ürün verisine erişilemedi', origin: 'Menşe belirtilmemiş', grams: null, price: null, stock: 'Belirsiz', productType: 'Kahve ürünü', url: base, sourceMethod: 'Yeni firma keşfi — resmî site', confidence: 'Orta', note: 'Firma ve resmî site doğrulandı; ürün kataloğu sonraki tarama için takip kaydına alındı.', catalogStatus: 'Katalog takip kaydı' }));
const preserved = existing.filter((row) => !names.has(row.business));
await fs.writeFile(sourcePath, JSON.stringify([...preserved, ...unique, ...placeholders], null, 2), 'utf8');
await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ candidates: candidates.length, businessesWithProducts: withProducts.size, products: unique.length, placeholders: placeholders.length, audit }, null, 2));
