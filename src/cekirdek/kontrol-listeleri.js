// Otonom bakım kontrol listeleri (TPM 1. adım: operatör kendi ekipmanının temel durumunu her vardiya başında kontrol eder).
// Bir liste 1-2 dakikada bitmeli: az madde, her madde gözle ya da tek hareketle kontrol edilebilir.
// Sorunlu madde etiket açmaya yönlendirir: önerilen renk ve Arıza Defteri'ndeki ilgili arıza türü buradan gelir.
//   renk: 'beyaz' → operatör kendisi giderebilir (temizlik, sıkma, akü değişimi) · 'kirmizi' → bakım ekibi gerekir
//   emniyet: true → can güvenliği maddesi (fren, çatal, acil stop, bariyer). Sorun varsa ekipman kullanılmaz
//   (kilitlenir), etiket kırmızı ve hedef aynı gün: 3 gün beklemek sahada kabul edilmez.

export const KONTROL_LISTELERI = {
  forklift: [
    { kod: 'aku', metin: 'Akü şarjı %30 üstünde, soket ve kablo sağlam', renk: 'beyaz', tur: 'FL-AKU' },
    { kod: 'hidrolik', metin: 'Zeminde ve silindirlerde yağ izi yok', renk: 'kirmizi', tur: 'FL-HID' },
    { kod: 'lastik', metin: 'Lastiklerde kesik, parça kopması yok', renk: 'kirmizi', tur: 'FL-LAS' },
    { kod: 'fren', metin: 'Fren ve park freni tutuyor', renk: 'kirmizi', tur: 'FL-FRN', emniyet: true },
    { kod: 'ikaz', metin: 'Korna, far ve ikaz ışığı çalışıyor; ekranda hata kodu yok', renk: 'beyaz', tur: 'FL-SNS' },
    { kod: 'catal', metin: 'Çatallarda çatlak, eğilme yok; zincir gergin', renk: 'kirmizi', tur: 'FL-CAT', emniyet: true },
  ],
  reach_truck: [
    { kod: 'aku', metin: 'Akü şarjı %30 üstünde, soket ve kablo sağlam', renk: 'beyaz', tur: 'RT-AKU' },
    { kod: 'hidrolik', metin: 'Zeminde ve direkte yağ izi yok, kaldırma sesi normal', renk: 'kirmizi', tur: 'RT-HID' },
    { kod: 'direk', metin: 'Direk zinciri gergin, makaralarda takılma yok', renk: 'kirmizi', tur: 'RT-MAS' },
    { kod: 'sensor', metin: 'Yükseklik göstergesi doğru, sensör camı temiz', renk: 'beyaz', tur: 'RT-SNS' },
    { kod: 'fren', metin: 'Fren tutuyor, korna ve ikaz ışığı çalışıyor', renk: 'kirmizi', tur: 'RT-AYR', emniyet: true },
  ],
  konveyor: [
    { kod: 'bant', metin: 'Bant ortada, kayma ve yırtık yok', renk: 'beyaz', tur: 'KV-BNT' },
    { kod: 'fotosel', metin: 'Fotoseller temiz ve hizalı', renk: 'beyaz', tur: 'KV-FTS' },
    { kod: 'acil', metin: 'Acil stop butonları çalışıyor (birini dene)', renk: 'kirmizi', tur: 'KV-MTR', emniyet: true },
    { kod: 'ses', metin: 'Motor ve makaralarda anormal ses, titreşim yok', renk: 'kirmizi', tur: 'KV-MTR' },
    { kod: 'temiz', metin: 'Hat üzerinde yabancı cisim, ezik koli yok', renk: 'beyaz', tur: 'KV-SIK' },
  ],
  sorter: [
    { kod: 'okuyucu', metin: 'Barkod okuyucu camı temiz, test barkodu okunuyor', renk: 'beyaz', tur: 'SR-OKU' },
    { kod: 'klape', metin: 'Klape ve tray\'lerde sıkışma, kırık yok', renk: 'kirmizi', tur: 'SR-TRY' },
    { kod: 'acil', metin: 'Acil stop butonları çalışıyor', renk: 'kirmizi', tur: 'SR-PLC', emniyet: true },
    { kod: 'acilis', metin: 'Açılış testi hatasız bitti', renk: 'kirmizi', tur: 'SR-ACL' },
    { kod: 'oluk', metin: 'Oluk sensörleri temiz, oluklarda koli kalmamış', renk: 'beyaz', tur: 'SR-SIK' },
  ],
  strec: [
    { kod: 'film', metin: 'Film rulosu vardiyaya yetecek, doğru takılı', renk: 'beyaz', tur: 'ST-FLM' },
    { kod: 'gerdirme', metin: 'Ön gerdirme makaraları temiz', renk: 'beyaz', tur: 'ST-AYR' },
    { kod: 'tabla', metin: 'Döner tablada anormal ses yok', renk: 'kirmizi', tur: 'ST-MTR' },
    { kod: 'bariyer', metin: 'Güvenlik bariyeri ve fotosel makineyi durduruyor', renk: 'kirmizi', tur: 'ST-MTR', emniyet: true },
  ],
};

export const listeBul = (tip) => KONTROL_LISTELERI[tip] || [];
