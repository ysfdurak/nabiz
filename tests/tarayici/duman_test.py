"""Tarayıcı duman testi (telefon boyutu): kişi seç → ekipman kartı → vardiya kontrolü (1 sorun) → etiket + fotoğraf →
etiket sayfası (benzetim gönderimi) → etiketler → özet → QR. Konsol hatası ve CSP ihlali olmamalı. Ekran görüntüleri docs/ekranlar/.
Kullanım: python3 tests/tarayici/duman_test.py [chrome-yolu] [adres]   (sunucu çalışıyor olmalı: npm run start:dev)"""
import sys, io, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

chrome = sys.argv[1] if len(sys.argv) > 1 else None
adres = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8081/"
cikti = Path(__file__).resolve().parents[2] / "docs" / "ekranlar"
cikti.mkdir(parents=True, exist_ok=True)

# Fotoğraf: Pillow varsa gerçek bir JPEG, yoksa en küçük geçerli JPEG
foto = Path(tempfile.gettempdir()) / "nabiz-test.jpg"
try:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1600, 1200), (200, 190, 170)); d = ImageDraw.Draw(im); d.ellipse((600, 700, 900, 850), fill=(60, 45, 20))
    im.save(foto, "JPEG", quality=85)
except ImportError:
    foto.write_bytes(bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f00d2cf20ffd9"))

hatalar = []
with sync_playwright() as p:
    t = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
    for tema in ["light", "dark"]:
        b = t.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme=tema, is_mobile=True, has_touch=True)
        s = b.new_page()
        s.on("console", lambda m: hatalar.append(f"{tema}: {m.text}") if m.type in ("error", "warning") else None)
        s.on("pageerror", lambda e: hatalar.append(f"{tema}: {e}"))
        ek = "" if tema == "light" else "-koyu"
        s.goto(adres)
        s.wait_for_selector("#kisi-penceresi[open]")
        s.screenshot(path=str(cikti / f"kisi-secimi{ek}.png"))
        s.get_by_role("button", name="Ali Yılmaz").click()
        s.wait_for_selector(".liste .satir")
        s.screenshot(path=str(cikti / f"ekipman{ek}.png"), full_page=False)
        if tema == "dark":
            b.close(); continue
        s.goto(adres + "#/e/RT-03")
        s.wait_for_selector(".kart-baslik h1")
        s.screenshot(path=str(cikti / "kart.png"), full_page=True)
        s.goto(adres + "#/kontrol/RT-03")
        s.wait_for_selector(".madde")
        s.get_by_role("button", name='Hepsini "tamam" işaretle').click()
        s.locator(".madde").nth(1).get_by_role("button", name="Sorun var").click()
        s.screenshot(path=str(cikti / "kontrol.png"), full_page=True)
        s.get_by_role("button", name="Kaydet").click()
        s.wait_for_selector("text=Kontrol kaydedildi, sorun var")
        s.get_by_text("Kırmızı etiket aç").click()
        s.wait_for_selector("#aciklama")
        s.fill("#aciklama", "Direkte yağ izi var")
        s.set_input_files("#foto", str(foto))
        s.wait_for_selector(".onizleme:not(.gizli)")
        s.check("#durus")
        s.screenshot(path=str(cikti / "etiket-ac.png"), full_page=True)
        s.get_by_role("button", name="Etiketi aç").click()
        s.wait_for_selector("text=Bağlı sistemler")
        s.wait_for_selector("img.foto")
        assert s.locator("text=Benzetim").count() == 2, "iki gönderim benzetim olmalı"
        s.screenshot(path=str(cikti / "etiket.png"), full_page=True)
        assert s.evaluate("document.querySelector('img.foto').naturalWidth") == 1280, "fotoğraf 1280 piksele küçültülmeli"
        # Operatör kırmızıyı kapatamaz; teknisyene geç ve kapat
        assert s.locator("text=Kırmızı etiketi teknisyen ya da şef kapatır").count() == 1
        s.click("#kisi-dugme"); s.get_by_role("button", name="Serkan Aydın").click()
        s.wait_for_selector("textarea")
        s.fill("form.kapat textarea", "Hortum değiştirildi")
        s.get_by_role("button", name="Kapat", exact=True).click()
        s.wait_for_selector("text=Kapatan")
        s.goto(adres + "#/etiketler?durum=acik&renk=kirmizi")
        s.wait_for_selector("h1:has-text('Etiketler')")
        s.screenshot(path=str(cikti / "etiketler.png"))
        # V2: duruş kaydı, kayıp ve OEE, güvenilirlik, A3
        s.goto(adres + "#/durus/KV-02")
        s.wait_for_selector("#tur")
        s.select_option("#tur", "KV-HIZ")
        s.fill("#sure", "25")
        s.fill("#aciklama", "Hat yavaşladı")
        s.get_by_role("button", name="Kaydet").click()
        s.wait_for_selector(".durus")
        s.goto(adres + "#/kayip")
        s.wait_for_selector(".selale")
        s.wait_for_selector("svg polyline")
        s.screenshot(path=str(cikti / "kayip.png"), full_page=True)
        s.goto(adres + "#/analiz")
        s.wait_for_selector("svg.beta")
        s.screenshot(path=str(cikti / "analiz.png"), full_page=True)
        s.locator(".tur-satir a", has_text="RT-MAS").click()
        s.wait_for_selector(".a3-bolum")
        assert s.locator(".a3-bolum").count() == 7
        s.screenshot(path=str(cikti / "a3.png"), full_page=True)
        s.goto(adres + "#/ozet")
        s.wait_for_selector(".kpi")
        s.screenshot(path=str(cikti / "ozet.png"), full_page=True)
        s.goto(adres + "#/qr")
        s.wait_for_selector(".qr img")
        for _ in range(50):  # wait_for_function CSP'li sayfada çalışmaz (dizeyi eval eder); evaluate ile yokla
            if s.evaluate("[...document.querySelectorAll('.qr img')].slice(0,4).every(i => i.complete && i.naturalWidth > 0)"): break
            s.wait_for_timeout(100)
        s.screenshot(path=str(cikti / "qr.png"))
        b.close()
    t.close()
if hatalar:
    print("\n".join(hatalar)); sys.exit(1)
print("Duman testi geçti; ekran görüntüleri:", cikti)
