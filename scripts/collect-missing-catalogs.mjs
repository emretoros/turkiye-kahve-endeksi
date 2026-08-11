import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source', 'broad_products.json');
const auditPath = path.join(root, 'source', 'missing_catalog_audit_2026-08-11.json');
const existing = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const targets = [
  { business: 'Akademi Kahve', url: 'https://academyroastery.com/tr', status: '503 — canlı katalog alınamadı' },
  { business: 'Arabica Coffee House', url: 'https://arabicacoffee.com.tr/urun/cekirdek-kahveler', status: 'Menü sayfası açılıyor; paket gramajı ve çevrim içi satış varyantı doğrulanamadı' },
  { business: 'Baristas Roastery', url: 'https://www.baristasroastery.com/catalog/kahve-cesitleri', status: 'Hedefli HTML çıkarımı' },
  { business: 'Coffee Sapiens', url: 'https://www.coffeesapiens.com/', status: 'Bağlantı sıfırlandı — canlı katalog alınamadı' },
  { business: 'Coffeeizim Coffee Roastery', url: 'https://www.shopier.com/Coffeeizim', status: 'Shopier mağazası üzerinden hedefli HTML çıkarımı' },
  { business: 'der Röster', url: 'http://derroster.com/', status: 'Alan adının süresi dolmuş' },
  { business: 'Espressolab', url: 'https://espressolab.com/alisveris', status: '403 — otomatik erişim engeli' },
  { business: 'Gönül Kahvesi', url: 'https://www.gonulkahve.com/', status: 'Ana sayfadaki doğrulanmış ürün kartları' },
  { business: 'Kafeingo', url: 'https://kafeingo.com/', status: 'İstemci tarafı kabuk; ürün kataloğu HTML içinde yok' },
  { business: 'Kahve Fabrikası', url: 'https://www.kahvefabrikasi.com/kahve', status: 'Hedefli HTML çıkarımı' },
  { business: 'Kronotrop', url: 'https://www.kronotrop.com.tr/alisveris/kategori/kahveler', status: 'Hedefli HTML çıkarımı' },
  { business: 'MeetLab Coffee', url: 'https://www.meetlabcoffee.com/', status: 'Bağlantı sıfırlandı — canlı katalog alınamadı' },
  { business: 'People of Coffee', url: 'https://shop.peopleofcoffee.com.tr/', status: 'Mağaza 500 yanıtı veriyor' },
  { business: 'RoasterLab', url: 'https://roasterlab.com.tr/', status: 'Alan adı DNS üzerinde çözümlenmiyor' },
  { business: 'Sedirkent Coffee', url: 'https://www.sedirkent.com.tr/kategori/kahve-cesitleri', status: 'Kategori açılıyor; sunucu HTML’sinde doğrulanabilir ürün bağlantısı yok' },
  { business: 'Octagon Coffee', url: 'https://octagonroastery.com/', status: 'Ürün kataloğu bulunmayan boş açılış sayfası' },
  { business: 'Punctum Coffee', url: 'https://punctumcoffee.com/', status: 'Başka marka olan puntacoffee.com alanına yönleniyor; veri eklenmedi' }
];

function fetch(url) {
  return execFileSync('curl.exe', ['-sS', '-L', '--max-time', '30', '-A', 'Mozilla/5.0', url], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
  });
}

function decode(value = '') {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&ccedil;/gi, 'ç')
    .replace(/&ouml;/gi, 'ö').replace(/&uuml;/gi, 'ü')
    .replace(/&Ccedil;/g, 'Ç').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

function absolute(base, href) {
  try { return new URL(decode(href).trim(), base).href; } catch { return null; }
}

function links(html, base, predicate) {
  const found = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((match) => absolute(base, match[1]))
    .filter(Boolean).filter(predicate);
  return [...new Set(found)];
}

function productCardLinks(html, base) {
  return [...new Set(
    [...html.matchAll(/<a\s+href=["']([^"']+)["']\s+class=["'][^"']*c-p-i-link[^"']*["']/gi)]
      .map((match) => absolute(base, match[1])).filter(Boolean)
  )];
}

function number(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const parsed = Number(cleaned.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function grams(text) {
  const kg = text.match(/(?:^|\D)(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (kg) return Math.round(number(kg[1]) * 1000);
  const gr = text.match(/(?:^|\D)(\d{2,4})\s*(?:g|gr|gram)\b/i);
  return gr ? Number(gr[1]) : null;
}

function origin(text) {
  const values = [
    ['Etiyopya', /ethiopia|etiyopya/i], ['Kolombiya', /colombia|kolombiya/i],
    ['Brezilya', /brazil|brezilya/i], ['Guatemala', /guatemala/i],
    ['Kenya', /kenya/i], ['Peru', /peru/i], ['Honduras', /honduras/i],
    ['Kosta Rika', /costa rica|kosta rika/i], ['El Salvador', /el salvador/i],
    ['Endonezya', /indonesia|endonezya|sumatra/i], ['Vietnam', /vietnam/i],
    ['Meksika', /mexico|meksika/i], ['Ruanda', /rwanda|ruanda/i], ['Burundi', /burundi/i]
  ];
  return values.find(([, re]) => re.test(text))?.[0] || 'Menşe belirtilmemiş';
}

function priceFrom(html) {
  const patterns = [
    /property=["']product:price:amount["'][^>]*content=["']([\d.,]+)/i,
    /id=["']price-new["'][^>]*>\s*(?:<[^>]+>\s*)?([\d.,]+)/i,
    /"price_legacy_formatted":"([^"]+)"/i,
    /class=["'][^"']*sale-price[^"']*["'][^>]*>\s*([\d.,]+)/i,
    /class=["'][^"']*gk-pd-price[^"']*["'][^>]*>[\s\S]{0,150}?([\d.,]+)\s*(?:TL|₺)/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const parsed = number(match?.[1]);
    if (parsed) return parsed;
  }
  return null;
}

function titleFrom(html, url) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return decode(h1 || og || title || new URL(url).pathname.split('/').pop());
}

function descriptionFrom(html) {
  return decode(
    html.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i)?.[1]
    || html.match(/name=["']description["'][^>]*content=["']([^"']+)/i)?.[1]
    || ''
  );
}

function rowFromPage(business, url, html, sourceMethod) {
  const name = titleFrom(html, url).replace(/\s*[|–-]\s*(Kronotrop|Kahve Fabrikası|Baristas Roastery).*$/i, '').trim();
  const description = descriptionFrom(html);
  const all = `${name} ${description} ${decode(html.slice(0, 120000))}`;
  const coffeeSignal = /kahve|coffee|espresso|filtre|çekirdek|cekirdek|ethiopia|colombia|brazil|kenya|peru|guatemala|honduras|costa rica|el salvador|vietnam/i;
  const excluded = /ekipman|dripper|aeropress|cezve|fincan|kupa|termos|t-shirt|hoodie|hot chocolate|sıcak çikolata|sicak cikolata|aboneliği otomatik kahve makinesi/i;
  if (!coffeeSignal.test(`${name} ${description} ${url}`) || excluded.test(`${name} ${url}`)) return null;
  // Gramajı tüm sayfadan okumak; rakım, üretim kapasitesi veya önerilen ürün
  // gramajını yanlışlıkla ana varyant sanabilir. Yalnızca başlık/açıklama kullanılır.
  const g = grams(`${name} ${description}`);
  const price = priceFrom(html);
  return {
    business, city: 'İstanbul', businessStatus: 'Doğrulandı', product: name,
    origin: origin(`${name} ${description}`), grams: g, price,
    stock: /out.of.stock|stokta yok|tükendi/i.test(html) ? 'Stokta yok' : 'Stokta',
    productType: /blend|harman/i.test(`${name} ${description}`) ? 'Harman' : /türk kahvesi/i.test(name) ? 'Türk kahvesi' : 'Kahve ürünü',
    url, sourceMethod, confidence: g && price ? 'Yüksek' : price ? 'Orta' : 'Düşük',
    note: 'Özel mağaza altyapısındaki canlı ürün sayfasından çıkarıldı.', catalogStatus: 'Ürün kaydı'
  };
}

const collected = [];
const counts = {};

async function crawl({ business, starts, linkTest, sourceMethod, extractLinks }) {
  const urls = new Set();
  for (const start of starts) {
    const html = fetch(start);
    const discovered = extractLinks ? extractLinks(html, start) : links(html, start, linkTest);
    for (const url of discovered.filter(linkTest)) urls.add(url);
  }
  for (const url of urls) {
    try {
      const row = rowFromPage(business, url, fetch(url), sourceMethod);
      if (row) collected.push(row);
    } catch {}
  }
  counts[business] = collected.filter((row) => row.business === business).length;
}

await crawl({
  business: 'Baristas Roastery', starts: ['https://www.baristasroastery.com/catalog/kahve-cesitleri'],
  linkTest: (url) => /baristasroastery\.com\/product\/kahve-cesitleri\//i.test(url), sourceMethod: 'Özel katalog HTML taraması'
});

await crawl({
  business: 'Kronotrop', starts: ['https://www.kronotrop.com.tr/alisveris/kategori/kahveler'],
  linkTest: (url) => /kronotrop\.com\.tr\/alisveris\/urun\//i.test(url) && !/makinesi|ekipman|dripper|cezve|aeropress/i.test(url),
  sourceMethod: 'Kronotrop kahve kategorisi HTML taraması'
});

await crawl({
  business: 'Kahve Fabrikası', starts: ['https://www.kahvefabrikasi.com/kahve'],
  linkTest: (url) => /kahvefabrikasi\.com\//i.test(url), extractLinks: productCardLinks,
  sourceMethod: 'Kahve Fabrikası kategori HTML taraması'
});

counts['Sedirkent Coffee'] = 0;

const shopier = fetch('https://www.shopier.com/Coffeeizim');
const shopierLinks = links(shopier, 'https://www.shopier.com/Coffeeizim', (url) => /shopier\.com\/Coffeeizim\/\d+/i.test(url));
for (const url of shopierLinks) {
  try {
    const row = rowFromPage('Coffeeizim Coffee Roastery', url, fetch(url), 'Shopier canlı ürün sayfası');
    if (row) collected.push(row);
  } catch {}
}
counts['Coffeeizim Coffee Roastery'] = collected.filter((row) => row.business === 'Coffeeizim Coffee Roastery').length;

for (const row of [
  ['Türk Kahvesi', 1000, 700], ['Filtre Kahve', 1000, 800], ['Espresso', 1000, 800]
]) {
  collected.push({
    business: 'Gönül Kahvesi', city: 'İstanbul', businessStatus: 'Doğrulandı', product: row[0],
    origin: 'Menşe belirtilmemiş', grams: row[1], price: row[2], stock: 'Sipariş verilebilir',
    productType: row[0] === 'Türk Kahvesi' ? 'Türk kahvesi' : 'Kahve ürünü', url: 'https://www.gonulkahve.com/#urunler',
    sourceMethod: 'Ana sayfa ürün kartı', confidence: 'Yüksek',
    note: 'Canlı ürün kartındaki gramaj ve fiyat birlikte doğrulandı.', catalogStatus: 'Ürün kaydı'
  });
}
counts['Gönül Kahvesi'] = 3;

const dedupedCollected = [...new Map(collected.map((row) => [`${row.business}|${row.url}|${row.grams}|${row.price}`, row])).values()];
const replacedBusinesses = new Set(dedupedCollected.map((row) => row.business));
const preserved = existing.filter((row) => !(replacedBusinesses.has(row.business) && row.catalogStatus === 'Katalog takip kaydı'));
const existingKeys = new Set(preserved.map((row) => `${row.business}|${row.url}|${row.grams}|${row.price}`));
const added = dedupedCollected.filter((row) => !existingKeys.has(`${row.business}|${row.url}|${row.grams}|${row.price}`));

await fs.writeFile(sourcePath, JSON.stringify([...preserved, ...added], null, 2), 'utf8');
await fs.writeFile(auditPath, JSON.stringify(targets.map((target) => ({
  ...target, productsAdded: added.filter((row) => row.business === target.business).length
})), null, 2), 'utf8');

console.log(JSON.stringify({ candidates: targets.length, extracted: dedupedCollected.length, added: added.length, counts }, null, 2));
