// Anonim kullanım ölçümü ve geri bildirim düğmesi (ortak servis: olcum.ysfdurak.com; kaynak: ysfdurak.com → sunucu/olcum).
// Yalnız resmî demo adresinde yüklenir: kurum kurulumları dışarıya hiç istek atmaz (çalışan takibi yapılmaz).
// Gönderilenler: ekran ve işlem adı (ör. "kontrol"), aktif süre, cihaz türü, dil. Ekipman kodu, not, fotoğraf, kişi gönderilmez.
const OLCUM_ACIK = location.hostname === 'nabiz.ysfdurak.com';
if (OLCUM_ACIK) {
  const s = document.createElement('script');
  s.src = 'https://olcum.ysfdurak.com/olcum.js';
  s.defer = true;
  s.dataset.proje = 'nabiz';
  s.dataset.renk = '#1f3a5f';
  document.head.appendChild(s);
}
function olc(tur, ad) {
  if (!OLCUM_ACIK) return;
  if (window.olcum && window.olcum[tur]) window.olcum[tur](ad);
  else (window.olcumKuyruk ||= []).push([tur, ad]);
}
// İşlem adı yalnız sabit yol parçalarından: /v1/etiket/12/kapat → "islem:etiket_kapat" (kimlikler atılır).
const islemAdi = (yol) => 'islem:' + yol.split('?')[0].split('/').filter((p) => /^[a-z-]+$/.test(p) && p !== 'v1').join('_');

// Nabız telefon arayüzü. Adres çubuğundaki #/... yolu sayfayı seçer; QR kodu #/e/<kod> açar.
// Güvenlik: sayfaya giden her metin textContent ile yazılır (el yardımcısı); innerHTML kullanılmaz.
'use strict';

const $ = (id) => document.getElementById(id);
const icerik = $('icerik');
let S = null; // /v1/baslangic: ekipmanlar, kişiler, kontrol listeleri, bağlantılar

function el(etiket, ozellik = {}, ...cocuklar) {
  const e = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellik)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of cocuklar.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

/** SVG öğesi (grafikler için; yine yalnız DOM API, metin textContent ile). */
function svg(etiket, ozellik = {}, ...cocuklar) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', etiket);
  for (const [k, v] of Object.entries(ozellik)) if (v != null) e.setAttribute(k, String(v));
  for (const c of cocuklar.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

// --- yardımcılar --------------------------------------------------------------------------------
const depo = {
  oku(a) { try { return localStorage.getItem(a); } catch { return null; } },
  yaz(a, d) { try { localStorage.setItem(a, d); } catch { /* özel pencere: yalnız bu oturum */ } },
};
const saat = (iso) => (iso ? iso.slice(11, 16) : '');
const gunSaat = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)}` : '');
/** Hedef gün (YYYY-AA-GG) → "28.11"; gecikmişse kırmızı rozet. */
const hedefGun = (g) => (g ? `${g.slice(8, 10)}.${g.slice(5, 7)}` : '');
const hedefRozeti = (t) => (t.durum !== 'acik' || !t.hedef ? null : t.gecikti ? rozet('kirmizi koyu', `${t.gecikmeGun} gün gecikti`) : rozet('gri', `Hedef ${hedefGun(t.hedef)}`));
/** Sorumlu olabilecekler: kırmızıda teknisyen, beyazda operatör ve teknisyen (kurallar.js ile aynı). */
const sorumlular = (renk) => S.kisiler.filter((k) => (renk === 'kirmizi' ? k.rol === 'teknisyen' : ['operator', 'teknisyen'].includes(k.rol)));
const bugunGun = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const yuzde = (x) => (x == null ? '–' : `%${Math.round(x * 100)}`);
const yuzde1 = (x) => (x == null ? '–' : `%${(x * 100).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
const sayi = (x, b = 0) => (x == null ? '–' : Number(x).toLocaleString('tr-TR', { maximumFractionDigits: b }));
const saatDk = (dk) => (dk == null ? '–' : dk >= 120 ? `${sayi(dk / 60, 1)} sa` : `${sayi(dk)} dk`);
const SINIF = { asinma: ['Aşınma', 'kirmizi'], rastgele: ['Rastgele', 'gri'], erken: ['Erken dönem', 'sari'], yetersiz: ['Yetersiz veri', 'beyaz'] };
const KAYIP_AD = { ariza: 'Ekipman arızası', ayar: 'Kurulum ve ayar', kucuk_durus: 'Küçük duruşlar', hiz: 'Hız düşüklüğü', kalite: 'Hata ve hasar', baslangic: 'Başlangıç kayıpları' };
/** Yatay çubuk: oran 0-1, CSSOM ile genişlik (CSP satır içi stile izin vermez). */
function cubuk(oran, sinif = '') {
  const ic = el('span', { class: `cubuk-ic ${sinif}` });
  ic.style.width = `${Math.max(0, Math.min(1, oran || 0)) * 100}%`;
  return el('span', { class: 'cubuk', 'aria-hidden': 'true' }, ic);
}
const ROL = { operator: 'Operatör', teknisyen: 'Teknisyen', sef: 'Vardiya şefi' };
const HEDEF = { ariza_bildir: 'Arıza Defteri: arıza bildir', ariza_kapat: 'Arıza Defteri: arızayı kapat' };
const GDURUM = { bekliyor: 'Gönderilecek', gonderildi: 'Gönderildi', hata: 'Gönderilemedi', benzetim: 'Benzetim' };
const ekipmanBul = (kod) => S.ekipmanlar.find((e) => e.kod === kod);
const kisi = () => S?.kisiler.find((k) => k.kod === depo.oku('nabiz_kisi')) || null;

function bildir(metin, tur = 'bilgi') {
  const b = $('bildirim');
  b.textContent = metin;
  b.className = `bildirim ${tur}`;
  clearTimeout(bildir.z);
  bildir.z = setTimeout(() => b.classList.add('gizli'), 4000);
}

async function api(yol, { method = 'GET', govde, ham, tur } = {}) {
  const ayar = { method, headers: { Accept: 'application/json' } };
  if (govde) { ayar.headers['Content-Type'] = 'application/json'; ayar.body = JSON.stringify(govde); }
  if (ham) { ayar.headers['Content-Type'] = tur; ayar.body = ham; }
  const y = await fetch(yol, ayar);
  const v = await y.json().catch(() => ({}));
  if (y.status === 401 && v.kod === 'alan_yok') { location.reload(); throw new Error(v.hata); }
  if (!y.ok) { const h = new Error(v.hata || 'İstek başarısız.'); h.kod = v.kod; h.durum = y.status; throw h; }
  if (method === 'POST' && yol !== '/v1/giris') olc('olay', islemAdi(yol));
  return v;
}

function sayfa(...cocuklar) {
  icerik.replaceChildren(...cocuklar.flat().filter((c) => c != null && c !== false)); // koşullu bölümler null gelebilir
  icerik.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
const hataKutusu = (m) => el('p', { class: 'hata' }, m);
const geri = (href, metin = 'Geri') => el('a', { class: 'geri', href }, `← ${metin}`);
const rozet = (renk, metin) => el('span', { class: `rozet ${renk}` }, metin);

function kisiZorunlu() {
  const k = kisi();
  if (!k) { kisiSec(); bildir('Önce kim olarak çalıştığını seç.', 'uyari'); }
  return k;
}

// --- kişi seçimi ---------------------------------------------------------------------------------
function kisiDugmesi() {
  const k = kisi();
  $('kisi-dugme').textContent = k ? `${k.ad} · ${ROL[k.rol]}` : 'Kişi seç';
}
function kisiSec() {
  const gruplar = ['operator', 'teknisyen', 'sef'].map((rol) => el('fieldset', {},
    el('legend', {}, ROL[rol]),
    ...S.kisiler.filter((k) => k.rol === rol).map((k) => el('button', {
      type: 'button', class: 'kisi-secenek' + (k.kod === kisi()?.kod ? ' secili' : ''),
      onclick: () => { depo.yaz('nabiz_kisi', k.kod); kisiDugmesi(); $('kisi-penceresi').close(); bildir(`${k.ad} olarak çalışıyorsun.`); yonlendir(); },
    }, k.ad, el('small', {}, `${k.vardiya}. vardiya`)))));
  $('kisi-listesi').replaceChildren(...gruplar);
  $('kisi-penceresi').showModal();
}

// --- sayfalar ------------------------------------------------------------------------------------
async function ekipmanSayfasi() {
  const v = await api('/v1/ekipman');
  const bolgeler = [...new Set(v.ekipmanlar.map((e) => e.bolge))];
  const yapilan = v.ekipmanlar.filter((e) => e.calisiyor && e.kontrol).length;
  const beklenen = v.ekipmanlar.filter((e) => e.calisiyor).length;
  sayfa(
    el('div', { class: 'baslik-satir' }, el('h1', {}, 'Ekipman'), el('span', { class: 'soluk' }, `${v.vardiya.no}. vardiya · kontrol ${yapilan}/${beklenen}`)),
    el('p', { class: 'ipucu' }, 'Ekipmanın üzerindeki QR kodu telefon kamerasıyla okutursan doğrudan kartı açılır.'),
    // Demo ziyaretçisi (mülakatçı) 5 dakikada değeri görsün: üç adımlı yol
    S.demo ? el('div', { class: 'dene' }, el('strong', {}, '5 dakikada dene'), el('ol', {},
      el('li', {}, el('a', { href: '#/kontrol/RT-03' }, 'RT-03 vardiya kontrolünü yap'), ', bir maddeyi "Sorun var" işaretle ve etiket aç.'),
      el('li', {}, el('a', { href: '#/etiketler?durum=acik&ek=geciken' }, 'Geciken etiketlere'), ' bak; teknisyen olarak birine sorumlu ata.'),
      el('li', {}, el('a', { href: '#/kayip' }, 'Kayıp'), ' ve ', el('a', { href: '#/analiz' }, 'Analiz'), ': OEE, bakım aralığı önerisi, Pareto\'dan A3 taslağı.'))) : null,
    ...bolgeler.map((b) => el('section', { class: 'grup' },
      el('h2', {}, b),
      el('ul', { class: 'liste' }, ...v.ekipmanlar.filter((e) => e.bolge === b).map((e) => el('li', {},
        el('a', { class: 'satir', href: `#/e/${e.kod}` },
          el('span', { class: 'satir-ana' }, el('strong', {}, e.kod), ' ', e.ad.replace(/\s*\(.*\)$/, '')),
          el('span', { class: 'satir-yan' },
            !e.calisiyor ? rozet('gri', 'Bu vardiya çalışmıyor')
              : e.kontrol ? rozet(e.kontrol.nokSayisi ? 'sari' : 'yesil', e.kontrol.nokSayisi ? `Kontrol ${e.kontrol.saat} · ${e.kontrol.nokSayisi} sorun` : `Kontrol ${e.kontrol.saat}`)
                : rozet('turuncu', 'Kontrol yok'),
            e.acikEtiket.kirmizi ? rozet('kirmizi', `${e.acikEtiket.kirmizi} kırmızı`) : null,
            e.acikEtiket.beyaz ? rozet('beyaz', `${e.acikEtiket.beyaz} beyaz`) : null,
            e.acikEtiket.durus ? rozet('kirmizi koyu', 'Duruyor') : null,
            e.acikEtiket.geciken ? rozet('turuncu', `${e.acikEtiket.geciken} gecikti`) : null))))))),
  );
}

async function kartSayfasi(kod) {
  const v = await api(`/v1/ekipman/${encodeURIComponent(kod)}`);
  const e = v.ekipman;
  sayfa(
    geri('#/', 'Ekipman'),
    el('div', { class: 'kart-baslik' }, el('p', { class: 'soluk' }, `${e.tipAd} · ${e.bolge}`), el('h1', {}, `${e.kod} · ${e.ad}`)),
    v.buVardiya
      ? el('p', { class: `durum ${v.buVardiya.nokSayisi ? 'sari' : 'yesil'}` }, `Bu vardiyanın kontrolü yapıldı: ${saat(v.buVardiya.bitis)}, ${v.buVardiya.kisiAd}${v.buVardiya.nokSayisi ? ` · ${v.buVardiya.nokSayisi} sorunlu madde` : ' · sorun yok'}`)
      : el('p', { class: 'durum turuncu' }, 'Bu vardiyanın kontrolü henüz yapılmadı.'),
    el('div', { class: 'dugmeler' },
      el('a', { class: 'dugme birincil', href: `#/kontrol/${e.kod}` }, v.buVardiya ? 'Yeniden kontrol et' : 'Vardiya kontrolünü başlat'),
      el('a', { class: 'dugme', href: `#/etiket-ac/${e.kod}` }, 'Etiket aç')),
    el('section', { class: 'grup' }, el('h2', {}, `Açık etiketler (${v.acikEtiketler.length})`),
      v.acikEtiketler.length ? etiketListesi(v.acikEtiketler) : el('p', { class: 'soluk' }, 'Açık etiket yok.')),
    el('section', { class: 'grup' }, el('h2', {}, 'Son kontroller'),
      v.sonKontroller.length ? el('ul', { class: 'liste sade' }, ...v.sonKontroller.map((k) => el('li', {},
        `${gunSaat(k.bitis)} · ${k.vardiya}. vardiya · ${k.kisiAd} · ${k.sureSn} sn · `,
        k.nokSayisi ? rozet('sari', `${k.nokSayisi} sorun`) : rozet('yesil', 'sorun yok')))) : el('p', { class: 'soluk' }, 'Son 7 günde kontrol yok.')),
    v.kapananEtiketler.length ? el('section', { class: 'grup' }, el('h2', {}, 'Son kapanan etiketler'), etiketListesi(v.kapananEtiketler)) : null,
    el('section', { class: 'grup' }, el('div', { class: 'baslik-satir' }, el('h2', {}, 'Duruşlar'), el('a', { class: 'dugme kucuk', href: `#/durus/${e.kod}` }, 'Duruş kaydet')),
      v.duruslar.length ? el('ul', { class: 'liste sade' }, ...v.duruslar.map(durusSatiri)) : el('p', { class: 'soluk' }, 'Elle kaydedilmiş duruş yok. Arıza dışındaki kayıpları (ayar, küçük duruş, hız) da buradan kaydedebilirsin.')),
    el('section', { class: 'grup' }, el('h2', {}, 'Arıza Defteri: son 30 gün'),
      v.sonArizalar == null ? el('p', { class: 'soluk' }, 'Arıza Defteri\'ne şu an ulaşılamıyor ya da bağlantı tanımlı değil.')
        : v.sonArizalar.length ? el('ul', { class: 'liste sade' }, ...v.sonArizalar.map((a) => el('li', {},
          `${gunSaat(a.baslangic)} · ${a.tur.ad} · `, a.durum === 'acik' ? rozet('turuncu', 'açık') : `${a.sure_dk} dk${a.cozen ? `, ${a.cozen.ad}` : ''}`)))
          : el('p', { class: 'soluk' }, 'Son 30 günde arıza yok.')),
  );
}

function etiketListesi(liste) {
  return el('ul', { class: 'liste' }, ...liste.map((t) => el('li', {},
    el('a', { class: 'satir', href: `#/etiket/${t.id}` },
      el('span', { class: 'satir-ana' }, rozet(t.renk, t.renk === 'kirmizi' ? 'Kırmızı' : 'Beyaz'), ' ', el('strong', {}, t.ekipman), ' ', t.aciklama),
      el('span', { class: 'satir-yan soluk' },
        t.durum === 'acik' ? `${gunSaat(t.olusturma)} · ${t.sorumluAd ? `Sorumlu: ${t.sorumluAd}` : t.renk === 'kirmizi' ? 'Sorumlu yok' : t.kisiAd}` : `Kapandı ${gunSaat(t.kapanis)} · ${t.kapatanAd}`,
        ' ', hedefRozeti(t), t.emniyet ? [' ', rozet('kirmizi koyu', 'Emniyet')] : t.durus ? [' ', rozet('kirmizi koyu', 'Duruyor')] : null)))));
}

function durusSatiri(d) {
  const li = el('li', { class: 'durus' },
    el('div', {}, el('strong', {}, d.turAd), ' ', rozet(d.bitis ? 'gri' : 'turuncu', d.bitis ? saatDk(d.sureDk) : 'Devam ediyor')),
    el('p', { class: 'soluk' }, `${gunSaat(d.baslangic)} · ${KAYIP_AD[d.kayip] || d.kayip} · ${d.kisiAd}${d.aciklama ? ` · ${d.aciklama}` : ''}`));
  if (!d.bitis) {
    const not = el('input', { type: 'text', maxlength: 300, placeholder: 'Ne yapıldı?', required: true, 'aria-label': 'Yapılan işlem' });
    li.append(el('form', { class: 'satir-form', onsubmit: async (ev) => {
      ev.preventDefault();
      const k = kisiZorunlu();
      if (!k) return;
      try {
        await api(`/v1/durus/${d.id}/bitir`, { method: 'POST', govde: { kisi: k.kod, not: not.value } });
        bildir('Duruş bitirildi.');
        yonlendir();
      } catch (err) { bildir(err.message, 'hata'); }
    } }, not, el('button', { type: 'submit', class: 'dugme kucuk' }, 'Bitir')));
  }
  return li;
}

function durusSayfasi(kod) {
  const e = ekipmanBul(kod);
  if (!e) throw new Error('Ekipman bulunamadı.');
  const turler = S.arizaTurleri.filter((t) => t.tip === e.tip);
  const sec = el('select', { id: 'tur', required: true }, el('option', { value: '' }, 'Tür seç'),
    ...Object.entries(KAYIP_AD).map(([k, ad]) => {
      const l = turler.filter((t) => t.kayip === k);
      return l.length ? el('optgroup', { label: ad }, ...l.map((t) => el('option', { value: t.kod }, t.ad))) : null;
    }));
  const sure = el('input', { type: 'number', id: 'sure', min: 1, max: 600, step: 1, inputmode: 'numeric', placeholder: 'ör. 25' });
  const devam = el('input', { type: 'checkbox', id: 'devam' });
  const aciklama = el('input', { type: 'text', id: 'aciklama', maxlength: 300, placeholder: 'Kısa not (isteğe bağlı)' });
  const sureAlani = el('div', { class: 'alan' }, el('label', { for: 'sure' }, 'Kaç dakika sürdü?'), sure);
  devam.addEventListener('change', () => { sureAlani.classList.toggle('gizli', devam.checked); sure.required = !devam.checked; });
  sure.required = true;
  const gonder = el('button', { type: 'submit', class: 'dugme birincil genis' }, 'Kaydet');
  sayfa(geri(`#/e/${kod}`, e.kod), el('h1', {}, `${e.kod} duruş kaydı`),
    el('p', { class: 'ipucu' }, 'Arızayla birlikte ayar, küçük duruş, hız ve kalite kayıplarını da kaydet: OEE ve Pareto bunlardan hesaplanır. Kayıt Arıza Defteri\'ne de gider.'),
    el('form', { class: 'form', onsubmit: async (ev) => {
      ev.preventDefault();
      const k = kisiZorunlu();
      if (!k) return;
      gonder.disabled = true;
      try {
        await api('/v1/durus', { method: 'POST', govde: { ekipman: kod, tur: sec.value, kisi: k.kod, devam: devam.checked, sureDk: devam.checked ? null : Number(sure.value), aciklama: aciklama.value || null } });
        bildir('Duruş kaydedildi.');
        location.hash = `#/e/${kod}`;
      } catch (err) { bildir(err.message, 'hata'); gonder.disabled = false; }
    } },
    el('div', { class: 'alan' }, el('label', { for: 'tur' }, 'Duruş türü'), sec),
    el('label', { class: 'onay notr' }, devam, el('span', {}, 'Duruş hâlâ devam ediyor (bitince karttan bitir)')),
    sureAlani,
    el('div', { class: 'alan' }, el('label', { for: 'aciklama' }, 'Açıklama'), aciklama),
    gonder));
}

/** Günlük OEE çizgisi (SVG). Değerler 0-1; dünya sınıfı %85 çizgisi kesik. */
function oeeCizgisi(gunler) {
  const G = 640, Y = 160, sol = 34, alt = 22, ust = 10;
  const x = (i) => sol + (i * (G - sol - 8)) / Math.max(1, gunler.length - 1);
  const y = (v) => ust + (1 - v) * (Y - ust - alt);
  const nokta = gunler.map((g, i) => `${x(i)},${y(g.oee ?? 0)}`).join(' ');
  return el('figure', { class: 'grafik' },
    svg('svg', { viewBox: `0 0 ${G} ${Y}`, role: 'img', 'aria-label': 'Günlük depo OEE' },
      ...[0.5, 0.75, 1].map((v) => [svg('line', { x1: sol, x2: G - 8, y1: y(v), y2: y(v), class: 'izgara' }), svg('text', { x: 2, y: y(v) + 4, class: 'eksen' }, `%${v * 100}`)]),
      svg('line', { x1: sol, x2: G - 8, y1: y(0.85), y2: y(0.85), class: 'hedef' }),
      svg('polyline', { points: nokta, class: 'cizgi' }),
      ...gunler.map((g, i) => svg('circle', { cx: x(i), cy: y(g.oee ?? 0), r: 2.5, class: 'nokta' }, svg('title', {}, `${g.gun}: ${yuzde1(g.oee)}`))),
      svg('text', { x: sol, y: Y - 4, class: 'eksen' }, gunler[0]?.gun.slice(5).split('-').reverse().join('.') ?? ''),
      svg('text', { x: G - 8, y: Y - 4, class: 'eksen', 'text-anchor': 'end' }, gunler.at(-1)?.gun.slice(5).split('-').reverse().join('.') ?? '')),
    el('figcaption', { class: 'soluk' }, 'Günlük depo OEE. Kesik çizgi: dünya sınıfı %85 (yol gösterici).'));
}

/** Kayıp sayfasının tek cümlelik sonucu: yönetici "bu ne diyor?" diye sorar. */
function kayipCumlesi(d, enBuyukTur, gun) {
  const t = d.planliDk || 1;
  const kayip = [['hız', d.kayipDk.hiz, 'ekipman çalışıyor ama ideal hızın altında'], ['duruş', d.kayipDk.durus, 'ekipman duruyor'], ['kalite', d.kayipDk.kalite, 'hatalı iş']]
    .sort((a, b) => b[1] - a[1])[0];
  return `Son ${gun} günde planlı sürenin ${yuzde(d.kayipDk.deger / t)}'i değerli işe gitti. En büyük kayıp ${kayip[0]} (${yuzde(kayip[1] / t)}): ${kayip[2]}.`
    + (enBuyukTur ? ` Duruşta ilk sıradaki tür ${enBuyukTur.kod} (${enBuyukTur.ad.toLocaleLowerCase('tr-TR')}); A3 için aşağıdaki listeden aç.` : '');
}

async function kayipSayfasi(q) {
  const gun = q.get('gun') || '30';
  const v = await api(`/v1/kayip?gun=${encodeURIComponent(gun)}`);
  const d = v.oee.depo;
  const toplamDk = d.planliDk || 1;
  const parca = (ad, dk, sinif) => {
    const s = el('span', { class: `selale-parca ${sinif}`, title: `${ad}: ${saatDk(dk)}` });
    s.style.width = `${(dk / toplamDk) * 100}%`;
    return s;
  };
  const kpi = (ad, deger, not, hedef) => el('div', { class: 'kpi' }, el('span', {}, ad), el('strong', {}, deger), el('small', {}, not), hedef != null ? cubuk(hedef) : null);
  const enBuyuk = Math.max(...v.kayiplar.map((k) => k.durusDk), 1);
  const paretoEnBuyuk = v.pareto[0]?.durusDk || 1;
  sayfa(
    el('div', { class: 'baslik-satir' }, el('h1', {}, 'Kayıp ve OEE'),
      el('span', { class: 'filtreler' }, ...['7', '30', '90'].map((g) => el('a', { class: 'filtre' + (g === gun ? ' secili' : ''), href: `#/kayip?gun=${g}` }, `${g} gün`)))),
    el('p', { class: 'sonuc' }, kayipCumlesi(d, v.pareto[0], gun)),
    el('div', { class: 'kpiler' },
      kpi('Depo OEE', yuzde1(d.oee), `dünya sınıfı %${v.dunyaSinifi.oee * 100}`, d.oee),
      kpi('Kullanılabilirlik', yuzde1(d.kullanilabilirlik), `${saatDk(d.durusDk)} duruş`, d.kullanilabilirlik),
      kpi('Performans', yuzde1(d.performans), 'ideal hıza göre', d.performans),
      kpi('Kalite', yuzde1(d.kalite), `${sayi(d.hatali)} hatalı iş`, d.kalite)),
    el('section', { class: 'grup' }, el('h2', {}, 'Planlı süre nereye gitti?'),
      el('div', { class: 'selale' }, parca('Değerli iş', d.kayipDk.deger, 'deger'), parca('Duruş', d.kayipDk.durus, 'durus'), parca('Hız', d.kayipDk.hiz, 'hiz'), parca('Kalite', d.kayipDk.kalite, 'kalite')),
      el('ul', { class: 'lejant' },
        el('li', {}, el('i', { class: 'deger' }), `Değerli iş ${yuzde(d.kayipDk.deger / toplamDk)}`),
        el('li', {}, el('i', { class: 'durus' }), `Duruş ${yuzde(d.kayipDk.durus / toplamDk)}`),
        el('li', {}, el('i', { class: 'hiz' }), `Hız ${yuzde(d.kayipDk.hiz / toplamDk)}`),
        el('li', {}, el('i', { class: 'kalite' }), `Kalite ${yuzde1(d.kayipDk.kalite / toplamDk)}`))),
    v.oee.gun.length > 1 ? el('section', { class: 'grup' }, el('h2', {}, 'Günlük OEE'), oeeCizgisi(v.oee.gun)) : null,
    el('details', { class: 'yontem' }, el('summary', {}, 'OEE nasıl hesaplanıyor?'),
      el('p', {}, 'OEE = kullanılabilirlik × performans × kalite. Kullanılabilirlik: planlı sürenin duruş dışında kalan payı. Performans: çalışılan sürede yapılan işin ideal hıza oranı. Kalite: hatasız işin payı. Oranların ortalaması alınmaz; süreler ve adetler toplanır, oran sonra hesaplanır. Veri: Arıza Defteri vardiya üretimi (sentetik).')),
    el('section', { class: 'grup' }, el('h2', {}, '6 büyük kayıp (duruş süresi)'),
      el('ul', { class: 'liste sade cubuklu' }, ...v.kayiplar.map((k) => el('li', {}, el('span', {}, k.ad), cubuk(k.durusDk / enBuyuk), el('span', { class: 'sag' }, `${saatDk(k.durusDk)} · ${k.adet}`))))),
    el('section', { class: 'grup' }, el('h2', {}, 'Pareto: en çok duruş yaratan türler'),
      el('p', { class: 'ipucu' }, 'Bir türe dokun: A3 problem çözme taslağı açılır.'),
      el('ol', { class: 'liste pareto' }, ...v.pareto.map((p) => el('li', {}, el('a', { class: 'satir', href: `#/a3/${p.kod}` },
        el('span', { class: 'satir-ana' }, el('strong', {}, p.kod), ' ', p.ad),
        cubuk(p.durusDk / paretoEnBuyuk),
        el('span', { class: 'satir-yan soluk' }, `${saatDk(p.durusDk)} · ${p.adet} kez · kümülatif ${yuzde(p.kumulatif)}`)))))),
    el('section', { class: 'grup' }, el('h2', {}, 'Ekipman OEE (en düşükten)'),
      el('div', { class: 'tablo-kap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Ekipman'), el('th', { class: 'sag' }, 'OEE'), el('th', { class: 'sag' }, 'K'), el('th', { class: 'sag' }, 'P'), el('th', { class: 'sag' }, 'Ka'))),
        el('tbody', {}, ...v.oee.ekipman.map((x) => el('tr', {}, el('td', {}, el('a', { href: `#/e/${x.kod}` }, x.kod)),
          el('td', { class: 'sag' }, x.oee != null && x.oee < 0.6 ? rozet('turuncu', yuzde1(x.oee)) : yuzde1(x.oee)),
          el('td', { class: 'sag' }, yuzde(x.kullanilabilirlik)), el('td', { class: 'sag' }, yuzde(x.performans)), el('td', { class: 'sag' }, yuzde1(x.kalite))))))),
      el('p', { class: 'soluk kucuk-yazi' }, 'K: kullanılabilirlik · P: performans · Ka: kalite')),
  );
}

async function analizSayfasi() {
  const r = await api('/v1/guvenilirlik');
  const tipAd = Object.fromEntries(Object.entries(S.tipler).map(([k, t]) => [k, t.ad]));
  const betaCubugu = (t) => {
    if (t.beta == null) return el('span', { class: 'soluk' }, '–');
    const x = (b) => 6 + (Math.log(b) - Math.log(0.25)) / (Math.log(4) - Math.log(0.25)) * 188; // log ölçek 0,25–4
    return svg('svg', { viewBox: '0 0 200 22', class: 'beta', role: 'img', 'aria-label': `β ${t.beta}, aralık ${t.beta_alt}–${t.beta_ust}` },
      svg('line', { x1: x(1), x2: x(1), y1: 2, y2: 20, class: 'bir' }),
      svg('line', { x1: x(Math.max(0.25, t.beta_alt)), x2: x(Math.min(4, t.beta_ust)), y1: 11, y2: 11, class: `aralik ${t.sinif}` }),
      svg('circle', { cx: x(Math.min(4, Math.max(0.25, t.beta))), cy: 11, r: 4, class: `nokta ${t.sinif}` }));
  };
  const aralikMetni = (t) => (t.sinirda && t.onerilen_gun >= t.mevcut_gun ? 'uzatılabilir' : t.sinirda ? `${Math.round(t.onerilen_gun)} gün veya daha sık` : `${Math.round(t.onerilen_gun)} gün`);
  const kisalt = r.tipler.filter((t) => t.onerilen_gun < t.mevcut_gun * 0.9);
  const uzat = r.tipler.filter((t) => t.onerilen_gun > t.mevcut_gun * 1.1);
  const say = (s) => r.turler.filter((t) => t.sinif === s).length;
  const liste = (l) => l.map((t) => t.ad.toLocaleLowerCase('tr-TR')).join(', ').replace(/, ([^,]*)$/, ' ve $1');
  const sonuc = [
    kisalt.length ? `${liste(kisalt)} için bakım sıklaştırılmalı (${kisalt.map((t) => `${sayi(t.mevcut_gun)} → ${Math.round(t.onerilen_gun)}`).join(', ')} gün).` : 'Hiçbir tipte bakımı sıklaştırmak gerekmiyor.',
    uzat.length ? `${liste(uzat)} için aralık uzatılabilir.` : '',
    `${say('asinma')} arıza türü aşınıyor (planlı bakımla önlenir), ${say('rastgele')} tür rastgele (bakım sıklığı etkilemez; kontrol listesi ve kök neden analizi azaltır)${say('erken') ? `, ${say('erken')} türde bakımdan hemen sonra arıza artıyor (bakım işinin kalitesine bakılmalı)` : ''}.`,
  ].filter(Boolean).join(' ').replace(/^./, (h) => h.toLocaleUpperCase('tr-TR'));
  const turKarti = (t) => el('li', { class: 'tur-satir' },
    el('div', { class: 'tur-ust' }, el('a', { href: `#/a3/${t.tur}` }, el('strong', {}, t.tur)), ' ', t.ad, ' ', rozet(SINIF[t.sinif][1], SINIF[t.sinif][0])),
    el('div', { class: 'tur-alt' }, betaCubugu(t), el('span', { class: 'soluk' }, `β ${t.beta == null ? '–' : sayi(t.beta, 2)} · ${t.n} arıza · ort. ${sayi(t.ortSureDk)} dk`)));
  sayfa(
    el('h1', {}, 'Bakım aralığı ve arıza türleri'),
    el('p', { class: 'sonuc' }, sonuc),
    r.uyari ? el('p', { class: 'durum sari' }, r.uyari) : null,
    el('section', { class: 'grup' }, el('h2', {}, 'Bakım aralığı önerisi'),
      el('ul', { class: 'liste sade' }, ...r.tipler.map((t) => el('li', { class: 'aralik-oneri' },
        el('div', { class: 'baslik-satir' }, el('strong', {}, t.ad), el('span', { class: 'aralik-sayi' }, `${sayi(t.mevcut_gun)} gün → `, el('b', {}, aralikMetni(t)))),
        el('p', {}, t.gerekce),
        el('p', { class: 'soluk' }, `Duruş maliyeti (dk/gün, ekipman başına): ${sayi(t.maliyet_mevcut, 1)} → ${sayi(t.maliyet_onerilen, 1)}${t.maliyet_mevcut ? ` (%${Math.round((1 - t.maliyet_onerilen / t.maliyet_mevcut) * 100)} az)` : ''}. Aralığı belirleyen aşınan türler: ${t.asinanTurler.join(', ') || 'yok'}.`))))),
    el('section', { class: 'grup' }, el('h2', {}, 'Arıza türleri'),
      el('p', { class: 'ipucu' }, 'Kartta yalnız bakımla ilgisi olanlar (aşınma, erken dönem) gösterilir; rastgele türler adıyla listelenir. Bir türe dokun: A3 taslağı açılır.'),
      ...Object.keys(S.tipler).map((tip) => {
        const l = r.turler.filter((t) => t.tip === tip);
        if (!l.length) return null;
        const onemli = l.filter((t) => ['asinma', 'erken'].includes(t.sinif));
        const diger = l.filter((t) => !['asinma', 'erken'].includes(t.sinif));
        return el('div', { class: 'tur-grup' }, el('h3', {}, tipAd[tip]),
          onemli.length ? el('ul', { class: 'liste sade' }, ...onemli.map(turKarti)) : null,
          diger.length ? el('div', {}, el('small', { class: 'soluk' }, `Rastgele ya da verisi yetersiz (${diger.length}):`),
            el('ul', { class: 'tur-kisa' }, ...diger.map((t) => el('li', {}, el('a', { href: `#/a3/${t.tur}` }, t.tur), ` ${t.ad}${t.sinif === 'yetersiz' ? ' (veri az)' : ''}`)))) : null);
      })),
    el('details', { class: 'yontem' }, el('summary', {}, 'β nedir, nasıl okunur?'),
      el('p', {}, 'β, bakımdan sonra arıza sıklığının zamanla nasıl değiştiğini gösterir. β > 1 aşınma: bakımdan uzaklaştıkça arıza sıklaşır, planlı bakım önler. β ≈ 1 rastgele: zamandan bağımsız, bakım sıklığı etkilemez. β < 1 erken dönem: bakımdan hemen sonra arıza artar, bakım işinin kalitesine bakılmalı. Grafikte nokta β tahmini, çizgi %90 güven aralığı, dikey çizgi β = 1; aralık 1\'i kesiyorsa tür rastgele sayılır ve bakım aralığı hesabında β = 1 alınır.'),
      el('p', {}, r.yontem),
      el('p', { class: 'soluk' }, `Rapor: ${gunSaat(r.olusturma)} · ${r.donemGun} gün · ${sayi(r.kayit)} kayıt · Nabız Analiz (Python)`)),
  );
}

async function a3Sayfasi(tur) {
  const a = await api(`/v1/a3/${encodeURIComponent(tur)}`);
  const metin = () => [`A3: ${a.baslik}`, ...a.bolumler.map((b) => `\n## ${b.ad}\n${b.metin.map((m) => `- ${m}`).join('\n')}`)].join('\n');
  sayfa(
    el('div', { class: 'baslik-satir yazdirma-gizli' }, geri('#/kayip', 'Kayıp'),
      el('span', { class: 'dugmeler-satir' },
        el('button', { type: 'button', class: 'dugme kucuk', onclick: async () => { try { await navigator.clipboard.writeText(metin()); bildir('A3 metni kopyalandı.'); } catch { bildir('Kopyalanamadı; yazdırmayı dene.', 'uyari'); } } }, 'Metni kopyala'),
        el('button', { type: 'button', class: 'dugme kucuk', onclick: () => window.print() }, 'Yazdır'))),
    el('h1', {}, `A3 · ${a.baslik}`),
    el('p', { class: 'ipucu' }, `Son ${a.donemGun} günün verisinden kural tabanlı taslak. Kök nedeni ve sorumluları ekip doldurur.`),
    el('div', { class: 'a3' }, ...a.bolumler.map((b, i) => el('section', { class: 'a3-bolum' }, el('h2', {}, `${i + 1}. ${b.ad}`), el('ul', {}, ...b.metin.map((m) => el('li', {}, m)))))),
  );
}

async function kontrolSayfasi(kod) {
  const e = ekipmanBul(kod);
  if (!e) throw new Error('Ekipman bulunamadı.');
  const liste = S.kontrolListeleri[e.tip] || [];
  const baslangic = Date.now();
  const secim = {};
  const kaydet = el('button', { type: 'button', class: 'dugme birincil genis', disabled: true }, 'Kaydet');
  const sayac = el('span', { class: 'soluk' }, `0/${liste.length}`);
  const guncelle = () => {
    const n = Object.keys(secim).length;
    sayac.textContent = `${n}/${liste.length}`;
    kaydet.disabled = n !== liste.length;
  };
  const maddeler = liste.map((m) => {
    const tamam = el('button', { type: 'button', class: 'secim tamam', 'aria-pressed': 'false' }, 'Tamam');
    const sorun = el('button', { type: 'button', class: 'secim sorun', 'aria-pressed': 'false' }, 'Sorun var');
    const sec = (d) => {
      secim[m.kod] = d;
      tamam.setAttribute('aria-pressed', String(d === 'ok'));
      sorun.setAttribute('aria-pressed', String(d === 'nok'));
      guncelle();
    };
    tamam.addEventListener('click', () => sec('ok'));
    sorun.addEventListener('click', () => sec('nok'));
    return el('li', { class: 'madde' }, el('p', {}, m.emniyet ? [rozet('kirmizi koyu', 'Emniyet'), ' '] : null, m.metin), el('div', { class: 'secimler' }, tamam, sorun));
  });
  kaydet.addEventListener('click', async () => {
    const k = kisiZorunlu();
    if (!k) return;
    kaydet.disabled = true;
    try {
      const s = await api('/v1/kontrol', { method: 'POST', govde: { ekipman: kod, kisi: k.kod, baslangicMs: baslangic, sonuc: Object.entries(secim).map(([madde, durum]) => ({ madde, durum })) } });
      kontrolSonucu(kod, s);
    } catch (err) {
      bildir(err.message, 'hata');
      kaydet.disabled = false;
    }
  });
  sayfa(
    geri(`#/e/${kod}`, e.kod),
    el('div', { class: 'baslik-satir' }, el('h1', {}, `${e.kod} vardiya kontrolü`), sayac),
    el('p', { class: 'ipucu' }, 'Her maddeye bakarak tek tek işaretle; 1-2 dakika sürer. Sorun gördüğün maddeye etiket açacaksın. Emniyet maddesinde sorun varsa ekipmanı kullanma.'),
    el('ol', { class: 'maddeler' }, ...maddeler),
    kaydet,
  );
}

function kontrolSonucu(kod, s) {
  sayfa(
    el('h1', {}, s.sorunlu.length ? 'Kontrol kaydedildi, sorun var' : 'Kontrol kaydedildi'),
    el('p', { class: `durum ${s.sorunlu.length ? 'sari' : 'yesil'}` }, `${s.kontrol.sureSn} saniye sürdü.${s.sorunlu.length ? ` ${s.sorunlu.length} maddede sorun işaretledin; her biri için etiket aç.` : ' Ekipman vardiyaya hazır.'}`),
    s.sorunlu.length ? el('ul', { class: 'liste' }, ...s.sorunlu.map((m) => el('li', {},
      el('a', { class: 'satir', href: `#/etiket-ac/${kod}?madde=${encodeURIComponent(m.kod)}&kontrol=${encodeURIComponent(s.kontrol.id)}` },
        el('span', { class: 'satir-ana' }, m.metin),
        el('span', { class: 'satir-yan' }, m.emniyet ? [rozet('kirmizi koyu', 'Emniyet: ekipmanı kullanma'), ' '] : null, rozet(m.renk, m.renk === 'kirmizi' ? 'Kırmızı etiket aç' : 'Beyaz etiket aç')))))) : null,
    el('div', { class: 'dugmeler' }, el('a', { class: 'dugme', href: `#/e/${kod}` }, 'Ekipman kartına dön'), el('a', { class: 'dugme', href: '#/' }, 'Ekipman listesi')),
  );
}

/** Telefonda seçilen resmi en çok 1280 piksele küçültüp JPEG'e çevirir (sunucu yalnız JPEG kabul eder). */
async function fotoHazirla(dosya) {
  const resim = await createImageBitmap(dosya);
  const oran = Math.min(1, 1280 / Math.max(resim.width, resim.height));
  const tuval = el('canvas', { width: Math.round(resim.width * oran), height: Math.round(resim.height * oran) });
  tuval.getContext('2d').drawImage(resim, 0, 0, tuval.width, tuval.height);
  for (const kalite of [0.8, 0.65, 0.5]) {
    const blob = await new Promise((r) => tuval.toBlob(r, 'image/jpeg', kalite));
    if (blob && blob.size <= 1_400_000) return blob;
  }
  throw new Error('Fotoğraf küçültülemedi.');
}

function etiketAcSayfasi(kod, q) {
  const e = ekipmanBul(kod);
  if (!e) throw new Error('Ekipman bulunamadı.');
  const liste = S.kontrolListeleri[e.tip] || [];
  const madde = liste.find((m) => m.kod === q.get('madde')) || null;
  const turler = S.arizaTurleri.filter((t) => t.tip === e.tip);

  const renkSecimi = ['kirmizi', 'beyaz'].map((r) => el('label', { class: `renk-secenek ${r}` },
    el('input', { type: 'radio', name: 'renk', value: r, checked: (madde?.renk || 'beyaz') === r }),
    el('span', {}, el('strong', {}, r === 'kirmizi' ? 'Kırmızı' : 'Beyaz'), el('small', {}, r === 'kirmizi' ? 'Bakım ekibi gerekir' : 'Kendim giderebilirim'))));
  const maddeSec = el('select', { id: 'madde' }, el('option', { value: '' }, 'Kontrol maddesiyle ilgili değil'),
    ...liste.map((m) => el('option', { value: m.kod, selected: m.kod === madde?.kod }, m.metin)));
  const aciklama = el('textarea', { id: 'aciklama', rows: 3, maxlength: 300, required: true, placeholder: 'Ne gördün? Ör. sol silindirin altında yağ damlası' });
  const durus = el('input', { type: 'checkbox', id: 'durus' });
  const turSec = el('select', { id: 'tur' }, el('option', { value: '' }, 'Arıza türü seç'), ...turler.map((t) => el('option', { value: t.kod }, t.ad)));
  const turAlani = el('div', { class: 'alan gizli' }, el('label', { for: 'tur' }, 'Arıza türü'), turSec);
  const foto = el('input', { type: 'file', id: 'foto', accept: 'image/*', capture: 'environment' });
  const onizleme = el('img', { class: 'onizleme gizli', alt: 'Seçilen fotoğraf' });
  const durusAlani = el('label', { class: 'onay' }, durus, el('span', {}, 'Ekipman çalışamıyor (Arıza Defteri\'ne arıza olarak da düşer)'));
  const sorumluSec = el('select', { id: 'sorumlu' });
  const sorumluAlani = el('div', { class: 'alan' }, el('label', { for: 'sorumlu' }, 'Sorumlu (isteğe bağlı)'), sorumluSec);
  const hedefTarih = el('input', { type: 'date', id: 'hedef', min: bugunGun() });
  const hedefAlani = el('div', { class: 'alan' }, el('label', { for: 'hedef' }, 'Hedef tarih (isteğe bağlı)'), hedefTarih,
    el('small', { class: 'soluk' }, 'Boş bırakırsan: ekipman duruyorsa 1 gün, kırmızı 3 gün, beyaz 7 gün.'));
  const sorumluDoldur = () => {
    const onceki = sorumluSec.value;
    sorumluSec.replaceChildren(el('option', { value: '' }, renk() === 'kirmizi' ? 'Sonra atanacak' : 'Ben gideririm'),
      ...sorumlular(renk()).map((x) => el('option', { value: x.kod }, `${x.ad} (${ROL[x.rol]})`)));
    if ([...sorumluSec.options].some((o) => o.value === onceki)) sorumluSec.value = onceki;
  };
  const emniyetUyari = el('p', { class: 'durum kirmizi gizli' }, 'Emniyet maddesi: ekipmanı kullanma, şefe haber ver. Etiket kırmızı açılır, ekipman duruyor sayılır, hedef bugün.');
  const gonder = el('button', { type: 'submit', class: 'dugme birincil genis' }, 'Etiketi aç');
  let fotoBlob = null;

  const renk = () => document.querySelector('input[name=renk]:checked')?.value;
  const alanlariGuncelle = () => {
    // Emniyet maddesi: kırmızı ve "çalışamıyor" zorunlu (sunucu da aynı kuralı uygular)
    const emniyet = liste.find((x) => x.kod === maddeSec.value)?.emniyet === true;
    emniyetUyari.classList.toggle('gizli', !emniyet);
    renkSecimi.forEach((r) => { r.querySelector('input').disabled = emniyet && r.querySelector('input').value !== 'kirmizi'; });
    if (emniyet) { document.querySelector('input[name=renk][value=kirmizi]').checked = true; durus.checked = true; }
    durus.disabled = emniyet;
    durusAlani.classList.toggle('gizli', renk() !== 'kirmizi');
    if (renk() !== 'kirmizi') durus.checked = false;
    turAlani.classList.toggle('gizli', !(durus.checked && !maddeSec.value));
    sorumluDoldur();
  };
  renkSecimi.forEach((r) => r.querySelector('input').addEventListener('change', alanlariGuncelle));
  durus.addEventListener('change', alanlariGuncelle);
  maddeSec.addEventListener('change', () => {
    const m = liste.find((x) => x.kod === maddeSec.value);
    if (m) document.querySelector(`input[name=renk][value=${m.renk}]`).checked = true;
    alanlariGuncelle();
  });
  foto.addEventListener('change', async () => {
    fotoBlob = null;
    onizleme.classList.add('gizli');
    if (!foto.files[0]) return;
    try {
      fotoBlob = await fotoHazirla(foto.files[0]);
      if (onizleme.src) URL.revokeObjectURL(onizleme.src);
      onizleme.src = URL.createObjectURL(fotoBlob);
      onizleme.classList.remove('gizli');
    } catch (err) {
      bildir(`Fotoğraf eklenemedi: ${err.message}`, 'hata');
    }
  });

  const form = el('form', { class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    const k = kisiZorunlu();
    if (!k) return;
    gonder.disabled = true;
    try {
      const t = await api('/v1/etiket', { method: 'POST', govde: {
        ekipman: kod, renk: renk(), madde: maddeSec.value || null, aciklama: aciklama.value, kisi: k.kod,
        durus: durus.checked, tur: durus.checked && !maddeSec.value ? turSec.value || null : null, kontrol: q.get('kontrol') || null,
        ...(sorumluSec.value ? { sorumlu: sorumluSec.value } : {}), ...(hedefTarih.value ? { hedefTarih: hedefTarih.value } : {}),
      } });
      if (fotoBlob) {
        try { await api(`/v1/etiket/${t.id}/foto`, { method: 'POST', ham: fotoBlob, tur: 'image/jpeg' }); } catch (err) { bildir(`Etiket açıldı ama fotoğraf yüklenemedi: ${err.message}`, 'uyari'); }
      }
      bildir('Etiket açıldı.');
      location.hash = `#/etiket/${t.id}`;
    } catch (err) {
      bildir(err.message, 'hata');
      gonder.disabled = false;
    }
  } },
  emniyetUyari,
  el('fieldset', { class: 'renkler' }, el('legend', {}, 'Etiket rengi'), ...renkSecimi),
  el('div', { class: 'alan' }, el('label', { for: 'madde' }, 'Kontrol maddesi'), maddeSec),
  el('div', { class: 'alan' }, el('label', { for: 'aciklama' }, 'Açıklama'), aciklama),
  el('div', { class: 'alan' }, el('label', { for: 'foto' }, 'Fotoğraf (isteğe bağlı)'), foto, onizleme),
  durusAlani, turAlani, sorumluAlani, hedefAlani, gonder);

  sayfa(geri(`#/e/${kod}`, e.kod), el('h1', {}, `${e.kod} için etiket`), el('p', { class: 'ipucu' }, 'Beyaz etiketi kendin giderip kapatırsın; kırmızı etiket bakım ekibinin iş listesine düşer. Her etiketin bir sorumlusu ve hedef tarihi olur.'), form);
  alanlariGuncelle();
}

async function etiketSayfasi(id) {
  const t = await api(`/v1/etiket/${encodeURIComponent(id)}`);
  const k = kisi();
  const kapatabilir = t.durum === 'acik' && k && (t.renk === 'beyaz' || ['teknisyen', 'sef'].includes(k.rol));
  const not = el('textarea', { rows: 2, maxlength: 300, required: true, placeholder: 'Ne yaptın? Ör. hortum değiştirildi, test edildi' });
  const kapatForm = t.durum === 'acik' ? el('form', { class: 'form kapat', onsubmit: async (ev) => {
    ev.preventDefault();
    const kk = kisiZorunlu();
    if (!kk) return;
    try {
      await api(`/v1/etiket/${t.id}/kapat`, { method: 'POST', govde: { kisi: kk.kod, not: not.value } });
      bildir('Etiket kapatıldı.');
      etiketSayfasi(id);
    } catch (err) { bildir(err.message, 'hata'); }
  } },
  el('h2', {}, 'Etiketi kapat'),
  kapatabilir ? [not, el('button', { type: 'submit', class: 'dugme birincil' }, 'Kapat')]
    : el('p', { class: 'soluk' }, t.renk === 'kirmizi' ? 'Kırmızı etiketi teknisyen ya da şef kapatır. Kişi seçimini değiştirerek deneyebilirsin.' : 'Kapatmak için kişi seç.')) : null;

  const atayabilir = t.durum === 'acik' && k && ['teknisyen', 'sef'].includes(k.rol);
  const ataSorumlu = el('select', { 'aria-label': 'Sorumlu' }, el('option', { value: '' }, 'Atanmadı'),
    ...sorumlular(t.renk).map((x) => el('option', { value: x.kod, selected: x.kod === t.sorumlu }, `${x.ad} (${ROL[x.rol]})`)));
  const ataHedef = el('input', { type: 'date', value: t.hedef || '', min: bugunGun(), 'aria-label': 'Hedef tarih' });
  const ataForm = t.durum === 'acik' ? el('form', { class: 'form ata', onsubmit: async (ev) => {
    ev.preventDefault();
    const kk = kisiZorunlu();
    if (!kk) return;
    try {
      await api(`/v1/etiket/${t.id}/ata`, { method: 'POST', govde: { kisi: kk.kod, sorumlu: ataSorumlu.value || null, ...(ataHedef.value && ataHedef.value !== t.hedef ? { hedefTarih: ataHedef.value } : {}) } });
      bildir('Sorumlu ve hedef kaydedildi.');
      etiketSayfasi(id);
    } catch (err) { bildir(err.message, 'hata'); }
  } },
  el('h2', {}, 'Sorumlu ve hedef'),
  atayabilir ? [el('div', { class: 'satir-alanlar' }, ataSorumlu, ataHedef), el('button', { type: 'submit', class: 'dugme' }, 'Kaydet')]
    : el('p', { class: 'soluk' }, 'Sorumluyu ve hedef tarihi teknisyen ya da şef değiştirir.')) : null;

  sayfa(
    geri(`#/e/${t.ekipman}`, t.ekipman),
    el('div', { class: 'kart-baslik' }, el('p', {}, rozet(t.renk, t.renkAd), ' ', t.durum === 'acik' ? rozet('turuncu', 'Açık') : rozet('yesil', 'Kapalı'), t.durus ? [' ', rozet('kirmizi koyu', 'Ekipman çalışamıyor')] : null),
      el('h1', {}, `${t.ekipman} · ${t.aciklama}`)),
    el('dl', { class: 'bilgiler' },
      el('dt', {}, 'Ekipman'), el('dd', {}, t.ekipmanAd),
      t.maddeMetni ? [el('dt', {}, 'Kontrol maddesi'), el('dd', {}, t.maddeMetni)] : null,
      el('dt', {}, 'Açan'), el('dd', {}, `${t.kisiAd} · ${gunSaat(t.olusturma)}`),
      el('dt', {}, 'Sorumlu'), el('dd', {}, t.sorumluAd || (t.renk === 'kirmizi' ? 'Atanmadı' : t.kisiAd)),
      t.hedef ? [el('dt', {}, 'Hedef'), el('dd', {}, hedefGun(t.hedef), ' ', t.gecikti ? rozet('kirmizi koyu', `${t.gecikmeGun} gün gecikti`) : null)] : null,
      t.durum === 'kapali' ? [el('dt', {}, 'Kapatan'), el('dd', {}, `${t.kapatanAd} · ${gunSaat(t.kapanis)}`), el('dt', {}, 'Yapılan'), el('dd', {}, t.kapatmaNotu)] : null),
    t.foto ? el('img', { class: 'foto', src: `/v1/etiket/${t.id}/foto`, alt: 'Etiket fotoğrafı', loading: 'lazy' }) : null,
    t.gonderimler.length ? el('section', { class: 'grup' }, el('h2', {}, 'Bağlı sistemler'),
      el('ul', { class: 'liste sade' }, ...t.gonderimler.map((g) => el('li', { class: 'gonderim' },
        el('div', {}, el('strong', {}, HEDEF[g.hedef] || g.hedef), ' ', rozet(g.durum === 'gonderildi' ? 'yesil' : g.durum === 'hata' ? 'kirmizi' : g.durum === 'benzetim' ? 'gri' : 'turuncu', GDURUM[g.durum])),
        g.sonuc?.id ? el('p', { class: 'soluk' }, `Kayıt: ${g.sonuc.id}`) : null,
        g.sonuc?.not ? el('p', { class: 'soluk' }, g.sonuc.not) : null,
        g.hata ? el('p', { class: 'hata-metin' }, `${g.hata} (deneme ${g.deneme})`) : null,
        g.durum === 'benzetim' && g.govde?.aciklama ? el('details', {}, el('summary', {}, 'Gidecek içerik'), el('pre', {}, g.govde.aciklama)) : null)))) : null,
    ataForm,
    kapatForm,
  );
}

async function etiketlerSayfasi(q) {
  const durum = q.get('durum') ?? 'acik';
  const renk = q.get('renk') || '';
  const ek = q.get('ek') || ''; // '' | 'geciken' | 'benim'
  const ben = kisi();
  const p = new URLSearchParams({ durum, renk });
  if (ek === 'geciken') p.set('geciken', '1');
  if (ek === 'benim' && ben) p.set('sorumlu', ben.kod);
  const sorumluQ = /^K-[A-Z0-9]{2,10}$/.test(q.get('sorumlu') || '') ? q.get('sorumlu') : null; // özetteki "sorumlu başına" bağlantısı
  if (sorumluQ && ek !== 'benim') p.set('sorumlu', sorumluQ);
  const v = await api(`/v1/etiket?${p}`);
  const secim = { durum, renk, ek };
  const filtre = (ad, deger, metin) => el('a', { class: 'filtre' + (secim[ad] === deger ? ' secili' : ''), href: `#/etiketler?${new URLSearchParams({ ...secim, [ad]: deger })}` }, metin);
  // "Göster": durum ve ek tek seçimde birleşir (kapalı + geciken anlamsız)
  const secili = durum === 'kapali' ? 'kapali' : ek || 'acik';
  const gorunum = (g, metin) => el('a', { class: 'filtre' + (secili === g ? ' secili' : ''),
    href: `#/etiketler?${new URLSearchParams({ renk, durum: g === 'kapali' ? 'kapali' : 'acik', ek: ['geciken', 'benim'].includes(g) ? g : '' })}` }, metin);
  sayfa(
    el('h1', {}, 'Etiketler'),
    // İki satır, adlı: "hangi etiketler" (asıl soru) ve "hangi renk". Eskiden 9 düğme etiketsiz 3 gruptaydı (Hepsi ile Herkes yan yana).
    el('div', { class: 'filtre-satir' }, el('span', { class: 'filtre-ad' }, 'Göster'),
      el('span', { class: 'filtreler' }, gorunum('acik', 'Açık'), gorunum('geciken', 'Geciken'), ben ? gorunum('benim', 'Bana atanan') : null, gorunum('kapali', 'Kapalı'))),
    el('div', { class: 'filtre-satir' }, el('span', { class: 'filtre-ad' }, 'Renk'),
      el('span', { class: 'filtreler' }, filtre('renk', '', 'Hepsi'), filtre('renk', 'kirmizi', 'Kırmızı'), filtre('renk', 'beyaz', 'Beyaz'))),
    el('p', { class: 'ipucu' }, sorumluQ && ek !== 'benim' ? `Sorumlu: ${S.kisiler.find((x) => x.kod === sorumluQ)?.ad ?? sorumluQ} · ${v.etiketler.length} etiket`
      : durum === 'acik' && renk === 'kirmizi' ? 'Bakım ekibinin iş listesi: en eskisi en altta.' : `${v.etiketler.length} etiket`),
    v.etiketler.length ? etiketListesi(v.etiketler) : el('p', { class: 'soluk' }, 'Bu filtrede etiket yok.'),
  );
}

async function ozetSayfasi(q) {
  const gun = q.get('gun') || '7';
  const [o, so] = await Promise.all([api(`/v1/ozet?gun=${encodeURIComponent(gun)}`), api('/v1/sabah-ozeti')]);
  const kpi = (ad, deger, not) => el('div', { class: 'kpi' }, el('span', {}, ad), el('strong', {}, deger), not ? el('small', {}, not) : null);
  sayfa(
    el('div', { class: 'baslik-satir' }, el('h1', {}, 'TPM özeti'), el('a', { class: 'dugme kucuk', href: '#/qr' }, 'QR etiketleri'),
      el('span', { class: 'filtreler' }, ...['1', '7', '30'].map((g) => el('a', { class: 'filtre' + (g === gun ? ' secili' : ''), href: `#/ozet?gun=${g}` }, `${g} gün`)))),
    el('div', { class: 'kpiler' },
      kpi('Bugün kontrol uyumu', yuzde(o.bugunUyum.oran), 'başlamış vardiyalar'),
      kpi(`${o.donemGun} gün uyum`, yuzde(o.uyum.oran), `${o.uyum.yapilan}/${o.uyum.beklenen} kontrol`),
      kpi('Açık kırmızı', String(o.acik.kirmizi), o.acik.durus ? `${o.acik.durus} ekipman duruyor` : 'duran ekipman yok'),
      kpi('Açık beyaz', String(o.acik.beyaz), 'operatörde'),
      kpi('Geciken', String(o.acik.geciken), 'hedef tarihi geçmiş açık etiket'),
      kpi('Sorumlusuz kırmızı', String(o.acik.sorumsuzKirmizi), 'atama bekliyor'),
      kpi('Hızlı kontrol', String(o.hizliKontrol.adet), o.hizliKontrol.adet ? `bakılmadan işaretlenmiş olabilir · ${o.hizliKontrol.kisiler.map((x) => `${x.ad} ${x.adet}`).join(', ')}` : 'madde başına 6 sn altı yok'),
      kpi('Kapanma (kırmızı)', o.ortKapanmaSaat.kirmizi == null ? '–' : `${o.ortKapanmaSaat.kirmizi.toLocaleString('tr-TR')} sa`, 'ortalama'),
      kpi('Kapanma (beyaz)', o.ortKapanmaSaat.beyaz == null ? '–' : `${o.ortKapanmaSaat.beyaz.toLocaleString('tr-TR')} sa`, 'ortalama')),
    el('section', { class: 'grup' }, el('h2', {}, 'Geciken etiketler'), o.gecikenler.length ? etiketListesi(o.gecikenler) : el('p', { class: 'soluk' }, 'Geciken etiket yok.')),
    el('details', { class: 'grup bildirim-ac' }, el('summary', {}, `Şefin sabah bildirimi: ${so.gonderilecek ? so.baslik : 'bugün gönderilmez'}`),
      el('p', { class: 'ipucu' }, S.demo ? 'Kurulumda her sabah şefin telefonuna bildirim olarak gider. Demoda yalnız burada görünür.' : 'Her sabah şefin telefonuna bildirim olarak gider (BILDIRIM_URL tanımlıysa).'),
      el('div', { class: 'bildirim-onizleme' }, el('strong', {}, so.baslik), el('pre', {}, so.gonderilecek ? so.metin : `${so.metin} Bugün bildirim gönderilmez.`))),
    el('section', { class: 'grup' }, el('h2', {}, 'Bugün eksik kontroller'),
      o.bugunUyum.eksik.length ? el('ul', { class: 'liste sade' }, ...o.bugunUyum.eksik.map((x) => el('li', {}, el('a', { href: `#/e/${x.kod}` }, x.kod), ` · ${x.vardiyalar.map((v) => `${v}. vardiya`).join(', ')}`))) : el('p', { class: 'soluk' }, 'Eksik kontrol yok.')),
    el('section', { class: 'grup' }, el('h2', {}, 'En sık sorunlu maddeler'),
      o.sikMaddeler.length ? el('ul', { class: 'liste sade' }, ...o.sikMaddeler.map((m) => el('li', {}, el('strong', {}, `${m.adet}×`), ` ${m.ekipman} · ${m.metin}`))) : el('p', { class: 'soluk' }, 'Sorunlu madde yok.')),
    el('section', { class: 'grup' }, el('h2', {}, 'Sorumlu başına açık iş'),
      o.sorumluYuku.length ? el('div', { class: 'tablo-kap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Sorumlu'), el('th', { class: 'sag' }, 'Açık'), el('th', { class: 'sag' }, 'Geciken'))),
        el('tbody', {}, ...o.sorumluYuku.map((x) => el('tr', {}, el('td', {}, el('a', { href: `#/etiketler?durum=acik&ek=&sorumlu=${x.kod}` }, x.ad)), el('td', { class: 'sag' }, String(x.acik)),
          el('td', { class: 'sag' }, x.geciken ? rozet('kirmizi', String(x.geciken)) : '0'))))))
        : el('p', { class: 'soluk' }, 'Atanmış açık etiket yok.')),
    el('section', { class: 'grup' }, el('h2', {}, 'En eski açık etiketler'), o.enEskiAcik.length ? etiketListesi(o.enEskiAcik) : el('p', { class: 'soluk' }, 'Açık etiket yok.')),
    el('section', { class: 'grup' }, el('h2', {}, 'Ekipman başına uyum'),
      el('div', { class: 'tablo-kap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Ekipman'), el('th', { class: 'sag' }, 'Yapılan'), el('th', { class: 'sag' }, 'Uyum'))),
        el('tbody', {}, ...o.ekipmanUyum.map((x) => el('tr', {}, el('td', {}, el('a', { href: `#/e/${x.kod}` }, x.kod), ` ${x.ad || ''}`), el('td', { class: 'sag' }, `${x.yapilan}/${x.beklenen}`),
          el('td', { class: 'sag' }, x.oran != null && x.oran < 0.8 ? rozet('turuncu', yuzde(x.oran)) : yuzde(x.oran)))))))),
  );
}

function qrSayfasi() {
  sayfa(
    el('div', { class: 'baslik-satir yazdirma-gizli' }, el('h1', {}, 'QR etiketleri'), el('button', { type: 'button', class: 'dugme', onclick: () => window.print() }, 'Yazdır')),
    el('p', { class: 'ipucu yazdirma-gizli' }, 'Her kodu ekipmanın operatörün göreceği bir yerine yapıştır. Telefon kamerasıyla okutunca ekipmanın kartı açılır.'),
    el('div', { class: 'qr-izgara' }, ...S.ekipmanlar.map((e) => el('figure', { class: 'qr' },
      el('img', { src: `/v1/qr/${e.kod}.svg`, alt: `${e.kod} QR kodu`, width: 140, height: 140, loading: 'lazy' }),
      el('figcaption', {}, el('strong', {}, e.kod), el('span', {}, e.ad))))),
  );
}

function girisSayfasi() {
  const sifre = el('input', { type: 'password', id: 'sifre', autocomplete: 'current-password', required: true });
  sayfa(el('h1', {}, 'Kurum girişi'), el('p', { class: 'ipucu' }, S?.demo ? 'Demo yerine kurumun gerçek alanında çalışmak için. Duruş ve arıza bildirimleri gerçek Arıza Defteri\'ne gider.' : 'Devam etmek için kurum şifresini gir.'),
    el('form', { class: 'form', onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        await api('/v1/giris', { method: 'POST', govde: { sifre: sifre.value } });
        location.hash = '#/';
        await basla();
      } catch (err) { bildir(err.message, 'hata'); }
    } }, el('div', { class: 'alan' }, el('label', { for: 'sifre' }, 'Şifre'), sifre), el('button', { type: 'submit', class: 'dugme birincil' }, 'Giriş')));
}

// --- yönlendirme ---------------------------------------------------------------------------------
async function yonlendir() {
  const [yol, sorgu = ''] = location.hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(sorgu);
  const p = (yol || '/').split('/').filter(Boolean);
  olc('ekran', p[0] || 'ekipman');
  const sekme = p[0] === 'etiketler' || p[0] === 'etiket' ? 'etiketler' : p[0] === 'ozet' || p[0] === 'qr' ? 'ozet' : p[0] === 'kayip' || p[0] === 'a3' ? 'kayip' : p[0] === 'analiz' ? 'analiz' : 'ekipman';
  document.querySelectorAll('.sekmeler a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.sekme === sekme));
  if (p[0] === 'giris') return girisSayfasi();
  if (!S) return;
  try {
    if (!p.length) await ekipmanSayfasi();
    else if (p[0] === 'e' && p[1]) await kartSayfasi(p[1]);
    else if (p[0] === 'kontrol' && p[1]) await kontrolSayfasi(p[1]);
    else if (p[0] === 'etiket-ac' && p[1]) etiketAcSayfasi(p[1], q);
    else if (p[0] === 'etiket' && p[1]) await etiketSayfasi(p[1]);
    else if (p[0] === 'etiketler') await etiketlerSayfasi(q);
    else if (p[0] === 'ozet') await ozetSayfasi(q);
    else if (p[0] === 'qr') qrSayfasi();
    else if (p[0] === 'durus' && p[1]) durusSayfasi(p[1]);
    else if (p[0] === 'kayip') await kayipSayfasi(q);
    else if (p[0] === 'analiz') await analizSayfasi();
    else if (p[0] === 'a3' && p[1]) await a3Sayfasi(p[1]);
    else sayfa(hataKutusu('Sayfa bulunamadı.'), el('a', { href: '#/' }, 'Ekipman listesine dön'));
  } catch (err) {
    sayfa(hataKutusu(err.message || 'Bir hata oluştu.'), el('a', { href: '#/' }, 'Ekipman listesine dön'));
  }
}

async function basla() {
  try {
    S = await api('/v1/baslangic');
  } catch (err) {
    if (err.kod === 'giris') { $('giris-baglanti').classList.add('gizli'); return girisSayfasi(); }
    return sayfa(hataKutusu(err.message));
  }
  const serit = $('demo-serit');
  serit.classList.toggle('gizli', !S.demo);
  if (S.demo) serit.textContent = 'Deneme alanı: kayıtların yalnız sana görünür, 72 saatte silinir. Veriler sentetik.';
  $('giris-baglanti').classList.toggle('gizli', !(S.demo && S.girisVar));
  kisiDugmesi();
  if (!kisi()) kisiSec();
  await yonlendir();
}

$('kisi-dugme').addEventListener('click', () => S && kisiSec());
window.addEventListener('hashchange', yonlendir);
basla();
