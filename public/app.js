const base = document.body.dataset.base || '/';
const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('tr-TR');
const date = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('tr-TR');
const els = Object.fromEntries(['search','origin','business','price-change','weight-range','sort','product-rows','result-summary','prev','next','page-label','clear','stat-last-control','price-update-summary','footer-update','origin-guide','origin-guide-title','origin-guide-copy','advisor-launch','advisor-panel','advisor-close','advisor-messages','advisor-actions'].map(id => [id, document.getElementById(id)]));
let all = [], filtered = [], page = 1, history = {}, historyThrough = null, originGuides = {};
const pageSize = 30;

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const available = (value, format = String) => value == null ? '<span class="missing">Erişilemedi</span>' : format(value);
const asDate = value => new Date(`${value}T00:00:00`);

function priceChangeStatus(row) {
  if (row.price == null || row.previousPrice == null) return 'unknown';
  if (row.price > row.previousPrice) return 'up';
  if (row.price < row.previousPrice) return 'down';
  return 'same';
}

/* ------------------------------------------------------ fiyat geçmişi grafiği */

// Ham geçmiş yalnızca fiyat değiştiğinde yeni kayıt içerir. Grafikte zaman
// ekseninin gerçek takvim günlerini göstermesi için aradaki günleri son bilinen
// fiyatla dolduruyoruz. Böylece değişiklik olmayan günler de yatay çizgi ve
// ayrı birer günlük nokta olarak görünür.
function expandDailyHistory(rawPoints, throughDate) {
  if (!rawPoints.length) return [];

  const priceByDate = new Map();
  rawPoints.forEach(([dateValue, price]) => {
    if (typeof dateValue === 'string' && Number.isFinite(price) && price > 0) {
      priceByDate.set(dateValue.slice(0, 10), price);
    }
  });
  const dates = [...priceByDate.keys()].sort();
  if (!dates.length) return [];

  const firstDate = dates[0];
  const lastObservedDate = dates[dates.length - 1];
  const endDate = throughDate && throughDate >= lastObservedDate ? throughDate : lastObservedDate;
  const cursor = new Date(`${firstDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const points = [];
  let lastPrice = priceByDate.get(firstDate);

  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10);
    if (priceByDate.has(day)) lastPrice = priceByDate.get(day);
    points.push([day, lastPrice]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

function buildHistoryChart(points) {
  const W = 560, H = 220;
  const pad = { top: 24, right: 16, bottom: 28, left: 68 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const prices = points.map((p) => p[1]);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const span = maxP - minP;
  const yMin = span === 0 ? minP - Math.max(10, minP * 0.08) : minP - span * 0.15;
  const yMax = span === 0 ? maxP + Math.max(10, maxP * 0.08) : maxP + span * 0.15;
  const xFor = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yFor = (p) => pad.top + innerH - ((p - yMin) / (yMax - yMin)) * innerH;
  const coords = points.map((p, i) => [xFor(i), yFor(p[1])]);

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const priceLabel = (v) => money.format(v).replace(',00', '');

  const gridLines = [yMin, (yMin + yMax) / 2, yMax].map((t) => {
    const y = yFor(t);
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" class="history-grid" />`
      + `<text x="${pad.left - 10}" y="${(y + 4).toFixed(1)}" class="history-axis-label" text-anchor="end">${esc(priceLabel(t))}</text>`;
  }).join('');

  const dots = coords.map((c, i) => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="4" class="history-dot" />`).join('');

  const first = points[0], last = points[points.length - 1];
  const xLabels = `<text x="${pad.left}" y="${H - 8}" class="history-axis-label">${esc(shortDate.format(asDate(first[0])))}</text>`
    + (points.length > 1 ? `<text x="${W - pad.right}" y="${H - 8}" class="history-axis-label" text-anchor="end">${esc(shortDate.format(asDate(last[0])))}</text>` : '');

  const lastCoord = coords[coords.length - 1];
  const endLabel = `<text x="${(lastCoord[0] - 8).toFixed(1)}" y="${(lastCoord[1] - 12).toFixed(1)}" class="history-end-label" text-anchor="end">${esc(priceLabel(last[1]))}</text>`;

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="history-svg" role="img" aria-label="Fiyat geçmişi grafiği">`
    + gridLines
    + `<path d="${linePath}" class="history-line" fill="none" />`
    + dots + xLabels + endLabel
    + `<line class="history-crosshair" x1="0" y1="${pad.top}" x2="0" y2="${H - pad.bottom}" />`
    + `</svg>`;

  return { svg, coords, points, W, H };
}

function attachHistoryInteraction(wrap, chart) {
  const svg = wrap.querySelector('.history-svg');
  const crosshair = svg.querySelector('.history-crosshair');
  const tooltip = wrap.querySelector('.history-tooltip');
  const dots = [...svg.querySelectorAll('.history-dot')];

  function moveTo(clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const svgX = relX * chart.W;
    let nearest = 0, nearestDist = Infinity;
    chart.coords.forEach((c, i) => { const d = Math.abs(c[0] - svgX); if (d < nearestDist) { nearestDist = d; nearest = i; } });
    const [cx, cy] = chart.coords[nearest];
    crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx);
    crosshair.style.opacity = '1';
    dots.forEach((d, i) => d.classList.toggle('is-active', i === nearest));
    const point = chart.points[nearest];
    tooltip.innerHTML = `<strong></strong><span></span>`;
    tooltip.querySelector('strong').textContent = money.format(point[1]);
    tooltip.querySelector('span').textContent = date.format(asDate(point[0]));
    tooltip.style.opacity = '1';
    const wrapRect = wrap.getBoundingClientRect();
    const scaleX = rect.width / chart.W, scaleY = rect.height / chart.H;
    tooltip.style.left = `${(cx * scaleX) + (rect.left - wrapRect.left)}px`;
    tooltip.style.top = `${(cy * scaleY) + (rect.top - wrapRect.top)}px`;
  }

  function hide() {
    crosshair.style.opacity = '0'; tooltip.style.opacity = '0';
    dots.forEach((d) => d.classList.remove('is-active'));
  }

  svg.addEventListener('pointermove', (e) => moveTo(e.clientX));
  svg.addEventListener('pointerleave', hide);
  hide();
}

let historyOverlay = null;
let lastHistoryTrigger = null;

function createHistoryOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'history-overlay';
  overlay.className = 'history-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'history-title');
  overlay.innerHTML = `<div class="history-card">
    <button type="button" class="history-close" aria-label="Kapat">×</button>
    <p class="history-eyebrow"></p>
    <h3 id="history-title"></h3>
    <div class="history-stats"></div>
    <div class="history-chart-wrap"></div>
    <ul class="history-list"></ul>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHistoryModal(); });
  overlay.querySelector('.history-close').addEventListener('click', closeHistoryModal);
  return overlay;
}

function closeHistoryModal() {
  if (!historyOverlay || historyOverlay.hidden) return;
  historyOverlay.hidden = true;
  document.body.classList.remove('history-open');
  lastHistoryTrigger?.focus();
}

function openHistoryModal(row, trigger) {
  const rawPoints = row.variantId == null ? [] : (history[row.variantId] || []);
  const points = expandDailyHistory(rawPoints, historyThrough);
  if (!historyOverlay) historyOverlay = createHistoryOverlay();
  lastHistoryTrigger = trigger || null;

  historyOverlay.querySelector('.history-eyebrow').textContent = row.business;
  historyOverlay.querySelector('#history-title').textContent = row.product;
  const statsEl = historyOverlay.querySelector('.history-stats');
  const chartWrap = historyOverlay.querySelector('.history-chart-wrap');
  const listEl = historyOverlay.querySelector('.history-list');

  if (!points.length) {
    statsEl.innerHTML = '';
    chartWrap.innerHTML = '<p class="history-empty">Bu ürün için fiyat geçmişi henüz yok.</p>';
    listEl.innerHTML = '';
  } else {
    const prices = points.map((p) => p[1]);
    const min = Math.min(...prices), max = Math.max(...prices), current = prices[prices.length - 1];
    statsEl.innerHTML = `<div><strong></strong><span>güncel fiyat</span></div><div><strong></strong><span>en düşük</span></div><div><strong></strong><span>en yüksek</span></div>`;
    const strongs = statsEl.querySelectorAll('strong');
    strongs[0].textContent = money.format(current);
    strongs[1].textContent = money.format(min);
    strongs[2].textContent = money.format(max);

    if (points.length >= 2) {
      const chart = buildHistoryChart(points);
      chartWrap.innerHTML = `${chart.svg}<div class="history-tooltip" role="status" aria-live="polite"></div>`;
      attachHistoryInteraction(chartWrap, chart);
    } else {
      chartWrap.innerHTML = '<p class="history-empty">Henüz yalnızca 1 gözlem var — her gün otomatik güncellemeyle geçmiş birikmeye devam edecek.</p>';
    }

    listEl.innerHTML = '';
    points.slice().reverse().forEach(([d, p]) => {
      const li = document.createElement('li');
      const dateSpan = document.createElement('span'); dateSpan.textContent = date.format(asDate(d));
      const priceStrong = document.createElement('strong'); priceStrong.textContent = money.format(p);
      li.append(dateSpan, priceStrong);
      listEl.appendChild(li);
    });
  }

  historyOverlay.hidden = false;
  document.body.classList.add('history-open');
  historyOverlay.querySelector('.history-close').focus();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHistoryModal(); });

function fillSelect(select, values) {
  values.sort((a,b) => a.localeCompare(b, 'tr')).forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`));
}

function weightMatches(row, range) {
  if (!range) return true;
  if (range === 'unknown') return row.grams == null;
  if (row.grams == null) return false;
  if (range === 'lt250') return row.grams < 250;
  if (range === 'eq250') return row.grams === 250;
  if (range === 'gt250') return row.grams > 250;
  return true;
}

function originGuideCopy(origin) {
  let copy = originGuides[origin];
  if (!copy && origin.includes(' | ')) {
    const countries = origin.split(' | ');
    copy = `Bu kayıt ${countries.join(', ')} menşelerini bir araya getiriyor. Farklı ülkelerin çekirdekleri dengeli, katmanlı veya belirli bir tat hedefi için harmanlanmış olabilir. Son karakter kullanılan oranlara, işleme yöntemlerine ve kavurma profiline göre değişir.`;
  }
  return copy || originGuides['Menşe belirtilmemiş'] || '';
}

function updateOriginGuide() {
  const origin = els.origin.value;
  if (!origin) {
    els['origin-guide'].hidden = true;
    return;
  }

  els['origin-guide-title'].textContent = origin;
  els['origin-guide-copy'].textContent = originGuideCopy(origin);
  els['origin-guide'].hidden = false;
}

/* ----------------------------------------------------- seçim asistanı */

const advisorState = { prefs: {}, started: false };
const brewOptions = [
  ['v60', 'V60 / filtre'], ['aeropress', 'AeroPress'], ['french', 'French Press'],
  ['espresso', 'Espresso makinesi'], ['moka', 'Moka Pot'], ['turkish', 'Türk kahvesi'], ['any', 'Fark etmez']
];

function advisorBubble(text, role = 'bot') {
  const bubble = document.createElement('div');
  bubble.className = `advisor-bubble advisor-bubble--${role}`;
  bubble.textContent = text;
  els['advisor-messages'].appendChild(bubble);
  els['advisor-messages'].scrollTop = els['advisor-messages'].scrollHeight;
}

function advisorButtons(options, onSelect) {
  els['advisor-actions'].innerHTML = '';
  options.forEach(([value, label]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => onSelect(value, label));
    els['advisor-actions'].appendChild(button);
  });
}

function advisorSelect(options, buttonLabel, onSelect) {
  els['advisor-actions'].innerHTML = '';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Seçiminiz');
  options.forEach(([value, label]) => select.add(new Option(label, value)));
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = buttonLabel;
  button.addEventListener('click', () => onSelect(select.value, select.options[select.selectedIndex].text));
  els['advisor-actions'].append(select, button);
  return select;
}

function askAdvisorOrigin() {
  advisorBubble('Hangi menşeyi tercih edersiniz? Emin değilseniz “Fark etmez” diyebilirsiniz.');
  const origins = [...new Set(all.map((row) => row.origin))]
    .filter((origin) => origin && origin !== 'Erişilemedi' && !origin.includes(' | '))
    .sort((a, b) => a.localeCompare(b, 'tr'));
  const select = advisorSelect([['any', 'Fark etmez'], ...origins.map((origin) => [origin, origin])], 'Devam et', (value, label) => {
    advisorState.prefs.origin = value;
    advisorBubble(label, 'user');
    if (value !== 'any') advisorBubble(`${label} hakkında: ${originGuideCopy(value)}`);
    askAdvisorBudget();
  });
  const guide = document.createElement('aside');
  guide.className = 'advisor-origin-guide';
  guide.setAttribute('aria-live', 'polite');
  guide.hidden = true;
  guide.innerHTML = '<small>Menşe rehberi</small><strong></strong><p></p>';
  els['advisor-messages'].appendChild(guide);
  select.addEventListener('change', () => {
    const origin = select.value;
    guide.hidden = origin === 'any';
    if (origin === 'any') return;
    guide.querySelector('strong').textContent = origin;
    guide.querySelector('p').textContent = originGuideCopy(origin);
    els['advisor-messages'].scrollTop = els['advisor-messages'].scrollHeight;
  });
}

function askAdvisorBudget() {
  advisorBubble('Bir paket için azami bütçeniz nedir?');
  advisorButtons([['500', '500 TL'], ['750', '750 TL'], ['1000', '1.000 TL'], ['1500', '1.500 TL'], ['2500', '2.500 TL'], ['any', 'Fark etmez']], (value, label) => {
    advisorState.prefs.budget = value; advisorBubble(label, 'user'); askAdvisorGrams();
  });
}

function askAdvisorGrams() {
  advisorBubble('Hangi paket gramajını istersiniz?');
  const counts = new Map();
  all.forEach((row) => { if (row.grams) counts.set(row.grams, (counts.get(row.grams) || 0) + 1); });
  const grams = [...counts.entries()].filter(([, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1]).slice(0, 7).map(([value]) => value).sort((a, b) => a - b);
  advisorSelect([['any', 'Fark etmez'], ...grams.map((value) => [String(value), `${number.format(value)} g`])], 'Önerileri göster', (value, label) => {
    advisorState.prefs.grams = value; advisorBubble(label, 'user'); showAdvisorResults();
  });
}

function showAdvisorResults() {
  const result = globalThis.CoffeeRecommender.recommend(all, advisorState.prefs);
  els['advisor-actions'].innerHTML = '';
  if (!result.recommendations.length) {
    advisorBubble('Bu tercihlerin tamamına uyan ve stokta olduğu doğrulanan ürün bulamadım. Bütçe, menşe veya gramajı esneterek yeniden deneyebilirsiniz.');
    advisorButtons([['restart', 'Yeniden başla']], () => resetAdvisor());
    return;
  }
  advisorBubble(result.recommendations.length >= 5
    ? `Stokta olduğu doğrulanan ${number.format(result.matches.length)} eşleşme arasından beş seçenek buldum. İlk kart en ucuz, son kart en pahalı eşleşmedir.`
    : `Bu tercihlere uyan ve stokta olduğu doğrulanan ${number.format(result.recommendations.length)} ürün buldum; mevcut eşleşmelerin tamamını gösteriyorum.`);

  const list = document.createElement('div'); list.className = 'advisor-results';
  result.recommendations.forEach((row, index) => {
    const card = document.createElement('article'); card.className = 'advisor-result';
    const badge = index === 0 ? 'En ucuz' : index === result.recommendations.length - 1 ? 'En pahalı' : 'Alternatif';
    card.innerHTML = `<span>${badge}</span><span class="advisor-stock">● Stokta</span><h3>${esc(row.product)}</h3><p>${esc(row.business)} · ${esc(row.origin)} · ${number.format(row.grams)} g</p><strong>${money.format(row.price)}</strong><small>Son stok kontrolü: ${row.checkedAt ? shortDate.format(asDate(row.checkedAt)) : 'Bilinmiyor'}</small><a href="${esc(row.url)}" target="_blank" rel="noopener">Ürüne git ↗</a>`;
    list.appendChild(card);
  });
  els['advisor-messages'].appendChild(list);
  els['advisor-messages'].scrollTop = els['advisor-messages'].scrollHeight;
  advisorButtons([['restart', 'Yeniden başla'], ['close', 'Kapat']], (value) => value === 'close' ? closeAdvisor() : resetAdvisor());
}

function resetAdvisor() {
  advisorState.prefs = {}; advisorState.started = true;
  els['advisor-messages'].innerHTML = '';
  advisorBubble('Merhaba! Birkaç kısa seçimle size uygun kahveleri bulacağım. Hangi ekipmanla demliyorsunuz?');
  advisorButtons(brewOptions, (value, label) => {
    advisorState.prefs.brew = value; advisorBubble(label, 'user'); askAdvisorOrigin();
  });
}

function openAdvisor() {
  els['advisor-panel'].hidden = false;
  els['advisor-launch'].setAttribute('aria-expanded', 'true');
  if (!advisorState.started) resetAdvisor();
  els['advisor-close'].focus();
}

function closeAdvisor() {
  els['advisor-panel'].hidden = true;
  els['advisor-launch'].setAttribute('aria-expanded', 'false');
  els['advisor-launch'].focus();
}

function applyFilters() {
  const q = els.search.value.trim().toLocaleLowerCase('tr');
  filtered = all.filter(row => {
    const text = `${row.business} ${row.product} ${row.origin} ${(row.aliases || []).join(' ')} ${row.instagram || ''}`.toLocaleLowerCase('tr');
    const weightRange = els['weight-range'].value;
    const change = els['price-change'].value;
    return (!q || text.includes(q)) && (!els.origin.value || row.origin === els.origin.value) && (!els.business.value || row.business === els.business.value)
      && (!change || priceChangeStatus(row) === change)
      && weightMatches(row, weightRange);
  });
  const sort = els.sort.value;
  filtered.sort((a,b) => sort === 'price-asc' ? (a.price ?? Infinity) - (b.price ?? Infinity) : a.business.localeCompare(b.business, 'tr'));
  updateOriginGuide();
  page = 1; render();
}

function historyCell(row) {
  const points = row.variantId == null ? null : history[row.variantId];
  if (!points || !points.length) return '<span class="missing">—</span>';
  return `<button type="button" class="history-btn" data-variant="${row.variantId}">Geçmiş</button>`;
}

function render() {
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pages);
  const rows = filtered.slice((page-1)*pageSize, page*pageSize);
  els['product-rows'].innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${esc(row.business)}</strong><small>${esc(row.businessStatus)}</small></td><td>${esc(row.product)}</td><td><span class="origin-pill">${esc(row.origin)}</span></td><td>${available(row.grams, v => `${number.format(v)} g`)}</td><td>${available(row.price, money.format)}</td><td class="history-cell">${historyCell(row)}</td><td>${row.url ? `<a class="source-link" href="${esc(row.url)}" target="_blank" rel="noopener">Web sitesine git ↗</a>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="loading">Bu filtrelerle eşleşen kayıt bulunamadı.</td></tr>';
  const products = filtered.filter(row => row.catalogStatus === 'Ürün kaydı').length;
  const tracking = filtered.length - products;
  els['result-summary'].textContent = `${number.format(filtered.length)} toplam kayıt: ${number.format(products)} ürün + ${number.format(tracking)} takip kaydı`;
  els['page-label'].textContent = `${page} / ${pages}`;
  els.prev.disabled = page === 1; els.next.disabled = page === pages;
}

Promise.all([fetch(`${base}data/products.json`).then(r=>r.json()), fetch(`${base}data/metadata.json`).then(r=>r.json()), fetch(`${base}data/price_history.json`).then(r=>r.json()).catch(() => ({})), fetch(`${base}origin-guides.json`).then(r=>r.json())]).then(([products, meta, priceHistory, guides]) => {
  // Veri üretimindeki kaynak filtresine ek savunma: eski/önbelleklenmiş bir
  // veri dosyası gelse bile bağlantısız satırı kullanıcıya gösterme.
  all = products.filter((row) => row.url); filtered = all; history = priceHistory; historyThrough = meta.checkedAt; originGuides = guides;
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
  els['advisor-launch'].hidden = false;
  render();
}).catch(() => { els['product-rows'].innerHTML = '<tr><td colspan="7" class="loading">Veri yüklenemedi.</td></tr>'; });

['search','origin','business','price-change','weight-range','sort'].forEach(id => els[id].addEventListener(id === 'search' ? 'input' : 'change', applyFilters));
els.prev.addEventListener('click', () => { page--; render(); }); els.next.addEventListener('click', () => { page++; render(); });
els.clear.addEventListener('click', () => { ['search','origin','business','price-change','weight-range'].forEach(id => els[id].value=''); els.sort.value='business'; applyFilters(); });
els['product-rows'].addEventListener('click', (e) => {
  const btn = e.target.closest('.history-btn');
  if (!btn) return;
  const row = filtered.find((r) => String(r.variantId) === btn.dataset.variant);
  if (row) openHistoryModal(row, btn);
});
els['advisor-launch'].addEventListener('click', openAdvisor);
els['advisor-close'].addEventListener('click', closeAdvisor);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !els['advisor-panel'].hidden) closeAdvisor(); });
