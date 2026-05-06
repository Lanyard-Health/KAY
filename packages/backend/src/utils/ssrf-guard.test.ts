import { describe, it, expect, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { checkSsrfSafety } from './ssrf-guard.js';
import { lookup } from 'node:dns/promises';

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

describe('checkSsrfSafety — literal IPs', () => {
  it('rejects loopback IPv4 (127.0.0.1)', async () => {
    const r = await checkSsrfSafety('https://127.0.0.1/path');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/127\.0\.0\.0\/8/);
  });

  it('rejects 10.x.x.x', async () => {
    const r = await checkSsrfSafety('http://10.0.0.5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/10\.0\.0\.0\/8/);
  });

  it('rejects 172.16.x.x – 172.31.x.x', async () => {
    const r = await checkSsrfSafety('http://172.20.10.1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/172\.16\.0\.0\/12/);
  });

  it('accepts 172.15.x.x (just outside private range)', async () => {
    const r = await checkSsrfSafety('http://172.15.10.1');
    expect(r.ok).toBe(true);
  });

  it('rejects 192.168.x.x', async () => {
    const r = await checkSsrfSafety('http://192.168.1.1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/192\.168\.0\.0\/16/);
  });

  it('rejects link-local 169.254.x.x (AWS metadata)', async () => {
    const r = await checkSsrfSafety('http://169.254.169.254/latest/meta-data');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/169\.254\.0\.0\/16/);
  });

  it('rejects 0.0.0.0', async () => {
    const r = await checkSsrfSafety('http://0.0.0.0');
    expect(r.ok).toBe(false);
  });

  it('accepts public IPv4 8.8.8.8', async () => {
    const r = await checkSsrfSafety('http://8.8.8.8');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ip).toBe('8.8.8.8');
  });

  it('rejects IPv6 loopback ::1', async () => {
    const r = await checkSsrfSafety('http://[::1]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/loopback/);
  });

  it('rejects IPv6 link-local fe80::', async () => {
    const r = await checkSsrfSafety('http://[fe80::1]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/link-local/);
  });

  it('rejects IPv6 unique-local fc00::', async () => {
    const r = await checkSsrfSafety('http://[fc00::1]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unique-local/);
  });

  it('rejects IPv4-mapped IPv6 ::ffff:127.0.0.1', async () => {
    const r = await checkSsrfSafety('http://[::ffff:127.0.0.1]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/IPv4-mapped/);
  });

  it('accepts public IPv6 2606:4700:4700::1111', async () => {
    const r = await checkSsrfSafety('http://[2606:4700:4700::1111]');
    expect(r.ok).toBe(true);
  });
});

describe('checkSsrfSafety — hostname resolution', () => {
  it('rejects hostname that resolves to a private IP', async () => {
    lookupMock.mockResolvedValueOnce({ address: '10.0.0.1', family: 4 });
    const r = await checkSsrfSafety('https://internal.evil.example/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/internal\.evil\.example.*10\.0\.0\.1/);
  });

  it('accepts hostname that resolves to a public IP', async () => {
    lookupMock.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 });
    const r = await checkSsrfSafety('https://example.com/webhook');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ip).toBe('93.184.216.34');
  });

  it('rejects hostname when DNS lookup fails', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const r = await checkSsrfSafety('https://nope.invalid/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/DNS lookup failed/);
  });

  it('rejects an invalid URL', async () => {
    const r = await checkSsrfSafety('http://[invalid');
    expect(r.ok).toBe(false);
  });
});
