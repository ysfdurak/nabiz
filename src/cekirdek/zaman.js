// Zaman yardımcıları. Türkiye 2016'dan beri yaz saati uygulamıyor: sabit UTC+3.
export const GUN_MS = 86_400_000;
const OFSET = '+03:00';

/** Türkiye saatine göre gün (YYYY-AA-GG). */
export const istanbulGunu = (zaman = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(zaman));

/** Gün + saat + dakika (Türkiye saati) → epoch ms. saat 24 = ertesi gün 00:00. */
export const anMs = (gun, saat = 0, dakika = 0) => Date.parse(`${gun}T00:00:00${OFSET}`) + (saat * 60 + dakika) * 60_000;

/** Günü kaydırır. */
export const gunEkle = (gun, n) => new Date(Date.parse(`${gun}T12:00:00Z`) + n * GUN_MS).toISOString().slice(0, 10);

/** İki gün arasındaki fark (b - a), gün. */
export const gunFarki = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / GUN_MS);

/** Haftanın günü: 0 pazar … 6 cumartesi. */
export const haftaGunu = (gun) => new Date(`${gun}T12:00:00Z`).getUTCDay();

/** Ay (1-12). */
export const ay = (gun) => Number(gun.slice(5, 7));

export const gecerliGun = (g) => typeof g === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g) && !Number.isNaN(Date.parse(`${g}T00:00:00Z`))
  && new Date(`${g}T00:00:00Z`).toISOString().slice(0, 10) === g;

/** epoch ms → "2026-11-24T14:05:00+03:00" (okunur, saat dilimi açık). */
export const isoTr = (ms) => (ms == null ? null : new Date(ms + 3 * 3600e3).toISOString().slice(0, 19) + OFSET);
