const SENSITIVE_KEYS = new Set([
  'ssnEncrypted',
  'ssn_encrypted',
  'ssn',
  'caqhPassword',
  'caqh_password',
  'caqhUsername',
  'caqh_username',
  'taxId',
  'tax_id',
]);

/**
 * Defense-in-depth: recursively strip known sensitive fields from any object.
 * Primary defense is positive `select` in Prisma queries — this is a safety net.
 */
export function sanitizeRecord<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeRecord(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      continue;
    }
    result[key] = typeof value === 'object' ? sanitizeRecord(value) : value;
  }
  return result as T;
}
