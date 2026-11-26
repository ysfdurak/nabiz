// Demo için sentetik geçmiş: son 7 günün kontrolleri ve etiketleri. Tohum = tarih; aynı gün hep aynı veri.
// Hikâye Arıza Defteri'yle uyumlu: RT-03'te hidrolik sorunu sık (cuma), forkliftlerde otonom bakım oturmuş (uyum yüksek),
// gece vardiyasında kontrol daha sık atlanıyor, sorter'ın kırmızı etiketleri Murat Kaya'yı bekliyor (sorumlu o, gecikenler onda birikir).
import { listeBul } from './kontrol-listeleri.js';
import { uretec } from './rastgele.js';
import { gunEkle, haftaGunu, istanbulGunu } from './zaman.js';
import { vardiyaBasi, varsayilanHedef } from './kurallar.js';

const ACIKLAMALAR = {
  hidrolik: ['Sol silindirin altında yağ damlası var', 'Zeminde avuç kadar yağ lekesi', 'Kaldırırken hortumdan sızıntı'],
  aku: ['Şarj %20, soket gevşek', 'Akü kablosu ezilmiş görünüyor'],
  lastik: ['Ön sağ lastikte kesik var'],
  fren: ['Park freni rampada tutmuyor'],
  ikaz: ['Ekranda E-14 hata kodu', 'Sağ far yanmıyor'],
  catal: ['Sol çatalın ucunda eğilme'],
  direk: ['Direk zinciri bir tarafta gevşek'],
  sensor: ['Yükseklik göstergesi 20 cm sapıyor'],
  bant: ['Bant sağa kaçıyor'],
  fotosel: ['Giriş fotoseli tozlu'],
  acil: ['Acil stop basınca hat 2 saniye geç duruyor'],
  ses: ['Redüktörden tıkırtı sesi'],
  temiz: ['Hat altında ezik koli parçaları'],
  okuyucu: ['Okuyucu camı tozlu, test barkodu iki kez okutuldu'],
  klape: ['12 numaralı klape geç açılıyor'],
  acilis: ['Açılış testi 1 kez hata verdi, ikinci denemede geçti'],
  oluk: ['7 numaralı olukta koli kalmış'],
  film: ['Film rulosu yarım vardiyaya yeter'],
  gerdirme: ['Makarada film artığı birikmiş'],
  tabla: ['Döner tablada gıcırtı'],
  bariyer: ['Fotosel bir kez tepki vermedi'],
};

/**
 * @param {{ ekipmanlar: object[], kisiler: object[], tipler: object }} ana  Arıza Defteri ana verileri
 * @param {number} simdi
 * @returns {{ kontroller: object[], etiketler: object[] }}
 */
export function ornekGecmis(ana, simdi, gunSayisi = 7) {
  const kontroller = [];
  const etiketler = [];
  const bugun = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(simdi));
  const operator = (v) => ana.kisiler.filter((k) => k.rol === 'operator' && k.vardiya === v);
  const teknisyen = ana.kisiler.filter((k) => k.rol === 'teknisyen');
  for (let i = gunSayisi - 1; i >= 0; i--) {
    const gun = gunEkle(bugun, -i);
    const r = uretec(`nabiz-ornek:${gun}`);
    const ra = uretec(`nabiz-ornek-atama:${gun}`); // atama ayrı üreteçte: eski örnek verinin geri kalanı değişmesin
    for (const v of [3, 1, 2]) {
      for (const e of ana.ekipmanlar) {
        if (!ana.tipler[e.tip]?.vardiyalar.includes(v)) continue;
        const bas = vardiyaBasi(gun, v) + r.tam(5, 40) * 60_000;
        if (bas > simdi) continue;
        const yapildiOrani = (v === 3 ? 0.72 : 0.9) + (e.tip === 'forklift' ? 0.06 : 0);
        if (r.sayi() > yapildiOrani) continue;
        const kisi = r.sec(operator(v));
        const liste = listeBul(e.tip);
        const sonuc = liste.map((m) => {
          let nok = r.sayi() < 0.025;
          if (e.kod === 'RT-03' && m.kod === 'hidrolik' && haftaGunu(gun) === 5) nok = r.sayi() < 0.7;
          return { madde: m.kod, durum: nok ? 'nok' : 'ok' };
        });
        // %8 kontrol aceleyle yapılır (12-25 sn): özetteki "hızlı kontrol" göstergesi boş kalmasın; ayrı üreteç
        const normal = r.tam(55, 150); // r her durumda çekilir: dizinin geri kalanı değişmesin
        const sure = ra.sayi() < 0.08 ? ra.tam(12, 25) : normal;
        const k = { ekipman: e.kod, kisi: kisi.kod, gun, vardiya: v, baslangic: bas, bitis: bas + sure * 1000, sonuc };
        kontroller.push(k);
        const kontrolSira = kontroller.length - 1;
        for (const s of sonuc.filter((x) => x.durum === 'nok')) {
          const m = liste.find((x) => x.kod === s.madde);
          const acilis = k.bitis + 60_000;
          // Eski etiketlerin çoğu kapanmıştır; açık kalanlar çoğunlukla son bir-iki günden (gerçekçi bakım kuyruğu).
          const kapanacak = r.sayi() < (m.renk === 'beyaz' ? 0.92 : 0.88);
          const kapanis = acilis + r.tam(m.renk === 'beyaz' ? 10 : 60, m.renk === 'beyaz' ? 60 : 600) * 60_000;
          const kapali = kapanacak && kapanis <= simdi;
          const kapatan = m.renk === 'beyaz' ? kisi : e.tip === 'sorter' ? teknisyen.find((t) => t.kod === 'K-MKAYA') : r.sec(teknisyen);
          const durus = (m.renk === 'kirmizi' && r.sayi() < 0.12) || m.emniyet === true; // emniyet maddesi ekipmanı kilitler
          // Sorumlu: beyazda açan operatör; kırmızıda sorter → Murat Kaya, diğerleri çoğunlukla bir teknisyen (bazısı atanmamış).
          const sorumlu = m.renk === 'beyaz' ? kisi.kod : e.tip === 'sorter' ? 'K-MKAYA' : ra.sayi() < 0.8 ? ra.sec(teknisyen).kod : null;
          etiketler.push({
            ekipman: e.kod, renk: m.renk, madde: m.kod, tur: m.tur, aciklama: r.sec(ACIKLAMALAR[m.kod] || ['Kontrolde sorun görüldü']),
            kisi: kisi.kod, olusturma: acilis, durus, sorumlu, hedef: varsayilanHedef(m.renk, durus, istanbulGunu(acilis), m.emniyet === true), kontrolSira,
            durum: kapali ? 'kapali' : 'acik', kapatan: kapali ? kapatan.kod : null, kapanis: kapali ? kapanis : null,
            kapatmaNotu: kapali ? (m.renk === 'beyaz' ? 'Temizlendi / düzeltildi' : 'Parça değiştirildi, test edildi') : null,
          });
        }
        // Kontrol dışında, çalışırken fark edilen kırmızı etiket (bozulma ya da operatörün sonradan gördüğü sorun).
        // Forkliftlerde otonom bakım oturduğu için sorunların çoğu kontrolde yakalanır (7 adım: 4. adım); diğerlerinde değil.
        if (ra.sayi() < (e.tip === 'forklift' ? 0.02 : 0.09)) {
          const m = ra.sec(liste.filter((x) => x.renk === 'kirmizi'));
          const acilis = bas + ra.tam(60, 400) * 60_000;
          if (acilis <= simdi) {
            const kapali = ra.sayi() < 0.85 && acilis + 4 * 3600e3 <= simdi;
            etiketler.push({
              ekipman: e.kod, renk: 'kirmizi', madde: null, tur: m.tur, aciklama: `Çalışırken fark edildi: ${ra.sec(ACIKLAMALAR[m.kod] || ['anormal ses'])}`.slice(0, 300),
              kisi: kisi.kod, olusturma: acilis, durus: ra.sayi() < 0.3, sorumlu: e.tip === 'sorter' ? 'K-MKAYA' : ra.sec(teknisyen).kod,
              hedef: varsayilanHedef('kirmizi', false, istanbulGunu(acilis)),
              durum: kapali ? 'kapali' : 'acik', kapatan: kapali ? (e.tip === 'sorter' ? 'K-MKAYA' : ra.sec(teknisyen).kod) : null, kapanis: kapali ? acilis + ra.tam(60, 600) * 60_000 : null,
              kapatmaNotu: kapali ? 'Onarıldı, test edildi' : null,
            });
          }
        }
      }
    }
  }
  return { kontroller, etiketler };
}

