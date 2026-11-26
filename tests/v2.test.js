// V2: OEE hesabı, A3 taslağı, duruş kaydı, kayıp ve güvenilirlik uçları (dış servisler dosyadan taklit edilir).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oeeTopla, oeeRaporu } from '../src/cekirdek/oee.js';
import { a3Taslagi, aralikCumlesi } from '../src/cekirdek/a3.js';
import { loadConfig, kok } from '../server/config.js';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { anaVeriKaynagi } from '../server/ana-veri.js';
import { DisServisHatasi, gidenIsleyici } from '../server/entegrasyon.js';
import ana from '../veri/ana-veriler.json' with { type: 'json' };

const oku = (ad) => JSON.parse(readFileSync(new URL(`./veri/${ad}`, import.meta.url)));
const URETIM = oku('uretim-14.json'), OZET = oku('ozet-30.json'), RTHID = oku('arizalar-RT-HID-180.json'), BULGU = oku('bulgular-180.json'), GUV = oku('guvenilirlik.json');
const SIMDI = Date.parse(readFileSync(new URL('./veri/zaman.txt', import.meta.url), 'utf8').trim());

test('OEE: elle hesaplananla aynı; toplarken oranların ortalaması değil, süre ve adet toplamı', () => {
  const tipler = { forklift: { idealHiz: 30 } }; // çevrim 2 dk
  const a = { planli_dk: 480, durus_dk: 80, uretilen: 160, hatali: 4, tip: 'forklift' }; // çalışma 400, ideal 320
  const o = oeeTopla([a], tipler);
  assert.equal(o.kullanilabilirlik, Math.round((400 / 480) * 1000) / 1000);
  assert.equal(o.performans, 0.8);
  assert.equal(o.kalite, Math.round((156 / 160) * 1000) / 1000);
  assert.equal(o.oee, Math.round(((156 * 2) / 480) * 1000) / 1000);
  assert.deepEqual(o.kayipDk, { durus: 80, hiz: 80, kalite: 8, deger: 312 });
  const b = { planli_dk: 120, durus_dk: 0, uretilen: 60, hatali: 0, tip: 'forklift' }; // kısa ve kusursuz vardiya
  const t = oeeTopla([a, b], tipler);
  assert.equal(t.oee, Math.round(((156 + 60) * 2 / 600) * 1000) / 1000, 'süreyle ağırlıklı');
  assert.notEqual(t.oee, Math.round(((o.oee + 1) / 2) * 1000) / 1000, 'basit ortalama değil');
});

test('OEE raporu gerçek veriyle tutarlı: her bileşen 0-1, OEE = A × P × K (yuvarlama payıyla)', () => {
  const r = oeeRaporu(URETIM.satirlar, URETIM.tipler, ana.ekipmanlar);
  for (const x of [r.depo, ...r.ekipman, ...r.tip, ...r.gun]) {
    for (const k of ['kullanilabilirlik', 'performans', 'kalite', 'oee']) assert.ok(x[k] >= 0 && x[k] <= 1, k);
    assert.ok(Math.abs(x.oee - x.kullanilabilirlik * x.performans * x.kalite) < 0.004);
  }
  assert.equal(r.ekipman.length, 18);
  assert.ok(r.ekipman[0].oee <= r.ekipman.at(-1).oee, 'en düşükten');
  assert.ok(r.depo.oee > 0.5 && r.depo.oee < 0.9, `depo OEE ${r.depo.oee}`);
});

test('A3 taslağı: 7 bölüm; aşınma ve tekrarlayan gün karşı önlem olarak gelir', () => {
  const tur = ana.arizaTurleri.find((t) => t.kod === 'RT-HID');
  const a = a3Taslagi({
    tur: 'RT-HID', turBilgi: { ...tur, tipAd: 'Reach truck' }, kayitlar: RTHID.kayitlar, pareto: OZET.pareto,
    guvenilirlik: GUV.turler.find((t) => t.tur === 'RT-HID'), aralik: GUV.tipler.find((t) => t.tip === 'reach_truck'), bulgular: BULGU.bulgular, donemGun: 90,
  });
  assert.deepEqual(a.bolumler.map((b) => b.ad), ['Konu', 'Arka plan', 'Mevcut durum', 'Analiz', 'Hedef', 'Karşı önlemler', 'Takip']);
  const onlem = a.bolumler[5].metin.join(' ');
  // RT-HID'nin çoğu RT-03'ün cuma arızası: zamandan bağımsız, analiz "rastgele" der. Önlem bakım aralığı değil, kök neden.
  assert.match(onlem, /Rastgele/);
  assert.match(onlem, /Tekrarlayan gün/);
  assert.match(a.bolumler[2].metin.join(' '), /Gün: Cuma/);
  // Aşınan tür (SR-TRY): öneri yönüne göre cümle
  const sr = ana.arizaTurleri.find((t) => t.kod === 'SR-TRY');
  const b = a3Taslagi({ tur: 'SR-TRY', turBilgi: { ...sr, tipAd: 'Sorter' }, kayitlar: [], pareto: [], guvenilirlik: GUV.turler.find((t) => t.tur === 'SR-TRY'),
    aralik: GUV.tipler.find((t) => t.tip === 'sorter'), bulgular: [], donemGun: 180 });
  assert.match(b.bolumler[5].metin.join(' '), /Aşınma.*kısaltılması değerlendirilmeli \(30 → \d+ gün\)/);
  const uzun = aralikCumlesi('Forklift', { mevcut_gun: 30, onerilen_gun: 75, sinirda: false });
  assert.match(uzun, /yeterli.*75 güne uzatmayı.*emniyet muayenesi/);
  assert.match(aralikCumlesi('Forklift', { mevcut_gun: 30, onerilen_gun: 31 }), /uygun/);
  const bos = a3Taslagi({ tur: 'RT-HID', turBilgi: tur, kayitlar: [], pareto: [], guvenilirlik: null, aralik: null, bulgular: [], donemGun: 90 });
  assert.match(bos.bolumler[5].metin[0], /Güvenilirlik analizi yok/);
});

async function kur({ analizAcik = true, arizaAcik = true } = {}) {
  const config = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'nabiz-v2-')), APP_URL: 'https://nabiz.ornek.test/' });
  const store = openStore(join(config.dataDir, 'n.db'));
  const ariza = arizaAcik ? {
    acik: true, yazabilir: false,
    arizalar: async () => ({ kayitlar: [] }), uretim: async () => URETIM, ozet: async () => OZET,
    turKayitlari: async () => RTHID, bulgular: async () => BULGU,
  } : { acik: false, yazabilir: false };
  const analiz = analizAcik ? { acik: true, guvenilirlik: async () => GUV } : { acik: true, guvenilirlik: async () => { throw new DisServisHatasi("Nabız Analiz'e ulaşılamadı (bağlantı)."); } };
  const a = anaVeriKaynagi({ store, ariza: { acik: false }, kok });
  const app = createApp({ config, store, ana: a.al, ariza, analiz, simdi: () => SIMDI });
  const server = createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const kok2 = `http://127.0.0.1:${server.address().port}`;
  let cerez = '';
  const iste = async (yol, govde) => {
    const r = await fetch(kok2 + yol, { method: govde ? 'POST' : 'GET', headers: { ...(cerez ? { cookie: cerez } : {}), ...(govde ? { 'content-type': 'application/json' } : {}) }, body: govde ? JSON.stringify(govde) : undefined });
    const c = r.headers.getSetCookie()[0];
    if (c) cerez = c.split(';')[0];
    return { durum: r.status, govde: await r.json() };
  };
  await iste('/v1/baslangic');
  return { iste, store, kapat: () => new Promise((r) => server.close(r)) };
}

test('kayıp, güvenilirlik ve A3 uçları; analiz servisi yoksa 503 ama A3 yine çıkar', async () => {
  const { iste, kapat } = await kur();
  try {
    const k = await iste('/v1/kayip?gun=30');
    assert.equal(k.durum, 200);
    assert.ok(k.govde.oee.depo.oee > 0 && k.govde.kayiplar.length === 6 && k.govde.pareto.length === 10);
    const g = await iste('/v1/guvenilirlik');
    assert.equal(g.durum, 200);
    assert.ok(g.govde.turler.some((t) => t.tur === 'RT-MAS' && t.sinif === 'asinma'));
    assert.equal((await iste('/v1/a3/RT-HID')).govde.bolumler.length, 7);
    assert.equal((await iste('/v1/a3/XX-YYY')).durum, 404);
  } finally { await kapat(); }
  const b = await kur({ analizAcik: false });
  try {
    const g = await b.iste('/v1/guvenilirlik');
    assert.equal(g.durum, 503);
    assert.match(g.govde.hata, /Nabız Analiz/);
    const a3 = await b.iste('/v1/a3/RT-HID');
    assert.equal(a3.durum, 200);
    assert.match(a3.govde.bolumler[3].metin[0], /alınamadı/);
  } finally { await b.kapat(); }
  const c = await kur({ arizaAcik: false });
  try {
    assert.equal((await c.iste('/v1/kayip')).durum, 503);
  } finally { await c.kapat(); }
});

test('duruş kaydı: süreli kayıt iki gönderim; devam eden kayıt sonra bitirilir; hatalı girdi 400', async () => {
  const { iste, kapat } = await kur();
  try {
    assert.equal((await iste('/v1/durus', { ekipman: 'KV-02', tur: 'FL-HID', kisi: 'K-O01', sureDk: 10 })).durum, 400, 'tür tipe ait değil');
    assert.equal((await iste('/v1/durus', { ekipman: 'KV-02', tur: 'KV-BNT', kisi: 'K-O01', sureDk: 0 })).durum, 400);
    assert.equal((await iste('/v1/durus', { ekipman: 'KV-02', tur: 'KV-BNT', kisi: 'K-O01', sureDk: 2.5 })).durum, 400);
    const d = await iste('/v1/durus', { ekipman: 'KV-02', tur: 'KV-HIZ', kisi: 'K-O06', sureDk: 25, aciklama: 'Hat yavaşladı' });
    assert.equal(d.durum, 201);
    assert.equal(d.govde.sureDk, 25);
    assert.deepEqual(d.govde.gonderimler.map((g) => [g.hedef, g.durum]), [['ariza_bildir', 'benzetim'], ['ariza_kapat', 'benzetim']]);
    assert.equal(d.govde.gonderimler[0].govde.tur, 'KV-HIZ');
    const s = await iste('/v1/durus', { ekipman: 'SR-01', tur: 'SR-SIK', kisi: 'K-O01', devam: true });
    assert.equal(s.govde.bitis, null);
    assert.equal(s.govde.gonderimler.length, 1);
    const b = await iste(`/v1/durus/${s.govde.id}/bitir`, { kisi: 'K-O01', not: 'Sıkışma giderildi' });
    assert.equal(b.durum, 200);
    assert.ok(b.govde.bitis);
    assert.equal(b.govde.gonderimler.at(-1).hedef, 'ariza_kapat');
    assert.equal((await iste(`/v1/durus/${s.govde.id}/bitir`, { kisi: 'K-O01', not: 'x' })).durum, 409);
    const kart = await iste('/v1/ekipman/SR-01');
    assert.equal(kart.govde.duruslar[0].id, s.govde.id);
  } finally { await kapat(); }
});

test('giden kutusu: duruşun arıza kimliği duruşa yazılır, kapatma onu kullanır', async () => {
  const s = openStore(join(mkdtempSync(join(tmpdir(), 'nabiz-g-')), 't.db'));
  const id = s.durusEkle('ana', { ekipman: 'KV-02', tur: 'KV-HIZ', kayip: 'hiz', kisi: 'K-O06', baslangic: 1, bitis: 2, olusturma: 1 });
  s.gidenEkle('ana', { durus: id, hedef: 'ariza_bildir', govde: {} }, 0);
  s.gidenEkle('ana', { durus: id, hedef: 'ariza_kapat', govde: {} }, 0);
  const kapatilan = [];
  const ariza = { bildir: async () => ({ id: 'G-20261124-aaaaaaaa' }), kapat: async (aid) => { kapatilan.push(aid); return { id: aid }; } };
  await gidenIsleyici({ store: s, ariza, simdi: () => 0 }).isle();
  assert.equal(s.durusBul('ana', id).ariza_id, 'G-20261124-aaaaaaaa');
  assert.deepEqual(kapatilan, ['G-20261124-aaaaaaaa']);
});

test('V3 bakım ucu: takvim + sayaç + öneri; analiz yoksa yalnız takvim; Arıza Defteri yoksa 503; sabah özetinde geciken bakım', async () => {
  const { iste, kapat } = await kur();
  try {
    const b = await iste('/v1/bakim');
    assert.equal(b.durum, 200);
    assert.equal(b.govde.oneriVar, true);
    assert.equal(b.govde.satirlar.length, 18);
    const sira = { gecikti: 0, oneriye_gore: 1, yaklasiyor: 2, normal: 3 };
    for (let i = 1; i < b.govde.satirlar.length; i++) assert.ok(sira[b.govde.satirlar[i - 1].durum] <= sira[b.govde.satirlar[i].durum], 'durum sırası');
    const fl = b.govde.satirlar.find((x) => x.tip === 'forklift');
    assert.ok(fl.bakimdanBeriSaat != null && fl.periyotSaat > 300, 'sayaç Arıza Defteri\'nden (surum 4)');
    assert.equal(fl.onerilenGun, null, 'gerçek sıklıkta (surum 6) forklift önerisi uzatma yönünde: uyarı değil');
    const sr = b.govde.satirlar.find((x) => x.tip === 'sorter');
    assert.ok(sr.onerilenGun > 0 && sr.onerilenGun < 30, 'sorter için kısalt önerisi (SR-TRY aşınıyor)');
    const so = await iste('/v1/sabah-ozeti');
    const gec = b.govde.satirlar.filter((x) => x.durum === 'gecikti');
    if (gec.length) assert.ok(so.govde.metin.includes(`${gec.length} planlı bakım gecikti`));
    const ol = await iste('/v1/olgunluk');
    assert.equal(ol.govde.tipler.length, 5);
  } finally { await kapat(); }
  const yok = await kur({ analizAcik: false });
  try {
    const b = await yok.iste('/v1/bakim');
    assert.equal(b.durum, 200);
    assert.equal(b.govde.oneriVar, false);
    assert.ok(b.govde.satirlar.every((x) => x.onerilenGun == null && x.durum !== 'oneriye_gore'));
  } finally { await yok.kapat(); }
  const kapali = await kur({ arizaAcik: false });
  try {
    assert.equal((await kapali.iste('/v1/bakim')).durum, 503);
    assert.equal((await kapali.iste('/v1/sabah-ozeti')).durum, 200, 'sabah özeti Arıza Defteri olmadan da çıkar');
  } finally { await kapali.kapat(); }
});
