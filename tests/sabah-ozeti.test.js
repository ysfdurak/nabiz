// Şefin sabah özeti: metin kuralları (saf) ve zamanlayıcı (saat, günde bir kez, gönderim biçimi, hata).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sabahOzeti } from '../src/cekirdek/sabah-ozeti.js';
import { sabahZamanlayici } from '../server/bildirim.js';
import { openStore } from '../server/store.js';
import { anMs } from '../src/cekirdek/zaman.js';

const et = (ekipman, hedef, g = {}) => ({ ekipman, aciklama: 'yağ kaçağı', hedef, gecikmeGun: 2, sorumluAd: 'Murat Kaya', durus: false, ...g });

test('sabah özeti: sorun yoksa gönderilmez; varsa en eski gecikme üstte, en çok 5 satır, kişi özeti', () => {
  const bos = sabahOzeti({ gecikenler: [], sorumsuzKirmizilar: [], sorumluYuku: [] }, { bugun: '2026-11-25' });
  assert.equal(bos.gonderilecek, false);
  const gecikenler = [et('SR-01', '2026-11-23'), et('FL-03', '2026-11-19', { sorumluAd: null, gecikmeGun: 6 }), ...['A', 'B', 'C', 'D'].map((x) => et(`RT-0${x}`, '2026-11-24'))];
  const o = sabahOzeti({ gecikenler, sorumsuzKirmizilar: [et('KV-01', '2026-11-27')], sorumluYuku: [{ ad: 'Murat Kaya', geciken: 5 }] },
    { bugun: '2026-11-25', uygulamaUrl: 'https://nabiz.ornek.test/' });
  assert.equal(o.gonderilecek, true);
  assert.equal(o.baslik, '25.11 sabah özeti: 6 geciken');
  const satir = o.metin.split('\n');
  assert.match(satir[1], /^• FL-03 .* sorumlu yok · 6 gün$/, 'en eski gecikme ilk');
  assert.ok(o.metin.includes('… ve 1 etiket daha'));
  assert.ok(o.metin.includes('1 kırmızı etiketin sorumlusu yok: KV-01'));
  assert.ok(o.metin.includes('Gecikme kimde: Murat Kaya (5)'));
  assert.equal(o.baglanti, 'https://nabiz.ornek.test/#/etiketler?durum=acik&ek=geciken');
  assert.equal(o.oncelik, 'default');
  assert.equal(sabahOzeti({ gecikenler: [et('RT-03', '2026-11-24', { durus: true })], sorumsuzKirmizilar: [], sorumluYuku: [] }, { bugun: '2026-11-25' }).oncelik, 'high', 'duran ekipman gecikmişse acil');
});

test('zamanlayıcı: saatten önce gitmez, günde bir kez gider, başlıklar ASCII, hata uygulamayı durdurmaz', async () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'nabiz-sabah-')), 's.db'));
  const istekler = [];
  let ozet = { gonderilecek: true, baslik: '25.11 sabah özeti: 1 geciken', metin: '1 geciken etiket:\n• SR-01 …', oncelik: 'high', baglanti: 'https://n/#/etiketler' };
  const servis = { sabahOzeti: (kum) => { assert.equal(kum, 'ana', 'yalnız kurum alanı'); return ozet; } };
  const f = async (url, o) => { istekler.push({ url, ...o }); return { ok: true }; };
  const z = sabahZamanlayici({ servis, store, url: 'https://ntfy.sh/gizli', saat: '07:30', fetch: f });
  assert.equal(await z.kontrol(anMs('2026-11-25', 7, 29)), null, 'saatten önce');
  assert.ok(await z.kontrol(anMs('2026-11-25', 7, 35)));
  assert.equal(await z.kontrol(anMs('2026-11-25', 12, 0)), null, 'aynı gün ikinci kez yok');
  assert.equal(istekler.length, 1);
  const i = istekler[0];
  assert.equal(i.method, 'POST');
  assert.equal(i.headers.Priority, 'high');
  assert.equal(i.headers.Click, 'https://n/#/etiketler');
  for (const v of Object.values(i.headers)) assert.match(v, /^[\x20-\x7e]*$/, `başlık ASCII olmalı: ${v}`);
  assert.ok(i.body.startsWith('25.11 sabah özeti'));
  // Ertesi gün: sorun yoksa istek yok; sonraki gün ağ hatası fırlatılmaz
  ozet = { ...ozet, gonderilecek: false };
  assert.ok(await z.kontrol(anMs('2026-11-26', 8, 0)));
  assert.equal(istekler.length, 1);
  ozet = { ...ozet, gonderilecek: true };
  const kayit = [];
  const z2 = sabahZamanlayici({ servis, store, url: 'https://ntfy.sh/gizli', saat: '07:30', log: (m) => kayit.push(m), fetch: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); } });
  await z2.kontrol(anMs('2026-11-27', 7, 31));
  assert.ok(kayit.some((m) => /gönderilemedi \(TimeoutError\)/.test(m)));
  // Adres yoksa yalnız kayıt
  const z3 = sabahZamanlayici({ servis, store, url: null, saat: '07:30', fetch: () => assert.fail('istek atılmamalı') });
  assert.ok(await z3.kontrol(anMs('2026-11-28', 9, 0)));
});

test('ayarlar: BILDIRIM_URL yalnız https, saat SS:DD', async () => {
  const { loadConfig } = await import('../server/config.js');
  const hata = (env) => loadConfig({ DATA_DIR: tmpdir(), ...env }).errors.join(' ');
  assert.match(hata({ BILDIRIM_URL: 'http://ntfy.sh/x' }), /BILDIRIM_URL/);
  assert.match(hata({ SABAH_OZETI_SAATI: '7:30' }), /SABAH_OZETI_SAATI/);
  assert.match(hata({ SABAH_OZETI_SAATI: '24:00' }), /SABAH_OZETI_SAATI/);
  const c = loadConfig({ DATA_DIR: tmpdir(), BILDIRIM_URL: 'https://ntfy.sh/nabiz-abc' });
  assert.deepEqual([c.errors, c.bildirimUrl, c.sabahSaati], [[], 'https://ntfy.sh/nabiz-abc', '07:30']);
});
