// Şefin sabah özeti: geciken etiketler, sorumlusu olmayan kırmızılar, işin kimde biriktiği. Saf fonksiyon:
// sunucu her sabah bunu bildirim olarak gönderir, Özet ekranı aynı metni önizleme olarak gösterir.
//
// Neden yalnız bunlar? Şefin sabah ilk sorusu "bugün kimi aramam gerek?". Açık etiketlerin hepsi değil,
// yalnız müdahale isteyenler: hedefi geçmiş olanlar ve sahibi olmayan kırmızılar. Telefonda bir bakışta okunsun diye
// en çok 5 satır etiket, 3 satır kişi.

const gunAy = (g) => `${g.slice(8, 10)}.${g.slice(5, 7)}`;

/**
 * @param {{ gecikenler: object[], sorumsuzKirmizilar: object[], sorumluYuku: {ad: string, acik: number, geciken: number}[] }} v
 * @param {{ bugun: string, uygulamaUrl?: string }} o
 * @returns {{ gonderilecek: boolean, baslik: string, metin: string, oncelik: 'high'|'default', baglanti: string|null }}
 */
export function sabahOzeti({ gecikenler, sorumsuzKirmizilar, sorumluYuku }, { bugun, uygulamaUrl = null }) {
  const n = gecikenler.length;
  const s = sorumsuzKirmizilar.length;
  const baglanti = uygulamaUrl ? `${uygulamaUrl.replace(/\/$/, '')}/#/etiketler?durum=acik&ek=geciken` : null;
  if (!n && !s) {
    return { gonderilecek: false, baslik: `${gunAy(bugun)} sabah özeti`, metin: 'Geciken etiket ve sorumlusuz kırmızı yok.', oncelik: 'default', baglanti };
  }
  const satirlar = [];
  if (n) {
    satirlar.push(`${n} geciken etiket:`);
    // En çok geciken üstte: hedefi en eski olan
    for (const e of [...gecikenler].sort((a, b) => a.hedef.localeCompare(b.hedef)).slice(0, 5)) {
      satirlar.push(`• ${e.ekipman} ${e.aciklama.slice(0, 50)} · ${e.sorumluAd ?? 'sorumlu yok'} · ${e.gecikmeGun} gün`);
    }
    if (n > 5) satirlar.push(`• … ve ${n - 5} etiket daha`);
  }
  if (s) {
    if (satirlar.length) satirlar.push('');
    satirlar.push(`${s} kırmızı etiketin sorumlusu yok: ${sorumsuzKirmizilar.slice(0, 5).map((e) => e.ekipman).join(', ')}${s > 5 ? ' …' : ''}`);
  }
  const yuk = sorumluYuku.filter((x) => x.geciken).slice(0, 3);
  if (yuk.length) {
    satirlar.push('');
    satirlar.push(`Gecikme kimde: ${yuk.map((x) => `${x.ad} (${x.geciken})`).join(', ')}`);
  }
  // Ekipmanı duran ve gecikmiş bir etiket varsa acil
  const acil = gecikenler.some((e) => e.durus);
  return { gonderilecek: true, baslik: `${gunAy(bugun)} sabah özeti: ${n} geciken`, metin: satirlar.join('\n'), oncelik: acil ? 'high' : 'default', baglanti };
}
