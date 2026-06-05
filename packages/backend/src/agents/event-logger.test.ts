import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logAgentEvent } from './event-logger.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { logger } from '../utils/logger.js';
import { canonicalize, verifyAgentEvent } from '../utils/agent-signing.js';

// Single keypair for the file; ed25519 keygen is fast but reuse keeps tests cheap.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const KEY_ID = 'test-key-1';

interface CapturedCreate {
  data: {
    id: string;
    workflowId: string;
    taskId: string | null;
    agent: string;
    action: string;
    data: unknown;
    level: string;
    timestamp: Date;
    prevHash: string | null;
    eventHash: string | null;
    signature: string | null;
    signatureKeyId: string | null;
  };
}

// Wires prismaMock.$transaction to invoke its callback with the same mock as tx.
function setupTransactionMock() {
  // vitest-mock-extended types $transaction loosely; the cast lets us provide a callable.
  (prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)
  );
}

describe('logAgentEvent (chain + sign)', () => {
  let envSnapshot: Record<string, string | undefined>;

  const baseInput = {
    workflowId: 'wf-123',
    agent: 'document-agent',
    action: 'extract_text',
    data: { documentId: 'doc-1', pages: 5 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    envSnapshot = {
      AGENT_SIGNING_PRIVATE_KEY: process.env['AGENT_SIGNING_PRIVATE_KEY'],
      AGENT_SIGNING_PUBLIC_KEY: process.env['AGENT_SIGNING_PUBLIC_KEY'],
      AGENT_SIGNING_KEY_ID: process.env['AGENT_SIGNING_KEY_ID'],
      AGENT_SIGNING_MODE: process.env['AGENT_SIGNING_MODE'],
      NODE_ENV: process.env['NODE_ENV'],
    };
    process.env['AGENT_SIGNING_PRIVATE_KEY'] = PRIV_PEM;
    process.env['AGENT_SIGNING_PUBLIC_KEY'] = PUB_PEM;
    process.env['AGENT_SIGNING_KEY_ID'] = KEY_ID;
    delete process.env['AGENT_SIGNING_MODE'];

    setupTransactionMock();
    prismaMock.agentEvent.findFirst.mockResolvedValue(null as never);
    prismaMock.agentEvent.create.mockImplementation(async (args: unknown) => {
      const { data } = args as CapturedCreate;
      return data as never;
    });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('happy path — keys configured, fresh workflow', () => {
    it('writes an AgentEvent with prevHash=null, valid eventHash, and a verifiable signature', async () => {
      await logAgentEvent(baseInput);

      const call = prismaMock.agentEvent.create.mock.calls[0]?.[0] as CapturedCreate | undefined;
      expect(call).toBeDefined();
      const data = call!.data;

      expect(data.workflowId).toBe('wf-123');
      expect(data.agent).toBe('document-agent');
      expect(data.action).toBe('extract_text');
      expect(data.level).toBe('info');
      expect(data.taskId).toBeNull();
      expect(data.prevHash).toBeNull();
      expect(data.eventHash).toMatch(/^[a-f0-9]{64}$/);
      expect(data.signatureKeyId).toBe(KEY_ID);
      expect(data.signature).not.toBeNull();

      // Reconstruct canonical the way an external verifier would and verify the signature.
      const canonical = canonicalize({
        id: data.id,
        workflowId: data.workflowId,
        taskId: data.taskId,
        agent: data.agent,
        action: data.action,
        data: data.data,
        level: data.level,
        timestamp: data.timestamp.toISOString(),
        prevHash: data.prevHash,
      });
      expect(verifyAgentEvent(canonical, data.signature!, PUB_PEM)).toBe(true);
      expect(createHash('sha256').update(canonical).digest('hex')).toBe(data.eventHash);
    });

    it('threads prevHash from the prior event in the same workflow', async () => {
      prismaMock.agentEvent.findFirst.mockResolvedValueOnce({ eventHash: 'parent-hash-abc' } as never);

      await logAgentEvent(baseInput);

      const data = (prismaMock.agentEvent.create.mock.calls[0]?.[0] as CapturedCreate).data;
      expect(data.prevHash).toBe('parent-hash-abc');
      expect(data.eventHash).toMatch(/^[a-f0-9]{64}$/);

      // eventHash binds prevHash → changing prevHash must change eventHash.
      const canonical = canonicalize({
        id: data.id,
        workflowId: data.workflowId,
        taskId: data.taskId,
        agent: data.agent,
        action: data.action,
        data: data.data,
        level: data.level,
        timestamp: data.timestamp.toISOString(),
        prevHash: data.prevHash,
      });
      expect(createHash('sha256').update(canonical).digest('hex')).toBe(data.eventHash);
    });

    it('respects optional taskId and explicit level', async () => {
      await logAgentEvent({ ...baseInput, taskId: 'task-42', level: 'error' });

      const data = (prismaMock.agentEvent.create.mock.calls[0]?.[0] as CapturedCreate).data;
      expect(data.taskId).toBe('task-42');
      expect(data.level).toBe('error');
    });
  });

  describe('signing failure handling', () => {
    it('SHADOW mode (default): null signature + null keyId, eventHash still written', async () => {
      delete process.env['AGENT_SIGNING_PRIVATE_KEY'];
      await logAgentEvent(baseInput);

      const data = (prismaMock.agentEvent.create.mock.calls[0]?.[0] as CapturedCreate).data;
      expect(data.signature).toBeNull();
      expect(data.signatureKeyId).toBeNull();
      // Chain integrity still works in shadow mode.
      expect(data.eventHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('SHADOW mode: explicit AGENT_SIGNING_MODE=shadow behaves the same', async () => {
      process.env['AGENT_SIGNING_MODE'] = 'shadow';
      delete process.env['AGENT_SIGNING_PRIVATE_KEY'];
      await logAgentEvent(baseInput);

      const data = (prismaMock.agentEvent.create.mock.calls[0]?.[0] as CapturedCreate).data;
      expect(data.signature).toBeNull();
      expect(data.signatureKeyId).toBeNull();
    });

    it("ENFORCE mode: signature null but signatureKeyId='unsigned' + Sentry-grade error log", async () => {
      process.env['AGENT_SIGNING_MODE'] = 'enforce';
      delete process.env['AGENT_SIGNING_PRIVATE_KEY'];
      await logAgentEvent(baseInput);

      const data = (prismaMock.agentEvent.create.mock.calls[0]?.[0] as CapturedCreate).data;
      expect(data.signature).toBeNull();
      expect(data.signatureKeyId).toBe('unsigned');
      expect(data.eventHash).toMatch(/^[a-f0-9]{64}$/);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY P1'),
        expect.objectContaining({ workflowId: 'wf-123' })
      );
    });

    it('ENFORCE mode: malformed PEM still writes row with unsigned marker', async () => {
      process.env['AGENT_SIGNING_MODE'] = 'enforce';
      process.env['AGENT_SIGNING_PRIVATE_KEY'] = 'not-a-pem';
      await logAgentEvent(baseInput);

      const data = (prismaMock.agentEvent.create.mock.calls[0]?.[0] as CapturedCreate).data;
      expect(data.signature).toBeNull();
      expect(data.signatureKeyId).toBe('unsigned');
    });
  });

  describe('serializable transaction retry', () => {
    it('retries up to 5 times on Postgres P2034 (write conflict / 40001)', async () => {
      const conflictErr = Object.assign(new Error('write conflict'), { code: 'P2034' });
      const callable = prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>;
      callable.mockReset();
      let attempts = 0;
      callable.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => {
        attempts++;
        if (attempts < 4) throw conflictErr; // fail 3x, succeed on 4th
        return fn(prismaMock);
      });

      const result = await logAgentEvent(baseInput);
      expect(attempts).toBe(4);
      expect(result).not.toBeNull();
    });

    it('gives up after MAX_SERIALIZABLE_RETRIES and returns null without throwing', async () => {
      const conflictErr = Object.assign(new Error('could not serialize access'), { code: 'P2034' });
      const callable = prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>;
      callable.mockReset();
      let attempts = 0;
      callable.mockImplementation(async () => {
        attempts++;
        throw conflictErr;
      });

      const result = await logAgentEvent(baseInput);
      expect(attempts).toBe(5);
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to log agent event'),
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('fail-soft contract', () => {
    it('returns null on non-retryable DB error and never throws', async () => {
      const callable = prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>;
      callable.mockReset();
      callable.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await logAgentEvent(baseInput);
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to log agent event'),
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });
});
