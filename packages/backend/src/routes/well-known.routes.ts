import { Router, Request, Response } from 'express';
import { getKeyset } from '../utils/agent-signing.js';

// Public verification keys for AgentEvent signatures (Phase 0.A).
// No auth — these are by definition public. Cached client-side for 5 minutes.

const router = Router();

router.get('/lanyard-signing-key.pem', (_req: Request, res: Response) => {
  const { current } = getKeyset();
  if (!current) {
    return res.status(503).type('text/plain').send('Signing key not configured');
  }
  res.set({
    'Content-Type': 'application/x-pem-file',
    'Cache-Control': 'public, max-age=300',
  });
  return res.send(current.publicKey);
});

router.get('/lanyard-signing-keys.json', (_req: Request, res: Response) => {
  const { current, retired } = getKeyset();
  const keys: Array<{ keyId: string; publicKey: string; status: 'current' | 'retired'; retiredAt?: string }> = [];
  if (current) {
    keys.push({ keyId: current.keyId, publicKey: current.publicKey, status: 'current' });
  }
  for (const k of retired) {
    keys.push({
      keyId: k.keyId,
      publicKey: k.publicKey,
      status: 'retired',
      ...(k.retiredAt ? { retiredAt: k.retiredAt } : {}),
    });
  }
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ keys });
});

export { router as wellKnownRoutes };
