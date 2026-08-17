const base = document.body.dataset.base || '/';
const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('tr-TR');
const date = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('tr-TR');
const els = Object.fromEntries(['search','origin','business','data-status','price-change','sort','product-rows','result-summary','prev','next','page-label','clear','stat-last-control','price-update-summary','footer-update'].map(id => [id, document.getElementById(id)]));
let all = [], filtered = [], page = 1;
const pageSize = 30;

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const available = (value, format = String) => value == null ? '<span class="missing">Erişilemedi</span>' : format(value);
const previousPrice = value => value == null ? '<span class="missing">Henüz yok</span>' : money.format(value);
const asDate = value => new Date(`${value}T00:00:00`);

function priceChangeStatus(row) {
  if (row.price == null || row.previousPrice == null) {
    return 'unknown';
  }
  if (row.price > row.previousPrice) return 'up';
  if (row.price < row.previousPrice) return 'down';
  return 'same';
}

function priceChange(row) {
  const status = priceChangeStatus(row);
  if (status === 'up') return '<span class="price-change price-change--up" title="Fiyat arttı" aria-label="Fiyat arttı">😟</span>';
  if (status === 'down') return '<span class="price-change price-change--down" title="Fiyat düştü" aria-label="Fiyat düştü">😊</span>';
  if (status === 'same') return '<span class="price-change price-change--same" title="Fiyat değişmedi" aria-label="Fiyat değişmedi">😐</span>';
  return '<span class="price-change price-change--unknown" title="Karşılaştırma için önceki fiyat henüz yok" aria-label="Önceki fiyat yok">—</span>';
}

function fillSelect(select, values) {
  values.sort((a,b) => a.localeCompare(b, 'tr')).forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`));
}

function applyFilters() {
  const q = els.search.value.trim().toLocaleLowerCase('tr');
  filtered = all.filter(row => {
    const text = `${row.business} ${row.product} ${row.origin} ${(row.aliases || []).join(' ')} ${row.instagram || ''}`.toLocaleLowerCase('tr');
    const state = els['data-status'].value;
    const change = els['price-change'].value;
    return (!q || text.includes(q)) && (!els.origin.value || row.origin === els.origin.value) && (!els.business.value || row.business === els.business.value)
      && (!state || (state === 'complete' && row.price && row.grams) || (state === 'price' && row.price) || (state === 'weight' && row.grams) || (state === 'missing' && (!row.price || !row.grams)))
      && (!change || priceChangeStatus(row) === change);
  });
  const sort = els.sort.value;
  filtered.sort((a,b) => sort === 'price-asc' ? (a.price ?? Infinity) - (b.price ?? Infinity) : sort === 'kg-asc' ? (a.pricePerKg ?? Infinity) - (b.pricePerKg ?? Infinity) : sort === 'kg-desc' ? (b.pricePerKg ?? -1) - (a.pricePerKg ?? -1) : a.business.localeCompare(b.business, 'tr'));
  page = 1; render();
}

function render() {
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pages);
  const rows = filtered.slice((page-1)*pageSize, page*pageSize);
  els['product-rows'].innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${esc(row.business)}</strong><small>${esc(row.businessStatus)}</small></td><td>${esc(row.product)}</td><td><span class="origin-pill">${esc(row.origin)}</span></td><td>${available(row.grams, v => `${number.format(v)} g`)}</td><td>${available(row.price, money.format)}</td><td>${previousPrice(row.previousPrice)}</td><td class="change-cell">${priceChange(row)}</td><td>${available(row.pricePerKg, money.format)}</td><td>${row.url ? `<a class="source-link" href="${esc(row.url)}" target="_blank" rel="noopener">Sayfaya git ↗</a>` : '<span class="missing">Erişilemedi</span>'}</td></tr>`).join('') : '<tr><td colspan="9" class="loading">Bu filtrelerle eşleşen kayıt bulunamadı.</td></tr>';
  const products = filtered.filter(row => row.catalogStatus === 'Ürün kaydı').length;
  const tracking = filtered.length - products;
  els['result-summary'].textContent = `${number.format(filtered.length)} toplam kayıt: ${number.format(products)} ürün + ${number.format(tracking)} takip kaydı`;
  els['page-label'].textContent = `${page} / ${pages}`;
  els.prev.disabled = page === 1; els.next.disabled = page === pages;
}

Promise.all([fetch(`${base}data/products.json`).then(r=>r.json()), fetch(`${base}data/metadata.json`).then(r=>r.json())]).then(([products, meta]) => {
  all = products; filtered = products;
  fillSelect(els.origin, [...new Set(all.map(r=>r.origin))]); fillSelect(els.business, [...new Set(all.map(r=>r.business))]);
  document.getElementById('stat-businesses').textContent = number.format(meta.businesses); document.getElementById('stat-products').textContent = number.format(meta.namedProducts); document.getElementById('stat-origins').textContent = number.format(meta.origins);
  document.getElementById('nav-count').textContent = `${number.format(meta.businesses)} kavurucu · ${number.format(meta.namedProducts)} ürün`;
  document.getElementById('hero-copy').textContent = `${number.format(meta.businesses)} kavurucunun çekirdeklerini tek yerde keşfedin. Menşeyi seçin, fiyatı karşılaştırın, doğru çekirdeğe doğrudan ulaşın.`;
  els['stat-last-control'].textContent = shortDate.format(asDate(meta.checkedAt));
  if (meta.priceComparisonCheckedAt) {
    const comparisonDate = date.format(asDate(meta.priceComparisonCheckedAt));
    els['price-update-summary'].textContent = `Fiyat karşılaştırması: ${comparisonDate} · ${number.format(meta.priceComparedBusinesses)} işletmede ${number.format(meta.priceComparedRows)} ürün`;
    els['footer-update'].textContent = `Son tam kontrol: ${date.format(asDate(meta.checkedAt))} · Fiyat karşılaştırması: ${comparisonDate}`;
  }
  render();
}).catch(() => { els['product-rows'].innerHTML = '<tr><td colspan="9" class="loading">Veri yüklenemedi.</td></tr>'; });

['search','origin','business','data-status','price-change','sort'].forEach(id => els[id].addEventListener(id === 'search' ? 'input' : 'change', applyFilters));
els.prev.addEventListener('click', () => { page--; render(); }); els.next.addEventListener('click', () => { page++; render(); });
els.clear.addEventListener('click', () => { ['search','origin','business','data-status','price-change'].forEach(id => els[id].value=''); els.sort.value='business'; applyFilters(); });
