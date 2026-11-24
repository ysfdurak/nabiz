// Ziyaretçinin gerçek IP adresi (hız ve kullanım sınırları için). İstemcinin kendi gönderdiği başlıklara güvenilmez:
// - X-Forwarded-For yalnız istek yerel/özel ağdaki ters vekilden (Caddy) geliyorsa okunur ve son elemanı alınır.
//   Caddy 2.5+ güvenmediği istemciden gelen X-Forwarded-For'u atar; son eleman Caddy'nin gördüğü bağlantıdır.
// - CF-Connecting-IP yalnız o bağlantı Cloudflare'in yayımladığı adres aralıklarından geliyorsa okunur.
//   Alan adı Cloudflare'den geçmiyorsa (gri bulut) bu başlığı herkes yazabilir; yazılırsa yok sayılır.
// Cloudflare aralıkları: https://www.cloudflare.com/ips/ (son değişiklik Eylül 2023). Değişirse buradan güncellenir.
import { BlockList, isIP } from 'node:net';

const CLOUDFLARE = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];
const OZEL = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '::1/128', 'fc00::/7'];
const liste = (araliklar) => {
  const b = new BlockList();
  for (const a of araliklar) { const [ip, n] = a.split('/'); b.addSubnet(ip, +n, ip.includes(':') ? 'ipv6' : 'ipv4'); }
  return b;
};
const cf = liste(CLOUDFLARE), ozel = liste(OZEL);
const temiz = (ip) => String(ip || '').trim().replace(/^::ffff:(?=\d+\.)/, '');
const icinde = (b, ip) => { const t = isIP(ip); return t ? b.check(ip, t === 4 ? 'ipv4' : 'ipv6') : false; };

export function gercekIp(req) {
  const soket = temiz(req.socket?.remoteAddress);
  let es = soket;
  if (icinde(ozel, soket)) {
    const zincir = String(req.headers['x-forwarded-for'] || '').split(',').map(temiz).filter(Boolean);
    if (isIP(zincir.at(-1) || '')) es = zincir.at(-1);
  }
  const bulut = temiz(req.headers['cf-connecting-ip']);
  return icinde(cf, es) && isIP(bulut) ? bulut : es;
}
