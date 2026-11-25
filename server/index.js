// Nabız sunucusu — başlatma.  Kullanım: npm start   (ayarlar: .env.example, docs/SUNUCU_KURULUMU.md)
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { kok, loadConfig } from './config.js';
import { openStore } from './store.js';
import { createApp } from './app.js';
import { anaVeriKaynagi } from './ana-veri.js';
import { analizIstemcisi, arizaDefteriIstemcisi, gidenIsleyici } from './entegrasyon.js';
import { sabahZamanlayici } from './bildirim.js';
import { ornekGecmis } from '../src/cekirdek/ornek.js';
import { istanbulGunu } from '../src/cekirdek/zaman.js';

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const config = loadConfig();
if (config.errors.length) {
  console.error('Nabız başlatılamadı, ayarları kontrol et:\n - ' + config.errors.join('\n - '));
  process.exit(1);
}

mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbFile);
const ariza = arizaDefteriIstemcisi({ url: config.arizaUrl, anahtar: config.arizaAnahtari });
const analiz = analizIstemcisi({ url: config.analizUrl });
const ana = anaVeriKaynagi({ store, ariza, kok, log });
await ana.yenile();

const app = createApp({ config, store, ana: ana.al, ariza, analiz, log });
app.ornekKaynagi(() => ornekGecmis(ana.al(), Date.now()));
const giden = gidenIsleyici({ store, ariza, log });
const sabah = sabahZamanlayici({ servis: app.servis, store, url: config.bildirimUrl, saat: config.sabahSaati, log });

/** Demo kurulumunda kurum alanı ("ana") her gün örnek geçmişle tazelenir: vitrin ve MCP için. */
function vitrin() {
  if (config.mod !== 'demo') return;
  const gun = istanbulGunu();
  if (store.metaOku('vitrin_gun') === gun) return;
  const s = store.ornekYukle('ana', ornekGecmis(ana.al(), Date.now()));
  store.metaYaz('vitrin_gun', gun);
  log(`Vitrin verisi tazelendi: ${s.kontrol} kontrol, ${s.etiket} etiket.`);
}
vitrin();

setInterval(() => giden.isle().catch((e) => log(`Giden kutusu: ${e}`)), 30_000).unref();
// Sabah özeti 5 dakikada bir yoklanır; vitrin tazelendikten sonra gitsin diye önce vitrin().
setInterval(() => { vitrin(); sabah.kontrol().catch((e) => log(`Sabah özeti: ${e}`)); }, 5 * 60_000).unref();
setInterval(() => { ana.yenile(); app.bakim(); vitrin(); }, 3600e3).unref();

const server = createServer(app.handle);
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.listen(config.port, config.host, () => {
  log(`Nabız: ${config.appUrl} (dinlenen ${config.host}:${config.port}) · mod: ${config.mod} · ana veri: ${ana.kaynak()} · Arıza Defteri: ${ariza.acik ? (ariza.yazabilir ? 'okuma+yazma' : 'okuma') : 'kapalı'} · Analiz: ${analiz.acik ? 'açık' : 'kapalı'} · MCP: ${config.mcpEnabled ? 'açık' : 'kapalı'} · Sabah özeti: ${config.bildirimUrl ? config.sabahSaati : 'kapalı'}`);
});

function shutdown(signal) {
  log(`${signal} alındı, kapanıyor…`);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
