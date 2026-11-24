# Sunucu kurulumu (nabiz.ysfdurak.com)

Ortak altyapı (VPS, Docker, Caddy, `web` ağı): [ysfdurak.com → sunucu/README.md](https://github.com/ysfdurak/ysfdurak.com/blob/main/sunucu/README.md). Önce Arıza Defteri kurulu olmalı (`kurulum-ariza.sh`).

## 1. Pusula'da hizmet hesabı (kırmızı etiket → iş)

Nabız, Pusula'nın MCP kapısını bir hizmet hesabıyla çağırır.

1. Pusula'da çalışma alanına `nabiz@ysfdurak.com` adresini **düzenleyici** olarak üye ekle. İstersen "Bakım" adında bir ekip aç.
2. Sunucuda `~/pusula-is-takip/.env` dosyasına şu satırı ekle (anahtar: `openssl rand -hex 32`):
   ```
   MCP_TOKENS=nabiz@ysfdurak.com:<anahtar>
   ```
3. Pusula'yı yeniden başlat: `bash ~/ysfdurak.com/sunucu/kurulum-pusula.sh`

> Not: Pusula'nın belgesi `MCP_TOKENS`'ı "yalnızca deneme" diye anlatır, çünkü kişi hesaplarında OAuth kullanılır. Sunucudan sunucuya bu tek hizmet hesabı için uygundur: anahtar internete çıkmaz (iç ağ), hesap yalnız düzenleyicidir. İleride Pusula'ya ayrı bir "hizmet hesabı" türü eklenebilir.

## 2. Nabız

1. Cloudflare DNS'te `nabiz` için A kaydı aç (proxy açık).
2. Sunucuda:
   ```bash
   bash ~/ysfdurak.com/sunucu/kurulum-nabiz.sh
   ```
   Betik iki şey sorar: Pusula hizmet anahtarı (boş bırakılırsa Pusula bağlantısı kapalı kalır) ve Pusula'daki ekip adı. Ardından `.env`'i üretir. Arıza Defteri'nin yazma anahtarını oradaki `.env`'den, site şifresini ve MCP anahtarını rastgele üretir. Son olarak konteyneri kurar ve Caddy'yi yeniden başlatır.
3. Kontrol: `https://nabiz.ysfdurak.com` açılmalı. Alt bilgideki "Kurum girişi" ile site şifresini (`grep SITE_SIFRESI ~/nabiz/.env`) girip kırmızı etiket aç. 30 saniye içinde Pusula'da iş görünmeli.

## 3. Nabız Analiz (V2, Python)

`bash ~/ysfdurak.com/sunucu/kurulum-nabiz-analiz.sh`: dışarı açılmaz, Nabız'ın `.env`'ine `ANALIZ_URL=http://nabiz-analiz:8000` yazar ve Nabız'ı yeniden başlatır. Arıza Defteri `GECMIS_GUN=360` olmalı (varsayılan). Kontrol: `#/analiz`.

## Çalışma biçimleri

| | Demo (`MOD=demo`) | Kurum (`MOD=kurum`) |
| --- | --- | --- |
| Ziyaretçi | Kendi deneme alanı, 72 saat, örnek geçmişle | Giriş zorunlu |
| Gönderimler | Benzetim | Gerçek |
| Kurum alanı ("ana") | Site şifresiyle; her gece örnek geçmişle **tazelenir** (vitrin) | Kalıcı |
| MCP | Kurum alanını okur | Kurum alanını okur |

Demo kurulumunda kurum alanına girip yaptığın gerçek denemeler ertesi gün vitrin verisiyle silinir. Pusula'daki işler ve Arıza Defteri kayıtları kalır.

## Sık kullanılanlar

| İş | Komut |
| --- | --- |
| Kayıtlar | `sudo docker logs --tail 50 nabiz` |
| Gönderilemeyenler | Kayıtlarda "başarısız" satırı; etiket sayfasında kırmızı rozet |
| Güncelleme | `bash ~/ysfdurak.com/sunucu/kurulum-nabiz.sh` (`.env`'e ve veriye dokunmaz) |

## Yedek

Demo kurulumunda yedek yok: ziyaretçi alanları geçicidir, vitrin her gün yeniden üretilir. Kurum modunda `nabiz-data` birimindeki `/data/nabiz.db` gece yedeğine eklenmelidir.

## Yerelde üçü birlikte

```bash
# 1) Arıza Defteri (8091)
cd ariza-defteri && PORT=8091 YAZMA_ANAHTARLARI=$(printf 'a%.0s' {1..40}) npm run start:dev
# 2) Pusula (8092): MCP_TOKENS içindeki anahtar package.json'daki start:mcp-dev'de
cd pusula-is-takip && PORT=8092 APP_URL=http://localhost:8092/ npm run start:mcp-dev
# 3) Nabız (8081)
cd nabiz && ARIZA_DEFTERI_URL=http://localhost:8091 ARIZA_YAZMA_ANAHTARI=$(printf 'a%.0s' {1..40}) \
  PUSULA_MCP_URL=http://localhost:8092/mcp PUSULA_ANAHTARI=gelistirme-anahtari-yalnizca-yerel-deneme \
  SITE_SIFRESI=cok-gizli-deneme-sifresi npm run start:dev
```
