// Otonom bakım olgunluğu: TPM'in 7 adımı, ekipman tipi (hat) başına (V3).
//
// Bir adım beyanla değil, Nabız'daki gerçek kayıtla "geçildi" sayılır; bir adım geçilmeden sonrakine bakılmaz.
// Ölçütler son 30 günün kontrol ve etiketlerinden. 5-7. adımlar bu uygulamanın kaydıyla ölçülemez: dürüstçe
// "ölçülmüyor" denir (denetimle değerlendirilir), uydurma bir yüzde gösterilmez.
//
//   1 Temel temizlik ve ilk kontrol    kontrol uyumu ≥ %85 (her vardiya başında kontrol yapılıyor)
//   (Asgari veri: 10 kontrol, 5 kapanmış beyaz, 5 kırmızı; azsa "veri az" denir, adım geçilmiş sayılmaz.)
//   2 Kirlilik kaynakları             beyaz etiketlerin ≥ %80'i hedef tarihinde kapanıyor, geciken beyaz yok
//                                     (operatör kendi giderebileceği sorunları gerçekten gideriyor)
//   3 Geçici standartlar              hızlı (bakılmadan işaretlenmiş olabilecek) kontrol ≤ %5 ve geciken emniyet etiketi yok
//                                     (standart var ve uyuluyor)
//   4 Genel muayene                   kırmızı etiketlerin ≥ %60'ı vardiya kontrolünde bulunmuş
//                                     (sorun, ekipman bozulmadan muayenede yakalanıyor)
//   5 Otonom muayene · 6 Standardizasyon · 7 Otonom yönetim: ölçülmüyor
import { geciktiMi, hizliKontrolMu, kontrolUyumu } from './kurallar.js';
import { listeBul } from './kontrol-listeleri.js';
import { istanbulGunu } from './zaman.js';

export const ADIMLAR = [
  { no: 1, ad: 'Temel temizlik ve ilk kontrol', esik: 0.85 },
  { no: 2, ad: 'Kirlilik kaynakları ve zor erişilen yerler', esik: 0.8 },
  { no: 3, ad: 'Geçici temizlik ve kontrol standartları', esik: 0.05 },
  { no: 4, ad: 'Genel muayene', esik: 0.6 },
  { no: 5, ad: 'Otonom muayene' },
  { no: 6, ad: 'Standardizasyon' },
  { no: 7, ad: 'Otonom yönetim' },
];
const EN_AZ = { kontrol: 10, beyaz: 5, kirmizi: 5 };
const yuzde = (x) => `%${Math.round(x * 100)}`;

/**
 * @param {object} v
 * @param {object[]} v.kontroller  son 30 gün
 * @param {object[]} v.etiketler   son 30 günde açılanlar
 * @param {object[]} v.ekipmanlar  ana veriler
 * @param {object} v.tipler        ana veriler (vardiyalar)
 * @param {string} v.bugun
 * @param {number} v.simdi
 */
export function olgunluk({ kontroller, etiketler, ekipmanlar, tipler, bugun, simdi, gunSayisi = 30 }) {
  return Object.entries(tipler).map(([tip, t]) => {
    const ek = ekipmanlar.filter((e) => e.tip === tip);
    const kodlar = new Set(ek.map((e) => e.kod));
    const k = kontroller.filter((x) => kodlar.has(x.ekipman));
    const et = etiketler.filter((x) => kodlar.has(x.ekipman));
    const maddeSayisi = listeBul(tip).length || 5;

    const uyum = kontrolUyumu(k, ek, tipler, { bugun, simdi, gunSayisi });
    const beyaz = et.filter((x) => x.renk === 'beyaz');
    const beyazKapanan = beyaz.filter((x) => x.durum === 'kapali');
    const zamaninda = beyazKapanan.filter((x) => !x.hedef || istanbulGunu(new Date(x.kapanis).getTime()) <= x.hedef).length;
    const gecikenBeyaz = beyaz.filter((x) => geciktiMi(x, bugun)).length;
    const hizli = k.filter((x) => hizliKontrolMu(x, maddeSayisi)).length;
    const emniyetGeciken = et.filter((x) => x.emniyet && geciktiMi(x, bugun)).length;
    const kirmizi = et.filter((x) => x.renk === 'kirmizi');
    const kontroldenBulunan = kirmizi.filter((x) => x.kontrol).length;

    const olcum = [
      k.length < EN_AZ.kontrol ? { durum: 'veri_az', kanit: `${k.length} kontrol: en az ${EN_AZ.kontrol} gerekir.` }
        : { gecti: uyum.oran >= ADIMLAR[0].esik, kanit: `Kontrol uyumu: ${yuzde(uyum.oran)} (${uyum.yapilan}/${uyum.beklenen} vardiya; hedef en az ${yuzde(ADIMLAR[0].esik)}).` },
      beyazKapanan.length < EN_AZ.beyaz ? { durum: 'veri_az', kanit: `${beyazKapanan.length} kapanmış beyaz etiket: en az ${EN_AZ.beyaz} gerekir.` }
        : { gecti: zamaninda / beyazKapanan.length >= ADIMLAR[1].esik && !gecikenBeyaz,
          kanit: `Hedefinde kapanan beyaz etiket: ${yuzde(zamaninda / beyazKapanan.length)} (hedef en az ${yuzde(ADIMLAR[1].esik)}); geciken açık beyaz: ${gecikenBeyaz}.` },
      k.length < EN_AZ.kontrol ? { durum: 'veri_az', kanit: `${k.length} kontrol: en az ${EN_AZ.kontrol} gerekir.` }
        : { gecti: hizli / k.length <= ADIMLAR[2].esik && !emniyetGeciken,
          kanit: `Hızlı kontrol: ${yuzde(hizli / k.length)} (hedef en çok ${yuzde(ADIMLAR[2].esik)}); geciken emniyet etiketi: ${emniyetGeciken}.` },
      kirmizi.length < EN_AZ.kirmizi ? { durum: 'veri_az', kanit: `${kirmizi.length} kırmızı etiket: en az ${EN_AZ.kirmizi} gerekir.` }
        : { gecti: kontroldenBulunan / kirmizi.length >= ADIMLAR[3].esik,
          kanit: `Vardiya kontrolünde bulunan kırmızı etiket: ${yuzde(kontroldenBulunan / kirmizi.length)} (hedef en az ${yuzde(ADIMLAR[3].esik)}).` },
    ];
    // Sıralı: bir adım geçilmeden sonrakiler "bekliyor"
    let engel = false;
    let mevcut = 1;
    const adimlar = ADIMLAR.map((a, i) => {
      if (i >= 4) return { ...a, durum: 'olculmuyor', kanit: 'Bu uygulamanın kaydıyla ölçülmüyor; denetimle değerlendirilir.' };
      const m = olcum[i];
      let durum;
      if (engel) durum = 'bekliyor';
      else if (m.durum === 'veri_az') { durum = 'veri_az'; engel = true; } else if (m.gecti) { durum = 'gecti'; mevcut = a.no + 1; } else { durum = 'devam'; engel = true; }
      return { no: a.no, ad: a.ad, durum, kanit: m.kanit };
    });
    return { tip, ad: t.ad, ekipmanSayisi: ek.length, mevcutAdim: Math.min(mevcut, 5), adimlar };
  });
}
