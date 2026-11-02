import { BlockList, isIP } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { env, log } from '../env';

/**
 * Klientens rigtige IP bag Render.
 *
 * Al trafik til Render – både tilbudsradaren.dk og *.onrender.com – går gennem
 * Cloudflare og derefter Renders egne proxyer. Cloudflare sætter
 * CF-Connecting-IP til den besøgendes IP og afviser selv forespørgsler, hvor
 * klienten har sendt den header (fejl 1000), så den kan ikke forfalskes.
 * Uden den bruges X-Forwarded-For, hvor kun Renders interne proxyer og
 * Cloudflare er betroede: den første adresse fra højre, der ikke er en af dem,
 * er klienten. Poster, klienten selv har sat ind længere til venstre, ignoreres.
 */

/** Cloudflares adresser – https://www.cloudflare.com/ips/ (hentet 2. november 2026). */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Interne net (loopback, link-local, private og carrier-grade NAT) – her ligger Renders egne proxyer. */
const INTERNAL_RANGES = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

function blockList(cidrs: string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address, bits] = cidr.split('/') as [string, string];
    list.addSubnet(address, Number(bits), isIP(address) === 6 ? 'ipv6' : 'ipv4');
  }
  return list;
}

const internal = blockList(INTERNAL_RANGES);
const cloudflare = blockList(CLOUDFLARE_RANGES);

/** Trimmer, fjerner zone-id og pakker IPv4 i IPv6 ud ("::ffff:1.2.3.4" → "1.2.3.4"). */
export function normalizeIp(value: string): string {
  const ip = value.trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped ? mapped[1]! : ip;
}

function inList(list: BlockList, value: string): boolean {
  const ip = normalizeIp(value);
  const version = isIP(ip);
  return version !== 0 && list.check(ip, version === 6 ? 'ipv6' : 'ipv4');
}

export const isInternalIp = (ip: string) => inList(internal, ip);
export const isCloudflareIp = (ip: string) => inList(cloudflare, ip);

/** Værdien til `app.set('trust proxy', …)`: kun Renders interne proxyer og Cloudflare er betroede. */
export const trustProxy = (address: string): boolean => isInternalIp(address) || isCloudflareIp(address);

export function clientIp(req: Request, options: { trustCloudflareHeader?: boolean } = {}): string {
  if (options.trustCloudflareHeader ?? env.trustCloudflareIp) {
    const header = normalizeIp(req.get('cf-connecting-ip') ?? '');
    if (isIP(header)) return header;
  }
  return normalizeIp(req.ip ?? req.socket.remoteAddress ?? '') || 'ukendt';
}

/** De første 64 bit af en IPv6-adresse – det net, en enkelt kunde typisk har. */
export function ipv6Prefix64(ip: string): string {
  const [head = '', tail] = ip.split('::') as [string, string | undefined];
  const groups = (part: string) =>
    part
      ? part.split(':').flatMap((g) => {
          if (!g.includes('.')) return [g];
          const [a, b, c, d] = g.split('.').map(Number) as [number, number, number, number];
          return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
        })
      : [];
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const full = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return full
    .slice(0, 4)
    .map((g) => parseInt(g || '0', 16).toString(16))
    .join(':');
}

/** Nøgle til rate limiting: IPv4-adressen, eller /64-nettet for IPv6 (så en klient ikke kan skifte adresse i sit eget net). */
export function clientKey(req: Request, options?: { trustCloudflareHeader?: boolean }): string {
  const ip = clientIp(req, options);
  return isIP(ip) === 6 ? `${ipv6Prefix64(ip)}::/64` : ip;
}

/**
 * Logger én gang pr. proces, hvordan proxykæden ser ud – uden IP-adresser –
 * så opsætningen kan efterprøves i Render-loggen efter en deploy.
 */
let chainLogged = false;
export const logProxyChainOnce: RequestHandler = (req, _res, next) => {
  if (!chainLogged && env.isProd && req.get('cf-connecting-ip')) {
    chainLogged = true;
    const forwarded = (req.get('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const hops = [req.socket.remoteAddress ?? '', ...forwarded.reverse()].map((ip) =>
      isInternalIp(ip) ? 'intern' : isCloudflareIp(ip) ? 'cloudflare' : 'anden',
    );
    log.info('Proxykæde (nærmeste først, uden IP-adresser)', {
      hops,
      trustCloudflareIp: env.trustCloudflareIp,
      reqIpMatchesCloudflareHeader: normalizeIp(req.ip ?? '') === normalizeIp(req.get('cf-connecting-ip') ?? ''),
    });
  }
  next();
};
