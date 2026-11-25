# Sunucu kurulumu (nabiz.ysfdurak.com)

Ortak altyapı (VPS, Docker, Caddy, `web` ağı): [ysfdurak.com → sunucu/README.md](https://github.com/ysfdurak/ysfdurak.com/blob/main/sunucu/README.md). Önce Arıza Defteri kurulu olmalı (`kurulum-ariza.sh`).

> Pusula bağlantısı 25.11.2026'da kaldırıldı (V2.1). Pusula'da hizmet hesabı ya da anahtar gerekmez. Neden: [PROJE.md → "Neden Pusula çıkarıldı"](PROJE.md#neden-pusula-çıkarıldı-v21-25112026).

## 1. Nabız

1. Cloudflare DNS'te `nabiz` için A kaydı aç (proxy açık).
2. Sunucuda:
   ```bash
   bash ~/ysfdurak.com/sunucu/kurulum-nabiz.sh
   ```
   Betik soru sormaz. `.env`'i üretir: Arıza Defteri'nin yazma anahtarını oradaki `.env`'den alır, site şifresini ve MCP anahtarını rastgele üretir. Son olarak konteyneri kurar ve Caddy'yi yeniden başlatır.
3. Kontrol: `https://nabiz.ysfdurak.com` açılmalı. Alt bilgideki "Kurum girişi" ile site şifresini (`grep SITE_SIFRESI ~/nabiz/.env`) girip "ekipman çalışamıyor" işaretli bir kırmızı etiket aç. 30 saniye içinde etiket sayfasındaki gönderim "Gönderildi" olmalı ve [ariza.ysfdurak.com](https://ariza.ysfdurak.com)'da kayıt görünmeli.

## 2. Nabız Analiz (V2, Python)

`bash ~/ysfdurak.com/sunucu/kurulum-nabiz-analiz.sh`: dışarı açılmaz, Nabız'ın `.env`'ine `ANALIZ_URL=http://nabiz-analiz:8000` yazar ve Nabız'ı yeniden başlatır. Arıza Defteri `GECMIS_GUN=360` olmalı (varsayılan). Kontrol: `#/analiz`.

## Çalışma biçimleri

| | Demo (`MOD=demo`) | Kurum (`MOD=kurum`) |
| --- | --- | --- |
| Ziyaretçi | Kendi deneme alanı, 72 saat, örnek geçmişle | Giriş zorunlu |
| Gönderimler | Benzetim | Gerçek |
| Kurum alanı ("ana") | Site şifresiyle; her gece örnek geçmişle **tazelenir** (vitrin) | Kalıcı |
| MCP | Kurum alanını okur | Kurum alanını okur |

Demo kurulumunda kurum alanına girip yaptığın gerçek denemeler ertesi gün vitrin verisiyle silinir. Arıza Defteri kayıtları kalır.

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
# 2) Nabız Analiz (8093, Python)
cd nabiz-analiz && ARIZA_DEFTERI_URL=http://localhost:8091 PORT=8093 .venv/bin/python -m analiz
# 3) Nabız (8081)
cd nabiz && ARIZA_DEFTERI_URL=http://localhost:8091 ARIZA_YAZMA_ANAHTARI=$(printf 'a%.0s' {1..40}) \
  ANALIZ_URL=http://localhost:8093 SITE_SIFRESI=cok-gizli-deneme-sifresi npm run start:dev
```
