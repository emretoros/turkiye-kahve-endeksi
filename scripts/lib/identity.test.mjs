/**
 * node --test scripts/lib/identity.test.mjs
 *
 * Kritik olan iki şey test ediliyor:
 *   1. Gramaj çıkarımı demleme dozunu ve çuval boyunu ambalaj sanmıyor.
 *   2. Kimlik anahtarı ürün adı/fiyat değişse de sabit kalıyor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGrams, optionSignature, variantKey, productKey } from './identity.mjs';

test('gramaj: normal ambalajlar', () => {
  assert.equal(parseGrams('250 gr'), 250);
  assert.equal(parseGrams('Brazil Mogiana ( 1 Kg )'), 1000);
  assert.equal(parseGrams('Etiyopya Yirgacheffe 200g'), 200);
  assert.equal(parseGrams('Kolombiya 500 gram'), 500);
  assert.equal(parseGrams('0,5 kg harman'), 500);
});

test('gramaj: demleme dozu ambalaj sayılmaz', () => {
  // Mevcut veride bu satırlar 12–28 g "ambalaj" olarak kaydedilmişti.
  assert.equal(parseGrams('ORDI NO:1 / ESPRESSO 12 g'), null);
  assert.equal(parseGrams('Colombia Geisha Cerro Azul 15 g'), null);
  assert.equal(parseGrams('House Ceremony Espresso 16 gr'), null);
});

test('gramaj: çuval/dökme ambalaj sayılmaz', () => {
  assert.equal(parseGrams('Dark Ceremony 60 kg'), null);
  assert.equal(parseGrams('Desenli Kahve Çuvalı 69 kg'), null);
});

test('gramaj: birden fazla aday varsa ambalaj olanı seçilir', () => {
  assert.equal(parseGrams('250 g paket — demleme için 12 g kullanın'), 250);
  assert.equal(parseGrams('1 kg ekonomik — 18 g doz önerilir'), 1000);
});

test('gramaj: yanlış birim yakalanmaz', () => {
  assert.equal(parseGrams('Geisha 250 ml şişe'), null);
  assert.equal(parseGrams('Kahve Kupası 350ml'), null);
});

test('öğütüm imzası', () => {
  assert.equal(optionSignature('Çekirdek'), 'cekirdek');
  assert.equal(optionSignature('Öğütülmemiş'), 'cekirdek');
  assert.equal(optionSignature('Filtre Kahve'), 'filtre');
  assert.equal(optionSignature('V60'), 'filtre');
  assert.equal(optionSignature('Espresso'), 'espresso');
  assert.equal(optionSignature('250 g'), '');
});

test('kimlik: platform id varsa 1. kademe', () => {
  const record = {
    platform: 'shopify',
    host: 'goodcoffee.com.tr',
    platformProductId: '7788',
    platformVariantId: '4321',
    url: 'https://www.goodcoffee.com.tr/products/brasil-karma-fruta'
  };
  const { key, tier } = variantKey(record);
  assert.equal(tier, 1);
  assert.equal(key, 'p1:shopify:goodcoffee.com.tr:7788:4321');
});

test('kimlik: ürün adı ve fiyat değişse de anahtar sabit kalır', () => {
  const before = {
    platform: 'shopify', host: 'x.com', platformProductId: '1', platformVariantId: '2',
    productName: 'Brasil Karma Fruta', price: 600, grams: 250
  };
  const after = {
    ...before,
    productName: 'BRASIL KARMA FRUTA — Yeni Hasat',   // ad değişti
    price: 720,                                        // fiyat değişti
    urlPath: '/products/brasil-karma-fruta-2026'       // URL değişti
  };
  assert.equal(variantKey(before).key, variantKey(after).key);
  assert.equal(productKey(before).key, productKey(after).key);
});

test('kimlik: platform id yoksa URL yoluna düşer ve varyantları ayırır', () => {
  const base = { host: 'a.com', urlPath: '/urun/etiyopya', productName: 'Etiyopya' };
  const small = variantKey({ ...base, grams: 250, optionSignature: 'cekirdek' });
  const large = variantKey({ ...base, grams: 1000, optionSignature: 'cekirdek' });
  const ground = variantKey({ ...base, grams: 250, optionSignature: 'filtre' });
  assert.equal(small.tier, 2);
  assert.notEqual(small.key, large.key);
  assert.notEqual(small.key, ground.key, 'öğütüm ekseni ayrışmalı');
});

test('kimlik: www ve sondaki eğik çizgi farkı kimliği bozmaz', () => {
  const a = variantKey({ url: 'https://www.a.com/urun/x/', grams: 250 });
  const b = variantKey({ url: 'https://a.com/urun/x', grams: 250 });
  assert.equal(a.key, b.key);
});
