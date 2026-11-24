// OEE (Toplam Ekipman Etkinliği) = Kullanılabilirlik × Performans × Kalite. Saf fonksiyonlar.
//
//   Planlı süre (P)      : vardiya süresi − planlı bakım
//   Çalışma süresi       : P − duruş (6 büyük kaybın duruş olanları: arıza, ayar, küçük duruş, başlangıç)
//   Kullanılabilirlik (A): çalışma / P
//   Performans (Pf)      : (iş adedi × ideal çevrim süresi) / çalışma          ← hız kaybı ve kayıt dışı küçük duruşlar
//   Kalite (K)           : (iş adedi − hatalı) / iş adedi                       ← hata ve hasar
//   OEE                  : A × Pf × K = iyi iş adedi × ideal çevrim süresi / P
// Birden çok vardiya ya da ekipman toplanırken oranların ortalaması alınmaz: süreler ve adetler toplanır, oran sonra
// hesaplanır (uzun vardiya kısa vardiyadan ağır basar). Ekipman tipleri arası toplam ise planlı süreyle ağırlıklıdır.

const oran = (pay, payda) => (payda > 0 ? Math.round((pay / payda) * 1000) / 1000 : null);

/** Satırları toplayıp OEE bileşenlerini verir. satir: { planli_dk, durus_dk, uretilen, hatali, tip }, tipler[tip].idealHiz (adet/saat). */
export function oeeTopla(satirlar, tipler) {
  let P = 0, D = 0, idealDk = 0, iyiIdealDk = 0, uretilen = 0, hatali = 0;
  for (const s of satirlar) {
    const cevrimDk = 60 / tipler[s.tip].idealHiz;
    P += s.planli_dk;
    D += s.durus_dk;
    idealDk += s.uretilen * cevrimDk;
    iyiIdealDk += (s.uretilen - s.hatali) * cevrimDk;
    uretilen += s.uretilen;
    hatali += s.hatali;
  }
  const calisma = P - D;
  return {
    planliDk: P, durusDk: D, uretilen, hatali,
    kullanilabilirlik: oran(calisma, P),
    performans: oran(idealDk, calisma),
    kalite: oran(uretilen - hatali, uretilen),
    oee: oran(iyiIdealDk, P),
    // Kayıpların dakika karşılığı (şelale): planlı süre → duruş → hız → kalite → değerli süre
    kayipDk: { durus: D, hiz: Math.round(calisma - idealDk), kalite: Math.round(idealDk - iyiIdealDk), deger: Math.round(iyiIdealDk) },
  };
}

/** Ekipman başına, tip başına, gün başına ve depo toplamı. */
export function oeeRaporu(satirlar, tipler, ekipmanlar) {
  const grupla = (anahtar) => {
    const m = new Map();
    for (const s of satirlar) {
      const k = anahtar(s);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return m;
  };
  const ekipman = [...grupla((s) => s.ekipman)].map(([kod, l]) => {
    const e = ekipmanlar.find((x) => x.kod === kod);
    return { kod, ad: e?.ad ?? kod, tip: e?.tip, ...oeeTopla(l, tipler) };
  }).sort((a, b) => (a.oee ?? 1) - (b.oee ?? 1));
  const tip = [...grupla((s) => s.tip)].map(([t, l]) => ({ tip: t, ...oeeTopla(l, tipler) }));
  const gun = [...grupla((s) => s.gun)].sort(([a], [b]) => a.localeCompare(b)).map(([g, l]) => ({ gun: g, ...oeeTopla(l, tipler) }));
  return { depo: oeeTopla(satirlar, tipler), tip, ekipman, gun };
}

/** Dünya sınıfı OEE kıyası (Nakajima): %85 (A %90 × Pf %95 × K %99,9). Depo ekipmanı için yol gösterici, hedef değil. */
export const DUNYA_SINIFI = { oee: 0.85, kullanilabilirlik: 0.9, performans: 0.95, kalite: 0.999 };
