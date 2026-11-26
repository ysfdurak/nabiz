// Nabız MCP kapısı: kurum alanının ('ana') verisini Claude'a salt okuma araçlarıyla açar.
//
// İkili yapı:  çekirdek (src/cekirdek: kontrol listeleri, kurallar) + servis (server/servis.js)
//                ├─ web kapısı: /v1   (telefon arayüzü)
//                └─ MCP kapısı: /mcp  (Claude) — yazma yok: etiket açma/kapama sahadaki kişinin işi
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { KuralHatasi } from './servis.js';

const OKUMA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const MCP_ARAC_ADLARI = ['ekipman_durumu', 'etiketleri_listele', 'etiket_detayi', 'ekipman_karti', 'tpm_ozeti', 'oee_ve_kayiplar', 'guvenilirlik', 'a3_taslagi', 'bakim_durumu', 'otonom_bakim_olgunlugu'];

const TALIMAT = `Nabız, Yıldız Ev & Yaşam deposunun TPM (Toplam Verimli Bakım) uygulamasıdır.
Operatörler vardiya başında ekipmanı kontrol eder (otonom bakım), sorunu etiketler: kırmızı = bakım ekibi gerekir, beyaz = operatör kendisi giderir.
Her etiketin sorumlusu ve hedef tarihi vardır; hedefi geçmiş açık etiket "gecikti" sayılır. "Ekipman çalışamıyor" işaretliyse Arıza Defteri'ne arıza düşer.
V2: OEE ve 6 büyük kayıp (oee_ve_kayiplar), güvenilirlik ve bakım aralığı (guvenilirlik), A3 taslağı (a3_taslagi). "Neden sık arıza" sorusunda önce guvenilirlik ve oee_ve_kayiplar'a bak.
V3: planlı bakım takvimi ve sayaç (bakim_durumu: "geciken bakımlar" sorusunun cevabı), otonom bakımın 7 adımı (otonom_bakim_olgunlugu).
Araçlar salt okumadır. Kontrol ve etiket kaydını sahadaki kişi telefondan yapar.`;

export function createMcpHandler({ servis, log = () => {} }) {
  const KUM = 'ana';
  const ARACLAR = [
    ['ekipman_durumu', 'Bu vardiyada her ekipmanın kontrolü yapıldı mı, sorunlu madde sayısı ve açık kırmızı/beyaz etiketleri.', {},
      () => servis.ekipmanlar(KUM)],
    ['etiketleri_listele', 'Etiketler (yeniden eskiye): sorumlu, hedef tarih ve gecikme dahil. Filtreler isteğe bağlı; "geciken" ile yalnız hedefi geçmiş açık etiketler.', {
      durum: z.enum(['acik', 'kapali']).optional(),
      renk: z.enum(['kirmizi', 'beyaz']).optional(),
      ekipman: z.string().max(10).optional().describe('Ekipman kodu, ör. RT-03.'),
      sorumlu: z.string().max(12).optional().describe('Sorumlu kişi kodu, ör. K-MKAYA.'),
      geciken: z.boolean().optional().describe('true: yalnız hedef tarihi geçmiş açık etiketler.'),
    }, (a) => servis.etiketler(KUM, a)],
    ['etiket_detayi', 'Tek etiket: açıklama, kim açtı/kapattı, sorumlu ve hedef tarih, Arıza Defteri gönderimlerinin durumu.', {
      id: z.string().max(20).describe('Etiket kimliği, ör. E-1a2b3c4d5e6f.'),
    }, (a) => servis.etiketDetay(KUM, a.id)],
    ['ekipman_karti', 'Tek ekipman: kontrol listesi, bu vardiyanın kontrolü, son kontroller, açık/kapanan etiketler, Arıza Defteri\'ndeki son arızalar.', {
      kod: z.string().max(10).describe('Ekipman kodu, ör. FL-01.'),
    }, (a) => servis.ekipmanKarti(KUM, a.kod)],
    ['tpm_ozeti', 'Kontrol uyumu (bugün ve dönem), eksik kontroller, açık ve geciken etiketler, sorumlu başına yük, ortalama kapanma süresi, en sık sorunlu maddeler.', {
      gun: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional().describe('Dönem: 1, 7 ya da 30 gün. Varsayılan 7.'),
    }, (a) => servis.ozet(KUM, { gun: a.gun })],
    ['oee_ve_kayiplar', 'OEE (kullanılabilirlik × performans × kalite) depo, tip, ekipman ve gün bazında; 6 büyük kayıp; arıza Pareto\'su. Veri Arıza Defteri\'nden (sentetik).', {
      gun: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional().describe('Dönem: 7, 30 ya da 90 gün. Varsayılan 30.'),
    }, (a) => servis.kayipAnalizi({ gun: a.gun })],
    ['guvenilirlik', 'Nabız Analiz (Python) raporu: arıza türü başına güç yasası β (aşınma/rastgele/erken, güven aralığıyla) ve ekipman tipi başına bakım aralığı önerisi.', {
      tip: z.enum(['forklift', 'reach_truck', 'konveyor', 'sorter', 'strec']).optional(),
    }, async (a) => {
      const r = await servis.guvenilirlik();
      return a.tip ? { ...r, turler: r.turler.filter((t) => t.tip === a.tip), tipler: r.tipler.filter((t) => t.tip === a.tip) } : r;
    }],
    ['a3_taslagi', 'Bir arıza türü için A3 problem çözme taslağı: arka plan, mevcut durum, analiz (güvenilirlik ve bulgular), hedef, kural tabanlı karşı önlemler.', {
      tur: z.string().max(10).describe('Arıza türü kodu, ör. RT-HID.'),
    }, (a) => servis.a3(a.tur)],
    ['bakim_durumu', 'Planlı bakım tablosu: ekipman başına son bakım, takvimdeki sıradaki bakım, bakımdan beri gün ve çalışma saati (sayaç), Nabız Analiz önerisi ve durum: gecikti (takvime göre), oneriye_gore (önerilen aralık aşıldı), yaklasiyor (3 gün içinde), normal. "Geciken bakımları listele" için durum=gecikti.', {
      durum: z.enum(['gecikti', 'oneriye_gore', 'yaklasiyor', 'normal']).optional(),
      tip: z.enum(['forklift', 'reach_truck', 'konveyor', 'sorter', 'strec']).optional(),
    }, async (a) => {
      const r = await servis.bakimDurumu();
      return { ...r, satirlar: r.satirlar.filter((x) => (!a.durum || x.durum === a.durum) && (!a.tip || x.tip === a.tip)) };
    }],
    ['otonom_bakim_olgunlugu', 'Otonom bakımın 7 adımı, ekipman tipi başına: hangi adımda olduğu ve her adımın kanıtı (son 30 günün kontrol ve etiketlerinden). 5-7. adımlar ölçülmüyor.', {}, () => servis.olgunluk(KUM)],
  ];

  function buildServer() {
    const server = new McpServer({ name: 'nabiz', version: '0.1.0' }, { instructions: TALIMAT });
    for (const [name, description, inputSchema, calistir] of ARACLAR) {
      server.registerTool(name, { description, inputSchema, annotations: OKUMA }, async (args) => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(await calistir(args), null, 2) }] };
        } catch (err) {
          if (err instanceof KuralHatasi) return { isError: true, content: [{ type: 'text', text: err.message }] };
          log(`MCP hatası (${name}): ${err?.stack || err}`);
          return { isError: true, content: [{ type: 'text', text: 'İstek işlenemedi.' }] };
        }
      });
    }
    return server;
  }

  async function handle(req, res, body) {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
  return { handle };
}
