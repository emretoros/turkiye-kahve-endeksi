/**
 * node --test scripts/lib/store.test.mjs
 *
 * En kritik davranış: aynı varyant iki farklı koşuda görülünce AYNI id'yi
 * almalı (kimlik kalıcılığı), ve fiyat değişmediyse ikinci koşuda observation
 * satırı EKLENMEMELİ (depoyu şişirmemek için).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kahve-store-'));
}

function ingest(store, roasterInput, record, runId) {
  const roaster = store.upsertRoaster(roasterInput);
  const product = store.upsertProduct(roaster, record);
  const variant = store.upsertVariant(product, record);
  const changed = store.recordObservation(variant, record, runId, 'test');
  return { roaster, product, variant, changed };
}

test('varyant kimliği iki koşu arasında sabit kalır', () => {
  const dir = tmpDir();
  const roasterInput = { business: 'Test Kavurucu', website: 'https://test.com' };
  const record = {
    platform: 'shopify', host: 'test.com', platformProductId: '1', platformVariantId: '2',
    urlPath: '/products/x', productName: 'Etiyopya', grams: 250, price: 500, inStock: true
  };

  const store1 = openStore(dir);
  const r1 = ingest(store1, roasterInput, record, 'run-1');
  store1.save();

  const store2 = openStore(dir);
  const r2 = ingest(store2, roasterInput, { ...record, productName: 'Etiyopya — Yeni Hasat' }, 'run-2');
  store2.save();

  assert.equal(r1.variant.id, r2.variant.id);
  assert.equal(r1.product.id, r2.product.id);
  assert.equal(r1.roaster.id, r2.roaster.id);
});

test('sonraki koşu önceden boş kalan gramajı kimliği değiştirmeden doldurur', () => {
  const dir = tmpDir();
  const roasterInput = { business: 'Eksik Gramaj', website: 'https://eksik.com' };
  const record = {
    platform: 'shopify', host: 'eksik.com', platformProductId: '1', platformVariantId: '2',
    urlPath: '/products/x', productName: 'Ruanda', variantTitle: 'Çekirdek',
    grams: null, price: 925, inStock: true
  };

  const store1 = openStore(dir);
  const first = ingest(store1, roasterInput, record, 'run-1');
  store1.save();

  const store2 = openStore(dir);
  const second = ingest(store2, roasterInput, { ...record, grams: 250 }, 'run-2');
  store2.save();

  assert.equal(second.variant.id, first.variant.id);
  assert.equal(second.variant.grams, 250);
});

test('varyanta özgü bağlantı sonraki koşuda kaydedilir ve kalıcı olur', () => {
  const dir = tmpDir();
  const roasterInput = { business: 'Varyant Bağlantısı', website: 'https://varyant.com' };
  const record = {
    platform: 'ikas', host: 'varyant.com', platformProductId: 'urun-1', platformVariantId: 'varyant-2',
    urlPath: '/kahve', productName: 'Etiyopya', variantTitle: '1000 gr Çekirdek',
    grams: 1000, price: 2100, inStock: true
  };

  const store1 = openStore(dir);
  ingest(store1, roasterInput, record, 'run-1');
  store1.save();

  const variantUrl = 'https://varyant.com/kahve?vid=varyant-2';
  const store2 = openStore(dir);
  const second = ingest(store2, roasterInput, { ...record, url: variantUrl }, 'run-2');
  store2.save();

  assert.equal(second.variant.url, variantUrl);
  assert.equal(openStore(dir).variants[0].url, variantUrl);
});

test('fiyat değişmezse ikinci koşuda observation eklenmez', () => {
  const dir = tmpDir();
  const roasterInput = { business: 'Sabit Fiyat', website: 'https://sabit.com' };
  const record = {
    platform: 'shopify', host: 'sabit.com', platformProductId: '9', platformVariantId: '9',
    urlPath: '/products/y', productName: 'Kolombiya', grams: 250, price: 400, inStock: true
  };

  const store1 = openStore(dir);
  const first = ingest(store1, roasterInput, record, 'run-1');
  store1.save();
  assert.equal(first.changed, true, 'ilk gözlem her zaman kaydedilmeli');

  const store2 = openStore(dir);
  const second = ingest(store2, roasterInput, record, 'run-2'); // aynı fiyat
  store2.save();
  assert.equal(second.changed, false, 'değişmeyen fiyat yeni satır açmamalı');

  const lines = fs.readFileSync(path.join(dir, 'price_observations.ndjson'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1, 'sadece ilk koşudan 1 gözlem satırı olmalı');
});

test('fiyat değişirse yeni observation eklenir ve variant.lastPrice güncellenir', () => {
  const dir = tmpDir();
  const roasterInput = { business: 'Degisen Fiyat', website: 'https://degisen.com' };
  const record = {
    platform: 'shopify', host: 'degisen.com', platformProductId: '7', platformVariantId: '7',
    urlPath: '/products/z', productName: 'Brezilya', grams: 1000, price: 900, inStock: true
  };

  const store1 = openStore(dir);
  ingest(store1, roasterInput, record, 'run-1');
  store1.save();

  const store2 = openStore(dir);
  const changedRun = ingest(store2, roasterInput, { ...record, price: 950 }, 'run-2');
  store2.save();
  assert.equal(changedRun.changed, true);
  assert.equal(changedRun.variant.lastPrice, 950);

  const lines = fs.readFileSync(path.join(dir, 'price_observations.ndjson'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const last = JSON.parse(lines.at(-1));
  assert.equal(last.price, 950);
});

test('stok durumu değişirse fiyat aynı olsa bile gözlem yazılır', () => {
  const dir = tmpDir();
  const roasterInput = { business: 'Stok Testi', website: 'https://stok.com' };
  const record = {
    platform: 'shopify', host: 'stok.com', platformProductId: '3', platformVariantId: '3',
    urlPath: '/products/a', productName: 'Kenya', grams: 250, price: 600, inStock: true
  };
  const store1 = openStore(dir);
  ingest(store1, roasterInput, record, 'run-1');
  store1.save();

  const store2 = openStore(dir);
  const r = ingest(store2, roasterInput, { ...record, inStock: false }, 'run-2');
  store2.save();
  assert.equal(r.changed, true);
});

test('aynı işletme adı iki kez upsert edilince tek roaster kalır', () => {
  const dir = tmpDir();
  const store = openStore(dir);
  const a = store.upsertRoaster({ business: 'Aynı İşletme', website: 'https://a.com' });
  const b = store.upsertRoaster({ business: 'Aynı İşletme', website: 'https://a.com' });
  assert.equal(a.id, b.id);
  store.save();
  assert.equal(store.stats().roasters, 1);
});
