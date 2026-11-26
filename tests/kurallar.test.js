// Kurallar: vardiya sınırları, kim neyi kapatır, kontrol uyumu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kontrolUyumu, vardiyaBul, yetkiliMi } from '../src/cekirdek/kurallar.js';
import { KONTROL_LISTELERI } from '../src/cekirdek/kontrol-listeleri.js';
import { anMs } from '../src/cekirdek/zaman.js';
import ana from '../veri/ana-veriler.json' with { type: 'json' };

test('vardiya sınırları (Türkiye saati)', () => {
  assert.deepEqual(vardiyaBul(anMs('2026-11-24', 0, 0)), { gun: '2026-11-24', no: 3 });
  assert.deepEqual(vardiyaBul(anMs('2026-11-24', 7, 59)), { gun: '2026-11-24', no: 3 });
  assert.deepEqual(vardiyaBul(anMs('2026-11-24', 8, 0)), { gun: '2026-11-24', no: 1 });
  assert.deepEqual(vardiyaBul(anMs('2026-11-24', 16, 0)), { gun: '2026-11-24', no: 2 });
  assert.deepEqual(vardiyaBul(anMs('2026-11-24', 23, 59)), { gun: '2026-11-24', no: 2 });
});

test('yetki: kırmızıyı yalnız teknisyen ve şef kapatır, beyazı herkes', () => {
  const op = { rol: 'operator' }, tk = { rol: 'teknisyen' }, sf = { rol: 'sef' };
  for (const k of [op, tk, sf]) {
    assert.ok(yetkiliMi(k, 'kontrol'));
    assert.ok(yetkiliMi(k, 'etiket_ac'));
    assert.ok(yetkiliMi(k, 'etiket_kapat', { renk: 'beyaz' }));
  }
  assert.equal(yetkiliMi(op, 'etiket_kapat', { renk: 'kirmizi' }), false);
  assert.ok(yetkiliMi(tk, 'etiket_kapat', { renk: 'kirmizi' }));
  assert.ok(yetkiliMi(sf, 'etiket_kapat', { renk: 'kirmizi' }));
  assert.equal(yetkiliMi(null, 'kontrol'), false);
  assert.equal(yetkiliMi({ rol: 'misafir' }, 'kontrol'), false);
});

test('kontrol uyumu: başlamamış vardiya beklenmez, aynı vardiyada iki kontrol bir sayılır', () => {
  const ekipmanlar = [{ kod: 'FL-01', tip: 'forklift' }, { kod: 'SR-01', tip: 'sorter' }];
  const simdi = anMs('2026-11-24', 10); // 3. ve 1. vardiya başladı
  const kontroller = [
    { ekipman: 'FL-01', gun: '2026-11-24', vardiya: 3 }, { ekipman: 'FL-01', gun: '2026-11-24', vardiya: 1 }, { ekipman: 'FL-01', gun: '2026-11-24', vardiya: 1 },
  ];
  const u = kontrolUyumu(kontroller, ekipmanlar, ana.tipler, { bugun: '2026-11-24', simdi });
  // FL-01: 3 ve 1 beklenir, ikisi yapıldı · SR-01: yalnız 1 (sorter gece çalışmaz), yapılmadı
  assert.equal(u.beklenen, 3);
  assert.equal(u.yapilan, 2);
  assert.deepEqual(u.ekipmanlar.find((x) => x.kod === 'SR-01').eksik, [1]);
});

test('her kontrol listesi kısa ve maddeleri Arıza Defteri türlerine bağlı', () => {
  for (const [tip, liste] of Object.entries(KONTROL_LISTELERI)) {
    assert.ok(liste.length >= 4 && liste.length <= 7, tip);
    for (const m of liste) {
      assert.ok(['kirmizi', 'beyaz'].includes(m.renk));
      assert.ok(ana.arizaTurleri.some((t) => t.kod === m.tur && t.tip === tip), `${tip}/${m.kod} → ${m.tur}`);
    }
  }
});

test('takip kuralları: varsayılan hedef, gecikme, kim sorumlu olabilir', async () => {
  const { varsayilanHedef, geciktiMi, sorumluOlabilirMi } = await import('../src/cekirdek/kurallar.js');
  assert.equal(varsayilanHedef('kirmizi', true, '2026-11-24'), '2026-11-25');
  assert.equal(varsayilanHedef('kirmizi', false, '2026-11-24'), '2026-11-27');
  assert.equal(varsayilanHedef('beyaz', false, '2026-11-28'), '2026-12-05', 'ay geçişi');
  assert.equal(geciktiMi({ durum: 'acik', hedef: '2026-11-24' }, '2026-11-24'), false, 'hedef günü içinde');
  assert.equal(geciktiMi({ durum: 'acik', hedef: '2026-11-23' }, '2026-11-24'), true);
  assert.equal(geciktiMi({ durum: 'kapali', hedef: '2026-11-01' }, '2026-11-24'), false, 'kapanan gecikmiş sayılmaz');
  assert.equal(geciktiMi({ durum: 'acik', hedef: null }, '2026-11-24'), false);
  const tek = { rol: 'teknisyen' }, op = { rol: 'operator' }, sef = { rol: 'sef' };
  assert.deepEqual([sorumluOlabilirMi(tek, 'kirmizi'), sorumluOlabilirMi(op, 'kirmizi'), sorumluOlabilirMi(sef, 'kirmizi')], [true, false, false]);
  assert.deepEqual([sorumluOlabilirMi(tek, 'beyaz'), sorumluOlabilirMi(op, 'beyaz'), sorumluOlabilirMi(sef, 'beyaz')], [true, true, false]);
});

test('emniyet ve hızlı kontrol kuralları', async () => {
  const { varsayilanHedef, hizliKontrolMu } = await import('../src/cekirdek/kurallar.js');
  const { KONTROL_LISTELERI } = await import('../src/cekirdek/kontrol-listeleri.js');
  assert.equal(varsayilanHedef('kirmizi', true, '2026-11-24', true), '2026-11-24', 'emniyet: aynı gün');
  for (const [tip, l] of Object.entries(KONTROL_LISTELERI)) {
    assert.ok(l.some((m) => m.emniyet), `${tip}: en az bir emniyet maddesi`);
    assert.ok(l.filter((m) => m.emniyet).every((m) => m.renk === 'kirmizi'), `${tip}: emniyet maddesi kırmızı`);
  }
  assert.equal(hizliKontrolMu({ baslangic: 0, bitis: 29_000 }, 5), true, '5 madde 29 sn');
  assert.equal(hizliKontrolMu({ baslangic: 0, bitis: 30_000 }, 5), false);
});

test('V3 bakım tablosu: takvim gecikmesi, öneriye göre, yaklaşan; sıralama', async () => {
  const { bakimTablosu } = await import('../src/cekirdek/bakim.js');
  const e = (kod, tip, sonBakim, sonrakiPlan, gecikmede = false, gecikmeGun = 0) => ({ kod, ad: kod, tip, tipAd: tip, bakim: { sonBakim, sonrakiPlan, gecikmede, gecikmeGun, bakimdanBeriSaat: 100, periyotSaat: 450 } });
  const oneriler = [{ tip: 'forklift', mevcut_gun: 30, onerilen_gun: 12.1, sinirda: false, sayac: { onerilen_saat: 177.4 } },
    { tip: 'strec', mevcut_gun: 60, onerilen_gun: 180, sinirda: true }];
  const t = bakimTablosu([
    e('FL-01', 'forklift', '2026-11-20', '2026-12-20'),          // 6 gün: normal
    e('FL-02', 'forklift', '2026-11-05', '2026-12-05'),          // 21 gün > 12: öneriye göre
    e('FL-03', 'forklift', '2026-10-20', '2026-11-19', true, 7), // takvim gecikti
    e('ST-01', 'strec', '2026-10-01', '2026-11-28'),             // 2 gün kaldı; öneri "uzat" uyarı üretmez
  ], oneriler, '2026-11-26');
  assert.deepEqual(t.satirlar.map((x) => [x.kod, x.durum]), [['FL-03', 'gecikti'], ['FL-02', 'oneriye_gore'], ['ST-01', 'yaklasiyor'], ['FL-01', 'normal']]);
  assert.deepEqual(t.sayilar, { gecikti: 1, oneriyeGore: 1, yaklasiyor: 1 });
  assert.equal(t.satirlar.find((x) => x.kod === 'FL-02').onerilenSaat, 177);
  assert.equal(bakimTablosu([e('FL-02', 'forklift', '2026-11-05', '2026-12-05')], null, '2026-11-26').satirlar[0].durum, 'normal', 'analiz yoksa yalnız takvim');
});

test('V3 olgunluk: adımlar sırayla, veri azsa durur, 5-7 ölçülmüyor', async () => {
  const { olgunluk } = await import('../src/cekirdek/olgunluk.js');
  const { anMs, gunEkle } = await import('../src/cekirdek/zaman.js');
  const bugun = '2026-11-26';
  const ekipmanlar = [{ kod: 'FL-01', tip: 'forklift' }];
  const tipler = { forklift: { ad: 'Forklift', vardiyalar: [1, 2, 3] } };
  const kontroller = [];
  for (let i = 0; i < 30; i++) for (const v of [1, 2, 3]) {
    const g = gunEkle(bugun, -i); const bas = anMs(g, v === 3 ? 0 : v === 1 ? 8 : 16, 10);
    if (bas > anMs(bugun, 12)) continue;
    kontroller.push({ ekipman: 'FL-01', gun: g, vardiya: v, baslangic: bas, bitis: bas + 90_000 });
  }
  const beyaz = Array.from({ length: 6 }, (_, i) => ({ ekipman: 'FL-01', renk: 'beyaz', durum: 'kapali', hedef: gunEkle(bugun, -i), kapanis: anMs(gunEkle(bugun, -i - 1), 10) }));
  const kirmizi = Array.from({ length: 5 }, (_, i) => ({ ekipman: 'FL-01', renk: 'kirmizi', durum: 'kapali', kontrol: i < 2 ? 'K-1' : null }));
  const o = olgunluk({ kontroller, etiketler: [...beyaz, ...kirmizi], ekipmanlar, tipler, bugun, simdi: anMs(bugun, 12) })[0];
  assert.deepEqual(o.adimlar.map((a) => a.durum), ['gecti', 'gecti', 'gecti', 'devam', 'olculmuyor', 'olculmuyor', 'olculmuyor']);
  assert.equal(o.mevcutAdim, 4);
  assert.match(o.adimlar[3].kanit, /Vardiya kontrolünde bulunan kırmızı etiket: %40/);
  // 10'dan az kontrol: veri az
  const az = olgunluk({ kontroller: kontroller.slice(0, 5), etiketler: [], ekipmanlar, tipler, bugun, simdi: anMs(bugun, 12) })[0];
  assert.deepEqual(az.adimlar.slice(0, 3).map((a) => a.durum), ['veri_az', 'bekliyor', 'bekliyor']);
});
