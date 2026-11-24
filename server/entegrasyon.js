// Dış servisler: Arıza Defteri (/v1 API) ve Pusula (MCP kapısı). Hepsi sunucudan sunucuya, zaman aşımıyla.
//
// Giden kutusu: Etiket açılınca/kapanınca yapılacak gönderimler önce "giden" tablosuna yazılır, sonra işlenir.
// Pusula ya da Arıza Defteri o an cevap vermezse kayıt kaybolmaz; 1, 5, 15, 60 dakika arayla yeniden denenir,
// 6 denemeden sonra "hata" olarak kalır ve etiketin sayfasında görünür. Ziyaretçi alanlarında gönderim yapılmaz,
// "benzetim" olarak "şu gidecekti" bilgisiyle saklanır.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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

/** Pusula istemcisi: MCP kapısındaki araçları sunucu hesabının anahtarıyla çağırır. */
export function pusulaIstemcisi({ url, anahtar, calismaAlani, ekip }) {
  const acik = !!(url && anahtar);
  async function arac(ad, args) {
    if (!acik) throw new DisServisHatasi('Pusula bağlantısı tanımlı değil.', { kalici: true });
    const client = new Client({ name: 'nabiz', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${anahtar}` } } });
    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, red) => setTimeout(() => red(new Error('zaman aşımı')), ZAMAN_ASIMI)),
      ]);
      const sonuc = await client.callTool({ name: ad, arguments: { ...(calismaAlani ? { calismaAlani } : {}), ...args } }, undefined, { timeout: ZAMAN_ASIMI });
      const metin = sonuc.content?.find((c) => c.type === 'text')?.text ?? '';
      if (sonuc.isError) throw new DisServisHatasi(`Pusula: ${metin.slice(0, 300)}`, { kalici: true });
      try { return JSON.parse(metin); } catch { return { metin }; }
    } catch (err) {
      if (err instanceof DisServisHatasi) throw err;
      const yetki = /401|403|unauthori/i.test(String(err?.message));
      throw new DisServisHatasi(yetki ? 'Pusula anahtarı reddedildi.' : `Pusula'ya ulaşılamadı (${String(err?.message || err).slice(0, 120)}).`, { kalici: false });
    } finally {
      await client.close().catch(() => {});
    }
  }
  return {
    acik,
    isAc: ({ baslik, aciklama, oncelik }) => arac('is_olustur', { baslik, aciklama, oncelik, ...(ekip ? { ekip } : {}) }),
    isKapat: async ({ isId, not }) => {
      await arac('yorum_ekle', { isId, metin: `Nabız: etiket kapatıldı. ${not}` });
      try {
        return await arac('durum_degistir', { isId, durum: 'done' });
      } catch (err) {
        // Tamamlama koşulları (kontrol listesi vb.) Pusula'da eksikse iş açık kalır; yorum zaten düştü.
        if (err.kalici) return { tamamlanamadi: err.message };
        throw err;
      }
    },
  };
}

/** Kırmızı etiket için Pusula iş metni (benzetimde de aynı metin gösterilir). */
export function pusulaIsi(etiket, ekipman, kisi, madde, uygulamaUrl) {
  return {
    baslik: `[Kırmızı etiket] ${ekipman?.kod ?? etiket.ekipman} ${ekipman?.ad ? `(${ekipman.ad})` : ''}: ${etiket.aciklama}`.replace(/\s+/g, ' ').slice(0, 200),
    aciklama: [
      `Ekipman: ${ekipman?.ad ?? etiket.ekipman} · ${ekipman?.bolge ?? ''}`,
      madde ? `Kontrol maddesi: ${madde.metin}` : null,
      `Bildiren: ${kisi?.ad ?? etiket.kisi}`,
      etiket.durus ? 'Ekipman ÇALIŞAMIYOR (Arıza Defteri\'ne arıza olarak da bildirildi).' : 'Ekipman çalışabiliyor.',
      `Etiket: ${uygulamaUrl}#/etiket/${etiket.id}`,
    ].filter(Boolean).join('\n'),
    oncelik: etiket.durus ? 'urgent' : 'high',
  };
}

/**
 * Giden kutusunu işler (yalnız 'ana' alanı). Sıra önemlidir: aynı etiketin "aç" kaydı "kapat"tan önce gider;
 * "kapat" giderken "aç"ın sonucu (iş/arıza kimliği) etiketten okunur.
 */
export function gidenIsleyici({ store, ariza, pusula, simdi = Date.now, log = () => {} }) {
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
    if (g.hedef === 'pusula_ac') {
      const is = await pusula.isAc(g.govde);
      store.etiketBaglanti('ana', g.etiket, { pusulaIs: is.id ?? null });
      return { id: is.id ?? null };
    }
    if (g.hedef === 'pusula_kapat') {
      if (!etiket?.pusulaIs) throw new DisServisHatasi('Pusula işi henüz açılmadı; sonra yeniden denenecek.');
      return await pusula.isKapat({ isId: etiket.pusulaIs, not: g.govde.not });
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
