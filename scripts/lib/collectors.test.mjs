import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWoo, extractTicimaxModel, extractWixProducts, productFromHtmlMeta,
  rankCatalogUrls, ticimaxRecordsFromModel, wixRecordsFromProducts, enjekteRecordsFromHtml
} from './collectors.mjs';

test('sitemap URL sıralaması ürün sayfalarını ilk sıraya taşır', () => {
  const urls = [
    'https://example.com/',
    'https://example.com/hakkimizda',
    'https://example.com/urun/etiyopya-250g',
    'https://example.com/products/kenya'
  ];
  assert.deepEqual(rankCatalogUrls(urls).slice(0, 2), [urls[2], urls[3]]);
});

test('HTML meta ürün çıkarımı yalnızca etiketlenmiş fiyatı kabul eder', () => {
  const html = `
    <meta property="og:title" content="Etiyopya Halo Beriti 250 g">
    <meta property="product:price:amount" content="725.00">
    <meta property="product:price:currency" content="TRY">
    <meta property="product:availability" content="in stock">
    <div>Kargo 1500 TL üzeri ücretsiz</div>`;
  const record = productFromHtmlMeta(html, 'https://example.com/urun/halo-beriti');
  assert.equal(record.productName, 'Etiyopya Halo Beriti 250 g');
  assert.equal(record.price, 725);
  assert.equal(record.grams, 250);
  assert.equal(record.inStock, true);
});

test('etiketlenmiş ürün fiyatı yoksa HTML gövdesindeki tutar kullanılmaz', () => {
  const html = '<h1>Kenya 250 g</h1><div>Fiyat 650 TL — Kargo 1500 TL üzeri ücretsiz</div>';
  assert.equal(productFromHtmlMeta(html, 'https://example.com/urun/kenya'), null);
});

test('Next gömülü ürün kaydındaki gramaj mevcut sayfanın slugından okunur', () => {
  const html = `
    <meta property="og:title" content="Brezilya Mogiana">
    <meta property="product:price:amount" content="470">
    <script>self.__next_f.push([1,"\\\"slugTr\\\":\\\"brezilya-mogiana\\\",\\\"gram\\\":\\\"250g\\\""])</script>`;
  const record = productFromHtmlMeta(html, 'https://example.com/tr/urun/brezilya-mogiana');
  assert.equal(record.grams, 250);
});

test('5+1 gibi kahve paketlerinde toplam gramaj hesaplanır', () => {
  const html = `
    <meta property="og:title" content="5+1 Filtre Kahve Sepeti 1000 g">
    <meta property="product:price:amount" content="4199">`;
  const record = productFromHtmlMeta(html, 'https://example.com/product-page/5-1-filtre-kahve-sepeti');
  assert.equal(record.grams, 6000);
});

test('4 adet 100 gr gibi tadım setlerinde toplam gramaj hesaplanır', () => {
  const html = `
    <meta property="og:title" content="Kahve Tadım Seti">
    <meta property="og:description" content="4 adet 100 gr kahve">
    <meta property="product:price:amount" content="1691.70">`;
  const record = productFromHtmlMeta(html, 'https://example.com/urun/tadim-seti');
  assert.equal(record.grams, 400);
});

test('Ticimax gömülü modeli dengeli JSON olarak ayrıştırılır', () => {
  const html = '<script>var productDetailModel = {"productId":3,"productName":"El Salvador {La Majada}","products":[]}; var next = true;</script>';
  const model = extractTicimaxModel(html);
  assert.equal(model.productId, 3);
  assert.equal(model.productName, 'El Salvador {La Majada}');
});

test('Ticimax varyantları gramaj/fiyata göre tekilleştirilir ve çekirdek tercih edilir', () => {
  const model = {
    productId: 3, productName: 'El Salvador, La Majada', productType: 'Kahve',
    productShortDescription: 'Yıkanmış kahve',
    productVariantData: [
      { urunID: 30, ekSecenekTipiTanim: 'Miktar', tanim: '250 gr' },
      { urunID: 30, ekSecenekTipiTanim: 'Öğütülme Tipi', tanim: 'Çekirdek' },
      { urunID: 31, ekSecenekTipiTanim: 'Miktar', tanim: '250 gr' },
      { urunID: 31, ekSecenekTipiTanim: 'Öğütülme Tipi', tanim: 'V60' },
      { urunID: 40, ekSecenekTipiTanim: 'Miktar', tanim: '1 KG' },
      { urunID: 40, ekSecenekTipiTanim: 'Öğütülme Tipi', tanim: 'Çekirdek' }
    ],
    products: [
      { id: 31, aktif: true, stokKodu: 'lamajada-250gr-v60', stokAdedi: 5, urunSepetFiyatiStr: '₺802,59', satisFiyatiStr: '₺802,59', paraBirimiKodu: 'TRY' },
      { id: 30, aktif: true, stokKodu: 'lamajada-250gr-cekirdek', stokAdedi: 8, urunSepetFiyatiStr: '₺802,59', satisFiyatiStr: '₺802,59', paraBirimiKodu: 'TRY' },
      { id: 40, aktif: true, stokKodu: 'lamajada-1000gr-cekirdek', stokAdedi: 3, urunSepetFiyatiStr: '₺2.887,50', satisFiyatiStr: '₺3.208,70', paraBirimiKodu: 'TRY' }
    ]
  };
  const records = ticimaxRecordsFromModel(model, 'https://example.com/urunlerimiz/la-majada');
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.grams).sort((a, b) => a - b), [250, 1000]);
  assert.equal(records.find((r) => r.grams === 250).platformVariantId, '30');
  assert.equal(records.find((r) => r.grams === 1000).price, 2887.5);
  assert.equal(records.find((r) => r.grams === 1000).listPrice, 3208.7);
});

test('Wix warmup verisindeki gramaj varyantları ayrıştırılır ve öğütümler tekilleştirilir', () => {
  const product = {
    id: 'p1', name: 'Colombia Pink Bourbon', urlPart: 'colombia-pink-bourbon',
    price: 1150, comparePrice: 0, currency: 'TRY', isInStock: true,
    options: [
      { title: 'Size', selections: [{ id: 1, value: '250GR' }, { id: 29, value: '1000GR' }] },
      { title: 'ÖĞÜTME SEÇENEĞİ', selections: [{ id: 5, value: 'Çekirdek' }, { id: 16, value: 'V60' }] }
    ],
    productItems: [
      { id: 'v60-250', price: 1150, comparePrice: 0, isVisible: true, inventory: { status: 'in_stock' }, optionsSelections: [1, 16] },
      { id: 'bean-250', price: 1150, comparePrice: 0, isVisible: true, inventory: { status: 'in_stock' }, optionsSelections: [1, 5] },
      { id: 'bean-1000', price: 3750, comparePrice: 4000, isVisible: true, inventory: { status: 'in_stock' }, optionsSelections: [29, 5] }
    ]
  };
  const html = `<script id="wix-warmup-data" type="application/json">${JSON.stringify({ nested: { product } })}</script>`;
  const extracted = extractWixProducts(html);
  assert.equal(extracted.length, 1);
  const records = wixRecordsFromProducts(extracted, 'https://example.com');
  assert.equal(records.length, 2);
  assert.equal(records.find((r) => r.grams === 250).platformVariantId, 'bean-250');
  assert.equal(records.find((r) => r.grams === 1000).price, 3750);
  assert.equal(records.find((r) => r.grams === 1000).listPrice, 4000);
});

test('Enjekte kartında varyant kimliği gramaj ve doğru fiyatla eşleşir', () => {
  const html = `<div class="products-lists"><div class="list">
    <a class="image" href="/etiyopya"><div class="name">Etiyopya Doğal</div></a>
    <div class="variantprices variantprices2445">
      <div class="variantprice active" id="variantprice652"><div class="price"><small>₺</small><span>745.</span><samp>00</samp></div></div>
      <div class="variantprice" id="variantprice653"><div class="price"><small>₺</small><span>2850.</span><samp>50</samp></div></div>
    </div><select><option value="652">250gr Öğütülmemiş</option><option value="653">1kg Öğütülmemiş</option></select>
  </div></div>`;
  const records = enjekteRecordsFromHtml(html, 'https://example.com/kahve');
  assert.deepEqual(records.map(({ platformProductId, platformVariantId, grams, price }) =>
    ({ platformProductId, platformVariantId, grams, price })), [
    { platformProductId: '2445', platformVariantId: '652', grams: 250, price: 745 },
    { platformProductId: '2445', platformVariantId: '653', grams: 1000, price: 2850.5 }
  ]);
});

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

// filcoffee.com'un gerçek Store API yanıtından birebir alındı (20 Ağustos
// 2026, WebFetch ile doğrulandı) — "Gramaj" özniteliği BİRİMSİZ bir sayı
// ("1000"), WooCommerce'in hazır "variation" etiketi de aynı şekilde
// birimsiz ("Gramaj: 1000") — parseGrams(label) bunu kaçırıyordu, ürün
// sitede "gramaj bilgisi yok" diye elenip kayboluyordu.
const FIL_PARENT_LIST = [{
  id: 11773, name: 'HİNDİSTAN', type: 'variable', parent: 0,
  permalink: 'https://filcoffee.com/dukkan/hindistan/',
  short_description: '', description: '',
  prices: { price: '50000', regular_price: '50000', currency_minor_unit: 2, currency_code: 'TRY' },
  categories: [{ id: 12, name: 'Tek Köken' }],
  attributes: [{ id: 3, name: 'Gramaj', taxonomy: 'pa_gramaj', terms: [{ id: 72, name: '1000', slug: '1000' }, { id: 74, name: '500', slug: '500' }] }],
  variations: [
    { id: 11775, attributes: [{ name: 'Gramaj', value: '500' }] },
    { id: 11776, attributes: [{ name: 'Gramaj', value: '1000' }] }
  ],
  is_in_stock: true
}];

const FIL_VARIATION_11775 = {
  id: 11775, name: 'HİNDİSTAN', parent: 11773, type: 'variation',
  variation: 'Gramaj: 500', // birim yok
  permalink: 'https://filcoffee.com/dukkan/hindistan/?attribute_pa_gramaj=500',
  attributes: [], // Store API tekil varyasyon uç noktası özniteliği tekrar etmiyor
  prices: { price: '50000', regular_price: '50000', currency_minor_unit: 2, currency_code: 'TRY' },
  is_in_stock: true
};

const FIL_VARIATION_11776 = {
  id: 11776, name: 'HİNDİSTAN', parent: 11773, type: 'variation',
  variation: 'Gramaj: 1000',
  permalink: 'https://filcoffee.com/dukkan/hindistan/?attribute_pa_gramaj=1000',
  attributes: [],
  prices: { price: '90000', regular_price: '90000', currency_minor_unit: 2, currency_code: 'TRY' },
  is_in_stock: true
};

test('birimsiz "Gramaj" özniteliği taşıyan varyasyonlar (filcoffee.com, gerçek vaka)', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = fakeFetch({
    '/products?per_page=100&page=1': FIL_PARENT_LIST,
    '/products?per_page=100&page=2': [],
    '/products/11775': FIL_VARIATION_11775,
    '/products/11776': FIL_VARIATION_11776
  });
  t.after(() => { global.fetch = originalFetch; });

  const records = await collectWoo('https://filcoffee.com');

  assert.equal(records.length, 2);
  const byGrams = Object.fromEntries(records.map((r) => [r.platformVariantId, r.grams]));
  assert.equal(byGrams['11775'], 500, 'birimsiz "Gramaj: 500" -> 500 gram olarak okunmalı');
  assert.equal(byGrams['11776'], 1000, 'birimsiz "Gramaj: 1000" -> 1000 gram olarak okunmalı');
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
