/**
 * broad_products.json satırlarından + manuel onaylı eklerden birleşik
 * işletme listesi çıkarır. collect-identity.mjs'in eski inline döngüsünden
 * ayrıştırıldı — test edilebilir olsun diye.
 *
 * Her işletme için en çok geçen host, web sitesi olarak seçilir.
 * manualEntries (data/manual_roasters.json'dan gelir) yeni keşfedilip
 * insan onayından geçmiş işletmeleri temsil eder; oradaki website alanına
 * büyük bir başlangıç ağırlığı (+1000) verilir ki satır verisiyle çelişse
 * bile bizim belirttiğimiz site öncelikli sayılsın.
 */
import { hostOf } from './identity.mjs';

const MANUAL_HOST_WEIGHT = 1000;
const DEFAULT_MANUAL_STATUS = 'Kapsam doğrulaması bekliyor';

export function buildBusinessList(rows, manualEntries = []) {
  const byBusiness = new Map();

  for (const row of rows) {
    if (!row || !row.business) continue;
    if (!byBusiness.has(row.business)) {
      byBusiness.set(row.business, {
        business: row.business,
        city: row.city ?? null,
        businessStatus: row.businessStatus ?? null,
        instagram: row.instagram ?? null,
        hostCounts: new Map()
      });
    }
    if (row.url) {
      const host = hostOf(row.url);
      if (host) {
        const entry = byBusiness.get(row.business);
        entry.hostCounts.set(host, (entry.hostCounts.get(host) || 0) + 1);
      }
    }
  }

  for (const manual of manualEntries) {
    if (!manual || !manual.business) continue;
    if (!byBusiness.has(manual.business)) {
      byBusiness.set(manual.business, {
        business: manual.business,
        city: manual.city ?? null,
        businessStatus: manual.businessStatus ?? DEFAULT_MANUAL_STATUS,
        instagram: manual.instagram ?? null,
        hostCounts: new Map()
      });
    }
    const entry = byBusiness.get(manual.business);
    if (manual.website) {
      const host = hostOf(manual.website);
      if (host) entry.hostCounts.set(host, (entry.hostCounts.get(host) || 0) + MANUAL_HOST_WEIGHT);
    }
    if (manual.instagram && !entry.instagram) entry.instagram = manual.instagram;
    if (manual.city && !entry.city) entry.city = manual.city;
    if (manual.businessStatus && !entry.businessStatus) entry.businessStatus = manual.businessStatus;
  }

  return [...byBusiness.values()].map((entry) => {
    const topHost = [...entry.hostCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
      business: entry.business,
      city: entry.city,
      businessStatus: entry.businessStatus,
      instagram: entry.instagram,
      website: topHost ? `https://${topHost}` : null
    };
  });
}
