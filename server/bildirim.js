// Şefin sabah özeti: her gün SABAH_OZETI_SAATI'nden (Türkiye saati) sonraki ilk kontrolde bir kez gönderilir.
// BILDIRIM_URL'ye düz metin POST eder (ntfy.sh uyumlu: telefona anlık bildirim; Diyalog Atölyesi'yle aynı kalıp).
// Geciken ve sorumlusuz kırmızı yoksa gönderilmez (her sabah "sorun yok" bildirimi gürültü olur), yalnız kayda yazılır.
// Gönderim uygulamayı asla bekletmez; hata fırlatmaz. Aynı gün ikinci kez gönderilmez (meta: sabah_ozeti_gun),
// sunucu yeniden başlasa da.
import { anMs, istanbulGunu } from '../src/cekirdek/zaman.js';

/**
 * @param {object} o
 * @param {{ sabahOzeti: (kum: string) => object }} o.servis
 * @param {{ metaOku: Function, metaYaz: Function }} o.store
 * @param {string|null} o.url    BILDIRIM_URL
 * @param {string} o.saat        "07:30"
 */
export function sabahZamanlayici({ servis, store, url, saat, log = () => {}, fetch: f = fetch }) {
  const [ss, dd] = saat.split(':').map(Number);
  return {
    /** Zamanı geldiyse ve bugün gönderilmediyse özeti çıkarır. Döner: gönderilen özet ya da null. */
    async kontrol(simdi = Date.now()) {
      const gun = istanbulGunu(simdi);
      if (simdi < anMs(gun, ss, dd) || store.metaOku('sabah_ozeti_gun') === gun) return null;
      store.metaYaz('sabah_ozeti_gun', gun); // önce işaretle: gönderim hata verse de gün içinde tekrar denenmez (gürültü olmasın)
      const o = await servis.sabahOzeti('ana');
      if (!o.gonderilecek) {
        log(`Sabah özeti: ${o.metin}`);
        return o;
      }
      log(`Sabah özeti: ${o.baslik}${url ? '' : ' (BILDIRIM_URL yok, gönderilmedi)'}`);
      if (url) {
        try {
          const y = await f(url, {
            method: 'POST',
            // HTTP başlıkları ASCII olmalı: Türkçe başlık gövdeye, başlığa yalnız ASCII
            headers: {
              'content-type': 'text/plain; charset=utf-8', Title: 'Nabiz: sabah ozeti', Priority: o.oncelik, Tags: o.oncelik === 'high' ? 'warning' : 'clipboard',
              ...(o.baglanti ? { Click: o.baglanti } : {}),
            },
            body: `${o.baslik}\n\n${o.metin}`,
            signal: AbortSignal.timeout(10_000),
          });
          if (!y.ok) log(`Sabah özeti gönderilemedi (HTTP ${y.status}).`);
        } catch (err) {
          log(`Sabah özeti gönderilemedi (${err.name}).`);
        }
      }
      return o;
    },
  };
}
