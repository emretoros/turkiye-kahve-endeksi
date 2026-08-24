/**
 * Katalog sınıflandırma yardımcıları — prepare-data.mjs için.
 *
 * Üç iş yapar:
 *   1. Kahve dışı ürünleri listeden düşürmek (nonCoffeeRules — eski
 *      prepare-data.mjs'ten BİREBİR taşındı, kategori/regex isimleri aynı).
 *   2. Menşe (hangi ülke) tahmini — ürün adındaki ülke isimlerine bakan bir
 *      sözlük eşleşmesi. Eski veri setinde menşe bir LLM/insan incelemesiyle
 *      atanmıştı; yeni toplayıcılar (Shopify/Woo/ikas/JSON-LD) bu adımı
 *      YAPMIYOR. Bu yüzden burada kural tabanlı, bilerek MÜTEVAZİ bir tahmin
 *      var: eşleşme yoksa "Menşe belirtilmemiş" — yanlış menşe söylemektense
 *      boş bırakmak tercih edildi (fiyat karantina mantığındaki "yanlış
 *      veriden çok veri yok" ilkesiyle aynı).
 *   3. Ürün tipi (tek köken / harman / Türk kahvesi / kapsül / aromalı) —
 *      aynı şekilde ürün adı üzerinden kural tabanlı tahmin.
 *
 * Menşe ve ürün tipi burada KESİN bilgi değil, en iyi tahmindir; ikisi de
 * yalnızca filtreleme/gösterim amaçlı, fiyat/kimlik bütünlüğünü etkilemez.
 */
import { normalize } from './identity.mjs';

/* ----------------------------------------------------- kahve dışı filtre */

const nonCoffeeRules = [
  // "makine|makinesi|grinder" BİLEREK genel: espresso/kahve makinesi marka+model
  // isimleri (ör. "La Marzocco Linea Micra") hiçbir ekipman kelimesi içermeyebilir
  // — bu durumları prepare-data.mjs'teki sayısal fiyat eşiği (UNGRAMMED_PRICE_MAX
  // mantığının aynısı) yakalar, bu liste yalnızca isimle yakalanabilenler içindir.
  ['Ekipman/aksesuar', /\b(server|dripper|chemex|aeropress|v60|phin filtre|filtre kagidi|filter paper|degirmen|ogutucu|grinder|makine|makinesi|ekipman|equipment|aksesuar|accessory|bardak|glass set|mug|fellow|tarti|scale|kettle|tamper|tamper mati|pitcher|ibrik|ibrigi|demleme seti|demleyici|olcu kasigi|kahve torbasi|seramik kupa|kahve kupasi|termos|difluid|refraktometre|analizor|pin\b)/],
  ['Çay ve içecek tozu', /\b(adacay|cay|tea|matcha|salep|sahlep|frappe|smoothie|milkshake|hindiba|chicory)/],
  ['Şurup', /\b(surup|surub|syrup)/],
  ['Çikolata/şekerleme', /\b(cikolata bari?|bean to bar|madlen|draje|lokum|sekerleme|bonte|roche|cookie|kurabiye|granola)\b/],
  ['Gıda dışı ürün', /\b(kolonya|sabun|t-shirt|tisort|canta)/],
  ['Eğitim/hizmet', /\b(egitim|course|sertifikasyon|workshop|q grader|sensory skills|kahve hasadi turu|kahve turu|bookeasy|barista egitimi|promosyon kahve)/],
  ['Kavrulmamış kahve', /\b(yesil kahve|yesil kahve cekirdegi|yesil cekirdek|green coffee)/],
  ['Sos/püre', /\b(pure|puree|sos|cool lime)/],
  ['Diğer gıda', /\b(hindistan cevizi|pirinc|chia|corekotu|hibiskus|tuz|kakule|karabiber|karanfil|karbonat|karabugday|keten tohumu|kimyon|kinoa|nar eksisi|nohut unu|tarcin|zencefil|zerdecal)\b/],
  // Tüketici karşılaştırması için: palet/toptan birimleri gerçek kahve ama tek
  // paket fiyatıyla kıyaslanamaz (bkz. proje önceliği: önce tüketici, B2B sonra).
  ['Toptan/B2B satış', /\bpalet\b|\btoptan\b|\bwholesale\b/],
  // Türkçe ünsüz yumuşaması ("abonelik" → "aboneliği") yüzünden kök "abone"
  // olarak bırakıldı; \b yalnızca kelime BAŞINDA aranıyor.
  ['Abonelik', /\babone|\bsubscription\b/]
];

/**
 * @param {string} text - ürün adı + URL (ve varsa açıklama) birleşik metni
 * @returns {string|null} dışlama sebebi, ya da kahve ürünüyse null
 */
export function exclusionReason(text) {
  const haystack = normalize(text);

  // "Çikolatalı kahve" bir kahve ürünüdür; çikolata barı/sıcak çikolata değildir.
  if (/\b(sicak cikolata|cikolata kalibi|paper chocolate)\b/.test(haystack)) {
    return 'Çikolata/şekerleme';
  }
  if (/\bcikolata\b/.test(haystack) && !/\b(kahve|filtre|turk|dibek|aromali|espresso)\b/.test(haystack)) {
    return 'Çikolata/şekerleme';
  }

  for (const [reason, pattern] of nonCoffeeRules) {
    if (pattern.test(haystack)) return reason;
  }
  return null;
}

/* ------------------------------------------------------------------ menşe */

const ORIGIN_KEYWORDS = [
  ['Etiyopya', /etiyopya|ethiopia|yirgacheffe|sidamo|guji/],
  ['Kolombiya', /kolombiya|colombia/],
  ['Brezilya', /brezilya|brasil|brazil/],
  ['Guatemala', /guatemala/],
  ['Kenya', /\bkenya\b/],
  ['Honduras', /honduras/],
  ['El Salvador', /el salvador/],
  ['Kosta Rika', /kosta rika|costa rica/],
  ['Nikaragua', /nikaragua|nicaragua/],
  ['Meksika', /meksika|mexico/],
  ['Peru', /\bperu\b/],
  ['Yemen', /\byemen\b/],
  ['Endonezya', /endonezya|indonesia|sumatra|sumatera|\bjava\b|mandailing|toraja/],
  ['Hindistan', /hindistan|\bindia\b/],
  ['Tanzanya', /tanzanya|tanzania/],
  ['Ruanda', /ruanda|rwanda/],
  ['Burundi', /burundi/],
  ['Panama', /panama/],
  ['Bolivya', /bolivya|bolivia/],
  ['Uganda', /uganda/],
  ['Papua Yeni Gine', /papua/]
];

/**
 * Ürün adından (gerekirse açıklamadan) menşe ülke(ler)ini tahmin eder.
 * Birden fazla ülke geçiyorsa " | " ile birleştirir (harman sinyali).
 */
export function guessOrigin(text) {
  const haystack = normalize(text);
  const hits = [];
  for (const [label, pattern] of ORIGIN_KEYWORDS) {
    if (pattern.test(haystack) && !hits.includes(label)) hits.push(label);
  }
  if (hits.length) return hits.join(' | ');
  if (/\bcoklu mense\b/.test(haystack)) return 'Çoklu menşe';
  return 'Menşe belirtilmemiş';
}

/* ---------------------------------------------------------------- tip */

/**
 * Ürün adından kaba bir ürün tipi tahmini üretir. guessOrigin'in SONUCUNU
 * girdi olarak alır (harman/tek-köken ayrımı için).
 */
export function guessProductType(text, origin) {
  const haystack = normalize(text);
  if (/kapsul|capsule|nespresso|dolce gusto/.test(haystack)) return 'Kapsül kahve';
  if (/turk kahvesi|turkish coffee|dibek/.test(haystack)) return 'Türk kahvesi';
  if (/(vanilya|karamel|findikli|hazelnut|caramel|vanilla|amaretto|cikolatali kahve)/.test(haystack)) return 'Aromalı kahve';

  const originCount = origin && origin !== 'Menşe belirtilmemiş' && origin !== 'Çoklu menşe'
    ? origin.split('|').length : 0;
  if (/\bharman\b|\bblend\b/.test(haystack) || origin === 'Çoklu menşe' || originCount > 1) return 'Harman';
  if (originCount === 1) return 'Tek köken';
  return 'Kahve ürünü';
}

/** Bir varyant etiketinin salt gramaj bilgisi taşıyıp taşımadığını kontrol eder. */
export function isWeightOnlyLabel(label) {
  const stripped = normalize(label)
    .replace(/\d+(?:[.,]\d+)?\s*(kg|kilo|g|gr|gram)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return stripped.length === 0;
}

/* --------------------------------------------------------- varyant seçimi */

const WEIGHT_SEGMENT = /^(?:gramaj\s*)?\d+(?:[.,]\d+)?\s*(?:kg|kilo|g|gr|gram)$/;
const GRIND_SEGMENT = /^(?:(?:ogutme|ogutme derecesi|ogutum|demleme)\s*)?(?:cekirdek|ogutulmemis|cekirdek ogutulmemis|whole bean|v60|hario|aeropress|french ?press|kagit filtre|metal filtre|moka ?pot|chemex|espresso ogutulmus|espresso|filtre(?: kahve(?: makinesi)?)?|manuel demleme|cold ?brew|turk kahvesi)$/;

/**
 * Varyant etiketinden gramaj ve öğütme/demleme seçeneğini çıkarıp gerçek ürün
 * seçimini döndürür. Aynı kahvenin "Çekirdek / V60 / Kağıt Filtre" satırları
 * böylece aynı gruba düşerken "Kenya / V60" ile "Etiyopya / V60" ayrık kalır.
 */
export function coffeeVariantChoiceKey(label) {
  return normalize(label || '')
    .split(/\s*(?:\/|\||,|;)\s*/)
    .map((part) => part.replace(/:/g, ' ').replace(/\s+/g, ' ').trim())
    // Ağırlık bazen öğütümle aynı parçada gelir ("Öğütülmemiş 250 G").
    // Önce ağırlığı temizlemek, bu etiketlerin sahte bir kahve seçimi olarak
    // kalmasını engeller.
    .map((part) => part
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|kilo|g|gr|gram)\b/g, '')
      .replace(/^(?:gramaj|miktar|weight|agirlik)\s*$/, '')
      .trim())
    .filter((part) => part && !WEIGHT_SEGMENT.test(part) && !GRIND_SEGMENT.test(part))
    .join(' | ');
}

/** Aynı kahve/gramaj grubunda gösterilecek en kararlı varyantı seçer. */
export function chooseRepresentativeVariant(variants) {
  return variants.slice().sort((a, b) => {
    const rank = (variant) => {
      const label = normalize(variant.label || '');
      const stockRank = variant.lastInStock === true ? 0 : variant.lastInStock == null ? 1 : 2;
      const labelRank = /\b(cekirdek ogutulmemis|whole bean|cekirdek)\b/.test(label) ? 0
        : (!label || label === 'default title' || isWeightOnlyLabel(label) ? 1 : 2);
      return stockRank * 10 + labelRank;
    };
    return rank(a) - rank(b) || Number(a.id || 0) - Number(b.id || 0);
  })[0] || null;
}
