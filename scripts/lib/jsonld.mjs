/**
 * schema.org JSON-LD ayrıştırma — saf fonksiyonlar, ağ bağımlılığı yok.
 *
 * Bilerek YAPILMAYAN şey: HTML gövdesinde "₺" veya "TL" geçen herhangi bir
 * sayıyı regex ile avlamak. Önceki denetimde (price_audit_2026-08-19) sahte
 * fiyatların %79'u tam olarak bu yöntemden geliyordu — kargo bedava eşiği,
 * taksit tutarı gibi ürün fiyatı olmayan sayılar yakalanmıştı. Burada SADECE
 * schema.org Product/Offer etiketindeki `price` alanına güveniliyor; bu alan
 * arama motorlarının zengin sonuç göstermek için kullandığı yapısal veridir,
 * serbest metin değildir.
 */

export function extractJsonLdNodes(html) {
  const nodes = [];
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    try { parsed = JSON.parse(match[1].trim()); } catch { continue; }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (item && Array.isArray(item['@graph'])) nodes.push(...item['@graph']);
      else if (item) nodes.push(item);
    }
  }
  return nodes;
}

const hasType = (node, typeName) => {
  const type = node?.['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.includes(typeName);
};

export function productNodesFrom(nodes) {
  return nodes.filter((node) => hasType(node, 'Product') && node.name);
}

/** Offer / AggregateOffer'ı düz bir Offer dizisine indirger. */
export function offersOf(product) {
  const offers = product?.offers;
  if (!offers) return [];
  if (Array.isArray(offers)) return offers.filter(Boolean);
  if (hasType(offers, 'AggregateOffer') && Array.isArray(offers.offers)) return offers.offers.filter(Boolean);
  return [offers];
}

/**
 * schema.org `price` alanı standarda göre düz ondalık sayıdır ("600" ya da
 * "1800.00"), Türkçe binlik/ondalık biçimi (1.250,50) DEĞİLDİR. Burada
 * lokalize ayrıştırma bilerek yapılmıyor — yapılırsa "1.250" gibi tam sayı
 * fiyatlar yanlışlıkla "1,25" olarak okunur.
 */
export function toNumber(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function availabilityToBool(value) {
  const text = String(value || '');
  if (/outofstock|soldout|discontinued/i.test(text)) return false;
  if (/instock|limitedavailability|preorder|backorder/i.test(text)) return true;
  return null; // bilinmiyor — false varsaymak yanlış olur
}

/** Sitemap URL süzgeci: ürün olmayan sayfaları eleyerek gereksiz fetch'i azaltır. */
export const NON_PRODUCT_PATH = /\/(cart|sepet|hesap|account|login|giris|kayit|sayfa|page|blog|haber|news|kampanya|iletisim|contact|hakkimizda|about|policy|politika|kvkk|iade|teslimat|sss|faq|kargo)(\/|$)/i;
export const NON_PAGE_EXT = /\.(jpg|jpeg|png|gif|webp|pdf|xml|css|js)$/i;
