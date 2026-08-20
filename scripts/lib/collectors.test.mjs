import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWoo } from './collectors.mjs';

// Bu sabitler baristocrat.com'un gerçek WooCommerce Store API yanıtından
// birebir alındı (20 Ağustos 2026, WebFetch ile doğrulandı) — "değişken
// ürün" (variable product) vakasını gerçek veriyle test etmek için.
const PARENT_LIST = [{
  id: 14806, name: 'Rwanda – Gisanga', type: 'variable', parent: 0,
  permalink: 'https://www.baristocrat.com/urun/rwanda-gisanga/',
  short_description: '', description: 'Ruanda kahvesi.',
  prices: { price: '90000', regular_price: '90000', currency_minor_unit: 2, currency_code: 'TRY' },
  categories: [{ id: 64, name: 'Kahve' }],
  attributes: [
    { id: 7, name: 'Miktar', taxonomy: 'pa_miktar', terms: [{ name: '250 Gr' }, { name: '1000 Gr' }] },
    { id: 6, name: 'Öğütme Seçeneği', taxonomy: 'pa_ogutme-secenegi', terms: [] }
  ],
  variations: [{ id: 14807, attributes: [{ name: 'Miktar', value: '250-gr' }, { name: 'Öğütme Seçeneği', value: null }] }],
  is_in_stock: true
}];

const VARIATION_14807 = {
  id: 14807, name: 'Rwanda – Gisanga', parent: 14806, type: 'variation',
  variation: 'Miktar: 250 Gr',
  permalink: 'https://www.baristocrat.com/urun/rwanda-gisanga/?attribute_pa_miktar=250-gr',
  prices: { price: '90000', regular_price: '90000', currency_minor_unit: 2, currency_code: 'TRY' },
  is_in_stock: true
};

function fakeFetch(routes) {
  return async (url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'not found' };
    return { ok: true, status: 200, text: async () => JSON.stringify(routes[key]) };
  };
}

test('değişken (variable) ürünlerin gramajı varyasyon kaydından çıkarılır', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = fakeFetch({
    '/products?per_page=100&page=1': PARENT_LIST,
    '/products?per_page=100&page=2': [],
    '/products/14807': VARIATION_14807
  });
  t.after(() => { global.fetch = originalFetch; });

  const records = await collectWoo('https://www.baristocrat.com');

  assert.equal(records.length, 1, 'ana listedeki değişken ürün kendi başına kayıt üretmemeli, yalnızca varyasyonu üretmeli');
  const record = records[0];
  assert.equal(record.grams, 250, '"Miktar: 250 Gr" ifadesinden 250 gram çıkarılmalı');
  assert.equal(record.price, 900, 'kuruş cinsinden 90000 -> 900 TL');
  assert.equal(record.platformProductId, '14806', 'ana ürün kimliği parent id olmalı');
  assert.equal(record.platformVariantId, '14807', 'varyant kimliği varyasyon id olmalı');
  assert.equal(record.productName, 'Rwanda – Gisanga');
});

test('sabit (simple) ürünler eskisi gibi ada göre gramaj çıkarır', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = fakeFetch({
    '/products?per_page=100&page=1': [{
      id: 500, name: 'Filtre Kahve 250g', type: 'simple', permalink: 'https://example.com/urun/filtre-kahve-250g',
      short_description: '', description: '',
      prices: { price: '60000', regular_price: '60000', currency_minor_unit: 2, currency_code: 'TRY' },
      categories: [], variations: [], is_in_stock: true
    }],
    '/products?per_page=100&page=2': []
  });
  t.after(() => { global.fetch = originalFetch; });

  const records = await collectWoo('https://example.com');
  assert.equal(records.length, 1);
  assert.equal(records[0].grams, 250);
  assert.equal(records[0].platformVariantId, null);
});

test('çekilemeyen bir varyasyon diğerlerini bozmadan atlanır', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = fakeFetch({
    '/products?per_page=100&page=1': [{
      ...PARENT_LIST[0], id: 999,
      variations: [{ id: 111, attributes: [] }, { id: 14807, attributes: [] }]
    }],
    '/products?per_page=100&page=2': [],
    '/products/14807': VARIATION_14807
    // 111 kasıtlı olarak yok — 404 dönecek
  });
  t.after(() => { global.fetch = originalFetch; });

  const records = await collectWoo('https://www.baristocrat.com');
  assert.equal(records.length, 1, 'başarısız varyasyon atlanmalı, diğeri kaydedilmeli');
  assert.equal(records[0].platformVariantId, '14807');
});
