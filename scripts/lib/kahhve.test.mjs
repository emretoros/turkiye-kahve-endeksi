import test from 'node:test';
import assert from 'node:assert/strict';
import {kahhveRecordsFromPayload, collectKahhveBrand, kahhveBrandSlug} from './kahhve.mjs';
import {buildBusinessList} from './roster.mjs';
import {applyPriceRules} from './price-rules.mjs';

const hit = (slug, overrides = {}, weights = [250]) => ({_source: {
  marka: [slug], kategoriler: ['kahveler', 'cekirdek-kahveler'], agirlik: weights,
  urun: {id: 795, urun_ismi: 'Breakfast Blend', link: '/caffe-fresco-breakfast-blend-kahveler',
    is_kahve: 1, durum: 1, fiyat: 383.99, eski_fiyat: 479.99, stok: 1, ...overrides}
}});

test('indirimli fiyatı ve tükenen ürünü korur; farklı marka ve ekipman karışmaz', () => {
  const payload = {urunler: [hit('caffe-fresco', {stok: 0}), hit('toom'),
    hit('caffe-fresco', {id: 999, is_kahve: 0, urun_ismi: 'Değirmen'})]};
  const records = kahhveRecordsFromPayload(payload, 'https://kahhve.com/caffe-fresco');
  assert.equal(records.length, 1);
  assert.equal(records[0].price, 383.99);
  assert.equal(records[0].listPrice, 479.99);
  assert.equal(records[0].inStock, false);
});

test('500 g iki paket için toplam 1000 g; Toom için hassas 226.80 g kullanılır', () => {
  const bundle = kahhveRecordsFromPayload({urunler: [hit('caffe-fresco',
    {urun_ismi: "Dark Roast 500 gram 2'li Paket"}, [1000])]}, 'https://kahhve.com/caffe-fresco')[0];
  assert.equal(bundle.grams, 1000);
  const toom = kahhveRecordsFromPayload({urunler: [hit('toom',
    {aciklama: '12 g demleme dozu. AĞIRLIK: 226.80 GRAM (8 OZ)'}, [226])]}, 'https://kahhve.com/toom')[0];
  assert.equal(toom.grams, 226.8);
});

test('belirsiz gramaj, geçersiz fiyat, kapsül ve dış kaynak bağlantısı yayınlanmaz', () => {
  const capsule = hit('toom'); capsule._source.kategoriler = ['kapsul-kahveler'];
  const records = kahhveRecordsFromPayload({urunler: [hit('toom', {}, []),
    hit('toom', {fiyat: 'hatalı'}), hit('toom', {link: 'https://other.example/product'}), capsule]},
  'https://kahhve.com/toom');
  assert.deepEqual(records, []);
  assert.throws(() => kahhveBrandSlug('https://kahhve.com/'), /tek bir marka/);
});

test('aynı satıcıdaki iki marka günlük taramada ayrı katalog adreslerini korur', () => {
  const entries = ['Toom', 'Urban Grind'].map(business => ({business,
    website: 'https://kahhve.com', catalogUrl: `https://kahhve.com/${business.toLowerCase().replace(' ', '-')}`}));
  const businesses = buildBusinessList([], entries);
  assert.equal(businesses.length, 2);
  assert.equal(businesses[0].catalogUrl, 'https://kahhve.com/toom');
  assert.equal(businesses[1].catalogUrl, 'https://kahhve.com/urban-grind');
});

test('mağazanın tüm gramajlarını seçer ve aynı SKU iki kez eklenmez', async () => {
  const requested = [];
  const base = {urunler: [hit('caffe-fresco')], filtreListesi: {filtreler: {filtre_ismi: {buckets: [
    {key: 'Ağırlık', filtre_degeri: {buckets: [{key: '250'}, {key: '1000'}]}}
  ]}}}};
  const requestJson = async url => {
    requested.push(new URL(url));
    return requested.length === 1 ? base : {urunler: [hit('caffe-fresco'),
      hit('caffe-fresco', {id: 1011, link: '/caffe-fresco-breakfast-1kg-kahveler'}, [1000])]};
  };
  const records = await collectKahhveBrand('https://kahhve.com/caffe-fresco', {requestJson});
  assert.deepEqual(records.map(r => r.grams), [250, 1000]);
  assert.equal(requested[1].searchParams.get('marka'), 'caffe-fresco');
  assert.equal(requested[1].searchParams.get('filtreler[Ağırlık]'), '250,1000');
});

test('Moka Pot Coffee kahvesi ekipman sayılmaz; moka pot makinesi engellenir', () => {
  const rows = applyPriceRules([
    {business: 'Urban Grind', product: 'Moka Pot Coffee', grams: 250, price: 499.99},
    {business: 'Urban Grind', product: 'Moka Pot Coffee Mini', grams: 50, price: 149.99},
    {business: 'Equipment', product: 'Moka Pot Coffee Makinesi', grams: 250, price: 499.99},
    {business: 'Equipment', product: 'Moka Pot', grams: 250, price: 499.99}
  ]).rows;
  assert.deepEqual(rows.map(row => row.quarantined), [false, false, true, true]);
});
