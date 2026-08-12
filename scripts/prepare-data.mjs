import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.resolve(root, 'source');
const products = JSON.parse(await fs.readFile(path.join(sourceRoot, 'broad_products.json'), 'utf8'));
const publicData = path.join(root, 'public', 'data');
const downloads = path.join(root, 'public', 'downloads');
await fs.mkdir(publicData, { recursive: true });
await fs.mkdir(downloads, { recursive: true });

const normalize = (value) => String(value || '')
  .toLocaleLowerCase('tr-TR')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i');

const nonCoffeeRules = [
  ['Ekipman/aksesuar', /\b(server|dripper|chemex|aeropress|v60|phin filtre|filtre kagidi|filter paper|degirmen|ogutucu|tarti|scale|kettle|tamper|tamper mati|pitcher|ibrik|ibrigi|demleme seti|demleyici|olcu kasigi|kahve torbasi|seramik kupa|kahve kupasi|termos|difluid|refraktometre|analizor|pin\b)/],
  ['Çay ve içecek tozu', /\b(adacay|cay|tea|matcha|salep|sahlep|frappe|smoothie|milkshake|hindiba|chicory)/],
  ['Şurup', /\b(surup|surub|syrup)/],
  ['Çikolata/şekerleme', /\b(cikolata bari?|bean to bar|madlen|draje|lokum|sekerleme|bonte|roche|cookie|kurabiye|granola)\b/],
  ['Gıda dışı ürün', /\b(kolonya|sabun|t-shirt|tisort|canta)/],
  ['Eğitim/hizmet', /\b(egitim|course|sertifikasyon|workshop|q grader|sensory skills|kahve hasadi turu|kahve turu|bookeasy|barista egitimi|promosyon kahve)/],
  ['Kavrulmamış kahve', /\b(yesil kahve|yesil kahve cekirdegi|yesil cekirdek|green coffee)/],
  ['Sos/püre', /\b(pure|puree|sos|cool lime)/],
  ['Diğer gıda', /\b(hindistan cevizi|pirinc|chia|corekotu|hibiskus|tuz|kakule|karabiber|karanfil|karbonat|karabugday|keten tohumu|kimyon|kinoa|nar eksisi|nohut unu|tarcin|zencefil|zerdecal)\b/]
];

const exclusionReason = (row) => {
  const haystack = normalize(`${row.product} ${row.url || ''}`);

  // “Çikolatalı kahve” bir kahve ürünüdür; çikolata barı ve sıcak çikolata değildir.
  if (/\b(sicak cikolata|cikolata kalibi|paper chocolate)\b/.test(haystack)) {
    return 'Çikolata/şekerleme';
  }
  if (/\bcikolata\b/.test(haystack) && !/\b(kahve|filtre|turk|dibek|aromali|espresso)\b/.test(haystack)) {
    return 'Çikolata/şekerleme';
  }

  for (const [reason, pattern] of nonCoffeeRules) {
    if (pattern.test(haystack)) return reason;
  }

  // Katalog taramasına ürün yerine haber/kurumsal sayfa karışmış kayıtlar.
  if (/basarisini kalite oduluyle percinledi/.test(haystack)) return 'Ürün olmayan sayfa';
  return null;
};

const excluded = products
  .map((row) => ({ ...row, exclusionReason: exclusionReason(row) }))
  .filter((row) => row.exclusionReason);

const placeholderBusinesses = new Set();
const coffeeProducts = products.filter((row) => {
  if (exclusionReason(row)) return false;

  if (row.catalogStatus === 'Katalog takip kaydı') {
    const businessKey = normalize(row.business);
    if (placeholderBusinesses.has(businessKey)) return false;
    placeholderBusinesses.add(businessKey);
  }

  return true;
});

const cleaned = coffeeProducts.map((row, index) => ({
  id: index + 1,
  business: row.business,
  city: row.city || null,
  businessStatus: row.businessStatus,
  product: row.product,
  origin: row.origin || 'Menşe belirtilmemiş',
  grams: Number.isFinite(row.grams) && row.grams > 0 ? row.grams : null,
  price: Number.isFinite(row.price) && row.price > 0 ? row.price : null,
  pricePerKg: Number.isFinite(row.grams) && row.grams > 0 && Number.isFinite(row.price) && row.price > 0
    ? Math.round((row.price / row.grams) * 100000) / 100
    : null,
  stock: row.stock || 'Belirsiz',
  productType: row.productType,
  url: row.url || null,
  sourceMethod: row.sourceMethod,
  confidence: row.confidence,
  catalogStatus: row.catalogStatus,
  note: row.note,
  aliases: Array.isArray(row.aliases) ? row.aliases : [],
  instagram: row.instagram || null,
  discoveryChannels: Array.isArray(row.discoveryChannels) ? row.discoveryChannels : [],
  checkedAt: row.checkedAt || '2026-08-11'
}));

const businesses = [...new Set(cleaned.map((row) => row.business))].sort((a, b) => a.localeCompare(b, 'tr'));
const checkedAt = cleaned.map((row) => row.checkedAt).sort().at(-1) || '2026-08-11';
const metadata = {
  checkedAt,
  totalRows: cleaned.length,
  excludedRows: excluded.length,
  exclusions: excluded.reduce((counts, row) => {
    counts[row.exclusionReason] = (counts[row.exclusionReason] || 0) + 1;
    return counts;
  }, {}),
  businesses: businesses.length,
  namedProducts: cleaned.filter((row) => row.catalogStatus === 'Ürün kaydı').length,
  trackingRecords: cleaned.filter((row) => row.catalogStatus === 'Katalog takip kaydı').length,
  origins: new Set(cleaned.map((row) => row.origin)).size
};

await fs.writeFile(path.join(publicData, 'products.json'), JSON.stringify(cleaned));
await fs.writeFile(path.join(publicData, 'metadata.json'), JSON.stringify(metadata, null, 2));

console.log(JSON.stringify(metadata));
