// Ana veriler (ekipman, kişi, arıza türü) Arıza Defteri'nden gelir: tek kaynak.
// Gevşek bağ: son okunan liste veritabanında saklanır. Arıza Defteri kapalıysa son liste, o da yoksa depodaki
// gömülü kopya (veri/ana-veriler.json) kullanılır; Nabız hiçbir durumda açılamaz hâle gelmez.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function anaVeriKaynagi({ store, ariza, kok, log = () => {} }) {
  const gomulu = JSON.parse(readFileSync(join(kok, 'veri', 'ana-veriler.json'), 'utf8'));
  let guncel = gomulu;
  let kaynak = 'gömülü kopya';
  try {
    const kayitli = store.metaOku('ana_veri');
    if (kayitli) { guncel = JSON.parse(kayitli); kaynak = 'son okunan'; }
  } catch { /* bozuk kayıt: gömülü kopya */ }

  const gecerli = (v) => v && Array.isArray(v.ekipmanlar) && v.ekipmanlar.length && Array.isArray(v.kisiler) && v.tipler && typeof v.tipler === 'object';

  return {
    al: () => guncel,
    kaynak: () => kaynak,
    async yenile() {
      if (!ariza.acik) return false;
      try {
        const v = await ariza.anaVeriler();
        if (!gecerli(v)) throw new Error('beklenmeyen biçim');
        guncel = v;
        kaynak = 'Arıza Defteri';
        store.metaYaz('ana_veri', JSON.stringify(v));
        return true;
      } catch (err) {
        log(`Ana veriler Arıza Defteri'nden alınamadı (${err.message}); ${kaynak} kullanılıyor.`);
        return false;
      }
    },
  };
}
