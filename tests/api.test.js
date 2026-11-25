// HTTP: deneme alanı, yalıtım, kontrol ve etiket akışı, yetki, fotoğraf denetimi, sınırlar, kurum girişi, MCP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, kok } from '../server/config.js';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { anaVeriKaynagi } from '../server/ana-veri.js';
import { arizaDefteriIstemcisi } from '../server/entegrasyon.js';
import { ornekGecmis } from '../src/cekirdek/ornek.js';
import { anMs } from '../src/cekirdek/zaman.js';

const SIMDI = anMs('2026-11-24', 10, 30);
const SIFRE = 'kurum-sifresi-uzun-1';
const MCP = 'm'.repeat(40);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);

async function kur(ek = {}) {
  const config = loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), 'nabiz-api-')), APP_URL: 'https://nabiz.ornek.test/', SITE_SIFRESI: SIFRE, MCP_ENABLED: 'true', MCP_ANAHTARLARI: MCP, ...ek });
  assert.deepEqual(config.errors, []);
  const store = openStore(join(config.dataDir, 'n.db'));
  const ariza = arizaDefteriIstemcisi({});
  const ana = anaVeriKaynagi({ store, ariza, kok });
  const app = createApp({ config, store, ana: ana.al, ariza, simdi: () => SIMDI });
  app.ornekKaynagi(() => ornekGecmis(ana.al(), SIMDI));
  const server = createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const adres = `http://127.0.0.1:${server.address().port}`;
  /** Basit tarayıcı: çerezleri saklar. */
  const tarayici = () => {
    const cerez = new Map();
    return async (yol, o = {}) => {
      const headers = { ...(o.headers || {}) };
      if (cerez.size) headers.cookie = [...cerez].map(([k, v]) => `${k}=${v}`).join('; ');
      if (o.json) { headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.json); }
      const r = await fetch(adres + yol, { method: o.method || (o.body ? 'POST' : 'GET'), headers, body: o.body });
      for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) cerez.set(k, v); else cerez.delete(k); }
      const tur = r.headers.get('content-type') || '';
      return { durum: r.status, basliklar: r.headers, govde: tur.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), cerez };
    };
  };
  return { tarayici, store, kapat: () => new Promise((r) => server.close(r)) };
}

test('deneme alanı: ilk istekte açılır, örnek geçmişle dolar, çerez güvenli; ziyaretçiler birbirini görmez', async () => {
  const { tarayici, kapat } = await kur();
  try {
    const a = tarayici(), b = tarayici();
    const s = await a('/v1/baslangic');
    assert.equal(s.durum, 200);
    assert.equal(s.govde.demo, true);
    assert.match(s.basliklar.getSetCookie()[0], /nabiz_alan=[A-Za-z0-9_-]{24}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
    for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy']) assert.ok(s.basliklar.get(h), h);
    const o = await a('/v1/ozet');
    assert.ok(o.govde.uyum.beklenen > 0, 'örnek geçmiş yüklenmeli');
    const e = await a('/v1/etiket', { json: { ekipman: 'FL-01', renk: 'beyaz', aciklama: 'akü kablosu', kisi: 'K-O01' } });
    assert.equal(e.durum, 201);
    await b('/v1/baslangic');
    assert.equal((await b(`/v1/etiket/${e.govde.id}`)).durum, 404, 'başka ziyaretçinin etiketi görünmez');
    assert.equal((await tarayici()('/v1/ekipman')).durum, 401, 'alansız istek reddedilir');
  } finally { await kapat(); }
});

test('kontrol: eksik madde 400, bilinmeyen kişi 400; sorunlu madde etiket önerisi döner', async () => {
  const { tarayici, kapat } = await kur();
  try {
    const a = tarayici();
    await a('/v1/baslangic');
    const liste = (await a('/v1/ekipman/RT-03')).govde.kontrolListesi;
    const sonuc = liste.map((m) => ({ madde: m.kod, durum: m.kod === 'hidrolik' ? 'nok' : 'ok' }));
    assert.equal((await a('/v1/kontrol', { json: { ekipman: 'RT-03', kisi: 'K-O01', sonuc: sonuc.slice(1) } })).durum, 400);
    assert.equal((await a('/v1/kontrol', { json: { ekipman: 'RT-03', kisi: 'K-YOK', sonuc } })).durum, 400);
    assert.equal((await a('/v1/kontrol', { json: { ekipman: 'XX-99', kisi: 'K-O01', sonuc } })).durum, 404);
    const k = await a('/v1/kontrol', { json: { ekipman: 'RT-03', kisi: 'K-O01', sonuc } });
    assert.equal(k.durum, 201);
    assert.deepEqual(k.govde.sorunlu.map((m) => [m.kod, m.renk, m.tur]), [['hidrolik', 'kirmizi', 'RT-HID']]);
    const kart = await a('/v1/ekipman/RT-03');
    assert.equal(kart.govde.buVardiya.id, k.govde.kontrol.id);
  } finally { await kapat(); }
});

test('kırmızı etiket: benzetim gönderimleri; operatör kapatamaz, teknisyen kapatır; ikinci kapatma 409', async () => {
  const { tarayici, kapat } = await kur();
  try {
    const a = tarayici();
    await a('/v1/baslangic');
    assert.equal((await a('/v1/etiket', { json: { ekipman: 'RT-03', renk: 'beyaz', aciklama: 'x', kisi: 'K-O01', durus: true, tur: 'RT-HID' } })).durum, 400, 'duran ekipman beyazla bildirilmez');
    assert.equal((await a('/v1/etiket', { json: { ekipman: 'RT-03', renk: 'kirmizi', aciklama: 'x', kisi: 'K-O01', durus: true } })).durum, 400, 'tür gerekli');
    assert.equal((await a('/v1/etiket', { json: { ekipman: 'RT-03', renk: 'kirmizi', aciklama: 'x', kisi: 'K-O01', tur: 'FL-HID' } })).durum, 400, 'tür ekipmana ait değil');
    const e = await a('/v1/etiket', { json: { ekipman: 'RT-03', renk: 'kirmizi', madde: 'hidrolik', aciklama: 'Direkte yağ', kisi: 'K-O01', durus: true } });
    assert.equal(e.durum, 201);
    assert.deepEqual(e.govde.gonderimler.map((g) => [g.hedef, g.durum]), [['ariza_bildir', 'benzetim']], 'yalnız Arıza Defteri; Pusula\'ya gitmez');
    assert.equal(e.govde.gonderimler[0].govde.tur, 'RT-HID');
    assert.equal(e.govde.hedef, '2026-11-25', 'ekipmanı durduran kırmızı: ertesi gün');
    assert.equal(e.govde.sorumlu, null, 'kırmızı etiketin sorumlusu sonra atanır');
    const k1 = await a(`/v1/etiket/${e.govde.id}/kapat`, { json: { kisi: 'K-O01', not: 'x' } });
    assert.equal(k1.durum, 403);
    const k2 = await a(`/v1/etiket/${e.govde.id}/kapat`, { json: { kisi: 'K-SAYDIN', not: 'Conta değişti' } });
    assert.equal(k2.durum, 200);
    assert.equal(k2.govde.durum, 'kapali');
    assert.deepEqual(k2.govde.gonderimler.map((g) => g.hedef), ['ariza_bildir', 'ariza_kapat']);
    assert.equal((await a(`/v1/etiket/${e.govde.id}/kapat`, { json: { kisi: 'K-SAYDIN', not: 'tekrar' } })).durum, 409);
    const beyaz = await a('/v1/etiket', { json: { ekipman: 'FL-01', renk: 'beyaz', aciklama: 'soket gevşek', kisi: 'K-O02' } });
    assert.equal(beyaz.govde.gonderimler.length, 0, 'beyaz etiket hiçbir yere gitmez');
    assert.equal(beyaz.govde.sorumlu, 'K-O02', 'beyazın sorumlusu açan operatör');
    assert.equal(beyaz.govde.hedef, '2026-12-01', 'beyaz: 7 gün');
    assert.equal((await a(`/v1/etiket/${beyaz.govde.id}/kapat`, { json: { kisi: 'K-O02', not: 'sıkıldı' } })).durum, 200, 'operatör beyazı kapatır');
  } finally { await kapat(); }
});

test('sorumlu ve hedef tarih: kurallar, atama yetkisi, gecikme, filtreler ve özet', async () => {
  const { tarayici, kapat } = await kur();
  try {
    const a = tarayici();
    await a('/v1/baslangic');
    const ac = (g) => a('/v1/etiket', { json: { ekipman: 'SR-01', renk: 'kirmizi', aciklama: 'klape geç açılıyor', kisi: 'K-O01', ...g } });
    assert.equal((await ac({ sorumlu: 'K-O02' })).durum, 400, 'kırmızının sorumlusu teknisyen olmalı');
    assert.equal((await ac({ sorumlu: 'K-AKOC' })).durum, 400, 'şef sorumlu yapılmaz');
    assert.equal((await ac({ hedefTarih: '2026-11-23' })).durum, 400, 'geçmiş tarih olmaz');
    assert.equal((await ac({ hedefTarih: '2027-11-24' })).durum, 400, 'yanlış yıl yakalanır (en çok 90 gün)');
    assert.equal((await ac({ hedefTarih: '24.11.2026' })).durum, 400);
    const e = await ac({ sorumlu: 'K-MKAYA', hedefTarih: '2026-11-24' });
    assert.equal(e.durum, 201);
    assert.equal(e.govde.sorumluAd, 'Murat Kaya');
    assert.equal(e.govde.gecikti, false, 'hedef günü içinde gecikmiş sayılmaz');
    const varsayilan = await ac({});
    assert.equal(varsayilan.govde.hedef, '2026-11-27', 'kırmızı: 3 gün');
    const yol = `/v1/etiket/${varsayilan.govde.id}/ata`;
    assert.equal((await a(yol, { json: { kisi: 'K-O01', sorumlu: 'K-SAYDIN' } })).durum, 403, 'operatör atayamaz');
    assert.equal((await a(yol, { json: { kisi: 'K-AKOC' } })).durum, 400, 'boş istek');
    const at = await a(yol, { json: { kisi: 'K-AKOC', sorumlu: 'K-SAYDIN', hedefTarih: '2026-11-26' } });
    assert.equal(at.durum, 200);
    assert.deepEqual([at.govde.sorumlu, at.govde.hedef], ['K-SAYDIN', '2026-11-26']);
    const kaldir = await a(yol, { json: { kisi: 'K-SAYDIN', sorumlu: null } });
    assert.deepEqual([kaldir.govde.sorumlu, kaldir.govde.hedef], [null, '2026-11-26'], 'yalnız verilen alan değişir');

    // Gecikme: hedef tarih geçmişe girilemez (kural), bu yüzden ziyaretçi alanına yüklenen 7 günlük örnek geçmişteki
    // açık etiketlere bakılır.
    const tum = await a('/v1/etiket?durum=acik');
    const geciken = await a('/v1/etiket?durum=acik&geciken=1');
    assert.ok(geciken.govde.etiketler.length >= 1, 'örnek veride geciken etiket olmalı (vitrin bunu gösterir)');
    assert.ok(geciken.govde.etiketler.every((x) => x.gecikti && x.gecikmeGun >= 1));
    assert.equal(geciken.govde.etiketler.length, tum.govde.etiketler.filter((x) => x.gecikti).length);
    const benim = await a('/v1/etiket?durum=acik&sorumlu=K-MKAYA');
    assert.ok(benim.govde.etiketler.some((x) => x.id === e.govde.id) && benim.govde.etiketler.every((x) => x.sorumlu === 'K-MKAYA'));
    assert.equal((await a('/v1/etiket?sorumlu=K-YOK')).durum, 400);
    const o = await a('/v1/ozet');
    assert.equal(o.govde.acik.geciken, geciken.govde.etiketler.length);
    assert.equal(o.govde.acik.sorumsuzKirmizi, tum.govde.etiketler.filter((x) => x.renk === 'kirmizi' && !x.sorumlu).length);
    assert.ok(o.govde.sorumluYuku.find((x) => x.kod === 'K-MKAYA').acik >= 1);
    const so = await a('/v1/sabah-ozeti');
    assert.equal(so.govde.gonderilecek, true, 'örnek veride geciken var');
    assert.match(so.govde.baslik, new RegExp(`sabah özeti: ${geciken.govde.etiketler.length} geciken`));
    assert.equal(so.govde.baglanti, 'https://nabiz.ornek.test/#/etiketler?durum=acik&ek=geciken');
    const kapandi = await a(`/v1/etiket/${e.govde.id}/kapat`, { json: { kisi: 'K-MKAYA', not: 'Klape ayarlandı' } });
    assert.equal(kapandi.durum, 200);
    assert.equal((await a(`/v1/etiket/${e.govde.id}/ata`, { json: { kisi: 'K-AKOC', sorumlu: 'K-SAYDIN' } })).durum, 409, 'kapalı etiket atanmaz');
  } finally { await kapat(); }
});

test('fotoğraf: yalnız JPEG, boyut sınırı, başka sitenin isteği 403; okurken sıkı CSP', async () => {
  const { tarayici, kapat } = await kur();
  try {
    const a = tarayici();
    await a('/v1/baslangic');
    const e = await a('/v1/etiket', { json: { ekipman: 'FL-01', renk: 'beyaz', aciklama: 'x', kisi: 'K-O01' } });
    const yol = `/v1/etiket/${e.govde.id}/foto`;
    assert.equal((await a(yol, { body: Buffer.from('<svg onload=alert(1)>'.padEnd(200)), headers: { 'content-type': 'image/jpeg' } })).durum, 415, 'başlık baytları denetlenir');
    assert.equal((await a(yol, { body: JPEG, headers: { 'content-type': 'image/svg+xml' } })).durum, 415);
    assert.equal((await a(yol, { body: Buffer.alloc(1_600_000, 0xff), headers: { 'content-type': 'image/jpeg' } })).durum, 413);
    assert.equal((await a(yol, { body: JPEG, headers: { 'content-type': 'image/jpeg', origin: 'https://kotu.test' } })).durum, 403);
    assert.equal((await a(yol, { body: JPEG, headers: { 'content-type': 'image/jpeg', 'sec-fetch-site': 'cross-site' } })).durum, 403);
    assert.equal((await a(yol, { body: JPEG, headers: { 'content-type': 'image/jpeg', origin: 'https://nabiz.ornek.test' } })).durum, 201);
    const f = await a(yol);
    assert.equal(f.durum, 200);
    assert.equal(f.basliklar.get('content-type'), 'image/jpeg');
    assert.equal(f.basliklar.get('content-security-policy'), "default-src 'none'");
    assert.deepEqual(f.govde, JPEG);
  } finally { await kapat(); }
});

test('sınırlar: IP başına günlük alan, alan başına günlük etiket', async () => {
  const { tarayici, kapat } = await kur({ IP_GUNLUK_ALAN: '2' });
  try {
    assert.equal((await tarayici()('/v1/baslangic')).durum, 200);
    const a = tarayici();
    assert.equal((await a('/v1/baslangic')).durum, 200);
    assert.equal((await tarayici()('/v1/baslangic')).durum, 429);
    const sonuclar = [];
    for (let i = 0; i < 31; i++) sonuclar.push((await a('/v1/etiket', { json: { ekipman: 'FL-01', renk: 'beyaz', aciklama: `e${i}`, kisi: 'K-O01' } })).durum);
    assert.equal(sonuclar.at(-2), 201);
    assert.equal(sonuclar.at(-1), 429);
  } finally { await kapat(); }
});

test('kurum girişi: yanlış şifre 401, 5 denemeden sonra 429; doğru şifre kurum alanını açar (sınırsız, gerçek gönderim kuyruğu)', async () => {
  const { tarayici, kapat } = await kur();
  try {
    const a = tarayici();
    for (let i = 0; i < 4; i++) assert.equal((await a('/v1/giris', { json: { sifre: 'yanlis' } })).durum, 401);
    const g = await a('/v1/giris', { json: { sifre: SIFRE } });
    assert.equal(g.durum, 200);
    assert.match(g.basliklar.getSetCookie()[0], /nabiz_oturum=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure/);
    assert.equal((await a('/v1/giris', { json: { sifre: SIFRE } })).durum, 429, '6. deneme sınırda');
    const s = await a('/v1/baslangic');
    assert.equal(s.govde.demo, false);
    assert.equal(s.govde.sinirlar, null);
    assert.equal((await a('/v1/cikis', { json: {} })).durum, 200);
    assert.equal((await a('/v1/baslangic')).govde.demo, true, 'çıkınca deneme alanına döner');
  } finally { await kapat(); }
});

test('kurum modu: girişsiz hiçbir veri açılmaz; zayıf şifre ayarı reddedilir', async () => {
  assert.ok(loadConfig({ MOD: 'kurum' }).errors.length);
  assert.ok(loadConfig({ MOD: 'kurum', SITE_SIFRESI: 'kisa' }).errors.length);
  const { tarayici, kapat } = await kur({ MOD: 'kurum' });
  try {
    const a = tarayici();
    const s = await a('/v1/baslangic');
    assert.equal(s.durum, 401);
    assert.equal(s.govde.kod, 'giris');
    assert.equal(s.basliklar.getSetCookie().length, 0, 'kurum modunda deneme alanı açılmaz');
  } finally { await kapat(); }
});

test('QR SVG ve MCP (salt okuma, kurum alanı)', async () => {
  const { tarayici, kapat } = await kur();
  try {
    const a = tarayici();
    const q = await a('/v1/qr/RT-03.svg');
    assert.equal(q.durum, 200);
    assert.match(q.govde.toString(), /^<svg/);
    assert.equal((await a('/v1/qr/XX-99.svg')).durum, 404);
    const rpc = (govde, anahtar = MCP) => a('/mcp', { json: govde, headers: { accept: 'application/json, text/event-stream', ...(anahtar ? { authorization: `Bearer ${anahtar}` } : {}) } });
    assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)).durum, 401);
    const l = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepEqual(l.govde.result.tools.map((t) => t.name).sort(), ['a3_taslagi', 'ekipman_durumu', 'ekipman_karti', 'etiket_detayi', 'etiketleri_listele', 'guvenilirlik', 'oee_ve_kayiplar', 'tpm_ozeti']);
    assert.ok(l.govde.result.tools.every((t) => t.annotations.readOnlyHint));
    const c = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ekipman_durumu', arguments: {} } });
    assert.equal(JSON.parse(c.govde.result.content[0].text).ekipmanlar.length, 18);
  } finally { await kapat(); }
});
