// Planlı bakım tablosu (V3): Arıza Defteri'nin bakım takvimi + Nabız Analiz'in aralık önerisi → ekipman başına durum.
//
// Üç ayrı soru, üç ayrı durum:
//   gecikti         : takvimdeki planlı bakım günü geçti, bakım yapılmadı (şirketin kendi kuralına göre geç)
//   oneriye_gore    : takvim henüz gelmedi ama bakımdan beri geçen gün, analizin önerdiği aralığı aştı
//                     (veri "daha sık bakım" diyor; şirket kuralı değişmediyse bu bir uyarı, gecikme değil)
//   yaklasiyor      : takvimdeki bakıma 3 gün ya da daha az kaldı
// Sayaç: bakımdan beri çalışılan saat ve bir takvim periyodunun ortalama çalışma saati (Arıza Defteri, surum 4).
// Saf fonksiyon: test edilir, sunucu da MCP de aynı tabloyu kullanır.
import { gunFarki } from './zaman.js';

export const YAKLASIYOR_GUN = 3;
const SIRA = { gecikti: 0, oneriye_gore: 1, yaklasiyor: 2, normal: 3 };

/**
 * @param {object[]} ekipmanlar  Arıza Defteri /v1/ozet → ekipmanlar (kod, ad, tip, tipAd, bakim)
 * @param {object[]|null} oneriler Nabız Analiz → tipler (tip, onerilen_gun, sinirda, sayac?) ; yoksa null
 * @param {string} bugun YYYY-AA-GG
 */
export function bakimTablosu(ekipmanlar, oneriler, bugun) {
  const oneri = new Map((oneriler || []).map((t) => [t.tip, t]));
  const satirlar = ekipmanlar.filter((e) => e.bakim).map((e) => {
    const b = e.bakim;
    const o = oneri.get(e.tip);
    const bakimdanBeriGun = b.sonBakim ? gunFarki(b.sonBakim, bugun) : null;
    // Öneri yalnız "kısalt" diyorsa ve sınıra dayanmıyorsa uyarı üretir; "uzatılabilir" bir gecikme değildir
    const onerilenGun = o && !o.sinirda && o.onerilen_gun < o.mevcut_gun * 0.9 ? Math.round(o.onerilen_gun) : null;
    const kalanGun = gunFarki(bugun, b.sonrakiPlan);
    const durum = b.gecikmede ? 'gecikti'
      : onerilenGun != null && bakimdanBeriGun != null && bakimdanBeriGun > onerilenGun ? 'oneriye_gore'
        : kalanGun <= YAKLASIYOR_GUN ? 'yaklasiyor' : 'normal';
    return {
      kod: e.kod, ad: e.ad, tip: e.tip, tipAd: e.tipAd,
      sonBakim: b.sonBakim, sonrakiPlan: b.sonrakiPlan, kalanGun, gecikmeGun: b.gecikmeGun || 0,
      bakimdanBeriGun, bakimdanBeriSaat: b.bakimdanBeriSaat ?? null, periyotSaat: b.periyotSaat ?? null,
      onerilenGun, onerilenSaat: o?.sayac?.onerilen_saat != null && onerilenGun != null ? Math.round(o.sayac.onerilen_saat) : null,
      durum,
    };
  }).sort((x, y) => SIRA[x.durum] - SIRA[y.durum] || (y.gecikmeGun - x.gecikmeGun) || (x.kalanGun - y.kalanGun) || x.kod.localeCompare(y.kod));
  const say = (d) => satirlar.filter((s) => s.durum === d).length;
  return { satirlar, sayilar: { gecikti: say('gecikti'), oneriyeGore: say('oneriye_gore'), yaklasiyor: say('yaklasiyor') } };
}
