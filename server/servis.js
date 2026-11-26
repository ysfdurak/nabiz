// Servis katmanı: web kapısı (/v1) ve MCP kapısı (/mcp) aynı fonksiyonları çağırır. Kurallar burada.
// Her işlem bir "kum" (alan) içinde çalışır: 'ana' ya da ziyaretçinin kendi alanı (store.js).
import { KONTROL_LISTELERI, listeBul } from '../src/cekirdek/kontrol-listeleri.js';
import { RENKLER, buVardiyaKontrolu, geciktiMi, hizliKontrolMu, kontrolUyumu, sorumluOlabilirMi, varsayilanHedef, vardiyaBul, yetkiliMi } from '../src/cekirdek/kurallar.js';
import { anMs, gecerliGun, gunEkle, gunFarki, isoTr, istanbulGunu } from '../src/cekirdek/zaman.js';
import { DUNYA_SINIFI, oeeRaporu } from '../src/cekirdek/oee.js';
import { a3Taslagi } from '../src/cekirdek/a3.js';
import { sabahOzeti } from '../src/cekirdek/sabah-ozeti.js';
import { bakimTablosu } from '../src/cekirdek/bakim.js';
import { olgunluk } from '../src/cekirdek/olgunluk.js';

export class KuralHatasi extends Error {
  constructor(mesaj, { durum = 400, kod = 'kural' } = {}) {
    super(mesaj);
    this.durum = durum;
    this.kod = kod;
  }
}

const METIN_SINIRI = 300;
export const FOTO_SINIRI = 1_500_000;

function metin(v, ad, { zorunlu = false, sinir = METIN_SINIRI } = {}) {
  if (v == null || v === '') {
    if (zorunlu) throw new KuralHatasi(`${ad} gerekli.`);
    return null;
  }
  if (typeof v !== 'string') throw new KuralHatasi(`${ad} metin olmalı.`);
  const t = v.trim();
  if (zorunlu && !t) throw new KuralHatasi(`${ad} gerekli.`);
  if (t.length > sinir) throw new KuralHatasi(`${ad} en fazla ${sinir} karakter olabilir.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) throw new KuralHatasi(`${ad} geçersiz karakter içeriyor.`);
  return t || null;
}

const kimlikBicimi = (v, onek) => typeof v === 'string' && new RegExp(`^${onek}-[0-9a-f]{12}$`).test(v);

/**
 * @param {object} o
 * @param {ReturnType<import('./store.js').openStore>} o.store
 * @param {() => object} o.ana        güncel ana veriler (Arıza Defteri'nden, önbellekli)
 * @param {ReturnType<import('./entegrasyon.js').arizaDefteriIstemcisi>} o.ariza
 */
export function servisOlustur({ store, ana, ariza, analiz = { acik: false }, appUrl = null, sinirlar = {}, simdi = Date.now }) {
  const S = { kontrol: 60, etiket: 30, foto: 10, demoFoto: 200, durus: 40, ...sinirlar };
  // Paylaşılan analiz verisi (her ziyaretçi için aynı): kısa süreli önbellek, dış servisleri yormamak için.
  const onbellek = new Map();
  async function onbellekli(anahtar, sureMs, fn) {
    const k = onbellek.get(anahtar);
    if (k && simdi() - k.zaman < sureMs) return k.veri;
    const veri = await fn();
    onbellek.set(anahtar, { zaman: simdi(), veri });
    return veri;
  }
  const disZorunlu = (istemci, ad) => {
    if (!istemci.acik) throw new KuralHatasi(`${ad} bağlantısı bu kurulumda tanımlı değil.`, { durum: 503, kod: 'baglanti' });
  };
  async function dis(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof KuralHatasi) throw err;
      throw new KuralHatasi(err.message || 'Dış servise ulaşılamadı.', { durum: 503, kod: 'baglanti' });
    }
  }
  const ekipmanBul = (kod) => ana().ekipmanlar.find((e) => e.kod === kod);
  const kisiBul = (kod) => ana().kisiler.find((k) => k.kod === kod);

  function ekipmanZorunlu(kod) {
    const e = typeof kod === 'string' ? ekipmanBul(kod) : null;
    if (!e) throw new KuralHatasi('Ekipman bulunamadı.', { durum: 404, kod: 'yok' });
    return e;
  }
  function kisiZorunlu(kod, eylem, etiket) {
    const k = typeof kod === 'string' ? kisiBul(kod) : null;
    if (!k) throw new KuralHatasi('Kişi seçilmeli (kişi kodu tanınmıyor).');
    if (!yetkiliMi(k, eylem, etiket)) {
      const mesaj = { etiket_kapat: 'Kırmızı etiketi yalnız teknisyen ya da şef kapatabilir.', etiket_ata: 'Sorumlu atamayı ve hedef tarihi yalnız teknisyen ya da şef değiştirebilir.' };
      throw new KuralHatasi(mesaj[eylem] ?? 'Bu işlem için yetkin yok.', { durum: 403, kod: 'yetki' });
    }
    return k;
  }
  function sorumluDogrula(kod, renk) {
    const k = typeof kod === 'string' ? kisiBul(kod) : null;
    if (!k) throw new KuralHatasi('Sorumlu kişi tanınmıyor.');
    if (!sorumluOlabilirMi(k, renk)) throw new KuralHatasi(renk === 'kirmizi' ? 'Kırmızı etiketin sorumlusu bir teknisyen olmalı.' : 'Beyaz etiketin sorumlusu bir operatör ya da teknisyen olmalı.');
    return k;
  }
  /** Hedef tarih: bugün ya da sonrası, en çok 90 gün ileri (yanlış yıl girişini yakalar). */
  function hedefDogrula(gun, bugun) {
    if (!gecerliGun(gun)) throw new KuralHatasi('Hedef tarih YYYY-AA-GG biçiminde olmalı.');
    if (gun < bugun) throw new KuralHatasi('Hedef tarih geçmişte olamaz.');
    if (gunFarki(bugun, gun) > 90) throw new KuralHatasi('Hedef tarih en çok 90 gün ileri olabilir.');
    return gun;
  }
  /** Ziyaretçi alanında günlük sınır; 'ana' alanında yok (kurum içi kullanım). */
  function hak(kum, tur) {
    if (kum === 'ana') return;
    const gun = istanbulGunu(simdi());
    if (!store.hakDus(gun, `${kum}:${tur}`, S[tur])) {
      throw new KuralHatasi(`Deneme alanında bugünkü ${tur} sınırı (${S[tur]}) doldu. Yarın yeniden deneyebilirsin.`, { durum: 429, kod: 'sinir' });
    }
    // Fotoğraflar disk kullanır: tüm deneme alanları için ayrıca günlük toplam sınır (en kötü durumda ~900 MB / 72 saat).
    if (tur === 'foto' && !store.hakDus(gun, 'demo:foto', S.demoFoto)) {
      throw new KuralHatasi('Bugün deneme alanlarına yüklenebilecek fotoğraf sayısı doldu. Etiketi fotoğrafsız açabilirsin.', { durum: 429, kod: 'sinir' });
    }
  }
  /** Gönderimi kuyruğa yazar. Ziyaretçi alanında ya da bağlantı tanımlı değilse gönderilmez, "benzetim" olarak saklanır. */
  function kuyruk(kum, etiket, hedef, govde, durus = null) {
    const gercek = kum === 'ana' && ariza.yazabilir;
    store.gidenEkle(kum, {
      etiket, durus, hedef, govde, durum: gercek ? 'bekliyor' : 'benzetim',
      sonuc: gercek ? null : { not: kum !== 'ana' ? 'Deneme alanı: gerçek sisteme gönderilmedi, gönderilecek içerik gösteriliyor.' : 'Arıza Defteri bağlantısı tanımlı değil.' },
    }, simdi());
  }

  const etiketGorunumu = (e) => e && ({
    ...e,
    olusturma: isoTr(e.olusturma),
    kapanis: isoTr(e.kapanis),
    renkAd: RENKLER[e.renk],
    ekipmanAd: ekipmanBul(e.ekipman)?.ad ?? e.ekipman,
    kisiAd: kisiBul(e.kisi)?.ad ?? e.kisi,
    kapatanAd: e.kapatan ? kisiBul(e.kapatan)?.ad ?? e.kapatan : null,
    sorumluAd: e.sorumlu ? kisiBul(e.sorumlu)?.ad ?? e.sorumlu : null,
    emniyet: !!e.madde && listeBul(ekipmanBul(e.ekipman)?.tip).find((m) => m.kod === e.madde)?.emniyet === true,
    gecikti: geciktiMi(e, istanbulGunu(simdi())),
    gecikmeGun: geciktiMi(e, istanbulGunu(simdi())) ? gunFarki(e.hedef, istanbulGunu(simdi())) : 0,
    maddeMetni: e.madde ? listeBul(ekipmanBul(e.ekipman)?.tip).find((m) => m.kod === e.madde)?.metin ?? null : null,
  });
  const durusGorunumu = (d) => d && ({
    id: d.id, ekipman: d.ekipman, tur: d.tur, turAd: ana().arizaTurleri.find((t) => t.kod === d.tur)?.ad ?? d.tur, kayip: d.kayip,
    kisi: d.kisi, kisiAd: kisiBul(d.kisi)?.ad ?? d.kisi, baslangic: isoTr(d.baslangic), bitis: isoTr(d.bitis),
    sureDk: d.bitis ? Math.round((d.bitis - d.baslangic) / 60_000) : null, aciklama: d.aciklama, arizaId: d.ariza_id,
  });
  const kontrolGorunumu = (k) => k && ({ ...k, baslangic: isoTr(k.baslangic), bitis: isoTr(k.bitis), sureSn: Math.round((k.bitis - k.baslangic) / 1000), kisiAd: kisiBul(k.kisi)?.ad ?? k.kisi });

  return {
    /** Arayüzün açılışta aldığı sabitler. */
    baslangic(kum) {
      const a = ana();
      return {
        demo: kum !== 'ana',
        simdi: isoTr(simdi()),
        vardiya: vardiyaBul(simdi()),
        ekipmanlar: a.ekipmanlar,
        kisiler: a.kisiler.map(({ kod, ad, rol, vardiya }) => ({ kod, ad, rol, vardiya })),
        tipler: a.tipler,
        arizaTurleri: a.arizaTurleri.map(({ kod, tip, ad, kayip }) => ({ kod, tip, ad, kayip })),
        kontrolListeleri: KONTROL_LISTELERI,
        renkler: RENKLER,
        baglantilar: { arizaDefteri: ariza.acik, arizaYazma: ariza.yazabilir, analiz: analiz.acik },
        sinirlar: kum === 'ana' ? null : S,
      };
    },

    /** Ekipman listesi: bu vardiyanın kontrolü yapıldı mı, açık etiketler. */
    ekipmanlar(kum) {
      const an = simdi();
      const v = vardiyaBul(an);
      const kontroller = store.kontroller(kum, { bas: anMs(v.gun) });
      const acik = store.etiketler(kum, { durum: 'acik' });
      return {
        vardiya: v,
        ekipmanlar: ana().ekipmanlar.map((e) => {
          const k = buVardiyaKontrolu(kontroller, e.kod, an);
          const et = acik.filter((x) => x.ekipman === e.kod);
          return {
            ...e,
            calisiyor: ana().tipler[e.tip]?.vardiyalar.includes(v.no) ?? true,
            kontrol: k ? { id: k.id, saat: isoTr(k.bitis).slice(11, 16), nokSayisi: k.nokSayisi, kisiAd: kisiBul(k.kisi)?.ad } : null,
            acikEtiket: { kirmizi: et.filter((x) => x.renk === 'kirmizi').length, beyaz: et.filter((x) => x.renk === 'beyaz').length, durus: et.some((x) => x.durus), geciken: et.filter((x) => geciktiMi(x, v.gun)).length },
          };
        }),
      };
    },

    /** Ekipman kartı (QR'ın açtığı sayfa). Arıza Defteri'ne ulaşılamazsa kart yine açılır, son arızalar boş gelir. */
    async ekipmanKarti(kum, kod) {
      const e = ekipmanZorunlu(kod);
      const an = simdi();
      const kontroller = store.kontroller(kum, { ekipman: kod, bas: an - 7 * 86400e3, limit: 30 });
      let arizalar = null;
      if (ariza.acik) {
        try {
          arizalar = (await ariza.arizalar(kod)).kayitlar;
        } catch { /* Arıza Defteri cevap vermedi: kart yine açılır */ }
      }
      return {
        ekipman: e,
        kontrolListesi: listeBul(e.tip),
        buVardiya: kontrolGorunumu(buVardiyaKontrolu(kontroller, kod, an)),
        sonKontroller: kontroller.slice(0, 5).map(kontrolGorunumu),
        acikEtiketler: store.etiketler(kum, { ekipman: kod, durum: 'acik' }).map(etiketGorunumu),
        kapananEtiketler: store.etiketler(kum, { ekipman: kod, durum: 'kapali', limit: 5 }).map(etiketGorunumu),
        sonArizalar: arizalar,
        duruslar: store.duruslar(kum, { ekipman: kod, limit: 10 }).map(durusGorunumu),
      };
    },

    /** Vardiya başı kontrolü kaydeder. Her madde bir kez ve "ok"/"nok" olmalı. */
    kontrolKaydet(kum, g = {}) {
      const e = ekipmanZorunlu(g.ekipman);
      const kisi = kisiZorunlu(g.kisi, 'kontrol');
      const liste = listeBul(e.tip);
      if (!Array.isArray(g.sonuc) || g.sonuc.length !== liste.length) throw new KuralHatasi('Listedeki her madde bir kez işaretlenmeli.');
      const sonuc = liste.map((m) => {
        const s = g.sonuc.find((x) => x && x.madde === m.kod);
        if (!s || !['ok', 'nok'].includes(s.durum)) throw new KuralHatasi(`"${m.metin}" maddesi işaretlenmedi.`);
        return { madde: m.kod, durum: s.durum };
      });
      const an = simdi();
      const bas = Number.isInteger(g.baslangicMs) && g.baslangicMs <= an && g.baslangicMs >= an - 30 * 60_000 ? g.baslangicMs : an;
      hak(kum, 'kontrol');
      const v = vardiyaBul(bas);
      const id = store.kontrolEkle(kum, { ekipman: e.kod, kisi: kisi.kod, gun: v.gun, vardiya: v.no, baslangic: bas, bitis: an, sonuc });
      return {
        kontrol: kontrolGorunumu(store.kontrolBul(kum, id)),
        sorunlu: sonuc.filter((s) => s.durum === 'nok').map((s) => liste.find((m) => m.kod === s.madde)),
      };
    },

    /**
     * Etiket açar. "Çalışamıyor" → Arıza Defteri'ne arıza. Takip Nabız'da: sorumlu (isteğe bağlı) ve hedef tarih.
     * Hedef verilmezse kurala göre konur (kurallar.js → HEDEF_GUN); beyazın sorumlusu verilmezse açan kişidir.
     */
    etiketAc(kum, g = {}) {
      const e = ekipmanZorunlu(g.ekipman);
      const kisi = kisiZorunlu(g.kisi, 'etiket_ac');
      if (!RENKLER[g.renk]) throw new KuralHatasi('Etiket rengi kırmızı ya da beyaz olmalı.');
      const aciklama = metin(g.aciklama, 'Açıklama', { zorunlu: true });
      let madde = null;
      if (g.madde != null) {
        madde = listeBul(e.tip).find((m) => m.kod === g.madde);
        if (!madde) throw new KuralHatasi('Kontrol maddesi bu ekipmana ait değil.');
      }
      // Emniyet maddesi: ekipman kilitlenir (kullanılmaz) ve etiket kırmızıdır; işaretlemeyi operatöre bırakmayız.
      const emniyet = madde?.emniyet === true;
      if (emniyet && g.renk !== 'kirmizi') throw new KuralHatasi('Emniyet maddesi kırmızı etiketle bildirilir: ekipman kullanılmaz.');
      const durus = g.durus === true || emniyet;
      let tur = madde?.tur ?? null;
      if (g.tur != null) {
        const t = ana().arizaTurleri.find((x) => x.kod === g.tur && x.tip === e.tip);
        if (!t) throw new KuralHatasi('Arıza türü bu ekipman tipine ait değil.');
        tur = t.kod;
      }
      if (durus && !tur) throw new KuralHatasi('Ekipman çalışamıyorsa arıza türü seçilmeli.');
      if (durus && g.renk !== 'kirmizi') throw new KuralHatasi('Ekipmanı durduran sorun kırmızı etiketle bildirilir.');
      let kontrol = null;
      if (g.kontrol != null) {
        if (!kimlikBicimi(g.kontrol, 'K') || !store.kontrolBul(kum, g.kontrol)) throw new KuralHatasi('Kontrol kaydı bulunamadı.');
        kontrol = g.kontrol;
      }
      const bugun = istanbulGunu(simdi());
      const sorumlu = g.sorumlu != null ? sorumluDogrula(g.sorumlu, g.renk).kod : g.renk === 'beyaz' && sorumluOlabilirMi(kisi, 'beyaz') ? kisi.kod : null;
      const hedef = g.hedefTarih != null ? hedefDogrula(g.hedefTarih, bugun) : varsayilanHedef(g.renk, durus, bugun, emniyet);
      hak(kum, 'etiket');
      const an = simdi();
      const id = store.etiketEkle(kum, { ekipman: e.kod, renk: g.renk, madde: madde?.kod, tur, aciklama, kisi: kisi.kod, olusturma: an, durus, kontrol, sorumlu, hedef });
      if (durus) kuyruk(kum, id, 'ariza_bildir', { ekipman: e.kod, tur, bildiren: kisi.kod, aciklama: `Nabız etiketi ${id}: ${aciklama}`.slice(0, 300), baslangic: isoTr(an) });
      return this.etiketDetay(kum, id);
    },

    /** Etiketi kapatır. Bağlı Arıza Defteri kaydı da kapatılır (kuyrukla). */
    etiketKapat(kum, id, g = {}) {
      if (!kimlikBicimi(id, 'E')) throw new KuralHatasi('Etiket kimliği geçersiz.');
      const etiket = store.etiketBul(kum, id);
      if (!etiket) throw new KuralHatasi('Etiket bulunamadı.', { durum: 404, kod: 'yok' });
      if (etiket.durum !== 'acik') throw new KuralHatasi('Etiket zaten kapalı.', { durum: 409, kod: 'kapali' });
      const kisi = kisiZorunlu(g.kisi, 'etiket_kapat', etiket);
      const not = metin(g.not, 'Yapılan işlem', { zorunlu: true });
      const an = simdi();
      if (!store.etiketKapat(kum, id, { kapatan: kisi.kod, kapanis: an, not })) throw new KuralHatasi('Etiket zaten kapalı.', { durum: 409, kod: 'kapali' });
      const gidenler = store.gidenler(kum, id);
      if (gidenler.some((x) => x.hedef === 'ariza_bildir')) {
        // Arıza Defteri kapatırken çözen kişi kodu ister; operatör kapattıysa da kendi kodu gider.
        kuyruk(kum, id, 'ariza_kapat', { cozen: kisi.kod, islem: not, bitis: isoTr(an) });
      }
      return this.etiketDetay(kum, id);
    },

    /** Sorumlu atar ve/veya hedef tarihi değiştirir (teknisyen ve şef). sorumlu: null → atamayı kaldırır. */
    etiketAta(kum, id, g = {}) {
      if (!kimlikBicimi(id, 'E')) throw new KuralHatasi('Etiket kimliği geçersiz.');
      const etiket = store.etiketBul(kum, id);
      if (!etiket) throw new KuralHatasi('Etiket bulunamadı.', { durum: 404, kod: 'yok' });
      if (etiket.durum !== 'acik') throw new KuralHatasi('Kapalı etiketin sorumlusu değiştirilemez.', { durum: 409, kod: 'kapali' });
      kisiZorunlu(g.kisi, 'etiket_ata', etiket);
      if (g.sorumlu === undefined && g.hedefTarih === undefined) throw new KuralHatasi('Sorumlu ya da hedef tarih verilmeli.');
      const sorumlu = g.sorumlu === undefined ? etiket.sorumlu : g.sorumlu === null ? null : sorumluDogrula(g.sorumlu, etiket.renk).kod;
      const hedef = g.hedefTarih === undefined ? etiket.hedef : hedefDogrula(g.hedefTarih, istanbulGunu(simdi()));
      if (!store.etiketAta(kum, id, { sorumlu, hedef })) throw new KuralHatasi('Kapalı etiketin sorumlusu değiştirilemez.', { durum: 409, kod: 'kapali' });
      return this.etiketDetay(kum, id);
    },

    etiketDetay(kum, id) {
      if (!kimlikBicimi(id, 'E')) throw new KuralHatasi('Etiket kimliği geçersiz.');
      const e = store.etiketBul(kum, id);
      if (!e) throw new KuralHatasi('Etiket bulunamadı.', { durum: 404, kod: 'yok' });
      return {
        ...etiketGorunumu(e),
        gonderimler: store.gidenler(kum, id).map((x) => ({ hedef: x.hedef, durum: x.durum, deneme: x.deneme, hata: x.son_hata, govde: x.govde, sonuc: x.sonuc, zaman: isoTr(x.guncelleme) })),
      };
    },

    etiketler(kum, q = {}) {
      const durum = ['acik', 'kapali'].includes(q.durum) ? q.durum : undefined;
      const renk = RENKLER[q.renk] ? q.renk : undefined;
      if (q.ekipman) ekipmanZorunlu(q.ekipman);
      if (q.sorumlu && !kisiBul(q.sorumlu)) throw new KuralHatasi('Sorumlu kişi tanınmıyor.');
      const geciken = q.geciken === true || q.geciken === 'true' || q.geciken === '1';
      return {
        etiketler: store.etiketler(kum, {
          durum, renk, ekipman: q.ekipman || undefined, sorumlu: q.sorumlu || undefined, gecikenBugun: geciken ? istanbulGunu(simdi()) : undefined, limit: 200,
        }).map(etiketGorunumu),
      };
    },

    /** Fotoğraf: yalnız JPEG (arayüz telefonda küçültüp JPEG'e çevirir), en çok 1,5 MB. Başlık baytları denetlenir. */
    fotoKaydet(kum, id, veri) {
      if (!kimlikBicimi(id, 'E')) throw new KuralHatasi('Etiket kimliği geçersiz.');
      const e = store.etiketBul(kum, id);
      if (!e) throw new KuralHatasi('Etiket bulunamadı.', { durum: 404, kod: 'yok' });
      if (!Buffer.isBuffer(veri) || veri.length < 100) throw new KuralHatasi('Fotoğraf boş.');
      if (veri.length > FOTO_SINIRI) throw new KuralHatasi('Fotoğraf çok büyük.', { durum: 413 });
      if (!(veri[0] === 0xff && veri[1] === 0xd8 && veri[2] === 0xff && veri.at(-2) === 0xff && veri.at(-1) === 0xd9)) throw new KuralHatasi('Fotoğraf JPEG olmalı.', { durum: 415 });
      hak(kum, 'foto');
      store.fotoYaz(kum, id, veri);
      return { tamam: true };
    },
    fotoOku(kum, id) {
      if (!kimlikBicimi(id, 'E')) throw new KuralHatasi('Etiket kimliği geçersiz.');
      const v = store.fotoOku(kum, id);
      if (!v) throw new KuralHatasi('Fotoğraf yok.', { durum: 404, kod: 'yok' });
      return v;
    },

    // ---------------------------------------------------------------------------------------------
    // V2: duruş kaydı, OEE ve 6 büyük kayıp, güvenilirlik, A3 taslağı
    // ---------------------------------------------------------------------------------------------

    /**
     * Elle duruş kaydı (6 büyük kaybın herhangi biri). Süre verilirse kapanmış kaydedilir; "devam" ise sonra bitirilir.
     * Arıza Defteri'ne gerçek kayıt olarak gider (giden kutusu); planlı bakım buradan girilmez.
     */
    durusKaydet(kum, g = {}) {
      const e = ekipmanZorunlu(g.ekipman);
      const kisi = kisiZorunlu(g.kisi, 'kontrol');
      const t = ana().arizaTurleri.find((x) => x.kod === g.tur && x.tip === e.tip);
      if (!t) throw new KuralHatasi('Duruş türü bu ekipman tipine ait değil.');
      const devam = g.devam === true;
      let sure = null;
      if (!devam) {
        sure = Number(g.sureDk);
        if (!Number.isInteger(sure) || sure < 1 || sure > 600) throw new KuralHatasi('Süre 1 ile 600 dakika arasında bir tam sayı olmalı (sürüyorsa "devam ediyor" seç).');
      }
      const aciklama = metin(g.aciklama, 'Açıklama');
      hak(kum, 'durus');
      const an = simdi();
      const baslangic = devam ? an : an - sure * 60_000;
      const id = store.durusEkle(kum, { ekipman: e.kod, tur: t.kod, kayip: t.kayip, kisi: kisi.kod, baslangic, bitis: devam ? null : an, aciklama, olusturma: an });
      kuyruk(kum, null, 'ariza_bildir', { ekipman: e.kod, tur: t.kod, bildiren: kisi.kod, aciklama: `Nabız duruş kaydı ${id}${aciklama ? `: ${aciklama}` : ''}`.slice(0, 300), baslangic: isoTr(baslangic) }, id);
      if (!devam) kuyruk(kum, null, 'ariza_kapat', { cozen: kisi.kod, islem: aciklama || 'Nabız duruş kaydı', bitis: isoTr(an) }, id);
      return this.durusDetay(kum, id);
    },

    durusBitir(kum, id, g = {}) {
      if (!kimlikBicimi(id, 'D')) throw new KuralHatasi('Duruş kimliği geçersiz.');
      const d = store.durusBul(kum, id);
      if (!d) throw new KuralHatasi('Duruş bulunamadı.', { durum: 404, kod: 'yok' });
      const kisi = kisiZorunlu(g.kisi, 'kontrol');
      const not = metin(g.not, 'Yapılan işlem', { zorunlu: true });
      const an = simdi();
      if (!store.durusBitir(kum, id, an)) throw new KuralHatasi('Duruş zaten bitmiş.', { durum: 409, kod: 'kapali' });
      kuyruk(kum, null, 'ariza_kapat', { cozen: kisi.kod, islem: not, bitis: isoTr(an) }, id);
      return this.durusDetay(kum, id);
    },

    durusDetay(kum, id) {
      const d = store.durusBul(kum, id);
      if (!d) throw new KuralHatasi('Duruş bulunamadı.', { durum: 404, kod: 'yok' });
      return { ...durusGorunumu(d), gonderimler: store.gidenler(kum, id).map((x) => ({ hedef: x.hedef, durum: x.durum, hata: x.son_hata, govde: x.govde, sonuc: x.sonuc })) };
    },

    /** OEE + 6 büyük kayıp + Pareto (Arıza Defteri verisinden). Paylaşılan veri: dakikada bir hesaplanır. */
    async kayipAnalizi(q = {}) {
      disZorunlu(ariza, 'Arıza Defteri');
      const gun = [7, 30, 90].includes(Number(q.gun)) ? Number(q.gun) : 30;
      return onbellekli(`kayip:${gun}`, 60_000, () => dis(async () => {
        const [u, o] = await Promise.all([ariza.uretim(gun), ariza.ozet(gun)]);
        return {
          donemGun: gun,
          oee: oeeRaporu(u.satirlar, u.tipler, ana().ekipmanlar),
          dunyaSinifi: DUNYA_SINIFI,
          kayiplar: o.kayiplar,
          pareto: o.pareto.slice(0, 10),
          ekipmanlar: o.ekipmanlar.map(({ kod, ad, arizaSayisi, durusDk, mttrDk, mtbfSaat }) => ({ kod, ad, arizaSayisi, durusDk, mttrDk, mtbfSaat })),
        };
      }));
    },

    /** Nabız Analiz (Python) raporu: tür başına β ve sınıf, tip başına bakım aralığı önerisi. 10 dakikalık önbellek. */
    async guvenilirlik() {
      disZorunlu(analiz, 'Nabız Analiz');
      return onbellekli('guvenilirlik', 10 * 60_000, () => dis(() => analiz.guvenilirlik()));
    },

    /** Bir arıza türü için A3 taslağı. Güvenilirlik alınamazsa taslak yine çıkar (o bölüm "alınamadı" der). */
    async a3(tur, q = {}) {
      disZorunlu(ariza, 'Arıza Defteri');
      const t = ana().arizaTurleri.find((x) => x.kod === tur);
      if (!t) throw new KuralHatasi('Arıza türü bulunamadı.', { durum: 404, kod: 'yok' });
      const gun = [30, 90].includes(Number(q.gun)) ? Number(q.gun) : 90;
      const [kayitlar, o, b] = await dis(() => Promise.all([ariza.turKayitlari(tur, gun), ariza.ozet(gun), ariza.bulgular(gun)]));
      let gv = null, aralik = null;
      if (analiz.acik) {
        try {
          const r = await this.guvenilirlik();
          gv = r.turler.find((x) => x.tur === tur) ?? null;
          aralik = r.tipler.find((x) => x.tip === t.tip) ?? null;
        } catch { /* analiz servisi yoksa taslak yine çıkar */ }
      }
      return a3Taslagi({
        tur, turBilgi: { ...t, tipAd: ana().tipler[t.tip]?.ad }, kayitlar: kayitlar.kayitlar, pareto: o.pareto,
        guvenilirlik: gv, aralik, bulgular: b.bulgular, donemGun: gun,
      });
    },

    /**
     * Planlı bakım tablosu (V3): Arıza Defteri takvimi + sayaç + Nabız Analiz önerisi. Analiz kapalıysa öneri sütunu boş.
     * Paylaşılan veri: dakikada bir.
     */
    async bakimDurumu() {
      disZorunlu(ariza, 'Arıza Defteri');
      return onbellekli('bakim', 60_000, async () => {
        const o = await dis(() => ariza.ozet(30));
        let oneriler = null;
        if (analiz.acik) { try { oneriler = (await this.guvenilirlik()).tipler; } catch { oneriler = null; } }
        return { gun: istanbulGunu(simdi()), oneriVar: !!oneriler, ...bakimTablosu(o.ekipmanlar, oneriler, istanbulGunu(simdi())) };
      });
    },

    /** Otonom bakım olgunluğu (7 adım), tip başına; son 30 günün kontrol ve etiketlerinden. */
    olgunluk(kum) {
      const an = simdi();
      const bugun = istanbulGunu(an);
      const kontroller30 = store.kontroller(kum, { bas: anMs(gunEkle(bugun, -29)) });
      // Kayıt 30 günden kısaysa (yeni kurulum, demo: 7 gün) dönem kaydın başladığı güne kısalır; yoksa uyum yanlış düşük çıkar
      const ilk = kontroller30.reduce((m, k) => (k.gun < m ? k.gun : m), bugun);
      const gunSayisi = Math.max(1, Math.min(30, gunFarki(ilk, bugun) + 1));
      const bas = anMs(gunEkle(bugun, -(gunSayisi - 1)));
      const a = ana();
      return {
        donemGun: gunSayisi,
        tipler: olgunluk({ kontroller: kontroller30.filter((k) => k.baslangic >= bas), etiketler: store.etiketler(kum, { bas, limit: 5000 }).map(etiketGorunumu),
          ekipmanlar: a.ekipmanlar, tipler: a.tipler, bugun, simdi: an, gunSayisi }),
      };
    },

    /** Şefin sabah özeti (bildirim metni ve önizleme): geciken etiketler, sorumlusuz kırmızılar, gecikme kimde, geciken bakım. */
    async sabahOzeti(kum) {
      const bugun = istanbulGunu(simdi());
      const acik = store.etiketler(kum, { durum: 'acik', limit: 2000 });
      const gecikenler = acik.filter((e) => geciktiMi(e, bugun)).map(etiketGorunumu);
      const sorumsuzKirmizilar = acik.filter((e) => e.renk === 'kirmizi' && !e.sorumlu).map(etiketGorunumu);
      const sorumluYuku = [...Map.groupBy(gecikenler.filter((e) => e.sorumlu), (e) => e.sorumluAd)].map(([ad, l]) => ({ ad, geciken: l.length }))
        .sort((x, y) => y.geciken - x.geciken);
      // Takvime göre geciken planlı bakımlar (Arıza Defteri'ne ulaşılamazsa özet yine gider, bakım satırı olmaz)
      let gecikenBakimlar = [];
      if (ariza.acik) { try { gecikenBakimlar = (await this.bakimDurumu()).satirlar.filter((x) => x.durum === 'gecikti'); } catch { gecikenBakimlar = []; } }
      return { gun: bugun, ...sabahOzeti({ gecikenler, sorumsuzKirmizilar, sorumluYuku, gecikenBakimlar }, { bugun, uygulamaUrl: appUrl }) };
    },

    /** Yönetici özeti: kontrol uyumu, açık etiketler, kapanma süreleri, en sık sorunlu maddeler. */
    ozet(kum, q = {}) {
      const gunSayisi = [1, 7, 30].includes(Number(q.gun)) ? Number(q.gun) : 7;
      const an = simdi();
      const bugun = istanbulGunu(an);
      const bas = anMs(gunEkle(bugun, -(gunSayisi - 1)));
      const kontroller = store.kontroller(kum, { bas });
      const a = ana();
      const uyum = kontrolUyumu(kontroller, a.ekipmanlar, a.tipler, { bugun, simdi: an, gunSayisi });
      const bugunUyum = kontrolUyumu(kontroller, a.ekipmanlar, a.tipler, { bugun, simdi: an, gunSayisi: 1 });
      const etiketler = store.etiketler(kum, { bas, limit: 2000 });
      const acik = store.etiketler(kum, { durum: 'acik', limit: 2000 });
      const kapanmaSaat = (renk) => {
        const l = etiketler.filter((e) => e.renk === renk && e.durum === 'kapali');
        return l.length ? Math.round((l.reduce((t, e) => t + (e.kapanis - e.olusturma), 0) / l.length / 3600e3) * 10) / 10 : null;
      };
      const maddeler = new Map();
      for (const k of kontroller) for (const s of k.sonuc) if (s.durum === 'nok') {
        const a2 = `${k.ekipman}|${s.madde}`;
        maddeler.set(a2, (maddeler.get(a2) || 0) + 1);
      }
      return {
        donemGun: gunSayisi,
        uyum: { oran: uyum.oran, beklenen: uyum.beklenen, yapilan: uyum.yapilan },
        /** Madde başına 6 sn'den kısa süren kontroller: bakılmadan işaretlenmiş olabilir. */
        hizliKontrol: (() => {
          const l = kontroller.filter((k) => hizliKontrolMu(k, listeBul(ekipmanBul(k.ekipman)?.tip).length || 5));
          return { adet: l.length, oran: kontroller.length ? Math.round((l.length / kontroller.length) * 1000) / 1000 : null,
            kisiler: [...Map.groupBy(l, (k) => k.kisi)].map(([kod, x]) => ({ kod, ad: kisiBul(kod)?.ad ?? kod, adet: x.length })).sort((a2, b2) => b2.adet - a2.adet).slice(0, 3) };
        })(),
        bugunUyum: { oran: bugunUyum.oran, eksik: bugunUyum.ekipmanlar.filter((x) => x.eksik.length).map((x) => ({ kod: x.kod, vardiyalar: x.eksik })) },
        ekipmanUyum: uyum.ekipmanlar.map(({ kod, beklenen, yapilan }) => ({ kod, ad: ekipmanBul(kod)?.ad, beklenen, yapilan, oran: beklenen ? Math.round((yapilan / beklenen) * 1000) / 1000 : null })),
        acik: {
          kirmizi: acik.filter((e) => e.renk === 'kirmizi').length, beyaz: acik.filter((e) => e.renk === 'beyaz').length, durus: acik.filter((e) => e.durus).length,
          geciken: acik.filter((e) => geciktiMi(e, bugun)).length, sorumsuzKirmizi: acik.filter((e) => e.renk === 'kirmizi' && !e.sorumlu).length,
        },
        /** Sorumlu başına açık ve geciken etiket: iş kimde birikiyor? */
        sorumluYuku: [...Map.groupBy(acik.filter((e) => e.sorumlu), (e) => e.sorumlu)].map(([kod, l]) => ({
          kod, ad: kisiBul(kod)?.ad ?? kod, acik: l.length, geciken: l.filter((e) => geciktiMi(e, bugun)).length,
        })).sort((x, y) => y.geciken - x.geciken || y.acik - x.acik),
        donemEtiket: { kirmizi: etiketler.filter((e) => e.renk === 'kirmizi').length, beyaz: etiketler.filter((e) => e.renk === 'beyaz').length },
        ortKapanmaSaat: { kirmizi: kapanmaSaat('kirmizi'), beyaz: kapanmaSaat('beyaz') },
        sikMaddeler: [...maddeler.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => {
          const [ekipman, madde] = k.split('|');
          return { ekipman, ekipmanAd: ekipmanBul(ekipman)?.ad, madde, metin: listeBul(ekipmanBul(ekipman)?.tip).find((m) => m.kod === madde)?.metin, adet: n };
        }),
        enEskiAcik: acik.slice().sort((x, y) => x.olusturma - y.olusturma).slice(0, 5).map(etiketGorunumu),
        gecikenler: acik.filter((e) => geciktiMi(e, bugun)).sort((x, y) => x.hedef.localeCompare(y.hedef)).slice(0, 10).map(etiketGorunumu),
      };
    },
  };
}
