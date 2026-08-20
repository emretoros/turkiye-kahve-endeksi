import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBusinessList } from './roster.mjs';

test('aynı işletmenin en çok geçen host\'u web sitesi seçilir', () => {
  const rows = [
    { business: 'Kavurucu A', city: 'İstanbul', businessStatus: 'Doğrulandı', instagram: '@a', url: 'https://a.com/urun/1' },
    { business: 'Kavurucu A', city: 'İstanbul', businessStatus: 'Doğrulandı', instagram: '@a', url: 'https://a.com/urun/2' },
    { business: 'Kavurucu A', city: 'İstanbul', businessStatus: 'Doğrulandı', instagram: '@a', url: 'https://cdn.other.com/img.png' }
  ];
  const list = buildBusinessList(rows);
  assert.equal(list.length, 1);
  assert.equal(list[0].website, 'https://a.com');
});

test('url\'si olmayan işletme website:null ile listelenir', () => {
  const rows = [{ business: 'Kavurucu B', city: 'Ankara', businessStatus: 'Kısmi doğrulama', instagram: '@b' }];
  const list = buildBusinessList(rows);
  assert.equal(list[0].website, null);
});

test('manuel eklenen yeni işletme listeye girer', () => {
  const rows = [{ business: 'Kavurucu A', city: 'İstanbul', businessStatus: 'Doğrulandı', instagram: '@a', url: 'https://a.com' }];
  const manual = [{ business: 'Yeni Kavurucu C', city: 'İzmir', website: 'https://yenikavurucu.com', instagram: '@c' }];
  const list = buildBusinessList(rows, manual);
  assert.equal(list.length, 2);
  const c = list.find((b) => b.business === 'Yeni Kavurucu C');
  assert.equal(c.website, 'https://yenikavurucu.com');
  assert.equal(c.businessStatus, 'Kapsam doğrulaması bekliyor');
  assert.equal(c.city, 'İzmir');
});

test('manuel website, satır verisindeki host ile çelişse bile önceliklidir', () => {
  // broad_products.json'daki eski/yanlış url'ler (ör. CDN, sepet linki) çoğunluk
  // kazanabilir; manuel onaylı website her zaman kazanmalı.
  const rows = [
    { business: 'Kavurucu D', city: 'Bursa', businessStatus: 'Kısmi doğrulama', instagram: '@d', url: 'https://cdn.eskisite.com/1' },
    { business: 'Kavurucu D', city: 'Bursa', businessStatus: 'Kısmi doğrulama', instagram: '@d', url: 'https://cdn.eskisite.com/2' },
    { business: 'Kavurucu D', city: 'Bursa', businessStatus: 'Kısmi doğrulama', instagram: '@d', url: 'https://cdn.eskisite.com/3' }
  ];
  const manual = [{ business: 'Kavurucu D', website: 'https://dogrukavurucud.com' }];
  const list = buildBusinessList(rows, manual);
  assert.equal(list.length, 1);
  assert.equal(list[0].website, 'https://dogrukavurucud.com');
});

test('manuel giriş, satırlarda olmayan alanları boş bırakmaz ama var olanları ezmez', () => {
  const rows = [{ business: 'Kavurucu E', city: 'Konya', businessStatus: 'Doğrulandı', instagram: null, url: 'https://e.com' }];
  const manual = [{ business: 'Kavurucu E', instagram: '@yeniinsta' }];
  const list = buildBusinessList(rows, manual);
  assert.equal(list[0].instagram, '@yeniinsta', 'satırda instagram yoksa manuel değer kullanılmalı');
  assert.equal(list[0].businessStatus, 'Doğrulandı', 'var olan businessStatus manuel varsayılanla ezilmemeli');
});

test('boş girdi listeleri boş sonuç döndürür', () => {
  assert.deepEqual(buildBusinessList([]), []);
  assert.deepEqual(buildBusinessList([], []), []);
});
