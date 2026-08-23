import test from 'node:test';
import assert from 'node:assert/strict';
await import('../../public/recommender.js');

const rows = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  business: `Kavurucu ${index + 1}`,
  product: index % 2 ? `Etiyopya Filtre ${index + 1}` : `Etiyopya ${index + 1}`,
  productType: 'Tek köken', origin: 'Etiyopya', grams: 250,
  price: 300 + index * 100, stock: 'Stokta', url: `https://example.com/${index + 1}`
}));

test('öneriler en ucuz ve en pahalı eşleşmeyi içerir', () => {
  const result = globalThis.CoffeeRecommender.recommend(rows, {
    brew: 'v60', origin: 'Etiyopya', grams: 250, budget: 'any'
  });
  assert.equal(result.recommendations.length, 5);
  assert.equal(result.recommendations[0].price, 300);
  assert.equal(result.recommendations[4].price, 1400);
  assert.equal(new Set(result.recommendations.map((row) => row.url)).size, 5);
});

test('menşe, bütçe ve gramaj kesin filtrelenir', () => {
  const mixed = rows.concat([
    { ...rows[0], id: 90, origin: 'Kenya', url: 'https://example.com/kenya' },
    { ...rows[0], id: 91, grams: 1000, url: 'https://example.com/kg' },
    { ...rows[0], id: 92, price: 2000, url: 'https://example.com/expensive' }
  ]);
  const matches = globalThis.CoffeeRecommender.matchingProducts(mixed, {
    brew: 'any', origin: 'Etiyopya', grams: 250, budget: 800
  });
  assert.ok(matches.length > 0);
  assert.ok(matches.every((row) => row.origin === 'Etiyopya' && row.grams === 250 && row.price <= 800));
});

test('Türk kahvesi ekipmanı diğer ürün tiplerini dışarıda bırakır', () => {
  const mixed = rows.concat([{ ...rows[0], id: 99, product: 'Geleneksel Türk Kahvesi', productType: 'Türk kahvesi', url: 'https://example.com/turk' }]);
  const matches = globalThis.CoffeeRecommender.matchingProducts(mixed, {
    brew: 'turkish', origin: 'any', grams: 250, budget: 'any'
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].productType, 'Türk kahvesi');
});

test('yalnızca stokta olduğu doğrulanan ürünler önerilir', () => {
  const mixed = rows.concat([
    { ...rows[0], id: 97, stock: 'Tükendi', price: 100, url: 'https://example.com/out' },
    { ...rows[0], id: 98, stock: 'Belirsiz', price: 200, url: 'https://example.com/unknown' }
  ]);
  const matches = globalThis.CoffeeRecommender.matchingProducts(mixed, {
    brew: 'any', origin: 'Etiyopya', grams: 250, budget: 'any'
  });
  assert.ok(matches.length > 0);
  assert.ok(matches.every((row) => row.stock === 'Stokta'));
  assert.equal(matches[0].price, 300);
});
