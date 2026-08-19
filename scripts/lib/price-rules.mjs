/**
 * Fiyat karantina kuralları.
 *
 * Amaç: geçmiş serisine (price_observation) zehirli veri girmesini engellemek.
 * Bir gözlem karantinaya alındığında SİLİNMEZ — saklanır ama yayınlanmaz ve
 * endeks hesabına katılmaz. Böylece kural yanlışsa geri alınabilir.
 */

/** Regex ile HTML'den fiyat kazınan, yapısal olmayan kaynaklar. */
const UNSTRUCTURED_SOURCE = /Site haritası ürün sayfası|Mağaza\/katalog bağlantısı|Ana sayfa ürün kartı|HTML ürün kartı/i;

/** Platform API'sinden ya da JSON-LD'den gelen, alan adı belli kaynaklar. */
const STRUCTURED_SOURCE = /Shopify|WooCommerce|ikas|JSON-LD|manuel\/API|Store API/i;

export const isUnstructured = (sourceMethod) =>
  UNSTRUCTURED_SOURCE.test(sourceMethod || '') && !STRUCTURED_SOURCE.test(sourceMethod || '');

/** Türkiye perakendesinde çekirdek kahve için makul kg fiyatı bandı (TL). */
export const KG_PRICE_MIN = 200;
export const KG_PRICE_MAX = 25000;

/** Bunun altındaki her fiyat ürün fiyatı değildir (taksit, puan, adet vb.). */
export const ABSOLUTE_MIN_PRICE = 30;

/**
 * Makul ambalaj gramajı bandı.
 * Altı: demleme dozu ("12 g espresso") açıklamadan kazınmış demektir.
 * Üstü: çuval/dökme ("60 kg") demektir, perakende ambalaj değil.
 */
export const GRAMS_MIN = 50;
export const GRAMS_MAX = 6000;

const normalize = (value) => String(value || '')
  .toLocaleLowerCase('tr-TR')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/ı/g, 'i');

/**
 * prepare-data.mjs'in eleme listesinden sızan ekipman kalıpları.
 *
 * "makine|makinesi|grinder|degirmen" BİLEREK genel tutuldu: La Marzocco,
 * Jura, Astoria gibi marka+model isimleri (ör. "La Marzocco Linea Micra")
 * hiçbir ekipman kelimesi İÇERMEYEBİLİR — bu yüzden marka listesi kovalamak
 * yerine aşağıdaki UNGRAMMED_PRICE_MAX sayısal eşiği asıl güvenlik ağı.
 */
const EQUIPMENT = /\b(hario|v60|chemex|aeropress|kalita|fellow|comandante|timemore|origami|surahi|olcu kasigi|dripper|server|kettle|tamper|tarti|terazi|cezve|ibrik|french press|moka pot|filtre kagidi|kupa|mug|termos|cuval|stanley|barista aparat|makine|makinesi|grinder|degirmen)\b/;

/**
 * Abonelikler kahve ürünüdür ama birim fiyatı ürün fiyatıyla kıyaslanamaz.
 * "abone" kökü BİLEREK sondan sınırsız (\b yalnızca baştan): Türkçe ünsüz
 * yumuşaması "abonelik" → "aboneliği" gibi çekimlerde kökü değiştirir
 * (k→ğ), "abonelik" sabit dizesi bu çekimleri YAKALAMAZ.
 */
const SUBSCRIPTION = /\babone|\bsubscription\b/;

/** Palet/toptan satış birimleri — gerçek kahve ama tek tüketici paketiyle kıyaslanamaz. */
const WHOLESALE = /\bpalet\b|\btoptan\b|\bwholesale\b/;

/** Kargo eşiği olarak sık kullanılan yuvarlak tutarlar. */
const SHIPPING_THRESHOLDS = new Set([250, 300, 350, 400, 450, 500, 600, 750, 800, 1000, 1250, 1500, 2000, 2500]);

/** Aynı işletmede bir fiyatın kaç üründe tekrar etmesi şüpheli sayılır. */
export const REPEAT_THRESHOLD = 4;
export const ROUND_REPEAT_THRESHOLD = 2;

/** Önceki gözleme göre bu orandan büyük sıçrama manuel incelemeye düşer. */
export const JUMP_RATIO = 0.6;

/**
 * Gramajı belirlenemeyen (parseGrams boşa çıkan) bir üründe bu tutarın
 * üzerindeki fiyat, ekipman/marka-model isimli ürün (ör. "La Marzocco Linea
 * Micra" — hiçbir ekipman kelimesi içermez) ya da toptan/palet fiyatı
 * sızıntısıdır. Anahtar kelime listesi kovalamak yerine sayısal bir
 * güvenlik ağı: gramajsız hiçbir perakende kahve paketi bu kadar tutmaz.
 */
export const UNGRAMMED_PRICE_MAX = 15000;

const pricePerKg = (row) =>
  Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.grams) && row.grams > 0
    ? (row.price / row.grams) * 1000
    : null;

/**
 * Kuralları uygular.
 *
 * @param {Array} rows  broad_products.json biçiminde satırlar
 * @returns {{rows: Array, summary: Object}} her satıra `flags` ve `quarantined` eklenmiş hali
 */
export function applyPriceRules(rows) {
  // --- Ön geçiş: işletme bazında fiyat tekrar sayımı -------------------------
  // Tekrar sayarken aynı ürünün varyantlarını değil, farklı ürünleri sayıyoruz;
  // yoksa "her 250 g 450 TL" gibi meşru fiyatlandırma yanlışlıkla yakalanır.
  const repeatCount = new Map(); // "business|price" -> Set<ürün adı>
  for (const row of rows) {
    if (!Number.isFinite(row.price) || row.price <= 0) continue;
    if (!isUnstructured(row.sourceMethod)) continue;
    const key = `${row.business}|${row.price}`;
    if (!repeatCount.has(key)) repeatCount.set(key, new Set());
    repeatCount.get(key).add((row.product || '').trim().toLocaleLowerCase('tr-TR'));
  }

  const summary = {
    total: rows.length,
    withPrice: 0,
    quarantined: 0,
    review: 0,
    byRule: {},
    byBusiness: {}
  };

  const bump = (rule) => { summary.byRule[rule] = (summary.byRule[rule] || 0) + 1; };

  const out = rows.map((row) => {
    const flags = [];
    const price = Number.isFinite(row.price) && row.price > 0 ? row.price : null;
    if (price !== null) summary.withPrice += 1;

    const haystack = normalize(`${row.product} ${row.url || ''}`);

    // R7 — gramaj ambalaj ağırlığı değil, demleme dozu veya çuval boyu.
    // Fiyat doğru olabilir; bozuk olan gramaj, o yüzden gramajı düşürüyoruz.
    const gramsPlausible = Number.isFinite(row.grams) && row.grams >= GRAMS_MIN && row.grams <= GRAMS_MAX;
    if (Number.isFinite(row.grams) && !gramsPlausible) {
      flags.push({
        rule: 'SUSPECT_GRAMS',
        severity: 'review',
        detail: `${row.grams} g ambalaj olamaz (${GRAMS_MIN}–${GRAMS_MAX} bandı dışı)`
      });
    }

    // R8 — kahve dışı ürün elemesinden sızan ekipman.
    if (EQUIPMENT.test(haystack)) {
      flags.push({ rule: 'NON_COFFEE_LEAK', severity: 'quarantine', detail: 'ekipman/aksesuar kalıbı eşleşti' });
    }

    // R9 — abonelik: gerçek ürün ama birim fiyatı kıyaslanabilir değil.
    if (SUBSCRIPTION.test(haystack)) {
      flags.push({ rule: 'SUBSCRIPTION', severity: 'quarantine', detail: 'abonelik ürünü, birim fiyat kıyaslanamaz' });
    }

    // R11 — palet/toptan: gerçek kahve ama tek paket fiyatıyla kıyaslanamaz.
    if (WHOLESALE.test(haystack)) {
      flags.push({ rule: 'WHOLESALE', severity: 'quarantine', detail: 'palet/toptan satış birimi' });
    }

    if (price !== null) {
      // R5 — mutlak alt sınır. "8 TL kahve" diye bir şey yok.
      if (price < ABSOLUTE_MIN_PRICE) {
        flags.push({ rule: 'ABSOLUTE_MIN', severity: 'quarantine', detail: `${price} TL < ${ABSOLUTE_MIN_PRICE} TL` });
      }

      // R10 — gramajsız + aşırı yüksek fiyat: ekipman/marka-model ya da yanlış birim.
      if (!gramsPlausible && price > UNGRAMMED_PRICE_MAX) {
        flags.push({
          rule: 'HIGH_PRICE_NO_GRAMS',
          severity: 'quarantine',
          detail: `${price} TL, gramaj yok/belirsiz — ${UNGRAMMED_PRICE_MAX} TL eşiğinin üstünde`
        });
      }

      // R1 — aynı işletmede aynı fiyatın çok sayıda farklı üründe tekrar etmesi.
      const distinct = repeatCount.get(`${row.business}|${price}`)?.size ?? 0;
      if (distinct >= REPEAT_THRESHOLD) {
        flags.push({
          rule: 'REPEATED_PRICE',
          severity: 'quarantine',
          detail: `${row.business} içinde ${distinct} farklı üründe aynı ${price} TL`
        });
      } else if (distinct >= ROUND_REPEAT_THRESHOLD && SHIPPING_THRESHOLDS.has(price)) {
        // R3 — yuvarlak tutar + tekrar = kargo eşiği imzası.
        flags.push({
          rule: 'SHIPPING_THRESHOLD',
          severity: 'quarantine',
          detail: `${price} TL yuvarlak eşik, ${distinct} üründe tekrar ediyor`
        });
      }

      // R2 — kg fiyatı makul bandın dışında. Yalnızca gramaj güvenilirse anlamlı;
      // aksi halde asıl arıza gramajdadır, fiyatta değil (bkz. R7).
      const perKg = gramsPlausible ? pricePerKg(row) : null;
      if (perKg !== null && (perKg < KG_PRICE_MIN || perKg > KG_PRICE_MAX)) {
        flags.push({
          rule: 'KG_PRICE_RANGE',
          severity: 'quarantine',
          detail: `${Math.round(perKg)} TL/kg bandın dışında (${KG_PRICE_MIN}–${KG_PRICE_MAX})`
        });
      }

      // R6 — önceki fiyata göre sert sıçrama. Silmiyoruz, insan baksın.
      if (Number.isFinite(row.previousPrice) && row.previousPrice > 0) {
        const ratio = Math.abs(price - row.previousPrice) / row.previousPrice;
        if (ratio > JUMP_RATIO) {
          flags.push({
            rule: 'PRICE_JUMP',
            severity: 'review',
            detail: `${row.previousPrice} → ${price} TL (%${Math.round(ratio * 100)})`
          });
        }
      }
    }

    // R4 — yapısal olmayan kaynak + gramaj yok: fiyat yayınlanamaz kalitede.
    if (price !== null && !Number.isFinite(row.grams) && isUnstructured(row.sourceMethod)) {
      flags.push({ rule: 'UNSTRUCTURED_NO_GRAMS', severity: 'review', detail: 'regex fiyat, gramaj doğrulanamıyor' });
    }

    const quarantined = flags.some((flag) => flag.severity === 'quarantine');
    const review = !quarantined && flags.some((flag) => flag.severity === 'review');
    if (quarantined) summary.quarantined += 1;
    if (review) summary.review += 1;
    for (const flag of flags) bump(flag.rule);
    if (quarantined) {
      summary.byBusiness[row.business] = (summary.byBusiness[row.business] || 0) + 1;
    }

    return { ...row, flags, quarantined, review };
  });

  return { rows: out, summary };
}
