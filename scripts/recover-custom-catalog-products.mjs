import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source/broad_products.json');
const auditPath = path.join(root, 'source/custom_catalog_product_recovery_2026-08-11.json');
const existing = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const stores = [
  ['A4 Kahve', 'İstanbul', 'https://a4kahve.com/kahve-cekirdekleri', /a4kahve\.com\//i, /kahve-cekirdekleri$|\/pages\/|account|blog/i],
  ['Calibre Coffee', 'İstanbul', 'https://coffeecalibre.com/cekirdek-kahve', /coffeecalibre\.com\//i, /cekirdek-kahve$|tadim-setleri|yesil-cekirdek|ekipman|cikolata|kitap|giyim|\/pages\/|account/i],
  ['Federal Coffee', 'İstanbul', 'https://federal.coffee/urunler', /federal\.coffee\//i, /\/urunler$|\/kahveler$|\/suruplar|\/ekipman|chemex|account|\/de\/|\/en\//i],
  ['Gourme Coffee', null, 'https://gourmecoffee.com/kahveler', /gourmecoffee\.com\//i, /\/kahveler$|\/filtre-kahveler$|\/turk-kahvesi$|\/espresso$|makine|ekipman|kupa|account/i],
  ['MOC Coffee Roastery', 'İstanbul', 'https://moc.com.tr/cekirdek-kahveler', /moc\.com\.tr\//i, /\/cekirdek-kahveler$|\/tum-urunler$|\/kapsul|\/cig-|aksesuar|surup|frappe|yiyecek|termos|tozlari|caylari|egitim|account/i],
  ['Nitka Coffee', null, 'https://nitkacoffee.com/pages/cekirdek-kahveler', /nitkacoffee\.com\//i, /\/pages\/|account|filtre-kagidi/i]
  ,['Hound Coffee', 'İstanbul', 'https://houndcoffee.com/kahveler', /houndcoffee\.com\//i, /\/kahveler$|\/tum-urunler$|\/filtre-kahve$|\/espresso$|\/kapsul|ekipman|hounding|\/pages\/|account|search/i]
  ,['Kafein Kültür', null, 'https://www.kafeinkultur.com/nitelikli-kahve', /kafeinkultur\.com\//i, /nitelikli-kahve$|\/urunler$|\/icerik\//i]
];

async function text(url) { const response = await fetch(url.replace(/&amp;/g, '&'), { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } }); if (!response.ok) throw new Error(String(response.status)); return response.text(); }
function clean(value = '') { return String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim(); }
function grams(value = '') { const decoded = decodeURIComponent(String(value).replace(/\+/g, ' ')); const kg = decoded.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s*kg\b/i); if (kg) return Math.round(Number(kg[1].replace(',', '.')) * 1000); const gr = decoded.match(/(?:^|\D)(\d{2,4})\s*(?:g|gr|gram)\b/i); return gr ? Number(gr[1]) : null; }
function origin(textValue) { const values = [['Etiyopya',/ethiopia|etiyopya/i],['Kolombiya',/colombia|kolombiya/i],['Brezilya',/brazil|brezilya/i],['Guatemala',/guatemala/i],['Kenya',/kenya/i],['Peru',/peru/i],['Honduras',/honduras/i],['Kosta Rika',/costa rica|kosta rika/i],['El Salvador',/el salvador/i],['Ruanda',/rwanda|ruanda/i],['Burundi',/burundi/i],['Endonezya',/indonesia|endonezya|sumatra/i]]; return values.find(([, re]) => re.test(textValue))?.[0] || 'Menşe belirtilmemiş'; }
function links(html, base, include, exclude) { return [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { return null; } }).filter((url) => url && include.test(url) && !exclude.test(url) && !/\.(css|js|png|jpg|jpeg|webp|svg|ico|woff|pdf)(\?|$)/i.test(url)))]; }
function productNodes(html) { const nodes = []; for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { const parsed = JSON.parse(match[1]); const stack = Array.isArray(parsed) ? parsed : [parsed]; for (const item of stack) for (const node of item?.['@graph'] || [item]) if (/Product/i.test(Array.isArray(node?.['@type']) ? node['@type'].join(' ') : node?.['@type'] || '')) nodes.push(node); } catch {} } return nodes; }

const recovered = [], audit = [];
for (const [business, city, category, include, exclude] of stores) {
  let urls = [], errors = 0;
  try { urls = links(await text(category), category, include, exclude); } catch { errors++; }
  for (const pageUrl of urls) {
    try {
      const html = await text(pageUrl);
      for (const node of productNodes(html)) {
        const name = clean(node.name) || clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
        const description = clean(node.description);
        if (!name || !/kahve|coffee|espresso|filtre|türk|turk|ethiopia|etiyopya|colombia|kolombiya|brazil|brezilya|kenya|peru|guatemala|honduras|burundi|costa rica|kosta rika|nicaragua/i.test(`${name} ${description} ${pageUrl}`)) continue;
        const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [{}];
        const seen = new Set();
        for (const offer of offers) {
          const url = offer.url || node.url || pageUrl;
          const price = Number(offer.price || offer.lowPrice) > 0 ? Number(offer.price || offer.lowPrice) : null;
          const g = grams(`${url} ${pageUrl} ${name} ${description.slice(0, 500)}`);
          const key = `${g}|${price}`; if (seen.has(key)) continue; seen.add(key);
          const stock = /OutOfStock/i.test(offer.availability || '') ? 'Stokta yok' : 'Stokta';
          if (stock === 'Stokta yok') continue;
          recovered.push({ business, city, businessStatus: 'Doğrulandı', product: name, origin: origin(`${name} ${description}`), grams: g, price, stock, productType: /türk kahvesi|turk kahvesi/i.test(name) ? 'Türk kahvesi' : /blend|harman/i.test(name) ? 'Harman' : 'Kahve ürünü', url, sourceMethod: 'Özel katalog JSON-LD — takip kaydı kurtarma', confidence: g && price ? 'Yüksek' : price ? 'Orta' : 'Düşük', note: 'Resmî kategori ve ürün sayfasındaki yapılandırılmış veriden çıkarıldı.', catalogStatus: 'Ürün kaydı' });
        }
      }
    } catch { errors++; }
  }
  audit.push({ business, category, productLinks: urls.length, recovered: recovered.filter((row) => row.business === business).length, errors });
}

const unique = [...new Map(recovered.map((row) => [`${row.business}|${row.url}|${row.grams}|${row.price}`, row])).values()];
const businesses = new Set(unique.map((row) => row.business));
const preserved = existing.filter((row) => !(businesses.has(row.business) && row.catalogStatus === 'Katalog takip kaydı'));
const keys = new Set(preserved.map((row) => `${row.business}|${row.url}|${row.grams}|${row.price}`));
const added = unique.filter((row) => !keys.has(`${row.business}|${row.url}|${row.grams}|${row.price}`));
await fs.writeFile(sourcePath, JSON.stringify([...preserved, ...added], null, 2), 'utf8');
await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ recovered: unique.length, added: added.length, businesses: businesses.size, audit }, null, 2));
