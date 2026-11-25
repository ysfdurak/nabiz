// HTTP katmanı: alan (kum) çözümleme, giriş, /v1 API, fotoğraf, QR, MCP ve arayüz dosyaları.
// Kural içermez: kimin hangi alanda çalıştığını belirler, isteği servise iletir, hatayı HTTP'ye çevirir.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import QRCode from 'qrcode';
import { gercekIp } from './gercek-ip.js';
import { FOTO_SINIRI, KuralHatasi, servisOlustur } from './servis.js';
import { createMcpHandler } from './mcp.js';
import { istanbulGunu } from '../src/cekirdek/zaman.js';

const TURLER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const GOVDE_SINIRI = 16 * 1024;
// blob: yalnız fotoğraf önizlemesi için (telefonda seçilen resim gönderilmeden önce gösterilir).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const ALAN_CEREZI = 'nabiz_alan';
const OTURUM_CEREZI = 'nabiz_oturum';

/**
 * @param {object} o
 * @param {ReturnType<import('./config.js').loadConfig>} o.config
 * @param {ReturnType<import('./store.js').openStore>} o.store
 */
export function createApp({ config, store, ana, ariza, analiz, log = () => {}, simdi = Date.now }) {
  const servis = servisOlustur({ store, ana, ariza, analiz, simdi });
  const ozet = (v) => createHash('sha256').update(String(v)).digest();
  const mcpAnahtarlari = config.mcpAnahtarlari.map(ozet);
  const sifreOzeti = config.siteSifresi ? ozet(config.siteSifresi) : null;
  const mcp = config.mcpEnabled ? createMcpHandler({ servis, log }) : null;
  const tuz = store.tuz();
  const appOrigin = new URL(config.appUrl).origin;

  const dosyalar = new Map();
  for (const ad of readdirSync(config.webDir)) {
    if (TURLER[extname(ad)]) dosyalar.set('/' + ad, { tur: TURLER[extname(ad)], icerik: readFileSync(join(config.webDir, ad)) });
  }

  const ipOzeti = (req) => ozet(tuz + gercekIp(req)).toString('base64url').slice(0, 22);
  const pencere = new Map();
  /** Bellekte kayan pencere sınırı: anahtar başına `sinir` istek / `sureMs`. */
  function sinirla(anahtar, sinir, sureMs) {
    const an = simdi();
    const k = pencere.get(anahtar);
    if (!k || an - k.bas > sureMs) { pencere.set(anahtar, { bas: an, sayi: 1, sure: sureMs }); return true; }
    return ++k.sayi <= sinir;
  }

  function cerezler(req) {
    const c = {};
    for (const p of String(req.headers.cookie || '').split(';')) {
      const i = p.indexOf('=');
      if (i > 0) c[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    }
    return c;
  }
  function cerezYaz(res, ad, deger, saniye) {
    const onceki = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...[].concat(onceki), `${ad}=${deger}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${saniye}${config.guvenliCerez ? '; Secure' : ''}`]);
  }

  function basliklar(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // Kamera: yalnız bu site (fotoğraf için dosya seçici kamerayı açar); konum, mikrofon kapalı.
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Content-Security-Policy', CSP);
  }
  function json(res, durum, veri) {
    res.statusCode = durum;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(veri));
  }

  /** Gövdeyi okur; sınır aşılırsa okumayı keser (beyana güvenmez, sayarak). */
  function govdeOku(req, sinir) {
    return new Promise((resolve, reject) => {
      if (Number(req.headers['content-length'] || 0) > sinir) {
        req.resume();
        return reject(new KuralHatasi('İstek çok büyük.', { durum: 413 }));
      }
      let boyut = 0;
      const parcalar = [];
      req.on('data', (p) => {
        boyut += p.length;
        if (boyut > sinir) { reject(new KuralHatasi('İstek çok büyük.', { durum: 413 })); req.destroy(); } else parcalar.push(p);
      });
      req.on('end', () => resolve(Buffer.concat(parcalar)));
      req.on('error', reject);
    });
  }
  async function jsonOku(req) {
    const ham = await govdeOku(req, GOVDE_SINIRI);
    try {
      const v = ham.length ? JSON.parse(ham.toString('utf8')) : {};
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v;
    } catch {
      throw new KuralHatasi('İstek gövdesi geçerli JSON nesnesi olmalı.');
    }
  }

  /** Bu istek hangi alanda? Geçerli oturum → 'ana'. Demo → ziyaretçinin alanı (yoksa olustur=true ise açılır). */
  function alan(req, res, { olustur = false } = {}) {
    const c = cerezler(req);
    if (c[OTURUM_CEREZI] && /^[A-Za-z0-9_-]{43}$/.test(c[OTURUM_CEREZI]) && store.oturumGecerli(ozet(c[OTURUM_CEREZI]).toString('hex'), simdi())) return 'ana';
    if (config.mod === 'kurum') throw new KuralHatasi('Giriş gerekli.', { durum: 401, kod: 'giris' });
    const mevcut = c[ALAN_CEREZI];
    if (mevcut && /^[A-Za-z0-9_-]{24}$/.test(mevcut) && store.kumVar(mevcut)) {
      store.kumDokun(mevcut, simdi());
      return mevcut;
    }
    if (!olustur) throw new KuralHatasi('Deneme alanın bulunamadı; sayfayı yenile.', { durum: 401, kod: 'alan_yok' });
    if (store.kumSayisi() >= config.demoAzamiAlan) throw new KuralHatasi('Şu an çok sayıda deneme alanı açık. Biraz sonra yeniden dene.', { durum: 503, kod: 'dolu' });
    const ip = ipOzeti(req);
    if (!store.hakDus(istanbulGunu(simdi()), `ip:${ip}`, config.ipGunlukAlan)) throw new KuralHatasi('Bugün bu bağlantıdan çok sayıda deneme alanı açıldı. Yarın yeniden dene.', { durum: 429, kod: 'sinir' });
    const id = store.kumOlustur(ip, simdi());
    store.ornekYukle(id, ornekUret());
    cerezYaz(res, ALAN_CEREZI, id, config.demoSaat * 3600);
    return id;
  }
  let ornekUret = () => ({ kontroller: [], etiketler: [] });

  async function giris(req, res) {
    if (!sifreOzeti) throw new KuralHatasi('Bu kurulumda giriş tanımlı değil.', { durum: 404, kod: 'yok' });
    if (!sinirla(`giris:${ipOzeti(req)}`, 5, 15 * 60_000)) throw new KuralHatasi('Çok fazla deneme. 15 dakika sonra yeniden dene.', { durum: 429, kod: 'sinir' });
    const g = await jsonOku(req);
    const dogru = typeof g.sifre === 'string' && timingSafeEqual(ozet(g.sifre), sifreOzeti);
    if (!dogru) throw new KuralHatasi('Şifre yanlış.', { durum: 401, kod: 'sifre' });
    const anahtar = randomBytes(32).toString('base64url');
    store.oturumEkle(ozet(anahtar).toString('hex'), simdi() + config.oturumSaat * 3600e3);
    cerezYaz(res, OTURUM_CEREZI, anahtar, config.oturumSaat * 3600);
    log('Kurum alanına giriş yapıldı.');
    return { tamam: true };
  }

  function mcpYetkili(req, path) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    const sunulan = m?.[1] || path.slice('/mcp/'.length);
    if (!sunulan || !mcpAnahtarlari.length) return false;
    const h = ozet(sunulan);
    return mcpAnahtarlari.some((a) => timingSafeEqual(a, h));
  }

  async function v1(req, res, path, q) {
    const yazma = req.method === 'POST';
    if (yazma) {
      const origin = req.headers.origin;
      if (origin && origin !== appOrigin) return json(res, 403, { hata: 'İstek kaynağı reddedildi.' });
      const sfs = req.headers['sec-fetch-site'];
      if (sfs && !['same-origin', 'none'].includes(sfs)) return json(res, 403, { hata: 'İstek kaynağı reddedildi.' });
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { hata: 'Yöntem desteklenmiyor.' });
    }

    if (path === '/v1/giris' && yazma) return json(res, 200, await giris(req, res));
    if (path === '/v1/cikis' && yazma) {
      const c = cerezler(req)[OTURUM_CEREZI];
      if (c) store.oturumSil(ozet(c).toString('hex'));
      cerezYaz(res, OTURUM_CEREZI, '', 0);
      return json(res, 200, { tamam: true });
    }

    const qr = /^\/v1\/qr\/([A-Z]{2}-\d{2})\.svg$/.exec(path);
    if (qr && !yazma) {
      const e = ana().ekipmanlar.find((x) => x.kod === qr[1]);
      if (!e) return json(res, 404, { hata: 'Ekipman bulunamadı.' });
      const svg = await QRCode.toString(`${config.appUrl}#/e/${e.kod}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      return res.end(svg);
    }

    const kum = alan(req, res, { olustur: path === '/v1/baslangic' });
    if (path === '/v1/baslangic' && !yazma) return json(res, 200, { ...servis.baslangic(kum), girisVar: !!sifreOzeti, mod: config.mod });
    if (path === '/v1/ekipman' && !yazma) return json(res, 200, servis.ekipmanlar(kum));
    let m = /^\/v1\/ekipman\/([A-Z]{2}-\d{2})$/.exec(path);
    if (m && !yazma) return json(res, 200, await servis.ekipmanKarti(kum, m[1]));
    if (path === '/v1/kontrol' && yazma) return json(res, 201, servis.kontrolKaydet(kum, await jsonOku(req)));
    if (path === '/v1/etiket' && yazma) return json(res, 201, servis.etiketAc(kum, await jsonOku(req)));
    if (path === '/v1/etiket' && !yazma) return json(res, 200, servis.etiketler(kum, q));
    if (path === '/v1/ozet' && !yazma) return json(res, 200, servis.ozet(kum, q));
    // V2
    if (path === '/v1/durus' && yazma) return json(res, 201, servis.durusKaydet(kum, await jsonOku(req)));
    m = /^\/v1\/durus\/(D-[0-9a-f]{12})(\/bitir)?$/.exec(path);
    if (m && m[2] && yazma) return json(res, 200, servis.durusBitir(kum, m[1], await jsonOku(req)));
    if (m && !m[2] && !yazma) return json(res, 200, servis.durusDetay(kum, m[1]));
    if (path === '/v1/kayip' && !yazma) return json(res, 200, await servis.kayipAnalizi(q));
    if (path === '/v1/guvenilirlik' && !yazma) return json(res, 200, await servis.guvenilirlik());
    m = /^\/v1\/a3\/([A-Z]{2}-[A-Z]{3})$/.exec(path);
    if (m && !yazma) return json(res, 200, await servis.a3(m[1], q));
    m = /^\/v1\/etiket\/([^/]+)(\/kapat|\/ata|\/foto)?$/.exec(path);
    if (m) {
      const [, id, alt] = m;
      if (!alt && !yazma) return json(res, 200, servis.etiketDetay(kum, id));
      if (alt === '/kapat' && yazma) return json(res, 200, servis.etiketKapat(kum, id, await jsonOku(req)));
      if (alt === '/ata' && yazma) return json(res, 200, servis.etiketAta(kum, id, await jsonOku(req)));
      if (alt === '/foto' && yazma) {
        if (!/^image\/jpeg$/i.test(String(req.headers['content-type'] || ''))) throw new KuralHatasi('Fotoğraf image/jpeg olarak gönderilmeli.', { durum: 415 });
        return json(res, 201, servis.fotoKaydet(kum, id, await govdeOku(req, FOTO_SINIRI)));
      }
      if (alt === '/foto' && !yazma) {
        const veri = servis.fotoOku(kum, id);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        return res.end(req.method === 'HEAD' ? undefined : veri);
      }
    }
    return json(res, 404, { hata: 'Bulunamadı.' });
  }

  async function handle(req, res) {
    basliklar(res);
    let url;
    try {
      url = new URL(req.url, 'http://x');
      decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { hata: 'Geçersiz adres.' });
    }
    const path = url.pathname;
    try {
      if (path === '/healthz') return json(res, 200, { ok: true });
      if (!sinirla(`istek:${ipOzeti(req)}`, config.dakikalikIstek, 60_000)) {
        res.setHeader('Retry-After', '60');
        return json(res, 429, { hata: 'Çok hızlı istek gönderiyorsun. Bir dakika sonra tekrar dene.' });
      }
      if (path === '/mcp' || path.startsWith('/mcp/')) {
        if (!mcp) return json(res, 404, { hata: 'MCP kapısı bu kurulumda kapalı.' });
        if (!mcpYetkili(req, path)) return json(res, 401, { hata: 'Geçerli bir MCP erişim anahtarı gerekli.' });
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { hata: 'Yöntem desteklenmiyor.' }); }
        return await mcp.handle(req, res, await jsonOku(req));
      }
      if (path.startsWith('/v1/')) return await v1(req, res, path, Object.fromEntries(url.searchParams));
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { hata: 'Yöntem desteklenmiyor.' });
      const dosya = dosyalar.get(path === '/' ? '/index.html' : path);
      if (!dosya) return json(res, 404, { hata: 'Bulunamadı.' });
      res.statusCode = 200;
      res.setHeader('Content-Type', dosya.tur);
      res.setHeader('Cache-Control', dosya.tur.startsWith('text/html') ? 'no-cache' : 'public, max-age=300');
      return res.end(req.method === 'HEAD' ? undefined : dosya.icerik);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof KuralHatasi) return json(res, err.durum, { hata: err.message, kod: err.kod });
      log(`Beklenmeyen hata: ${err?.stack || err}`);
      return json(res, 500, { hata: 'İstek işlenemedi.' });
    }
  }

  /** Saatlik: süresi dolan alanlar, oturumlar, sayaçlar, bellek pencereleri. */
  function bakim() {
    const an = simdi();
    const silinen = store.kumTemizle(an - config.demoSaat * 3600e3);
    if (silinen) log(`${silinen} deneme alanı silindi.`);
    store.oturumTemizle(an);
    store.sayacTemizle(istanbulGunu(an - 2 * 86400e3));
    for (const [k, v] of pencere) if (an - v.bas > v.sure) pencere.delete(k);
  }

  return { handle, bakim, servis, ornekKaynagi: (fn) => { ornekUret = fn; } };
}
