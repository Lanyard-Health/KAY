import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

/**
 * Dev-only mock of Aetna's "Join the Network" (RFP) wizard, used to exercise
 * the full Aetna enrollment workflow end-to-end WITHOUT creating a real
 * application at Aetna. Point the adapter at it via
 * `AETNA_RFP_START_URL=http://localhost:<port>/dev/mock-aetna-rfp`.
 *
 * Never mounted in production (guarded in index.ts). No auth on purpose: the
 * automation browser hits these endpoints exactly like it would hit Aetna's
 * public form.
 */
const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

router.get('/dev/mock-aetna-rfp', (_req: Request, res: Response) => {
  // Helmet's global CSP (default-src 'none') would block the wizard's own
  // fetch() calls; this page is dev-only and same-origin, so relax it here.
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'");
  // dist/routes -> dist/static (src/static is copied to dist/static at build).
  res.sendFile(path.resolve(__dirname, '../static/mock-aetna-rfp.html'));
});

// Wizard script served separately: helmet's CSP (script-src 'self') forbids
// inline scripts, so the page loads its logic from this same-origin file.
router.get('/dev/mock-aetna-rfp.js', (_req: Request, res: Response) => {
  res.sendFile(path.resolve(__dirname, '../static/mock-aetna-rfp.js'));
});

/** Mirrors Aetna's npcheck response shape: { data: { requestId } }. */
router.post('/api/provider/update/npcheck', (_req: Request, res: Response) => {
  const requestId = `9${Math.floor(1000000 + Math.random() * 8999999)}`; // 8 digits
  logger.info('[mock-aetna] npcheck — issued mock Request ID', { requestId });
  res.json({ data: { requestId } });
});

/** Mirrors Aetna's submitrequest response shape: { data: { confirmationNumber } }. */
router.post('/api/provider/update/submitrequest', (req: Request, res: Response) => {
  const confirmationNumber = `8${Math.floor(1000000 + Math.random() * 8999999)}`;
  logger.info('[mock-aetna] submitrequest — issued mock confirmation number', {
    confirmationNumber,
    requestId: (req.body as { requestId?: string } | undefined)?.requestId,
  });
  res.json({ data: { confirmationNumber } });
});

export default router;
