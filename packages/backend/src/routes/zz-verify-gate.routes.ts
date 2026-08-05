// TEMPORARY — proves the tenant-scope CI job blocks a merge. Deleted immediately.
import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
const r = Router();
r.get('/', async (_req, res) => {
  res.json(await prisma.portalCredential.findMany({}));
});
export default r;
