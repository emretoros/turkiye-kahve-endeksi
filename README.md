# Türkiye Kahve Endeksi

Türkiye'de tüketiciye doğrudan kahve satan işletmelerin ürün, menşe, gramaj ve fiyat kayıtlarını keşfetmek için hazırlanmış statik web sitesi.

## Yerel kullanım

```sh
corepack enable
pnpm install
pnpm dev
```

Üretim derlemesi:

```sh
pnpm build
```

`source/` klasöründeki kaynaklar güncellendiğinde `pnpm build`, web verilerini, CSV dosyasını ve indirilebilir Excel dosyasını yeniden üretir.

## GitHub Pages

Depo GitHub'a gönderildikten sonra **Settings → Pages → Source** alanında **GitHub Actions** seçilir. `main` dalına yapılan gönderimler siteyi otomatik yayımlar.
