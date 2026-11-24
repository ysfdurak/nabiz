// Tohumlu rastgele sayı üreteci: aynı tohum her zaman aynı diziyi verir.
// Üretici her gün için tohumu "senaryo tohumu + tarih" metninden türetir; böylece bir gün kaç kez üretilirse
// üretilsin aynı kayıtlar çıkar (demo bozulmaz, testler tekrarlanabilir).

/** Metni 32 bitlik sayıya çevirir (FNV-1a). */
export function ozet32(metin) {
  let h = 0x811c9dc5;
  for (let i = 0; i < metin.length; i++) {
    h ^= metin.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: küçük, hızlı, istatistiği yeterince iyi bir üreteç. Kriptografik değildir; güvenlik için kullanılmaz. */
export function uretec(tohumMetni) {
  let a = ozet32(String(tohumMetni));
  const sayi = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** [0, 1) */
    sayi,
    /** [alt, ust] tam sayı */
    tam: (alt, ust) => alt + Math.floor(sayi() * (ust - alt + 1)),
    /** listeden bir eleman */
    sec: (liste) => liste[Math.floor(sayi() * liste.length)],
    /** ağırlıklı seçim: [[deger, agirlik], ...] */
    agirlikli(liste) {
      const toplam = liste.reduce((t, [, a]) => t + a, 0);
      let r = sayi() * toplam;
      for (const [d, a] of liste) if ((r -= a) < 0) return d;
      return liste.at(-1)[0];
    },
    /** Standart normal (Box-Muller) */
    normal() {
      const u = 1 - sayi(), v = sayi();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** Poisson (küçük ortalamalar için Knuth yöntemi) */
    poisson(ortalama) {
      const L = Math.exp(-ortalama);
      let k = 0, p = 1;
      do { k++; p *= sayi(); } while (p > L);
      return k - 1;
    },
  };
}
