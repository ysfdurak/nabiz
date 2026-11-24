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
