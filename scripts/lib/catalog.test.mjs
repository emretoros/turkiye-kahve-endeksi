import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseRepresentativeVariant, coffeeVariantChoiceKey, exclusionReason,
  guessOrigin, guessProductType, isWeightOnlyLabel
} from './catalog.mjs';

test('ekipman ürünleri dışlanır', () => {
  assert.equal(exclusionReason('Hario V60 Dripper 02'), 'Ekipman/aksesuar');
  assert.equal(exclusionReason('Chemex Filtre Kağıdı'), 'Ekipman/aksesuar');
});

test('çikolatalı kahve dışlanmaz, çikolata barı dışlanır', () => {
  assert.equal(exclusionReason('Çikolatalı Aromalı Filtre Kahve 250g'), null);
  assert.equal(exclusionReason('Bean to Bar Çikolata 70%'), 'Çikolata/şekerleme');
  assert.equal(exclusionReason('Sıcak Çikolata Tozu'), 'Çikolata/şekerleme');
});

test('gerçek kahve ürünü dışlanmaz', () => {
  assert.equal(exclusionReason('Etiyopya Yirgacheffe 250g /products/etiyopya-yirgacheffe'), null);
});

test('menşe ürün adından tahmin edilir', () => {
  assert.equal(guessOrigin('Etiyopya Yirgacheffe 250g'), 'Etiyopya');
  assert.equal(guessOrigin('Kolombiya & Brezilya Harmanı'), 'Kolombiya | Brezilya');
  assert.equal(guessOrigin('House Blend 1kg'), 'Menşe belirtilmemiş');
});

test('ürün tipi menşe sayısına ve anahtar kelimelere göre tahmin edilir', () => {
  assert.equal(guessProductType('Türk Kahvesi 250g', 'Menşe belirtilmemiş'), 'Türk kahvesi');
  assert.equal(guessProductType('Nespresso Uyumlu Kapsül Kahve', 'Menşe belirtilmemiş'), 'Kapsül kahve');
  assert.equal(guessProductType('Fındıklı Aromalı Kahve', 'Menşe belirtilmemiş'), 'Aromalı kahve');
  assert.equal(guessProductType('Kolombiya & Brezilya Harmanı', 'Kolombiya | Brezilya'), 'Harman');
  assert.equal(guessProductType('Etiyopya Yirgacheffe', 'Etiyopya'), 'Tek köken');
  assert.equal(guessProductType('Günlük Kahve 1kg', 'Menşe belirtilmemiş'), 'Kahve ürünü');
});

test('salt gramaj etiketleri tespit edilir', () => {
  assert.equal(isWeightOnlyLabel('250 g'), true);
  assert.equal(isWeightOnlyLabel('1 Kg'), true);
  assert.equal(isWeightOnlyLabel('250g / Çekirdek'), false);
  assert.equal(isWeightOnlyLabel('Filtre Kahve'), false);
});

test('öğütme seçenekleri aynı kahve varyant grubuna düşer', () => {
  assert.equal(coffeeVariantChoiceKey('Çekirdek'), '');
  assert.equal(coffeeVariantChoiceKey('250gr / Kağıt Filtre'), '');
  assert.equal(coffeeVariantChoiceKey('Gramaj: 250 Gr, Öğütme Derecesi: Metal Filtre'), '');
  assert.equal(coffeeVariantChoiceKey('Öğütülmemiş 250 G'), '');
  assert.equal(coffeeVariantChoiceKey('250 gr / Hario'), '');
  assert.equal(coffeeVariantChoiceKey('250 gr Delter Coffee Press'), '');
  assert.equal(coffeeVariantChoiceKey('Miktar: 250g, Öğütme: Türk Kahvesi'), '');
  assert.equal(coffeeVariantChoiceKey('Miktar: 250g, Öğütme: Coldbrew'), '');
  assert.equal(coffeeVariantChoiceKey('Kenya / V60'), 'kenya');
  assert.equal(coffeeVariantChoiceKey('Etiyopya / V60'), 'etiyopya');
  assert.equal(coffeeVariantChoiceKey('Kavurma Profili: Espresso, Öğütme: V60'), 'kavurma profili espresso');
});

test('aynı kahvede çekirdek varyantı tercih edilir', () => {
  const selected = chooseRepresentativeVariant([
    { id: 3, label: 'V60' },
    { id: 2, label: 'Çekirdek' },
    { id: 1, label: 'Metal Filtre' }
  ]);
  assert.equal(selected.id, 2);
});

test('stok grubunda tükenmiş çekirdek yerine alınabilir öğütüm seçilir', () => {
  const selected = chooseRepresentativeVariant([
    { id: 1, label: 'Çekirdek', lastInStock: false },
    { id: 2, label: 'V60', lastInStock: true }
  ]);
  assert.equal(selected.id, 2);
});
