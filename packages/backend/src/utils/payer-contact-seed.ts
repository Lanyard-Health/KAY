/**
 * Payer contact-info seeding logic (Tasks v2). Exact-normalized matching ONLY
 * — no fuzzy matching: a wrong number on click-to-call is worse than the
 * designed empty state. Misses simply fall back to "Nothing on file".
 */

const CORPORATE_SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'corp', 'corporation', 'co', 'company']);

export function normalizePayerName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  while (words.length > 1 && CORPORATE_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

export interface ContactSeedSource {
  trackName: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  hours: string | null;
  notes: string | null;
}

export interface SeedPlanRow {
  payerId: string;
  payerName: string;
  source: 'payer_contact' | 'payer_phone';
  phone: string | null;
  email: string | null;
  hours: string | null;
  notes: string | null;
}

export function planContactSeeds(
  payers: { id: string; name: string; phone: string | null }[],
  contacts: ContactSeedSource[],
  existingPayerIds: Set<string>,
): SeedPlanRow[] {
  // Group contacts by normalized track name; a Credentialing-type contact wins.
  const byName = new Map<string, ContactSeedSource>();
  for (const contact of contacts) {
    const key = normalizePayerName(contact.trackName);
    const current = byName.get(key);
    if (!current || (contact.contactType === 'Credentialing' && current.contactType !== 'Credentialing')) {
      byName.set(key, contact);
    }
  }

  const plan: SeedPlanRow[] = [];
  for (const payer of payers) {
    if (existingPayerIds.has(payer.id)) continue; // idempotent — never touch existing rows
    const match = byName.get(normalizePayerName(payer.name));
    if (match && (match.phone || match.email)) {
      plan.push({ payerId: payer.id, payerName: payer.name, source: 'payer_contact', phone: match.phone, email: match.email, hours: match.hours, notes: match.notes });
    } else if (payer.phone) {
      plan.push({ payerId: payer.id, payerName: payer.name, source: 'payer_phone', phone: payer.phone, email: null, hours: null, notes: null });
    }
    // else: no data → no row → designed empty state
  }
  return plan;
}
