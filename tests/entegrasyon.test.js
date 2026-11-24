// Giden kutusu: başarı, geçici hata (yeniden dene), kalıcı hata, sıra; Pusula istemcisi gerçek bir MCP sunucusuna karşı.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { openStore } from '../server/store.js';
import { DisServisHatasi, gidenIsleyici, pusulaIstemcisi } from '../server/entegrasyon.js';

const depo = () => openStore(join(mkdtempSync(join(tmpdir(), 'nabiz-')), 't.db'));
const etiket = (s) => s.etiketEkle('ana', { ekipman: 'RT-03', renk: 'kirmizi', aciklama: 'yağ', kisi: 'K-O01', olusturma: 1, durus: true });

test('başarılı gönderim: kimlikler etikete yazılır, kapatma açılıştan sonra gider', async () => {
  const s = depo();
  const id = etiket(s);
  let an = 1000;
  const cagrilar = [];
  const ariza = { bildir: async () => { cagrilar.push('bildir'); return { id: 'G-1' }; }, kapat: async (aid) => { cagrilar.push(`kapat:${aid}`); return { id: aid, sure_dk: 5 }; } };
  const pusula = { isAc: async () => { cagrilar.push('ac'); return { id: 'is-9' }; }, isKapat: async ({ isId }) => { cagrilar.push(`kapat:${isId}`); return { id: isId }; } };
  s.gidenEkle('ana', { etiket: id, hedef: 'pusula_ac', govde: {} }, an);
  s.gidenEkle('ana', { etiket: id, hedef: 'ariza_bildir', govde: {} }, an);
  s.gidenEkle('ana', { etiket: id, hedef: 'pusula_kapat', govde: { not: 'x' } }, an);
  s.gidenEkle('ana', { etiket: id, hedef: 'ariza_kapat', govde: {} }, an);
  await gidenIsleyici({ store: s, ariza, pusula, simdi: () => an }).isle();
  assert.deepEqual(cagrilar, ['ac', 'bildir', 'kapat:is-9', 'kapat:G-1']);
  const e = s.etiketBul('ana', id);
  assert.equal(e.pusulaIs, 'is-9');
  assert.equal(e.arizaId, 'G-1');
  assert.ok(s.gidenler('ana', id).every((g) => g.durum === 'gonderildi'));
});

test('geçici hata yeniden denenir; kalıcı hata hemen "hata" olur; ziyaretçi alanı hiç gönderilmez', async () => {
  const s = depo();
  const id = etiket(s);
  let an = 0;
  let deneme = 0;
  const ariza = { bildir: async () => { if (++deneme < 3) throw new DisServisHatasi('ulaşılamadı'); return { id: 'G-2' }; } };
  const pusula = { isAc: async () => { throw new DisServisHatasi('Pusula: çalışma alanı yok', { kalici: true }); } };
  s.gidenEkle('ana', { etiket: id, hedef: 'ariza_bildir', govde: {} }, an);
  s.gidenEkle('ana', { etiket: id, hedef: 'pusula_ac', govde: {} }, an);
  const kum = s.kumOlustur('ip', 0);
  const zid = s.etiketEkle(kum, { ekipman: 'FL-01', renk: 'kirmizi', aciklama: 'x', kisi: 'K-O01', olusturma: 1 });
  s.gidenEkle(kum, { etiket: zid, hedef: 'pusula_ac', govde: {}, durum: 'benzetim' }, an);
  const g = gidenIsleyici({ store: s, ariza, pusula, simdi: () => an });
  await g.isle();
  let l = s.gidenler('ana', id);
  assert.equal(l[0].durum, 'bekliyor'); // 1. deneme başarısız, 1 dk sonra
  assert.equal(l[1].durum, 'hata');
  assert.match(l[1].son_hata, /çalışma alanı/);
  await g.isle(); // zamanı gelmedi
  assert.equal(deneme, 1);
  an += 61_000; await g.isle();
  an += 5 * 61_000; await g.isle();
  l = s.gidenler('ana', id);
  assert.equal(l[0].durum, 'gonderildi');
  assert.equal(deneme, 3);
  assert.equal(s.gidenler(kum, zid)[0].durum, 'benzetim');
});

test('Pusula istemcisi: MCP üzerinden is_olustur ve durum_degistir çağrılır, anahtar başlıkta gider', async () => {
  const gelen = [];
  const sunucu = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${'p'.repeat(40)}`) { res.statusCode = 401; return res.end('{}'); }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); } // Pusula gibi durumsuz: yalnız POST
    const parca = []; for await (const p of req) parca.push(p);
    const mcp = new McpServer({ name: 'sahte-pusula', version: '1' });
    mcp.registerTool('is_olustur', { inputSchema: { baslik: z.string(), aciklama: z.string().optional(), oncelik: z.string().optional(), calismaAlani: z.string().optional() } },
      async (a) => { gelen.push(['is_olustur', a]); return { content: [{ type: 'text', text: JSON.stringify({ id: 'is-42', baslik: a.baslik }) }] }; });
    mcp.registerTool('yorum_ekle', { inputSchema: { isId: z.string(), metin: z.string(), calismaAlani: z.string().optional() } },
      async (a) => { gelen.push(['yorum_ekle', a]); return { content: [{ type: 'text', text: '{}' }] }; });
    mcp.registerTool('durum_degistir', { inputSchema: { isId: z.string(), durum: z.string(), calismaAlani: z.string().optional() } },
      async () => ({ isError: true, content: [{ type: 'text', text: 'Kontrol listesi bitmedi' }] }));
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { t.close(); mcp.close(); });
    await mcp.connect(t);
    await t.handleRequest(req, res, JSON.parse(Buffer.concat(parca).toString()));
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${sunucu.address().port}/mcp`;
  try {
    const p = pusulaIstemcisi({ url, anahtar: 'p'.repeat(40), calismaAlani: 'alan-1' });
    const is = await p.isAc({ baslik: '[Kırmızı etiket] RT-03', aciklama: 'yağ', oncelik: 'urgent' });
    assert.equal(is.id, 'is-42');
    assert.equal(gelen[0][1].calismaAlani, 'alan-1');
    const k = await p.isKapat({ isId: 'is-42', not: 'hortum' });
    assert.match(k.tamamlanamadi, /Kontrol listesi/, 'tamamlanamazsa yorumla yetinilir');
    assert.equal(gelen.at(-1)[0], 'yorum_ekle');
    const yanlis = pusulaIstemcisi({ url, anahtar: 'y'.repeat(40) });
    await assert.rejects(yanlis.isAc({ baslik: 'x' }), (e) => e instanceof DisServisHatasi && !e.kalici);
  } finally {
    await new Promise((r) => sunucu.close(r));
  }
});
