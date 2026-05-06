/**
 * SSRF guard for outbound webhook delivery (Phase 0.A PR 4, Addition 1).
 *
 * Resolves a hostname and rejects any address that lands inside a
 * private / loopback / link-local / unique-local range. Used both at
 * subscription create time AND at delivery time — DNS rebinding requires
 * a fresh lookup per delivery, since a hostname can resolve to a
 * permitted IP at create time and a private IP later.
 *
 * Blocked ranges (per Addition 1):
 *   IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *         169.254.0.0/16 (link-local), 127.0.0.0/8 (loopback),
 *         0.0.0.0/8 (this network).
 *   IPv6: ::1 (loopback), fc00::/7 (unique-local), fe80::/10 (link-local),
 *         ::ffff:0:0/96 (IPv4-mapped — applies the IPv4 rules above).
 *
 * Contract: returns { ok: true, ip } on accept, { ok: false, reason } on
 * reject. Never throws — DNS errors are surfaced as { ok: false }. Caller
 * is responsible for HTTP-status mapping.
 */
import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

export type SsrfResult =
  | { ok: true; ip: string }
  | { ok: false; reason: string };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inIpv4Cidr(ipInt: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  if (!base || !bitsStr) return false;
  const baseInt = ipv4ToInt(base);
  const bits = Number(bitsStr);
  if (baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = ((0xffffffff << (32 - bits)) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '127.0.0.0/8',
  '0.0.0.0/8',
];

function isBlockedIpv4(ip: string): { blocked: true; cidr: string } | { blocked: false } {
  const n = ipv4ToInt(ip);
  if (n === null) return { blocked: false };
  for (const cidr of BLOCKED_IPV4_CIDRS) {
    if (inIpv4Cidr(n, cidr)) return { blocked: true, cidr };
  }
  return { blocked: false };
}

function expandIpv6(ip: string): number[] | null {
  // Handles IPv4-mapped (::ffff:1.2.3.4) and zone IDs (fe80::1%eth0).
  const stripped = ip.split('%')[0] ?? ip;

  // IPv4-mapped form — compare via IPv4 rules.
  const v4Match = stripped.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4Match && v4Match[1]) {
    const n = ipv4ToInt(v4Match[1]);
    if (n === null) return null;
    return [0, 0, 0, 0, 0, 0xffff, (n >>> 16) & 0xffff, n & 0xffff];
  }

  // Split on "::" for zero-run shorthand.
  const dblColonCount = (stripped.match(/::/g) ?? []).length;
  if (dblColonCount > 1) return null;

  let head: string[] = [];
  let tail: string[] = [];
  if (dblColonCount === 1) {
    const parts = stripped.split('::');
    head = parts[0] ? parts[0].split(':') : [];
    tail = parts[1] ? parts[1].split(':') : [];
  } else {
    head = stripped.split(':');
  }
  const fillCount = 8 - head.length - tail.length;
  if (fillCount < 0) return null;
  const groups = [...head, ...Array(fillCount).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  const result: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    result.push(parseInt(g, 16));
  }
  return result;
}

function isBlockedIpv6(ip: string): { blocked: true; reason: string } | { blocked: false } {
  const groups = expandIpv6(ip);
  if (!groups) return { blocked: false };

  // ::1 — loopback
  if (groups.every((g, i) => (i === 7 ? g === 1 : g === 0))) {
    return { blocked: true, reason: 'IPv6 loopback (::1)' };
  }

  // fc00::/7 — unique-local
  const first = groups[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return { blocked: true, reason: 'IPv6 unique-local (fc00::/7)' };

  // fe80::/10 — link-local
  if ((first & 0xffc0) === 0xfe80) return { blocked: true, reason: 'IPv6 link-local (fe80::/10)' };

  // ::ffff:x.x.x.x — apply IPv4 rules
  if (
    groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
    groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff
  ) {
    const v4 = `${(groups[6]! >>> 8) & 0xff}.${groups[6]! & 0xff}.${(groups[7]! >>> 8) & 0xff}.${groups[7]! & 0xff}`;
    const v4Check = isBlockedIpv4(v4);
    if (v4Check.blocked) return { blocked: true, reason: `IPv4-mapped ${v4} in ${v4Check.cidr}` };
  }

  return { blocked: false };
}

/**
 * Resolve `urlOrHostname` and return whether the address is delivery-safe.
 * Accepts either a full URL (https://example.com/path) or a bare hostname.
 */
export async function checkSsrfSafety(urlOrHostname: string): Promise<SsrfResult> {
  let hostname: string;
  try {
    hostname = urlOrHostname.includes('://') ? new URL(urlOrHostname).hostname : urlOrHostname;
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (!hostname) return { ok: false, reason: 'Empty hostname' };

  // URL parsing keeps the brackets on bracketed IPv6 hosts ("[::1]");
  // strip them before the family check so isIPv6() can recognize the value.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Literal IPs in the URL — check directly without DNS.
  if (isIPv4(hostname)) {
    const v4 = isBlockedIpv4(hostname);
    if (v4.blocked) return { ok: false, reason: `IPv4 in ${v4.cidr}` };
    return { ok: true, ip: hostname };
  }
  if (isIPv6(hostname)) {
    const v6 = isBlockedIpv6(hostname);
    if (v6.blocked) return { ok: false, reason: v6.reason };
    return { ok: true, ip: hostname };
  }

  // Hostname — resolve.
  let resolved: { address: string; family: number };
  try {
    resolved = await lookup(hostname);
  } catch (err) {
    return { ok: false, reason: `DNS lookup failed: ${(err as Error).message}` };
  }

  if (resolved.family === 4) {
    const v4 = isBlockedIpv4(resolved.address);
    if (v4.blocked) return { ok: false, reason: `${hostname} resolved to ${resolved.address} in ${v4.cidr}` };
  } else if (resolved.family === 6) {
    const v6 = isBlockedIpv6(resolved.address);
    if (v6.blocked) return { ok: false, reason: `${hostname} resolved to ${resolved.address}: ${v6.reason}` };
  }

  return { ok: true, ip: resolved.address };
}
