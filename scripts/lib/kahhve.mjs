import {hostOf, pathOf, optionSignature, normalize} from './identity.mjs';

// The shop's own catalog UI uses this public read-only endpoint. Always pass
// one brand: a shared retailer host must never become every brand's catalog.
export function kahhveBrandSlug(catalogUrl) {
  const url = new URL(catalogUrl);
  if (hostOf(catalogUrl) !== 'kahhve.com' || !/^\/[a-z0-9-]+\/?$/.test(url.pathname)) {
    throw new Error('Kahhve kataloğu tek bir marka adresi olmalı');
  }
  return url.pathname.replace(/^\/|\/$/g, '');
}

const clean = value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const positive = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function kahhveRecordsFromPayload(payload, catalogUrl) {
  const slug = kahhveBrandSlug(catalogUrl);
  if (!Array.isArray(payload?.urunler)) throw new Error('Kahhve ürün listesi bulunamadı');
  const records = [];
  for (const hit of payload.urunler) {
    const source = hit?._source;
    const product = source?.urun;
    if (!product || !source.marka?.includes(slug) || Number(product.is_kahve) !== 1) continue;
    // This addition covers packaged beans and ground coffee. Capsule count
    // and brewing-dose text are not package weights for this catalog.
    if (source.kategoriler?.includes('kapsul-kahveler')) continue;
    if (Number(product.durum) !== 1) continue;
    const name = clean(product.urun_ismi || product.isim);
    const price = positive(product.fiyat);
    const weights = (source.agirlik || []).map(positive).filter(Boolean);
    if (weights.length !== 1 || !price || !name || !product.id || !product.link) continue;
    let grams = weights[0];
    // The search index truncates Toom's 226.80 g to 226. Only use a labelled
    // package weight to recover decimals; never scan arbitrary dosage text.
    const labelled = normalize(clean(product.aciklama)).match(/agirlik\s*:\s*(\d+(?:[.,]\d+)?)\s*(g|gr|gram)\b/);
    const precise = labelled ? positive(labelled[1].replace(',', '.')) : null;
    if (precise && Math.abs(precise - grams) < 1) grams = precise;
    if (grams < 50 || grams > 6000) continue;
    const url = new URL(product.link, 'https://kahhve.com').href;
    if (hostOf(url) !== 'kahhve.com') continue;
    const stock = product.stok;
    const inStock = [true, 1, '1'].includes(stock) ? true : [false, 0, '0'].includes(stock) ? false : null;
    records.push({
      platform: 'kahhve', host: 'kahhve.com',
      platformProductId: String(product.id), platformVariantId: 'default',
      urlPath: pathOf(url), url, productName: name,
      variantTitle: `${grams} g`, grams, optionSignature: optionSignature(`${grams} g`),
      price, listPrice: positive(product.eski_fiyat), inStock, currency: 'TRY',
      productType: product.ana_kategori || null, descriptionText: clean(product.aciklama),
      brand: product.marka, brandSlug: slug, catalogUrl
    });
  }
  return [...new Map(records.map(record => [record.platformProductId, record])).values()];
}

export async function collectKahhveBrand(catalogUrl, {requestJson, onPayload} = {}) {
  const slug = kahhveBrandSlug(catalogUrl);
  const get = requestJson || (async url => {
    const response = await fetch(url, {
      headers: {'user-agent': 'CekirdekBulBot/1.0 (+https://cekirdekbul.com/bot; fiyat endeksi)', accept: 'application/json'},
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Kahhve HTTP ${response.status}`);
    return response.json();
  });
  const endpoint = new URL('https://kahhve.com/urun/geturunler');
  endpoint.searchParams.set('marka', slug);
  const base = await get(endpoint.href);
  await onPayload?.(base, endpoint.href);
  const weights = base.filtreListesi?.filtreler?.filtre_ismi?.buckets
    ?.find(bucket => bucket.key === 'Ağırlık')?.filtre_degeri?.buckets
    ?.map(bucket => String(bucket.key)).filter(weight => /^\d+(?:[.,]\d+)?$/.test(weight)) || [];
  let all = [];
  if (weights.length) {
    // Default storefront results show representative SKUs only. Selecting
    // every advertised weight also returns 50 g/500 g/1 kg/5 kg packages.
    endpoint.searchParams.set('filtreler[Ağırlık]', weights.join(','));
    const weighted = await get(endpoint.href);
    await onPayload?.(weighted, endpoint.href);
    if (!Array.isArray(weighted?.urunler)) throw new Error('Kahhve gramaj listesi bulunamadı');
    all = weighted.urunler;
  }
  return kahhveRecordsFromPayload({urunler: [...(base.urunler || []), ...all]}, catalogUrl);
}
