import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const row = (id, business, prices, extra = {}) => ({
  id, variantId: id, business, product: `Coffee ${id}`, origin: 'Kenya', grams: 250,
  price: prices.at(-1), previousPrice: prices.at(-2) ?? null,
  url: `https://example.com/${id}`, catalogStatus: 'Ürün kaydı', prices, ...extra
});

async function application(products, extraHistory = {}, seed = 123) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'sort' ? 'business' : '', innerHTML: '', textContent: '', handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      insertAdjacentHTML() {},
    });
    return elements.get(id);
  }
  const history = Object.fromEntries(products.map(product => [product.variantId,
    product.prices.map((price, i) => [`2026-09-${String(i + 1).padStart(2, '0')}`, price])
  ]));
  const data = {
    '/data/products.json': products,
    '/data/metadata.json': { checkedAt: '2026-10-03', businesses: 3, namedProducts: products.length, origins: 1 },
    '/data/price_history.json': { ...history, ...extraHistory },
    '/origin-guides.json': {},
  };
  const randomMath = Object.create(Math);
  randomMath.random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const context = vm.createContext({
    Math: randomMath,
    document: { body: { dataset: { base: '/' } }, getElementById: element, addEventListener() {} },
    fetch: async url => ({ json: async () => data[url] }),
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!element('product-rows').innerHTML.includes('Veri yüklenemedi'));
  return {
    element,
    change(id, value) { element(id).value = value; element(id).handlers[id === 'search' ? 'input' : 'change'](); },
    evaluate(expression) { return vm.runInContext(expression, context); },
    ids() { return Array.from(vm.runInContext('filtered.map(row => row.id)', context)); },
  };
}

test('counts increases and decreases, excluding the baseline and unchanged observations', async () => {
  const app = await application([
    row(1, 'A', [100, 100, 120, 90, 90, 100]), row(2, 'B', [100, 100]), row(3, 'C', [100])
  ]);
  assert.deepEqual(Array.from(app.evaluate('all.map(row => priceChangeCounts.get(row))')), [3, 0, 0]);
});

test('orders raw history and ignores invalid prices; missing history uses the known latest change', async () => {
  const app = await application([row(1, 'A', [100, 150]), row(2, 'B', [90, 100])], {
    1: [['2026-09-03', 150], ['2026-09-01', 100], ['2026-09-02', null], ['2026-09-02', -10]],
    2: [],
  });
  assert.deepEqual(Array.from(app.evaluate('all.map(row => priceChangeCounts.get(row))')), [1, 1]);
});

test('increase and decrease filters default to total change count ahead of business and amount', async () => {
  const app = await application([
    row(1, 'A', [100, 500]), row(2, 'Z', [100, 120, 90, 110]),
    row(3, 'B', [100, 50]), row(4, 'Y', [100, 120, 90, 110, 100]),
  ]);
  app.change('price-change', 'up');
  assert.equal(app.element('sort').value, 'changes-desc');
  assert.deepEqual(app.ids(), [2, 1]);
  app.change('price-change', 'down');
  assert.deepEqual(app.ids(), [4, 3]);
});

test('interleaves businesses within each count tier, including across a page boundary', async () => {
  const products = Array.from({ length: 65 }, (_, i) => row(i, i < 33 ? 'A' : 'B', [100, 120, 90, 110]));
  const app = await application(products);
  app.change('price-change', 'up');
  const businesses = Array.from(app.evaluate('filtered.map(row => row.business)'));
  assert.ok(businesses.every((business, i) => i === 0 || business !== businesses[i - 1]));
  assert.equal(new Set(app.ids()).size, products.length);
  const firstPage = app.element('product-rows').innerHTML;
  const ids = app.ids();
  app.element('next').handlers.click();
  assert.equal(app.element('page-label').textContent, '2 / 3');
  app.element('prev').handlers.click();
  assert.equal(app.element('product-rows').innerHTML, firstPage);
  app.change('search', 'Coffee');
  assert.deepEqual(app.ids(), ids);
});

test('spreads a larger business through smaller businesses whenever a non-adjacent order exists', async () => {
  const app = await application([
    row(1, 'A', [100, 120]), row(2, 'A', [100, 120]), row(3, 'A', [100, 120]),
    row(4, 'B', [100, 120]), row(5, 'C', [100, 120])
  ]);
  app.change('price-change', 'up');
  const businesses = Array.from(app.evaluate('filtered.map(row => row.business)'));
  assert.ok(businesses.every((business, i) => i === 0 || business !== businesses[i - 1]));
});

test('count priority remains global across businesses, and explicit sorting and clearing still work', async () => {
  const app = await application([
    row(1, 'A', [100, 130]), row(2, 'Z', [100, 120, 90, 110]),
    row(3, 'A', [100, 120, 90, 130]), row(4, 'B', [100, 140])
  ]);
  app.change('price-change', 'up');
  const counts = Array.from(app.evaluate('filtered.map(row => priceChangeCounts.get(row))'));
  assert.deepEqual(counts, [3, 3, 1, 1]);
  app.change('sort', 'price-asc');
  assert.deepEqual(app.ids(), [2, 1, 3, 4]);
  app.change('business', 'A');
  assert.deepEqual(new Set(app.ids()), new Set([1, 3]));
  app.element('clear').handlers.click();
  assert.equal(app.element('sort').value, 'business');
  assert.equal(app.ids().length, 4);
});

test('separate visits randomize business order without grouping one business into a block', async () => {
  const products = ['A', 'B', 'C', 'D'].flatMap((business, i) => [row(i * 2, business, [100, 120]), row(i * 2 + 1, business, [100, 120])]);
  const orders = new Set();
  for (let i = 0; i < 12; i++) {
    const app = await application(products, {}, i + 1);
    app.change('price-change', 'up');
    orders.add(app.evaluate('filtered.slice(0, 4).map(row => row.business).join()'));
  }
  assert.ok(orders.size > 1);
});
