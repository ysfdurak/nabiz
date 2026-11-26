// A3 taslağı: bir arıza türü için problem çözme sayfasının ilk hâli. Kural tabanlı; boşluklar ekip tarafından doldurulur.
// A3: tek sayfa, soldan sağa: konu → arka plan → mevcut durum → analiz → hedef → karşı önlemler → takip.
// Veriler: Arıza Defteri (kayıtlar, özet, bulgular) + Nabız Analiz (güvenilirlik). Hiçbiri yoksa ilgili bölüm "veri yok" der.

const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const yuzde = (x) => `%${Math.round(x * 100)}`;
const tr = (x, b = 1) => (x == null ? '—' : Number(x).toLocaleString('tr-TR', { maximumFractionDigits: b }));

/**
 * @param {object} g
 * @param {string} g.tur              arıza türü kodu
 * @param {object} g.turBilgi         { kod, ad, tip, kayip, kayipAd }
 * @param {object[]} g.kayitlar       bu türün kayıtları (Arıza Defteri görünümü), dönem içinde
 * @param {object[]} g.pareto         dönem Pareto'su (pay için)
 * @param {object|null} g.guvenilirlik Nabız Analiz tür sonucu
 * @param {object|null} g.aralik       Nabız Analiz tip bakım aralığı önerisi
 * @param {object[]} g.bulgular        Arıza Defteri bulguları
 * @param {number} g.donemGun
 */
export function a3Taslagi(g) {
  const kapali = g.kayitlar.filter((k) => k.sure_dk != null);
  const durus = kapali.reduce((t, k) => t + k.sure_dk, 0);
  const p = g.pareto.find((x) => x.kod === g.tur);
  const say = (fn) => {
    const m = new Map();
    for (const k of g.kayitlar) { const a = fn(k); m.set(a, (m.get(a) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const ekipman = say((k) => k.ekipman.kod);
  const vardiya = say((k) => `${k.vardiya}. vardiya`);
  const gunler = say((k) => GUN_ADLARI[new Date(Date.parse(k.baslangic) + 3 * 3600e3).getUTCDay()]); // Türkiye saatine göre gün
  const cozen = say((k) => k.cozen?.ad ?? '—').filter(([a]) => a !== '—');
  const ilgiliBulgular = g.bulgular.filter((b) => b.arizaTuru === g.tur || (b.tip && b.tip === g.turBilgi.tip));
  const gv = g.guvenilirlik;

  const onlemler = [];
  if (gv?.sinif === 'asinma') {
    onlemler.push(`Aşınma (β ${tr(gv.beta, 2)}, %90 aralık ${tr(gv.beta_alt, 2)}–${tr(gv.beta_ust, 2)}): planlı bakım bu arızayı önler.${g.aralik ? ` ${g.turBilgi.tipAd ?? g.turBilgi.tip} bakım aralığı ${g.aralik.mevcut_gun} → ${Math.round(g.aralik.onerilen_gun)} gün önerisi değerlendirilmeli.` : ''}`);
    onlemler.push('Bakım talimatına bu arızanın parçası için ölçülebilir kontrol (aşınma payı, sızdırmazlık) eklenmeli.');
  } else if (gv?.sinif === 'rastgele') {
    onlemler.push(`Rastgele (β ${tr(gv.beta, 2)}): planlı bakımı sıklaştırmak azaltmaz. Vardiya başı kontrol listesine erken belirti maddesi eklenmeli, kök neden 5 Neden ile aranmalı.`);
  } else if (gv?.sinif === 'erken') {
    onlemler.push(`Erken dönem (β ${tr(gv.beta, 2)}): bakımdan hemen sonra sık. Bakım sonrası kontrol (ayar, tork, test çalıştırma) ve bakım talimatı gözden geçirilmeli.`);
  } else {
    onlemler.push('Güvenilirlik analizi yok ya da veri yetersiz: önce kayıt disiplini (her duruşun kaydı) sağlanmalı.');
  }
  for (const b of ilgiliBulgular) {
    if (b.tur === 'tekrarlayan_gun') onlemler.push(`Tekrarlayan gün: ${b.metin} O günün öncesindeki iş, şarj ve vardiya düzeni incelenmeli.`);
    if (b.tur === 'tek_kisi') onlemler.push(`Tek kişiye bağımlılık: ${b.metin} Emanet'te çapraz eğitim planı açılmalı.`);
  }
  if (ekipman[0] && g.kayitlar.length >= 5 && ekipman[0][1] / g.kayitlar.length >= 0.5) {
    onlemler.push(`En çok arıza ${ekipman[0][0]} ekipmanında (tüm arızaların ${yuzde(ekipman[0][1] / g.kayitlar.length)}): önce bu ekipmana odaklanılmalı (ekipmana özgü durum: yaş, kullanım, konum).`);
  }

  return {
    baslik: `${g.turBilgi.ad} (${g.tur})`,
    donemGun: g.donemGun,
    bolumler: [
      { ad: 'Konu', metin: [`${g.turBilgi.tipAd ?? g.turBilgi.tip} ekipmanında "${g.turBilgi.ad}" kaynaklı duruşları azaltmak.`] },
      { ad: 'Arka plan', metin: [
        `Son ${g.donemGun} günde ${g.kayitlar.length} kez, toplam ${tr(durus / 60)} saat duruş (${g.turBilgi.kayipAd ?? g.turBilgi.kayip}).`,
        p ? `Depodaki toplam arıza duruşunun ${yuzde(p.pay)}'i; Pareto'da ${g.pareto.indexOf(p) + 1}. sırada.` : null,
        kapali.length ? `Ortalama onarım ${Math.round(durus / kapali.length)} dakika.` : null,
      ].filter(Boolean) },
      { ad: 'Mevcut durum', metin: [
        `Ekipman: ${ekipman.slice(0, 4).map(([a, n]) => `${a} ${n}`).join(', ') || '—'}`,
        `Vardiya: ${vardiya.map(([a, n]) => `${a} ${n}`).join(', ') || '—'}`,
        `Gün: ${gunler.slice(0, 3).map(([a, n]) => `${a} ${n}`).join(', ') || '—'}`,
        `Çözen: ${cozen.slice(0, 3).map(([a, n]) => `${a} ${n}`).join(', ') || '—'}`,
      ] },
      { ad: 'Analiz', metin: [
        gv ? `Güvenilirlik: ${gv.sinif === 'asinma' ? 'aşınma' : gv.sinif === 'erken' ? 'erken dönem' : gv.sinif === 'rastgele' ? 'rastgele' : 'yetersiz veri'} (β ${tr(gv.beta, 2)}, ${gv.n} arıza, ${gv.dongu} bakım döngüsü). ${gv.yorum}` : 'Güvenilirlik analizi alınamadı.',
        ...ilgiliBulgular.map((b) => `Bulgu: ${b.metin}`),
        '5 Neden: 1) ... 2) ... 3) ... 4) ... 5) ... (ekip doldurur)',
      ] },
      { ad: 'Hedef', metin: [`${g.donemGun} günlük duruşu ${tr(durus / 60 / 2)} saate (yarıya) indirmek; 90 gün içinde ölçülür.`] },
      { ad: 'Karşı önlemler', metin: onlemler },
      { ad: 'Takip', metin: ['Haftalık: bu türün adet ve duruşu (Nabız → Kayıp).', 'Sorumlu ve tarih: ... (karşı önlem Nabız\'da kırmızı etiketle, sorumlu ve hedef tarihle izlenebilir)'] },
    ],
  };
}
