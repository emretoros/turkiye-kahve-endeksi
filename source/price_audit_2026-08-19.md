# Fiyat denetim raporu — 2026-08-19

Kaynak: `source/broad_products.json` (3.256 satır)

## Özet

| | Satır | Oran |
|---|---:|---:|
| Fiyatı olan | 2.460 | %75.6 |
| **Karantina** (yayınlanmaz) | **355** | %14.4 |
| İnceleme kuyruğu | 147 | %6.0 |
| Temiz | 1.958 | %79.6 |

## Kural bazında

| Kural | Tetiklenme |
|---|---:|
| `REPEATED_PRICE` | 254 |
| `UNSTRUCTURED_NO_GRAMS` | 221 |
| `SUSPECT_GRAMS` | 140 |
| `KG_PRICE_RANGE` | 50 |
| `NON_COFFEE_LEAK` | 47 |
| `ABSOLUTE_MIN` | 25 |
| `SHIPPING_THRESHOLD` | 13 |
| `SUBSCRIPTION` | 7 |

## Karantinaya giren satırların işletme dağılımı

| İşletme | Satır |
|---|---:|
| Sanal Baharat | 53 |
| Kahve Dünyası | 41 |
| Parsa Coffee Roasters | 34 |
| Kahve.com / Moliendo | 31 |
| Paper Coffee & Chocolate | 26 |
| Fuga Coffee | 20 |
| Shazel | 19 |
| Spada Coffee | 18 |
| Cho Coffee Roastery | 15 |
| 1978 Coffee Roastery | 9 |
| Bravo Coffee Roastery | 9 |
| Coffee Project | 8 |
| Kernel Coffee | 8 |
| Orkun Üstel | 7 |
| CoffeeNutz | 7 |
| Keobs Coffee Roastery | 6 |
| Gramaj Coffee Roastery | 5 |
| Sezy Coffee | 5 |
| Coffee Tropic | 4 |
| Four Letter Word Coffee | 4 |
| Story Coffee Roasters | 4 |
| Coffeemamma | 3 |
| Nok Coffee | 3 |
| Coach Coffee Company | 2 |
| Montag Coffee Roasters | 2 |
| Kronotrop | 2 |
| Homestead Coffee | 2 |
| Taft Coffee | 2 |
| Coffee Department | 1 |
| Coffee Friendzone | 1 |
| Coffee Lab | 1 |
| Noite Coffee | 1 |
| Old Java Coffee Roasters | 1 |
| Probador Colectiva | 1 |

## Örnek satırlar (ilk 25)

| İşletme | Ürün | Gramaj | Fiyat | Kural |
|---|---|---:|---:|---|
| 1978 Coffee Roastery | 78 Tanışma Paketi | — | 1000 | REPEATED_PRICE, UNSTRUCTURED_NO_GRAMS |
| 1978 Coffee Roastery | Brazil Mogiana ( 1 Kg ) | 1000 | 1000 | REPEATED_PRICE |
| 1978 Coffee Roastery | Brazil Mogiana ( 250 gr ) | 250 | 1000 | REPEATED_PRICE |
| 1978 Coffee Roastery | Colombia EL PARAISO | — | 1000 | REPEATED_PRICE, UNSTRUCTURED_NO_GRAMS |
| 1978 Coffee Roastery | Colombia LA ROCA | — | 1000 | REPEATED_PRICE, UNSTRUCTURED_NO_GRAMS |
| 1978 Coffee Roastery | Honduras Las Calaveras ( 1 Kg ) | 1000 | 1000 | REPEATED_PRICE |
| 1978 Coffee Roastery | Honduras Las Calaveras ( 250 gr ) | 250 | 1000 | REPEATED_PRICE |
| 1978 Coffee Roastery | TIMEMORE Coffee Server (360 ml) | — | 1000 | NON_COFFEE_LEAK, REPEATED_PRICE, UNSTRUCTURED_NO_GRAMS |
| 1978 Coffee Roastery | Türk Kahvesi | — | 1000 | REPEATED_PRICE, UNSTRUCTURED_NO_GRAMS |
| Bravo Coffee Roastery | Bravo Espresso Blend 250 Gr | 250 | 1 | ABSOLUTE_MIN, KG_PRICE_RANGE |
| Bravo Coffee Roastery | Colombia Medellin 250 Gr | 250 | 3 | ABSOLUTE_MIN, KG_PRICE_RANGE |
| Bravo Coffee Roastery | Ethiopia Kochere 250 Gr | 250 | 4 | ABSOLUTE_MIN, KG_PRICE_RANGE |
| Bravo Coffee Roastery | HESAP OLUŞTUR | — | 2 | ABSOLUTE_MIN, UNSTRUCTURED_NO_GRAMS |
| Bravo Coffee Roastery | OTURUM AÇ | — | 8 | ABSOLUTE_MIN, UNSTRUCTURED_NO_GRAMS |
| Bravo Coffee Roastery | SİPARİŞ TAKİP | — | 1 | ABSOLUTE_MIN, UNSTRUCTURED_NO_GRAMS |
| Bravo Coffee Roastery | ŞİFRENİZİ SIFIRLAYIN | — | 7 | ABSOLUTE_MIN, UNSTRUCTURED_NO_GRAMS |
| Bravo Coffee Roastery | Türk Kahvesi 125 Gr | 125 | 7 | ABSOLUTE_MIN, KG_PRICE_RANGE |
| Bravo Coffee Roastery | Türk Kahvesi 200 Gr | 200 | 7 | ABSOLUTE_MIN, KG_PRICE_RANGE |
| Cho Coffee Roastery | BREZILYA SANTUARIO SUL GEISHA LUIZ PAULO | — | 450 | SHIPPING_THRESHOLD, UNSTRUCTURED_NO_GRAMS |
| Cho Coffee Roastery | BREZILYA SANTUARIO SUL STARMAYA | — | 300 | SHIPPING_THRESHOLD, UNSTRUCTURED_NO_GRAMS |
| Cho Coffee Roastery | Cho Coffee Roastery. FELLOW | — | null | NON_COFFEE_LEAK |
| Cho Coffee Roastery | Cho Coffee Roastery. HARIO | — | null | NON_COFFEE_LEAK |
| Cho Coffee Roastery | Cho Coffee Roastery. TIMEMORE | — | null | NON_COFFEE_LEAK |
| Cho Coffee Roastery | CHO NOCTURNE ESPRESSO | — | 450 | SHIPPING_THRESHOLD, UNSTRUCTURED_NO_GRAMS |
| Cho Coffee Roastery | CHO SINGNATURE GELENEKSEL T&#xDC;RK KAHVES&#x1 | — | 300 | SHIPPING_THRESHOLD, UNSTRUCTURED_NO_GRAMS |

---
Karantina = veri silinmez, `is_quarantined=1` ile saklanır; sitede ve endekste kullanılmaz.
