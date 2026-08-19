/**
 * Kalıcı ürün/varyant kimliği.
 *
 * Kimlik şelalesi:
 *   1. platform kimliği  — platform:host:productId:variantId   (en sağlam)
 *   2. URL yolu          — url:host/path#grams                 (platform id yoksa)
 *   3. aday eşleştirme   — insan onayı gerektirir (identity_candidate)
 *
 * Kural: bir varyant bir kez kimlik aldıysa, ürün adı veya URL'i değişse bile
 * aynı kimlikte kalır. Bu yüzden anahtar ada ve fiyata ASLA bakmaz.
 */

export const normalize = (value) => String(value || '')
  .toLocaleLowerCase('tr-TR')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/ı/g, 'i')
  .replace(/\s+/g, ' ')
  .trim();

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

export function pathOf(url) {
  try { return new URL(url).pathname.replace(/\/+$/, '').toLowerCase() || '/'; } catch { return ''; }
}

/**
 * Varyant için kimlik anahtarı üretir.
 * @returns {{key: string, tier: 1|2|3}}
 */
export function variantKey(record) {
  const host = record.host || hostOf(record.url);
  if (record.platform && record.platformProductId) {
    const variant = record.platformVariantId ?? 'default';
    return { key: `p1:${record.platform}:${host}:${record.platformProductId}:${variant}`, tier: 1 };
  }
  const path = record.urlPath || pathOf(record.url);
  if (path) {
    const suffix = [record.grams ?? '', record.optionSignature ?? ''].join('/');
    return { key: `p2:${host}${path}#${suffix}`, tier: 2 };
  }
  return { key: `p3:${host}:${normalize(record.productName)}#${record.grams ?? ''}`, tier: 3 };
}

/** Ürün düzeyi anahtar (varyantlardan bağımsız). */
export function productKey(record) {
  const host = record.host || hostOf(record.url);
  if (record.platform && record.platformProductId) {
    return { key: `p1:${record.platform}:${host}:${record.platformProductId}`, tier: 1 };
  }
  const path = record.urlPath || pathOf(record.url);
  if (path) return { key: `p2:${host}${path}`, tier: 2 };
  return { key: `p3:${host}:${normalize(record.productName)}`, tier: 3 };
}

const GRAM_UNITS = /(?:^|[^a-zçğıöşü0-9])(\d+(?:[.,]\d+)?)\s*(kg|kilo|g|gr|gram)(?![a-zçğıöşü])/gi;

/**
 * Ambalaj gramajını çıkarır.
 *
 * Mevcut scraper'daki hatanın kaynağı: açıklama metnindeki demleme dozunu
 * ("12 g kahve kullanın") ambalaj sanması. Burada yalnızca varyant/başlık
 * metnine bakıyoruz ve makul ambalaj bandına düşmeyen değerleri reddediyoruz.
 */
export function parseGrams(text, { min = 50, max = 6000 } = {}) {
  const candidates = [];
  for (const match of String(text || '').matchAll(GRAM_UNITS)) {
    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount)) continue;
    const unit = match[2].toLowerCase();
    const grams = unit === 'kg' || unit === 'kilo' ? Math.round(amount * 1000) : Math.round(amount);
    if (grams >= min && grams <= max) candidates.push(grams);
  }
  if (!candidates.length) return null;
  // Birden fazla aday varsa en büyüğü ambalajdır (ör. "250 g / 12 g doz").
  return Math.max(...candidates);
}

const GRIND = [
  ['cekirdek', /(cekirdek|ogutulmemis|whole bean|tane)/],
  ['french-press', /(french press|frenc)/],
  ['filtre', /(filtre|v60|chemex|pour ?over|dripper)/],
  ['espresso', /espresso/],
  ['moka', /(moka|mokapot)/],
  ['turk', /(turk kahvesi|turk)/],
  ['soguk', /(cold brew|soguk)/]
];

/** Gramaj dışındaki varyant eksenini tek bir imzaya indirger. */
export function optionSignature(text) {
  const value = normalize(text);
  if (!value) return '';
  const hits = GRIND.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
  return hits.length ? hits.sort().join('+') : '';
}
