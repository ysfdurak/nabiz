// Ayarlar: hepsi ortam değişkeninden (.env.example). Hatalar toplu döner; sunucu eksik ayarla başlamaz.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const kok = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sayi = (v, varsayilan, alt, ust) => Math.min(ust, Math.max(alt, Number.isFinite(Number(v)) && v !== '' && v != null ? Math.round(Number(v)) : varsayilan));
const anahtarlar = (deger, ad, errors) => {
  const l = String(deger || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (l.some((a) => a.length < 32 || !/^[A-Za-z0-9_-]+$/.test(a))) errors.push(`${ad}: her anahtar en az 32 karakter, yalnız harf, rakam, tire, alt çizgi (üretmek için: openssl rand -hex 32).`);
  return l;
};
const adres = (v, ad, errors) => {
  const t = String(v || '').trim();
  if (!t) return null;
  try { const u = new URL(t); if (!/^https?:$/.test(u.protocol)) throw new Error(); return t; } catch { errors.push(`${ad} geçerli bir http(s) adresi olmalı.`); return null; }
};

export function loadConfig(env = process.env) {
  const errors = [];
  let appUrl = String(env.APP_URL || 'http://localhost:8080/').trim();
  if (!appUrl.endsWith('/')) appUrl += '/';
  try { new URL(appUrl); } catch { errors.push('APP_URL geçerli bir adres olmalı (ör. https://nabiz.ysfdurak.com/).'); }

  const mod = env.MOD === 'kurum' ? 'kurum' : 'demo';
  const siteSifresi = String(env.SITE_SIFRESI || '');
  if (mod === 'kurum' && siteSifresi.length < 12) errors.push('MOD=kurum için SITE_SIFRESI en az 12 karakter olmalı (herkesçe bilinen parola yalnız demoda olmaz).');
  if (siteSifresi && siteSifresi.length < 12) errors.push('SITE_SIFRESI en az 12 karakter olmalı.');

  const mcpEnabled = env.MCP_ENABLED === 'true';
  const mcpAnahtarlari = anahtarlar(env.MCP_ANAHTARLARI, 'MCP_ANAHTARLARI', errors);
  if (mcpEnabled && !mcpAnahtarlari.length) errors.push('MCP_ENABLED=true için MCP_ANAHTARLARI gerekli.');

  const dataDir = resolve(env.DATA_DIR || join(kok, 'tmp', 'data'));

  // Şefe sabah özeti (ntfy.sh ya da düz metin kabul eden başka bir webhook). Boşsa gönderilmez, yalnız Özet'te görünür.
  const bildirimUrl = String(env.BILDIRIM_URL || '').trim() || null;
  if (bildirimUrl && !/^https:\/\/\S+$/.test(bildirimUrl)) errors.push('BILDIRIM_URL https:// ile başlayan bir adres olmalı (ör. https://ntfy.sh/gizli-konu-adi).');
  const sabahSaati = String(env.SABAH_OZETI_SAATI || '07:30').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sabahSaati)) errors.push('SABAH_OZETI_SAATI SS:DD biçiminde olmalı (ör. 07:30).');

  return {
    errors,
    appUrl,
    guvenliCerez: appUrl.startsWith('https://'),
    port: sayi(env.PORT, 8080, 1, 65535),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: join(dataDir, 'nabiz.db'),
    webDir: join(kok, 'web'),
    mod,
    siteSifresi,
    oturumSaat: sayi(env.OTURUM_SAAT, 12, 1, 72),
    demoSaat: sayi(env.DEMO_SAAT, 72, 1, 720),
    demoAzamiAlan: sayi(env.DEMO_AZAMI_ALAN, 300, 1, 10000),
    ipGunlukAlan: sayi(env.IP_GUNLUK_ALAN, 10, 1, 1000),
    dakikalikIstek: sayi(env.DAKIKALIK_ISTEK, 90, 5, 1000),
    arizaUrl: adres(env.ARIZA_DEFTERI_URL, 'ARIZA_DEFTERI_URL', errors),
    arizaAnahtari: String(env.ARIZA_YAZMA_ANAHTARI || '').trim() || null,
    analizUrl: adres(env.ANALIZ_URL, 'ANALIZ_URL', errors),
    bildirimUrl,
    sabahSaati,
    mcpEnabled,
    mcpAnahtarlari,
  };
}
