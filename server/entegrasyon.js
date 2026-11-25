// Dış servisler: Arıza Defteri (/v1 API) ve Nabız Analiz (salt okuma). Hepsi sunucudan sunucuya, zaman aşımıyla.
// Pusula bağlantısı 25.11.2026'da kaldırıldı: arıza Arıza Defteri'nde, takip (sorumlu + hedef tarih) Nabız'ın kendisinde.
//
// Giden kutusu: Etiket açılınca/kapanınca yapılacak gönderimler önce "giden" tablosuna yazılır, sonra işlenir.
// Arıza Defteri o an cevap vermezse kayıt kaybolmaz; 1, 5, 15, 60 dakika arayla yeniden denenir,
// 6 denemeden sonra "hata" olarak kalır ve etiketin sayfasında görünür. Ziyaretçi alanlarında gönderim yapılmaz,
// "benzetim" olarak "şu gidecekti" bilgisiyle saklanır.

const ZAMAN_ASIMI = 8000;
const BEKLEME_DK = [1, 5, 15, 60, 60];

export class DisServisHatasi extends Error {
  constructor(mesaj, { kalici = false } = {}) {
    super(mesaj);
    this.kalici = kalici; // true: yeniden denemek işe yaramaz (ör. 400 doğrulama hatası)
  }
}

/** Arıza Defteri istemcisi. url yoksa kapalıdır (yalnız gömülü ana veri kullanılır). */
export function arizaDefteriIstemcisi({ url, anahtar, fetchImpl = fetch }) {
  const kok = url ? url.replace(/\/$/, '') : null;
  async function iste(yol, { method = 'GET', govde } = {}) {
    if (!kok) throw new DisServisHatasi('Arıza Defteri adresi tanımlı değil.', { kalici: true });
    let yanit;
    try {
      yanit = await fetchImpl(kok + yol, {
        method,
        headers: { accept: 'application/json', ...(govde ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' && anahtar ? { authorization: `Bearer ${anahtar}` } : {}) },
        body: govde ? JSON.stringify(govde) : undefined,
        signal: AbortSignal.timeout(ZAMAN_ASIMI),
      });
    } catch (err) {
      throw new DisServisHatasi(`Arıza Defteri'ne ulaşılamadı (${err.name === 'TimeoutError' ? 'zaman aşımı' : 'bağlantı'}).`);
    }
    const veri = await yanit.json().catch(() => ({}));
    if (!yanit.ok) throw new DisServisHatasi(`Arıza Defteri ${yanit.status}: ${veri.hata || 'hata'}`, { kalici: yanit.status >= 400 && yanit.status < 500 && yanit.status !== 429 });
    return veri;
  }
  return {
    acik: !!kok,
    yazabilir: !!(kok && anahtar),
    anaVeriler: () => iste('/v1/ana-veriler'),
    arizalar: (ekipman, gun = 30, limit = 5) => iste(`/v1/arizalar?gun=${gun}&limit=${limit}&ekipman=${encodeURIComponent(ekipman)}`),
    ozet: (gun = 30) => iste(`/v1/ozet?gun=${gun}`),
    uretim: (gun = 30) => iste(`/v1/uretim?gun=${gun}`),
    turKayitlari: (tur, gun = 90) => iste(`/v1/arizalar?gun=${gun}&limit=2000&tur=${encodeURIComponent(tur)}`),
    bulgular: (gun = 90) => iste(`/v1/bulgular?gun=${gun}`),
    bildir: (govde) => iste('/v1/arizalar', { method: 'POST', govde }),
    kapat: (id, govde) => iste(`/v1/arizalar/${encodeURIComponent(id)}/kapat`, { method: 'POST', govde }),
  };
}

/**
 * Giden kutusunu işler (yalnız 'ana' alanı). Sıra önemlidir: aynı etiketin "aç" kaydı "kapat"tan önce gider;
 * "kapat" giderken "aç"ın sonucu (arıza kimliği) etiketten ya da duruştan okunur.
 */
export function gidenIsleyici({ store, ariza, simdi = Date.now, log = () => {} }) {
  let calisiyor = false;
  async function gonder(g) {
    // Gönderim bir etikete ya da (V2) elle kaydedilmiş bir duruşa bağlıdır; arıza kimliği hangisindeyse oraya yazılır.
    const etiket = g.etiket ? store.etiketBul('ana', g.etiket) : null;
    const durus = g.durus ? store.durusBul('ana', g.durus) : null;
    const arizaId = etiket?.arizaId ?? durus?.ariza_id ?? null;
    if (g.hedef === 'ariza_bildir') {
      const k = await ariza.bildir(g.govde);
      if (g.durus) store.durusBaglanti('ana', g.durus, k.id);
      else store.etiketBaglanti('ana', g.etiket, { arizaId: k.id });
      return { id: k.id };
    }
    if (g.hedef === 'ariza_kapat') {
      if (!arizaId) throw new DisServisHatasi('Arıza kaydı henüz açılmadı; sonra yeniden denenecek.');
      const k = await ariza.kapat(arizaId, g.govde);
      return { id: k.id, sure_dk: k.sure_dk };
    }
    throw new DisServisHatasi(`Bilinmeyen hedef: ${g.hedef}`, { kalici: true });
  }

  async function isle() {
    if (calisiyor) return 0;
    calisiyor = true;
    let n = 0;
    try {
      for (const g of store.gidenBekleyen(simdi())) {
        try {
          const sonuc = await gonder(g);
          store.gidenSonuc(g.id, { durum: 'gonderildi', sonuc }, simdi());
        } catch (err) {
          const kalici = err instanceof DisServisHatasi && err.kalici;
          const son = kalici || g.deneme + 1 >= 6;
          store.gidenSonuc(g.id, { durum: son ? 'hata' : 'bekliyor', hata: String(err?.message || err).slice(0, 300), sonraki: simdi() + (BEKLEME_DK[g.deneme] ?? 60) * 60_000 }, simdi());
          log(`Gönderim ${g.id} (${g.hedef}) ${son ? 'başarısız' : 'yeniden denenecek'}: ${err?.message || err}`);
        }
        n++;
      }
    } finally {
      calisiyor = false;
    }
    return n;
  }
  return { isle };
}

/** Nabız Analiz (Python) istemcisi: güvenilirlik raporu. İç ağdan, salt okuma. */
export function analizIstemcisi({ url, fetchImpl = fetch }) {
  const kok = url ? url.replace(/\/$/, '') : null;
  async function iste(yol) {
    if (!kok) throw new DisServisHatasi('Nabız Analiz adresi tanımlı değil.', { kalici: true });
    let y;
    try {
      y = await fetchImpl(kok + yol, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(ZAMAN_ASIMI) });
    } catch (err) {
      throw new DisServisHatasi(`Nabız Analiz'e ulaşılamadı (${err.name === 'TimeoutError' ? 'zaman aşımı' : 'bağlantı'}).`);
    }
    const v = await y.json().catch(() => ({}));
    if (!y.ok) throw new DisServisHatasi(`Nabız Analiz ${y.status}: ${v.hata || 'hata'}`);
    return v;
  }
  return { acik: !!kok, guvenilirlik: () => iste('/v1/guvenilirlik') };
}
