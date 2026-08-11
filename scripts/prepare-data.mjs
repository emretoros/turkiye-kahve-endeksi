import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.resolve(root, 'source');
const products = JSON.parse(await fs.readFile(path.join(sourceRoot, 'broad_products.json'), 'utf8'));
const publicData = path.join(root, 'public', 'data');
const downloads = path.join(root, 'public', 'downloads');
await fs.mkdir(publicData, { recursive: true });
await fs.mkdir(downloads, { recursive: true });

const cleaned = products.map((row, index) => ({
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
  checkedAt: '2026-08-11'
}));

const businesses = [...new Set(cleaned.map((row) => row.business))].sort((a, b) => a.localeCompare(b, 'tr'));
const metadata = {
  checkedAt: '2026-08-11',
  totalRows: cleaned.length,
  businesses: businesses.length,
  namedProducts: cleaned.filter((row) => row.catalogStatus === 'Ürün kaydı').length,
  origins: new Set(cleaned.map((row) => row.origin)).size
};

await fs.writeFile(path.join(publicData, 'products.json'), JSON.stringify(cleaned));
await fs.writeFile(path.join(publicData, 'metadata.json'), JSON.stringify(metadata, null, 2));

const headers = ['İşletme','Doğrulama','Ürün','Menşe','Gramaj (g)','Fiyat (TL)','TL/kg','Stok','Kaynak bağlantısı','Kontrol tarihi'];
const quote = (value) => `"${String(value ?? 'Erişilemedi').replaceAll('"', '""')}"`;
const csv = [headers, ...cleaned.map((row) => [row.business,row.businessStatus,row.product,row.origin,row.grams,row.price,row.pricePerKg,row.stock,row.url,row.checkedAt])]
  .map((row) => row.map(quote).join(';')).join('\n');
await fs.writeFile(path.join(downloads, 'kahve-endeksi.csv'), `\uFEFF${csv}`);
await fs.copyFile(
  path.join(sourceRoot, 'turkiye_151_isletme_filtresiz_kahve_urun_endeksi.xlsx'),
  path.join(downloads, 'kahve-endeksi.xlsx')
);

console.log(JSON.stringify(metadata));
