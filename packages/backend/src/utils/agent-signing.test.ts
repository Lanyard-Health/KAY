import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalize,
  signAgentEvent,
  verifyAgentEvent,
  getKeyset,
  isSigningAvailable,
} from './agent-signing.js';

describe('agent-signing', () => {
  // Single keypair for the whole file — Ed25519 keygen is fast but reuse is fine.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const KEY_ID = 'test-key-1';

  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    snapshot = {
      AGENT_SIGNING_PRIVATE_KEY: process.env['AGENT_SIGNING_PRIVATE_KEY'],
      AGENT_SIGNING_PUBLIC_KEY: process.env['AGENT_SIGNING_PUBLIC_KEY'],
      AGENT_SIGNING_KEY_ID: process.env['AGENT_SIGNING_KEY_ID'],
      AGENT_SIGNING_RETIRED_KEYS: process.env['AGENT_SIGNING_RETIRED_KEYS'],
      NODE_ENV: process.env['NODE_ENV'],
    };
    process.env['AGENT_SIGNING_PRIVATE_KEY'] = PRIV_PEM;
    process.env['AGENT_SIGNING_PUBLIC_KEY'] = PUB_PEM;
    process.env['AGENT_SIGNING_KEY_ID'] = KEY_ID;
    delete process.env['AGENT_SIGNING_RETIRED_KEYS'];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('canonicalize()', () => {
    it('produces identical output regardless of key insertion order', () => {
      const a = canonicalize({ b: 1, a: 2, c: 3 });
      const b = canonicalize({ c: 3, a: 2, b: 1 });
      expect(a).toBe(b);
    });

    it('preserves array order', () => {
      expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    });

    it('handles nested objects with sorted keys at every level', () => {
      const out = canonicalize({ outer: { z: 1, a: 2 }, x: [{ b: 1, a: 2 }] });
      expect(out).toBe('{"outer":{"a":2,"z":1},"x":[{"a":2,"b":1}]}');
    });

    it('handles primitives', () => {
      expect(canonicalize('hi')).toBe('"hi"');
      expect(canonicalize(42)).toBe('42');
      expect(canonicalize(null)).toBe('null');
      expect(canonicalize(true)).toBe('true');
      expect(canonicalize(false)).toBe('false');
    });

    it('handles empty object and array', () => {
      expect(canonicalize({})).toBe('{}');
      expect(canonicalize([])).toBe('[]');
    });
  });

  describe('signAgentEvent / verifyAgentEvent', () => {
    it('signs and verifies a canonical payload', () => {
      const payload = canonicalize({ workflowId: 'w1', action: 'task_dispatched', taskId: 't1' });
      const { signature, keyId } = signAgentEvent(payload);
      expect(signature).toBeTruthy();
      expect(keyId).toBe(KEY_ID);
      expect(verifyAgentEvent(payload, signature as string, PUB_PEM)).toBe(true);
    });

    it('verify returns false when payload differs', () => {
      const payload = canonicalize({ workflowId: 'w1' });
      const { signature } = signAgentEvent(payload);
      expect(verifyAgentEvent(canonicalize({ workflowId: 'w2' }), signature as string, PUB_PEM)).toBe(false);
    });

    it('verify returns false on malformed signature', () => {
      const payload = canonicalize({ x: 1 });
      expect(verifyAgentEvent(payload, 'not-base64-or-too-short', PUB_PEM)).toBe(false);
    });

    it('verify returns false on malformed public key', () => {
      const payload = canonicalize({ x: 1 });
      const { signature } = signAgentEvent(payload);
      expect(verifyAgentEvent(payload, signature as string, 'not-a-pem')).toBe(false);
    });

    it('FAIL-SOFT: missing private key → unsigned, never throws', () => {
      delete process.env['AGENT_SIGNING_PRIVATE_KEY'];
      const result = signAgentEvent('{"a":1}');
      expect(result.signature).toBeNull();
      expect(result.keyId).toBe('unsigned');
    });

    it('FAIL-SOFT: missing key id → unsigned, never throws', () => {
      delete process.env['AGENT_SIGNING_KEY_ID'];
      const result = signAgentEvent('{"a":1}');
      expect(result.signature).toBeNull();
      expect(result.keyId).toBe('unsigned');
    });

    it('FAIL-SOFT: malformed PEM → unsigned, never throws', () => {
      process.env['AGENT_SIGNING_PRIVATE_KEY'] = 'not-a-pem';
      const result = signAgentEvent('{"a":1}');
      expect(result.signature).toBeNull();
      expect(result.keyId).toBe('unsigned');
    });
  });

  describe('isSigningAvailable()', () => {
    it('true when private key + key id set', () => {
      expect(isSigningAvailable()).toBe(true);
    });

    it('false when private key missing', () => {
      delete process.env['AGENT_SIGNING_PRIVATE_KEY'];
      expect(isSigningAvailable()).toBe(false);
    });

    it('false when key id missing', () => {
      delete process.env['AGENT_SIGNING_KEY_ID'];
      expect(isSigningAvailable()).toBe(false);
    });
  });

  describe('getKeyset()', () => {
    it('returns current key when configured', () => {
      const ks = getKeyset();
      expect(ks.current).toEqual({ keyId: KEY_ID, publicKey: PUB_PEM, status: 'current' });
      expect(ks.retired).toEqual([]);
    });

    it('returns null current when public key missing', () => {
      delete process.env['AGENT_SIGNING_PUBLIC_KEY'];
      expect(getKeyset().current).toBeNull();
    });

    it('parses retired keys from JSON env var', () => {
      process.env['AGENT_SIGNING_RETIRED_KEYS'] = JSON.stringify([
        { keyId: 'old-1', publicKey: '-----BEGIN OLD-----', retiredAt: '2026-04-01T00:00:00Z' },
      ]);
      const ks = getKeyset();
      expect(ks.retired).toHaveLength(1);
      expect(ks.retired[0]?.keyId).toBe('old-1');
      expect(ks.retired[0]?.status).toBe('retired');
      expect(ks.retired[0]?.retiredAt).toBe('2026-04-01T00:00:00Z');
    });

    it('returns empty retired array when JSON is malformed', () => {
      process.env['AGENT_SIGNING_RETIRED_KEYS'] = 'not-json';
      expect(getKeyset().retired).toEqual([]);
    });

    it('skips retired entries missing required fields', () => {
      process.env['AGENT_SIGNING_RETIRED_KEYS'] = JSON.stringify([
        { keyId: 'good-1', publicKey: '-----PEM-----' },
        { keyId: 'no-pem' },
        { publicKey: '-----PEM-----' },
        'not-an-object',
      ]);
      const ks = getKeyset();
      expect(ks.retired).toHaveLength(1);
      expect(ks.retired[0]?.keyId).toBe('good-1');
    });
  });
});
