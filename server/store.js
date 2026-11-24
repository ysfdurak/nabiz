// SQLite deposu (node:sqlite, ek paket yok). SQL'lerin hepsi parametrelidir.
// Her satır bir "kum" (alan) içindedir:
//   'ana'        : kurumun gerçek verisi. Demo kurulumunda vitrin verisi; MCP ve entegrasyonlar yalnız bunu kullanır.
//   rastgele kod : ziyaretçinin kendi deneme alanı (çerezle bağlanır, 72 saat sonra silinir). Gönderimler benzetimdir.
//
//   kum     : ziyaretçi alanları (IP'nin kendisi değil, tuzlu özeti)
//   kontrol : vardiya başı otonom bakım kontrolleri (madde sonuçları JSON)
//   etiket  : kırmızı/beyaz etiketler
//   foto    : etiket fotoğrafı (JPEG, en çok 1,5 MB)
//   durus   : elle kaydedilen duruşlar (V2: 6 büyük kayıp; Arıza Defteri'ne de gider)
//   giden   : Pusula ve Arıza Defteri'ne gidecek istekler (kuyruk; hata olursa yeniden denenir). Bir etikete ya da duruşa bağlıdır.
//   sayac   : günlük kullanım sınırları
//   oturum  : kurum modunda giriş oturumları (anahtarın kendisi değil, özeti)
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const kimlik = (onek) => `${onek}-${randomBytes(6).toString('hex')}`;
const ETIKET_SUTUNLARI = 'id, kum, ekipman, renk, madde, tur, aciklama, kisi, olusturma, durus, durum, kapatan, kapanis, kapatma_notu, foto, pusula_is, ariza_id, kontrol';

const etiketNesnesi = (s) => s && ({
  id: s.id, ekipman: s.ekipman, renk: s.renk, madde: s.madde, tur: s.tur, aciklama: s.aciklama, kisi: s.kisi,
  olusturma: s.olusturma, durus: !!s.durus, durum: s.durum, kapatan: s.kapatan, kapanis: s.kapanis, kapatmaNotu: s.kapatma_notu,
  foto: !!s.foto, pusulaIs: s.pusula_is, arizaId: s.ariza_id, kontrol: s.kontrol,
});
const kontrolNesnesi = (s) => s && ({
  id: s.id, ekipman: s.ekipman, kisi: s.kisi, gun: s.gun, vardiya: s.vardiya, baslangic: s.baslangic, bitis: s.bitis,
  sonuc: JSON.parse(s.sonuc), nokSayisi: s.nok_sayisi,
});

export function openStore(dosya) {
  const db = new DatabaseSync(dosya);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (anahtar TEXT PRIMARY KEY, deger TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kum (id TEXT PRIMARY KEY, olusturma INTEGER NOT NULL, son INTEGER NOT NULL, ip TEXT);
    CREATE TABLE IF NOT EXISTS kontrol (
      id TEXT PRIMARY KEY, kum TEXT NOT NULL REFERENCES kum(id) ON DELETE CASCADE, ekipman TEXT NOT NULL, kisi TEXT NOT NULL,
      gun TEXT NOT NULL, vardiya INTEGER NOT NULL, baslangic INTEGER NOT NULL, bitis INTEGER NOT NULL, sonuc TEXT NOT NULL, nok_sayisi INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS kontrol_kum ON kontrol (kum, gun, ekipman);
    CREATE TABLE IF NOT EXISTS etiket (
      id TEXT PRIMARY KEY, kum TEXT NOT NULL REFERENCES kum(id) ON DELETE CASCADE, ekipman TEXT NOT NULL,
      renk TEXT NOT NULL CHECK (renk IN ('kirmizi', 'beyaz')), madde TEXT, tur TEXT, aciklama TEXT NOT NULL, kisi TEXT NOT NULL,
      olusturma INTEGER NOT NULL, durus INTEGER NOT NULL DEFAULT 0, durum TEXT NOT NULL CHECK (durum IN ('acik', 'kapali')),
      kapatan TEXT, kapanis INTEGER, kapatma_notu TEXT, foto INTEGER NOT NULL DEFAULT 0, pusula_is TEXT, ariza_id TEXT, kontrol TEXT);
    CREATE INDEX IF NOT EXISTS etiket_kum ON etiket (kum, durum, olusturma);
    CREATE TABLE IF NOT EXISTS foto (etiket TEXT PRIMARY KEY REFERENCES etiket(id) ON DELETE CASCADE, kum TEXT NOT NULL, veri BLOB NOT NULL, boyut INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS durus (
      id TEXT PRIMARY KEY, kum TEXT NOT NULL REFERENCES kum(id) ON DELETE CASCADE, ekipman TEXT NOT NULL, tur TEXT NOT NULL, kayip TEXT NOT NULL,
      kisi TEXT NOT NULL, baslangic INTEGER NOT NULL, bitis INTEGER, aciklama TEXT, ariza_id TEXT, olusturma INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS durus_kum ON durus (kum, baslangic);
    CREATE TABLE IF NOT EXISTS giden (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kum TEXT NOT NULL REFERENCES kum(id) ON DELETE CASCADE,
      etiket TEXT REFERENCES etiket(id) ON DELETE CASCADE, durus TEXT REFERENCES durus(id) ON DELETE CASCADE,
      hedef TEXT NOT NULL, govde TEXT NOT NULL, durum TEXT NOT NULL CHECK (durum IN ('bekliyor', 'gonderildi', 'hata', 'benzetim')),
      deneme INTEGER NOT NULL DEFAULT 0, sonraki INTEGER NOT NULL, son_hata TEXT, sonuc TEXT, olusturma INTEGER NOT NULL, guncelleme INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS giden_bekleyen ON giden (durum, sonraki);
    CREATE TABLE IF NOT EXISTS sayac (gun TEXT NOT NULL, anahtar TEXT NOT NULL, sayi INTEGER NOT NULL, PRIMARY KEY (gun, anahtar));
    CREATE TABLE IF NOT EXISTS oturum (ozet TEXT PRIMARY KEY, bitis INTEGER NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO kum (id, olusturma, son) VALUES ('ana', 0, 0)").run();

  function islem(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const s = fn();
      db.exec('COMMIT');
      return s;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const kontrolYaz = db.prepare('INSERT INTO kontrol (id, kum, ekipman, kisi, gun, vardiya, baslangic, bitis, sonuc, nok_sayisi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const etiketYaz = db.prepare(`INSERT INTO etiket (id, kum, ekipman, renk, madde, tur, aciklama, kisi, olusturma, durus, durum, kapatan, kapanis, kapatma_notu, kontrol)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const kontrolEkle = (kum, k) => {
    const id = kimlik('K');
    kontrolYaz.run(id, kum, k.ekipman, k.kisi, k.gun, k.vardiya, k.baslangic, k.bitis, JSON.stringify(k.sonuc), k.sonuc.filter((s) => s.durum === 'nok').length);
    return id;
  };
  const etiketEkle = (kum, e) => {
    const id = kimlik('E');
    etiketYaz.run(id, kum, e.ekipman, e.renk, e.madde ?? null, e.tur ?? null, e.aciklama, e.kisi, e.olusturma, e.durus ? 1 : 0, e.durum ?? 'acik',
      e.kapatan ?? null, e.kapanis ?? null, e.kapatmaNotu ?? null, e.kontrol ?? null);
    return id;
  };

  return {
    // --- alanlar -----------------------------------------------------------------------------
    kumOlustur(ip, zaman) {
      const id = randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO kum (id, olusturma, son, ip) VALUES (?, ?, ?, ?)').run(id, zaman, zaman, ip);
      return id;
    },
    kumVar: (id) => !!db.prepare('SELECT 1 FROM kum WHERE id = ?').get(id),
    kumDokun: (id, zaman) => db.prepare('UPDATE kum SET son = ? WHERE id = ?').run(zaman, id),
    kumSayisi: () => db.prepare("SELECT COUNT(*) AS n FROM kum WHERE id != 'ana'").get().n,
    /** Son kullanımı sınırdan eski ziyaretçi alanlarını, içindeki her şeyle siler. */
    kumTemizle: (sinir) => Number(db.prepare("DELETE FROM kum WHERE id != 'ana' AND son < ?").run(sinir).changes),

    /** Bir alanın içeriğini örnek geçmişle değiştirir (vitrin her gün tazelenir; ziyaretçi alanı açılırken dolar). */
    ornekYukle(kum, { kontroller, etiketler }) {
      return islem(() => {
        db.prepare('DELETE FROM kontrol WHERE kum = ?').run(kum);
        db.prepare('DELETE FROM etiket WHERE kum = ?').run(kum);
        db.prepare('DELETE FROM durus WHERE kum = ?').run(kum);
        for (const k of kontroller) kontrolEkle(kum, k);
        for (const e of etiketler) etiketEkle(kum, e);
        return { kontrol: kontroller.length, etiket: etiketler.length };
      });
    },

    // --- kontroller ----------------------------------------------------------------------------
    kontrolEkle,
    kontroller(kum, { bas = 0, ekipman, limit = 5000 } = {}) {
      const k = ['kum = ?', 'baslangic >= ?'];
      const d = [kum, bas];
      if (ekipman) { k.push('ekipman = ?'); d.push(ekipman); }
      return db.prepare(`SELECT * FROM kontrol WHERE ${k.join(' AND ')} ORDER BY baslangic DESC LIMIT ${Math.min(5000, Math.max(1, limit))}`).all(...d).map(kontrolNesnesi);
    },
    kontrolBul: (kum, id) => kontrolNesnesi(db.prepare('SELECT * FROM kontrol WHERE kum = ? AND id = ?').get(kum, id)),

    // --- etiketler -----------------------------------------------------------------------------
    etiketEkle,
    etiketBul: (kum, id) => etiketNesnesi(db.prepare(`SELECT ${ETIKET_SUTUNLARI} FROM etiket WHERE kum = ? AND id = ?`).get(kum, id)),
    etiketler(kum, { durum, renk, ekipman, bas, limit = 500 } = {}) {
      const k = ['kum = ?'];
      const d = [kum];
      if (durum) { k.push('durum = ?'); d.push(durum); }
      if (renk) { k.push('renk = ?'); d.push(renk); }
      if (ekipman) { k.push('ekipman = ?'); d.push(ekipman); }
      if (bas != null) { k.push('olusturma >= ?'); d.push(bas); }
      return db.prepare(`SELECT ${ETIKET_SUTUNLARI} FROM etiket WHERE ${k.join(' AND ')} ORDER BY olusturma DESC LIMIT ${Math.min(2000, Math.max(1, limit))}`).all(...d).map(etiketNesnesi);
    },
    /** Yalnız açık etiket kapanır; döner: değişen satır sayısı (0 = zaten kapalı ya da yok). */
    etiketKapat: (kum, id, { kapatan, kapanis, not }) => Number(db.prepare(
      "UPDATE etiket SET durum = 'kapali', kapatan = ?, kapanis = ?, kapatma_notu = ? WHERE kum = ? AND id = ? AND durum = 'acik'",
    ).run(kapatan, kapanis, not, kum, id).changes),
    etiketBaglanti(kum, id, { pusulaIs, arizaId }) {
      if (pusulaIs !== undefined) db.prepare('UPDATE etiket SET pusula_is = ? WHERE kum = ? AND id = ?').run(pusulaIs, kum, id);
      if (arizaId !== undefined) db.prepare('UPDATE etiket SET ariza_id = ? WHERE kum = ? AND id = ?').run(arizaId, kum, id);
    },

    // --- fotoğraf ------------------------------------------------------------------------------
    fotoYaz(kum, etiket, veri) {
      return islem(() => {
        db.prepare('INSERT INTO foto (etiket, kum, veri, boyut) VALUES (?, ?, ?, ?) ON CONFLICT(etiket) DO UPDATE SET veri = excluded.veri, boyut = excluded.boyut').run(etiket, kum, veri, veri.length);
        db.prepare('UPDATE etiket SET foto = 1 WHERE kum = ? AND id = ?').run(kum, etiket);
      });
    },
    fotoOku: (kum, etiket) => db.prepare('SELECT veri FROM foto WHERE kum = ? AND etiket = ?').get(kum, etiket)?.veri ?? null,

    // --- duruşlar -------------------------------------------------------------------------------
    durusEkle(kum, d) {
      const id = kimlik('D');
      db.prepare('INSERT INTO durus (id, kum, ekipman, tur, kayip, kisi, baslangic, bitis, aciklama, olusturma) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, kum, d.ekipman, d.tur, d.kayip, d.kisi, d.baslangic, d.bitis ?? null, d.aciklama ?? null, d.olusturma);
      return id;
    },
    durusBul: (kum, id) => db.prepare('SELECT * FROM durus WHERE kum = ? AND id = ?').get(kum, id) ?? null,
    duruslar(kum, { ekipman, acik, limit = 200 } = {}) {
      const k = ['kum = ?'];
      const d = [kum];
      if (ekipman) { k.push('ekipman = ?'); d.push(ekipman); }
      if (acik) k.push('bitis IS NULL');
      return db.prepare(`SELECT * FROM durus WHERE ${k.join(' AND ')} ORDER BY baslangic DESC LIMIT ${Math.min(1000, Math.max(1, limit))}`).all(...d);
    },
    /** Yalnız devam eden duruş bitirilir; döner: değişen satır sayısı. */
    durusBitir: (kum, id, bitis) => Number(db.prepare('UPDATE durus SET bitis = ? WHERE kum = ? AND id = ? AND bitis IS NULL').run(bitis, kum, id).changes),
    durusBaglanti: (kum, id, arizaId) => db.prepare('UPDATE durus SET ariza_id = ? WHERE kum = ? AND id = ?').run(arizaId, kum, id),

    // --- giden kutusu --------------------------------------------------------------------------
    gidenEkle(kum, { etiket = null, durus = null, hedef, govde, durum = 'bekliyor', sonuc = null }, zaman) {
      return Number(db.prepare('INSERT INTO giden (kum, etiket, durus, hedef, govde, durum, sonraki, sonuc, olusturma, guncelleme) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(kum, etiket, durus, hedef, JSON.stringify(govde), durum, zaman, sonuc && JSON.stringify(sonuc), zaman, zaman).lastInsertRowid);
    },
    /** Zamanı gelmiş bekleyen gönderimler (yalnız 'ana' alanı; ziyaretçi gönderimleri benzetimdir). */
    gidenBekleyen: (zaman, limit = 20) => db.prepare("SELECT * FROM giden WHERE kum = 'ana' AND durum = 'bekliyor' AND sonraki <= ? ORDER BY id LIMIT ?")
      .all(zaman, limit).map((s) => ({ ...s, govde: JSON.parse(s.govde) })),
    gidenSonuc(id, { durum, sonuc, hata, sonraki }, zaman) {
      db.prepare('UPDATE giden SET durum = ?, sonuc = COALESCE(?, sonuc), son_hata = ?, sonraki = COALESCE(?, sonraki), deneme = deneme + 1, guncelleme = ? WHERE id = ?')
        .run(durum, sonuc ? JSON.stringify(sonuc) : null, hata ?? null, sonraki ?? null, zaman, id);
    },
    /** Bir etiketin (E-…) ya da duruşun (D-…) gönderimleri. */
    gidenler: (kum, kaynak) => db.prepare(`SELECT id, hedef, govde, durum, deneme, son_hata, sonuc, olusturma, guncelleme FROM giden WHERE kum = ? AND ${String(kaynak).startsWith('D-') ? 'durus' : 'etiket'} = ? ORDER BY id`)
      .all(kum, kaynak).map((s) => ({ ...s, govde: JSON.parse(s.govde), sonuc: s.sonuc ? JSON.parse(s.sonuc) : null })),
    gidenOzet: () => db.prepare("SELECT durum, COUNT(*) AS n FROM giden WHERE kum = 'ana' GROUP BY durum").all(),

    // --- sınırlar ------------------------------------------------------------------------------
    /** Sayaç sınırın altındaysa artırır ve true döner; doluysa false (atomik). */
    hakDus(gun, anahtar, sinir) {
      return islem(() => {
        const n = db.prepare('SELECT sayi FROM sayac WHERE gun = ? AND anahtar = ?').get(gun, anahtar)?.sayi ?? 0;
        if (n >= sinir) return false;
        db.prepare('INSERT INTO sayac (gun, anahtar, sayi) VALUES (?, ?, 1) ON CONFLICT(gun, anahtar) DO UPDATE SET sayi = sayi + 1').run(gun, anahtar);
        return true;
      });
    },
    sayacTemizle: (sinirGun) => db.prepare('DELETE FROM sayac WHERE gun < ?').run(sinirGun),

    // --- kurum modu oturumları -----------------------------------------------------------------
    oturumEkle: (ozet, bitis) => db.prepare('INSERT INTO oturum (ozet, bitis) VALUES (?, ?)').run(ozet, bitis),
    oturumGecerli: (ozet, zaman) => !!db.prepare('SELECT 1 FROM oturum WHERE ozet = ? AND bitis > ?').get(ozet, zaman),
    oturumSil: (ozet) => db.prepare('DELETE FROM oturum WHERE ozet = ?').run(ozet),
    oturumTemizle: (zaman) => db.prepare('DELETE FROM oturum WHERE bitis <= ?').run(zaman),

    // --- meta ----------------------------------------------------------------------------------
    metaOku: (a) => db.prepare('SELECT deger FROM meta WHERE anahtar = ?').get(a)?.deger ?? null,
    metaYaz: (a, d) => db.prepare('INSERT INTO meta (anahtar, deger) VALUES (?, ?) ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger').run(a, d),
    tuz() {
      const v = db.prepare("SELECT deger FROM meta WHERE anahtar = 'tuz'").get()?.deger;
      if (v) return v;
      const d = randomBytes(24).toString('base64url');
      db.prepare("INSERT INTO meta (anahtar, deger) VALUES ('tuz', ?)").run(d);
      return d;
    },
    close: () => db.close(),
  };
}
