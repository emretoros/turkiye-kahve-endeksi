import test from 'node:test';
import assert from 'node:assert/strict';
import { exclusionReason, guessOrigin, guessProductType, isWeightOnlyLabel } from './catalog.mjs';

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
