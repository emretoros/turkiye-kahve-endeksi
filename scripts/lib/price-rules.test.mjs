import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPriceRules, UNGRAMMED_PRICE_MAX } from './price-rules.mjs';

const row = (overrides) => ({
  business: 'Test Kavurucu', product: 'Ürün', grams: 250, price: 500,
  previousPrice: null, sourceMethod: 'shopify', url: '', ...overrides
});

test('marka+model isimli ekipman (ör. La Marzocco) sadece "makine" kelimesiyle bile yakalanır', () => {
  const { rows } = applyPriceRules([row({ product: 'ACME Kahve Makinesi Pro', grams: null, price: 200000 })]);
  assert.equal(rows[0].quarantined, true);
  assert.ok(rows[0].flags.some((f) => f.rule === 'NON_COFFEE_LEAK'));
});

test('Türkçe ünsüz yumuşamasıyla çekimlenmiş "aboneliği" da yakalanır', () => {
  const { rows } = applyPriceRules([row({ product: 'Kahve Aboneliği (6 Aylık) — 1000 gr', grams: 1000, price: 14500 })]);
  assert.equal(rows[0].quarantined, true);
  assert.ok(rows[0].flags.some((f) => f.rule === 'SUBSCRIPTION'));
});

test('palet/toptan satış birimleri karantinaya alınır', () => {
  const { rows } = applyPriceRules([row({ product: 'Kapsül Kahve 12x243 Koli | Palet', grams: null, price: 279926 })]);
  assert.equal(rows[0].quarantined, true);
  assert.ok(rows[0].flags.some((f) => f.rule === 'WHOLESALE'));
});

test('gramajsız + eşiğin üstünde fiyat karantinaya alınır (marka isimli ekipman güvenlik ağı)', () => {
  const { rows } = applyPriceRules([row({ product: 'La Marzocco Linea Micra', grams: null, price: UNGRAMMED_PRICE_MAX + 1 })]);
  assert.equal(rows[0].quarantined, true);
  assert.ok(rows[0].flags.some((f) => f.rule === 'HIGH_PRICE_NO_GRAMS'));
});

test('gramajsız ama eşiğin altındaki fiyat bu kuraldan etkilenmez', () => {
  const { rows } = applyPriceRules([row({ product: 'Filtre Kahve 12 Adet Kapsül Kutusu', grams: null, price: UNGRAMMED_PRICE_MAX - 1 })]);
  assert.ok(!rows[0].flags.some((f) => f.rule === 'HIGH_PRICE_NO_GRAMS'));
});

test('normal, gramajı bilinen bir ürün karantinaya alınmaz', () => {
  const { rows } = applyPriceRules([row({ product: 'Etiyopya Yirgacheffe 250g', grams: 250, price: 600 })]);
  assert.equal(rows[0].quarantined, false);
});
