// Giden kutusu (Arıza Defteri'ne gönderimler): başarı, geçici hata (yeniden dene), kalıcı hata, sıra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.js';
import { DisServisHatasi, gidenIsleyici } from '../server/entegrasyon.js';

const depo = () => openStore(join(mkdtempSync(join(tmpdir(), 'nabiz-')), 't.db'));
const etiket = (s) => s.etiketEkle('ana', { ekipman: 'RT-03', renk: 'kirmizi', aciklama: 'yağ', kisi: 'K-O01', olusturma: 1, durus: true });

test('başarılı gönderim: arıza kimliği etikete yazılır, kapatma açılıştan sonra gider', async () => {
  const s = depo();
  const id = etiket(s);
  const an = 1000;
  const cagrilar = [];
  const ariza = { bildir: async () => { cagrilar.push('bildir'); return { id: 'G-1' }; }, kapat: async (aid) => { cagrilar.push(`kapat:${aid}`); return { id: aid, sure_dk: 5 }; } };
  s.gidenEkle('ana', { etiket: id, hedef: 'ariza_bildir', govde: {} }, an);
  s.gidenEkle('ana', { etiket: id, hedef: 'ariza_kapat', govde: {} }, an);
  await gidenIsleyici({ store: s, ariza, simdi: () => an }).isle();
  assert.deepEqual(cagrilar, ['bildir', 'kapat:G-1']);
  assert.equal(s.etiketBul('ana', id).arizaId, 'G-1');
  assert.ok(s.gidenler('ana', id).every((g) => g.durum === 'gonderildi'));
});

test('geçici hata yeniden denenir; kalıcı hata hemen "hata" olur; ziyaretçi alanı hiç gönderilmez', async () => {
  const s = depo();
  const id = etiket(s);
  const id2 = etiket(s);
  s.etiketBaglanti('ana', id2, { arizaId: 'G-7' });
  let an = 0;
  let deneme = 0;
  const ariza = {
    bildir: async () => { if (++deneme < 3) throw new DisServisHatasi('ulaşılamadı'); return { id: 'G-2' }; },
    kapat: async () => { throw new DisServisHatasi('Arıza Defteri: kayıt zaten kapalı', { kalici: true }); },
  };
  s.gidenEkle('ana', { etiket: id, hedef: 'ariza_bildir', govde: {} }, an);
  s.gidenEkle('ana', { etiket: id2, hedef: 'ariza_kapat', govde: {} }, an);
  const kum = s.kumOlustur('ip', 0);
  const zid = s.etiketEkle(kum, { ekipman: 'FL-01', renk: 'kirmizi', aciklama: 'x', kisi: 'K-O01', olusturma: 1 });
  s.gidenEkle(kum, { etiket: zid, hedef: 'ariza_bildir', govde: {}, durum: 'benzetim' }, an);
  const g = gidenIsleyici({ store: s, ariza, simdi: () => an });
  await g.isle();
  assert.equal(s.gidenler('ana', id)[0].durum, 'bekliyor'); // 1. deneme başarısız, 1 dk sonra
  const k = s.gidenler('ana', id2)[0];
  assert.equal(k.durum, 'hata');
  assert.match(k.son_hata, /zaten kapalı/);
  await g.isle(); // zamanı gelmedi
  assert.equal(deneme, 1);
  an += 61_000; await g.isle();
  an += 5 * 61_000; await g.isle();
  assert.equal(s.gidenler('ana', id)[0].durum, 'gonderildi');
  assert.equal(deneme, 3);
  assert.equal(s.gidenler(kum, zid)[0].durum, 'benzetim');
});
