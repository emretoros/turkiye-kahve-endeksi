(function (root) {
  const normalize = (value) => String(value || '').toLocaleLowerCase('tr-TR');

  function brewScore(row, brew) {
    if (!brew || brew === 'any') return 0;
    const text = normalize(`${row.product} ${row.productType}`);
    if (brew === 'turkish') return /türk kahvesi|turk kahvesi|dibek/.test(text) ? 10 : -10;
    if (brew === 'espresso') return /espresso/.test(text) ? 5 : /harman|blend/.test(text) ? 2 : 0;
    if (brew === 'moka') return /espresso|harman|blend|moka/.test(text) ? 4 : 0;
    if (brew === 'v60') return /tek köken|filtre|single origin|v60/.test(text) ? 4 : 1;
    if (brew === 'aeropress') return /tek köken|filtre|single origin|aeropress/.test(text) ? 3 : 1;
    if (brew === 'french') return /harman|blend|filtre|tek köken|french/.test(text) ? 3 : 1;
    return 0;
  }

  function matchingProducts(rows, prefs) {
    let matches = rows.filter((row) => row.url && Number.isFinite(row.price) && row.price > 0)
      .filter((row) => !/kapsül kahve/i.test(row.productType || ''))
      .filter((row) => !prefs.origin || prefs.origin === 'any' || row.origin === prefs.origin)
      .filter((row) => !prefs.grams || prefs.grams === 'any' || row.grams === Number(prefs.grams))
      .filter((row) => !prefs.budget || prefs.budget === 'any' || row.price <= Number(prefs.budget));

    if (prefs.brew === 'turkish') {
      matches = matches.filter((row) => brewScore(row, prefs.brew) > 0);
    } else if (prefs.brew && prefs.brew !== 'any') {
      const scored = matches.filter((row) => brewScore(row, prefs.brew) > 1);
      if (scored.length >= 5) matches = scored;
    }

    const byUrl = new Map();
    for (const row of matches) {
      const current = byUrl.get(row.url);
      if (!current || brewScore(row, prefs.brew) > brewScore(current, prefs.brew)
        || (brewScore(row, prefs.brew) === brewScore(current, prefs.brew) && row.price < current.price)) {
        byUrl.set(row.url, row);
      }
    }
    return [...byUrl.values()].sort((a, b) => a.price - b.price || a.business.localeCompare(b.business, 'tr'));
  }

  function chooseFive(sorted) {
    if (sorted.length <= 5) return sorted.slice();
    const picked = [sorted[0], sorted[sorted.length - 1]];
    const usedUrls = new Set(picked.map((row) => row.url));
    const usedBusinesses = new Set(picked.map((row) => row.business));

    for (const ratio of [0.25, 0.5, 0.75]) {
      const target = Math.round((sorted.length - 1) * ratio);
      const candidates = sorted
        .map((row, index) => ({ row, distance: Math.abs(index - target) }))
        .filter(({ row }) => !usedUrls.has(row.url))
        .sort((a, b) => {
          const aNew = usedBusinesses.has(a.row.business) ? 1 : 0;
          const bNew = usedBusinesses.has(b.row.business) ? 1 : 0;
          return aNew - bNew || a.distance - b.distance || a.row.price - b.row.price;
        });
      const selected = candidates[0]?.row;
      if (selected) {
        picked.push(selected);
        usedUrls.add(selected.url);
        usedBusinesses.add(selected.business);
      }
    }

    for (const row of sorted) {
      if (picked.length >= 5) break;
      if (!usedUrls.has(row.url)) {
        picked.push(row);
        usedUrls.add(row.url);
      }
    }
    return picked.sort((a, b) => a.price - b.price);
  }

  function recommend(rows, prefs) {
    const matches = matchingProducts(rows, prefs);
    return { matches, recommendations: chooseFive(matches) };
  }

  root.CoffeeRecommender = { brewScore, matchingProducts, chooseFive, recommend };
})(globalThis);
