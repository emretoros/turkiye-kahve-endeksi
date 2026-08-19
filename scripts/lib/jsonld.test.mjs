import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonLdNodes, productNodesFrom, offersOf, toNumber, availabilityToBool } from './jsonld.mjs';

const wrap = (obj) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;

test('tekil Product + Offer ayrıştırılır', () => {
  const html = wrap({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Etiyopya Yirgacheffe 250g',
    offers: { '@type': 'Offer', price: '600', priceCurrency: 'TRY', availability: 'https://schema.org/InStock' }
  });
  const products = productNodesFrom(extractJsonLdNodes(html));
  assert.equal(products.length, 1);
  const offers = offersOf(products[0]);
  assert.equal(offers.length, 1);
  assert.equal(toNumber(offers[0].price), 600);
  assert.equal(availabilityToBool(offers[0].availability), true);
});

test('@graph içindeki Product bulunur', () => {
  const html = wrap({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [] },
    { '@type': 'Product', name: 'Kolombiya 1kg', offers: { price: 1800, priceCurrency: 'TRY' } }
  ] });
  const products = productNodesFrom(extractJsonLdNodes(html));
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Kolombiya 1kg');
});

test('AggregateOffer birden fazla varyantı ayırır', () => {
  const html = wrap({
    '@type': 'Product', name: 'Brezilya', offers: {
      '@type': 'AggregateOffer',
      offers: [
        { sku: 'BRZ-250', price: 500, availability: 'InStock' },
        { sku: 'BRZ-1000', price: 1800, availability: 'OutOfStock' }
      ]
    }
  });
  const products = productNodesFrom(extractJsonLdNodes(html));
  const offers = offersOf(products[0]);
  assert.equal(offers.length, 2);
  assert.equal(availabilityToBool(offers[0].availability), true);
  assert.equal(availabilityToBool(offers[1].availability), false);
});

test('Product olmayan düğümler (BreadcrumbList, Organization) atlanır', () => {
  const html = wrap({ '@type': 'Organization', name: 'Bir Kavurucu Ltd.' });
  assert.equal(productNodesFrom(extractJsonLdNodes(html)).length, 0);
});

test('bozuk JSON sessizce atlanır, sayfa çökmez', () => {
  const html = '<script type="application/ld+json">{ bozuk json </script>';
  assert.deepEqual(extractJsonLdNodes(html), []);
});

test('offers alanı olmayan Product boş varyant listesi döner', () => {
  const html = wrap({ '@type': 'Product', name: 'Eksik Ürün' });
  const products = productNodesFrom(extractJsonLdNodes(html));
  assert.equal(offersOf(products[0]).length, 0);
});

test('fiyat standart ondalık biçimde ayrıştırılır (Türkçe binlik değil)', () => {
  assert.equal(toNumber('600'), 600);
  assert.equal(toNumber('1800.00'), 1800);
  assert.equal(toNumber(1250.5), 1250.5);
  assert.equal(toNumber('0'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(undefined), null);
});

test('bilinmeyen stok durumu null döner (false varsayılmaz)', () => {
  assert.equal(availabilityToBool(undefined), null);
  assert.equal(availabilityToBool('PreOrder'), true);
});
