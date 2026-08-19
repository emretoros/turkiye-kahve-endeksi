/**
 * Fiyat denetimi — karantina kurallarını mevcut kaynağa uygular ve rapor üretir.
 *
 * Kullanım:
 *   node scripts/audit-prices.mjs                  # rapor üret
 *   node scripts/audit-prices.mjs --write-clean    # temizlenmiş kopya da yaz
 *
 * Çıktılar:
 *   source/price_audit_<tarih>.json  — satır düzeyinde bayraklar
 *   source/price_audit_<tarih>.md    — okunabilir özet
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyPriceRules } from './lib/price-rules.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'source', 'broad_products.json');
const stamp = process.env.AUDIT_DATE || new Date().toISOString().slice(0, 10);
const writeClean = process.argv.includes('--write-clean');

const rows = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const { rows: audited, summary } = applyPriceRules(rows);

const quarantined = audited.filter((row) => row.quarantined);
const review = audited.filter((row) => row.review);

const tr = new Intl.NumberFormat('tr-TR');
const pct = (part, whole) => whole ? `%${(100 * part / whole).toFixed(1)}` : '—';

const businessTable = Object.entries(summary.byBusiness)
  .sort((a, b) => b[1] - a[1])
  .map(([business, count]) => `| ${business} | ${count} |`)
  .join('\n');

const ruleTable = Object.entries(summary.byRule)
  .sort((a, b) => b[1] - a[1])
  .map(([rule, count]) => `| \`${rule}\` | ${tr.format(count)} |`)
  .join('\n');

const sample = quarantined.slice(0, 25).map((row) => {
  const reason = row.flags.map((flag) => flag.rule).join(', ');
  return `| ${row.business} | ${(row.product || '').slice(0, 46)} | ${row.grams ?? '—'} | ${row.price} | ${reason} |`;
}).join('\n');

const markdown = `# Fiyat denetim raporu — ${stamp}

Kaynak: \`source/broad_products.json\` (${tr.format(summary.total)} satır)

## Özet

| | Satır | Oran |
|---|---:|---:|
| Fiyatı olan | ${tr.format(summary.withPrice)} | ${pct(summary.withPrice, summary.total)} |
| **Karantina** (yayınlanmaz) | **${tr.format(summary.quarantined)}** | ${pct(summary.quarantined, summary.withPrice)} |
| İnceleme kuyruğu | ${tr.format(summary.review)} | ${pct(summary.review, summary.withPrice)} |
| Temiz | ${tr.format(summary.withPrice - summary.quarantined - summary.review)} | ${pct(summary.withPrice - summary.quarantined - summary.review, summary.withPrice)} |

## Kural bazında

| Kural | Tetiklenme |
|---|---:|
${ruleTable}

## Karantinaya giren satırların işletme dağılımı

| İşletme | Satır |
|---|---:|
${businessTable}

## Örnek satırlar (ilk 25)

| İşletme | Ürün | Gramaj | Fiyat | Kural |
|---|---|---:|---:|---|
${sample}

---
Karantina = veri silinmez, \`is_quarantined=1\` ile saklanır; sitede ve endekste kullanılmaz.
`;

const jsonOut = {
  auditedAt: stamp,
  summary,
  quarantined: quarantined.map((row) => ({
    business: row.business,
    product: row.product,
    grams: row.grams,
    price: row.price,
    url: row.url,
    sourceMethod: row.sourceMethod,
    flags: row.flags
  })),
  review: review.map((row) => ({
    business: row.business,
    product: row.product,
    grams: row.grams,
    price: row.price,
    url: row.url,
    sourceMethod: row.sourceMethod,
    flags: row.flags
  }))
};

await fs.writeFile(path.join(root, 'source', `price_audit_${stamp}.json`), JSON.stringify(jsonOut, null, 2), 'utf8');
await fs.writeFile(path.join(root, 'source', `price_audit_${stamp}.md`), markdown, 'utf8');

if (writeClean) {
  const clean = audited.map(({ flags, quarantined: q, review: r, ...row }) =>
    q ? { ...row, price: null, priceQuarantined: true, priceQuarantineReason: flags.map((f) => f.rule).join(',') } : row);
  await fs.writeFile(path.join(root, 'source', `broad_products.clean_${stamp}.json`), JSON.stringify(clean, null, 2), 'utf8');
}

console.log(JSON.stringify({
  total: summary.total,
  withPrice: summary.withPrice,
  quarantined: summary.quarantined,
  review: summary.review,
  byRule: summary.byRule
}, null, 2));
