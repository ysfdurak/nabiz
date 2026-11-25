// İş kuralları: vardiya, yetki, kontrol uyumu. Saf fonksiyonlar; web, MCP ve testler aynı kodu kullanır.
import { anMs, gunEkle, istanbulGunu } from './zaman.js';

export const RENKLER = { kirmizi: 'Kırmızı etiket (bakım ekibi)', beyaz: 'Beyaz etiket (operatör)' };

/** Bir an hangi vardiyaya düşer? 3. vardiya (00-08) aynı takvim gününün sabahıdır. */
export function vardiyaBul(ms) {
  const gun = istanbulGunu(ms);
  const saat = Math.floor((ms - anMs(gun)) / 3600e3);
  return { gun, no: saat < 8 ? 3 : saat < 16 ? 1 : 2 };
}

/** Vardiyanın başlangıcı (ms). */
export const vardiyaBasi = (gun, no) => anMs(gun, no === 1 ? 8 : no === 2 ? 16 : 0);

/** Vardiyaların zaman sırası: önce 3 (00-08), sonra 1, sonra 2. */
const SIRA = { 3: 0, 1: 1, 2: 2 };

/**
 * Kim ne yapabilir? Rol, Arıza Defteri'nin kişi listesinden gelir.
 *   kontrol ve etiket açma: herkes
 *   beyaz etiket kapatma: herkes (operatör kendisi giderir; TPM'in amacı)
 *   kırmızı etiket kapatma: teknisyen ve şef
 *   sorumlu atama ve hedef tarih değiştirme: teknisyen ve şef
 */
export function yetkiliMi(kisi, eylem, etiket = null) {
  if (!kisi) return false;
  if (eylem === 'kontrol' || eylem === 'etiket_ac') return ['operator', 'teknisyen', 'sef'].includes(kisi.rol);
  if (eylem === 'etiket_kapat') return etiket?.renk === 'beyaz' ? ['operator', 'teknisyen', 'sef'].includes(kisi.rol) : ['teknisyen', 'sef'].includes(kisi.rol);
  if (eylem === 'etiket_ata') return ['teknisyen', 'sef'].includes(kisi.rol);
  return false;
}

/**
 * Etiketin sorumlusu olabilir mi? Kırmızı etiketi bakım ekibi (teknisyen) giderir; beyazı herkes (operatör kendisi giderir).
 * Şef sorumlu yapılmaz: şef işi dağıtır, kendisi gidermez.
 */
export const sorumluOlabilirMi = (kisi, renk) => !!kisi && (renk === 'kirmizi' ? kisi.rol === 'teknisyen' : ['operator', 'teknisyen'].includes(kisi.rol));

/** Hedef tarih verilmezse: ekipmanı durduran kırmızı ertesi gün, diğer kırmızı 3 gün, beyaz 7 gün içinde kapanmalı. */
export const HEDEF_GUN = { durus: 1, kirmizi: 3, beyaz: 7 };
export const varsayilanHedef = (renk, durus, acilisGunu) => gunEkle(acilisGunu, durus ? HEDEF_GUN.durus : HEDEF_GUN[renk]);

/** Açık etiketin hedef günü geçtiyse gecikmiştir (hedef günü içinde kapanan gecikmiş sayılmaz). */
export const geciktiMi = (etiket, bugun) => etiket.durum === 'acik' && !!etiket.hedef && etiket.hedef < bugun;

/**
 * Kontrol uyumu: beklenen (ekipman × vardiya) çiftlerinden kaçında kontrol yapıldı?
 * Beklenen: ekipmanın çalıştığı vardiyalar, verilen günlerde, şimdiye kadar başlamış olanlar.
 * @param {Array<{ekipman: string, gun: string, vardiya: number}>} kontroller
 * @param {Array<{kod: string, tip: string}>} ekipmanlar
 * @param {Record<string, {vardiyalar: number[]}>} tipler
 */
export function kontrolUyumu(kontroller, ekipmanlar, tipler, { bugun, simdi, gunSayisi = 1 }) {
  const yapilan = new Set(kontroller.map((k) => `${k.ekipman}|${k.gun}|${k.vardiya}`));
  const satirlar = ekipmanlar.map((e) => ({ kod: e.kod, beklenen: 0, yapilan: 0, eksik: [] }));
  for (let i = 0; i < gunSayisi; i++) {
    const gun = gunEkle(bugun, -i);
    for (const s of satirlar) {
      const e = ekipmanlar.find((x) => x.kod === s.kod);
      for (const v of tipler[e.tip]?.vardiyalar || []) {
        if (vardiyaBasi(gun, v) > simdi) continue; // henüz başlamadı
        s.beklenen++;
        if (yapilan.has(`${e.kod}|${gun}|${v}`)) s.yapilan++;
        else if (i === 0) s.eksik.push(v);
      }
    }
  }
  const beklenen = satirlar.reduce((t, s) => t + s.beklenen, 0);
  const yapilanToplam = satirlar.reduce((t, s) => t + s.yapilan, 0);
  return { oran: beklenen ? Math.round((yapilanToplam / beklenen) * 1000) / 1000 : null, beklenen, yapilan: yapilanToplam, ekipmanlar: satirlar };
}

/** Bu vardiyada bu ekipmanın kontrolü yapıldı mı? */
export const buVardiyaKontrolu = (kontroller, ekipman, simdi) => {
  const v = vardiyaBul(simdi);
  return kontroller.find((k) => k.ekipman === ekipman && k.gun === v.gun && k.vardiya === v.no) || null;
};

export const vardiyaSirasi = (a, b) => SIRA[a] - SIRA[b];
